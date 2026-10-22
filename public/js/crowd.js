// PUBLIKEN, KUNGAPARET, VAKTERNA OCH HÄROLDEN
//
// Alla åskådare på alla läktare ritas tillsammans: en ritning per kroppsdel ("instansierad"),
// så att hundra detaljerade personer bara kostar ett tjugotal ritanrop för grafikkortet.
// Varje person har en osynlig liten "docka" (höft, bål, huvud, armar, ben) som rör sig,
// och dockans leder bestämmer var varje kroppsdel ritas.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ermineTexture, heraldryTexture } from "./textures.js";

const CLOTHES = [0x8a3b2e, 0x2e5a8a, 0x6b8a2e, 0x8a6b2e, 0x5a2e8a, 0x2e8a7a, 0x9a9a8a, 0x7a4a2a, 0xb07a3a, 0x4a4a5a, 0xa04a5a, 0x3a6a5a];
const NOBLE = [0x6a1a8a, 0x8a1a2a, 0x1a3a7a, 0x1a5a3a, 0x7a1a4a];
const HOSE = [0x4a3a2a, 0x3a3a4a, 0x5a4a3a, 0x2a2a2a, 0x6a2a2a, 0x2a4a3a];
const SKINS = [0xf2cfaa, 0xe6b890, 0xd09a6c, 0xa86e48, 0x7a4c2e];
const HAIRS = [0x23170e, 0x4a3018, 0x7a4e26, 0xc8a050, 0x9a3c18, 0x8c8a86, 0xd8d4cc];
const HAT_COLORS = [0x6a2e22, 0x2e3e6a, 0x3e5a2a, 0x5a4a2a, 0x7a2a5a, 0x2a2a2a, 0x8a6a2a];

