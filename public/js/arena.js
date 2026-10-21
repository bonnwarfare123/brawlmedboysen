// ARENAN – byggs helt av enkla former (lådor, cylindrar, koner).
// Inga 3D-filer behövs. Senare kan delar bytas mot riktiga modeller.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA_RX, ARENA_RZ } from "./shared.js";
import { CONFIG } from "./config.js";

const PALETTE = {
  grass: 0x7d9a55,
  dirt: 0x8a6a48,
  wood: 0x7a5434,
  woodDark: 0x5a3c24,
  woodLight: 0x9a7048,
  blue: 0x2f5fb3,
  red: 0xb8322f,
  cream: 0xe9dcc0,
  gold: 0xd9a521,
  white: 0xf2efe6,
  stone: 0x9b968c,
  tree: 0x4f7a3a,
  hill: 0x6f8f4e,
};

const materials = new Map();
function mat(color) {
  if (!materials.has(color)) {
    materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }));
  }
  return materials.get(color);
}

function mesh(geometry, color, shadows = true) {
  const m = new THREE.Mesh(geometry, mat(color));
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}

function box(w, h, d, color) {
  return mesh(new THREE.BoxGeometry(w, h, d), color);
}

// Punkt på en oval med radierna rx/rz. t = vinkel (0 = framsidan, +Z)
function ellipsePoint(t, rx, rz) {
  return new THREE.Vector3(Math.sin(t) * rx, 0, Math.cos(t) * rz);
}

