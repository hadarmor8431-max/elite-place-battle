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
const MAP_SIZE = 500;
const ZONE_DAMAGE_PER_SEC = 5;
const ZONE_SHRINK_INTERVAL_MS = 30000;
const ZONE_SHRINK_FACTOR = 0.65;
const MIN_ZONE_RADIUS = 12;
const MAX_SHIELD = 100;
const SHIELD_PER_POTION = 25;
const POTION_COUNT = 80;
const PICKUP_RADIUS = 1.8;
const SPAWN_PROTECTION_MS = 3000;

// Lobby
const LOBBY_CENTER = { x: -210, z: -210 };
const LOBBY_SIZE = 40; // half-extent

const app = express();
// Disable caching so deploys are picked up immediately by clients
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  },
}));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const players = new Map(); // id -> {ws, name, x,y,z, rotY, hp, alive, lastSeen}
const obstacles = generateObstacles();

let nextId = 1;
let gameState = 'lobby'; // lobby | playing | ended
let zone = { cx: 0, cz: 0, r: MAP_SIZE / 2 };
let potions = []; // {id, x, z}
let nextPotionId = 1;
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
  for (let i = 0; i < 100; i++) {
    const w = 4 + rng() * 10;
    const h = 3 + rng() * 10;
    const d = 4 + rng() * 10;
    const x = (rng() - 0.5) * (MAP_SIZE - 20);
    const z = (rng() - 0.5) * (MAP_SIZE - 20);
    // Skip if too close to lobby
    if (Math.hypot(x - LOBBY_CENTER.x, z - LOBBY_CENTER.z) < LOBBY_SIZE + 10) continue;
    obs.push({ x, y: h / 2, z, w, h, d });
  }
  // Trees
  for (let i = 0; i < 200; i++) {
    const x = (rng() - 0.5) * (MAP_SIZE - 10);
    const z = (rng() - 0.5) * (MAP_SIZE - 10);
    if (Math.hypot(x - LOBBY_CENTER.x, z - LOBBY_CENTER.z) < LOBBY_SIZE + 6) continue;
    obs.push({ x, y: 3, z, w: 1.5, h: 6, d: 1.5, tree: true });
  }
  // Lobby walls (4 walls around the lobby area)
  const lc = LOBBY_CENTER, ls = LOBBY_SIZE;
  obs.push({ x: lc.x,        y: 2, z: lc.z - ls, w: ls * 2 + 2, h: 4, d: 2, lobby: true });
  obs.push({ x: lc.x,        y: 2, z: lc.z + ls, w: ls * 2 + 2, h: 4, d: 2, lobby: true });
  obs.push({ x: lc.x - ls,   y: 2, z: lc.z,      w: 2, h: 4, d: ls * 2 + 2, lobby: true });
  obs.push({ x: lc.x + ls,   y: 2, z: lc.z,      w: 2, h: 4, d: ls * 2 + 2, lobby: true });
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

