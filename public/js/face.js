// ANSIKTEN – kantig, handgjord stil (platta ytor, kraftiga drag), hår, skägg, krigsmålning.
//
// Allt slumpas fram ur ett frö (spelarens namn), så man ser likadan ut varje gång och alla ser samma ansikte.
// Huvudet är ett klot med få ytor som formas om (käke, haka, kindben, pannben) och ritas med platta ytor.
// Hudens färg, skäggstubb, fräknar, blåtiror, ärr och krigsmålning målas på en bild som läggs på huvudet.

import * as THREE from "three";

// Hudtoner (från ljus och fräknig till mörkbrun) och hårfärger
export const SKIN = [0xf3d2b6, 0xebc29c, 0xdcab80, 0xc79064, 0xa8714a, 0x8a5636, 0x6a3f27];
export const HAIR = [0x1c130c, 0x3a2414, 0x5a3820, 0x86562c, 0xc4964a, 0xdcbc72, 0xa4461c, 0x8a8682];
export const EYES = [0x3a2a1a, 0x4a6a8a, 0x5a6a3a, 0x2a2a2a, 0x5a7a9a];

// Slumpa fram ett ansikte. rand = seededRandom(frö)
export function rollFeatures(rand) {
  for (let i = 0; i < 6; i++) rand(); // de första talen ur ett litet frö är nästan lika: kasta dem
  const pick = (weights) => {
    let r = rand() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return i;
    return weights.length - 1;
  };
  const skinI = pick([1.2, 1.6, 1.6, 1.2, 0.9, 0.7, 0.6]);
  // Mörkare hud: mest mörkt hår. Ljus hud: alla färger, rött och blont oftare.
  const hairI = skinI >= 4 ? pick([3, 2, 1, 0.3, 0, 0, 0, 0.6]) : pick([1, 1.4, 1.4, 1, 1, 0.7, 0.8, 0.6]);
  const old = HAIR[hairI] === 0x8a8682;
  const hairStyle = pick([1.6, 1.4, 1, old ? 1.4 : 0.5, old ? 1.4 : 0.4, 0.9]); // 0 spretig, 1 rufsig, 2 långt, 3 flint, 4 tunnhårig, 5 snaggad
  const beard = pick([1.4, 1.2, 0.8, 1.4, 0.45, 0.7, 0.45]); // 0 inget, 1 stubb, 2 mustasch, 3 helskägg, 4 långt flätat, 5 pipskägg, 6 knävelborr
  const paintRoll = rand();
  return {
    skin: SKIN[skinI],
    skinIndex: skinI,
    hair: HAIR[hairI],
    eyes: EYES[Math.floor(rand() * EYES.length)],
    hairStyle,
    beard,
    jaw: 0.04 + rand() * 0.16,      // smal eller bred, fyrkantig käke
    chin: rand(),                   // hur mycket hakan sticker ut
    nose: 0.85 + rand() * 0.5,      // näsans storlek
    broken: rand() < 0.14,          // sned (bruten) näsa
    brow: rand(),                   // tunna eller kraftiga ögonbryn
    smirk: (rand() - 0.5) * 2,      // snett leende åt ena hållet
    browRaise: (rand() - 0.5) * 2,  // ena ögonbrynet lite högre
    scar: rand() < 0.2 ? (rand() < 0.5 ? 1 : 2) : 0, // 1 över ögat, 2 över kinden
    patch: rand() < 0.06,           // lapp för ögat
    gap: rand() < 0.22,             // en framtand saknas
    stubble: beard === 1 || (beard !== 3 && beard !== 4 && rand() < 0.35),
    freckles: (skinI <= 1 || hairI === 6) && rand() < 0.55,
    blackEye: rand() < 0.07,
    bandage: rand() < 0.07,         // plåster över näsan
    headband: rand() < 0.18 ? (rand() < 0.55 ? 0xa82418 : 0x1e1c1a) : 0, // pannband (syns utan hjälm)
    paint: paintRoll < 0.06 ? 1 : paintRoll < 0.11 ? 2 : paintRoll < 0.15 ? 3 : 0, // krigsmålning: röda ränder, blått band, svart dödskalle
  };
}

