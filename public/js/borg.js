// KUNGABORGEN – den tredje banan: borgen som byggdes i Blender.
//
// Modellen (models/borg.glb) är exporterad från Blender med namngivna material (BO_Mur, BO_Tra ...).
// Blenders egna materialnoder följer inte med, så här byts varje material mot ett spelmaterial med
// enkla, upprepade bildtexturer. Kartan i Blender har 1 UV-enhet = 1 meter, så texturerna skalas efter
// hur många meter en bild ska täcka.
//
// Stridsytan är samma oval som på de andra banorna (servern räknar likadant), och borgens skrank
// står precis utanför den. Publiken sitter på borgens läktare, kungen och drottningen i kungalogen.

import * as THREE from "three";
import { ARENA_RX, ARENA_RZ } from "./shared.js";
import { Crowd, makeRoyals } from "./crowd.js";
import {
  seededRandom, makePodium, makeQuintain, mergeStatic, makeSky, setSkyColors, makeCloud, getCloudMaterial, updateClouds,
} from "./arena.js";
import { plankTexture, linenTexture, rakedSandTexture, sandGrainTexture, strawTexture } from "./textures.js";
import { stoneMat, STONE_TILE } from "./castle.js";

const MODEL_URL = "models/borg.glb";
// Blenders borg är byggd i meter men skranket är lite för trångt för ovalen: skala upp hela borgen
const S = 1.12;
// Blender (x, y = norrut, z = upp) -> spelet. Borgen vrids ett halvt varv så att kungalogen hamnar på +z.
const B = (x, y, z) => new THREE.Vector3(-x * S, z * S, y * S);

// ---------- Små bildtexturer (ritas en gång) ----------
const texCache = new Map();
function canvasTex(key, w, h, draw, srgb = true) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
// Takpannor/skiffer/spån: rader som ligger omlott, mörkare nedtill på varje rad (vit bas, färgas av materialet)
function tilesTexture() {
  return canvasTex("borg-tiles", 256, 256, (ctx, w, h) => {
    const rand = seededRandom(91);
    const rows = 4;
    const rh = h / rows;
    ctx.fillStyle = "#3a3a3a";
    ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < rows; r++) {
      const tw = w / 3;
      let x = r % 2 ? -tw / 2 : 0;
      while (x < w) {
        const v = 190 + rand() * 60;
        const g = ctx.createLinearGradient(0, r * rh, 0, (r + 1) * rh);
        g.addColorStop(0, `rgb(${v},${v},${v})`);
        g.addColorStop(1, `rgb(${v * 0.72},${v * 0.72},${v * 0.72})`);
        ctx.fillStyle = g;
        ctx.fillRect(x + 2, r * rh + 1, tw - 4, rh - 3);
        x += tw;
      }
    }
  });
}
// Korsvirke: kalkputs mellan mörka bjälkar (3,2 x 2,6 m per bild)
function timberTexture() {
  return canvasTex("borg-timber", 320, 260, (ctx, w, h) => {
    const rand = seededRandom(17);
    ctx.fillStyle = "#e6dcc6";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = rand() * w, y = rand() * h, r = 4 + rand() * 18;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(150,130,100,${0.05 + rand() * 0.08})`);
      g.addColorStop(1, "rgba(150,130,100,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.fillStyle = "#3e2c1e";
    const t = 17; // 17 cm bjälkar
    for (const x of [0, w / 2]) ctx.fillRect(x, 0, t, h);
    for (const y of [0, h / 2]) ctx.fillRect(0, y, w, t);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    for (const x of [0, w / 2]) ctx.fillRect(x + t, 0, 2, h);
  });
}
// Kullersten (2 m per bild) och stenhällar (3 m per bild)
function cobbleTexture(big = false) {
  return canvasTex(big ? "borg-flags" : "borg-cobble", 256, 256, (ctx, w, h) => {
    const rand = seededRandom(big ? 5 : 3);
    ctx.fillStyle = "#4a443c";
    ctx.fillRect(0, 0, w, h);
    const rows = big ? 4 : 7;
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rand() * rh;
      while (x < w) {
        const sw = rh * (big ? 1.3 + rand() * 0.6 : 0.9 + rand() * 0.5);
        const v = 150 + rand() * 70;
        ctx.fillStyle = `rgb(${v},${v * 0.97},${v * 0.92})`;
        const pad = big ? 3 : 4;
        const rx = x + pad, ry = r * rh + pad, ww = sw - pad * 2, hh = rh - pad * 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(rx, ry, ww, hh, big ? 3 : 7);
        else ctx.rect(rx, ry, ww, hh);
        ctx.fill();
        x += sw;
      }
    }
  });
}
// Baner: grundfärg, fållkant och ett enkelt motiv (bilden täcker hela duken)
function bannerTexture(base, trim, motif) {
  return canvasTex(`borg-banner-${base}-${motif}`, 128, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = trim;
    const b = 9;
    ctx.fillRect(0, 0, w, b); ctx.fillRect(0, h - b, w, b); ctx.fillRect(0, 0, b, h); ctx.fillRect(w - b, 0, b, h);
    if (motif === "stripe") ctx.fillRect(w / 2 - 11, 0, 22, h);
    else if (motif === "fess") ctx.fillRect(0, h * 0.4, w, 22);
    else { ctx.beginPath(); ctx.arc(w / 2, h * 0.4, 23, 0, Math.PI * 2); ctx.fill(); }
    const rand = seededRandom(7);
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rand() * 0.06})`;
      ctx.fillRect(rand() * w, rand() * h, 1, 2);
    }
  });
}
// Ett eget exemplar av en delad textur (egen upprepning) som täcker "tile" meter
function tiled(base, tileU, tileV = tileU, rot = 0) {
  const t = base.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tileU, 1 / tileV);
  t.rotation = rot;
  return t;
}

