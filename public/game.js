import * as THREE from 'three';

// ---------- DOM ----------
const lobby = document.getElementById('lobby');
const playBtn = document.getElementById('playBtn');
const nameInput = document.getElementById('nameInput');
const hud = document.getElementById('hud');
const hpFill = document.getElementById('hpFill');
const hpVal = document.getElementById('hpVal');
const shieldFill = document.getElementById('shieldFill');
const shieldVal = document.getElementById('shieldVal');
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
const DEFAULT_KEYBINDS = {
  weaponAR: 'Digit1',
  weaponPump: 'Digit2',
  weaponSniper: 'Digit3',
};
const DEFAULT_SETTINGS = {
  sensitivity: 1.0,    // multiplier on base 0.0025
  fov: 75,
  volume: 1.0,
  camDist: 5.0,
  invertY: false,
  leftShoulder: false,
  keyBindings: { ...DEFAULT_KEYBINDS },
};
const settings = { ...DEFAULT_SETTINGS, keyBindings: { ...DEFAULT_KEYBINDS } };
try {
  const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  Object.assign(settings, stored);
  // Merge keyBindings so newly added bindings get their default in old saves
  settings.keyBindings = { ...DEFAULT_KEYBINDS, ...(stored.keyBindings || {}) };
} catch {}

function keyLabel(code) {
  if (!code) return '?';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'Space';
  if (code === 'ShiftLeft') return 'L Shift';
  if (code === 'ShiftRight') return 'R Shift';
  if (code === 'ControlLeft') return 'L Ctrl';
  if (code === 'ControlRight') return 'R Ctrl';
  if (code === 'AltLeft') return 'L Alt';
  if (code === 'AltRight') return 'R Alt';
  if (code === 'Escape') return 'Esc';
  if (code === 'Enter') return 'Enter';
  if (code === 'Tab') return 'Tab';
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}
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

// Potion (shield pickup) management
const potionMeshes = new Map(); // id -> mesh

function spawnPotion(id, x, z) {
  const group = new THREE.Group();
  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.7, 10),
    new THREE.MeshLambertMaterial({
      color: 0x4fc3ff,
      emissive: 0x1f6bb0,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.9,
    })
  );
  bottle.position.y = 0.35;
  group.add(bottle);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.18, 8),
    new THREE.MeshLambertMaterial({ color: 0x1a1a2a })
  );
  cap.position.y = 0.79;
  group.add(cap);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0x4fc3ff, transparent: true, opacity: 0.18, depthWrite: false })
  );
  glow.position.y = 0.4;
  group.add(glow);
  group.position.set(x, 0.6, z);
  group.userData.baseY = 0.6;
  group.userData.phase = Math.random() * Math.PI * 2;
  scene.add(group);
  potionMeshes.set(id, group);
}

function removePotion(id) {
  const m = potionMeshes.get(id);
  if (!m) return;
  scene.remove(m);
  m.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  });
  potionMeshes.delete(id);
}

function clearAllPotions() {
  for (const id of [...potionMeshes.keys()]) removePotion(id);
}

function animatePotions(t) {
  for (const m of potionMeshes.values()) {
    m.position.y = m.userData.baseY + Math.sin(t * 2 + m.userData.phase) * 0.15;
    m.rotation.y += 0.025;
  }
}

