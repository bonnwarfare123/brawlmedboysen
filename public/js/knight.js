// RIDDAREN – formade lemmar, rustning i enskilda delar och riktiga leder.
// Riddaren tittar mot +Z. Origo (0,0,0) är mellan fötterna. Längd ca 1,8 m.
//
// Kroppen består av 15 delar som sitter ihop i leder:
//
//   pelvis (höfter)
//    ├ torso (bål)            ← midja
//    │  ├ head (huvud)        ← hals
//    │  ├ upperArmL/R         ← axel
//    │  │  └ forearmL/R       ← armbåge
//    │  │     └ handL/R       ← handled   (sköld i vänster, svärd i höger)
//    ├ thighL/R (lår)         ← höft
//    │  └ shinL/R (underben)  ← knä
//    │     └ footL/R (fot)    ← fotled
//
// Varje led kan huggas av. Då blir delen (och allt som sitter längre ut)
// en egen ragdoll som flyger iväg.
//
// Utseendet väljs med look = { a: rustning, h: hjälm, s: sköld } (se listorna i shared.js).
// Benen styrs av en benlösare (ik.js) så att fötterna står stadigt på marken.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { COMBAT, JOINT_SEGMENT, LEG_JOINTS } from "./shared.js";
import { Ragdoll } from "./ragdoll.js";
import { FootPlanner, solveLeg } from "./ik.js";
import {
  chainmailTexture, leatherTexture, quiltTexture, wrapTexture, strawTexture, metalWearTexture, heraldryTexture,
} from "./textures.js";

const VISOR = 0x15151a;
const BLOOD = 0x6a0808;
const SKIN = [0xf0c8a0, 0xd9a878, 0xb98058, 0x8a5a3a];

// Omgivning som blank metall speglar (sätts av spelet, se setEnvironment)
let ENVIRONMENT = null;
export function setEnvironment(texture) {
  ENVIRONMENT = texture;
}

let bloodDecalMaterial = null;
function bloodDecal() {
  if (!bloodDecalMaterial) {
    bloodDecalMaterial = new THREE.MeshStandardMaterial({
      color: BLOOD, roughness: 0.25, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -4,
    });
  }
  return bloodDecalMaterial;
}

