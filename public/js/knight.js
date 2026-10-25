// RIDDAREN – formade lemmar, rustning i enskilda delar, ansikte och riktiga leder.
// Riddaren tittar mot +Z. Origo (0,0,0) är mellan fötterna. Längd ca 1,8 m.
//
// Kroppen består av 15 delar som sitter ihop i leder:
//
//   pelvis (höfter)
//    ├ torso (bål)            ← midja
//    │  ├ head (huvud)        ← hals     (ansikte under hjälmen, hjälmen kan flyga av)
//    │  ├ upperArmL/R         ← axel
//    │  │  └ forearmL/R       ← armbåge
//    │  │     └ handL/R       ← handled   (sköld i vänster, vapen i höger)
//    ├ thighL/R (lår)         ← höft
//    │  └ shinL/R (underben)  ← knä
//    │     └ footL/R (fot)    ← fotled
//
// Varje led kan huggas av. Då blir delen (och allt som sitter längre ut)
// en egen ragdoll som flyger iväg.
//
// Utseendet väljs med look = { a: rustning, h: hjälm, s: sköld, w: vapen, c: mantel } (se shared.js).
// Benen styrs av en benlösare (ik.js) så att fötterna står stadigt på marken.
// Mantel, vapenrock och slagkedja är mjuka och styrs av fysik (cloth.js).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { COMBAT, JOINT_SEGMENT, LEG_JOINTS, weaponSpec, FISTS } from "./shared.js";
import { Ragdoll } from "./ragdoll.js";
import { FootPlanner, solveLeg, solveArm, gaitStride } from "./ik.js";
import { Cloth, Chain } from "./cloth.js";
import {
  chainmailTexture, leatherTexture, quiltTexture, wrapTexture, strawTexture, metalWearTexture, heraldryTexture,
  linenTexture, daggedTexture, splatterTexture, forgedTexture, woodGrainTexture, plateTexture, rustyPlateTexture,
} from "./textures.js";

const BLOOD = 0x6a0808;
const SKIN = [0xf2cfaa, 0xe6b890, 0xd09a6c, 0xa86e48, 0x7a4c2e];
const HAIR = [0x23170e, 0x4a3018, 0x7a4e26, 0xc8a050, 0x9a3c18, 0x8c8a86];
const EYES = [0x3a2a1a, 0x4a6a8a, 0x5a6a3a, 0x2a2a2a];
const DIRT = new THREE.Color(0x5a4630);

// Omgivning som blank metall speglar (sätts av spelet, se setEnvironment)
let ENVIRONMENT = null;
export function setEnvironment(texture) {
  ENVIRONMENT = texture;
}

// Blodstänk på rustningen: oregelbundna stänk (samma former som på marken), lite blanka
const bloodDecalMaterials = [];
function bloodDecal() {
  if (bloodDecalMaterials.length === 0) {
    for (let v = 0; v < 4; v++) {
      bloodDecalMaterials.push(new THREE.MeshStandardMaterial({
        color: BLOOD, roughness: 0.25, metalness: 0.1, map: splatterTexture(v), alphaTest: 0.4,
        polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide,
      }));
    }
  }
  return bloodDecalMaterials[Math.floor(Math.random() * bloodDecalMaterials.length)];
}

// Enkel slumpgenerator som ger samma följd för samma frö (så ansiktet blir likadant hos alla)
function seededRandom(seed) {
  let s = Math.abs(Math.floor(seed)) % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ---------- Formade lemmar ----------
// Profil = [andel av längden, radie]. Snurras runt sin axel till en rund, formad lem.
const PROFILE = {
  thigh: [[0, 0.082], [0.12, 0.09], [0.5, 0.08], [0.85, 0.064], [1, 0.06]],
  shin: [[0, 0.063], [0.2, 0.073], [0.42, 0.07], [0.78, 0.053], [1, 0.049]],
  upperArm: [[0, 0.058], [0.35, 0.061], [0.72, 0.052], [1, 0.046]],
  forearm: [[0, 0.05], [0.25, 0.054], [0.72, 0.042], [1, 0.036]],
};

function radiusAt(profile, f) {
  for (let i = 1; i < profile.length; i++) {
    if (f <= profile[i][0]) {
      const [f0, r0] = profile[i - 1];
      const [f1, r1] = profile[i];
      return r0 + ((r1 - r0) * (f - f0)) / (f1 - f0 || 1);
    }
  }
  return profile[profile.length - 1][1];
}

// Rund form längs en lem (från andel "from" till "to"), "extra" = hur mycket större än själva lemmen
// Punkterna måste gå uppåt (ökande y), annars vänds ytan ut och in och syns inte utifrån.
// Muskler: lemmarna är inte runda rör. Låret buktar fram, vaden buktar bak, överarmen har en
// biceps fram och en triceps bak, och underarmen blir platt mot handleden.
// [del av längden där bulan är störst, hur bred bulan är, fram (+z), bak (-z), sidled (x)]
const MUSCLE = new Map([
  [PROFILE.thigh, [[0.3, 0.35, 0.16, 0.08, 0.02], [0.85, 0.15, 0.06, -0.04, 0.0]]],
  [PROFILE.shin, [[0.3, 0.28, -0.06, 0.32, 0.03], [0.9, 0.2, 0.0, -0.05, -0.08]]],
  [PROFILE.upperArm, [[0.15, 0.22, 0.08, 0.06, 0.12], [0.5, 0.3, 0.14, 0.12, -0.02]]],
  [PROFILE.forearm, [[0.25, 0.3, 0.06, 0.1, 0.12], [0.85, 0.2, -0.12, -0.12, 0.1]]],
]);
function shapeMuscles(geo, profile, length, extra) {
  const bumps = MUSCLE.get(profile);
  if (!bumps) return geo;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 0.002) continue;
    const f = -y / length;
    let fz = 1, fx = 1;
    for (const [c, w, front, back, side] of bumps) {
      const k = Math.exp(-(((f - c) / w) ** 2));
      fz += (z > 0 ? front : back) * k * Math.abs(z / r);
      fx += side * k;
    }
    // Plåt utanpå ska följa samma form, men lite mjukare (den är stel)
    const soft = extra > 0.008 ? 0.6 : 1;
    pos.setX(i, x * (1 + (fx - 1) * soft));
    pos.setZ(i, z * (1 + (fz - 1) * soft));
  }
  geo.computeVertexNormals();
  return geo;
}

function latheAlong(profile, length, from = 0, to = 1, extra = 0, closed = true, flare = 0) {
  return shapeMuscles(latheAlongRound(profile, length, from, to, extra, closed, flare), profile, length, extra);
}
function latheAlongRound(profile, length, from = 0, to = 1, extra = 0, closed = true, flare = 0) {
  const pts = [];
  const steps = 12;
  if (closed) pts.push(new THREE.Vector2(0.0001, -to * length));
  for (let i = steps; i >= 0; i--) {
    const f = from + ((to - from) * i) / steps;
    let r = radiusAt(profile, f) + extra;
    if (flare && (i === 0 || i === steps)) r += flare; // utvikt kant på plåten
    pts.push(new THREE.Vector2(r, -f * length));
  }
  if (closed) pts.push(new THREE.Vector2(0.0001, -from * length));
  return new THREE.LatheGeometry(pts, 16);
}

// ---------- Huvudet ----------
// Ett klot som formas om till ett huvud: smalare käke, framskjuten haka, ögonhålor, pannben och kindben.
function sculptHead(f) {
  const geo = new THREE.SphereGeometry(1, 36, 28);
  const pos = geo.attributes.position;
  const d = new THREE.Vector3();
  const bump = (cx, cy, cz, radius, amount) => {
    const dist = Math.hypot(d.x - cx, d.y - cy, d.z - cz);
    return dist < radius ? amount * (1 - dist / radius) ** 2 : 0;
  };
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i);
    let r = 1;
    for (const s of [1, -1]) {
      r -= bump(0.36 * s, 0.12, 0.92, 0.3, 0.075);   // ögonhålor
      r += bump(0.32 * s, 0.3, 0.9, 0.24, 0.04);     // pannben
      r += bump(0.62 * s, -0.08, 0.74, 0.3, 0.045);  // kindben
      r -= bump(0.86 * s, 0.25, 0.35, 0.3, 0.03);    // tinningar
      r -= bump(0.55 * s, -0.42, 0.65, 0.25, 0.025); // under kindbenen
    }
    r += bump(0, -0.8, 0.58, 0.3, 0.05 + f.chin * 0.07); // haka
    r += bump(0, 0.1, 0.99, 0.18, 0.02);               // näsrot
    let x = d.x * r;
    let y = d.y * r;
    let z = d.z * r;
    // Käken smalnar av nedåt och skjuter fram lite
    const low = Math.min(1, Math.max(0, (-0.12 - d.y) / 0.8));
    x *= 1 - f.jaw * low * low;
    if (z > 0) z *= 1 + 0.32 * low;
    if (z < -0.3) z *= 1.03; // bakhuvudet
    pos.setXYZ(i, x * 0.09, y * 0.1, z * 0.095);
  }
  geo.translate(0, 0.135, 0.004);
  geo.computeVertexNormals();
  return geo;
}
// Skäggstubb: ett tunt skal över käken och hakan, gjort av huvudets egen form
function stubbleShell(skull) {
  const src = skull.index ? skull : null;
  if (!src) return null;
  const pos = skull.attributes.position;
  const keep = (i) => {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    return y < 0.084 && z > -0.02;
  };
  const idx = [];
  const ind = src.index?.array;
  if (!ind || !skull.attributes.normal) return null;
  for (let t = 0; t < ind.length; t += 3) {
    if (keep(ind[t]) && keep(ind[t + 1]) && keep(ind[t + 2])) idx.push(ind[t], ind[t + 1], ind[t + 2]);
  }
  if (!idx.length) return null;
  const geo = skull.clone();
  geo.setIndex(idx);
  // lite utanför huden
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * 0.0012, p.getY(i) + n.getY(i) * 0.0012, p.getZ(i) + n.getZ(i) * 0.0012);
  return geo;
}
// Näsa: sidoprofilen (rygg, spets, undersida) dras ut till en näsa med rundade kanter
function noseGeometry(size) {
  const k = size;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.152);
  shape.lineTo(0.012 * k, 0.13);
  shape.quadraticCurveTo(0.024 * k, 0.112, 0.024 * k, 0.106);
  shape.quadraticCurveTo(0.023 * k, 0.098, 0.014 * k, 0.098);
  shape.lineTo(0, 0.101);
  shape.lineTo(0, 0.152);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.0035, bevelSegments: 4, curveSegments: 8 });
  geo.translate(0, 0, -0.004);
  geo.rotateY(-Math.PI / 2); // profilens bredd blir sidled, profilen pekar framåt
  // Smal näsrygg upptill, bredare nertill, och rundad framkant
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const f = Math.min(1, Math.max(0, (0.152 - y) / 0.05)); // 0 överst, 1 vid spetsen
    const fwd = pos.getZ(i) / (0.024 * k);
    pos.setX(i, pos.getX(i) * (0.45 + 0.55 * f) * (1 - 0.35 * Math.max(0, fwd) ** 2));
  }
  geo.computeVertexNormals();
  return geo;
}

// Bålen under rustningen formas lite: smalare under armarna (så armarna får plats bredvid kroppen)
// och en antydan till midja. geo = en kapsel runt y = 0 med halva höjden "half".
function sculptTorso(geo, half) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const f = (pos.getY(i) + half) / (2 * half); // 0 nederst, 1 överst
    const pit = Math.exp(-(((f - 0.7) / 0.13) ** 2)) * 0.13;
    const waist = Math.exp(-(((f - 0.3) / 0.16) ** 2)) * 0.05;
    pos.setX(i, pos.getX(i) * (1 - pit - waist));
  }
  geo.computeVertexNormals();
  return geo;
}
// Samma sak för en bröstplåt (svarvad runt y, nederkant y0, överkant y1)
function sculptChest(geo, y0, y1, amount = 0.13) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const f = (pos.getY(i) - y0) / (y1 - y0);
    const x = pos.getX(i);
    const side = Math.abs(x) / (Math.hypot(x, pos.getZ(i)) || 1); // bara på sidorna, inte fram
    const pit = Math.exp(-(((f - 0.68) / 0.17) ** 2)) * amount * side * side;
    pos.setX(i, x * (1 - pit));
  }
  geo.computeVertexNormals();
  return geo;
}

// Rustningarna
const ARMOR_STYLES = ["plate", "chain", "leather", "gilded", "peasant", "jester", "hedge"];

// Rörelsekurvor för vapenarmen:
// [tid, överarm framåt, överarm i sidled, underarm böj, bålens vridning, handled]
const STANCE_R = [-0.55, -0.12, -1.25, 0.12, 0.35]; // stridsställning: vapnet redo
const CARRY_R = [-0.25, 0, -0.75, 0, 0.1];          // när man går: armen mer avslappnad
// ---------- Varje vapen har egna slag ----------
// arm:  [tid, överarm framåt, överarm i sidled (+ = in över kroppen), underarm böj, bålens vridning (+ = åt vänster), handled]
// body: [tid, lutning framåt, kliv framåt, sjunka ner, luta åt sidan]
// Träffen sker vid tiden 0,3 (stöten 0,26), samma för alla vapen: tunga vapen spelas bara långsammare.
// q = snabba slag (växlar mellan varianterna), h = tungt slag (börjar i laddningsställningen), t = stöt.
const S = STANCE_R;
const BODY0 = [0, 0, 0, 0];
const at = (t, pose) => [t, ...pose];
const MOVES = {
  // Dolk: korta, snabba hugg och stick nära kroppen
  dagger: {
    q: [
      // Snabbt stick framåt underifrån
      { arm: [at(0, S), [0.12, -0.5, -0.2, -1.9, -0.35, 0.9], [0.3, -1.35, 0.1, -0.35, 0.4, 1.2], at(0.46, S)],
        body: [[0, ...BODY0], [0.12, -0.03, 0, 0, 0], [0.3, 0.14, 0.12, 0.03, 0], [0.46, ...BODY0]] },
      // Snabbt snitt tvärs över
      { arm: [at(0, S), [0.12, -1.5, -0.7, -1.4, -0.5, 0.4], [0.3, -1.2, 0.55, -0.4, 0.5, 0.4], at(0.46, S)],
        body: [[0, ...BODY0], [0.12, 0, 0, 0, 0.04], [0.3, 0.08, 0.08, 0, -0.05], [0.46, ...BODY0]] },
      // Stick uppåt mot halsen
      { arm: [at(0, S), [0.12, -0.3, -0.3, -1.7, -0.3, 0.6], [0.3, -1.9, 0.15, -0.7, 0.35, 1.3], at(0.46, S)],
        body: [[0, ...BODY0], [0.12, -0.05, 0, 0.03, 0], [0.3, 0.1, 0.1, -0.02, 0], [0.46, ...BODY0]] },
    ],
    // Hugg uppifrån och ner (som med en ishacka)
    h: { arm: [[0, -2.95, -0.1, -1.4, -0.3, -0.6], [0.15, -3.1, -0.1, -1.6, -0.4, -0.7], [0.32, -0.9, 0.15, -0.9, 0.35, -0.2], at(0.62, S)],
      body: [[0, -0.12, -0.04, 0, 0], [0.15, -0.15, -0.05, 0, 0], [0.32, 0.32, 0.2, 0.08, 0], [0.62, ...BODY0]] },
    // Utfall med dolken rakt fram
    t: { arm: [at(0, S), [0.11, -0.6, -0.25, -2.0, -0.5, 1.0], [0.25, -1.5, 0.05, -0.05, 0.6, 1.2], [0.36, -1.45, 0.05, -0.05, 0.55, 1.2], at(0.55, S)],
      body: [[0, ...BODY0], [0.11, -0.06, -0.05, 0, 0], [0.25, 0.25, 0.34, 0.08, 0], [0.36, 0.22, 0.3, 0.08, 0], [0.55, ...BODY0]] },
  },
  sword: {
    q: [
      { arm: [at(0, S), [0.12, -2.4, -0.4, -1.0, -0.45, 0], [0.3, -0.6, 0.3, -0.2, 0.45, 0], at(0.5, S)],
        body: [[0, ...BODY0], [0.12, -0.05, 0, 0, 0.05], [0.3, 0.12, 0.08, 0.02, -0.06], [0.5, ...BODY0]] },
      // Bakhandshugg: klingan upp över vänster axel, sedan ut åt höger
      { arm: [at(0, S), [0.13, -1.9, 0.75, -1.9, 0.55, 0.2], [0.3, -0.9, -0.55, -0.25, -0.45, -0.1], at(0.5, S)],
        body: [[0, ...BODY0], [0.13, -0.03, 0, 0, -0.06], [0.3, 0.1, 0.1, 0.02, 0.07], [0.5, ...BODY0]] },
    ],
    h: { arm: [[0, -2.9, 0, -0.6, -0.3, 0], [0.15, -3.0, 0, -0.7, -0.4, 0], [0.32, -0.5, 0, -0.1, 0.45, 0], at(0.7, S)],
      body: [[0, -0.1, -0.04, 0, 0], [0.15, -0.12, -0.05, 0, 0], [0.32, 0.3, 0.16, 0.08, 0], [0.7, ...BODY0]] },
    t: { arm: [at(0, S), [0.13, -0.75, -0.3, -2.0, -0.6, 0.75], [0.27, -1.5, 0.05, -0.02, 0.7, 1.1], [0.42, -1.5, 0.05, -0.02, 0.62, 1.1], at(0.65, S)],
      body: [[0, ...BODY0], [0.13, -0.08, -0.06, 0, 0], [0.27, 0.25, 0.32, 0.08, 0], [0.42, 0.22, 0.3, 0.08, 0], [0.65, ...BODY0]] },
  },
  axe: {
    q: [
      // Kort hugg uppifrån med en knyck i handleden
      { arm: [at(0, S), [0.14, -2.7, -0.25, -1.6, -0.3, 0.6], [0.3, -0.45, 0.05, -0.15, 0.3, 0.6], at(0.52, S)],
        body: [[0, ...BODY0], [0.14, -0.08, 0, 0, 0], [0.3, 0.2, 0.08, 0.05, 0], [0.52, ...BODY0]] },
      // Vågrätt hugg från höger
      { arm: [at(0, S), [0.14, -1.4, -1.0, -1.2, -0.6, 0.3], [0.3, -1.3, 0.6, -0.3, 0.6, 0.2], at(0.52, S)],
        body: [[0, ...BODY0], [0.14, 0, 0, 0.02, 0.08], [0.3, 0.1, 0.06, 0.04, -0.08], [0.52, ...BODY0]] },
    ],
    h: { arm: [[0, -3.1, -0.1, -1.5, -0.35, 0.5], [0.16, -3.2, -0.1, -1.7, -0.45, 0.5], [0.32, -0.35, 0.05, -0.05, 0.4, 0.5], at(0.72, S)],
      body: [[0, -0.15, -0.05, 0, 0], [0.16, -0.2, -0.06, 0, 0], [0.32, 0.42, 0.18, 0.12, 0], [0.72, ...BODY0]] },
    t: { arm: [at(0, S), [0.12, -0.8, -0.25, -1.9, -0.4, 0.6], [0.26, -1.35, 0, -0.1, 0.45, 0.9], [0.4, -1.3, 0, -0.15, 0.4, 0.9], at(0.6, S)],
      body: [[0, ...BODY0], [0.12, -0.05, -0.04, 0, 0], [0.26, 0.2, 0.22, 0.05, 0], [0.4, 0.18, 0.2, 0.05, 0], [0.6, ...BODY0]] },
  },
  flail: {
    q: [
      // Svingar kedjan runt huvudet och låter bollen slå in från sidan
      { arm: [at(0, S), [0.1, -2.6, -0.8, -1.0, -0.5, 0.2], [0.2, -2.3, 0.5, -0.6, 0.1, 0], [0.3, -0.9, 0.5, -0.3, 0.55, 0], at(0.55, S)],
        body: [[0, ...BODY0], [0.1, -0.05, 0, 0, 0.1], [0.3, 0.12, 0.06, 0.03, -0.1], [0.55, ...BODY0]] },
      // Underifrån och upp
      { arm: [at(0, S), [0.12, 0.2, -0.5, -0.3, -0.5, 0], [0.3, -2.0, 0.3, -0.4, 0.45, 0], at(0.55, S)],
        body: [[0, ...BODY0], [0.12, 0.12, 0, 0.06, 0.05], [0.3, -0.08, 0.06, 0, -0.05], [0.55, ...BODY0]] },
    ],
    // Ett helt varv runt huvudet innan bollen slår ner
    h: { arm: [[0, -2.9, -0.3, -0.6, -0.3, 0], [0.08, -3.0, 0.6, -0.8, -0.1, 0], [0.16, -2.4, -0.8, -0.6, -0.45, 0], [0.32, -0.4, 0.2, -0.1, 0.5, 0], at(0.75, S)],
      body: [[0, -0.08, 0, 0, 0.08], [0.08, -0.1, 0, 0, -0.08], [0.16, -0.08, 0, 0, 0.1], [0.32, 0.3, 0.15, 0.08, -0.05], [0.75, ...BODY0]] },
    t: { arm: [at(0, S), [0.12, -0.7, -0.2, -1.9, -0.4, 0.5], [0.26, -1.4, 0, -0.2, 0.4, 0.6], at(0.48, S)],
      body: [[0, ...BODY0], [0.12, -0.05, -0.03, 0, 0], [0.26, 0.15, 0.18, 0.03, 0], [0.48, ...BODY0]] },
  },
  twohander: {
    q: [
      // Diagonalt hugg från höger axel ner mot vänster
      { arm: [at(0, S), [0.13, -2.5, -0.55, -1.3, -0.6, 0.3], [0.3, -0.5, 0.45, -0.3, 0.6, -0.1], at(0.55, S)],
        body: [[0, ...BODY0], [0.13, -0.06, 0, 0, 0.08], [0.3, 0.2, 0.12, 0.05, -0.1], [0.55, ...BODY0]] },
      // Uppåt från vänster höft
      { arm: [at(0, S), [0.13, -0.4, 0.6, -0.8, 0.6, 0.2], [0.3, -1.9, -0.5, -0.5, -0.5, 0.1], at(0.55, S)],
        body: [[0, ...BODY0], [0.13, 0.15, 0, 0.06, -0.08], [0.3, -0.05, 0.1, 0, 0.08], [0.55, ...BODY0]] },
    ],
    h: { arm: [[0, -2.9, 0, -0.6, -0.3, 0], [0.15, -3.05, 0, -0.8, -0.4, -0.2], [0.32, -0.45, 0, -0.05, 0.45, 0.1], at(0.72, S)],
      body: [[0, -0.12, -0.05, 0, 0], [0.15, -0.16, -0.06, 0, 0], [0.32, 0.4, 0.2, 0.12, 0], [0.72, ...BODY0]] },
    t: { arm: [at(0, S), [0.13, -0.6, -0.15, -2.1, -0.5, 1.0], [0.27, -1.45, 0.1, -0.1, 0.55, 1.2], [0.42, -1.45, 0.1, -0.1, 0.5, 1.2], at(0.65, S)],
      body: [[0, ...BODY0], [0.13, -0.08, -0.06, 0, 0], [0.27, 0.28, 0.35, 0.1, 0], [0.42, 0.25, 0.33, 0.1, 0], [0.65, ...BODY0]] },
  },
  daneaxe: {
    q: [
      { arm: [at(0, S), [0.14, -2.8, -0.5, -1.4, -0.6, 0.3], [0.3, -0.4, 0.35, -0.15, 0.55, 0.4], at(0.55, S)],
        body: [[0, ...BODY0], [0.14, -0.1, 0, 0, 0.06], [0.3, 0.3, 0.12, 0.08, -0.08], [0.55, ...BODY0]] },
      // Vågrätt svep från vänster
      { arm: [at(0, S), [0.14, -1.5, 0.7, -1.3, 0.65, 0], [0.3, -1.4, -0.7, -0.4, -0.6, 0.2], at(0.55, S)],
        body: [[0, ...BODY0], [0.14, 0, 0, 0.03, -0.1], [0.3, 0.1, 0.08, 0.05, 0.1], [0.55, ...BODY0]] },
    ],
    // Yxan svingas upp bakom ryggen och slår ner med hela kroppen
    h: { arm: [[0, -3.1, 0.1, -1.7, -0.5, 0.6], [0.17, -3.25, 0.1, -1.9, -0.6, 0.65], [0.32, -0.25, 0.1, 0, 0.35, 0.6], at(0.72, S)],
      body: [[0, -0.22, -0.06, 0, 0], [0.17, -0.28, -0.08, 0, 0], [0.32, 0.5, 0.2, 0.16, 0], [0.72, ...BODY0]] },
    t: { arm: [at(0, S), [0.12, -0.8, -0.25, -1.9, -0.4, 0.6], [0.26, -1.35, 0, -0.1, 0.45, 0.9], [0.4, -1.3, 0, -0.15, 0.4, 0.9], at(0.6, S)],
      body: [[0, ...BODY0], [0.12, -0.05, -0.04, 0, 0], [0.26, 0.22, 0.24, 0.06, 0], [0.4, 0.2, 0.22, 0.06, 0], [0.6, ...BODY0]] },
  },
  halberd: {
    q: [
      // Brett vågrätt svep: hillebarden når långt åt sidorna
      { arm: [at(0, S), [0.14, -1.3, -0.9, -1.1, -0.7, 0.2], [0.3, -1.25, 0.6, -0.4, 0.7, 0.1], at(0.55, S)],
        body: [[0, ...BODY0], [0.14, 0, 0, 0.02, 0.1], [0.3, 0.12, 0.1, 0.04, -0.1], [0.55, ...BODY0]] },
      { arm: [at(0, S), [0.14, -2.6, -0.2, -1.2, -0.3, -0.3], [0.3, -0.6, 0, -0.2, 0.25, 0.4], at(0.55, S)],
        body: [[0, ...BODY0], [0.14, -0.08, 0, 0, 0], [0.3, 0.25, 0.12, 0.06, 0], [0.55, ...BODY0]] },
    ],
    h: { arm: [[0, -3.0, -0.1, -1.4, -0.4, 0.4], [0.16, -3.15, -0.1, -1.6, -0.5, 0.45], [0.32, -0.4, 0.05, -0.05, 0.35, 0.5], at(0.72, S)],
      body: [[0, -0.15, -0.05, 0, 0], [0.16, -0.2, -0.06, 0, 0], [0.32, 0.42, 0.2, 0.12, 0], [0.72, ...BODY0]] },
    // Långt utfall som med en pik
    t: { arm: [at(0, S), [0.13, -0.7, -0.2, -2.2, -0.55, 1.1], [0.27, -1.5, 0.05, 0, 0.6, 1.25], [0.45, -1.5, 0.05, 0, 0.55, 1.25], at(0.68, S)],
      body: [[0, ...BODY0], [0.13, -0.1, -0.08, 0, 0], [0.27, 0.3, 0.4, 0.12, 0], [0.45, 0.28, 0.38, 0.12, 0], [0.68, ...BODY0]] },
  },
  zweihander: {
    q: [
      // Enormt vågrätt svep från höger
      { arm: [at(0, S), [0.15, -1.6, -1.1, -1.0, -0.8, 0.3], [0.3, -1.4, 0.7, -0.3, 0.8, 0.1], at(0.55, S)],
        body: [[0, ...BODY0], [0.15, -0.05, 0, 0.04, 0.12], [0.3, 0.15, 0.12, 0.08, -0.12], [0.55, ...BODY0]] },
      // Snett nedåt från vänster axel
      { arm: [at(0, S), [0.15, -2.4, 0.6, -1.6, 0.6, 0.2], [0.3, -0.6, -0.5, -0.3, -0.55, 0], at(0.55, S)],
        body: [[0, ...BODY0], [0.15, -0.08, 0, 0, -0.1], [0.3, 0.28, 0.12, 0.1, 0.1], [0.55, ...BODY0]] },
    ],
    h: { arm: [[0, -2.9, 0, -0.6, -0.3, 0], [0.16, -3.15, 0, -0.9, -0.45, -0.3], [0.32, -0.4, 0, 0, 0.4, 0.2], at(0.75, S)],
      body: [[0, -0.18, -0.06, 0, 0], [0.16, -0.25, -0.08, 0, 0], [0.32, 0.5, 0.22, 0.16, 0], [0.75, ...BODY0]] },
    t: { arm: [at(0, S), [0.13, -0.6, -0.15, -2.1, -0.5, 1.0], [0.27, -1.45, 0.1, -0.1, 0.55, 1.2], [0.42, -1.45, 0.1, -0.1, 0.5, 1.2], at(0.65, S)],
      body: [[0, ...BODY0], [0.13, -0.1, -0.08, 0, 0], [0.27, 0.3, 0.38, 0.12, 0], [0.42, 0.28, 0.35, 0.12, 0], [0.65, ...BODY0]] },
  },
  spear: {
    q: [
      // Slår med skaftet från sidan
      { arm: [at(0, S), [0.13, -1.2, -0.8, -1.0, -0.55, 0.4], [0.3, -1.1, 0.5, -0.3, 0.55, 0.4], at(0.5, S)],
        body: [[0, ...BODY0], [0.13, 0, 0, 0, 0.06], [0.3, 0.1, 0.06, 0.02, -0.06], [0.5, ...BODY0]] },
      // Snabb låg stöt
      { arm: [at(0, S), [0.12, -0.7, -0.2, -1.9, -0.35, 0.9], [0.3, -1.25, 0, -0.05, 0.4, 1.1], at(0.5, S)],
        body: [[0, ...BODY0], [0.12, -0.04, -0.04, 0, 0], [0.3, 0.18, 0.2, 0.06, 0], [0.5, ...BODY0]] },
    ],
    // Kraftstöt: drar spjutet långt bakåt, vrider hela kroppen och kastar sig fram
    h: { arm: [[0, -0.5, -0.4, -2.3, -0.8, 0.9], [0.15, -0.4, -0.45, -2.4, -0.9, 0.9], [0.32, -1.55, 0.05, 0, 0.7, 1.2], at(0.72, S)],
      body: [[0, -0.12, -0.1, 0.04, 0], [0.15, -0.15, -0.12, 0.05, 0], [0.32, 0.35, 0.45, 0.12, 0], [0.72, ...BODY0]] },
    // Blixtsnabb stöt som dras tillbaka direkt
    t: { arm: [at(0, S), [0.1, -0.75, -0.2, -2.0, -0.4, 1.0], [0.26, -1.5, 0.05, 0, 0.6, 1.15], [0.36, -1.45, 0.05, -0.05, 0.55, 1.15], at(0.5, S)],
      body: [[0, ...BODY0], [0.1, -0.06, -0.05, 0, 0], [0.26, 0.22, 0.28, 0.06, 0], [0.36, 0.2, 0.26, 0.06, 0], [0.5, ...BODY0]] },
  },
  warhammer: {
    q: [
      { arm: [at(0, S), [0.12, -2.0, -0.6, -1.8, -0.5, 0.2], [0.3, -0.9, 0.4, -0.6, 0.5, 0.5], at(0.5, S)],
        body: [[0, ...BODY0], [0.12, -0.04, 0, 0, 0.05], [0.3, 0.15, 0.08, 0.04, -0.06], [0.5, ...BODY0]] },
      // Bakhand med näbben
      { arm: [at(0, S), [0.12, -1.8, 0.7, -1.9, 0.6, 0.3], [0.3, -1.0, -0.5, -0.4, -0.5, 0.1], at(0.5, S)],
        body: [[0, ...BODY0], [0.12, -0.03, 0, 0, -0.05], [0.3, 0.12, 0.08, 0.03, 0.06], [0.5, ...BODY0]] },
    ],
    h: { arm: [[0, -3.1, -0.1, -1.5, -0.35, 0.5], [0.16, -3.2, -0.1, -1.7, -0.45, 0.5], [0.32, -0.35, 0.05, -0.05, 0.4, 0.5], at(0.72, S)],
      body: [[0, -0.15, -0.05, 0, 0], [0.16, -0.2, -0.06, 0, 0], [0.32, 0.4, 0.16, 0.12, 0], [0.72, ...BODY0]] },
    t: { arm: [at(0, S), [0.12, -0.8, -0.25, -1.9, -0.4, 0.6], [0.26, -1.35, 0, -0.1, 0.45, 0.9], [0.4, -1.3, 0, -0.15, 0.4, 0.9], at(0.6, S)],
      body: [[0, ...BODY0], [0.12, -0.05, -0.04, 0, 0], [0.26, 0.2, 0.2, 0.05, 0], [0.4, 0.18, 0.18, 0.05, 0], [0.6, ...BODY0]] },
  },
  maul: {
    q: [
      // Uppercut: släggan svingas underifrån och upp
      { arm: [at(0, S), [0.14, 0.1, -0.5, -0.4, -0.5, 0.3], [0.3, -2.2, 0.2, -0.6, 0.4, 0], at(0.55, S)],
        body: [[0, ...BODY0], [0.14, 0.2, 0, 0.1, 0.05], [0.3, -0.12, 0.08, 0, -0.04], [0.55, ...BODY0]] },
      { arm: [at(0, S), [0.15, -1.4, -1.0, -1.1, -0.75, 0.2], [0.3, -1.3, 0.55, -0.3, 0.7, 0], at(0.55, S)],
        body: [[0, ...BODY0], [0.15, 0, 0, 0.04, 0.12], [0.3, 0.15, 0.1, 0.08, -0.12], [0.55, ...BODY0]] },
    ],
    // Över axeln och rakt ner i marken med hela tyngden
    h: { arm: [[0, -3.1, -0.2, -1.8, -0.5, 0.7], [0.17, -3.2, -0.2, -2.0, -0.6, 0.7], [0.32, -0.2, 0.05, 0, 0.3, 0.7], at(0.75, S)],
      body: [[0, -0.22, -0.06, 0, 0], [0.17, -0.3, -0.08, 0, 0], [0.32, 0.55, 0.22, 0.2, 0], [0.75, ...BODY0]] },
    t: { arm: [at(0, S), [0.13, -0.7, -0.2, -2.0, -0.4, 0.6], [0.26, -1.4, 0, -0.2, 0.45, 0.9], at(0.5, S)],
      body: [[0, ...BODY0], [0.13, -0.06, -0.05, 0, 0], [0.26, 0.2, 0.25, 0.06, 0], [0.5, ...BODY0]] },
  },
  fists: {
    q: [
      // Rak höger (jabb)
      { arm: [at(0, S), [0.15, -0.9, -0.2, -2.3, -0.3, 0], [0.3, -1.5, 0.05, -0.15, 0.35, 0], at(0.48, S)],
        body: [[0, ...BODY0], [0.15, -0.04, 0, 0, 0], [0.3, 0.12, 0.12, 0.03, 0], [0.48, ...BODY0]] },
      // Krok från sidan
      { arm: [at(0, S), [0.15, -1.3, -0.9, -1.8, -0.6, 0], [0.3, -1.4, 0.5, -1.6, 0.6, 0], at(0.48, S)],
        body: [[0, ...BODY0], [0.15, 0, 0, 0.03, 0.08], [0.3, 0.1, 0.06, 0.04, -0.08], [0.48, ...BODY0]] },
    ],
    // Ett stort svingslag
    h: { arm: [[0, -1.4, -1.2, -1.9, -0.7, 0], [0.15, -1.3, -1.3, -2.0, -0.8, 0], [0.3, -1.5, 0.6, -1.5, 0.7, 0], at(0.7, S)],
      body: [[0, -0.05, -0.04, 0.03, 0.1], [0.15, -0.06, -0.05, 0.04, 0.12], [0.3, 0.2, 0.15, 0.06, -0.12], [0.7, ...BODY0]] },
    t: { arm: [at(0, S), [0.13, -0.8, -0.2, -2.3, -0.5, 0], [0.26, -1.55, 0.05, -0.1, 0.6, 0], at(0.5, S)],
      body: [[0, ...BODY0], [0.13, -0.06, -0.05, 0, 0], [0.26, 0.22, 0.3, 0.08, 0], [0.5, ...BODY0]] },
  },
};
// Kasta vapnet: upp bakom axeln, sedan släpps det vid tiden 0,22 (COMBAT.throw.windup)
const THROW_MOVE = {
  arm: [at(0, S), [0.14, -2.9, -0.35, -1.6, -0.55, -0.4], [0.22, -1.5, 0.1, -0.2, 0.55, 0.3], [0.36, -0.9, 0.35, -0.2, 0.6, 0.2], at(0.6, S)],
  body: [[0, ...BODY0], [0.14, -0.18, -0.06, 0, 0.06], [0.22, 0.25, 0.16, 0.04, -0.06], [0.36, 0.2, 0.14, 0.04, 0], [0.6, ...BODY0]],
};
function movesFor(key) {
  return MOVES[key] || MOVES.sword;
}

