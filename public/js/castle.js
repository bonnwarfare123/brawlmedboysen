// BORGGÅRDEN – den andra banan: en borggård i vinter.
//
// Samma stridsyta som tornerplatsen (så striden, botarna och servern fungerar likadant), men runt om:
// en låg stenmur, en snöig gård med eldkorgar, tunnor och ställningar, en hög ringmur med tinnar där
// publiken står, sex runda torn med snötäckta tak och ett porttorn med fällgaller som riddarna
// marscherar ut genom när matchen börjar.

import * as THREE from "three";
import { ARENA_RX, ARENA_RZ } from "./shared.js";
import { Crowd, makeRoyals } from "./crowd.js";
import {
  PALETTE, mat, mesh, box, ellipsePoint, seededRandom, makeBrazier, makePodium, makeQuintain, mergeStatic,
  makeCloud, makeStand, makeRoyalBox, makeBarrels, makeCrates, makeWeaponRack, makeFlag, waveFlag,
  heraldBanner, makeSky, setSkyColors, resetFlags, getCloudMaterial, radialPatch, sandScatter, updateClouds,
} from "./arena.js";
import { rakedSandTexture, sandGrainTexture, trampledTexture } from "./textures.js";

const STONE = 0xa8a29a;
const STONE_DARK = 0x8c867e;
const SNOW = 0xf4f6fa;
const GATE_T = Math.PI; // porten ligger på baksidan

// Snöig mark: vit med blågrå skuggor, fotspår och lite grus som skymtar fram
function snowTexture(size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const rand = seededRandom(707);
  ctx.fillStyle = "#e9edf3";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 2 + rand() * 14;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = rand() < 0.75 ? "200,210,226" : "160,150,140";
    g.addColorStop(0, `rgba(${tone},${0.18 + rand() * 0.2})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.5})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Snö ovanpå stridsytan: genomskinlig i mitten, snödrivor och snöfläckar mot kanten, slask däremellan
function snowEdgeTexture(size = 1024) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const rand = seededRandom(909);
  const h = size / 2;
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 2200; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand());
    const edge = Math.pow(d, 3);
    if (rand() > edge * 1.2 + 0.02) continue;
    const x = h + Math.cos(a) * d * h;
    const y = h + Math.sin(a) * d * h;
    const r = 4 + rand() * 20 * (0.3 + edge);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + (rand() - 0.5));
    ctx.scale(1, 0.3 + rand() * 0.5);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    const al = 0.25 + edge * 0.55;
    const tone = rand() < 0.25 ? "190,190,195" : "238,242,248"; // smutsig eller ren snö
    g.addColorStop(0, `rgba(${tone},${al})`);
    g.addColorStop(0.65, `rgba(${tone},${al * 0.45})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }
  // snövall längs kanten
  const rim = ctx.createRadialGradient(h, h, h * 0.86, h, h, h);
  rim.addColorStop(0, "rgba(236,240,246,0)");
  rim.addColorStop(0.6, "rgba(236,240,246,0.6)");
  rim.addColorStop(1, "rgba(236,240,246,1)");
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Sten: en skarp bild med stenar i verklig storlek (en bild = 2 x 2 m), tydliga fogar, olika toner,
// sprickor, mossa och frost på stenarnas överkant. En gråskalebild av samma mönster ger fogarna djup.
const TILE = 2.0;
let stoneTex = null;
function stoneTextures() {
  if (stoneTex) return stoneTex;
  const size = 1024;
  const rows = 8; // 25 cm per rad
  const rh = size / rows;
  const col = document.createElement("canvas");
  const bmp = document.createElement("canvas");
  col.width = col.height = bmp.width = bmp.height = size;
  const c = col.getContext("2d");
  const b = bmp.getContext("2d");
  const rand = seededRandom(313);
  c.fillStyle = "#6e6a64"; // fogbruk
  c.fillRect(0, 0, size, size);
  b.fillStyle = "#202020";
  b.fillRect(0, 0, size, size);
  for (let r = 0; r < rows; r++) {
    let x = -rand() * rh;
    while (x < size + rh) {
      const w = rh * (1.25 + rand() * 1.25);
      const v = 150 + rand() * 70;
      const warm = rand() * 14;
      const x0 = x + 4;
      const y0 = r * rh + 4;
      const ww = w - 8;
      const hh = rh - 8;
      // stenen, med lite rundade hörn
      c.fillStyle = `rgb(${v + warm},${v + warm * 0.5},${v - 6})`;
      c.beginPath();
      c.roundRect(x0, y0, ww, hh, 7);
      c.fill();
      // ljusare överkant och mörkare underkant (ser ut att sticka ut)
      const grad = c.createLinearGradient(0, y0, 0, y0 + hh);
      grad.addColorStop(0, "rgba(255,255,255,0.12)");
      grad.addColorStop(0.5, "rgba(255,255,255,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.18)");
      c.fillStyle = grad;
      c.fillRect(x0, y0, ww, hh);
      // ytstruktur
      for (let k = 0; k < 22; k++) {
        c.fillStyle = `rgba(${rand() < 0.5 ? "40,38,34" : "235,232,225"},${0.05 + rand() * 0.08})`;
        c.fillRect(x0 + rand() * ww, y0 + rand() * hh, 2 + rand() * 7, 2 + rand() * 4);
      }
      // ibland en spricka
      if (rand() < 0.18) {
        c.strokeStyle = "rgba(40,36,32,0.55)";
        c.lineWidth = 1.5;
        c.beginPath();
        let cx = x0 + rand() * ww;
        let cy = y0;
        c.moveTo(cx, cy);
        for (let k = 0; k < 5; k++) {
          cx += (rand() - 0.5) * 18;
          cy += hh / 5;
          c.lineTo(cx, cy);
        }
        c.stroke();
      }
      // mossa i nedre stenarna, frost på överkanten av vissa
      if (r >= rows - 2 && rand() < 0.35) {
        c.fillStyle = `rgba(80,96,60,${0.18 + rand() * 0.15})`;
        c.fillRect(x0, y0 + hh * 0.6, ww * (0.3 + rand() * 0.6), hh * 0.4);
      }
      if (rand() < 0.45) {
        c.fillStyle = `rgba(245,248,252,${0.5 + rand() * 0.4})`;
        c.fillRect(x0 + 2, y0, ww * (0.4 + rand() * 0.6), 3 + rand() * 3);
      }
      // höjdkartan: stenen ljus (upphöjd), kanterna mjukt ner mot fogen
      const bv = 180 + rand() * 60;
      b.fillStyle = `rgb(${bv},${bv},${bv})`;
      b.beginPath();
      b.roundRect(x0, y0, ww, hh, 9);
      b.fill();
      for (let k = 0; k < 10; k++) {
        b.fillStyle = `rgba(${rand() < 0.5 ? 0 : 255},0,0,0)`;
      }
      x += w;
    }
  }
  const map = new THREE.CanvasTexture(col);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const bump = new THREE.CanvasTexture(bmp);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  stoneTex = { map, bump };
  return stoneTex;
}
const stoneMats = new Map();
function stoneMat(color = STONE) {
  if (!stoneMats.has(color)) {
    const { map, bump } = stoneTextures();
    stoneMats.set(color, new THREE.MeshStandardMaterial({ color, map, bumpMap: bump, bumpScale: 2.2, roughness: 0.93 }));
  }
  return stoneMats.get(color);
}
// Skala bildkoordinaterna efter formens verkliga mått, så att stenarna blir lika stora överallt
function worldUV(geo, w, h, d) {
  const uv = geo.attributes.uv;
  // BoxGeometry: sidorna i ordningen +x, -x, +y, -y, +z, -z (4 punkter var)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [fu, fv] = dims[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * (fu / TILE), uv.getY(i) * (fv / TILE));
    }
  }
  return geo;
}
function stoneBox(w, h, d, color = STONE) {
  const m = new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, h, d), w, h, d), stoneMat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function stoneCylinder(rTop, rBottom, h, seg, color = STONE) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, false);
  const uv = geo.attributes.uv;
  const around = (2 * Math.PI * Math.max(rTop, rBottom)) / TILE;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * (h / TILE));
  const m = new THREE.Mesh(geo, stoneMat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
// Istappar under en kant
function addIcicles(group, x, y, z, angle, width, rand, n = 4) {
  const iceMat = new THREE.MeshStandardMaterial({ color: 0xdfeefa, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
  for (let k = 0; k < n; k++) {
    const len = 0.12 + rand() * 0.35;
    const ice = new THREE.Mesh(new THREE.ConeGeometry(0.025 + rand() * 0.02, len, 5), iceMat);
    const off = (k / Math.max(1, n - 1) - 0.5) * width + (rand() - 0.5) * 0.1;
    ice.position.set(x + Math.cos(angle) * off, y - len / 2, z - Math.sin(angle) * off);
    ice.rotation.x = Math.PI;
    group.add(ice);
  }
}
// Fackla på väggen (järnhållare, eld och ett sken – inget riktigt ljus, det kostar för mycket)
let torchGlow = null;
function makeWallTorch() {
  const g = new THREE.Group();
  const iron = mat(0x2e2a28);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.35), iron);
  arm.position.set(0, 0, 0.17);
  g.add(arm);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.5, 6), mat(PALETTE.woodDark));
  stick.position.set(0, 0.2, 0.33);
  stick.rotation.x = 0.3;
  g.add(stick);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 6), new THREE.MeshBasicMaterial({ color: 0xffb040 }));
  flame.position.set(0, 0.52, 0.42);
  flame.userData.noMerge = true;
  g.add(flame);
  if (!torchGlow) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,190,110,0.9)");
    gr.addColorStop(1, "rgba(255,150,60,0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    torchGlow = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  }
  const glow = new THREE.Sprite(torchGlow);
  glow.scale.setScalar(1.6);
  glow.position.set(0, 0.5, 0.45);
  g.add(glow);
  g.userData.flame = flame;
  return g;
}

