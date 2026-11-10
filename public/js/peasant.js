// BONDEN – kläder i lager: vadderad tunika, yllesjal med spänne, rem över bröstet, brett bälte
// med väskor, stickade ärmar med läderskydd, pösiga byxor och rejäla stövlar med korsade remmar.

import * as THREE from "three";
import { paddedTexture, paddedBumpTexture, knitTexture, coarseWoolTexture, leatherTexture } from "./textures.js";
import { shoeParts } from "./body.js";

export function peasantMaterials(k, m) {
  m.padded = k.mat(0xdccba6, 0.95, 0, { map: paddedTexture(), bumpMap: paddedBumpTexture(), bumpScale: 3.5, side: THREE.DoubleSide });
  m.knit = k.mat(0xcdbb96, 0.98, 0, { map: knitTexture(), bumpMap: knitTexture(), bumpScale: 1.6 });
  m.shawl = k.mat(0x62432e, 0.98, 0, { map: coarseWoolTexture(), bumpMap: coarseWoolTexture(), bumpScale: 1.2, side: THREE.DoubleSide });
  m.trouser = k.mat(0x5c4635, 0.97, 0, { map: coarseWoolTexture() });
  m.boot = k.mat(0x6e4528, 0.74, 0, { map: leatherTexture() });
  m.belt = k.mat(0x5a3820, 0.7, 0, { map: leatherTexture() });
  // Pösigare ärmar och byxben (själva skinnet görs tjockare, se buildSkin)
  k.skinExtra = { upperArm: 0.007, forearm: 0.003, thigh: 0.006, shin: 0.012 };
}