// Player models
function makePlayerMesh(color, name) {
  const group = new THREE.Group();
  const shirtMat = new THREE.MeshLambertMaterial({ color });
  const skinMat  = new THREE.MeshLambertMaterial({ color: 0xffd9b3 });
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2a3450 });
  const bootMat  = new THREE.MeshLambertMaterial({ color: 0x141420 });

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.45), shirtMat);
  torso.position.y = 1.35;
  group.add(torso);

  // Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), skinMat);
  head.position.y = 2.1;
  group.add(head);
  // Eyes
  const eyeGeom = new THREE.BoxGeometry(0.09, 0.09, 0.05);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
  eyeL.position.set(-0.13, 2.16, -0.29);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
  eyeR.position.set(0.13, 2.16, -0.29);
  group.add(eyeR);

  // Arms — geometry shifted so pivot is at the top (shoulder)
  const armGeom = new THREE.CylinderGeometry(0.13, 0.13, 0.85, 8);
  armGeom.translate(0, -0.425, 0);
  const armL = new THREE.Mesh(armGeom, shirtMat);
  armL.position.set(-0.55, 1.75, 0);
  group.add(armL);
  const armR = new THREE.Mesh(armGeom, shirtMat);
  armR.position.set(0.55, 1.75, 0);
  group.add(armR);

  // Legs — pivot at hip
  const legGeom = new THREE.CylinderGeometry(0.18, 0.18, 0.9, 8);
  legGeom.translate(0, -0.45, 0);
  const legL = new THREE.Mesh(legGeom, pantsMat);
  legL.position.set(-0.22, 0.9, 0);
  group.add(legL);
  const legR = new THREE.Mesh(legGeom, pantsMat);
  legR.position.set(0.22, 0.9, 0);
  group.add(legR);

  // Feet
  const footGeom = new THREE.BoxGeometry(0.3, 0.12, 0.42);
  const footL = new THREE.Mesh(footGeom, bootMat);
  footL.position.set(-0.22, 0.06, -0.06);
  legL.add(footL);
  // Foot is child of leg so it swings with the leg; reset to leg's local frame
  footL.position.set(0, -0.86, -0.06);
  const footR = new THREE.Mesh(footGeom, bootMat);
  footR.position.set(0, -0.86, -0.06);
  legR.add(footR);

  // Save limb refs for animation
  group.userData.armL = armL;
  group.userData.armR = armR;
  group.userData.legL = legL;
  group.userData.legR = legR;
  group.userData.phase = Math.random() * Math.PI * 2;

  // Weapon holder — held at the right shoulder, past the torso edge, slightly forward
  const weaponHolder = new THREE.Group();
  weaponHolder.position.set(0.55, 1.45, -0.4);
  weaponHolder.scale.setScalar(1.15);
  group.add(weaponHolder);
  group.userData.weaponHolder = weaponHolder;
  group.userData.heldWeapon = null;
  setPlayerWeapon(group, 'ar');

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
const myPrevPos = { x: 0, z: 0 };

function buildWeaponMesh(name) {
  const g = new THREE.Group();
  const black = new THREE.MeshLambertMaterial({ color: 0x161616 });
  const gray  = new THREE.MeshLambertMaterial({ color: 0x444450 });
  const wood  = new THREE.MeshLambertMaterial({ color: 0x4a3018 });
  const dark  = new THREE.MeshLambertMaterial({ color: 0x222a36 });
  const add = (geom, mat, x, y, z) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  if (name === 'ar') {
    add(new THREE.BoxGeometry(0.10, 0.15, 0.55), gray,  0,     0,    0);     // receiver
    add(new THREE.BoxGeometry(0.05, 0.05, 0.35), black, 0,     0,   -0.45);  // barrel
    add(new THREE.BoxGeometry(0.08, 0.18, 0.10), black, 0,    -0.16, 0.05);  // magazine
    add(new THREE.BoxGeometry(0.08, 0.12, 0.22), gray,  0,     0,    0.38);  // stock
    add(new THREE.BoxGeometry(0.04, 0.05, 0.08), black, 0,     0.11,-0.05);  // sight
  } else if (name === 'pump') {
    add(new THREE.BoxGeometry(0.13, 0.16, 0.42), wood,  0,     0,    0);     // body
    add(new THREE.BoxGeometry(0.08, 0.08, 0.32), black, 0,     0.02,-0.37);  // barrel
    add(new THREE.BoxGeometry(0.10, 0.13, 0.26), wood,  0,     0,    0.34);  // stock
    add(new THREE.BoxGeometry(0.11, 0.06, 0.22), gray,  0,    -0.11,-0.15);  // pump
  } else if (name === 'sniper') {
    add(new THREE.BoxGeometry(0.08, 0.13, 0.42), dark,  0,     0,    0);     // receiver
    add(new THREE.BoxGeometry(0.04, 0.04, 0.60), black, 0,     0,   -0.51);  // long barrel
    add(new THREE.BoxGeometry(0.08, 0.12, 0.30), dark,  0,     0,    0.36);  // stock
    add(new THREE.BoxGeometry(0.06, 0.10, 0.26), black, 0,     0.13,-0.05);  // scope body
    add(new THREE.BoxGeometry(0.04, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: 0x000000 }), 0, 0.13, -0.19); // scope lens
    add(new THREE.BoxGeometry(0.03, 0.06, 0.04), black, 0,     0.07,-0.05);  // scope mount
  }
  return g;
}

