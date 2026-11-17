// KUNGABORGEN – den tredje banan: borgen som byggdes i Blender.
//
// Modellen (models/borg.glb) är exporterad från Blender med bakade PBR-texturer (färg, roughness,
// normal map) per material (MAT_Sten_Mur, MAT_Tra_Laktare …). Se blender/-skripten i projektet.
//
// Stridsytan är samma oval som på de andra banorna (servern räknar likadant), och borgens skrank
// står precis utanför den. Publiken sitter på borgens läktare, kungen och drottningen i kungalogen.

import * as THREE from "three";
import { ARENA_RX, ARENA_RZ } from "./shared.js";
import { Crowd, makeRoyals } from "./crowd.js";
import {
  seededRandom, makePodium, makeQuintain, mergeStatic, makeSky, makeCloud, getCloudMaterial, updateClouds,
} from "./arena.js";
import { plankTexture, rakedSandTexture } from "./textures.js";

const MODEL_URL = "models/borg.glb";
// Blenders borg är byggd i meter men skranket är lite för trångt för ovalen: skala upp hela borgen
const S = 1.12;
// Blender (x, y = norrut, z = upp) -> spelet. Borgen vrids ett halvt varv så att kungalogen hamnar på +z.
// Stridsytan ligger på z 0,04 i Blender. Hela borgen sänks så att sanden hamnar på spelets marknivå (0,01),
// annars sjunker riddarnas fötter ner i sanden.
const Y0 = 0.01 - 0.04 * S;
const B = (x, y, z) => new THREE.Vector3(-x * S, z * S + Y0, y * S);

// ---------- Material från Blender (bakade texturer) ----------
// Varje material i Blender är bakat till sömlösa bilder: färg, roughness(+metallic) och normal map.
// Bilderna ligger inbäddade i borg.glb som WebP. Ett material upprepar sin bild var "kakel_u" meter
// (UV i Blender = meter); glb-filen anger det som KHR_texture_transform (skala + förskjutning).
//
// Det som beror på var ytan står i världen bakas inte (det skulle kräva en bild per objekt):
//   smuts nertill på murar och trä, mossa på skuggsidan nära marken, nötta trappsteg,
//   mer grus längs arenans skrank och en upptrampad mitt. Det görs här i shadern, med samma
//   värden som Blender-materialen (de följer med som "extras").

// Blender (x, y, z) från spelets världskoordinater (borgen är vriden ett halvt varv och skalad S, sänkt Y0)
const WORLD_GLSL = `
varying vec3 vBorgPos;
varying vec3 vBorgNrm;
float bHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bHash(i), bHash(i + vec3(1,0,0)), f.x), mix(bHash(i + vec3(0,1,0)), bHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(bHash(i + vec3(0,0,1)), bHash(i + vec3(1,0,1)), f.x), mix(bHash(i + vec3(0,1,1)), bHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float bFbm(vec3 p) { return bNoise(p) * 0.5 + bNoise(p * 2.03) * 0.3 + bNoise(p * 4.1) * 0.2; }
uniform float uSmuts;
uniform float uMossa;
uniform float uTrappa;
uniform float uArena;
`;
const WORLD_VERT = `
vec4 bw = modelMatrix * vec4(transformed, 1.0);
vBorgPos = vec3(-bw.x, bw.z, bw.y - ${Y0.toFixed(5)}) / ${S.toFixed(4)};
vec3 bn = normalize(mat3(modelMatrix) * objectNormal);
vBorgNrm = vec3(-bn.x, bn.z, bn.y);
`;
const WORLD_COLOR = `
{
  float z = vBorgPos.z;
  vec3 N = normalize(vBorgNrm);
  // smuts nertill (Blender: VARLD_FAKTOR-delen)
  float smuts = (1.0 - smoothstep(0.0, 1.3, z)) * uSmuts;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.332, 0.275, 0.202), smuts);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.8, smuts * 0.5);
  // mossa: fläckvis, nära marken och mest på skuggsidan (bort från solen)
  float skugga = smoothstep(0.3, -0.5, dot(N, vec3(-0.62, 0.78, 0.0)));
  float mossa = smoothstep(0.58, 0.72, bFbm(vBorgPos * 0.45)) * (1.0 - smoothstep(0.2, 2.2, z)) * 0.45 * uMossa;
  mossa = clamp(mossa * (0.35 + skugga * 1.3), 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.076, 0.093, 0.037), mossa);
  // nötta trappsteg: översidorna ljusare
  float nott = smoothstep(0.8, 0.95, N.z) * uTrappa;
  diffuseColor.rgb *= 1.0 + nott * 0.09;
  // arenan: mörkare och grusigare längs skranket, upptrampad mitt
  float d = length(vBorgPos.xy / vec2(13.0, 9.3));
  float kant = smoothstep(0.78, 0.98, d) * uArena;
  float mitt = (1.0 - smoothstep(0.0, 0.65, d)) * uArena;
  diffuseColor.rgb *= (1.0 - kant * 0.112) * (1.0 - mitt * 0.05);
  borgRough = smuts * 0.05 - nott * 0.22 + kant * 0.04 - mitt * 0.06;
}
`;