// Enkel slumptalsgenerator med fast frö, så alla spelare får samma träd
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Mönstrad markyta ritad i koden (prickar och fläckar), så marken inte är helt slät
function groundTexture(base, spots, size, repeat) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const rand = seededRandom(7);
  for (const { color, count, min, max, alpha } of spots) {
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const r = min + rand() * (max - min);
      const x = rand() * size;
      const y = rand() * size;
      ctx.globalAlpha = alpha * (0.5 + rand() * 0.5);
      // rita även på andra sidan kanten, så mönstret går ihop när det upprepas
      for (const [dx, dy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
        ctx.beginPath();
        ctx.ellipse(x + dx, y + dy, r, r * (0.6 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  return texture;
}

// Returnerar { group, colliders, update, cheer }.
//   colliders = rektanglar spelare inte kan gå igenom
//   update(dt) = animerar publiken, cheer(styrka) = publiken jublar
export function buildArena() {
  const group = new THREE.Group();
  const colliders = [];
  const crowds = []; // publiken på läktarna

  const FX = ARENA_RX + 0.7; // staketets radier
  const FZ = ARENA_RZ + 0.7;
  const center = new THREE.Vector3(0, 0, 0);

  // ---------- Mark ----------
  const grassMat = new THREE.MeshStandardMaterial({
    roughness: 1,
    map: groundTexture("#7d9a55", [
      { color: "#6b8a46", count: 260, min: 3, max: 10, alpha: 0.6 },
      { color: "#93ad66", count: 200, min: 2, max: 7, alpha: 0.5 },
      { color: "#5f7d3d", count: 80, min: 6, max: 16, alpha: 0.35 },
    ], 256, 70),
  });
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), grassMat);
  grass.receiveShadow = true;
  grass.rotation.x = -Math.PI / 2;
  group.add(grass);

  const dirtMat = new THREE.MeshStandardMaterial({
    roughness: 1,
    map: groundTexture("#8a6a48", [
      { color: "#7a5c3d", count: 220, min: 4, max: 14, alpha: 0.55 },
      { color: "#9c7b56", count: 180, min: 3, max: 10, alpha: 0.5 },
      { color: "#6a4f34", count: 120, min: 1, max: 3, alpha: 0.8 }, // småsten
      { color: "#b09070", count: 90, min: 1, max: 2.5, alpha: 0.7 },
    ], 256, 9),
  });
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(1, 64), dirtMat);
  dirt.receiveShadow = true;
  dirt.rotation.x = -Math.PI / 2;
  dirt.scale.set(FX + 0.4, FZ + 0.4, 1);
  dirt.position.y = 0.01;
  group.add(dirt);

  // ---------- Staket runt arenan ----------
  const POSTS = 56;
  const points = [];
  for (let i = 0; i < POSTS; i++) {
    points.push(ellipsePoint((i / POSTS) * Math.PI * 2, FX, FZ));
  }

  const dummy = new THREE.Object3D();

  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 1.4, 0.26), mat(PALETTE.woodDark), POSTS);
  points.forEach((p, i) => {
    dummy.position.set(p.x, 0.7, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    postMesh.setMatrixAt(i, dummy.matrix);
  });
  postMesh.castShadow = true;
  postMesh.receiveShadow = true;
  group.add(postMesh);

  const railMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.14, 0.1), mat(PALETTE.wood), POSTS * 2);
  points.forEach((a, i) => {
    const b = points[(i + 1) % POSTS];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    [0.55, 1.05].forEach((y, k) => {
      dummy.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
      dummy.rotation.set(0, -Math.atan2(dz, dx), 0);
      dummy.scale.set(length, 1, 1);
      dummy.updateMatrix();
      railMesh.setMatrixAt(i * 2 + k, dummy.matrix);
    });
  });
  dummy.scale.set(1, 1, 1);
  railMesh.castShadow = true;
  railMesh.receiveShadow = true;
  group.add(railMesh);

  // Sköldar på staketet, vända mot mitten
  points.forEach((p, i) => {
    if (i % 4 !== 2) return;
    const isRed = (i / 4) % 2 < 1;
    const shield = makeShield(isRed ? PALETTE.red : PALETTE.blue, isRed);
    const inward = p.clone().multiplyScalar(0.985);
    shield.position.set(inward.x, 0.8, inward.z);
    shield.lookAt(center.x, 0.8, center.z);
    group.add(shield);
  });

  // Vimplar: snören med trekantiga flaggor mellan var fjärde stolpe (en enda ritning för alla)
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute("position", new THREE.Float32BufferAttribute([-0.11, 0, 0, 0.11, 0, 0, 0, -0.26, 0], 3));
  flagGeo.computeVertexNormals();
  const flagColors = [PALETTE.red, PALETTE.cream, PALETTE.blue, PALETTE.gold];
  const flagSpots = [];
  const ropeSpots = [];
  for (let i = 0; i < POSTS; i += 4) {
    const a = points[i];
    const b = points[(i + 4) % POSTS];
    const n = 9;
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      const x = a.x + (b.x - a.x) * f;
      const z = a.z + (b.z - a.z) * f;
      const y = 1.75 - Math.sin(f * Math.PI) * 0.35; // snöret hänger ner i mitten
      if (k < n) {
        const f2 = (k + 1) / n;
        ropeSpots.push({
          from: new THREE.Vector3(x, y, z),
          to: new THREE.Vector3(a.x + (b.x - a.x) * f2, 1.75 - Math.sin(f2 * Math.PI) * 0.35, a.z + (b.z - a.z) * f2),
        });
      }
      if (k > 0 && k < n) flagSpots.push({ pos: new THREE.Vector3(x, y, z), angle: Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2 });
    }
  }
  const flagMesh = new THREE.InstancedMesh(flagGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), flagSpots.length);
  flagSpots.forEach((f, i) => {
    dummy.position.copy(f.pos);
    dummy.rotation.set(0, f.angle, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    flagMesh.setMatrixAt(i, dummy.matrix);
    flagMesh.setColorAt(i, new THREE.Color(flagColors[i % flagColors.length]));
  });
  flagMesh.castShadow = true;
  group.add(flagMesh);
  const ropeMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.015, 0.015, 1), mat(PALETTE.woodDark), ropeSpots.length);
  ropeSpots.forEach((r, i) => {
    dummy.position.copy(r.from).add(r.to).multiplyScalar(0.5);
    dummy.lookAt(r.to);
    dummy.scale.set(1, 1, r.from.distanceTo(r.to));
    dummy.updateMatrix();
    ropeMesh.setMatrixAt(i, dummy.matrix);
  });
  group.add(ropeMesh);
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(1, 1, 1);
  // Högre stolpar där vimpelsnörena sitter fast
  for (let i = 0; i < POSTS; i += 4) {
    const pole = box(0.12, 1.9, 0.12, PALETTE.woodDark);
    pole.position.set(points[i].x, 0.95, points[i].z);
    group.add(pole);
  }

  // Facklor (bara dekor, inget riktigt ljus – det kostar prestanda)
  [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75].forEach((t) => {
    const p = ellipsePoint(t, FX + 0.5, FZ + 0.5);
    const pole = box(0.14, 1.9, 0.14, PALETTE.woodDark);
    pole.position.set(p.x, 0.95, p.z);
    const basket = mesh(new THREE.ConeGeometry(0.22, 0.3, 6), PALETTE.woodDark);
    basket.rotation.x = Math.PI;
    basket.position.set(p.x, 2.0, p.z);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.14, 0.35, 6),
      new THREE.MeshBasicMaterial({ color: 0xffa23a })
    );
    flame.position.set(p.x, 2.3, p.z);
    group.add(pole, basket, flame);
  });

  // ---------- Läktare på baksidan ----------
  const standAngles = [-0.95, -0.5, 0.5, 0.95]; // relativt baksidan (t = PI)
  standAngles.forEach((offset) => {
    const leftSide = offset < 0;
    const stand = makeStand(leftSide ? PALETTE.blue : PALETTE.red, crowds);
    const p = ellipsePoint(Math.PI + offset, FX + 2.6, FZ + 2.6);
    stand.position.copy(p);
    stand.lookAt(center);
    group.add(stand);
  });

  // Kungliga logen i mitten av baksidan
  const royal = makeRoyalBox(crowds);
  const rp = ellipsePoint(Math.PI, FX + 3, FZ + 3);
  royal.position.copy(rp);
  royal.lookAt(center);
  group.add(royal);

  // ---------- Torn i hörnen ----------
  [
    { t: Math.PI + 1.45, color: PALETTE.blue, emblemRed: false },
    { t: Math.PI - 1.45, color: PALETTE.red, emblemRed: true },
  ].forEach(({ t, color, emblemRed }) => {
    const tower = makeTower(color, emblemRed);
    const p = ellipsePoint(t, FX + 2.2, FZ + 2.2);
    tower.position.copy(p);
    tower.lookAt(center);
    group.add(tower);
  });

  // ---------- Rekvisita utanför staketet ----------
  const props = [
    { t: 0.15, kind: "hay" }, { t: -0.2, kind: "barrels" }, { t: 0.45, kind: "rack" },
    { t: -0.55, kind: "hay" }, { t: 2.05, kind: "barrels" }, { t: -2.1, kind: "hay" },
    { t: 1.1, kind: "rack" }, { t: -1.15, kind: "barrels" },
  ];
  for (const { t, kind } of props) {
    const p = ellipsePoint(t, FX + 1.6, FZ + 1.6);
    const prop = kind === "hay" ? makeHayBales() : kind === "barrels" ? makeBarrels() : makeWeaponRack();
    prop.position.copy(p);
    prop.lookAt(center);
    group.add(prop);
  }

  // ---------- Himmel, moln och en borg i fjärran ----------
  group.add(makeSky());
  const cloudRand = seededRandom(99);
  for (let i = 0; i < 12; i++) {
    const t = cloudRand() * Math.PI * 2;
    const r = 120 + cloudRand() * 80;
    const cloud = makeCloud(cloudRand);
    cloud.position.set(Math.sin(t) * r, 45 + cloudRand() * 25, Math.cos(t) * r);
    group.add(cloud);
  }
  const castle = makeCastle();
  castle.position.set(-25, 2, -125);
  castle.rotation.y = 0.3;
  group.add(castle);

  // ---------- Mittbarriär (valfri) ----------
  if (CONFIG.centerBarrier) {
    const length = 10;
    const barrier = new THREE.Group();
    for (let x = -length / 2; x <= length / 2 + 0.01; x += 1.25) {
      const post = box(0.18, 1.1, 0.18, PALETTE.woodDark);
      post.position.set(x, 0.55, 0);
      barrier.add(post);
    }
    const rail = box(length, 0.14, 0.1, PALETTE.wood);
    rail.position.y = 0.95;
    const rail2 = rail.clone();
    rail2.position.y = 0.5;
    barrier.add(rail, rail2);
    group.add(barrier);
    colliders.push({ minX: -length / 2 - 0.1, maxX: length / 2 + 0.1, minZ: -0.1, maxZ: 0.1 });
  }

  // ---------- Omgivning: kullar och träd (ersätts senare av en målad kuliss) ----------
  const rand = seededRandom(42);
  for (let i = 0; i < 14; i++) {
    const t = (i / 14) * Math.PI * 2 + rand() * 0.3;
    const r = 90 + rand() * 40;
    const hill = mesh(new THREE.IcosahedronGeometry(1, 1), PALETTE.hill, false);
    hill.scale.set(25 + rand() * 25, 8 + rand() * 10, 25 + rand() * 25);
    hill.position.set(Math.sin(t) * r, -2, Math.cos(t) * r);
    group.add(hill);
  }

  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.25, 1.4, 6);
  const crownGeo = new THREE.ConeGeometry(1.3, 3.2, 7);
  for (let i = 0; i < 40; i++) {
    const t = rand() * Math.PI * 2;
    const r = 26 + rand() * 30;
    const s = 0.8 + rand() * 0.8;
    const tree = new THREE.Group();
    const trunk = mesh(trunkGeo, PALETTE.woodDark);
    trunk.position.y = 0.7;
    const crown = mesh(crownGeo, PALETTE.tree);
    crown.position.y = 2.8;
    tree.add(trunk, crown);
    tree.scale.setScalar(s);
    tree.position.set(Math.sin(t) * r, 0, Math.cos(t) * r);
    group.add(tree);
  }

  // Slå ihop alla stillastående bitar till några få stora (mycket bättre FPS)
  group.add(mergeStatic(group));

  // Publiken: gungar lite hela tiden och hoppar upp och jublar vid häftiga händelser
  let excitement = 0;
  let time = 0;
  const update = (dt) => {
    time += dt;
    excitement = Math.max(0, excitement - dt * 0.4);
    for (const crowd of crowds) crowd.update(time, excitement);
  };
  const cheer = (strength = 1) => {
    excitement = Math.min(1.5, excitement + strength);
  };

  return { group, colliders, update, cheer };
}