function setPlayerWeapon(mesh, weapon) {
  if (!mesh || !mesh.userData || !mesh.userData.weaponHolder) return;
  if (mesh.userData.heldWeapon === weapon) return;
  const holder = mesh.userData.weaponHolder;
  while (holder.children.length) {
    const c = holder.children[0];
    holder.remove(c);
    c.traverse && c.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) n.material.dispose();
    });
  }
  holder.add(buildWeaponMesh(weapon));
  mesh.userData.heldWeapon = weapon;
}

function animatePlayerMesh(mesh, walkingIntensity, t) {
  if (!mesh || !mesh.userData) return;
  const { armL, armR, legL, legR, phase } = mesh.userData;
  if (!armL) return;
  // Arms locked in "holding weapon forward" pose (don't swing — they hold the gun)
  armL.rotation.x = 1.3;
  armR.rotation.x = 1.3;
  // Legs still swing during walk
  if (walkingIntensity > 0.05) {
    const p = t * 8 + phase;
    const swing = 0.7 * Math.min(1, walkingIntensity);
    legL.rotation.x = -Math.sin(p) * swing;
    legR.rotation.x = Math.sin(p) * swing;
  } else {
    legL.rotation.x *= 0.85;
    legR.rotation.x *= 0.85;
  }
}

// ---------- GAME STATE ----------
const me = {
  id: null,
  name: '',
  x: 0, y: 0, z: 0,
  rotY: 0,
  vy: 0,
  onGround: true,
  hp: 100,
  shield: 0,
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
let mouseHeld = false;
let pointerLocked = false;

// Touch / mobile
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
if (isTouchDevice) document.body.classList.add('touch');

const joystick = {
  touchId: null,
  startX: 0, startY: 0,
  dx: 0, dy: 0,
  radius: 60,
};
const look = { touchId: null, lastX: 0, lastY: 0 };
let touchFiring = false;

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  const kb = settings.keyBindings;
  if (e.code === kb.weaponAR) selectWeapon('ar');
  else if (e.code === kb.weaponPump) selectWeapon('pump');
  else if (e.code === kb.weaponSniper) selectWeapon('sniper');
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

document.querySelectorAll('.weapon').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    selectWeapon(el.dataset.weapon);
  });
});

canvas.addEventListener('click', () => {
  if (isTouchDevice) return;
  if (!me.alive) return;
  if (!pointerLocked) canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  if (isTouchDevice) return;
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked && me.alive && gameState === 'playing' && lobby.classList.contains('hidden')) {
    openPauseMenu();
  } else if (pointerLocked) {
    closeMenus();
  }
});

document.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  const scopedMult = isScoped() ? 0.35 : 1;
  const sens = 0.0025 * settings.sensitivity * scopedMult;
  me.rotY -= e.movementX * sens;
  me.pitch += e.movementY * sens * (settings.invertY ? 1 : -1);
  me.pitch = Math.max(-1.2, Math.min(1.2, me.pitch));
});

document.addEventListener('mousedown', (e) => {
  if (!pointerLocked || e.button !== 0 || menuOpen) return;
  mouseHeld = true;
  fireShot(); // immediate first shot (one click = one shot for pump/sniper)
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseHeld = false;
});
window.addEventListener('blur', () => { mouseHeld = false; });

