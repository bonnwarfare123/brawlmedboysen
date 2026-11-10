// KROPPEN – mjuka leder, händer och fötter.
//
// Förr var armar och ben stela rör som möttes i en kula i varje led. Här byggs i stället ett
// sammanhängande "skinn" per arm och ben som böjer sig mjukt över axel, armbåge, höft och knä.
// Skinnet följer samma kroppsdelar som förut (ingen ny animation behövs).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bell = (x, w) => Math.exp(-((x / w) ** 2));

// ---------- Skinn ----------
// En ring = { c: mittpunkt, ex/ez: ringens två riktningar, xz: [x0, z0, x1, z1 ...], b: [ben A, ben B], w: vikt för ben B, v }
function ring(c, ex, ez, xz, b, w, v) {
  return { c, ex, ez, xz, b, w, v };
}

// Ringar för en arm. S = axelleden (i riddarens egna mått, stående rakt), s = +1 vänster / -1 höger.
// sec1/sec2(f, sin, cos, out) ger tvärsnittet på överarm/underarm vid andelen f av längden.
export function armRings({ S, s, L1, L2, sec1, sec2, bones, N = 14 }) {
  const rings = [];
  const [bTorso, bUpper, bFore] = bones;
  const out = [0, 0];
  const section = (t) => {
    const xz = new Float32Array(N * 2);
    const wFore = smooth(L1 - 0.06, L1 + 0.06, t);
    const fA = t / L1;
    const fB = (t - L1) / L2;
    const elbow = bell(t - L1, 0.04);
    const delt = bell(t - 0.05, 0.07); // axelmuskeln buktar utåt överst
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      const sn = Math.sin(a), cs = Math.cos(a);
      let x = 0, z = 0;
      if (wFore < 1) { sec1(Math.min(1, Math.max(0, fA)), sn, cs, out); x += out[0] * (1 - wFore); z += out[1] * (1 - wFore); }
      if (wFore > 0) { sec2(Math.min(1, Math.max(0, fB)), sn, cs, out); x += out[0] * wFore; z += out[1] * wFore; }
      if (cs < 0) z *= 1 + 0.16 * elbow * -cs;            // armbågsspetsen
      x *= 1 + 0.03 * elbow;
      if (sn * s > 0) x *= 1 + 0.2 * delt * sn * s;       // axelmuskeln (bara utåt)
      xz[j * 2] = x;
      xz[j * 2 + 1] = z;
    }
    return xz;
  };

  // Axeln: en båge från bålen (vågrätt) över till armen (lodrätt)
  const rho = 0.022, d1 = 0.04;
  const Q = new THREE.Vector3(S.x - s * rho, S.y - d1, S.z);
  const top = section(d1);
  const ez = new THREE.Vector3(0, 0, 1);
  // I armhålan möts ringarna i en linje (annars viker sig ytan över sig själv)
  const capXZ = (kx, kz) => {
    const o = new Float32Array(N * 2);
    for (let j = 0; j < N; j++) {
      const x = top[j * 2] * kx;
      o[j * 2] = s * Math.max(s * x, -rho + 0.002);
      o[j * 2 + 1] = top[j * 2 + 1] * kz;
    }
    return o;
  };
  // Inne i bålen
  for (const [dx, k] of [[0.1, 0.55], [0.055, 0.9]]) {
    rings.push(ring(new THREE.Vector3(Q.x - s * dx, Q.y + rho, S.z), new THREE.Vector3(0, s, 0), ez, capXZ(0.92 * k, 1.06 * k), [bTorso, bUpper], 0, -0.1));
  }
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const u = 1 - i / steps; // 1 = uppe vid bålen, 0 = armen
    const th = (u * Math.PI) / 2;
    const rad = new THREE.Vector3(s * Math.cos(th), Math.sin(th), 0);
    const c = Q.clone().addScaledVector(rad, rho);
    const exr = new THREE.Vector3(Math.cos(th), s * Math.sin(th), 0);
    rings.push(ring(c, exr, ez, capXZ(1 - 0.08 * u, 1 + 0.06 * u), [bTorso, bUpper], 1 - smooth(0.2, 0.9, u), -0.02 * u));
  }
  // Armen rakt ner
  const ex = new THREE.Vector3(1, 0, 0);
  const total = L1 + L2;
  let t = d1;
  while (t < total - 1e-4) {
    const near = Math.abs(t - L1) < 0.075;
    t = Math.min(total, t + (near ? 0.0125 : 0.028));
    rings.push(ring(new THREE.Vector3(S.x, S.y - t, S.z), ex, ez, section(t), [bUpper, bFore], smooth(L1 - 0.042, L1 + 0.042, t), t));
  }
  return rings;
}

