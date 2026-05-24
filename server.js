const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TICK_RATE = 20;
const MAX_HP = 100;

const WEAPONS = {
  ar:     { dmg: 25,  cooldown: 110,  range: 80                              },
  pump:   { dmg: 15,  cooldown: 800,  range: 22,  pellets: 10, spread: 0.09  },
  sniper: { dmg: 100, cooldown: 1400, range: 250                             },
};
const MAP_SIZE = 200;
const ZONE_DAMAGE_PER_SEC = 5;
const ZONE_SHRINK_INTERVAL_MS = 30000;
const ZONE_SHRINK_FACTOR = 0.6;
const MIN_ZONE_RADIUS = 8;
const MAX_SHIELD = 100;
const SHIELD_PER_POTION = 25;
const POTION_COUNT = 30;
const PICKUP_RADIUS = 1.8;
const GRID = 4;
const PIECE_HP = 100;
const MAX_PIECE_RANGE = 14;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const players = new Map(); // id -> {ws, name, x,y,z, rotY, hp, alive, lastSeen}
const obstacles = generateObstacles();

let nextId = 1;
let gameState = 'waiting'; // waiting | playing | ended
let zone = { cx: 0, cz: 0, r: MAP_SIZE / 2 };
let potions = []; // {id, x, z}
let nextPotionId = 1;
const pieces = new Map(); // key -> {id, type, gx, gy, gz, rot, hp, tiles, ownerId, key}
let nextPieceId = 1;
let lastShrink = Date.now();
let lastTick = Date.now();
let lastZoneDamage = Date.now();
let winnerInfo = null;
let gameEndTime = 0;

function generateObstacles() {
  // Deterministic so client and server share the same layout
  const obs = [];
  const seed = 42;
  let s = seed;
  const rng = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < 40; i++) {
    const w = 4 + rng() * 8;
    const h = 3 + rng() * 8;
    const d = 4 + rng() * 8;
    const x = (rng() - 0.5) * (MAP_SIZE - 20);
    const z = (rng() - 0.5) * (MAP_SIZE - 20);
    obs.push({ x, y: h / 2, z, w, h, d });
  }
  // Trees
  for (let i = 0; i < 60; i++) {
    const x = (rng() - 0.5) * (MAP_SIZE - 10);
    const z = (rng() - 0.5) * (MAP_SIZE - 10);
    obs.push({ x, y: 3, z, w: 1.5, h: 6, d: 1.5, tree: true });
  }
  return obs;
}

