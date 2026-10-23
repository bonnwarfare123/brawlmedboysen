// ARENAN – byggs helt av enkla former (lådor, cylindrar, koner).
// Inga 3D-filer behövs. Senare kan delar bytas mot riktiga modeller.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA_RX, ARENA_RZ } from "./shared.js";
import { CONFIG } from "./config.js";
import { Crowd, makeRoyals, mergeFigure } from "./crowd.js";
import {
  plankTexture, stripeTexture, rakedSandTexture, glowTexture, heraldryTexture, daggedTexture, linenTexture, strawTexture,
  sandGrainTexture, podiumTexture,
} from "./textures.js";

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
let wavingFlags = []; // flaggdukar som fladdrar i vinden (fylls i när arenan byggs)
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

// Returnerar ett objekt med:
//   group, colliders (rektanglar spelare inte kan gå igenom),
//   update(dt, fokus) = animerar allt, cheer(styrka) = publiken jublar,
//   throwAt(sort, mål) = publiken kastar tomater/rosor, royalReact(upp), heraldBlow(),
//   quintain (träningsdockan), setQuality(låg), clearThrown()
export function buildArena() {
  const group = new THREE.Group();
  const colliders = [];
  const crowdSpots = []; // alla platser på läktarna (fylls i när läktarna byggs)
  wavingFlags = [];

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

  // Krattad sand med halm, småsten och gamla blodfläckar
  const grain = sandGrainTexture();
  grain.repeat.set(26, 26);
  const dirtMat = new THREE.MeshStandardMaterial({ roughness: 1, map: rakedSandTexture(), bumpMap: grain, bumpScale: 2.2 });
  dirtMat.map.repeat.set(4, 4);
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(1, 64), dirtMat);
  dirt.receiveShadow = true;
  dirt.rotation.x = -Math.PI / 2;
  dirt.scale.set(FX + 0.4, FZ + 0.4, 1);
  dirt.position.y = 0.01;
  group.add(dirt);
  // Fuktig, mörkare sand längs barriären och en upptrampad fläck i mitten
  group.add(radialPatch(FX + 0.4, FZ + 0.4, 0.84, 1.0, 0x4a3420, 0, 0.55, 0.012));
  group.add(radialPatch(FX * 0.55, FZ * 0.55, 0, 1.0, 0x5e4430, 0.32, 0, 0.013));
  group.add(sandScatter(FX, FZ));

  // ---------- Tornerbarriär runt arenan ----------
  // Plankväggar klädda med randigt tyg, en överliggare, en tandad tygkant och sköldar på stolparna
  const POSTS = 56;
  const points = [];
  for (let i = 0; i < POSTS; i++) {
    points.push(ellipsePoint((i / POSTS) * Math.PI * 2, FX, FZ));
  }

  const dummy = new THREE.Object3D();
  const BARRIER_COLORS = [PALETTE.red, PALETTE.blue, PALETTE.gold, 0x3f8a3a];
  const panelMeshes = BARRIER_COLORS.map((color) => {
    const m = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 0.07),
      new THREE.MeshStandardMaterial({ map: stripeTexture(color, PALETTE.cream, 6), roughness: 0.92 }),
      Math.ceil(POSTS / BARRIER_COLORS.length),
    );
    m.count = 0;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  });
  const railMat = new THREE.MeshStandardMaterial({ map: plankTexture(), color: PALETTE.wood, roughness: 0.85 });
  const railMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.1, 0.18), railMat, POSTS);
  const valance = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 0.2),
    new THREE.MeshStandardMaterial({ alphaMap: daggedTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, map: linenTexture() }),
    POSTS,
  );
  points.forEach((a, i) => {
    const b = points[(i + 1) % POSTS];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const angle = -Math.atan2(dz, dx);
    // Tygklädd plankvägg
    const pm = panelMeshes[i % BARRIER_COLORS.length];
    dummy.position.set(mx, 0.56, mz);
    dummy.rotation.set(0, angle, 0);
    dummy.scale.set(length + 0.02, 1.02, 1);
    dummy.updateMatrix();
    pm.setMatrixAt(pm.count++, dummy.matrix);
    // Överliggare
    dummy.position.set(mx, 1.12, mz);
    dummy.scale.set(length + 0.05, 1, 1);
    dummy.updateMatrix();
    railMesh.setMatrixAt(i, dummy.matrix);
    // Tandad tygkant på insidan
    const inv = 1 / Math.hypot(mx, mz);
    dummy.position.set(mx - mx * inv * 0.06, 0.98, mz - mz * inv * 0.06);
    dummy.scale.set(length, 1, 1);
    dummy.updateMatrix();
    valance.setMatrixAt(i, dummy.matrix);
    valance.setColorAt(i, new THREE.Color(BARRIER_COLORS[(i + 2) % BARRIER_COLORS.length]));
  });
  dummy.scale.set(1, 1, 1);
  railMesh.castShadow = true;
  railMesh.receiveShadow = true;
  group.add(railMesh, valance);

  // Stolpar med mässingsknoppar
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 1.3, 0.2), mat(PALETTE.woodDark), POSTS);
  const knobMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc49440, metalness: 0.8, roughness: 0.35 }), POSTS);
  points.forEach((p, i) => {
    dummy.position.set(p.x, 0.65, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    postMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, 1.35, p.z);
    dummy.updateMatrix();
    knobMesh.setMatrixAt(i, dummy.matrix);
  });
  postMesh.castShadow = true;
  postMesh.receiveShadow = true;
  knobMesh.castShadow = true;
  group.add(postMesh, knobMesh);

  // Sköldar med vapenmönster på varannan stolpe, vända mot mitten
  const shieldColors = [PALETTE.red, PALETTE.blue, PALETTE.gold, 0x3f8a3a, 0x7a3fa0, 0x2a2a2e];
  points.forEach((p, i) => {
    if (i % 2 !== 1) return;
    const shield = makeHeraldicShield(shieldColors[(i >> 1) % shieldColors.length], (i >> 1) % 3);
    const inward = p.clone().multiplyScalar(0.982);
    shield.position.set(inward.x, 0.72, inward.z);
    shield.lookAt(center.x, 0.72, center.z);
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

  // Eldkorgar med riktig eld, rök och fladdrande ljus
  const fires = [];
  [0.35, 1.2, Math.PI - 1.25, Math.PI + 1.25, -1.2, -0.35].forEach((t, i) => {
    const p = ellipsePoint(t, FX + 0.75, FZ + 0.75);
    const fire = makeBrazier(i);
    fire.group.position.set(p.x, 0, p.z);
    group.add(fire.group);
    fires.push(fire);
  });

  // ---------- Läktare på baksidan ----------
  const standAngles = [-0.95, -0.5, 0.5, 0.95]; // relativt baksidan (t = PI)
  standAngles.forEach((offset, si) => {
    const leftSide = offset < 0;
    const { stand, spots } = makeStand(leftSide ? PALETTE.blue : PALETTE.red, si);
    const p = ellipsePoint(Math.PI + offset, FX + 2.6, FZ + 2.6);
    stand.position.copy(p);
    stand.lookAt(center);
    group.add(stand);
    // Platserna i världen (publiken ritas gemensamt för alla läktare)
    stand.updateMatrixWorld(true);
    const e = stand.matrixWorld.elements;
    const yaw = Math.atan2(e[8], e[10]);
    for (const spot of spots) crowdSpots.push({ pos: spot.pos.clone().applyMatrix4(stand.matrixWorld), yaw, row: spot.row });
  });

  // Kungliga logen i mitten av baksidan, med kungaparet, vakter och en härold
  const royals = makeRoyals();
  const royal = makeRoyalBox(royals);
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
  const sky = makeSky();
  group.add(sky);
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

  // ---------- Natur och en liten by runt arenan ----------
  // Områden där träd och stenar inte ska stå (stigen, marknaden, stallet)
  const clearings = [
    { x: 0, z: FZ + 25, rx: 3, rz: 26 },     // stigen
    { x: -22, z: 14, rx: 9, rz: 8 },        // marknaden och tälten
    { x: 22, z: 11, rx: 7, rz: 6 },         // brunnen och hästarna
  ];
  const free = (x, z) => clearings.every((c) => ((x - c.x) / c.rx) ** 2 + ((z - c.z) / c.rz) ** 2 > 1);
  const ringSpot = (minR, maxR) => {
    for (let tries = 0; tries < 20; tries++) {
      const t = rand() * Math.PI * 2;
      const r = minR + rand() * (maxR - minR);
      const x = Math.sin(t) * r * 1.15;
      const z = Math.cos(t) * r;
      if (free(x, z)) return [x, z];
    }
    return null;
  };

  const pineTrunk = new THREE.CylinderGeometry(0.2, 0.25, 1.4, 6);
  const pineCrown = new THREE.ConeGeometry(1.3, 3.2, 7);
  const pineTop = new THREE.ConeGeometry(0.9, 2.2, 7);
  const leafTrunk = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6);
  const puff = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 130; i++) {
    const spot = ringSpot(22, 75);
    if (!spot) continue;
    const tree = new THREE.Group();
    const s2 = 0.75 + rand() * 0.8;
    if (rand() < 0.55) {
      // Gran i två våningar
      const trunk = mesh(pineTrunk, PALETTE.woodDark);
      trunk.position.y = 0.7;
      const crown = mesh(pineCrown, rand() < 0.5 ? PALETTE.tree : 0x456e33);
      crown.position.y = 2.6;
      const top = mesh(pineTop, rand() < 0.5 ? PALETTE.tree : 0x4a7838);
      top.position.y = 4.0;
      tree.add(trunk, crown, top);
    } else {
      // Lövträd med rundad krona av flera bollar
      const trunk = mesh(leafTrunk, 0x5e4126);
      trunk.position.y = 1.1;
      tree.add(trunk);
      const shade = [0x5f8a3e, 0x6e9a44, 0x557d36][Math.floor(rand() * 3)];
      for (let b = 0; b < 4; b++) {
        const ball = mesh(puff, shade);
        ball.scale.setScalar(0.9 + rand() * 0.5);
        ball.position.set((rand() - 0.5) * 1.4, 2.6 + rand() * 0.9, (rand() - 0.5) * 1.4);
        tree.add(ball);
      }
    }
    tree.scale.setScalar(s2);
    tree.rotation.y = rand() * Math.PI;
    tree.position.set(spot[0], 0, spot[1]);
    tree.traverse((o) => (o.castShadow = false)); // långt utanför skuggområdet: spara prestanda
    group.add(tree);
  }

  // Buskar och stenar
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < 70; i++) {
    const spot = ringSpot(17, 55);
    if (!spot) continue;
    if (i % 2) {
      const bush = mesh(puff, [0x5a8a3a, 0x4f7a34, 0x6a9a46][i % 3]);
      bush.scale.set(0.7 + rand() * 0.6, 0.45 + rand() * 0.3, 0.7 + rand() * 0.6);
      bush.position.set(spot[0], 0.25, spot[1]);
      bush.castShadow = false;
      group.add(bush);
    } else {
      const rock = mesh(rockGeo, [0x8f8a80, 0x7a766d, 0x9b968c][i % 3]);
      const sz = 0.25 + rand() * 0.7;
      rock.scale.set(sz * (1 + rand() * 0.5), sz * 0.6, sz);
      rock.rotation.set(rand(), rand() * 3, rand());
      rock.position.set(spot[0], sz * 0.2, spot[1]);
      rock.castShadow = false;
      group.add(rock);
      // Mossa ovanpå ungefär varannan sten
      if (i % 4 === 0) {
        const moss = mesh(rockGeo, [0x5d7a3a, 0x6b8a44][i % 8 ? 1 : 0]);
        moss.scale.set(rock.scale.x * 0.8, rock.scale.y * 0.45, rock.scale.z * 0.8);
        moss.rotation.copy(rock.rotation);
        moss.position.set(spot[0], sz * 0.2 + rock.scale.y * 0.42, spot[1]);
        moss.castShadow = false;
        group.add(moss);
      }
    }
  }

  // Grästuvor och blommor (en ritning var för hundratals stycken)
  const tufts = [];
  const flowers = [];
  for (let i = 0; i < 1100; i++) {
    const spot = ringSpot(15.5, 60);
    if (spot) (i % 4 === 0 ? flowers : tufts).push(spot);
  }
  // Gräset svajar i vinden: toppen av varje tuva flyttas lite i sidled i grafikkortet
  const windTime = { value: 0 };
  const windGrassMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  windGrassMat.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = windTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float windTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float bend = clamp(position.y + 0.16, 0.0, 0.32) / 0.32;
        vec3 base = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        float wave = sin(windTime * 1.7 + base.x * 0.35 + base.z * 0.25) + 0.4 * sin(windTime * 3.1 + base.z * 0.9);
        transformed.x += wave * 0.06 * bend * bend;
        transformed.z += wave * 0.03 * bend * bend;`
      );
  };
  const tuftMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.07, 0.32, 4), windGrassMat, tufts.length);
  tuftMesh.userData.noMerge = true;
  tufts.forEach(([x, z], i) => {
    dummy.position.set(x, 0.14, z);
    dummy.rotation.set((rand() - 0.5) * 0.4, rand() * 3, (rand() - 0.5) * 0.4);
    const sz = 0.7 + rand() * 0.9;
    dummy.scale.set(sz, sz, sz);
    dummy.updateMatrix();
    tuftMesh.setMatrixAt(i, dummy.matrix);
    tuftMesh.setColorAt(i, new THREE.Color([0x6b8f45, 0x7fa352, 0x5c7f3a, 0x8aab5a][i % 4]));
  });
  group.add(tuftMesh);
  const flowerMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.05, 0), new THREE.MeshStandardMaterial({ roughness: 0.8 }), flowers.length);
  flowers.forEach(([x, z], i) => {
    dummy.position.set(x, 0.12, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    flowerMesh.setMatrixAt(i, dummy.matrix);
    flowerMesh.setColorAt(i, new THREE.Color([0xf4f0e0, 0xf2d040, 0xd8483a, 0x9a5ac8, 0xf08ab0][i % 5]));
  });
  group.add(flowerMesh);
  dummy.scale.set(1, 1, 1);
  dummy.rotation.set(0, 0, 0);

  // Stigen in till arenan, med staket på båda sidor
  const path = new THREE.Mesh(new THREE.PlaneGeometry(3, 46), dirtMat);
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.012, FZ + 24);
  path.receiveShadow = true;
  group.add(path);
  for (let z = FZ + 3; z < FZ + 46; z += 2.5) {
    for (const x of [-2, 2]) {
      const post = box(0.12, 0.9, 0.12, PALETTE.woodDark);
      post.position.set(x, 0.45, z);
      group.add(post);
      const rail = box(0.06, 0.07, 2.5, PALETTE.wood);
      rail.position.set(x, 0.65, z + 1.25);
      group.add(rail);
    }
  }

  // Marknad med stånd, tält och lyktor till vänster om stigen
  [[-17, 9, 0.4], [-21, 15, 0.2], [-26, 10, 0.9]].forEach(([x, z, rot], i) => {
    const stall = makeMarketStall([PALETTE.red, PALETTE.blue, PALETTE.gold][i]);
    stall.position.set(x, 0, z);
    stall.rotation.y = rot;
    group.add(stall);
  });
  [[-25, 19, PALETTE.red], [-29, 15, PALETTE.blue], [-18, 20, PALETTE.gold], [-30, 7, PALETTE.cream]].forEach(([x, z, color]) => {
    const tent = makeTent(color);
    tent.position.set(x, 0, z);
    tent.rotation.y = rand() * Math.PI;
    group.add(tent);
  });
  [[-14.5, 6], [-15.5, 13], [-20, 5.5], [-3, FZ + 8], [3, FZ + 8], [-3, FZ + 18], [3, FZ + 18]].forEach(([x, z]) => {
    const lantern = makeLantern();
    lantern.position.set(x, 0, z);
    group.add(lantern);
  });

  // Brunn och hästar till höger om stigen
  const well = makeWell();
  well.position.set(20, 0, 9);
  group.add(well);
  const hitch = box(3.2, 0.1, 0.1, PALETTE.wood);
  hitch.position.set(24.5, 1.0, 13);
  group.add(hitch);
  [-1.3, 1.3].forEach((dx) => {
    const post = box(0.12, 1.1, 0.12, PALETTE.woodDark);
    post.position.set(24.5 + dx * 1.15, 0.55, 13);
    group.add(post);
  });
  [[23.6, 14.3, 0.1, 0x6a4a2c], [25.6, 14.5, -0.15, 0xe8e0d0]].forEach(([x, z, rot, color]) => {
    const horse = makeHorse(color);
    horse.position.set(x, 0, z);
    horse.rotation.y = Math.PI + rot;
    group.add(horse);
  });

  // Träningsdocka ("quintain") vid kanten: snurrar när man slår på den
  const quintain = makeQuintain();
  quintain.group.position.set(-10.6, 0, 3.6);
  quintain.group.rotation.y = 0.9;
  group.add(quintain.group);
  colliders.push({ minX: -10.6 - 0.22, maxX: -10.6 + 0.22, minZ: 3.6 - 0.22, maxZ: 3.6 + 0.22 });

  // Slå ihop alla stillastående bitar till några få stora (mycket bättre FPS)
  group.add(mergeStatic(group));

  // Publiken (alla läktare tillsammans)
  const crowd = new Crowd(crowdSpots, 11);
  group.add(crowd.group);

  // Prispallen (gömd under marken tills matchen är slut)
  const podium = makePodium();
  podium.group.rotation.y = Math.PI; // framsidan mot kungen
  group.add(podium.group);

  // Publiken: gungar lite hela tiden, följer striden och reser sig och jublar vid häftiga händelser
  let excitement = 0;
  let time = 0;
  const focus = new THREE.Vector3();
  const update = (dt, focusPoint = null) => {
    time += dt;
    windTime.value = time;
    excitement = Math.max(0, excitement - dt * 0.35);
    if (focusPoint) focus.lerp(focusPoint, Math.min(1, dt * 2));
    crowd.setFocus(focus);
    crowd.update(dt, time, excitement);
    royals.update(dt);
    podium.update(dt);
    quintain.update(dt);
    for (const fire of fires) fire.update(dt, time);
    // Flaggor fladdrar i vinden
    for (const flag of wavingFlags) waveFlag(flag, time);
    // Vimplarna vajar lite på sina snören
    flagSpots.forEach((f, i) => {
      dummy.position.copy(f.pos);
      dummy.rotation.set(Math.sin(time * 2.2 + i * 0.7) * 0.25, f.angle, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      flagMesh.setMatrixAt(i, dummy.matrix);
    });
    flagMesh.instanceMatrix.needsUpdate = true;
  };
  const cheer = (strength = 1) => {
    excitement = Math.min(1.5, excitement + strength);
  };

  return {
    group, colliders, update, cheer, quintain,
    podium,
    royalReact: (up) => royals.react(up),
    heraldBlow: () => royals.blow(),
    setQuality: (low) => fires.forEach((f) => (f.light.visible = !low)),
    // Dag eller kväll: himlen, molnen och eldkorgarna
    setTime(evening) {
      setSkyColors(sky, evening);
      if (cloudMaterial) cloudMaterial.color.set(evening ? 0xf0b090 : 0xffffff);
      for (const f of fires) {
        f.boost = evening ? 2.6 : 1;
        f.light.distance = evening ? 15 : 8;
      }
    },
  };
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

// Marknadsstånd: disk, stolpar, randigt tak och varor
function makeMarketStall(color) {
  const g = new THREE.Group();
  const counter = box(2.2, 0.9, 0.9, PALETTE.wood);
  counter.position.y = 0.45;
  g.add(counter);
  [[-1.05, -0.4], [1.05, -0.4], [-1.05, 0.4], [1.05, 0.4]].forEach(([x, z]) => {
    const post = box(0.08, 2.2, 0.08, PALETTE.woodDark);
    post.position.set(x, 1.1, z);
    g.add(post);
  });
  const roof = makeStripedRoof(2.5, 1.4, color, 6);
  roof.position.y = 2.25;
  roof.rotation.x = 0.15;
  g.add(roof);
  const goods = [0xc0392b, 0xe67e22, 0x7fa352, 0xd9b45a];
  for (let i = 0; i < 9; i++) {
    const item = mesh(new THREE.SphereGeometry(0.08, 6, 5), goods[i % goods.length]);
    item.position.set(-0.8 + (i % 5) * 0.4, 0.97, -0.1 + Math.floor(i / 5) * 0.25);
    g.add(item);
  }
  const crate = box(0.5, 0.4, 0.5, PALETTE.woodLight);
  crate.position.set(1.4, 0.2, 0.3);
  g.add(crate);
  return g;
}

// Tält: rund vägg och spetsigt tak med en liten vimpel
function makeTent(color) {
  const g = new THREE.Group();
  const wall = mesh(new THREE.CylinderGeometry(1.6, 1.7, 1.4, 12), PALETTE.cream);
  wall.position.y = 0.7;
  const roof = mesh(new THREE.ConeGeometry(1.95, 1.6, 12), color);
  roof.position.y = 2.2;
  const door = box(0.7, 1.1, 0.05, 0x3a2a1a);
  door.position.set(0, 0.55, 1.68);
  const pole = box(0.05, 0.8, 0.05, PALETTE.woodDark);
  pole.position.y = 3.3;
  const pennant = mesh(new THREE.ConeGeometry(0.12, 0.45, 3), color);
  pennant.rotation.z = -Math.PI / 2;
  pennant.position.set(0.22, 3.55, 0);
  g.add(wall, roof, door, pole, pennant);
  return g;
}

// Lykta på en stolpe (lyser utan riktigt ljus – billigt för grafikkortet)
function makeLantern() {
  const g = new THREE.Group();
  const pole = box(0.1, 2.0, 0.1, PALETTE.woodDark);
  pole.position.y = 1.0;
  const arm = box(0.45, 0.06, 0.06, PALETTE.woodDark);
  arm.position.set(0.2, 1.95, 0);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.18), new THREE.MeshBasicMaterial({ color: 0xffc860 }));
  lamp.position.set(0.38, 1.75, 0);
  const cap = mesh(new THREE.ConeGeometry(0.15, 0.12, 4), PALETTE.woodDark);
  cap.rotation.y = Math.PI / 4;
  cap.position.set(0.38, 1.93, 0);
  g.add(pole, arm, lamp, cap);
  return g;
}

function makeWell() {
  const g = new THREE.Group();
  const ring = mesh(new THREE.CylinderGeometry(0.8, 0.85, 0.8, 14, 1, true), PALETTE.stone);
  ring.position.y = 0.4;
  const rim = mesh(new THREE.TorusGeometry(0.8, 0.09, 6, 16), PALETTE.stone);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.8;
  const water = mesh(new THREE.CircleGeometry(0.78, 14), 0x3a5a7a, false);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.45;
  g.add(ring, rim, water);
  [-0.75, 0.75].forEach((x) => {
    const post = box(0.1, 1.8, 0.1, PALETTE.woodDark);
    post.position.set(x, 0.9, 0);
    g.add(post);
  });
  const roof = mesh(new THREE.ConeGeometry(1.2, 0.7, 4), PALETTE.red);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 2.1;
  const bucket = mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.18, 8), PALETTE.wood);
  bucket.position.set(0, 1.2, 0);
  g.add(roof, bucket);
  return g;
}

// Enkel häst (står och tittar mot sin stolpe)
function makeHorse(color) {
  const g = new THREE.Group();
  const body = mesh(new THREE.CapsuleGeometry(0.32, 0.9, 4, 10), color);
  body.rotation.x = Math.PI / 2;
  body.position.y = 1.15;
  const neck = mesh(new THREE.CapsuleGeometry(0.16, 0.5, 3, 8), color);
  neck.position.set(0, 1.55, 0.6);
  neck.rotation.x = 0.6;
  const head = mesh(new THREE.CapsuleGeometry(0.12, 0.35, 3, 8), color);
  head.position.set(0, 1.78, 0.92);
  head.rotation.x = 1.25;
  const mane = box(0.06, 0.5, 0.25, 0x2a1d12);
  mane.position.set(0, 1.68, 0.5);
  mane.rotation.x = 0.6;
  const tail = mesh(new THREE.ConeGeometry(0.08, 0.6, 6), 0x2a1d12);
  tail.position.set(0, 1.0, -0.75);
  tail.rotation.x = -0.4;
  const saddle = box(0.5, 0.12, 0.45, PALETTE.red);
  saddle.position.set(0, 1.45, 0.05);
  g.add(body, neck, head, mane, tail, saddle);
  [[-0.2, 0.45], [0.2, 0.45], [-0.2, -0.45], [0.2, -0.45]].forEach(([x, z]) => {
    const leg = mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.9, 6), color);
    leg.position.set(x, 0.45, z);
    const hoof = mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.08, 6), 0x2a1d12);
    hoof.position.set(x, 0.04, z);
    g.add(leg, hoof);
  });
  return g;
}

// Himmel: stor kupol med färgövergång (djupblå uppåt, ljus vid horisonten)
// Himlens färger: dag = blå, kväll = solnedgång (orange vid horisonten, djupblå högst upp)
export const SKY_COLORS = {
  day: { top: 0x4f86c6, horizon: 0xc4dcef },
  evening: { top: 0x27305e, horizon: 0xf2925a },
};

export function setSkyColors(sky, evening) {
  const c = evening ? SKY_COLORS.evening : SKY_COLORS.day;
  sky.material.uniforms.top.value.set(c.top);
  sky.material.uniforms.horizon.value.set(c.horizon);
}

export function makeSky(evening = false) {
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
  setSkyColors(sky, evening);
  sky.userData.noMerge = true;
  sky.renderOrder = -1;
  return sky;
}

let cloudMaterial = null;
function makeCloud(rand) {
  const g = new THREE.Group();
  // Ett gemensamt material, så alla moln slås ihop till en enda ritning
  if (!cloudMaterial) cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, fog: false });
  const material = cloudMaterial;
  const parts = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < parts; i++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), material);
    puff.scale.set(6 + rand() * 6, 3 + rand() * 2, 5 + rand() * 4);
    puff.position.set(i * 7 - parts * 3.5 + rand() * 3, rand() * 2, rand() * 4);
    puff.castShadow = false;
    g.add(puff);
  }
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

// Delade material med plankstruktur (läktare, logen)
const plankMats = new Map();
function plankMat(color) {
  if (!plankMats.has(color)) plankMats.set(color, new THREE.MeshStandardMaterial({ color, map: plankTexture(), roughness: 0.88 }));
  return plankMats.get(color);
}

// Tygtak som hänger lite i mitten (mellan stolparna) och sluttar framåt
function saggingRoof(width, depth, material, sag = 0.18, slope = 0.12) {
  const geo = new THREE.PlaneGeometry(width, depth, 12, 6);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (width / 2);
    const z = pos.getZ(i) / (depth / 2);
    pos.setY(i, -sag * (1 - x * x) * (1 - z * z * 0.6) - z * slope * (depth / 2));
  }
  geo.computeVertexNormals();
  const roof = new THREE.Mesh(geo, material);
  roof.castShadow = true;
  roof.receiveShadow = true;
  return roof;
}

// En tygbanderoll med vapenmönster (hänger från en överkant)
const bannerMats = new Map();
function heraldBanner(color, variant, w = 0.6, h = 0.85) {
  const key = color + ":" + variant;
  if (!bannerMats.has(key)) {
    bannerMats.set(key, new THREE.MeshStandardMaterial({ map: heraldryTexture(color, variant), alphaMap: daggedTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }));
  }
  const geo = new THREE.PlaneGeometry(w, h);
  geo.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(geo, bannerMats.get(key));
  m.castShadow = true;
  return m;
}

// En läktare: trappsteg av plankor, räcke med banderoller och ett randigt tygtak med tandad kant.
// Framsidan mot +Z. Returnerar läktaren och platserna där publiken sitter (i läktarens koordinater).
function makeStand(color, seed) {
  const stand = new THREE.Group();
  const width = 5;
  const spots = [];
  const rand = seededRandom(31 + seed * 17);
  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(width, 0.5 * (i + 1), 0.9), plankMat(i % 2 ? PALETTE.wood : PALETTE.woodLight));
    step.castShadow = true;
    step.receiveShadow = true;
    step.position.set(0, 0.25 * (i + 1), -i * 0.9);
    stand.add(step);
    // Bänkkant (en mörkare list där man sitter)
    const lip = box(width, 0.05, 0.08, PALETTE.woodDark);
    lip.position.set(0, 0.5 * (i + 1) + 0.025, -i * 0.9 + 0.41);
    stand.add(lip);
    // Publik på varje trappsteg (några platser står tomma)
    for (let x = -width / 2 + 0.4; x <= width / 2 - 0.3; x += 0.55) {
      if (rand() < 0.8) spots.push({ pos: new THREE.Vector3(x + (rand() - 0.5) * 0.12, 0.5 * (i + 1), -i * 0.9 - 0.08), row: i });
    }
  }
  // Stolpar
  [-width / 2 + 0.1, width / 2 - 0.1].forEach((x) => {
    [0.4, -2.2].forEach((z) => {
      const post = box(0.16, 3.4, 0.16, PALETTE.woodDark);
      post.position.set(x, 1.7, z);
      stand.add(post);
    });
  });
  // Räcke framtill (lågt, så man ser publiken) med banderoller i läktarens färg
  for (const x of [-width / 2 + 0.1, -0.85, 0.85, width / 2 - 0.1]) {
    const post = box(0.09, 0.75, 0.09, PALETTE.woodDark);
    post.position.set(x, 0.375, 0.52);
    stand.add(post);
  }
  const rail = box(width, 0.08, 0.1, PALETTE.wood);
  rail.position.set(0, 0.74, 0.52);
  stand.add(rail);
  [-1.7, 0, 1.7].forEach((x, k) => {
    const banner = heraldBanner(k === 1 ? PALETTE.gold : color, seed + k, 0.55, 0.62);
    banner.position.set(x, 0.72, 0.58);
    stand.add(banner);
  });
  // Tygtaket: randigt, hänger lite i mitten, med en tandad kant framtill
  const roofMat = new THREE.MeshStandardMaterial({ map: stripeTexture(color, PALETTE.cream, 10), side: THREE.DoubleSide, roughness: 0.9 });
  const roof = saggingRoof(width + 0.4, 3.2, roofMat);
  roof.position.set(0, 3.45, -0.9);
  stand.add(roof);
  const valanceMat = new THREE.MeshStandardMaterial({ color, map: linenTexture(), alphaMap: daggedTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  const valance = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.4, 0.32), valanceMat);
  valance.position.set(0, 3.45 - 0.19 - 0.16, -0.9 + 1.6);
  stand.add(valance);
  // Flagga
  const flag = makeFlag(color);
  flag.position.set(width / 2 - 0.1, 3.4, -2.2);
  stand.add(flag);
  return { stand, spots };
}

// Kungliga logen: hög plattform med tronstolar, gobelänger, guldkant, kungaparet, vakter och en härold.
function makeRoyalBox(royals) {
  const royal = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8ae42, metalness: 0.85, roughness: 0.3 });
  const goldBox = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), gold);
    m.position.set(x, y, z);
    m.castShadow = true;
    royal.add(m);
    return m;
  };
  // Plattformen
  const base = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 3), plankMat(PALETTE.woodDark));
  base.position.set(0, 1, -0.5);
  base.castShadow = true;
  base.receiveShadow = true;
  royal.add(base);
  // Röd matta på golvet och trappa på sidan
  const carpet = box(1.0, 0.02, 2.6, 0x8a1a2a);
  carpet.position.set(0, 2.01, -0.5);
  royal.add(carpet);
  for (let i = 0; i < 5; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4 * (i + 1), 0.4), plankMat(PALETTE.wood));
    step.position.set(2.4, 0.2 * (i + 1), 0.6 - i * 0.4);
    step.castShadow = true;
    royal.add(step);
  }
  // Bakvägg med gobelänger
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 0.12), plankMat(PALETTE.woodDark));
  wall.position.set(0, 3.3, -1.9);
  royal.add(wall);
  [-1.3, 0, 1.3].forEach((x, k) => {
    const tapestry = heraldBanner(k === 1 ? 0x6a1a8a : PALETTE.blue, 3 + k, 1.0, 1.9);
    tapestry.position.set(x, 4.4, -1.83);
    royal.add(tapestry);
  });
  // Tronstolar: hög rygg med guldknoppar, armstöd och röd dyna
  [-0.6, 0.6].forEach((x) => {
    const seat = box(0.62, 0.45, 0.55, PALETTE.woodDark);
    seat.position.set(x, 2.225, -0.12);
    royal.add(seat);
    const cushion = box(0.56, 0.06, 0.5, 0x8a1a2a);
    cushion.position.set(x, 2.48, -0.1);
    royal.add(cushion);
    const back = box(0.62, 1.35, 0.1, 0x8a1a2a);
    back.position.set(x, 3.1, -0.42);
    royal.add(back);
    goldBox(0.66, 0.06, 0.12, x, 3.8, -0.42);
    for (const s of [1, -1]) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), gold);
      knob.position.set(x + 0.3 * s, 3.88, -0.42);
      royal.add(knob);
      const arm = box(0.07, 0.3, 0.5, PALETTE.woodDark);
      arm.position.set(x + 0.3 * s, 2.6, -0.12);
      royal.add(arm);
    }
  });
  // Kungaparet sitter på tronerna
  royals.king.group.position.set(-0.6, 2.52, -0.08);
  royals.queen.group.position.set(0.6, 2.52, -0.08);
  royal.add(royals.king.group, royals.queen.group);
  // Härolden står längst fram på plattformen, vakterna nedanför
  royals.herald.group.position.set(1.45, 2.0, 0.6);
  royals.herald.group.rotation.y = -0.25;
  royal.add(royals.herald.group);
  royals.guards[0].group.position.set(-1.6, 0, 1.55);
  royals.guards[1].group.position.set(1.6, 0, 1.55);
  royal.add(royals.guards[0].group, royals.guards[1].group);
  // Kungaparet och härolden rör sig; vakterna står still och bakas ihop med resten av logen
  for (const f of [royals.king, royals.queen, royals.herald]) f.group.userData.noMerge = true;
  // Räcke framtill med guldkant och banderoller
  const rail = box(4, 0.55, 0.12, PALETTE.woodDark);
  rail.position.set(0, 2.28, 0.95);
  royal.add(rail);
  goldBox(4.05, 0.05, 0.16, 0, 2.58, 0.95);
  [-1.5, -0.5, 0.5, 1.5].forEach((x, i) => {
    const banner = heraldBanner(i % 2 ? PALETTE.blue : PALETTE.red, i, 0.62, 1.35);
    banner.position.set(x, 1.95, 1.04);
    royal.add(banner);
  });
  // Stolpar och tak med guldkant och tandad tygkant runt om
  [-1.9, 1.9].forEach((x) => {
    [0.95, -1.9].forEach((z) => {
      const post = box(0.18, 3, 0.18, PALETTE.woodDark);
      post.position.set(x, 3.5, z);
      royal.add(post);
    });
  });
  const roof = mesh(new THREE.ConeGeometry(3.2, 1.8, 4), PALETTE.blue);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0, 5.9, -0.5);
  royal.add(roof);
  const valanceMat = new THREE.MeshStandardMaterial({ color: PALETTE.gold, map: linenTexture(), alphaMap: daggedTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.2 });
  for (const [x, z, ry, w] of [[0, 0.98, 0, 4.4], [0, -1.98, 0, 4.4], [2.0, -0.5, Math.PI / 2, 3.0], [-2.0, -0.5, Math.PI / 2, 3.0]]) {
    const v = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.35), valanceMat);
    v.position.set(x, 4.85, z);
    v.rotation.y = ry;
    royal.add(v);
  }
  const flag = makeFlag(PALETTE.blue);
  flag.position.set(0, 6.8, -0.5);
  royal.add(flag);
  return royal;
}

// Eldkorg på tre ben: glödande kol, fladdrande lågor, glöd, rök och ett riktigt ljus
function makeBrazier(index) {
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x2e2a28, roughness: 0.6, metalness: 0.5 });
  const add = (geo, m, pos, rot = [0, 0, 0]) => {
    const x = new THREE.Mesh(geo, m);
    x.position.set(...pos);
    x.rotation.set(...rot);
    x.castShadow = true;
    g.add(x);
    return x;
  };
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    add(new THREE.CylinderGeometry(0.025, 0.03, 1.15, 6), iron, [Math.sin(a) * 0.2, 0.55, Math.cos(a) * 0.2], [Math.cos(a) * 0.22, 0, -Math.sin(a) * 0.22]);
  }
  add(new THREE.TorusGeometry(0.3, 0.025, 6, 16), iron, [0, 1.0, 0], [Math.PI / 2, 0, 0]);
  const bowl = add(new THREE.CylinderGeometry(0.34, 0.2, 0.26, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x2e2a28, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }), [0, 1.08, 0]);
  bowl.castShadow = true;
  add(new THREE.TorusGeometry(0.34, 0.02, 6, 16), iron, [0, 1.21, 0], [Math.PI / 2, 0, 0]);
  add(new THREE.SphereGeometry(0.29, 12, 6), new THREE.MeshStandardMaterial({ color: 0x3a1408, emissive: 0xff4a10, emissiveIntensity: 1.6, roughness: 1 }), [0, 1.14, 0]).scale.set(1, 0.3, 1);
  // Det som rör sig ska inte slås ihop med resten
  const fx = new THREE.Group();
  fx.userData.noMerge = true;
  g.add(fx);
  const flameColors = [0xffe08a, 0xffa040, 0xff5a1a];
  const flames = flameColors.map((color, i) => {
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(0.2 - i * 0.03, 0.6 + i * 0.1, 8, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 - i * 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    m.position.set((i - 1) * 0.06, 1.45 + i * 0.03, (i % 2) * 0.05);
    fx.add(m);
    return m;
  });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffa050, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.55, depthWrite: false }));
  glow.position.y = 1.45;
  glow.scale.set(1.8, 1.8, 1);
  fx.add(glow);
  const smoke = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x4a4644, transparent: true, opacity: 0.2, depthWrite: false }));
    s.userData.phase = i / 3;
    fx.add(s);
    smoke.push(s);
  }
  const light = new THREE.PointLight(0xff8a3a, 4, 8, 1.6);
  light.position.y = 1.7;
  fx.add(light);
  const seed = index * 1.7;
  return {
    group: g,
    light,
    boost: 1, // starkare på kvällen
    update(dt, time) {
      const flicker = Math.sin(time * 13 + seed) * 0.5 + Math.sin(time * 23.7 + seed * 2) * 0.3 + (Math.random() - 0.5) * 0.4;
      flames.forEach((f, i) => {
        const s = 1 + flicker * (0.18 + i * 0.05);
        f.scale.set(1 - flicker * 0.06, s, 1 - flicker * 0.06);
        f.rotation.y = time * (1.5 + i);
        f.position.y = 1.45 + i * 0.03 + (s - 1) * 0.25;
      });
      glow.material.opacity = 0.45 + flicker * 0.12;
      light.intensity = (4 + flicker * 1.3) * this.boost;
      for (const s of smoke) {
        const k = (time * 0.35 + s.userData.phase) % 1;
        s.position.set(Math.sin(time * 0.7 + s.userData.phase * 9) * 0.15 + k * 0.4, 1.8 + k * 2.4, k * 0.2);
        s.scale.setScalar(0.5 + k * 1.6);
        s.material.opacity = 0.22 * Math.sin(k * Math.PI);
      }
    },
  };
}

// Träningsdocka ("quintain"): en stolpe med en snurrande arm. Ena änden har en sköld,
// andra en sandsäck. Slår man på den snurrar den runt.
function makeQuintain() {
  const g = new THREE.Group();
  const wood = mat(PALETTE.wood);
  const dark = mat(PALETTE.woodDark);
  const add = (parent, geo, m, pos, rot = [0, 0, 0], scale = [1, 1, 1]) => {
    const x = new THREE.Mesh(geo, m);
    x.position.set(...pos);
    x.rotation.set(...rot);
    x.scale.set(...scale);
    x.castShadow = true;
    x.receiveShadow = true;
    parent.add(x);
    return x;
  };
  add(g, new THREE.CylinderGeometry(0.09, 0.11, 1.7, 8), wood, [0, 0.85, 0]);
  add(g, new THREE.BoxGeometry(1.0, 0.12, 0.14), dark, [0, 0.06, 0]);
  add(g, new THREE.BoxGeometry(0.14, 0.12, 1.0), dark, [0, 0.06, 0]);
  // Snedstöd från stolpen ner mot fötterna
  for (const [x, z] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) add(g, new THREE.BoxGeometry(0.06, 0.42, 0.06), dark, [x * 0.6, 0.24, z * 0.6], [-z * 2.2, 0, x * 2.2]);
  // Den snurrande delen
  const spinner = new THREE.Group();
  spinner.userData.noMerge = true;
  spinner.position.y = 1.62;
  g.add(spinner);
  add(spinner, new THREE.CylinderGeometry(0.11, 0.11, 0.16, 10), dark, [0, 0, 0]);
  add(spinner, new THREE.BoxGeometry(1.55, 0.08, 0.08), wood, [-0.02, 0.02, 0]);
  // Ett målat trähuvud med turban överst
  add(spinner, new THREE.SphereGeometry(0.13, 12, 10), mat(0xc89a6a), [0, 0.22, 0]);
  add(spinner, new THREE.TorusGeometry(0.11, 0.05, 8, 14), mat(PALETTE.cream), [0, 0.3, 0], [Math.PI / 2, 0, 0]);
  add(spinner, new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(PALETTE.red), [0, 0.31, 0]);
  for (const s of [1, -1]) add(spinner, new THREE.BoxGeometry(0.035, 0.018, 0.01), mat(0x1a1a1a), [0.045 * s, 0.25, 0.125]);
  add(spinner, new THREE.BoxGeometry(0.06, 0.012, 0.01), mat(0x6a1a1a), [0, 0.17, 0.125]);
  // Skölden på ena änden
  const shield = makeHeraldicShield(PALETTE.blue, 1);
  shield.position.set(0.74, -0.08, 0.05);
  spinner.add(shield);
  // Sandsäcken på andra änden, i ett rep (svänger ut när armen snurrar)
  const bagPivot = new THREE.Group();
  bagPivot.position.set(-0.78, 0, 0);
  spinner.add(bagPivot);
  add(bagPivot, new THREE.CylinderGeometry(0.008, 0.008, 0.35, 4), mat(0xa08850), [0, -0.175, 0]);
  add(bagPivot, new THREE.SphereGeometry(0.13, 10, 8), mat(0xb8a070), [0, -0.42, 0], [0, 0, 0], [1, 1.25, 1]);
  add(bagPivot, new THREE.TorusGeometry(0.04, 0.012, 4, 8), mat(0xa08850), [0, -0.3, 0], [Math.PI / 2, 0, 0]);

  mergeFigure(spinner);

  const state = { angle: 0, vel: 0 };
  return {
    group: g,
    // Ett slag från (x, z) med vridningen yaw och räckvidden reach. Returnerar true om dockan träffades.
    hit(x, z, yaw, reach, strength = 1) {
      const px = g.position.x;
      const pz = g.position.z;
      const dx = px - x;
      const dz = pz - z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach + 0.7) return false;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      if (dist > 0.3 && (fx * dx + fz * dz) / dist < 0.4) return false;
      const side = fx * dz - fz * dx >= 0 ? 1 : -1; // snurrar åt olika håll beroende på var den träffas
      state.vel += side * (5 + Math.random() * 3) * strength;
      state.vel = Math.max(-16, Math.min(16, state.vel));
      return true;
    },
    update(dt) {
      state.angle += state.vel * dt;
      state.vel *= Math.exp(-dt * 0.8);
      spinner.rotation.y = state.angle;
      bagPivot.rotation.z = -Math.min(1.25, state.vel * state.vel * 0.01); // säcken svänger utåt
    },
  };
}

// En sköld med vapenmönster (rak överkant, rundad spets). Framsidan mot +Z.
const heraldShieldMats = new Map();
function makeHeraldicShield(color, variant) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-0.22, 0.25);
  s.lineTo(0.22, 0.25);
  s.lineTo(0.22, 0.05);
  s.quadraticCurveTo(0.2, -0.18, 0, -0.3);
  s.quadraticCurveTo(-0.2, -0.18, -0.22, 0.05);
  s.lineTo(-0.22, 0.25);
  const body = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false });
  body.translate(0, 0, -0.045);
  const bodyMesh = new THREE.Mesh(body, mat(PALETTE.woodDark));
  bodyMesh.castShadow = true;
  g.add(bodyMesh);
  const key = color + ":" + variant;
  if (!heraldShieldMats.has(key)) heraldShieldMats.set(key, new THREE.MeshStandardMaterial({ map: heraldryTexture(color, variant), roughness: 0.75 }));
  const face = new THREE.ShapeGeometry(s, 10);
  face.computeBoundingBox();
  const box3 = face.boundingBox;
  const uv = face.attributes.uv;
  const pos = face.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (pos.getX(i) - box3.min.x) / (box3.max.x - box3.min.x), (pos.getY(i) - box3.min.y) / (box3.max.y - box3.min.y));
  }
  const faceMesh = new THREE.Mesh(face, heraldShieldMats.get(key));
  faceMesh.position.z = 0.002;
  g.add(faceMesh);
  return g;
}

// Trätorn byggt av riktiga plankor: hörnstolpar, liggande bräder, kryssförband,
// järnband, ett fönster med luckor, stege på baksidan och en tinnad plattform under taket.
// Framsidan (med fanan) är +Z.
const boardMats = new Map();
function boardMat(color) {
  // Ådrat trä där texturen bara visar EN bräda (den delade plankbilden har fyra)
  if (!boardMats.has(color)) {
    const map = plankTexture().clone();
    map.repeat.set(1, 0.25);
    map.needsUpdate = true;
    boardMats.set(color, new THREE.MeshStandardMaterial({ color, map, roughness: 0.88 }));
  }
  return boardMats.get(color);
}
function board(w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), boardMat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makeTower(color, emblemRed) {
  const tower = new THREE.Group();
  const rand = seededRandom(emblemRed ? 71 : 37);
  const W = 2.2;   // bredd
  const H = 4.6;   // plattformens höjd
  const half = W / 2;
  const woods = [0x7a5434, 0x8a6040, 0x6e4a2e, 0x9a7048, 0x735034];
  const iron = 0x3b3a3c;

  // Stengrund
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = half + 0.05;
    const stone = mesh(new THREE.DodecahedronGeometry(0.32, 0), [0x8f8a80, 0x7d786f, 0x9b968c][i % 3]);
    stone.scale.set(1.2, 0.55, 0.9);
    stone.position.set(Math.sin(a) * r, 0.1, Math.cos(a) * r);
    stone.rotation.set(rand(), a, rand() * 0.3);
    tower.add(stone);
  }

  // Hörnstolpar (går ända upp till taket)
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = board(0.26, H + 1.25, 0.26, PALETTE.woodDark);
    post.position.set(x * (half - 0.05), (H + 1.25) / 2, z * (half - 0.05));
    tower.add(post);
  }

  // Liggande bräder på alla fyra sidor. Varje bräda har egen färg och sitter lite snett.
  const ROWS = 19;
  const rowH = H / ROWS;
  const sides = [
    { ry: 0, ox: 0, oz: half },            // fram
    { ry: Math.PI, ox: 0, oz: -half },     // bak
    { ry: Math.PI / 2, ox: half, oz: 0 },  // höger
    { ry: -Math.PI / 2, ox: -half, oz: 0 },// vänster
  ];
  sides.forEach((side, si) => {
    for (let r = 0; r < ROWS; r++) {
      const y = rowH * (r + 0.5);
      // Fönster på sidorna högt upp: två kortare bräder med ett hål emellan
      const windowRow = si >= 2 && r >= 14 && r <= 16;
      const pieces = windowRow ? [[-0.66, 0.78], [0.66, 0.78]] : [[0, W - 0.1]];
      for (const [cx, len] of pieces) {
        const b = board(len, rowH * 0.92, 0.06, woods[Math.floor(rand() * woods.length)]);
        const local = new THREE.Vector3(cx + (rand() - 0.5) * 0.04, y, 0.02 + rand() * 0.015);
        local.applyAxisAngle(new THREE.Vector3(0, 1, 0), side.ry);
        b.position.set(side.ox + local.x, local.y, side.oz + local.z);
        b.rotation.set(0, side.ry, (rand() - 0.5) * 0.025);
        tower.add(b);
      }
    }
    const out = (lx, y, lz, w, h, d, c, rz = 0) => {
      const m = c === iron ? box(w, h, d, c) : board(w, h, d, c);
      const v = new THREE.Vector3(lx, y, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), side.ry);
      m.position.set(side.ox + v.x, v.y, side.oz + v.z);
      m.rotation.set(0, side.ry, rz);
      tower.add(m);
      return m;
    };
    // Järnband runt tornet
    for (const y of [0.9, 2.6, 4.2]) out(0, y, 0.07, W + 0.02, 0.07, 0.02, iron);
    // Kryssförband nertill (inte på framsidan där fanan hänger)
    if (si !== 0) {
      const diag = Math.hypot(W - 0.3, 2.0);
      const ang = Math.atan2(2.0, W - 0.3);
      out(0, 1.25, 0.1, diag, 0.16, 0.06, PALETTE.woodDark, ang);
      out(0, 1.25, 0.13, diag, 0.16, 0.06, PALETTE.woodDark, -ang);
    }
    // Fönsterluckor som står öppna
    if (si >= 2) {
      const sy = rowH * 15.5;
      // Luckorna sitter på gångjärn i fönsterkanten och står öppna utåt
      for (const dir of [-1, 1]) {
        const open = 1.15;
        const shutter = out(dir * (0.27 + Math.cos(open) * 0.135), sy, 0.07 + Math.sin(open) * 0.135, 0.27, rowH * 3.2, 0.04, 0x5f7a3a);
        shutter.rotation.y -= dir * open;
      }
      out(0, rowH * 13.9, 0.1, 0.7, 0.06, 0.16, PALETTE.woodDark); // fönsterbräda
    }
  });

  // Plattformen: golv med bjälkar som sticker ut
  const floor = board(W + 0.7, 0.14, W + 0.7, PALETTE.woodDark);
  floor.position.y = H + 0.07;
  tower.add(floor);
  for (let i = 0; i < 5; i++) {
    const x = -1.1 + i * 0.55;
    const joist = board(0.13, 0.13, W + 1.0, PALETTE.wood);
    joist.position.set(x, H - 0.07, 0);
    tower.add(joist);
  }
  // Stöttor under hörnen av plattformen
  for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const strut = board(0.1, 0.8, 0.1, PALETTE.woodDark);
    strut.position.set(x * (half + 0.12), H - 0.32, z * (half + 0.12));
    strut.rotation.set(-z * 0.5, 0, x * 0.5);
    tower.add(strut);
  }

  // Bröstvärn med tinnar runt plattformen
  const P = (W + 0.7) / 2 - 0.04;
  for (const [ry, ox, oz] of [[0, 0, P], [Math.PI, 0, -P], [Math.PI / 2, P, 0], [-Math.PI / 2, -P, 0]]) {
    for (let r = 0; r < 3; r++) {
      const b = board(W + 0.7, 0.17, 0.05, woods[Math.floor(rand() * woods.length)]);
      b.position.set(ox, H + 0.24 + r * 0.18, oz);
      b.rotation.y = ry;
      tower.add(b);
    }
    for (let m = 0; m < 3; m++) {
      const merlon = board(0.42, 0.36, 0.07, PALETTE.wood);
      const lx = (m - 1) * 0.95;
      const v = new THREE.Vector3(lx, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      merlon.position.set(ox + v.x, H + 0.95, oz + v.z);
      merlon.rotation.y = ry;
      tower.add(merlon);
    }
  }

  // Stege på baksidan
  const ladder = new THREE.Group();
  for (const x of [-0.24, 0.24]) {
    const rail = board(0.07, H + 0.6, 0.07, PALETTE.woodLight);
    rail.position.set(x, (H + 0.6) / 2, 0);
    ladder.add(rail);
  }
  for (let y = 0.3; y < H + 0.3; y += 0.32) {
    const rung = board(0.52, 0.045, 0.05, PALETTE.wood);
    rung.position.set(0, y, 0);
    ladder.add(rung);
  }
  ladder.position.set(0.5, 0, -half - 0.35);
  ladder.rotation.x = -0.06;
  tower.add(ladder);

  // Tak av spån i rader på stolparna, med takfot, bjälkändar, åsar och en spira
  const roofTop = makeShingleRoof(color, H + 1.25, 1.6, 2.0, rand);
  tower.add(roofTop);
  const flag = makeFlag(color);
  flag.position.y = H + 1.25 + 2.0 + 0.12;
  tower.add(flag);
  const banner = makeBanner(color, emblemRed);
  banner.position.set(0, 2.6, half + 0.1);
  banner.scale.setScalar(1.4);
  tower.add(banner);
  return tower;
}

// Pyramidtak av överlappande spån. y0 = takfotens höjd, B = halva bredden vid takfoten, h = höjd.
function makeShingleRoof(color, y0, B, h, rand) {
  const roof = new THREE.Group();
  const c = new THREE.Color(color);
  const shades = [color, c.clone().multiplyScalar(0.82).getHex(), c.clone().lerp(new THREE.Color(0x6a5040), 0.25).getHex()];
  // Undertak (syns mellan spånen och underifrån)
  const under = mesh(new THREE.ConeGeometry(B * Math.SQRT2 * 0.97, h * 0.97, 4, 1, true), PALETTE.woodDark);
  under.rotation.y = Math.PI / 4;
  under.position.y = y0 + h * 0.485;
  under.material = new THREE.MeshStandardMaterial({ color: PALETTE.woodDark, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
  roof.add(under);
  const slope = Math.atan2(h, B);
  const slant = Math.hypot(h, B);
  const ROWS = 9;
  for (let side = 0; side < 4; side++) {
    const face = new THREE.Group();
    face.rotation.y = (side * Math.PI) / 2;
    for (let r = 0; r < ROWS; r++) {
      const t = (r + 0.5) / ROWS;           // andel upp längs sluttningen
      const half = B * (1 - t);             // halva bredden på den här höjden
      const count = Math.max(1, Math.round((half * 2) / 0.3));
      const w = (half * 2) / count;
      for (let i = 0; i < count; i++) {
        const offset = r % 2 ? 0.5 : 0;
        let x = -half + (i + 0.5 + offset * 0.5) * w;
        if (Math.abs(x) > half - w * 0.3) x = Math.sign(x) * (half - w * 0.5);
        const shingle = box(w * 0.94, 0.035, (slant / ROWS) * 1.35, shades[Math.floor(rand() * shades.length)]);
        shingle.position.set(x, y0 + h * t + 0.03, B * (1 - t) + 0.03);
        shingle.rotation.set(slope + 0.07 + (rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.05);
        face.add(shingle);
      }
    }
    // Takfot: en bräda längs kanten och bjälkändar som sticker ut under
    const fascia = box(B * 2 + 0.1, 0.12, 0.05, PALETTE.woodDark);
    fascia.position.set(0, y0 - 0.04, B + 0.06);
    face.add(fascia);
    for (let i = 0; i < 4; i++) {
      const rafter = box(0.1, 0.1, 0.32, PALETTE.wood);
      rafter.position.set(-B * 0.75 + i * B * 0.5, y0 - 0.12, B - 0.05);
      face.add(rafter);
    }
    roof.add(face);
    // Ås längs varje hörn
    const ridge = box(0.09, 0.07, Math.hypot(slant, B) * 1.0, PALETTE.woodDark);
    const corner = new THREE.Group();
    corner.rotation.y = (side * Math.PI) / 2 + Math.PI / 4;
    ridge.position.set(0, y0 + h / 2 + 0.05, (B * Math.SQRT2) / 2);
    ridge.rotation.x = Math.atan2(h, B * Math.SQRT2);
    corner.add(ridge);
    roof.add(corner);
  }
  // Spira med knopp högst upp
  const spire = mesh(new THREE.ConeGeometry(0.06, 0.5, 6), PALETTE.gold);
  spire.position.y = y0 + h + 0.2;
  roof.add(spire);
  const knob = mesh(new THREE.SphereGeometry(0.1, 10, 8), PALETTE.gold);
  knob.position.y = y0 + h + 0.02;
  roof.add(knob);
  return roof;
}

// En platt fläck på marken som tonar ut (ellips). Alfa går från a0 (radie r0) till a1 (radie r1).
function radialPatch(rx, rz, r0, r1, color, a0, a1, y) {
  const SEG = 72;
  const RINGS = 6;
  const pos = [];
  const col = [];
  const index = [];
  const c = new THREE.Color(color);
  for (let ring = 0; ring <= RINGS; ring++) {
    const f = ring / RINGS;
    const r = r0 + (r1 - r0) * f;
    const a = a0 + (a1 - a0) * (f * f * (3 - 2 * f));
    for (let i = 0; i < SEG; i++) {
      const t = (i / SEG) * Math.PI * 2;
      const wob = 1 + Math.sin(t * 7) * 0.015 + Math.sin(t * 3 + 1) * 0.02;
      pos.push(Math.sin(t) * rx * r * wob, y, Math.cos(t) * rz * r * wob);
      col.push(c.r, c.g, c.b, a);
    }
  }
  for (let ring = 0; ring < RINGS; ring++) {
    for (let i = 0; i < SEG; i++) {
      const a = ring * SEG + i;
      const b = ring * SEG + ((i + 1) % SEG);
      index.push(a, a + SEG, b, b, a + SEG, b + SEG);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, transparent: true, depthWrite: false, roughness: 1, side: THREE.DoubleSide,
  }));
  m.receiveShadow = true;
  m.userData.noMerge = true;
  return m;
}

// Småsten och halmtussar utspridda i sanden (riktiga små 3D-bitar, en ritning per sort)
function sandScatter(rx, rz) {
  const rand = seededRandom(913);
  const g = new THREE.Group();
  g.userData.noMerge = true;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const inside = () => {
    for (;;) {
      const x = (rand() * 2 - 1) * rx;
      const z = (rand() * 2 - 1) * rz;
      if ((x / rx) ** 2 + (z / rz) ** 2 < 0.95) return [x, z];
    }
  };
  const PEBBLES = 260;
  const pebbles = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }),
    PEBBLES,
  );
  for (let i = 0; i < PEBBLES; i++) {
    const [x, z] = inside();
    const s = 0.025 + rand() * rand() * 0.07;
    dummy.position.set(x, 0.005, z);
    dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    dummy.scale.set(s * (1 + rand() * 0.6), s * 0.6, s);
    dummy.updateMatrix();
    pebbles.setMatrixAt(i, dummy.matrix);
    const v = 0.35 + rand() * 0.35;
    pebbles.setColorAt(i, color.setRGB(v * 1.05, v, v * 0.92));
  }
  pebbles.receiveShadow = true;
  g.add(pebbles);

  const STRAWS = 420;
  const straw = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.008, 0.006, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.8 }),
    STRAWS,
  );
  let n = 0;
  while (n < STRAWS) {
    // Halmen ligger i små tussar
    const [cx, cz] = inside();
    const count = 4 + Math.floor(rand() * 10);
    for (let k = 0; k < count && n < STRAWS; k++, n++) {
      dummy.position.set(cx + (rand() - 0.5) * 0.3, 0.012 + rand() * 0.01, cz + (rand() - 0.5) * 0.3);
      dummy.rotation.set((rand() - 0.5) * 0.15, rand() * Math.PI, (rand() - 0.5) * 0.2);
      dummy.scale.set(1, 1, 0.08 + rand() * 0.14);
      dummy.updateMatrix();
      straw.setMatrixAt(n, dummy.matrix);
      straw.setColorAt(n, color.setHSL(0.11 + rand() * 0.03, 0.55, 0.45 + rand() * 0.2));
    }
  }
  g.add(straw);
  return g;
}

// ---------- Prispallen ----------
// Tre trappsteg med tyg, guldkant och siffror. Står i mitten och reser sig ur marken när matchen är slut.
// Framsidan är +Z (vänds mot kungen). spot(rank) = var riddaren ska stå (världskoordinater, y = stegets höjd).
const PODIUM_STEPS = [
  { rank: 1, x: 0, h: 1.0, color: 0xb8322f, css: "#9e2a28" },
  { rank: 2, x: -1.35, h: 0.68, color: 0x2f5fb3, css: "#2a4f94" },
  { rank: 3, x: 1.35, h: 0.42, color: 0x3f8a3a, css: "#356f31" },
];
function makePodium() {
  const group = new THREE.Group();
  group.visible = false;
  const inner = new THREE.Group(); // det som reser sig
  group.add(inner);
  const W = 1.3;
  const D = 1.3;

  // Låg träplatta under
  const dais = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.14, 1.9), plankMat(PALETTE.woodDark));
  dais.position.y = 0.07;
  dais.castShadow = dais.receiveShadow = true;
  inner.add(dais);

  for (const step of PODIUM_STEPS) {
    const side = new THREE.MeshStandardMaterial({ color: step.color, roughness: 0.85, map: linenTexture() });
    const front = new THREE.MeshStandardMaterial({ map: podiumTexture(step.css, step.rank, step.h / W), roughness: 0.8 });
    // BoxGeometry-sidor: +x, -x, +y, -y, +z, -z
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, step.h, D), [side, side, side, side, front, side]);
    body.position.set(step.x, 0.14 + step.h / 2, 0);
    body.castShadow = body.receiveShadow = true;
    inner.add(body);
    // Ek-skiva överst och guldlist runt kanten
    const top = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.07, D + 0.1), plankMat(PALETTE.woodLight));
    top.position.set(step.x, 0.14 + step.h + 0.035, 0);
    top.castShadow = top.receiveShadow = true;
    inner.add(top);
    const trim = mesh(new THREE.BoxGeometry(W + 0.12, 0.05, D + 0.12), PALETTE.gold);
    trim.position.set(step.x, 0.14 + step.h - 0.02, 0);
    inner.add(trim);
    // Tygflikar som hänger ner på sidorna
    for (const sx of [-1, 1]) {
      const valance = new THREE.Mesh(
        new THREE.PlaneGeometry(D + 0.1, 0.2),
        new THREE.MeshStandardMaterial({ color: step.color, alphaMap: daggedTexture(), alphaTest: 0.5, side: THREE.DoubleSide, map: linenTexture() }),
      );
      valance.rotation.y = Math.PI / 2;
      valance.position.set(step.x + sx * (W / 2 + 0.065), 0.14 + step.h - 0.12, 0);
      inner.add(valance);
    }
  }
  // Fanor bakom pallen
  for (const x of [-2.1, 2.1]) {
    const flag = makeFlag(x < 0 ? PALETTE.blue : PALETTE.red);
    flag.scale.setScalar(1.6);
    flag.position.set(x, 0.14, -0.8);
    inner.add(flag);
  }

  // Röd matta fram mot kungen (ligger på marken, syns bara när pallen är uppe)
  const carpet = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 7),
    new THREE.MeshStandardMaterial({ color: 0x8e1f1d, roughness: 0.95, map: linenTexture() }),
  );
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(0, 0.018, 0.95 + 3.5);
  carpet.receiveShadow = true;
  carpet.scale.y = 0.001;
  group.add(carpet);

  const SINK = 1.4;
  let t = -1;      // tid sedan pallen började resa sig (-1 = gömd)
  inner.position.y = -SINK;
  const spotVec = new THREE.Vector3();
  return {
    group,
    rising: () => t >= 0 && t < 1.6,
    show() {
      group.visible = true;
      t = 0;
    },
    hide() {
      group.visible = false;
      t = -1;
      inner.position.y = -SINK;
      carpet.scale.y = 0.001;
    },
    update(dt) {
      if (t < 0) return;
      t += dt;
      const f = Math.min(1, t / 1.6);
      const ease = 1 - (1 - f) ** 3;
      inner.position.y = -SINK * (1 - ease) + Math.sin(Math.min(1, t / 1.6) * Math.PI * 3) * 0.015 * (1 - f);
      carpet.scale.y = Math.max(0.001, Math.min(1, (t - 0.8) / 1.2));
      carpet.position.z = 0.95 + 3.5 * carpet.scale.y;
    },
    // Var riddaren med placering 1–3 ska stå (världskoordinater)
    spot(rank) {
      const step = PODIUM_STEPS[rank - 1];
      group.updateMatrixWorld(true);
      spotVec.set(step.x, 0.14 + step.h + 0.07, 0.05).applyMatrix4(group.matrixWorld);
      return spotVec.clone();
    },
    // Riddare som inte kom på pallen står i en halvcirkel framför och applåderar
    crowdSpot(i, n) {
      const a = ((i + 0.5) / Math.max(n, 1) - 0.5) * 2.2;
      group.updateMatrixWorld(true);
      spotVec.set(Math.sin(a) * 3.6, 0, 1.2 + Math.cos(a) * 2.4).applyMatrix4(group.matrixWorld);
      return spotVec.clone();
    },
    // Vilket håll riddarna på pallen tittar åt
    yaw: () => group.rotation.y,
  };
}

// Flaggstång med en tygflagga som fladdrar. Origo = stångens fot.
function makeFlag(color) {
  const flag = new THREE.Group();
  const pole = box(0.07, 1.6, 0.07, PALETTE.woodDark);
  pole.position.y = 0.8;
  const knob = mesh(new THREE.SphereGeometry(0.06, 8, 6), PALETTE.gold);
  knob.position.y = 1.62;
  const geo = new THREE.PlaneGeometry(0.85, 0.45, 12, 2);
  geo.translate(0.425 + 0.035, 0, 0); // vänsterkanten sitter vid stången
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide }));
  cloth.position.y = 1.35;
  cloth.castShadow = true;
  cloth.userData.noMerge = true;
  cloth.userData.base = Float32Array.from(geo.attributes.position.array);
  cloth.userData.phase = Math.random() * 10;
  wavingFlags.push(cloth);
  flag.add(pole, knob, cloth);
  return flag;
}

// Låter en flaggduk böja sig i vågor, mer ju längre från stången
function waveFlag(cloth, time) {
  const pos = cloth.geometry.attributes.position;
  const base = cloth.userData.base;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3];
    const y = base[i * 3 + 1];
    const away = Math.max(0, x - 0.035);
    pos.array[i * 3 + 2] = Math.sin(away * 7 - time * 6 + cloth.userData.phase) * 0.07 * away + Math.sin(y * 4 + time * 3) * 0.01;
  }
  pos.needsUpdate = true;
  cloth.geometry.computeVertexNormals();
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