function seededRandom(seed) {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Ge en ritning en egen nyans (vertex-färg): 1 = full färg, 0.4 = mörkare variant av samma färg
function tint(geo, value) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const [r, gg, b] = Array.isArray(value) ? value : [value, value, value];
  for (let i = 0; i < n; i++) {
    c[i * 3] = r;
    c[i * 3 + 1] = gg;
    c[i * 3 + 2] = b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}
function place(geo, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...scale),
  );
  return geo.applyMatrix4(m);
}
function part(geo, shade, pos, scale, rot) {
  return tint(place(geo, pos, scale, rot), shade);
}
function merge(parts) {
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------------------
// Kroppsdelarnas former (i personens egna koordinater, tittar mot +Z)
// ---------------------------------------------------------------------------
function buildShapes() {
  const S = {};
  // Bål: tunika med axlar, krage och bälte (mörkare)
  S.torso = merge([
    part(new THREE.CylinderGeometry(0.12, 0.16, 0.42, 10), 1, [0, 0.21, 0], [1.1, 1, 0.85]),
    part(new THREE.SphereGeometry(0.14, 10, 6), 1, [0, 0.39, 0], [1.3, 0.5, 0.85]),
    part(new THREE.CylinderGeometry(0.168, 0.168, 0.045, 12), 0.4, [0, 0.11, 0], [1.1, 1, 0.85]),
    part(new THREE.TorusGeometry(0.06, 0.018, 5, 12), 0.7, [0, 0.44, 0.01], [1, 1, 1], [Math.PI / 2, 0, 0]),
  ]);
  // Klänning upptill (snörliv med urringning)
  S.bodice = merge([
    part(new THREE.CylinderGeometry(0.11, 0.14, 0.42, 10), 1, [0, 0.21, 0], [1.1, 1, 0.85]),
    part(new THREE.SphereGeometry(0.13, 10, 6), 1, [0, 0.39, 0], [1.25, 0.45, 0.85]),
    part(new THREE.BoxGeometry(0.012, 0.22, 0.01), 0.35, [0, 0.27, 0.115]), // snörning
  ]);
  // Huvud med näsa och öron (hudfärg)
  S.head = merge([
    part(new THREE.CylinderGeometry(0.04, 0.045, 0.08, 8), 0.92, [0, 0.0, 0]),
    part(new THREE.SphereGeometry(0.1, 12, 10), 1, [0, 0.1, 0], [1, 1.1, 1.02]),
    part(new THREE.SphereGeometry(0.068, 10, 8), 1, [0, 0.058, 0.03], [1.05, 0.8, 1]),
    part(new THREE.BoxGeometry(0.02, 0.04, 0.03), 0.95, [0, 0.095, 0.1], [1, 1, 1], [-0.3, 0, 0]),
    part(new THREE.SphereGeometry(0.02, 6, 5), 0.9, [0.098, 0.1, 0], [0.5, 1, 0.8]),
    part(new THREE.SphereGeometry(0.02, 6, 5), 0.9, [-0.098, 0.1, 0], [0.5, 1, 0.8]),
  ]);
  // Ögon och ögonbryn (mörk färg)
  S.face = merge([
    part(new THREE.SphereGeometry(0.013, 6, 5), 1, [0.034, 0.118, 0.09], [1, 1, 0.6]),
    part(new THREE.SphereGeometry(0.013, 6, 5), 1, [-0.034, 0.118, 0.09], [1, 1, 0.6]),
    part(new THREE.BoxGeometry(0.03, 0.007, 0.01), 1, [0.035, 0.142, 0.094], [1, 1, 1], [0, 0, 0.12]),
    part(new THREE.BoxGeometry(0.03, 0.007, 0.01), 1, [-0.035, 0.142, 0.094], [1, 1, 1], [0, 0, -0.12]),
  ]);
  S.mouth = part(new THREE.SphereGeometry(0.02, 8, 6), 1, [0, 0, 0], [1.3, 1, 0.5]);
  // Arm (ärm med mörkare mudd) och hand
  S.arm = merge([
    part(new THREE.CapsuleGeometry(0.045, 0.22, 3, 8), 1, [0, -0.14, 0]),
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 8), 0.6, [0, -0.27, 0]),
  ]);
  S.hand = part(new THREE.SphereGeometry(0.038, 8, 6), 1, [0, -0.32, 0.005], [0.9, 1.1, 0.8]);
  // Ben: lår (hosor) och underben med sko (skon blir mörk)
  S.thigh = part(new THREE.CapsuleGeometry(0.06, 0.26, 3, 8), 1, [0, -0.18, 0]);
  S.shin = merge([
    part(new THREE.CapsuleGeometry(0.05, 0.28, 3, 8), 1, [0, -0.2, 0]),
    part(new THREE.SphereGeometry(0.06, 8, 6), 0.3, [0, -0.39, 0.04], [0.9, 0.6, 1.6]),
  ]);
  // Kjol (kvinnor): bredare lår och en klocka nedtill
  S.skirtThigh = part(new THREE.CapsuleGeometry(0.085, 0.24, 3, 8), 1, [0, -0.18, 0], [1.15, 1, 1]);
  S.skirtShin = merge([
    part(new THREE.CylinderGeometry(0.08, 0.12, 0.4, 10, 1, true), 1, [0, -0.2, 0]),
    part(new THREE.SphereGeometry(0.05, 8, 6), 0.3, [0, -0.4, 0.06], [0.9, 0.6, 1.4]),
  ]);
  // Hår: kort, långt (med fläta bak), krans runt flint (präster)
  S.hairShort = part(new THREE.SphereGeometry(0.105, 12, 6, 0, Math.PI * 2, 0, 1.5), 1, [0, 0.11, -0.006], [1.02, 1.08, 1.06]);
  S.hairLong = merge([
    part(new THREE.SphereGeometry(0.106, 12, 6, 0, Math.PI * 2, 0, 1.6), 1, [0, 0.11, -0.006], [1.03, 1.1, 1.08]),
    part(new THREE.BoxGeometry(0.17, 0.2, 0.05), 1, [0, 0.03, -0.075], [1, 1, 1], [0.12, 0, 0]),
  ]);
  S.tonsure = part(new THREE.TorusGeometry(0.09, 0.02, 6, 14), 1, [0, 0.13, 0], [1.05, 1.08, 1], [Math.PI / 2, 0, 0]);
  S.beard = merge([
    part(new THREE.SphereGeometry(0.06, 10, 6), 1, [0, 0.035, 0.05], [1.15, 0.9, 0.85]),
    part(new THREE.BoxGeometry(0.06, 0.012, 0.014), 1, [0, 0.075, 0.098]),
  ]);
  // Huvudbonader
  S.hood = merge([
    part(new THREE.ConeGeometry(0.135, 0.26, 10), 1, [0, 0.2, -0.04], [1, 1, 1], [-0.35, 0, 0]),
    part(new THREE.TorusGeometry(0.1, 0.04, 6, 12), 0.8, [0, 0.0, 0], [1.1, 1.1, 1], [Math.PI / 2, 0, 0]),
  ]);
  S.brim = merge([
    part(new THREE.CylinderGeometry(0.2, 0.2, 0.015, 14), 1, [0, 0.19, 0]),
    part(new THREE.CylinderGeometry(0.09, 0.11, 0.1, 12), 1, [0, 0.24, 0]),
    part(new THREE.CylinderGeometry(0.112, 0.112, 0.025, 12, 1, true), 0.4, [0, 0.205, 0]),
  ]);
  S.cap = part(new THREE.SphereGeometry(0.112, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 1, [0, 0.13, 0], [1, 0.9, 1.05]);
  S.beret = merge([
    part(new THREE.CylinderGeometry(0.14, 0.11, 0.05, 14), 0.6, [0.02, 0.21, 0], [1, 1, 1], [0, 0, -0.15]),
    part(new THREE.ConeGeometry(0.02, 0.22, 5), 1, [-0.07, 0.3, -0.04], [1, 1, 1], [0.2, 0, 0.7]),     // fjäder
  ]);
  S.wimple = merge([
    part(new THREE.SphereGeometry(0.115, 12, 8, 0, Math.PI * 2, 0, 1.7), 1, [0, 0.11, -0.01], [1.04, 1.1, 1.06]),
    part(new THREE.BoxGeometry(0.2, 0.22, 0.04), 1, [0, 0.04, -0.09], [1, 1, 1], [0.15, 0, 0]),
    part(new THREE.TorusGeometry(0.075, 0.02, 5, 12, Math.PI), 1, [0, 0.07, 0.01], [1, 1, 1.1], [Math.PI, 0, 0]), // hakband
  ]);
  S.hennin = merge([
    part(new THREE.ConeGeometry(0.07, 0.42, 10), 1, [0, 0.38, -0.06], [1, 1, 1], [-0.45, 0, 0]),
    part(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 12), 0.6, [0, 0.19, 0], [1, 1, 1], [-0.25, 0, 0]),
  ]);
  S.straw = merge([
    part(new THREE.CylinderGeometry(0.22, 0.22, 0.012, 14), 1, [0, 0.19, 0]),
    part(new THREE.CylinderGeometry(0.08, 0.1, 0.09, 12), 1, [0, 0.235, 0]),
  ]);
  // Saker i händerna
  S.kerchief = part(new THREE.PlaneGeometry(0.16, 0.14, 2, 1), 1, [0, -0.36, 0.06]);
  S.mug = merge([
    part(new THREE.CylinderGeometry(0.035, 0.038, 0.09, 8), 1, [0, -0.34, 0.06]),
    part(new THREE.TorusGeometry(0.022, 0.007, 4, 8), 0.7, [0.04, -0.34, 0.06], [1, 1, 1], [0, Math.PI / 2, 0]),
  ]);
  return S;
}