// ---------- Formade lemmar ----------
// Profil = [andel av längden, radie]. Snurras runt sin axel till en rund, formad lem.
const PROFILE = {
  thigh: [[0, 0.082], [0.12, 0.09], [0.5, 0.079], [0.85, 0.062], [1, 0.057]],
  shin: [[0, 0.058], [0.2, 0.067], [0.42, 0.064], [0.78, 0.046], [1, 0.041]],
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
function latheAlong(profile, length, from = 0, to = 1, extra = 0, closed = true, flare = 0) {
  const pts = [];
  const steps = 8;
  if (closed) pts.push(new THREE.Vector2(0.0001, -from * length));
  for (let i = 0; i <= steps; i++) {
    const f = from + ((to - from) * i) / steps;
    let r = radiusAt(profile, f) + extra;
    if (flare && (i === 0 || i === steps)) r += flare; // utvikt kant på plåten
    pts.push(new THREE.Vector2(r, -f * length));
  }
  if (closed) pts.push(new THREE.Vector2(0.0001, -to * length));
  return new THREE.LatheGeometry(pts, 14);
}

// Rustningarna: material för varje del
const ARMOR_STYLES = [
  { key: "plate" },   // Plåtrustning
  { key: "chain" },   // Ringbrynja
  { key: "leather" }, // Läderrustning
  { key: "gilded" },  // Praktrustning
  { key: "peasant" }, // Bonde
];

// Rörelsekurvor för svärdsarmen:
// [tid, överarm framåt, överarm i sidled, underarm böj, bålens vridning, handled]
const STANCE_R = [-0.55, -0.12, -1.25, 0.12, 0.35]; // stridsställning: svärdet redo
const CARRY_R = [-0.25, 0, -0.75, 0, 0.1];          // när man går: armen mer avslappnad
const QUICK_KEYS = [
  [0.0, -0.55, -0.12, -1.25, 0.12, 0.35],
  [0.12, -2.4, -0.4, -1.0, -0.45, 0],
  [0.3, -0.6, 0.3, -0.2, 0.45, 0],
  [0.5, -0.55, -0.12, -1.25, 0.12, 0.35],
];
const HEAVY_KEYS = [
  [0.0, -2.9, 0.0, -0.6, -0.3, 0],
  [0.15, -3.0, 0.0, -0.7, -0.4, 0],
  [0.32, -0.5, 0.0, -0.1, 0.45, 0],
  [0.7, -0.55, -0.12, -1.25, 0.12, 0.35],
];
const THRUST_KEYS = [
  [0.0, -0.55, -0.12, -1.25, 0.12, 0.35],
  [0.1, -0.7, -0.25, -1.7, -0.45, 0.65],
  [0.22, -1.45, 0.0, -0.05, 0.45, 1.0],
  [0.32, -1.45, 0.0, -0.05, 0.4, 1.0],
  [0.5, -0.55, -0.12, -1.25, 0.12, 0.35],
];
const CHARGE_POSE = [-2.9, 0, -0.6, -0.3, 0];
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

export class Knight {
  constructor(colorHex, name = null, look = { a: 0, h: 0, s: 0 }) {
    this.group = new THREE.Group();
    this.materials = [];
    this.seg = {};
    this.stumps = [];
    this.legLoss = 0;
    this.bloodSplats = 0;
    this.swordBlood = 0;

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

    const style = (ARMOR_STYLES[look.a] || ARMOR_STYLES[0]).key;
    this.style = style;
    const skinColor = SKIN[Math.abs(Math.floor(colorHex / 7)) % SKIN.length];
    const isPlate = style === "plate" || style === "gilded";
    const gilded = style === "gilded";

    // ---------- Material ----------
    const m = {};
    m.cloth = this.mat(colorHex, 0.85, 0);
    m.cloth.side = THREE.DoubleSide; // kjolar och mantlar är öppna
    m.herald = this.mat(0xffffff, 0.8, 0, { map: heraldryTexture(colorHex) });
    m.steel = gilded ? this.mat(0xd2d8e0, 0.2, 0.92, { roughnessMap: metalWearTexture() }) : this.mat(0xa2a9b2, 0.32, 0.85, { roughnessMap: metalWearTexture() });
    m.steelDark = this.mat(0x5e646d, 0.4, 0.75);
    m.gold = this.mat(0xd4a83a, 0.28, 0.9);
    m.brass = this.mat(0xb8893a, 0.35, 0.85);
    m.chain = this.mat(0xb8bec6, 0.45, 0.8, { map: chainmailTexture(), bumpMap: chainmailTexture(), bumpScale: 2 });
    m.leather = this.mat(0x7a5230, 0.75, 0, { map: leatherTexture() });
    m.leatherDark = this.mat(0x4a2e1a, 0.8, 0, { map: leatherTexture() });
    m.wool = this.mat(0x5a4632, 0.95, 0, { map: wrapTexture() });
    m.quilt = this.mat(0xd8c8a0, 0.95, 0, { map: quiltTexture() });
    m.straw = this.mat(0xffffff, 0.9, 0, { map: strawTexture() });
    m.rope = this.mat(0xa08850, 0.95, 0);
    m.skin = this.mat(skinColor, 0.75, 0);
    m.visor = this.mat(VISOR, 0.6, 0.2);
    m.white = this.mat(0xf2efe6, 0.8, 0);
    m.blade = this.mat(0xd8dde3, 0.18, 0.95);
    m.wood = this.mat(0x6a4a2c, 0.85, 0);
    m.blood = this.mat(BLOOD, 0.4, 0.1);
    m.trim = gilded ? m.gold : m.brass;
    this.m = m;

    // Vad lemmarna består av under plåten
    const limbMat = { plate: m.chain, gilded: m.chain, chain: m.chain, leather: m.leather, peasant: m.quilt }[style];
    const legMat = { plate: m.chain, gilded: m.chain, chain: m.chain, leather: m.wool, peasant: m.wool }[style];

    // ---------- Kroppsdelarna ----------
    // segment(namn, förälder, ledens position, punkter för fysiken, radie)

    const pelvis = this.segment("pelvis", this.group, [0, 1.0, 0], [[0, 0, 0], [0.1, -0.08, 0], [-0.1, -0.08, 0]], 0.1);
    const torso = this.segment("torso", pelvis, [0, 0, 0], [[0, 0, 0], [0, 0.44, 0], [0.19, 0.4, 0], [-0.19, 0.4, 0], [0, 0.25, 0.12]], 0.13);
    const head = this.segment("head", torso, [0, 0.46, 0], [[0, 0, 0], [0, 0.28, 0], [0, 0.12, 0.12]], 0.12);

    this.buildTorso(pelvis, torso, style, m, isPlate, gilded);
    this.buildHelmet(head, look.h, m, gilded);

    for (const side of ["L", "R"]) {
      const s = side === "L" ? 1 : -1;
      const upper = this.segment("upperArm" + side, torso, [0.2 * s, 0.41, 0], [[0, 0, 0], [0, -0.29, 0], [0.05 * s, -0.14, 0]], 0.055);
      const fore = this.segment("forearm" + side, upper, [0, -0.29, 0], [[0, 0, 0], [0, -0.26, 0], [0.05 * s, -0.13, 0]], 0.05);
      const hand = this.segment("hand" + side, fore, [0, -0.26, 0], [[0, 0, 0], [0, -0.1, 0], [0.04 * s, -0.05, 0]], 0.045);
      const thigh = this.segment("thigh" + side, pelvis, [0.1 * s, -0.08, 0], [[0, 0, 0], [0, -0.42, 0], [0.06 * s, -0.21, 0]], 0.075);
      const shin = this.segment("shin" + side, thigh, [0, -0.42, 0], [[0, 0, 0], [0, -0.4, 0], [0.05 * s, -0.2, 0]], 0.06);
      const foot = this.segment("foot" + side, shin, [0, -0.4, 0], [[0, 0, 0], [0, -0.06, 0.18], [0.05 * s, -0.06, 0]], 0.05);

      // Lemmarna under rustningen (formade, inte rör)
      upper.add(this.shape(latheAlong(PROFILE.upperArm, 0.29), limbMat));
      fore.add(this.shape(latheAlong(PROFILE.forearm, 0.26), limbMat));
      thigh.add(this.shape(latheAlong(PROFILE.thigh, 0.42), legMat));
      shin.add(this.shape(latheAlong(PROFILE.shin, 0.4), legMat));

      if (isPlate) this.buildPlateLimbs(side, s, upper, fore, hand, thigh, shin, foot, m, gilded);
      else if (style === "chain") this.buildChainLimbs(side, s, upper, fore, hand, thigh, shin, foot, m);
      else if (style === "leather") this.buildLeatherLimbs(side, s, upper, fore, hand, thigh, shin, foot, m);
      else this.buildPeasantLimbs(side, s, upper, fore, hand, thigh, shin, foot, m);
    }

    // Svärd och sköld
    const sword = this.buildSword(m, gilded);
    sword.position.set(0, -0.06, 0.01);
    sword.rotation.x = 2.0;
    sword.userData.equipment = true; // siktet ska inte räkna svärdet som kroppsdel
    this.seg.handR.add(sword);
    this.sword = sword;

    const shield = this.buildShield(look.s, m, colorHex);
    shield.position.set(0.03, -0.08, 0);
    shield.rotation.x = 1.6;
    shield.userData.equipment = true;
    this.seg.handL.add(shield);

    // Slå ihop småbitarna i varje kroppsdel (färre ritanrop = högre FPS)
    for (const seg of Object.values(this.seg)) this.mergeChildren(seg);
    this.mergeChildren(sword);
    this.mergeChildren(shield);

    // Blod på svärdsklingan (syns mer ju fler man träffat)
    this.bladeBloodMat = new THREE.MeshStandardMaterial({ color: BLOOD, roughness: 0.3, transparent: true, opacity: 0, depthWrite: false });
    const bladeBlood = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.6, 0.016), this.bladeBloodMat);
    bladeBlood.position.set(0, 0.62, 0);
    sword.add(bladeBlood);

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

  buildTorso(pelvis, torso, style, m, isPlate, gilded) {
    const P = (...a) => pelvis.add(this.shape(...a));
    const T = (...a) => torso.add(this.shape(...a));

    // Höfterna
    P(new THREE.SphereGeometry(1, 14, 10), isPlate || style === "chain" ? m.chain : style === "leather" ? m.wool : m.wool, [0, -0.04, 0], [0.16, 0.11, 0.12]);

    if (isPlate) {
      // Bröstharnesk: format runt bålen, med mittås, rullad halskant och nitar
      const chest = [[0.15, 0.0], [0.168, 0.06], [0.192, 0.2], [0.2, 0.3], [0.182, 0.39], [0.13, 0.445], [0.095, 0.46]]
        .map(([r, y]) => new THREE.Vector2(r, y));
      T(new THREE.LatheGeometry(chest, 18), m.steel, [0, 0, 0], [1.15, 1, 0.78]);
      T(new THREE.BoxGeometry(0.018, 0.36, 0.02), gilded ? m.gold : m.steel, [0, 0.24, 0.155], [1, 1, 1], [-0.08, 0, 0]); // mittås
      T(new THREE.TorusGeometry(0.1, 0.014, 6, 18), gilded ? m.gold : m.steel, [0, 0.455, 0], [1.1, 0.78, 1], [Math.PI / 2, 0, 0]); // halskant
      T(new THREE.TorusGeometry(0.175, 0.008, 5, 22), m.trim, [0, 0.01, 0], [1.15, 0.78, 1], [Math.PI / 2, 0, 0]); // nederkant
      for (let i = -3; i <= 3; i++) {
        const a = i * 0.32;
        T(new THREE.SphereGeometry(0.008, 5, 4), m.trim, [Math.sin(a) * 0.2, 0.035, Math.cos(a) * 0.15]); // nitar
      }
      // Band i spelarens färg över bröstet (så man ser vem som är vem)
      T(new THREE.BoxGeometry(0.06, 0.5, 0.33), m.cloth, [0, 0.24, 0.005], [1, 1, 1], [0, 0, 0.72]);
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
      if (gilded) {
        // Mantel på ryggen
        T(new THREE.BoxGeometry(0.4, 1.0, 0.012), m.cloth, [0, -0.07, -0.16], [1, 1, 1], [0.1, 0, 0]);
        T(new THREE.TorusGeometry(0.03, 0.008, 5, 10), m.gold, [0.15, 0.4, 0.1]); // mantelspänne
      }
      // Svärdsskida vid vänster höft
      this.addScabbard(pelvis, m, gilded ? m.gold : m.steelDark);
    } else if (style === "chain") {
      // Vapenrock med vapenmönster över ringbrynjan
      T(new THREE.CapsuleGeometry(0.15, 0.2, 6, 14), m.chain, [0, 0.24, 0], [1.22, 1, 0.76]);
      T(new THREE.BoxGeometry(0.3, 0.42, 0.012), m.cloth, [0, 0.21, 0.122]);
      T(new THREE.PlaneGeometry(0.29, 0.4), m.herald, [0, 0.21, 0.129]);
      T(new THREE.BoxGeometry(0.3, 0.42, 0.012), m.cloth, [0, 0.21, -0.122]);
      T(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 12), m.chain, [0, 0.44, 0]); // ringbrynjehuva vid halsen
      P(new THREE.CylinderGeometry(0.16, 0.22, 0.45, 16, 1, true), m.cloth, [0, -0.21, 0], [1, 1, 0.74]); // lång vapenrockskjol
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        P(new THREE.ConeGeometry(0.02, 0.05, 4), m.cloth, [Math.sin(a) * 0.22, -0.455, Math.cos(a) * 0.163], [1, 1, 1], [Math.PI, 0, 0]); // tandad fåll
      }
      P(new THREE.CylinderGeometry(0.162, 0.162, 0.045, 16), m.leatherDark, [0, 0, 0], [1, 1, 0.8]); // bälte
      P(new THREE.BoxGeometry(0.05, 0.05, 0.02), m.brass, [0, 0, 0.13]);
      this.addScabbard(pelvis, m, m.leatherDark);
    } else if (style === "leather") {
      // Läderjacka med remmar, spännen, nitar och axelskydd
      T(new THREE.CapsuleGeometry(0.15, 0.2, 6, 14), m.leather, [0, 0.24, 0], [1.24, 1, 0.78]);
      for (const s of [1, -1]) {
        T(new THREE.BoxGeometry(0.035, 0.5, 0.012), m.leatherDark, [0.02 * s, 0.24, 0.12], [1, 1, 1], [0, 0, 0.5 * s]); // korsade remmar
        T(new THREE.TorusGeometry(0.018, 0.005, 4, 8), m.brass, [0.08 * s, 0.3, 0.128]);                         // spännen
      }
      for (let y = 0.08; y < 0.42; y += 0.07) {
        for (const x of [-0.13, 0.13]) T(new THREE.SphereGeometry(0.009, 5, 4), m.brass, [x, y, 0.105]); // nitar
      }
      T(new THREE.BoxGeometry(0.06, 0.48, 0.3), m.cloth, [0, 0.24, 0.01], [1, 1, 1], [0, 0, -0.72]);   // band i spelarens färg
      P(new THREE.CylinderGeometry(0.16, 0.19, 0.2, 14, 1, true), m.leather, [0, -0.09, 0], [1, 1, 0.78]);
      P(new THREE.CylinderGeometry(0.165, 0.165, 0.05, 16), m.leatherDark, [0, 0, 0], [1, 1, 0.8]); // bälte
      P(new THREE.BoxGeometry(0.06, 0.05, 0.02), m.brass, [0, 0, 0.133]);
      P(new THREE.BoxGeometry(0.08, 0.09, 0.05), m.leatherDark, [-0.13, -0.05, 0.08]);  // pung
      P(new THREE.BoxGeometry(0.035, 0.2, 0.02), m.leatherDark, [0.15, -0.1, 0.06], [1, 1, 1], [0, 0, 0.2]); // dolkslida
      P(new THREE.SphereGeometry(0.018, 6, 5), m.brass, [0.165, 0.01, 0.06]);
    } else {
      // Bonde: vadderad jacka med lappar, repbälte och trasig fåll
      T(new THREE.CapsuleGeometry(0.155, 0.2, 6, 14), m.quilt, [0, 0.24, 0], [1.26, 1, 0.8]);
      T(new THREE.BoxGeometry(0.09, 0.09, 0.01), m.leather, [0.08, 0.3, 0.125], [1, 1, 1], [0, 0, 0.2]);   // lapp
      T(new THREE.BoxGeometry(0.07, 0.06, 0.01), m.wool, [-0.1, 0.14, 0.123], [1, 1, 1], [0, 0, -0.3]);    // lapp
      T(new THREE.BoxGeometry(0.06, 0.48, 0.32), m.cloth, [0, 0.24, 0.005], [1, 1, 1], [0, 0, 0.72]);     // band i spelarens färg
      P(new THREE.CylinderGeometry(0.165, 0.2, 0.22, 14, 1, true), m.quilt, [0, -0.1, 0], [1, 1, 0.8]);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const len = 0.03 + ((i * 7) % 5) * 0.012;
        P(new THREE.ConeGeometry(0.024, len, 3), m.quilt, [Math.sin(a) * 0.2, -0.21 - len / 2, Math.cos(a) * 0.16], [1, 1, 1], [Math.PI, 0, 0]); // trasig fåll
      }
      P(new THREE.TorusGeometry(0.165, 0.012, 5, 18), m.rope, [0, 0, 0], [1, 0.8, 1], [Math.PI / 2, 0, 0]); // repbälte
      P(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 4), m.rope, [0.06, -0.06, 0.135]);                // knuten
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

  // ---------- Lemmar per rustning ----------

  buildPlateLimbs(side, s, upper, fore, hand, thigh, shin, foot, m, gilded) {
    const U = (...a) => upper.add(this.shape(...a));
    const F = (...a) => fore.add(this.shape(...a));
    const H = (...a) => hand.add(this.shape(...a));
    const TH = (...a) => thigh.add(this.shape(...a));
    const SH = (...a) => shin.add(this.shape(...a));
    const FT = (...a) => foot.add(this.shape(...a));
    const edge = gilded ? m.gold : m.steelDark;

    // Axelskydd i tre överlappande plåtar
    U(new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.steel, [0.012 * s, 0.0, 0], [1.08, 0.75, 1.2]);
    U(new THREE.TorusGeometry(0.1, 0.008, 5, 18), edge, [0.012 * s, 0.0, 0], [1.08, 1.2, 1], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 2; i++) {
      U(new THREE.CylinderGeometry(0.1 - i * 0.012, 0.106 - i * 0.012, 0.04, 16, 1, true), m.steel, [0.01 * s, -0.035 - i * 0.035, 0], [1.08, 1, 1.2]);
    }
    U(new THREE.SphereGeometry(0.01, 5, 4), m.trim, [0.08 * s, 0.03, 0.07]);
    // Överarmsskena
    U(latheAlong(PROFILE.upperArm, 0.29, 0.38, 0.88, 0.012, false, 0.004), m.steel);
    // Armbågskopp med solfjäderformad vinge
    F(new THREE.SphereGeometry(0.066, 12, 8), m.steel, [0, 0, -0.008]);
    F(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 10), m.steel, [0.055 * s, 0, -0.01], [1, 1, 1.25], [0, 0, Math.PI / 2]);
    F(new THREE.SphereGeometry(0.009, 5, 4), m.trim, [0.062 * s, 0, -0.01]);
    // Underarmsskena och handskens utvikta krage
    F(latheAlong(PROFILE.forearm, 0.26, 0.12, 0.72, 0.01, false, 0.003), m.steel);
    F(new THREE.CylinderGeometry(0.06, 0.046, 0.08, 14, 1, true), m.steel, [0, -0.22, 0]);
    if (gilded) F(new THREE.TorusGeometry(0.06, 0.006, 4, 14), m.gold, [0, -0.18, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    // Handske med fingrar
    this.addGauntlet(H, m.steel, m.steelDark, s);

    // Lårskena med kant, knäkopp med vinge, benskena
    TH(latheAlong(PROFILE.thigh, 0.42, 0.06, 0.82, 0.012, false, 0.004), m.steel);
    TH(new THREE.BoxGeometry(0.012, 0.3, 0.012), edge, [0, -0.2, 0.094]); // ås fram
    SH(new THREE.SphereGeometry(0.074, 12, 8), m.steel, [0, 0, 0.022], [1, 1, 1.12]);
    SH(new THREE.CylinderGeometry(0.062, 0.062, 0.01, 10), m.steel, [0.062 * s, 0.0, 0.0], [1, 1, 1.2], [0, 0, Math.PI / 2]);
    SH(new THREE.SphereGeometry(0.01, 5, 4), m.trim, [0.07 * s, 0, 0]);
    SH(latheAlong(PROFILE.shin, 0.4, 0.14, 0.94, 0.011, false, 0.003), m.steel);
    if (gilded) SH(new THREE.TorusGeometry(0.067, 0.006, 4, 14), m.gold, [0, -0.06, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    // Spetsiga sabatoner i lameller
    this.addPointedShoe(FT, m.steel, edge, 0.24, true);
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
    // Läderhandskar och läderskor med spets (poulainer)
    H(new THREE.SphereGeometry(1, 12, 8), m.leatherDark, [0, -0.05, 0.005], [0.046, 0.06, 0.05]);
    F(new THREE.CylinderGeometry(0.048, 0.04, 0.07, 12, 1, true), m.leatherDark, [0, -0.225, 0]);
    SH(new THREE.CylinderGeometry(0.05, 0.046, 0.1, 12, 1, true), m.leatherDark, [0, -0.36, 0]);
    this.addPointedShoe(FT, m.leatherDark, m.leatherDark, 0.17, false);
  }

  buildLeatherLimbs(side, s, upper, fore, hand, thigh, shin, foot, m) {
    const U = (...a) => upper.add(this.shape(...a));
    const F = (...a) => fore.add(this.shape(...a));
    const H = (...a) => hand.add(this.shape(...a));
    const SH = (...a) => shin.add(this.shape(...a));
    const FT = (...a) => foot.add(this.shape(...a));
    // Axelskydd i läder
    U(new THREE.SphereGeometry(0.085, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.leatherDark, [0.01 * s, -0.01, 0], [1.05, 0.8, 1.15]);
    U(new THREE.SphereGeometry(0.008, 5, 4), m.brass, [0.07 * s, 0.03, 0.05]);
    // Armskydd med två remmar och spänne
    F(latheAlong(PROFILE.forearm, 0.26, 0.2, 0.85, 0.009, false), m.leatherDark);
    for (const y of [-0.1, -0.18]) {
      F(new THREE.TorusGeometry(0.053, 0.005, 4, 14), m.leather, [0, y, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
      F(new THREE.BoxGeometry(0.014, 0.014, 0.008), m.brass, [0, y, 0.056]);
    }
    H(new THREE.SphereGeometry(1, 12, 8), m.leatherDark, [0, -0.05, 0.005], [0.046, 0.06, 0.05]);
    // Höga stövlar med nedvikt kant och spetsig tå
    SH(new THREE.CylinderGeometry(0.07, 0.056, 0.26, 12, 1, true), m.leatherDark, [0, -0.25, 0]);
    SH(new THREE.CylinderGeometry(0.078, 0.072, 0.045, 12, 1, true), m.leather, [0, -0.115, 0]);
    this.addPointedShoe(FT, m.leatherDark, m.leatherDark, 0.15, false);
  }

  buildPeasantLimbs(side, s, upper, fore, hand, thigh, shin, foot, m) {
    const F = (...a) => fore.add(this.shape(...a));
    const H = (...a) => hand.add(this.shape(...a));
    const SH = (...a) => shin.add(this.shape(...a));
    const FT = (...a) => foot.add(this.shape(...a));
    // Lappad armbåge, bara händer, benlindor och klumpiga rundade skor
    F(new THREE.SphereGeometry(0.04, 8, 6), m.leather, [0, -0.01, -0.035], [1, 1, 0.5]);
    H(new THREE.SphereGeometry(1, 12, 8), m.skin, [0, -0.05, 0.005], [0.043, 0.056, 0.047]);
    SH(latheAlong(PROFILE.shin, 0.4, 0.35, 0.95, 0.006, false), m.wool);
    FT(new THREE.SphereGeometry(1, 12, 8), m.leatherDark, [0, -0.06, 0.05], [0.06, 0.05, 0.12]);
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

  // Spetsig sko eller sabaton: häl, lameller över foten och en lång, lite uppåtböjd spets
  addPointedShoe(FT, mat, edge, pointLength, lames) {
    FT(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat, [0, -0.1, -0.005], [0.058, 0.07, 0.07]); // häl
    if (lames) {
      for (let i = 0; i < 4; i++) {
        FT(new THREE.CylinderGeometry(0.052 - i * 0.004, 0.052 - i * 0.004, 0.05, 12, 1, true, Math.PI / 2, Math.PI), mat,
          [0, -0.09, 0.02 + i * 0.04], [1.05, 1, 0.75], [Math.PI / 2, 0, 0]);
        FT(new THREE.TorusGeometry(0.05 - i * 0.004, 0.003, 3, 10, Math.PI), edge, [0, -0.09, 0.045 + i * 0.04], [1.05, 0.75, 1], [0, 0, 0]);
      }
    } else {
      FT(new THREE.CapsuleGeometry(0.045, 0.12, 4, 10), mat, [0, -0.06, 0.06], [1.05, 0.9, 1], [Math.PI / 2, 0, 0]);
    }
    // Spetsen (cirka 1400-tal)
    FT(new THREE.ConeGeometry(0.036, pointLength, 10), mat, [0, -0.085, 0.17 + pointLength / 2], [1, 1, 0.75], [Math.PI / 2 - 0.12, 0, 0]);
  }

  // ---------- Hjälmar ----------

  buildHelmet(head, kind, m, gilded) {
    const add = (...args) => head.add(this.shape(...args));
    const trim = gilded ? m.gold : m.brass;
    const rivetRing = (radius, y, count, scaleZ = 1, skipFront = false) => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        if (skipFront && Math.abs(Math.sin(a / 2)) < 0.2) continue;
        add(new THREE.SphereGeometry(0.0075, 5, 4), trim, [Math.sin(a) * radius, y, Math.cos(a) * radius * scaleZ]);
      }
    };
    const face = () => {
      // Ansikte med ögon, näsa och mustasch (för öppna hjälmar)
      add(new THREE.SphereGeometry(0.1, 14, 10), m.skin, [0, 0.12, 0.01], [1, 1.1, 1]);
      add(new THREE.SphereGeometry(0.014, 6, 4), m.visor, [0.035, 0.14, 0.095]);
      add(new THREE.SphereGeometry(0.014, 6, 4), m.visor, [-0.035, 0.14, 0.095]);
      add(new THREE.ConeGeometry(0.018, 0.05, 6), m.skin, [0, 0.11, 0.11], [1, 1, 1], [Math.PI / 2 + 0.3, 0, 0]);
      add(new THREE.BoxGeometry(0.08, 0.015, 0.02), m.leatherDark, [0, 0.085, 0.1]);
    };

    if (kind === 1) {
      // Visirhjälm: spetsig topp, "grisnosvisir" med andningshål, gångjärn och mässingskant
      add(new THREE.CylinderGeometry(0.11, 0.12, 0.15, 18), m.steel, [0, 0.12, 0]);
      add(new THREE.ConeGeometry(0.11, 0.17, 18), m.steel, [0, 0.275, -0.01]);
      add(new THREE.ConeGeometry(0.078, 0.18, 14), m.steel, [0, 0.12, 0.12], [1, 1, 1], [Math.PI / 2, 0, 0]);
      add(new THREE.TorusGeometry(0.078, 0.006, 4, 16), trim, [0, 0.12, 0.035]);
      add(new THREE.BoxGeometry(0.15, 0.016, 0.04), m.visor, [0, 0.158, 0.13]);
      for (let r = 0; r < 2; r++) for (let c = -2; c <= 2; c++) add(new THREE.SphereGeometry(0.005, 4, 3), m.visor, [c * 0.018 + 0.02, 0.09 - r * 0.02, 0.15 - r * 0.01]); // andningshål
      for (const s of [1, -1]) add(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 8), trim, [0.115 * s, 0.13, 0.02], [1, 1, 1], [0, 0, Math.PI / 2]); // gångjärn
      rivetRing(0.118, 0.055, 14, 1, true);
      add(new THREE.CylinderGeometry(0.13, 0.17, 0.09, 16, 1, true), m.chain, [0, 0.025, 0]); // ringbrynja över halsen
    } else if (kind === 2) {
      // Järnhatt med brätte och nitar
      face();
      add(new THREE.SphereGeometry(0.118, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.steel, [0, 0.16, 0], [1, 0.95, 1]);
      add(new THREE.CylinderGeometry(0.215, 0.215, 0.014, 22), m.steel, [0, 0.163, 0], [1, 1, 1], [0.05, 0, 0]);
      add(new THREE.TorusGeometry(0.215, 0.007, 4, 24), trim, [0, 0.165, 0.01], [1, 1, 1], [Math.PI / 2 + 0.05, 0, 0]);
      add(new THREE.BoxGeometry(0.015, 0.11, 0.24), m.steel, [0, 0.24, 0], [1, 1, 1], [0, 0, 0]); // ås
      rivetRing(0.118, 0.175, 12);
    } else if (kind === 3) {
      // Hornhjälm med nässkydd, mässingsband och nitar
      add(new THREE.CylinderGeometry(0.115, 0.11, 0.2, 18), m.steel, [0, 0.13, 0]);
      add(new THREE.SphereGeometry(0.115, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.steel, [0, 0.23, 0]);
      add(new THREE.BoxGeometry(0.16, 0.025, 0.02), m.visor, [0, 0.16, 0.108]);
      add(new THREE.BoxGeometry(0.025, 0.1, 0.02), m.steel, [0, 0.12, 0.118]); // nässkydd
      add(new THREE.TorusGeometry(0.116, 0.01, 5, 20), trim, [0, 0.21, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
      rivetRing(0.117, 0.06, 12);
      const bone = this.mat(0xe8dcc0, 0.55, 0);
      for (const s of [1, -1]) {
        add(new THREE.ConeGeometry(0.035, 0.16, 10), bone, [0.13 * s, 0.25, 0], [1, 1, 1], [0, 0, -1.1 * s]);
        add(new THREE.ConeGeometry(0.023, 0.13, 10), bone, [0.2 * s, 0.33, 0], [1, 1, 1], [0, 0, -0.3 * s]);
        add(new THREE.TorusGeometry(0.036, 0.007, 4, 10), trim, [0.115 * s, 0.24, 0], [1, 1, 1], [0, Math.PI / 2, -1.1 * s]);
      }
    } else if (kind === 4) {
      // Plymhjälm: rundad med nackskydd, graverade linjer, plymhållare och en stor fjäderplym
      add(new THREE.SphereGeometry(0.126, 18, 12), m.steel, [0, 0.15, 0], [1, 0.95, 1.12]);
      add(new THREE.ConeGeometry(0.1, 0.18, 14), m.steel, [0, 0.08, -0.12], [1.2, 1, 0.5], [-Math.PI / 2 - 0.5, 0, 0]);
      add(new THREE.BoxGeometry(0.17, 0.02, 0.03), m.visor, [0, 0.15, 0.13]);
      for (const y of [0.2, 0.23]) add(new THREE.TorusGeometry(0.115, 0.004, 4, 20), trim, [0, y, 0.005], [1, 1.12, 1], [Math.PI / 2 - 0.15, 0, 0]);
      add(new THREE.CylinderGeometry(0.015, 0.02, 0.06, 8), trim, [0, 0.28, -0.02]); // plymhållare
      const plume = [[0, 0.32, -0.02, 0.06], [0, 0.38, -0.07, 0.07], [0, 0.41, -0.14, 0.065], [0, 0.39, -0.21, 0.055], [0, 0.34, -0.26, 0.045]];
      plume.forEach(([x, y, z, r], i) => add(new THREE.SphereGeometry(r, 10, 8), i % 2 ? m.white : m.cloth, [x, y, z], [0.7, 1.3, 1]));
      if (gilded) add(new THREE.TorusGeometry(0.12, 0.012, 5, 20), m.gold, [0, 0.12, 0], [1, 1, 1.1], [Math.PI / 2, 0, 0]);
    } else if (kind === 5) {
      // Kastrull, med skaftet ut åt sidan
      face();
      const pot = this.mat(0x4a4d52, 0.4, 0.7);
      add(new THREE.CylinderGeometry(0.13, 0.125, 0.13, 18), pot, [0, 0.23, 0]);
      add(new THREE.TorusGeometry(0.128, 0.01, 6, 20), pot, [0, 0.165, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
      add(new THREE.BoxGeometry(0.26, 0.025, 0.035), m.wood, [0.25, 0.2, 0], [1, 1, 1], [0, 0, 0.15]);
      add(new THREE.SphereGeometry(0.03, 8, 6), pot, [-0.07, 0.29, 0.03], [1, 0.4, 1]); // en buckla
    } else if (kind === 6) {
      // Halmhatt med band i spelarens färg
      face();
      add(new THREE.CylinderGeometry(0.26, 0.26, 0.018, 22), m.straw, [0, 0.17, 0]);
      add(new THREE.CylinderGeometry(0.1, 0.12, 0.12, 16), m.straw, [0, 0.235, 0]);
      add(new THREE.CylinderGeometry(0.121, 0.121, 0.03, 16, 1, true), m.cloth, [0, 0.195, 0]);
    } else {
      // Tunnhjälm: kors i mässing över ansiktet, nitrader, andningshål och hjälmkam
      add(new THREE.CylinderGeometry(0.115, 0.11, 0.2, 18), m.steel, [0, 0.13, 0]);
      add(new THREE.SphereGeometry(0.115, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.steel, [0, 0.23, 0]);
      add(new THREE.BoxGeometry(0.16, 0.025, 0.02), m.visor, [0, 0.16, 0.108]); // ögonspringa
      add(new THREE.BoxGeometry(0.018, 0.16, 0.012), trim, [0, 0.12, 0.116]);  // kors i mässing
      add(new THREE.BoxGeometry(0.2, 0.014, 0.012), trim, [0, 0.185, 0.112]);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) add(new THREE.SphereGeometry(0.005, 4, 3), m.visor, [-0.035 - c * 0.016, 0.1 - r * 0.018, 0.112]); // andningshål
      rivetRing(0.114, 0.04, 16);
      rivetRing(0.114, 0.215, 16);
      add(new THREE.BoxGeometry(0.035, 0.07, 0.22), m.cloth, [0, 0.36, -0.01]); // hjälmkam
      if (gilded) add(new THREE.TorusGeometry(0.1, 0.014, 5, 18), m.gold, [0, 0.33, 0], [1, 1, 1], [Math.PI / 2, 0, 0]); // guldkrans
    }
  }

  // ---------- Svärd ----------

  buildSword(m, gilded) {
    const sword = new THREE.Group();
    const hilt = gilded ? m.gold : m.steelDark;
    const add = (...a) => sword.add(this.shape(...a));
    add(new THREE.BoxGeometry(0.05, 0.85, 0.01), m.blade, [0, 0.52, 0]);        // klinga
    add(new THREE.BoxGeometry(0.012, 0.66, 0.014), m.steelDark, [0, 0.46, 0]);  // blodränna
    add(new THREE.ConeGeometry(0.025, 0.08, 4), m.blade, [0, 0.985, 0], [1, 1, 0.22]); // spets
    add(new THREE.BoxGeometry(0.2, 0.03, 0.04), hilt, [0, 0.085, 0]);          // parerstång
    for (const s of [1, -1]) add(new THREE.SphereGeometry(0.02, 8, 6), hilt, [0.1 * s, 0.095, 0]); // böjda ändar
    add(new THREE.CylinderGeometry(0.017, 0.019, 0.14, 8), m.leatherDark, [0, 0, 0]); // läderlindat fäste
    for (let i = 0; i < 5; i++) add(new THREE.TorusGeometry(0.019, 0.003, 3, 8), m.leather, [0, -0.05 + i * 0.025, 0], [1, 1, 1], [Math.PI / 2, 0, 0.4]);
    add(new THREE.SphereGeometry(0.03, 10, 8), hilt, [0, -0.085, 0], [1, 0.8, 0.6]); // knapp
    return sword;
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
      m.envMapIntensity = 1;
    }
    this.materials.push(m);
    return m;
  }

  shape(geometry, material, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    return mesh;
  }

  segment(name, parent, pivot, points, radius) {
    const g = new THREE.Group();
    g.position.set(pivot[0], pivot[1], pivot[2]);
    g.userData = { segment: name, points, radius, detached: false };
    parent.add(g);
    this.seg[name] = g;
    return g;
  }

  // Slå ihop alla direkta småbitar i en grupp som har samma material till en enda
  mergeChildren(group) {
    const buckets = new Map();
    for (const child of [...group.children]) {
      if (!child.isMesh) continue;
      child.updateMatrix();
      const geo = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()).applyMatrix4(child.matrix);
      for (const key of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(key)) geo.deleteAttribute(key);
      geo.clearGroups?.();
      if (!buckets.has(child.material)) buckets.set(child.material, []);
      buckets.get(child.material).push(geo);
      group.remove(child);
      child.geometry.dispose();
    }
    for (const [material, geos] of buckets) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos);
      if (geos.length > 1) geos.forEach((g) => g.dispose());
      group.add(new THREE.Mesh(merged, material));
    }
  }

  // ---------- Blod på rustningen och svärdet ----------

  // En blodfläck på kroppsdelen som träffades
  addBloodSplat(segName) {
    const seg = this.seg[segName];
    if (!seg || seg.userData.detached || this.bloodSplats > 45) return;
    this.bloodSplats += 1;
    const pts = seg.userData.points;
    const isTorso = segName === "torso";
    const isHead = segName === "head";
    const angle = Math.random() * Math.PI * 2;
    const y = isTorso ? 0.08 + Math.random() * 0.34 : isHead ? 0.1 + Math.random() * 0.12 : pts[1][1] * (0.15 + Math.random() * 0.7);
    const r = isTorso ? 0.2 : isHead ? 0.125 : seg.userData.radius * 1.35 + 0.01;
    const sx = isTorso ? 1.15 : 1;
    const sz = isTorso ? 0.78 : 1;
    const normal = new THREE.Vector3(Math.sin(angle) * sx, 0, Math.cos(angle) * sz).normalize();
    const size = 0.025 + Math.random() * 0.04;
    const splat = new THREE.Mesh(new THREE.CircleGeometry(size, 7), bloodDecal());
    splat.position.set(Math.sin(angle) * r * sx, y, Math.cos(angle) * r * sz);
    splat.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    splat.scale.set(1, 0.6 + Math.random() * 0.9, 1);
    seg.add(splat);
  }

  bloodySword() {
    this.swordBlood = Math.min(1, this.swordBlood + 0.25);
    this.bladeBloodMat.opacity = this.swordBlood * 0.8;
  }

  // ---------- Svärdsspår (en ljus båge som följer klingan i slaget) ----------

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
      this.sword.updateWorldMatrix(true, false);
      const tip = new THREE.Vector3(0, 0.98, 0).applyMatrix4(this.sword.matrixWorld);
      const base = new THREE.Vector3(0, 0.3, 0).applyMatrix4(this.sword.matrixWorld);
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

  // ---------- Reaktioner ----------

  // Rycker till bort från slaget. dirLocal = [x, z] i riddarens egna koordinater (varifrån slaget kom)
  playHit(dirLocal) {
    this.hitT = 0;
    this.hitDir = dirLocal;
  }

  playLand() {
    this.landT = 0;
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
    this.label.scale.set(2.4, 0.6, 1);
    this.label.position.y = 2.3;
    this.group.add(this.label);
    this.setHp(COMBAT.maxHp);
  }

  setHp(hp) {
    if (!this.labelCanvas) return;
    const ctx = this.labelCanvas.getContext("2d");
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = "bold 44px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(20, 14, 8, 0.85)";
    ctx.strokeText(this.name, 256, 42);
    ctx.fillStyle = "#" + new THREE.Color(this.colorHex).lerp(new THREE.Color(0xffffff), 0.55).getHexString();
    ctx.fillText(this.name, 256, 42);

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

  // ---------- Stridshändelser (anropas från spelet) ----------

  playAttack(kind) {
    this.attack = { kind, t: 0 };
    this.charging = false;
  }

  setCharging(on) {
    this.charging = on;
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

  makeRagdoll(segments, velocity, scene, bounds, spinAmount) {
    this.group.updateMatrixWorld(true);
    const tmp = new THREE.Vector3();
    const bodies = segments.map((s) => {
      const world = s.userData.points.map((p) => tmp.set(p[0], p[1], p[2]).applyMatrix4(s.matrixWorld).toArray());
      const jitter = () => (Math.random() - 0.5) * 1.5;
      return {
        object: s,
        local: s.userData.points,
        world,
        radius: s.userData.radius,
        velocity: [velocity[0] + jitter(), velocity[1] + jitter() * 0.5, velocity[2] + jitter()],
        spin: [jitter() * spinAmount, jitter() * spinAmount, jitter() * spinAmount],
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

    // Blodig stump på kroppen och på den lösa delen
    const parent = seg.parent;
    const stump = this.shape(new THREE.SphereGeometry(0.055, 10, 8), this.m.blood, seg.position.toArray());
    parent.add(stump);
    seg.add(this.shape(new THREE.SphereGeometry(0.05, 10, 8), this.m.blood));
    this.stumps.push({ object: parent, local: seg.position.clone(), time: 0, segName });
    if (LEG_JOINTS.includes(joint)) this.legLoss += 1;

    return this.makeRagdoll(this.subtree(seg), velocity, scene, bounds, 6);
  }

  // Hela riddaren blir en ragdoll (vid död). Riddaren själv ska inte användas efter detta.
  die(velocity, scene, bounds) {
    if (this.label) this.label.removeFromParent();
    this.removeTrail();
    const ragdoll = this.makeRagdoll(this.subtree(this.seg.pelvis), velocity, scene, bounds, 2);
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
      if (s.time < 3.5) {
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
      for (const child of old.children) {
        if (child.isMesh && child.userData.baseMaterial) {
          if (!old.userData.detached) child.material = child.userData.baseMaterial;
          delete child.userData.baseMaterial;
        }
      }
    }
    this.highlighted = segName;
    const seg = segName && this.seg[segName];
    if (!seg || seg.userData.detached) return;
    if (!this.glowMats) this.glowMats = new Map();
    for (const child of seg.children) {
      if (!child.isMesh) continue;
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

  playKick() {
    this.kickT = 0;
    this.emote = null;
    this.attack = null;
    this.charging = false;
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
    const T = {}; // led -> [x, y, z, hastighet]
    const set = (name, x, y = 0, z = 0, speed = k) => (T[name] = [x, y, z, speed]);
    const legsFree = { L: true, R: true }; // false = benet styrs av en animation i stället för benlösaren

    // Gester avbryts om man börjar röra sig eller slåss
    if (this.emote && (motion.speed > 0.8 || this.attack || this.kickT >= 0 || this.parryT >= 0 || this.charging)) this.emote = null;

    // ----- Gångcykel -----
    const speed = motion.airborne ? 0 : motion.speed;
    const run = Math.min(1, Math.max(0, (speed - 3.5) / 2.5)); // 0 = gå, 1 = spring
    const stride = lerp(1.35, 2.0, run);
    const backwards = motion.forward < -0.3 && Math.abs(motion.forward) > Math.abs(motion.side);
    if (speed > 0.3) this.phase += ((speed * dt) / stride) * Math.PI * 2 * (backwards ? -1 : 1);
    const targetAmp = Math.min(1, speed / 3.5) * lerp(0.5, 0.8, run);
    this.amp += (targetAmp - this.amp) * (1 - Math.exp(-dt * 8));
    const amp = this.amp;
    const moving = Math.min(1, amp * 2.2); // 0 = stilla (stridsställning), 1 = i rörelse

    let dirFwd = 1;
    if (speed > 0.1) {
      const len = Math.hypot(motion.forward, motion.side) || 1;
      dirFwd = (motion.forward / len) * (backwards ? -1 : 1);
    }
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

    // ----- Svärdsarmen: stridsställning/gång, laddning eller slag -----
    let pose = STANCE_R.map((v, i) => lerp(v, CARRY_R[i], moving));
    pose[0] -= swing * 0.3 * dirFwd;
    this.chargeAmount += ((this.charging ? 1 : 0) - this.chargeAmount) * Math.min(1, dt * 8);
    pose = pose.map((v, i) => lerp(v, CHARGE_POSE[i], this.chargeAmount));
    let armK = k;
    if (this.attack) {
      this.attack.t += dt;
      const keys = this.attack.kind === "h" ? HEAVY_KEYS : this.attack.kind === "t" ? THRUST_KEYS : QUICK_KEYS;
      if (this.attack.t >= keys[keys.length - 1][0]) this.attack = null;
      else {
        pose = sampleKeys(keys, this.attack.t);
        armK = kFast;
        // Tyngd i slaget: höften vrids och kroppen kliver in i tunga slag och stötar
        const strike = Math.sin(Math.min(1, this.attack.t / 0.35) * Math.PI);
        if (this.attack.kind === "h") pelvisZ = strike * 0.1;
        if (this.attack.kind === "t") pelvisZ = strike * 0.08;
        pelvisRotY += pose[3] * 0.5;
      }
    }
    set("upperArmR", pose[0], 0, pose[1], armK);
    set("forearmR", pose[2], 0, 0, armK);
    set("handR", pose[4], 0, 0, armK);

    // ----- Sköldarmen: stridsställning/gång eller parering -----
    let shield = STANCE_L.map((v, i) => lerp(v, CARRY_L[i], moving));
    shield[0] += swing * 0.15 * dirFwd;
    let shieldK = k;
    if (this.parryT >= 0) {
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

    // ----- Bålen: lutar in i rörelsen, motvrids mot höfterna, andas -----
    let lean = 0.06 * moving + 0.1 * run * dirFwd + Math.sin(this.time * 2.0) * 0.012 + (1 - moving) * 0.05;
    let torsoZ = 0;
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
          // Buga djupt med svärdet utsträckt åt sidan
          lean = mix(lean, 0.85);
          headX = mix(0, 0.35);
          pelvisRotY = mix(pelvisRotY, 0);
          set("upperArmR", mix(pose[0], -0.5), 0, mix(pose[1], -1.1));
          set("forearmR", mix(pose[2], -0.2));
          set("upperArmL", mix(shield[0], 0.2), 0, mix(shield[1], 0.3));
          set("forearmL", mix(shield[2], -1.6));
        } else if (this.emote.e === 2) {
          // Peka med svärdet och skaka av skratt
          const shake = Math.sin(t * 22) * 0.07;
          lean = mix(lean, -0.22 + shake);
          headX = mix(0, -0.35 + shake * 1.5);
          set("upperArmR", mix(pose[0], -1.5), 0, mix(pose[1], 0), kFast);
          set("forearmR", mix(pose[2], -0.05), 0, 0, kFast);
          set("handR", mix(pose[4], 1.0), 0, 0, kFast);
          set("upperArmL", mix(shield[0], -0.2), 0, mix(shield[1], -0.2));
          set("forearmL", mix(shield[2], -2.0));
          pelvisY += Math.abs(shake) * 0.3 * w;
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
        }
      }
    }

    set("torso", lean, torsoY, torsoZ, this.attack || this.kickT >= 0 ? kFast : k);
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
    }

    // ----- Benen -----
    this.animateLegs(dt, motion, T, legsFree, k);

    // ----- Röd blinkning vid träff -----
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    const glow = this.flashT / 0.2;
    for (const mat of this.materials) {
      if (mat.emissive) mat.emissiveIntensity = glow;
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
    });

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
      const ankle = [foot[0], foot[1] + 0.1 + Math.max(0, pitch) * 0.07, foot[2]];
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
