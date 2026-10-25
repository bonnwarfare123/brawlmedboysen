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
  heraldBanner, makeSky, setSkyColors, resetFlags, getCloudMaterial,
} from "./arena.js";

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

// Stridsytan: upptrampad lera i mitten som övergår i snö mot kanten (bilden är ovalens hela yta)
function muddySnowTexture(size = 1024) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const rand = seededRandom(909);
  const h = size / 2;
  ctx.fillStyle = "#7a5a40";
  ctx.fillRect(0, 0, size, size);
  // Lerfläckar i olika toner
  for (let i = 0; i < 1400; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 4 + rand() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = rand() < 0.5 ? "92,64,42" : rand() < 0.5 ? "128,96,68" : "70,50,34";
    g.addColorStop(0, `rgba(${col},${0.25 + rand() * 0.3})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Snöfläckar: tätare mot kanten, några kvar i mitten. Mjuka, utdragna och ojämna (inga prickar).
  for (let i = 0; i < 1500; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand());
    const edge = Math.pow(d, 2.5);
    if (rand() > edge * 1.1 + 0.04) continue;
    const x = h + Math.cos(a) * d * h;
    const y = h + Math.sin(a) * d * h;
    const r = 6 + rand() * 26 * (0.4 + edge);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI);
    ctx.scale(1, 0.35 + rand() * 0.5);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    const al = 0.18 + edge * 0.45 + rand() * 0.15;
    g.addColorStop(0, `rgba(236,240,246,${al})`);
    g.addColorStop(0.6, `rgba(228,234,242,${al * 0.5})`);
    g.addColorStop(1, "rgba(228,234,242,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }
  // Uppblött, mörkare lera i mitten där man slåss mest
  const mid = ctx.createRadialGradient(h, h, 0, h, h, h * 0.6);
  mid.addColorStop(0, "rgba(60,42,28,0.35)");
  mid.addColorStop(1, "rgba(60,42,28,0)");
  ctx.fillStyle = mid;
  ctx.fillRect(0, 0, size, size);
  // En snövall längs kanten
  const rim = ctx.createRadialGradient(h, h, h * 0.82, h, h, h);
  rim.addColorStop(0, "rgba(236,240,246,0)");
  rim.addColorStop(1, "rgba(236,240,246,0.95)");
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);
  // Fotspår och småsten
  for (let i = 0; i < 260; i++) {
    const x = rand() * size;
    const y = rand() * size;
    ctx.fillStyle = `rgba(52,36,24,${0.15 + rand() * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + rand() * 2, 6 + rand() * 3, rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(${150 + rand() * 60},${150 + rand() * 50},${140 + rand() * 50},0.8)`;
    ctx.fillRect(rand() * size, rand() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Stenblock: en låda med lite ojämna kanter (fogar ritas som en mörkare textur)
let stoneTex = null;
function stoneTexture() {
  if (stoneTex) return stoneTex;
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const rand = seededRandom(313);
  ctx.fillStyle = "#cfc9c0";
  ctx.fillRect(0, 0, size, size);
  const rows = 8;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -rh * 0.8 : 0;
    while (x < size) {
      const w = rh * (1.3 + rand() * 1.2);
      const v = 185 + rand() * 45;
      ctx.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      ctx.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
      // lite smuts och mossa
      if (rand() < 0.3) {
        ctx.fillStyle = `rgba(90,90,70,${0.1 + rand() * 0.15})`;
        ctx.fillRect(x + 4, r * rh + rh * 0.6, w * rand(), rh * 0.3);
      }
      x += w;
    }
  }
  stoneTex = new THREE.CanvasTexture(c);
  stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;
  stoneTex.colorSpace = THREE.SRGBColorSpace;
  return stoneTex;
}
const stoneMats = new Map();
function stoneMat(color = STONE, repeat = 1) {
  const key = color + ":" + repeat;
  if (!stoneMats.has(key)) {
    const t = stoneTexture().clone();
    t.needsUpdate = true;
    t.repeat.set(repeat, repeat);
    stoneMats.set(key, new THREE.MeshStandardMaterial({ color, map: t, roughness: 0.95 }));
  }
  return stoneMats.get(key);
}
function stoneBox(w, h, d, color = STONE, repeat = 1) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stoneMat(color, repeat));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function snowCap(w, d, h = 0.08) {
  const m = mesh(new THREE.BoxGeometry(w + 0.04, h, d + 0.04), SNOW);
  return m;
}

// Ett runt torn med tinnar, skottgluggar och ett snötäckt koniskt tak med en flagga
function makeRoundTower(radius, height, flagColor, flags) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.06, height, 18), stoneMat(STONE, 2));
  body.position.y = height / 2;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  // Tinnar runt toppen
  const top = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.12, radius * 1.05, 0.5, 18), stoneMat(STONE_DARK, 2));
  top.position.y = height + 0.1;
  g.add(top);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const m = stoneBox(0.5, 0.55, 0.35, STONE);
    m.position.set(Math.sin(a) * radius * 1.08, height + 0.6, Math.cos(a) * radius * 1.08);
    m.rotation.y = a;
    g.add(m);
    const s = snowCap(0.5, 0.35, 0.07);
    s.position.set(Math.sin(a) * radius * 1.08, height + 0.91, Math.cos(a) * radius * 1.08);
    s.rotation.y = a;
    g.add(s);
  }
  // Snötäckt koniskt tak med en stenkant
  const roof = mesh(new THREE.ConeGeometry(radius * 1.2, radius * 1.6, 18), SNOW);
  roof.position.y = height + 0.35 + radius * 0.8;
  g.add(roof);
  const roofRim = mesh(new THREE.CylinderGeometry(radius * 1.22, radius * 1.22, 0.12, 18), 0x6a5a4a);
  roofRim.position.y = height + 0.38;
  g.add(roofRim);
  // Skottgluggar
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const w = box(0.14, 0.6, 0.12, 0x1c1a1a);
    w.position.set(Math.sin(a) * radius * 1.0, height * (0.45 + (i % 2) * 0.2), Math.cos(a) * radius * 1.0);
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
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + p.getZ(i)) / 2.5, p.getY(i) / 2.5);
  }
  const wall = new THREE.Mesh(wallGeo, stoneMat(STONE, 1));
  wall.castShadow = wall.receiveShadow = true;
  g.add(wall);
  // Valvets insida (mörkt) och en stenbåge runt öppningen
  const inner = mesh(new THREE.BoxGeometry(OW - 0.05, 0.05, D), 0x3a3634);
  inner.position.set(0, 0.02, 0);
  g.add(inner);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(OW / 2 + 0.12, 0.16, 6, 20, Math.PI), stoneMat(STONE_DARK, 1));
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
  const fieldMat = new THREE.MeshStandardMaterial({ map: muddySnowTexture(), roughness: 0.95 });
  fieldMat.userData.dryColor = fieldMat.color.clone();
  const field = new THREE.Mesh(new THREE.CircleGeometry(1, 72), fieldMat);
  field.rotation.x = -Math.PI / 2;
  field.scale.set(FX + 0.4, FZ + 0.4, 1);
  field.position.y = 0.01;
  field.receiveShadow = true;
  group.add(field);
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
    const seg = stoneBox(len + 0.04, 0.78, 0.38, STONE, 1);
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
    const wall = stoneBox(len + 0.05, WALL_H, 1.6, STONE, 2);
    wall.position.set(mx, WALL_H / 2, mz);
    wall.rotation.y = angle;
    group.add(wall);
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
    // Publiken på gångbanan (två led), vända mot mitten
    for (const row of [0, 1]) {
      if (rand() < 0.25) continue;
      const r = row ? 0.25 : -0.45;
      crowdSpots.push({ pos: new THREE.Vector3(mx + out.x * r, WALL_H + 0.06, mz + out.z * r), yaw: Math.atan2(-mx, -mz), row: 3, standing: true });
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
  const propTs = [0.15, 0.55, -0.6, 1.0, -1.05, 1.55, -1.5, 2.0, -1.95, 2.45, -2.45];
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
  // Två läktare på sidorna och kungens loge mitt emot porten
  [1.65, -1.65].forEach((t, si) => {
    const { stand, spots } = makeStand(si ? PALETTE.blue : PALETTE.red, si + 5);
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
    // Fällgallret går upp långsamt (skramlar) och slår igen snabbt
    const speed = gateWant > gateOpen ? 0.45 : 2.5;
    gateOpen += Math.sign(gateWant - gateOpen) * Math.min(Math.abs(gateWant - gateOpen), dt * speed);
    port.position.y = gateOpen * 3.9;
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
      fieldMat.color.copy(fieldMat.userData.dryColor).multiplyScalar(wet ? 1.12 : 1);
      fieldMat.needsUpdate = true;
    },
    setOvercast(on) {
      this.overcast = on;
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
