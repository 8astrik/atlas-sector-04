import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ------------------------------------------------------------------ */
/*  Boot                                                               */
/* ------------------------------------------------------------------ */

const params = new URLSearchParams(location.search);
const SHOT_MODE = params.has('shot');
const CAPTURE_MODE = params.has('capture');

if (SHOT_MODE) document.body.classList.add('shot');
if (CAPTURE_MODE) document.body.classList.add('capture');

const stage = document.getElementById('stage');
const canvas = document.getElementById('scene');
const hud = document.getElementById('hud');
const startOverlay = document.getElementById('start');
const pauseOverlay = document.getElementById('pause');
const startBtn = document.getElementById('start-btn');
const resumeBtn = document.getElementById('resume-btn');
const reticle = document.getElementById('reticle');
const promptEl = document.getElementById('prompt');
const promptKey = document.getElementById('prompt-key');
const promptText = document.getElementById('prompt-text');
const toastEl = document.getElementById('toast');
const objectiveEl = document.getElementById('objective');
const cellCountEl = document.getElementById('cell-count');
const reserveCountEl = document.getElementById('reserve-count');
const reactorEl = document.getElementById('reactor-state');
const controlsEl = document.getElementById('controls');
const missionBars = [...document.querySelectorAll('.mission-progress i')];
const cellPips = [...document.querySelectorAll('.cell-pips i')];

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true,
  stencil: false
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.94;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080b);
scene.fog = new THREE.FogExp2(0x05090c, 0.031);

const camera = new THREE.PerspectiveCamera(62, 1, 0.04, 60);
camera.rotation.order = 'YXZ';

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (repeatX !== 1 || repeatY !== 1) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
  }
  return t;
}

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rt, rb, h, seg, mat, open = false) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function place(parent, mesh, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  parent.add(mesh);
  return mesh;
}

/* ------------------------------------------------------------------ */
/*  Procedural textures                                                */
/* ------------------------------------------------------------------ */

const rnd = mulberry32(20261019);

function makeFloorTexture() {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    const tiles = 4;
    const s = w / tiles;
    ctx.fillStyle = '#5d646c';
    ctx.fillRect(0, 0, w, h);

    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        const v = 96 + Math.floor(rnd() * 22);
        ctx.fillStyle = `rgb(${v},${v + 5},${v + 10})`;
        ctx.fillRect(tx * s + 2, ty * s + 2, s - 4, s - 4);

        ctx.strokeStyle = 'rgba(255,255,255,0.045)';
        ctx.lineWidth = 2;
        ctx.strokeRect(tx * s + 7, ty * s + 7, s - 14, s - 14);

        // occasional scuffs and stains
        for (let i = 0; i < 5; i++) {
          if (rnd() > 0.55) {
            const gx = tx * s + rnd() * s;
            const gy = ty * s + rnd() * s;
            const gr = 8 + rnd() * 48;
            const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
            g.addColorStop(0, `rgba(20,24,28,${0.05 + rnd() * 0.1})`);
            g.addColorStop(1, 'rgba(20,24,28,0)');
            ctx.fillStyle = g;
            ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
          }
        }
      }
    }

    // seams
    ctx.strokeStyle = 'rgba(46,52,58,0.9)';
    ctx.lineWidth = 4;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s, 0);
      ctx.lineTo(i * s, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * s);
      ctx.lineTo(w, i * s);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(210,225,235,0.09)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s + 3, 0);
      ctx.lineTo(i * s + 3, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * s + 3);
      ctx.lineTo(w, i * s + 3);
      ctx.stroke();
    }

    // bolts
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        for (const [ox, oy] of [[6, 6], [s - 6, 6], [6, s - 6], [s - 6, s - 6]]) {
          ctx.fillStyle = 'rgba(25,29,33,0.8)';
          ctx.beginPath();
          ctx.arc(tx * s + ox, ty * s + oy, 3, 0, TAU);
          ctx.fill();
          ctx.fillStyle = 'rgba(200,212,220,0.12)';
          ctx.beginPath();
          ctx.arc(tx * s + ox - 0.7, ty * s + oy - 0.7, 1.4, 0, TAU);
          ctx.fill();
        }
      }
    }

    // speckle
    for (let i = 0; i < 2400; i++) {
      const a = rnd();
      ctx.fillStyle = a > 0.55 ? 'rgba(235,245,250,0.035)' : 'rgba(5,8,10,0.06)';
      ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }

    // long scratches
    for (let i = 0; i < 24; i++) {
      ctx.strokeStyle = `rgba(220,235,242,${0.02 + rnd() * 0.035})`;
      ctx.lineWidth = 0.7 + rnd();
      const x = rnd() * w;
      const y = rnd() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 90, y + (rnd() - 0.5) * 90);
      ctx.stroke();
    }
  }, 2, 2);
}

function makeWallTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#7f858d';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(0, 0, w, 18);
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    ctx.fillRect(0, h - 24, w, 24);

    for (let i = 0; i < 60; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const ww = 10 + rnd() * 90;
      const hh = 2 + rnd() * 20;
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.045)';
      ctx.fillRect(x, y, ww, hh);
    }

    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(rnd() * w, rnd() * h, 1, 1 + rnd() * 2);
    }

    // vertical grime streaks
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w;
      const g = ctx.createLinearGradient(x, 0, x, h);
      g.addColorStop(0, 'rgba(10,14,18,0.0)');
      g.addColorStop(0.5, `rgba(10,14,18,${0.02 + rnd() * 0.05})`);
      g.addColorStop(1, 'rgba(10,14,18,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 1 + rnd() * 6, h);
    }

    // fine scratches
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(230,240,245,${0.015 + rnd() * 0.03})`;
      ctx.lineWidth = 0.6;
      const x = rnd() * w;
      const y = rnd() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 40);
      ctx.stroke();
    }
  }, 2, 1.4);
}

function makeHazardTexture() {
  return canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#171a1d';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    for (let x = -h; x < w + h; x += 32) {
      ctx.fillStyle = '#c89638';
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + 18, h);
      ctx.lineTo(x + 18 + h, 0);
      ctx.lineTo(x + h, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(10,12,14,0.35)';
    for (let i = 0; i < 160; i++) {
      ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1);
    }
    ctx.restore();
  }, 3, 1);
}

function makeSignTexture(title, sub, accent = '#8ff4ff', numeric = '') {
  return canvasTexture(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = '#0a0f13';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(150,215,225,0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, w - 20, h - 20);

    ctx.fillStyle = accent;
    ctx.fillRect(10, 10, 6, h - 20);
    ctx.fillStyle = 'rgba(150,215,225,0.25)';
    ctx.fillRect(24, 10, w - 34, 2);
    ctx.fillRect(24, h - 12, w - 34, 2);

    if (numeric) {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = accent;
      ctx.font = '700 210px Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(numeric, w - 40, h / 2 + 8);
      ctx.restore();
    }

    ctx.save();
    ctx.shadowColor = accent;
    ctx.shadowBlur = 22;
    ctx.fillStyle = accent;
    ctx.font = '700 78px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 46, h / 2 - 24);
    ctx.restore();

    ctx.fillStyle = 'rgba(214,236,240,0.62)';
    ctx.font = '400 25px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(sub, 50, h / 2 + 50);

    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, rnd() * h, w, 1);
    }
  });
}

function makeStencilTexture(title, sub, accent = '#d8b56a') {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 5;
    ctx.strokeRect(22, 22, w - 44, h - 44);

    ctx.font = '700 98px Consolas, monospace';
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, w / 2, h / 2 - 18);

    ctx.font = '400 32px Consolas, monospace';
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.6;
    ctx.fillText(sub, w / 2, h / 2 + 66);

    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 3;
    for (const [x, y, sx, sy] of [[22, 22, 1, 1], [w - 22, 22, -1, 1], [22, h - 22, 1, -1], [w - 22, h - 22, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(x, y + sy * 26);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * 26, y);
      ctx.stroke();
    }

    // weathering
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 240; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.2 + rnd() * 0.8})`;
      ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 8, 1 + rnd() * 4);
    }
    ctx.globalCompositeOperation = 'source-over';
  });
}

function makePathTexture() {
  return canvasTexture(512, 1024, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(116,242,255,0.18)';
    ctx.lineWidth = 5;
    ctx.setLineDash([46, 34]);
    ctx.beginPath();
    ctx.moveTo(w / 2, h - 20);
    ctx.lineTo(w / 2, 30);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(255,180,92,0.4)';
    ctx.lineWidth = 4;
    for (let y = 700; y > 150; y -= 170) {
      ctx.beginPath();
      ctx.moveTo(w / 2 - 40, y + 34);
      ctx.lineTo(w / 2, y);
      ctx.lineTo(w / 2 + 40, y + 34);
      ctx.stroke();
    }
  });
}

const floorTex = makeFloorTexture();
const wallTex = makeWallTexture();
const hazardTex = makeHazardTexture();
const pathTex = makePathTexture();

// soft radial halo used for glows
const haloTex = canvasTexture(128, 128, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(190,250,255,1)');
  g.addColorStop(0.18, 'rgba(100,235,255,0.85)');
  g.addColorStop(0.5, 'rgba(30,180,220,0.25)');
  g.addColorStop(1, 'rgba(0,80,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
});

/* ------------------------------------------------------------------ */
/*  Environment map                                                    */
/* ------------------------------------------------------------------ */

function makeEnvironment() {
  const tex = canvasTexture(1024, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#18232c');
    g.addColorStop(0.42, '#202c35');
    g.addColorStop(0.52, '#2d3942');
    g.addColorStop(0.75, '#0a0e12');
    g.addColorStop(1, '#040608');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const strips = [
      [0.1, 0.06, '#dff4ff', 0.9],
      [0.24, 0.045, '#ffc183', 0.5],
      [0.47, 0.08, '#9fdcff', 0.75],
      [0.63, 0.035, '#eaf8ff', 0.45],
      [0.8, 0.06, '#86d4e8', 0.6]
    ];
    for (const [x, ww, color, alpha] of strips) {
      const gg = ctx.createLinearGradient(w * x, 0, w * (x + ww), 0);
      gg.addColorStop(0, 'rgba(0,0,0,0)');
      gg.addColorStop(0.5, color);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = alpha;
      ctx.fillStyle = gg;
      ctx.fillRect(w * x, 0, w * ww, h * 0.58);
      ctx.globalAlpha = 1;
    }
  });
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromEquirectangular(tex);
  tex.dispose();
  pmrem.dispose();
  return rt.texture;
}