// ---------- TOUCH HANDLERS ----------
if (isTouchDevice) {
  const joystickBase = document.getElementById('joystickBase');
  const joystickKnob = document.getElementById('joystickKnob');
  const fireBtn = document.getElementById('touchFire');
  const jumpBtn = document.getElementById('touchJump');
  const pauseBtn = document.getElementById('touchPause');

  function setJoystickKnob(dx, dy) {
    joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  document.addEventListener('touchstart', (e) => {
    if (lobby && !lobby.classList.contains('hidden')) return; // lobby uses normal taps
    for (const t of e.changedTouches) {
      // Ignore touches landing on touch buttons or UI elements
      if (t.target && t.target.closest && t.target.closest('.touchBtn, .weapon, .menuBox, .menuOverlay, #lobby')) continue;
      if (menuOpen) continue;
      const halfW = window.innerWidth / 2;
      if (t.clientX < halfW && joystick.touchId === null) {
        joystick.touchId = t.identifier;
        joystick.startX = t.clientX;
        joystick.startY = t.clientY;
        joystick.dx = 0; joystick.dy = 0;
        joystickBase.style.left = `${t.clientX - 70}px`;
        joystickBase.style.top = `${t.clientY - 70}px`;
        joystickBase.style.display = 'block';
        setJoystickKnob(0, 0);
      } else if (t.clientX >= halfW && look.touchId === null) {
        look.touchId = t.identifier;
        look.lastX = t.clientX;
        look.lastY = t.clientY;
      }
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joystick.touchId) {
        let dx = t.clientX - joystick.startX;
        let dy = t.clientY - joystick.startY;
        const mag = Math.hypot(dx, dy);
        if (mag > joystick.radius) {
          dx = dx * joystick.radius / mag;
          dy = dy * joystick.radius / mag;
        }
        joystick.dx = dx / joystick.radius;
        joystick.dy = dy / joystick.radius;
        setJoystickKnob(dx, dy);
      } else if (t.identifier === look.touchId) {
        const moveX = t.clientX - look.lastX;
        const moveY = t.clientY - look.lastY;
        look.lastX = t.clientX;
        look.lastY = t.clientY;
        const scopedMult = isScoped() ? 0.35 : 1;
        const sens = 0.005 * settings.sensitivity * scopedMult;
        me.rotY -= moveX * sens;
        me.pitch += moveY * sens * (settings.invertY ? 1 : -1);
        me.pitch = Math.max(-1.2, Math.min(1.2, me.pitch));
      }
    }
  }, { passive: true });

  function endTouch(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joystick.touchId) {
        joystick.touchId = null;
        joystick.dx = 0; joystick.dy = 0;
        joystickBase.style.display = 'none';
      } else if (t.identifier === look.touchId) {
        look.touchId = null;
      }
    }
  }
  document.addEventListener('touchend', endTouch, { passive: true });
  document.addEventListener('touchcancel', endTouch, { passive: true });

  // Fire button: hold to fire continuously (cooldown limits rate)
  fireBtn.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    touchFiring = true;
    ensureAudio();
    fireShot(); // immediate first shot for pump/sniper (single tap = single shot)
  });
  fireBtn.addEventListener('touchend', (e) => {
    e.preventDefault(); e.stopPropagation();
    touchFiring = false;
  });
  fireBtn.addEventListener('touchcancel', () => { touchFiring = false; });

  jumpBtn.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    keys['Space'] = true;
    setTimeout(() => { keys['Space'] = false; }, 100);
  });

  pauseBtn.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (menuOpen) closeMenus();
    else openPauseMenu();
  });

  // Weapon buttons via touchstart (faster than click on mobile)
  document.querySelectorAll('.weapon').forEach((el) => {
    el.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      selectWeapon(el.dataset.weapon);
    });
  });
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- WEAPONS ----------
const WEAPONS = {
  ar:     { dmg: 25,  cooldown: 110,  color: 0xfff0a8, radius: 0.04, length: 0.9,  speed: 220, flashSize: 0.35, flashColor: 0xffdd66, pitch: 1.0  },
  pump:   { dmg: 150, cooldown: 800,  color: 0xff9955, radius: 0.03, length: 0.35, speed: 150, flashSize: 0.6,  flashColor: 0xff7733, pitch: 0.65 },
  sniper: { dmg: 100, cooldown: 1400, color: 0xc0eaff, radius: 0.03, length: 2.0,  speed: 600, flashSize: 0.28, flashColor: 0xddffff, pitch: 1.35 },
};
let currentWeapon = 'ar';
let lastShotTime = 0;

function selectWeapon(name) {
  if (!WEAPONS[name] || currentWeapon === name) return;
  currentWeapon = name;
  document.querySelectorAll('.weapon').forEach((el) => {
    el.classList.toggle('active', el.dataset.weapon === name);
  });
  if (myMesh) setPlayerWeapon(myMesh, name);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'weapon', weapon: name }));
  }
  updateScope();
}