function worldEffects(mat, ex) {
  const smuts = +ex.varld_smuts || 0;
  const mossa = ex.varld_mossa ? 1 : 0;
  const trappa = ex.trappa ? 1 : 0;
  const arena = ex.arena ? 1 : 0;
  if (!smuts && !mossa && !trappa && !arena) return;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSmuts = { value: smuts };
    shader.uniforms.uMossa = { value: mossa };
    shader.uniforms.uTrappa = { value: trappa };
    shader.uniforms.uArena = { value: arena };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBorgPos;\nvarying vec3 vBorgNrm;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n" + WORLD_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + WORLD_GLSL)
      .replace("#include <map_fragment>", "#include <map_fragment>\nfloat borgRough = 0.0;\n" + WORLD_COLOR)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + borgRough, 0.04, 1.0);");
  };
  mat.customProgramCacheKey = () => `borg-${smuts}-${mossa}-${trappa}-${arena}`;
}

// Bilder i glb-filen → THREE.Texture (bara de vi behöver, en gång var)
async function decodeImages(json, bin) {
  return Promise.all((json.images || []).map(async (img) => {
    const bv = json.bufferViews[img.bufferView];
    const blob = new Blob([new Uint8Array(bin, bv.byteOffset || 0, bv.byteLength)], { type: img.mimeType || "image/webp" });
    return createImageBitmap(blob, { imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "none" });
  }));
}

function makeMaterials(json, bitmaps) {
  const texCache = new Map();
  const tex = (info, srgb) => {
    if (!info) return null;
    const t = json.textures[info.index];
    const src = t.extensions?.EXT_texture_webp?.source ?? t.source;
    const tr = info.extensions?.KHR_texture_transform;
    const key = `${src}|${srgb}|${tr ? tr.scale + "/" + tr.offset : ""}`;
    if (texCache.has(key)) return texCache.get(key);
    const tx = new THREE.Texture(bitmaps[src]);
    tx.flipY = false; // glTF-bilder ligger åt det hållet redan
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tx.anisotropy = 8;
    if (tr) {
      if (tr.scale) tx.repeat.fromArray(tr.scale);
      if (tr.offset) tx.offset.fromArray(tr.offset);
    }
    tx.needsUpdate = true;
    texCache.set(key, tx);
    return tx;
  };
  return (json.materials || []).map((m) => {
    const name = m.name.replace(/__B$/, "");
    const ex = m.extras || {};
    const pbr = m.pbrMetallicRoughness || {};
    const color = pbr.baseColorFactor ? new THREE.Color().fromArray(pbr.baseColorFactor) : new THREE.Color(1, 1, 1);
    let mat;
    if (name === "MAT_Eld") {
      mat = new THREE.MeshBasicMaterial({ color: 0xffb050 });
    } else {
      const mr = tex(pbr.metallicRoughnessTexture, false);
      mat = new THREE.MeshStandardMaterial({
        name,
        color,
        map: tex(pbr.baseColorTexture, true),
        roughnessMap: mr,
        metalnessMap: ex.typ === "jarn" ? mr : null,
        roughness: pbr.roughnessFactor ?? 1,
        metalness: ex.typ === "jarn" ? pbr.metallicFactor ?? 1 : 0,
        normalMap: tex(m.normalTexture, false),
        side: ex.typ === "tyg" ? THREE.DoubleSide : THREE.FrontSide,
      });
      // utan tangenter i filen räknar three.js fram dem – då ska normalens y vändas (som GLTFLoader gör)
      if (mat.normalMap) mat.normalScale.set(1, -1);
      worldEffects(mat, ex);
    }
    // Marken ligger platt i full sol och blir mycket ljusare i spelet än i Blenders testljus:
    // tona ner den lite så att sanden förblir dämpad och jordnära (uppdraget: ingen ljus gul sand).
    if (ex.typ === "mark") mat.color.multiplyScalar(0.8);
    mat.name = name;
    mat.userData.extras = ex;
    mat.userData.dryColor = mat.color.clone();
    return mat;
  });
}