// Tvåhandsvapen: parera genom att lyfta vapnet på tvären framför kroppen
const PARRY_2H = [-1.35, -0.25, -1.15, -0.2, 1.45];
// Zweihändern släpas efter riddaren med spetsen i sanden när man går
const DRAG_R = [0.3, -0.3, -0.15, 0, 2.15]; // klingan pekar bakåt och neråt
// Sköldarmen: [tid, överarm framåt, överarm i sidled, underarm böj]
const STANCE_L = [-0.45, -0.12, -1.5];
const CARRY_L = [-0.2, 0, -1.3];
const PARRY_KEYS = [
  [0.0, -0.45, -0.12, -1.5],
  [0.07, -0.95, -0.3, -1.2],
  [0.3, -0.95, -0.3, -1.2],
  [0.45, -0.45, -0.12, -1.5],
];
// Spark med höger ben: [tid, lår framåt, knäböj, bålens lutning]
const KICK_KEYS = [
  [0.0, 0.0, 0.2, 0.0],
  [0.1, -0.7, 1.4, -0.15],
  [0.2, -1.5, 0.1, -0.3],
  [0.32, -1.2, 0.3, -0.25],
  [0.48, 0.0, 0.2, 0.0],
];
const EMOTE_LENGTH = { 1: 1.8, 2: 2.0, 3: 3.2 };

function sampleKeys(keys, t) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1];
      const b = keys[i];
      let k = (t - a[0]) / (b[0] - a[0]);
      k = k * k * (3 - 2 * k); // mjuk övergång
      return a.slice(1).map((v, j) => v + (b[j + 1] - v) * k);
    }
  }
  return keys[keys.length - 1].slice(1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Konturen av en formad sköld (i XY-planet)
function shieldShape(kind) {
  const s = new THREE.Shape();
  if (kind === 1) {
    // Droppformad: rund upptill, spetsig nertill
    s.moveTo(0, 0.38);
    s.quadraticCurveTo(0.22, 0.38, 0.22, 0.17);
    s.quadraticCurveTo(0.2, -0.15, 0, -0.44);
    s.quadraticCurveTo(-0.2, -0.15, -0.22, 0.17);
    s.quadraticCurveTo(-0.22, 0.38, 0, 0.38);
  } else if (kind === 2) {
    // Klassisk riddarsköld: rak överkant, rundad spets
    s.moveTo(-0.25, 0.28);
    s.lineTo(0.25, 0.28);
    s.lineTo(0.25, 0.06);
    s.quadraticCurveTo(0.23, -0.2, 0, -0.34);
    s.quadraticCurveTo(-0.23, -0.2, -0.25, 0.06);
    s.lineTo(-0.25, 0.28);
  } else {
    // Pavis: stor rektangel med rundade hörn
    const w = 0.25;
    const h = 0.4;
    const r = 0.06;
    s.moveTo(-w + r, h);
    s.lineTo(w - r, h);
    s.quadraticCurveTo(w, h, w, h - r);
    s.lineTo(w, -h + r);
    s.quadraticCurveTo(w, -h, w - r, -h);
    s.lineTo(-w + r, -h);
    s.quadraticCurveTo(-w, -h, -w, -h + r);
    s.lineTo(-w, h - r);
    s.quadraticCurveTo(-w, h, -w + r, h);
  }
  return s;
}

// Gör om en platt form så att bilden (vapenmönstret) täcker den exakt
function fitUVs(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const uv = geometry.attributes.uv;
  const pos = geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (pos.getX(i) - box.min.x) / (box.max.x - box.min.x), (pos.getY(i) - box.min.y) / (box.max.y - box.min.y));
  }
  uv.needsUpdate = true;
  return geometry;
}

// Återanvända hjälpvektorer (så vi inte skapar skräp varje bildruta)
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _xAxis = new THREE.Vector3(1, 0, 0);
const _inv = new THREE.Matrix4();
const _mat = new THREE.Matrix4();
const _mid = new THREE.Vector3();
const _linkScale = new THREE.Vector3(1, 1.7, 1);

export class Knight {
  constructor(colorHex, name = null, look = {}, opts = {}) {
    look = { a: 0, h: 0, s: 0, w: 0, c: 0, ...look };
    this.look = look;
    this.isBot = !!opts.bot; // träningsmotståndare får en liten skylt i namnet
    this.group = new THREE.Group();
    this.materials = [];
    this.seg = {};
    this.stumps = [];
    this.legLoss = 0;
    this.bloodSplats = 0;
    this.decals = 0;
    this.swordBlood = 0;
    this.soft = []; // tyg som ska röras av fysiken: { cloth, pins: [[seg, [x,y,z]]...], colliders }

    this.phase = 0;
    this.amp = 0;
    this.attack = null;
    this.charging = false;
    this.chargeAmount = 0;
    this.parryT = -1;
    this.staggerT = -1;
    this.kickT = -1;
    this.hitT = -1;
    this.hitDir = [0, 0];
    this.landT = -1;
    this.emote = null;
    this.flashT = 0;
    this.feet = new FootPlanner();
    this.wasAirborne = false;
    this.onFootstep = null; // anropas (sida, [x, z], vridning) när en fot sätts ner
    this.helmetOff = false;
    // Ansiktsuttryck
    this.mouthOpen = 0;
    this.mouthTimer = 0;
    this.mouthTarget = 0;
    this.squint = 0;
    this.blinkTimer = 1 + Math.random() * 3;
    this.visorOpen = 0;

    const style = ARMOR_STYLES[look.a] || ARMOR_STYLES[0];
    this.style = style;
    this.wIndex = look.w; // vapnet riddaren håller just nu (FISTS = inget)
    const wspec = weaponSpec(look.w);
    this.weaponKey = wspec.key;
    this.twoHanded = !!wspec.twoHanded; // tvåhandsvapen: ingen sköld, vänster hand på greppet
    this.victory = 0;  // placering på prispallen (1–3) när matchen är slut
    this.groundY = 0;  // markens höjd under fötterna (prispallen)
    this.spinT = -1;   // zweihändern: snurrar runt efter ett bom
    this.wobbleT = -1;
    this.crouching = false; // hukar (C)
    this.crouchAmt = 0;
    this.rollT = -1;        // rullning pågår
    this.rollAxis = new THREE.Vector3(1, 0, 0);
    this.downT = -1;        // omsparkad: ligger på marken
    this.legless = false;   // båda benen avhuggna: sitter på marken
    this.grab = null;       // brottning: "hold", "held", "reach"
    this.grabT = 0;
    this.struggleT = -1;
    this.sitAmt = 0;
    this.plume = null;      // plymen vajar
    this.nicks = 0;         // hack i eggen
    const isPlate = style === "plate" || style === "gilded";
    const gilded = style === "gilded";
    this.isMetal = isPlate || style === "hedge";

    // Ansiktsdrag slumpas fram ur ett frö (spelarens id), så alla ser samma ansikte
    const rand = seededRandom(opts.seed ?? colorHex + 7);
    const features = {
      skin: SKIN[Math.floor(rand() * SKIN.length)],
      hair: HAIR[Math.floor(rand() * HAIR.length)],
      eyes: EYES[Math.floor(rand() * EYES.length)],
      hairStyle: Math.floor(rand() * 4), // 0 kort, 1 långt, 2 flint, 3 pottfrisyr
      beard: Math.floor(rand() * 4),     // 0 inget, 1 mustasch, 2 helskägg, 3 pipskägg
      // Ansiktets form och kännetecken
      jaw: 0.14 + rand() * 0.2,          // smalare eller bredare käke
      chin: rand(),                      // hur mycket hakan sticker ut
      nose: 0.85 + rand() * 0.45,        // näsans storlek
      broken: rand() < 0.15,             // bruten (sned) näsa
      scar: rand() < 0.14,               // ärr över ögat
      patch: rand() < 0.05,              // lapp för ögat
      gap: rand() < 0.18,                // en tand saknas
      stubble: rand() < 0.55,            // skäggstubb
      brow: rand(),                      // kraftiga eller tunna ögonbryn
    };

    // ---------- Material ----------
    const m = {};
    m.cloth = this.mat(colorHex, 0.85, 0);
    m.cloth.side = THREE.DoubleSide; // kjolar och mantlar är öppna
    m.capeCloth = this.mat(colorHex, 0.9, 0, { map: linenTexture(), side: THREE.DoubleSide });
    m.tabardCloth = this.mat(colorHex, 0.88, 0, { map: linenTexture(), alphaMap: daggedTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
    m.herald = this.mat(0xffffff, 0.8, 0, { map: heraldryTexture(colorHex) });
    this.gilded = gilded;
    // Stålet har en borstad yta med fina repor (i ytan, så det ser rent ut på håll men detaljerat på nära håll)
    m.steel = gilded
      ? this.mat(0xe4e8ee, 0.26, 0.84, { map: plateTexture(), bumpMap: plateTexture(), bumpScale: 0.6 })
      : this.mat(0xb8bec6, 0.4, 0.78, { map: plateTexture(), bumpMap: plateTexture(), bumpScale: 0.8 });
    m.steelDark = this.mat(0x6a7079, 0.42, 0.72);
    m.gold = this.mat(0xd8ae42, 0.3, 0.85);
    m.brass = this.mat(0xc49440, 0.35, 0.8);
    m.chain = this.mat(0xbcc2ca, 0.45, 0.75, { map: chainmailTexture(), bumpMap: chainmailTexture(), bumpScale: 2 });
    m.leather = this.mat(0xa8763f, 0.72, 0, { map: leatherTexture() });
    m.leatherDark = this.mat(0x553620, 0.78, 0, { map: leatherTexture() });
    m.strap = this.mat(0x3a2414, 0.75, 0, { map: leatherTexture() });
    m.wool = this.mat(0x5a4632, 0.95, 0, { map: wrapTexture() });
    m.quilt = this.mat(0xd8c8a0, 0.95, 0, { map: quiltTexture() });
    m.straw = this.mat(0xffffff, 0.9, 0, { map: strawTexture() });
    m.rope = this.mat(0xa08850, 0.95, 0);
    m.skin = this.mat(features.skin, 0.72, 0);
    m.lips = this.mat(new THREE.Color(features.skin).multiplyScalar(0.72).getHex(), 0.6, 0);
    m.hair = this.mat(features.hair, 0.9, 0);
    m.eyeWhite = this.mat(0xf4f0e8, 0.3, 0);
    m.iris = this.mat(features.eyes, 0.25, 0);
    m.mouth = this.mat(0x2a0e0c, 0.8, 0);
    m.teeth = this.mat(0xeee6d0, 0.5, 0);
    m.helmInner = this.mat(0x16161a, 0.9, 0, { side: THREE.BackSide });
    m.hole = this.mat(0x0c0c0e, 0.9, 0);
    m.white = this.mat(0xf2efe6, 0.8, 0);
    m.blade = this.mat(0xd4dae2, 0.3, 0.62);
    m.wood = this.mat(0xd8c8b8, 0.85, 0, { map: woodGrainTexture() }); // ådrat trä med kvistar
    m.forged = this.mat(0xffffff, 0.82, 0.45, { map: forgedTexture(), bumpMap: forgedTexture(), bumpScale: 3 }); // matt smitt järn
    m.forgedFace = this.mat(0xc8c4be, 0.6, 0.55, { map: forgedTexture() }); // slagytor: lite blankare av slitage
    m.rag = this.mat(0x9a8866, 0.97, 0, { map: wrapTexture() });             // smutsiga trasor
    m.iron = this.mat(0x4a4e55, 0.5, 0.7);
    m.blood = this.mat(BLOOD, 0.4, 0.1);
    m.trim = gilded ? m.gold : m.brass;
    m.scratch = isPlate ? this.mat(0xf2f5f8, 0.3, 0.45) : this.mat(0xd8bc90, 0.8, 0);
    m.edge = this.mat(0xf4f7fa, 0.14, 0.92); // slipad, blank egg
    if (style === "hedge") {
      // Den vandrande riddaren: rostigt, matt stål, rostig brynja, blekt tyg och leriga stövlar
      m.rusty = this.mat(0xffffff, 0.75, 0.45, { map: rustyPlateTexture(), bumpMap: rustyPlateTexture(), bumpScale: 2.5 });
      m.rustChain = this.mat(0xa08c78, 0.62, 0.55, { map: chainmailTexture(), bumpMap: chainmailTexture(), bumpScale: 2 });
      m.faded = this.mat(new THREE.Color(colorHex).lerp(new THREE.Color(0x8a7a62), 0.45).getHex(), 0.95, 0,
        { map: linenTexture(), alphaMap: daggedTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
      m.mud = this.mat(0x4a3622, 0.98, 0, { map: leatherTexture() });
      m.capeCloth.color.lerp(new THREE.Color(0x5a4a3a), 0.45); // smutsig resemantel
      m.capeCloth.userData.baseColor = m.capeCloth.color.clone();
    }
    if (style === "jester") {
      // Gycklaren: spelarens färg och en färg som syns bra bredvid
      const hsl = new THREE.Color(colorHex).getHSL({});
      const yellowish = hsl.h > 0.08 && hsl.h < 0.18 && hsl.s > 0.4;
      const other = yellowish || hsl.l > 0.75 ? 0x6a2f8f : 0xe6c13a;
      m.motleyA = this.mat(colorHex, 0.8, 0, { map: linenTexture() });
      m.motleyB = this.mat(other, 0.8, 0, { map: linenTexture() });
      m.bell = this.mat(0xe0b040, 0.25, 0.9);
    }
    this.m = m;
    for (const mat of this.materials) mat.userData.baseColor = mat.color.clone();

    // Vad lemmarna består av under rustningen
    const limbMat = { plate: m.chain, gilded: m.chain, chain: m.chain, leather: m.leather, peasant: m.quilt, jester: m.motleyA, hedge: m.rustChain }[style];
    const legMat = { plate: m.chain, gilded: m.chain, chain: m.chain, leather: m.wool, peasant: m.wool, jester: m.motleyB, hedge: m.wool }[style];
    this.limbMat = limbMat;

    // ---------- Kroppsdelarna ----------
    // segment(namn, förälder, ledens position, punkter för fysiken, radie)

    // Bålens form för att hålla armarna utanför den (se keepArmsOut)
    this.chestBody = isPlate ? { rx: 0.205, rz: 0.145, ar: 0.068 } : style === "hedge" ? { rx: 0.19, rz: 0.135, ar: 0.062 } : { rx: 0.168, rz: 0.112, ar: 0.054 };
    const pelvis = this.segment("pelvis", this.group, [0, 1.0, 0], [[0, 0, 0], [0.1, -0.08, 0], [-0.1, -0.08, 0]], 0.1);
    const torso = this.segment("torso", pelvis, [0, 0, 0], [[0, 0, 0], [0, 0.44, 0], [0.19, 0.4, 0], [-0.19, 0.4, 0], [0, 0.25, 0.12]], 0.13);
    const head = this.segment("head", torso, [0, 0.46, 0], [[0, 0, 0], [0, 0.28, 0], [0, 0.12, 0.12]], 0.12);

    this.buildTorso(pelvis, torso, style, m, isPlate, gilded, limbMat, look);
    this.buildHead(head, m, features);
    this.helmet = new THREE.Group();
    this.helmet.userData.helmet = true;
    head.add(this.helmet);
    if (style === "jester") this.buildJesterHat(this.helmet, m);
    else this.buildHelmet(this.helmet, look.h, m, gilded);

    for (const side of ["L", "R"]) {
      const s = side === "L" ? 1 : -1;
      const upper = this.segment("upperArm" + side, torso, [0.212 * s, 0.41, 0], [[0, 0, 0], [0, -0.29, 0], [0.05 * s, -0.14, 0]], 0.055);
      const fore = this.segment("forearm" + side, upper, [0, -0.29, 0], [[0, 0, 0], [0, -0.26, 0], [0.05 * s, -0.13, 0]], 0.05);
      const hand = this.segment("hand" + side, fore, [0, -0.26, 0], [[0, 0, 0], [0, -0.1, 0], [0.04 * s, -0.05, 0]], 0.045);
      const thigh = this.segment("thigh" + side, pelvis, [0.1 * s, -0.08, 0], [[0, 0, 0], [0, -0.42, 0], [0.06 * s, -0.21, 0]], 0.075);
      const shin = this.segment("shin" + side, thigh, [0, -0.42, 0], [[0, 0, 0], [0, -0.4, 0], [0.05 * s, -0.2, 0]], 0.065);
      const foot = this.segment("foot" + side, shin, [0, -0.4, 0], [[0, 0, 0], [0, -0.06, 0.2], [0.05 * s, -0.06, 0]], 0.055);

      // Lemmarna under rustningen (formade, inte rör). Kulor i lederna så det aldrig blir glipor.
      // Gycklaren har olika färg på vänster och höger sida (och korsvis på benen).
      const lm = style === "jester" ? (side === "L" ? m.motleyA : m.motleyB) : limbMat;
      const lg = style === "jester" ? (side === "L" ? m.motleyB : m.motleyA) : legMat;
      upper.add(this.shape(latheAlong(PROFILE.upperArm, 0.29), lm));
      upper.add(this.shape(new THREE.SphereGeometry(0.06, 10, 8), lm));
      fore.add(this.shape(latheAlong(PROFILE.forearm, 0.26), lm));
      fore.add(this.shape(new THREE.SphereGeometry(0.05, 10, 8), lm));
      thigh.add(this.shape(latheAlong(PROFILE.thigh, 0.42), lg));
      thigh.add(this.shape(new THREE.SphereGeometry(0.082, 10, 8), lg));
      shin.add(this.shape(latheAlong(PROFILE.shin, 0.4), lg));
      shin.add(this.shape(new THREE.SphereGeometry(0.062, 10, 8), lg));
      if (style === "chain" || style === "jester") shin.add(this.shape(new THREE.SphereGeometry(0.045, 10, 8), lg, [0, -0.005, 0.04], [1, 0.95, 0.6])); // knäskål
      fore.add(this.shape(new THREE.SphereGeometry(0.04, 8, 6), lm, [0, 0.005, -0.035], [1, 0.9, 0.6])); // armbågsspets

      if (isPlate) this.buildPlateLimbs(side, s, upper, fore, hand, thigh, shin, foot, m, gilded);
      else if (style === "chain") this.buildChainLimbs(side, s, upper, fore, hand, thigh, shin, foot, m);
      else if (style === "leather") this.buildLeatherLimbs(side, s, upper, fore, hand, thigh, shin, foot, m);
      else if (style === "jester") this.buildJesterLimbs(side, s, upper, fore, hand, thigh, shin, foot, m);
      else if (style === "hedge") this.buildHedgeLimbs(side, s, upper, fore, hand, thigh, shin, foot, m);
      else this.buildPeasantLimbs(side, s, upper, fore, hand, thigh, shin, foot, m);
    }

    // Proportioner: längre bål och armar, lite mindre huvud, större händer och fötter.
    // Varje riddare blir också lite olika lång i överkroppen och olika bred över axlarna.
    const build = seededRandom((opts.seed ?? colorHex) * 13 + 5);
    const tall = 1.08 + build() * 0.08;
    const broad = 0.98 + build() * 0.08;
    this.reshape({
      torso: [broad, tall, 1],
      head: [0.94, 0.94, 0.94],
      upperArmL: [1, 1.1, 1], upperArmR: [1, 1.1, 1],
      forearmL: [1, 1.04, 1], forearmR: [1, 1.04, 1],
      handL: [1.15, 1.15, 1.15], handR: [1.15, 1.15, 1.15],
      footL: [1.04, 1.02, 1.14], footR: [1.04, 1.02, 1.14],
      pelvis: [0.96, 1, 1],
    });
    this.armLen = [0.29 * 1.1, 0.26 * 1.04]; // överarm, underarm (för armlösaren)
    this.chestBody.rx *= broad;
    this.chestBody.top = 0.44 * tall;

    // Vapen och sköld
    const weapon = this.buildWeapon(look.w, m, gilded);
    weapon.position.set(0, -0.069, 0.01);
    weapon.rotation.x = 2.0;
    weapon.userData.equipment = true; // siktet ska inte räkna vapnet som kroppsdel
    this.seg.handR.add(weapon);
    this.weapon = weapon;
    this.sword = weapon; // gammalt namn

    // Sköld (inte med tvåhandsvapen)
    const shield = this.twoHanded ? new THREE.Group() : this.buildShield(look.s, m, colorHex);
    shield.position.set(0.03, -0.115, 0);
    shield.rotation.x = 1.6;
    shield.userData.equipment = true;
    this.seg.handL.add(shield);
    this.shield = shield;

    // Slå ihop småbitarna i varje kroppsdel (färre ritanrop = högre FPS)
    for (const seg of Object.values(this.seg)) this.mergeChildren(seg);
    this.mergeChildren(weapon);
    this.mergeChildren(shield);
    this.mergeChildren(this.helmet);
    if (this.plume) this.mergeChildren(this.plume);
    this.mergeChildren(this.hairGroup);
    this.closedHelmet = style !== "jester" && [0, 1, 4].includes(look.h);
    this.hairGroup.visible = !this.closedHelmet;

    // Blod på vapnet (syns mer ju fler man träffat)
    this.bladeBloodMat = new THREE.MeshStandardMaterial({ color: BLOOD, roughness: 0.3, transparent: true, opacity: 0, depthWrite: false });
    this.addWeaponBlood(look.w);

    // Mjukt tyg: mantel (valfri) och vapenrockens skört (ringbrynja)
    if (look.c === 1) this.addCape(m, gilded);
    if (style === "chain") this.addTabard(m);

    this.group.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    this.name = name;
    this.colorHex = colorHex;
    if (name) this.createLabel();
  }

  // ---------- Bål och höfter ----------

  buildTorso(pelvis, torso, style, m, isPlate, gilded, limbMat, look) {
    const P = (...a) => pelvis.add(this.shape(...a));
    const T = (...a) => torso.add(this.shape(...a));

    // Höfterna
    P(new THREE.SphereGeometry(1, 14, 10), isPlate || style === "chain" ? m.chain : m.wool, [0, -0.04, 0], [0.16, 0.11, 0.12]);
    // Axlarna sitter fast på bålen, så det aldrig blir ett tomrum mellan arm och kropp
    for (const s of [1, -1]) T(new THREE.SphereGeometry(0.075, 12, 8), limbMat, [0.178 * s, 0.395, 0], [1.15, 0.85, 1.1]);

    if (isPlate) {
      // Bröstharnesk: format runt bålen, med mittås, rullad halskant och nitar
      const chest = [[0.15, 0.0], [0.168, 0.06], [0.192, 0.2], [0.2, 0.3], [0.182, 0.39], [0.13, 0.445], [0.095, 0.46]]
        .map(([r, y]) => new THREE.Vector2(r, y));
      T(sculptChest(new THREE.LatheGeometry(chest, 24), 0, 0.46), m.steel, [0, 0, 0], [1.15, 1, 0.78]);
      T(new THREE.BoxGeometry(0.018, 0.36, 0.02), gilded ? m.gold : m.steel, [0, 0.24, 0.155], [1, 1, 1], [-0.08, 0, 0]); // mittås
      T(new THREE.TorusGeometry(0.1, 0.014, 6, 18), gilded ? m.gold : m.steel, [0, 0.455, 0], [1.1, 0.78, 1], [Math.PI / 2, 0, 0]); // halskant
      T(new THREE.TorusGeometry(0.175, 0.008, 5, 22), m.trim, [0, 0.01, 0], [1.15, 0.78, 1], [Math.PI / 2, 0, 0]); // nederkant
      for (let i = -3; i <= 3; i++) {
        const a = i * 0.32;
        T(new THREE.SphereGeometry(0.008, 5, 4), m.trim, [Math.sin(a) * 0.2, 0.035, Math.cos(a) * 0.15]); // nitar
      }
      // Halsskydd (krage i plåt) upp till hjälmen
      T(new THREE.CylinderGeometry(0.068, 0.092, 0.09, 16, 1, true), m.steel, [0, 0.49, 0], [1.05, 1, 0.95]);
      T(new THREE.TorusGeometry(0.07, 0.006, 4, 16), m.trim, [0, 0.535, 0], [1.05, 0.95, 1], [Math.PI / 2, 0, 0]);
      // Axelplåtar på bålen (under axelskydden)
      for (const s of [1, -1]) {
        T(new THREE.SphereGeometry(0.09, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.steel, [0.16 * s, 0.395, 0], [1.15, 0.6, 1.15]);
      }
      if (gilded) {
        // Praktrustningen: guldemblem på bröstet och ett graverat guldband
        T(new THREE.CylinderGeometry(0.034, 0.034, 0.008, 16), m.gold, [0, 0.32, 0.158], [1, 1, 1], [Math.PI / 2 - 0.08, 0, 0]);
        T(new THREE.TorusGeometry(0.034, 0.004, 4, 16), m.gold, [0, 0.32, 0.163], [1, 1, 1], [-0.08, 0, 0]);
        T(new THREE.ConeGeometry(0.014, 0.03, 4), m.white, [0, 0.322, 0.166], [1, 1, 0.3], [0, 0, Math.PI]);
      }
      // Band i spelarens färg snett över bröstet (så man ser vem som är vem), knutet vid höften
      this.addSash(T, P, m, 0.212, 0.172);
      // Svärdsbälte över plåtkjolen med spänne
      P(new THREE.TorusGeometry(0.19, 0.011, 4, 24), m.strap, [0, -0.05, 0], [1.08, 0.8, 1], [Math.PI / 2, 0, 0.08]);
      P(new THREE.BoxGeometry(0.04, 0.032, 0.012), m.brass, [0.03, -0.055, 0.154], [1, 1, 1], [0, 0, 0.08]);
      // Plåtkjol i lameller, tygkjol under och höftskydd framtill
      for (let i = 0; i < 3; i++) {
        P(new THREE.CylinderGeometry(0.168 + i * 0.008, 0.176 + i * 0.008, 0.055, 18, 1, true), m.steel, [0, -0.02 - i * 0.048, 0], [1.08, 1, 0.8]);
        P(new THREE.TorusGeometry(0.176 + i * 0.008, 0.005, 4, 20), m.trim, [0, -0.047 - i * 0.048, 0], [1.08, 0.8, 1], [Math.PI / 2, 0, 0]);
      }
      P(new THREE.CylinderGeometry(0.17, 0.2, 0.2, 16, 1, true), m.cloth, [0, -0.2, 0], [1, 1, 0.78]);
      for (const s of [1, -1]) {
        P(new THREE.BoxGeometry(0.13, 0.17, 0.012), m.steel, [0.085 * s, -0.22, 0.135], [1, 1, 1], [-0.12, 0, 0]); // höftskydd
        P(new THREE.SphereGeometry(0.008, 5, 4), m.trim, [0.085 * s, -0.15, 0.143]);
      }
      if (look.w === 0) this.addScabbard(pelvis, m, gilded ? m.gold : m.steelDark);
    } else if (style === "chain") {
      // Vapenrock med vapenmönster över ringbrynjan (skörtet nedtill är mjukt tyg, se addTabard)
      T(sculptTorso(new THREE.CapsuleGeometry(0.15, 0.2, 8, 18), 0.25), m.chain, [0, 0.24, 0], [1.22, 1, 0.76]);
      T(new THREE.BoxGeometry(0.3, 0.42, 0.012), m.cloth, [0, 0.21, 0.122]);
      T(new THREE.PlaneGeometry(0.29, 0.4), m.herald, [0, 0.21, 0.129]);
      T(new THREE.BoxGeometry(0.3, 0.42, 0.012), m.cloth, [0, 0.21, -0.122]);
      // Ringbrynjehuva över halsen och axlarna
      T(new THREE.CylinderGeometry(0.075, 0.13, 0.12, 14, 1, true), m.chain, [0, 0.47, 0], [1.1, 1, 0.9]);
      P(new THREE.CylinderGeometry(0.162, 0.18, 0.12, 16, 1, true), m.chain, [0, -0.07, 0], [1, 1, 0.78]); // ringbrynjans nederkant
      P(new THREE.CylinderGeometry(0.162, 0.162, 0.045, 16), m.strap, [0, 0, 0], [1, 1, 0.8]); // bälte
      P(new THREE.BoxGeometry(0.05, 0.05, 0.02), m.brass, [0, 0, 0.13]);
      P(new THREE.BoxGeometry(0.012, 0.09, 0.008), m.strap, [0.03, -0.05, 0.132]); // bältets ände hänger ner
      // Vadderad jacka (gambesong) under brynjan: syns vid halsen och längst ner
      T(new THREE.TorusGeometry(0.08, 0.02, 6, 16), m.quilt, [0, 0.52, 0], [1.08, 0.95, 1], [Math.PI / 2, 0, 0]);
      P(new THREE.CylinderGeometry(0.178, 0.195, 0.06, 16, 1, true), m.quilt, [0, -0.15, 0], [1, 1, 0.8]);
      // Pung och dolk i bältet
      P(new THREE.BoxGeometry(0.075, 0.085, 0.045), m.leatherDark, [-0.13, -0.05, 0.085], [1, 1, 1], [0, 0.5, 0]);
      P(new THREE.SphereGeometry(0.009, 5, 4), m.brass, [-0.135, -0.015, 0.105]);
      P(new THREE.BoxGeometry(0.03, 0.18, 0.018), m.leatherDark, [0.14, -0.1, 0.07], [1, 1, 1], [0, 0, 0.25]);
      P(new THREE.CylinderGeometry(0.009, 0.009, 0.06, 6), m.wood, [0.16, 0.02, 0.07], [1, 1, 1], [0, 0, 0.25]);
      P(new THREE.BoxGeometry(0.045, 0.009, 0.012), m.steelDark, [0.152, -0.012, 0.07], [1, 1, 1], [0, 0, 0.25]);
      if (look.w === 0) this.addScabbard(pelvis, m, m.leatherDark);
    } else if (style === "leather") {
      // Läderjacka med remmar, spännen, nitar och axelskydd
      T(sculptTorso(new THREE.CapsuleGeometry(0.15, 0.2, 8, 18), 0.25), m.leather, [0, 0.24, 0], [1.24, 1, 0.78]);
      T(new THREE.CylinderGeometry(0.075, 0.1, 0.07, 14, 1, true), m.leatherDark, [0, 0.47, 0], [1.1, 1, 0.9]); // hög krage
      for (const s of [1, -1]) {
        T(new THREE.BoxGeometry(0.038, 0.5, 0.012), m.strap, [0.02 * s, 0.24, 0.12], [1, 1, 1], [0, 0, 0.5 * s]); // korsade remmar
        T(new THREE.BoxGeometry(0.03, 0.026, 0.006), m.brass, [0.08 * s, 0.3, 0.13]);                        // spännen
        T(new THREE.BoxGeometry(0.008, 0.026, 0.008), m.strap, [0.08 * s, 0.3, 0.134]);
      }
      // Sömmar och nitar längs framkanten
      for (let y = 0.06; y < 0.42; y += 0.06) {
        for (const x of [-0.035, 0.035]) T(new THREE.SphereGeometry(0.009, 5, 4), m.brass, [x, y, 0.118]);
      }
      T(new THREE.BoxGeometry(0.005, 0.4, 0.004), m.strap, [0, 0.23, 0.119]); // snörning
      // Slitna, ljusare fläckar och lagningar
      T(new THREE.SphereGeometry(1, 8, 6), m.leather, [-0.1, 0.32, 0.11], [0.035, 0.026, 0.005], [0, -0.5, 0.3]);
      T(new THREE.BoxGeometry(0.06, 0.05, 0.006), m.leatherDark, [0.11, 0.12, 0.112], [1, 1, 1], [0, 0.4, -0.2]);
      for (let i = 0; i < 4; i++) T(new THREE.BoxGeometry(0.012, 0.003, 0.004), m.strap, [0.11 + (i - 1.5) * 0.014, 0.148, 0.116], [1, 1, 1], [0, 0.4, 1.4]); // stygn
      this.addSash(T, P, m, 0.2, 0.13, -1); // band i spelarens färg
      P(new THREE.CylinderGeometry(0.16, 0.19, 0.2, 14, 1, true), m.leather, [0, -0.09, 0], [1, 1, 0.78]);
      P(new THREE.CylinderGeometry(0.165, 0.165, 0.05, 16), m.strap, [0, 0, 0], [1, 1, 0.8]); // bälte
      P(new THREE.BoxGeometry(0.06, 0.05, 0.008), m.brass, [0, 0, 0.133]);
      P(new THREE.BoxGeometry(0.08, 0.09, 0.05), m.leatherDark, [-0.13, -0.05, 0.08]);  // pung
      P(new THREE.SphereGeometry(0.01, 5, 4), m.brass, [-0.13, -0.02, 0.106]);
      P(new THREE.BoxGeometry(0.035, 0.2, 0.02), m.leatherDark, [0.15, -0.1, 0.06], [1, 1, 1], [0, 0, 0.2]); // dolkslida
      P(new THREE.SphereGeometry(0.018, 6, 5), m.brass, [0.165, 0.01, 0.06]);
    } else if (style === "jester") {
      this.buildJesterTorso(pelvis, torso, m);
    } else if (style === "hedge") {
      this.buildHedgeTorso(pelvis, torso, m, look);
    } else {
      // Bonde: vadderad jacka med lappar, repbälte, huva och trasig fåll
      T(sculptTorso(new THREE.CapsuleGeometry(0.155, 0.2, 8, 18), 0.255), m.quilt, [0, 0.24, 0], [1.26, 1, 0.8]);
      T(new THREE.TorusGeometry(0.1, 0.035, 8, 16), m.wool, [0, 0.45, -0.01], [1.1, 1, 1], [Math.PI / 2 + 0.2, 0, 0]); // nedfälld huva
      T(new THREE.BoxGeometry(0.09, 0.09, 0.01), m.leather, [0.08, 0.3, 0.125], [1, 1, 1], [0, 0, 0.2]);   // lapp
      T(new THREE.BoxGeometry(0.07, 0.06, 0.01), m.wool, [-0.1, 0.14, 0.123], [1, 1, 1], [0, 0, -0.3]);    // lapp
      this.addSash(T, P, m, 0.205, 0.135); // band i spelarens färg
      P(new THREE.CylinderGeometry(0.165, 0.2, 0.22, 14, 1, true), m.quilt, [0, -0.1, 0], [1, 1, 0.8]);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const len = 0.03 + ((i * 7) % 5) * 0.012;
        P(new THREE.ConeGeometry(0.024, len, 3), m.quilt, [Math.sin(a) * 0.2, -0.21 - len / 2, Math.cos(a) * 0.16], [1, 1, 1], [Math.PI, 0, 0]); // trasig fåll
      }
      P(new THREE.TorusGeometry(0.165, 0.012, 5, 18), m.rope, [0, 0, 0], [1, 0.8, 1], [Math.PI / 2, 0, 0]); // repbälte
      P(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 4), m.rope, [0.06, -0.06, 0.135]);                // knuten
      // En liten pung och en träkåsa som hänger i repet, och en lapp till på ryggen
      P(new THREE.SphereGeometry(1, 8, 6), m.leather, [-0.12, -0.07, 0.1], [0.035, 0.045, 0.025]);
      P(new THREE.CylinderGeometry(0.012, 0.003, 0.04, 5), m.rope, [-0.12, -0.02, 0.1]);
      P(new THREE.CylinderGeometry(0.028, 0.022, 0.04, 10), m.wood, [0.15, -0.07, 0.06], [1, 1, 1], [0.2, 0, 0.3]);
      P(new THREE.TorusGeometry(0.012, 0.004, 4, 8), m.wood, [0.175, -0.06, 0.06], [1, 1, 1], [0, Math.PI / 2, 0]);
      T(new THREE.BoxGeometry(0.1, 0.08, 0.01), m.wool, [0.03, 0.25, -0.128], [1, 1, 1], [0, 0, 0.15]);
      for (let i = 0; i < 5; i++) T(new THREE.BoxGeometry(0.014, 0.003, 0.004), m.rope, [0.03 + (i - 2) * 0.02, 0.292, -0.134], [1, 1, 1], [0, 0, 1.3]); // stygn
    }
  }

  // Band i spelarens färg som går snett runt bålen (ett tygband som ligger an mot kroppen),
  // med en knut och två ändar som hänger vid höften. rx/rz = bålens radie i sidled och framåt.
  addSash(T, P, m, rx, rz, dir = 1) {
    T(new THREE.CylinderGeometry(1, 1, 0.07, 28, 1, true), m.cloth, [0, 0.25, 0.004], [rx, 1, rz], [0, 0, 0.62 * dir]);
    // Knuten och ändarna på höften (på den sida där bandet går lägst)
    const kx = -0.13 * dir;
    P(new THREE.SphereGeometry(0.026, 8, 6), m.cloth, [kx, 0.07, 0.12], [1.2, 0.9, 0.6]);
    P(new THREE.BoxGeometry(0.035, 0.13, 0.008), m.cloth, [kx - 0.01 * dir, -0.01, 0.13], [1, 1, 1], [0.1, 0, 0.12 * dir]);
    P(new THREE.BoxGeometry(0.03, 0.1, 0.008), m.cloth, [kx + 0.025 * dir, 0.0, 0.128], [1, 1, 1], [0.08, 0, -0.18 * dir]);
  }

  // ---------- Vandrande riddare ----------
  // En fattig riddare: hopplockad, rostig rustning över en sliten brynja, lagad med rep, blekt tyg med egen symbol

  buildHedgeTorso(pelvis, torso, m, look) {
    const P = (...a) => pelvis.add(this.shape(...a));
    const T = (...a) => torso.add(this.shape(...a));
    // Rostig brynja under
    T(sculptTorso(new THREE.CapsuleGeometry(0.15, 0.2, 8, 18), 0.25), m.rustChain, [0, 0.24, 0], [1.22, 1, 0.76]);
    T(new THREE.CylinderGeometry(0.075, 0.13, 0.12, 14, 1, true), m.rustChain, [0, 0.47, 0], [1.1, 1, 0.9]);
    // Gammal bröstplåt (lite för liten, sitter snett), med en buckla och en lapp av järn
    const chest = [[0.14, 0.06], [0.16, 0.12], [0.185, 0.24], [0.19, 0.32], [0.17, 0.39], [0.12, 0.43], [0.09, 0.44]].map(([r, y]) => new THREE.Vector2(r, y));
    T(sculptChest(new THREE.LatheGeometry(chest, 18, -Math.PI * 0.55, Math.PI * 1.1), 0.06, 0.44), m.rusty, [0, 0, 0.005], [1.14, 1, 0.8], [0, 0, 0.04]);
    T(new THREE.SphereGeometry(0.03, 8, 6), m.rusty, [0.07, 0.3, 0.14], [1, 0.8, 0.35]);                       // buckla
    T(new THREE.BoxGeometry(0.06, 0.05, 0.006), m.forged, [-0.07, 0.17, 0.14], [1, 1, 1], [-0.1, 0.3, 0.2]);    // järnlapp
    for (const [x, y] of [[-0.095, 0.19], [-0.045, 0.19], [-0.095, 0.15], [-0.045, 0.15]]) T(new THREE.SphereGeometry(0.005, 4, 3), m.forged, [x, y, 0.143]);
    // Remmar som håller plåten: den ena lagad med rep
    for (const sx of [1, -1]) {
      T(new THREE.BoxGeometry(0.022, 0.2, 0.012), sx > 0 ? m.strap : m.rope, [0.12 * sx, 0.4, 0.02], [1, 1, 1], [0.3, 0, 0.15 * sx]);
    }
    T(new THREE.TorusGeometry(0.012, 0.005, 4, 8), m.rope, [-0.12, 0.33, 0.1]);
    // Blekt tygstycke i spelarens färg som hänger från bältet, med en egenmålad symbol
    P(new THREE.PlaneGeometry(0.2, 0.36), m.faded, [0, -0.2, 0.15], [1, 1, 1], [-0.08, 0, 0]);
    P(new THREE.BoxGeometry(0.02, 0.09, 0.004), m.white, [0, -0.16, 0.155], [1, 1, 1], [-0.08, 0, 0.1]);
    P(new THREE.BoxGeometry(0.065, 0.018, 0.004), m.white, [0, -0.14, 0.156], [1, 1, 1], [-0.08, 0, 0.1]);
    // Brynjans nederkant, ett slitet bälte med rep som extra spänne, och en pung
    P(new THREE.CylinderGeometry(0.162, 0.185, 0.13, 16, 1, true), m.rustChain, [0, -0.08, 0], [1, 1, 0.78]);
    P(new THREE.CylinderGeometry(0.165, 0.165, 0.04, 16), m.strap, [0, 0, 0], [1, 1, 0.8]);
    P(new THREE.TorusGeometry(0.02, 0.007, 4, 8), m.rope, [0.02, 0, 0.133]);
    P(new THREE.SphereGeometry(1, 8, 6), m.leatherDark, [0.13, -0.06, 0.08], [0.035, 0.05, 0.03]);
    if (look.w === 0) this.addScabbard(pelvis, m, m.leatherDark);
  }

  buildHedgeLimbs(side, s, upper, fore, hand, thigh, shin, foot, m) {
    const U = (...a) => upper.add(this.shape(...a));
    const F = (...a) => fore.add(this.shape(...a));
    const H = (...a) => hand.add(this.shape(...a));
    const TH = (...a) => thigh.add(this.shape(...a));
    const SH = (...a) => shin.add(this.shape(...a));
    const FT = (...a) => foot.add(this.shape(...a));
    if (side === "L") {
      // Vänster: en enda rostig axelplåt och en läderhandske
      U(new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.rusty, [0.015 * s, -0.005, 0], [1.12, 0.62, 1.2]);
      U(new THREE.CylinderGeometry(0.098, 0.108, 0.045, 16, 1, false), m.rusty, [0.018 * s, -0.035, 0], [1.1, 1, 1.18], [0, 0, 0.1 * s]);
      U(new THREE.TorusGeometry(0.05, 0.006, 4, 12), m.strap, [0, -0.1, 0], [1.2, 1.2, 1], [Math.PI / 2, 0, 0]);
      this.addHand(H, m.leatherDark, s, 1.06);
      F(new THREE.CylinderGeometry(0.048, 0.04, 0.07, 12, 1, true), m.leatherDark, [0, -0.225, 0]);
    } else {
      // Höger: bara en vadderad axel, men en gammal plåthandske och en rostig armskena
      U(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.quilt, [0.012 * s, -0.008, 0], [1.08, 0.75, 1.15]);
      F(latheAlong(PROFILE.forearm, 0.26, 0.15, 0.75, 0.01, false, 0.003), m.rusty);
      F(new THREE.CylinderGeometry(0.058, 0.046, 0.08, 12, 1, true), m.rusty, [0, -0.22, 0]);
      this.addGauntlet(H, m.rusty, m.forged, s);
    }
    // Slitna knäskydd (bara på ena benet) och leriga stövlar
    if (side === "R") {
      SH(new THREE.SphereGeometry(0.072, 10, 8), m.rusty, [0, 0, 0.022], [1, 1, 1.1]);
      SH(new THREE.TorusGeometry(0.05, 0.005, 4, 10), m.rope, [0, -0.06, 0], [1.2, 1.2, 1], [Math.PI / 2, 0, 0]);
    } else {
      TH(new THREE.BoxGeometry(0.07, 0.06, 0.012), m.leather, [0, -0.32, 0.082], [1, 1, 1], [-0.1, 0, 0.2]); // lapp på knät
    }
    SH(new THREE.CylinderGeometry(0.07, 0.06, 0.26, 12, 1, true), m.leatherDark, [0, -0.27, 0]);
    SH(new THREE.CylinderGeometry(0.066, 0.064, 0.13, 12, 1, true), m.mud, [0, -0.33, 0], [1.03, 1, 1.03]);          // lera upp till vaden
    SH(new THREE.CylinderGeometry(0.078, 0.072, 0.04, 12, 1, true), m.leather, [0, -0.14, 0]);
    this.addPointedShoe(FT, m.mud, m.strap, 0.12, false);
  }

  // ---------- Gycklaren ----------
  // Tröja delad på mitten i två färger, uddig krage och kjolkant med bjällror

  buildJesterTorso(pelvis, torso, m) {
    const P = (...a) => pelvis.add(this.shape(...a));
    const T = (...a) => torso.add(this.shape(...a));
    const pointed = (parent, mat, pos, dir, size) => {
      const cone = this.shape(new THREE.ConeGeometry(size, size * 2.8, 4), mat, pos, [1, 1, 0.45]);
      cone.quaternion.setFromUnitVectors(_up, dir);
      parent.add(cone);
    };
    // Vänster halva i spelarens färg, höger i den andra (cylinderns vinkel 0..π = vänster sida)
    for (const [left, mat] of [[true, m.motleyA], [false, m.motleyB]]) {
      T(new THREE.CylinderGeometry(0.15, 0.135, 0.34, 12, 1, false, left ? 0 : Math.PI, Math.PI), mat, [0, 0.2, 0], [1.22, 1, 0.78]);
      T(new THREE.SphereGeometry(0.15, 12, 6, left ? Math.PI / 2 : Math.PI * 1.5, Math.PI, 0, Math.PI / 2), mat, [0, 0.37, 0], [1.22, 0.55, 0.78]);
      P(new THREE.CylinderGeometry(0.155, 0.17, 0.16, 12, 1, false, left ? 0 : Math.PI, Math.PI), left ? m.motleyB : m.motleyA, [0, -0.06, 0], [1, 1, 0.8]);
    }
    // Ruter ner längs mitten i omvända färger
    for (let i = 0; i < 3; i++) {
      T(new THREE.BoxGeometry(0.045, 0.045, 0.012), i % 2 ? m.motleyA : m.motleyB, [0, 0.12 + i * 0.09, 0.118], [1, 1, 1], [0, 0, Math.PI / 4]);
    }
    // Uddig krage med bjällror
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(a) * 0.85, -0.5, Math.cos(a) * 0.85).normalize();
      const base = new THREE.Vector3(Math.sin(a) * 0.12, 0.44, Math.cos(a) * 0.095);
      pointed(torso, i % 2 ? m.motleyA : m.motleyB, base.clone().addScaledVector(dir, 0.05).toArray(), dir, 0.04);
      T(new THREE.SphereGeometry(0.014, 8, 6), m.bell, base.clone().addScaledVector(dir, 0.115).toArray());
    }
    T(new THREE.TorusGeometry(0.075, 0.014, 6, 16), m.bell, [0, 0.455, 0], [1.1, 0.9, 1], [Math.PI / 2, 0, 0]);
    // Bälte och uddig kjolkant
    P(new THREE.CylinderGeometry(0.162, 0.162, 0.04, 16), m.strap, [0, 0.01, 0], [1, 1, 0.8]);
    P(new THREE.BoxGeometry(0.045, 0.04, 0.01), m.bell, [0, 0.01, 0.132]);
    for (let i = 0; i < 12; i++) {
      const a = ((i + 0.5) / 12) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(a) * 0.35, -1, Math.cos(a) * 0.35).normalize();
      pointed(pelvis, i % 2 ? m.motleyA : m.motleyB, [Math.sin(a) * 0.168, -0.17, Math.cos(a) * 0.135], dir, 0.042);
      if (i % 2 === 0) P(new THREE.SphereGeometry(0.013, 8, 6), m.bell, [Math.sin(a) * 0.19, -0.28, Math.cos(a) * 0.155]);
    }
  }