// ---------- SHOOTING ----------
const bullets = [];  // {mesh, sx,sy,sz, ex,ey,ez, elapsed, duration}
const flashes = [];  // {mesh, light, life, max}
const impacts = [];  // {mesh, life, max, growth}

function fireShot() {
  ensureAudio();
  const w = WEAPONS[currentWeapon];
  const now = performance.now();
  if (now - lastShotTime < w.cooldown) return;
  lastShotTime = now;
  const origin = new THREE.Vector3();
  camera.getWorldPosition(origin);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  ws.send(JSON.stringify({
    type: 'shoot',
    weapon: currentWeapon,
    ox: origin.x, oy: origin.y, oz: origin.z,
    dx: dir.x, dy: dir.y, dz: dir.z,
  }));
}

function spawnShotEffect(msg, isMine) {
  const w = WEAPONS[msg.weapon] || WEAPONS.ar;

  // Shooter body + yaw -> gun position (right shoulder, slightly forward, chest height)
  const shSh = Math.sin(msg.srotY), shCh = Math.cos(msg.srotY);
  const fwdX = -shSh, fwdZ = -shCh;
  const rgtX = shCh, rgtZ = -shSh;
  const gunX = msg.sx + rgtX * 0.45 + fwdX * 0.5;
  const gunY = msg.sy + 1.5;
  const gunZ = msg.sz + rgtZ * 0.45 + fwdZ * 0.5;

  // Pellets array; for single-shot weapons it has one element
  const pellets = msg.pellets || [{ dx: msg.dx, dy: msg.dy, dz: msg.dz, dist: msg.dist }];

  for (const p of pellets) {
    const ix = msg.ox + p.dx * p.dist;
    const iy = msg.oy + p.dy * p.dist;
    const iz = msg.oz + p.dz * p.dist;
    const bulletGeom = new THREE.CylinderGeometry(w.radius, w.radius, w.length, 6);
    bulletGeom.rotateX(Math.PI / 2);
    const bulletMat = new THREE.MeshBasicMaterial({ color: w.color, transparent: true, opacity: 0.95 });
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
      duration: Math.max(0.03, totalDist / w.speed),
    });
  }

  // ONE muzzle flash + light per shot (not per pellet)
  const flashGeom = new THREE.SphereGeometry(w.flashSize, 8, 8);
  const flashMat = new THREE.MeshBasicMaterial({ color: w.flashColor, transparent: true, opacity: 1, depthWrite: false });
  const flashMesh = new THREE.Mesh(flashGeom, flashMat);
  flashMesh.position.set(gunX, gunY, gunZ);
  scene.add(flashMesh);
  const flashLight = new THREE.PointLight(w.flashColor, 4, 8);
  flashLight.position.set(gunX, gunY, gunZ);
  scene.add(flashLight);
  flashes.push({ mesh: flashMesh, light: flashLight, life: 0.07, max: 0.07 });

  // ONE sound per shot, with distance attenuation for other players
  let vol = 1.0;
  if (!isMine) {
    const cam = new THREE.Vector3();
    camera.getWorldPosition(cam);
    const d = Math.hypot(cam.x - gunX, cam.y - gunY, cam.z - gunZ);
    vol = Math.max(0.05, Math.min(0.7, 10 / (10 + d * 0.6)));
  }
  playGunshot(vol, w.pitch);
}

// ---------- DAMAGE NUMBERS ----------
const damageNumbers = []; // {sprite, vx, vy, vz, life, max}

function spawnDamageNumber(x, y, z, amount, shieldDmg, hpDmg) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Color choice: blue=shield-only, red=HP-only, white=mixed, gold=big hit (>=100)
  let color = '#ffffff';
  if (amount >= 100) color = '#ffd66b';
  else if (shieldDmg > 0 && hpDmg === 0) color = '#4fc3ff';
  else if (hpDmg > 0 && shieldDmg === 0) color = '#ff6b6b';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.strokeText(String(amount), 64, 32);
  ctx.fillStyle = color;
  ctx.fillText(String(amount), 64, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2, 1, 1);
  const ox = (Math.random() - 0.5) * 0.6;
  const oz = (Math.random() - 0.5) * 0.6;
  sprite.position.set(x + ox, y + 2.2, z + oz);
  scene.add(sprite);
  damageNumbers.push({
    sprite,
    vx: ox * 0.3,
    vy: 1.6,
    vz: oz * 0.3,
    life: 1.0,
    max: 1.0,
  });
}