// ---------- Materialen (efter namnen i Blender) ----------
function buildMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, ...o });
  const plank = (color, tile, vertical = false, extra = {}) =>
    std({ color, map: tiled(plankTexture(), tile, tile, vertical ? Math.PI / 2 : 0), roughness: 0.82, ...extra });
  const tile = (color) => std({ color, map: tiled(tilesTexture(), 1.0), roughness: 0.8 });
  const cloth = (color, tex) => std({ color, map: tex, roughness: 0.92, side: THREE.DoubleSide });
  const linen = (color) => std({ color, map: tiled(linenTexture(), 1.0), roughness: 0.92, side: THREE.DoubleSide });
  const sand = std({ color: 0xcdb08a, map: tiled(rakedSandTexture(), 7), bumpMap: tiled(sandGrainTexture(), 1.2), bumpScale: 1.6, roughness: 1 });
  sand.userData.dryColor = sand.color.clone();
  const M = {
    // Sten: samma stenmaterial som borggården (med variation i världskoordinater), i tre toner
    BO_Mur: { mat: stoneMat(0xb2aa9e), stone: true },
    BO_Karna: { mat: stoneMat(0xd2c9b8), stone: true },
    BO_Port: { mat: stoneMat(0xd0a27c), stone: true },
    BO_Service: { mat: std({ color: 0xffffff, map: tiled(timberTexture(), 3.2, 2.6) }) },
    BO_Gard: { mat: std({ color: 0xa49c90, map: tiled(cobbleTexture(), 2.0), roughness: 0.92 }) },
    BO_Hallar: { mat: std({ color: 0xb4ad9f, map: tiled(cobbleTexture(true), 3.0), roughness: 0.88 }) },
    BO_Tak_Skiffer: { mat: tile(0x6a6e76) },
    BO_Tak_Tegel: { mat: tile(0xb0623e) },
    BO_Tak_Spon: { mat: tile(0x8e7a62) },
    BO_Tra: { mat: plank(0x7c5a3a, 1.2, true) },
    BO_Publik: { mat: plank(0xa07f58, 1.2) },
    BO_Barriar: { mat: plank(0xb8956a, 1.2) },
    BO_Dorr: { mat: plank(0x553a24, 0.9, true) },
    BO_Jarn: { mat: std({ color: 0x3c3c40, metalness: 0.7, roughness: 0.45 }) },
    BO_Eld: { mat: new THREE.MeshBasicMaterial({ color: 0xffb050 }), noShadow: true },
    BO_Fonster: { mat: std({ color: 0x101216, roughness: 0.3 }) },
    BO_Arena: { mat: sand },
    BO_Vag: { mat: std({ color: 0x8e7658, map: tiled(rakedSandTexture(), 5), roughness: 1 }) },
    BO_Mark: { mat: std({ color: 0x5e6c40, map: tiled(sandGrainTexture(), 3), roughness: 1 }) },
    BO_Grav: { mat: std({ color: 0x4a5640, roughness: 1 }) },
    BO_Ho: { mat: std({ color: 0xd2b264, map: tiled(strawTexture(), 1.0), roughness: 1 }) },
    BO_Baner_Bla: { mat: linen(0x2a4a96) },
    BO_Baner_Rod: { mat: linen(0xa4302a) },
    BO_Baner_Kung: { mat: linen(0xc89a30) },
    BO_Tyg_Kung: { mat: cloth(0xffffff, bannerTexture("#b8892a", "#6e1712", "circle")), uv01: true },
    BO_Tyg_Bla: { mat: cloth(0xffffff, bannerTexture("#22407e", "#c9a440", "stripe")), uv01: true },
    BO_Tyg_Rod: { mat: cloth(0xffffff, bannerTexture("#962820", "#c9a440", "fess")), uv01: true },
  };
  return M;
}

