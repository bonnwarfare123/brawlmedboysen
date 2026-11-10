// RUSTNINGARNA (v0.32) – alla utom Bonden (peasant.js) och goblinen (kit.js), byggda i lager efter konceptbilder.
//
// Varje rustning består av samma sorts byggbitar: ett plagg runt bålen (shell), en kjol som följer benen
// (skirtGeo + addSkirt), bälte med väskor, axelskydd, handskar, benskydd och stövlar.

import * as THREE from "three";
import { sturdyBoot, bracer, buckle, band } from "./peasant.js";
import { paddedTexture, paddedBumpTexture, leatherTexture, linenTexture, rivetClothTexture, channelQuiltTexture, stripeTexture } from "./textures.js";

const PI = Math.PI;
const half = PI / 2;
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
const _up = new THREE.Vector3(0, 1, 0);

export const OUTFIT_STYLES = ["plate", "gilded", "chain", "leather", "jester", "hedge", "gambeson", "surcoat", "coatplates", "brigandine", "guard", "mercenary", "halfplate", "crusader"];

// ---------- Material ----------
export function outfitMaterials(k, m, style, colorHex) {
  const worn = m.cloth.color.getHex();
  m.clothTex = k.mat(worn, 0.9, 0, { map: linenTexture(), side: THREE.DoubleSide });
  m.cream = k.mat(0xcbbd9c, 0.93, 0, { map: linenTexture(), side: THREE.DoubleSide });
  m.boot = k.mat(0x6a4226, 0.76, 0, { map: leatherTexture(), bumpMap: leatherTexture(), bumpScale: 0.5 });
  m.chain.side = THREE.DoubleSide;
  const out = { limbL: m.chain, limbR: m.chain, legL: m.chain, legR: m.chain, hips: m.chain, chest: { rx: 0.185, rz: 0.13, ar: 0.058 }, metal: false };
  const set = (o) => Object.assign(out, o);
  k.skinExtra = { upperArm: 0.004, forearm: 0.003, thigh: 0.005, shin: 0.004 };
  if (style === "plate" || style === "gilded") {
    set({ chest: { rx: 0.205, rz: 0.145, ar: 0.068 }, metal: true });
  } else if (style === "leather") {
    m.leatherQuilt = k.mat(0x94623a, 0.82, 0, { map: paddedTexture(), bumpMap: paddedBumpTexture(), bumpScale: 3, side: THREE.DoubleSide });
    set({ limbL: m.leatherQuilt, limbR: m.leatherQuilt, legL: m.wool, legR: m.wool, hips: m.wool, chest: { rx: 0.19, rz: 0.135, ar: 0.062 } });
    k.skinExtra = { upperArm: 0.008, forearm: 0.004, thigh: 0.01, shin: 0.01 };
  } else if (style === "jester") {
    set({ limbL: m.motleyA, limbR: m.motleyB, legL: m.motleyB, legR: m.motleyA, hips: m.motleyA, chest: { rx: 0.172, rz: 0.115, ar: 0.054 } });
    k.skinExtra = { upperArm: 0, forearm: 0, thigh: 0.003, shin: 0.002 };
  } else if (style === "hedge") {
    m.rustChain.side = THREE.DoubleSide;
    set({ limbL: m.rustChain, limbR: m.rustChain, legL: m.wool, legR: m.wool, hips: m.wool, chest: { rx: 0.195, rz: 0.138, ar: 0.062 }, metal: true });
    k.skinExtra = { upperArm: 0.005, forearm: 0.003, thigh: 0.01, shin: 0.01 };
  } else if (style === "gambeson") {
    m.gamb = k.mat(mix(colorHex, 0xd8c8a4, 0.55), 0.96, 0, { map: channelQuiltTexture(), bumpMap: channelQuiltTexture(), bumpScale: 2.5, side: THREE.DoubleSide });
    m.gambDark = k.mat(mix(colorHex, 0x33261a, 0.45), 0.9, 0);
    set({ limbL: m.gamb, limbR: m.gamb, legL: m.wool, legR: m.wool, hips: m.wool, chest: { rx: 0.2, rz: 0.145, ar: 0.068 } });
    k.skinExtra = { upperArm: 0.014, forearm: 0.009, thigh: 0.01, shin: 0.01 };
  } else if (style === "coatplates") {
    m.coat = k.mat(mix(colorHex, 0x1c1820, 0.28), 0.8, 0.02, { map: rivetClothTexture(), side: THREE.DoubleSide });
    set({ legL: m.coat, legR: m.coat, hips: m.coat, chest: { rx: 0.2, rz: 0.142, ar: 0.066 }, metal: true });
    k.skinExtra = { upperArm: 0.004, forearm: 0.003, thigh: 0.012, shin: 0.004 };
  } else if (style === "brigandine") {
    m.brig = k.mat(mix(colorHex, 0x241c18, 0.2), 0.8, 0.04, { map: rivetClothTexture(), side: THREE.DoubleSide });
    set({ legL: m.wool, legR: m.wool, hips: m.wool, chest: { rx: 0.195, rz: 0.14, ar: 0.06 } });
    k.skinExtra = { upperArm: 0.004, forearm: 0.003, thigh: 0.01, shin: 0.01 };
  } else if (style === "guard") {
    m.pleat = k.mat(0xd6cab0, 0.92, 0, { map: channelQuiltTexture(), bumpMap: channelQuiltTexture(), bumpScale: 2, side: THREE.DoubleSide });
    m.padDark = k.mat(0x4c3a2b, 0.95, 0, { map: paddedTexture(), bumpMap: paddedBumpTexture(), bumpScale: 3, side: THREE.DoubleSide });
    m.hoseLight = k.mat(0xd2c6ac, 0.92, 0, { map: linenTexture() });
    m.hoseColor = k.mat(worn, 0.92, 0, { map: linenTexture() });
    set({ limbL: m.padDark, limbR: m.padDark, legL: m.hoseColor, legR: m.hoseLight, hips: m.padDark, chest: { rx: 0.19, rz: 0.135, ar: 0.062 } });
    k.skinExtra = { upperArm: 0.01, forearm: 0.006, thigh: 0.003, shin: 0.002 };
  } else if (style === "mercenary") {
    m.jack = k.mat(0x9c7f52, 0.96, 0, { map: paddedTexture(), bumpMap: paddedBumpTexture(), bumpScale: 3.5, side: THREE.DoubleSide });
    m.hoseStripe = k.mat(0xffffff, 0.92, 0, { map: stripeTexture(worn, 0xd8ccb0, 6) });
    set({ legL: m.hoseStripe, legR: m.wool, hips: m.wool, chest: { rx: 0.192, rz: 0.136, ar: 0.06 } });
    k.skinExtra = { upperArm: 0.004, forearm: 0.003, thigh: 0.006, shin: 0.005 };
  } else if (style === "halfplate") {
    set({ chest: { rx: 0.205, rz: 0.145, ar: 0.066 }, metal: true });
  } else if (style === "crusader") {
    m.surWhite = k.mat(0xd9d0b8, 0.93, 0, { map: linenTexture(), side: THREE.DoubleSide });
  }
  return out;
}