// ---------- Publik ----------
// Enkla figurer (kropp + huvud) i en enda ritning per läktare. Varje person får egen färg och takt.
const CROWD_COLORS = [0x8a3b2e, 0x2e5a8a, 0x6b8a2e, 0x8a6b2e, 0x5a2e8a, 0x2e8a7a, 0x9a9a8a, 0x7a4a2a, 0xb07a3a, 0x4a4a5a];
const SKIN_COLORS = [0xf0c8a0, 0xd9a878, 0xb98058, 0x8a5a3a];

function makeCrowd(spots, seed) {
  const rand = seededRandom(seed);
  const bodyGeo = new THREE.CapsuleGeometry(0.15, 0.32, 3, 8);
  const headGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const bodies = new THREE.InstancedMesh(bodyGeo, material, spots.length);
  const heads = new THREE.InstancedMesh(headGeo, material.clone(), spots.length);
  const people = spots.map((pos, i) => {
    bodies.setColorAt(i, new THREE.Color(CROWD_COLORS[Math.floor(rand() * CROWD_COLORS.length)]));
    heads.setColorAt(i, new THREE.Color(SKIN_COLORS[Math.floor(rand() * SKIN_COLORS.length)]));
    return { pos, phase: rand() * Math.PI * 2, speed: 0.8 + rand() * 1.2, jump: 0.6 + rand() * 0.6 };
  });
  bodies.castShadow = true;
  const d = new THREE.Object3D();
  const group = new THREE.Group();
  group.add(bodies, heads);
  group.update = (time, excitement) => {
    people.forEach((p, i) => {
      const idle = Math.sin(time * p.speed + p.phase) * 0.015;
      const hop = excitement > 0.05 ? Math.max(0, Math.sin(time * 9 * p.jump + p.phase)) * 0.22 * Math.min(1, excitement) : 0;
      const sway = Math.sin(time * p.speed * 0.7 + p.phase) * 0.06;
      d.position.set(p.pos.x, p.pos.y + 0.31 + idle + hop, p.pos.z);
      d.rotation.set(0, 0, sway);
      d.updateMatrix();
      bodies.setMatrixAt(i, d.matrix);
      d.position.y += 0.37;
      d.updateMatrix();
      heads.setMatrixAt(i, d.matrix);
    });
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  };
  group.update(0, 0);
  return group;
}