// ---------- En liten GLB-läsare (borgen har bara enkla mesher: position, normal, UV, index) ----------
async function loadGlb(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("inte en glb-fil");
  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, start, len)));
    else if (type === 0x004e4942) bin = buf.slice(start, start + len);
    off = start + len;
  }
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const arrays = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array };
  const accessor = (i) => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const Arr = arrays[a.componentType];
    const n = comps[a.type];
    return new THREE.BufferAttribute(new Arr(bin, (bv.byteOffset || 0) + (a.byteOffset || 0), a.count * n), n);
  };
  const meshes = json.meshes.map((m) => m.primitives.map((p) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", accessor(p.attributes.POSITION));
    if (p.attributes.NORMAL !== undefined) g.setAttribute("normal", accessor(p.attributes.NORMAL));
    if (p.attributes.TEXCOORD_0 !== undefined) g.setAttribute("uv", accessor(p.attributes.TEXCOORD_0));
    if (p.indices !== undefined) g.setIndex(accessor(p.indices));
    // Alla delar måste ha samma attribut för att kunna slås ihop
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    return { geometry: g, material: json.materials[p.material]?.name || "BO_Mur" };
  }));
  return json.nodes.filter((n) => n.mesh !== undefined).map((n) => ({
    name: n.name,
    parts: meshes[n.mesh],
    t: n.translation || [0, 0, 0],
    r: n.rotation || [0, 0, 0, 1],
    s: n.scale || [1, 1, 1],
  }));
}

// Bröstvärnet framför kungalogen går från golvet (z 3,27) till z 4,2 i Blender. Det sänks till z 3,78,
// så kungaparet syns från midjan och uppåt. Fanorna under det kortas lika mycket i överkanten.
const PARAPET_TOP = 4.2, PARAPET_NEW = 3.78;
// Tronerna lyfts upp på en tronpall och flyttas fram, så att kungaparet syns från planen
const THRONE_LIFT = 0.6, THRONE_FWD = 0.5;
function lowerRoyalParapet(n) {
  for (const part of n.parts) {
    const pos = part.geometry.attributes.position;
    const a = new Float32Array(pos.array);
    for (let i = 0; i < pos.count; i++) {
      // glTF-koordinater: Blender z = y, Blender y = -z (plus nodens förflyttning)
      const bz = a[i * 3 + 1] * n.s[1] + n.t[1];
      const by = -(a[i * 3 + 2] * n.s[2] + n.t[2]);
      if (Math.abs(bz - PARAPET_TOP) < 0.05 && by > 11.8 && by < 12.35) a[i * 3 + 1] = (PARAPET_NEW - n.t[1]) / n.s[1];
    }
    part.geometry = part.geometry.clone();
    part.geometry.setAttribute("position", new THREE.BufferAttribute(a, 3));
  }
}