const envMap = makeEnvironment();
scene.environment = envMap;

/* ------------------------------------------------------------------ */
/*  Materials                                                          */
/* ------------------------------------------------------------------ */

const matFloor = new THREE.MeshStandardMaterial({
  map: floorTex,
  color: 0xc8cdd2,
  roughness: 0.72,
  metalness: 0.08,
  envMapIntensity: 0.55
});

const matWall = new THREE.MeshStandardMaterial({
  map: wallTex,
  color: 0x98a0a8,
  roughness: 0.94,
  metalness: 0.03,
  envMapIntensity: 0.2
});

const matWallDark = new THREE.MeshStandardMaterial({
  map: wallTex,
  color: 0x6b7279,
  roughness: 0.96,
  metalness: 0.03,
  envMapIntensity: 0.16
});

const matMetal = new THREE.MeshStandardMaterial({
  color: 0x59616a,
  roughness: 0.48,
  metalness: 0.62,
  envMapIntensity: 0.9
});

const matMetalDark = new THREE.MeshStandardMaterial({
  color: 0x262b31,
  roughness: 0.55,
  metalness: 0.55,
  envMapIntensity: 0.7
});

const matRubber = new THREE.MeshStandardMaterial({
  color: 0x14181c,
  roughness: 0.9,
  metalness: 0.08,
  envMapIntensity: 0.3
});

const matSeam = new THREE.MeshStandardMaterial({
  color: 0x32383f,
  roughness: 0.9,
  metalness: 0.15
});

const matCrate = new THREE.MeshStandardMaterial({
  map: wallTex,
  color: 0xaab1b8,
  roughness: 0.82,
  metalness: 0.08,
  envMapIntensity: 0.35
});

const matHazard = new THREE.MeshStandardMaterial({
  map: hazardTex,
  roughness: 0.72,
  metalness: 0.1,
  envMapIntensity: 0.4
});

const matFloorPaint = new THREE.MeshBasicMaterial({
  map: pathTex,
  transparent: true,
  depthWrite: false,
  opacity: 0.8,
  toneMapped: false
});

/* ------------------------------------------------------------------ */
/*  Room shell                                                         */
/* ------------------------------------------------------------------ */

const world = new THREE.Group();
scene.add(world);

const W = 10;
const D = 10;
const H = 4.2;

// floor
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), matFloor);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.layers.enable(3); // reacts to the cyan cell lights
world.add(floor);

// painted guide line
const guide = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 7.4), matFloorPaint);
guide.rotation.x = -Math.PI / 2;
guide.position.set(0.1, 0.012, 0.35);
guide.renderOrder = 2;
world.add(guide);

// ceiling
const ceiling = box(W, 0.2, D, matWallDark);
ceiling.position.set(0, H + 0.1, 0);
world.add(ceiling);

// side walls
const wallL = box(0.2, H, D, matWall);
wallL.position.set(-W / 2 - 0.1, H / 2, 0);
world.add(wallL);

const wallR = box(0.2, H, D, matWall);
wallR.position.set(W / 2 + 0.1, H / 2, 0);
world.add(wallR);

// front wall (behind player)
const wallFront = box(W, H, 0.2, matWall);
wallFront.position.set(0, H / 2, D / 2 + 0.1);
world.add(wallFront);

// back wall, with door opening 2.4 x 2.72
const doorW = 2.4;
const doorH = 2.72;
const backLeft = box(3.8, H, 0.2, matWall);
backLeft.position.set(-3.1, H / 2, -D / 2);
world.add(backLeft);

const backRight = box(3.8, H, 0.2, matWall);
backRight.position.set(3.1, H / 2, -D / 2);
world.add(backRight);

const backTop = box(doorW, H - doorH, 0.2, matWall);
backTop.position.set(0, doorH + (H - doorH) / 2, -D / 2);
world.add(backTop);

// floor / ceiling of the short corridor beyond the airlock
const corridorFloor = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.8), matFloor);
corridorFloor.rotation.x = -Math.PI / 2;
corridorFloor.position.set(0, 0.002, -6.9);
corridorFloor.receiveShadow = true;
world.add(corridorFloor);

const corridorCeil = box(2.4, 0.16, 3.8, matWallDark);
corridorCeil.position.set(0, 2.78, -6.9);
world.add(corridorCeil);

const corridorL = box(0.16, 2.78, 3.8, matWallDark);
corridorL.position.set(-1.28, 1.39, -6.9);
world.add(corridorL);

const corridorR = box(0.16, 2.78, 3.8, matWallDark);
corridorR.position.set(1.28, 1.39, -6.9);
world.add(corridorR);

const corridorEnd = box(2.4, 2.8, 0.16, matSeam);
corridorEnd.position.set(0, 1.4, -8.8);
world.add(corridorEnd);

// ---- sealed blast door at the end of the corridor (sector 05) ----
const exitFrame = box(1.92, 2.44, 0.14, matMetalDark);
exitFrame.position.set(0, 1.22, -8.7);
world.add(exitFrame);

for (const sx of [-1, 1]) {
  const post = box(0.16, 2.62, 0.24, matMetal);
  post.position.set(sx * 1.06, 1.31, -8.66);
  world.add(post);
}
const exitLintel = box(2.28, 0.18, 0.24, matMetal);
exitLintel.position.set(0, 2.62, -8.66);
world.add(exitLintel);

for (const y of [0.42, 0.92, 1.42, 1.92, 2.24]) {
  const rib = box(1.74, 0.05, 0.03, matMetal);
  rib.position.set(0, y, -8.62);
  rib.castShadow = false;
  world.add(rib);
}

const exitHazard = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.24), matHazard);
exitHazard.position.set(0, 0.2, -8.615);
world.add(exitHazard);

// window of the sector 05 door
const endWinFrame = box(0.62, 0.42, 0.05, matMetalDark);
endWinFrame.position.set(0.28, 1.64, -8.615);
world.add(endWinFrame);

const exitGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(0.46, 0.26),
  new THREE.MeshBasicMaterial({
    color: 0x9fe8ff,
    toneMapped: false,
    transparent: true,
    opacity: 0.9
  })
);
exitGlow.position.set(0.28, 1.64, -8.585);
world.add(exitGlow);

const exitHalo = new THREE.Sprite(new THREE.SpriteMaterial({
  map: haloTex,
  color: 0x7fd8ff,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  opacity: 0.55,
  toneMapped: false
}));
exitHalo.scale.set(1.5, 1.1, 1);
exitHalo.position.set(0.28, 1.64, -8.58);
world.add(exitHalo);

// vertical light strip beside the door
const exitStrip = new THREE.Mesh(
  new THREE.PlaneGeometry(0.05, 2.0),
  new THREE.MeshBasicMaterial({ color: 0xd6f3ff, toneMapped: false })
);
exitStrip.position.set(0.93, 1.12, -8.6);
world.add(exitStrip);

// keypad next to the door
const keypad = box(0.18, 0.3, 0.07, matMetalDark);
keypad.position.set(-0.82, 1.3, -8.6);
world.add(keypad);
for (let i = 0; i < 3; i++) {
  const key = new THREE.Mesh(
    new THREE.PlaneGeometry(0.04, 0.04),
    new THREE.MeshBasicMaterial({ color: 0x7ff4ff, toneMapped: false })
  );
  key.position.set(-0.82, 1.38 - i * 0.08, -8.558);
  world.add(key);
}

// corridor ceiling light
const corridorLamp = new THREE.Mesh(
  new THREE.PlaneGeometry(0.24, 2.6),
  new THREE.MeshBasicMaterial({ color: 0xcfeaf6, toneMapped: false })
);
corridorLamp.rotation.x = Math.PI / 2;
corridorLamp.position.set(0, 2.69, -6.9);
world.add(corridorLamp);

// corridor wall rails
for (const y of [0.85, 1.95]) {
  for (const sx of [-1, 1]) {
    const rail = box(0.05, 0.04, 3.6, matMetalDark);
    rail.position.set(sx * 1.19, y, -6.9);
    rail.castShadow = false;
    world.add(rail);
  }
}

// corridor sign
const corridorSign = new THREE.Mesh(
  new THREE.PlaneGeometry(1.5, 0.36),
  new THREE.MeshBasicMaterial({ map: makeSignTexture('SECTOR 05', 'ДОСТУП РАЗРЕШЁН', '#b9f4ff', '05'), toneMapped: false })
);
corridorSign.position.set(0, 2.42, -8.6);
world.add(corridorSign);

/* ------------------------------------------------------------------ */
/*  Wall detailing                                                     */
/* ------------------------------------------------------------------ */

const wallDetail = new THREE.Group();
world.add(wallDetail);

function seam(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = box(w, h, d, matSeam);
  m.castShadow = false;
  return place(wallDetail, m, x, y, z, rx, ry, rz);
}

// horizontal panel rails on back wall
for (const y of [1.02, 2.02, 3.02, 4.02]) {
  seam(3.72, 0.035, 0.05, -3.1, y, -4.88);
  seam(3.72, 0.035, 0.05, 3.1, y, -4.88);
}

// vertical seams on back wall
for (const x of [-4.5, -2.9, -1.4, 1.4, 2.9, 4.5]) {
  seam(0.03, 3.1, 0.05, x, 2.7, -4.88);
}

