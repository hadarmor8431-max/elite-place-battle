import * as THREE from 'three';

// ---------- DOM ----------
const lobby = document.getElementById('lobby');
const playBtn = document.getElementById('playBtn');
const nameInput = document.getElementById('nameInput');
const hud = document.getElementById('hud');
const hpFill = document.getElementById('hpFill');
const hpVal = document.getElementById('hpVal');
const aliveEl = document.getElementById('alive');
const zoneREl = document.getElementById('zoneR');
const statusEl = document.getElementById('status');
const killFeed = document.getElementById('killFeed');
const deathOverlay = document.getElementById('deathOverlay');
const winOverlay = document.getElementById('winOverlay');
const winSub = document.getElementById('winSub');
const minimapCanvas = document.getElementById('minimapCanvas');
const minimapCtx = minimapCanvas.getContext('2d');

const savedName = localStorage.getItem('brName');
if (savedName) nameInput.value = savedName;

// ---------- SETTINGS ----------
const SETTINGS_KEY = 'epbSettings';
const DEFAULT_SETTINGS = {
  sensitivity: 1.0,    // multiplier on base 0.0025
  fov: 75,
  volume: 1.0,
  camDist: 5.0,
  invertY: false,
  leftShoulder: false,
};
const settings = { ...DEFAULT_SETTINGS };
try {
  const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  Object.assign(settings, stored);
} catch {}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

let menuOpen = false;
const pauseMenu = document.getElementById('pauseMenu');
const settingsPanel = document.getElementById('settingsPanel');
const sensSlider = document.getElementById('sensSlider');
const sensVal = document.getElementById('sensVal');
const fovSlider = document.getElementById('fovSlider');
const fovVal = document.getElementById('fovVal');
const volSlider = document.getElementById('volSlider');
const volVal = document.getElementById('volVal');
const distSlider = document.getElementById('distSlider');
const distVal = document.getElementById('distVal');
const invertY = document.getElementById('invertY');
const leftShoulder = document.getElementById('leftShoulder');

// ---------- THREE ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 220);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);

// Lights
const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2cc, 0.7);
sun.position.set(60, 100, 40);
scene.add(sun);

// Ground
const MAP_SIZE = 200;
const groundGeom = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 20, 20);
const groundMat = new THREE.MeshLambertMaterial({ color: 0x4a8b4a });
const ground = new THREE.Mesh(groundGeom, groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Grid for orientation
const grid = new THREE.GridHelper(MAP_SIZE, 40, 0x336633, 0x336633);
grid.position.y = 0.01;
grid.material.transparent = true;
grid.material.opacity = 0.3;
scene.add(grid);

// Zone visualization (vertical cylinder)
const zoneGeom = new THREE.CylinderGeometry(100, 100, 50, 64, 1, true);
const zoneMat = new THREE.MeshBasicMaterial({
  color: 0x4f9fff,
  transparent: true,
  opacity: 0.18,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const zoneMesh = new THREE.Mesh(zoneGeom, zoneMat);
zoneMesh.position.y = 25;
scene.add(zoneMesh);

// Obstacles container
const obstacleGroup = new THREE.Group();
scene.add(obstacleGroup);
let obstacleList = []; // {x,z,w,d,h, tree}

function buildObstacles(obs) {
  obstacleGroup.clear();
  obstacleList = obs;
  for (const o of obs) {
    if (o.tree) {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.5, 4, 8),
        new THREE.MeshLambertMaterial({ color: 0x6b3f1f })
      );
      trunk.position.set(o.x, 2, o.z);
      obstacleGroup.add(trunk);
      const leaves = new THREE.Mesh(
        new THREE.ConeGeometry(2.2, 5, 8),
        new THREE.MeshLambertMaterial({ color: 0x2d6b2d })
      );
      leaves.position.set(o.x, 6, o.z);
      obstacleGroup.add(leaves);
    } else {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(o.w, o.h, o.d),
        new THREE.MeshLambertMaterial({ color: 0x8a8a8a + Math.floor(Math.random() * 0x202020) })
      );
      box.position.set(o.x, o.y, o.z);
      obstacleGroup.add(box);
      // Roof accent
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(o.w + 0.4, 0.4, o.d + 0.4),
        new THREE.MeshLambertMaterial({ color: 0x553322 })
      );
      roof.position.set(o.x, o.y + o.h / 2 + 0.2, o.z);
      obstacleGroup.add(roof);
    }
  }
}