// ---------- Publikplatser: borgens läktare, adelsläktarna och ståplatserna ----------
function crowdSpots() {
  const spots = [];
  const rand = seededRandom(2024);
  const face = (p) => Math.atan2(-p.x, -p.z * 0.55); // mot planen (lite mer rakt fram än mot mitten)
  const seat = (bx, by, bz, row, standing = false) => {
    const pos = B(bx, by, bz);
    spots.push({ pos, yaw: face(pos), row, standing });
  };
  // Sidoläktarna öst och väst: fyra rader, 1 m djupa, 0,6 m höga steg
  for (const sg of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      for (let y = -1.85; y <= 7.75; y += 0.6) {
        if (rand() < 0.78) seat(sg * (16.05 + i) + (rand() - 0.5) * 0.06, y + (rand() - 0.5) * 0.1, 1.2 + 0.6 * i, i);
      }
    }
  }
  // Adelsläktarna på övre gården (tre rader på var sida om kungalogen)
  for (const [xa, xb] of [[-12.8, -8.8], [8.7, 16.7]]) {
    for (let i = 0; i < 3; i++) {
      for (let x = xa; x <= xb; x += 0.62) if (rand() < 0.82) seat(x, 13.85 + 0.9 * i, 1.4 + 0.45 * (i + 1), i);
    }
  }
  // Ståplatser på södra sidan (två låga steg på var sida om paradvägen)
  for (const sx of [-1, 1]) {
    for (const [y, z] of [[-10.9, 0.35], [-12.1, 0.7]]) {
      for (let x = 3.5; x <= 11.2; x += 0.62) if (rand() < 0.7) seat(sx * x, y + (rand() - 0.5) * 0.2, z, 3, true);
    }
  }
  return spots;
}