// ---------- Rekvisita ----------

function makeHayBales() {
  const g = new THREE.Group();
  const hay = 0xd9b45a;
  const geo = new THREE.CylinderGeometry(0.45, 0.45, 0.9, 12);
  [[-0.5, 0.45, 0], [0.5, 0.45, 0.1], [0, 1.3, 0.05]].forEach(([x, y, z], i) => {
    const bale = mesh(geo, hay);
    bale.rotation.z = Math.PI / 2;
    bale.rotation.y = i * 0.3;
    bale.position.set(x, y - (i === 2 ? 0.05 : 0), z);
    g.add(bale);
  });
  return g;
}

function makeBarrels() {
  const g = new THREE.Group();
  const body = new THREE.CylinderGeometry(0.32, 0.32, 0.8, 12);
  const band = new THREE.CylinderGeometry(0.335, 0.335, 0.05, 12);
  [[-0.4, 0], [0.35, 0.15], [0, -0.5]].forEach(([x, z]) => {
    const barrel = mesh(body, PALETTE.wood);
    barrel.position.set(x, 0.4, z);
    g.add(barrel);
    [0.15, 0.65].forEach((y) => {
      const ring = mesh(band, PALETTE.woodDark);
      ring.position.set(x, y, z);
      g.add(ring);
    });
  });
  return g;
}