// ---------- Byggbitar: bålen ----------
const BODY = [0, 0.24, 0];
// Bålens djup framtill längs höjden (samma tabell som sculptTorso i knight.js)
const WF = [[0, 0.5], [0.05, 0.84], [0.13, 1.02], [0.3, 0.98], [0.52, 1.04], [0.7, 1.13], [0.84, 0.98], [0.94, 0.64], [1, 0.46]];
const WX = [[0, 0.5], [0.05, 0.8], [0.12, 0.94], [0.28, 0.87], [0.48, 0.9], [0.7, 0.87], [0.8, 0.92], [0.88, 0.84], [0.94, 0.62], [1, 0.42]];
function key(pts, f) {
  for (let i = 1; i < pts.length; i++) {
    if (f <= pts[i][0]) {
      const t = (f - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0] || 1);
      return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * (t * t * (3 - 2 * t));
    }
  }
  return pts[pts.length - 1][1];
}
// Var bålens framsida (z) och sida (x) ligger på höjden y, för ett plagg med tjockleken extra
const frontZ = (y, extra = 0.008, sz = 0.78) => (0.155 + extra) * key(WF, (y + 0.015) / 0.51) * sz;
const sideX = (y, extra = 0.008, sx = 1.24) => (0.155 + extra) * key(WX, (y + 0.015) / 0.51) * sx;

// Själva kroppen (när plagget är kroppen: jacka, brynja)
function body(c, mat, sc = [1.24, 1, 0.78]) {
  c.T(c.H.sculptTorso(new THREE.CapsuleGeometry(0.155, 0.2, 8, 18), 0.255), mat, BODY, sc);
}
// Ett plagg runt bålen: från andelen f0 till f1 av höjden (0 = höften, 1 = halsen), mellan vinklarna a0 och a1 (0 = rakt fram)
function shell(c, mat, f0, f1, extra = 0.008, a0 = -PI, a1 = PI, sc = [1.24, 1, 0.78]) {
  const R = 0.155 + extra;
  const n = Math.max(2, Math.round((24 * (a1 - a0)) / (2 * PI)));
  const geo = new THREE.CylinderGeometry(R, R, (f1 - f0) * 0.51, n, 6, true, a0, a1 - a0);
  geo.translate(0, -0.255 + ((f0 + f1) / 2) * 0.51, 0);
  c.H.sculptTorso(geo, 0.255);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) * (a1 - a0)) / (2 * PI));
  c.T(geo, mat, BODY, sc);
}
// Kors på bröstet (och ryggen): två remsor som följer bålen
function cross(c, mat, { extra = 0.014, back = false, yMid = 0.64, arm = 0.5, sc } = {}) {
  for (const o of back ? [0, PI] : [0]) {
    shell(c, mat, 0.08, 0.88, extra, o - 0.2, o + 0.2, sc);
    shell(c, mat, yMid - 0.06, yMid + 0.06, extra, o - arm, o + arm, sc);
  }
}
const collar = (c, mat, r0 = 0.075, r1 = 0.1, h = 0.08) => c.T(new THREE.CylinderGeometry(r0, r1, h, 14, 1, true), mat, [0, 0.475, 0], [1.1, 1, 0.9]);

// Bröstplåt (svarvad form med midja och bröstkorg). front = bara framsidan.
const CHEST = [[0.15, 0.0], [0.168, 0.06], [0.192, 0.2], [0.2, 0.3], [0.182, 0.39], [0.13, 0.445], [0.095, 0.46]];
function cuirass(c, mat, { front = false, sc = [1.15, 1, 0.78], pos = [0, 0, 0], rot = [0, 0, 0] } = {}) {
  const pts = CHEST.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = front ? new THREE.LatheGeometry(pts, 18, -PI * 0.55, PI * 1.1) : new THREE.LatheGeometry(pts, 24);
  c.T(c.H.sculptChest(geo, 0, 0.46), mat, pos, sc, rot);
}

