// Bakar ihop en kropp som ligger still (död riddare, avhuggen del, tappad hjälm) till några få
// statiska meshar – en per material. Den ser exakt likadan ut, men i stället för 30–80 små meshar
// (varje ett ritanrop) och en skinnad rustning som räknas om varje bild blir det 4–8 ritanrop.
// Rustningens skinning räknas ut en gång på processorn (samma formel som grafikkortets shader).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const _m = new THREE.Matrix4();
const _mw = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();

// Skinnade positioner/normaler/tangenter i världen
function skinnedToWorld(mesh) {
  const src = mesh.geometry;
  const skel = mesh.skeleton;
  skel.update();
  const bm = skel.boneMatrices;
  const pos = src.attributes.position;
  const nor = src.attributes.normal;
  const tan = src.attributes.tangent;
  const si = src.attributes.skinIndex;
  const sw = src.attributes.skinWeight;
  const n = pos.count;
  const P = new Float32Array(n * 3);
  const N = nor ? new Float32Array(n * 3) : null;
  const T = tan ? new Float32Array(n * 4) : null;
  // bindMatrix (riddarens rustning binds med identitet, men räkna rätt ändå)
  const bind = mesh.bindMatrix;
  const bindInvWorld = _mw.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
  const e = new Float32Array(16);
  for (let i = 0; i < n; i++) {
    e.fill(0);
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w === 0) continue;
      const b = si.getComponent(i, k) * 16;
      for (let j = 0; j < 16; j++) e[j] += w * bm[b + j];
    }
    _m.fromArray(e).multiply(bind).premultiply(bindInvWorld);
    _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
    P[i * 3] = _v.x; P[i * 3 + 1] = _v.y; P[i * 3 + 2] = _v.z;
    if (N || T) _n.getNormalMatrix(_m);
    if (N) {
      _v.fromBufferAttribute(nor, i).applyMatrix3(_n).normalize();
      N[i * 3] = _v.x; N[i * 3 + 1] = _v.y; N[i * 3 + 2] = _v.z;
    }
    if (T) {
      _v.set(tan.getX(i), tan.getY(i), tan.getZ(i)).transformDirection(_m);
      T[i * 4] = _v.x; T[i * 4 + 1] = _v.y; T[i * 4 + 2] = _v.z; T[i * 4 + 3] = tan.getW(i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(P, 3));
  if (N) g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
  if (T) g.setAttribute("tangent", new THREE.BufferAttribute(T, 4));
  for (const name of ["uv", "uv1", "color"]) if (src.attributes[name]) g.setAttribute(name, src.attributes[name]);
  if (src.index) g.setIndex(src.index);
  g.groups = src.groups.map((x) => ({ ...x }));
  return g;
}

function worldCopy(mesh) {
  const src = mesh.geometry;
  const g = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "tangent", "uv", "uv1", "color"]) if (src.attributes[name]) g.setAttribute(name, src.attributes[name].clone());
  if (src.index) g.setIndex(src.index.clone());
  g.groups = src.groups.map((x) => ({ ...x }));
  g.applyMatrix4(mesh.matrixWorld);
  // spegelvända delar (negativ skala) vänder trianglarna – vänd tillbaka
  if (mesh.matrixWorld.determinant() < 0 && g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
  }
  return g;
}

// En bit av geometrin (en materialgrupp) med eget index, alltid indexerad
function piece(g, start, count) {
  const out = new THREE.BufferGeometry();
  for (const name in g.attributes) out.setAttribute(name, g.attributes[name]);
  const n = g.attributes.position.count;
  let idx;
  if (g.index) idx = g.index.array.slice(start, start + count);
  else {
    idx = new Uint32Array(count);
    for (let i = 0; i < count; i++) idx[i] = start + i;
  }
  out.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1));
  return out;
}

function visibleChain(o, stop) {
  for (let p = o; p && p !== stop.parent; p = p.parent) if (!p.visible) return false;
  return true;
}