function snowCap(w, d, h = 0.08) {
  const m = mesh(new THREE.BoxGeometry(w + 0.04, h, d + 0.04), SNOW);
  return m;
}

// Ett runt torn med tinnar, skottgluggar och ett snötäckt koniskt tak med en flagga
function makeRoundTower(radius, height, flagColor, flags) {
  const g = new THREE.Group();
  const body = stoneCylinder(radius, radius * 1.06, height, 24);
  body.position.y = height / 2;
  g.add(body);
  // sockel och en stenlist halvvägs upp
  const base = stoneCylinder(radius * 1.12, radius * 1.16, 0.8, 24, STONE_DARK);
  base.position.y = 0.4;
  g.add(base);
  const band = stoneCylinder(radius * 1.08, radius * 1.08, 0.22, 24, STONE_DARK);
  band.position.y = height * 0.55;
  g.add(band);
  // snödriva vid foten
  const drift = mesh(new THREE.TorusGeometry(radius * 1.15, 0.45, 6, 20), SNOW, false);
  drift.rotation.x = Math.PI / 2;
  drift.scale.set(1, 1, 0.45);
  drift.position.y = 0.05;
  g.add(drift);
  // Tinnar runt toppen
  const top = stoneCylinder(radius * 1.12, radius * 1.05, 0.5, 24, STONE_DARK);
  top.position.y = height + 0.1;
  g.add(top);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const m = stoneBox(0.5, 0.55, 0.35);
    m.position.set(Math.sin(a) * radius * 1.08, height + 0.6, Math.cos(a) * radius * 1.08);
    m.rotation.y = a;
    g.add(m);
    const s = snowCap(0.5, 0.35, 0.07);
    s.position.set(Math.sin(a) * radius * 1.08, height + 0.91, Math.cos(a) * radius * 1.08);
    s.rotation.y = a;
    g.add(s);
  }
  // Koniskt tak av takpannor som skymtar fram under snön
  const RH = radius * 1.6;
  const shingle = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.85, flatShading: true });
  const roofDark = new THREE.Mesh(new THREE.ConeGeometry(radius * 1.24, RH, 24, 4), shingle);
  roofDark.position.y = height + 0.35 + RH / 2;
  roofDark.castShadow = true;
  g.add(roofDark);
  for (let k = 0; k < 4; k++) {
    const rr = radius * 1.24 * (1 - (k + 0.5) / 5);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.035, 4, 24), shingle);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = height + 0.35 + RH * ((k + 0.5) / 5);
    g.add(ring);
  }
  const roof = mesh(new THREE.ConeGeometry(radius * 1.2, RH * 0.96, 24), SNOW);
  roof.position.y = height + 0.35 + RH * 0.04 + (RH * 0.96) / 2 + 0.02;
  g.add(roof);
  const roofRim = mesh(new THREE.CylinderGeometry(radius * 1.22, radius * 1.22, 0.12, 18), 0x6a5a4a);
  roofRim.position.y = height + 0.38;
  g.add(roofRim);
  // Skottgluggar
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const w = box(0.14, 0.6, 0.3, 0x1c1a1a);
    w.position.set(Math.sin(a) * radius * 0.98, height * (0.45 + (i % 2) * 0.2), Math.cos(a) * radius * 0.98);
    const sill = stoneBox(0.34, 0.08, 0.36, STONE_DARK);
    sill.position.set(Math.sin(a) * radius * 1.02, height * (0.45 + (i % 2) * 0.2) - 0.34, Math.cos(a) * radius * 1.02);
    sill.rotation.y = a;
    g.add(sill);
    w.rotation.y = a;
    g.add(w);
  }
  const flag = makeFlag(flagColor);
  flag.position.y = height + 0.35 + radius * 1.55;
  flag.scale.setScalar(1.6);
  g.add(flag);
  return g;
}