function broadcast(obj, excludeId = null) {
  const data = JSON.stringify(obj);
  for (const [id, p] of players) {
    if (id === excludeId) continue;
    if (p.ws.readyState === 1) p.ws.send(data);
  }
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function spawnPos() {
  const angle = Math.random() * Math.PI * 2;
  const r = Math.random() * (zone.r * 0.7);
  return {
    x: zone.cx + Math.cos(angle) * r,
    y: 0,
    z: zone.cz + Math.sin(angle) * r,
  };
}

function aliveCount() {
  let n = 0;
  for (const p of players.values()) if (p.alive) n++;
  return n;
}

function startGame() {
  gameState = 'playing';
  zone = { cx: 0, cz: 0, r: MAP_SIZE / 2 };
  lastShrink = Date.now();
  lastZoneDamage = Date.now();
  winnerInfo = null;
  potions = generatePotions();
  pieces.clear();
  for (const p of players.values()) {
    const pos = spawnPos();
    p.x = pos.x; p.y = pos.y; p.z = pos.z;
    p.hp = MAX_HP;
    p.shield = 0;
    p.alive = true;
    p.rotY = 0;
  }
  broadcast({ type: 'gamestart', zone, obstacles, potions, pieces: [...pieces.values()].map(piecePayload) });
}

function generatePotions() {
  const arr = [];
  for (let i = 0; i < POTION_COUNT; i++) {
    let x = 0, z = 0, ok = false;
    for (let tries = 0; tries < 20 && !ok; tries++) {
      x = (Math.random() - 0.5) * (MAP_SIZE - 20);
      z = (Math.random() - 0.5) * (MAP_SIZE - 20);
      ok = true;
      for (const o of obstacles) {
        if (o.tree) continue;
        if (Math.abs(x - o.x) < o.w / 2 + 1.5 && Math.abs(z - o.z) < o.d / 2 + 1.5) {
          ok = false;
          break;
        }
      }
    }
    arr.push({ id: nextPotionId++, x, z });
  }
  return arr;
}

function applyDamage(p, dmg) {
  if (p.shield > 0) {
    const absorbed = Math.min(p.shield, dmg);
    p.shield -= absorbed;
    dmg -= absorbed;
  }
  if (dmg > 0) p.hp -= dmg;
}

function pieceKey(gx, gy, gz, type, rot) {
  if (type === 'wall') return `${gx},${gy},${gz},wall,${rot}`;
  return `${gx},${gy},${gz},${type}`;
}

function pieceAABB(p) {
  const cx = p.gx * GRID, cy = p.gy * GRID, cz = p.gz * GRID;
  const half = GRID / 2;
  if (p.type === 'floor') {
    return { minX: cx - half, maxX: cx + half, minY: cy - half - 0.15, maxY: cy - half + 0.15, minZ: cz - half, maxZ: cz + half };
  }
  if (p.type === 'ramp') {
    return { minX: cx - half, maxX: cx + half, minY: cy - half, maxY: cy + half, minZ: cz - half, maxZ: cz + half };
  }
  // wall
  if (p.rot === 0 || p.rot === 2) {
    return { minX: cx - half, maxX: cx + half, minY: cy - half, maxY: cy + half, minZ: cz - 0.15, maxZ: cz + 0.15 };
  } else {
    return { minX: cx - 0.15, maxX: cx + 0.15, minY: cy - half, maxY: cy + half, minZ: cz - half, maxZ: cz + half };
  }
}

function piecePayload(p) {
  return { id: p.id, type: p.type, gx: p.gx, gy: p.gy, gz: p.gz, rot: p.rot, hp: p.hp, tiles: p.tiles, ownerId: p.ownerId };
}

function handleBuild(playerId, msg) {
  const player = players.get(playerId);
  if (!player || !player.alive || gameState !== 'playing') return;
  const type = msg.pieceType === 'wall' || msg.pieceType === 'floor' || msg.pieceType === 'ramp' ? msg.pieceType : null;
  if (!type) return;
  const gx = msg.gx | 0, gy = msg.gy | 0, gz = msg.gz | 0;
  if (gy < 0 || gy > 6) return;
  const halfMap = MAP_SIZE / 2 / GRID;
  if (Math.abs(gx) > halfMap || Math.abs(gz) > halfMap) return;
  const rot = ((msg.rot | 0) % 4 + 4) % 4;
  const k = pieceKey(gx, gy, gz, type, rot);
  if (pieces.has(k)) return;
  // Range from player
  const cx = gx * GRID, cz = gz * GRID;
  if (Math.hypot(player.x - cx, player.z - cz) > MAX_PIECE_RANGE) return;
  const piece = { id: nextPieceId++, type, gx, gy, gz, rot, hp: PIECE_HP, tiles: 0x1FF, ownerId: playerId, key: k };
  pieces.set(k, piece);
  broadcast({ type: 'piece_placed', piece: piecePayload(piece) });
}

function handleEditPiece(playerId, msg) {
  const player = players.get(playerId);
  if (!player) return;
  let piece = null;
  for (const p of pieces.values()) if (p.id === msg.pieceId) { piece = p; break; }
  if (!piece || piece.ownerId !== playerId) return;
  if (piece.type === 'ramp') return; // ramps not editable
  piece.tiles = (msg.tiles | 0) & 0x1FF;
  if (piece.tiles === 0) {
    pieces.delete(piece.key);
    broadcast({ type: 'piece_destroyed', pieceId: piece.id });
  } else {
    broadcast({ type: 'piece_edited', pieceId: piece.id, tiles: piece.tiles });
  }
}

function damagePiece(piece, dmg) {
  piece.hp -= dmg;
  if (piece.hp <= 0) {
    pieces.delete(piece.key);
    broadcast({ type: 'piece_destroyed', pieceId: piece.id });
  } else {
    broadcast({ type: 'piece_hp', pieceId: piece.id, hp: piece.hp });
  }
}

function endGame(winnerId) {
  gameState = 'ended';
  const w = winnerId ? players.get(winnerId) : null;
  winnerInfo = w ? { id: winnerId, name: w.name } : null;
  gameEndTime = Date.now();
  broadcast({ type: 'gameover', winner: winnerInfo });
}

function tick() {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  if (gameState === 'waiting' && players.size >= 1) {
    // Auto start after 5 seconds when at least 1 player connected
    startGame();
  }

  if (gameState === 'ended' && now - gameEndTime > 8000) {
    if (players.size >= 1) startGame();
    else gameState = 'waiting';
  }

  if (gameState === 'playing') {
    // Shrink zone
    if (now - lastShrink > ZONE_SHRINK_INTERVAL_MS) {
      zone.r = Math.max(MIN_ZONE_RADIUS, zone.r * ZONE_SHRINK_FACTOR);
      // Drift center a bit toward random point
      const ang = Math.random() * Math.PI * 2;
      const drift = zone.r * 0.2;
      zone.cx += Math.cos(ang) * drift;
      zone.cz += Math.sin(ang) * drift;
      lastShrink = now;
      broadcast({ type: 'zone', zone });
    }

    // Zone damage every second
    if (now - lastZoneDamage > 1000) {
      lastZoneDamage = now;
      for (const [id, p] of players) {
        if (!p.alive) continue;
        const dx = p.x - zone.cx;
        const dz = p.z - zone.cz;
        if (Math.sqrt(dx * dx + dz * dz) > zone.r) {
          applyDamage(p, ZONE_DAMAGE_PER_SEC);
          send(p.ws, { type: 'hp', hp: p.hp, shield: p.shield, fromZone: true });
          if (p.hp <= 0) killPlayer(id, null);
        }
      }
    }

    // Pickup potions
    for (const [pid, p] of players) {
      if (!p.alive) continue;
      for (let i = potions.length - 1; i >= 0; i--) {
        const pot = potions[i];
        const dx = p.x - pot.x, dz = p.z - pot.z;
        if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS && p.shield < MAX_SHIELD) {
          p.shield = Math.min(MAX_SHIELD, p.shield + SHIELD_PER_POTION);
          const removed = potions.splice(i, 1)[0];
          broadcast({ type: 'pickup', potionId: removed.id });
          send(p.ws, { type: 'hp', hp: p.hp, shield: p.shield, fromZone: false });
        }
      }
    }

    // Win condition
    if (aliveCount() <= 1 && players.size > 1) {
      let winner = null;
      for (const [id, p] of players) if (p.alive) { winner = id; break; }
      endGame(winner);
    }
  }

  // Broadcast state
  const snapshot = [];
  for (const [id, p] of players) {
    snapshot.push({ id, name: p.name, x: p.x, y: p.y, z: p.z, rotY: p.rotY, hp: p.hp, shield: p.shield, alive: p.alive, weapon: p.currentWeapon });
  }
  broadcast({ type: 'state', players: snapshot, t: now });
}