// Player models
function makePlayerMesh(color, name) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.5, 1.2, 4, 8),
    new THREE.MeshLambertMaterial({ color })
  );
  body.position.y = 1.1;
  group.add(body);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.7, 0.7),
    new THREE.MeshLambertMaterial({ color: 0xffd9b3 })
  );
  head.position.y = 2.1;
  group.add(head);
  // Front marker (small box on the chest indicating facing)
  const front = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.3, 0.15),
    new THREE.MeshLambertMaterial({ color: 0x222222 })
  );
  front.position.set(0, 1.4, -0.55);
  group.add(front);

  // Name tag (skip if empty — used for the local player)
  if (name) {
    const canvas2 = document.createElement('canvas');
    canvas2.width = 256; canvas2.height = 64;
    const ctx = canvas2.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, 128, 42);
    const tex = new THREE.CanvasTexture(canvas2);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sprite.scale.set(3, 0.75, 1);
    sprite.position.y = 3.2;
    group.add(sprite);
  }

  return group;
}

let myMesh = null;

// ---------- GAME STATE ----------
const me = {
  id: null,
  name: '',
  x: 0, y: 0, z: 0,
  rotY: 0,
  vy: 0,
  onGround: true,
  hp: 100,
  alive: false,
  pitch: 0,
};

const otherPlayers = new Map(); // id -> {mesh, x, y, z, rotY, targetX, targetY, targetZ, targetRot, name, hp, alive}
let zone = { cx: 0, cz: 0, r: 100 };
let gameState = 'waiting';
let ws = null;
let connected = false;

// Player color palette
const COLORS = [0xff6b6b, 0x6bb7ff, 0xc084fc, 0xffd66b, 0x4ade80, 0xfb923c, 0xf472b6, 0x22d3ee];
function colorFor(id) { return COLORS[id % COLORS.length]; }

// ---------- INPUT ----------
const keys = {};
let mouseDown = false;
let pointerLocked = false;

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

canvas.addEventListener('click', () => {
  if (!me.alive) return;
  if (!pointerLocked) canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked && me.alive && gameState === 'playing' && lobby.classList.contains('hidden')) {
    openPauseMenu();
  } else if (pointerLocked) {
    closeMenus();
  }
});

document.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  const sens = 0.0025 * settings.sensitivity;
  me.rotY -= e.movementX * sens;
  me.pitch += e.movementY * sens * (settings.invertY ? 1 : -1);
  me.pitch = Math.max(-1.2, Math.min(1.2, me.pitch));
});