// Krage som ligger ut över axlarna (brynjehuva, sjal). rows = hur långt ut den når, dag = uddar i kanten.
const M_SIDE = [[0.085, 0.475], [0.14, 0.484], [0.195, 0.48], [0.234, 0.456], [0.254, 0.412], [0.259, 0.365], [0.259, 0.335]];
const M_FRONT = [[0.075, 0.455], [0.1, 0.445], [0.125, 0.425], [0.146, 0.395], [0.156, 0.36], [0.16, 0.325], [0.161, 0.3]];
const M_BACK = [[0.08, 0.47], [0.105, 0.465], [0.13, 0.448], [0.148, 0.42], [0.156, 0.385], [0.159, 0.345], [0.16, 0.315]];
function mantle(c, mat, { rows = 5, dag = 0, grow = 1 } = {}) {
  const A = 28;
  const pos = [], uv = [], index = [];
  for (let i = 0; i <= A; i++) {
    const a = (i / A) * PI * 2;
    const sn = Math.sin(a), cs = Math.cos(a);
    const w = sn * sn;
    const prof = cs > 0 ? M_FRONT : M_BACK;
    for (let j = 0; j <= rows; j++) {
      const r = (M_SIDE[j][0] * w + prof[j][0] * (1 - w)) * (j ? grow : 1);
      let y = M_SIDE[j][1] * w + prof[j][1] * (1 - w);
      if (j === rows && dag && i % 2) y -= dag;
      pos.push(sn * r, y, cs * r - 0.006);
      uv.push((i / A) * 4, j * 0.25);
    }
  }
  const cols = rows + 1;
  for (let i = 0; i < A; i++) for (let j = 0; j < rows; j++) {
    const p = i * cols + j, q = p + cols;
    index.push(p, p + 1, q, p + 1, q + 1, q);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  c.T(geo, mat);
}

// ---------- Byggbitar: höften ----------
// En kjol eller en del av en (mellan vinklarna a0 och a1). dag = uddar i fållen. Följer benen.
function skirtGeo({ r0 = 0.172, r1 = 0.212, y0 = 0.0, len = 0.3, a0 = -PI, a1 = PI, segs = 24, rows = 5, dag = 0, zs = 0.84 } = {}) {
  const pos = [], uv = [], index = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= segs; i++) {
      const th = a0 + ((a1 - a0) * i) / segs;
      const r = r0 + ((r1 - r0) * j) / rows;
      let y = y0 - (len * j) / rows;
      if (j === rows && dag && i % 2) y -= dag;
      pos.push(Math.sin(th) * r, y, Math.cos(th) * r * zs);
      uv.push(((th + PI) / (2 * PI)) * 3, (j / rows) * len * 4);
    }
  }
  const cols = segs + 1;
  for (let j = 0; j < rows; j++) for (let i = 0; i < segs; i++) {
    const p = j * cols + i, q = p + cols;
    index.push(p, q, p + 1, p + 1, q, q + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}
const skirt = (c, mat, o) => c.k.addSkirt(skirtGeo(o), mat);
// Kant längst ner på en kjol
const hem = (c, mat, o, h = 0.035) => {
  const t = 1 - h / o.len;
  const r0 = (o.r0 ?? 0.172) + ((o.r1 ?? 0.212) - (o.r0 ?? 0.172)) * t;
  skirt(c, mat, { ...o, r0: r0 + 0.004, r1: (o.r1 ?? 0.212) + 0.005, y0: (o.y0 ?? 0) - o.len * t, len: h, rows: 1, dag: 0 });
};
const belt = (c, r = 0.174, y = 0, h = 0.05) => c.P(new THREE.CylinderGeometry(r, r, h, 18, 1, true), c.m.strap, [0, y, 0], [1, 1, 0.84]);
// Väska i bältet. side = +1 vänster höft, -1 höger. back = sitter bak.
function pouch(c, side = -1, back = false) {
  const m = c.m;
  const x = 0.118 * side, z = back ? -0.125 : 0.118, ry = (back ? PI - 0.45 * side : 0.45 * side);
  c.P(new THREE.BoxGeometry(0.085, 0.09, 0.048), m.leather, [x, -0.06, z], [1, 1, 1], [0, ry, 0]);
  c.P(new THREE.BoxGeometry(0.091, 0.045, 0.054), m.leatherDark, [x, -0.035, z], [1, 1, 1], [0, ry, 0]);
  c.P(new THREE.SphereGeometry(0.009, 6, 5), m.brass, [x + Math.sin(ry) * 0.029, -0.058, z + Math.cos(ry) * 0.029]);
}
// Tygstycke som hänger från bältet
const flap = (c, mat, x = 0, w = 0.1, len = 0.24, z = 0.172) => c.k.addSkirt(new THREE.BoxGeometry(w, len, 0.008, 1, 5, 1), mat, [x, -len / 2 - 0.01, z], [1, 1, 1], [-0.1, 0, 0]);
// Remmar med spänne tvärs över framsidan (plåtrock, brigandin)
function frontStraps(c, extra, ys = [0.13, 0.215, 0.3]) {
  for (const y of ys) {
    const z = frontZ(y, extra) + 0.004;
    c.T(new THREE.BoxGeometry(0.1, 0.022, 0.008), c.m.strap, [0, y, z]);
    buckle(c.T, c.m.brass, [0.012, y, z + 0.006], 0.03, 0.03, [0, 0, 0], 0.006);
  }
}
// Rem snett över bålen
const baldric = (c, dir = 1, w = 0.04, mat = null, rx = 0.2065, rz = 0.1405) =>
  c.T(new THREE.CylinderGeometry(1, 1, w, 28, 1, true), mat || c.m.strap, [0, 0.25, 0.004], [rx, 1, rz], [0, 0, 0.62 * dir]);

// ---------- Byggbitar: armar och ben ----------
// Axelskydd i plåt: välvd plåt och lameller nedåt
function pauldron(L, mat, edge, { lames = 3, size = 1, wing = false, rivets = true } = {}) {
  const { U, s } = L;
  U(new THREE.SphereGeometry(0.097 * size, 18, 8, 0, PI * 2, 0, half), mat, [0.018 * s, -0.005, 0], [1.1, 0.62, 1.15]);
  U(new THREE.TorusGeometry(0.097 * size, 0.006, 5, 22), edge, [0.018 * s, -0.005, 0], [1.1, 1.15, 1], [half, 0, 0]);
  for (let i = 0; i < lames; i++) {
    const r = 0.095 * size - i * 0.008;
    const y = -0.03 - i * 0.03;
    U(new THREE.CylinderGeometry(r, r + 0.01, 0.04, 18, 1, false), mat, [0.018 * s, y, 0], [1.08, 1, 1.12]);
    U(new THREE.TorusGeometry(r + 0.01, 0.0035, 4, 18), edge, [0.018 * s, y - 0.02, 0], [1.08, 1.12, 1], [half, 0, 0]);
  }
  if (rivets) for (const z of [0.07, -0.07]) U(new THREE.SphereGeometry(0.009, 5, 4), edge, [0.06 * s, 0.035, z]);
  if (wing) {
    // Uppvikt kant ytterst (stoppar hugg mot halsen)
    U(new THREE.BoxGeometry(0.012, 0.085, 0.15), mat, [0.1 * s, 0.035, 0], [1, 1, 1], [0, 0, -0.45 * s]);
    U(new THREE.BoxGeometry(0.014, 0.012, 0.154), edge, [0.119 * s, 0.073, 0], [1, 1, 1], [0, 0, -0.45 * s]);
  }
}
// Hela armen i plåt
function plateArm(L, mat, edge, o = {}) {
  const { k, m, H, U, F, HN, s } = L;
  const { latheAlong, PROFILE } = H;
  if (o.pauldron !== false) pauldron(L, mat, edge, o.pauldron || {});
  if (o.upper !== false) {
    U(band(H, PROFILE.upperArm, 0.29, 0.55, 0.014, 0.05), m.strap);
    U(new THREE.BoxGeometry(0.016, 0.016, 0.008), m.brass, [0, -0.16, 0.066]);
    U(latheAlong(PROFILE.upperArm, 0.29, 0.38, 0.88, 0.012, false, 0.004), mat);
  }
  // Armbågskopp med vinge
  F(new THREE.SphereGeometry(0.066, 12, 8), mat, [0, 0, -0.008]);
  F(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 10), mat, [0.055 * s, 0, -0.01], [1, 1, 1.25], [0, 0, half]);
  F(new THREE.SphereGeometry(0.009, 5, 4), edge, [0.062 * s, 0, -0.01]);
  F(latheAlong(PROFILE.forearm, 0.26, 0.12, 0.72, 0.01, false, 0.003), mat);
  if (o.rich) for (const f of [0.14, 0.7]) F(band(H, PROFILE.forearm, 0.26, f, 0.013, 0.03), edge);
  if (o.gauntlet !== false) {
    F(new THREE.CylinderGeometry(0.062, 0.046, 0.085, 14, 1, true), mat, [0, -0.215, 0]);
    F(new THREE.TorusGeometry(0.062, 0.004, 4, 14), edge, [0, -0.173, 0], [1, 1, 1], [half, 0, 0]);
    k.addGauntlet(HN, mat, m.steelDark, s);
  }
}
// Benet i plåt: lårskena (valfri), knäkopp, benskena och plåtsko (valfri)
function plateLeg(L, mat, edge, o = {}) {
  const { k, m, H, TH, SH, FT, s } = L;
  const { latheAlong, PROFILE } = H;
  if (o.cuisse !== false) {
    TH(latheAlong(PROFILE.thigh, 0.42, 0.1, 0.82, 0.012 + (k.skinExtra?.thigh || 0), false, 0.004), mat);
    for (const f of [0.3, 0.72]) {
      TH(band(H, PROFILE.thigh, 0.42, f, 0.015 + (k.skinExtra?.thigh || 0), 0.03), m.strap);
    }
  }
  SH(new THREE.SphereGeometry(0.079, 12, 8), mat, [0, 0, 0.022], [1, 1, 1.12]);
  SH(new THREE.CylinderGeometry(0.064, 0.064, 0.01, 10), mat, [0.066 * s, 0, 0], [1, 1, 1.2], [0, 0, half]);
  SH(new THREE.SphereGeometry(0.01, 5, 4), edge, [0.074 * s, 0, 0]);
  SH(new THREE.TorusGeometry(0.06, 0.005, 4, 14), edge, [0, -0.05, 0.012], [1.05, 1.15, 1], [half, 0, 0]);
  SH(latheAlong(PROFILE.shin, 0.4, 0.14, o.sabaton === false ? 0.78 : 1, 0.012, false, 0.003), mat);
  if (o.sabaton !== false) {
    SH(new THREE.CylinderGeometry(0.066, 0.06, 0.03, 14, 1, true), mat, [0, -0.39, 0]);
    SH(new THREE.TorusGeometry(0.066, 0.004, 4, 14), edge, [0, -0.375, 0], [1, 1, 1], [half, 0, 0]);
    k.addPointedShoe(FT, mat, edge, o.point ?? 0.2, true);
  }
}
// Läderhandske med vid krage upp över handleden
function glove(L, mat, { cuff = 0.1, size = 1.1 } = {}) {
  const { k, m, F, HN, s } = L;
  k.addHand(HN, mat, s, size);
  if (cuff) {
    F(new THREE.CylinderGeometry(0.05 + cuff * 0.16, 0.044, cuff, 14, 1, true), mat, [0, -0.255 + cuff / 2, 0]);
    F(new THREE.TorusGeometry(0.05 + cuff * 0.16, 0.0045, 4, 14), m.bootDark, [0, -0.255 + cuff, 0], [1, 1, 1], [half, 0, 0]);
  }
}
// Knäskydd i läder (rund lapp med ring) eller en enkel knäkopp i stål
function kneePad(L, mat, rim) {
  L.SH(new THREE.SphereGeometry(0.07, 12, 8), mat, [0, 0.0, 0.026], [1, 1.05, 0.8]);
  L.SH(new THREE.TorusGeometry(0.043, 0.006, 4, 14), rim, [0, 0.0, 0.079]);
}
function kneeCop(L, mat, edge) {
  const { SH, s } = L;
  SH(new THREE.SphereGeometry(0.077, 12, 8), mat, [0, 0, 0.022], [1, 1, 1.1]);
  SH(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 10), mat, [0.064 * s, 0, 0], [1, 1, 1.15], [0, 0, half]);
  SH(band(L.H, L.H.PROFILE.shin, 0.4, 0.14, 0.012, 0.04), L.m.strap);
  if (edge) SH(new THREE.SphereGeometry(0.009, 5, 4), edge, [0.072 * s, 0, 0]);
}
// Enkel rund axelkopp (utan lameller)
function shoulderCap(L, mat, edge, size = 1) {
  const { U, s } = L;
  U(new THREE.SphereGeometry(0.098 * size, 16, 8, 0, PI * 2, 0, half), mat, [0.016 * s, -0.02, 0], [1.1, 0.9, 1.16]);
  if (edge) U(new THREE.TorusGeometry(0.098 * size, 0.005, 4, 18), edge, [0.016 * s, -0.02, 0], [1.1, 1.16, 1], [half, 0, 0]);
}
// Byxbenet pöser över stövelkragen
const trouserPuff = (L, mat, top = 0.4) => L.SH(L.H.latheAlong(L.H.PROFILE.shin, 0.4, top - 0.2, top - 0.03, 0.026, true), mat);
const boots = (L, o) => sturdyBoot(L.k, L.SH, L.FT, L.s, L.H, L.m, o);