// Porttornet: valv med fällgaller som kan dras upp, två fanor och facklor
function makeGatehouse() {
  const g = new THREE.Group();
  const W = 7.6;
  const H = 6.6;
  const D = 2.8;
  const OW = 3.4; // portens bredd
  const OH = 4.2; // portens höjd (till valvets topp)
  // Väggen med ett rundbågat valv (en form med ett hål)
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0);
  shape.lineTo(W / 2, 0);
  shape.lineTo(W / 2, H);
  shape.lineTo(-W / 2, H);
  shape.lineTo(-W / 2, 0);
  const hole = new THREE.Path();
  hole.moveTo(-OW / 2, 0);
  hole.lineTo(-OW / 2, OH - OW / 2);
  hole.absarc(0, OH - OW / 2, OW / 2, Math.PI, 0, true);
  hole.lineTo(OW / 2, 0);
  hole.lineTo(-OW / 2, 0);
  shape.holes.push(hole);
  const wallGeo = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, curveSegments: 16 });
  wallGeo.translate(0, 0, -D / 2);
  // UV: stenmönster efter världens mått
  {
    const uv = wallGeo.attributes.uv;
    const p = wallGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + p.getZ(i)) / TILE, p.getY(i) / TILE);
  }
  const wall = new THREE.Mesh(wallGeo, stoneMat(STONE));
  wall.castShadow = wall.receiveShadow = true;
  g.add(wall);
  // Valvets insida (mörkt) och en stenbåge runt öppningen
  const inner = mesh(new THREE.BoxGeometry(OW - 0.05, 0.05, D), 0x3a3634);
  inner.position.set(0, 0.02, 0);
  g.add(inner);
  // Portgången: mörka väggar och ett välvt tak genom hela muren, och en fackla där inne
  const passMat = new THREE.MeshStandardMaterial({ color: 0x4a4640, map: stoneTextures().map, roughness: 1, side: THREE.BackSide });
  const vault = new THREE.Mesh(new THREE.CylinderGeometry(OW / 2 - 0.02, OW / 2 - 0.02, D + 0.02, 16, 1, true, -Math.PI / 2, Math.PI), passMat);
  vault.rotation.x = -Math.PI / 2; // halvcylindern ska bli taket, inte golvet
  vault.position.y = OH - OW / 2;
  g.add(vault);
  for (const sx of [1, -1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(D + 0.02, OH - OW / 2), passMat);
    side.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    side.position.set(sx * (OW / 2 - 0.02), (OH - OW / 2) / 2, 0);
    g.add(side);
  }
  const passTorch = makeWallTorch();
  passTorch.position.set(OW / 2 - 0.05, 2.2, -0.2);
  passTorch.rotation.y = -Math.PI / 2;
  g.add(passTorch);
  const passLight = new THREE.PointLight(0xff9a50, 1.6, 6, 1.6);
  passLight.position.set(0.8, 2.4, 0);
  g.add(passLight);
  // Vindbrygga utanför porten, med kedjor upp till muren
  const bridge = new THREE.Group();
  for (let k = 0; k < 8; k++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(OW - 0.1, 0.1, 0.5), mat(k % 2 ? PALETTE.wood : PALETTE.woodDark));
    plank.position.set(0, 0.05, -D / 2 - 0.25 - k * 0.5);
    plank.castShadow = plank.receiveShadow = true;
    bridge.add(plank);
  }
  const bridgeSnow = mesh(new THREE.BoxGeometry(OW - 0.4, 0.04, 3.6), SNOW, false);
  bridgeSnow.position.set(0, 0.12, -D / 2 - 2.2);
  bridge.add(bridgeSnow);
  for (const sx of [1, -1]) {
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4.6, 5), mat(0x2e2c2a));
    chain.position.set(sx * (OW / 2 - 0.15), 2.4, -D / 2 - 1.9);
    chain.rotation.x = -0.72;
    bridge.add(chain);
  }
  g.add(bridge);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(OW / 2 + 0.12, 0.16, 6, 20, Math.PI), stoneMat(STONE_DARK));
  arch.position.set(0, OH - OW / 2, D / 2 + 0.05);
  g.add(arch);
  // Tinnar på toppen
  for (let x = -W / 2 + 0.35; x <= W / 2 - 0.3; x += 0.95) {
    for (const z of [D / 2 - 0.2, -D / 2 + 0.2]) {
      const m = stoneBox(0.55, 0.6, 0.35);
      m.position.set(x, H + 0.3, z);
      g.add(m);
      const s = snowCap(0.55, 0.35, 0.07);
      s.position.set(x, H + 0.63, z);
      g.add(s);
    }
  }
  const snowTop = mesh(new THREE.BoxGeometry(W, 0.06, D - 0.4), SNOW);
  snowTop.position.y = H + 0.03;
  g.add(snowTop);
  // Fällgaller: järnstänger i ett rutnät som dras upp
  const port = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.55, metalness: 0.6 });
  for (let x = -OW / 2 + 0.2; x <= OW / 2 - 0.15; x += 0.32) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, OH, 0.07), iron);
    bar.position.set(x, OH / 2, 0);
    bar.castShadow = true;
    port.add(bar);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), iron);
    spike.position.set(x, -0.06, 0);
    spike.rotation.x = Math.PI;
    port.add(spike);
  }
  for (let y = 0.4; y < OH; y += 0.42) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(OW, 0.06, 0.06), iron);
    bar.position.set(0, y, 0);
    port.add(bar);
  }
  port.position.z = D / 2 - 0.35;
  port.userData.noMerge = true;
  g.add(port);
  g.userData.port = port;
  // Fanor och facklor på framsidan
  for (const sx of [1, -1]) {
    const banner = heraldBanner(sx > 0 ? PALETTE.red : PALETTE.blue, sx > 0 ? 2 : 3, 0.9, 1.6);
    banner.position.set(sx * (OW / 2 + 1.0), H - 1.4, D / 2 + 0.05);
    g.add(banner);
  }
  return g;
}