// ---------- Huvudet ----------
// Ett klot med få ytor som formas om. Riktningen på klotet (före formningen) sparas, så målningen
// på huden och skägget kan placeras efter var på ansiktet en punkt sitter.
export function sculptHead(f) {
  const geo = new THREE.SphereGeometry(1, 18, 14);
  const pos = geo.attributes.position;
  const dirs = new Float32Array(pos.count * 3);
  const d = new THREE.Vector3();
  const bump = (cx, cy, cz, radius, amount) => {
    const dist = Math.hypot(d.x - cx, d.y - cy, d.z - cz);
    return dist < radius ? amount * (1 - dist / radius) ** 2 : 0;
  };
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i);
    dirs.set([d.x, d.y, d.z], i * 3);
    let r = 1;
    for (const s of [1, -1]) {
      r -= bump(0.36 * s, 0.1, 0.92, 0.3, 0.08);    // ögonhålor
      r += bump(0.3 * s, 0.32, 0.9, 0.3, 0.07);     // kraftiga pannben
      r += bump(0.6 * s, -0.1, 0.76, 0.32, 0.07);   // kindben
      r -= bump(0.9 * s, 0.25, 0.3, 0.3, 0.04);     // tinningar
      r -= bump(0.55 * s, -0.45, 0.66, 0.24, 0.03); // under kindbenen
      r += bump(0.62 * s, -0.62, 0.42, 0.3, 0.04 + f.jaw * 0.25); // käkvinkel (fyrkantig käke)
    }
    r += bump(0, -0.82, 0.56, 0.32, 0.06 + f.chin * 0.08); // haka
    r += bump(0, 0.12, 0.99, 0.2, 0.02);                  // näsrot
    let x = d.x * r;
    let y = d.y * r;
    let z = d.z * r;
    // Lite fyrkantigare form (plattare sidor och front), käken smalnar av nedåt och skjuter fram
    x = Math.sign(x) * Math.abs(x) ** 0.92;
    z = z > 0 ? z ** 0.94 : z;
    const low = Math.min(1, Math.max(0, (-0.12 - d.y) / 0.8));
    x *= 1 - (0.2 - f.jaw * 0.6) * low * low;
    if (z > 0) z *= 1 + 0.3 * low;
    if (z < -0.3) z *= 1.04; // bakhuvudet
    pos.setXYZ(i, x * 0.09, y * 0.1, z * 0.095);
  }
  geo.translate(0, 0.135, 0.004);
  geo.computeVertexNormals();
  geo.userData.dirs = dirs;
  return geo;
}

// Var på huvudets yta en riktning hamnar (ungefär, för att placera saker utanpå)
export function headPoint(x, y, z, out = 1) {
  const len = Math.hypot(x, y, z) || 1;
  return [(x / len) * 0.09 * out, (y / len) * 0.1 * out + 0.135, (z / len) * 0.095 * out + 0.004];
}

// ---------- Huden: en målad bild ----------
// Bilden ligger på klotet: x över bilden = runt huvudet, y = uppifrån och ner.
// paint-funktionerna tar riktningar (x, y, z) på klotet: framåt är (0, 0, 1).
const TW = 512;
const TH = 256;
function toCanvas(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  let phi = Math.atan2(z / len, -x / len);
  if (phi < 0) phi += Math.PI * 2;
  return [(phi / (Math.PI * 2)) * TW, (Math.acos(Math.max(-1, Math.min(1, y / len))) / Math.PI) * TH];
}
const hex = (c) => "#" + new THREE.Color(c).getHexString();