function lobbySpawnPos() {
  const angle = Math.random() * Math.PI * 2;
  const r = Math.random() * (LOBBY_SIZE - 5);
  return {
    x: LOBBY_CENTER.x + Math.cos(angle) * r,
    y: 0,
    z: LOBBY_CENTER.z + Math.sin(angle) * r,
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
  const now = Date.now();
  for (const p of players.values()) {
    const pos = spawnPos();
    p.x = pos.x; p.y = pos.y; p.z = pos.z;
    p.hp = MAX_HP;
    p.shield = 0;
    p.alive = true;
    p.rotY = 0;
    p.kills = 0;
    p.protectedUntil = now + SPAWN_PROTECTION_MS;
  }
  broadcast({ type: 'gamestart', zone, obstacles, potions, shrinkInterval: ZONE_SHRINK_INTERVAL_MS, spawnProtectionMs: SPAWN_PROTECTION_MS });
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

function endGame(winnerId) {
  gameState = 'ended';
  const w = winnerId ? players.get(winnerId) : null;
  winnerInfo = w ? { id: winnerId, name: w.name } : null;
  gameEndTime = Date.now();
  broadcast({ type: 'gameover', winner: winnerInfo });
}

function returnToLobby() {
  gameState = 'lobby';
  winnerInfo = null;
  for (const p of players.values()) {
    const pos = lobbySpawnPos();
    p.x = pos.x; p.y = pos.y; p.z = pos.z;
    p.hp = MAX_HP;
    p.shield = 0;
    p.alive = true;
    p.kills = 0;
    p.protectedUntil = 0;
  }
  broadcast({ type: 'lobby', center: LOBBY_CENTER, size: LOBBY_SIZE });
}

function tick() {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  // After a round ends, return everyone to the lobby
  if (gameState === 'ended' && now - gameEndTime > 5000) {
    returnToLobby();
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
      broadcast({ type: 'zone', zone, nextShrinkAt: now + ZONE_SHRINK_INTERVAL_MS });
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
    snapshot.push({ id, name: p.name, x: p.x, y: p.y, z: p.z, rotY: p.rotY, hp: p.hp, shield: p.shield, alive: p.alive, weapon: p.currentWeapon, protectedUntil: p.protectedUntil });
  }
  broadcast({ type: 'state', players: snapshot, t: now, nextShrinkAt: lastShrink + ZONE_SHRINK_INTERVAL_MS });
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
  if (!shooter || !shooter.alive) return;
  // In lobby, allow visual shots but no damage will be applied (see below)
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

  for (let pi = 0; pi < numPellets; pi++) {
    const [pdx, pdy, pdz] = numPellets > 1 ? applySpread(ndx, ndy, ndz, spread) : [ndx, ndy, ndz];
    let bestT = rayHitsObstacle(ox, oy, oz, pdx, pdy, pdz, maxRange);
    let hitId = null;
    for (const [id, p] of players) {
      if (id === shooterId || !p.alive) continue;
      const t = raySphere(ox, oy, oz, pdx, pdy, pdz, p.x, p.y + 1, p.z, 0.9);
      if (t !== null && t > 0 && t < bestT) {
        bestT = t;
        hitId = id;
      }
    }
    pelletResults.push({
      dx: pdx, dy: pdy, dz: pdz,
      dist: isFinite(bestT) ? bestT : maxRange,
    });
    if (hitId !== null) {
      damageByTarget.set(hitId, (damageByTarget.get(hitId) || 0) + w.dmg);
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

  // No damage applied while in lobby
  if (gameState !== 'playing') return;

  // Apply accumulated damage (multiple pellets on one target = sum)
  const now2 = Date.now();
  for (const [hitId, totalDmg] of damageByTarget) {
    const target = players.get(hitId);
    // Spawn protection: ignore damage
    if (target.protectedUntil > now2) {
      send(shooter.ws, { type: 'dmg', amount: 0, blocked: true, targetId: hitId, x: target.x, y: target.y, z: target.z });
      continue;
    }
    const preShield = target.shield;
    const preHp = target.hp;
    applyDamage(target, totalDmg);
    const shieldDmg = preShield - target.shield;
    const hpDmg = preHp - target.hp;
    send(target.ws, { type: 'hp', hp: target.hp, shield: target.shield, fromZone: false, fromX: shooter.x, fromZ: shooter.z });
    // Damage feedback for the shooter (floating numbers + hit marker)
    send(shooter.ws, {
      type: 'dmg',
      amount: shieldDmg + hpDmg,
      shieldDmg,
      hpDmg,
      targetId: hitId,
      x: target.x, y: target.y, z: target.z,
    });
    if (target.hp <= 0) {
      shooter.kills = (shooter.kills || 0) + 1;
      send(shooter.ws, { type: 'eliminated', kills: shooter.kills });
      killPlayer(hitId, shooterId);
    }
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
    kills: 0,
    protectedUntil: 0,
  };
  players.set(id, p);

  send(ws, {
    type: 'init',
    id,
    obstacles,
    zone,
    potions,
    mapSize: MAP_SIZE,
    gameState,
    winner: winnerInfo,
    lobbyCenter: LOBBY_CENTER,
    lobbySize: LOBBY_SIZE,
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const player = players.get(id);
    if (!player) return;

    if (msg.type === 'join') {
      player.name = String(msg.name || '').slice(0, 16) || 'Player' + id;
      // Always spawn somewhere alive
      const pos = (gameState === 'playing') ? spawnPos() : lobbySpawnPos();
      player.x = pos.x; player.y = pos.y; player.z = pos.z;
      player.hp = MAX_HP;
      player.shield = 0;
      player.alive = true;
      broadcast({ type: 'joined', id, name: player.name });
    } else if (msg.type === 'startMatch') {
      if (gameState === 'lobby') startGame();
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
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'left', id });
  });
});

server.listen(PORT, () => {
  console.log(`Skyzone listening on port ${PORT}`);
});