document.addEventListener('mousedown', (e) => {
  if (!pointerLocked || e.button !== 0 || menuOpen) return;
  fireShot();
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- SHOOTING ----------
const bullets = [];  // {mesh, sx,sy,sz, ex,ey,ez, elapsed, duration}
const flashes = [];  // {mesh, light, life, max}
const impacts = [];  // {mesh, life, max, growth}

function fireShot() {
  ensureAudio();
  const origin = new THREE.Vector3();
  camera.getWorldPosition(origin);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  ws.send(JSON.stringify({
    type: 'shoot',
    ox: origin.x, oy: origin.y, oz: origin.z,
    dx: dir.x, dy: dir.y, dz: dir.z,
  }));
}

function spawnShotEffect(msg, isMine) {
  // Shooter body + yaw -> gun position (right shoulder, slightly forward, chest height)
  const shSh = Math.sin(msg.srotY), shCh = Math.cos(msg.srotY);
  const fwdX = -shSh, fwdZ = -shCh;
  const rgtX = shCh, rgtZ = -shSh;
  const gunX = msg.sx + rgtX * 0.45 + fwdX * 0.5;
  const gunY = msg.sy + 1.5;
  const gunZ = msg.sz + rgtZ * 0.45 + fwdZ * 0.5;

  // Impact point (server-validated ray endpoint)
  const ix = msg.ox + msg.dx * msg.dist;
  const iy = msg.oy + msg.dy * msg.dist;
  const iz = msg.oz + msg.dz * msg.dist;

  // Bullet streak
  const bulletGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6);
  bulletGeom.rotateX(Math.PI / 2);
  const bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 0.95 });
  const bullet = new THREE.Mesh(bulletGeom, bulletMat);
  bullet.position.set(gunX, gunY, gunZ);
  bullet.lookAt(ix, iy, iz);
  scene.add(bullet);
  const totalDist = Math.hypot(ix - gunX, iy - gunY, iz - gunZ);
  bullets.push({
    mesh: bullet,
    sx: gunX, sy: gunY, sz: gunZ,
    ex: ix, ey: iy, ez: iz,
    elapsed: 0,
    duration: Math.max(0.03, totalDist / 220),
  });

  // Muzzle flash sphere + brief point light
  const flashGeom = new THREE.SphereGeometry(0.35, 8, 8);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffdd66, transparent: true, opacity: 1, depthWrite: false });
  const flashMesh = new THREE.Mesh(flashGeom, flashMat);
  flashMesh.position.set(gunX, gunY, gunZ);
  scene.add(flashMesh);
  const flashLight = new THREE.PointLight(0xffcc66, 4, 8);
  flashLight.position.set(gunX, gunY, gunZ);
  scene.add(flashLight);
  flashes.push({ mesh: flashMesh, light: flashLight, life: 0.07, max: 0.07 });

  // Audio with distance attenuation for other players
  let vol = 1.0;
  if (!isMine) {
    const cam = new THREE.Vector3();
    camera.getWorldPosition(cam);
    const d = Math.hypot(cam.x - gunX, cam.y - gunY, cam.z - gunZ);
    vol = Math.max(0.05, Math.min(0.7, 10 / (10 + d * 0.6)));
  }
  playGunshot(vol);
}

function spawnImpact(x, y, z) {
  // Bright core
  const coreGeom = new THREE.SphereGeometry(0.12, 8, 8);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffcc55, transparent: true, opacity: 1, depthWrite: false });
  const core = new THREE.Mesh(coreGeom, coreMat);
  core.position.set(x, y, z);
  scene.add(core);
  impacts.push({ mesh: core, life: 0.2, max: 0.2, growth: 3.5 });
  // Sparks (short bright line shards)
  for (let i = 0; i < 7; i++) {
    const tx = (Math.random() - 0.5) * 2;
    const ty = Math.random() * 1.2 + 0.2;
    const tz = (Math.random() - 0.5) * 2;
    const len = 0.5 + Math.random() * 0.5;
    const sparkGeom = new THREE.BufferGeometry();
    sparkGeom.setAttribute('position', new THREE.Float32BufferAttribute([
      x, y, z,
      x + tx * len, y + ty * len, z + tz * len,
    ], 3));
    const sparkMat = new THREE.LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 1 });
    const spark = new THREE.Line(sparkGeom, sparkMat);
    scene.add(spark);
    impacts.push({ mesh: spark, life: 0.18, max: 0.18, growth: 0 });
  }
}

// ---------- AUDIO ----------
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function playGunshot(volume = 1.0) {
  volume *= settings.volume;
  if (!audioCtx || volume <= 0.005) return;
  const now = audioCtx.currentTime;

  // Noise burst — main "bang" body
  const noiseDur = 0.18;
  const sampleCount = Math.floor(audioCtx.sampleRate * noiseDur);
  const noiseBuf = audioCtx.createBuffer(1, sampleCount, audioCtx.sampleRate);
  const ndata = noiseBuf.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    const env = Math.exp(-i / (audioCtx.sampleRate * 0.035));
    ndata[i] = (Math.random() * 2 - 1) * env;
  }
  const noiseSrc = audioCtx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  const noiseFilter = audioCtx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 1400;
  noiseFilter.Q.value = 0.6;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.value = 0.55 * volume;
  noiseSrc.connect(noiseFilter).connect(noiseGain).connect(audioCtx.destination);
  noiseSrc.start(now);

  // Sub-bass thump
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, now);
  osc.frequency.exponentialRampToValueAtTime(45, now + 0.1);
  const oscGain = audioCtx.createGain();
  oscGain.gain.setValueAtTime(0.55 * volume, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
  osc.connect(oscGain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.15);

  // High-frequency crack
  const crack = audioCtx.createOscillator();
  crack.type = 'sawtooth';
  crack.frequency.setValueAtTime(2800, now);
  crack.frequency.exponentialRampToValueAtTime(800, now + 0.04);
  const crackGain = audioCtx.createGain();
  crackGain.gain.setValueAtTime(0.18 * volume, now);
  crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  crack.connect(crackGain).connect(audioCtx.destination);
  crack.start(now);
  crack.stop(now + 0.06);
}