// Sjalen: en yta som ligger från halsen ut över axlarna, bröstet och ryggen, med veck och ojämn kant.
function shawlGeometry() {
  const A = 30, V = 6;
  // [avstånd från mitten, höjd] från halsen och utåt, åt tre håll
  const side = [[0.085, 0.475], [0.14, 0.484], [0.195, 0.48], [0.234, 0.456], [0.254, 0.412], [0.259, 0.365], [0.259, 0.335]];
  const front = [[0.075, 0.455], [0.1, 0.445], [0.125, 0.425], [0.146, 0.395], [0.156, 0.36], [0.16, 0.325], [0.161, 0.3]];
  const back = [[0.08, 0.47], [0.105, 0.465], [0.13, 0.448], [0.148, 0.42], [0.156, 0.385], [0.159, 0.345], [0.16, 0.315]];
  const pos = [], uv = [], index = [];
  const edge = [];
  for (let i = 0; i <= A; i++) {
    const a = (i / A) * Math.PI * 2;
    const sn = Math.sin(a), cs = Math.cos(a);
    const wSide = sn * sn;
    const prof = cs > 0 ? front : back;
    // Kanten hänger längre ner snett fram (en snibb) och lite ojämnt runt om
    const snibb = Math.exp(-(((a - 0.55) / 0.5) ** 2)) * 0.07 + Math.exp(-(((a - 3.5) / 0.7) ** 2)) * 0.04;
    for (let j = 0; j <= V; j++) {
      const v = j / V;
      const r = side[j][0] * wSide + prof[j][0] * (1 - wSide);
      let y = side[j][1] * wSide + prof[j][1] * (1 - wSide);
      const fold = 1 + 0.045 * Math.sin(a * 7 + 0.8) * v * v + 0.02 * Math.sin(a * 13 + 2) * v * v;
      y -= (snibb + 0.012 * Math.sin(a * 5 + 1.3)) * v * v;
      // sjalen följer bålen: bredare åt sidorna än framåt
      const x = sn * r * fold;
      const z = cs * r * fold - 0.006;
      pos.push(x, y, z);
      uv.push((i / A) * 3, v);
      if (j === V) edge.push(new THREE.Vector3(x, y, z));
    }
  }
  const cols = V + 1;
  for (let i = 0; i < A; i++) {
    for (let j = 0; j < V; j++) {
      const p = i * cols + j, q = p + cols;
      index.push(p, p + 1, q, p + 1, q + 1, q);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  for (let j = 0; j <= V; j++) { // sömmen
    const p = j, q = A * cols + j;
    const x = n.getX(p) + n.getX(q), y = n.getY(p) + n.getY(q), z = n.getZ(p) + n.getZ(q);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(p, x / l, y / l, z / l);
    n.setXYZ(q, x / l, y / l, z / l);
  }
  edge.pop();
  return { geo, edge };
}

// Gör mönstret tätare eller glesare på en form (så rutorna blir lika stora överallt)
export function uvScale(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

// En ram (spänne) av fyra smala bitar, med en torn tvärs över
export function buckle(add, mat, pos, w, h, rot = [0, 0, 0], t = 0.008) {
  const g = new THREE.Group();
  g.position.set(...pos);
  g.rotation.set(...rot);
  const piece = (geo, p) => { const mesh = new THREE.Mesh(geo, mat); mesh.position.set(...p); g.add(mesh); };
  piece(new THREE.BoxGeometry(w, t, t), [0, h / 2, 0]);
  piece(new THREE.BoxGeometry(w, t, t), [0, -h / 2, 0]);
  piece(new THREE.BoxGeometry(t, h + t, t), [w / 2, 0, 0]);
  piece(new THREE.BoxGeometry(t, h + t, t), [-w / 2, 0, 0]);
  piece(new THREE.BoxGeometry(w * 0.55, t * 0.7, t * 0.7), [w * 0.2, 0, t * 0.4]);
  g.updateMatrixWorld(true);
  for (const c of g.children) {
    const geo = c.geometry;
    geo.applyMatrix4(c.matrixWorld);
    add(geo, mat);
  }
}

export function buildPeasantTorso(k, pelvis, torso, m, H) {
  const P = (...a) => pelvis.add(k.shape(...a));
  const T = (...a) => torso.add(k.shape(...a));
  const half = Math.PI / 2;

  // Vadderad tunika
  T(H.sculptTorso(new THREE.CapsuleGeometry(0.155, 0.2, 8, 18), 0.255), m.padded, [0, 0.24, 0], [1.26, 1, 0.8]);

  // Sjalen över axlarna, med en tjock nedvikt krage, kant i spelarens färg och ett runt spänne
  const { geo, edge } = shawlGeometry();
  T(geo, m.shawl);
  const curve = new THREE.CatmullRomCurve3(edge, true);
  T(new THREE.TubeGeometry(curve, 60, 0.0085, 5, true), m.shawl);
  // Fodret tittar fram under kanten (spelarens färg)
  const lining = new THREE.CatmullRomCurve3(edge.map((p) => new THREE.Vector3(p.x * 0.985, p.y - 0.012, p.z * 0.985)), true);
  T(new THREE.TubeGeometry(lining, 60, 0.0075, 5, true), m.cloth);
  T(new THREE.TorusGeometry(0.094, 0.04, 8, 18), m.shawl, [0, 0.462, -0.006], [1.12, 1, 0.78], [half + 0.16, 0, 0]);   // kragen
  T(new THREE.TorusGeometry(0.1, 0.03, 7, 16, Math.PI * 1.2), m.shawl, [0.01, 0.432, 0.012], [1.1, 1, 0.8], [half + 0.3, 0, -1.2]); // ett veck till framtill
  T(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 14), m.brass, [-0.045, 0.385, 0.151], [1, 1, 1], [half - 0.28, 0, 0]);
  T(new THREE.TorusGeometry(0.03, 0.005, 5, 14), m.brass, [-0.045, 0.385, 0.154], [1, 1, 1], [-0.28, 0, 0]);
  T(new THREE.TorusGeometry(0.014, 0.0035, 4, 3), m.brass, [-0.045, 0.385, 0.157], [1, 1, 1], [-0.28, 0, 0.5]);       // knuten i spännet

  // Band i spelarens färg snett över bålen, med en läderrem ovanpå och ett spänne på bröstet
  T(new THREE.CylinderGeometry(1, 1, 0.082, 28, 1, true), m.cloth, [0, 0.25, 0.004], [0.202, 1, 0.137], [0, 0, 0.62]);
  T(new THREE.CylinderGeometry(1, 1, 0.044, 28, 1, true), m.belt, [0, 0.25, 0.004], [0.2065, 1, 0.1405], [0, 0, 0.62]);
  buckle(T, m.brass, [0.062, 0.296, 0.139], 0.05, 0.056, [0, 0.3, 0.62]);

  // Tunikans kjol ner över låren, med kant i spelarens färg
  const S = (...a) => k.addSkirt(...a); // följer med låren
  S(uvScale(new THREE.CylinderGeometry(0.176, 0.218, 0.3, 20, 6, true), 3, 0.75), m.padded, [0, -0.14, 0], [1, 1, 0.86]);
  S(new THREE.CylinderGeometry(0.2155, 0.2215, 0.04, 20, 1, true), m.cloth, [0, -0.272, 0], [1, 1, 0.86]);

  // Brett läderbälte med stort spänne, och remmens ände som hänger ner
  P(new THREE.CylinderGeometry(0.1765, 0.181, 0.058, 20, 1, true), m.belt, [0, 0.004, 0], [1, 1, 0.82]);
  for (const y of [0.031, -0.023]) P(new THREE.TorusGeometry(0.1795, 0.0045, 4, 20), m.bootDark, [0, y, 0], [1, 0.82, 1], [half, 0, 0]);
  buckle(P, m.brass, [0.012, 0.004, 0.151], 0.064, 0.072, [0, 0, 0], 0.01);
  S(new THREE.BoxGeometry(0.036, 0.15, 0.008, 1, 4, 1), m.belt, [0.05, -0.075, 0.157], [1, 1, 1], [-0.1, 0, -0.08]);
  S(new THREE.BoxGeometry(0.038, 0.028, 0.011), m.belt, [0.056, -0.152, 0.165], [1, 1, 1], [-0.1, 0, -0.08]);

  // Tygflik som hänger från bältet (kanter i spelarens färg)
  const flap = [-0.07, -0.155, 0.17];
  const rot = [-0.13, 0, 0];
  S(uvScale(new THREE.BoxGeometry(0.085, 0.27, 0.008, 1, 6, 1), 0.25, 0.7), m.padded, flap, [1, 1, 1], rot);
  for (const sx of [1, -1]) S(new THREE.BoxGeometry(0.014, 0.27, 0.011, 1, 6, 1), m.cloth, [flap[0] + 0.0365 * sx, flap[1], flap[2]], [1, 1, 1], rot);
  S(new THREE.BoxGeometry(0.087, 0.022, 0.011), m.cloth, [flap[0], flap[1] - 0.126, flap[2] + 0.0165], [1, 1, 1], rot);

  // Väska bak på höften, liten pung fram och en dolkslida
  P(new THREE.BoxGeometry(0.085, 0.085, 0.045), m.belt, [0.105, -0.05, -0.135], [1, 1, 1], [0, 0.35, 0]);
  P(new THREE.BoxGeometry(0.09, 0.045, 0.05), m.bootDark, [0.105, -0.022, -0.136], [1, 1, 1], [0, 0.35, 0]);
  P(new THREE.SphereGeometry(0.009, 6, 5), m.brass, [0.114, -0.046, -0.163]);
  P(new THREE.SphereGeometry(1, 8, 6), m.belt, [0.135, -0.06, 0.09], [0.034, 0.044, 0.026]);
  P(new THREE.CylinderGeometry(0.012, 0.004, 0.035, 5), m.bootDark, [0.135, -0.02, 0.09]);
  P(new THREE.BoxGeometry(0.03, 0.17, 0.02), m.bootDark, [-0.16, -0.08, 0.06], [1, 1, 1], [0.1, 0, -0.18]);
  P(new THREE.CylinderGeometry(0.011, 0.011, 0.06, 6), m.wood, [-0.148, 0.03, 0.05], [1, 1, 1], [0.1, 0, -0.18]);
}

// Ett band runt en lem som följer lemmens form precis. tilt lutar bandet (för remmar i kors).
export function band(H, profile, length, f, extra, width, tilt = 0) {
  const geo = H.latheAlong(profile, length, f - width / 2, f + width / 2, extra, false);
  if (tilt) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + p.getZ(i) * tilt);
    geo.computeVertexNormals();
  }
  return geo;
}