// raised access panels on the right wall
for (const [z, y, w, h] of [[-3.5, 2.4, 1.1, 0.9], [-1.6, 3.2, 0.8, 0.6], [3.2, 2.3, 1.3, 1.0]]) {
  const panelBox = box(0.05, h, w, matMetalDark);
  panelBox.position.set(4.86, y, z);
  panelBox.castShadow = false;
  world.add(panelBox);
  const handle = box(0.04, 0.05, 0.22, matMetal);
  handle.position.set(4.9, y - h * 0.3, z + w * 0.3);
  handle.castShadow = false;
  world.add(handle);
}

// side walls: horizontal rails only (vertical seams would read as a glass facade)
for (const sx of [-1, 1]) {
  const x = sx * 4.88;
  for (const y of [1.02, 2.02, 3.02]) {
    seam(0.05, 0.035, 9.72, x, y, 0);
  }
}

// lower wall band (wainscot) breaks up the flat panels
for (const [w, d, x, z] of [[9.72, 0.08, 0, -4.87], [0.08, 9.72, 4.87, 0], [0.08, 9.72, -4.87, 0]]) {
  const band = box(w, 0.86, d, matWallDark);
  band.position.set(x, 0.43, z);
  band.castShadow = false;
  world.add(band);
  const cap = box(w, 0.06, d * 1.6, matMetalDark);
  cap.position.set(x, 0.88, z);
  cap.castShadow = false;
  world.add(cap);
}

// baseboards
for (const [w, d, x, z] of [[10, 0.1, 0, -4.88], [10, 0.1, 0, 4.88], [0.1, 10, -4.88, 0], [0.1, 10, 4.88, 0]]) {
  const b = box(w, 0.16, d, matMetalDark);
  b.position.set(x, 0.08, z);
  b.castShadow = false;
  world.add(b);
}

// ceiling cross beams
for (const z of [-3.2, -0.3, 2.6]) {
  const b = box(10, 0.22, 0.18, matMetalDark);
  b.position.set(0, 4.02, z);
  world.add(b);
}

// ceiling pipes
for (const [x, r] of [[-3.6, 0.11], [-3.25, 0.075], [3.5, 0.09]]) {
  const pipe = cyl(r, r, 9.6, 12, matMetal);
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(x, 3.94, 0);
  world.add(pipe);

  for (const z of [-3.6, -1.8, 0, 1.8, 3.6]) {
    const clampM = box(0.18, 0.08, 0.08, matMetalDark);
    clampM.position.set(x, 4.05, z);
    world.add(clampM);
  }
}

// wall pipes / conduit on left wall
for (const [z, y, h] of [[2.55, 2.15, 2.9], [3.05, 2.15, 2.9]]) {
  const p = cyl(0.055, 0.055, 2.9, 8, matMetal);
  p.position.set(-4.83, y, z);
  world.add(p);
}
const conduitH = cyl(0.06, 0.06, 2.4, 8, matMetal);
conduitH.rotation.z = Math.PI / 2;
conduitH.position.set(-4.83, 3.6, 2.8);
world.add(conduitH);

// vent grille on left wall
const ventFrame = box(0.1, 1.5, 1.8, matMetalDark);
ventFrame.position.set(-4.86, 2.55, 3.45);
world.add(ventFrame);
for (let i = 0; i < 8; i++) {
  const slat = box(0.06, 0.055, 1.62, matMetal);
  slat.position.set(-4.79, 1.92 + i * 0.18, 3.45);
  world.add(slat);
}

// large hex-ish wall hatch on left
const hatch = cyl(0.62, 0.62, 0.08, 6, matMetalDark);
hatch.rotation.z = Math.PI / 2;
hatch.position.set(-4.78, 2.55, 1.55);
world.add(hatch);
const hatchInner = cyl(0.48, 0.48, 0.1, 6, matMetal);
hatchInner.rotation.z = Math.PI / 2;
hatchInner.position.set(-4.74, 2.55, 1.55);
world.add(hatchInner);
const hatchBolt = cyl(0.1, 0.1, 0.12, 12, matSeam);
hatchBolt.rotation.z = Math.PI / 2;
hatchBolt.position.set(-4.68, 2.55, 1.55);
world.add(hatchBolt);

// sign on right wall
const wallSign = new THREE.Mesh(
  new THREE.PlaneGeometry(1.35, 0.34),
  new THREE.MeshBasicMaterial({ map: makeSignTexture('POWER RELAY', 'СЕКТОР 04 · УЗЕЛ B', '#ffc479', 'B'), toneMapped: false })
);
wallSign.position.set(4.885, 2.75, 1.75);
wallSign.rotation.y = -Math.PI / 2;
world.add(wallSign);

/* ------------------------------------------------------------------ */
/*  Lighting                                                           */
/* ------------------------------------------------------------------ */

const hemi = new THREE.HemisphereLight(0x2c3b46, 0x060809, 0.34);
scene.add(hemi);

const ceilingLights = [];
for (const [z, intensity] of [[-2.9, 17], [0.4, 13], [3.0, 9]]) {
  const housing = box(0.56, 0.1, 2.1, matMetalDark);
  housing.position.set(0.9, 4.12, z);
  world.add(housing);

  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 1.9),
    new THREE.MeshBasicMaterial({ color: 0xd8f1fb, toneMapped: false })
  );
  panel.rotation.x = Math.PI / 2;
  panel.position.set(0.9, 4.06, z);
  world.add(panel);

  const light = new THREE.PointLight(0xd9e5ea, intensity, 9, 2);
  light.position.set(0.9, 3.88, z);
  light.castShadow = false;
  scene.add(light);
  ceilingLights.push({ light, base: intensity });

  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(1.55, 3.9, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x9fd6e8,
      transparent: true,
      opacity: 0.008,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  cone.position.set(0.9, 2.15, z);
  world.add(cone);
}

const spotDoor = new THREE.SpotLight(0xd2e2e8, 52, 11, 0.58, 0.85, 1.6);
spotDoor.position.set(0, 4.05, -3.1);
spotDoor.target.position.set(0, 1.1, -5);
spotDoor.castShadow = true;
spotDoor.shadow.mapSize.set(1024, 1024);
spotDoor.shadow.bias = -0.0008;
spotDoor.shadow.normalBias = 0.02;
scene.add(spotDoor, spotDoor.target);

const spotRack = new THREE.SpotLight(0xb8dce6, 34, 9, 0.55, 0.8, 1.8);
spotRack.position.set(-3.1, 4.05, 0.7);
spotRack.target.position.set(-3.0, 1.3, -1.2);
spotRack.castShadow = true;
spotRack.shadow.mapSize.set(1024, 1024);
spotRack.shadow.bias = -0.0008;
spotRack.shadow.normalBias = 0.02;
scene.add(spotRack, spotRack.target);

const doorAmber = new THREE.PointLight(0xff9a4c, 4, 4.2, 2);
doorAmber.position.set(0, 3.0, -4.72);
scene.add(doorAmber);

const corridorLight = new THREE.PointLight(0xd6f0ff, 0, 9, 2);
corridorLight.position.set(0, 2.25, -7.15);
scene.add(corridorLight);

/* ------------------------------------------------------------------ */
/*  Air lock door                                                      */
/* ------------------------------------------------------------------ */

const doorGroup = new THREE.Group();
doorGroup.position.set(0, 0, 0);
world.add(doorGroup);

// frame
for (const sx of [-1, 1]) {
  const post = box(0.24, 2.88, 0.52, matMetalDark);
  post.position.set(sx * 1.32, 1.44, -4.85);
  doorGroup.add(post);

  const innerRib = box(0.06, 2.66, 0.1, matMetal);
  innerRib.position.set(sx * 1.215, 1.34, -4.73);
  doorGroup.add(innerRib);

  const hazard = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.62), matHazard);
  hazard.position.set(sx * 1.32, 0.48, -4.585);
  doorGroup.add(hazard);
}

const lintel = box(2.88, 0.24, 0.52, matMetalDark);
lintel.position.set(0, 2.84, -4.85);
doorGroup.add(lintel);

const threshold = box(2.4, 0.05, 0.55, matMetal);
threshold.position.set(0, 0.025, -4.72);
doorGroup.add(threshold);

// door leaves
const doorPanels = [];
const panelMat = new THREE.MeshStandardMaterial({
  map: wallTex,
  color: 0x6a7179,
  roughness: 0.6,
  metalness: 0.32,
  envMapIntensity: 0.55
});

for (const side of [-1, 1]) {
  const pivot = new THREE.Group();
  pivot.position.set(0, 0, 0);
  doorGroup.add(pivot);

  const panel = box(1.17, 2.6, 0.18, panelMat);
  panel.position.set(side * 0.595, 1.32, -4.88);
  pivot.add(panel);

  // ribs
  for (const y of [0.32, 0.7, 1.18, 1.66, 2.14, 2.46]) {
    const rib = box(1.03, 0.045, 0.03, matMetalDark);
    rib.position.set(side * 0.595, y, -4.787);
    rib.castShadow = false;
    pivot.add(rib);
  }

  // central edge trim
  const edge = box(0.045, 2.52, 0.04, matMetal);
  edge.position.set(side * 0.032, 1.32, -4.782);
  edge.castShadow = false;
  pivot.add(edge);

  // hazard block near bottom
  const hz = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.22), matHazard);
  hz.position.set(side * 0.595, 0.22, -4.786);
  pivot.add(hz);

  pivot.userData = { side, closedX: 0, slide: 1.2 };
  doorPanels.push(pivot);
}

// window in left door leaf
const winFrame = box(0.5, 0.22, 0.05, matMetalDark);
winFrame.position.set(-0.595, 2.06, -4.77);
doorGroup.add(winFrame);

const winGlass = new THREE.Mesh(
  new THREE.PlaneGeometry(0.42, 0.14),
  new THREE.MeshBasicMaterial({ color: 0xffb056, toneMapped: false, transparent: true, opacity: 0.6 })
);
winGlass.position.set(-0.595, 2.06, -4.742);
doorGroup.add(winGlass);