// ---------- Bålen, rustning för rustning ----------
export function buildOutfitTorso(k, style, pelvis, torso, m, look, H) {
  const c = { k, m, H, T: (...a) => torso.add(k.shape(...a)), P: (...a) => k.pelvisPart(pelvis, ...a) };
  const { T, P } = c;
  const gilded = style === "gilded";
  const scabbard = (metal) => { if (look.w === 0) k.addScabbard(pelvis, m, metal); };

  if (style === "plate" || gilded) {
    // Helrustning: bröstharnesk med mittås, halskrage, band i spelarens färg, nitade höftplåtar
    // och en veckad kjol i spelarens färg och vitt med uddar framtill
    const edge = m.trim;
    cuirass(c, m.steel);
    T(new THREE.BoxGeometry(0.018, 0.36, 0.02), gilded ? m.gold : m.steel, [0, 0.24, 0.155], [1, 1, 1], [-0.08, 0, 0]);
    T(new THREE.TorusGeometry(0.1, 0.014, 6, 18), edge, [0, 0.455, 0], [1.1, 0.78, 1], [half, 0, 0]);
    T(new THREE.TorusGeometry(0.175, 0.008, 5, 22), edge, [0, 0.01, 0], [1.15, 0.78, 1], [half, 0, 0]);
    T(new THREE.CylinderGeometry(0.068, 0.092, 0.09, 16, 1, true), m.steel, [0, 0.49, 0], [1.05, 1, 0.95]);
    T(new THREE.TorusGeometry(0.07, 0.006, 4, 16), edge, [0, 0.535, 0], [1.05, 0.95, 1], [half, 0, 0]);
    for (const s of [1, -1]) T(new THREE.SphereGeometry(0.09, 14, 8, 0, PI * 2, 0, half), m.steel, [0.16 * s, 0.395, 0], [1.15, 0.6, 1.15]);
    if (gilded) {
      T(new THREE.CylinderGeometry(0.034, 0.034, 0.008, 16), m.gold, [0, 0.32, 0.158], [1, 1, 1], [half - 0.08, 0, 0]);
      T(new THREE.TorusGeometry(0.034, 0.004, 4, 16), m.gold, [0, 0.32, 0.163], [1, 1, 1], [-0.08, 0, 0]);
      for (const y of [0.1, 0.2]) T(new THREE.TorusGeometry(0.19, 0.005, 4, 24), m.gold, [0, y, 0], [1.15, 0.79, 1], [half, 0, 0]);
    }
    k.addSash(T, P, m, 0.212, 0.172);
    // Två höftplåtar med nitar och en läderrem emellan
    for (let i = 0; i < 2; i++) {
      const r = 0.18 + i * 0.008, y = -0.005 - i * 0.05;
      P(new THREE.CylinderGeometry(r, r + 0.008, 0.05, 20, 1, true), m.steel, [0, y, 0], [1.08, 1, 0.82]);
      P(new THREE.TorusGeometry(r + 0.008, 0.005, 4, 22), edge, [0, y - 0.025, 0], [1.08, 0.82, 1], [half, 0, 0]);
      for (let j = 0; j < 12; j++) {
        const a = ((j + 0.5 * i) / 12) * PI * 2;
        P(new THREE.SphereGeometry(0.007, 5, 4), edge, [Math.sin(a) * (r + 0.004) * 1.08, y, Math.cos(a) * (r + 0.004) * 0.82]);
      }
    }
    P(new THREE.TorusGeometry(0.186, 0.008, 4, 22), m.strap, [0, -0.03, 0], [1.08, 0.82, 1], [half, 0, 0]);
    // Kjolen: åtta veck framtill i omväxlande färg, slät baktill
    const sk = { r0: 0.186, r1: 0.226, y0: -0.07, len: 0.19 };
    const n = 8, span = PI * 1.2;
    for (let i = 0; i < n; i++) {
      const a0 = -span / 2 + (span * i) / n;
      skirt(c, i % 2 ? m.cream : m.clothTex, { ...sk, a0, a1: a0 + span / n, segs: 2, rows: 3, dag: 0.05 });
    }
    skirt(c, m.clothTex, { ...sk, a0: span / 2, a1: PI * 2 - span / 2, segs: 10, rows: 3, len: 0.21 });
    scabbard(gilded ? m.gold : m.steelDark);
  } else if (style === "chain") {
    // Lång ringbrynja, vapenrock i spelarens färg med kors och måne, bälte med väska
    body(c, m.chain);
    collar(c, m.chain, 0.078, 0.13, 0.12);
    mantle(c, m.chain, { rows: 3 });
    shell(c, m.clothTex, 0.06, 0.9, 0.012, -1.1, 1.1);
    shell(c, m.clothTex, 0.06, 0.9, 0.012, PI - 1.1, PI + 1.1);
    cross(c, m.cream, { extra: 0.016, arm: 0.62 });
    T(new THREE.TorusGeometry(0.03, 0.009, 4, 12, PI * 1.25), m.gold, [0.012, 0.31, frontZ(0.31, 0.02) + 0.004], [1, 1, 0.45], [0, 0, 2.2]);
    belt(c, 0.178);
    pouch(c, -1);
    // Brynjans kjol med ljus kant, vapenrockens våder fram och bak, och uddar i spelarens färg underst
    const mail = { r0: 0.174, r1: 0.222, y0: 0.0, len: 0.36 };
    skirt(c, m.chain, mail);
    hem(c, m.cream, mail, 0.03);
    for (const o of [0, PI]) {
      skirt(c, m.clothTex, { r0: 0.18, r1: 0.229, len: 0.33, a0: o - 0.78, a1: o + 0.78, segs: 8 });
      if (!o) skirt(c, m.cream, { r0: 0.183, r1: 0.232, len: 0.33, a0: -0.2, a1: 0.2, segs: 2 });
    }
    skirt(c, m.clothTex, { r0: 0.16, r1: 0.205, y0: -0.2, len: 0.2, segs: 20, rows: 2, dag: 0.06 });
    scabbard(m.leatherDark);
  } else if (style === "leather") {
    // Vadderad läderjacka, huva i spelarens färg över axlarna, band över bröstet, bälte
    body(c, m.leatherQuilt, [1.26, 1, 0.8]);
    mantle(c, m.clothTex, { rows: 4, grow: 0.9 });
    T(new THREE.TorusGeometry(0.1, 0.04, 8, 18), m.clothTex, [0, 0.475, -0.004], [1.14, 1, 0.82], [half + 0.14, 0, 0]);
    T(new THREE.BoxGeometry(0.01, 0.3, 0.006), m.bootDark, [0, 0.18, frontZ(0.18, 0.004, 0.8) + 0.003]); // knäppning
    k.addSash(T, P, m, 0.205, 0.134, -1);
    belt(c, 0.18);
    // Jackans skört: två våder med en springa framtill, mörk kant
    const sk = { r0: 0.176, r1: 0.216, len: 0.27, a0: 0.05, a1: PI * 2 - 0.05 };
    skirt(c, m.leatherQuilt, sk);
    hem(c, m.leatherDark, sk, 0.028);
    P(new THREE.BoxGeometry(0.035, 0.2, 0.02), m.leatherDark, [0.165, -0.1, 0.05], [1, 1, 1], [0, 0, 0.2]); // dolkslida
    P(new THREE.SphereGeometry(0.018, 6, 5), m.brass, [0.18, 0.01, 0.05]);
  } else if (style === "jester") {
    // Tröja delad på mitten i två färger, uddig krage och uddig kjolkant med bjällror
    shell(c, m.motleyA, 0.03, 1, 0.002, 0, PI, [1.2, 1, 0.76]);
    shell(c, m.motleyB, 0.03, 1, 0.002, -PI, 0, [1.2, 1, 0.76]);
    for (let i = 0; i < 4; i++) {
      const y = 0.09 + i * 0.085;
      T(new THREE.BoxGeometry(0.05, 0.05, 0.01), i % 2 ? m.motleyA : m.motleyB, [0, y, frontZ(y, 0.002, 0.76)], [1, 1, 1], [0, 0, PI / 4]);
    }
    const pointed = (mat, pos, dir, size) => {
      const cone = k.shape(new THREE.ConeGeometry(size, size * 2.8, 4), mat, pos, [1, 1, 0.45]);
      cone.quaternion.setFromUnitVectors(_up, dir);
      torso.add(cone);
    };
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * PI * 2;
      const dir = new THREE.Vector3(Math.sin(a) * 0.85, -0.5, Math.cos(a) * 0.85).normalize();
      const base = new THREE.Vector3(Math.sin(a) * 0.12, 0.44, Math.cos(a) * 0.095);
      pointed(i % 2 ? m.motleyA : m.motleyB, base.clone().addScaledVector(dir, 0.05).toArray(), dir, 0.042);
      T(new THREE.SphereGeometry(0.014, 8, 6), m.bell, base.clone().addScaledVector(dir, 0.118).toArray());
    }
    T(new THREE.TorusGeometry(0.075, 0.014, 6, 16), m.bell, [0, 0.455, 0], [1.1, 0.9, 1], [half, 0, 0]);
    belt(c, 0.168);
    for (let i = 0; i < 10; i++) {
      const a0 = -PI + (i / 10) * PI * 2, a1 = a0 + PI / 5;
      skirt(c, i % 2 ? m.motleyA : m.motleyB, { r0: 0.166, r1: 0.2, len: 0.1, a0, a1, segs: 2, rows: 2, dag: 0.1 });
      const am = (a0 + a1) / 2;
      k.addSkirt(new THREE.SphereGeometry(0.013, 8, 6), m.bell, [Math.sin(am) * 0.203, -0.205, Math.cos(am) * 0.203 * 0.84]);
    }
  } else if (style === "hedge") {
    // Rostig brynja ner över låren, gammal bröstplåt, blekt tygstycke med egen symbol
    body(c, m.rustChain);
    collar(c, m.rustChain, 0.078, 0.13, 0.12);
    cuirass(c, m.rusty, { front: true, sc: [1.14, 1, 0.8], pos: [0, 0, 0.005], rot: [0, 0, 0.03] });
    T(new THREE.SphereGeometry(0.03, 8, 6), m.rusty, [0.07, 0.3, 0.14], [1, 0.8, 0.35]);
    T(new THREE.BoxGeometry(0.06, 0.05, 0.006), m.forged, [-0.07, 0.17, 0.14], [1, 1, 1], [-0.1, 0.3, 0.2]);
    for (const [x, y] of [[-0.095, 0.19], [-0.045, 0.19], [-0.095, 0.15], [-0.045, 0.15]]) T(new THREE.SphereGeometry(0.005, 4, 3), m.forged, [x, y, 0.143]);
    for (const sx of [1, -1]) T(new THREE.BoxGeometry(0.024, 0.2, 0.012), sx > 0 ? m.strap : m.rope, [0.12 * sx, 0.4, 0.02], [1, 1, 1], [0.3, 0, 0.15 * sx]);
    shell(c, m.strap, 0.34, 0.4, 0.012, PI - 1.9, PI + 1.9); // remmen runt ryggen
    belt(c, 0.18);
    const mail = { r0: 0.176, r1: 0.22, len: 0.3 };
    skirt(c, m.rustChain, mail);
    k.addSkirt(new THREE.PlaneGeometry(0.2, 0.36, 1, 5), m.faded, [0, -0.2, 0.19], [1, 1, 1], [-0.08, 0, 0]);
    k.addSkirt(new THREE.BoxGeometry(0.02, 0.09, 0.004), m.white, [0, -0.17, 0.196], [1, 1, 1], [-0.08, 0, 0.1]);
    k.addSkirt(new THREE.BoxGeometry(0.065, 0.018, 0.004), m.white, [0, -0.15, 0.197], [1, 1, 1], [-0.08, 0, 0.1]);
    P(new THREE.SphereGeometry(1, 8, 6), m.leatherDark, [0.14, -0.06, 0.09], [0.035, 0.05, 0.03]);
    scabbard(m.leatherDark);
  } else if (style === "gambeson") {
    // Tjock vadderad jacka med hög krage, snörning fram, mörka kanter och bälte med väska
    const sc = [1.3, 1, 0.84];
    body(c, m.gamb, sc);
    collar(c, m.gamb, 0.082, 0.105, 0.1);
    T(new THREE.TorusGeometry(0.084, 0.012, 5, 16), m.gambDark, [0, 0.525, 0], [1.1, 0.9, 1], [half, 0, 0]);
    T(new THREE.BoxGeometry(0.012, 0.36, 0.006), m.gambDark, [0, 0.21, frontZ(0.21, 0.002, 0.84) + 0.004]);
    for (let i = 0; i < 5; i++) {
      const y = 0.07 + i * 0.075;
      T(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 6), m.wood, [0, y, frontZ(y, 0.002, 0.84) + 0.008], [1, 1, 1], [0, 0, half]);
    }
    belt(c, 0.186);
    pouch(c, 1);
    const sk = { r0: 0.182, r1: 0.226, len: 0.33 };
    skirt(c, m.gamb, sk);
    hem(c, m.gambDark, sk, 0.03);
    skirt(c, m.gambDark, { r0: 0.185, r1: 0.229, len: 0.33, a0: -0.05, a1: 0.05, segs: 1 });
  } else if (style === "surcoat") {
    // Ringbrynja, uddig brynjekrage, lång vapenrock med kors och måne, bälte med väska och två hängande kedjor
    body(c, m.chain);
    collar(c, m.chain, 0.078, 0.13, 0.12);
    shell(c, m.clothTex, 0.05, 0.9, 0.012);
    cross(c, m.cream, { extra: 0.016, arm: 0.6 });
    T(new THREE.TorusGeometry(0.03, 0.009, 4, 12, PI * 1.25), m.gold, [0.012, 0.31, frontZ(0.31, 0.02) + 0.004], [1, 1, 0.45], [0, 0, 2.2]);
    mantle(c, m.chain, { rows: 4, dag: 0.035 });
    belt(c, 0.18);
    pouch(c, -1);
    const sk = { r0: 0.178, r1: 0.25, len: 0.52, segs: 24, rows: 7, dag: 0.05 };
    skirt(c, m.clothTex, sk);
    skirt(c, m.cream, { ...sk, r0: 0.181, r1: 0.253, a0: -0.17, a1: 0.17, segs: 2, dag: 0, len: 0.5 });
    for (const x of [-0.07, 0.085]) {
      k.addSkirt(new THREE.CylinderGeometry(0.004, 0.004, 0.26, 5, 4), m.steelDark, [x, -0.15, 0.2]);
      k.addSkirt(new THREE.SphereGeometry(0.026, 10, 8), m.steel, [x, -0.3, 0.215]);
    }
    scabbard(m.steelDark);
  } else if (style === "coatplates") {
    // Plåtrock: nitat tyg i spelarens färg med plåtar under, tre remmar fram, brynja som sticker fram nertill
    const sc = [1.27, 1, 0.82];
    body(c, m.coat, sc);
    collar(c, m.chain, 0.078, 0.11, 0.1);
    frontStraps(c, 0.002 * 1 + 0.004);
    belt(c, 0.184);
    const sk = { r0: 0.18, r1: 0.212, len: 0.19 };
    skirt(c, m.coat, sk);
    skirt(c, m.chain, { r0: 0.176, r1: 0.214, y0: -0.12, len: 0.13, rows: 2 });
    scabbard(m.steelDark);
  } else if (style === "brigandine") {
    // Brigandin: nitad väst med remmar fram, brynja under, bälte med väska
    const sc = [1.26, 1, 0.81];
    body(c, m.chain);
    shell(c, m.brig, 0.04, 0.93, 0.012, -PI, PI, sc);
    collar(c, m.chain, 0.078, 0.11, 0.1);
    frontStraps(c, 0.018);
    belt(c, 0.184);
    pouch(c, -1);
    const sk = { r0: 0.18, r1: 0.208, len: 0.17 };
    skirt(c, m.brig, sk);
    skirt(c, m.chain, { r0: 0.176, r1: 0.212, y0: -0.11, len: 0.12, rows: 2 });
  } else if (style === "guard") {
    // Stadsvakt: livré i två halvor (veckat ljust och spelarens färg) med nycklar på bröstet, vaddering under
    const sc = [1.25, 1, 0.8];
    body(c, m.padDark, sc);
    shell(c, m.clothTex, 0.05, 0.9, 0.012, 0, 1.25, sc);
    shell(c, m.pleat, 0.05, 0.9, 0.012, -1.25, 0, sc);
    shell(c, m.clothTex, 0.05, 0.9, 0.012, PI - 1.25, PI, sc);
    shell(c, m.pleat, 0.05, 0.9, 0.012, PI, PI + 1.25, sc);
    mantle(c, m.chain, { rows: 2 });
    collar(c, m.chain, 0.078, 0.1, 0.08);
    // Två korslagda nycklar i mässing
    const z = frontZ(0.33, 0.016, 0.8) + 0.006;
    for (const d of [1, -1]) {
      T(new THREE.BoxGeometry(0.009, 0.1, 0.006), m.brass, [-0.05, 0.33, z], [1, 1, 1], [0, 0, 0.6 * d]);
      T(new THREE.TorusGeometry(0.012, 0.004, 4, 8), m.brass, [-0.05 - 0.034 * d, 0.378, z]);
      T(new THREE.BoxGeometry(0.018, 0.009, 0.006), m.brass, [-0.05 + 0.034 * d, 0.29, z]);
    }
    T(new THREE.SphereGeometry(0.04, 10, 8), m.bootDark, [-0.05, 0.335, z - 0.016], [1.2, 1.3, 0.3]);
    belt(c, 0.182);
    pouch(c, -1);
    const sk = { r0: 0.18, r1: 0.214, len: 0.22 };
    for (const o of [0, PI]) {
      skirt(c, m.clothTex, { ...sk, a0: o, a1: o + 1.3, segs: 6 });
      skirt(c, m.pleat, { ...sk, a0: o - 1.3, a1: o, segs: 6 });
    }
    hem(c, m.brass, sk, 0.012);
    skirt(c, m.padDark, { r0: 0.174, r1: 0.215, len: 0.27 });
  } else if (style === "mercenary") {
    // Legoknekt: vadderad jack med hög krage, rem över bröstet, brett tygbälte i spelarens färg, skört i två våningar
    const sc = [1.27, 1, 0.82];
    body(c, m.jack, sc);
    collar(c, m.jack, 0.082, 0.105, 0.1);
    T(new THREE.BoxGeometry(0.02, 0.07, 0.006), m.cream, [0, 0.36, frontZ(0.36, 0.002, 0.82) + 0.004]);
    baldric(c, -1, 0.04, m.strap, 0.212, 0.146);
    buckle(T, m.brass, [-0.05, 0.215, frontZ(0.215, 0.012, 0.82) + 0.004], 0.04, 0.05, [0, -0.2, -0.62], 0.007);
    P(new THREE.CylinderGeometry(0.186, 0.186, 0.075, 20, 1, true), m.clothTex, [0, 0, 0], [1, 1, 0.84]);
    pouch(c, -1);
    skirt(c, m.jack, { r0: 0.186, r1: 0.214, y0: -0.03, len: 0.1, rows: 2 });
    skirt(c, m.jack, { r0: 0.178, r1: 0.214, y0: -0.11, len: 0.1, rows: 2 });
    skirt(c, m.chain, { r0: 0.172, r1: 0.212, y0: -0.18, len: 0.09, rows: 2 });
  } else if (style === "halfplate") {
    // Halvplåt: bröstplåt över brynja, band i spelarens färg, bälte, brynjekjol med mässingsringar i kanten
    body(c, m.chain);
    collar(c, m.chain, 0.078, 0.13, 0.12);
    mantle(c, m.chain, { rows: 3 });
    cuirass(c, m.steel);
    T(new THREE.TorusGeometry(0.175, 0.007, 5, 22), m.steelDark, [0, 0.01, 0], [1.15, 0.78, 1], [half, 0, 0]);
    T(new THREE.TorusGeometry(0.1, 0.012, 6, 18), m.steelDark, [0, 0.452, 0], [1.1, 0.78, 1], [half, 0, 0]);
    for (const sx of [1, -1]) T(new THREE.SphereGeometry(0.008, 5, 4), m.brass, [0.1 * sx, 0.4, 0.1]);
    k.addSash(T, P, m, 0.212, 0.172);
    belt(c, 0.186);
    flap(c, m.clothTex, -0.075, 0.08, 0.2, 0.185);
    const mail = { r0: 0.18, r1: 0.224, len: 0.28 };
    skirt(c, m.chain, mail);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * PI * 2;
      k.addSkirt(new THREE.SphereGeometry(0.009, 6, 5), m.brass, [Math.sin(a) * 0.224, -0.285, Math.cos(a) * 0.224 * 0.84]);
    }
    scabbard(m.steelDark);
  } else if (style === "crusader") {
    // Korsriddare: brynja, ljus vapenrock med kors i spelarens färg fram och bak, bälte med två väskor
    body(c, m.chain);
    collar(c, m.chain, 0.078, 0.13, 0.12);
    shell(c, m.surWhite, 0.05, 0.9, 0.012);
    cross(c, m.clothTex, { extra: 0.016, back: true, arm: 0.55 });
    mantle(c, m.chain, { rows: 4 });
    belt(c, 0.18);
    pouch(c, -1);
    pouch(c, 1, true);
    // Lång rock med springa fram, smutsig och fransig i fållen
    const sk = { r0: 0.178, r1: 0.246, len: 0.5, a0: 0.035, a1: PI * 2 - 0.035, segs: 26, rows: 7, dag: 0.022 };
    skirt(c, m.surWhite, sk);
    skirt(c, m.chain, { r0: 0.17, r1: 0.215, len: 0.3, a0: -0.5, a1: 0.5, segs: 6 });
    scabbard(m.steelDark);
  }
}