export function legRings({ H, s, L1, L2, sec1, sec2, bones, N = 14 }) {
  const rings = [];
  const [bPelvis, bThigh, bShin] = bones;
  const out = [0, 0];
  const ex = new THREE.Vector3(1, 0, 0), ez = new THREE.Vector3(0, 0, 1);
  const total = L1 + L2;
  const section = (t) => {
    const xz = new Float32Array(N * 2);
    const wShin = smooth(L1 - 0.07, L1 + 0.07, t);
    const knee = bell(t - L1, 0.05);
    const up = t < 0 ? 1 + t * 3.2 : 1; // smalnar av upp i höften
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      const sn = Math.sin(a), cs = Math.cos(a);
      let x = 0, z = 0;
      if (wShin < 1) { sec1(Math.min(1, Math.max(0, t / L1)), sn, cs, out); x += out[0] * (1 - wShin); z += out[1] * (1 - wShin); }
      if (wShin > 0) { sec2(Math.min(1, Math.max(0, (t - L1) / L2)), sn, cs, out); x += out[0] * wShin; z += out[1] * wShin; }
      if (cs > 0) z *= 1 + 0.07 * knee * cs;   // knäskålen
      else z *= 1 - 0.08 * knee;              // knävecket
      x *= 1 + 0.04 * knee;
      xz[j * 2] = x * up;
      xz[j * 2 + 1] = z * up;
    }
    return xz;
  };
  let t = -0.1;
  rings.push(ring(new THREE.Vector3(H.x, H.y - t, H.z), ex, ez, section(t), [bPelvis, bThigh], 0, t));
  while (t < total - 1e-4) {
    const near = Math.abs(t - L1) < 0.085 || t < 0.05;
    t = Math.min(total, t + (near ? 0.014 : 0.03));
    const top = t < L1 / 2;
    rings.push(ring(new THREE.Vector3(H.x, H.y - t, H.z), ex, ez, section(t), top ? [bPelvis, bThigh] : [bThigh, bShin],
      top ? smooth(-0.05, 0.045, t) : smooth(L1 - 0.065, L1 + 0.065, t), t));
  }
  return rings;
}

// Bygg en slang av ringarna (med lock i båda ändar). Ger form med skinnvikter.
export function tubeGeometry(rings, N = 14, vScale = 3) {
  const cols = N + 1;
  const count = rings.length * cols + 2;
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const si = new Uint16Array(count * 4);
  const sw = new Float32Array(count * 4);
  let k = 0;
  const put = (x, y, z, u, v, r) => {
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    uv[k * 2] = u; uv[k * 2 + 1] = v;
    si[k * 4] = r.b[0]; si[k * 4 + 1] = r.b[1];
    sw[k * 4] = 1 - r.w; sw[k * 4 + 1] = r.w;
    return k++;
  };
  for (const r of rings) {
    for (let j = 0; j <= N; j++) {
      const jj = j % N;
      const x = r.xz[jj * 2], z = r.xz[jj * 2 + 1];
      put(r.c.x + r.ex.x * x + r.ez.x * z, r.c.y + r.ex.y * x + r.ez.y * z, r.c.z + r.ex.z * x + r.ez.z * z, j / N, -r.v * vScale, r);
    }
  }
  const first = rings[0], last = rings[rings.length - 1];
  const capA = put(first.c.x, first.c.y, first.c.z, 0.5, -first.v * vScale, first);
  const capB = put(last.c.x, last.c.y, last.c.z, 0.5, -last.v * vScale, last);
  const index = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const lastRow = (rings.length - 1) * cols;
  for (let j = 0; j < N; j++) {
    index.push(capA, j, j + 1);
    index.push(capB, lastRow + j + 1, lastRow + j);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // Sömmen (första och sista kolumnen ligger på samma ställe): samma riktning på ytan
  const n = geo.attributes.normal;
  for (let i = 0; i < rings.length; i++) {
    const a = i * cols, b = a + N;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
  return geo;
}

// ---------- Former ----------

// En "tvål": en kula som dragits ut mot en låda (rundade hörn). a, b, c = halva måtten.
function soap(a, b, c, boxy = 0.5, ws = 12, hs = 8) {
  const geo = new THREE.SphereGeometry(1, ws, hs);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) || 1;
    const k = 1 - boxy + boxy / m;
    p.setXYZ(i, x * k * a, y * k * b, z * k * c);
  }
  geo.computeVertexNormals();
  return geo;
}

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _d = new THREE.Vector3();
// En kapsel mellan två punkter
function bone(p0, p1, r, radial = 6) {
  _d.subVectors(p1, p0);
  const len = _d.length();
  const geo = new THREE.CapsuleGeometry(r, len, 1, radial);
  _q.setFromUnitVectors(_up, _d.normalize());
  geo.applyQuaternion(_q);
  geo.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
  return geo;
}