// ---------- COLLISION (client-side prediction) ----------
function collideAndMove(nx, nz) {
  const r = 0.55;
  for (const o of obstacleList) {
    if (o.tree) continue; // walk through trees visually
    const minX = o.x - o.w / 2 - r;
    const maxX = o.x + o.w / 2 + r;
    const minZ = o.z - o.d / 2 - r;
    const maxZ = o.z + o.d / 2 + r;
    if (nx > minX && nx < maxX && nz > minZ && nz < maxZ) {
      // Push back along smallest axis
      const dxL = nx - minX, dxR = maxX - nx;
      const dzL = nz - minZ, dzR = maxZ - nz;
      const minPen = Math.min(dxL, dxR, dzL, dzR);
      if (minPen === dxL) nx = minX;
      else if (minPen === dxR) nx = maxX;
      else if (minPen === dzL) nz = minZ;
      else nz = maxZ;
    }
  }
  const half = MAP_SIZE / 2 - 1;
  nx = Math.max(-half, Math.min(half, nx));
  nz = Math.max(-half, Math.min(half, nz));
  return { x: nx, z: nz };
}

// ---------- NETWORK ----------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const key = new URLSearchParams(location.search).get('key') || '';
  ws = new WebSocket(`${proto}://${location.host}/?key=${encodeURIComponent(key)}`);
  ws.onopen = () => {
    connected = true;
    ws.send(JSON.stringify({ type: 'join', name: me.name }));
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMsg(msg);
  };
  ws.onclose = () => {
    connected = false;
    statusEl.textContent = 'Disconnected. Reload to reconnect.';
  };
}

function handleMsg(msg) {
  if (msg.type === 'init') {
    me.id = msg.id;
    buildObstacles(msg.obstacles);
    zone = msg.zone;
    updateZoneMesh();
    gameState = msg.gameState;
    if (!myMesh) {
      myMesh = makePlayerMesh(colorFor(me.id), '');
      scene.add(myMesh);
    }
  } else if (msg.type === 'state') {
    updateFromState(msg.players);
  } else if (msg.type === 'hp') {
    me.hp = msg.hp;
    updateHpUI();
    if (msg.fromZone) statusEl.textContent = 'Outside zone! Move in.';
  } else if (msg.type === 'shot') {
    spawnShotEffect(msg, msg.shooterId === me.id);
  } else if (msg.type === 'kill') {
    const victim = msg.victimName;
    const killer = msg.killerName || 'the zone';
    addKill(`${killer} eliminated ${victim}`);
    if (msg.victimId === me.id) {
      me.alive = false;
      deathOverlay.classList.remove('hidden');
      closeMenus();
      if (pointerLocked) document.exitPointerLock();
    }
  } else if (msg.type === 'zone') {
    zone = msg.zone;
    updateZoneMesh();
    statusEl.textContent = 'Zone shrinking!';
    setTimeout(() => { if (statusEl.textContent === 'Zone shrinking!') statusEl.textContent = ''; }, 3000);
  } else if (msg.type === 'gamestart') {
    zone = msg.zone;
    if (msg.obstacles) buildObstacles(msg.obstacles);
    updateZoneMesh();
    gameState = 'playing';
    me.alive = true;
    me.hp = 100;
    deathOverlay.classList.add('hidden');
    winOverlay.classList.add('hidden');
    statusEl.textContent = 'Round started!';
    setTimeout(() => { if (statusEl.textContent === 'Round started!') statusEl.textContent = ''; }, 3000);
    updateHpUI();
  } else if (msg.type === 'gameover') {
    gameState = 'ended';
    if (msg.winner) {
      winSub.textContent = msg.winner.id === me.id ? 'You won!' : `Winner: ${msg.winner.name}`;
    } else {
      winSub.textContent = 'No survivors.';
    }
    winOverlay.classList.remove('hidden');
    deathOverlay.classList.add('hidden');
    closeMenus();
    if (pointerLocked) document.exitPointerLock();
  } else if (msg.type === 'left') {
    const p = otherPlayers.get(msg.id);
    if (p) {
      scene.remove(p.mesh);
      otherPlayers.delete(msg.id);
    }
  }
}

