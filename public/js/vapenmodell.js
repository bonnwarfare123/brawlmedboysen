// =====================================================================
//  Vapen som 3D-modeller från Blender (GLB) – VAPEN 2.0
//
//  Ett vapen som finns i VAPENMODELLER nedan ritas med en färdig modell i stället
//  för de kodbyggda formerna i Knight.buildWeapon. Allt annat om vapnet är som förut:
//  greppet (handens origo), slagspåret, blodet på klingan, hacken i eggen och
//  vänsterhandens grepp kommer från den kodbyggda versionen (userData), och
//  träffar, räckvidd och skada avgörs av servern (WEAPON_SPECS).
//
//  Modellen är exporterad med blender/vapen/Vxx_*.py: greppets mitt i origo,
//  klingan/skaftet längs +Y, eggarna längs ±X. Den har ett bakat material
//  (färg, roughness, metallic, normal) och två delar: <namn> och <namn>_Faste
//  (fästet, guldtonas på praktrustningen).
//
//  Nytt vapen: exportera, lägg filen i public/models/vapen/ och lägg till en rad.
//  Saknas filen (eller hinner den inte laddas) används det kodbyggda vapnet.
// =====================================================================
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// vapnets index (WEAPONS i shared.js) → fil
export const VAPENMODELLER = {
  0: "models/vapen/sword.glb", 1: "models/vapen/axe.glb", 2: "models/vapen/flail.glb",
  3: "models/vapen/twohander.glb", 4: "models/vapen/daneaxe.glb", 5: "models/vapen/halberd.glb",
  6: "models/vapen/zweihander.glb", 7: "models/vapen/spear.glb", 8: "models/vapen/warhammer.glb",
  9: "models/vapen/maul.glb", 10: "models/vapen/dagger.glb", 11: "models/vapen/falchion.glb",
  12: "models/vapen/messer.glb", 13: "models/vapen/mace.glb", 14: "models/vapen/shortspear.glb",
  15: "models/vapen/glaive.glb", 16: "models/vapen/poleaxe.glb", 17: "models/vapen/goedendag.glb",
};

// sköldens index (SHIELDS i shared.js) → fil. Vapenmålningen (framsidan i spelarens färg) ritas
// fortfarande av spelet ovanpå modellen.
export const SKOLDMODELLER = {
  0: "models/vapen/skold_rund.glb", 1: "models/vapen/skold_droppe.glb", 2: "models/vapen/skold_riddare.glb",
  3: "models/vapen/skold_bucklare.glb", 4: "models/vapen/skold_pavis.glb",
};

// Inställningen ?vapen=gamla i adressen visar de kodbyggda vapnen (för jämförelse)
const AV = typeof location !== "undefined" && /[?&]vapen=gamla/.test(location.search);

const cache = new Map(); // "v<index>" / "s<index>" → { delar: [{ geo, mat, faste }] }

function ladda(nyckel, url) {
  return new GLTFLoader().loadAsync(url).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const delar = [];
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      geo.computeBoundingSphere();
      delar.push({ geo, mat: o.material, faste: /_Faste/.test(o.name) });
    });
    if (!delar.length) throw new Error("tom modell");
    cache.set(nyckel, { delar });
  }).catch((e) => {
    console.warn(`[vapen] ${url}: kunde inte laddas, använder det kodbyggda`, e);
  });
}

export function forladdaVapen() {
  if (AV) return Promise.resolve();
  return Promise.all([
    ...Object.entries(VAPENMODELLER).map(([k, url]) => ladda("v" + k, url)),
    ...Object.entries(SKOLDMODELLER).map(([k, url]) => ladda("s" + k, url)),
  ]);
}
// Spelet väntar (högst 8 s) på modellerna innan första riddaren byggs
await Promise.race([forladdaVapen(), new Promise((r) => setTimeout(r, 8000))]);

export function vapenmodell(kind) {
  return cache.get("v" + kind) || null;
}

export function skoldmodell(kind) {
  return cache.get("s" + kind) || null;
}

const GULD = new THREE.Color(1.0, 0.78, 0.42);

// Riddarens egna kopior av modellens material (en per riddare, som riddarens andra material:
// träffblink, blod och smuts verkar på dem). Fästet guldtonas på praktrustningen.
function materialFor(knight, mat, guld) {
  if (!knight._vapenMat) knight._vapenMat = new Map();
  const nyckel = mat.uuid + (guld ? ":guld" : "");
  if (!knight._vapenMat.has(nyckel)) {
    const k = mat.clone();
    if (guld) {
      k.color.copy(GULD);
      k.roughness = 0.75; // multipliceras med roughness-bilden: lite blankare
    } else {
      // Som spelets egna stålmaterial (metalness ~0,6): metallen får lite eget ljust grått, så att den
      // läses som stål även när den speglar varm sand (helt metallisk blir den bronsfärgad i arenan).
      k.color.setRGB(1.06, 1.1, 1.16);
    }
    k.metalness = 0.68; // multipliceras med metallic-bilden (trä och läder förblir 0)
    if (k.metalness >= 0.3 && knight.m?.steel?.envMap) {
      k.envMap = knight.m.steel.envMap; // speglar omgivningen som riddarnas övriga metall
      k.envMapIntensity = 1.0;
    }
    k.emissive = new THREE.Color(0xaa1010);
    k.emissiveIntensity = 0;
    k.userData.baseColor = k.color.clone();
    knight.materials?.push(k);
    knight._vapenMat.set(nyckel, k);
  }
  return knight._vapenMat.get(nyckel);
}

// Byter de kodbyggda formerna i vapengruppen g mot modellen. Gruppens userData (grepp, slagspår,
// blod, eggar) och eventuella undergrupper (t.ex. armborstets pil) lämnas orörda.
export function anvandVapenmodell(knight, g, spec, gilded, behall = (c) => c.material === knight.m?.cloth) {
  for (const c of [...g.children]) {
    if (!c.isMesh || behall(c)) continue; // delar i spelarens färg (tofsar, tygremsor) är kvar
    g.remove(c);
    c.geometry?.dispose();
  }
  for (const d of spec.delar) {
    const mesh = new THREE.Mesh(d.geo.clone(), materialFor(knight, d.mat, gilded && d.faste));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.vapenmodell = true;
    g.add(mesh);
  }
  g.userData.vapenmodell = true;
}

// Skölden: modellen ersätter trä, kant, nitar och buckla; den målade framsidan (vapenbilden i
// spelarens färg, materialet med en bild) ritas av spelet som förut.
export function anvandSkoldmodell(knight, shield, spec, gilded) {
  anvandVapenmodell(knight, shield, spec, gilded, (c) => !!c.material?.userData?.skoldMalning || c.material === knight.m?.cloth);
}