// ---------- Hand ----------
// Handen byggs runt det den håller: en stång genom G i riktningen A (vapnets grepp).
// Fingrarna går runt stången, tummen ligger om från andra hållet, och handryggen pekar utåt.
// Mått: uo = utåt från kroppen, d = bort från handleden, a = längs greppet (mot klingan).
const GRIP = new THREE.Vector3(0, -0.069, 0.01);
const AX = new THREE.Vector3(0, Math.cos(2.0), Math.sin(2.0));       // längs greppet
const DN = new THREE.Vector3(0, -Math.sin(2.0), Math.cos(2.0));      // bort från handleden
export function handParts(s, k = 1, opts = {}) {
  const P = (uo, d, a) => new THREE.Vector3(GRIP.x + s * uo * k, GRIP.y + (DN.y * d + AX.y * a) * k, GRIP.z + (DN.z * d + AX.z * a) * k);
  const main = [];
  const tips = []; // yttersta fingerleden (annan färg på plåthandskar)
  const plate = [];

  // Fyra fingrar: tre leder var, böjda runt greppet
  const fingers = [
    { a: -0.060, len: 0.84, r: 0.0082 }, // lillfinger
    { a: -0.041, len: 0.97, r: 0.009 },
    { a: -0.021, len: 1.03, r: 0.0095 },
    { a: -0.001, len: 0.97, r: 0.0093 }, // pekfinger
  ];
  for (const f of fingers) {
    const L = f.len;
    const K = P(0.03, -0.006, f.a);
    const p1 = P(0.03 - 0.024 * L, -0.006 + 0.036 * L, f.a);
    const p2 = P(p1x(L) - 0.032 * L, pd1(L) - 0.018 * L, f.a + 0.001);
    const p3 = P(p1x(L) - 0.033 * L, pd1(L) - 0.044 * L, f.a + 0.002);
    main.push(bone(K, p1, f.r * k), bone(p1, p2, f.r * 0.94 * k));
    tips.push(bone(p2, p3, f.r * 0.86 * k));
    // Knoge
    const kn = new THREE.SphereGeometry(f.r * 1.22 * k, 6, 4);
    kn.translate(K.x, K.y, K.z);
    main.push(kn);
  }
  function p1x(L) { return 0.03 - 0.024 * L; }
  function pd1(L) { return -0.006 + 0.036 * L; }

  // Handrygg och handflata: en rundad platta från handleden till knogarna
  {
    const W = P(0.004, -0.06, -0.031), K = P(0.027, -0.004, -0.031);
    const dir = K.clone().sub(W);
    const len = dir.length();
    dir.normalize();
    const along = new THREE.Vector3(0, AX.y, AX.z);
    const thick = new THREE.Vector3().crossVectors(dir, along).normalize();
    const geo = soap(len / 2 + 0.006 * k, 0.0165 * k, 0.041 * k, 0.55, 12, 8);
    const m = new THREE.Matrix4().makeBasis(dir, thick, along);
    geo.applyMatrix4(m);
    const mid = W.clone().add(K).multiplyScalar(0.5).addScaledVector(thick, 0.0 * k);
    // plattan ligger lite in mot greppet (handflatan trycker mot det)
    const inward = P(0, 0, -0.031).sub(mid).normalize();
    mid.addScaledVector(inward, 0.004 * k);
    geo.translate(mid.x, mid.y, mid.z);
    main.push(geo);
    if (opts.plate) {
      // Handskens ryggplåt
      const pg = soap(len / 2 + 0.002 * k, 0.006 * k, 0.043 * k, 0.75, 8, 6);
      pg.applyMatrix4(m);
      const pm = mid.clone().addScaledVector(inward, -0.016 * k);
      pg.translate(pm.x, pm.y, pm.z);
      plate.push(pg);
    }
  }
  // Tumme: tumbas (handflatans muskel), två leder om greppet från andra hållet
  {
    const t0 = P(-0.002, -0.05, -0.004), t1 = P(-0.02, -0.031, 0.016), t2 = P(-0.031, -0.008, 0.021), t3 = P(-0.024, 0.014, 0.02);
    main.push(bone(t0, t1, 0.0125 * k), bone(t1, t2, 0.0108 * k));
    tips.push(bone(t2, t3, 0.0096 * k));
    const th = soap(0.02 * k, 0.024 * k, 0.02 * k, 0.2, 8, 6);
    const c = P(-0.004, -0.043, -0.012);
    th.translate(c.x, c.y, c.z);
    main.push(th);
    // Lillfingersidan av handflatan
    const hy = soap(0.016 * k, 0.024 * k, 0.014 * k, 0.2, 8, 6);
    const c2 = P(-0.002, -0.036, -0.058);
    hy.translate(c2.x, c2.y, c2.z);
    main.push(hy);
  }
  // Handleden: smal åt sidan, bred framåt–bakåt (handflatan vetter in mot kroppen)
  {
    const w = new THREE.SphereGeometry(1, 10, 8);
    w.scale(0.027 * k, 0.03 * k, 0.037 * k);
    w.translate(0, -0.008 * k, -0.001 * k);
    main.push(w);
  }
  const strip = (list) => {
    const g = list.map((x) => { const n = x.index ? x.toNonIndexed() : x; for (const key of Object.keys(n.attributes)) if (!["position", "normal", "uv"].includes(key)) n.deleteAttribute(key); return n; });
    return g.length ? mergeGeometries(g) : null;
  };
  return { main: strip(main), tips: strip(tips), plate: strip(plate) };
}