function makeWeaponRack() {
  const g = new THREE.Group();
  [-0.8, 0.8].forEach((x) => {
    const leg = box(0.1, 1.4, 0.1, PALETTE.woodDark);
    leg.position.set(x, 0.7, 0);
    g.add(leg);
  });
  const bar = box(1.8, 0.08, 0.08, PALETTE.wood);
  bar.position.y = 1.2;
  g.add(bar);
  const low = box(1.8, 0.08, 0.3, PALETTE.wood);
  low.position.set(0, 0.25, 0.15);
  g.add(low);
  // Spjut och svärd lutade mot ställningen
  for (let i = 0; i < 5; i++) {
    const x = -0.6 + i * 0.3;
    const spear = i % 2 === 0;
    const shaft = box(0.035, spear ? 2.0 : 1.0, 0.035, spear ? PALETTE.wood : 0xc9ced4);
    shaft.position.set(x, spear ? 1.0 : 0.75, 0.18);
    shaft.rotation.x = -0.12;
    g.add(shaft);
    if (spear) {
      const tip = mesh(new THREE.ConeGeometry(0.05, 0.2, 4), 0xc9ced4);
      tip.position.set(x, 2.08, 0.06);
      tip.rotation.x = -0.12;
      g.add(tip);
    }
  }
  return g;
}

// Himmel: stor kupol med färgövergång (djupblå uppåt, ljus vid horisonten)
function makeSky() {
  const geo = new THREE.SphereGeometry(300, 24, 12);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x4f86c6) },
      horizon: { value: new THREE.Color(0xc4dcef) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vPos;
      void main() {
        float h = clamp(normalize(vPos).y, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, top, pow(h, 0.6)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(geo, material);
  sky.userData.noMerge = true;
  sky.renderOrder = -1;
  return sky;
}

function makeCloud(rand) {
  const g = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, fog: false });
  const parts = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < parts; i++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), material);
    puff.scale.set(6 + rand() * 6, 3 + rand() * 2, 5 + rand() * 4);
    puff.position.set(i * 7 - parts * 3.5 + rand() * 3, rand() * 2, rand() * 4);
    g.add(puff);
  }
  g.userData.noMerge = true;
  return g;
}