function updateDamageNumbers(dt) {
  for (let i = damageNumbers.length - 1; i >= 0; i--) {
    const d = damageNumbers[i];
    d.life -= dt;
    d.sprite.position.x += d.vx * dt;
    d.sprite.position.y += d.vy * dt;
    d.sprite.position.z += d.vz * dt;
    d.vy -= 1.5 * dt; // gentle gravity
    d.sprite.material.opacity = Math.max(0, Math.min(1, d.life / d.max));
    if (d.life <= 0) {
      scene.remove(d.sprite);
      if (d.sprite.material.map) d.sprite.material.map.dispose();
      d.sprite.material.dispose();
      damageNumbers.splice(i, 1);
    }
  }
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

function playGunshot(volume = 1.0, pitch = 1.0) {
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
  noiseFilter.frequency.value = 1400 * pitch;
  noiseFilter.Q.value = 0.6;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.value = 0.55 * volume;
  noiseSrc.connect(noiseFilter).connect(noiseGain).connect(audioCtx.destination);
  noiseSrc.start(now);

  // Sub-bass thump
  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160 * pitch, now);
  osc.frequency.exponentialRampToValueAtTime(45 * pitch, now + 0.1);
  const oscGain = audioCtx.createGain();
  oscGain.gain.setValueAtTime(0.55 * volume, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
  osc.connect(oscGain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.15);

  // High-frequency crack
  const crack = audioCtx.createOscillator();
  crack.type = 'sawtooth';
  crack.frequency.setValueAtTime(2800 * pitch, now);
  crack.frequency.exponentialRampToValueAtTime(800 * pitch, now + 0.04);
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
  ws = new WebSocket(`${proto}://${location.host}`);
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
    clearAllPotions();
    if (msg.potions) {
      for (const p of msg.potions) spawnPotion(p.id, p.x, p.z);
    }
  } else if (msg.type === 'state') {
    updateFromState(msg.players);
  } else if (msg.type === 'hp') {
    me.hp = msg.hp;
    if (typeof msg.shield === 'number') me.shield = msg.shield;
    updateHpUI();
    if (msg.fromZone) statusEl.textContent = 'Outside zone! Move in.';
  } else if (msg.type === 'pickup') {
    removePotion(msg.potionId);
  } else if (msg.type === 'dmg') {
    spawnDamageNumber(msg.x, msg.y, msg.z, msg.amount, msg.shieldDmg || 0, msg.hpDmg || 0);
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
      updateScope();
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
    me.shield = 0;
    updateScope();
    clearAllPotions();
    if (msg.potions) {
      for (const p of msg.potions) spawnPotion(p.id, p.x, p.z);
    }
    deathOverlay.classList.add('hidden');
    winOverlay.classList.add('hidden');
    statusEl.textContent = 'Round started! Find blue potions for shield.';
    setTimeout(() => { if (statusEl.textContent.startsWith('Round started')) statusEl.textContent = ''; }, 4000);
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
      // Sync HP/shield from server
      const sh = (typeof p.shield === 'number') ? p.shield : me.shield;
      if (p.hp !== me.hp || sh !== me.shield) {
        me.hp = p.hp;
        me.shield = sh;
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
    if (p.weapon) setPlayerWeapon(op.mesh, p.weapon);
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
  const hpPct = Math.max(0, Math.min(100, me.hp));
  hpFill.style.width = `${hpPct}%`;
  hpVal.textContent = hpPct;
  const sPct = Math.max(0, Math.min(100, me.shield));
  shieldFill.style.width = `${sPct}%`;
  shieldVal.textContent = sPct;
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
  let mx = 0, mz = 0;
  let stickMag = 0;
  if (!inputBlocked) {
    if (isTouchDevice && joystick.touchId !== null) {
      mx = joystick.dx;
      mz = joystick.dy;
      stickMag = Math.hypot(mx, mz);
    } else {
      if (keys['KeyW']) mz -= 1;
      if (keys['KeyS']) mz += 1;
      if (keys['KeyA']) mx -= 1;
      if (keys['KeyD']) mx += 1;
      const klen = Math.hypot(mx, mz);
      if (klen > 0) { mx /= klen; mz /= klen; }
      stickMag = klen > 0 ? 1 : 0;
    }
  }
  // Sprint: keyboard shift, or touch joystick pushed > 85%
  const sprinting = (keys['ShiftLeft'] || keys['ShiftRight']) || (isTouchDevice && stickMag > 0.85);
  const speed = sprinting ? 10 : 6;
  // Normalize touch joystick magnitude (don't exceed 1)
  if (stickMag > 1) { mx /= stickMag; mz /= stickMag; }

  // Continuous fire on hold — AR only (pump/sniper require a fresh click/tap)
  if (!inputBlocked && currentWeapon === 'ar') {
    if (mouseHeld && pointerLocked) fireShot();
    if (touchFiring) fireShot();
  }

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
    const moved = Math.hypot(me.x - myPrevPos.x, me.z - myPrevPos.z);
    myPrevPos.x = me.x; myPrevPos.z = me.z;
    animatePlayerMesh(myMesh, moved / 0.15, clock.elapsedTime);
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
    const oldX = op.x, oldZ = op.z;
    op.x += (op.targetX - op.x) * lerp;
    op.y += (op.targetY - op.y) * lerp;
    op.z += (op.targetZ - op.z) * lerp;
    let dr = op.targetRot - op.rotY;
    while (dr > Math.PI) dr -= Math.PI * 2;
    while (dr < -Math.PI) dr += Math.PI * 2;
    op.rotY += dr * lerp;
    op.mesh.position.set(op.x, op.y, op.z);
    op.mesh.rotation.y = op.rotY;
    const movedR = Math.hypot(op.x - oldX, op.z - oldZ);
    animatePlayerMesh(op.mesh, movedR / (dt * 6), clock.elapsedTime);
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
  // Potions
  ctx.fillStyle = '#4fc3ff';
  for (const m of potionMeshes.values()) {
    ctx.beginPath();
    ctx.arc(cx + m.position.x * scale, cy + m.position.z * scale, 1.8, 0, Math.PI * 2);
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
  updateDamageNumbers(dt);
  animatePotions(clock.elapsedTime);
  drawMinimap();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();

// ---------- MENU & SETTINGS WIRING ----------
function applySettings() {
  updateScope();
}

function isScoped() {
  return currentWeapon === 'sniper' && me.alive;
}

function updateScope() {
  const scoped = isScoped();
  document.body.classList.toggle('scoped', scoped);
  camera.fov = scoped ? 25 : settings.fov;
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
  document.querySelectorAll('[data-bind]').forEach((btn) => {
    btn.textContent = keyLabel(settings.keyBindings[btn.dataset.bind]);
    btn.classList.remove('rebinding');
  });
}

function syncHotkeyChips() {
  const kb = settings.keyBindings;
  const setChip = (sel, code) => { const el = document.querySelector(sel); if (el) el.textContent = keyLabel(code); };
  setChip('.weapon[data-weapon="ar"] .wKey', kb.weaponAR);
  setChip('.weapon[data-weapon="pump"] .wKey', kb.weaponPump);
  setChip('.weapon[data-weapon="sniper"] .wKey', kb.weaponSniper);
}

let rebindingHandler = null;
function startRebind(action, button) {
  if (rebindingHandler) { window.removeEventListener('keydown', rebindingHandler, true); rebindingHandler = null; }
  document.querySelectorAll('.keybind').forEach((b) => b.classList.remove('rebinding'));
  button.classList.add('rebinding');
  button.textContent = 'Press a key...';
  rebindingHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.removeEventListener('keydown', rebindingHandler, true);
    rebindingHandler = null;
    if (e.code !== 'Escape') {
      settings.keyBindings[action] = e.code;
      saveSettings();
      syncHotkeyChips();
    }
    button.classList.remove('rebinding');
    button.textContent = keyLabel(settings.keyBindings[action]);
  };
  window.addEventListener('keydown', rebindingHandler, true);
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
    if (act === 'resume') {
      if (isTouchDevice) closeMenus();
      else canvas.requestPointerLock();
    }
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

// Keybind UI wiring
document.querySelectorAll('.keybind').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    startRebind(btn.dataset.bind, btn);
  });
});

applySettings();
syncSettingsUI();
syncHotkeyChips();

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