  buildJesterLimbs(side, s, upper, fore, hand, thigh, shin, foot, m) {
    const U = (...a) => upper.add(this.shape(...a));
    const F = (...a) => fore.add(this.shape(...a));
    const H = (...a) => hand.add(this.shape(...a));
    const FT = (...a) => foot.add(this.shape(...a));
    const armMat = side === "L" ? m.motleyA : m.motleyB;
    const otherMat = side === "L" ? m.motleyB : m.motleyA;
    U(new THREE.SphereGeometry(0.088, 12, 8), armMat, [0.012 * s, -0.045, 0], [1, 1.15, 1.05]); // puffärm
    F(new THREE.CylinderGeometry(0.058, 0.046, 0.06, 12, 1, true), otherMat, [0, -0.22, 0]);     // manschett
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      F(new THREE.ConeGeometry(0.018, 0.05, 4), otherMat, [Math.sin(a) * 0.05, -0.265, Math.cos(a) * 0.05], [1, 1, 0.5], [Math.PI, 0, 0]);
      F(new THREE.SphereGeometry(0.008, 6, 4), m.bell, [Math.sin(a) * 0.052, -0.295, Math.cos(a) * 0.052]); // bjällra i varje udd
    }
    // Ruter i den andra färgen längs benen
    const TH = (...a) => thigh.add(this.shape(...a));
    const SH = (...a) => shin.add(this.shape(...a));
    for (let i = 0; i < 3; i++) {
      TH(new THREE.BoxGeometry(0.04, 0.04, 0.008), otherMat, [0, -0.1 - i * 0.1, 0.083 - i * 0.008], [1, 1, 1], [0, 0, Math.PI / 4]);
      SH(new THREE.BoxGeometry(0.034, 0.034, 0.008), otherMat, [0, -0.08 - i * 0.1, 0.063 - i * 0.006], [1, 1, 1], [0, 0, Math.PI / 4]);
    }
    this.addHand(H, m.skin, s, 1);
    // Mjuka skor med lång, uppkrullad tå och en bjällra
    FT(new THREE.CylinderGeometry(0.056, 0.06, 0.08, 12, 1, true), armMat, [0, -0.04, 0]);
    FT(new THREE.SphereGeometry(1, 12, 8), armMat, [0, -0.07, 0.05], [0.06, 0.045, 0.12]);
    FT(new THREE.ConeGeometry(0.035, 0.17, 8), armMat, [0, -0.045, 0.2], [1, 1, 0.8], [Math.PI / 2 - 0.55, 0, 0]);
    FT(new THREE.TorusGeometry(0.035, 0.011, 6, 10, Math.PI * 1.2), armMat, [0, 0.0, 0.27], [1, 1, 1], [0, Math.PI / 2, -0.3]);
    FT(new THREE.SphereGeometry(0.018, 8, 6), m.bell, [0, 0.03, 0.245]);
  }

  // Narrmössa: kalott i två färger och tre slokande flikar med bjällror i spetsarna
  buildJesterHat(helmet, m) {
    const add = (...a) => helmet.add(this.shape(...a));
    add(new THREE.CylinderGeometry(0.104, 0.11, 0.05, 18, 1, true), m.bell, [0, 0.185, 0], [1, 1, 1.08]);
    add(new THREE.SphereGeometry(0.106, 16, 8, Math.PI / 2, Math.PI, 0, Math.PI / 2), m.motleyA, [0, 0.205, 0], [1, 0.9, 1.08]);
    add(new THREE.SphereGeometry(0.106, 16, 8, Math.PI * 1.5, Math.PI, 0, Math.PI / 2), m.motleyB, [0, 0.205, 0], [1, 0.9, 1.08]);
    const prongs = [[1, 0, m.motleyA], [-1, 0, m.motleyB], [0, -1, m.motleyB]];
    for (const [dx, dz, mat] of prongs) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(dx * 0.03, 0.25, dz * 0.03),
        new THREE.Vector3(dx * 0.12, 0.38, dz * 0.12),
        new THREE.Vector3(dx * 0.25, 0.42, dz * 0.25),
        new THREE.Vector3(dx * 0.34, 0.33, dz * 0.34),
      ]);
      const geo = new THREE.TubeGeometry(curve, 14, 0.05, 8, false);
      // Flikarna smalnar av mot spetsen
      const pos = geo.attributes.position;
      const center = new THREE.Vector3();
      const v = new THREE.Vector3();
      for (let i = 0; i <= 14; i++) {
        const u = i / 14;
        curve.getPointAt(u, center);
        for (let j = 0; j <= 8; j++) {
          const idx = i * 9 + j;
          v.fromBufferAttribute(pos, idx).sub(center).multiplyScalar(1 - u * 0.8).add(center);
          pos.setXYZ(idx, v.x, v.y, v.z);
        }
      }
      geo.computeVertexNormals();
      add(geo, mat);
      add(new THREE.SphereGeometry(0.024, 10, 8), m.bell, [dx * 0.35, 0.3, dz * 0.35]);
    }
  }

  addScabbard(pelvis, m, metal) {
    const g = new THREE.Group();
    g.add(this.shape(new THREE.BoxGeometry(0.05, 0.75, 0.025), m.leatherDark, [0, -0.36, 0]));
    g.add(this.shape(new THREE.ConeGeometry(0.027, 0.06, 4), metal, [0, -0.76, 0], [1, 1, 0.5], [Math.PI, 0, 0])); // doppsko
    g.add(this.shape(new THREE.BoxGeometry(0.06, 0.04, 0.03), metal, [0, -0.02, 0]));                              // munbleck
    g.position.set(0.17, -0.02, -0.02);
    g.rotation.set(0.35, 0, 0.12);
    // Lägg in delarna direkt i höfterna (så de slås ihop)
    g.updateMatrix();
    for (const child of [...g.children]) {
      child.applyMatrix4(g.matrix);
      pelvis.add(child);
    }
  }

  // ---------- Huvud och ansikte ----------
  // Ansiktet finns alltid (även under stängda hjälmar, och syns om hjälmen flyger av).
  // Ögon, ögonbryn och mun ligger i en egen grupp så de kan röra sig (blinka, grimasera, skrika).

  buildHead(head, m, f) {
    const H = (...a) => head.add(this.shape(...a));
    const skinCol = new THREE.Color(m.skin.color);
    m.blush = this.mat(skinCol.clone().lerp(new THREE.Color(0xd06a5a), 0.22).getHex(), 0.7, 0);
    m.stubble = this.mat(skinCol.clone().multiplyScalar(0.72).lerp(new THREE.Color(f.hair), 0.25).getHex(), 0.95, 0);
    m.scarMat = this.mat(skinCol.clone().lerp(new THREE.Color(0xf0c0b8), 0.5).getHex(), 0.5, 0);

    H(new THREE.CylinderGeometry(0.046, 0.054, 0.12, 12), m.skin, [0, 0.01, 0]); // hals
    H(new THREE.SphereGeometry(0.03, 8, 6), m.skin, [0, 0.03, 0.03], [1.1, 1, 0.7]); // struphuvud
    // Formgjutet huvud: ett enda mjukt huvud med käke, haka, kindben, pannben och ögonhålor
    const skull = sculptHead(f);
    H(skull, m.skin);
    if (f.stubble && f.beard !== 2) {
      const st = stubbleShell(skull);
      if (st) H(st, m.stubble);
    }
    for (const s of [1, -1]) {
      H(new THREE.SphereGeometry(0.022, 10, 8), m.skin, [0.089 * s, 0.13, -0.004], [0.45, 1, 0.75]); // öron
      H(new THREE.TorusGeometry(0.011, 0.004, 5, 10), m.skin, [0.093 * s, 0.13, -0.002], [0.5, 1.4, 1], [0, Math.PI / 2, 0]); // örats kant
      H(new THREE.SphereGeometry(0.017, 10, 8), m.blush, [0.043 * s, 0.112, 0.074], [1.25, 0.85, 0.45]); // rosiga kinder (nästan inne i huden)
    }
    // Näsa: en riktig näsprofil (rygg, spets och näsvingar). Kan vara stor, liten eller bruten.
    const nose = noseGeometry(f.nose);
    H(nose, m.skin, [f.broken ? 0.003 : 0, 0, 0.083], [1, 1, 1], [0, 0, f.broken ? 0.13 : 0]);
    for (const s of [1, -1]) {
      H(new THREE.SphereGeometry(0.0095, 8, 6), m.skin, [0.011 * s, 0.103, 0.098 + 0.004 * f.nose], [1, 0.8, 0.9]);      // näsvingar
      H(new THREE.SphereGeometry(0.0035, 5, 4), m.mouth, [0.0075 * s, 0.099, 0.103 + 0.004 * f.nose]);                   // näsborrar
    }
    // Läppar: överläppen sitter fast, underläppen följer käken när munnen öppnas
    H(new THREE.CapsuleGeometry(0.0058, 0.026, 3, 8), m.lips, [0, 0.0945, 0.0935], [1, 1, 0.8], [0, 0, Math.PI / 2]);
    if (f.scar) H(new THREE.BoxGeometry(0.0035, 0.055, 0.003), m.scarMat, [0.045, 0.152, 0.093], [1, 1, 1], [-0.25, 0.3, 0.35]); // ärr över vänster öga

    // Hår och skägg i en egen grupp: göms under stängda hjälmar (så inget sticker ut) och syns om hjälmen åker av
    const hairGroup = new THREE.Group();
    head.add(hairGroup);
    this.hairGroup = hairGroup;
    const HR = (...a) => hairGroup.add(this.shape(...a));
    if (f.hairStyle !== 2) HR(new THREE.SphereGeometry(0.094, 16, 8, 0, Math.PI * 2, 0, 1.45), m.hair, [0, 0.142, -0.004], [1.03, 1.12, 1.08]);
    if (f.hairStyle === 1) {
      HR(new THREE.BoxGeometry(0.15, 0.13, 0.05), m.hair, [0, 0.1, -0.072], [1, 1, 1], [0.15, 0, 0]); // långt hår i nacken
      for (const s of [1, -1]) HR(new THREE.BoxGeometry(0.025, 0.1, 0.06), m.hair, [0.088 * s, 0.1, -0.02]);
    } else if (f.hairStyle === 2) {
      HR(new THREE.TorusGeometry(0.084, 0.014, 6, 16, Math.PI * 1.3), m.hair, [0, 0.125, 0.0], [1.05, 1, 1.08], [Math.PI / 2, 0, -Math.PI * 0.15 + Math.PI]); // krans runt flinten
    } else if (f.hairStyle === 3) {
      HR(new THREE.CylinderGeometry(0.098, 0.1, 0.035, 16, 1, true), m.hair, [0, 0.185, 0.002], [1.03, 1, 1.09]); // pottfrisyr
    }
    // Skägg
    if (f.beard === 1) {
      for (const s of [1, -1]) HR(new THREE.CapsuleGeometry(0.0045, 0.022, 3, 6), m.hair, [0.015 * s, 0.1, 0.099], [1, 1, 1], [0, 0, Math.PI / 2 - 0.35 * s]); // mustasch
    } else if (f.beard === 2) {
      HR(new THREE.SphereGeometry(0.06, 14, 10), m.hair, [0, 0.062, 0.045], [1.14, 0.88, 0.88]); // helskägg
      for (const s of [1, -1]) HR(new THREE.CapsuleGeometry(0.0045, 0.022, 3, 6), m.hair, [0.015 * s, 0.1, 0.1], [1, 1, 1], [0, 0, Math.PI / 2 - 0.3 * s]);
    } else if (f.beard === 3) {
      HR(new THREE.ConeGeometry(0.02, 0.05, 8), m.hair, [0, 0.045, 0.078], [1, 1, 1], [Math.PI + 0.3, 0, 0]); // pipskägg
    }
    // Lapp för ögat (sitter i hårgruppen så den följer med hjälmen av/på precis som håret)
    if (f.patch) {
      H(new THREE.SphereGeometry(0.019, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.mouth, [-0.033, 0.146, 0.088], [1, 1, 0.5], [Math.PI / 2, 0, 0]);
      H(new THREE.TorusGeometry(0.094, 0.0028, 4, 24), m.strap ?? m.mouth, [0, 0.15, 0.004], [1, 1.04, 1.06], [0.15, 0, 0.32]);
    }

    // Rörliga delar: ögon, ögonlock, ögonbryn, mun och underläpp
    const face = new THREE.Group();
    face.userData.face = true;
    head.add(face);
    this.eyes = [];
    this.brows = [];
    this.lids = [];
    for (const s of [1, -1]) {
      const eye = new THREE.Group();
      eye.position.set(0.033 * s, 0.146, 0.081);
      eye.add(this.shape(new THREE.SphereGeometry(0.0145, 12, 10), m.eyeWhite, [0, 0, 0], [1, 0.82, 0.7]));
      const iris = new THREE.Group(); // irisen kan titta åt sidan
      iris.add(this.shape(new THREE.SphereGeometry(0.0074, 10, 8), m.iris, [0, 0, 0.0085], [1, 1, 0.45]));
      iris.add(this.shape(new THREE.SphereGeometry(0.0036, 6, 4), m.mouth, [0, 0, 0.0115]));
      eye.add(iris);
      eye.userData.iris = iris;
      if (!(f.patch && s < 0)) face.add(eye);
      this.eyes.push(eye);
      // Övre ögonlock (hud) som sänks när man kisar eller blinkar, och ett fast nedre ögonlock
      const lid = new THREE.Group();
      lid.position.set(0.033 * s, 0.146, 0.081);
      lid.add(this.shape(new THREE.SphereGeometry(0.0162, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.skin, [0, 0, 0], [1, 0.85, 0.75]));
      lid.rotation.x = -0.9;
      face.add(lid);
      this.lids.push(lid);
      face.add(this.shape(new THREE.SphereGeometry(0.0155, 10, 6, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), m.skin, [0.033 * s, 0.1455, 0.081], [1.02, 0.8, 0.78])); // nedre ögonlock
      const bw = 0.03 + f.brow * 0.012;
      const brow = this.shape(new THREE.CapsuleGeometry(0.0042 + f.brow * 0.002, bw, 3, 6), m.hair, [0.034 * s, 0.168, 0.09], [1, 1, 0.8], [0, 0, Math.PI / 2 + 0.15 * s]);
      brow.userData.side = s;
      brow.userData.base = Math.PI / 2;
      face.add(brow);
      this.brows.push(brow);
    }
    // Munnen: mörk öppning med övre tänder (kanske med en lucka) och tunga
    const mouth = new THREE.Group();
    mouth.position.set(0, 0.088, 0.09);
    mouth.add(this.shape(new THREE.SphereGeometry(0.019, 10, 8), m.mouth, [0, 0, 0], [1.25, 1, 0.5]));
    if (f.gap) {
      mouth.add(this.shape(new THREE.BoxGeometry(0.009, 0.006, 0.006), m.teeth, [-0.008, 0.009, 0.004]));
      mouth.add(this.shape(new THREE.BoxGeometry(0.008, 0.006, 0.006), m.teeth, [0.009, 0.009, 0.004]));
    } else {
      mouth.add(this.shape(new THREE.BoxGeometry(0.024, 0.006, 0.006), m.teeth, [0, 0.009, 0.004]));
    }
    mouth.add(this.shape(new THREE.SphereGeometry(0.01, 8, 6), this.mat(0xa04048, 0.5, 0), [0, -0.007, 0.0], [1.3, 0.5, 1])); // tunga
    face.add(mouth);
    this.mouthMesh = mouth;
    // Underläpp och nedre tänder följer käken
    const lower = new THREE.Group();
    lower.position.set(0, 0.0815, 0.092);
    lower.add(this.shape(new THREE.CapsuleGeometry(0.0062, 0.022, 3, 8), m.lips, [0, 0, 0], [1, 1, 0.8], [0, 0, Math.PI / 2]));
    lower.add(this.shape(new THREE.BoxGeometry(0.02, 0.005, 0.005), m.teeth, [0, 0.005, -0.004]));
    face.add(lower);
    this.lowerLip = lower;
    this.lips = lower; // gammalt namn
    // Blod från näsan (syns efter en träff i huvudet)
    const nb = new THREE.Group();
    nb.add(this.shape(new THREE.BoxGeometry(0.004, 0.012, 0.002), m.blood, [0.008, 0.094, 0.1]));
    nb.add(this.shape(new THREE.BoxGeometry(0.003, 0.012, 0.002), m.blood, [0.006, 0.086, 0.099], [1, 1, 1], [0.3, 0, 0.1]));
    nb.add(this.shape(new THREE.SphereGeometry(0.003, 5, 4), m.blood, [0.005, 0.078, 0.1]));
    nb.visible = false;
    face.add(nb);
    this.noseBlood = nb;
    this.face = face;
    for (const eye of this.eyes) {
      this.mergeChildren(eye.userData.iris);
      this.mergeChildren(eye);
    }
    for (const l of this.lids) this.mergeChildren(l);
    this.mergeChildren(mouth);
    this.mergeChildren(lower);
    this.mergeChildren(nb);
  }

  // ---------- Lemmar per rustning ----------

  buildPlateLimbs(side, s, upper, fore, hand, thigh, shin, foot, m, gilded) {
    const U = (...a) => upper.add(this.shape(...a));
    const F = (...a) => fore.add(this.shape(...a));
    const H = (...a) => hand.add(this.shape(...a));
    const TH = (...a) => thigh.add(this.shape(...a));
    const SH = (...a) => shin.add(this.shape(...a));
    const FT = (...a) => foot.add(this.shape(...a));
    const edge = gilded ? m.gold : m.steelDark;

    // Axelskydd: en välvd plåt överst och tre lameller som överlappar nedåt
    U(new THREE.SphereGeometry(0.097, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.steel, [0.018 * s, -0.005, 0], [1.1, 0.6, 1.15]);
    U(new THREE.TorusGeometry(0.097, 0.007, 5, 22), edge, [0.018 * s, -0.005, 0], [1.1, 1.15, 1], [Math.PI / 2, 0, 0]);
    // Lamellerna sitter tätt mot varandra, och kanterna följer exakt samma lutning som plåten (inga lösa ringar)
    const lames = new THREE.Group();
    lames.position.set(0.018 * s, 0, 0);
    lames.rotation.z = 0.12 * s;
    for (let i = 0; i < 3; i++) {
      const r = 0.095 - i * 0.008;
      const y = -0.03 - i * 0.03;
      lames.add(this.shape(new THREE.CylinderGeometry(r, r + 0.01, 0.04, 18, 1, false), m.steel, [0, y, 0], [1.08, 1, 1.12]));
      lames.add(this.shape(new THREE.TorusGeometry(r + 0.01, 0.0035, 4, 18), edge, [0, y - 0.02, 0], [1.08, 1.12, 1], [Math.PI / 2, 0, 0]));
    }
    upper.add(lames);
    lames.updateMatrix();
    for (const child of [...lames.children]) {
      child.applyMatrix4(lames.matrix);
      upper.add(child);
    }
    lames.removeFromParent();
    for (const z of [0.07, -0.07]) U(new THREE.SphereGeometry(0.009, 5, 4), m.trim, [0.06 * s, 0.035, z]);
    // Läderrem med spänne som håller överarmsskenan
    U(new THREE.TorusGeometry(0.06, 0.006, 4, 14), m.strap, [0, -0.16, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    U(new THREE.BoxGeometry(0.016, 0.016, 0.008), m.brass, [0, -0.16, 0.062]);
    // Överarmsskena
    U(latheAlong(PROFILE.upperArm, 0.29, 0.38, 0.88, 0.012, false, 0.004), m.steel);
    // Armbågskopp med solfjäderformad vinge
    F(new THREE.SphereGeometry(0.066, 12, 8), m.steel, [0, 0, -0.008]);
    F(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 10), m.steel, [0.055 * s, 0, -0.01], [1, 1, 1.25], [0, 0, Math.PI / 2]);
    F(new THREE.SphereGeometry(0.009, 5, 4), m.trim, [0.062 * s, 0, -0.01]);
    // Underarmsskena och handskens utvikta krage
    F(latheAlong(PROFILE.forearm, 0.26, 0.12, 0.72, 0.01, false, 0.003), m.steel);
    F(new THREE.CylinderGeometry(0.06, 0.046, 0.08, 14, 1, true), m.steel, [0, -0.22, 0]);
    // Handske med fingrar
    this.addGauntlet(H, m.steel, m.steelDark, s);

    // Lårskena med kant, knäkopp med vinge, benskena ända ner till foten
    TH(latheAlong(PROFILE.thigh, 0.42, 0.06, 0.82, 0.012, false, 0.004), m.steel);
    for (const y of [-0.12, -0.3]) {
      TH(new THREE.TorusGeometry(0.084, 0.006, 4, 16), m.strap, [0, y, -0.005], [1, 1.05, 1], [Math.PI / 2, 0, 0]); // remmar bak
      TH(new THREE.BoxGeometry(0.016, 0.016, 0.008), m.brass, [0.082 * s, y, -0.01]);
    }
    SH(new THREE.SphereGeometry(0.077, 12, 8), m.steel, [0, 0, 0.022], [1, 1, 1.12]);
    SH(new THREE.CylinderGeometry(0.064, 0.064, 0.01, 10), m.steel, [0.064 * s, 0.0, 0.0], [1, 1, 1.2], [0, 0, Math.PI / 2]);
    SH(new THREE.SphereGeometry(0.01, 5, 4), m.trim, [0.072 * s, 0, 0]);
    SH(latheAlong(PROFILE.shin, 0.4, 0.14, 1, 0.011, false, 0.003), m.steel);
    SH(new THREE.CylinderGeometry(0.066, 0.06, 0.03, 14, 1, true), m.steel, [0, -0.39, 0]); // utvikt nederkant över fotleden
    // Spetsiga sabatoner i lameller
    this.addPointedShoe(FT, m.steel, edge, 0.27, true);
  }

  buildChainLimbs(side, s, upper, fore, hand, thigh, shin, foot, m) {
    const F = (...a) => fore.add(this.shape(...a));
    const H = (...a) => hand.add(this.shape(...a));
    const SH = (...a) => shin.add(this.shape(...a));
    const FT = (...a) => foot.add(this.shape(...a));
    // Tandad kant på ärmen
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      F(new THREE.SphereGeometry(0.011, 4, 3), m.chain, [Math.sin(a) * 0.04, -0.235, Math.cos(a) * 0.04]);
    }
    // Vadderad manschett under brynjans ärm
    F(new THREE.CylinderGeometry(0.05, 0.047, 0.035, 12, 1, true), m.quilt, [0, -0.205, 0]);
    // Läderhandskar och läderskor med spets (poulainer), med skaft upp över fotleden
    this.addHand(H, m.leatherDark, s, 1.06);
    F(new THREE.CylinderGeometry(0.048, 0.04, 0.07, 12, 1, true), m.leatherDark, [0, -0.225, 0]);
    SH(new THREE.CylinderGeometry(0.056, 0.052, 0.12, 12, 1, true), m.leatherDark, [0, -0.35, 0]);
    SH(new THREE.TorusGeometry(0.056, 0.006, 4, 14), m.strap, [0, -0.29, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    this.addPointedShoe(FT, m.leatherDark, m.strap, 0.2, false);
  }

  buildLeatherLimbs(side, s, upper, fore, hand, thigh, shin, foot, m) {
    const U = (...a) => upper.add(this.shape(...a));
    const F = (...a) => fore.add(this.shape(...a));
    const H = (...a) => hand.add(this.shape(...a));
    const SH = (...a) => shin.add(this.shape(...a));
    const FT = (...a) => foot.add(this.shape(...a));
    // Axelskydd i läder i två lager, med nit
    U(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.leatherDark, [0.012 * s, -0.008, 0], [1.08, 0.7, 1.18]);
    U(new THREE.CylinderGeometry(0.088, 0.096, 0.04, 14, 1, true), m.leather, [0.015 * s, -0.04, 0], [1.06, 1, 1.15]);
    U(new THREE.SphereGeometry(0.009, 5, 4), m.brass, [0.07 * s, 0.03, 0.05]);
    for (const z of [0.05, -0.05]) U(new THREE.SphereGeometry(0.007, 5, 4), m.brass, [0.08 * s, -0.035, z]);
    // Armskydd med två remmar och spänne
    F(latheAlong(PROFILE.forearm, 0.26, 0.2, 0.85, 0.009, false), m.leatherDark);
    for (const y of [-0.1, -0.18]) {
      F(new THREE.TorusGeometry(0.053, 0.006, 4, 14), m.strap, [0, y, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
      F(new THREE.BoxGeometry(0.016, 0.016, 0.008), m.brass, [0, y, 0.056]);
    }
    this.addHand(H, m.leatherDark, s, 1.06);
    // Höga stövlar med nedvikt kant, spänne och spetsig tå
    SH(new THREE.CylinderGeometry(0.074, 0.06, 0.29, 12, 1, true), m.leatherDark, [0, -0.26, 0]);
    SH(new THREE.CylinderGeometry(0.082, 0.076, 0.045, 12, 1, true), m.leather, [0, -0.115, 0]);
    SH(new THREE.TorusGeometry(0.066, 0.006, 4, 14), m.strap, [0, -0.3, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    SH(new THREE.BoxGeometry(0.018, 0.018, 0.008), m.brass, [0.066 * s, -0.3, 0]);
    for (let i = 0; i < 3; i++) SH(new THREE.SphereGeometry(0.006, 4, 3), m.brass, [0, -0.17 - i * 0.05, 0.071]); // nitar på stövelskaftet
    SH(new THREE.SphereGeometry(1, 8, 6), m.leather, [0, -0.02, 0.06], [0.045, 0.04, 0.015]);                  // nött knä
    this.addPointedShoe(FT, m.leatherDark, m.strap, 0.17, false);
  }

  buildPeasantLimbs(side, s, upper, fore, hand, thigh, shin, foot, m) {
    const F = (...a) => fore.add(this.shape(...a));
    const H = (...a) => hand.add(this.shape(...a));
    const SH = (...a) => shin.add(this.shape(...a));
    const FT = (...a) => foot.add(this.shape(...a));
    // Lappad armbåge, bara händer, benlindor och klumpiga rundade skor
    F(new THREE.SphereGeometry(0.04, 8, 6), m.leather, [0, -0.01, -0.035], [1, 1, 0.5]);
    SH(new THREE.SphereGeometry(0.045, 8, 6), m.leather, [0, -0.01, 0.045], [1, 1, 0.45]); // lappat knä
    this.addHand(H, m.skin, s, 1);
    SH(latheAlong(PROFILE.shin, 0.4, 0.35, 1, 0.006, false), m.wool);
    FT(new THREE.CylinderGeometry(0.056, 0.06, 0.08, 12, 1, true), m.leatherDark, [0, -0.04, 0]); // skoskaft över fotleden
    FT(new THREE.SphereGeometry(1, 12, 8), m.leatherDark, [0, -0.065, 0.055], [0.068, 0.055, 0.135]);
    FT(new THREE.TorusGeometry(0.058, 0.007, 4, 12), m.rope, [0, -0.02, 0], [1, 1, 1], [Math.PI / 2, 0, 0]); // snöre
  }

  // Hand (bar eller i läderhandske): handflata, böjda fingrar, knogar och en tumme – inte en kula
  addHand(H, mat, s, size = 1) {
    const k = size;
    H(new THREE.SphereGeometry(1, 12, 8), mat, [0, -0.042, -0.004], [0.04 * k, 0.046 * k, 0.026 * k]);           // handflata och handrygg
    H(new THREE.SphereGeometry(1, 12, 8), mat, [0, -0.079 * k, 0.012], [0.039 * k, 0.026 * k, 0.034 * k]);        // böjda fingrar
    H(new THREE.CylinderGeometry(0.009 * k, 0.009 * k, 0.07 * k, 8), mat, [0, -0.066 * k, -0.018 * k], [1, 1, 1], [0, 0, Math.PI / 2]); // knogar
    H(new THREE.CapsuleGeometry(0.012 * k, 0.026 * k, 3, 8), mat, [0.032 * s * k, -0.048 * k, 0.02 * k], [1, 1, 1], [0.55, 0, -0.45 * s]); // tumme
    H(new THREE.CylinderGeometry(0.034 * k, 0.038 * k, 0.03 * k, 12, 1, true), mat, [0, -0.005, 0], [1.05, 1, 0.8]); // handled
  }

  // Handske i plåt: handrygg, fyra fingrar runt greppet och en tumme
  addGauntlet(H, metal, dark, s) {
    H(new THREE.BoxGeometry(0.07, 0.06, 0.03), metal, [0, -0.04, -0.012]);
    for (let i = 0; i < 4; i++) {
      const x = -0.026 + i * 0.0175;
      H(new THREE.BoxGeometry(0.015, 0.03, 0.016), metal, [x, -0.078, 0.008], [1, 1, 1], [0.6, 0, 0]);
      H(new THREE.BoxGeometry(0.014, 0.026, 0.015), dark, [x, -0.092, 0.03], [1, 1, 1], [1.5, 0, 0]);
    }
    H(new THREE.BoxGeometry(0.016, 0.04, 0.016), metal, [0.035 * s, -0.05, 0.022], [1, 1, 1], [0.5, 0, -0.4 * s]);
  }

  // Spetsig sko eller sabaton: skaft över fotleden, häl, lameller över foten och en lång, lite uppåtböjd spets
  addPointedShoe(FT, mat, edge, pointLength, lames) {
    FT(new THREE.CylinderGeometry(0.056, 0.062, 0.1, 14, 1, true), mat, [0, -0.04, -0.003]);                     // skaft (täcker fotleden)
    FT(new THREE.TorusGeometry(0.057, 0.005, 4, 14), edge, [0, 0.01, -0.003], [1, 1, 1], [Math.PI / 2, 0, 0]);
    FT(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat, [0, -0.1, -0.008], [0.066, 0.08, 0.08]); // häl
    if (lames) {
      for (let i = 0; i < 4; i++) {
        FT(new THREE.CylinderGeometry(0.06 - i * 0.0045, 0.06 - i * 0.0045, 0.055, 12, 1, true, Math.PI / 2, Math.PI), mat,
          [0, -0.09, 0.02 + i * 0.045], [1.05, 1, 0.75], [Math.PI / 2, 0, 0]);
        FT(new THREE.TorusGeometry(0.058 - i * 0.0045, 0.0035, 3, 10, Math.PI), edge, [0, -0.09, 0.047 + i * 0.045], [1.05, 0.75, 1], [0, 0, 0]);
      }
      FT(new THREE.BoxGeometry(0.1, 0.012, 0.25), mat, [0, -0.1, 0.08]); // sula
    } else {
      FT(new THREE.CapsuleGeometry(0.052, 0.14, 4, 10), mat, [0, -0.06, 0.07], [1.05, 0.9, 1], [Math.PI / 2, 0, 0]);
      // Sula och klack, och en smalare vrist upptill (så foten inte ser ut som en korv)
      FT(new THREE.BoxGeometry(0.098, 0.014, 0.22), edge, [0, -0.108, 0.075]);
      FT(new THREE.BoxGeometry(0.085, 0.03, 0.06), edge, [0, -0.1, -0.03]);
      FT(new THREE.SphereGeometry(0.03, 8, 6), mat, [0, -0.07, 0.11], [1.4, 0.9, 1.2]); // fotens ovansida (vristen)
    }
    // Spetsen (cirka 1400-tal)
    FT(new THREE.ConeGeometry(0.042, pointLength, 10), mat, [0, -0.085, 0.19 + pointLength / 2], [1, 1, 0.75], [Math.PI / 2 - 0.12, 0, 0]);
  }

  // ---------- Hjälmar ----------
  // Stängda hjälmar byggs av band med riktiga öppningar för ögonen, så man ser ansiktet innanför.

  buildHelmet(helmet, kind, m, gilded) {
    const add = (...args) => helmet.add(this.shape(...args));
    // Plåt med mörk insida (syns genom ögonspringan)
    const shell = (geometry, pos, scale, rot) => {
      add(geometry, m.steel, pos, scale, rot);
      add(geometry.clone(), m.helmInner, pos, scale, rot);
    };
    const trim = gilded ? m.gold : m.brass;
    const rivetRing = (radius, y, count, scaleZ = 1, skipFront = 0) => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        if (skipFront && Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < skipFront) continue;
        add(new THREE.SphereGeometry(0.0075, 5, 4), trim, [Math.sin(a) * radius, y, Math.cos(a) * radius * scaleZ]);
      }
    };
    const cyl = (r1, r2, h, y, start = 0, length = Math.PI * 2, segs = 22) =>
      shell(new THREE.CylinderGeometry(r1, r2, h, segs, 1, true, start, length), [0, y, 0]);
    this.visor = null;

    if (kind === 1) {
      // Visirhjälm (bascinet med "hundsnos"): öppen framtill, visiret sitter på gångjärn och kan fällas upp
      const R = 0.122;
      cyl(R, R + 0.002, 0.15, 0.13, 1.0, Math.PI * 2 - 2.0);           // sidor och bak (öppet framtill)
      shell(new THREE.ConeGeometry(R, 0.17, 22, 1, true), [0, 0.29, -0.012]); // spetsig topp
      for (const s of [1, -1]) add(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 8), trim, [0.124 * s, 0.15, 0.02], [1, 1, 1], [0, 0, Math.PI / 2]); // gångjärn
      rivetRing(R + 0.002, 0.06, 14, 1, 1.0);
      add(new THREE.CylinderGeometry(0.13, 0.17, 0.09, 16, 1, true), m.chain, [0, 0.025, 0]); // ringbrynja över halsen
      // Visiret: pannplåt ovanför ögonen, nosplåt under, och en snos med andningshål
      const visor = new THREE.Group();
      visor.position.set(0, 0.15, 0.02);
      const V = (...a) => visor.add(this.shape(...a));
      const VS = (geometry, pos, scale, rot) => {
        V(geometry, m.steel, pos, scale, rot);
        V(geometry.clone(), m.helmInner, pos, scale, rot);
      };
      const front = 1.08;
      VS(new THREE.CylinderGeometry(R + 0.006, R + 0.006, 0.04, 16, 1, true, -front, front * 2), [0, 0.032, -0.02]);  // panna
      VS(new THREE.CylinderGeometry(R + 0.006, R + 0.006, 0.085, 16, 1, true, -front, front * 2), [0, -0.0525, -0.02]);  // under ögonen
      VS(new THREE.ConeGeometry(0.07, 0.13, 16, 1, true), [0, -0.05, 0.135], [1, 1, 0.9], [Math.PI / 2, 0, 0]);   // snos
      V(new THREE.SphereGeometry(0.008, 6, 4), m.steel, [0, -0.05, 0.2]);
      // Andningshål på snosens ovansida (snosen är en kon: radien minskar mot spetsen)
      for (const z of [0.11, 0.135]) {
        const r = 0.07 * 0.9 * (0.2 - z) / 0.13;
        for (let c = -2; c <= 2; c++) {
          const a = c * 0.38;
          V(new THREE.SphereGeometry(0.0048, 4, 3), m.hole, [Math.sin(a) * r, -0.05 + Math.cos(a) * r, z]);
        }
      }
      V(new THREE.TorusGeometry(0.07, 0.005, 4, 18), trim, [0, -0.05, 0.072], [1, 0.9, 1]); // mässingskant
      helmet.add(visor);
      this.visor = visor;
      this.mergeChildren(visor);
    } else if (kind === 2) {
      // Järnhatt med brätte och nitar (öppen: ansiktet syns)
      add(new THREE.SphereGeometry(0.118, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.steel, [0, 0.16, 0], [1, 0.95, 1]);
      add(new THREE.CylinderGeometry(0.215, 0.215, 0.014, 22), m.steel, [0, 0.163, 0], [1, 1, 1], [0.05, 0, 0]);
      add(new THREE.TorusGeometry(0.215, 0.007, 4, 24), trim, [0, 0.165, 0.01], [1, 1, 1], [Math.PI / 2 + 0.05, 0, 0]);
      // Kam längs hjälmen (som en morion): en välvd plåt med vulst
      const comb = new THREE.Shape();
      comb.moveTo(-0.11, 0);
      comb.absellipse(0, 0, 0.11, 0.1, Math.PI, 0, true);
      comb.lineTo(-0.11, 0);
      const combGeo = new THREE.ExtrudeGeometry(comb, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 16 });
      combGeo.translate(0, 0, -0.004);
      add(combGeo, m.steel, [0, 0.2, 0], [1, 1, 1], [0, Math.PI / 2, 0]);
      add(new THREE.TorusGeometry(0.105, 0.005, 4, 20, Math.PI), trim, [0, 0.2, 0], [1, 0.97, 1], [0, Math.PI / 2, 0]);
      rivetRing(0.118, 0.175, 12);
      add(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 16, 1, true), m.strap, [0, 0.16, 0]); // läderfoder
    } else if (kind === 3) {
      // Hornhjälm med nässkydd och kindskydd (öppen framtill)
      const R = 0.115;
      cyl(R, R, 0.06, 0.2);                                      // pannband runt hela huvudet
      shell(new THREE.SphereGeometry(R, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.23, 0]);
      cyl(R, R + 0.006, 0.12, 0.11, 0.95, Math.PI * 2 - 1.9);   // kindskydd och nacke
      add(new THREE.BoxGeometry(0.024, 0.1, 0.012), m.steel, [0, 0.135, 0.118]); // nässkydd
      add(new THREE.TorusGeometry(0.116, 0.01, 5, 20), trim, [0, 0.21, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
      rivetRing(0.117, 0.185, 12);
      const bone = this.mat(0xe8dcc0, 0.55, 0);
      for (const s of [1, -1]) {
        add(new THREE.ConeGeometry(0.035, 0.16, 10), bone, [0.13 * s, 0.25, 0], [1, 1, 1], [0, 0, -1.1 * s]);
        add(new THREE.ConeGeometry(0.023, 0.13, 10), bone, [0.2 * s, 0.33, 0], [1, 1, 1], [0, 0, -0.3 * s]);
        add(new THREE.TorusGeometry(0.036, 0.007, 4, 10), trim, [0.115 * s, 0.24, 0], [1, 1, 1], [0, Math.PI / 2, -1.1 * s]);
      }
    } else if (kind === 4) {
      // Plymhjälm (armet): rundad, med en smal springa för ögonen, nackskydd och fjäderplym
      const R = 0.126;
      const sphere = (t0, t1, p0 = 0, p1 = Math.PI * 2) =>
        shell(new THREE.SphereGeometry(R, 20, 6, p0, p1, t0, t1 - t0), [0, 0.15, 0], [1, 0.95, 1.12]);
      const gap = 0.62;
      sphere(0, 1.47);                                           // kupan
      sphere(1.47, 1.69, Math.PI / 2 + gap, Math.PI * 2 - gap * 2); // ögonspringan (öppen framtill)
      sphere(1.69, 2.45);                                        // hakan och kinderna
      add(new THREE.ConeGeometry(0.1, 0.18, 14), m.steel, [0, 0.08, -0.12], [1.2, 1, 0.5], [-Math.PI / 2 - 0.5, 0, 0]);
      for (const y of [0.205, 0.235]) add(new THREE.TorusGeometry(0.115, 0.004, 4, 20), trim, [0, y, 0.005], [1, 1.12, 1], [Math.PI / 2 - 0.15, 0, 0]);
      add(new THREE.BoxGeometry(0.006, 0.07, 0.01), m.steel, [0, 0.105, 0.14]); // ås nertill
      for (let c = 0; c < 4; c++) add(new THREE.SphereGeometry(0.005, 4, 3), m.hole, [0.04 + c * 0.012, 0.1 - c * 0.006, 0.128 - c * 0.008]);
      add(new THREE.CylinderGeometry(0.015, 0.02, 0.06, 8), trim, [0, 0.28, -0.02]); // plymhållare
      // Plym av långa fjädrar som böjer sig bakåt (vajar när man rör sig)
      const plume = new THREE.Group();
      plume.position.set(0, 0.305, -0.02);
      for (let i = 0; i < 9; i++) {
        const f = i / 8;
        const geo = new THREE.SphereGeometry(1, 10, 6);
        geo.translate(0, 1, 0);
        const feather = this.shape(geo, i % 2 ? m.white : m.cloth, [(i % 3 - 1) * 0.012, 0, 0], [0.034 - f * 0.008, 0.15 + Math.sin(f * Math.PI) * 0.04, 0.012]);
        feather.rotation.set(-0.15 - f * 1.75, 0, (i % 3 - 1) * 0.12);
        plume.add(feather);
      }
      helmet.add(plume);
      this.plume = plume;
      if (gilded) add(new THREE.TorusGeometry(0.12, 0.012, 5, 20), m.gold, [0, 0.12, 0], [1, 1, 1.1], [Math.PI / 2, 0, 0]);
    } else if (kind === 5) {
      // Kastrull, med skaftet ut åt sidan
      const pot = this.mat(0x4a4d52, 0.4, 0.7);
      add(new THREE.CylinderGeometry(0.13, 0.125, 0.13, 18), pot, [0, 0.23, 0]);
      add(new THREE.TorusGeometry(0.128, 0.01, 6, 20), pot, [0, 0.165, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
      add(new THREE.BoxGeometry(0.26, 0.025, 0.035), m.wood, [0.25, 0.2, 0], [1, 1, 1], [0, 0, 0.15]);
      add(new THREE.SphereGeometry(0.03, 8, 6), pot, [-0.07, 0.29, 0.03], [1, 0.4, 1]); // en buckla
    } else if (kind === 6) {
      // Halmhatt med band i spelarens färg
      add(new THREE.CylinderGeometry(0.26, 0.26, 0.018, 22), m.straw, [0, 0.17, 0]);
      add(new THREE.CylinderGeometry(0.1, 0.12, 0.12, 16), m.straw, [0, 0.235, 0]);
      add(new THREE.CylinderGeometry(0.121, 0.121, 0.03, 16, 1, true), m.cloth, [0, 0.195, 0]);
    } else {
      // Tunnhjälm: riktiga ögonspringor på var sin sida om ett kors i mässing, andningshål och hjälmkam
      const R = 0.122;
      cyl(R, R - 0.004, 0.112, 0.076);                        // nedre delen
      cyl(R, R, 0.03, 0.147, 0.6, Math.PI * 2 - 1.2);         // ögonspringorna i ögonhöjd (öppet framtill)
      cyl(R, R, 0.068, 0.196);                                // övre delen
      shell(new THREE.SphereGeometry(R, 22, 8, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.23, 0], [1, 0.75, 1]); // topp
      add(new THREE.BoxGeometry(0.024, 0.19, 0.012), trim, [0, 0.125, R + 0.004]);  // korsets lodräta del (delar springorna)
      add(new THREE.BoxGeometry(0.22, 0.016, 0.012), trim, [0, 0.172, R - 0.002], [1, 1, 1], [0, 0, 0]);
      add(new THREE.TorusGeometry(R, 0.006, 4, 24), trim, [0, 0.022, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        add(new THREE.SphereGeometry(0.0055, 4, 3), m.hole, [-0.03 - c * 0.016, 0.1 - r * 0.018, R - 0.004 - c * 0.0035]); // andningshål
      }
      rivetRing(R + 0.001, 0.04, 16);
      rivetRing(R + 0.001, 0.215, 16, 1, 0.3);
      // Hjälmprydnad: tvinnad krans i två färger, ett par vingar och tyg (mantling) som hänger ner bakåt
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        add(new THREE.SphereGeometry(0.028, 8, 6), i % 2 ? m.white : m.cloth, [Math.sin(a) * 0.088, 0.302, Math.cos(a) * 0.088], [1.4, 0.75, 0.9], [0, a + 0.6, 0.5]);
      }
      for (const s of [1, -1]) {
        const wing = new THREE.Shape();
        const pts = [[0, 0], [0.03, 0.1], [0.025, 0.24], [0.06, 0.19], [0.075, 0.22], [0.095, 0.16], [0.115, 0.18], [0.125, 0.11], [0.15, 0.12], [0.14, 0.05]];
        wing.moveTo(0, 0);
        for (const [x, y] of pts.slice(1)) wing.lineTo(x * s, y);
        wing.quadraticCurveTo(0.08 * s, 0.0, 0, 0);
        const wg = new THREE.ExtrudeGeometry(wing, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
        wg.translate(0, 0, -0.006);
        add(wg, gilded ? m.gold : m.cloth, [0.035 * s, 0.31, -0.02], [1, 1, 1], [0, -0.35 * s, 0]);
      }
      add(new THREE.PlaneGeometry(0.24, 0.3), m.tabardCloth, [0, 0.18, -0.14], [1, 1, 1], [0.22, 0, 0]);
      if (gilded) add(new THREE.TorusGeometry(0.1, 0.014, 5, 18), m.gold, [0, 0.33, 0], [1, 1, 1], [Math.PI / 2, 0, 0]); // guldkrans
    }
  }

  // ---------- Vapen ----------
  // Alla vapen hålls i handen med greppet i origo och pekar längs +Y. Eggen (yxans blad) vänds mot +Z,
  // som är hållet vapnet rör sig åt i ett nedåtgående hugg.

  buildWeapon(kind, m, gilded) {
    const g = new THREE.Group();
    const add = (...a) => g.add(this.shape(...a));
    const fit = gilded ? m.gold : m.steelDark;
    // Järnband med nitar runt ett skaft
    const band = (y, r) => {
      add(new THREE.CylinderGeometry(r, r, 0.022, 10), m.iron, [0, y, 0]);
      for (const a of [0, Math.PI]) add(new THREE.SphereGeometry(0.005, 5, 4), fit, [Math.sin(a) * r, y, Math.cos(a) * r]);
    };
    if (kind === FISTS) {
      // Inget vapen: knytnäven
      g.userData.trail = { tip: [0, 0.02, 0.06], base: [0, -0.02, 0] };
      g.userData.kind = kind;
      return g;
    }
    if (kind === 7) {
      // Spjut: långt askskaft, lövformat blad med mittås, holk, tvärstång och en doppsko nertill
      add(new THREE.CylinderGeometry(0.017, 0.02, 2.0, 8), m.wood, [0, 0.45, 0]);
      for (let i = 0; i < 7; i++) add(new THREE.TorusGeometry(0.021, 0.003, 3, 8), m.leatherDark, [0, -0.08 + i * 0.024, 0], [1, 1, 1], [Math.PI / 2, 0, 0.4]);
      add(new THREE.CylinderGeometry(0.021, 0.018, 0.13, 10), m.iron, [0, 1.49, 0]); // holk
      band(1.43, 0.021);
      band(0.9, 0.02);
      add(new THREE.BoxGeometry(0.13, 0.018, 0.018), m.iron, [0, 1.46, 0]); // tvärstång
      for (const sx of [1, -1]) add(new THREE.SphereGeometry(0.012, 6, 5), m.iron, [0.065 * sx, 1.46, 0]);
      const leaf = new THREE.Shape();
      leaf.moveTo(0, 0);
      leaf.quadraticCurveTo(0.06, 0.1, 0.034, 0.22);
      leaf.lineTo(0, 0.36);
      leaf.lineTo(-0.034, 0.22);
      leaf.quadraticCurveTo(-0.06, 0.1, 0, 0);
      const blade = new THREE.ExtrudeGeometry(leaf, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.005, bevelSegments: 1, curveSegments: 8 });
      blade.translate(0, 0, -0.003);
      add(blade, m.blade, [0, 1.54, 0]);
      add(new THREE.BoxGeometry(0.012, 0.3, 0.016), m.steelDark, [0, 1.69, 0]); // mittås
      this.weaponBloodGeo = blade.clone();
      this.weaponBloodPos = [0, 1.54, 0];
      add(new THREE.SphereGeometry(0.032, 8, 6), m.cloth, [0, 1.37, 0], [1, 1.4, 1]); // tofs i spelarens färg
      add(new THREE.ConeGeometry(0.02, 0.09, 6), m.iron, [0, -0.6, 0], [1, 1, 1], [Math.PI, 0, 0]); // doppsko
      g.userData.trail = { tip: [0, 1.9, 0], base: [0, 1.3, 0] };
      g.userData.edge = [[0.04, 1.62, 0], [0.012, 1.84, 0]];
      g.userData.grip2 = [0, -0.38, 0]; // tvåhandat: vänster hand längre bak på skaftet
    } else if (kind === 8) {
      // Stridshammare: grovt smitt järnhuvud på ett slitet skaft lindat med trasor och läderremmar
      add(new THREE.CylinderGeometry(0.016, 0.019, 0.72, 8), m.wood, [0, 0.21, 0]);
      for (let i = 0; i < 6; i++) add(new THREE.TorusGeometry(0.021, 0.0045, 4, 8), m.rag, [0, -0.08 + i * 0.026, 0], [1, 1, 1], [Math.PI / 2 + (i % 2 ? 0.25 : -0.2), 0, 0.3]);
      add(new THREE.TorusGeometry(0.016, 0.003, 3, 8), m.strap, [0, -0.17, 0.02], [1, 1.6, 1], [0.3, 0, 0]); // rem för handleden
      add(new THREE.SphereGeometry(0.026, 7, 5), m.forged, [0, -0.16, 0], [1, 0.8, 1]);
      for (const sx of [1, -1]) add(new THREE.BoxGeometry(0.007, 0.26, 0.024), m.forged, [0.018 * sx, 0.44, 0]); // järnskenor
      for (const y of [0.34, 0.42, 0.5]) for (const sx of [1, -1]) add(new THREE.SphereGeometry(0.006, 5, 4), m.forged, [0.023 * sx, y, 0]);
      add(new THREE.BoxGeometry(0.056, 0.075, 0.08), m.forged, [0.002, 0.59, 0], [1, 1, 1], [0.04, 0, 0.05]);   // huvudet (lite snett smitt)
      add(new THREE.CylinderGeometry(0.038, 0.031, 0.07, 7), m.forged, [0, 0.59, 0.07], [1, 0.95, 1], [Math.PI / 2, 0.1, 0]);
      add(new THREE.CylinderGeometry(0.036, 0.036, 0.012, 7), m.forgedFace, [0, 0.59, 0.108], [1, 1, 1], [Math.PI / 2, 0.1, 0]); // sliten slagyta
      for (const [x, y] of [[-0.011, -0.011], [0.011, -0.011], [-0.011, 0.011], [0.011, 0.011]]) {
        add(new THREE.ConeGeometry(0.008, 0.012, 4), m.forged, [x, 0.59 + y, 0.118], [1, 1, 1], [Math.PI / 2, 0, 0]); // trubbiga piggar
      }
      add(new THREE.ConeGeometry(0.023, 0.17, 5), m.forged, [0, 0.565, -0.11], [1, 1, 0.7], [-Math.PI / 2 - 0.35, 0, 0]); // näbb
      add(new THREE.ConeGeometry(0.014, 0.1, 5), m.forged, [0, 0.67, 0]);
      add(new THREE.BoxGeometry(0.012, 0.012, 0.03), m.forgedFace, [0.026, 0.62, 0.02], [1, 1, 1], [0.4, 0.3, 0]); // nick i järnet
      g.userData.trail = { tip: [0, 0.59, 0.11], base: [0, 0.4, 0.06] };
      g.userData.blood = { w: 0.07, len: 0.09, y: 0.59 };
    } else if (kind === 9) {
      // Slägga: tungt, grovt smitt järnhuvud med kilar och band, på ett slitet skaft med trasor
      add(new THREE.CylinderGeometry(0.022, 0.028, 1.4, 8), m.wood, [0, 0.27, 0]);
      // Trasor lindade (lite slarvigt) på båda greppen
      for (let i = 0; i < 8; i++) add(new THREE.TorusGeometry(0.029, 0.0055, 4, 8), m.rag, [0, -0.37 + i * 0.027, 0], [1, 1, 1], [Math.PI / 2 + (i % 2 ? 0.3 : -0.25), 0, 0.2]);
      for (let i = 0; i < 5; i++) add(new THREE.TorusGeometry(0.027, 0.005, 4, 8), m.rag, [0, -0.07 + i * 0.027, 0], [1, 1, 1], [Math.PI / 2 + (i % 2 ? -0.3 : 0.2), 0, 0.3]);
      add(new THREE.BoxGeometry(0.03, 0.12, 0.004), m.rag, [0.03, -0.42, 0.01], [1, 1, 1], [0.2, 0, 0.3]); // trasände som hänger
      add(new THREE.CylinderGeometry(0.031, 0.027, 0.04, 7), m.forged, [0, -0.44, 0]);
      add(new THREE.TorusGeometry(0.02, 0.004, 3, 8), m.strap, [0, -0.47, 0.02], [1, 1.7, 1], [0.3, 0, 0]);  // läderögla
      for (const sx of [1, -1]) add(new THREE.BoxGeometry(0.008, 0.3, 0.032), m.forged, [0.026 * sx, 0.84, 0]);
      for (const y of [0.74, 0.86]) for (const sx of [1, -1]) add(new THREE.SphereGeometry(0.008, 5, 4), m.forged, [0.031 * sx, y, 0]);
      // Huvudet: åttakantigt, lite ojämnt, med utsvällda slagytor och smidda band
      const head = new THREE.CylinderGeometry(0.075, 0.08, 0.3, 8);
      head.rotateX(Math.PI / 2);
      add(head, m.forged, [0, 1.02, 0], [1, 0.95, 1], [0, 0, 0.06]);
      for (const z of [-0.155, 0.155]) {
        const face = new THREE.CylinderGeometry(0.071, 0.081, 0.025, 8);
        face.rotateX(Math.PI / 2);
        add(face, m.forgedFace, [0, 1.02, z], [1, 1, z > 0 ? 1 : -1]);
      }
      for (const z of [-0.1, 0.1]) add(new THREE.TorusGeometry(0.081, 0.012, 4, 8), m.forged, [0, 1.02, z], [1, 1, 1], [0, 0, Math.PI / 8]);
      add(new THREE.BoxGeometry(0.034, 0.034, 0.06), m.forged, [0, 1.1, 0]);          // kil upptill
      add(new THREE.BoxGeometry(0.03, 0.02, 0.05), m.forged, [0, 0.935, 0]);          // kil nertill
      add(new THREE.BoxGeometry(0.02, 0.02, 0.04), m.forgedFace, [0.07, 1.06, 0.06], [1, 1, 1], [0.5, 0.3, 0.2]); // flisa som gått av
      g.userData.trail = { tip: [0, 1.02, 0.17], base: [0, 0.75, 0.1] };
      g.userData.blood = { w: 0.16, len: 0.16, y: 1.02 };
      g.userData.grip2 = [0, -0.3, 0];
    } else if (kind === 10) {
      // Dolk (rondelldolk): smal, spetsig klinga med fyrkantigt tvärsnitt, runda skivor som parerplåt och knapp
      const blade = new THREE.CylinderGeometry(0.0015, 0.016, 0.3, 4);
      blade.rotateY(Math.PI / 4);
      add(blade, m.blade, [0, 0.235, 0], [1, 1, 0.55]);
      add(new THREE.BoxGeometry(0.003, 0.26, 0.012), m.edge, [0, 0.22, 0], [1, 1, 1], [0, 0, 0]); // mittås som glänser
      add(new THREE.CylinderGeometry(0.038, 0.038, 0.008, 14), m.steelDark, [0, 0.083, 0]);          // parerskiva
      add(new THREE.TorusGeometry(0.038, 0.003, 4, 14), m.trim, [0, 0.083, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
      add(new THREE.CylinderGeometry(0.014, 0.016, 0.13, 8), m.wood, [0, 0.015, 0]);                 // träfäste
      for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(0.0155, 0.002, 3, 8), m.iron, [0, -0.03 + i * 0.03, 0], [1, 1, 1], [Math.PI / 2, 0, 0]); // tråd
      add(new THREE.CylinderGeometry(0.032, 0.032, 0.008, 14), m.steelDark, [0, -0.055, 0]);         // knappskiva
      add(new THREE.SphereGeometry(0.01, 6, 5), m.trim, [0, -0.064, 0]);
      add(new THREE.SphereGeometry(0.011, 6, 5), m.cloth, [0, 0.083, 0.035], [1, 1, 0.4]);           // liten sten i spelarens färg
      g.userData.edge = [[0.008, 0.12, 0], [0.003, 0.34, 0]];
      g.userData.trail = { tip: [0, 0.385, 0], base: [0, 0.12, 0] };
      g.userData.blood = { w: 0.03, len: 0.22, y: 0.24 };
    } else if (kind === 1) {
      // Skäggyxa: träskaft med lindat grepp, holk med skenor och ett brett blad med "skägg" nertill
      add(new THREE.CylinderGeometry(0.016, 0.019, 0.8, 8), m.wood, [0, 0.28, 0]);
      for (let i = 0; i < 6; i++) add(new THREE.TorusGeometry(0.02, 0.003, 3, 8), m.leatherDark, [0, -0.06 + i * 0.022, 0], [1, 1, 1], [Math.PI / 2, 0, 0.4]);
      add(new THREE.CylinderGeometry(0.022, 0.02, 0.03, 8), fit, [0, -0.125, 0]);  // ändbeslag
      add(new THREE.CylinderGeometry(0.024, 0.024, 0.11, 10), m.iron, [0, 0.6, 0]);  // holk
      for (const s of [1, -1]) add(new THREE.BoxGeometry(0.006, 0.16, 0.024), m.iron, [0.019 * s, 0.48, 0]); // skenor längs skaftet
      const blade = new THREE.ExtrudeGeometry(this.axeShape(1), { depth: 0.01, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 });
      blade.translate(0, 0, -0.005);
      blade.rotateY(-Math.PI / 2); // formens X blir framåt (+Z)
      add(blade, m.steel, [0, 0.6, 0]);
      this.weaponBloodGeo = blade.clone();
      this.weaponBloodPos = [0, 0.6, 0];
      add(new THREE.BoxGeometry(0.004, 0.2, 0.012), m.edge, [0, 0.585, 0.176], [1, 1, 1], [0.12, 0, 0]); // slipad egg
      g.userData.edge = [[0, 0.5, 0.168], [0, 0.67, 0.185]];
      add(new THREE.ConeGeometry(0.013, 0.07, 6), m.steel, [0, 0.69, 0]);                                // spets upptill (för stöten)
      add(new THREE.BoxGeometry(0.026, 0.04, 0.04), m.iron, [0, 0.6, -0.04]);                              // nacke bakåt
      for (const x of [0.009, -0.009]) add(new THREE.SphereGeometry(0.006, 5, 4), fit, [x, 0.6, 0.03]);
      g.userData.trail = { tip: [0, 0.68, 0.19], base: [0, 0.48, 0.15] };
    } else if (kind === 2) {
      // Slagkedja: handtag, kedja och en spikboll längst ut (kedjan och bollen styrs av fysiken)
      add(new THREE.CylinderGeometry(0.018, 0.021, 0.42, 8), m.wood, [0, 0.09, 0]);
      for (let i = 0; i < 6; i++) add(new THREE.TorusGeometry(0.022, 0.003, 3, 8), m.leatherDark, [0, -0.06 + i * 0.022, 0], [1, 1, 1], [Math.PI / 2, 0, 0.4]);
      add(new THREE.SphereGeometry(0.026, 8, 6), fit, [0, -0.13, 0], [1, 0.8, 1]);   // knapp
      add(new THREE.CylinderGeometry(0.024, 0.022, 0.06, 10), m.iron, [0, 0.31, 0]); // beslag upptill
      add(new THREE.TorusGeometry(0.014, 0.004, 4, 10), m.iron, [0, 0.35, 0]);      // ögla
      this.buildFlailChain(m);
      g.userData.anchor = [0, 0.35, 0];
    } else if (kind === 3) {
      // Tvåhandssvärd: lång klinga, långt grepp för två händer
      const hilt = gilded ? m.gold : m.steelDark;
      add(new THREE.BoxGeometry(0.056, 1.15, 0.011), m.blade, [0, 0.7, 0]);
      add(new THREE.BoxGeometry(0.014, 0.9, 0.015), m.steelDark, [0, 0.6, 0]);
      for (const sx of [1, -1]) add(new THREE.BoxGeometry(0.006, 1.1, 0.006), m.edge, [0.026 * sx, 0.72, 0]); // slipade eggar
      g.userData.edge = [[0.029, 0.3, 0], [0.029, 1.22, 0]];
      add(new THREE.ConeGeometry(0.028, 0.1, 4), m.blade, [0, 1.325, 0], [1, 1, 0.22]);
      this.addMakersMark(add, m, gilded, 0.2, 0.0087);
      add(new THREE.BoxGeometry(0.28, 0.035, 0.045), hilt, [0, 0.11, 0]);
      for (const s of [1, -1]) add(new THREE.SphereGeometry(0.024, 8, 6), hilt, [0.14 * s, 0.12, 0]);
      add(new THREE.CylinderGeometry(0.018, 0.02, 0.36, 8), m.leatherDark, [0, -0.07, 0]);
      for (let i = 0; i < 9; i++) add(new THREE.TorusGeometry(0.02, 0.003, 3, 8), m.leather, [0, -0.22 + i * 0.035, 0], [1, 1, 1], [Math.PI / 2, 0, 0.4]);
      add(new THREE.SphereGeometry(0.035, 10, 8), hilt, [0, -0.27, 0], [1, 0.8, 0.6]);
      g.userData.trail = { tip: [0, 1.36, 0], base: [0, 0.45, 0] };
      g.userData.blood = { w: 0.06, len: 0.8, y: 0.85 };
      g.userData.grip2 = [0, -0.2, 0];
    } else if (kind === 4) {
      // Stridsyxa (dansk yxa): ovalt askskaft med svag böj, två lindade grepp och ett tunt, brett blad
      // med lång böjd egg, smitt i flera lager (ränder), en holk med "öron" och en tygremsa i spelarens färg
      const haft = new THREE.CylinderGeometry(0.018, 0.023, 1.55, 10, 12);
      {
        const p = haft.attributes.position;
        for (let v = 0; v < p.count; v++) {
          const y = p.getY(v) / 1.55; // -0,5..0,5
          p.setXYZ(v, p.getX(v) * 0.85 + Math.sin(y * Math.PI * 2) * 0.006, p.getY(v), p.getZ(v) * 1.1);
        }
        haft.computeVertexNormals();
      }
      add(haft, m.wood, [0, 0.2, 0]);
      // Greppen: undre för vänster hand, övre för höger
      for (let i = 0; i < 7; i++) add(new THREE.TorusGeometry(0.023, 0.0035, 4, 10), m.leatherDark, [0, -0.36 + i * 0.022, 0], [0.9, 1, 1.1], [Math.PI / 2, 0, 0.4]);
      for (let i = 0; i < 5; i++) add(new THREE.TorusGeometry(0.022, 0.0035, 4, 10), m.leatherDark, [0, -0.05 + i * 0.022, 0], [0.9, 1, 1.1], [Math.PI / 2, 0, -0.4]);
      add(new THREE.CylinderGeometry(0.026, 0.023, 0.045, 10), m.iron, [0, -0.575, 0], [0.9, 1, 1.1]);           // ändbeslag
      add(new THREE.TorusGeometry(0.018, 0.004, 4, 10), m.strap, [0, -0.62, 0.012], [1, 1.6, 1], [0.3, 0, 0]);  // ögla för handleden
      // Holken: smidd i ett med bladet, med öron som griper om skaftet
      add(new THREE.CylinderGeometry(0.028, 0.026, 0.12, 12), m.iron, [0, 0.9, -0.004], [0.95, 1, 1.15]);
      for (const sy of [1, -1]) add(new THREE.ConeGeometry(0.014, 0.05, 6), m.iron, [0, 0.9 + sy * 0.07, -0.01], [1, 1, 0.8], [sy > 0 ? 0 : Math.PI, 0, 0]); // öron
      for (const s2 of [1, -1]) add(new THREE.BoxGeometry(0.006, 0.22, 0.026), m.iron, [0.021 * s2, 0.76, 0]);
      add(new THREE.BoxGeometry(0.02, 0.07, 0.03), m.iron, [0, 0.9, 0.036]);                                       // halsen mot bladet
      // Bladet: tjockare vid holken, tunnare ut mot eggen
      const blade = new THREE.ExtrudeGeometry(this.axeShape(1.65), { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 2, curveSegments: 10 });
      blade.translate(0, 0, -0.004);
      {
        const p = blade.attributes.position;
        for (let v = 0; v < p.count; v++) {
          const out = Math.min(1, Math.max(0, p.getX(v) / 0.3)); // 0 vid skaftet, 1 vid eggen
          p.setZ(v, p.getZ(v) * (1.6 - out * 1.0));
        }
        blade.computeVertexNormals();
      }
      blade.rotateY(-Math.PI / 2);
      add(blade, m.steel, [0, 0.9, 0]);
      this.weaponBloodGeo = blade.clone();
      this.weaponBloodPos = [0, 0.9, 0];
      // Smidesränder (flera lager stål) på båda sidor
      for (const sx of [1, -1]) {
        for (let k = 0; k < 4; k++) {
          add(new THREE.BoxGeometry(0.0015, 0.004, 0.17 - k * 0.02), m.steelDark, [0.0085 * sx, 0.95 - k * 0.04, 0.12 + k * 0.012], [1, 1, 1], [-0.25 + k * 0.08, 0, 0]);
        }
      }
      add(new THREE.BoxGeometry(0.004, 0.36, 0.012), m.edge, [0, 0.87, 0.29], [1, 1, 1], [0.1, 0, 0]);          // slipad egg
      add(new THREE.BoxGeometry(0.0025, 0.3, 0.008), m.edge, [0, 0.87, 0.276], [1, 1, 1], [0.1, 0, 0]);
      // Tygremsa i spelarens färg knuten under bladet
      add(new THREE.TorusGeometry(0.026, 0.005, 4, 10), m.cloth, [0, 0.82, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
      add(new THREE.BoxGeometry(0.004, 0.11, 0.022), m.cloth, [0.02, 0.76, 0.006], [1, 1, 1], [0, 0, 0.15]);
      band(0.55, 0.023);
      band(0.3, 0.022);
      g.userData.edge = [[0, 0.73, 0.275], [0, 1.0, 0.305]];
      g.userData.trail = { tip: [0, 1.03, 0.32], base: [0, 0.72, 0.26] };
      g.userData.grip2 = [0, -0.3, 0];
    } else if (kind === 5) {
      // Hillebard: lång stång med yxblad, krok bakåt och en spets för stötar
      add(new THREE.CylinderGeometry(0.017, 0.02, 2.1, 8), m.wood, [0, 0.33, 0]);
      add(new THREE.CylinderGeometry(0.022, 0.02, 0.05, 8), m.iron, [0, -0.72, 0]);
      for (let i = 0; i < 5; i++) add(new THREE.TorusGeometry(0.021, 0.003, 3, 8), m.leatherDark, [0, -0.36 + i * 0.024, 0], [1, 1, 1], [Math.PI / 2, 0, 0.4]);
      add(new THREE.CylinderGeometry(0.024, 0.024, 0.22, 10), m.iron, [0, 1.3, 0]);
      const blade = new THREE.ExtrudeGeometry(this.axeShape(0.95), { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
      blade.translate(0, 0, -0.004);
      blade.rotateY(-Math.PI / 2);
      add(blade, m.steel, [0, 1.3, 0]);
      this.weaponBloodGeo = blade.clone();
      this.weaponBloodPos = [0, 1.3, 0];
      add(new THREE.ConeGeometry(0.022, 0.32, 4), m.steel, [0, 1.56, 0]);                                     // spets
      add(new THREE.ConeGeometry(0.018, 0.14, 4), m.steel, [0, 1.32, -0.09], [1, 1, 1], [-Math.PI / 2 - 0.3, 0, 0]); // krok bakåt
      add(new THREE.SphereGeometry(0.03, 8, 6), m.cloth, [0, 1.15, 0], [1, 0.7, 1]);                          // tofs i spelarens färg
      add(new THREE.BoxGeometry(0.004, 0.2, 0.01), m.edge, [0, 1.29, 0.165], [1, 1, 1], [0.12, 0, 0]);       // egg
      band(0.8, 0.02);
      band(0.2, 0.019);
      g.userData.edge = [[0, 1.22, 0.16], [0, 1.37, 0.17]];
      g.userData.trail = { tip: [0, 1.7, 0], base: [0, 1.2, 0.18] };
      g.userData.grip2 = [0, -0.4, 0];
    } else if (kind === 6) {
      // Zweihänder: komiskt stort svärd med enorm parerstång, läderklädd ricasso med parerhakar
      const hilt = gilded ? m.gold : m.steelDark;
      add(new THREE.BoxGeometry(0.075, 1.5, 0.013), m.blade, [0, 1.07, 0]);
      add(new THREE.BoxGeometry(0.018, 1.2, 0.017), m.steelDark, [0, 0.95, 0]);
      for (const sx of [1, -1]) add(new THREE.BoxGeometry(0.007, 1.45, 0.007), m.edge, [0.035 * sx, 1.08, 0]);
      g.userData.edge = [[0.038, 0.4, 0], [0.038, 1.75, 0]];
      add(new THREE.ConeGeometry(0.038, 0.14, 4), m.blade, [0, 1.89, 0], [1, 1, 0.22]);
      this.addMakersMark(add, m, gilded, 0.4, 0.0097);
      add(new THREE.BoxGeometry(0.05, 0.2, 0.03), m.leatherDark, [0, 0.22, 0]);                     // ricasso
      for (const s of [1, -1]) {
        add(new THREE.ConeGeometry(0.014, 0.08, 5), hilt, [0.045 * s, 0.33, 0], [1, 1, 1], [0, 0, -1.2 * s]); // parerhakar
        add(new THREE.TorusGeometry(0.05, 0.012, 5, 10, Math.PI), hilt, [0.25 * s, 0.14, 0], [1, 1, 1], [0, 0, s > 0 ? 0 : Math.PI]); // böjda ändar
      }
      add(new THREE.BoxGeometry(0.5, 0.04, 0.05), hilt, [0, 0.11, 0]);                            // enorm parerstång
      add(new THREE.TorusGeometry(0.035, 0.009, 5, 12), hilt, [0, 0.11, 0.03], [1, 1, 1], [0, 0, 0]); // ring
      add(new THREE.CylinderGeometry(0.021, 0.024, 0.46, 8), m.leatherDark, [0, -0.13, 0]);
      for (let i = 0; i < 12; i++) add(new THREE.TorusGeometry(0.023, 0.003, 3, 8), m.leather, [0, -0.33 + i * 0.035, 0], [1, 1, 1], [Math.PI / 2, 0, 0.4]);
      add(new THREE.SphereGeometry(0.045, 10, 8), hilt, [0, -0.39, 0], [1, 0.85, 0.7]);
      g.userData.trail = { tip: [0, 1.95, 0], base: [0, 0.7, 0] };
      g.userData.blood = { w: 0.08, len: 1.0, y: 1.2 };
      g.userData.grip2 = [0, -0.25, 0];
    } else {
      // Svärd (riddarsvärd): klinga som smalnar mot spetsen med linsformat tvärsnitt och en nedsänkt
      // blodränna, nedåtböjd parerstång, läderlindat fäste med tråd och en hjulformad knapp
      const hilt = gilded ? m.gold : m.steelDark;
      const blade = new THREE.CylinderGeometry(0.42, 1, 0.84, 10, 6);
      {
        // tunn egg, tjockare mitt (lins) – skalas till klingans bredd och tjocklek
        const p = blade.attributes.position;
        for (let v = 0; v < p.count; v++) p.setXYZ(v, p.getX(v) * 0.026, p.getY(v), p.getZ(v) * 0.0055);
        blade.computeVertexNormals();
      }
      add(blade, m.blade, [0, 0.52, 0]);                                                       // klinga
      const tip = new THREE.ConeGeometry(1, 0.1, 10);
      add(tip, m.blade, [0, 0.99, 0], [0.0109, 1, 0.0035]);                                   // spets
      for (const z of [1, -1]) {
        add(new THREE.BoxGeometry(0.009, 0.5, 0.002), m.steelDark, [0, 0.42, 0.0042 * z]);   // blodränna (nedsänkt)
        add(new THREE.BoxGeometry(0.003, 0.5, 0.002), m.edge, [0.0062, 0.42, 0.004 * z]);    // ljus kant längs rännan
      }
      for (const sx of [1, -1]) add(new THREE.BoxGeometry(0.004, 0.84, 0.003), m.edge, [0.0165 * sx, 0.52, 0], [1, 1, 1], [0, 0, 0.0179 * sx]); // slipade eggar (följer avsmalningen)
      for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.01, 0.0015, 0.0012), m.scratch, [(k % 2 ? 0.006 : -0.008), 0.86 + k * 0.02, 0.0035], [1, 1, 1], [0, 0, 0.4 + k * 0.3]); // små repor nära spetsen
      this.addMakersMark(add, m, gilded, 0.2, 0.0045);
      // Parerstång: böjd nedåt mot ändarna och smalare ut mot ändarna
      {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.11, 0.073, 0), new THREE.Vector3(-0.055, 0.084, 0), new THREE.Vector3(0, 0.087, 0),
          new THREE.Vector3(0.055, 0.084, 0), new THREE.Vector3(0.11, 0.073, 0),
        ]);
        const guard = new THREE.TubeGeometry(curve, 20, 0.009, 8, false);
        const gp = guard.attributes.position;
        const c = new THREE.Vector3();
        const v3 = new THREE.Vector3();
        for (let a = 0; a <= 20; a++) {
          const u = a / 20;
          curve.getPointAt(u, c);
          const k = 0.65 + 0.35 * Math.sin(u * Math.PI);
          for (let b = 0; b <= 8; b++) {
            const idx = a * 9 + b;
            v3.fromBufferAttribute(gp, idx).sub(c).multiplyScalar(k).add(c);
            gp.setXYZ(idx, v3.x, v3.y, v3.z * 1.3);
          }
        }
        guard.computeVertexNormals();
        add(guard, hilt);
        for (const sx of [1, -1]) add(new THREE.SphereGeometry(0.009, 8, 6), hilt, [0.112 * sx, 0.072, 0]); // knoppar i ändarna
      }
      add(new THREE.BoxGeometry(0.03, 0.03, 0.026), hilt, [0, 0.088, 0], [1, 1, 1], [0, 0, Math.PI / 4]); // mittstycket
      add(new THREE.ConeGeometry(0.02, 0.03, 4), m.leatherDark, [0, 0.107, 0], [1, 1, 0.5], [0, Math.PI / 4, 0]); // regnskydd i läder över parerstången
      // Fäste: läderlindat, smalare i mitten, med tunn tråd i spiral
      add(new THREE.CylinderGeometry(0.017, 0.019, 0.14, 10), m.leatherDark, [0, 0, 0], [1, 1, 0.85]);
      for (let k = 0; k < 9; k++) add(new THREE.TorusGeometry(0.0182, 0.0016, 3, 10), m.iron, [0, -0.06 + k * 0.015, 0], [1, 1, 0.85], [Math.PI / 2 + 0.35, 0, 0]);
      // Hjulformad knapp med upphöjd kant och en liten sten i spelarens färg
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.016, 18), hilt, [0, -0.095, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
      for (const z of [1, -1]) {
        add(new THREE.TorusGeometry(0.024, 0.004, 5, 18), hilt, [0, -0.095, 0.009 * z]);
        add(new THREE.CylinderGeometry(0.01, 0.01, 0.003, 12), m.cloth, [0, -0.095, 0.0095 * z], [1, 1, 1], [Math.PI / 2, 0, 0]);
      }
      add(new THREE.CylinderGeometry(0.01, 0.012, 0.016, 8), hilt, [0, -0.079, 0]); // halsen mellan fäste och knapp
      g.userData.edge = [[0.025, 0.2, 0], [0.02, 0.9, 0]];
      g.userData.blood = { w: 0.05, len: 0.6, y: 0.6 };
      g.userData.trail = { tip: [0, 0.98, 0], base: [0, 0.3, 0] };
    }
    g.userData.kind = kind;
    return g;
  }

  // Smedens märke: ett litet inristat kors med ruter på båda sidor av klingan (guld på praktrustningen)
  addMakersMark(add, m, gilded, y, z) {
    const mat = gilded ? m.gold : m.steelDark;
    for (const side of [1, -1]) {
      add(new THREE.BoxGeometry(0.004, 0.05, 0.002), mat, [0, y, z * side]);
      add(new THREE.BoxGeometry(0.022, 0.004, 0.002), mat, [0, y + 0.012, z * side]);
      add(new THREE.BoxGeometry(0.009, 0.009, 0.002), mat, [0, y - 0.03, z * side], [1, 1, 1], [0, 0, Math.PI / 4]);
    }
  }

  // Ett yxblad med "skägg" (formens X = framåt mot eggen, Y = uppåt). k = storlek.
  axeShape(k) {
    const s = new THREE.Shape();
    s.moveTo(0, 0.05 * k);
    s.lineTo(0.06 * k, 0.045 * k);
    s.quadraticCurveTo(0.12 * k, 0.06 * k, 0.175 * k, 0.1 * k);   // övre hornet
    s.quadraticCurveTo(0.22 * k, -0.01 * k, 0.165 * k, -0.13 * k); // den böjda eggen
    s.quadraticCurveTo(0.09 * k, -0.09 * k, 0.045 * k, -0.045 * k); // skägget tillbaka mot skaftet
    s.lineTo(0, -0.045 * k);
    s.lineTo(0, 0.05 * k);
    return s;
  }

  // Kedjans länkar och spikbollen ligger direkt i riddarens grupp och flyttas varje bildruta
  buildFlailChain(m) {
    const LINKS = 6;
    const chain = new Chain(LINKS, 0.055, 0.065);
    // Alla länkar ritas med en enda ritning
    const links = new THREE.InstancedMesh(new THREE.TorusGeometry(0.014, 0.0042, 4, 10), m.iron, LINKS - 1);
    links.userData.equipment = true;
    links.castShadow = true;
    links.frustumCulled = false;
    this.group.add(links);
    const ball = new THREE.Group();
    ball.userData.equipment = true;
    ball.add(this.shape(new THREE.SphereGeometry(0.058, 14, 10), m.iron));
    // Spikar åt alla håll (jämnt fördelade på klotet)
    const n = 14;
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - y * y);
      const a = i * 2.39996;
      const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      const spike = this.shape(new THREE.ConeGeometry(0.014, 0.045, 6), m.steel, [dir.x * 0.07, dir.y * 0.07, dir.z * 0.07]);
      spike.quaternion.setFromUnitVectors(_up, dir);
      ball.add(spike);
    }
    ball.add(this.shape(new THREE.TorusGeometry(0.014, 0.004, 4, 10), m.iron, [0, 0.065, 0]));
    this.mergeChildren(ball);
    this.group.add(ball);
    this.flail = { chain, links, ball, frozen: false };
  }

  addWeaponBlood(kind) {
    if (kind === FISTS) return;
    let mesh;
    const bloodBox = this.weapon.userData.blood;
    if (this.weaponBloodGeo && kind !== 2) {
      mesh = new THREE.Mesh(this.weaponBloodGeo, this.bladeBloodMat);
      mesh.position.set(...this.weaponBloodPos);
      mesh.scale.set(1.25, 1.02, 1.02);
      this.weapon.add(mesh);
    } else if (kind === 2 && this.flail) {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.066, 12, 8), this.bladeBloodMat);
      this.flail.ball.add(mesh);
    } else if (bloodBox) {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(bloodBox.w, bloodBox.len, 0.018), this.bladeBloodMat);
      mesh.position.set(0, bloodBox.y, 0);
      this.weapon.add(mesh);
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.6, 0.016), this.bladeBloodMat);
      mesh.position.set(0, 0.62, 0);
      this.weapon.add(mesh);
    }
    mesh.userData.equipment = true;
  }

  // ---------- Sköldar ----------

  buildShield(kind, m, colorHex) {
    const shield = new THREE.Group();
    const add = (...a) => shield.add(this.shape(...a));
    const trim = this.style === "gilded" ? m.gold : m.steelDark;
    if (kind === 0 || kind === 3) {
      // Rund sköld (målad, med nitar och buckla), eller liten bucklare i metall
      const r = kind === 3 ? 0.16 : 0.3;
      const body = new THREE.CylinderGeometry(r, r, 0.035, 24);
      body.rotateX(Math.PI / 2);
      add(body, kind === 3 ? m.steel : m.wood);
      if (kind === 0) add(new THREE.CircleGeometry(r * 0.98, 24), m.herald, [0, 0, 0.0185]);
      add(new THREE.TorusGeometry(r, 0.016, 6, 28), trim);
      const studs = kind === 3 ? 8 : 14;
      for (let i = 0; i < studs; i++) {
        const a = (i / studs) * Math.PI * 2;
        add(new THREE.SphereGeometry(0.009, 5, 4), trim, [Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, 0.02]);
      }
      const boss = kind === 3 ? 0.08 : 0.055;
      add(new THREE.SphereGeometry(boss, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.steel, [0, 0, 0.018], [1, 1, 0.8], [Math.PI / 2, 0, 0]);
      return shield;
    }
    // Formade sköldar: målad framsida, träkropp och metallkant
    const shape = shieldShape(kind);
    const body = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false });
    body.translate(0, 0, -0.03);
    add(body, m.wood);
    add(fitUVs(new THREE.ShapeGeometry(shape, 12)), m.herald, [0, 0, 0.002]);
    const rim = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
    rim.translate(0, 0, -0.035);
    add(rim, trim, [0, 0, 0], [1.06, 1.04, 1]);
    // Nitar längs kanten
    const pts = shape.getSpacedPoints(16);
    for (let i = 0; i < pts.length - 1; i++) add(new THREE.SphereGeometry(0.008, 5, 4), trim, [pts[i].x * 0.92, pts[i].y * 0.92, 0.008]);
    if (kind === 4) add(new THREE.BoxGeometry(0.05, 0.7, 0.025), m.wood, [0, 0, -0.02]); // pavisens mittås (bak)
    return shield;
  }

  // ---------- Byggverktyg ----------

  mat(color, roughness, metalness, extra = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    m.emissive = new THREE.Color(0xaa1010);
    m.emissiveIntensity = 0;
    if (metalness >= 0.3 && ENVIRONMENT) {
      m.envMap = ENVIRONMENT; // blank metall speglar himlen och marken
      m.envMapIntensity = 1.25;
    }
    // Enfärgade material utan bilder kan slås ihop: färgen läggs då i själva formen (se mergeChildren)
    const plain = !extra.map && !extra.roughnessMap && !extra.alphaMap && !extra.bumpMap && !extra.transparent && !extra.vertexColors
      && (extra.side === undefined || extra.side === THREE.FrontSide);
    m.userData.vcKind = plain ? (metalness >= 0.3 ? "metal" : "plain") : null;
    this.materials.push(m);
    return m;
  }

  // Ett gemensamt material för alla enfärgade delar (ett för tyg/hud/trä, ett för metall)
  vcMaterial(kind) {
    if (!this.vcMats) this.vcMats = {};
    if (!this.vcMats[kind]) {
      // All metall (plåt, mässing, guld, järn) delar på ett material med lätt slitage i ytan
      const m = kind === "metal"
        ? this.mat(0xffffff, this.gilded ? 0.3 : 0.38, this.gilded ? 0.82 : 0.78, { vertexColors: true, roughnessMap: metalWearTexture() })
        : this.mat(0xffffff, 0.8, 0, { vertexColors: true });
      m.userData.baseColor = m.color.clone();
      this.vcMats[kind] = m;
    }
    return this.vcMats[kind];
  }

  shape(geometry, material, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    return mesh;
  }

  // Skala om kroppsdelar efter att de byggts. Formerna "bakas" om (så att även snett placerade
  // delar skalas rätt), barnens leder flyttas med och fysikens punkter skalas.
  reshape(scales) {
    this.segScale = scales;
    const S = new THREE.Matrix4();
    for (const [name, sc] of Object.entries(scales)) {
      const seg = this.seg[name];
      if (!seg) continue;
      const [sx, sy, sz] = sc;
      S.makeScale(sx, sy, sz);
      const uniform = Math.abs(sx - sy) < 1e-6 && Math.abs(sy - sz) < 1e-6;
      for (const child of [...seg.children]) {
        if (child.userData.segment) {
          child.position.set(child.position.x * sx, child.position.y * sy, child.position.z * sz);
        } else if (child.isMesh && !child.isInstancedMesh) {
          child.updateMatrix();
          const geo = child.geometry.clone();
          geo.applyMatrix4(child.matrix);
          geo.applyMatrix4(S);
          child.geometry = geo;
          child.position.set(0, 0, 0);
          child.quaternion.identity();
          child.scale.set(1, 1, 1);
        } else if (uniform) {
          // grupper (ansikte, hår, hjälm): flytta och skala hela gruppen
          child.position.multiplyScalar(sx);
          child.scale.multiplyScalar(sx);
        } else {
          child.position.set(child.position.x * sx, child.position.y * sy, child.position.z * sz);
        }
      }
      seg.userData.points = seg.userData.points.map(([x, y, z]) => [x * sx, y * sy, z * sz]);
      seg.userData.radius *= (sx + sz) / 2;
    }
  }

  segment(name, parent, pivot, points, radius) {
    const g = new THREE.Group();
    g.position.set(pivot[0], pivot[1], pivot[2]);
    g.userData = { segment: name, points, radius, detached: false };
    parent.add(g);
    this.seg[name] = g;
    return g;
  }

  // Slå ihop alla direkta småbitar i en grupp som har samma material till en enda.
  // Enfärgade delar slås ihop även om färgen skiljer sig: färgen sparas per punkt i formen.
  mergeChildren(group) {
    const buckets = new Map();
    for (const child of [...group.children]) {
      if (!child.isMesh) continue;
      child.updateMatrix();
      const geo = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()).applyMatrix4(child.matrix);
      const vcKind = child.material.userData?.vcKind;
      let material = child.material;
      if (vcKind) {
        material = this.vcMaterial(vcKind);
        const n = geo.attributes.position.count;
        const colors = new Float32Array(n * 3);
        const c = child.material.color;
        for (let i = 0; i < n; i++) {
          colors[i * 3] = c.r;
          colors[i * 3 + 1] = c.g;
          colors[i * 3 + 2] = c.b;
        }
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      }
      const keep = material.vertexColors ? ["position", "normal", "uv", "color"] : ["position", "normal", "uv"];
      for (const key of Object.keys(geo.attributes)) if (!keep.includes(key)) geo.deleteAttribute(key);
      geo.clearGroups?.();
      if (!buckets.has(material)) buckets.set(material, []);
      buckets.get(material).push(geo);
      group.remove(child);
      child.geometry.dispose();
    }
    for (const [material, geos] of buckets) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos);
      if (geos.length > 1) geos.forEach((g) => g.dispose());
      group.add(new THREE.Mesh(merged, material));
    }
  }

  // En kroppsdels egna ritningar (inte vapen, tyg eller andra kroppsdelar som sitter längre ut)
  ownMeshes(seg, includeHelmet = true) {
    const list = [];
    const walk = (obj) => {
      for (const child of obj.children) {
        if (child.userData?.segment || child.userData?.equipment || child.userData?.face || child.userData?.decal) continue;
        if (child.userData?.helmet && !includeHelmet) continue;
        if (child.isMesh) list.push(child);
        else walk(child);
      }
    };
    walk(seg);
    return list;
  }

  // ---------- Mjukt tyg ----------

  // Fästpunkter och klot (för att tyget inte ska gå igenom kroppen) anges i kroppsdelarnas egna koordinater
  // side = -1: tyget hålls bakom kroppsdelen (mantel), +1: framför (vapenrockens framstycke)
  // En punkt i en kroppsdels egna mått, omräknad efter proportionerna (se reshape)
  sc(seg, [x, y, z]) {
    const k = this.segScale?.[seg.userData.segment];
    return k ? [x * k[0], y * k[1], z * k[2]] : [x, y, z];
  }

  addSoft(cloth, pins, colliders, freezeTo, side, offset) {
    pins = pins.map(([seg, p]) => [seg, this.sc(seg, p)]);
    colliders = colliders.map(([seg, p, r]) => [seg, this.sc(seg, p), r]);
    this.group.add(cloth.mesh);
    this.soft.push({
      cloth, pins, colliders, freezeTo, side, offset,
      pinWorld: pins.map(() => [0, 0, 0]), colWorld: colliders.map(() => ({ x: 0, y: 0, z: 0, r: 0 })), plane: { nx: 0, nz: 0, d: 0 },
    });
  }

  addCape(m, gilded) {
    const cols = 7;
    const cloth = new Cloth({ cols, rows: 10, widthTop: 0.34, widthBottom: 0.62, height: 1.02, material: m.capeCloth });
    const torso = this.seg.torso;
    const pins = [];
    for (let c = 0; c < cols; c++) {
      const f = c / (cols - 1) - 0.5;
      pins.push([torso, [f * 0.34, 0.425 - Math.abs(f) * 0.03, -0.12 - (1 - Math.abs(f) * 2) * 0.03]]);
    }
    const T = this.seg;
    const colliders = [
      [T.torso, [0.08, 0.3, 0], 0.15], [T.torso, [-0.08, 0.3, 0], 0.15],
      [T.torso, [0.07, 0.1, 0], 0.15], [T.torso, [-0.07, 0.1, 0], 0.15],
      [T.pelvis, [0.07, -0.06, 0], 0.15], [T.pelvis, [-0.07, -0.06, 0], 0.15],
      [T.thighL, [0, -0.12, 0], 0.1], [T.thighR, [0, -0.12, 0], 0.1],
      [T.thighL, [0, -0.32, 0], 0.085], [T.thighR, [0, -0.32, 0], 0.085],
      [T.shinL, [0, -0.12, 0], 0.075], [T.shinR, [0, -0.12, 0], 0.075],
    ];
    this.addSoft(cloth, pins, colliders, "torso", -1, 0.1);
    // Rullad krage över axlarna och ett mantelspänne på bröstet
    const tor = (geo, mat, pos, scale, rot) => torso.add(this.shape(geo, mat, this.sc(torso, pos), scale, rot));
    tor(new THREE.CylinderGeometry(0.026, 0.026, 0.36, 10), m.cloth, [0, 0.425, -0.125], [1, 1, 1], [0, 0, Math.PI / 2]);
    for (const s of [1, -1]) {
      tor(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 12), gilded ? m.gold : m.brass, [0.12 * s, 0.4, 0.13], [1, 1, 1], [Math.PI / 2, 0, 0]);
      tor(new THREE.BoxGeometry(0.035, 0.012, 0.18), m.cloth, [0.15 * s, 0.43, 0.0], [1, 1, 1], [0, 0, 0.5 * s]); // kanten över axeln
    }
    tor(new THREE.CylinderGeometry(0.004, 0.004, 0.24, 4), gilded ? m.gold : m.brass, [0, 0.4, 0.135], [1, 1, 1], [0, 0, Math.PI / 2]); // kedja mellan spännena
    this.mergeChildren(torso);
  }

  // Vapenrockens skört fram och bak: mjukt tyg som gungar runt benen
  addTabard(m) {
    const P = this.seg.pelvis;
    const T = this.seg;
    for (const side of [1, -1]) {
      const cols = 5;
      const cloth = new Cloth({ cols, rows: 6, widthTop: 0.3, widthBottom: 0.36, height: 0.46, material: m.tabardCloth, damping: 0.96 });
      const pins = [];
      for (let c = 0; c < cols; c++) {
        const f = c / (cols - 1) - 0.5;
        pins.push([P, [f * 0.3 * side, -0.02, (0.128 - Math.abs(f) * 0.05) * side]]);
      }
      const colliders = [
        [T.pelvis, [0.06, -0.08, 0], 0.13], [T.pelvis, [-0.06, -0.08, 0], 0.13],
        [T.thighL, [0, -0.1, 0], 0.1], [T.thighR, [0, -0.1, 0], 0.1],
        [T.thighL, [0, -0.28, 0], 0.088], [T.thighR, [0, -0.28, 0], 0.088],
        [T.shinL, [0, -0.02, 0], 0.08], [T.shinR, [0, -0.02, 0], 0.08],
      ];
      this.addSoft(cloth, pins, colliders, "pelvis", side, 0.06);
    }
  }

  // Flytta tyget och kedjan (anropas efter att lederna flyttats)
  updateSoft(dt) {
    if (this.soft.length === 0 && !this.flail) return;
    this.group.updateMatrixWorld(true);
    _inv.copy(this.group.matrixWorld).invert();
    // Vände sig riddaren blixtsnabbt (t.ex. ny runda)? Då börjar tyget om och hänger rakt ner,
    // annars kan det fastna på fel sida om kroppen.
    const yaw = this.group.rotation.y;
    let turn = this.lastYaw === undefined ? 0 : yaw - this.lastYaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.lastYaw = yaw;
    const snapped = Math.abs(turn) > 0.9;
    for (const s of this.soft) {
      if (s.cloth.frozen) continue;
      s.pins.forEach(([seg, p], i) => {
        _v.set(p[0], p[1], p[2]).applyMatrix4(seg.matrixWorld);
        const w = s.pinWorld[i];
        w[0] = _v.x;
        w[1] = _v.y;
        w[2] = _v.z;
      });
      const cols = [];
      s.colliders.forEach(([seg, p, r], i) => {
        if (seg.userData.detached) return;
        _v.set(p[0], p[1], p[2]).applyMatrix4(seg.matrixWorld);
        const c = s.colWorld[i];
        c.x = _v.x;
        c.y = _v.y;
        c.z = _v.z;
        c.r = r;
        cols.push(c);
      });
      // Planet som tyget inte får passera: genom kroppsdelens mitt, vinkelrätt mot dess framåtriktning
      const e = this.seg[s.freezeTo].matrixWorld.elements;
      const fl = Math.hypot(e[8], e[10]) || 1;
      const fx = e[8] / fl;
      const fz = e[10] / fl;
      const along = fx * e[12] + fz * e[14];
      if (s.side < 0) Object.assign(s.plane, { nx: fx, nz: fz, d: along - s.offset });
      else Object.assign(s.plane, { nx: -fx, nz: -fz, d: -along - s.offset });
      if (snapped) s.cloth.reset(s.pinWorld, [fx * 0.02 * s.side, 0, fz * 0.02 * s.side]);
      s.cloth.update(dt, s.pinWorld, cols, _inv, 0.02, s.plane);
    }
    if (this.flail && !this.flail.frozen) this.updateFlail(dt);
  }

  updateFlail(dt) {
    const { chain, links, ball } = this.flail;
    const a = this.weapon.userData.anchor;
    _v.set(a[0], a[1], a[2]).applyMatrix4(this.weapon.matrixWorld);
    chain.update(dt, [_v.x, _v.y, _v.z]);
    // Länkarna mellan punkterna, varannan vriden ett kvarts varv (som en riktig kedja)
    for (let i = 0; i < links.count; i++) {
      chain.point(i + 1, _v).applyMatrix4(_inv);
      chain.point(i + 2, _v2).applyMatrix4(_inv);
      _mid.copy(_v).add(_v2).multiplyScalar(0.5);
      _v2.sub(_v).normalize();
      _q.setFromUnitVectors(_up, _v2);
      _q2.setFromAxisAngle(_up, i % 2 ? Math.PI / 2 : 0);
      _q.multiply(_q2);
      _mat.compose(_mid, _q, _linkScale);
      links.setMatrixAt(i, _mat);
    }
    links.instanceMatrix.needsUpdate = true;
    chain.point(chain.count, _v).applyMatrix4(_inv);
    chain.point(chain.count - 1, _v2).applyMatrix4(_inv);
    ball.position.copy(_v);
    _v2.sub(_v).normalize();
    ball.quaternion.setFromUnitVectors(_up, _v2);
  }

  // Tyg och kedja slutar röra sig och följer med kroppen (vid död eller avhuggning)
  freezeSoft(which = null) {
    for (const s of this.soft) {
      if (which && s.freezeTo !== which) continue;
      s.cloth.freeze(this.seg[s.freezeTo]);
    }
    if (this.flail && !this.flail.frozen && (!which || which === "weapon")) {
      this.flail.frozen = true;
      for (const obj of [this.flail.links, this.flail.ball]) this.weapon.attach(obj);
    }
  }

  // ---------- Blod, bucklor, repor och smuts ----------

  // En punkt på ytan av en kroppsdel (för fläckar och repor) och åt vilket håll ytan pekar.
  // En stråle skjuts in mot kroppsdelen utifrån, så punkten hamnar exakt på plåten/tyget.
  surfacePoint(segName) {
    const guess = this.guessSurfacePoint(segName);
    const seg = this.seg[segName];
    const meshes = this.ownMeshes(seg).filter((mesh) => !mesh.userData.decal && mesh.material !== this.m.helmInner);
    if (meshes.length === 0) return guess;
    if (!this.raycaster) this.raycaster = new THREE.Raycaster();
    this.group.updateMatrixWorld(true);
    const inward = guess.normal.clone().negate();
    const from = guess.pos.clone().addScaledVector(guess.normal, 0.25);
    const origin = from.applyMatrix4(seg.matrixWorld);
    const dir = inward.transformDirection(seg.matrixWorld);
    this.raycaster.set(origin, dir);
    this.raycaster.far = 0.6;
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit || !hit.face || !hit.point) return guess;
    const pos = seg.worldToLocal(hit.point.clone());
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    _inv.copy(seg.matrixWorld).invert();
    normal.transformDirection(_inv);
    if (normal.dot(guess.normal) < 0) normal.negate();
    pos.addScaledVector(normal, 0.0015); // en hårsmån utanför ytan
    return { pos, normal };
  }

  guessSurfacePoint(segName) {
    const seg = this.seg[segName];
    const pts = seg.userData.points;
    const isTorso = segName === "torso";
    const isHead = segName === "head";
    const angle = Math.random() * Math.PI * 2;
    const y = isTorso ? 0.08 + Math.random() * 0.34 : isHead ? 0.06 + Math.random() * 0.16 : pts[1][1] * (0.15 + Math.random() * 0.7);
    const r = isTorso ? 0.2 : isHead ? (this.helmetOff ? 0.1 : 0.126) : seg.userData.radius * 1.35 + 0.01;
    const sx = isTorso ? 1.15 : 1;
    const sz = isTorso ? 0.78 : 1;
    const normal = new THREE.Vector3(Math.sin(angle) * sx, 0, Math.cos(angle) * sz).normalize();
    return { pos: new THREE.Vector3(Math.sin(angle) * r * sx, isHead ? 0.135 + (y - 0.135) * 0.6 : y, Math.cos(angle) * r * sz), normal };
  }

  addDecal(segName, mesh) {
    const seg = this.seg[segName];
    if (!seg || seg.userData.detached || this.decals > 70) return false;
    this.decals += 1;
    const { pos, normal } = this.surfacePoint(segName);
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    // Fläckar på hjälmen följer med hjälmen om den flyger av
    (segName === "head" && !this.helmetOff ? this.helmet : seg).add(mesh);
    return true;
  }

  // En blodfläck på kroppsdelen som träffades
  addBloodSplat(segName) {
    if (segName === "head" && this.noseBlood) this.noseBlood.visible = true; // näsblod
    if (this.bloodSplats > 45) return;
    const size = 0.06 + Math.random() * 0.08;
    const splat = new THREE.Mesh(new THREE.PlaneGeometry(size, size), bloodDecal());
    splat.rotation.z = Math.random() * Math.PI * 2;
    splat.scale.set(1, 0.7 + Math.random() * 0.6, 1);
    const holder = new THREE.Group(); // hållaren vänds mot ytan, stänket vrids slumpvis i den
    holder.userData.decal = true;
    holder.add(splat);
    if (this.addDecal(segName, holder)) {
      this.bloodSplats += 1;
      // Blodet rinner nedåt från fläcken (åt det håll som är neråt just nu)
      if (Math.random() < 0.7) {
        holder.updateWorldMatrix(true, false);
        holder.getWorldQuaternion(_q).invert();
        const down = _v.set(0, -1, 0).applyQuaternion(_q);
        down.z = 0;
        if (down.lengthSq() > 0.05) {
          down.normalize();
          const len = 0.05 + Math.random() * 0.1;
          const run = new THREE.Mesh(new THREE.PlaneGeometry(0.014 + Math.random() * 0.01, len), bloodDecal());
          run.position.set(down.x * len * 0.5, down.y * len * 0.5, 0.0005);
          run.rotation.z = Math.atan2(down.y, down.x) - Math.PI / 2;
          holder.add(run);
          if (Math.random() < 0.5) {
            const drop = new THREE.Mesh(new THREE.CircleGeometry(0.008 + Math.random() * 0.005, 8), bloodDecal());
            drop.position.set(down.x * len, down.y * len, 0.0006);
            holder.add(drop);
          }
        }
      }
    }
  }

  // En blank repa (metall) eller ljus skråma (läder och tyg)
  addScratch(segName) {
    const len = 0.025 + Math.random() * 0.04;
    const scratch = new THREE.Mesh(new THREE.BoxGeometry(len, 0.0035, 0.002), this.m.scratch);
    scratch.rotation.z = Math.random() * Math.PI;
    const holder = new THREE.Group();
    holder.userData.decal = true;
    holder.add(scratch);
    this.addDecal(segName, holder);
  }

  // Plåten trycks faktiskt in: punkterna runt en slumpad plats flyttas inåt mot kroppsdelens mitt
  addDent(segName, depth = 0.012) {
    const seg = this.seg[segName];
    if (!seg || seg.userData.detached || !this.isMetal) return false;
    const metal = this.vcMats?.metal;
    const meshes = this.ownMeshes(seg).filter((mesh) => (mesh.material === metal || mesh.material === this.m.steel) && mesh.geometry.attributes.position);
    if (meshes.length === 0) return false;
    const mesh = meshes[Math.floor(Math.random() * meshes.length)];
    const pos = mesh.geometry.attributes.position;
    const normal = mesh.geometry.attributes.normal;
    if (!pos.count || !normal) return false;
    const arr = pos.array;
    const nrm = normal.array;
    const vi = Math.floor(Math.random() * pos.count) * 3;
    const cx = arr[vi];
    const cy = arr[vi + 1];
    const cz = arr[vi + 2];
    const radius = 0.028 + Math.random() * 0.025;
    const isHead = segName === "head";
    const moved = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = arr[i * 3];
      const y = arr[i * 3 + 1];
      const z = arr[i * 3 + 2];
      const d = Math.hypot(x - cx, y - cy, z - cz);
      if (d >= radius) continue;
      // Utåt från mitten: huvudet från en punkt mitt i skallen, bål och lemmar från sin lodräta axel
      const ox = x;
      const oy = isHead ? y - 0.13 : 0;
      const oz = z;
      const len = Math.hypot(ox, oy, oz) || 1;
      const f = (1 - d / radius) ** 2 * depth;
      arr[i * 3] -= (ox / len) * f;
      arr[i * 3 + 1] -= (oy / len) * f;
      arr[i * 3 + 2] -= (oz / len) * f;
      moved[i] = 1;
    }
    // Nya normaler för trianglarna i bucklan (så ljuset bryts i den)
    for (let t = 0; t + 2 < pos.count; t += 3) {
      if (!moved[t] && !moved[t + 1] && !moved[t + 2]) continue;
      const a = t * 3;
      const b = a + 3;
      const c = a + 6;
      const ux = arr[b] - arr[a];
      const uy = arr[b + 1] - arr[a + 1];
      const uz = arr[b + 2] - arr[a + 2];
      const vx = arr[c] - arr[a];
      const vy = arr[c + 1] - arr[a + 1];
      const vz = arr[c + 2] - arr[a + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      // Behåll riktningen utåt (samma håll som den gamla normalen)
      if (nx * nrm[a] + ny * nrm[a + 1] + nz * nrm[a + 2] < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      for (const k of [a, b, c]) {
        nrm[k] = nx;
        nrm[k + 1] = ny;
        nrm[k + 2] = nz;
      }
    }
    pos.needsUpdate = true;
    normal.needsUpdate = true;
    return true;
  }

  // Smuts: alla färger dras lite mot jordbrunt (0 = ren, 1 = riktigt smutsig)
  setDirt(amount) {
    this.dirt = Math.max(0, Math.min(1, amount));
    for (const mat of this.materials) {
      const base = mat.userData?.baseColor;
      if (!base || mat === this.m.blood || mat === this.m.eyeWhite || mat === this.m.iris || mat === this.m.helmInner) continue;
      mat.color.copy(base).lerp(DIRT, this.dirt * 0.38);
    }
  }

  // Slitage efter en träff (anropas av spelet). Returnerar vad som hände så spelet kan spara det.
  addWear(segName, heavy) {
    const seg = segName && this.seg[segName] && !this.seg[segName].userData.detached ? segName : "torso";
    let dents = 0;
    for (let i = 0; i < (heavy ? 2 : 1); i++) if (this.addDent(seg, heavy ? 0.016 : 0.01)) dents += 1;
    this.addScratch(seg);
    if (Math.random() < 0.5) this.addScratch(Math.random() < 0.5 ? "torso" : seg);
    this.setDirt((this.dirt || 0) + 0.04);
    return dents;
  }

  // Återskapa slitaget från tidigare rundor i matchen (en ny riddare skapas varje runda)
  applyWear(wear) {
    if (!wear) return;
    const parts = ["torso", "torso", "head", "upperArmL", "upperArmR", "thighL", "thighR", "shinL", "shinR", "forearmL", "forearmR"];
    const pick = () => parts[Math.floor(Math.random() * parts.length)];
    for (let i = 0; i < Math.min(30, wear.dents || 0); i++) this.addDent(pick(), 0.008 + Math.random() * 0.008);
    for (let i = 0; i < Math.min(25, wear.scratches || 0); i++) this.addScratch(pick());
    for (let i = 0; i < Math.min(12, wear.blood || 0); i++) this.addBloodSplat(pick());
    for (let i = 0; i < Math.min(10, wear.nicks || 0); i++) this.addNick();
    this.setDirt(wear.dirt || 0);
  }

  bloodySword() {
    this.bladeHitAt = performance.now() / 1000; // färskt blod droppar från eggen en stund
    this.swordBlood = Math.min(1, this.swordBlood + 0.25);
    this.bladeBloodMat.opacity = this.swordBlood * 0.8;
  }

  // Ett hack i eggen (blir fler under matchen). Returnerar true om det blev ett.
  addNick() {
    const edge = this.weapon?.userData.edge;
    if (!edge || this.nicks >= 10) return false;
    this.nicks += 1;
    const t = Math.random();
    const [a, b] = edge;
    const side = a[0] !== 0 && Math.random() < 0.5 ? -1 : 1;
    const nick = this.shape(new THREE.BoxGeometry(0.012, 0.016, 0.02), this.m.steelDark,
      [(a[0] + (b[0] - a[0]) * t) * side, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], [1, 1, 1], [0, 0, Math.PI / 4]);
    nick.userData.equipment = true;
    this.weapon.add(nick);
    return true;
  }

  // Byt vapen mitt i en runda (plockade upp ett från marken, eller tappade sitt: FISTS)
  setWeapon(kind) {
    if (this.seg.handR.userData.detached) return;
    if (this.flail) {
      this.flail.links.removeFromParent();
      this.flail.ball.removeFromParent();
      this.flail = null;
    }
    this.removeTrail();
    this.weapon.removeFromParent();
    this.weaponBloodGeo = null;
    this.wIndex = kind;
    const spec = weaponSpec(kind);
    this.weaponKey = spec.key;
    this.twoHanded = !!spec.twoHanded;
    const weapon = this.buildWeapon(kind, this.m, this.gilded);
    weapon.position.set(0, -0.06, 0.01);
    weapon.rotation.x = 2.0;
    weapon.userData.equipment = true;
    this.mergeChildren(weapon);
    this.seg.handR.add(weapon);
    this.weapon = weapon;
    this.sword = weapon;
    this.nicks = 0;
    this.swordBlood = 0;
    this.bladeBloodMat.opacity = 0;
    this.addWeaponBlood(kind);
    this.shield.visible = !this.twoHanded;
    weapon.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.attack = null;
    this.charging = false;
  }

  // Vapnet lossnar ur handen (det ligger sedan på marken som ett eget föremål)
  dropWeapon() {
    this.setWeapon(FISTS);
  }

  // En stillastående modell av ett vapen, för vapen som ligger på marken.
  // Byggs med riddarens egna material (samma färg på tofsar, guld på praktrustningen).
  buildItemModel(kind) {
    if (kind === FISTS) return null;
    const savedFlail = this.flail;
    const savedGeo = this.weaponBloodGeo;
    const savedPos = this.weaponBloodPos;
    this.flail = null;
    const g = this.buildWeapon(kind, this.m, this.gilded);
    this.mergeChildren(g);
    if (kind === 2 && this.flail) {
      // Slagkedjan: kedjan ligger utsträckt och spikbollen längst ut
      const { links, ball } = this.flail;
      links.removeFromParent();
      ball.removeFromParent();
      const a = g.userData.anchor;
      for (let i = 0; i < links.count; i++) {
        _mat.compose(_v.set(a[0], a[1] + 0.04 + i * 0.055, a[2]), _q.setFromAxisAngle(_up, i % 2 ? Math.PI / 2 : 0), _linkScale);
        links.setMatrixAt(i, _mat);
      }
      links.instanceMatrix.needsUpdate = true;
      links.frustumCulled = false;
      ball.position.set(a[0], a[1] + 0.04 + links.count * 0.055 + 0.05, a[2]);
      ball.quaternion.identity();
      g.add(links, ball);
    }
    this.flail = savedFlail;
    this.weaponBloodGeo = savedGeo;
    this.weaponBloodPos = savedPos;
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    return g;
  }

  // ---------- Vapenspår (en ljus båge som följer vapnets huvud i slaget) ----------

  trailEnds(tip, base) {
    const t = this.weapon.userData.trail;
    if (this.flail && !this.flail.frozen) {
      this.flail.chain.point(this.flail.chain.count, tip);
      const a = this.weapon.userData.anchor;
      base.set(a[0], a[1], a[2]).applyMatrix4(this.weapon.matrixWorld);
      return;
    }
    tip.set(...t.tip).applyMatrix4(this.weapon.matrixWorld);
    base.set(...t.base).applyMatrix4(this.weapon.matrixWorld);
  }

  updateTrail(scene) {
    const SAMPLES = 12;
    if (!this.trail) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SAMPLES * 2 * 3), 3));
      geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(SAMPLES * 2 * 4), 4));
      const index = [];
      for (let i = 0; i < SAMPLES - 1; i++) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      geo.setIndex(index);
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      this.trail = { mesh: new THREE.Mesh(geo, mat), samples: [] };
      this.trail.mesh.frustumCulled = false;
      this.trail.mesh.renderOrder = 2;
    }
    const trail = this.trail;
    if (!trail.mesh.parent && scene) scene.add(trail.mesh);
    const active = this.attack && !this.seg.handR.userData.detached && this.attack.t > 0.06 && this.attack.t < 0.42;
    if (active) {
      this.weapon.updateWorldMatrix(true, false);
      const tip = new THREE.Vector3();
      const base = new THREE.Vector3();
      this.trailEnds(tip, base);
      trail.samples.unshift({ tip, base, age: 0 });
    }
    for (const s of trail.samples) s.age += 1;
    while (trail.samples.length > SAMPLES || (trail.samples.length && trail.samples[trail.samples.length - 1].age > SAMPLES)) trail.samples.pop();
    const pos = trail.mesh.geometry.attributes.position;
    const col = trail.mesh.geometry.attributes.color;
    for (let i = 0; i < SAMPLES; i++) {
      const s = trail.samples[Math.min(i, trail.samples.length - 1)];
      const alpha = trail.samples.length > 1 && i < trail.samples.length ? (1 - i / SAMPLES) * 0.55 : 0;
      if (s) {
        pos.setXYZ(i * 2, s.tip.x, s.tip.y, s.tip.z);
        pos.setXYZ(i * 2 + 1, s.base.x, s.base.y, s.base.z);
      }
      col.setXYZW(i * 2, 1, 0.97, 0.9, alpha);
      col.setXYZW(i * 2 + 1, 1, 0.97, 0.9, alpha * 0.1);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  removeTrail() {
    if (this.trail) {
      this.trail.mesh.removeFromParent();
      this.trail.mesh.geometry.dispose();
      this.trail.mesh.material.dispose();
      this.trail = null;
    }
  }

  // ---------- Reaktioner och ansiktsuttryck ----------

  // Rycker till bort från slaget. dirLocal = [x, z] i riddarens egna koordinater (varifrån slaget kom)
  playHit(dirLocal) {
    this.hitT = 0;
    this.hitDir = dirLocal;
    this.squint = 1;
    this.shout(0.55, 0.35);
  }

  playLand() {
    this.landT = 0;
  }

  // Öppna munnen (stön, skrik): amount 0–1, under så många sekunder
  shout(amount = 1, seconds = 0.5) {
    if (amount >= this.mouthTarget || this.mouthTimer <= 0) {
      this.mouthTarget = amount;
      this.mouthTimer = seconds;
    }
  }

  // Hjälmen flyger av (tungt slag). Returnerar en ragdoll för hjälmen, eller null.
  knockHelmet(velocity, scene, bounds) {
    if (this.helmetOff || !this.helmet.parent) return null;
    this.helmetOff = true;
    this.visorOpen = 0;
    const helmet = this.helmet;
    this.group.updateMatrixWorld(true);
    const local = [[0, 0.1, 0], [0, 0.26, 0], [0, 0.15, 0.12]];
    const tmp = new THREE.Vector3();
    const world = local.map((p) => tmp.set(p[0], p[1], p[2]).applyMatrix4(helmet.matrixWorld).toArray());
    scene.attach(helmet);
    this.hairGroup.visible = true;
    helmet.traverse((obj) => {
      if (obj.isMesh) obj.material = this.calmMaterial(obj.material);
    });
    const spin = () => (Math.random() - 0.5) * 10;
    return new Ragdoll([{ object: helmet, local, world, radius: 0.13, velocity, spin: [spin(), spin(), spin()] }], bounds);
  }

  // Utan hjälm från början (t.ex. om man kommer in mitt i en runda där hjälmen redan åkt av)
  removeHelmet() {
    this.helmetOff = true;
    this.hairGroup.visible = true;
    this.helmet.removeFromParent();
  }

  updateFace(dt) {
    if (!this.face) return;
    const t = this.time || 0;
    // Läget avgör uttrycket: laddar (sammanbiten), lite liv (flämtar), vinner (flinar), död (slapp)
    const lowHp = !this.dead && this.hp !== undefined && this.hp < 30 && this.hp > 0;
    const grin = this.victory > 0 || (this.emote && this.emote.e === 2);
    const clench = this.charging && !this.dead;
    // Munnen
    this.mouthTimer -= dt;
    let target = this.mouthTimer > 0 ? this.mouthTarget : 0;
    if (lowHp) target = Math.max(target, 0.35 + Math.max(0, Math.sin(t * 7)) * 0.25); // flämtar
    if (grin) target = Math.max(target, 0.25);
    if (clench) target = Math.min(target, 0.05);
    if (this.dead) target = 0.55;
    this.mouthOpen += (target - this.mouthOpen) * (1 - Math.exp(-dt * (target > this.mouthOpen ? 30 : 10)));
    const wide = grin ? 1.35 : clench ? 1.15 : 1;
    this.mouthMesh.scale.set((1 - this.mouthOpen * 0.15) * wide, 0.2 + this.mouthOpen * 1.5, 1);
    this.mouthMesh.position.y = 0.088 - this.mouthOpen * 0.01 + (grin ? 0.002 : 0);
    this.lowerLip.position.y = 0.0815 - this.mouthOpen * 0.02;
    this.lowerLip.position.z = 0.092 - this.mouthOpen * 0.004;
    this.lowerLip.scale.x = wide;
    // Kisar vid träff, blinkar ibland, halvslutna ögon när man är död
    this.squint = Math.max(0, this.squint - dt * 2.5);
    this.blinkTimer -= dt;
    let lid = 1 - this.squint * 0.75 - (clench ? 0.2 : 0) - (lowHp ? 0.15 : 0) - (grin ? 0.25 : 0);
    if (this.blinkTimer < 0) {
      lid = 0.1;
      if (this.blinkTimer < -0.12) this.blinkTimer = 2 + Math.random() * 4;
    }
    if (this.dead) lid = 0.35;
    for (const eye of this.eyes) eye.scale.y = Math.max(0.35, lid);
    for (const l of this.lids) l.rotation.x = -0.9 + (1 - lid) * 1.3;
    // Blicken: irisen tittar mot den man slåss med (eller far runt lite)
    if (this.gazeTarget && !this.dead) {
      this.face.updateWorldMatrix(true, false);
      _v.copy(this.gazeTarget);
      this.face.worldToLocal(_v);
      const gx = Math.max(-1, Math.min(1, _v.x / Math.max(0.3, _v.z)));
      const gy = Math.max(-1, Math.min(1, (_v.y - 0.146) / Math.max(0.3, Math.abs(_v.z))));
      this.gaze = this.gaze || { x: 0, y: 0 };
      this.gaze.x += (gx - this.gaze.x) * Math.min(1, dt * 8);
      this.gaze.y += (gy - this.gaze.y) * Math.min(1, dt * 8);
    }
    const g = this.gaze || { x: 0, y: 0 };
    for (const eye of this.eyes) {
      const iris = eye.userData.iris;
      if (iris) iris.rotation.set(-g.y * 0.35, g.x * 0.5, 0);
    }
    // Ögonbrynen: arg i strid, höjda vid skratt, rynkade när man laddar, sorgsna när man är nära döden
    const laughing = this.emote && this.emote.e === 2;
    let angry = laughing ? -0.2 : 0.35 + this.squint * 0.3 + this.mouthOpen * 0.2 + (clench ? 0.25 : 0);
    if (lowHp) angry = -0.25;
    if (this.dead) angry = 0;
    for (const brow of this.brows) {
      brow.rotation.z = (brow.userData.base ?? 0) + brow.userData.side * angry;
      brow.position.y = 0.168 + (laughing ? 0.008 : -this.squint * 0.005 - Math.max(0, angry - 0.35) * 0.008 + this.mouthOpen * 0.004 + (lowHp ? 0.004 : 0));
      brow.position.x = brow.userData.side * (0.034 - Math.max(0, angry - 0.35) * 0.006);
    }
    // Visiret fälls upp när man hånar (så man ser flinet)
    if (this.visor) {
      const open = laughing && !this.helmetOff ? 1 : 0;
      this.visorOpen += (open - this.visorOpen) * (1 - Math.exp(-dt * 8));
      this.visor.rotation.x = -1.35 * this.visorOpen;
    }
  }

  // ---------- Namnskylt med livmätare ----------

  createLabel() {
    this.labelCanvas = document.createElement("canvas");
    this.labelCanvas.width = 512;
    this.labelCanvas.height = 128;
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTexture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: this.labelTexture, depthWrite: false });
    this.materials.push(material);
    this.label = new THREE.Sprite(material);
    this.label.scale.set(1.7, 0.425, 1);
    this.label.position.y = 2.2;
    this.group.add(this.label);
    this.setHp(COMBAT.maxHp);
  }

  setHp(hp) {
    if (!this.labelCanvas) return;
    this.hp = hp;
    const ctx = this.labelCanvas.getContext("2d");
    ctx.clearRect(0, 0, 512, 128);
    // Texten krymps så att långa namn får plats (och inte går in i grannens skylt)
    const badge = this.isBot ? 70 : 0;
    let size = 44;
    ctx.font = `bold ${size}px Georgia, serif`;
    while (ctx.measureText(this.name).width > 420 - badge && size > 22) {
      size -= 2;
      ctx.font = `bold ${size}px Georgia, serif`;
    }
    const tw = ctx.measureText(this.name).width;
    const tx = 256 - badge / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(20, 14, 8, 0.85)";
    ctx.strokeText(this.name, tx, 42);
    ctx.fillStyle = "#" + new THREE.Color(this.labelColor ?? this.colorHex).lerp(new THREE.Color(0xffffff), 0.55).getHexString();
    ctx.fillText(this.name, tx, 42);
    if (badge) {
      // Liten skylt "BOT" för träningsmotståndare
      const bx = tx + tw / 2 + 10;
      ctx.fillStyle = "rgba(20, 14, 8, 0.85)";
      ctx.fillRect(bx, 24, 62, 36);
      ctx.fillStyle = "#e0c070";
      ctx.font = "bold 24px Georgia, serif";
      ctx.textAlign = "left";
      ctx.fillText("BOT", bx + 6, 43);
      ctx.textAlign = "center";
    }

    const w = 260;
    const x = 256 - w / 2;
    ctx.fillStyle = "rgba(20, 14, 8, 0.8)";
    ctx.fillRect(x - 4, 88, w + 8, 26);
    ctx.fillStyle = "#4a1410";
    ctx.fillRect(x, 92, w, 18);
    ctx.fillStyle = hp > 50 ? "#4caf50" : hp > 25 ? "#e0a020" : "#d0302a";
    ctx.fillRect(x, 92, (w * Math.max(0, hp)) / COMBAT.maxHp, 18);
    this.labelTexture.needsUpdate = true;
  }

  // Namnet i en annan färg (t.ex. lagfärgen)
  setLabelColor(hex) {
    this.labelColor = hex;
    if (this.labelCanvas) this.setHp(this.hp ?? COMBAT.maxHp);
  }

  // ---------- Stridshändelser (anropas från spelet) ----------

  playAttack(kind) {
    // Kast och knytnävsslag medan man brottas har egna rörelser
    if (kind === "x" || kind === "p") {
      // Med dolken hugger man i stället för att slå med knytnäven
      const grabMove = this.weaponKey === "dagger" ? MOVES.dagger.q[0] : MOVES.fists.q[0];
      this.attack = { kind, t: 0, move: kind === "x" ? THROW_MOVE : grabMove };
      this.charging = false;
      this.shout(0.6, 0.25);
      return;
    }
    // Vapnets egen rörelse; snabba slag växlar mellan varianterna (hugg och bakhandshugg)
    const set = movesFor(this.weaponKey)[kind] || movesFor(this.weaponKey).q;
    let move = set;
    if (Array.isArray(set)) {
      this.combo = ((this.combo ?? -1) + 1) % set.length;
      move = set[this.combo];
    }
    this.attack = { kind, t: 0, move };
    this.charging = false;
    this.shout(kind === "h" ? 0.7 : 0.4, kind === "h" ? 0.35 : 0.22); // ansträngning
  }

  setCharging(on) {
    this.charging = on;
  }

  // Brottning: "hold" = håller fast någon framför sig, "held" = blir fasthållen, "reach" = sträcker sig efter någon, null = slut
  setGrab(role) {
    this.grab = role;
    this.grabT = 0;
    if (role) {
      this.attack = null;
      this.charging = false;
      this.emote = null;
    }
  }

  // Den fasthållna sliter för att komma loss
  playStruggle() {
    this.struggleT = 0;
    this.shout(0.7, 0.2);
  }

  playParry() {
    this.parryT = 0;
  }

  playStagger() {
    this.staggerT = 0;
    this.attack = null;
    this.charging = false;
  }

  flash() {
    this.flashT = 0.2;
  }

  chestPosition(target) {
    this.group.updateMatrixWorld(true);
    return target.set(0, 0.25, 0).applyMatrix4(this.seg.torso.matrixWorld);
  }

  // ---------- Hugga av och ragdoll ----------

  // Alla anslutna kroppsdelar från och med "root" och utåt
  subtree(root) {
    const list = [];
    root.traverse((obj) => {
      if (obj.userData && obj.userData.segment && !obj.userData.detached) list.push(obj);
    });
    return list;
  }

  // topple = hela kroppen faller: knuffen tar mest i överkroppen så att riddaren faller omkull
  // (i stället för att sjunka ihop rakt ner), och benen viker sig lite.
  makeRagdoll(segments, velocity, scene, bounds, spinAmount, topple = false) {
    this.group.updateMatrixWorld(true);
    const tmp = new THREE.Vector3();
    const ground = this.group.position.y;
    // Riddarens egen rörelse (springer man när man dör fortsätter kroppen framåt)
    const run = this.lastVel || [0, 0];
    const bodies = segments.map((s) => {
      const world = s.userData.points.map((p) => tmp.set(p[0], p[1], p[2]).applyMatrix4(s.matrixWorld).toArray());
      let v;
      let spin;
      if (topple) {
        const h = Math.max(0, Math.min(1, (world[0][1] - ground) / 1.6)); // 0 vid fötterna, 1 vid huvudet
        const jitter = () => (Math.random() - 0.5) * 0.35;
        v = [
          velocity[0] * (0.1 + 0.9 * h) + run[0] * 0.6 + jitter(),
          velocity[1] * 0.25 * h,
          velocity[2] * (0.1 + 0.9 * h) + run[1] * 0.6 + jitter(),
        ];
        // Knäna viker sig framåt (i riddarens egen riktning) så att benen ger vika
        if (/^shin/.test(s.userData.segment)) {
          const yaw = this.group.rotation.y;
          v[0] += Math.sin(yaw) * 0.8;
          v[2] += Math.cos(yaw) * 0.8;
          v[1] -= 0.6;
        }
        spin = [jitter(), jitter(), jitter()];
      } else {
        const jitter = () => (Math.random() - 0.5) * 1.5;
        v = [velocity[0] + jitter(), velocity[1] + jitter() * 0.5, velocity[2] + jitter()];
        spin = [jitter() * spinAmount, jitter() * spinAmount, jitter() * spinAmount];
      }
      return {
        object: s,
        name: s.userData.segment,
        local: s.userData.points,
        world,
        radius: s.userData.radius,
        velocity: v,
        spin,
      };
    });
    for (const s of segments) {
      s.userData.detached = true;
      scene.attach(s); // behåll positionen i världen men lossa från kroppen
      // Lösa delar får egna material, så de inte blinkar rött när riddaren träffas
      s.children.forEach((child) => {
        child.traverse((obj) => {
          if (obj.isMesh && !obj.userData?.segment) obj.material = this.calmMaterial(obj.material);
        });
      });
    }
    return new Ragdoll(bodies, bounds);
  }

  calmMaterial(material) {
    if (!this.calm) this.calm = new Map();
    if ([...this.calm.values()].includes(material)) return material; // redan lugn
    if (!this.calm.has(material)) {
      const copy = material.clone();
      copy.emissiveIntensity = 0;
      this.calm.set(material, copy);
    }
    return this.calm.get(material);
  }

  // Hugg av en led. Returnerar en ragdoll för den avhuggna delen (eller null).
  sever(joint, velocity, scene, bounds) {
    const segName = JOINT_SEGMENT[joint];
    const seg = segName && this.seg[segName];
    if (!seg || seg.userData.detached) return null;

    // Tyg och kedja som sitter på delen som lossnar slutar röra sig och följer med den
    if (segName === "torso") this.freezeSoft();
    if (["handR", "forearmR", "upperArmR"].includes(segName)) this.freezeSoft("weapon");

    // Blodig stump på kroppen och på den lösa delen
    const parent = seg.parent;
    const stump = this.shape(new THREE.SphereGeometry(0.055, 10, 8), this.m.blood, seg.position.toArray());
    parent.add(stump);
    seg.add(this.shape(new THREE.SphereGeometry(0.05, 10, 8), this.m.blood));
    this.stumps.push({ object: parent, local: seg.position.clone(), time: 0, segName });
    if (LEG_JOINTS.includes(joint)) this.legLoss += 1;
    if (segName === "head") this.shout(1, 99); // munnen står öppen

    return this.makeRagdoll(this.subtree(seg), velocity, scene, bounds, 6);
  }

  // Hela riddaren blir en ragdoll (vid död). Riddaren själv ska inte användas efter detta.
  die(velocity, scene, bounds) {
    if (this.label) this.label.removeFromParent();
    this.removeTrail();
    // Sista ansiktsuttrycket: gapande mun och slutna ögon
    this.mouthTarget = 1;
    this.mouthTimer = 99;
    this.mouthOpen = 0.9;
    this.blinkTimer = -0.05;
    this.dead = true;
    this.updateFace(0);
    this.freezeSoft();
    const ragdoll = this.makeRagdoll(this.subtree(this.seg.pelvis), velocity, scene, bounds, 2, true);
    this.group.removeFromParent();
    return ragdoll;
  }

  // Mitten av en kroppsdel i världen (för blod där träffen landade)
  segmentPosition(segName, target) {
    const seg = this.seg[segName];
    if (!seg || seg.userData.detached) return null;
    this.group.updateMatrixWorld(true);
    const pts = seg.userData.points;
    return target.set(pts[1][0] / 2, pts[1][1] / 2, pts[1][2] / 2).applyMatrix4(seg.matrixWorld);
  }

  // Var blöder stumparna? Anropar callback(position, ålder, riktning) för varje färsk stump.
  // Riktningen pekar utåt från kroppen (åt det håll den avhuggna delen satt).
  forEachBleedingStump(dt, callback) {
    const tmp = new THREE.Vector3();
    const origin = new THREE.Vector3();
    for (const s of this.stumps) {
      s.time += dt;
      if (s.time < 9) { // strålar de första sekunderna, sedan droppar
        tmp.copy(s.local).applyMatrix4(s.object.matrixWorld);
        origin.setFromMatrixPosition(s.object.matrixWorld);
        const dir = tmp.clone().sub(origin).normalize();
        if (dir.lengthSq() < 0.5) dir.set(0, 1, 0);
        callback(tmp, s.time, dir);
      }
    }
  }

  // ---------- Markering av kroppsdelen under siktet ----------

  setHighlight(segName) {
    if (segName === this.highlighted) return;
    // Återställ förra (en avhuggen del har redan fått egna material)
    if (this.highlighted && this.seg[this.highlighted]) {
      const old = this.seg[this.highlighted];
      for (const child of this.ownMeshes(old)) {
        if (child.userData.baseMaterial) {
          if (!old.userData.detached) child.material = child.userData.baseMaterial;
          delete child.userData.baseMaterial;
        }
      }
    }
    this.highlighted = segName;
    const seg = segName && this.seg[segName];
    if (!seg || seg.userData.detached) return;
    if (!this.glowMats) this.glowMats = new Map();
    for (const child of this.ownMeshes(seg)) {
      if (!this.glowMats.has(child.material)) {
        const glow = child.material.clone();
        glow.emissive = new THREE.Color(0xffc23a);
        glow.emissiveIntensity = 0.45;
        this.glowMats.set(child.material, glow);
      }
      child.userData.baseMaterial = child.material;
      child.material = this.glowMats.get(child.material);
    }
  }

  // ---------- Spark och gester ----------

  // Zweihändern bommade ett tungt slag: snurrar runt ett varv och vinglar
  playWhiff() {
    this.spinT = 0;
    this.staggerT = 0;
    this.attack = null;
    this.charging = false;
  }

  // Placering på prispallen (1, 2 eller 3), 0 = vanlig
  playVictory(rank) {
    this.victory = rank;
    this.emote = null;
    this.attack = null;
  }

  playKick() {
    this.kickT = 0;
    this.emote = null;
    this.attack = null;
    this.charging = false;
    this.shout(0.6, 0.25);
  }

  // Huka (håll C)
  setCrouch(on) {
    this.crouching = !!on && !this.legless;
  }

  // Rulla åt ett håll. dirLocal = [x, z] i riddarens egna koordinater (+x = vänster, +z = framåt)
  playRoll(dirLocal) {
    this.rollT = 0;
    this.rollAxis.set(dirLocal[1], 0, -dirLocal[0]);
    if (this.rollAxis.lengthSq() < 0.01) this.rollAxis.set(1, 0, 0);
    this.rollAxis.normalize();
    this.attack = null;
    this.charging = false;
    this.downT = -1;
    this.emote = null;
  }

  // Omsparkad: ramlar på rygg, ligger kvar en stund och reser sig
  playKnockdown() {
    this.downT = 0;
    this.attack = null;
    this.charging = false;
    this.emote = null;
    this.shout(0.9, 0.4);
  }

  // Båda benen borta: sitter på marken resten av rundan
  setLegless() {
    this.legless = true;
    this.crouching = false;
  }

  // 1 = buga, 2 = peka och skratta, 3 = dansa
  playEmote(e) {
    if (!EMOTE_LENGTH[e]) return;
    this.emote = { e, t: 0 };
  }

  get emoting() {
    return this.emote !== null;
  }

  // ---------- Animation varje bildruta ----------
  //
  // motion = { speed, forward, side, airborne }
  //   speed    = fart i meter/sekund
  //   forward  = fart framåt (minus = bakåt) i riddarens egen riktning
  //   side     = fart åt vänster (minus = höger)
  //   airborne = mitt i ett hopp
  //
  // Benen: fotplaneraren bestämmer var fötterna står i världen, och benlösaren
  // räknar ut höft- och knävinklar så att fötterna hamnar exakt där.
  // Resten av kroppen: först räknas en målvinkel för varje led (T), sedan glider lederna dit mjukt.

  animate(dt, motion = { speed: 0, forward: 0, side: 0, airborne: false }) {
    const k = 1 - Math.exp(-dt * 14);     // vanliga rörelser
    const kFast = 1 - Math.exp(-dt * 35); // slag, parering och spark ska vara skarpa
    this.time = (this.time || 0) + dt;
    // Farten i världen (används om riddaren dör i farten: kroppen fortsätter framåt)
    {
      const yaw = this.group.rotation.y;
      const f = motion.forward || 0;
      const sd = motion.side || 0;
      this.lastVel = [f * Math.sin(yaw) + sd * Math.cos(yaw), f * Math.cos(yaw) - sd * Math.sin(yaw)];
    }
    const T = {}; // led -> [x, y, z, hastighet]
    const set = (name, x, y = 0, z = 0, speed = k) => (T[name] = [x, y, z, speed]);
    const legsFree = { L: true, R: true }; // false = benet styrs av en animation i stället för benlösaren

    // Gester avbryts om man börjar röra sig eller slåss
    if (this.emote && (motion.speed > 0.8 || this.attack || this.kickT >= 0 || this.parryT >= 0 || this.charging)) this.emote = null;

    // ----- Gångcykel -----
    // Cykeln går alltid framåt, oavsett åt vilket håll man går (annars spritter benen när man går snett bakåt)
    const speed = motion.airborne ? 0 : motion.speed;
    const run = Math.min(1, Math.max(0, (speed - 3.5) / 2.5)); // 0 = gå, 1 = spring
    const stride = gaitStride(run, motion.forward, motion.side);
    this.stride = stride;
    if (speed > 0.3) this.phase += ((speed * dt) / stride) * Math.PI * 2;
    const targetAmp = Math.min(1, speed / 3.5) * lerp(0.5, 0.8, run);
    this.amp += (targetAmp - this.amp) * (1 - Math.exp(-dt * 8));
    const amp = this.amp;
    const moving = Math.min(1, amp * 2.2); // 0 = stilla (stridsställning), 1 = i rörelse

    // Hur mycket av farten är framåt (+1) eller bakåt (-1)? Jämnas ut så att det inte hoppar.
    const len = Math.hypot(motion.forward, motion.side) || 1;
    const wantFwd = speed > 0.1 ? motion.forward / len : 1;
    this.dirFwd = (this.dirFwd ?? 1) + (wantFwd - (this.dirFwd ?? 1)) * (1 - Math.exp(-dt * 6));
    const dirFwd = this.dirFwd;
    const swing = Math.sin(this.phase) * amp;

    // ----- Höfterna -----
    // Lägre när man står i stridsställning (böjda knän) och när man springer, gungar i takt med stegen
    let pelvisY = lerp(0.95, 0.925 - 0.03 * run, moving) - Math.abs(Math.sin(this.phase)) * 0.025 * amp;
    let pelvisRotY = lerp(-0.22, Math.sin(this.phase) * 0.14 * amp * dirFwd, moving); // stilla: vänster höft fram
    let pelvisRotZ = Math.sin(this.phase) * 0.04 * amp;
    let pelvisZ = 0;
    if (motion.airborne) pelvisY = 0.9;
    if (this.landT >= 0) {
      this.landT += dt;
      if (this.landT > 0.35) this.landT = -1;
      else pelvisY -= Math.sin((this.landT / 0.35) * Math.PI) * 0.12; // knäböj vid landning
    }
    // Hukad: höfterna sänks (benlösaren böjer knäna) och kroppen lutar fram
    this.crouchAmt += ((this.crouching ? 1 : 0) - this.crouchAmt) * Math.min(1, dt * 10);
    pelvisY -= 0.3 * this.crouchAmt;

    // ----- Vapenarmen: stridsställning/gång, laddning eller slag -----
    let pose = STANCE_R.map((v, i) => lerp(v, CARRY_R[i], moving));
    pose[0] -= swing * 0.3 * dirFwd;
    this.chargeAmount += ((this.charging ? 1 : 0) - this.chargeAmount) * Math.min(1, dt * 8);
    const chargePose = movesFor(this.weaponKey).h.arm[0].slice(1);
    pose = pose.map((v, i) => lerp(v, chargePose[i], this.chargeAmount));
    // Zweihändern släpas med spetsen i sanden när man går (och inte gör något annat)
    const dragging = this.weaponKey === "zweihander" && !this.attack && !this.charging && this.parryT < 0 && !this.emote && !this.victory;
    this.dragAmount = (this.dragAmount ?? 0) + (((dragging ? moving : 0)) - (this.dragAmount ?? 0)) * Math.min(1, dt * 5);
    if (this.dragAmount > 0.01) pose = pose.map((v, i) => lerp(v, DRAG_R[i], this.dragAmount));
    let armK = k;
    let lunge = 0;     // extra lutning framåt från slaget
    let attackBend = 0; // kroppen lutar åt sidan i breda svep
    if (this.attack) {
      // Tunga vapen är långsammare: animationen spelas i vapnets takt (samma som servern räknar med)
      this.attack.t += dt / (this.attack.kind === "x" || this.attack.kind === "p" ? 1 : weaponSpec(this.wIndex).speed || 1);
      const move = this.attack.move || movesFor(this.weaponKey).q[0];
      const keys = move.arm;
      if (this.attack.t >= keys[keys.length - 1][0]) {
        this.attack = null;
        if (this.weaponKey === "zweihander") this.wobbleT = 0; // vinglar till efter varje hugg
      } else {
        pose = sampleKeys(keys, this.attack.t);
        armK = kFast;
        // Kroppen följer med: lutar, kliver fram, sjunker ner i tunga slag och lutar i svepen
        const [bLean, bStep, bDip, bBend] = sampleKeys(move.body, this.attack.t);
        lunge = bLean / 0.25;
        pelvisZ = bStep;
        pelvisY -= bDip;
        attackBend = bBend;
        pelvisRotY += pose[3] * 0.5;
      }
    }
    // Tvåhandsvapen: parera genom att lyfta vapnet på tvären
    if (this.twoHanded && this.parryT >= 0) {
      this.parryT += dt;
      if (this.parryT >= PARRY_KEYS[PARRY_KEYS.length - 1][0]) this.parryT = -1;
      else {
        const f = Math.min(1, this.parryT / 0.07, (PARRY_KEYS[PARRY_KEYS.length - 1][0] - this.parryT) / 0.15);
        pose = pose.map((v, i) => lerp(v, PARRY_2H[i], f));
        armK = kFast;
      }
    }
    // Tvåhandsvapen hålls en bit längre ut från kroppen (så armarna får plats framför bröstplåten)
    if (this.twoHanded && !this.attack && this.parryT < 0 && this.dragAmount < 0.5) {
      pose = [pose[0] - 0.12, pose[1] + 0.32, Math.min(-0.45, pose[2] + 0.15), pose[3], pose[4]];
    }
    set("upperArmR", pose[0], 0, pose[1], armK);
    set("forearmR", pose[2], 0, 0, armK);
    set("handR", pose[4], 0, 0, armK);

    // ----- Sköldarmen: stridsställning/gång eller parering -----
    let shield = STANCE_L.map((v, i) => lerp(v, CARRY_L[i], moving));
    shield[0] += swing * 0.15 * dirFwd;
    let shieldK = k;
    if (this.parryT >= 0 && !this.twoHanded) {
      this.parryT += dt;
      if (this.parryT >= PARRY_KEYS[PARRY_KEYS.length - 1][0]) this.parryT = -1;
      else {
        shield = sampleKeys(PARRY_KEYS, this.parryT);
        shieldK = kFast;
      }
    }
    if (motion.airborne) shield = [shield[0] - 0.3, shield[1] - 0.2, shield[2]];
    set("upperArmL", shield[0], 0, shield[1], shieldK);
    set("forearmL", shield[2], 0, 0, shieldK);

    // ----- Brottning -----
    let grabLean = 0;
    if (this.grab) {
      this.grabT = (this.grabT || 0) + dt;
      if (this.grab === "reach" && this.grabT > 0.4) this.grab = null;
    }
    if (this.struggleT >= 0) {
      this.struggleT += dt;
      if (this.struggleT > 0.25) this.struggleT = -1;
    }
    if (this.grab === "hold" || this.grab === "reach") {
      // Båda armarna fram och in, som om man håller i motståndarens axlar
      const f = this.grab === "reach" ? Math.sin(Math.min(1, this.grabT / 0.4) * Math.PI) : Math.min(1, this.grabT / 0.15);
      const tug = this.grab === "hold" ? Math.sin(this.time * 9) * 0.06 : 0;
      for (const side of ["L", "R"]) {
        const sx = side === "L" ? 1 : -1;
        set("upperArm" + side, lerp(-0.4, -1.25 + tug, f), 0, lerp(0, -0.25 * sx, f), kFast);
        set("forearm" + side, lerp(-1.2, -0.55, f), 0, 0, kFast);
      }
      grabLean = 0.18 * f;
    } else if (this.grab === "held") {
      // Fasthållen: armarna trycker mot den andra och kroppen lutar bakåt; ryck när man sliter
      const jerk = this.struggleT >= 0 ? Math.sin((this.struggleT / 0.25) * Math.PI) : 0;
      const wob = Math.sin(this.time * 7);
      set("upperArmL", -1.0 - jerk * 0.5 + wob * 0.1, 0, 0.35 + jerk * 0.3, kFast);
      set("forearmL", -1.4, 0, 0, kFast);
      set("upperArmR", -1.1 - jerk * 0.4 - wob * 0.1, 0, -0.35 - jerk * 0.3, kFast);
      set("forearmR", -1.3, 0, 0, kFast);
      grabLean = -0.2 - jerk * 0.15;
    }

    // ----- Bålen: lutar in i rörelsen, motvrids mot höfterna, andas -----
    let lean = 0.06 * moving + 0.1 * run * dirFwd + Math.sin(this.time * 2.0) * 0.012 + (1 - moving) * 0.05 + lunge * 0.25 + this.crouchAmt * 0.28;
    let torsoZ = attackBend;
    lean += grabLean;
    if (this.twoHanded && !this.attack) lean += 0.04;
    // Zweihändern: vinglar till efter varje hugg
    if (this.wobbleT >= 0) {
      this.wobbleT += dt;
      if (this.wobbleT > 0.9) this.wobbleT = -1;
      else torsoZ += Math.sin(this.wobbleT * 14) * 0.12 * (1 - this.wobbleT / 0.9);
    }
    if (this.staggerT >= 0) {
      this.staggerT += dt;
      const d = COMBAT.parry.stagger;
      if (this.staggerT >= d) this.staggerT = -1;
      else lean -= 0.4 * Math.sin((this.staggerT / d) * Math.PI);
    }
    // Träff: rycker till bort från slaget
    let headX = null;
    let headZ = 0;
    if (this.hitT >= 0) {
      this.hitT += dt;
      if (this.hitT > 0.35) this.hitT = -1;
      else {
        const f = Math.sin((this.hitT / 0.35) * Math.PI) * (1 - this.hitT / 0.35 * 0.3);
        lean -= this.hitDir[1] * 0.35 * f; // slag framifrån: bakåt
        torsoZ -= this.hitDir[0] * 0.3 * f; // slag från sidan: åt andra hållet
        headX = -this.hitDir[1] * 0.4 * f;
        headZ = -this.hitDir[0] * 0.4 * f;
      }
    }
    const counter = -Math.sin(this.phase) * 0.12 * amp * dirFwd;
    let torsoY = pose[3] + counter - pelvisRotY * 0.6; // bålen vänds tillbaka mot motståndaren

    // ----- Spark med höger ben -----
    if (this.kickT >= 0) {
      this.kickT += dt;
      if (this.kickT >= KICK_KEYS[KICK_KEYS.length - 1][0]) this.kickT = -1;
      else {
        const [thighX, kneeX, kickLean] = sampleKeys(KICK_KEYS, this.kickT);
        set("thighR", thighX, 0, -0.05, kFast);
        set("shinR", kneeX, 0, 0, kFast);
        set("footR", 0.3, 0, 0, kFast);
        legsFree.R = false;
        lean += kickLean;
        set("upperArmL", -0.6, 0, 0.5, kFast);
      }
    }

    // ----- Hån-gester -----
    if (this.emote) {
      this.emote.t += dt;
      const t = this.emote.t;
      const len = EMOTE_LENGTH[this.emote.e];
      if (t >= len) {
        this.emote = null;
      } else {
        const w = Math.min(1, t / 0.25, (len - t) / 0.3);
        const mix = (from, to) => lerp(from, to, w);
        if (this.emote.e === 1) {
          // Buga djupt med vapnet utsträckt åt sidan
          lean = mix(lean, 0.85);
          headX = mix(0, 0.35);
          pelvisRotY = mix(pelvisRotY, 0);
          set("upperArmR", mix(pose[0], -0.5), 0, mix(pose[1], -1.1));
          set("forearmR", mix(pose[2], -0.2));
          set("upperArmL", mix(shield[0], 0.2), 0, mix(shield[1], 0.3));
          set("forearmL", mix(shield[2], -1.6));
        } else if (this.emote.e === 2) {
          // Peka med vapnet och skaka av skratt (munnen öppnas i takt med skrattet)
          const shake = Math.sin(t * 22) * 0.07;
          lean = mix(lean, -0.22 + shake);
          headX = mix(0, -0.35 + shake * 1.5);
          set("upperArmR", mix(pose[0], -1.5), 0, mix(pose[1], 0), kFast);
          set("forearmR", mix(pose[2], -0.05), 0, 0, kFast);
          set("handR", mix(pose[4], 1.0), 0, 0, kFast);
          set("upperArmL", mix(shield[0], -0.2), 0, mix(shield[1], -0.2));
          set("forearmL", mix(shield[2], -2.0));
          pelvisY += Math.abs(shake) * 0.3 * w;
          this.shout(0.45 + Math.abs(Math.sin(t * 11)) * 0.5, 0.05);
        } else {
          // Dansa: armarna i luften, knäna upp växelvis, höfterna vickar
          const beat = t * 7;
          const upL = Math.max(0, Math.sin(beat));
          const upR = Math.max(0, -Math.sin(beat));
          set("upperArmR", mix(pose[0], -2.7 + Math.sin(beat) * 0.3), 0, mix(pose[1], -0.4));
          set("forearmR", mix(pose[2], -0.4));
          set("upperArmL", mix(shield[0], -2.7 - Math.sin(beat) * 0.3), 0, mix(shield[1], 0.4));
          set("forearmL", mix(shield[2], -0.4));
          set("thighL", mix(-0.04, -upL * 1.0));
          set("shinL", mix(0.08, upL * 1.4));
          set("thighR", mix(-0.04, -upR * 1.0));
          set("shinR", mix(0.08, upR * 1.4));
          legsFree.L = legsFree.R = false;
          pelvisRotY = mix(pelvisRotY, 0);
          pelvisRotZ = mix(pelvisRotZ, Math.sin(beat * 0.5) * 0.2);
          pelvisY = mix(pelvisY, 0.97 + Math.abs(Math.sin(beat)) * 0.06);
          torsoY = mix(torsoY, Math.sin(beat * 0.5) * 0.35);
          headX = mix(0, Math.sin(beat) * 0.15);
          this.shout(0.5, 0.05);
        }
      }
    }

    // ----- Prispallen: ettan jublar med vapnet i luften, tvåan bugar, trean klappar -----
    if (this.victory) {
      const t = this.time;
      if (this.victory === 1) {
        const pump = Math.sin(t * 6);
        set("upperArmR", -2.9 + pump * 0.15, 0, -0.25, kFast);
        set("forearmR", -0.25, 0, 0, kFast);
        set("handR", 0.4, 0, 0, kFast);
        if (!this.twoHanded) {
          set("upperArmL", -2.7 - pump * 0.15, 0, 0.35, kFast);
          set("forearmL", -0.3, 0, 0, kFast);
        }
        pelvisY += Math.max(0, Math.sin(t * 6)) * 0.07;
        lean = -0.15;
        headX = -0.3;
        this.shout(0.8, 0.1);
      } else if (this.victory === 2) {
        const bow = Math.max(0, Math.sin(t * 1.6));
        lean = 0.1 + bow * 0.6;
        headX = 0.2 + bow * 0.25;
        set("upperArmR", lerp(-0.6, -0.3, bow), 0, lerp(-0.2, -1.1, bow));
        set("forearmR", -0.5);
        if (!this.twoHanded) {
          set("upperArmL", lerp(-0.3, 0.2, bow), 0, 0.3);
          set("forearmL", -1.4);
        }
      } else {
        const clap = Math.abs(Math.sin(t * 10)) * 0.4;
        set("upperArmR", -1.25, 0, -0.1 - clap, kFast);
        set("forearmR", -0.5, 0, 0, kFast);
        set("upperArmL", -1.25, 0, 0.1 + clap, kFast);
        set("forearmL", -0.5, 0, 0, kFast);
        this.shout(0.4, 0.1);
      }
      torsoY = 0;
      pelvisRotY = 0;
    }

    // ----- Zweihändern: ett tungt slag som missar får riddaren att snurra ett varv -----
    let spin = 0;
    if (this.spinT >= 0) {
      this.spinT += dt;
      const f = Math.min(1, this.spinT / 0.8);
      spin = f * f * (3 - 2 * f) * Math.PI * 2;
      lean += Math.sin(f * Math.PI) * 0.3;
      for (const side of ["L", "R"]) {
        set("thigh" + side, -0.15, 0, side === "L" ? 0.08 : -0.08, kFast);
        set("shin" + side, 0.3, 0, 0, kFast);
        set("foot" + side, -0.15, 0, 0, kFast);
        legsFree[side] = false; // fötterna snurrar med (komiskt)
      }
      if (f >= 1) {
        this.spinT = -1;
        this.feet.reset([this.group.position.x, this.group.position.y, this.group.position.z], this.group.rotation.y);
      }
    }

    // ----- Rullning: kroppen kröker ihop sig och snurrar ett varv runt sig själv -----
    let rollAngle = 0;
    let rollAmt = 0;
    if (this.rollT >= 0) {
      this.rollT += dt;
      const f = Math.min(1, this.rollT / COMBAT.roll.time);
      rollAngle = f * f * (3 - 2 * f) * Math.PI * 2;
      rollAmt = Math.sin(f * Math.PI);
      const tuck = Math.min(1, rollAmt * 1.8);
      lean = lerp(lean, 1.15, tuck);
      headX = lerp(headX ?? 0, 0.6, tuck);
      for (const side of ["L", "R"]) {
        set("thigh" + side, lerp(-0.1, -1.7, tuck), 0, 0, kFast);
        set("shin" + side, lerp(0.2, 2.2, tuck), 0, 0, kFast);
        set("foot" + side, 0.3, 0, 0, kFast);
        legsFree[side] = false;
        set("upperArm" + side, lerp(-0.4, -1.1, tuck), 0, side === "L" ? 0.2 : -0.2, kFast);
        set("forearm" + side, -1.7, 0, 0, kFast);
      }
      if (f >= 1) {
        this.rollT = -1;
        this.feet.reset([this.group.position.x, this.group.position.y, this.group.position.z], this.group.rotation.y);
      }
    }

    // ----- Omsparkad: faller på rygg, ligger en stund, reser sig -----
    let downAmt = 0;
    if (this.downT >= 0) {
      this.downT += dt;
      const D = COMBAT.down.time;
      const smooth = (x) => x * x * (3 - 2 * x);
      if (this.downT < 0.25) downAmt = smooth(this.downT / 0.25);
      else if (this.downT < D) downAmt = 1;
      else if (this.downT < D + 0.45) downAmt = 1 - smooth((this.downT - D) / 0.45);
      else {
        this.downT = -1;
        this.feet.reset([this.group.position.x, this.group.position.y, this.group.position.z], this.group.rotation.y);
      }
      if (downAmt > 0) {
        lean = lerp(lean, -0.15, downAmt);
        headX = lerp(headX ?? 0, 0.35, downAmt); // lyfter huvudet från marken
        for (const side of ["L", "R"]) {
          const sx = side === "L" ? 1 : -1;
          set("thigh" + side, lerp(-0.1, -0.35 - (side === "L" ? 0.25 : 0), downAmt), 0, 0.18 * sx * downAmt, kFast);
          set("shin" + side, lerp(0.2, side === "L" ? 0.9 : 0.35, downAmt), 0, 0, kFast);
          set("foot" + side, 0.2, 0, 0, kFast);
          if (downAmt > 0.3) legsFree[side] = false;
          set("upperArm" + side, lerp(-0.4, -0.5, downAmt), 0, lerp(0.15, 1.15, downAmt) * sx, kFast);
          set("forearm" + side, -0.4, 0, 0, kFast);
        }
      }
    }

    // ----- Utan ben: sitter på marken med stumparna rakt fram -----
    this.sitAmt += ((this.legless ? 1 : 0) - this.sitAmt) * Math.min(1, dt * 6);
    if (this.sitAmt > 0.01) {
      pelvisY = lerp(pelvisY, 0.2, this.sitAmt);
      lean += 0.12 * this.sitAmt;
      for (const side of ["L", "R"]) {
        set("thigh" + side, -1.45, 0, side === "L" ? 0.15 : -0.15, k);
        set("shin" + side, 0.15, 0, 0, k);
        set("foot" + side, 0, 0, 0, k);
        legsFree[side] = false;
      }
    }

    set("torso", lean, torsoY, torsoZ, this.attack || this.kickT >= 0 || rollAmt > 0 ? kFast : k);
    set("head", headX ?? -lean * 0.5, -torsoY * 0.5 - pelvisRotY * 0.3, headZ);

    // ----- Flytta överkroppens leder mjukt mot målen -----
    for (const name in T) {
      if (name.startsWith("thigh") || name.startsWith("shin") || name.startsWith("foot")) continue;
      this.easeJoint(name, T[name]);
    }
    const pelvis = this.seg.pelvis;
    if (!pelvis.userData.detached) {
      pelvis.position.y += (pelvisY - pelvis.position.y) * k;
      pelvis.position.z += (pelvisZ - pelvis.position.z) * kFast;
      pelvis.rotation.y += (pelvisRotY - pelvis.rotation.y) * k;
      pelvis.rotation.z += (pelvisRotZ - pelvis.rotation.z) * k;
      if (spin) pelvis.rotation.y = pelvisRotY + spin;
      // Rullningen och fallet styr höfterna direkt
      if (this.rollT >= 0) {
        pelvis.position.y = lerp(pelvisY, 0.5, rollAmt);
        pelvis.quaternion.setFromAxisAngle(this.rollAxis, rollAngle);
        this.wasRolling = true;
      } else if (this.wasRolling) {
        this.wasRolling = false;
        pelvis.rotation.set(0, pelvisRotY, pelvisRotZ);
      }
      if (downAmt > 0 && this.rollT < 0) {
        pelvis.rotation.x = -1.45 * downAmt;
        pelvis.position.y = lerp(pelvisY, 0.17, downAmt);
      } else if (this.rollT < 0 && pelvis.rotation.x !== 0) {
        pelvis.rotation.x *= 1 - k;
        if (Math.abs(pelvis.rotation.x) < 0.001) pelvis.rotation.x = 0;
      }
    }

    // Plymen vajar bakåt när man går framåt och svänger lite i vinden
    if (this.plume) {
      const want = -0.1 - motion.forward * 0.05 - (this.attack ? 0.25 : 0) + Math.sin(this.time * 2.7) * 0.05;
      this.plumeX = (this.plumeX ?? 0) + (want - (this.plumeX ?? 0)) * Math.min(1, dt * 6);
      this.plume.rotation.x = this.plumeX;
      this.plume.rotation.z = motion.side * 0.04 + Math.sin(this.time * 1.9) * 0.04;
    }

    // ----- Tvåhandsvapen: vänster hand håller greppet (armen räknas ut så att handen hamnar där) -----
    const freeLeft = this.emote || this.victory === 3 || this.victory === 2 || this.dragAmount > 0.5 || this.kickT >= 0 || this.rollT >= 0 || downAmt > 0.3 || this.grab;
    if (this.twoHanded && !freeLeft && !this.seg.handL.userData.detached && !this.seg.handR.userData.detached && this.weapon.userData.grip2) {
      const g = this.weapon.userData.grip2;
      this.ikLeft = true;
      // Först höger arm ut ur bröstet (den håller vapnet), sedan räknas vänster arm efter greppet
      this.keepArmsOut(["R"]);
      this.solveLeftGrip(g);
    } else {
      this.ikLeft = false;
    }
    // Armarna får inte gå in i bröstet: knuffas ut åt sidan eller fram om de gör det
    this.keepArmsOut(this.ikLeft ? ["R"] : ["L", "R"]);

    // ----- Benen -----
    this.animateLegs(dt, motion, T, legsFree, k);

    // Zweihänderns spets som släpar i sanden lämnar damm efter sig
    if (this.dragAmount > 0.6 && motion.speed > 1 && this.onWeaponDrag) {
      this.dragTimer = (this.dragTimer || 0) + dt;
      if (this.dragTimer > 0.12) {
        this.dragTimer = 0;
        this.weapon.updateWorldMatrix(true, false);
        const t = this.weapon.userData.trail.tip;
        _v.set(t[0], t[1], t[2]).applyMatrix4(this.weapon.matrixWorld);
        if (_v.y < this.groundY + 0.25) this.onWeaponDrag(_v.x, _v.z);
      }
    }

    // ----- Ansiktet, tyget och kedjan -----
    this.updateFace(dt);
    this.updateSoft(dt);

    // ----- Röd blinkning vid träff -----
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    const glow = this.flashT / 0.2;
    for (const mat of this.materials) {
      if (mat.emissive) mat.emissiveIntensity = glow;
    }
  }

  // Vänster hand på tvåhandsvapnets skaft: armbågen ska peka utåt och nedåt (inte in i bröstet).
  // Prövar några vridningar av armen runt linjen axel–hand, och låter handen glida längre ut
  // på skaftet om armen ändå skulle gå in i kroppen.
  solveLeftGrip(grip) {
    const upper = this.seg.upperArmL;
    const fore = this.seg.forearmL;
    const torso = this.seg.torso;
    const body = this.chestBody;
    const ex = body.rx + body.ar;
    const ez = body.rz + body.ar;
    const inside = (p) => (p.y < 0.02 || p.y > body.top ? 0 : Math.max(0, 1 - Math.hypot(p.x / ex, p.z / ez)));
    let best = null;
    const reach = this.armLen[0] + this.armLen[1] - 0.005;
    // Handen kan glida längs skaftet: närmare höger hand (når lättare) eller längre bort (armen går fri från kroppen)
    for (const slide of [0, 0.08, 0.16, -0.1, -0.2]) {
      if (grip[1] + slide > -0.13) continue;
      this.group.updateMatrixWorld(true);
      _v.set(grip[0], grip[1] + slide, grip[2]).applyMatrix4(this.weapon.matrixWorld);
      _inv.copy(torso.matrixWorld).invert();
      _v.applyMatrix4(_inv).sub(upper.position);
      const target = _v.clone();
      const { upperX, upperZ, elbow } = solveArm([target.x, target.y, target.z], this.armLen[0], this.armLen[1]);
      const base = _q.setFromEuler(new THREE.Euler(upperX, 0, upperZ));
      const axis = target.clone().normalize();
      for (const turn of [0, 0.35, -0.35, 0.7, -0.7, 1.0]) {
        const q = _q2.setFromAxisAngle(axis, turn).multiply(base);
        // armbågens och underarmens läge (i bålens mått)
        const elbowP = _mid.set(0, -this.armLen[0], 0).applyQuaternion(q).add(upper.position);
        const foreQ = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(_xAxis, elbow));
        const midP = new THREE.Vector3(0, -this.armLen[1] * 0.5, 0).applyQuaternion(foreQ).add(elbowP);
        const pen = inside(elbowP) + inside(midP);
        // poäng: inte i kroppen, armbågen utåt (vänster = +x) och lite nedåt, så lite vridning som möjligt
        const miss = Math.max(0, target.length() - reach); // når inte ända fram
        const score = pen * 10 + miss * 25 - (elbowP.x - upper.position.x) * 2 + Math.abs(turn) * 0.15 + Math.abs(slide) * 0.6;
        if (!best || score < best.score) best = { score, q: q.clone(), elbow, pen, miss };
      }
      if (best && best.pen === 0 && best.miss === 0) break;
    }
    upper.quaternion.copy(best.q);
    fore.rotation.set(best.elbow, 0, 0);
  }

  keepArmsOut(sides = ["L", "R"]) {
    const body = this.chestBody;
    const torso = this.seg.torso;
    if (!body || torso.userData.detached || this.dead) return;
    this.group.updateMatrixWorld(true);
    _inv.copy(torso.matrixWorld).invert();
    const ex = body.rx + body.ar;
    const ez = body.rz + body.ar;
    const probe = (seg, out) => out.setFromMatrixPosition(seg.matrixWorld).applyMatrix4(_inv);
    for (const side of sides) {
      const upper = this.seg["upperArm" + side];
      const fore = this.seg["forearm" + side];
      const hand = this.seg["hand" + side];
      if (upper.userData.detached || fore.userData.detached) continue;
      const s = side === "L" ? 1 : -1;
      for (let iter = 0; iter < 3; iter++) {
        probe(upper, _v2);
        let worst = 0;
        let gx = 0;
        let gz = 0;
        let lever = 0.3;
        const test = (p) => {
          if (p.y < 0.02 || p.y > body.top) return;
          const d = Math.hypot(p.x / ex, p.z / ez);
          if (d < 1 && 1 - d > worst) {
            worst = 1 - d;
            gx = p.x / (ex * ex);
            gz = p.z / (ez * ez);
            lever = Math.max(0.15, p.distanceTo(_v2));
          }
        };
        probe(fore, _v);
        test(_v);
        if (!hand.userData.detached) {
          probe(hand, _mid);
          test(_mid);
          test(_v.lerp(_mid, 0.5));
        }
        if (worst < 0.004) break;
        const push = Math.min(0.5, (worst * ex) / lever + 0.01);
        if (Math.abs(gx) * ex >= Math.abs(gz) * ez && gx * s > 0) upper.rotation.z += push * s; // ut åt sidan
        else if (gz >= 0) upper.rotation.x -= push; // fram (framför bröstet)
        else upper.rotation.x += push;              // bak
        upper.updateMatrixWorld(true);
      }
    }
  }

  easeJoint(name, [x, y, z, sp]) {
    const seg = this.seg[name];
    if (!seg || seg.userData.detached) return;
    seg.rotation.x += (x - seg.rotation.x) * sp;
    seg.rotation.y += (y - seg.rotation.y) * sp;
    seg.rotation.z += (z - seg.rotation.z) * sp;
  }

  animateLegs(dt, motion, T, legsFree, k) {
    const yaw = this.group.rotation.y;
    const pos = this.group.position;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // Farten i världen (motion är i riddarens egna koordinater)
    const vx = motion.forward * s + motion.side * c;
    const vz = motion.forward * c - motion.side * s;

    if (motion.airborne) {
      // I luften: knäna dras upp
      this.easeJoint("thighL", [-0.55, 0, 0.05, k]);
      this.easeJoint("thighR", [-0.35, 0, -0.05, k]);
      this.easeJoint("shinL", [0.9, 0, 0, k]);
      this.easeJoint("shinR", [0.7, 0, 0, k]);
      this.easeJoint("footL", [-0.2, 0, 0, k]);
      this.easeJoint("footR", [-0.2, 0, 0, k]);
      this.wasAirborne = true;
      return;
    }
    if (this.wasAirborne) {
      this.wasAirborne = false;
      this.feet.reset([pos.x, pos.y, pos.z], yaw); // landa med fötterna under kroppen
    }

    const run = Math.min(1, Math.max(0, (motion.speed - 3.5) / 2.5));
    const feet = this.feet.update(dt, [pos.x, pos.y, pos.z], yaw, [vx, vz], this.phase, run, (side, spot) => {
      this.onFootstep?.(side, spot, yaw);
    }, this.stride);

    // Höftledernas position i världen
    const pelvis = this.seg.pelvis;
    const hipYaw = yaw + pelvis.rotation.y;
    const hc = Math.cos(hipYaw);
    const hs = Math.sin(hipYaw);
    const pelvisWorld = [
      pos.x + pelvis.position.z * s,
      pos.y + pelvis.position.y,
      pos.z + pelvis.position.z * c,
    ];

    for (const side of ["L", "R"]) {
      if (!legsFree[side]) {
        for (const part of ["thigh", "shin", "foot"]) if (T[part + side]) this.easeJoint(part + side, T[part + side]);
        continue;
      }
      const sx = side === "L" ? 0.1 : -0.1;
      const hip = [pelvisWorld[0] + sx * hc, pelvisWorld[1] - 0.08, pelvisWorld[2] - sx * hs];
      const foot = feet[side];
      const pitch = side === "L" ? feet.pitchL : feet.pitchR;
      // Fotleden sitter 0,1 m ovanför sulan; när hälen lyfts höjs den lite
      const ankle = [foot[0], foot[1] + this.groundY + 0.1 + Math.max(0, pitch) * 0.07, foot[2]];
      const dx = ankle[0] - hip[0];
      const dy = ankle[1] - hip[1];
      const dz = ankle[2] - hip[2];
      // Till höftens egna koordinater (x = vänster, z = framåt)
      const local = [dx * hc - dz * hs, dy, dx * hs + dz * hc];
      const { hipX, hipZ, knee } = solveLeg(local);
      const legK = 1 - Math.exp(-dt * 30);
      this.easeJoint("thigh" + side, [hipX, 0, hipZ, legK]);
      this.easeJoint("shin" + side, [knee, 0, 0, legK]);
      // Foten hålls plan mot marken (plus häl- och tårörelse)
      this.easeJoint("foot" + side, [-(hipX + knee) + pitch, 0, -hipZ, legK]);
    }
  }

  dispose() {
    this.removeTrail();
    this.group.traverse((obj) => {
      if (obj.isMesh && obj.geometry) obj.geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
    if (this.labelTexture) this.labelTexture.dispose();
    this.group.removeFromParent();
  }
}