// En borg på en kulle långt bort (blir dimmig av avståndet)
function makeCastle() {
  const g = new THREE.Group();
  const stone = PALETTE.stone;
  const hill = mesh(new THREE.IcosahedronGeometry(1, 1), PALETTE.hill, false);
  hill.scale.set(40, 10, 30);
  hill.position.y = -6;
  g.add(hill);
  const wall = box(30, 8, 4, stone);
  wall.position.set(0, 6, 8);
  g.add(wall);
  const keep = box(12, 16, 12, stone);
  keep.position.set(0, 10, -2);
  g.add(keep);
  [[-15, 8], [15, 8], [-8, -8], [8, -8]].forEach(([x, z]) => {
    const tower = mesh(new THREE.CylinderGeometry(2.5, 2.8, 14, 10), stone);
    tower.position.set(x, 9, z);
    g.add(tower);
    const roof = mesh(new THREE.ConeGeometry(3.2, 5, 10), PALETTE.red);
    roof.position.set(x, 18.5, z);
    g.add(roof);
  });
  const keepRoof = mesh(new THREE.ConeGeometry(9, 6, 4), PALETTE.blue);
  keepRoof.rotation.y = Math.PI / 4;
  keepRoof.position.set(0, 21, -2);
  g.add(keepRoof);
  return g;
}

// Grafikkortet ritar snabbare EN stor sak än hundratals små.
// Här slås alla bitar med samma material ihop till en enda.
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const toRemove = [];

  root.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh) return;
    for (let o = obj; o; o = o.parent) if (o.userData.noMerge) return; // himmel och moln hålls separata
    const key = obj.material.uuid + (obj.castShadow ? ":s" : ":n");
    const geometry = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    geometry.applyMatrix4(obj.matrixWorld);
    if (!buckets.has(key)) buckets.set(key, { material: obj.material, castShadow: obj.castShadow, geometries: [] });
    buckets.get(key).geometries.push(geometry);
    toRemove.push(obj);
  });

  toRemove.forEach((obj) => obj.removeFromParent());

  const merged = new THREE.Group();
  for (const bucket of buckets.values()) {
    const geometry = mergeGeometries(bucket.geometries);
    bucket.geometries.forEach((g) => g.dispose());
    const m = new THREE.Mesh(geometry, bucket.material);
    m.castShadow = bucket.castShadow;
    m.receiveShadow = true;
    merged.add(m);
  }
  return merged;
}

// En sköld med märke. Framsidan pekar mot +Z (använd lookAt för att vända den).
function makeShield(color, withCross) {
  const shield = new THREE.Group();
  const disc = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 12), color);
  disc.rotation.x = Math.PI / 2;
  shield.add(disc);
  if (withCross) {
    const v = box(0.08, 0.38, 0.02, PALETTE.white);
    const h = box(0.3, 0.08, 0.02, PALETTE.white);
    v.position.z = h.position.z = 0.035;
    shield.add(v, h);
  } else {
    const emblem = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 8), PALETTE.gold);
    emblem.rotation.x = Math.PI / 2;
    emblem.position.z = 0.035;
    shield.add(emblem);
  }
  return shield;
}

// Randigt tak av omväxlande färgade remsor
function makeStripedRoof(width, depth, color, strips = 8) {
  const roof = new THREE.Group();
  const stripWidth = width / strips;
  for (let i = 0; i < strips; i++) {
    const strip = box(stripWidth, 0.08, depth, i % 2 === 0 ? color : PALETTE.cream);
    strip.position.x = -width / 2 + stripWidth * (i + 0.5);
    roof.add(strip);
  }
  return roof;
}

// En läktare: trappsteg med bänkar och randigt tak. Framsidan mot +Z.
function makeStand(color, crowds) {
  const stand = new THREE.Group();
  const width = 5;
  const spots = [];
  const rand = seededRandom(Math.floor(color % 1000) + crowds.length * 17);
  for (let i = 0; i < 3; i++) {
    const step = box(width, 0.5 * (i + 1), 0.9, i % 2 ? PALETTE.wood : PALETTE.woodLight);
    step.position.set(0, 0.25 * (i + 1), -i * 0.9);
    stand.add(step);
    // Publik på varje trappsteg (några platser står tomma)
    for (let x = -width / 2 + 0.4; x <= width / 2 - 0.3; x += 0.55) {
      if (rand() < 0.75) spots.push(new THREE.Vector3(x + (rand() - 0.5) * 0.15, 0.5 * (i + 1), -i * 0.9 - 0.05));
    }
  }
  const crowd = makeCrowd(spots, crowds.length + 3);
  stand.add(crowd);
  crowds.push(crowd);
  // Stolpar
  [-width / 2 + 0.1, width / 2 - 0.1].forEach((x) => {
    [0.4, -2.2].forEach((z) => {
      const post = box(0.16, 3.4, 0.16, PALETTE.woodDark);
      post.position.set(x, 1.7, z);
      stand.add(post);
    });
  });
  const roof = makeStripedRoof(width + 0.4, 3.2, color);
  roof.position.set(0, 3.45, -0.9);
  roof.rotation.x = 0.12;
  stand.add(roof);
  // Flagga
  const flag = makeFlag(color);
  flag.position.set(width / 2 - 0.1, 3.4, -2.2);
  stand.add(flag);
  return stand;
}