// objects: de lösa delarna (redan direkt i scenen). Ger en grupp med de bakade masharna, eller null.
export function bakeObjects(objects, scene) {
  const buckets = new Map();
  // alla delar först (rustningens ben är andra delar – de måste stå rätt innan någon skinnas)
  for (const root of objects) root?.updateMatrixWorld(true);
  for (const root of objects) {
    if (!root || !root.parent) continue;
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      // rustningen: alltid den fulla versionen (LOD0), aldrig den enklare (den är för avstånd/skuggor)
      if (o.userData.lod === 1) return;
      if (o.userData.lod === 0 ? !visibleChain(o.parent, root) : !visibleChain(o, root)) return;
      if (o.material && (Array.isArray(o.material) ? o.material.some((m) => m.transparent) : o.material.transparent) && !o.isSkinnedMesh) {
        // genomskinligt (t.ex. blod-decaler på kroppen) bakas också, men får egen hink per material
      }
      let g;
      try {
        g = o.isSkinnedMesh ? skinnedToWorld(o) : worldCopy(o);
      } catch {
        return;
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const groups = Array.isArray(o.material) && g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : g.attributes.position.count, materialIndex: 0 }];
      for (const gr of groups) {
        const mat = mats[gr.materialIndex ?? 0];
        if (!mat || !mat.visible) continue;
        const p = piece(g, gr.start, Math.min(gr.count, (g.index ? g.index.count : g.attributes.position.count) - gr.start));
        // bara de attribut materialet behöver (alla i en hink måste ha samma)
        if (!mat.normalMap && p.attributes.tangent) p.deleteAttribute("tangent");
        if (!mat.vertexColors && p.attributes.color) p.deleteAttribute("color");
        if (!(mat.aoMap || mat.lightMap) && p.attributes.uv1) p.deleteAttribute("uv1");
        if (!p.attributes.normal) p.computeVertexNormals();
        const key = mat.uuid + "|" + Object.keys(p.attributes).sort().join(",") + "|" + (o.receiveShadow ? 1 : 0);
        if (!buckets.has(key)) buckets.set(key, { mat, receive: o.receiveShadow, list: [] });
        buckets.get(key).list.push(p);
      }
    });
  }
  if (!buckets.size) return null;
  const group = new THREE.Group();
  group.name = "bakad kropp";
  for (const b of buckets.values()) {
    // bara de hörn som används (annars följer hela rustningens hörnbuffert med varje bit)
    const compact = b.list.map(compactGeometry);
    const merged = compact.length === 1 ? compact[0] : mergeGeometries(compact);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const m = new THREE.Mesh(merged, b.mat);
    m.receiveShadow = b.receive;
    m.castShadow = false;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  group.matrixAutoUpdate = true;
  scene.add(group);
  // (originalen tas bort ur scenen av den som anropar, men sparas – reprisen behöver dem)
  return group;
}

// Plockar ut de hörn som indexet använder (en bit av rustningen ska inte bära med sig alla 40 000 hörn)
function compactGeometry(g) {
  const idx = g.index.array;
  const remap = new Map();
  const order = [];
  const out = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    let r = remap.get(idx[i]);
    if (r === undefined) {
      r = order.length;
      remap.set(idx[i], r);
      order.push(idx[i]);
    }
    out[i] = r;
  }
  const res = new THREE.BufferGeometry();
  for (const name in g.attributes) {
    const a = g.attributes[name];
    const sz = a.itemSize;
    const arr = new Float32Array(order.length * sz);
    for (let i = 0; i < order.length; i++) for (let c = 0; c < sz; c++) arr[i * sz + c] = a.getComponent(order[i], c);
    res.setAttribute(name, new THREE.BufferAttribute(arr, sz)); // (getComponent ger redan riktiga värden)
  }
  res.setIndex(new THREE.BufferAttribute(order.length > 65535 ? out : Uint16Array.from(out), 1));
  return res;
}