const winGlow = new THREE.PointLight(0xff9a45, 1.2, 1.6, 2);
winGlow.position.set(-0.595, 2.06, -4.6);
doorGroup.add(winGlow);

// central lock wheel — split in two halves, each half rides on its own leaf
const lockDark = new THREE.MeshStandardMaterial({ color: 0x20252a, roughness: 0.42, metalness: 0.7, envMapIntensity: 0.9 });

const lockDots = [];
[
  { pivot: doorPanels[0], rot: Math.PI / 2 },
  { pivot: doorPanels[1], rot: -Math.PI / 2 }
].forEach(({ pivot, rot }) => {
  const half = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.032, 10, 26, Math.PI), lockDark);
  half.rotation.z = rot;
  half.position.set(0, 1.62, -4.755);
  pivot.add(half);

  const hub = cyl(0.1, 0.1, 0.06, 20, lockDark);
  hub.rotation.x = Math.PI / 2;
  hub.position.set(0, 1.62, -4.735);
  pivot.add(hub);

  const dotMat = new THREE.MeshBasicMaterial({ color: 0xff6a5c, toneMapped: false });
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.034, 16), dotMat);
  dot.position.set(0, 1.62, -4.699);
  pivot.add(dot);
  lockDots.push(dotMat);
});

// three cell indicators on the wall, right of the status lamp
const lockArcs = [];
for (let i = 0; i < 3; i++) {
  const arcMat = new THREE.MeshBasicMaterial({ color: 0x7a2418, toneMapped: false });
  const bar = box(0.1, 0.055, 0.025, arcMat);
  bar.position.set(0.3 + i * 0.15, 3.06, -4.885);
  bar.castShadow = false;
  doorGroup.add(bar);
  lockArcs.push(bar);
}

// status lamp above door
const lampHousing = box(0.4, 0.12, 0.16, matMetalDark);
lampHousing.position.set(0, 3.06, -4.63);
doorGroup.add(lampHousing);

const statusMat = new THREE.MeshBasicMaterial({ color: 0xff4d3d, toneMapped: false });
const statusLamp = box(0.28, 0.055, 0.06, statusMat);
statusLamp.position.set(0, 3.06, -4.542);
doorGroup.add(statusLamp);

// sign above door
const doorSign = new THREE.Mesh(
  new THREE.PlaneGeometry(2.45, 0.46),
  new THREE.MeshBasicMaterial({ map: makeSignTexture('SECTOR 04', 'AIRLOCK // ШЛЮЗ 04', '#8ff4ff', '04'), toneMapped: false })
);
doorSign.position.set(0, 3.56, -4.888);
doorGroup.add(doorSign);

// small caution decal on lintel
const caution = new THREE.Mesh(
  new THREE.PlaneGeometry(1.3, 0.16),
  new THREE.MeshBasicMaterial({ map: makeSignTexture('CAUTION', 'KEEP CLEAR', '#ffb45c'), toneMapped: false })
);
caution.position.set(0, 2.8, -4.585);
doorGroup.add(caution);

// tag the door leaves for raycasts
for (const pivot of doorPanels) {
  pivot.traverse((o) => {
    if (o.isMesh) o.userData.interact = { type: 'door' };
  });
}

/* ------------------------------------------------------------------ */
/*  Control console                                                    */
/* ------------------------------------------------------------------ */

const consoleGroup = new THREE.Group();
consoleGroup.position.set(1.82, 0, -4.46);
consoleGroup.rotation.y = -0.3;
world.add(consoleGroup);

const consoleBase = box(0.54, 1.04, 0.34, matMetalDark);
consoleBase.position.set(0, 0.52, 0);
consoleGroup.add(consoleBase);

const consoleFoot = box(0.68, 0.08, 0.48, matMetal);
consoleFoot.position.set(0, 0.04, 0);
consoleGroup.add(consoleFoot);

const consoleNeck = box(0.2, 0.24, 0.18, matMetal);
consoleNeck.position.set(0, 1.08, 0);
consoleGroup.add(consoleNeck);

const consoleHead = new THREE.Group();
consoleHead.position.set(0, 1.4, 0.05);
consoleHead.rotation.x = -0.19;
consoleGroup.add(consoleHead);

const headShell = box(0.74, 0.5, 0.12, matMetalDark);
consoleHead.add(headShell);

const headTrim = box(0.8, 0.54, 0.04, matMetal);
headTrim.position.set(0, 0, -0.05);
consoleHead.add(headTrim);

const screenCanvas = document.createElement('canvas');
screenCanvas.width = 512;
screenCanvas.height = 360;
const screenCtx = screenCanvas.getContext('2d');
const screenTex = new THREE.CanvasTexture(screenCanvas);
screenTex.colorSpace = THREE.SRGBColorSpace;
screenTex.anisotropy = 8;

const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.39), screenMat);
screen.position.set(0, 0.01, 0.066);
consoleHead.add(screen);

// console buttons
const buttonMats = [];
for (let i = 0; i < 3; i++) {
  const bMat = new THREE.MeshBasicMaterial({ color: 0x3a1714, toneMapped: false });
  const btn = cyl(0.023, 0.023, 0.02, 12, bMat);
  btn.rotation.x = Math.PI / 2;
  btn.position.set(-0.16 + i * 0.16, -0.195, 0.1);
  consoleHead.add(btn);
  buttonMats.push(bMat);
}

const consoleGlow = new THREE.PointLight(0x74f2ff, 1.8, 2.1, 2);
consoleGlow.position.set(0, 1.42, 0.35);
consoleGroup.add(consoleGlow);

const consoleSign = new THREE.Mesh(
  new THREE.PlaneGeometry(1.35, 0.27),
  new THREE.MeshBasicMaterial({ map: makeSignTexture('AIRLOCK CONTROL', 'ПАНЕЛЬ ПИТАНИЯ · 04', '#8ff4ff'), toneMapped: false })
);
consoleSign.position.set(2.5, 2.78, -4.888);
world.add(consoleSign);

consoleGroup.traverse((o) => {
  if (o.isMesh) o.userData.interact = { type: 'console' };
});

/* ------------------------------------------------------------------ */
/*  Energy cells                                                       */
/* ------------------------------------------------------------------ */

const rack = new THREE.Group();
rack.position.set(-3.0, 0, -1.1);
rack.rotation.y = 0.16;
world.add(rack);

const rackBase = box(2.95, 0.52, 0.78, matMetalDark);
rackBase.position.set(0, 0.26, 0);
rackBase.layers.enable(3);
rack.add(rackBase);

const rackTopPlate = box(3.05, 0.08, 0.86, matMetal);
rackTopPlate.position.set(0, 0.56, 0.02);
rackTopPlate.layers.enable(3);
rack.add(rackTopPlate);

const rackBack = box(2.95, 2.15, 0.14, matMetalDark);
rackBack.position.set(0, 1.48, -0.35);
rackBack.layers.enable(3);
rack.add(rackBack);

const rackBackPanel = box(2.7, 1.9, 0.04, matMetal);
rackBackPanel.position.set(0, 1.48, -0.27);
rackBackPanel.layers.enable(3);
rack.add(rackBackPanel);

for (const sx of [-1, 1]) {
  const column = box(0.16, 2.5, 0.74, matMetalDark);
  column.position.set(sx * 1.44, 1.25, -0.02);
  column.layers.enable(3);
  rack.add(column);

  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(0.035, 1.72),
    new THREE.MeshBasicMaterial({ color: 0x58d8ea, toneMapped: false, transparent: true, opacity: 0.5 })
  );
  strip.position.set(sx * 1.36, 1.5, 0.36);
  rack.add(strip);
}

const rackHeader = box(3.08, 0.32, 0.86, matMetalDark);
rackHeader.position.set(0, 2.62, 0);
rack.add(rackHeader);

const rackHeaderSign = new THREE.Mesh(
  new THREE.PlaneGeometry(2.2, 0.18),
  new THREE.MeshBasicMaterial({ map: makeSignTexture('CELL ARRAY', 'МОДУЛЬ ПИТАНИЯ · 03', '#8ff4ff'), toneMapped: false })
);
rackHeaderSign.position.set(0, 2.62, 0.435);
rack.add(rackHeaderSign);

const rackHazard = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 0.2), matHazard);
rackHazard.position.set(0, 0.18, 0.395);
rack.add(rackHazard);

const coreTex = canvasTexture(128, 512, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,20,40,0)');
  g.addColorStop(0.12, 'rgba(24,140,190,0.3)');
  g.addColorStop(0.3, 'rgba(90,220,245,0.72)');
  g.addColorStop(0.5, 'rgba(190,248,255,0.95)');
  g.addColorStop(0.7, 'rgba(90,220,245,0.72)');
  g.addColorStop(0.88, 'rgba(24,140,190,0.3)');
  g.addColorStop(1, 'rgba(0,20,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 20; i++) {
    const y = rnd() * h;
    ctx.fillStyle = `rgba(235,255,255,${0.03 + rnd() * 0.08})`;
    ctx.fillRect(0, y, w, 1 + rnd() * 3);
  }
});

const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x63cddd,
  roughness: 0.14,
  metalness: 0,
  transparent: true,
  opacity: 0.24,
  depthWrite: false,
  side: THREE.DoubleSide,
  envMapIntensity: 1.2,
  emissive: 0x0b3b48,
  emissiveIntensity: 0.9,
  clearcoat: 0.3,
  clearcoatRoughness: 0.22
});

const cellRingMat = new THREE.MeshBasicMaterial({ color: 0x3fbfd6, toneMapped: false });
const cellCapMat = new THREE.MeshStandardMaterial({ color: 0x3e464e, roughness: 0.4, metalness: 0.75, envMapIntensity: 1 });
const cellCoreMat = new THREE.MeshBasicMaterial({
  map: coreTex,
  color: 0xffffff,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false
});

const cells = [];
const cellPositions = [-0.92, 0, 0.92];