// ---------- En liten GLB-läsare (mesher: position, normal, UV, index + material och bilder) ----------
async function loadGlb(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("inte en glb-fil");
  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, start, len)));
    else if (type === 0x004e4942) bin = buf.slice(start, start + len);
    off = start + len;
  }
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const arrays = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array };
  const accessor = (i) => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const Arr = arrays[a.componentType];
    const n = comps[a.type];
    return new THREE.BufferAttribute(new Arr(bin, (bv.byteOffset || 0) + (a.byteOffset || 0), a.count * n), n);
  };
  const materials = makeMaterials(json, await decodeImages(json, bin));
  const fallback = new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.9 });
  const meshes = json.meshes.map((m) => m.primitives.map((p) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", accessor(p.attributes.POSITION));
    if (p.attributes.NORMAL !== undefined) g.setAttribute("normal", accessor(p.attributes.NORMAL));
    if (p.attributes.TEXCOORD_0 !== undefined) g.setAttribute("uv", accessor(p.attributes.TEXCOORD_0));
    if (p.indices !== undefined) g.setIndex(accessor(p.indices));
    // Alla delar måste ha samma attribut för att kunna slås ihop
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    return { geometry: g, material: materials[p.material] || fallback };
  }));
  return {
    materials,
    nodes: json.nodes.filter((n) => n.mesh !== undefined).map((n) => ({
      name: n.name,
      parts: meshes[n.mesh],
      t: n.translation || [0, 0, 0],
      r: n.rotation || [0, 0, 0, 1],
      s: n.scale || [1, 1, 1],
    })),
  };
}

// Bröstvärnet framför kungalogen går från golvet (z 3,27) till z 4,2 i Blender. Det sänks till z 3,78,
// så kungaparet syns från midjan och uppåt. Fanorna under det kortas lika mycket i överkanten.
const PARAPET_TOP = 4.2, PARAPET_NEW = 3.78;
// Tronerna lyfts upp på en tronpall och flyttas fram, så att kungaparet syns från planen
const THRONE_LIFT = 0.6, THRONE_FWD = 0.5;
function lowerRoyalParapet(n) {
  for (const part of n.parts) {
    const pos = part.geometry.attributes.position;
    const a = new Float32Array(pos.array);
    for (let i = 0; i < pos.count; i++) {
      // glTF-koordinater: Blender z = y, Blender y = -z (plus nodens förflyttning)
      const bz = a[i * 3 + 1] * n.s[1] + n.t[1];
      const by = -(a[i * 3 + 2] * n.s[2] + n.t[2]);
      if (Math.abs(bz - PARAPET_TOP) < 0.05 && by > 11.8 && by < 12.35) a[i * 3 + 1] = (PARAPET_NEW - n.t[1]) / n.s[1];
    }
    part.geometry = part.geometry.clone();
    part.geometry.setAttribute("position", new THREE.BufferAttribute(a, 3));
  }
}