// ---------- Armar och ben, rustning för rustning ----------
export function buildOutfitLimbs(k, style, side, s, upper, fore, hand, thigh, shin, foot, m, H) {
  const add = (seg) => (...a) => seg.add(k.shape(...a));
  const L = { k, m, H, s, side, U: add(upper), F: add(fore), HN: add(hand), TH: add(thigh), SH: add(shin), FT: add(foot) };
  const { U, F, HN, SH, FT } = L;
  const { latheAlong, PROFILE } = H;

  if (style === "plate" || style === "gilded") {
    const rich = style === "gilded";
    plateArm(L, m.steel, m.trim, { rich, pauldron: { lames: rich ? 4 : 3, size: rich ? 1.06 : 1 } });
    plateLeg(L, m.steel, m.trim, { point: 0.22 });
    if (rich) L.TH(band(H, PROFILE.thigh, 0.42, 0.82, 0.02, 0.035), m.gold);
  } else if (style === "chain") {
    glove(L, m.leatherDark, { cuff: 0.06 });
    boots(L, { boot: m.boot, cuff: false, top: 0.3 });
  } else if (style === "leather") {
    // Axelskydd i läder i två lager med nitar
    shoulderCap(L, m.leatherDark, null, 1.02);
    U(new THREE.CylinderGeometry(0.1, 0.112, 0.05, 16, 1, true), m.leather, [0.016 * s, -0.05, 0], [1.08, 1, 1.14]);
    for (const z of [0.06, 0, -0.06]) U(new THREE.SphereGeometry(0.008, 5, 4), m.brass, [(0.1 - Math.abs(z) * 0.5) * s, -0.045, z * 1.5]);
    bracer(k, F, s, H, m, m.leatherDark);
    glove(L, m.leatherDark, { cuff: 0 });
    kneePad(L, m.leather, m.leatherDark);
    boots(L, { boot: m.boot });
    trouserPuff(L, m.wool);
  } else if (style === "jester") {
    const A = side === "L" ? m.motleyA : m.motleyB;
    const B = side === "L" ? m.motleyB : m.motleyA;
    // Randig puffärm, krås vid handleden
    for (let i = 0; i < 8; i++) U(new THREE.SphereGeometry(0.104, 3, 8, (i * PI) / 4, PI / 4), i % 2 ? A : B, [0.012 * s, -0.055, 0], [1, 1.12, 1.06]);
    U(new THREE.TorusGeometry(0.058, 0.01, 5, 14), B, [0, -0.165, 0], [1, 1, 1], [half, 0, 0]);
    F(new THREE.CylinderGeometry(0.046, 0.064, 0.035, 14, 1, true), A, [0, -0.24, 0]);
    F(new THREE.TorusGeometry(0.047, 0.006, 4, 14), m.bell, [0, -0.222, 0], [1, 1, 1], [half, 0, 0]);
    k.addHand(HN, m.skin, s, 1);
    // Mjuka skor med lång, uppkrullad tå och en bjällra
    FT(new THREE.CylinderGeometry(0.056, 0.06, 0.08, 12, 1, true), A, [0, -0.04, 0]);
    FT(new THREE.SphereGeometry(1, 12, 8), A, [0, -0.07, 0.05], [0.06, 0.045, 0.12]);
    FT(new THREE.ConeGeometry(0.035, 0.17, 8), A, [0, -0.045, 0.2], [1, 1, 0.8], [half - 0.55, 0, 0]);
    FT(new THREE.TorusGeometry(0.035, 0.011, 6, 10, PI * 1.2), A, [0, 0.0, 0.27], [1, 1, 1], [0, half, -0.3]);
    FT(new THREE.SphereGeometry(0.018, 8, 6), m.bell, [0, 0.03, 0.245]);
    FT(new THREE.TorusGeometry(0.058, 0.007, 4, 12), B, [0, 0.0, 0], [1, 1, 1], [half, 0, 0]);
  } else if (style === "hedge") {
    if (side === "L") {
      // En tjock rulle av rep och tyg som axelskydd
      for (let i = 0; i < 4; i++) U(new THREE.TorusGeometry(0.075 - i * 0.004, 0.022, 6, 14), m.rope, [0.02 * s, 0.02 - i * 0.03, 0], [1.1, 1.2, 1], [half, 0, 0]);
    } else {
      pauldron(L, m.rusty, m.forged, { lames: 2, rivets: false });
    }
    glove(L, m.leatherDark, { cuff: 0.12, size: 1.14 });
    if (side === "R") kneeCop(L, m.rusty, null);
    else L.TH(new THREE.BoxGeometry(0.07, 0.06, 0.012), m.leather, [0, -0.32, 0.09], [1, 1, 1], [-0.1, 0, 0.2]);
    boots(L, { boot: m.leatherDark, round: true, mud: m.mud });
    trouserPuff(L, m.wool);
  } else if (style === "gambeson") {
    // Vadderade axelrullar, remmar runt underarmen, läderhandskar
    for (let i = 0; i < 3; i++) U(new THREE.TorusGeometry(0.078 - i * 0.004, 0.02, 6, 14), m.gamb, [0.014 * s, 0.01 - i * 0.034, 0], [1.08, 1.16, 1], [half, 0, 0]);
    for (const f of [0.35, 0.8]) F(band(H, PROFILE.forearm, 0.26, f, 0.012, 0.04), m.gambDark);
    glove(L, m.leatherDark, { cuff: 0.07 });
    boots(L, { boot: m.boot });
    trouserPuff(L, m.wool);
  } else if (style === "surcoat") {
    pauldron(L, m.steel, m.trim, { lames: 2, size: 1.04 });
    plateArm(L, m.steel, m.trim, { pauldron: false, upper: false, gauntlet: false });
    glove(L, m.leatherDark, { cuff: 0 });
    boots(L, { boot: m.boot, cuff: false, top: 0.3 });
  } else if (style === "coatplates") {
    plateArm(L, m.steel, m.steelDark, { pauldron: { lames: 3 } });
    plateLeg(L, m.steel, m.steelDark, { cuisse: false, point: 0.1 });
  } else if (style === "brigandine") {
    shoulderCap(L, m.steel, m.steelDark, 1);
    glove(L, m.leatherDark, { cuff: 0.11 });
    kneeCop(L, m.steel, m.brass);
    boots(L, { boot: m.boot, cross: false });
    trouserPuff(L, m.wool);
  } else if (style === "guard") {
    // Puffad axel (ena i spelarens färg, andra ljus), vadderade ärmar, läderhandskar, korta stövlar
    U(new THREE.SphereGeometry(0.088, 14, 10), side === "L" ? m.clothTex : m.cream, [0.012 * s, -0.04, 0], [1.04, 1.02, 1.08]);
    U(new THREE.TorusGeometry(0.066, 0.008, 5, 14), m.brass, [0, -0.125, 0], [1.05, 1.05, 1], [half, 0, 0]);
    glove(L, m.leather, { cuff: 0.1 });
    SH(band(H, PROFILE.shin, 0.4, 0.06, 0.006, 0.03), m.bootDark); // hosans band under knät
    boots(L, { boot: m.boot, cross: false, top: 0.62, round: true });
  } else if (style === "mercenary") {
    glove(L, m.leatherDark, { cuff: 0.1 });
    if (side === "L") {
      SH(band(H, PROFILE.shin, 0.4, 0.1, 0.012, 0.09), m.leather); // lindat knä
      boots(L, { boot: m.leather, cuff: true, cross: false, top: 0.5, round: true });
    } else {
      boots(L, { boot: m.leatherDark, round: true });
      trouserPuff(L, m.wool);
    }
  } else if (style === "halfplate") {
    pauldron(L, m.steel, m.brass, { lames: 2 });
    plateArm(L, m.steel, m.steelDark, { pauldron: false, upper: false, gauntlet: false });
    for (const f of [0.3, 0.6]) F(band(H, PROFILE.forearm, 0.26, f, 0.014, 0.05), m.strap);
    glove(L, m.leatherDark, { cuff: 0 });
    plateLeg(L, m.steel, m.steelDark, { sabaton: false });
    boots(L, { boot: m.boot, cross: false, top: 0.7, round: true });
  } else if (style === "crusader") {
    pauldron(L, m.steel, m.steelDark, { lames: 1 });
    bracer(k, F, s, H, m, m.leather);
    glove(L, m.leatherDark, { cuff: 0 });
    boots(L, { boot: m.boot, cross: false });
    for (const f of [0.55, 0.75]) SH(new THREE.SphereGeometry(0.007, 5, 4), m.brass, [0.075 * s, -0.4 * f, 0]);
  }
}