function makeRoyalBox(crowds) {
  const royal = new THREE.Group();
  // Kungen och drottningen i logen
  const crowd = makeCrowd([new THREE.Vector3(-0.6, 2, 0.2), new THREE.Vector3(0.6, 2, 0.2)], 77);
  royal.add(crowd);
  crowds.push(crowd);
  [-0.6, 0.6].forEach((x) => {
    const crown = mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.09, 6, 1, true), PALETTE.gold);
    crown.position.set(x, 2.8, 0.2);
    crown.userData.noMerge = true;
    royal.add(crown);
  });
  const base = box(4, 2, 3, PALETTE.wood);
  base.position.set(0, 1, -0.5);
  royal.add(base);
  const rail = box(4, 0.6, 0.15, PALETTE.woodDark);
  rail.position.set(0, 2.3, 0.95);
  royal.add(rail);
  [-1.9, 1.9].forEach((x) => {
    [0.95, -1.9].forEach((z) => {
      const post = box(0.18, 3, 0.18, PALETTE.woodDark);
      post.position.set(x, 3.5, z);
      royal.add(post);
    });
  });
  // Tältliknande tak (fyrsidig kon)
  const roof = mesh(new THREE.ConeGeometry(3.2, 1.8, 4), PALETTE.blue);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0, 5.9, -0.5);
  royal.add(roof);
  const flag = makeFlag(PALETTE.blue);
  flag.position.set(0, 6.8, -0.5);
  royal.add(flag);
  // Hängande fanor på framsidan
  [-1.2, -0.4, 0.4, 1.2].forEach((x, i) => {
    const banner = makeBanner(i % 2 ? PALETTE.blue : PALETTE.red, i % 2 === 0);
    banner.position.set(x, 1.4, 1.02);
    royal.add(banner);
  });
  return royal;
}

function makeTower(color, emblemRed) {
  const tower = new THREE.Group();
  const body = box(2.2, 4.6, 2.2, PALETTE.wood);
  body.position.y = 2.3;
  tower.add(body);
  const top = box(2.6, 0.5, 2.6, PALETTE.woodDark);
  top.position.y = 4.85;
  tower.add(top);
  const roof = mesh(new THREE.ConeGeometry(2.0, 1.8, 4), color);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 6.0;
  tower.add(roof);
  const flag = makeFlag(color);
  flag.position.y = 6.6;
  tower.add(flag);
  const banner = makeBanner(color, emblemRed);
  banner.position.set(0, 3.0, 1.12);
  banner.scale.setScalar(1.4);
  tower.add(banner);
  return tower;
}

// Flaggstång med flagga. Origo = stångens fot.
function makeFlag(color) {
  const flag = new THREE.Group();
  const pole = box(0.07, 1.6, 0.07, PALETTE.woodDark);
  pole.position.y = 0.8;
  const cloth = box(0.8, 0.45, 0.02, color);
  cloth.position.set(0.43, 1.35, 0);
  flag.add(pole, cloth);
  return flag;
}

// Hängande fana med märke, framsidan mot +Z
function makeBanner(color, withCross) {
  const banner = new THREE.Group();
  const cloth = box(0.6, 1.1, 0.03, color);
  banner.add(cloth);
  if (withCross) {
    const v = box(0.1, 0.5, 0.02, PALETTE.white);
    const h = box(0.36, 0.1, 0.02, PALETTE.white);
    v.position.z = h.position.z = 0.025;
    banner.add(v, h);
  } else {
    const emblem = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 8), PALETTE.gold);
    emblem.rotation.x = Math.PI / 2;
    emblem.position.z = 0.025;
    banner.add(emblem);
  }
  return banner;
}