// ---------- Sko ----------
// En sko formad som en fot: häl, vrist, tåparti och (om man vill) en lång spets.
// Foten sitter med fotleden i origo, sulan vid y = -0.105 och tårna mot +z.
export function shoeParts({ point = 0, round = false, wide = 1, sturdy = false } = {}) {
  const y0 = -0.106;
  const z0 = -0.068;
  const zToe = 0.165;                 // där tåpartiet slutar och spetsen börjar
  const z1 = zToe + (round ? 0.04 : 0.05 + point);
  const key = (pts, z) => {
    for (let i = 1; i < pts.length; i++) {
      if (z <= pts[i][0]) {
        const [za, a] = pts[i - 1], [zb, b] = pts[i];
        const t = smooth(0, 1, (z - za) / (zb - za || 1));
        return a + (b - a) * t;
      }
    }
    return pts[pts.length - 1][1];
  };
  // halva bredden och höjden längs foten
  const W = [[z0, 0.018], [-0.05, 0.039], [-0.01, 0.046], [0.06, 0.05], [0.115, 0.056], [zToe, round ? 0.05 : 0.04], [z1 - 0.012, round ? 0.03 : 0.008], [z1, 0.003]];
  const Hh = [[z0, 0.03], [-0.052, 0.082], [-0.02, 0.1], [0.022, 0.098], [0.06, 0.066], [0.115, 0.047], [zToe, round ? 0.042 : 0.034], [z1 - 0.012, round ? 0.028 : 0.012], [z1, 0.004]];
  const rows = 22, N = 12;
  const pos = [], uv = [], index = [];
  for (let i = 0; i <= rows; i++) {
    const f = i / rows;
    const z = z0 + (z1 - z0) * (f < 0.75 ? f * (zToe - z0) / (z1 - z0) / 0.75 : (zToe - z0) / (z1 - z0) + ((f - 0.75) / 0.25) * (1 - (zToe - z0) / (z1 - z0)));
    const w = key(W, z) * wide, h = key(Hh, z) * (sturdy && z > 0.05 ? 1.22 : 1);
    const lift = z > zToe && !round ? ((z - zToe) / (z1 - zToe)) ** 2 * (0.02 + point * 0.12) : z > 0.1 ? ((z - 0.1) / 0.1) ** 2 * 0.006 : 0;
    for (let j = 0; j <= N; j++) {
      const a = (j / N) * Math.PI;
      const c = Math.cos(a), sn = Math.sin(a);
      // lite fyrkantigare nertill (sidorna går rakt ner mot sulan)
      const x = w * Math.sign(c) * Math.abs(c) ** 0.75;
      const y = y0 + lift + h * sn ** 0.85;
      pos.push(x, y, z);
      uv.push(j / N, f * 2);
    }
  }
  const cols = N + 1;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < N; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  // häl-lock
  const upper = new THREE.BufferGeometry();
  upper.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  upper.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  upper.setIndex(index);
  upper.computeVertexNormals();

  // Sula: följer fotens kontur, lite bredare, med klack
  const shape = new THREE.Shape();
  const pts = [];
  const M = 20;
  for (let i = 0; i <= M; i++) {
    const z = z0 + ((z1 - z0) * i) / M;
    pts.push([key(W, z) * wide + (sturdy ? 0.008 : 0.004), z]);
  }
  shape.moveTo(pts[0][0], pts[0][1]);
  for (const [x, z] of pts) shape.lineTo(x, z);
  for (let i = M; i >= 0; i--) shape.lineTo(-pts[i][0], pts[i][1]);
  const sole = new THREE.ExtrudeGeometry(shape, { depth: sturdy ? 0.017 : 0.011, bevelEnabled: false, curveSegments: 1 });
  sole.rotateX(Math.PI / 2);       // formen (x, z) läggs ner: y blir nedåt
  sole.translate(0, y0 + 0.004, 0);
  // spetsen på sulan följer med uppåt
  const sp = sole.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const z = sp.getZ(i);
    if (z > zToe && !round) sp.setY(i, sp.getY(i) + ((z - zToe) / (z1 - zToe)) ** 2 * (0.02 + point * 0.12));
    else if (z > 0.1) sp.setY(i, sp.getY(i) + ((z - 0.1) / 0.1) ** 2 * 0.006);
  }
  sole.computeVertexNormals();
  const heel = new THREE.BoxGeometry(0.074 * wide, 0.016, 0.062);
  heel.translate(0, y0 - 0.006, -0.034);
  const clean = (g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!["position", "normal", "uv"].includes(k)) n.deleteAttribute(k); return n; };
  return { upper, sole: mergeGeometries([clean(sole), clean(heel)]) };
}

// ---------- Kjol ----------
// Ger en form vikter så att den följer låren: ingenting vid bältet, mest vid fållen,
// vänster sida följer vänster lår och höger sida höger lår.
export function skirtWeights(geo, hipL, hipR, bones) {
  const pos = geo.attributes.position;
  const si = new Uint16Array(pos.count * 4);
  const sw = new Float32Array(pos.count * 4);
  const top = hipL.y + 0.07;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const down = smooth(0.02, 0.2, top - y) * 0.94;
    const left = smooth(-0.07, 0.07, x); // mitt emellan benen: hälften av varje
    const l = left * down;
    const r = (1 - left) * down;
    si[i * 4] = bones[0]; si[i * 4 + 1] = bones[1]; si[i * 4 + 2] = bones[2];
    sw[i * 4] = 1 - l - r; sw[i * 4 + 1] = l; sw[i * 4 + 2] = r;
  }
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
  return geo;
}
