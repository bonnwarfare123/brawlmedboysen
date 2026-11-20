// =====================================================================
//  Rustningar som 3D-modeller från Blender (GLB)
//
//  En rustning som finns i MODELLER nedan ritas med en färdig modell i stället för
//  den kodbyggda kroppen. Modellen är exporterad med C10_spelmodell_export.py och
//  är skinnad på riddarens egna 15 kroppsdelar (pelvis, torso, head, upperArm,
//  forearm, hand, thigh, shin, foot), så all rörelse, ragdoll och avhuggning
//  fungerar som förut. Hjälmen är en egen stel del (kan slås av).
//
//  Ny rustning: kör exportskriptet med rätt KONFIG i Blender, lägg filen i
//  public/models/rustningar/ och lägg till en rad i MODELLER.
//  Saknas filen (eller hinner den inte laddas) används den kodbyggda kroppen.
// =====================================================================
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// rustningens nyckel (KIT_STYLES / ARMOR_STYLES i knight.js) → fil
export const MODELLER = {
  guard: "models/rustningar/guard.glb",
};

// Kroppsdelarna i samma ordning som i exportskriptet (_REGION i modellen är ett index här)
const BEN = ["pelvis", "torso", "head", "upperArmL", "forearmL", "handL", "upperArmR", "forearmR", "handR",
  "thighL", "shinL", "footL", "thighR", "shinR", "footR"];

const cache = new Map(); // nyckel → { scene, meta } när den är laddad
const laddar = new Map();

function ladda(nyckel) {
  if (laddar.has(nyckel)) return laddar.get(nyckel);
  const url = MODELLER[nyckel];
  const p = new GLTFLoader().loadAsync(url).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    let meta = null;
    gltf.scene.traverse((o) => {
      const s = o.userData?.spelmodell;
      if (s && !meta) meta = typeof s === "string" ? JSON.parse(s) : s;
    });
    if (!meta) throw new Error("modellen saknar mått (spelmodell)");
    const spec = { scene: gltf.scene, meta };
    cache.set(nyckel, spec);
    return spec;
  }).catch((e) => {
    console.warn(`[rustning] ${nyckel}: kunde inte laddas, använder den kodbyggda`, e);
    return null;
  });
  laddar.set(nyckel, p);
  return p;
}

// Börja ladda alla direkt, så de oftast är klara innan första riddaren byggs
export function forladdaRustningar() {
  return Promise.all(Object.keys(MODELLER).map(ladda));
}
// Spelet väntar (högst 8 s) på modellerna innan första riddaren byggs, så att alla ser samma kropp
await Promise.race([forladdaRustningar(), new Promise((r) => setTimeout(r, 8000))]);

// Den laddade modellen för en rustning (eller null)
export function rustningsmodell(style) {
  return MODELLER[style] ? cache.get(style) || null : null;
}

// Riddarens mått för den här rustningen (ersätter den slumpade kroppsbyggnaden)
export function byggnadFor(spec) {
  const b = spec.meta.byggnad;
  return {
    reshape: {
      torso: [b.broad, b.tall, 1],
      head: [1.1, 1.1, 1.1],
      upperArmL: [1.1, b.armY, 1.1], upperArmR: [1.1, b.armY, 1.1],
      forearmL: [1.1, b.foreY, 1.1], forearmR: [1.1, b.foreY, 1.1],
      handL: [1.3, 1.3, 1.3], handR: [1.3, 1.3, 1.3],
      thighL: [1.12, 1, 1.12], thighR: [1.12, 1, 1.12],
      shinL: [1.12, 1, 1.12], shinR: [1.12, 1, 1.12],
      footL: [1.22, 1.06, 1.2], footR: [1.22, 1.06, 1.2],
      pelvis: [1, 1, 1],
    },
    broad: b.broad, tall: b.tall, deep: 1,
    armLen: [0.29 * b.armY, 0.26 * b.foreY],
    // bröstets mått (knight.js multiplicerar rx med broad själv)
    chest: { rx: (spec.meta.brost?.rx ?? 0.2 * b.broad) / b.broad, rz: spec.meta.brost?.rz ?? 0.15, ar: spec.meta.brost?.ar ?? 0.075 },
  };
}

const LAG_SMUTS = new THREE.Color(0x3a332c);