// ---------- Publikplatser: borgens läktare, adelsläktarna och ståplatserna ----------
function crowdSpots() {
  const spots = [];
  const rand = seededRandom(2024);
  const face = (p) => Math.atan2(-p.x, -p.z * 0.55); // mot planen (lite mer rakt fram än mot mitten)
  const seat = (bx, by, bz, row, standing = false) => {
    const pos = B(bx, by, bz);
    spots.push({ pos, yaw: face(pos), row, standing });
  };
  // Sidoläktarna öst och väst: fyra rader, 1 m djupa, 0,6 m höga steg
  for (const sg of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      for (let y = -1.85; y <= 7.75; y += 0.6) {
        if (rand() < 0.78) seat(sg * (16.05 + i) + (rand() - 0.5) * 0.06, y + (rand() - 0.5) * 0.1, 1.2 + 0.6 * i, i);
      }
    }
  }
  // Adelsläktarna på övre gården (tre rader på var sida om kungalogen)
  for (const [xa, xb] of [[-12.8, -8.8], [8.7, 16.7]]) {
    for (let i = 0; i < 3; i++) {
      for (let x = xa; x <= xb; x += 0.62) if (rand() < 0.82) seat(x, 13.85 + 0.9 * i, 1.4 + 0.45 * (i + 1), i);
    }
  }
  // Ståplatser på södra sidan (två låga steg på var sida om paradvägen)
  for (const sx of [-1, 1]) {
    for (const [y, z] of [[-10.9, 0.35], [-12.1, 0.7]]) {
      for (let x = 3.5; x <= 11.2; x += 0.62) if (rand() < 0.7) seat(sx * x, y + (rand() - 0.5) * 0.2, z, 3, true);
    }
  }
  return spots;
}