export function buildPeasantLimbs(k, side, s, upper, fore, hand, thigh, shin, foot, m, H) {
  const U = (...a) => upper.add(k.shape(...a));
  const F = (...a) => fore.add(k.shape(...a));
  const HN = (...a) => hand.add(k.shape(...a));
  const SH = (...a) => shin.add(k.shape(...a));
  const FT = (...a) => foot.add(k.shape(...a));
  const half = Math.PI / 2;
  const { latheAlong, PROFILE } = H;

  // Sjalen fortsätter ut över axeln (följer med armen, så den inte sticker igenom när armen lyfts)
  U(new THREE.SphereGeometry(0.098, 14, 7, 0, Math.PI * 2, 0, half), m.shawl, [0.002 * s, -0.02, 0], [1, 0.95, 1.06]);
  U(latheAlong(PROFILE.upperArm, 0.29, 0.06, 0.3, 0.034, false), m.shawl);
  U(band(H, PROFILE.upperArm, 0.29, 0.3, 0.036, 0.035), m.cloth);
  // Ärmens kant vid armbågen
  U(band(H, PROFILE.upperArm, 0.29, 0.86, 0.016, 0.07), m.padded);

  // Stickad ärm på underarmen och ett läderskydd med två remmar
  F(latheAlong(PROFILE.forearm, 0.26, 0.08, 0.6, 0.008, false), m.knit);
  F(latheAlong(PROFILE.forearm, 0.26, 0.48, 0.97, 0.015, false), m.boot);
  for (const f of [0.49, 0.96]) F(band(H, PROFILE.forearm, 0.26, f, 0.018, 0.035), m.bootDark);
  for (const f of [0.63, 0.82]) {
    F(band(H, PROFILE.forearm, 0.26, f, 0.019, 0.07), m.bootDark);
    F(new THREE.BoxGeometry(0.008, 0.024, 0.026), m.brass, [0.058 * s, -0.26 * f, 0]);
  }
  k.addHand(HN, m.skin, s, 1);

  sturdyBoot(k, SH, FT, s, H, m, { boot: m.boot, round: true });
  SH(latheAlong(PROFILE.shin, 0.4, 0.2, 0.37, 0.026, true), m.trouser); // byxbenet pöser över stövelkragen
}