function updateFromState(playersArr) {
  let aliveN = 0;
  const seen = new Set();
  for (const p of playersArr) {
    seen.add(p.id);
    if (p.alive) aliveN++;
    if (p.id === me.id) {
      // Sync HP from server (in case of zone damage)
      if (p.hp !== me.hp) {
        me.hp = p.hp;
        updateHpUI();
      }
      // Server may have respawned us
      if (p.alive && !me.alive) {
        me.alive = true;
        me.x = p.x; me.y = p.y; me.z = p.z;
        deathOverlay.classList.add('hidden');
      }
      continue;
    }
    let op = otherPlayers.get(p.id);
    if (!op) {
      const mesh = makePlayerMesh(colorFor(p.id), p.name);
      scene.add(mesh);
      op = { mesh, x: p.x, y: p.y, z: p.z, rotY: p.rotY, targetX: p.x, targetY: p.y, targetZ: p.z, targetRot: p.rotY, name: p.name, alive: p.alive };
      otherPlayers.set(p.id, op);
    }
    op.targetX = p.x; op.targetY = p.y; op.targetZ = p.z; op.targetRot = p.rotY;
    op.alive = p.alive;
    op.mesh.visible = p.alive;
  }
  // Remove disconnected
  for (const [id, op] of otherPlayers) {
    if (!seen.has(id)) {
      scene.remove(op.mesh);
      otherPlayers.delete(id);
    }
  }
  aliveEl.textContent = `Alive: ${aliveN}`;
}

function updateZoneMesh() {
  zoneMesh.position.x = zone.cx;
  zoneMesh.position.z = zone.cz;
  zoneMesh.scale.x = zone.r / 100;
  zoneMesh.scale.z = zone.r / 100;
  zoneREl.textContent = Math.round(zone.r);
}

function updateHpUI() {
  const pct = Math.max(0, Math.min(100, me.hp));
  hpFill.style.width = `${pct}%`;
  hpVal.textContent = pct;
}

function addKill(text) {
  const el = document.createElement('div');
  el.className = 'killEntry';
  el.textContent = text;
  killFeed.prepend(el);
  setTimeout(() => el.remove(), 6500);
}

// ---------- GAME LOOP ----------
let lastSent = 0;
const SEND_INTERVAL = 50; // ms => 20Hz
const clock = new THREE.Clock();

function update(dt) {
  if (!me.alive) {
    // Spectator: orbit slowly
    const t = Date.now() * 0.0002;
    camera.position.set(Math.cos(t) * 40, 30, Math.sin(t) * 40);
    camera.lookAt(0, 0, 0);
    return;
  }

  // Freeze input while menu is open (camera stays at last frame's pose)
  const inputBlocked = menuOpen;

  // Movement input
  const speed = (keys['ShiftLeft'] || keys['ShiftRight']) ? 10 : 6;
  let mx = 0, mz = 0;
  if (!inputBlocked) {
    if (keys['KeyW']) mz -= 1;
    if (keys['KeyS']) mz += 1;
    if (keys['KeyA']) mx -= 1;
    if (keys['KeyD']) mx += 1;
  }
  const len = Math.hypot(mx, mz);
  if (len > 0) { mx /= len; mz /= len; }

  // Rotate movement by player rotation
  const cos = Math.cos(me.rotY), sin = Math.sin(me.rotY);
  const wx = mx * cos + mz * sin;
  const wz = -mx * sin + mz * cos;

  const nx = me.x + wx * speed * dt;
  const nz = me.z + wz * speed * dt;
  const moved = collideAndMove(nx, nz);
  me.x = moved.x;
  me.z = moved.z;

  // Jump
  if (!inputBlocked && keys['Space'] && me.onGround) {
    me.vy = 8;
    me.onGround = false;
  }
  me.vy -= 22 * dt;
  me.y += me.vy * dt;
  if (me.y <= 0) {
    me.y = 0;
    me.vy = 0;
    me.onGround = true;
  }

  // Third-person over-the-shoulder camera with proper pitch
  const camDist = settings.camDist;
  const shoulder = settings.leftShoulder ? -0.85 : 0.85;
  const pivotY = me.y + 1.5;
  const sh = Math.sin(me.rotY), ch = Math.cos(me.rotY);
  const sp = Math.sin(me.pitch), cp = Math.cos(me.pitch);
  // Aim direction (where the player is looking)
  const fx = -sh * cp;
  const fy = sp;
  const fz = -ch * cp;
  // Horizontal right (for shoulder offset)
  const rx = ch;
  const rz = -sh;
  camera.position.set(
    me.x - fx * camDist + rx * shoulder,
    pivotY - fy * camDist,
    me.z - fz * camDist + rz * shoulder,
  );
  camera.lookAt(
    camera.position.x + fx,
    camera.position.y + fy,
    camera.position.z + fz,
  );

  // Update local player mesh
  if (myMesh) {
    myMesh.position.set(me.x, me.y, me.z);
    myMesh.rotation.y = me.rotY;
    myMesh.visible = me.alive;
  }

  // Network send
  const now = performance.now();
  if (connected && now - lastSent > SEND_INTERVAL) {
    lastSent = now;
    ws.send(JSON.stringify({
      type: 'move',
      x: me.x, y: me.y, z: me.z, rotY: me.rotY,
    }));
  }
}