setInterval(tick, 1000 / TICK_RATE);

function killPlayer(id, killerId) {
  const p = players.get(id);
  if (!p || !p.alive) return;
  p.alive = false;
  p.hp = 0;
  const killer = killerId ? players.get(killerId) : null;
  broadcast({
    type: 'kill',
    victimId: id,
    victimName: p.name,
    killerId: killerId,
    killerName: killer ? killer.name : null,
  });
}

function rayHitsObstacle(ox, oy, oz, dx, dy, dz, maxDist) {
  // Simple AABB ray test against all obstacles, returns nearest dist or Infinity
  let nearest = maxDist;
  for (const o of obstacles) {
    const minX = o.x - o.w / 2, maxX = o.x + o.w / 2;
    const minY = o.y - o.h / 2, maxY = o.y + o.h / 2;
    const minZ = o.z - o.d / 2, maxZ = o.z + o.d / 2;
    const t = rayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ);
    if (t !== null && t < nearest && t > 0) nearest = t;
  }
  return nearest;
}

function rayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = -Infinity, tmax = Infinity;
  for (const [o, d, lo, hi] of [
    [ox, dx, minX, maxX], [oy, dy, minY, maxY], [oz, dz, minZ, maxZ],
  ]) {
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin > 0 ? tmin : (tmax > 0 ? tmax : null);
}