for (let i = 0; i < 3; i++) {
  const x = cellPositions[i];

  // socket
  const socket = cyl(0.27, 0.3, 0.2, 20, cellCapMat);
  socket.position.set(x, 0.68, 0.12);
  socket.layers.enable(3);
  rack.add(socket);

  const socketRing = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.012, 8, 28), cellRingMat);
  socketRing.rotation.x = Math.PI / 2;
  socketRing.position.set(x, 0.785, 0.12);
  rack.add(socketRing);

  // top clamp
  const clampTop = box(0.36, 0.14, 0.34, cellCapMat);
  clampTop.position.set(x, 2.31, 0.12);
  rack.add(clampTop);

  const clampLight = new THREE.Mesh(
    new THREE.PlaneGeometry(0.14, 0.02),
    new THREE.MeshBasicMaterial({ color: 0x8ef8ff, toneMapped: false })
  );
  clampLight.position.set(x, 2.235, 0.295);
  rack.add(clampLight);

  // wall halo behind cell
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 1.75),
    new THREE.MeshBasicMaterial({
      map: haloTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.12,
      toneMapped: false
    })
  );
  halo.position.set(x, 1.48, -0.245);
  rack.add(halo);

  // tube group (this is what gets "extracted")
  const tube = new THREE.Group();
  tube.position.set(x, 0, 0.12);
  rack.add(tube);

  const glass = cyl(0.205, 0.205, 1.36, 24, glassMat, true);
  glass.position.y = 1.48;
  glass.castShadow = false;
  glass.receiveShadow = false;
  tube.add(glass);

  const core = cyl(0.135, 0.135, 1.26, 20, cellCoreMat, true);
  core.position.y = 1.48;
  core.castShadow = false;
  core.receiveShadow = false;
  tube.add(core);

  const innerCore = cyl(0.008, 0.008, 1.12, 8, new THREE.MeshBasicMaterial({ color: 0x63c8e0 }), true);
  innerCore.position.y = 1.48;
  innerCore.castShadow = false;
  tube.add(innerCore);

  // soft volumetric energy column inside the tube
  const glowCol = cyl(0.175, 0.175, 1.22, 16, new THREE.MeshBasicMaterial({
    map: coreTex,
    color: 0x3fd4f0,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  }), true);
  glowCol.position.y = 1.48;
  glowCol.castShadow = false;
  tube.add(glowCol);

  const rings = [];
  for (const y of [1.0, 1.48, 1.96]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.009, 6, 32), cellRingMat);
    r.rotation.x = Math.PI / 2;
    r.position.y = y;
    r.castShadow = false;
    tube.add(r);
    rings.push(r);
  }

  const capTop = cyl(0.2, 0.2, 0.08, 20, cellCapMat);
  capTop.position.y = 2.18;
  tube.add(capTop);

  const capBottom = cyl(0.2, 0.2, 0.08, 20, cellCapMat);
  capBottom.position.y = 0.79;
  tube.add(capBottom);

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTex,
    color: 0x7fefff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.07,
    toneMapped: false
  }));
  sprite.scale.set(0.5, 0.5, 1);
  sprite.position.set(0, 1.48, 0);
  tube.add(sprite);

  const light = new THREE.PointLight(0x5fe6ff, 2.2, 3.8, 2);
  light.position.set(0, 1.5, 0.52);
  light.layers.set(3); // dedicated layer: keeps the glass free of hotspots
  tube.add(light);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.3, 1.6, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x49d8f2,
      transparent: true,
      opacity: 0.018,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  beam.position.y = 1.48;
  tube.add(beam);

  tube.traverse((o) => {
    if (o.isMesh) o.userData.interact = { type: 'cell', index: i };
  });

  cells.push({
    index: i,
    tube,
    glass,
    core,
    innerCore,
    glowCol,
    rings,
    sprite,
    light,
    halo,
    beam,
    collected: false,
    collectT: 0,
    baseLight: 2.2,
    phase: i * 1.7
  });
}

// rack tag (frame only, so aiming at a cell still hits the cell first)
// intentionally not tagged

/* ------------------------------------------------------------------ */
/*  Cables + energy pulses                                             */
/* ------------------------------------------------------------------ */

const cableMat = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.85, metalness: 0.15 });
const cableCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-2.5, 0.14, -0.85),
  new THREE.Vector3(-2.0, 0.055, -1.55),
  new THREE.Vector3(-1.4, 0.045, -2.6),
  new THREE.Vector3(-0.7, 0.045, -3.75),
  new THREE.Vector3(0.35, 0.045, -4.36),
  new THREE.Vector3(1.35, 0.12, -4.42),
  new THREE.Vector3(1.78, 0.9, -4.46)
]);

const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 90, 0.027, 7, false), cableMat);
cable.castShadow = true;
world.add(cable);

const cable2 = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 90, 0.012, 5, false), cableMat);
cable2.position.set(0.055, 0.015, 0.03);
world.add(cable2);

const pulseMat = new THREE.MeshBasicMaterial({ color: 0x91f6ff, toneMapped: false });
const pulses = [];
for (let i = 0; i < 3; i++) {
  const p = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), pulseMat);
  p.visible = false;
  world.add(p);
  pulses.push({ mesh: p, offset: i / 3 });
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

function makeCrate(x, z, size, rotY, label) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  world.add(g);

  const body = box(size, size, size, matCrate);
  body.position.y = size / 2;
  g.add(body);

  for (const y of [size * 0.16, size * 0.84]) {
    const strap = box(size * 1.01, 0.075, size * 1.01, matMetalDark);
    strap.position.y = y;
    g.add(strap);
  }

  const stencil = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 0.7, size * 0.7),
    new THREE.MeshBasicMaterial({ map: makeStencilTexture(label, 'CARGO · 07', '#d8b56a'), transparent: true, toneMapped: false })
  );
  stencil.position.set(0, size * 0.5, size / 2 + 0.002);
  g.add(stencil);

  const labelLight = new THREE.PointLight(0xffb45c, 0.3, 1.4, 2);
  labelLight.position.set(0, size * 0.5, size / 2 + 0.2);
  g.add(labelLight);

  return g;
}

makeCrate(3.55, -2.5, 1.0, -0.12, '07');
makeCrate(3.65, -2.55, 0.68, 0.2, '12').position.y = 1.0;
makeCrate(4.15, -1.35, 0.8, -0.35, 'A4');

// barrel
const barrel = cyl(0.33, 0.35, 0.92, 16, matMetalDark);
barrel.position.set(4.35, 0.46, -0.05);
world.add(barrel);
const barrelBand = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.02, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffa34f, toneMapped: false }));
barrelBand.rotation.x = Math.PI / 2;
barrelBand.position.set(4.35, 0.72, -0.05);
world.add(barrelBand);

// pallet
for (let i = 0; i < 4; i++) {
  const plank = box(1.1, 0.06, 0.18, matCrate);
  plank.position.set(4.25, 0.05, -3.35 + i * 0.24);
  world.add(plank);
}

// workbench along right wall
const bench = new THREE.Group();
bench.position.set(4.5, 0, 1.6);
bench.rotation.y = -Math.PI / 2;
world.add(bench);

const benchTop = box(2.1, 0.09, 0.72, matMetal);
benchTop.position.y = 0.9;
bench.add(benchTop);

for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    const leg = box(0.07, 0.86, 0.07, matMetalDark);
    leg.position.set(sx * 0.9, 0.44, sz * 0.28);
    bench.add(leg);
  }
}

const benchBox = box(0.45, 0.22, 0.3, matMetalDark);
benchBox.position.set(-0.55, 1.03, 0.02);
bench.add(benchBox);

const benchBox2 = box(0.3, 0.16, 0.22, matCrate);
benchBox2.position.set(0.45, 1.0, 0.03);
bench.add(benchBox2);

const benchLamp = new THREE.Mesh(
  new THREE.PlaneGeometry(0.42, 0.12),
  new THREE.MeshBasicMaterial({ color: 0xdff5ff, toneMapped: false })
);
benchLamp.position.set(0.05, 1.55, -0.2);
bench.add(benchLamp);

// ladder on right wall
const ladder = new THREE.Group();
ladder.position.set(4.82, 0, 0.55);
world.add(ladder);

for (const sz of [-0.28, 0.28]) {
  const rail = box(0.06, 3.3, 0.06, matMetal);
  rail.position.set(0, 1.65, sz);
  ladder.add(rail);
}
for (let i = 0; i < 8; i++) {
  const rung = box(0.05, 0.05, 0.62, matMetal);
  rung.position.set(0, 0.32 + i * 0.4, 0);
  ladder.add(rung);
}

// floor tool clutter
const toolCase = box(0.5, 0.16, 0.34, matMetalDark);
toolCase.position.set(2.75, 0.08, 0.5);
toolCase.rotation.y = 0.4;
world.add(toolCase);

const toolLid = box(0.48, 0.04, 0.32, matMetal);
toolLid.position.set(2.72, 0.18, 0.47);
toolLid.rotation.y = 0.4;
world.add(toolLid);

// wall light near start
const sconce = box(0.32, 0.1, 0.12, matMetalDark);
sconce.position.set(-4.82, 2.9, -3.6);
world.add(sconce);
const sconceLight = new THREE.PointLight(0xffa75a, 2.2, 3.5, 2);
sconceLight.position.set(-4.7, 2.85, -3.6);
scene.add(sconceLight);

// warm practical above the cargo stack (right side)
const sconceR = box(0.12, 0.32, 0.12, matMetalDark);
sconceR.position.set(4.84, 2.75, -2.5);
world.add(sconceR);
const sconceRLight = new THREE.PointLight(0xffa04a, 5.5, 5.5, 2);
sconceRLight.position.set(4.55, 2.68, -2.5);
scene.add(sconceRLight);
const sconceRGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(0.09, 0.09),
  new THREE.MeshBasicMaterial({ color: 0xffc07a, toneMapped: false })
);
sconceRGlow.position.set(4.77, 2.75, -2.5);
sconceRGlow.rotation.y = -Math.PI / 2;
world.add(sconceRGlow);

