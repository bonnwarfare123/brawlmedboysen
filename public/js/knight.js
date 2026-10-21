// RIDDAREN – byggd av rundade former med riktiga leder.
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

import * as THREE from "three";
import { COMBAT, JOINT_SEGMENT, LEG_JOINTS } from "./shared.js";
import { Ragdoll } from "./ragdoll.js";

const VISOR = 0x15151a;
const BLOOD = 0x7a0a0a;
const SKIN = [0xf0c8a0, 0xd9a878, 0xb98058, 0x8a5a3a];

// Omgivning som blank metall speglar (sätts av spelet, se setEnvironment)
let ENVIRONMENT = null;
export function setEnvironment(texture) {
  ENVIRONMENT = texture;
}

// Rustningarna: vilka färger och material varje del av kroppen får
//   arm/leg = armar och ben, joint = axel-/armbågs-/knäskydd (null = inga),
//   chest = bålen ("cloth" = vapenrock i spelarens färg), hands, boots, trim = detaljer
const ARMOR_STYLES = [
  { // Plåtrustning
    arm: [0x9aa1aa, 0.35, 0.75], leg: [0x9aa1aa, 0.35, 0.75], joint: [0x60666f, 0.4, 0.7],
    chest: "cloth", hands: [0x60666f, 0.4, 0.7], boots: [0x60666f, 0.4, 0.7],
    trim: [0x5a3c24, 0.85, 0], emblem: 0xf2efe6, pauldron: 1, skirt: 0.32, neck: true,
  },
  { // Ringbrynja
    arm: [0x80868d, 0.7, 0.55], leg: [0x80868d, 0.7, 0.55], joint: null,
    chest: "cloth", hands: [0x5a3c24, 0.85, 0], boots: [0x4a3322, 0.85, 0],
    trim: [0x5a3c24, 0.85, 0], emblem: 0xf2efe6, pauldron: 0, skirt: 0.45, neck: true, coif: true,
  },
  { // Läderrustning
    arm: [0x7a5230, 0.8, 0], leg: [0x4a3322, 0.85, 0], joint: [0x4a2e1a, 0.8, 0],
    chest: [0x6a4528, 0.8, 0], hands: [0x4a2e1a, 0.85, 0], boots: [0x3a2414, 0.85, 0],
    trim: [0x2e1d10, 0.85, 0], emblem: null, sash: true, pauldron: 0.6, skirt: 0.2, neck: false,
  },
  { // Praktrustning (blank stål med guld)
    arm: [0xc8ced6, 0.22, 0.9], leg: [0xc8ced6, 0.22, 0.9], joint: [0xd4a83a, 0.3, 0.85],
    chest: "cloth", hands: [0xd4a83a, 0.3, 0.85], boots: [0xc8ced6, 0.22, 0.9],
    trim: [0xd4a83a, 0.3, 0.85], emblem: 0xd4a83a, pauldron: 1.25, skirt: 0.32, neck: true,
  },
  { // Bonde i vadderad jacka
    arm: [0xd8c8a0, 0.95, 0], leg: [0x6a5038, 0.95, 0], joint: null,
    chest: [0xd8c8a0, 0.95, 0], hands: "skin", boots: [0x4a3322, 0.9, 0],
    trim: [0xa08850, 0.95, 0], emblem: null, sash: true, pauldron: 0, skirt: 0, neck: false,
  },
];

