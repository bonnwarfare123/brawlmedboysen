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

// Returnerar { group, colliders }. colliders = rektanglar spelare inte kan gå igenom.
export function buildArena() {
  const group = new THREE.Group();
  const colliders = [];

  const FX = ARENA_RX + 0.7; // staketets radier
  const FZ = ARENA_RZ + 0.7;
  const center = new THREE.Vector3(0, 0, 0);

  // ---------- Mark ----------
  const grass = mesh(new THREE.PlaneGeometry(400, 400), PALETTE.grass, false);
  grass.rotation.x = -Math.PI / 2;
  group.add(grass);

  const dirt = mesh(new THREE.CircleGeometry(1, 64), PALETTE.dirt, false);
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
    const stand = makeStand(leftSide ? PALETTE.blue : PALETTE.red);
    const p = ellipsePoint(Math.PI + offset, FX + 2.6, FZ + 2.6);
    stand.position.copy(p);
    stand.lookAt(center);
    group.add(stand);
  });

  // Kungliga logen i mitten av baksidan
  const royal = makeRoyalBox();
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

  return { group, colliders };
}

// Grafikkortet ritar snabbare EN stor sak än hundratals små.
// Här slås alla bitar med samma material ihop till en enda.
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const toRemove = [];

  root.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh) return;
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
function makeStand(color) {
  const stand = new THREE.Group();
  const width = 5;
  for (let i = 0; i < 3; i++) {
    const step = box(width, 0.5 * (i + 1), 0.9, i % 2 ? PALETTE.wood : PALETTE.woodLight);
    step.position.set(0, 0.25 * (i + 1), -i * 0.9);
    stand.add(step);
  }
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

function makeRoyalBox() {
  const royal = new THREE.Group();
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