/* ------------------------------------------------------------------ */
/*  Dust                                                               */
/* ------------------------------------------------------------------ */

const dustCount = 420;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(dustCount * 3);
const dustSeed = [];
for (let i = 0; i < dustCount; i++) {
  dustPos[i * 3] = (rnd() - 0.5) * 9.2;
  dustPos[i * 3 + 1] = rnd() * 3.9 + 0.15;
  dustPos[i * 3 + 2] = (rnd() - 0.5) * 9.2;
  dustSeed.push({ speed: 0.02 + rnd() * 0.06, phase: rnd() * TAU });
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({
  color: 0x9fd9ea,
  size: 0.011,
  transparent: true,
  opacity: 0.34,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  sizeAttenuation: true
});
const dust = new THREE.Points(dustGeo, dustMat);
world.add(dust);

/* ------------------------------------------------------------------ */
/*  Post processing                                                    */
/* ------------------------------------------------------------------ */

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.58, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

if (renderer.capabilities.isWebGL2) {
  composer.renderTarget1.samples = 4;
  composer.renderTarget2.samples = 4;
}

function resize() {
  const w = stage.clientWidth || window.innerWidth;
  const h = stage.clientHeight || window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
}

/* ------------------------------------------------------------------ */
/*  State / HUD                                                        */
/* ------------------------------------------------------------------ */

const state = {
  started: SHOT_MODE,
  cells: 0,
  ready: false,
  doorOpen: false,
  doorOpening: false,
  doorT: 0,
  shake: 0,
  lock: false
};

let focused = null;
let toastTimer = 0;

function drawScreen() {
  const ctx = screenCtx;
  const w = screenCanvas.width;
  const h = screenCanvas.height;

  ctx.fillStyle = '#03080a';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(116,242,255,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  ctx.fillStyle = 'rgba(116,242,255,0.08)';
  ctx.fillRect(10, 10, w - 20, 48);

  ctx.fillStyle = '#9ff6ff';
  ctx.font = '700 24px Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('AIRLOCK CONTROL', 26, 35);

  ctx.fillStyle = 'rgba(210,240,246,0.45)';
  ctx.font = '400 12px Consolas, monospace';
  ctx.fillText('SECTOR 04 // LOCAL RELAY', 26, 78);

  const locked = state.cells < 3;
  const statusColor = state.doorOpen ? '#8ef7b0' : locked ? '#ff6a5c' : '#8ef7b0';
  const statusText = state.doorOpen ? 'OPEN' : locked ? 'LOCKED' : 'READY';

  ctx.fillStyle = 'rgba(210,240,246,0.55)';
  ctx.font = '400 13px Consolas, monospace';
  ctx.fillText('POWER CELLS', 26, 118);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#9ff6ff';
  ctx.fillText(`${state.cells}/3`, w - 26, 118);
  ctx.textAlign = 'left';

  for (let i = 0; i < 3; i++) {
    const x = 26 + i * 150;
    const on = i < state.cells;
    ctx.fillStyle = 'rgba(116,242,255,0.09)';
    ctx.fillRect(x, 136, 132, 20);
    ctx.strokeStyle = on ? 'rgba(116,242,255,0.7)' : 'rgba(116,242,255,0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, 136, 132, 20);
    if (on) {
      ctx.fillStyle = 'rgba(116,242,255,0.75)';
      ctx.fillRect(x + 3, 139, 126, 14);
    }
  }

  ctx.fillStyle = 'rgba(210,240,246,0.4)';
  ctx.font = '400 12px Consolas, monospace';
  ctx.fillText('DOOR STATUS', 26, 198);

  ctx.save();
  ctx.shadowColor = statusColor;
  ctx.shadowBlur = 16;
  ctx.fillStyle = statusColor;
  ctx.font = '700 30px Consolas, monospace';
  ctx.fillText(statusText, 26, 230);
  ctx.restore();

  ctx.fillStyle = 'rgba(210,240,246,0.45)';
  ctx.font = '400 13px Consolas, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(locked ? 'INSERT 3 CELLS' : state.doorOpen ? 'PASSAGE CLEAR' : 'PRESS [E]', w - 26, 230);
  ctx.textAlign = 'left';

  ctx.strokeStyle = 'rgba(116,242,255,0.18)';
  ctx.beginPath();
  ctx.moveTo(26, 258);
  ctx.lineTo(w - 26, 258);
  ctx.stroke();

  ctx.fillStyle = 'rgba(210,240,246,0.3)';
  ctx.font = '400 11px Consolas, monospace';
  ctx.fillText('MANUAL OVERRIDE: LOCKED', 26, 284);
  ctx.fillText('LINK: 98%  //  TEMP: 19.4°C', 26, 306);

  // scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);

  // small blinking cursor
  if (!state.doorOpen) {
    ctx.fillStyle = `rgba(116,242,255,${0.25 + 0.35 * Math.abs(Math.sin(performance.now() * 0.003))})`;
    ctx.fillRect(w - 36, 336, 10, 3);
  }

  screenTex.needsUpdate = true;
}

function updateHUD() {
  cellCountEl.textContent = String(state.cells);
  reserveCountEl.textContent = String(state.cells);

  cellPips.forEach((p, i) => p.classList.toggle('on', i < state.cells));
  missionBars.forEach((b, i) => b.classList.toggle('on', i < state.cells));

  if (state.doorOpen) {
    objectiveEl.textContent = 'Пройти в шлюз';
    reactorEl.textContent = 'ONLINE';
    reactorEl.className = 'ok';
  } else if (state.ready) {
    objectiveEl.textContent = 'Открыть шлюз с панели';
    reactorEl.textContent = 'READY';
    reactorEl.className = 'ok';
  } else {
    objectiveEl.textContent = 'Восстановить питание шлюза';
    reactorEl.textContent = 'OFFLINE';
    reactorEl.className = 'warn';
  }

  drawScreen();
}

function showToast(text, duration = 2600) {
  toastEl.textContent = text;
  toastEl.classList.add('on');
  toastTimer = duration / 1000;
}

function setPrompt(text, key = 'E', locked = false) {
  promptKey.textContent = key;
  promptText.textContent = text;
  promptEl.classList.toggle('locked', locked);
  promptEl.classList.add('on');
  reticle.classList.add('active');
}

function hidePrompt() {
  promptEl.classList.remove('on', 'locked');
  reticle.classList.remove('active');
}

function updateLockVisuals() {
  lockArcs.forEach((bar, i) => {
    const on = i < state.cells;
    bar.material.color.setHex(on ? 0x7ff4ff : 0x7a2418);
  });

  lockDots.forEach((m) => {
    m.color.setHex(state.ready ? 0x8ef7b0 : 0xff6a5c);
  });

  buttonMats.forEach((m, i) => {
    m.color.setHex(i < state.cells ? 0x7ff4ff : 0x3a1714);
  });

  if (state.ready) {
    statusMat.color.setHex(0x74ffa4);
    doorAmber.color.setHex(0x74ffa4);
    doorAmber.intensity = 3.2;
  } else {
    statusMat.color.setHex(0xff4d3d);
    doorAmber.color.setHex(0xff9a4c);
    doorAmber.intensity = 6;
  }
}

/* ------------------------------------------------------------------ */
/*  Game actions                                                       */
/* ------------------------------------------------------------------ */

let audioCtx = null;

function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const master = audioCtx.createGain();
    master.gain.value = 0.045;
    master.connect(audioCtx.destination);

    const o1 = audioCtx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = 48;
    const g1 = audioCtx.createGain();
    g1.gain.value = 0.6;
    o1.connect(g1).connect(master);
    o1.start();

    const o2 = audioCtx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = 96;
    const g2 = audioCtx.createGain();
    g2.gain.value = 0.08;
    o2.connect(g2).connect(master);
    o2.start();

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.25;
    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const ng = audioCtx.createGain();
    ng.gain.value = 0.06;
    noise.connect(filter).connect(ng).connect(master);
    noise.start();
  } catch {
    audioCtx = null;
  }
}

function blip(freq = 760, duration = 0.11, type = 'sine', level = 0.05) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(level, audioCtx.currentTime + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
  o.connect(g).connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + duration + 0.02);
}

function collectCell(index) {
  const cell = cells[index];
  if (cell.collected) return;

  cell.collected = true;
  cell.collectT = 0.0001;
  state.cells += 1;
  state.shake = Math.max(state.shake, 0.018);

  if (state.cells === 3) {
    state.ready = true;
    setTimeout(() => {
      if (!state.ready) return;
      showToast('ПИТАНИЕ ВОССТАНОВЛЕНО // ШЛЮЗ РАЗБЛОКИРОВАН', 3200);
      blip(520, 0.16, 'sine', 0.05);
      setTimeout(() => blip(880, 0.2, 'sine', 0.04), 110);
      state.shake = Math.max(state.shake, 0.03);
    }, 520);
  } else {
    showToast(`ЭНЕРГОЯЧЕЙКА ${state.cells}/3 ИЗВЛЕЧЕНА`, 2200);
    blip(640, 0.1, 'square', 0.03);
  }

  updateHUD();
  updateLockVisuals();
}

function openDoor() {
  if (state.doorOpen || state.doorOpening) return;
  if (state.cells < 3) {
    showToast('НЕДОСТАТОЧНО ПИТАНИЯ // ТРЕБУЕТСЯ 3 ЯЧЕЙКИ', 2400);
    blip(190, 0.18, 'sawtooth', 0.04);
    return;
  }

  state.doorOpening = true;
  state.shake = Math.max(state.shake, 0.05);
  showToast('РАЗБЛОКИРОВКА ШЛЮЗА…', 2200);
  blip(320, 0.3, 'sine', 0.045);
  setTimeout(() => blip(480, 0.35, 'sine', 0.04), 320);

  setTimeout(() => {
    state.doorOpen = true;
    state.doorOpening = false;
    updateHUD();
    updateLockVisuals();
    showToast('ШЛЮЗ ОТКРЫТ // ПРОХОД РАЗРЕШЁН', 3200);
  }, 2450);
}

