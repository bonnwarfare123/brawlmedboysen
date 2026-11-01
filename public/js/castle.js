// BORGGÅRDEN – den andra banan: en borggård i vinter.
//
// Samma stridsyta som tornerplatsen (så striden, botarna och servern fungerar likadant), men runt om:
// en låg stenmur, en snöig gård med eldkorgar, tunnor och ställningar, en hög ringmur med tinnar där
// publiken står, sex runda torn med snötäckta tak och ett porttorn med fällgaller som riddarna
// marscherar ut genom när matchen börjar.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA_RX, ARENA_RZ } from "./shared.js";
import { Crowd, makeRoyals, makePatrol, makeVendor } from "./crowd.js";
import {
  PALETTE, mat, mesh, box, ellipsePoint, seededRandom, makeBrazier, makePodium, makeQuintain, mergeStatic,
  makeCloud, makeStand, makeRoyalBox, makeBarrels, makeCrates, makeWeaponRack, makeFlag, waveFlag,
  heraldBanner, makeSky, setSkyColors, resetFlags, getCloudMaterial, radialPatch, sandScatter, updateClouds, groundMacro,
} from "./arena.js";
import { rakedSandTexture, sandGrainTexture, trampledTexture } from "./textures.js";
import {
  tracksTexture, makeWoodpile, makeSacks, makeCart, makeBench, makeHay, makeGarlands, makeEmbers, makeWarmPool, makeSmoke,
  makeFlurries,
} from "./castle-extras.js";

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
  // Snöfläckarna är oregelbundna klumpar (flera små i en hög) med mörkare, blöt slask runt om.
  // Mest mot kanten; i mitten bara enstaka, små fläckar (där är snön upptrampad).
  const soft = (x, y, r, tone, al, sy = 1, rot = 0) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(1, sy);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(${tone},${al})`);
    g.addColorStop(0.6, `rgba(${tone},${al * 0.5})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  };
  for (let i = 0; i < 1500; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand());
    const edge = Math.pow(d, 3.2);
    if (rand() > edge * 1.15 + 0.006) continue;
    const x = h + Math.cos(a) * d * h;
    const y = h + Math.sin(a) * d * h;
    const r = 3 + rand() * 15 * (0.3 + edge);
    const rot = a + (rand() - 0.5);
    const sy = 0.35 + rand() * 0.45;
    soft(x, y, r * 1.7, "62,52,46", 0.16 + edge * 0.12, sy, rot); // blöt slask runt fläcken
    const dirty = rand() < 0.3;
    const al = 0.3 + edge * 0.55;
    const clumps = 2 + Math.floor(rand() * 4);
    for (let k = 0; k < clumps; k++) {
      const ox = (rand() - 0.5) * r * 1.1;
      const oy = (rand() - 0.5) * r * 0.6;
      soft(x + Math.cos(rot) * ox - Math.sin(rot) * oy, y + Math.sin(rot) * ox + Math.cos(rot) * oy, r * (0.4 + rand() * 0.5),
        dirty ? "176,172,170" : "238,242,248", al, sy, rot + (rand() - 0.5) * 0.6);
    }
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
      // Olika stenar: de flesta grå, några varmare (brunare), några kallare (blågrå), några mörka
      const kind = rand();
      const v = (kind < 0.12 ? 115 : 140) + rand() * (kind < 0.12 ? 40 : 80);
      const warm = kind > 0.82 ? 14 + rand() * 18 : kind > 0.66 ? -10 - rand() * 8 : rand() * 10;
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
      // Avslagna hörn och kanter (mörka hack), någon enstaka skadad sten, och sällan lite frost upptill
      for (let k = 0; k < 2; k++) {
        if (rand() < 0.35) {
          const cx = rand() < 0.5 ? x0 + 3 : x0 + ww - 3;
          const cy = rand() < 0.5 ? y0 + 3 : y0 + hh - 3;
          c.fillStyle = "rgba(60,56,50,0.75)";
          c.beginPath();
          c.moveTo(cx, cy);
          c.lineTo(cx + (cx < x0 + ww / 2 ? 1 : -1) * (6 + rand() * 12), cy);
          c.lineTo(cx, cy + (cy < y0 + hh / 2 ? 1 : -1) * (5 + rand() * 9));
          c.fill();
        }
      }
      if (rand() < 0.05) {
        // En sten med en bit som slagits loss: mörk, ojämn grop med ljus kant
        const px = x0 + ww * (0.2 + rand() * 0.5);
        const py = y0 + hh * (0.25 + rand() * 0.4);
        c.fillStyle = "rgba(70,64,58,0.85)";
        c.beginPath();
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2;
          const rr = 8 + rand() * 12;
          c.lineTo(px + Math.cos(a) * rr * 1.4, py + Math.sin(a) * rr * 0.8);
        }
        c.fill();
        c.strokeStyle = "rgba(230,225,215,0.35)";
        c.lineWidth = 1.5;
        c.stroke();
      }
      if (rand() < 0.12) {
        c.fillStyle = `rgba(236,240,246,${0.35 + rand() * 0.3})`;
        c.fillRect(x0 + 2, y0, ww * (0.3 + rand() * 0.5), 2 + rand() * 2);
      }
      // ojämn fog: ibland urgröpt och mörkare, ibland ljusare kalkbruk
      if (rand() < 0.3) {
        c.fillStyle = rand() < 0.6 ? "rgba(40,36,32,0.5)" : "rgba(200,195,185,0.35)";
        c.fillRect(x0 - 4, y0 + hh, ww + 8, 4);
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
// Stenen varierar över hela borgen (räknas i grafikkortet efter var i världen ytan är, så det kostar
// nästan inget): varmare och kallare partier, ljusare och mörkare stenar, smuts och fukt nertill,
// rinnande fuktränder, snö på allt som pekar uppåt och snöstänk längst ner mot marken.
const STONE_GLSL = `
varying vec3 vStoneW;
varying vec3 vStoneN;
float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;
const STONE_FRAG = `
{
  vec3 w = vStoneW;
  vec2 q = vec2(w.x * 0.8 + w.z * 0.6, w.y);
  float big = sNoise(q * 0.21);
  float mid = sNoise(q * 0.85 + 7.3);
  float fine = sNoise(q * 3.7 + 1.7);
  vec3 tint = mix(vec3(0.84, 0.86, 0.9), vec3(1.08, 1.02, 0.94), big);
  diffuseColor.rgb *= tint * (0.86 + mid * 0.2 + fine * 0.08);
  float grime = 1.0 - smoothstep(0.0, 1.2 + mid * 1.3, w.y);
  diffuseColor.rgb *= 1.0 - grime * 0.48;
  // mossa och fukt i fläckar nära marken
  float moss = smoothstep(0.62, 0.8, sNoise(q * 1.6 + 3.1)) * (1.0 - smoothstep(0.3, 1.6, w.y));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.72, 0.5), moss * 0.7);
  // vädrade, ljusare och mörkare stråk (ålder)
  float weather = sNoise(vec2((w.x + w.z) * 0.6, w.y * 0.12));
  diffuseColor.rgb *= 0.9 + weather * 0.18;
  float streak = sNoise(vec2((w.x - w.z) * 2.4, w.y * 0.3));
  diffuseColor.rgb *= 1.0 - smoothstep(0.6, 0.95, streak) * 0.18 * smoothstep(0.8, 2.6, w.y);
  float up = smoothstep(0.45, 0.85, vStoneN.y);
  float frost = smoothstep(0.22, 0.0, w.y) * (0.25 + fine * 0.3) + up * (0.5 + mid * 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.98), clamp(frost, 0.0, 0.92));
}`;
function stoneMat(color = STONE) {
  if (!stoneMats.has(color)) {
    const { map, bump } = stoneTextures();
    const m = new THREE.MeshStandardMaterial({ color, map, bumpMap: bump, bumpScale: 2.2, roughness: 0.93 });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vStoneW;\nvarying vec3 vStoneN;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvStoneW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvStoneN = normalize(mat3(modelMatrix) * objectNormal);");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\n" + STONE_GLSL)
        .replace("#include <map_fragment>", "#include <map_fragment>\n" + STONE_FRAG);
    };
    m.customProgramCacheKey = () => "stone-variation";
    stoneMats.set(color, m);
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
// Fackla på väggen. Inget riktigt ljus (det kostar för mycket per fackla): i stället en droppformad låga
// som fladdrar, en liten gloria runt lågan, ett varmt sken som "faller" på stenen bakom och under
// facklan, sot på muren ovanför och lite rök. Skenet på muren ritas samlat för alla facklor (se fackelSken).
let torchGlow = null;
let flameGeo = null;
function torchFlameGeometry() {
  if (flameGeo) return flameGeo;
  // Droppform: bred nertill, spetsig upptill. Färgen går från gul kärna nertill till orange spets.
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const r = Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * (1 - t) ** 1.2 * 0.075;
    pts.push(new THREE.Vector2(Math.max(0.001, r), t * 0.32));
  }
  const geo = new THREE.LatheGeometry(pts, 8);
  const col = new Float32Array(geo.attributes.position.count * 3);
  const low = new THREE.Color(0xffe6a0);
  const high = new THREE.Color(0xff6a18);
  const c = new THREE.Color();
  for (let i = 0; i < geo.attributes.position.count; i++) {
    c.copy(low).lerp(high, Math.min(1, geo.attributes.position.getY(i) / 0.26));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  flameGeo = geo;
  return geo;
}
const flameMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false });
const sootMat = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 40, 2, 32, 34, 32);
  g.addColorStop(0, "rgba(0,0,0,0.6)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2 });
})();
function makeWallTorch() {
  const g = new THREE.Group();
  const iron = mat(0x2e2a28);
  // Järnhållare: en platta mot muren, en arm ut och en korg runt facklan
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.03), iron);
  plate.position.set(0, 0, 0.015);
  g.add(plate);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.32), iron);
  arm.position.set(0, 0, 0.17);
  g.add(arm);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 4, 10), iron);
  ring.position.set(0, 0.05, 0.33);
  ring.rotation.x = Math.PI / 2 - 0.3;
  g.add(ring);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.026, 0.5, 6), mat(PALETTE.woodDark));
  stick.position.set(0, 0.16, 0.36);
  stick.rotation.x = 0.3;
  g.add(stick);
  // Facklans huvud: lindat, beckindränkt tyg (mörkt)
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.12, 7), mat(0x1e1814));
  head.position.set(0, 0.42, 0.44);
  head.rotation.x = 0.3;
  g.add(head);
  const flame = new THREE.Mesh(torchFlameGeometry(), flameMat);
  flame.position.set(0, 0.47, 0.455);
  flame.userData.noMerge = true;
  g.add(flame);
  if (!torchGlow) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,170,80,0.55)");
    gr.addColorStop(0.35, "rgba(255,130,50,0.18)");
    gr.addColorStop(1, "rgba(255,110,40,0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    torchGlow = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  }
  // En liten, svag gloria runt lågan (inte en stor lysande boll)
  const glow = new THREE.Sprite(torchGlow.clone());
  glow.scale.setScalar(0.75);
  glow.position.set(0, 0.6, 0.47);
  g.add(glow);
  // Sot på muren ovanför facklan
  const soot = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 1.1), sootMat);
  soot.position.set(0, 1.0, 0.012);
  g.add(soot);
  g.userData.flame = flame;
  g.userData.glow = glow;
  // Lite rök som stiger från facklan
  const smoke = makeSmoke(1, 0x3a3634, 0.14);
  smoke.group.position.set(0, 0.7, 0.45);
  g.add(smoke.group);
  g.userData.smoke = smoke;
  return g;
}

// Det varma skenet från facklorna på muren: en platta per fackla, alla ihopslagna till en enda form
// (ett ritanrop). Skenet fladdrar svagt i takt med lågorna.
function torchSplash(torches) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  const gr = x.createRadialGradient(64, 58, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,160,80,0.75)");
  gr.addColorStop(0.3, "rgba(255,120,50,0.32)");
  gr.addColorStop(0.7, "rgba(200,80,30,0.08)");
  gr.addColorStop(1, "rgba(200,80,30,0)");
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geos = [];
  for (const t of torches) {
    t.updateMatrixWorld(true);
    const geo = new THREE.PlaneGeometry(2.6, 2.4);
    geo.translate(0, 0.35, 0.02);
    geo.applyMatrix4(t.matrixWorld);
    geos.push(geo);
  }
  const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({
    map: tex, color: 0xffffff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
  }));
  m.userData.noMerge = true;
  m.userData.base = 0.7;
  m.renderOrder = 3;
  return m;
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

// Ett enkelt skjul av trä mot muren: stolpar, ett snett plankstak (med snö) och lite ved under
function makeShed(rand) {
  const g = new THREE.Group();
  const W = 3.0;
  const D = 1.7;
  for (const x of [-W / 2, 0, W / 2]) {
    const front = box(0.14, 2.1, 0.14, PALETTE.woodDark);
    front.position.set(x, 1.05, 0);
    g.add(front);
    const back = box(0.14, 2.7, 0.14, PALETTE.woodDark);
    back.position.set(x, 1.35, -D);
    g.add(back);
    const brace = box(0.08, 0.08, 0.9, PALETTE.wood);
    brace.position.set(x, 1.8, -0.35);
    brace.rotation.x = 0.6;
    g.add(brace);
  }
  const roof = new THREE.Group();
  roof.position.set(0, 2.45, -D / 2);
  roof.rotation.x = -0.32;
  g.add(roof);
  for (let i = 0; i < 9; i++) {
    const plank = box(W / 9 + 0.03, 0.06, D + 0.5, i % 2 ? PALETTE.wood : PALETTE.woodLight);
    plank.position.set(-W / 2 + (i + 0.5) * (W / 9), (i % 3) * 0.006, 0);
    roof.add(plank);
  }
  const snow = mesh(new THREE.BoxGeometry(W + 0.1, 0.07, D + 0.4), SNOW, false);
  snow.position.y = 0.06;
  roof.add(snow);
  const beam = box(W + 0.2, 0.14, 0.14, PALETTE.woodDark);
  beam.position.set(0, 2.1, 0);
  g.add(beam);
  // Ved och en tunna under taket
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6 - r; i++) {
    const log = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.8, 7), 0x4a3220);
    log.rotation.z = Math.PI / 2;
    log.position.set(-0.7 + (i - (5 - r) / 2) * 0.22, 0.1 + r * 0.18, -D + 0.45);
    g.add(log);
  }
  const barrel = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 12), PALETTE.wood);
  barrel.position.set(1.0, 0.35, -D + 0.5);
  g.add(barrel);
  return g;
}

// Resten av borgen runt arenan: en yttre ringmur med torn och ett porttorn, ett stort kärntorn,
// en sal, ett kapell och hustak som sticker upp bakom ringmuren. Bara kuliss: enkla former,
// som slås ihop med resten (få ritanrop). Rök stiger från några skorstenar.
function makeOuterCastle(WX, WZ, rand) {
  const g = new THREE.Group();
  const OX = WX + 21; // långt ut: introts kamera sveper över gården innanför
  const OZ = WZ + 21;
  const far = 0xb2b6bc; // lite ljusare och blåare sten på håll (luftperspektiv)
  const farDark = 0xa0a4aa;
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4e4a52, roughness: 0.9, flatShading: true });
  const plaster = 0xd2c6ae;
  const beam = 0x4a3424;
  const smokes = [];
  const pt = (t, rx, rz) => ellipsePoint(t, rx, rz);
  // Yttre ringmur med tinnar (grövre än den inre)
  const N = 56;
  for (let i = 0; i < N; i++) {
    const a = pt((i / N) * Math.PI * 2, OX, OZ);
    const b = pt(((i + 1) / N) * Math.PI * 2, OX, OZ);
    const t = ((i + 0.5) / N) * Math.PI * 2;
    if (Math.abs(t - GATE_T) < 0.07) continue;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const angle = -Math.atan2(b.z - a.z, b.x - a.x);
    const wall = stoneBox(len + 0.1, 8.5, 2.2, far);
    wall.position.set((a.x + b.x) / 2, 4.25, (a.z + b.z) / 2);
    wall.rotation.y = angle;
    g.add(wall);
    const merlon = stoneBox(len * 0.5, 0.8, 0.5, far);
    const out = new THREE.Vector3(a.x + b.x, 0, a.z + b.z).normalize();
    merlon.position.set((a.x + b.x) / 2 + out.x * 0.8, 8.9, (a.z + b.z) / 2 + out.z * 0.8);
    merlon.rotation.y = angle;
    g.add(merlon);
    const sc = snowCap(len, 2.0, 0.08);
    sc.position.set((a.x + b.x) / 2, 8.54, (a.z + b.z) / 2);
    sc.rotation.y = angle;
    g.add(sc);
  }
  // Torn på den yttre muren (enkla: stam, tinnkrans och snötäckt kon)
  const towerAt = (t, r, h) => {
    const p = pt(t, OX + 0.4, OZ + 0.4);
    const body = stoneCylinder(r, r * 1.05, h, 14, farDark);
    body.position.set(p.x, h / 2, p.z);
    g.add(body);
    const crown = stoneCylinder(r * 1.12, r * 1.05, 0.7, 14, far);
    crown.position.set(p.x, h + 0.2, p.z);
    g.add(crown);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.2, r * 1.7, 14), roofMat);
    roof.position.set(p.x, h + 0.55 + r * 0.85, p.z);
    g.add(roof);
    const snow = mesh(new THREE.ConeGeometry(r * 1.2, r * 1.7, 14), SNOW, false);
    snow.position.set(p.x, h + 0.55 + r * 0.85 + 0.3, p.z); // ligger ovanpå: en mörk takfot syns nertill
    g.add(snow);
  };
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2 + 0.31;
    if (Math.abs(((t - GATE_T + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.3) continue;
    towerAt(t, 2.1, 13 + (i % 3));
  }
  // Det yttre porttornet (två torn och ett valv)
  for (const dt of [-0.09, 0.09]) towerAt(GATE_T + dt, 2.4, 15);
  {
    const p = pt(GATE_T, OX, OZ);
    const gh = stoneBox(7, 11, 3, farDark);
    gh.position.set(p.x, 5.5, p.z);
    g.add(gh);
    const arch = box(3, 4, 3.2, 0x1a1816);
    arch.position.set(p.x, 2, p.z);
    g.add(arch);
  }
  // Kärntornet: stort och fyrkantigt med hörntorn, bakom kungens loge
  {
    const p = pt(0, WX + 14, WZ + 14);
    const K = new THREE.Group();
    K.position.copy(p);
    K.lookAt(0, 0, 0);
    g.add(K);
    const body = stoneBox(10, 18, 9, far);
    body.position.y = 9;
    K.add(body);
    const plinth = stoneBox(10.6, 1.4, 9.6, farDark);
    plinth.position.y = 0.7;
    K.add(plinth);
    for (const [x, z] of [[-5, -4.5], [5, -4.5], [-5, 4.5], [5, 4.5]]) {
      const tw = stoneCylinder(1.4, 1.5, 21, 12, farDark);
      tw.position.set(x, 10.5, z);
      K.add(tw);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.75, 3.2, 12), roofMat);
      roof.position.set(x, 22.6, z);
      K.add(roof);
      const snow = mesh(new THREE.ConeGeometry(1.75, 3.2, 12), SNOW, false);
      snow.position.set(x, 22.9, z);
      K.add(snow);
    }
    for (let i = 0; i < 7; i++) {
      for (const z of [-4.75, 4.75]) {
        const m = stoneBox(0.8, 0.9, 0.5, far);
        m.position.set(-3.6 + i * 1.2, 18.45, z);
        K.add(m);
      }
    }
    // Fönster (mörka springor) i tre våningar
    for (let fl = 0; fl < 3; fl++) for (let i = 0; i < 3; i++) {
      const w = box(0.5, 1.2, 0.2, 0x1a1816);
      w.position.set(-2.5 + i * 2.5, 6 + fl * 4, 4.55);
      K.add(w);
    }
    const flag = makeFlag(PALETTE.red);
    flag.scale.setScalar(2.4);
    flag.position.set(5, 24.2, 4.5);
    K.add(flag);
    const flag2 = makeFlag(PALETTE.blue);
    flag2.scale.setScalar(2.4);
    flag2.position.set(-5, 24.2, 4.5);
    K.add(flag2);
  }
  // Byggnader med branta, snötäckta tak som sticker upp bakom ringmuren
  const building = (t, dist, w, d, wallH, roofH, stone, chimney = false) => {
    const p = pt(t, WX + dist, WZ + dist);
    const B = new THREE.Group();
    B.position.copy(p);
    B.lookAt(0, 0, 0);
    B.rotateY(Math.PI / 2); // långsidan mot arenan
    g.add(B);
    if (stone) {
      const body = stoneBox(w, wallH, d, farDark);
      body.position.y = wallH / 2;
      B.add(body);
    } else {
      const body = box(w, wallH, d, plaster);
      body.position.y = wallH / 2;
      B.add(body);
      for (const x of [-w / 2, -w / 6, w / 6, w / 2]) {
        const post = box(0.18, wallH, d + 0.04, beam);
        post.position.set(x, wallH / 2, 0);
        B.add(post);
      }
      const rail = box(w + 0.04, 0.16, d + 0.04, beam);
      rail.position.y = wallH * 0.55;
      B.add(rail);
    }
    // Sadeltak: ett prisma av två lutande plattor, med snö ovanpå
    const slope = Math.hypot(d / 2 + 0.3, roofH);
    const ang = Math.atan2(roofH, d / 2 + 0.3);
    for (const s of [1, -1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.22, slope), roofMat);
      r.position.set(0, wallH + roofH / 2, (s * (d / 2 + 0.3)) / 2);
      r.rotation.x = s * ang;
      B.add(r);
      const sn = mesh(new THREE.BoxGeometry(w + 0.5, 0.1, slope * 0.92), SNOW, false);
      sn.position.copy(r.position).add(new THREE.Vector3(0, 0.14, 0));
      sn.rotation.copy(r.rotation);
      B.add(sn);
    }
    // Gavlarna
    const gable = new THREE.Shape();
    gable.moveTo(-d / 2, 0);
    gable.lineTo(d / 2, 0);
    gable.lineTo(0, roofH);
    gable.lineTo(-d / 2, 0);
    for (const s of [1, -1]) {
      const gm = stone ? stoneMat(farDark) : mat(plaster);
      const gg = new THREE.Mesh(new THREE.ShapeGeometry(gable), gm);
      gg.position.set((s * w) / 2, wallH, 0);
      gg.rotation.y = s * Math.PI / 2;
      B.add(gg);
    }
    if (chimney) {
      const ch = stoneBox(0.7, 2.2, 0.7, farDark);
      ch.position.set(w * 0.3, wallH + roofH * 0.8, 0.6);
      B.add(ch);
      const sm = makeSmoke(4, 0x6a6668, 0.22);
      sm.group.position.set(w * 0.3, wallH + roofH * 0.8 + 1.1, 0.6);
      sm.group.scale.setScalar(3.2);
      B.add(sm.group);
      smokes.push(sm);
    }
    return B;
  };
  building(0.78, 9, 13, 6.5, 6.5, 4.5, true, true);   // stora salen
  building(-0.8, 9.5, 11, 6, 6, 4.2, true);            // kornbod och förråd
  // Kapellet med ett litet klocktorn
  {
    const B = building(1.75, 9.5, 9, 5.5, 6.5, 4, true);
    const tw = stoneBox(2, 4, 2, far);
    tw.position.set(-3.2, 12.5, 0);
    B.add(tw);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(1.5, 4.5, 4), roofMat);
    spire.position.set(-3.2, 16.7, 0);
    spire.rotation.y = Math.PI / 4;
    B.add(spire);
    const sn = mesh(new THREE.ConeGeometry(1.5, 4.5, 4), SNOW, false);
    sn.position.set(-3.2, 17.0, 0);
    sn.rotation.y = Math.PI / 4;
    B.add(sn);
  }
  // Små korsvirkeshus i borgens yttre gård (bara taken syns över muren)
  [[-1.7, 8], [2.35, 8], [-2.4, 8.5], [1.25, 11], [-1.25, 11.5], [2.75, 11], [-2.8, 11.5], [0.35, 12], [-0.35, 12.5]].forEach(([t, dist], i) => {
    building(t, dist, 4.5 + (i % 3), 3.6, 4.2 + (i % 2) * 0.8, 2.8 + (i % 3) * 0.4, false, i % 3 === 0);
  });
  return {
    group: g,
    update(time) {
      for (const [i, sm] of smokes.entries()) sm.update(time + i * 3, 0.12, 1.4, 1.3);
    },
  };
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
  group.add(groundMacro(FX + 0.4, FZ + 0.4, 23, [34, 26, 22])); // storskalig variation: blöta partier, spår, nötta stråk
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
  // Spår av striden: fotspår, skrapmärken, släpspår och lerklumpar (en bild över hela ytan)
  const tracks = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshStandardMaterial({ map: tracksTexture(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1.2 }),
  );
  tracks.rotation.x = -Math.PI / 2;
  tracks.rotation.z = 0.4;
  tracks.scale.set(FX + 0.4, FZ + 0.4, 1);
  tracks.position.y = 0.0115;
  tracks.renderOrder = -2;
  tracks.receiveShadow = true;
  tracks.userData.noMerge = true;
  group.add(tracks);
  // Upptrampad slask på gården runt den låga muren (folk har gått runt planen)
  group.add(radialPatch(FX + 3.2, FZ + 3.2, (FX + 0.3) / (FX + 3.2), 1.0, 0x7a6e66, 0.55, 0, 0.011));
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
  const iceMat = new THREE.MeshStandardMaterial({ color: 0x7e92a6, roughness: 0.05, metalness: 0.45, transparent: true, opacity: 0.55, depthWrite: false });
  const slushMat = new THREE.MeshBasicMaterial({ color: 0x2a201a, transparent: true, opacity: 0.28, depthWrite: false });
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
    // Blöt, mörk kant runt isen
    const rim = new THREE.Mesh(new THREE.CircleGeometry(1, 16), slushMat);
    rim.rotation.copy(ice.rotation);
    rim.scale.set(ice.scale.x * 1.25, ice.scale.y * 1.35, 1);
    rim.position.set(ice.position.x, 0.0145, ice.position.z);
    rim.renderOrder = -1;
    rim.userData.noMerge = true;
    group.add(rim);
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
  const torches = [];
  const swayBanners = [];
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
        torch.userData.seed = i * 1.37;
        group.add(torch);
        torches.push(torch);
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
    if (i % 9 === 4 || i % 9 === 8) {
      const banner = heraldBanner(i % 18 === 4 || i % 18 === 17 ? PALETTE.blue : i % 9 === 8 ? PALETTE.gold : PALETTE.red, i % 4, 0.8, i % 9 === 8 ? 1.25 : 1.6);
      banner.position.set(mx - out.x * 0.82, WALL_H - 0.25, mz - out.z * 0.82);
      banner.lookAt(center.x, WALL_H - 0.25, center.z);
      group.add(banner);
      if (i % 9 === 4) {
        // De stora fanorna gungar lite i vinden
        banner.userData.noMerge = true;
        banner.userData.base = banner.quaternion.clone();
        banner.userData.phase = i * 0.77;
        swayBanners.push(banner);
      }
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

  // Facklornas varma sken på muren (alla i en form)
  const splash = torchSplash(torches);
  group.add(splash);

  // ---------- Resten av borgen (kuliss bakom ringmuren, inte spelbar) ----------
  const outer = makeOuterCastle(WX, WZ, rand);
  group.add(outer.group);

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

  // ---------- Vimpelgirlanger längs murens insida (i bågar under bröstvärnet) ----------
  {
    const spans = [];
    const N = 36;
    for (let i = 0; i < N; i++) {
      const t0 = (i / N) * Math.PI * 2;
      const t1 = ((i + 1) / N) * Math.PI * 2;
      if (Math.abs(((t0 - GATE_T + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.35) continue;
      if (Math.abs(((t1 - GATE_T + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.35) continue;
      const a = ellipsePoint(t0, WX - 0.95, WZ - 0.95);
      const b = ellipsePoint(t1, WX - 0.95, WZ - 0.95);
      spans.push([new THREE.Vector3(a.x, WALL_H - 0.45, a.z), new THREE.Vector3(b.x, WALL_H - 0.45, b.z), 0.55]);
    }
    group.add(makeGarlands(spans));
  }

  // ---------- Gården: eldkorgar, tunnor, lådor, vapenställ, ställningar och smedja ----------
  const fires = [];
  [0.35, 1.25, -1.25, -0.35, GATE_T - 0.42, GATE_T + 0.42].forEach((t, i) => {
    const p = ellipsePoint(t, FX + 1.1, FZ + 1.1);
    const fire = makeBrazier(i);
    fire.group.position.set(p.x, 0, p.z);
    group.add(fire.group);
    fires.push(fire);
    // Varmt sken på snön runt elden, och ett varmare, längre ljus
    const pool = makeWarmPool(2.6);
    pool.position.set(p.x, 0.03, p.z);
    group.add(pool);
    fire.pool = pool;
    fire.light.color.set(0xff6a20);
    fire.light.distance = 6;
    fire.light.decay = 2;
    fire.boost = 0.5;
  });
  const embers = makeEmbers(fires.map((f) => new THREE.Vector3(f.group.position.x, 1.35, f.group.position.z)));
  group.add(embers.points);

  // Mer liv på gården: vedtravar, säckar, kärror, bänkar med sejdlar och halmbalar
  {
    const pr = seededRandom(4711);
    const extras = [
      [0.92, 3.6, makeWoodpile], [-0.9, 3.4, makeCart], [1.92, 2.2, makeSacks], [-1.86, 2.4, makeHay],
      [2.25, 3.4, makeBench], [-2.28, 3.2, makeWoodpile], [0.45, 1.85, makeHay], [-0.48, 1.9, makeSacks],
      [2.62, 2.1, makeCart], [-2.62, 2.2, makeBench], [1.05, 1.9, makeBench], [-1.08, 1.9, makeSacks],
    ];
    for (const [t, out, make] of extras) {
      const obj = make(pr);
      const p = ellipsePoint(t, FX + out, FZ + out);
      obj.position.copy(p);
      obj.lookAt(center);
      obj.rotateY((pr() - 0.5) * 0.8);
      group.add(obj);
    }
  }
  const propTs = [0.12, -0.12, 1.15, -1.18, 2.0, -1.95, 2.45, -2.45];
  propTs.forEach((t, i) => {
    const p = ellipsePoint(t, FX + 2.6 + (i % 2) * 1.6, FZ + 2.6 + (i % 2) * 1.6);
    const prop = i % 3 === 0 ? makeBarrels() : i % 3 === 1 ? makeCrates() : makeWeaponRack();
    prop.position.copy(p);
    prop.lookAt(center);
    group.add(prop);
  });
  // Tunnor, lådor och ett vapenställ vid porten (där riddarna kommer in), och ett skjul mot muren
  [[GATE_T - 0.62, makeBarrels], [GATE_T + 0.62, makeCrates], [GATE_T + 0.5, makeWeaponRack]].forEach(([t, make], i) => {
    const prop = make();
    const p = ellipsePoint(t, FX + 2.3 + (i === 2 ? 0.9 : 0), FZ + 2.3 + (i === 2 ? 0.9 : 0));
    prop.position.copy(p);
    prop.lookAt(center);
    group.add(prop);
  });
  {
    const shed = makeShed(rand);
    const p = ellipsePoint(2.0, WX - 1.65, WZ - 1.65);
    shed.position.copy(p);
    shed.lookAt(center);
    group.add(shed);
  }
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
    const r = 47 + rand() * 38; // utanför den yttre muren
    const tree = makeSnowPine(rand);
    tree.position.set(Math.sin(t) * r * 1.1, 0, Math.cos(t) * r);
    group.add(tree);
  }

  // Lätta snöflingor i luften (diset vid murarnas fot är borttaget: det gjorde murarna vita)
  const flurries = makeFlurries(WX, WZ, 320);
  group.add(flurries.points);

  // Slå ihop allt som står still
  group.add(mergeStatic(group));

  const crowd = new Crowd(crowdSpots, 21, { winter: true });
  group.add(crowd.group);
  // Vakter som går fram och tillbaka på muren, och en tjänare som bär öl längs gården
  const walkers = [];
  const pingPong = (a0, a1, rx, rz, y) => (t, out) => {
    const k = t < 0.5 ? t * 2 : 2 - t * 2;
    const a = a0 + (a1 - a0) * k;
    return out.set(Math.sin(a) * rx, y, Math.cos(a) * rz);
  };
  [[0.95, 2.0, PALETTE.blue, 0.1], [-2.0, -0.95, PALETTE.red, 0.6], [-0.62, 0.62, PALETTE.blue, 0.35]].forEach(([a0, a1, color, start]) => {
    const w = makePatrol(pingPong(a0, a1, WX - 0.3, WZ - 0.3, WALL_H + 0.06), start, 0.012, color);
    group.add(w.group);
    walkers.push(w);
  });
  {
    const v = makeVendor("ale", pingPong(-0.3, 0.3, FX + 1.7, FZ + 1.7, 0), 0.2, 0.02);
    group.add(v.group);
    walkers.push(v);
  }
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
    for (const fire of fires) {
      fire.update(dt, time);
      if (fire.pool) fire.pool.material.opacity = (0.3 + Math.sin(time * 11 + fire.group.position.x) * 0.03 + (fire.light.intensity / fire.boost - 4) * 0.025) * (fire.boost > 0.8 ? 1.4 : 1);
    }
    embers.update(dt, time);
    splash.material.opacity = splash.userData.base * (0.88 + Math.sin(time * 9.3) * 0.06 + Math.sin(time * 21.7) * 0.05);
    if (flurries.points.visible) flurries.update(dt, time);
    // Facklorna fladdrar och ryker
    for (const torch of torches) {
      const s = torch.userData.seed;
      const fl = Math.sin(time * 14 + s) * 0.5 + Math.sin(time * 27.3 + s * 2) * 0.3 + Math.sin(time * 5.1 + s) * 0.2;
      const flame = torch.userData.flame;
      flame.scale.set(1 - fl * 0.08, 1 + fl * 0.22, 1 - fl * 0.08);
      flame.rotation.z = Math.sin(time * 3 + s) * 0.12;
      if (torch.userData.glow) torch.userData.glow.material.opacity = 0.8 + fl * 0.2;
      torch.userData.smoke?.update(time + s, 0.32, 1.6, 0.9);
    }
    forge.light.intensity = 2.2 + Math.sin(time * 9) * 0.3 + Math.sin(time * 23) * 0.2;
    for (const flag of flags) waveFlag(flag, time);
    for (const w of walkers) w.update(dt);
    outer.update(time);
    for (const b of swayBanners) {
      b.quaternion.copy(b.userData.base);
      b.rotateX(Math.sin(time * 1.1 + b.userData.phase) * 0.06);
      b.rotateZ(Math.sin(time * 0.7 + b.userData.phase * 1.3) * 0.03);
    }
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
    kingThrow: (onRelease) => royals.throwBow(onRelease),
    setQuality: (low) => {
      fires.forEach((f) => (f.light.visible = !low));
      forge.light.visible = !low;
      embers.points.visible = !low;
      flurries.points.visible = !low;
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
        f.boost = evening ? 1.1 : 0.5;
        f.light.distance = evening ? 8.5 : 6;
      }
      splash.userData.base = evening ? 1 : 0.7;
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