// Rejäl stövel: skaft upp på vaden med nedvikt krage, remmar i kors, rem med spänne över vristen,
// sko formad som en fot med tjock sula och klack. Används av flera rustningar.
export function sturdyBoot(k, SH, FT, s, H, m, { boot, round = false, point = 0, cross = true, cuff = true, mud = null, top = 0.4, sole = null } = {}) {
  const { latheAlong, PROFILE } = H;
  const half = Math.PI / 2;
  const d = top - 0.4;
  SH(latheAlong(PROFILE.shin, 0.4, top, 1, 0.022, false), boot);
  if (cuff) {
    SH(latheAlong(PROFILE.shin, 0.4, top - 0.07, top + 0.1, 0.031, false), boot);
    for (const f of [top - 0.065, top + 0.095]) SH(band(H, PROFILE.shin, 0.4, f, 0.034, 0.028), m.bootDark);
  } else {
    SH(band(H, PROFILE.shin, 0.4, top + 0.01, 0.027, 0.04), m.bootDark);
  }
  if (cross) for (const f of [0.66 + d * 0.5, 0.84 + d * 0.2]) for (const tilt of [0.38, -0.38]) SH(band(H, PROFILE.shin, 0.4, f, 0.026, 0.045, tilt), m.bootDark);
  else SH(band(H, PROFILE.shin, 0.4, Math.max(0.72, top + 0.16), 0.026, 0.05), m.bootDark);
  if (mud) SH(latheAlong(PROFILE.shin, 0.4, 0.78, 1, 0.0245, false), mud); // lera upp på skaftet
  FT(new THREE.CylinderGeometry(0.066, 0.071, 0.1, 14, 1, true), mud || boot, [0, -0.035, -0.002]);
  const p = shoeParts({ round, point, wide: round ? 1.2 : 1.12, sturdy: true });
  FT(p.upper, mud || boot);
  FT(p.sole, sole || m.bootDark);
  FT(new THREE.TorusGeometry(0.068, 0.0065, 4, 14), m.bootDark, [0, -0.03, 0.004], [1, 1.1, 1.7], [half - 0.5, 0, 0]);
  FT(new THREE.BoxGeometry(0.01, 0.024, 0.026), m.brass, [0.066 * s, -0.035, 0.02]);
}

// Läderskydd på underarmen med kanter och två remmar med spännen
export function bracer(k, F, s, H, m, mat) {
  const { latheAlong, PROFILE } = H;
  F(latheAlong(PROFILE.forearm, 0.26, 0.42, 0.97, 0.015, false), mat);
  for (const f of [0.43, 0.96]) F(band(H, PROFILE.forearm, 0.26, f, 0.018, 0.035), m.bootDark);
  for (const f of [0.58, 0.8]) {
    F(band(H, PROFILE.forearm, 0.26, f, 0.019, 0.07), m.bootDark);
    F(new THREE.BoxGeometry(0.008, 0.024, 0.026), m.brass, [0.058 * s, -0.26 * f, 0]);
  }
}