// ---------------------------------------------------------------------------
// Publiken
// spots: [{ pos: Vector3 (sitsens mitt i världen), yaw: vinkel (åt vilket håll personen tittar), row, step }]
// ---------------------------------------------------------------------------
export class Crowd {
  constructor(spots, seed = 5) {
    this.group = new THREE.Group();
    this.group.userData.noMerge = true;
    const rand = seededRandom(seed);
    const S = buildShapes();
    const material = (extra = {}) => new THREE.MeshStandardMaterial({ roughness: 0.88, vertexColors: true, ...extra });

    // Bestäm vilka som sitter var
    this.people = spots.map((spot, i) => {
      const r = rand();
      const front = spot.row === 0;
      let type = r < 0.38 ? "woman" : r < 0.48 ? "child" : r < 0.53 ? "priest" : "man";
      if (front && rand() < 0.35) type = rand() < 0.5 ? "noble" : "lady";
      const female = type === "woman" || type === "lady";
      const pick = (list) => list[Math.floor(rand() * list.length)];
      const clothes = type === "priest" ? pick([0x4a3a2a, 0x2a2a2a, 0x5a4a3a]) : type === "noble" || type === "lady" ? pick(NOBLE) : pick(CLOTHES);
      const hatRoll = rand();
      let hat = null;
      if (type === "man") hat = hatRoll < 0.25 ? "hood" : hatRoll < 0.45 ? "brim" : hatRoll < 0.6 ? "cap" : hatRoll < 0.7 ? "straw" : null;
      if (type === "child") hat = hatRoll < 0.3 ? "cap" : null;
      if (type === "woman") hat = hatRoll < 0.55 ? "wimple" : hatRoll < 0.7 ? "hood" : null;
      if (type === "lady") hat = hatRoll < 0.6 ? "hennin" : "wimple";
      if (type === "noble") hat = hatRoll < 0.7 ? "beret" : "brim";
      const styleRoll = rand();
      const style = styleRoll < 0.3 ? "clap" : styleRoll < 0.5 ? "kerchief" : styleRoll < 0.65 ? "mug" : styleRoll < 0.85 ? "fist" : "wave";
      return {
        index: i, spot, type, female, hat,
        hair: type === "priest" ? "tonsure" : female ? "long" : rand() < 0.15 ? null : "short",
        beard: !female && type !== "child" && rand() < 0.35,
        clothes, hose: female ? clothes : pick(HOSE), skin: pick(SKINS), hairColor: pick(HAIRS),
        hatColor: hat === "wimple" ? 0xf2efe6 : hat === "straw" ? 0xd9bf6a : hat === "hennin" ? pick([0xd9a521, 0xf2efe6, 0x8a1a2a]) : pick(HAT_COLORS),
        scale: type === "child" ? 0.72 : 0.92 + rand() * 0.16,
        phase: rand() * Math.PI * 2,
        speed: 0.6 + rand() * 1.0,
        eager: rand(),                 // hur lätt personen reser sig och jublar
        style: type === "priest" && style !== "clap" ? "fist" : style,
        look: 0, stand: 0, throwT: -1,
      };
    });

    // En ritning per kroppsdel och sort
    const n = this.people.length;
    const inst = (geo, count, mat = material()) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
      m.count = count;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    const men = this.people.filter((p) => !p.female);
    const women = this.people.filter((p) => p.female);
    men.forEach((p, k) => (p.mi = k));
    women.forEach((p, k) => (p.wi = k));
    this.mesh = {
      torso: inst(S.torso, men.length),
      bodice: inst(S.bodice, women.length),
      head: inst(S.head, n),
      face: inst(S.face, n, material({ roughness: 0.5 })),
      mouth: inst(S.mouth, n, material({ roughness: 0.6 })),
      arm: inst(S.arm, n * 2),
      hand: inst(S.hand, n * 2),
      thigh: inst(S.thigh, men.length * 2),
      shin: inst(S.shin, men.length * 2),
      skirtThigh: inst(S.skirtThigh, women.length * 2),
      skirtShin: inst(S.skirtShin, women.length * 2, material({ side: THREE.DoubleSide })),
    };
    // Hår, skägg, hattar och saker: bara för dem som har dem
    this.extras = [];
    const extra = (geo, owners, colorOf, attach, mat) => {
      if (owners.length === 0) return;
      const m = inst(geo, owners.length, mat);
      owners.forEach((p, k) => {
        m.setColorAt(k, new THREE.Color(colorOf(p)));
        (p.extras ||= []).push({ mesh: m, k, attach });
      });
      this.extras.push({ mesh: m, owners, attach });
    };
    const P = this.people;
    extra(S.hairShort, P.filter((p) => p.hair === "short" && !["wimple", "hood", "hennin"].includes(p.hat)), (p) => p.hairColor, "head");
    extra(S.hairLong, P.filter((p) => p.hair === "long" && !["wimple", "hennin"].includes(p.hat)), (p) => p.hairColor, "head");
    extra(S.tonsure, P.filter((p) => p.hair === "tonsure"), (p) => p.hairColor, "head");
    extra(S.beard, P.filter((p) => p.beard), (p) => p.hairColor, "head");
    for (const hat of ["hood", "brim", "cap", "beret", "wimple", "hennin", "straw"]) {
      extra(S[hat], P.filter((p) => p.hat === hat), (p) => p.hatColor, "head", material({ side: THREE.DoubleSide }));
    }
    extra(S.kerchief, P.filter((p) => p.style === "kerchief"), () => 0xf2efe6, "armR", material({ side: THREE.DoubleSide }));
    extra(S.mug, P.filter((p) => p.style === "mug"), (p) => (p.index % 2 ? 0x8a8e94 : 0x7a5434), "armR", material({ metalness: 0.3, roughness: 0.5 }));

    // Fasta färger
    for (const p of P) {
      const i = p.index;
      const clothes = new THREE.Color(p.clothes);
      if (p.female) this.mesh.bodice.setColorAt(p.wi, clothes);
      else this.mesh.torso.setColorAt(p.mi, clothes);
      this.mesh.head.setColorAt(i, new THREE.Color(p.skin));
      this.mesh.face.setColorAt(i, new THREE.Color(0x2a1a12));
      this.mesh.mouth.setColorAt(i, new THREE.Color(0x4a1410));
      for (const s of [0, 1]) {
        this.mesh.arm.setColorAt(i * 2 + s, clothes);
        this.mesh.hand.setColorAt(i * 2 + s, new THREE.Color(p.skin));
        if (p.female) {
          this.mesh.skirtThigh.setColorAt(p.wi * 2 + s, clothes);
          this.mesh.skirtShin.setColorAt(p.wi * 2 + s, clothes);
        } else {
          this.mesh.thigh.setColorAt(p.mi * 2 + s, new THREE.Color(p.hose));
          this.mesh.shin.setColorAt(p.mi * 2 + s, new THREE.Color(p.hose));
        }
      }
    }

    // Dockan som används för att räkna ut var delarna hamnar
    const d = {};
    d.root = new THREE.Object3D();
    d.torso = new THREE.Object3D();
    d.head = new THREE.Object3D();
    d.mouth = new THREE.Object3D();
    d.armL = new THREE.Object3D();
    d.armR = new THREE.Object3D();
    d.thighL = new THREE.Object3D();
    d.thighR = new THREE.Object3D();
    d.shinL = new THREE.Object3D();
    d.shinR = new THREE.Object3D();
    d.root.add(d.torso, d.thighL, d.thighR);
    d.torso.add(d.head, d.armL, d.armR);
    d.head.add(d.mouth);
    d.thighL.add(d.shinL);
    d.thighR.add(d.shinR);
    d.head.position.set(0, 0.46, 0.01);
    d.mouth.position.set(0, 0.066, 0.088);
    d.armL.position.set(0.18, 0.38, 0);
    d.armR.position.set(-0.18, 0.38, 0);
    d.thighL.position.set(0.08, 0.02, 0.02);
    d.thighR.position.set(-0.08, 0.02, 0.02);
    d.shinL.position.set(0, -0.36, 0);
    d.shinR.position.set(0, -0.36, 0);
    this.d = d;
    this.focus = new THREE.Vector3();
    this.throwQueue = [];
    this.update(0, 0, 0);
  }