export function buildBorgArena() {
  const group = new THREE.Group();
  const colliders = [];
  const rand = seededRandom(99);

  // Marken långt bort (borgens egen mark är 200 m bred) och himlen
  const far = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0x55613c, roughness: 1 }));
  far.rotation.x = -Math.PI / 2;
  far.position.y = -2.9;
  group.add(far);
  const sky = makeSky();
  group.add(sky);
  for (let i = 0; i < 12; i++) {
    const t = rand() * Math.PI * 2;
    const r = 130 + rand() * 80;
    const cloud = makeCloud(rand);
    cloud.position.set(Math.sin(t) * r, 42 + rand() * 25, Math.cos(t) * r);
    group.add(cloud);
  }
  const deck = new THREE.Group();
  deck.visible = false;
  deck.userData.noMerge = true;
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2;
    const c = makeCloud(rand, "deck");
    c.position.set(Math.sin(t) * (70 + rand() * 60), 32 + rand() * 8, Math.cos(t) * (70 + rand() * 60));
    deck.add(c);
  }
  group.add(deck);

  // Borgen (laddas medan man är i lobbyn)
  const model = new THREE.Group();
  model.rotation.y = Math.PI;
  model.scale.setScalar(S);
  model.position.y = Y0;
  model.userData.noMerge = true;
  group.add(model);
  const woodUsers = [];
  // Trä till tronpallen (tills borgens eget trämaterial har laddats)
  const wood = new THREE.MeshStandardMaterial({ color: 0x6f5c48, map: plankTexture(), roughness: 0.85 });
  let arenaMat = null;
  // Några bostadsfönster lyser svagt varmt på kvällen (ingen ljuskälla – bara självlysande färg)
  let varmMat = null;
  let inreMat = null;
  let kvall = false;
  const tandFonster = () => {
    // Fönsternischernas insida ligger i skugga och blir kolsvart utan studsljus:
    // ge den ett svagt brunt egenljus så att den läses som mörkt trä/murverk, inte som ett hål.
    if (inreMat) {
      inreMat.emissive.set(0x3a2c20);
      inreMat.emissiveIntensity = kvall ? 0.35 : 0.6;
    }
    if (varmMat) {
      varmMat.emissive.set(kvall ? 0xff8a3a : 0x3a2c20);
      varmMat.emissiveIntensity = kvall ? 0.45 : 0.6;
    }
  };
  const ready = loadGlb(MODEL_URL).then(({ nodes, materials }) => {
    const holder = new THREE.Group();
    arenaMat = materials.find((m) => m.name === "MAT_Mark_Arena") || null;
    varmMat = materials.find((m) => m.name === "MAT_Fonster_Varm") || null;
    inreMat = materials.find((m) => m.name === "MAT_Fonster_Inre") || null;
    tandFonster();
    const tra = materials.find((m) => m.name === "MAT_Tra_Konstruktion");
    if (tra) for (const o of woodUsers) o.material = tra;
    for (const n of nodes) {
      // Kungalogens bröstvärn är så högt att det döljer kungaparet: sänk det till ett lågt räcke
      if (n.name === "Kungaloge" || n.name.startsWith("Baner_Kungaloge")) lowerRoyalParapet(n);
      // Tronerna flyttas fram och upp på en tronpall (glTF: y = upp, z = mot planen)
      if (n.name === "Kungaloge_Stolar" || n.name === "Kungaloge_Dynor") n.t = [n.t[0], n.t[1] + THRONE_LIFT, n.t[2] + THRONE_FWD];
      for (const part of n.parts) {
        const mesh = new THREE.Mesh(part.geometry, part.material);
        mesh.position.fromArray(n.t);
        mesh.quaternion.fromArray(n.r);
        mesh.scale.fromArray(n.s);
        mesh.castShadow = part.material.name !== "MAT_Eld" && !/^Mark_|Skrankgang|Stridsyta|Paradvag|Kampevag|Tillfartsvag|Golv|SM_Grus/.test(n.name);
        mesh.receiveShadow = true;
        holder.add(mesh);
      }
    }
    // Slå ihop allt per material: några tiotal ritanrop i stället för flera hundra
    const merged = mergeStatic(holder);
    model.add(merged);
    model.updateMatrixWorld(true);
    return true;
  }).catch((err) => {
    console.warn("Kunde inte ladda borgen:", err);
    // Reserv: en enkel sandplan så att man ändå kan spela
    const field = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.MeshStandardMaterial({ color: 0x94826a, map: rakedSandTexture(), roughness: 1 }));
    field.rotation.x = -Math.PI / 2;
    field.receiveShadow = true;
    group.add(field);
    return false;
  });

  // Varma ljuspunkter (facklor) – tas in i spelets ljuspool som på de andra banorna
  const torches = [];
  for (const [x, y, z, power] of [
    [0, -17.0, 3.0, 2.2], [2.75, -26.95, 3.85, 1.2], [-2.75, -26.95, 3.85, 1.2], [0, 13.6, 6.6, 1.6],
    [13.05, -5.0, 2.9, 1.0], [-13.05, -5.0, 2.9, 1.0], [-15.7, -14.4, 1.4, 1.4],
  ]) {
    const l = new THREE.PointLight(0xffa860, power, 8, 1.6);
    l.position.copy(B(x, y, z));
    l.castShadow = false;
    l.userData.base = power;
    group.add(l);
    torches.push(l);
  }

  // Publiken
  const crowd = new Crowd(crowdSpots(), 31);
  group.add(crowd.group);

  // Kungen och drottningen på stolarna i kungalogen, härolden framme vid bröstvärnet, vakter på sidorna
  const royals = makeRoyals();
  const place = (fig, p, yaw = Math.PI) => {
    fig.group.position.copy(p);
    fig.group.rotation.y = yaw;
    fig.group.userData.noMerge = true;
    group.add(fig.group);
  };
  place(royals.king, B(-0.9, 13.92 - THRONE_FWD, 3.73 + THRONE_LIFT));
  place(royals.queen, B(0.9, 13.92 - THRONE_FWD, 3.73 + THRONE_LIFT));
  // Tronpallen: en träpall med röd matta under tronerna
  {
    const dais = new THREE.Mesh(new THREE.BoxGeometry(3.3 * S, THRONE_LIFT * S, 1.5 * S), wood);
    woodUsers.push(dais);
    dais.position.copy(B(0, 13.6, 3.27 + THRONE_LIFT / 2));
    dais.castShadow = dais.receiveShadow = true;
    group.add(dais);
    const carpet = new THREE.Mesh(new THREE.BoxGeometry(2.9 * S, 0.03, 1.5 * S + 0.02), new THREE.MeshStandardMaterial({ color: 0x7a1a22, roughness: 0.95 }));
    carpet.position.copy(B(0, 13.6, 3.27 + THRONE_LIFT)).add(new THREE.Vector3(0, 0.015, 0));
    carpet.receiveShadow = true;
    group.add(carpet);
    // Ett trappsteg framför pallen
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.4 * S, 0.3 * S, 0.4 * S), wood);
    woodUsers.push(step);
    step.position.copy(B(0, 12.65, 3.27 + 0.15));
    step.castShadow = step.receiveShadow = true;
    group.add(step);
  }
  place(royals.herald, B(2.7, 12.75, 3.2), Math.PI + 0.25);
  place(royals.guards[0], B(-4.5, 13.75, 1.4));
  place(royals.guards[1], B(4.5, 13.75, 1.4));
  // Kungaparet görs lite större så att de syns från planen, och logen får ett varmt ljus under taket
  royals.king.group.scale.setScalar(1.18);
  royals.queen.group.scale.setScalar(1.18);
  const logeLight = new THREE.PointLight(0xffc890, 2.4, 7, 1.4);
  logeLight.position.copy(B(0, 12.6, 5.6));
  logeLight.userData.base = 2.4;
  group.add(logeLight);
  torches.push(logeLight);

  // Träningsdockan (som på de andra banorna) och prispallen mitt på planen
  const quintain = makeQuintain();
  quintain.group.position.set(-10.6, 0, 3.6);
  group.add(quintain.group);
  colliders.push({ minX: -10.6 - 0.22, maxX: -10.6 + 0.22, minZ: 3.6 - 0.22, maxZ: 3.6 + 0.22 });
  const podium = makePodium();
  podium.group.rotation.y = Math.PI;
  group.add(podium.group);

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
    updateClouds(dt);
    for (const l of torches) {
      const s = l.position.x * 3.1 + l.position.z;
      l.intensity = l.userData.base * l.userData.boost * (0.9 + Math.sin(time * 11 + s) * 0.06 + Math.sin(time * 23 + s) * 0.04);
    }
  };
  for (const l of torches) l.userData.boost = 1;

  return {
    kind: "borg",
    group, colliders, update, quintain, podium, ready,
    cheer: (strength = 1) => (excitement = Math.min(1.5, excitement + strength)),
    royalReact: (up) => royals.react(up),
    heraldBlow: () => royals.blow(),
    kingThrow: (onRelease) => royals.throwBow(onRelease),
    setQuality(low) {
      for (const l of torches) l.visible = !low || l === torches[0];
    },
    // Regn: blötare, mörkare sand
    setWet(wet) {
      if (!arenaMat) return;
      arenaMat.color.copy(arenaMat.userData.dryColor).multiplyScalar(wet ? 0.72 : 1);
      arenaMat.roughness = wet ? 0.75 : 1;
    },
    setOvercast(on) {
      this.overcast = on;
      deck.visible = on;
      const cm = getCloudMaterial();
      if (on) {
        sky.material.uniforms.top.value.set(this.evening ? 0x3a3446 : 0x76838f);
        sky.material.uniforms.horizon.value.set(this.evening ? 0x8a6a6a : 0xc4cad0);
        if (cm) cm.color.set(this.evening ? 0x7a6670 : 0xbcc2c8);
      } else {
        this.setTime(!!this.evening);
      }
    },
    setTime(evening) {
      this.evening = evening;
      kvall = !!evening;
      tandFonster();
      // Klar blå himmel på dagen, dämpad solnedgång på kvällen
      sky.material.uniforms.top.value.set(evening ? 0x3a4078 : 0x4a7cc0);
      sky.material.uniforms.horizon.value.set(evening ? 0xe0a078 : 0xc4d4e4);
      const cm = getCloudMaterial();
      if (cm) cm.color.set(evening ? 0xffb090 : 0xffffff);
      for (const l of torches) {
        l.userData.boost = evening ? 2.4 : 0.4; // i dagsljus syns facklorna knappt
        l.distance = evening ? 11 : 8;
      }
    },
  };
}