// Byter riddarens kropp mot modellen. Anropas i slutet av Knight-konstruktorn (vilopose).
export function anvandRustningsmodell(knight, spec, colorHex) {
  const seg = knight.seg;
  knight.group.updateMatrixWorld(true);
  const inv = knight.group.matrixWorld.clone().invert();
  const vila = {};
  for (const n of BEN) vila[n] = new THREE.Matrix4().multiplyMatrices(inv, seg[n].matrixWorld);

  // 1. Den kodbyggda kroppen döljs (vapen, sköld, knogjärn och hjälmgruppen finns kvar)
  const behall = new Set([knight.weapon, knight.shield, knight.knuckle, knight.helmet]);
  for (const s of Object.values(seg)) {
    for (const c of s.children) {
      if (c.userData?.segment || behall.has(c)) continue;
      c.visible = false;
    }
  }
  for (const c of knight.helmet.children) c.visible = false;
  for (const s of knight.soft) if (s.cloth.mesh.material !== knight.m.capeCloth) s.cloth.mesh.visible = false;
  knight.skin = {};
  knight.skinMeshes = [];
  knight.hairParts = null; // updateHairVisibility gör inget

  // 2. Material: egna kopior (så att träffblinkningen och lagfärgen bara gäller den här riddaren)
  const matKopia = new Map();
  const material = (m) => {
    if (!matKopia.has(m)) {
      const k = m.clone();
      k.emissive = new THREE.Color(0xaa1010);
      k.emissiveIntensity = 0;
      if (m.userData?.lag) k.color.set(colorHex).lerp(LAG_SMUTS, 0.17);
      if (k.metalness >= 0.3 && knight.m.steel?.envMap) {
        k.envMap = knight.m.steel.envMap; // blank metall speglar omgivningen, som riddarnas
        k.envMapIntensity = 1.25;
      }
      k.userData.baseColor = k.color.clone();
      knight.materials.push(k);
      matKopia.set(m, k);
    }
    return matKopia.get(m);
  };

  // 3. Den skinnade kroppen, bunden till riddarens kroppsdelar
  const delar = [];
  spec.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld); // till riddarens koordinater (vilopose)
    const ordning = o.skeleton.bones.map((b) => b.name);
    const ben = ordning.map((n) => seg[n]);
    if (ben.some((b) => !b)) {
      console.warn("[rustning] okänd kroppsdel i modellen", ordning);
      return;
    }
    const skel = new THREE.Skeleton(ben, ordning.map((n) => vila[n].clone().invert()));
    const mats = Array.isArray(o.material) ? o.material.map(material) : material(o.material);
    const mesh = new THREE.SkinnedMesh(geo, mats);
    mesh.bind(skel, new THREE.Matrix4());
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.rustning = true;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1.6);
    mesh.frustumCulled = false;
    seg.pelvis.add(mesh);
    delar.push({ mesh, ordning });
  });

  // 4. Hjälmen: stel, i hjälmgruppen (som sitter i huvudets led)
  const huvud = new THREE.Vector3().setFromMatrixPosition(vila.head);
  spec.scene.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    let p = o;
    let iHjalm = false;
    while (p) {
      if (/_Hjalm/.test(p.name)) iHjalm = true;
      p = p.parent;
    }
    if (!iHjalm) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    geo.translate(-huvud.x, -huvud.y, -huvud.z);
    const mesh = new THREE.Mesh(geo, material(o.material));
    mesh.castShadow = mesh.receiveShadow = true;
    knight.helmet.add(mesh);
  });

  // 5. Vapnet och skölden i modellens knutna händer (grepp från exporten, i handens koordinater)
  const g = spec.meta.grepp;
  if (g) {
    const standard = new THREE.Vector3(0, -0.069, 0.01); // där riddarens egen hand håller vapnet
    knight.greppDelta = {
      L: new THREE.Vector3(...g.L).sub(standard),
      R: new THREE.Vector3(...g.R).sub(standard),
    };
    knight.greppLen = new THREE.Vector3(...g.L).length();
    knight.weapon.position.add(knight.greppDelta.R);
    knight.shield.position.add(knight.greppDelta.L);
    knight.knuckle?.position.add(knight.greppDelta.L);
  }

  knight.rustning = { delar };
  return delar.length > 0;
}

// En led huggs av: hörnen på den lösa delen följer bara den, resten följer leden innanför
export function rustningHuggAv(knight, segName) {
  const r = knight.rustning;
  if (!r) return;
  const lossa = new Set();
  knight.seg[segName].traverse((o) => {
    if (o.userData?.segment) lossa.add(o.userData.segment);
  });
  const foralder = knight.seg[segName].parent?.userData?.segment || "pelvis";
  for (const { mesh, ordning } of r.delar) {
    const g = mesh.geometry;
    const idx = g.attributes.skinIndex;
    const w = g.attributes.skinWeight;
    const reg = g.attributes._region;
    const iLos = ordning.map((n) => lossa.has(n));
    const fi = ordning.indexOf(foralder);
    for (let v = 0; v < idx.count; v++) {
      const region = reg ? BEN[Math.round(reg.getX(v))] : null;
      const losHorn = region ? lossa.has(region) : iLos[idx.getX(v)];
      if (losHorn) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          if (!iLos[idx.getComponent(v, k)]) w.setComponent(v, k, 0);
          sum += w.getComponent(v, k);
        }
        if (sum > 1e-6) for (let k = 0; k < 4; k++) w.setComponent(v, k, w.getComponent(v, k) / sum);
        else {
          idx.setXYZW(v, ordning.indexOf(region || segName), 0, 0, 0);
          w.setXYZW(v, 1, 0, 0, 0);
        }
      } else {
        for (let k = 0; k < 4; k++) if (iLos[idx.getComponent(v, k)]) idx.setComponent(v, k, fi);
      }
    }
    idx.needsUpdate = true;
    w.needsUpdate = true;
  }
}