// Trästege och ställning längs muren
function makeScaffold(rand) {
  const g = new THREE.Group();
  const w = 2.4 + rand() * 1.2;
  const h = 2.2 + rand() * 1.2;
  for (const x of [-w / 2, w / 2]) {
    for (const z of [0, -0.9]) {
      const post = box(0.12, h, 0.12, PALETTE.woodDark);
      post.position.set(x, h / 2, z);
      g.add(post);
    }
  }
  const deck = box(w + 0.2, 0.08, 1.1, PALETTE.woodLight);
  deck.position.set(0, h, -0.45);
  g.add(deck);
  const snow = snowCap(w + 0.2, 1.1, 0.05);
  snow.position.set(0, h + 0.06, -0.45);
  g.add(snow);
  for (const z of [0, -0.9]) {
    const brace = box(w, 0.08, 0.06, PALETTE.wood);
    brace.position.set(0, h * 0.5, z);
    brace.rotation.z = Math.atan2(h * 0.6, w) * (z ? 1 : -1);
    g.add(brace);
  }
  // Räcke på framsidan, ett rep och en tunna uppe på ställningen
  const rail = box(w, 0.06, 0.06, PALETTE.wood);
  rail.position.set(0, h + 0.75, 0.05);
  g.add(rail);
  const railSnow = snowCap(w, 0.06, 0.03);
  railSnow.position.set(0, h + 0.8, 0.05);
  g.add(railSnow);
  for (let x = -w / 2; x <= w / 2 + 0.01; x += w / 4) {
    const baluster = box(0.05, 0.75, 0.05, PALETTE.woodDark);
    baluster.position.set(x, h + 0.38, 0.05);
    g.add(baluster);
  }
  const rope = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 5, 12), mat(0xa08850));
  rope.rotation.x = Math.PI / 2;
  rope.position.set(-w / 2 + 0.3, h + 0.08, -0.7);
  g.add(rope);
  const barrel = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10), PALETTE.wood);
  barrel.position.set(w / 2 - 0.3, h + 0.3, -0.75);
  g.add(barrel);
  const barrelSnow = mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 10), SNOW, false);
  barrelSnow.position.set(w / 2 - 0.3, h + 0.57, -0.75);
  g.add(barrelSnow);
  // Stege
  const lx = w / 2 + 0.3;
  for (const dx of [-0.2, 0.2]) {
    const rail = box(0.05, h + 0.5, 0.05, PALETTE.wood);
    rail.position.set(lx + dx, (h + 0.5) / 2, 0.25);
    rail.rotation.x = -0.15;
    g.add(rail);
  }
  for (let y = 0.3; y < h; y += 0.35) {
    const rung = box(0.4, 0.04, 0.04, PALETTE.woodLight);
    rung.position.set(lx, y, 0.25 + y * 0.15);
    g.add(rung);
  }
  return { group: g, h, w };
}

// Smedjans hörna: ässja med glöd, städ och ett litet snötäckt tak
function makeForge() {
  const g = new THREE.Group();
  const hearth = stoneBox(1.4, 0.9, 1.0, STONE_DARK);
  hearth.position.y = 0.45;
  g.add(hearth);
  const coals = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.7), new THREE.MeshStandardMaterial({ color: 0x3a1a0a, emissive: 0xff5a10, emissiveIntensity: 1.6 }));
  coals.position.y = 0.93;
  coals.userData.noMerge = true;
  g.add(coals);
  const chimney = stoneBox(0.6, 2.4, 0.6, STONE_DARK);
  chimney.position.set(0, 2.1, -0.3);
  g.add(chimney);
  const anvil = mesh(new THREE.BoxGeometry(0.5, 0.18, 0.22), 0x2e2c2a);
  anvil.position.set(1.3, 0.72, 0.4);
  g.add(anvil);
  const stump = mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.6, 10), PALETTE.woodDark);
  stump.position.set(1.3, 0.3, 0.4);
  g.add(stump);
  for (const x of [-1, 2]) {
    const post = box(0.12, 2.6, 0.12, PALETTE.woodDark);
    post.position.set(x, 1.3, 1.0);
    g.add(post);
  }
  const roof = box(3.4, 0.08, 2.0, PALETTE.wood);
  roof.position.set(0.5, 2.6, 0.2);
  roof.rotation.x = -0.25;
  g.add(roof);
  const roofSnow = snowCap(3.4, 2.0, 0.1);
  roofSnow.position.set(0.5, 2.67, 0.2);
  roofSnow.rotation.x = -0.25;
  g.add(roofSnow);
  const light = new THREE.PointLight(0xff7a30, 2.5, 7, 1.8);
  light.position.set(0, 1.4, 0.6);
  g.add(light);
  return { group: g, light, coals };
}