  // Alla tittar mot den här punkten (där striden pågår)
  setFocus(v) {
    this.focus.copy(v);
  }

  update(dt, time, excitement) {
    const d = this.d;
    const cheer = Math.min(1, excitement);
    const M = this.mesh;
    const handPos = new THREE.Vector3();
    for (const p of this.people) {
      const i = p.index;
      const t = time * p.speed + p.phase;
      const spot = p.spot;
      // Reser sig vid häftiga händelser (de ivrigaste först)
      const wantStand = cheer > 0.25 + p.eager * 0.6 ? 1 : 0;
      p.stand += (wantStand - p.stand) * Math.min(1, dt * (wantStand ? 6 : 2.5));
      const stand = p.stand;
      const sit = 1 - stand;
      // Tittar mot striden (med lite eget huvudvridande)
      const dx = this.focus.x - spot.pos.x;
      const dz = this.focus.z - spot.pos.z;
      let rel = Math.atan2(dx, dz) - spot.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const lookTarget = Math.max(-1.1, Math.min(1.1, rel)) + Math.sin(t * 0.37) * 0.12;
      p.look += (lookTarget - p.look) * Math.min(1, dt * 3);

      const hop = cheer > 0.05 ? Math.max(0, Math.sin(time * 8 * (0.7 + p.eager * 0.6) + p.phase)) * 0.08 * cheer * stand : 0;
      d.root.position.set(spot.pos.x, spot.pos.y + stand * 0.72 * p.scale + hop, spot.pos.z);
      d.root.rotation.set(0, spot.yaw + p.look * 0.25, 0);
      d.root.scale.setScalar(p.scale);
      d.torso.rotation.set(0.12 * cheer * sit + Math.sin(t) * 0.03 - stand * 0.05, p.look * 0.25, Math.sin(t * 0.7) * 0.04);
      d.head.rotation.set(Math.sin(t * 0.9) * 0.06 - cheer * 0.25, p.look * 0.5, Math.sin(t * 0.5) * 0.05);
      d.mouth.scale.set(1, 0.25 + cheer * (0.8 + Math.abs(Math.sin(time * 6 + p.phase)) * 0.6) + (p.throwT >= 0 ? 0.6 : 0), 1);
      // Benen: sittande lår framåt och underben rakt ner; stående: raka ben
      const spread = 0.06 + cheer * 0.05;
      d.thighL.rotation.set(-Math.PI / 2 * sit, 0, spread);
      d.thighR.rotation.set(-Math.PI / 2 * sit, 0, -spread);
      d.shinL.rotation.set(Math.PI / 2 * sit + (sit > 0.5 ? Math.sin(t * 1.3) * 0.08 : 0), 0, -spread);
      d.shinR.rotation.set(Math.PI / 2 * sit, 0, spread);

      // Armarna efter personens sätt att jubla
      const rest = 0.12;
      let lx = -0.35 * sit, lz = rest, rx = -0.35 * sit, rz = -rest;
      if (p.style === "clap") {
        const clap = Math.abs(Math.sin(time * 12 + p.phase)) * 0.45;
        const c = Math.max(cheer, 0.15 * (Math.sin(t * 0.4) > 0.9 ? 1 : 0));
        lx = lerp(lx, -1.35, c); lz = lerp(rest, 0.15 + clap, c);
        rx = lerp(rx, -1.35, c); rz = lerp(-rest, -0.15 - clap, c);
      } else if (p.style === "kerchief" || p.style === "wave") {
        const wave = Math.sin(time * 10 + p.phase) * 0.4;
        rx = lerp(rx, -2.8 + wave * 0.3, cheer); rz = lerp(-rest, -0.3 + wave, cheer);
        if (p.style === "wave") { lx = lerp(lx, -2.6, cheer); lz = lerp(rest, 0.4 - wave, cheer); }
      } else if (p.style === "mug") {
        rx = lerp(-1.0, -2.9, cheer); rz = lerp(-0.25, -0.15, cheer); // sejdeln i handen, höjs vid jubel
      } else {
        const pump = Math.max(0, Math.sin(time * 9 + p.phase)) * 0.5;
        rx = lerp(rx, -2.6 - pump, cheer); rz = lerp(-rest, -0.2, cheer);
      }
      // Kast: armen bakåt, sedan snabbt framåt
      if (p.throwT >= -1 && p.throwKind) {
        p.throwT += dt;
        if (p.throwT >= 0) {
          const k = p.throwT;
          if (k < 0.25) rx = lerp(rx, -3.2, k / 0.25);
          else if (k < 0.4) rx = lerp(-3.2, -0.9, (k - 0.25) / 0.15);
          else rx = lerp(-0.9, rx, Math.min(1, (k - 0.4) / 0.3));
          if (k >= 0.33 && !p.thrown) {
            p.thrown = true;
            d.root.updateMatrixWorld(true);
            handPos.set(0, -0.32, 0.05).applyMatrix4(d.armR.matrixWorld);
            p.throwables?.launch(p.throwKind, handPos, p.throwTarget);
          }
          if (k > 0.8) {
            p.throwT = -1;
            p.throwKind = null;
          }
        }
      }
      d.armL.rotation.set(lx, 0, lz);
      d.armR.rotation.set(rx, 0, rz);

      d.root.updateMatrixWorld(true);
      if (p.female) M.bodice.setMatrixAt(p.wi, d.torso.matrixWorld);
      else M.torso.setMatrixAt(p.mi, d.torso.matrixWorld);
      M.head.setMatrixAt(i, d.head.matrixWorld);
      M.face.setMatrixAt(i, d.head.matrixWorld);
      M.mouth.setMatrixAt(i, d.mouth.matrixWorld);
      M.arm.setMatrixAt(i * 2, d.armL.matrixWorld);
      M.arm.setMatrixAt(i * 2 + 1, d.armR.matrixWorld);
      M.hand.setMatrixAt(i * 2, d.armL.matrixWorld);
      M.hand.setMatrixAt(i * 2 + 1, d.armR.matrixWorld);
      if (p.female) {
        M.skirtThigh.setMatrixAt(p.wi * 2, d.thighL.matrixWorld);
        M.skirtThigh.setMatrixAt(p.wi * 2 + 1, d.thighR.matrixWorld);
        M.skirtShin.setMatrixAt(p.wi * 2, d.shinL.matrixWorld);
        M.skirtShin.setMatrixAt(p.wi * 2 + 1, d.shinR.matrixWorld);
      } else {
        M.thigh.setMatrixAt(p.mi * 2, d.thighL.matrixWorld);
        M.thigh.setMatrixAt(p.mi * 2 + 1, d.thighR.matrixWorld);
        M.shin.setMatrixAt(p.mi * 2, d.shinL.matrixWorld);
        M.shin.setMatrixAt(p.mi * 2 + 1, d.shinR.matrixWorld);
      }
      for (const e of p.extras || []) e.mesh.setMatrixAt(e.k, d[e.attach].matrixWorld);
    }
    for (const m of [...Object.values(M), ...this.extras.map((e) => e.mesh)]) m.instanceMatrix.needsUpdate = true;
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}


// ---------------------------------------------------------------------------
// Kungen, drottningen, vakterna och härolden: egna, rörliga figurer
// ---------------------------------------------------------------------------
function figureMat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
}