export function buildBorgArena() {
  const group = new THREE.Group();
  const colliders = [];
  const rand = seededRandom(99);

  // Marken långt bort (borgens egen mark är 200 m bred) och himlen
  const far = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0x55613c, roughness: 1 }));
  far.rotation.x = -Math.PI / 2;
  far.position.y = -2.9;
  group.add(far);
  const sky = makeSky();
  group.add(sky);
  for (let i = 0; i < 12; i++) {
    const t = rand() * Math.PI * 2;
    const r = 130 + rand() * 80;
    const cloud = makeCloud(rand);
    cloud.position.set(Math.sin(t) * r, 42 + rand() * 25, Math.cos(t) * r);
    group.add(cloud);
  }
  const deck = new THREE.Group();
  deck.visible = false;
  deck.userData.noMerge = true;
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2;
    const c = makeCloud(rand, "deck");
    c.position.set(Math.sin(t) * (70 + rand() * 60), 32 + rand() * 8, Math.cos(t) * (70 + rand() * 60));
    deck.add(c);
  }
  group.add(deck);

  // Borgen (laddas medan man är i lobbyn)
  const model = new THREE.Group();
  model.rotation.y = Math.PI;
  model.scale.setScalar(S);
  model.userData.noMerge = true;
  group.add(model);
  const M = buildMaterials();
  const ready = loadGlb(MODEL_URL).then((nodes) => {
    const scaled = new Set();
    const holder = new THREE.Group();
    for (const n of nodes) {
      // Kungalogens bröstvärn är så högt att det döljer kungaparet: sänk det till ett lågt räcke
      if (n.name === "Kungaloge" || n.name.startsWith("Baner_Kungaloge")) lowerRoyalParapet(n);
      // Tronerna flyttas fram och upp på en tronpall (glTF: y = upp, z = mot planen)
      if (n.name === "Kungaloge_Stolar" || n.name === "Kungaloge_Dynor") n.t = [n.t[0], n.t[1] + THRONE_LIFT, n.t[2] + THRONE_FWD];
      for (const part of n.parts) {
        const spec = M[part.material] || M.BO_Mur;
        // Stenen ritas med en bild per STONE_TILE meter; UV i Blender = meter
        if (!scaled.has(part.geometry)) {
          scaled.add(part.geometry);
          const uv = part.geometry.attributes.uv;
          if (uv && spec.stone) {
            const a = new Float32Array(uv.array);
            for (let i = 0; i < a.length; i++) a[i] /= STONE_TILE;
            part.geometry.setAttribute("uv", new THREE.BufferAttribute(a, 2));
          }
        }
        const mesh = new THREE.Mesh(part.geometry, spec.mat);
        mesh.position.fromArray(n.t);
        mesh.quaternion.fromArray(n.r);
        mesh.scale.fromArray(n.s);
        mesh.castShadow = !spec.noShadow && !/^Mark_|Skrankgang|Stridsyta|Paradvag|Kampevag|Tillfartsvag|Golv/.test(n.name);
        mesh.receiveShadow = true;
        holder.add(mesh);
      }
    }
    // Slå ihop allt per material: några tiotal ritanrop i stället för flera hundra
    const merged = mergeStatic(holder);
    model.add(merged);
    model.updateMatrixWorld(true);
    return true;
  }).catch((err) => {
    console.warn("Kunde inte ladda borgen:", err);
    // Reserv: en enkel sandplan så att man ändå kan spela
    const field = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), M.BO_Arena.mat);
    field.rotation.x = -Math.PI / 2;
    field.receiveShadow = true;
    group.add(field);
    return false;
  });

  // Varma ljuspunkter (facklor) – tas in i spelets ljuspool som på de andra banorna
  const torches = [];
  for (const [x, y, z, power] of [
    [0, -17.0, 3.0, 2.2], [2.75, -26.95, 3.85, 1.2], [-2.75, -26.95, 3.85, 1.2], [0, 13.6, 6.6, 1.6],
    [13.05, -5.0, 2.9, 1.0], [-13.05, -5.0, 2.9, 1.0], [-15.7, -14.4, 1.4, 1.4],
  ]) {
    const l = new THREE.PointLight(0xffa860, power, 8, 1.6);
    l.position.copy(B(x, y, z));
    l.castShadow = false;
    l.userData.base = power;
    group.add(l);
    torches.push(l);
  }

  // Publiken
  const crowd = new Crowd(crowdSpots(), 31);
  group.add(crowd.group);

  // Kungen och drottningen på stolarna i kungalogen, härolden framme vid bröstvärnet, vakter på sidorna
  const royals = makeRoyals();
  const place = (fig, p, yaw = Math.PI) => {
    fig.group.position.copy(p);
    fig.group.rotation.y = yaw;
    fig.group.userData.noMerge = true;
    group.add(fig.group);
  };
  place(royals.king, B(-0.9, 13.92 - THRONE_FWD, 3.73 + THRONE_LIFT));
  place(royals.queen, B(0.9, 13.92 - THRONE_FWD, 3.73 + THRONE_LIFT));
  // Tronpallen: en träpall med röd matta under tronerna
  {
    const dais = new THREE.Mesh(new THREE.BoxGeometry(3.3 * S, THRONE_LIFT * S, 1.5 * S), M.BO_Tra.mat);
    dais.position.copy(B(0, 13.6, 3.27 + THRONE_LIFT / 2));
    dais.castShadow = dais.receiveShadow = true;
    group.add(dais);
    const carpet = new THREE.Mesh(new THREE.BoxGeometry(2.9 * S, 0.03, 1.5 * S + 0.02), new THREE.MeshStandardMaterial({ color: 0x7a1a22, roughness: 0.95 }));
    carpet.position.copy(B(0, 13.6, 3.27 + THRONE_LIFT)).add(new THREE.Vector3(0, 0.015, 0));
    carpet.receiveShadow = true;
    group.add(carpet);
    // Ett trappsteg framför pallen
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.4 * S, 0.3 * S, 0.4 * S), M.BO_Tra.mat);
    step.position.copy(B(0, 12.65, 3.27 + 0.15));
    step.castShadow = step.receiveShadow = true;
    group.add(step);
  }
  place(royals.herald, B(2.7, 12.75, 3.2), Math.PI + 0.25);
  place(royals.guards[0], B(-4.5, 13.75, 1.4));
  place(royals.guards[1], B(4.5, 13.75, 1.4));
  // Kungaparet görs lite större så att de syns från planen, och logen får ett varmt ljus under taket
  royals.king.group.scale.setScalar(1.18);
  royals.queen.group.scale.setScalar(1.18);
  const logeLight = new THREE.PointLight(0xffc890, 2.4, 7, 1.4);
  logeLight.position.copy(B(0, 12.6, 5.6));
  logeLight.userData.base = 2.4;
  group.add(logeLight);
  torches.push(logeLight);

  // Träningsdockan (som på de andra banorna) och prispallen mitt på planen
  const quintain = makeQuintain();
  quintain.group.position.set(-10.6, 0, 3.6);
  group.add(quintain.group);
  colliders.push({ minX: -10.6 - 0.22, maxX: -10.6 + 0.22, minZ: 3.6 - 0.22, maxZ: 3.6 + 0.22 });
  const podium = makePodium();
  podium.group.rotation.y = Math.PI;
  group.add(podium.group);

  let excitement = 0;
  let time = 0;
  const focus = new THREE.Vector3();
  const update = (dt, focusPoint = null) => {
    time += dt;
    excitement = Math.max(0, excitement - dt * 0.35);
    if (focusPoint) focus.lerp(focusPoint, Math.min(1, dt * 2));
    crowd.setFocus(focus);
    crowd.update(dt, time, excitement);
    royals.update(dt);
    podium.update(dt);
    quintain.update(dt);
    updateClouds(dt);
    for (const l of torches) {
      const s = l.position.x * 3.1 + l.position.z;
      l.intensity = l.userData.base * l.userData.boost * (0.9 + Math.sin(time * 11 + s) * 0.06 + Math.sin(time * 23 + s) * 0.04);
    }
  };
  for (const l of torches) l.userData.boost = 1;

  return {
    kind: "borg",
    group, colliders, update, quintain, podium, ready,
    cheer: (strength = 1) => (excitement = Math.min(1.5, excitement + strength)),
    royalReact: (up) => royals.react(up),
    heraldBlow: () => royals.blow(),
    kingThrow: (onRelease) => royals.throwBow(onRelease),
    setQuality(low) {
      for (const l of torches) l.visible = !low || l === torches[0];
    },
    // Regn: blötare, mörkare sand
    setWet(wet) {
      const sand = M.BO_Arena.mat;
      sand.color.copy(sand.userData.dryColor).multiplyScalar(wet ? 0.72 : 1);
      sand.roughness = wet ? 0.75 : 1;
    },
    setOvercast(on) {
      this.overcast = on;
      deck.visible = on;
      const cm = getCloudMaterial();
      if (on) {
        sky.material.uniforms.top.value.set(this.evening ? 0x2c2e3a : 0x7a8492);
        sky.material.uniforms.horizon.value.set(this.evening ? 0x55505a : 0xc0c6cc);
        if (cm) cm.color.set(this.evening ? 0x5a5660 : 0xb0b6be);
      } else {
        this.setTime(!!this.evening);
      }
    },
    setTime(evening) {
      this.evening = evening;
      setSkyColors(sky, evening);
      const cm = getCloudMaterial();
      if (cm) cm.color.set(evening ? 0xf0b090 : 0xffffff);
      for (const l of torches) {
        l.userData.boost = evening ? 2.4 : 1;
        l.distance = evening ? 11 : 8;
      }
    },
  };
}