function applySpread(dx, dy, dz, spread) {
  const h = Math.sqrt(dx * dx + dz * dz);
  if (h < 0.01) return [dx, dy, dz];
  // Right (perpendicular to dir, horizontal)
  const rx = -dz / h, rz = dx / h;
  // Up (perpendicular to dir and right)
  const ux = -dx * dy / h;
  const uy = h; // = sqrt(1 - dy^2) since dir is unit
  const uz = -dz * dy / h;
  const sa = (Math.random() - 0.5) * 2 * spread;
  const sb = (Math.random() - 0.5) * 2 * spread;
  const nx = dx + rx * sa + ux * sb;
  const ny = dy + uy * sb;
  const nz = dz + rz * sa + uz * sb;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function handleShoot(shooterId, msg) {
  const shooter = players.get(shooterId);
  if (!shooter || !shooter.alive || gameState !== 'playing') return;
  const wname = (msg.weapon && WEAPONS[msg.weapon]) ? msg.weapon : 'ar';
  const w = WEAPONS[wname];
  const now = Date.now();
  // Allow 30ms grace for network jitter so client-locked cooldowns still pass
  if (shooter.lastShot && now - shooter.lastShot < w.cooldown - 30) return;
  shooter.lastShot = now;
  shooter.currentWeapon = wname;
  const { ox, oy, oz, dx, dy, dz } = msg;
  // Normalize aim direction
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const ndx = dx / len, ndy = dy / len, ndz = dz / len;

  const maxRange = w.range;
  const numPellets = w.pellets || 1;
  const spread = w.spread || 0;
  const pelletResults = [];
  const damageByTarget = new Map();

  const pieceHits = []; // {piece, dmg}
  for (let pi = 0; pi < numPellets; pi++) {
    const [pdx, pdy, pdz] = numPellets > 1 ? applySpread(ndx, ndy, ndz, spread) : [ndx, ndy, ndz];
    let bestT = rayHitsObstacle(ox, oy, oz, pdx, pdy, pdz, maxRange);
    let hitId = null;
    let hitPiece = null;
    // Test pieces
    for (const piece of pieces.values()) {
      const a = pieceAABB(piece);
      const t = rayAABB(ox, oy, oz, pdx, pdy, pdz, a.minX, a.minY, a.minZ, a.maxX, a.maxY, a.maxZ);
      if (t !== null && t > 0 && t < bestT) {
        bestT = t;
        hitPiece = piece;
        hitId = null;
      }
    }
    // Test players
    for (const [id, p] of players) {
      if (id === shooterId || !p.alive) continue;
      const t = raySphere(ox, oy, oz, pdx, pdy, pdz, p.x, p.y + 1, p.z, 0.9);
      if (t !== null && t > 0 && t < bestT) {
        bestT = t;
        hitId = id;
        hitPiece = null;
      }
    }
    pelletResults.push({
      dx: pdx, dy: pdy, dz: pdz,
      dist: isFinite(bestT) ? bestT : maxRange,
    });
    if (hitId !== null) {
      damageByTarget.set(hitId, (damageByTarget.get(hitId) || 0) + w.dmg);
    } else if (hitPiece) {
      pieceHits.push(hitPiece);
    }
  }

  // Broadcast shot — pellets array carries each pellet's direction+distance
  broadcast({
    type: 'shot',
    shooterId,
    weapon: wname,
    ox, oy, oz,
    sx: shooter.x, sy: shooter.y, sz: shooter.z,
    srotY: shooter.rotY,
    pellets: pelletResults,
  });

  // Damage pieces (each pellet hit deals w.dmg)
  for (const piece of pieceHits) {
    damagePiece(piece, w.dmg);
  }

  // Apply accumulated damage (multiple pellets on one target = sum)
  for (const [hitId, totalDmg] of damageByTarget) {
    const target = players.get(hitId);
    const preShield = target.shield;
    const preHp = target.hp;
    applyDamage(target, totalDmg);
    const shieldDmg = preShield - target.shield;
    const hpDmg = preHp - target.hp;
    send(target.ws, { type: 'hp', hp: target.hp, shield: target.shield, fromZone: false });
    // Damage feedback for the shooter (floating numbers)
    send(shooter.ws, {
      type: 'dmg',
      amount: shieldDmg + hpDmg,
      shieldDmg,
      hpDmg,
      targetId: hitId,
      x: target.x, y: target.y, z: target.z,
    });
    if (target.hp <= 0) killPlayer(hitId, shooterId);
  }
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (lx * dx + ly * dy + lz * dz);
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  if (t1 > 0) return t1;
  if (t2 > 0) return t2;
  return null;
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const p = {
    ws,
    name: 'Player' + id,
    x: 0, y: 0, z: 0,
    rotY: 0,
    hp: MAX_HP,
    shield: 0,
    alive: false,
    lastShot: 0,
    currentWeapon: 'ar',
  };
  players.set(id, p);

  send(ws, {
    type: 'init',
    id,
    obstacles,
    zone,
    potions,
    pieces: [...pieces.values()].map(piecePayload),
    mapSize: MAP_SIZE,
    gameState,
    winner: winnerInfo,
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const player = players.get(id);
    if (!player) return;

    if (msg.type === 'join') {
      player.name = String(msg.name || '').slice(0, 16) || 'Player' + id;
      if (gameState === 'playing' || gameState === 'waiting') {
        // Join in progress: spawn alive if game already started, otherwise wait for next round
        if (gameState === 'playing') {
          const pos = spawnPos();
          player.x = pos.x; player.y = pos.y; player.z = pos.z;
          player.hp = MAX_HP;
          player.shield = 0;
          player.alive = true;
        }
      }
      broadcast({ type: 'joined', id, name: player.name });
    } else if (msg.type === 'move') {
      if (!player.alive) return;
      // Clamp to map
      const half = MAP_SIZE / 2;
      player.x = Math.max(-half, Math.min(half, +msg.x || 0));
      player.z = Math.max(-half, Math.min(half, +msg.z || 0));
      player.y = Math.max(0, Math.min(20, +msg.y || 0));
      player.rotY = +msg.rotY || 0;
    } else if (msg.type === 'shoot') {
      handleShoot(id, msg);
    } else if (msg.type === 'weapon') {
      if (WEAPONS[msg.weapon]) player.currentWeapon = msg.weapon;
    } else if (msg.type === 'build') {
      handleBuild(id, msg);
    } else if (msg.type === 'piece_edit') {
      handleEditPiece(id, msg);
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'left', id });
  });
});

server.listen(PORT, () => {
  console.log(`Elite Place Battle listening on port ${PORT}`);
});