function interpolateOthers(dt) {
  const lerp = Math.min(1, dt * 12);
  for (const op of otherPlayers.values()) {
    op.x += (op.targetX - op.x) * lerp;
    op.y += (op.targetY - op.y) * lerp;
    op.z += (op.targetZ - op.z) * lerp;
    let dr = op.targetRot - op.rotY;
    while (dr > Math.PI) dr -= Math.PI * 2;
    while (dr < -Math.PI) dr += Math.PI * 2;
    op.rotY += dr * lerp;
    op.mesh.position.set(op.x, op.y, op.z);
    op.mesh.rotation.y = op.rotY;
  }
}

function updateEffects(dt) {
  // Bullet projectiles
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.elapsed += dt;
    const t = Math.min(1, b.elapsed / b.duration);
    b.mesh.position.set(
      b.sx + (b.ex - b.sx) * t,
      b.sy + (b.ey - b.sy) * t,
      b.sz + (b.ez - b.sz) * t,
    );
    if (t >= 1) {
      scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      spawnImpact(b.ex, b.ey, b.ez);
      bullets.splice(i, 1);
    }
  }
  // Muzzle flashes
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.life -= dt;
    const k = Math.max(0, f.life / f.max);
    f.mesh.material.opacity = k;
    f.mesh.scale.setScalar(1 + (1 - k) * 1.2);
    f.light.intensity = k * 4;
    if (f.life <= 0) {
      scene.remove(f.mesh); scene.remove(f.light);
      f.mesh.geometry.dispose(); f.mesh.material.dispose();
      flashes.splice(i, 1);
    }
  }
  // Impact sparks
  for (let i = impacts.length - 1; i >= 0; i--) {
    const im = impacts[i];
    im.life -= dt;
    const k = Math.max(0, im.life / im.max);
    im.mesh.material.opacity = k;
    if (im.growth) im.mesh.scale.setScalar(1 + (1 - k) * im.growth);
    if (im.life <= 0) {
      scene.remove(im.mesh);
      im.mesh.geometry.dispose();
      im.mesh.material.dispose();
      impacts.splice(i, 1);
    }
  }
}