// Gran med snö på grenarna
function makeSnowPine(rand) {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.15, 0.22, 1.4, 6), PALETTE.woodDark, false);
  trunk.position.y = 0.7;
  g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const r = 1.6 - i * 0.42;
    const cone = mesh(new THREE.ConeGeometry(r, 1.7, 7), 0x2e5038, false);
    cone.position.y = 1.5 + i * 1.0;
    g.add(cone);
    const snow = mesh(new THREE.ConeGeometry(r * 0.8, 0.8, 7), SNOW, false);
    snow.position.y = 1.95 + i * 1.0;
    g.add(snow);
  }
  g.scale.setScalar(0.9 + rand() * 0.8);
  return g;
}

export function buildCastleArena() {
  const group = new THREE.Group();
  const colliders = [];
  const crowdSpots = [];
  const flags = resetFlags();
  const FX = ARENA_RX + 0.7;
  const FZ = ARENA_RZ + 0.7;
  const WX = FX + 6.5; // ringmurens radier
  const WZ = FZ + 6.5;
  const center = new THREE.Vector3();
  const rand = seededRandom(1234);
  const dummy = new THREE.Object3D();

  // ---------- Mark ----------
  const snowTex = snowTexture();
  snowTex.repeat.set(40, 40);
  const snowMat = new THREE.MeshStandardMaterial({ map: snowTex, roughness: 0.9 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), snowMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  // Stridsytan byggs i lager som på tornerplatsen: detaljerad lera (som upprepas tätt, med höjdkarta),
  // fuktigare kant, upptrampad yta, småsten och halm, frusna pölar och snö i drivor längs kanten
  const grain = sandGrainTexture();
  grain.repeat.set(26, 26);
  const fieldMat = new THREE.MeshStandardMaterial({ color: 0x9a8272, roughness: 1, map: rakedSandTexture(), bumpMap: grain, bumpScale: 2.4 });
  fieldMat.map.repeat.set(4, 4);
  fieldMat.userData.dryColor = fieldMat.color.clone();
  const field = new THREE.Mesh(new THREE.CircleGeometry(1, 72), fieldMat);
  field.rotation.x = -Math.PI / 2;
  field.scale.set(FX + 0.4, FZ + 0.4, 1);
  field.position.y = 0.01;
  field.receiveShadow = true;
  group.add(field);
  group.add(radialPatch(FX + 0.4, FZ + 0.4, 0.8, 1.0, 0x3a2c22, 0, 0.6, 0.012));   // blöt slask mot muren
  group.add(radialPatch(FX * 0.6, FZ * 0.6, 0, 1.0, 0x4e3a2c, 0.38, 0, 0.013));  // upptrampad lera i mitten
  group.add(sandScatter(FX, FZ));
  const trampled = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshStandardMaterial({ map: trampledTexture(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }),
  );
  trampled.rotation.x = -Math.PI / 2;
  trampled.scale.set(FX + 0.4, FZ + 0.4, 1);
  trampled.position.y = 0.011;
  trampled.renderOrder = -2;
  trampled.receiveShadow = true;
  trampled.userData.noMerge = true;
  group.add(trampled);
  const snowOverMat = new THREE.MeshStandardMaterial({ map: snowEdgeTexture(), transparent: true, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1.5, opacity: 0.85 });
  const snowOver = new THREE.Mesh(new THREE.CircleGeometry(1, 72), snowOverMat);
  snowOver.rotation.x = -Math.PI / 2;
  snowOver.scale.set(FX + 0.42, FZ + 0.42, 1);
  snowOver.position.y = 0.012;
  snowOver.renderOrder = -1;
  snowOver.receiveShadow = true;
  snowOver.userData.noMerge = true;
  group.add(snowOver);
  // Frusna pölar: blank, ljusblå is
  const iceMat = new THREE.MeshStandardMaterial({ color: 0xa9bccc, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.7, depthWrite: false });
  for (let i = 0; i < 7; i++) {
    const t = rand() * Math.PI * 2;
    const d = 0.35 + rand() * 0.5;
    const ice = new THREE.Mesh(new THREE.CircleGeometry(1, 16), iceMat);
    ice.rotation.x = -Math.PI / 2;
    ice.rotation.z = rand() * 3;
    ice.scale.set(0.4 + rand() * 0.7, 0.25 + rand() * 0.4, 1);
    ice.position.set(Math.sin(t) * FX * d, 0.016, Math.cos(t) * FZ * d);
    ice.renderOrder = -1;
    ice.userData.noMerge = true;
    group.add(ice);
  }
  // Mörk slask där gården möter den höga muren
  group.add(radialPatch(FX + 6.5, FZ + 6.5, 0.9, 0.99, 0x7a7c84, 0, 0.45, 0.012));
  // Snödrivor längs murarna (låga, utdragna klot)
  for (let i = 0; i < 70; i++) {
    const t = rand() * Math.PI * 2;
    if (Math.abs(((t - GATE_T + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.25) continue;
    const near = rand() < 0.5;
    const p = ellipsePoint(t, near ? FX + 0.55 : WX - 0.9, near ? FZ + 0.55 : WZ - 0.9);
    const drift = mesh(new THREE.SphereGeometry(1, 10, 6), SNOW, false);
    drift.scale.set(0.6 + rand() * 1.2, 0.18 + rand() * 0.2, 0.4 + rand() * 0.4);
    drift.position.set(p.x, 0, p.z);
    drift.rotation.y = -t;
    group.add(drift);
  }

  // ---------- Låg stenmur runt stridsytan, med en träport mot porttornet ----------
  const SEGS = 60;
  const pts = [];
  for (let i = 0; i < SEGS; i++) pts.push(ellipsePoint((i / SEGS) * Math.PI * 2, FX, FZ));
  const lowGate = [];
  for (let i = 0; i < SEGS; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % SEGS];
    const t = ((i + 0.5) / SEGS) * Math.PI * 2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const angle = -Math.atan2(b.z - a.z, b.x - a.x);
    if (Math.abs(t - GATE_T) < 0.14) {
      lowGate.push({ mx, mz, angle, len });
      continue;
    }
    const seg = stoneBox(len + 0.04, 0.78, 0.38);
    seg.position.set(mx, 0.39, mz);
    seg.rotation.y = angle;
    group.add(seg);
    const cap = stoneBox(len + 0.06, 0.08, 0.46, STONE_DARK);
    cap.position.set(mx, 0.82, mz);
    cap.rotation.y = angle;
    group.add(cap);
    const snow = snowCap(len, 0.4, 0.06);
    snow.position.set(mx, 0.89, mz);
    snow.rotation.y = angle;
    group.add(snow);
    // Pelare var fjärde bit, med fana på varannan
    if (i % 4 === 0) {
      const pillar = stoneBox(0.5, 1.15, 0.5, STONE_DARK);
      pillar.position.set(a.x, 0.58, a.z);
      pillar.rotation.y = angle;
      group.add(pillar);
      const pc = snowCap(0.5, 0.5, 0.1);
      pc.position.set(a.x, 1.2, a.z);
      pc.rotation.y = angle;
      group.add(pc);
      if (i % 8 === 0) {
        const banner = heraldBanner(i % 16 === 0 ? PALETTE.blue : PALETTE.red, (i / 8) % 4, 0.42, 0.62);
        const inward = new THREE.Vector3(-a.x, 0, -a.z).normalize();
        banner.position.set(a.x + inward.x * 0.27, 0.62, a.z + inward.z * 0.27);
        banner.lookAt(center.x, 0.62, center.z);
        group.add(banner);
      }
    }
  }
  // Träporten i den låga muren (två dörrar som öppnas när riddarna kommer)
  const lowDoors = [];
  {
    const gx = 0;
    const gz = -FZ;
    const half = 1.15;
    for (const sx of [1, -1]) {
      const hinge = new THREE.Group();
      hinge.position.set(gx + sx * half, 0, gz);
      const door = new THREE.Mesh(new THREE.BoxGeometry(half, 0.85, 0.08), mat(PALETTE.wood));
      door.position.set(-sx * half / 2, 0.45, 0);
      door.castShadow = true;
      hinge.add(door);
      for (const y of [0.2, 0.7]) {
        const band = box(half, 0.06, 0.1, 0x2e2a28);
        band.position.set(-sx * half / 2, y, 0);
        hinge.add(band);
      }
      hinge.userData.noMerge = true;
      hinge.userData.sx = sx;
      group.add(hinge);
      lowDoors.push(hinge);
      const post = stoneBox(0.5, 1.3, 0.5, STONE_DARK);
      post.position.set(gx + sx * (half + 0.25), 0.65, gz);
      group.add(post);
      const pc = snowCap(0.5, 0.5, 0.1);
      pc.position.set(gx + sx * (half + 0.25), 1.35, gz);
      group.add(pc);
    }
  }

  // ---------- Ringmuren med tinnar och en gångbana där publiken står ----------
  const WALL_H = 5.2;
  const WSEGS = 72;
  const wpts = [];
  for (let i = 0; i < WSEGS; i++) wpts.push(ellipsePoint((i / WSEGS) * Math.PI * 2, WX, WZ));
  for (let i = 0; i < WSEGS; i++) {
    const a = wpts[i];
    const b = wpts[(i + 1) % WSEGS];
    const t = ((i + 0.5) / WSEGS) * Math.PI * 2;
    if (Math.abs(t - GATE_T) < 0.2) continue; // porttornet står här
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const angle = -Math.atan2(b.z - a.z, b.x - a.x);
    const wall = stoneBox(len + 0.05, WALL_H, 1.6);
    wall.position.set(mx, WALL_H / 2, mz);
    wall.rotation.y = angle;
    group.add(wall);
    {
      const inn = new THREE.Vector3(-mx, 0, -mz).normalize();
      // sockel (mörkare, lite utstående) och en stenlist halvvägs upp
      const plinth = stoneBox(len + 0.06, 0.9, 0.25, STONE_DARK);
      plinth.position.set(mx + inn.x * 0.88, 0.45, mz + inn.z * 0.88);
      plinth.rotation.y = angle;
      group.add(plinth);
      const course = stoneBox(len + 0.06, 0.18, 0.2, STONE_DARK);
      course.position.set(mx + inn.x * 0.86, 3.3, mz + inn.z * 0.86);
      course.rotation.y = angle;
      group.add(course);
      const cs = snowCap(len, 0.2, 0.04);
      cs.position.set(mx + inn.x * 0.86, 3.41, mz + inn.z * 0.86);
      cs.rotation.y = angle;
      group.add(cs);
      // strävpelare med jämna mellanrum
      if (i % 6 === 0) {
        const but = stoneBox(0.8, 3.6, 0.7, STONE_DARK);
        but.position.set(mx + inn.x * 1.1, 1.8, mz + inn.z * 1.1);
        but.rotation.y = angle;
        group.add(but);
        const bt = stoneBox(0.8, 0.5, 0.45, STONE_DARK);
        bt.position.set(mx + inn.x * 1.0, 3.85, mz + inn.z * 1.0);
        bt.rotation.y = angle;
        bt.rotateX(-0.5);
        group.add(bt);
        const bs = snowCap(0.8, 0.5, 0.05);
        bs.position.set(mx + inn.x * 1.12, 3.65, mz + inn.z * 1.12);
        bs.rotation.y = angle;
        group.add(bs);
      }
      // istappar under bröstvärnet och facklor på väggen
      addIcicles(group, mx + inn.x * 0.82, WALL_H - 0.02, mz + inn.z * 0.82, angle, len * 0.8, rand, 2 + Math.floor(rand() * 3));
      if (i % 6 === 3) {
        const torch = makeWallTorch();
        torch.position.set(mx + inn.x * 0.8, 2.4, mz + inn.z * 0.8);
        torch.rotation.y = Math.atan2(inn.x, inn.z);
        group.add(torch);
      }
    }
    // Bröstvärn med tinnar på utsidan
    const out = new THREE.Vector3(mx, 0, mz).normalize();
    const merlon = stoneBox(len * 0.55, 0.75, 0.4, STONE);
    merlon.position.set(mx + out.x * 0.6, WALL_H + 0.37, mz + out.z * 0.6);
    merlon.rotation.y = angle;
    group.add(merlon);
    const ms = snowCap(len * 0.55, 0.4, 0.07);
    ms.position.set(mx + out.x * 0.6, WALL_H + 0.78, mz + out.z * 0.6);
    ms.rotation.y = angle;
    group.add(ms);
    const walk = mesh(new THREE.BoxGeometry(len + 0.05, 0.06, 1.1), SNOW);
    walk.position.set(mx - out.x * 0.2, WALL_H + 0.03, mz - out.z * 0.2);
    walk.rotation.y = angle;
    group.add(walk);
    // Bara några få på gångbanan (vakter och nyfikna som lutar sig mot tinnarna)
    if (rand() < 0.12) {
      crowdSpots.push({ pos: new THREE.Vector3(mx - out.x * 0.35, WALL_H + 0.06, mz - out.z * 0.35), yaw: Math.atan2(-mx, -mz), row: 3, standing: true });
    }
    // Fanor som hänger på murens insida
    if (i % 9 === 4) {
      const banner = heraldBanner(i % 18 === 4 ? PALETTE.blue : PALETTE.red, i % 4, 0.8, 1.6);
      banner.position.set(mx - out.x * 0.82, WALL_H - 0.25, mz - out.z * 0.82);
      banner.lookAt(center.x, WALL_H - 0.25, center.z);
      group.add(banner);
    }
    // Små dörrar i muren
    if (i % 18 === 9) {
      const door = mesh(new THREE.BoxGeometry(1.1, 1.9, 0.1), PALETTE.woodDark);
      door.position.set(mx - out.x * 0.82, 0.95, mz - out.z * 0.82);
      door.rotation.y = angle;
      group.add(door);
      const archTop = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 12, 1, false, 0, Math.PI), mat(PALETTE.woodDark));
      archTop.rotation.set(Math.PI / 2, 0, -angle - Math.PI / 2);
      archTop.position.set(mx - out.x * 0.82, 1.9, mz - out.z * 0.82);
      group.add(archTop);
    }
  }

  // ---------- Porttornet ----------
  const gate = makeGatehouse();
  const gatePos = ellipsePoint(GATE_T, WX, WZ);
  gate.position.copy(gatePos);
  gate.lookAt(center);
  group.add(gate);
  const port = gate.userData.port;

  // ---------- Torn ----------
  const towerTs = [GATE_T - 0.24, GATE_T + 0.24, 0.8, -0.8, 2.15, -2.15];
  towerTs.forEach((t, i) => {
    const tower = makeRoundTower(i < 2 ? 2.0 : 2.3, i < 2 ? 8.2 : 7.4, i % 2 ? PALETTE.red : PALETTE.blue, flags);
    const p = ellipsePoint(t, WX + 0.3, WZ + 0.3);
    tower.position.copy(p);
    group.add(tower);
  });

  // ---------- Gården: eldkorgar, tunnor, lådor, vapenställ, ställningar och smedja ----------
  const fires = [];
  [0.35, 1.25, -1.25, -0.35, GATE_T - 0.42, GATE_T + 0.42].forEach((t, i) => {
    const p = ellipsePoint(t, FX + 1.1, FZ + 1.1);
    const fire = makeBrazier(i);
    fire.group.position.set(p.x, 0, p.z);
    group.add(fire.group);
    fires.push(fire);
  });
  const propTs = [0.12, -0.12, 1.15, -1.18, 2.0, -1.95, 2.45, -2.45];
  propTs.forEach((t, i) => {
    const p = ellipsePoint(t, FX + 2.6 + (i % 2) * 1.6, FZ + 2.6 + (i % 2) * 1.6);
    const prop = i % 3 === 0 ? makeBarrels() : i % 3 === 1 ? makeCrates() : makeWeaponRack();
    prop.position.copy(p);
    prop.lookAt(center);
    group.add(prop);
    // Snö ovanpå
    const s = mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.08, 10), SNOW, false);
    s.position.set(p.x, i % 3 === 2 ? 1.45 : 0.86, p.z);
    s.scale.set(1, 1, 0.7);
    if (i % 3 !== 2) group.add(s);
  });
  // Ställningar med stegar längs muren, med publik på
  [1.3, -1.3, 2.75, -2.75].forEach((t) => {
    const sc = makeScaffold(rand);
    const p = ellipsePoint(t, WX - 1.6, WZ - 1.6);
    sc.group.position.copy(p);
    sc.group.lookAt(center);
    group.add(sc.group);
    sc.group.updateMatrixWorld(true);
    for (let x = -sc.w / 2 + 0.35; x <= sc.w / 2 - 0.3; x += 0.6) {
      const local = new THREE.Vector3(x, sc.h + 0.04, -0.45).applyMatrix4(sc.group.matrixWorld);
      crowdSpots.push({ pos: local, yaw: Math.atan2(-local.x, -local.z), row: 3, standing: true });
    }
  });
  const forge = makeForge();
  {
    const p = ellipsePoint(-2.0, WX - 2.0, WZ - 2.0);
    forge.group.position.copy(p);
    forge.group.lookAt(center);
    group.add(forge.group);
  }
  // Fyra små läktare på gården och kungens loge mitt emot porten
  [1.65, -1.65, 0.62, -0.62].forEach((t, si) => {
    const { stand, spots } = makeStand(si % 2 ? PALETTE.blue : PALETTE.red, si + 5);
    const p = ellipsePoint(t, FX + 2.7, FZ + 2.7);
    stand.position.copy(p);
    stand.lookAt(center);
    group.add(stand);
    stand.updateMatrixWorld(true);
    const e = stand.matrixWorld.elements;
    const yaw = Math.atan2(e[8], e[10]);
    for (const spot of spots) crowdSpots.push({ pos: spot.pos.clone().applyMatrix4(stand.matrixWorld), yaw, row: spot.row, standing: !!spot.standing });
  });
  const royals = makeRoyals();
  const royal = makeRoyalBox(royals);
  {
    const rp = ellipsePoint(0, FX + 3, FZ + 3);
    royal.position.copy(rp);
    royal.lookAt(center);
    group.add(royal);
  }
  // Träningsdocka (som på tornerplatsen)
  const quintain = makeQuintain();
  quintain.group.position.set(-10.6, 0, 3.6);
  group.add(quintain.group);
  colliders.push({ minX: -10.6 - 0.22, maxX: -10.6 + 0.22, minZ: 3.6 - 0.22, maxZ: 3.6 + 0.22 });

  // ---------- Utanför: himmel, moln, snöiga kullar och granar ----------
  const sky = makeSky();
  group.add(sky);
  const cloudRand = seededRandom(77);
  for (let i = 0; i < 14; i++) {
    const t = cloudRand() * Math.PI * 2;
    const r = 120 + cloudRand() * 80;
    const cloud = makeCloud(cloudRand);
    cloud.position.set(Math.sin(t) * r, 40 + cloudRand() * 25, Math.cos(t) * r);
    group.add(cloud);
  }
  // Ett lågt, grått molntäcke som syns när det är mulet (regn, snö, dimma)
  const deck = new THREE.Group();
  deck.visible = false;
  deck.userData.noMerge = true;
  {
    const dr = seededRandom(4242);
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * Math.PI * 2 + dr() * 0.4;
      const r = 60 + dr() * 80;
      const c = makeCloud(dr, "deck");
      c.position.set(Math.sin(t) * r, 30 + dr() * 10, Math.cos(t) * r);
      deck.add(c);
    }
  }
  group.add(deck);
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2 + rand() * 0.3;
    const r = 85 + rand() * 45;
    const hill = mesh(new THREE.IcosahedronGeometry(1, 1), SNOW, false);
    hill.scale.set(25 + rand() * 25, 8 + rand() * 12, 25 + rand() * 25);
    hill.position.set(Math.sin(t) * r, -2, Math.cos(t) * r);
    group.add(hill);
  }
  for (let i = 0; i < 110; i++) {
    const t = rand() * Math.PI * 2;
    const r = 32 + rand() * 50;
    const tree = makeSnowPine(rand);
    tree.position.set(Math.sin(t) * r * 1.1, 0, Math.cos(t) * r);
    group.add(tree);
  }

  // Slå ihop allt som står still
  group.add(mergeStatic(group));

  const crowd = new Crowd(crowdSpots, 21, { winter: true });
  group.add(crowd.group);
  const podium = makePodium();
  podium.group.rotation.y = Math.PI; // samma håll som på tornerplatsen (kameran vid prisceremonin står där)
  group.add(podium.group);

  // ---------- Porten (för introt) ----------
  let gateOpen = 0;
  let gateWant = 0;
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
    for (const fire of fires) fire.update(dt, time);
    forge.light.intensity = 2.2 + Math.sin(time * 9) * 0.3 + Math.sin(time * 23) * 0.2;
    for (const flag of flags) waveFlag(flag, time);
    updateClouds(dt);
    // Fällgallret går upp långsamt (skramlar) och slår igen snabbt
    const speed = gateWant > gateOpen ? 0.45 : 2.5;
    gateOpen += Math.sign(gateWant - gateOpen) * Math.min(Math.abs(gateWant - gateOpen), dt * speed);
    port.position.y = gateOpen * 2.35; // upp i murens skåra, syns inte ovanför
    for (const d of lowDoors) d.rotation.y = d.userData.sx * gateOpen * 1.6;
  };
  const cheer = (strength = 1) => {
    excitement = Math.min(1.5, excitement + strength);
  };

  // Vägen genom porten: från valvet, över gården och in genom den låga porten
  const gateIn = ellipsePoint(GATE_T, WX + 1.2, WZ + 1.2);
  const gateOut = ellipsePoint(GATE_T, WX - 1.4, WZ - 1.4);
  const lowGatePt = ellipsePoint(GATE_T, FX - 1.0, FZ - 1.0);

  return {
    kind: "castle",
    group, colliders, update, cheer, quintain, podium,
    royalReact: (up) => royals.react(up),
    heraldBlow: () => royals.blow(),
    setQuality: (low) => {
      fires.forEach((f) => (f.light.visible = !low));
      forge.light.visible = !low;
    },
    // Snöfall: lite mer snö på marken (stridsytan blir ljusare)
    setWet(wet) {
      snowOverMat.opacity = wet ? 1 : 0.85; // det snöar: mer snö på marken
      fieldMat.color.copy(fieldMat.userData.dryColor).multiplyScalar(wet ? 1.08 : 1);
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
      for (const f of fires) {
        f.boost = evening ? 2.6 : 1;
        f.light.distance = evening ? 15 : 8;
      }
    },
    openGate() {
      gateWant = 1;
    },
    closeGate() {
      gateWant = 0;
    },
    gatePath: [gateIn, gateOut, lowGatePt],
    gateCamera: ellipsePoint(GATE_T, FX - 6, FZ - 6),
  };
}