/* ------------------------------------------------------------------ */
/*  Player                                                             */
/* ------------------------------------------------------------------ */

const player = {
  x: 2.3,
  z: 3.95,
  eye: 1.68,
  yaw: 0.24,
  pitch: -0.02,
  vx: 0,
  vz: 0,
  bob: 0,
  bobPhase: 0
};

const keys = Object.create(null);

const colliders = [
  { x0: -4.55, x1: -1.55, z0: -2.25, z1: 0.05 }, // rack
  { x0: 1.35, x1: 2.25, z0: -4.85, z1: -4.05 }, // console
  { x0: 2.9, x1: 4.8, z0: -3.2, z1: -0.9 },     // crates / barrel
  { x0: 4.2, x1: 4.9, z0: 0.75, z1: 2.45 },     // bench
  { x0: 4.55, x1: 4.95, z0: 0.2, z1: 0.9 }      // ladder
];

function canStand(x, z) {
  const r = 0.3;
  if (x < -4.62 + r || x > 4.62 - r) return false;
  if (z > 4.62 - r) return false;

  const inDoorway = Math.abs(x) < 1.0 && state.doorT > 0.82;
  if (z < -4.55 + r) {
    if (!inDoorway) return false;
    if (z < -8.35 + r) return false;
    if (Math.abs(x) > 1.05 - r) return false;
  }

  for (const c of colliders) {
    if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return false;
  }
  return true;
}

function setPose(x, y, z, yaw, pitch) {
  player.x = x;
  player.z = z;
  player.eye = y;
  player.yaw = yaw;
  player.pitch = pitch;
  player.vx = 0;
  player.vz = 0;
  player.bob = 0;
  camera.position.set(x, y, z);
  camera.rotation.set(pitch, yaw, 0);
}

function updatePlayer(dt) {
  const locked = document.pointerLockElement === canvas;

  let ix = 0;
  let iz = 0;
  if (locked && !SHOT_MODE) {
    ix = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
    iz = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
  }

  const speed = keys['ShiftLeft'] || keys['ShiftRight'] ? 3.6 : 2.25;
  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  const rx = Math.cos(player.yaw);
  const rz = -Math.sin(player.yaw);

  let dx = fx * iz + rx * ix;
  let dz = fz * iz + rz * ix;
  const len = Math.hypot(dx, dz);
  if (len > 0.001) {
    dx /= len;
    dz /= len;
  }

  const targetVx = dx * speed;
  const targetVz = dz * speed;
  const smooth = 1 - Math.exp(-11 * dt);
  player.vx = lerp(player.vx, targetVx, smooth);
  player.vz = lerp(player.vz, targetVz, smooth);

  if (Math.abs(player.vx) > 0.001 || Math.abs(player.vz) > 0.001) {
    const nx = player.x + player.vx * dt;
    const nz = player.z + player.vz * dt;
    if (canStand(nx, player.z)) player.x = nx;
    else player.vx = 0;
    if (canStand(player.x, nz)) player.z = nz;
    else player.vz = 0;
  }

  const vel = Math.hypot(player.vx, player.vz);
  const targetBob = vel > 0.15 ? 1 : 0;
  player.bob = lerp(player.bob, targetBob, 1 - Math.exp(-7 * dt));
  player.bobPhase += dt * (3.2 + vel * 1.6);

  const bobY = Math.sin(player.bobPhase * 2) * 0.018 * player.bob;
  const bobX = Math.cos(player.bobPhase) * 0.012 * player.bob;

  let sx = 0;
  let sy = 0;
  if (state.shake > 0.0005) {
    sx = (Math.random() - 0.5) * state.shake;
    sy = (Math.random() - 0.5) * state.shake;
    state.shake *= Math.exp(-7 * dt);
  } else {
    state.shake = 0;
  }

  camera.position.set(player.x + bobX + sx, player.eye + bobY + sy, player.z);
  camera.rotation.set(player.pitch + sy * 0.15, player.yaw + sx * 0.15, 0);
}

/* ------------------------------------------------------------------ */
/*  Interaction                                                        */
/* ------------------------------------------------------------------ */

const raycaster = new THREE.Raycaster();
raycaster.far = 8;
const centerNDC = new THREE.Vector2(0, 0);
const interactables = [];

function registerInteractables() {
  cells.forEach((c) => {
    c.tube.traverse((o) => {
      if (o.isMesh) interactables.push(o);
    });
  });
  consoleGroup.traverse((o) => {
    if (o.isMesh) interactables.push(o);
  });
  doorPanels.forEach((p) => {
    p.traverse((o) => {
      if (o.isMesh) interactables.push(o);
    });
  });
}
registerInteractables();

function updateFocus() {
  if (!state.started) {
    hidePrompt();
    focused = null;
    return;
  }

  raycaster.setFromCamera(centerNDC, camera);
  const hits = raycaster.intersectObjects(interactables, false);

  let found = null;
  for (const hit of hits) {
    const data = hit.object.userData.interact;
    if (!data) continue;
    if (data.type === 'cell' && cells[data.index].collected) continue;

    const maxDist = data.type === 'cell' ? 4.4 : 6.6;
    if (hit.distance > maxDist) continue;

    found = { ...data, distance: hit.distance, object: hit.object };
    break;
  }

  focused = found;

  if (!found) {
    hidePrompt();
    return;
  }

  if (found.type === 'cell') {
    const n = state.cells + 1;
    setPrompt(`Извлечь энергоячейку · ${n}/3`, 'E');
  } else if (found.type === 'console') {
    if (state.doorOpen) setPrompt('Шлюз открыт · проход разрешён', '—');
    else if (state.cells < 3) setPrompt(`Требуется питание · ${state.cells}/3`, 'E', true);
    else setPrompt('Открыть шлюз', 'E');
  } else if (found.type === 'door') {
    if (state.doorOpen) setPrompt('Шлюз открыт', '—');
    else if (state.cells < 3) setPrompt('Шлюз заблокирован · нет питания', '—', true);
    else setPrompt('Открыть шлюз с панели справа', '—');
  }
}

function interact() {
  if (!state.started || !focused) return;

  if (focused.type === 'cell') {
    collectCell(focused.index);
  } else if (focused.type === 'console') {
    if (state.doorOpen) {
      showToast('ПРОХОД СВОБОДЕН', 1600);
    } else if (state.cells < 3) {
      showToast('ПАНЕЛЬ ЗАБЛОКИРОВАНА // НУЖНЫ ВСЕ 3 ЯЧЕЙКИ', 2400);
      blip(180, 0.16, 'sawtooth', 0.035);
    } else {
      openDoor();
    }
  } else if (focused.type === 'door') {
    if (state.cells < 3) {
      showToast('ШЛЮЗ ОБЕСТОЧЕН', 1800);
      blip(170, 0.14, 'sawtooth', 0.03);
    } else if (!state.doorOpen) {
      showToast('ИСПОЛЬЗУЙТЕ ПАНЕЛЬ УПРАВЛЕНИЯ', 2000);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Per-frame animation                                                */
/* ------------------------------------------------------------------ */

const clock = new THREE.Clock();
let time = 0;
let lastFocusTime = 0;

function updateCells(dt) {
  for (const c of cells) {
    if (c.collected) {
      if (c.collectT > 0 && c.collectT < 1) {
        c.collectT = Math.min(1, c.collectT + dt * 2.6);
        const t = easeInOutCubic(c.collectT);
        c.tube.position.y = t * 0.55;
        c.tube.scale.setScalar(1 - t * 0.18);
        c.light.intensity = c.baseLight * (1 - t);
        c.sprite.material.opacity = 0.7 * (1 - t);
        c.beam.material.opacity = 0.04 * (1 - t);
        c.glowCol.material.opacity = 0.14 * (1 - t);
        c.halo.material.opacity = 0.12 * (1 - t);
        if (c.collectT >= 1) {
          c.tube.visible = false;
          c.halo.visible = false;
        }
      }
      continue;
    }

    const pulse = 0.84 + Math.sin(time * 2.1 + c.phase) * 0.12;
    c.core.material.opacity = 0.42 + Math.sin(time * 2.6 + c.phase) * 0.05;
    c.glowCol.material.opacity = 0.16 + Math.sin(time * 1.9 + c.phase) * 0.025;
    c.light.intensity = c.baseLight * pulse;
    c.sprite.material.opacity = 0.07 + Math.sin(time * 2.0 + c.phase) * 0.02;
    c.sprite.scale.setScalar(0.5 + Math.sin(time * 1.7 + c.phase) * 0.025);
    c.beam.material.opacity = 0.014 + Math.sin(time * 1.5 + c.phase) * 0.003;
    c.halo.material.opacity = 0.1 + Math.sin(time * 1.9 + c.phase) * 0.02;

    c.rings[0].rotation.z += dt * 0.7;
    c.rings[1].rotation.z -= dt * 0.45;
    c.rings[2].rotation.z += dt * 0.55;
  }
}

function updateDoor(dt) {
  if (state.doorOpening || state.doorOpen) {
    if (state.doorT < 1) {
      state.doorT = Math.min(1, state.doorT + dt / 2.25);
      const t = easeInOutCubic(state.doorT);
      doorPanels[0].position.x = -t * 1.2;
      doorPanels[1].position.x = t * 1.2;

      corridorLight.intensity = 18 * t;
      exitGlow.material.opacity = 0.85 + 0.15 * t;
      exitStrip.material.color.setRGB(0.84 * (0.4 + t * 0.6), 0.95, 1);
    }
  }
}

function updatePulses() {
  const active = state.cells > 0;
  const speed = 0.09 + state.cells * 0.025;
  pulses.forEach((p, i) => {
    p.mesh.visible = active && i < state.cells;
    if (!p.mesh.visible) return;
    const t = (time * speed + p.offset) % 1;
    const pos = cableCurve.getPoint(t);
    p.mesh.position.set(pos.x, pos.y + 0.026, pos.z);
    p.mesh.material.opacity = 1;
  });
  pulseMat.opacity = 0.7 + Math.sin(time * 5) * 0.25;
}

function updateDust(dt) {
  const arr = dustGeo.attributes.position.array;
  for (let i = 0; i < dustCount; i++) {
    const s = dustSeed[i];
    arr[i * 3 + 1] += s.speed * dt;
    arr[i * 3] += Math.sin(time * 0.35 + s.phase) * dt * 0.012;
    if (arr[i * 3 + 1] > 4.02) {
      arr[i * 3 + 1] = 0.08;
      arr[i * 3] = (rnd() - 0.5) * 9.2;
      arr[i * 3 + 2] = (rnd() - 0.5) * 9.2;
    }
  }
  dustGeo.attributes.position.needsUpdate = true;
}

function updateLights() {
  for (let i = 0; i < ceilingLights.length; i++) {
    const { light, base } = ceilingLights[i];
    light.intensity = base * (0.97 + Math.sin(time * 1.7 + i * 2.1) * 0.03);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;

  updatePlayer(dt);
  updateCells(dt);
  updateDoor(dt);
  updatePulses();
  updateDust(dt);
  updateLights();

  if (time - lastFocusTime > 0.045) {
    updateFocus();
    lastFocusTime = time;
  }

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) toastEl.classList.remove('on');
  }

  composer.render();
}

/* ------------------------------------------------------------------ */
/*  Input                                                              */
/* ------------------------------------------------------------------ */

function requestLook() {
  if (SHOT_MODE) return;
  try {
    const p = canvas.requestPointerLock?.();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    /* pointer lock unavailable (e.g. automated session) */
  }
}

function startExperience() {
  if (!state.started) {
    state.started = true;
    startOverlay.classList.add('hidden');
    hud.classList.add('visible');
    setTimeout(() => controlsEl.classList.add('hide'), 6500);
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  requestLook();
}

startBtn.addEventListener('click', startExperience);
startOverlay.addEventListener('click', (e) => {
  if (e.target === startOverlay) startExperience();
});

resumeBtn.addEventListener('click', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  requestLook();
});

canvas.addEventListener('click', () => {
  if (!state.started) return;
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (!SHOT_MODE && document.pointerLockElement !== canvas) requestLook();
});

document.addEventListener('pointerlockerror', () => {
  controlsEl.textContent = 'КЛИКНИТЕ ПО СЦЕНЕ, ЧТОБЫ ЗАХВАТИТЬ МЫШЬ · E — ВЗАИМОДЕЙСТВИЕ';
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  state.lock = locked;

  if (SHOT_MODE) return;

  if (locked) {
    pauseOverlay.classList.remove('on');
  } else if (state.started) {
    pauseOverlay.classList.add('on');
  }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.00215;
  player.pitch = clamp(player.pitch - e.movementY * 0.00215, -1.4, 1.4);
});

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;

  if (!state.started) return;

  if (e.code === 'KeyE') {
    interact();
    e.preventDefault();
  }

  if (e.code === 'KeyR' && SHOT_MODE) {
    location.reload();
  }
});