function drawMinimap() {
  const ctx = minimapCtx;
  const W = minimapCanvas.width, H = minimapCanvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0c1426';
  ctx.fillRect(0, 0, W, H);
  const scale = W / MAP_SIZE;
  const cx = W / 2, cy = H / 2;
  // Zone
  ctx.strokeStyle = '#4f9fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx + zone.cx * scale, cy + zone.cz * scale, zone.r * scale, 0, Math.PI * 2);
  ctx.stroke();
  // Obstacles
  ctx.fillStyle = '#445566';
  for (const o of obstacleList) {
    if (o.tree) continue;
    ctx.fillRect(cx + (o.x - o.w / 2) * scale, cy + (o.z - o.d / 2) * scale, o.w * scale, o.d * scale);
  }
  // Other players
  ctx.fillStyle = '#ff6b6b';
  for (const op of otherPlayers.values()) {
    if (!op.alive) continue;
    ctx.beginPath();
    ctx.arc(cx + op.x * scale, cy + op.z * scale, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Me
  if (me.alive) {
    ctx.fillStyle = '#6bff8a';
    ctx.beginPath();
    ctx.arc(cx + me.x * scale, cy + me.z * scale, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function loop() {
  const dt = Math.min(0.05, clock.getDelta());
  update(dt);
  interpolateOthers(dt);
  updateEffects(dt);
  drawMinimap();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();

// ---------- MENU & SETTINGS WIRING ----------
function applySettings() {
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();
}

function syncSettingsUI() {
  sensSlider.value = Math.round(settings.sensitivity * 100);
  sensVal.textContent = sensSlider.value;
  fovSlider.value = Math.round(settings.fov);
  fovVal.textContent = fovSlider.value;
  volSlider.value = Math.round(settings.volume * 100);
  volVal.textContent = volSlider.value;
  distSlider.value = Math.round(settings.camDist * 10);
  distVal.textContent = (distSlider.value / 10).toFixed(1);
  invertY.checked = settings.invertY;
  leftShoulder.checked = settings.leftShoulder;
}

function openPauseMenu() {
  menuOpen = true;
  pauseMenu.classList.remove('hidden');
  settingsPanel.classList.add('hidden');
}

function closeMenus() {
  menuOpen = false;
  pauseMenu.classList.add('hidden');
  settingsPanel.classList.add('hidden');
}

function openSettings() {
  pauseMenu.classList.add('hidden');
  settingsPanel.classList.remove('hidden');
  menuOpen = true;
  syncSettingsUI();
}

function backToPause() {
  settingsPanel.classList.add('hidden');
  pauseMenu.classList.remove('hidden');
}

document.querySelectorAll('[data-act]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const act = btn.dataset.act;
    if (act === 'resume') canvas.requestPointerLock();
    else if (act === 'settings') openSettings();
    else if (act === 'back') backToPause();
    else if (act === 'reset') {
      Object.assign(settings, DEFAULT_SETTINGS);
      saveSettings();
      applySettings();
      syncSettingsUI();
    } else if (act === 'quit') {
      if (ws) { try { ws.close(); } catch {} }
      closeMenus();
      hud.classList.add('hidden');
      lobby.classList.remove('hidden');
      // Reset local state so a fresh join works
      otherPlayers.forEach((op) => scene.remove(op.mesh));
      otherPlayers.clear();
      if (myMesh) { scene.remove(myMesh); myMesh = null; }
      me.alive = false;
      deathOverlay.classList.add('hidden');
      winOverlay.classList.add('hidden');
    }
  });
});

sensSlider.addEventListener('input', () => {
  settings.sensitivity = +sensSlider.value / 100;
  sensVal.textContent = sensSlider.value;
  saveSettings();
});
fovSlider.addEventListener('input', () => {
  settings.fov = +fovSlider.value;
  fovVal.textContent = fovSlider.value;
  applySettings();
  saveSettings();
});
volSlider.addEventListener('input', () => {
  settings.volume = +volSlider.value / 100;
  volVal.textContent = volSlider.value;
  saveSettings();
});
distSlider.addEventListener('input', () => {
  settings.camDist = +distSlider.value / 10;
  distVal.textContent = settings.camDist.toFixed(1);
  saveSettings();
});
invertY.addEventListener('change', () => {
  settings.invertY = invertY.checked;
  saveSettings();
});
leftShoulder.addEventListener('change', () => {
  settings.leftShoulder = leftShoulder.checked;
  saveSettings();
});

applySettings();
syncSettingsUI();

// ---------- START ----------
playBtn.addEventListener('click', () => {
  const n = (nameInput.value || '').trim().slice(0, 16) || 'Player';
  me.name = n;
  localStorage.setItem('brName', n);
  lobby.classList.add('hidden');
  hud.classList.remove('hidden');
  ensureAudio();
  connect();
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') playBtn.click();
});