export function faceTexture(f, rand) {
  const canvas = document.createElement("canvas");
  canvas.width = TW;
  canvas.height = TH;
  const g = canvas.getContext("2d");
  const skin = new THREE.Color(f.skin);
  g.fillStyle = hex(skin);
  g.fillRect(0, 0, TW, TH);
  const blob = (dir, radius, color, alpha) => {
    const [cx, cy] = toCanvas(...dir);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
    const c = new THREE.Color(color);
    const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
    grad.addColorStop(0, `rgba(${rgb},${alpha})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  };
  const stroke = (pts, width, color, alpha = 1) => {
    g.strokeStyle = hex(color);
    g.globalAlpha = alpha;
    g.lineWidth = width;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    pts.forEach((p, i) => {
      const [cx, cy] = toCanvas(...p);
      if (i) g.lineTo(cx, cy);
      else g.moveTo(cx, cy);
    });
    g.stroke();
    g.globalAlpha = 1;
  };
  // Rosiga kinder, lite rödare näsa och öron, mörkare under hakan
  for (const s of [1, -1]) blob([0.56 * s, -0.2, 0.8], 26, 0xc0504a, 0.16);
  blob([0, -0.05, 1], 14, 0xc0504a, 0.1);
  blob([0, -0.95, 0.3], 60, 0x000000, 0.1);
  // Skäggstubb: små prickar över käken, hakan och överläppen
  if (f.stubble || f.beard === 3 || f.beard === 4 || f.beard === 5) {
    const st = new THREE.Color(f.hair).lerp(skin, 0.35);
    g.fillStyle = hex(st);
    for (let i = 0; i < 2400; i++) {
      const a = (rand() - 0.5) * 2.4;
      const yy = -0.15 - rand() * 0.85;
      const dir = [Math.sin(a), yy, Math.cos(a)];
      if (dir[2] < -0.25) continue;
      const len = Math.hypot(...dir);
      if (!BEARD_REGION(dir[0] / len, dir[1] / len, dir[2] / len) && !(Math.abs(dir[0] / len) < 0.3 && dir[1] / len < -0.3 && dir[1] / len > -0.5)) continue; // + överläppen
      const [cx, cy] = toCanvas(...dir);
      g.globalAlpha = 0.18 + rand() * 0.3;
      g.fillRect(cx, cy, 1.4, 1.4);
    }
    g.globalAlpha = 1;
  }
  // Fräknar
  if (f.freckles) {
    g.fillStyle = hex(skin.clone().lerp(new THREE.Color(0x8a4a2a), 0.45));
    for (let i = 0; i < 70; i++) {
      const dir = [(rand() - 0.5) * 1.1, -0.05 - rand() * 0.3, 0.9];
      const [cx, cy] = toCanvas(...dir);
      g.globalAlpha = 0.5 + rand() * 0.4;
      g.beginPath();
      g.arc(cx, cy, 0.8 + rand() * 0.9, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  // Blåtira runt höger öga
  if (f.blackEye) {
    blob([-0.36, 0.08, 0.92], 22, 0x3a1c3a, 0.55);
    blob([-0.4, 0.0, 0.9], 14, 0x6a2a40, 0.35);
  }
  // Krigsmålning
  if (f.paint === 1) {
    // Två röda ränder lodrätt över vänster öga
    for (const x of [0.28, 0.44]) stroke([[x, 0.42, 0.85], [x, 0.1, 0.92], [x + 0.02, -0.25, 0.92], [x + 0.03, -0.45, 0.86]], 7, 0x9a1810, 0.88);
  } else if (f.paint === 2) {
    // Blått band snett över ansiktet
    stroke([[0.75, 0.4, 0.6], [0.3, 0.18, 0.92], [-0.2, -0.05, 0.96], [-0.7, -0.3, 0.6]], 16, 0x2a5aa8, 0.85);
  } else if (f.paint === 3) {
    // Svart dödskalle: mörka ögonhålor, svart nästipp och tänder ritade över läpparna
    for (const s of [1, -1]) blob([0.36 * s, 0.1, 0.92], 30, 0x0c0a0a, 0.95);
    blob([0, -0.1, 1], 10, 0x0c0a0a, 0.9);
    for (let i = -3; i <= 3; i++) stroke([[i * 0.07, -0.32, 0.95], [i * 0.075, -0.62, 0.8]], 1.6, 0x0c0a0a, 0.85);
    stroke([[-0.28, -0.47, 0.88], [0.28, -0.47, 0.88]], 2, 0x0c0a0a, 0.85);
    for (const s of [1, -1]) stroke([[0.55 * s, -0.15, 0.82], [0.4 * s, -0.4, 0.8]], 4, 0x1a1414, 0.5);
  }
  // Ärr: ljusare rand med mörkare kanter
  const scarLine = (pts) => {
    stroke(pts, 4.5, skin.clone().multiplyScalar(0.72), 0.5);
    stroke(pts, 2.4, skin.clone().lerp(new THREE.Color(0xf4c8c0), 0.55), 1);
  };
  if (f.scar === 1) scarLine([[0.26, 0.45, 0.86], [0.34, 0.15, 0.92], [0.42, -0.2, 0.88]]);
  if (f.scar === 2) scarLine([[-0.3, -0.05, 0.92], [-0.62, -0.38, 0.7]]);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- Hår ----------
// Hårfästet: lågt bak och på sidorna, högre framtill (pannan syns)
function hairShell(scale, yFront = 0.52, phiStart = 0, phiLength = Math.PI * 2) {
  const geo = new THREE.SphereGeometry(1, 14, 9, phiStart, phiLength, 0, 2.3);
  const pos = geo.attributes.position;
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i);
    const front = Math.min(1, Math.max(0, (d.z - 0.15) / 0.6));
    const back = Math.min(1, Math.max(0, -d.z / 0.8));
    const yMin = (1 - front) * (-0.1 - back * 0.4) + front * yFront;
    if (d.y < yMin) {
      const k = Math.sqrt(Math.max(0, 1 - yMin * yMin)) / (Math.hypot(d.x, d.z) || 1);
      d.set(d.x * k, yMin, d.z * k);
    }
    pos.setXYZ(i, d.x * 0.097 * scale, d.y * 0.107 * scale + 0.137, d.z * 0.1 * scale + 0.004);
  }
  geo.computeVertexNormals();
  return geo;
}

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
// En hårtofs: en låg kon (få sidor = kantig) som sticker ut från hårbotten
function tuft(mat, base, axis, radius, height, sides = 4) {
  const geo = new THREE.ConeGeometry(radius, height, sides);
  geo.translate(0, height / 2, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...base);
  mesh.quaternion.copy(_q.setFromUnitVectors(_up, axis.clone().normalize()));
  return mesh;
}

// Bygger håret i tre grupper: cap (kalotten, syns under hattar), top (tofsar och lugg, bara utan huvudbonad)
// och long (långt hår bak och på sidorna)
export function buildHair(f, mat, rand) {
  const cap = new THREE.Group();
  const top = new THREE.Group();
  const long = new THREE.Group();
  const add = (group, geo, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.scale.set(...scale);
    m.rotation.set(...rot);
    group.add(m);
    return m;
  };
  const style = f.hairStyle;
  const v = new THREE.Vector3();
  if (style === 0 || style === 1 || style === 2) {
    add(cap, hairShell(1.07, style === 2 ? 0.5 : 0.56));
    // Tofsar: spretig kort (pekar uppåt och framåt), rufsig (åt alla håll), långt (mjukt bakåt)
    const n = style === 0 ? 22 : style === 1 ? 26 : 14;
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const el = style === 2 ? 0.35 + rand() * 0.6 : 0.25 + rand() * 0.75; // höjd på huvudet (1 = toppen)
      const dir = v.set(Math.sin(a) * Math.cos(el * 1.3), Math.sin(el * 1.3) + 0.15, Math.cos(a) * Math.cos(el * 1.3)).normalize();
      if (dir.z > 0.55 && dir.y < 0.5) continue; // inte i pannan
      if (Math.abs(dir.x) > 0.7 && dir.y < 0.45) continue; // inga "horn" som sticker ut på sidorna
      const base = headPoint(dir.x, dir.y, dir.z, 1.04);
      const axis = dir.clone();
      // Tofsarna ligger mest längs huvudet (inte rakt ut), så det blir en frisyr och inte en igelkott
      if (style === 0) axis.multiplyScalar(0.55).add(new THREE.Vector3(0, 0.45, 0.75));
      else if (style === 1) axis.multiplyScalar(0.45).add(new THREE.Vector3((rand() - 0.5) * 1.1, -0.1, -0.5 + (rand() - 0.5) * 0.8));
      else axis.multiplyScalar(0.3).add(new THREE.Vector3(0, -0.35, -0.9));
      const big = style === 1 ? 1.1 : 1;
      top.add(tuft(mat, base, axis, (0.02 + rand() * 0.012) * big, (0.026 + rand() * 0.026) * big));
    }
    // Lugg: några tofsar framtill som hänger ner över pannan
    const fringe = style === 2 ? 3 : 5;
    for (let i = 0; i < fringe; i++) {
      const x = (i / (fringe - 1) - 0.5) * 0.9;
      const base = headPoint(x, 0.62, 0.78, 1.05);
      const axis = new THREE.Vector3(x * 0.6 + (rand() - 0.5) * 0.4, -0.25 - rand() * 0.3, 1);
      top.add(tuft(mat, base, axis, 0.02 + rand() * 0.008, 0.035 + rand() * 0.02));
    }
    if (style === 1) {
      // Rufsigt: tjockare på sidorna och i nacken
      for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
        const base = headPoint(0.9 * s, 0.05 - k * 0.12, -0.15 - k * 0.25, 1.02);
        cap.add(tuft(mat, base, new THREE.Vector3(0.6 * s, -0.8, -0.3), 0.022, 0.05 + rand() * 0.02));
      }
    }
    if (style === 2) {
      // Långt hår: en tjock "matta" bak ner mot axlarna och slingor på sidorna
      const back = new THREE.BoxGeometry(0.17, 0.2, 0.045, 2, 3, 1);
      const p = back.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const k = 1 - (0.1 - y) * 0.8; // smalare nertill
        p.setX(i, p.getX(i) * k + Math.sin(y * 40 + p.getX(i) * 60) * 0.004);
        p.setZ(i, p.getZ(i) - Math.max(0, -y) * 0.15);
      }
      back.computeVertexNormals();
      add(long, back, [0, 0.07, -0.08], [1, 1, 1], [0.12, 0, 0]);
      for (const s of [1, -1]) {
        for (let k = 0; k < 2; k++) {
          const lock = new THREE.ConeGeometry(0.022, 0.16, 4);
          lock.rotateX(Math.PI);
          add(long, lock, [(0.088 - k * 0.012) * s, 0.06, -0.01 - k * 0.04], [1, 1, 0.8], [0.15, 0, 0.18 * s]);
        }
      }
    }
  } else if (style === 4) {
    // Tunnhårig: en krans runt bakhuvudet och sidorna
    const a = 1.15;
    add(cap, hairShell(1.05, 0.0, Math.PI / 2 + a, Math.PI * 2 - a * 2));
    for (const s of [1, -1]) cap.add(tuft(mat, headPoint(0.85 * s, 0.35, 0.2, 1.02), new THREE.Vector3(0.7 * s, 0.4, -0.2), 0.018, 0.035));
  } else if (style === 5) {
    // Snaggat: tunt skal tätt intill huvudet
    add(cap, hairShell(1.025, 0.6));
  }
  for (const grp of [cap, top, long]) grp.traverse((o) => o.isMesh && (o.castShadow = true));
  return { cap, top, long };
}

// ---------- Skägg ----------
// Skägg byggs av huvudets egen form: de ytor som ligger där skägget växer, lyfts ut från huden.
export function beardShell(skull, region, thickness) {
  const dirs = skull.userData?.dirs;
  const pos = skull.attributes?.position;
  const nrm = skull.attributes?.normal;
  const ind = skull.index?.array;
  if (!dirs || !pos || !nrm || !ind || !skull.attributes.uv) return null;
  const keep = (i) => region(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
  const idx = [];
  for (let t = 0; t < ind.length; t += 3) if (keep(ind[t]) && keep(ind[t + 1]) && keep(ind[t + 2])) idx.push(ind[t], ind[t + 1], ind[t + 2]);
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const th = thickness(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
    p[i * 3] = pos.getX(i) + nrm.getX(i) * th;
    p[i * 3 + 1] = pos.getY(i) + nrm.getY(i) * th;
    p[i * 3 + 2] = pos.getZ(i) + nrm.getZ(i) * th;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
  geo.setAttribute("uv", skull.attributes.uv.clone());
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Var skägget växer: käken, hakan och kinderna nertill, men inte runt munnen
export const BEARD_REGION = (x, y, z) => {
  if (z < -0.35) return false;
  const side = Math.min(1, Math.max(0, (Math.abs(x) - 0.45) / 0.4)); // 0 framtill, 1 vid öronen
  if (y > -0.42 + side * 0.36) return false;                            // polisonger upp mot öronen, inte på kinderna
  if (Math.abs(x) < 0.33 && y > -0.7 && z > 0.55) return false;        // inte runt munnen
  return true;
};
export const BEARD_THICK = (x, y, z) => 0.004 + Math.max(0, -0.55 - y) * 0.03 + Math.max(0, z) * 0.003;

// Näsa: en kantig kil med rak näsrygg, spets och näsvingar (platta ytor)
export function noseGeometry(size, broken) {
  const k = size;
  const P = [
    [0, 0.158, 0.086],                      // 0 näsrot
    [0, 0.106, 0.096 + 0.024 * k],          // 1 spets
    [-0.016 * k, 0.1, 0.092],               // 2 vänster näsvinge
    [0.016 * k, 0.1, 0.092],                // 3 höger näsvinge
    [0, 0.097, 0.097 + 0.012 * k],          // 4 under spetsen
    [-0.009, 0.15, 0.083],                  // 5 näsrygg vänster bak
    [0.009, 0.15, 0.083],                   // 6 näsrygg höger bak
    [-0.012 * k, 0.12, 0.09 + 0.008 * k],   // 7 sida vänster
    [0.012 * k, 0.12, 0.09 + 0.008 * k],    // 8 sida höger
  ];
  if (broken) for (const i of [1, 4]) P[i][0] += 0.005;
  const tris = [[0, 7, 1], [0, 1, 8], [0, 5, 7], [0, 8, 6], [7, 2, 1], [1, 3, 8], [5, 2, 7], [8, 3, 6], [2, 4, 1], [1, 4, 3], [2, 3, 4]];
  const pos = [];
  for (const t of tris) for (const i of t) pos.push(...P[i]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0.5), 2));
  geo.computeVertexNormals();
  return geo;
}