function addMesh(parent, geo, mat, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Gemensamma material för enfärgade delar (färgen sparas i formen)
let VC_PLAIN = null;
let VC_METAL = null;
function vcMaterial(kind) {
  if (!VC_PLAIN) {
    VC_PLAIN = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    VC_METAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.82 });
  }
  return kind === "metal" ? VC_METAL : VC_PLAIN;
}

// Slå ihop alla småbitar i varje led till så få ritningar som möjligt, utom de som ska röra sig själva.
// Enfärgade delar får sin färg i formen och delar material; delar med bilder behåller sitt eget.
export function mergeFigure(root) {
  const groups = [];
  root.traverse((o) => {
    if (!o.isMesh) groups.push(o);
  });
  for (const g of groups) {
    const buckets = new Map();
    for (const child of [...g.children]) {
      if (!child.isMesh || child.userData.keep) continue;
      child.updateMatrix();
      const geo = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()).applyMatrix4(child.matrix);
      const src = child.material;
      let material = src;
      if (!src.map && !src.transparent && !src.vertexColors && src.side === THREE.FrontSide) {
        material = vcMaterial(src.metalness >= 0.3 ? "metal" : "plain");
        const n = geo.attributes.position.count;
        const colors = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          colors[i * 3] = src.color.r;
          colors[i * 3 + 1] = src.color.g;
          colors[i * 3 + 2] = src.color.b;
        }
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      }
      const keep = material.vertexColors ? ["position", "normal", "uv", "color"] : ["position", "normal", "uv"];
      for (const key of Object.keys(geo.attributes)) if (!keep.includes(key)) geo.deleteAttribute(key);
      if (!buckets.has(material)) buckets.set(material, []);
      buckets.get(material).push(geo);
      g.remove(child);
    }
    for (const [material, geos] of buckets) {
      const m = new THREE.Mesh(geos.length === 1 ? geos[0] : mergeGeometries(geos), material);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
  }
}