// Rörelsekurvor för svärdsarmen:
// [tid, överarm framåt, överarm i sidled, underarm böj, bålens vridning, handled]
const REST_R = [-0.3, 0, -0.9, 0, 0];
const QUICK_KEYS = [
  [0.0, -0.3, 0.0, -0.9, 0.0, 0],
  [0.12, -2.4, -0.4, -1.0, -0.4, 0],
  [0.3, -0.6, 0.3, -0.2, 0.4, 0],
  [0.5, -0.3, 0.0, -0.9, 0.0, 0],
];
const HEAVY_KEYS = [
  [0.0, -2.9, 0.0, -0.6, -0.3, 0],
  [0.15, -3.0, 0.0, -0.7, -0.35, 0],
  [0.32, -0.5, 0.0, -0.1, 0.3, 0],
  [0.7, -0.3, 0.0, -0.9, 0.0, 0],
];
// Stöt: dra tillbaka armen och stöt rakt fram med spetsen
const THRUST_KEYS = [
  [0.0, -0.3, 0.0, -0.9, 0.0, 0],
  [0.1, -0.7, -0.25, -1.7, -0.45, 0.65],
  [0.22, -1.45, 0.0, -0.05, 0.4, 1.0],
  [0.32, -1.45, 0.0, -0.05, 0.35, 1.0],
  [0.5, -0.3, 0.0, -0.9, 0.0, 0],
];
const CHARGE_POSE = [-2.9, 0, -0.6, -0.3, 0];
// Sköldarmen: [tid, överarm framåt, överarm i sidled, underarm böj]
const REST_L = [-0.2, 0, -1.4];
const PARRY_KEYS = [
  [0.0, -0.2, 0.0, -1.4],
  [0.07, -0.9, -0.3, -1.2],
  [0.3, -0.9, -0.3, -1.2],
  [0.45, -0.2, 0.0, -1.4],
];
// Spark med höger ben: [tid, lår framåt, knäböj, bålens lutning]
const KICK_KEYS = [
  [0.0, 0.0, 0.1, 0.0],
  [0.1, -0.7, 1.4, -0.15],
  [0.2, -1.5, 0.1, -0.3],
  [0.32, -1.2, 0.3, -0.25],
  [0.48, 0.0, 0.1, 0.0],
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

// Konturen av en sköld (i XY-planet), används för droppformad, riddarsköld och pavis
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

export class Knight {
  constructor(colorHex, name = null, look = { a: 0, h: 0, s: 0 }) {
    this.group = new THREE.Group();
    this.materials = [];
    this.seg = {};
    this.stumps = [];
    this.legLoss = 0;

    this.phase = 0;
    this.amp = 0;
    this.attack = null;
    this.charging = false;
    this.chargeAmount = 0;
    this.parryT = -1;
    this.staggerT = -1;
    this.kickT = -1;
    this.emote = null;
    this.flashT = 0;

    const style = ARMOR_STYLES[look.a] || ARMOR_STYLES[0];
    this.style = style;
    const skin = SKIN[Math.abs(Math.floor(colorHex / 7)) % SKIN.length];
    const fromSpec = (spec) => (spec === "skin" ? this.mat(skin, 0.8, 0) : spec === "cloth" ? null : this.mat(spec[0], spec[1], spec[2]));

    const m = {
      cloth: this.mat(colorHex, 0.8, 0),
      arm: fromSpec(style.arm),
      leg: fromSpec(style.leg),
      joint: style.joint ? fromSpec(style.joint) : null,
      hands: fromSpec(style.hands),
      boots: fromSpec(style.boots),
      trim: fromSpec(style.trim),
      helm: style === ARMOR_STYLES[3] ? this.mat(0xc8ced6, 0.22, 0.9) : this.mat(0x9aa1aa, 0.35, 0.75),
      helmDark: this.mat(0x60666f, 0.4, 0.7),
      gold: this.mat(0xd4a83a, 0.3, 0.85),
      chain: this.mat(0x80868d, 0.7, 0.55),
      visor: this.mat(VISOR, 0.6, 0.2),
      skin: this.mat(skin, 0.8, 0),
      white: this.mat(0xf2efe6, 0.8, 0),
      blade: this.mat(0xd3d8de, 0.25, 0.85),
      wood: this.mat(0x6a4a2c, 0.85, 0),
      blood: this.mat(BLOOD, 0.5, 0),
    };
    m.chest = style.chest === "cloth" ? m.cloth : fromSpec(style.chest);
    m.emblem = style.emblem === null ? null : style.emblem === 0xd4a83a ? m.gold : m.white;
    m.cloth.side = THREE.DoubleSide; // kjolen är öppen nedtill
    this.m = m;

    // ---------- Kroppsdelarna ----------
    // segment(namn, förälder, ledens position i förälderns koordinater, punkter för fysiken, radie)

    const pelvis = this.segment("pelvis", this.group, [0, 1.0, 0],
      [[0, 0, 0], [0.1, -0.08, 0], [-0.1, -0.08, 0]], 0.1);
    pelvis.add(this.shape(new THREE.SphereGeometry(1, 14, 10), m.leg, [0, -0.04, 0], [0.16, 0.11, 0.12]));
    if (style.skirt > 0) {
      const skirtMat = style.chest === "cloth" ? m.cloth : m.chest;
      pelvis.add(this.shape(new THREE.CylinderGeometry(0.155, 0.2, style.skirt, 14, 1, true), skirtMat, [0, -style.skirt / 2 + 0.01, 0], [1, 1, 0.75]));
    }
    pelvis.add(this.shape(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 14), m.trim, [0, 0.0, 0], [1, 1, 0.8])); // bälte
    if (style === ARMOR_STYLES[3]) pelvis.add(this.shape(new THREE.BoxGeometry(0.06, 0.06, 0.02), m.gold, [0, 0, 0.13])); // bältesspänne

    const torso = this.segment("torso", pelvis, [0, 0, 0],
      [[0, 0, 0], [0, 0.44, 0], [0.19, 0.4, 0], [-0.19, 0.4, 0], [0, 0.25, 0.12]], 0.13);
    torso.add(this.shape(new THREE.CapsuleGeometry(0.15, 0.2, 6, 14), m.chest, [0, 0.24, 0], [1.25, 1, 0.78])); // bålen
    if (style.neck) torso.add(this.shape(new THREE.CylinderGeometry(0.09, 0.11, 0.08, 12), style.coif ? m.chain : m.helmDark, [0, 0.44, 0]));
    if (m.emblem) {
      torso.add(this.shape(new THREE.BoxGeometry(0.05, 0.22, 0.01), m.emblem, [0, 0.26, 0.122])); // kors på bröstet
      torso.add(this.shape(new THREE.BoxGeometry(0.16, 0.05, 0.01), m.emblem, [0, 0.3, 0.12]));
    }
    if (style.sash) {
      // Snett band över bröstet i spelarens färg
      torso.add(this.shape(new THREE.BoxGeometry(0.07, 0.48, 0.25), m.cloth, [0, 0.25, 0.01], [1, 1, 1], [0, 0, 0.75]));
    }
    if (style === ARMOR_STYLES[3]) {
      torso.add(this.shape(new THREE.TorusGeometry(0.1, 0.012, 6, 16), m.gold, [0, 0.42, 0], [1, 1, 1], [Math.PI / 2, 0, 0])); // guldkrage
    }
    if (style === ARMOR_STYLES[4]) {
      // Bondens vaddering: tvärgående sömmar
      for (let i = 0; i < 3; i++) {
        torso.add(this.shape(new THREE.TorusGeometry(0.17, 0.006, 4, 18), m.trim, [0, 0.12 + i * 0.1, 0], [1.2, 0.78, 1], [Math.PI / 2, 0, 0]));
      }
    }

    const head = this.segment("head", torso, [0, 0.46, 0],
      [[0, 0, 0], [0, 0.28, 0], [0, 0.12, 0.12]], 0.12);
    this.buildHelmet(head, look.h, m);

    for (const side of ["L", "R"]) {
      const s = side === "L" ? 1 : -1;
      // Arm
      const upper = this.segment("upperArm" + side, torso, [0.2 * s, 0.41, 0],
        [[0, 0, 0], [0, -0.29, 0], [0.05 * s, -0.14, 0]], 0.055);
      upper.add(this.limbShape(0.056, 0.29, m.arm));
      if (style.pauldron > 0 && m.joint) {
        const p = style.pauldron;
        upper.add(this.shape(new THREE.SphereGeometry(0.085, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.joint, [0.01 * s, -0.01, 0], [1.05 * p, 0.85 * p, 1.15 * p]));
      }

      const fore = this.segment("forearm" + side, upper, [0, -0.29, 0],
        [[0, 0, 0], [0, -0.26, 0], [0.05 * s, -0.13, 0]], 0.05);
      fore.add(this.limbShape(0.05, 0.26, m.arm));
      if (m.joint) fore.add(this.shape(new THREE.SphereGeometry(0.058, 12, 8), m.joint, [0, 0, 0.01]));             // armbågsskydd
      if (style !== ARMOR_STYLES[4]) fore.add(this.shape(new THREE.CylinderGeometry(0.06, 0.052, 0.08, 12), m.hands, [0, -0.21, 0])); // handskens krage

      const hand = this.segment("hand" + side, fore, [0, -0.26, 0],
        [[0, 0, 0], [0, -0.1, 0], [0.04 * s, -0.05, 0]], 0.045);
      hand.add(this.shape(new THREE.SphereGeometry(1, 12, 8), m.hands, [0, -0.05, 0.005], [0.045, 0.058, 0.05]));

      // Ben
      const thigh = this.segment("thigh" + side, pelvis, [0.1 * s, -0.08, 0],
        [[0, 0, 0], [0, -0.42, 0], [0.06 * s, -0.21, 0]], 0.075);
      thigh.add(this.limbShape(0.076, 0.42, m.leg));

      const shin = this.segment("shin" + side, thigh, [0, -0.42, 0],
        [[0, 0, 0], [0, -0.4, 0], [0.05 * s, -0.2, 0]], 0.06);
      shin.add(this.limbShape(0.06, 0.4, m.leg));
      if (m.joint) shin.add(this.shape(new THREE.SphereGeometry(0.07, 12, 8), m.joint, [0, 0, 0.025], [1, 1, 1.15])); // knäskydd
      if (style === ARMOR_STYLES[2] || style === ARMOR_STYLES[4]) {
        shin.add(this.shape(new THREE.CylinderGeometry(0.068, 0.062, 0.22, 12), m.boots, [0, -0.28, 0])); // stövelskaft
      }

      const foot = this.segment("foot" + side, shin, [0, -0.4, 0],
        [[0, 0, 0], [0, -0.06, 0.18], [0.05 * s, -0.06, 0]], 0.05);
      const shoe = this.shape(new THREE.CapsuleGeometry(0.045, 0.15, 4, 10), m.boots, [0, -0.055, 0.05], [1.1, 1, 1]);
      shoe.rotation.x = Math.PI / 2;
      foot.add(shoe);
    }

    // Svärd i höger hand (klingan längs +Y, vinklad så den pekar framåt-uppåt i vila)
    const sword = new THREE.Group();
    sword.add(this.shape(new THREE.BoxGeometry(0.05, 0.85, 0.012), m.blade, [0, 0.52, 0]));   // klinga
    sword.add(this.shape(new THREE.BoxGeometry(0.012, 0.7, 0.016), m.helmDark, [0, 0.48, 0])); // blodränna
    sword.add(this.shape(new THREE.ConeGeometry(0.025, 0.08, 4), m.blade, [0, 0.985, 0], [1, 1, 0.25])); // spets
    sword.add(this.shape(new THREE.BoxGeometry(0.24, 0.035, 0.045), style.emblem === 0xd4a83a ? m.gold : m.helmDark, [0, 0.085, 0])); // parerstång
    sword.add(this.shape(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 8), m.trim, [0, 0, 0])); // fäste
    sword.add(this.shape(new THREE.SphereGeometry(0.03, 8, 6), style.emblem === 0xd4a83a ? m.gold : m.helmDark, [0, -0.08, 0])); // knapp
    sword.position.set(0, -0.06, 0.01);
    sword.rotation.x = 2.0;
    sword.userData.equipment = true; // siktet ska inte räkna svärdet som kroppsdel
    this.seg.handR.add(sword);

    // Sköld i vänster hand (vänd framåt i vila)
    const shield = this.buildShield(look.s, m);
    shield.position.set(0.03, -0.08, 0);
    shield.rotation.x = 1.6;
    shield.userData.equipment = true;
    this.seg.handL.add(shield);

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

  // ---------- Hjälmar ----------

  buildHelmet(head, kind, m) {
    const add = (...args) => head.add(this.shape(...args));
    const face = () => {
      // Ansikte med ögon, näsa och mustasch (för öppna hjälmar)
      add(new THREE.SphereGeometry(0.1, 14, 10), m.skin, [0, 0.12, 0.01], [1, 1.1, 1]);
      add(new THREE.SphereGeometry(0.014, 6, 4), m.visor, [0.035, 0.14, 0.095]);
      add(new THREE.SphereGeometry(0.014, 6, 4), m.visor, [-0.035, 0.14, 0.095]);
      add(new THREE.ConeGeometry(0.018, 0.05, 6), m.skin, [0, 0.11, 0.11], [1, 1, 1], [Math.PI / 2 + 0.3, 0, 0]);
      add(new THREE.BoxGeometry(0.08, 0.015, 0.02), m.trim, [0, 0.085, 0.1], [1, 1, 1], [0, 0, 0]);
    };

    if (kind === 1) {
      // Visirhjälm med spetsig topp och "grisnosvisir"
      add(new THREE.CylinderGeometry(0.11, 0.12, 0.15, 16), m.helm, [0, 0.12, 0]);
      add(new THREE.ConeGeometry(0.11, 0.16, 16), m.helm, [0, 0.27, -0.01]);
      add(new THREE.ConeGeometry(0.075, 0.17, 12), m.helm, [0, 0.12, 0.12], [1, 1, 1], [Math.PI / 2, 0, 0]);
      add(new THREE.BoxGeometry(0.14, 0.018, 0.04), m.visor, [0, 0.155, 0.13]);
      add(new THREE.CylinderGeometry(0.13, 0.16, 0.08, 16, 1, true), m.chain, [0, 0.03, 0]); // ringbrynja över halsen
    } else if (kind === 2) {
      // Järnhatt med brätte
      face();
      add(new THREE.SphereGeometry(0.115, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.helm, [0, 0.16, 0], [1, 0.9, 1]);
      add(new THREE.CylinderGeometry(0.21, 0.21, 0.015, 20), m.helm, [0, 0.165, 0], [1, 1, 1], [0.05, 0, 0]);
    } else if (kind === 3) {
      // Hornhjälm
      add(new THREE.CylinderGeometry(0.115, 0.11, 0.2, 16), m.helm, [0, 0.13, 0]);
      add(new THREE.SphereGeometry(0.115, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.helm, [0, 0.23, 0]);
      add(new THREE.BoxGeometry(0.16, 0.025, 0.02), m.visor, [0, 0.16, 0.108]);
      const bone = this.mat(0xe8dcc0, 0.6, 0);
      for (const s of [1, -1]) {
        add(new THREE.ConeGeometry(0.035, 0.16, 8), bone, [0.13 * s, 0.25, 0], [1, 1, 1], [0, 0, -1.1 * s]);
        add(new THREE.ConeGeometry(0.022, 0.12, 8), bone, [0.2 * s, 0.33, 0], [1, 1, 1], [0, 0, -0.3 * s]);
      }
    } else if (kind === 4) {
      // Plymhjälm: rundad hjälm med nackskydd och en stor fjäderplym
      add(new THREE.SphereGeometry(0.125, 16, 12), m.helm, [0, 0.15, 0], [1, 0.95, 1.12]);
      add(new THREE.ConeGeometry(0.1, 0.18, 12), m.helm, [0, 0.08, -0.12], [1.2, 1, 0.5], [-Math.PI / 2 - 0.5, 0, 0]);
      add(new THREE.BoxGeometry(0.17, 0.02, 0.03), m.visor, [0, 0.15, 0.13]);
      const plume = [[0, 0.3, -0.02, 0.06], [0, 0.36, -0.07, 0.07], [0, 0.39, -0.14, 0.065], [0, 0.37, -0.21, 0.055], [0, 0.32, -0.26, 0.045]];
      plume.forEach(([x, y, z, r], i) => add(new THREE.SphereGeometry(r, 10, 8), i % 2 ? m.white : m.cloth, [x, y, z], [0.7, 1.3, 1]));
    } else if (kind === 5) {
      // Kastrull, med skaftet ut åt sidan
      face();
      const pot = this.mat(0x4a4d52, 0.45, 0.6);
      add(new THREE.CylinderGeometry(0.13, 0.125, 0.13, 18), pot, [0, 0.23, 0]);
      add(new THREE.TorusGeometry(0.128, 0.01, 6, 20), pot, [0, 0.165, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
      add(new THREE.BoxGeometry(0.26, 0.025, 0.035), m.wood, [0.25, 0.2, 0], [1, 1, 1], [0, 0, 0.15]);
    } else {
      // Tunnhjälm (standard)
      add(new THREE.CylinderGeometry(0.115, 0.11, 0.2, 16), m.helm, [0, 0.13, 0]);
      add(new THREE.SphereGeometry(0.115, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.helm, [0, 0.23, 0]);
      add(new THREE.BoxGeometry(0.16, 0.025, 0.02), m.visor, [0, 0.16, 0.108]); // ögonspringa
      add(new THREE.BoxGeometry(0.012, 0.08, 0.02), m.visor, [0, 0.1, 0.112]);  // andningsspringa
      add(new THREE.BoxGeometry(0.035, 0.07, 0.22), m.cloth, [0, 0.36, -0.01]); // hjälmkam
    }
  }

  // ---------- Sköldar ----------

  buildShield(kind, m) {
    const shield = new THREE.Group();
    const emblem = m.emblem || m.white;
    if (kind === 0 || kind === 3) {
      // Rund sköld, eller liten bucklare
      const r = kind === 3 ? 0.16 : 0.3;
      const geo = new THREE.CylinderGeometry(r, r, 0.04, 20);
      geo.rotateX(Math.PI / 2);
      shield.add(this.shape(geo, kind === 3 ? m.helm : m.cloth));
      shield.add(this.shape(new THREE.TorusGeometry(r, 0.018, 6, 24), m.helmDark));
      if (kind === 0) {
        shield.add(this.shape(new THREE.BoxGeometry(0.07, 0.4, 0.01), emblem, [0, 0, 0.025]));
        shield.add(this.shape(new THREE.BoxGeometry(0.3, 0.07, 0.01), emblem, [0, 0.04, 0.025]));
      }
      const boss = kind === 3 ? 0.08 : 0.05;
      shield.add(this.shape(new THREE.SphereGeometry(boss, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.helmDark, [0, 0, 0.02], [1, 1, 1], [Math.PI / 2, 0, 0]));
      return shield;
    }
    // Formade sköldar: framsida i spelarens färg och en mörk kant bakom
    const shape = shieldShape(kind === 4 ? 4 : kind);
    const front = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false });
    front.translate(0, 0, -0.015);
    shield.add(this.shape(front, m.cloth));
    const rim = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
    rim.translate(0, 0, -0.03);
    shield.add(this.shape(rim, m.helmDark, [0, 0, 0], [1.07, 1.05, 1]));
    if (kind === 4) {
      shield.add(this.shape(new THREE.BoxGeometry(0.06, 0.74, 0.03), m.helmDark, [0, 0, 0.02])); // mittås
      shield.add(this.shape(new THREE.BoxGeometry(0.06, 0.25, 0.01), emblem, [0, 0.12, 0.04]));
      shield.add(this.shape(new THREE.BoxGeometry(0.2, 0.06, 0.01), emblem, [0, 0.16, 0.04]));
    } else {
      const tall = kind === 1 ? 0.5 : 0.36;
      shield.add(this.shape(new THREE.BoxGeometry(0.06, tall, 0.01), emblem, [0, kind === 1 ? 0.0 : 0.0, 0.02]));
      shield.add(this.shape(new THREE.BoxGeometry(0.28, 0.06, 0.01), emblem, [0, 0.08, 0.02]));
    }
    return shield;
  }

  // ---------- Byggverktyg ----------

  mat(color, roughness, metalness) {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
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

  // En rundad arm- eller bendel som hänger nedåt från leden
  limbShape(radius, length, material) {
    return this.shape(new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius), 4, 12), material, [0, -length / 2, 0]);
  }

  segment(name, parent, pivot, points, radius) {
    const g = new THREE.Group();
    g.position.set(pivot[0], pivot[1], pivot[2]);
    g.userData = { segment: name, points, radius, detached: false };
    parent.add(g);
    this.seg[name] = g;
    return g;
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
    this.stumps.push({ object: parent, local: seg.position.clone(), time: 0 });
    if (LEG_JOINTS.includes(joint)) this.legLoss += 1;

    return this.makeRagdoll(this.subtree(seg), velocity, scene, bounds, 6);
  }

  // Hela riddaren blir en ragdoll (vid död). Riddaren själv ska inte användas efter detta.
  die(velocity, scene, bounds) {
    if (this.label) this.label.removeFromParent();
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

  // Var blöder stumparna? Anropar callback(position) för varje färsk stump.
  forEachBleedingStump(dt, callback) {
    const tmp = new THREE.Vector3();
    for (const s of this.stumps) {
      s.time += dt;
      if (s.time < 3) callback(tmp.copy(s.local).applyMatrix4(s.object.matrixWorld), s.time);
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
  // Stegen räknas ut från farten så att fötterna inte glider på marken.
  //
  // Först räknas en målvinkel ut för varje led (T), sedan glider lederna dit mjukt.

  animate(dt, motion = { speed: 0, forward: 0, side: 0, airborne: false }) {
    const k = 1 - Math.exp(-dt * 14);     // vanliga rörelser
    const kFast = 1 - Math.exp(-dt * 35); // slag, parering och spark ska vara skarpa
    this.time = (this.time || 0) + dt;
    const T = {}; // led -> [x, y, z, hastighet]
    const set = (name, x, y = 0, z = 0, speed = k) => (T[name] = [x, y, z, speed]);

    // Gester avbryts om man börjar röra sig eller slåss
    if (this.emote && (motion.speed > 0.8 || this.attack || this.kickT >= 0 || this.parryT >= 0 || this.charging)) this.emote = null;

    // ----- Gångcykel -----
    const speed = motion.airborne ? 0 : motion.speed;
    const run = Math.min(1, Math.max(0, (speed - 3.5) / 2.5)); // 0 = gå, 1 = spring
    const stride = lerp(1.35, 2.0, run);    // meter per hel cykel (två steg)
    const backwards = motion.forward < -0.3 && Math.abs(motion.forward) > Math.abs(motion.side);
    if (speed > 0.1) this.phase += ((speed * dt) / stride) * Math.PI * 2 * (backwards ? -1 : 1);
    const targetAmp = Math.min(1, speed / 3.5) * lerp(0.5, 0.8, run);
    this.amp += (targetAmp - this.amp) * (1 - Math.exp(-dt * 8));
    const amp = this.amp;

    let dirFwd = 1;
    let dirSide = 0;
    if (speed > 0.1) {
      const len = Math.hypot(motion.forward, motion.side) || 1;
      dirFwd = motion.forward / len;
      dirSide = motion.side / len;
      if (backwards) {
        dirFwd = -dirFwd;
        dirSide = -dirSide;
      }
    }

    const swing = Math.sin(this.phase) * amp;
    const liftL = Math.max(0, -Math.cos(this.phase)) * amp; // knät lyfts när benet svingar fram
    const liftR = Math.max(0, Math.cos(this.phase)) * amp;

    if (motion.airborne) {
      set("thighL", -0.55, 0, 0.05);
      set("thighR", -0.35, 0, -0.05);
      set("shinL", 0.9);
      set("shinR", 0.7);
      set("footL", -0.2);
      set("footR", -0.2);
    } else {
      set("thighL", swing * dirFwd * 0.95 - 0.04, 0, swing * dirSide * 0.45 + 0.03);
      set("thighR", -swing * dirFwd * 0.95 - 0.04, 0, -swing * dirSide * 0.45 - 0.03);
      set("shinL", liftL * 1.5 + 0.08);
      set("shinR", liftR * 1.5 + 0.08);
      set("footL", -swing * dirFwd * 0.3 - liftL * 0.5);
      set("footR", swing * dirFwd * 0.3 - liftR * 0.5);
    }

    let pelvisY = 1.0 + Math.abs(Math.cos(this.phase)) * 0.045 * amp - (motion.airborne ? 0.06 : 0.025 * Math.min(1, amp * 2));
    let pelvisRotY = Math.sin(this.phase) * 0.14 * amp * dirFwd;
    let pelvisRotZ = Math.sin(this.phase) * 0.05 * amp;

    // ----- Svärdsarmen: vila, laddning eller slag -----
    let pose = [REST_R[0] - swing * 0.35 * dirFwd, REST_R[1], REST_R[2] - Math.abs(swing) * 0.1, REST_R[3], REST_R[4]];
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
      }
    }
    set("upperArmR", pose[0], 0, pose[1], armK);
    set("forearmR", pose[2], 0, 0, armK);
    set("handR", pose[4], 0, 0, armK);

    // ----- Sköldarmen: vila eller parering -----
    let shield = [REST_L[0] + swing * 0.15 * dirFwd, REST_L[1], REST_L[2]];
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

    // ----- Bålen: lutar in i rörelsen, motvrids mot höfterna, andas, vacklar -----
    let lean = 0.05 * amp + 0.12 * run * dirFwd + Math.sin(this.time * 2.2) * 0.012;
    if (this.staggerT >= 0) {
      this.staggerT += dt;
      const d = COMBAT.parry.stagger;
      if (this.staggerT >= d) this.staggerT = -1;
      else lean -= 0.4 * Math.sin((this.staggerT / d) * Math.PI);
    }
    const counter = -Math.sin(this.phase) * 0.12 * amp * dirFwd;
    let torsoY = pose[3] + counter;
    let torsoZ = -dirSide * 0.06 * amp;
    let headX = null;
    let headY = null;

    // ----- Spark med höger ben -----
    if (this.kickT >= 0) {
      this.kickT += dt;
      if (this.kickT >= KICK_KEYS[KICK_KEYS.length - 1][0]) this.kickT = -1;
      else {
        const [thighX, kneeX, kickLean] = sampleKeys(KICK_KEYS, this.kickT);
        set("thighR", thighX, 0, -0.05, kFast);
        set("shinR", kneeX, 0, 0, kFast);
        set("footR", 0.3, 0, 0, kFast);
        set("thighL", 0.1, 0, 0.05, kFast);
        set("shinL", 0.25, 0, 0, kFast);
        lean += kickLean;
        set("upperArmL", -0.6, 0, 0.5, kFast); // armarna ut för balansen
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
        const w = Math.min(1, t / 0.25, (len - t) / 0.3); // tona in och ut
        const mix = (from, to) => lerp(from, to, w);
        if (this.emote.e === 1) {
          // Buga djupt med svärdet utsträckt åt sidan
          lean = mix(lean, 0.85);
          headX = mix(0, 0.35);
          set("upperArmR", mix(pose[0], -0.5), 0, mix(pose[1], -1.1));
          set("forearmR", mix(pose[2], -0.2));
          set("upperArmL", mix(shield[0], 0.2), 0, mix(shield[1], 0.3));
          set("forearmL", mix(shield[2], -1.6));
          set("thighR", mix(-0.04, 0.25));
          set("shinR", mix(0.08, 0.35));
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
          pelvisRotZ = mix(pelvisRotZ, Math.sin(beat * 0.5) * 0.2);
          pelvisY = mix(pelvisY, 0.97 + Math.abs(Math.sin(beat)) * 0.06);
          torsoY = mix(torsoY, Math.sin(beat * 0.5) * 0.35);
          headX = mix(0, Math.sin(beat) * 0.15);
        }
      }
    }

    set("torso", lean, torsoY, torsoZ, this.attack || this.kickT >= 0 ? kFast : k);
    set("head", headX ?? -lean * 0.5, headY ?? -counter * 0.7, 0);

    // ----- Flytta lederna mjukt mot målen -----
    for (const name in T) {
      const seg = this.seg[name];
      if (!seg || seg.userData.detached) continue;
      const [x, y, z, sp] = T[name];
      seg.rotation.x += (x - seg.rotation.x) * sp;
      seg.rotation.y += (y - seg.rotation.y) * sp;
      seg.rotation.z += (z - seg.rotation.z) * sp;
    }
    const pelvis = this.seg.pelvis;
    if (!pelvis.userData.detached) {
      pelvis.position.y += (pelvisY - pelvis.position.y) * k;
      pelvis.rotation.y += (pelvisRotY - pelvis.rotation.y) * k;
      pelvis.rotation.z += (pelvisRotZ - pelvis.rotation.z) * k;
    }

    // ----- Röd blinkning vid träff -----
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    const glow = this.flashT / 0.2;
    for (const mat of this.materials) {
      if (mat.emissive) mat.emissiveIntensity = glow;
    }
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj.isMesh && obj.geometry) obj.geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
    if (this.labelTexture) this.labelTexture.dispose();
    this.group.removeFromParent();
  }
}