document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
});

window.addEventListener('resize', resize);

/* ------------------------------------------------------------------ */
/*  Offscreen capture (3D canvas + DOM HUD composited)                */
/* ------------------------------------------------------------------ */

async function captureComposite(width, height, withHud = true, format = 'png') {
  width = width || 1600;
  height = height || 900;

  composer.render();

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  ctx.drawImage(renderer.domElement, 0, 0, width, height);

  if (!withHud) return out.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92);

  const css = await (await fetch('./styles.css', { cache: 'no-store' })).text();
  const stageClone = document.getElementById('stage').cloneNode(true);
  stageClone.querySelector('#scene')?.remove();
  stageClone.querySelector('#start')?.remove();
  stageClone.querySelector('#pause')?.remove();

  const overlay = stageClone.innerHTML;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;position:relative;overflow:hidden;">` +
    `<style>${css}</style>${overlay}</div></foreignObject></svg>`;

  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();

  ctx.drawImage(img, 0, 0, width, height);

  return out.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92);
}

async function saveShot(name, width, height, withHud = true, format = 'png') {
  window.__shotStatus = 'working';
  try {
    const dataUrl = await captureComposite(width, height, withHud, format);
    const res = await fetch('./save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: dataUrl })
    });
    window.__shotStatus = res.ok ? 'done' : 'error:' + res.status;
  } catch (err) {
    window.__shotStatus = 'error:' + (err && err.message ? err.message : String(err));
  }
  return window.__shotStatus;
}

// три кадра в ряд — обложка для README / соцсетей
async function saveCover(name, viewNames, width = 1920) {
  window.__shotStatus = 'working';
  try {
    const cols = viewNames.length;
    const cw = Math.floor(width / cols);
    const ch = Math.round((cw * 9) / 16);
    const pad = 10;

    const out = document.createElement('canvas');
    out.width = width;
    out.height = ch + pad * 2;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#05080b';
    ctx.fillRect(0, 0, out.width, out.height);

    for (let i = 0; i < cols; i++) {
      applyView(viewNames[i]);
      const dataUrl = await captureComposite(cw, ch, false);
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      ctx.drawImage(img, i * cw, pad, cw, ch);
      if (i > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(i * cw - 1, pad, 2, ch);
      }
    }

    const res = await fetch('./save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: out.toDataURL('image/png') })
    });
    window.__shotStatus = res.ok ? 'done' : 'error:' + res.status;
  } catch (err) {
    window.__shotStatus = 'error:' + (err && err.message ? err.message : String(err));
  }
  return window.__shotStatus;
}

/* ------------------------------------------------------------------ */
/*  Views + public API (used for the portfolio stills)                 */
/* ------------------------------------------------------------------ */

const VIEWS = {
  establishing: { x: 2.05, y: 1.64, z: 3.55, yaw: 0.225, pitch: 0.005 },
  cells: { x: -0.72, y: 1.56, z: 1.62, yaw: 0.735, pitch: -0.085 },
  door: { x: 0.15, y: 1.62, z: 0.6, yaw: -0.115, pitch: 0.02 },
  open: { x: 0.36, y: 1.66, z: -0.4, yaw: 0.005, pitch: -0.015 },
  corridor: { x: 0.08, y: 1.67, z: -5.25, yaw: 0.0, pitch: 0.01 },
  detail: { x: 1.55, y: 1.55, z: -3.35, yaw: -0.44, pitch: -0.05 }
};

function applyView(name) {
  const v = VIEWS[name] || VIEWS.establishing;
  setPose(v.x, v.y, v.z, v.yaw, v.pitch);
  camera.updateMatrixWorld(true);
  updateFocus();
}

function setCellsInstant(n) {
  n = clamp(Math.round(n), 0, 3);
  cells.forEach((c, i) => {
    const collected = i < n;
    c.collected = collected;
    c.collectT = collected ? 1 : 0;
    c.tube.visible = !collected;
    c.halo.visible = !collected;
    c.light.intensity = collected ? 0 : c.baseLight;
    c.tube.position.y = 0;
    c.tube.scale.setScalar(1);
    c.glowCol.material.opacity = collected ? 0 : 0.14;
  });
  state.cells = n;
  state.ready = n >= 3;
  if (n < 3) {
    state.doorOpen = false;
    state.doorOpening = false;
    state.doorT = 0;
    doorPanels[0].position.x = 0;
    doorPanels[1].position.x = 0;
    corridorLight.intensity = 0;
    exitGlow.material.opacity = 0.5;
  }
  updateHUD();
  updateLockVisuals();
  updateFocus();
}

function setDoorInstant(open) {
  state.doorOpen = open;
  state.doorOpening = false;
  state.doorT = open ? 1 : 0;
  doorPanels[0].position.x = open ? -1.2 : 0;
  doorPanels[1].position.x = open ? 1.2 : 0;
  corridorLight.intensity = open ? 18 : 0;
  exitGlow.material.opacity = open ? 1 : 0.85;
  updateHUD();
  updateLockVisuals();
  updateFocus();
}

window.ATLAS = {
  view(name) {
    applyView(name);
  },
  pose(x, y, z, yaw, pitch) {
    setPose(x, y, z, yaw, pitch);
  },
  cells(n) {
    setCellsInstant(n);
  },
  door(open) {
    setDoorInstant(open);
  },
  state() {
    return { ...state, camera: { x: player.x, y: player.eye, z: player.z, yaw: player.yaw, pitch: player.pitch } };
  },
  hud(visible) {
    hud.classList.toggle('visible', !!visible);
  },
  prompt(text, key, locked) {
    if (!text) hidePrompt();
    else setPrompt(text, key || 'E', !!locked);
  },
  toast(text) {
    showToast(text);
  },
  start() {
    startExperience();
  },
  reset() {
    setCellsInstant(0);
    setDoorInstant(false);
    applyView('establishing');
  },
  shot(name, width, height, format) {
    return saveShot(name || 'shot.png', width, height, true, format);
  },
  cover(name, views, width) {
    return saveCover(name || 'cover.png', views, width);
  },
  shotStatus() {
    return window.__shotStatus || 'idle';
  },
  step(dt = 0.016, times = 1) {
    for (let i = 0; i < times; i++) {
      time += dt;
      updateCells(dt);
      updateDoor(dt);
      updatePulses();
      updateLights();
    }
    return true;
  },
  press(code) {
    document.dispatchEvent(new KeyboardEvent('keydown', { code }));
    document.dispatchEvent(new KeyboardEvent('keyup', { code }));
    return true;
  }
};

/* ------------------------------------------------------------------ */
/*  Init                                                               */
/* ------------------------------------------------------------------ */

resize();
applyView('establishing');
updateHUD();
updateLockVisuals();

if (SHOT_MODE) {
  state.started = true;
  hud.classList.add('visible');
  startOverlay.classList.add('hidden');
  controlsEl.classList.add('hide');
} else {
  // first paint behind the title card
  hud.classList.remove('visible');
}

animate();