// En figur med leder. opts: robe, skin, hair, beard, crown ("king"/"queen"), sitting, dress
function makeFigure(opts) {
  const f = {};
  const robe = figureMat(opts.robe);
  const skin = figureMat(opts.skin, { roughness: 0.7 });
  const hair = figureMat(opts.hair ?? 0x4a3018, { roughness: 0.9 });
  const dark = figureMat(0x1e120c);
  const gold = figureMat(0xd8ae42, { metalness: 0.85, roughness: 0.3 });
  const trimMat = opts.ermine ? figureMat(0xffffff, { map: ermineTexture() }) : figureMat(opts.trim ?? 0x3a2a1a);
  f.group = new THREE.Group();
  f.root = new THREE.Group();
  f.group.add(f.root);
  f.torso = new THREE.Group();
  f.root.add(f.torso);
  // Bål och kläder
  addMesh(f.torso, new THREE.CylinderGeometry(0.15, 0.19, 0.5, 14), robe, [0, 0.25, 0], [1.1, 1, 0.85]);
  addMesh(f.torso, new THREE.SphereGeometry(0.16, 12, 6), robe, [0, 0.47, 0], [1.35, 0.5, 0.85]);
  if (opts.tabard) {
    const tab = figureMat(0xffffff, { map: heraldryTexture(opts.tabard), side: THREE.DoubleSide });
    addMesh(f.torso, new THREE.PlaneGeometry(0.3, 0.5), tab, [0, 0.25, 0.165]);
    addMesh(f.torso, new THREE.PlaneGeometry(0.3, 0.5), tab, [0, 0.25, -0.165], [1, 1, 1], [0, Math.PI, 0]);
  }
  if (opts.ermine) {
    // Mantel med hermelinkrage
    addMesh(f.torso, new THREE.TorusGeometry(0.15, 0.05, 8, 16), trimMat, [0, 0.47, 0], [1.25, 1, 0.9], [Math.PI / 2, 0, 0]);
    addMesh(f.torso, new THREE.CylinderGeometry(0.2, 0.32, 0.9, 14, 1, true, Math.PI * 0.6, Math.PI * 0.8), robe, [0, 0.12, -0.02]);
  }
  addMesh(f.torso, new THREE.CylinderGeometry(0.195, 0.195, 0.05, 14), opts.ermine ? gold : dark, [0, 0.12, 0], [1.1, 1, 0.85]); // bälte
  // Huvud
  f.head = new THREE.Group();
  f.head.position.set(0, 0.55, 0.01);
  f.torso.add(f.head);
  addMesh(f.head, new THREE.CylinderGeometry(0.05, 0.055, 0.08, 8), skin, [0, 0.01, 0]);
  addMesh(f.head, new THREE.SphereGeometry(0.11, 14, 10), skin, [0, 0.12, 0], [1, 1.1, 1.03]);
  addMesh(f.head, new THREE.BoxGeometry(0.022, 0.045, 0.032), skin, [0, 0.115, 0.11], [1, 1, 1], [-0.3, 0, 0]);
  for (const s of [1, -1]) {
    addMesh(f.head, new THREE.SphereGeometry(0.014, 6, 5), dark, [0.037 * s, 0.14, 0.098], [1, 1, 0.6]);
    addMesh(f.head, new THREE.BoxGeometry(0.034, 0.008, 0.01), hair, [0.038 * s, 0.166, 0.103], [1, 1, 1], [0, 0, 0.15 * s]);
  }
  f.mouth = addMesh(f.head, new THREE.SphereGeometry(0.02, 8, 6), figureMat(0x4a1410), [0, 0.072, 0.098], [1.3, 0.3, 0.5]);
  f.mouth.userData.keep = true;
  addMesh(f.head, new THREE.SphereGeometry(0.116, 12, 6, 0, Math.PI * 2, 0, 1.5), hair, [0, 0.128, -0.006], [1.02, 1.08, 1.06]);
  if (opts.long) addMesh(f.head, new THREE.BoxGeometry(0.19, 0.24, 0.05), hair, [0, 0.05, -0.08], [1, 1, 1], [0.12, 0, 0]);
  if (opts.beard) addMesh(f.head, new THREE.SphereGeometry(0.07, 10, 8), hair, [0, 0.035, 0.05], [1.15, 1.05, 0.85]);
  if (opts.crown) {
    const r = opts.crown === "king" ? 0.112 : 0.095;
    addMesh(f.head, new THREE.CylinderGeometry(r, r, 0.05, 16, 1, true), gold, [0, 0.215, 0], [1, 1, 1], [0, 0, 0]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      addMesh(f.head, new THREE.ConeGeometry(0.018, 0.06, 4), gold, [Math.sin(a) * r, 0.265, Math.cos(a) * r]);
      addMesh(f.head, new THREE.SphereGeometry(0.01, 5, 4), figureMat(i % 2 ? 0xc01a2a : 0x1a4ac0, { roughness: 0.2 }), [Math.sin(a) * (r + 0.004), 0.215, Math.cos(a) * (r + 0.004)]);
    }
    if (opts.crown === "king") addMesh(f.head, new THREE.SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, 0, 1.2), figureMat(0x8a1a2a), [0, 0.19, 0]); // sammetsmössa i kronan
  }
  if (opts.hat === "kettle") {
    const steel = figureMat(0xa8aeb6, { metalness: 0.8, roughness: 0.35 });
    addMesh(f.head, new THREE.SphereGeometry(0.125, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), steel, [0, 0.15, 0]);
    addMesh(f.head, new THREE.CylinderGeometry(0.22, 0.22, 0.012, 16), steel, [0, 0.15, 0]);
  } else if (opts.hat === "beret") {
    addMesh(f.head, new THREE.CylinderGeometry(0.15, 0.12, 0.05, 14), figureMat(opts.robe), [0.02, 0.22, 0], [1, 1, 1], [0, 0, -0.15]);
    addMesh(f.head, new THREE.ConeGeometry(0.022, 0.26, 5), figureMat(0xf2efe6), [-0.08, 0.32, -0.04], [1, 1, 1], [0.2, 0, 0.7]);
  }
  // Armar (med händer)
  for (const s of [1, -1]) {
    const arm = new THREE.Group();
    arm.position.set(0.21 * s, 0.45, 0);
    f.torso.add(arm);
    addMesh(arm, new THREE.CapsuleGeometry(0.05, 0.22, 3, 8), robe, [0, -0.15, 0]);
    const fore = new THREE.Group();
    fore.position.set(0, -0.3, 0);
    arm.add(fore);
    addMesh(fore, new THREE.CapsuleGeometry(0.045, 0.2, 3, 8), robe, [0, -0.12, 0]);
    if (opts.ermine) addMesh(fore, new THREE.TorusGeometry(0.05, 0.02, 5, 10), trimMat, [0, -0.22, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
    const hand = new THREE.Group();
    hand.position.set(0, -0.27, 0);
    fore.add(hand);
    addMesh(hand, new THREE.SphereGeometry(0.042, 8, 6), skin, [0, -0.02, 0], [0.9, 1.1, 0.8]);
    f[s > 0 ? "armL" : "armR"] = arm;
    f[s > 0 ? "foreL" : "foreR"] = fore;
    f[s > 0 ? "handL" : "handR"] = hand;
  }
  // Tumme på höger hand (för tummen upp/ner)
  f.thumb = addMesh(f.handR, new THREE.CapsuleGeometry(0.014, 0.04, 2, 6), skin, [0.0, -0.02, 0.045], [1, 1, 1], [Math.PI / 2, 0, 0]);
  f.thumb.visible = false;
  f.thumb.userData.keep = true;
  // Ben och skor (en lång klänning/mantel döljer benen på kungaparet)
  for (const s of [1, -1]) {
    const thigh = new THREE.Group();
    thigh.position.set(0.09 * s, 0.02, 0.02);
    f.root.add(thigh);
    addMesh(thigh, new THREE.CapsuleGeometry(opts.dress ? 0.1 : 0.065, 0.3, 3, 8), opts.dress ? robe : figureMat(opts.hose ?? 0x3a2a1a), [0, -0.2, 0]);
    const shin = new THREE.Group();
    shin.position.set(0, -0.4, 0);
    thigh.add(shin);
    addMesh(shin, opts.dress ? new THREE.CylinderGeometry(0.1, 0.15, 0.42, 12, 1, true) : new THREE.CapsuleGeometry(0.055, 0.3, 3, 8), opts.dress ? robe : figureMat(opts.hose ?? 0x3a2a1a, { side: THREE.DoubleSide }), [0, -0.21, 0]);
    addMesh(shin, new THREE.SphereGeometry(0.06, 8, 6), dark, [0, -0.42, 0.05], [0.9, 0.6, 1.6]);
    f[s > 0 ? "thighL" : "thighR"] = thigh;
    f[s > 0 ? "shinL" : "shinR"] = shin;
  }
  f.setSitting = (amount) => {
    for (const s of ["L", "R"]) {
      f["thigh" + s].rotation.x = (-Math.PI / 2) * amount;
      f["shin" + s].rotation.x = (Math.PI / 2) * amount;
    }
    f.root.position.y = (1 - amount) * 0.78;
  };
  f.setSitting(opts.sitting ? 1 : 0);
  return f;
}

// Bygger kungaparet, två vakter och en härold. Placeras i kungalogen av arenan.
export function makeRoyals() {
  const king = makeFigure({ robe: 0x7a1a2a, skin: 0xe6b890, hair: 0xb8b4ac, beard: true, crown: "king", ermine: true, sitting: true, dress: true });
  const queen = makeFigure({ robe: 0x3a1a6a, skin: 0xf2cfaa, hair: 0x9a5a28, long: true, crown: "queen", ermine: true, sitting: true, dress: true });
  // Spira i kungens vänstra hand
  const gold = figureMat(0xd8ae42, { metalness: 0.85, roughness: 0.3 });
  addMesh(king.handL, new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), gold, [0, -0.02, 0.2], [1, 1, 1], [Math.PI / 2 - 0.4, 0, 0]);
  addMesh(king.handL, new THREE.SphereGeometry(0.035, 8, 6), gold, [0, 0.07, 0.43]);
  king.armL.rotation.set(-0.5, 0, 0.1);
  king.foreL.rotation.set(-0.9, 0, 0);
  queen.armR.rotation.set(-0.4, 0, -0.1);
  queen.foreR.rotation.set(-0.9, 0, 0);
  queen.armL.rotation.set(-0.4, 0, 0.1);
  queen.foreL.rotation.set(-0.9, 0, 0);
  king.armR.rotation.set(-0.4, 0, -0.1);
  king.foreR.rotation.set(-0.8, 0, 0);

  const guards = [0, 1].map(() => {
    const g = makeFigure({ robe: 0x2f5fb3, skin: 0xd09a6c, hair: 0x23170e, beard: Math.random() < 0.5, hat: "kettle", tabard: 0x2f5fb3, hose: 0x4a4a52 });
    // Hillebard: lång stång med yxblad, spets och krok
    const wood = figureMat(0x6a4a2c);
    const steel = figureMat(0xb6bcc4, { metalness: 0.8, roughness: 0.35 });
    const halberd = new THREE.Group();
    addMesh(halberd, new THREE.CylinderGeometry(0.016, 0.018, 2.2, 6), wood, [0, 0.9, 0]);
    addMesh(halberd, new THREE.ConeGeometry(0.025, 0.25, 4), steel, [0, 2.1, 0]);
    addMesh(halberd, new THREE.BoxGeometry(0.01, 0.2, 0.16), steel, [0, 1.85, 0.09]);
    addMesh(halberd, new THREE.ConeGeometry(0.02, 0.12, 4), steel, [0, 1.9, -0.06], [1, 1, 1], [-Math.PI / 2, 0, 0]);
    halberd.position.set(0, -0.08, 0.05);
    g.handR.add(halberd);
    g.armR.rotation.set(-0.35, 0, -0.15);
    g.foreR.rotation.set(-1.1, 0, 0);
    g.halberd = halberd;
    return g;
  });

  const herald = makeFigure({ robe: 0xd9a521, skin: 0xe6b890, hair: 0x7a4e26, hat: "beret", tabard: 0xb8322f, hose: 0xb8322f });
  // Lång trumpet med en liten fana
  const brass = figureMat(0xd8ae42, { metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide });
  const trumpet = new THREE.Group();
  addMesh(trumpet, new THREE.CylinderGeometry(0.008, 0.008, 0.8, 6), brass, [0, 0.4, 0]);
  addMesh(trumpet, new THREE.CylinderGeometry(0.06, 0.008, 0.16, 12, 1, true), brass, [0, 0.86, 0]);
  addMesh(trumpet, new THREE.PlaneGeometry(0.22, 0.26), figureMat(0xffffff, { map: heraldryTexture(0xb8322f, 2), side: THREE.DoubleSide }), [0.0, 0.5, 0.0], [1, 1, 1], [0, Math.PI / 2, 0]);
  trumpet.position.set(0, -0.03, 0.03);
  trumpet.rotation.x = 1.5;
  herald.handR.add(trumpet);
  herald.trumpet = trumpet;

  for (const f of [king, queen, herald, ...guards]) mergeFigure(f.group);

  const state = { reactT: -1, up: true, blowT: -1, time: 0 };

  const update = (dt) => {
    state.time += dt;
    const t = state.time;
    // Andning och små rörelser
    for (const [i, f] of [king, queen, herald].entries()) {
      f.torso.rotation.x = Math.sin(t * 1.3 + i) * 0.02;
      f.head.rotation.y = Math.sin(t * 0.4 + i * 1.7) * 0.25;
    }
    // Kungen reser sig och visar tummen upp eller ner
    let stand = 0;
    king.thumb.visible = false;
    if (state.reactT >= 0) {
      state.reactT += dt;
      const k = state.reactT;
      stand = k < 0.4 ? k / 0.4 : k > 2.4 ? Math.max(0, 1 - (k - 2.4) / 0.5) : 1;
      if (k > 2.9) state.reactT = -1;
      const arm = Math.min(1, Math.max(0, (k - 0.3) / 0.3)) * (k > 2.2 ? Math.max(0, 1 - (k - 2.2) / 0.3) : 1);
      king.armR.rotation.set(lerp(-0.4, -1.5, arm), 0, lerp(-0.1, -0.2, arm));
      king.foreR.rotation.set(lerp(-0.8, -0.1, arm), 0, 0);
      king.handR.rotation.set(0, 0, state.up ? 0 : Math.PI);
      king.thumb.visible = arm > 0.5;
      king.thumb.position.set(0, state.up ? 0.03 : -0.06, 0.0);
      king.thumb.rotation.set(0, 0, 0);
      king.mouth.scale.y = 0.3 + arm * 0.8;
      // Drottningen klappar
      const clap = Math.abs(Math.sin(t * 11)) * 0.4;
      queen.armL.rotation.set(-1.2, 0, 0.15 + clap);
      queen.armR.rotation.set(-1.2, 0, -0.15 - clap);
      queen.foreL.rotation.set(-0.4, 0, 0);
      queen.foreR.rotation.set(-0.4, 0, 0);
    } else {
      king.armR.rotation.set(-0.4, 0, -0.1);
      king.foreR.rotation.set(-0.8, 0, 0);
      king.handR.rotation.set(0, 0, 0);
      king.mouth.scale.y = 0.3;
      queen.armL.rotation.set(-0.4, 0, 0.1);
      queen.armR.rotation.set(-0.4, 0, -0.1);
      queen.foreL.rotation.set(-0.9, 0, 0);
      queen.foreR.rotation.set(-0.9, 0, 0);
    }
    king.setSitting(1 - stand);
    // Härolden lyfter trumpeten till munnen och blåser
    if (state.blowT >= 0) {
      state.blowT += dt;
      const k = state.blowT;
      const up = k < 0.3 ? k / 0.3 : k > 1.6 ? Math.max(0, 1 - (k - 1.6) / 0.3) : 1;
      if (k > 1.9) state.blowT = -1;
      // Handen förs upp framför munnen och trumpeten pekar framåt och lite uppåt
      herald.armR.rotation.set(lerp(-0.4, -1.5, up), 0, lerp(-0.15, 0.2, up));
      herald.foreR.rotation.set(lerp(-1.0, -1.3, up), 0, 0);
      herald.trumpet.rotation.set(lerp(1.5, 4.1, up), 0, 0);
      herald.torso.rotation.x = -0.12 * up;
      herald.head.rotation.x = -0.1 * up;
    } else {
      herald.armR.rotation.set(-0.4, 0, -0.15);
      herald.foreR.rotation.set(-1.0, 0, 0);
      herald.trumpet.rotation.set(1.5, 0, 0);
    }
  };

  return {
    king, queen, guards, herald, update,
    react(up) {
      state.reactT = 0;
      state.up = up;
    },
    blow() {
      state.blowT = 0;
    },
  };
}
