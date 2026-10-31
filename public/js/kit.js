// NYA RUSTNINGAR OCH HJÄLMAR (v0.25)
// Byggs med samma verktyg som de gamla (knight.shape, latheAlong osv.) och slås ihop på samma sätt,
// så de kostar ungefär lika mycket att rita. Varje rustning har en egen silhuett och egna material.

import * as THREE from "three";
import {
  chainmailTexture, leatherTexture, quiltTexture, wrapTexture, linenTexture, stripeTexture, plateTexture,
  rivetClothTexture, channelQuiltTexture, forgedTexture,
} from "./textures.js";

// Rustningarnas nycklar (läggs efter de gamla i ARMOR_STYLES, i samma ordning som ARMORS i shared.js)
export const KIT_STYLES = ["gambeson", "surcoat", "coatplates", "brigandine", "guard", "mercenary", "halfplate", "crusader"];

// Hjälmar: 11–18. Vilka som döljer hår och skägg (se updateHairVisibility)
export const CLOSED_HELMETS = [0, 1, 4, 18];
export const HOOD_HELMETS = [7, 8, 12, 15, 17];

const PI = Math.PI;
const col = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

// Radien på en profil [[r, y], ...] vid höjden y
function rAt(profile, y) {
  for (let i = 1; i < profile.length; i++) {
    if (y <= profile[i][1]) {
      const [r0, y0] = profile[i - 1];
      const [r1, y1] = profile[i];
      return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
    }
  }
  return profile[profile.length - 1][0];
}
const lathe = (profile, segs = 22, start = 0, len = PI * 2) =>
  new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs, start, len);

// En bit av en ring (torus) som ligger vågrätt och är centrerad framtill
function frontArc(radius, tube, arc) {
  const g = new THREE.TorusGeometry(radius, tube, 4, Math.max(6, Math.round(arc * 8)), arc);
  g.rotateZ(PI / 2 - arc / 2);
  g.rotateX(PI / 2);
  return g;
}

// ---------- Material ----------
// Returnerar vad lemmarna och höfterna ska vara gjorda av, och hur bred bålen är (för armarna)
export function kitMaterials(k, m, style, colorHex) {
  const light = new THREE.Color(colorHex).getHSL({}).l > 0.6;
  const out = { limbL: m.chain, limbR: m.chain, legL: m.chain, legR: m.chain, hips: m.chain, chest: { rx: 0.18, rz: 0.125, ar: 0.056 }, metal: false };
  if (style === "gambeson") {
    // Vadderad jacka i blekt, infärgat linne (spelarens färg blandad med oblekt tyg)
    m.gamb = k.mat(col(colorHex, 0xe6d8b6, 0.5), 0.96, 0, { map: channelQuiltTexture(), side: THREE.DoubleSide });
    m.gambDark = k.mat(col(colorHex, 0x3a2c1e, 0.6), 0.9, 0);
    Object.assign(out, { limbL: m.gamb, limbR: m.gamb, legL: m.wool, legR: m.wool, hips: m.gamb, chest: { rx: 0.195, rz: 0.142, ar: 0.066 } });
  } else if (style === "coatplates") {
    // Plåtrock: plåtar nitade under kraftigt tyg (mörkare, sammetsaktigt i spelarens färg)
    m.coat = k.mat(col(colorHex, 0x22181a, 0.3), 0.7, 0.02, { map: linenTexture() });
    out.chest = { rx: 0.198, rz: 0.142, ar: 0.064 };
  } else if (style === "brigandine") {
    m.brig = k.mat(col(colorHex, 0x2a2018, 0.18), 0.78, 0.04, { map: rivetClothTexture() });
    Object.assign(out, { legL: m.wool, legR: m.wool, hips: m.wool, chest: { rx: 0.19, rz: 0.138, ar: 0.06 } });
  } else if (style === "guard") {
    // Stadsvakt: livré i två färger (spelarens färg och en kontrast), mörk vadderad jacka under
    m.liveryA = k.mat(colorHex, 0.88, 0, { map: linenTexture() });
    m.liveryB = k.mat(light ? 0x2c2a30 : 0xe6dcc6, 0.88, 0, { map: linenTexture() });
    m.padDark = k.mat(0x4c4238, 0.95, 0, { map: quiltTexture() });
    Object.assign(out, { limbL: m.padDark, limbR: m.padDark, legL: m.liveryA, legR: m.liveryB, hips: m.wool, chest: { rx: 0.185, rz: 0.13, ar: 0.06 } });
  } else if (style === "mercenary") {
    // Legoknekt: hopplockat. Smutsig vadderad jack, en ärm i ringbrynja, randig hosa på ena benet
    m.jack = k.mat(0xa88e64, 0.96, 0, { map: quiltTexture() });
    m.hoseStripe = k.mat(0xffffff, 0.9, 0, { map: stripeTexture(colorHex, 0xe2d6bc, 10) });
    Object.assign(out, { limbL: m.jack, limbR: m.chain, legL: m.hoseStripe, legR: m.wool, hips: m.jack, chest: { rx: 0.188, rz: 0.132, ar: 0.062 } });
  } else if (style === "halfplate") {
    Object.assign(out, { chest: { rx: 0.205, rz: 0.145, ar: 0.066 }, metal: true });
  } else if (style === "crusader") {
    // Vit vapenrock med kors i spelarens färg (lite smutsig av resan)
    m.surWhite = k.mat(0xe8e1cf, 0.92, 0, { map: linenTexture(), side: THREE.DoubleSide });
  }
  return out;
}

// ---------- Bålen ----------

export function buildKitTorso(k, style, pelvis, torso, m, look, H) {
  const P = (...a) => pelvis.add(k.shape(...a));
  const T = (...a) => torso.add(k.shape(...a));
  const { sculptTorso, sculptChest } = H;
  const mailBody = () => {
    T(sculptTorso(new THREE.CapsuleGeometry(0.15, 0.2, 8, 18), 0.25), m.chain, [0, 0.24, 0], [1.22, 1, 0.76]);
    T(new THREE.CylinderGeometry(0.075, 0.13, 0.12, 14, 1, true), m.chain, [0, 0.47, 0], [1.1, 1, 0.9]); // brynjehuvans krage
  };
  const belt = (r, y, sz = 0.8, buckle = m.brass, w = 0.012) => {
    P(new THREE.CylinderGeometry(r, r, w * 3.4, 22, 1, true), m.strap, [0, y, 0], [1.05, 1, sz]);
    P(new THREE.BoxGeometry(0.04, 0.034, 0.012), buckle, [0.02, y - 0.003, r * sz + 0.006], [1, 1, 1], [0, 0, 0.06]);
    P(new THREE.BoxGeometry(0.014, 0.11, 0.006), m.strap, [0.05, y - 0.06, r * sz + 0.006], [1, 1, 1], [0.05, 0, 0.06]); // bältets ände
  };
  // Lodrät söm/kant som följer en ellips runt bålen (vinkeln a från framsidan)
  const around = (a, y, rx, rz, geo, mat, extraRot = 0) =>
    T(geo, mat, [Math.sin(a) * rx, y, Math.cos(a) * rz], [1, 1, 1], [extraRot, a, 0]);

  if (style === "gambeson") {
    // Tjock vadderad jacka med längsgående kanaler, hög krage, snörning och en lappad reva
    T(sculptTorso(new THREE.CapsuleGeometry(0.162, 0.2, 8, 20), 0.262), m.gamb, [0, 0.24, 0], [1.24, 1, 0.84]);
    T(new THREE.CylinderGeometry(0.082, 0.1, 0.075, 16, 1, true), m.gamb, [0, 0.475, 0], [1.1, 1, 0.98]);     // hög krage
    T(new THREE.TorusGeometry(0.083, 0.011, 6, 18), m.gambDark, [0, 0.512, 0], [1.1, 0.98, 1], [PI / 2, 0, 0]);
    // Omlott framtill med snören
    T(new THREE.BoxGeometry(0.05, 0.4, 0.016), m.gamb, [0.025, 0.25, 0.134], [1, 1, 1], [-0.03, 0, 0]);
    T(new THREE.BoxGeometry(0.006, 0.4, 0.018), m.gambDark, [0.05, 0.25, 0.135], [1, 1, 1], [-0.03, 0, 0]);
    for (let i = 0; i < 6; i++) {
      const y = 0.08 + i * 0.066;
      T(new THREE.SphereGeometry(0.009, 5, 4), m.leatherDark, [0.052, y, 0.145]);
      T(new THREE.BoxGeometry(0.004, 0.03, 0.004), m.leatherDark, [0.056, y - 0.018, 0.146], [1, 1, 1], [0, 0, 0.3]);
    }
    // Lagad reva på sidan, smutsig lapp
    T(new THREE.BoxGeometry(0.075, 0.065, 0.008), m.wool, [-0.12, 0.15, 0.115], [1, 1, 1], [0, -0.6, 0.15]);
    for (let i = 0; i < 5; i++) T(new THREE.BoxGeometry(0.003, 0.014, 0.004), m.rope, [-0.145 + i * 0.013, 0.185, 0.1 + i * 0.008], [1, 1, 1], [0, -0.6, 0]);
    belt(0.172, 0.0);
    // Vadderat skört med slits framtill
    P(new THREE.CylinderGeometry(0.175, 0.225, 0.26, 20, 1, true, 0.22, PI * 2 - 0.44), m.gamb, [0, -0.13, 0], [1, 1, 0.84]);
    const hem = frontArc(0.225, 0.009, PI * 2 - 0.44);
    hem.rotateY(PI);
    P(hem, m.gambDark, [0, -0.26, 0], [1, 1, 0.84]);
    // Pung och kniv i bältet
    P(new THREE.BoxGeometry(0.07, 0.08, 0.04), m.leather, [-0.14, -0.05, 0.09], [1, 1, 1], [0, 0.55, 0]);
    P(new THREE.BoxGeometry(0.026, 0.14, 0.016), m.leatherDark, [0.15, -0.09, 0.08], [1, 1, 1], [0, 0, 0.2]);
    P(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 6), m.wood, [0.163, 0.0, 0.08], [1, 1, 1], [0, 0, 0.2]);
  } else if (style === "surcoat") {
    // Ringbrynja under en lång, ärmlös vapenrock med stort vapen på bröstet (ca 1250–1300)
    mailBody();
    T(new THREE.TorusGeometry(0.08, 0.018, 6, 16), m.quilt, [0, 0.52, 0], [1.08, 0.95, 1], [PI / 2, 0, 0]);
    T(new THREE.CylinderGeometry(0.148, 0.168, 0.38, 22, 1, true), m.cloth, [0, 0.2, 0], [1.15, 1, 0.8]);
    T(new THREE.CylinderGeometry(0.153, 0.168, 0.3, 14, 1, true, -0.8, 1.6), m.herald, [0, 0.215, 0], [1.15, 1, 0.8]);
    T(new THREE.TorusGeometry(0.148, 0.006, 4, 24), m.trim, [0, 0.39, 0], [1.15, 0.8, 1], [PI / 2, 0, 0]); // kantband upptill
    belt(0.172, -0.005, 0.82, m.trim, 0.009);
    // Svärdsbälte lågt på höften, snett
    P(new THREE.TorusGeometry(0.19, 0.012, 4, 26), m.leatherDark, [0, -0.08, 0], [1.08, 0.8, 1], [PI / 2, 0, 0.14]);
    for (const a of [-0.5, 0.5]) P(new THREE.SphereGeometry(0.008, 5, 4), m.trim, [Math.sin(a) * 0.205, -0.08 + a * 0.05, Math.cos(a) * 0.152]);
    if (look.w === 0) k.addScabbard(pelvis, m, m.leatherDark);
  } else if (style === "coatplates") {
    // Plåtrock: tygklädd rock med plåtband (syns som upphöjda ränder med nitar), axelremmar, brynja under
    mailBody();
    const prof = [[0.122, 0.0], [0.152, 0.04], [0.162, 0.12], [0.168, 0.24], [0.162, 0.33], [0.132, 0.41], [0.092, 0.45]];
    T(H.sculptChest(lathe(prof, 26), 0, 0.45, 0.09), m.coat, [0, 0, 0], [1.22, 1, 0.84]);
    for (const y of [0.07, 0.15, 0.23, 0.31]) {
      const r = rAt(prof, y) + 0.004;
      T(frontArc(r, 0.0065, 2.4), m.coat, [0, y, 0], [1.22, 1, 0.84]);                 // plåtbandets kant
      for (let i = -3; i <= 3; i++) {
        const a = i * 0.36;
        T(new THREE.SphereGeometry(0.0085, 5, 4), m.brass, [Math.sin(a) * r * 1.22, y + 0.012, Math.cos(a) * r * 0.84 + 0.002]);
      }
    }
    // Rund plåt mitt på bröstet (stor nit) och remmar över axlarna med spännen
    T(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 14), m.steel, [0, 0.36, 0.115], [1, 1, 1], [PI / 2 - 0.35, 0, 0]);
    T(new THREE.SphereGeometry(0.01, 6, 4), m.brass, [0, 0.36, 0.121]);
    for (const s of [1, -1]) {
      T(new THREE.BoxGeometry(0.03, 0.14, 0.01), m.strap, [0.1 * s, 0.4, 0.07], [1, 1, 1], [-0.75, 0, 0]);
      T(new THREE.BoxGeometry(0.03, 0.12, 0.01), m.strap, [0.1 * s, 0.4, -0.08], [1, 1, 1], [0.75, 0, 0]);
      T(new THREE.BoxGeometry(0.03, 0.028, 0.008), m.brass, [0.1 * s, 0.35, 0.112]);
    }
    // Plåtkjol under tyget, med nitar, och brynjans kant under
    P(new THREE.CylinderGeometry(0.168, 0.2, 0.15, 20, 1, true), m.coat, [0, -0.065, 0], [1.1, 1, 0.82]);
    for (const y of [-0.035, -0.11]) {
      for (let i = -4; i <= 4; i++) {
        const a = i * 0.3;
        const r = 0.168 + (y - 0.01) * -0.21;
        P(new THREE.SphereGeometry(0.0075, 5, 4), m.brass, [Math.sin(a) * r * 1.1, y, Math.cos(a) * r * 0.82 + 0.003]);
      }
    }
    P(new THREE.CylinderGeometry(0.2, 0.218, 0.1, 18, 1, true), m.chain, [0, -0.18, 0], [1.08, 1, 0.8]);
    belt(0.178, 0.005);
    if (look.w === 0) k.addScabbard(pelvis, m, m.steelDark);
  } else if (style === "brigandine") {
    // Brigandin: tyg i spelarens färg fullt av nitar, spänns ihop framtill med tre remmar
    T(sculptTorso(new THREE.CapsuleGeometry(0.155, 0.2, 8, 20), 0.255), m.brig, [0, 0.24, 0], [1.22, 1, 0.82]);
    T(new THREE.CylinderGeometry(0.078, 0.1, 0.07, 14, 1, true), m.leatherDark, [0, 0.47, 0], [1.1, 1, 0.92]); // krage
    T(new THREE.BoxGeometry(0.012, 0.4, 0.012), m.leatherDark, [-0.03, 0.24, 0.128]);                          // kanten där den möts
    for (let i = 0; i < 3; i++) {
      const y = 0.13 + i * 0.1;
      T(new THREE.BoxGeometry(0.11, 0.022, 0.008), m.strap, [0.01, y, 0.13]);
      T(new THREE.BoxGeometry(0.026, 0.03, 0.01), m.steelDark, [0.055, y, 0.134]);
      T(new THREE.BoxGeometry(0.004, 0.03, 0.012), m.steelDark, [0.055, y, 0.137]);
    }
    // Mässingsnitar i rader längs kanterna (de små i tyget ritas i strukturen)
    for (let i = 0; i < 7; i++) {
      T(new THREE.SphereGeometry(0.0075, 5, 4), m.brass, [-0.045, 0.06 + i * 0.058, 0.132]);
    }
    // Utsvängd, nitad kjol och brynjefrans under
    P(new THREE.CylinderGeometry(0.17, 0.218, 0.14, 20, 1, true), m.brig, [0, -0.06, 0], [1.04, 1, 0.82]);
    P(new THREE.CylinderGeometry(0.21, 0.226, 0.07, 18, 1, true), m.chain, [0, -0.16, 0], [1.04, 1, 0.82]);
    belt(0.172, 0.005, 0.82, m.steelDark);
    P(new THREE.BoxGeometry(0.075, 0.085, 0.045), m.leatherDark, [-0.14, -0.06, 0.09], [1, 1, 1], [0, 0.5, 0]);
    if (look.w === 0) k.addScabbard(pelvis, m, m.steelDark);
  } else if (style === "guard") {
    // Stadsvakt: mörk vadderad jacka, livrérock i två färger med stadens nycklar, brynjekrage
    T(sculptTorso(new THREE.CapsuleGeometry(0.155, 0.2, 8, 18), 0.255), m.padDark, [0, 0.24, 0], [1.22, 1, 0.8]);
    for (const [z, flip] of [[0.124, 1], [-0.124, -1]]) {
      T(new THREE.BoxGeometry(0.15, 0.42, 0.012), m.liveryA, [0.075 * flip, 0.21, z]);
      T(new THREE.BoxGeometry(0.15, 0.42, 0.012), m.liveryB, [-0.075 * flip, 0.21, z]);
    }
    // Stadens märke: två korslagda nycklar i guld
    for (const s of [1, -1]) {
      T(new THREE.BoxGeometry(0.012, 0.13, 0.006), m.gold, [0, 0.26, 0.133], [1, 1, 1], [0, 0, 0.6 * s]);
      T(new THREE.TorusGeometry(0.014, 0.004, 4, 10), m.gold, [0.04 * s, 0.312, 0.133]);
      T(new THREE.BoxGeometry(0.022, 0.01, 0.006), m.gold, [-0.033 * s, 0.215, 0.133], [1, 1, 1], [0, 0, 0.6 * s]);
    }
    T(new THREE.CylinderGeometry(0.08, 0.165, 0.09, 16, 1, true), m.chain, [0, 0.46, 0], [1.12, 1, 0.92]); // brynjekrage
    T(new THREE.TorusGeometry(0.165, 0.005, 4, 22), m.strap, [0, 0.415, 0], [1.12, 0.92, 1], [PI / 2, 0, 0]);
    // Livrérockens nedre del, vaddering under, brett bälte med nyckelring och ett horn
    for (const [z, flip] of [[0.135, 1], [-0.135, -1]]) {
      P(new THREE.BoxGeometry(0.15, 0.16, 0.012), m.liveryA, [0.075 * flip, -0.09, z], [1, 1, 1], [0.08 * flip, 0, 0]);
      P(new THREE.BoxGeometry(0.15, 0.16, 0.012), m.liveryB, [-0.075 * flip, -0.09, z], [1, 1, 1], [0.08 * flip, 0, 0]);
      P(new THREE.BoxGeometry(0.3, 0.012, 0.014), m.gold, [0, -0.168, z + 0.006 * flip], [1, 1, 1], [0.08 * flip, 0, 0]);
    }
    P(new THREE.CylinderGeometry(0.168, 0.2, 0.2, 16, 1, true), m.padDark, [0, -0.1, 0], [1, 1, 0.8]);
    P(new THREE.CylinderGeometry(0.168, 0.168, 0.055, 18), m.strap, [0, 0, 0], [1, 1, 0.82]);
    P(new THREE.BoxGeometry(0.05, 0.05, 0.012), m.iron, [0, 0, 0.14]);
    P(new THREE.TorusGeometry(0.022, 0.004, 4, 10), m.iron, [0.16, -0.05, 0.06], [1, 1, 1], [0, 1.2, 0]);
    for (let i = 0; i < 3; i++) P(new THREE.BoxGeometry(0.006, 0.05, 0.004), m.iron, [0.165, -0.085, 0.055 + i * 0.01], [1, 1, 1], [0, 0, 0.2 * (i - 1)]);
    P(new THREE.ConeGeometry(0.022, 0.13, 8), m.white, [-0.15, -0.06, 0.07], [1, 1, 1], [0.1, 0, 1.25]); // horn
    P(new THREE.TorusGeometry(0.023, 0.004, 4, 10), m.brass, [-0.12, -0.05, 0.07], [1, 1, 1], [0, PI / 2, 0]);
  } else if (style === "mercenary") {
    // Legoknekt: lerig jack med snörd urringning, axelrem med pungar och flaska, skärp i spelarens färg
    T(sculptTorso(new THREE.CapsuleGeometry(0.158, 0.2, 8, 18), 0.258), m.jack, [0, 0.24, 0], [1.24, 1, 0.82]);
    T(new THREE.TorusGeometry(0.085, 0.022, 6, 16), m.jack, [0, 0.47, 0], [1.1, 0.95, 1], [PI / 2, 0, 0]);
    for (let i = 0; i < 4; i++) {
      const y = 0.32 + i * 0.03;
      for (const s of [1, -1]) T(new THREE.BoxGeometry(0.004, 0.05, 0.004), m.rope, [0, y, 0.136 - i * 0.004], [1, 1, 1], [0, 0, 1.1 * s]);
    }
    T(new THREE.BoxGeometry(0.03, 0.1, 0.004), m.skin, [0, 0.37, 0.131]);   // bröstet syns i urringningen
    // Axelrem snett över bröstet med två pungar
    T(new THREE.CylinderGeometry(1, 1, 0.034, 28, 1, true), m.strap, [0, 0.25, 0.004], [0.212, 1, 0.152], [0, 0, -0.62]);
    T(new THREE.BoxGeometry(0.05, 0.05, 0.03), m.leatherDark, [-0.07, 0.18, 0.135], [1, 1, 1], [0, 0, -0.6]);
    T(new THREE.BoxGeometry(0.045, 0.045, 0.028), m.leather, [0.04, 0.32, 0.13], [1, 1, 1], [0, 0, -0.6]);
    // Lappar och smuts
    T(new THREE.BoxGeometry(0.08, 0.07, 0.008), m.leather, [0.11, 0.12, 0.116], [1, 1, 1], [0, 0.55, -0.2]);
    T(new THREE.BoxGeometry(0.1, 0.06, 0.008), m.wool, [-0.05, 0.28, -0.13], [1, 1, 1], [0, 0, 0.3]);
    // Skärp i spelarens färg runt midjan med knut och hängande ändar
    P(new THREE.CylinderGeometry(0.172, 0.176, 0.07, 18, 1, true), m.cloth, [0, 0.0, 0], [1.04, 1, 0.84]);
    P(new THREE.SphereGeometry(0.032, 8, 6), m.cloth, [0.14, 0.0, 0.1], [1.2, 0.9, 0.7]);
    P(new THREE.BoxGeometry(0.04, 0.16, 0.008), m.cloth, [0.15, -0.09, 0.105], [1, 1, 1], [0.1, 0.5, 0.15]);
    P(new THREE.BoxGeometry(0.035, 0.12, 0.008), m.cloth, [0.17, -0.07, 0.09], [1, 1, 1], [0.1, 0.5, -0.2]);
    // Jackens skört, och en lös bit brynja framtill (plundrad)
    P(new THREE.CylinderGeometry(0.17, 0.205, 0.18, 16, 1, true), m.jack, [0, -0.1, 0], [1, 1, 0.82]);
    P(new THREE.CylinderGeometry(0.2, 0.215, 0.1, 12, 1, true, -1.1, 2.2), m.chain, [0, -0.2, 0], [1, 1, 0.82]);
    P(new THREE.TorusGeometry(0.174, 0.01, 4, 22), m.strap, [0, -0.04, 0], [1.04, 0.84, 1], [PI / 2, 0, -0.08]);
    // Träflaska på höften
    P(new THREE.SphereGeometry(1, 10, 8), m.wood, [-0.17, -0.1, 0.03], [0.045, 0.055, 0.03], [0, 0.4, 0]);
    P(new THREE.CylinderGeometry(0.01, 0.012, 0.03, 6), m.leatherDark, [-0.17, -0.035, 0.03]);
    if (look.w === 0) k.addScabbard(pelvis, m, m.iron);
  } else if (style === "halfplate") {
    // Halvplåt: bröstplåt över brynjan, brynjekrage och långt brynjeskört, rundplåtar i armhålorna
    mailBody();
    const chest = [[0.148, 0.04], [0.166, 0.09], [0.19, 0.2], [0.198, 0.3], [0.18, 0.39], [0.13, 0.44], [0.098, 0.455]].map(([r, y]) => new THREE.Vector2(r, y));
    T(sculptChest(new THREE.LatheGeometry(chest, 24), 0.04, 0.455), m.steel, [0, 0, 0], [1.15, 1, 0.78]);
    T(new THREE.BoxGeometry(0.016, 0.34, 0.02), m.steel, [0, 0.25, 0.153], [1, 1, 1], [-0.08, 0, 0]);
    T(new THREE.TorusGeometry(0.1, 0.012, 6, 18), m.steel, [0, 0.45, 0], [1.1, 0.78, 1], [PI / 2, 0, 0]);
    T(new THREE.TorusGeometry(0.17, 0.007, 5, 22), m.steelDark, [0, 0.05, 0], [1.15, 0.78, 1], [PI / 2, 0, 0]);
    // Remmar i kors över ryggen
    for (const s of [1, -1]) T(new THREE.BoxGeometry(0.026, 0.4, 0.01), m.strap, [0, 0.24, -0.118], [1, 1, 1], [0, 0, 0.55 * s]);
    T(new THREE.BoxGeometry(0.03, 0.03, 0.012), m.brass, [0, 0.24, -0.124]);
    // Rundplåtar (besagews) framför armhålorna
    for (const s of [1, -1]) {
      T(new THREE.CylinderGeometry(0.042, 0.042, 0.006, 16), m.steel, [0.165 * s, 0.33, 0.085], [1, 1, 1], [PI / 2 - 0.2, 0, -0.7 * s]);
      T(new THREE.SphereGeometry(0.009, 6, 4), m.brass, [0.168 * s, 0.332, 0.09]);
    }
    this_addSash(k, T, P, m);
    // En plåtlamell och sedan ett långt brynjeskört
    P(new THREE.CylinderGeometry(0.17, 0.18, 0.06, 18, 1, true), m.steel, [0, -0.02, 0], [1.1, 1, 0.8]);
    P(new THREE.TorusGeometry(0.18, 0.005, 4, 22), m.brass, [0, -0.05, 0], [1.1, 0.8, 1], [PI / 2, 0, 0]);
    P(new THREE.CylinderGeometry(0.18, 0.215, 0.24, 18, 1, true), m.chain, [0, -0.17, 0], [1.08, 1, 0.8]);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * PI * 2;
      P(new THREE.SphereGeometry(0.011, 4, 3), m.brass, [Math.sin(a) * 0.215 * 1.08, -0.29, Math.cos(a) * 0.215 * 0.8]); // mässingsringar längst ner
    }
    belt(0.19, -0.045, 0.8, m.brass);
    if (look.w === 0) k.addScabbard(pelvis, m, m.steelDark);
  } else if (style === "crusader") {
    // Korsriddare: brynja från topp till tå, vit vapenrock med ett stort kors i spelarens färg
    mailBody();
    T(new THREE.TorusGeometry(0.08, 0.018, 6, 16), m.quilt, [0, 0.52, 0], [1.08, 0.95, 1], [PI / 2, 0, 0]);
    T(new THREE.CylinderGeometry(0.148, 0.168, 0.38, 22, 1, true), m.surWhite, [0, 0.2, 0], [1.15, 1, 0.8]);
    for (const back of [false, true]) {
      const g1 = new THREE.CylinderGeometry(0.154, 0.168, 0.26, 4, 1, true, -0.15, 0.3);
      const g2 = new THREE.CylinderGeometry(0.157, 0.159, 0.05, 10, 1, true, -0.62, 1.24);
      if (back) { g1.rotateY(PI); g2.rotateY(PI); }
      T(g1, m.cloth, [0, back ? 0.22 : 0.22, 0], [1.15, 1, 0.8]);
      T(g2, m.cloth, [0, 0.28, 0], [1.15, 1, 0.8]);
    }
    T(new THREE.TorusGeometry(0.168, 0.006, 4, 24), m.strap, [0, 0.01, 0], [1.15, 0.8, 1], [PI / 2, 0, 0]);
    belt(0.172, -0.01, 0.82, m.iron, 0.01);
    P(new THREE.BoxGeometry(0.07, 0.08, 0.04), m.leather, [-0.14, -0.06, 0.09], [1, 1, 1], [0, 0.5, 0]);
    // Smuts längst ner på rocken
    T(new THREE.CylinderGeometry(0.169, 0.17, 0.05, 22, 1, true), k.mat(0x9a8a70, 0.95, 0, { map: linenTexture(), transparent: true, opacity: 0.55, depthWrite: false }), [0, 0.035, 0], [1.155, 1, 0.805]);
    if (look.w === 0) k.addScabbard(pelvis, m, m.iron);
  }
}

// Band i spelarens färg (som på plåtrustningen)
function this_addSash(k, T, P, m) {
  k.addSash(T, P, m, 0.214, 0.17);
}

// ---------- Armar och ben ----------

export function buildKitLimbs(k, style, side, s, upper, fore, hand, thigh, shin, foot, m, H) {
  const U = (...a) => upper.add(k.shape(...a));
  const F = (...a) => fore.add(k.shape(...a));
  const Hd = (...a) => hand.add(k.shape(...a));
  const TH = (...a) => thigh.add(k.shape(...a));
  const SH = (...a) => shin.add(k.shape(...a));
  const FT = (...a) => foot.add(k.shape(...a));
  const { latheAlong, PROFILE } = H;
  const steel = m.steel;
  const couter = (mat = steel) => {
    F(new THREE.SphereGeometry(0.062, 12, 8), mat, [0, 0, -0.008]);
    F(new THREE.CylinderGeometry(0.054, 0.054, 0.01, 10), mat, [0.05 * s, 0, -0.01], [1, 1, 1.25], [0, 0, PI / 2]);
    F(new THREE.SphereGeometry(0.008, 5, 4), m.brass, [0.057 * s, 0, -0.01]);
  };
  const vambrace = (mat = steel) => {
    F(latheAlong(PROFILE.forearm, 0.26, 0.12, 0.72, 0.01, false, 0.003), mat);
    F(new THREE.CylinderGeometry(0.058, 0.046, 0.08, 14, 1, true), mat, [0, -0.22, 0]);
  };
  const poleyn = (mat = steel, size = 1) => {
    SH(new THREE.SphereGeometry(0.074 * size, 12, 8), mat, [0, 0, 0.022], [1, 1, 1.12]);
    SH(new THREE.CylinderGeometry(0.06 * size, 0.06 * size, 0.01, 10), mat, [0.058 * s * size, 0, 0], [1, 1, 1.2], [0, 0, PI / 2]);
    SH(new THREE.SphereGeometry(0.009, 5, 4), m.brass, [0.066 * s * size, 0, 0]);
  };
  const greave = (mat = steel) => {
    SH(latheAlong(PROFILE.shin, 0.4, 0.14, 1, 0.011, false, 0.003), mat);
    SH(new THREE.CylinderGeometry(0.066, 0.06, 0.03, 14, 1, true), mat, [0, -0.39, 0]);
  };
  const cuisse = (mat = steel) => {
    TH(latheAlong(PROFILE.thigh, 0.42, 0.06, 0.82, 0.012, false, 0.004), mat);
    for (const y of [-0.12, -0.3]) {
      TH(new THREE.TorusGeometry(0.084, 0.006, 4, 16), m.strap, [0, y, -0.005], [1, 1.05, 1], [PI / 2, 0, 0]);
      TH(new THREE.BoxGeometry(0.016, 0.016, 0.008), m.brass, [0.082 * s, y, -0.01]);
    }
  };
  const highBoot = (mat = m.leatherDark, top = m.leather) => {
    SH(new THREE.CylinderGeometry(0.074, 0.06, 0.29, 12, 1, true), mat, [0, -0.26, 0]);
    SH(new THREE.CylinderGeometry(0.082, 0.076, 0.045, 12, 1, true), top, [0, -0.115, 0]);
    SH(new THREE.TorusGeometry(0.066, 0.006, 4, 14), m.strap, [0, -0.3, 0], [1, 1, 1], [PI / 2, 0, 0]);
    SH(new THREE.BoxGeometry(0.018, 0.018, 0.008), m.brass, [0.066 * s, -0.3, 0]);
  };
  const ankleBoot = (mat = m.leatherDark) => {
    SH(new THREE.CylinderGeometry(0.058, 0.054, 0.1, 12, 1, true), mat, [0, -0.36, 0]);
    SH(new THREE.CylinderGeometry(0.064, 0.06, 0.025, 12, 1, true), m.leather, [0, -0.31, 0]);
  };
  const garter = (mat = m.strap, y = -0.08) => {
    SH(new THREE.TorusGeometry(0.068, 0.006, 4, 14), mat, [0, y, 0], [1, 1, 1], [PI / 2, 0, 0]);
    SH(new THREE.BoxGeometry(0.012, 0.05, 0.004), mat, [0.06 * s, y - 0.025, 0.02], [1, 1, 1], [0, PI / 2 * s, 0.2 * s]);
  };
  const mailEdge = () => {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * PI * 2;
      F(new THREE.SphereGeometry(0.011, 4, 3), m.chain, [Math.sin(a) * 0.04, -0.235, Math.cos(a) * 0.04]);
    }
  };

  if (style === "gambeson") {
    // Tjocka vadderade ärmar med sömmar, rulle vid axeln, läderhandskar, hosor och kängor
    U(latheAlong(PROFILE.upperArm, 0.29, 0, 1, 0.014, false), m.gamb);
    U(new THREE.TorusGeometry(0.07, 0.022, 6, 14), m.gamb, [0.01 * s, -0.02, 0], [1, 1, 1.12], [PI / 2, 0, 0.15 * s]);
    for (const [y, r] of [[-0.09, 0.075], [-0.17, 0.071], [-0.245, 0.064]]) U(new THREE.TorusGeometry(r, 0.0045, 4, 14), m.gambDark, [0, y, 0], [1, 1, 1], [PI / 2, 0, 0]);
    F(latheAlong(PROFILE.forearm, 0.26, 0, 0.86, 0.012, false), m.gamb);
    F(new THREE.TorusGeometry(0.056, 0.009, 5, 14), m.gambDark, [0, -0.215, 0], [1, 1, 1], [PI / 2, 0, 0]);
    k.addHand(Hd, m.leatherDark, s, 1.06);
    F(new THREE.CylinderGeometry(0.048, 0.04, 0.07, 12, 1, true), m.leatherDark, [0, -0.235, 0]);
    garter(m.gambDark, -0.07);
    ankleBoot();
    k.addPointedShoe(FT, m.leatherDark, m.strap, 0.1, false);
  } else if (style === "surcoat") {
    // Brynja överallt, små knäkopp i stål och sköldformade axelbrickor (ailettes) med spelarens vapen
    k.buildChainLimbs(side, s, upper, fore, hand, thigh, shin, foot, m);
    U(new THREE.BoxGeometry(0.012, 0.11, 0.095), m.herald, [0.072 * s, 0.035, -0.01], [1, 1, 1], [0, 0, 0.22 * s]);
    U(new THREE.BoxGeometry(0.014, 0.115, 0.1), m.trim, [0.069 * s, 0.035, -0.01], [1, 1, 1], [0, 0, 0.22 * s]);
    U(new THREE.BoxGeometry(0.004, 0.06, 0.004), m.strap, [0.05 * s, 0.07, -0.01], [1, 1, 1], [0, 0, 0.22 * s]);
    poleyn(steel, 0.92);
    SH(new THREE.TorusGeometry(0.064, 0.005, 4, 14), m.strap, [0, -0.07, 0], [1, 1, 1], [PI / 2, 0, 0]);
  } else if (style === "coatplates") {
    // Runda axelplåtar, armbågskopp och armskenor, plåthandskar; nitade lårskydd i tyg, knän och benskenor i stål
    U(new THREE.SphereGeometry(0.088, 14, 8, 0, PI * 2, 0, PI / 2), steel, [0.016 * s, -0.005, 0], [1.1, 0.6, 1.15]);
    U(new THREE.TorusGeometry(0.088, 0.006, 4, 18), m.steelDark, [0.016 * s, -0.005, 0], [1.1, 1.15, 1], [PI / 2, 0, 0]);
    U(new THREE.TorusGeometry(0.06, 0.006, 4, 14), m.strap, [0, -0.13, 0], [1, 1, 1], [PI / 2, 0, 0]);
    couter();
    vambrace();
    k.addGauntlet(Hd, steel, m.steelDark, s);
    TH(latheAlong(PROFILE.thigh, 0.42, 0.04, 0.84, 0.012, false, 0.004), m.coat);
    for (let r = 0; r < 3; r++) for (let c = -1; c <= 1; c++) {
      const a = c * 0.45;
      TH(new THREE.SphereGeometry(0.0075, 5, 4), m.brass, [Math.sin(a) * 0.092, -0.08 - r * 0.11, Math.cos(a) * 0.092]);
    }
    poleyn();
    greave();
    k.addPointedShoe(FT, steel, m.steelDark, 0.2, true);
  } else if (style === "brigandine") {
    // Brynjeärmar, läderarmskydd med stålskenor, knäkopp och höga ridstövlar
    mailEdge();
    F(latheAlong(PROFILE.forearm, 0.26, 0.16, 0.82, 0.009, false), m.leatherDark);
    for (const a of [-0.55, 0, 0.55]) F(new THREE.BoxGeometry(0.012, 0.14, 0.006), steel, [Math.sin(a) * 0.052, -0.125, Math.cos(a) * 0.052], [1, 1, 1], [0, a, 0]);
    for (const y of [-0.08, -0.18]) F(new THREE.TorusGeometry(0.052, 0.005, 4, 14), m.strap, [0, y, 0], [1, 1, 1], [PI / 2, 0, 0]);
    couter(steel);
    k.addHand(Hd, m.leatherDark, s, 1.06);
    F(new THREE.CylinderGeometry(0.05, 0.04, 0.07, 12, 1, true), m.leatherDark, [0, -0.235, 0]);
    poleyn(steel, 0.9);
    highBoot();
    k.addPointedShoe(FT, m.leatherDark, m.strap, 0.17, false);
  } else if (style === "guard") {
    // Puffade axlar i livréfärgen, läderarmskydd, hosor i två färger, kängor med strumpeband
    const liv = side === "L" ? m.liveryA : m.liveryB;
    U(new THREE.SphereGeometry(0.074, 12, 8, 0, PI * 2, 0, PI * 0.62), liv, [0.012 * s, -0.01, 0], [1.05, 0.8, 1.12]);
    U(new THREE.TorusGeometry(0.067, 0.007, 5, 14), m.gold, [0.01 * s, -0.045, 0], [1.03, 1.1, 1], [PI / 2, 0, 0]);
    F(latheAlong(PROFILE.forearm, 0.26, 0.25, 0.85, 0.008, false), m.leather);
    F(new THREE.TorusGeometry(0.05, 0.005, 4, 14), m.strap, [0, -0.13, 0], [1, 1, 1], [PI / 2, 0, 0]);
    k.addHand(Hd, m.leatherDark, s, 1.06);
    F(new THREE.CylinderGeometry(0.048, 0.04, 0.07, 12, 1, true), m.leatherDark, [0, -0.235, 0]);
    garter(m.strap, -0.08);
    ankleBoot();
    k.addPointedShoe(FT, m.leatherDark, m.strap, 0.13, false);
  } else if (style === "mercenary") {
    if (side === "L") {
      // Vänster: stor, buckig axelplåt i råsmide och en läderhandske
      U(new THREE.SphereGeometry(0.104, 14, 8, 0, PI * 2, 0, PI / 2), m.forged, [0.02 * s, 0, 0], [1.15, 0.65, 1.22]);
      for (let i = 0; i < 2; i++) U(new THREE.CylinderGeometry(0.1 - i * 0.008, 0.11 - i * 0.008, 0.04, 14, 1, false), m.forged, [0.022 * s, -0.035 - i * 0.034, 0], [1.12, 1, 1.18], [0, 0, 0.12 * s]);
      U(new THREE.SphereGeometry(0.022, 6, 4), m.forged, [0.07 * s, 0.035, 0.06], [1, 0.6, 1]); // buckla
      U(new THREE.TorusGeometry(0.058, 0.006, 4, 14), m.strap, [0, -0.13, 0], [1, 1, 1], [PI / 2, 0, 0]);
      F(new THREE.TorusGeometry(0.05, 0.012, 5, 14), m.rag, [0, -0.06, 0], [1, 1, 1], [PI / 2 + 0.2, 0, 0]);
      k.addHand(Hd, m.leather, s, 1.08);
      F(new THREE.CylinderGeometry(0.05, 0.042, 0.08, 12, 1, true), m.leather, [0, -0.23, 0]);
      // Randig hosa, läderlapp på knät och korta kängor
      SH(new THREE.SphereGeometry(0.05, 8, 6), m.leather, [0, -0.01, 0.045], [1.1, 1.1, 0.5]);
      for (let i = 0; i < 3; i++) SH(new THREE.TorusGeometry(0.06 - i * 0.003, 0.009, 4, 12), m.rag, [0, -0.2 - i * 0.04, 0], [1, 1, 1], [PI / 2 + (i % 2 ? 0.25 : -0.25), 0, 0]);
      ankleBoot();
      k.addPointedShoe(FT, m.leatherDark, m.strap, 0.08, false);
    } else {
      // Höger: brynjeärm med armskydd i läder, bar hand med lindad handled, hög stövel
      mailEdge();
      F(latheAlong(PROFILE.forearm, 0.26, 0.3, 0.8, 0.008, false), m.leatherDark);
      for (const y of [-0.1, -0.17]) {
        F(new THREE.TorusGeometry(0.05, 0.005, 4, 14), m.strap, [0, y, 0], [1, 1, 1], [PI / 2, 0, 0]);
        F(new THREE.BoxGeometry(0.014, 0.014, 0.008), m.iron, [0, y, 0.052]);
      }
      k.addHand(Hd, m.skin, s, 1.03);
      F(new THREE.CylinderGeometry(0.044, 0.038, 0.05, 10, 1, true), m.rag, [0, -0.245, 0]);
      garter(m.cloth, -0.06);
      highBoot(m.leather, m.leatherDark);
      k.addPointedShoe(FT, m.leather, m.strap, 0.1, false);
    }
  } else if (style === "halfplate") {
    // Axelplåt med en lamell, brynja synlig på överarmen, plåt från armbågen och ner; plåtben men läderskor
    U(new THREE.SphereGeometry(0.097, 16, 8, 0, PI * 2, 0, PI / 2), steel, [0.018 * s, -0.005, 0], [1.1, 0.6, 1.15]);
    U(new THREE.CylinderGeometry(0.095, 0.105, 0.042, 16, 1, false), steel, [0.02 * s, -0.035, 0], [1.08, 1, 1.12], [0, 0, 0.12 * s]);
    U(new THREE.TorusGeometry(0.105, 0.005, 4, 18), m.steelDark, [0.02 * s, -0.056, 0], [1.08, 1.12, 1], [PI / 2, 0, 0.12 * s]);
    for (const z of [0.07, -0.07]) U(new THREE.SphereGeometry(0.009, 5, 4), m.brass, [0.06 * s, 0.03, z]);
    couter();
    vambrace();
    k.addGauntlet(Hd, steel, m.steelDark, s);
    cuisse();
    poleyn();
    greave();
    k.addPointedShoe(FT, m.leatherDark, m.strap, 0.18, false);
  } else if (style === "crusader") {
    // Brynja från topp till tå: brynjevantar, brynjehosor med läderremmar under knät, enkla skor
    mailEdge();
    k.addHand(Hd, m.chain, s, 1.1);
    F(new THREE.CylinderGeometry(0.05, 0.044, 0.05, 12, 1, true), m.chain, [0, -0.235, 0]);
    F(new THREE.TorusGeometry(0.045, 0.005, 4, 12), m.strap, [0, -0.225, 0], [1, 1, 1], [PI / 2, 0, 0]);
    SH(new THREE.SphereGeometry(0.045, 10, 8), m.chain, [0, -0.005, 0.04], [1, 0.95, 0.6]);
    garter(m.strap, -0.07);
    SH(new THREE.TorusGeometry(0.058, 0.004, 3, 14), m.strap, [0, -0.3, 0.004], [1, 1, 1.1], [PI / 2 + 0.3, 0, 0]);
    k.addPointedShoe(FT, m.leatherDark, m.strap, 0.12, false);
  }
}

// ---------- Hjälmar 11–18 ----------

export function buildKitHelmet(k, helmet, kind, m, gilded) {
  const add = (...args) => helmet.add(k.shape(...args));
  const shell = (geometry, mat, pos, scale, rot) => {
    add(geometry, mat, pos, scale, rot);
    add(geometry.clone(), m.helmInner, pos, scale, rot);
  };
  const trim = gilded ? m.gold : m.brass;
  const ring = (mat, radius, y, count, skipFront = 0, size = 0.0075, scaleZ = 1) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * PI * 2;
      if (skipFront && Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < skipFront) continue;
      add(new THREE.SphereGeometry(size, 5, 4), mat, [Math.sin(a) * radius, y, Math.cos(a) * radius * scaleZ]);
    }
  };

  if (kind === 11) {
    // Näshjälm: spetsig (normandisk) hjälm med pannband, nitar och ett nässkydd
    const dome = [[0.121, 0], [0.119, 0.04], [0.104, 0.095], [0.068, 0.15], [0.022, 0.19], [0.0, 0.198]];
    shell(lathe(dome, 22), m.steel, [0, 0.188, -0.004], [1, 1, 1.04], [0.1, 0, 0]);
    add(new THREE.CylinderGeometry(0.123, 0.124, 0.03, 22, 1, true), m.steel, [0, 0.188, -0.004], [1, 1, 1.04]);
    add(new THREE.TorusGeometry(0.124, 0.006, 4, 24), m.steelDark, [0, 0.174, -0.004], [1, 1.04, 1], [PI / 2, 0, 0]);
    ring(trim, 0.125, 0.19, 14, 0.25, 0.007, 1.04);
    add(new THREE.BoxGeometry(0.026, 0.11, 0.012), m.steel, [0, 0.135, 0.124]);           // nässkydd
    add(new THREE.BoxGeometry(0.036, 0.018, 0.012), m.steel, [0, 0.083, 0.124]);          // utvidgad nedre ände
    add(new THREE.SphereGeometry(0.007, 5, 4), trim, [0, 0.175, 0.132]);
    add(new THREE.CylinderGeometry(0.112, 0.118, 0.02, 18, 1, true), m.strap, [0, 0.168, -0.004]); // läderfoder
  } else if (kind === 12) {
    // Öppet bascinet: spetsig kupa som går ner över kinderna, öppen framtill, brynjekrage (aventail)
    const R = 0.125;
    shell(lathe([[R, 0], [R + 0.002, 0.05], [0.12, 0.11]], 22, 0.95, PI * 2 - 1.9), m.steel, [0, 0.06, -0.004]);
    shell(lathe([[0.12, 0], [0.104, 0.05], [0.07, 0.1], [0.025, 0.14], [0, 0.152]], 22), m.steel, [0, 0.17, -0.004], [1, 1, 1], [-0.06, 0, 0]);
    add(new THREE.TorusGeometry(0.12, 0.006, 4, 24, PI * 2 - 1.9), m.steelDark, [0, 0.172, -0.004], [1, 1, 1], [PI / 2, 0, PI / 2 + 0.95]);
    ring(trim, R + 0.003, 0.068, 16, 1.0, 0.0065);
    add(new THREE.CylinderGeometry(0.127, 0.205, 0.15, 20, 1, true), m.chain, [0, -0.005, -0.004]);   // aventail över axlarna
    add(new THREE.TorusGeometry(0.128, 0.007, 4, 22), m.strap, [0, 0.066, -0.004], [1, 1, 1], [PI / 2, 0, 0]);
    add(new THREE.TorusGeometry(0.205, 0.008, 4, 24), m.chain, [0, -0.08, -0.004], [1, 1, 1], [PI / 2, 0, 0]);
  } else if (kind === 13) {
    // Cervellière: tätt sittande hjässkål, vadderad mössa under och hakrem
    const cap = [[0.12, 0], [0.119, 0.03], [0.106, 0.07], [0.076, 0.106], [0.03, 0.126], [0, 0.13]];
    shell(lathe(cap, 22), m.steel, [0, 0.175, -0.006], [1, 1, 1.04], [-0.06, 0, 0]);
    add(new THREE.TorusGeometry(0.121, 0.0065, 5, 24), m.steel, [0, 0.176, -0.006], [1, 1.04, 1], [PI / 2 - 0.06, 0, 0]);
    add(new THREE.CylinderGeometry(0.116, 0.12, 0.022, 18, 1, true), m.quilt, [0, 0.164, -0.006], [1, 1, 1.04]);
    ring(m.steelDark, 0.121, 0.192, 8, 0, 0.006, 1.04);
    add(new THREE.BoxGeometry(0.008, 0.02, 0.15), m.steel, [0, 0.302, -0.012], [1, 1, 1], [-0.06, 0, 0]); // låg ås
    for (const s of [1, -1]) add(new THREE.BoxGeometry(0.004, 0.11, 0.012), m.strap, [0.113 * s, 0.11, 0.03], [1, 1, 1], [0.15, 0, 0]);
    add(new THREE.TorusGeometry(0.113, 0.006, 3, 14, PI), m.strap, [0, 0.07, 0.04], [1, 0.42, 1], [0.35, 0, PI]);
  } else if (kind === 14) {
    // Fotfolkshjälm: rå kittelhatt i smitt järn med brant brätte, ås och en buckla
    const crown = [[0.123, 0], [0.125, 0.04], [0.115, 0.09], [0.08, 0.14], [0.02, 0.168], [0, 0.17]];
    shell(lathe(crown, 18), m.forged, [0, 0.172, -0.004]);
    const brim = new THREE.CylinderGeometry(0.125, 0.225, 0.06, 20, 2, true);
    const p = brim.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const dent = Math.max(0, 1 - Math.hypot(x - 0.15, z - 0.12) / 0.09); // en buckla i brättet
      p.setY(i, p.getY(i) - dent * 0.025 + Math.sin(Math.atan2(x, z) * 5) * 0.002);
    }
    brim.computeVertexNormals();
    shell(brim, m.forged, [0, 0.148, -0.004]);
    add(new THREE.TorusGeometry(0.225, 0.007, 4, 26), m.iron, [0, 0.118, -0.004], [1, 1, 1], [PI / 2, 0, 0]);
    add(new THREE.BoxGeometry(0.01, 0.028, 0.22), m.forged, [0, 0.33, -0.004]);
    ring(m.iron, 0.126, 0.18, 8, 0, 0.009);
    add(new THREE.CylinderGeometry(0.112, 0.12, 0.024, 16, 1, true), m.strap, [0, 0.163, -0.004]);
  } else if (kind === 15) {
    // Öppen tunnhjälm: platt topp, nitade förstärkningsband och en stor öppning för ansiktet
    const R = 0.124;
    const cyl = (r1, r2, h, y, start = 0, len = PI * 2) =>
      shell(new THREE.CylinderGeometry(r1, r2, h, 22, 1, true, start, len), m.steel, [0, y, -0.004]);
    cyl(R, R, 0.075, 0.205);
    cyl(R, R - 0.003, 0.15, 0.093, 1.0, PI * 2 - 2.0);
    shell(new THREE.SphereGeometry(R, 22, 6, 0, PI * 2, 0, PI / 2), m.steel, [0, 0.242, -0.004], [1, 0.22, 1]);
    add(new THREE.TorusGeometry(R + 0.002, 0.008, 4, 24), m.steelDark, [0, 0.17, -0.004], [1, 1, 1], [PI / 2, 0, 0]);  // pannband
    add(new THREE.TorusGeometry(R + 0.002, 0.006, 4, 24), m.steelDark, [0, 0.242, -0.004], [1, 1, 1], [PI / 2, 0, 0]);
    add(new THREE.BoxGeometry(0.03, 0.08, 0.01), m.steelDark, [0, 0.205, R + 0.0]);                                  // lodrätt band
    add(new THREE.BoxGeometry(0.008, 0.11, 0.01), m.steelDark, [0, 0.11, -R - 0.001]);
    ring(trim, R + 0.004, 0.17, 18, 0, 0.0065);
    for (const s of [1, -1]) {
      for (let i = 0; i < 4; i++) add(new THREE.SphereGeometry(0.0065, 5, 4), trim, [Math.sin(1.0 * s) * (R + 0.003), 0.15 - i * 0.035, Math.cos(1.0) * (R + 0.003) - 0.004]);
      for (let i = 0; i < 3; i++) add(new THREE.SphereGeometry(0.0045, 4, 3), m.hole, [Math.sin(1.4 * s) * (R + 0.001), 0.09 - i * 0.02, Math.cos(1.4) * (R + 0.001)]); // andningshål på kinden
    }
  } else if (kind === 16) {
    // Krigarduk: ett långt tygstycke lindat runt huvudet, knutet i nacken med hängande ändar
    const linen = k.mat(0xd6cab0, 0.95, 0, { map: wrapTexture() });
    for (const [y, r, tilt, mat] of [[0.19, 0.122, 0.12, linen], [0.218, 0.116, -0.1, m.cloth], [0.243, 0.1, 0.14, linen]]) {
      add(new THREE.TorusGeometry(r, 0.022, 7, 22), mat, [0, y, -0.006], [1, 1.04, 1], [PI / 2 + tilt, 0, tilt * 0.6]);
    }
    add(new THREE.SphereGeometry(0.104, 16, 8, 0, PI * 2, 0, PI / 2), linen, [0, 0.235, -0.008], [1, 0.52, 1.04]);
    add(new THREE.SphereGeometry(0.03, 8, 6), linen, [0.035, 0.205, -0.125], [1.2, 1, 0.8]);
    add(new THREE.BoxGeometry(0.038, 0.17, 0.008), linen, [0.02, 0.12, -0.135], [1, 1, 1], [0.12, 0, 0.12]);
    add(new THREE.BoxGeometry(0.032, 0.13, 0.008), m.cloth, [0.055, 0.14, -0.13], [1, 1, 1], [0.1, 0, -0.18]);
  } else if (kind === 17) {
    // Huva med läderhätta: yllehuva i spelarens färg (öppen för ansiktet) med axelkrage och lång svans,
    // en läderhätta med sömmar ovanpå
    const wool = k.mat(col(k.colorHexFor ?? 0x806040, 0x5a4632, 0.35), 0.95, 0, { map: wrapTexture(), side: THREE.DoubleSide });
    const geo = new THREE.SphereGeometry(1, 18, 12);
    const pos = geo.attributes.position;
    const dirs = [];
    const d = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      d.fromBufferAttribute(pos, i);
      dirs.push(d.clone());
      pos.setXYZ(i, d.x * 0.118, d.y * 0.126 + 0.135, d.z * 0.124 + 0.002);
    }
    const open = (v) => v.z > 0.42 && v.y > -0.62 && v.y < 0.48;
    const ind = geo.index?.array || [];
    const idx = [];
    for (let t = 0; t < ind.length; t += 3) {
      if (open(dirs[ind[t]]) || open(dirs[ind[t + 1]]) || open(dirs[ind[t + 2]])) continue;
      if (dirs[ind[t]].y < -0.85 && dirs[ind[t + 1]].y < -0.85 && dirs[ind[t + 2]].y < -0.85) continue;
      idx.push(ind[t], ind[t + 1], ind[t + 2]);
    }
    if (ind.length) geo.setIndex(idx);
    geo.computeVertexNormals();
    add(geo, wool);
    add(new THREE.CylinderGeometry(0.09, 0.23, 0.15, 18, 1, true), wool, [0, -0.02, -0.004]);           // axelkrage
    add(new THREE.TorusGeometry(0.23, 0.01, 4, 24), wool, [0, -0.095, -0.004], [1, 1, 1], [PI / 2, 0, 0]);
    const tail = new THREE.ConeGeometry(0.03, 0.34, 8);
    add(tail, wool, [0, 0.05, -0.16], [1, 1, 0.7], [PI + 0.25, 0, 0]);                                         // svansen (liripipe)
    add(new THREE.SphereGeometry(1, 16, 8, 0, PI * 2, 0, PI / 2), m.leatherDark, [0, 0.172, -0.004], [0.124, 0.104, 0.13]);
    add(new THREE.TorusGeometry(0.125, 0.008, 4, 24), m.leather, [0, 0.174, -0.004], [1, 1.04, 1], [PI / 2, 0, 0]);
    for (const a of [0, PI / 2]) add(new THREE.TorusGeometry(0.1, 0.0035, 3, 18, PI), m.strap, [0, 0.174, -0.004], [a ? 1.31 : 1.255, 1.05, 1], [0, a, 0]); // sömmar över hättan
    ring(m.brass, 0.126, 0.19, 6, 0, 0.0065);
  } else if (kind === 18) {
    // Bucklig hjälm: en gammal tunnhjälm som fått ta emot många slag – bucklor, en lagning och sned
    const R = 0.122;
    const worn = k.mat(0x9a9890, 0.6, 0.62, { map: plateTexture(), bumpMap: forgedTexture(), bumpScale: 2 });
    const cyl = (r1, r2, h, y, start = 0, len = PI * 2) =>
      shell(new THREE.CylinderGeometry(r1, r2, h, 22, 2, true, start, len), worn, [0, y, 0]);
    cyl(R, R - 0.004, 0.112, 0.076);
    cyl(R, R, 0.03, 0.147, 0.6, PI * 2 - 1.2);
    cyl(R, R, 0.068, 0.196);
    shell(new THREE.SphereGeometry(R, 22, 8, 0, PI * 2, 0, PI / 2), worn, [0, 0.23, 0], [1, 0.75, 1]);
    add(new THREE.BoxGeometry(0.024, 0.19, 0.012), m.iron, [0, 0.125, R + 0.004]);
    add(new THREE.BoxGeometry(0.22, 0.016, 0.012), m.iron, [0, 0.172, R - 0.002]);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) add(new THREE.SphereGeometry(0.0055, 4, 3), m.hole, [0.03 + c * 0.016, 0.1 - r * 0.018, R - 0.004 - c * 0.0035]);
    // Lagning: en nitad järnbit över ett hål på sidan
    add(new THREE.BoxGeometry(0.05, 0.045, 0.006), m.forged, [-0.085, 0.09, 0.085], [1, 1, 1], [0, -0.78, 0.1]);
    for (const [dx, dy] of [[-0.018, 0.016], [0.018, 0.016], [-0.018, -0.016], [0.018, -0.016]]) {
      add(new THREE.SphereGeometry(0.0055, 4, 3), m.iron, [-0.085 + dx * 0.7, 0.09 + dy, 0.085 + dx * 0.7 + 0.004]);
    }
    // Bucklor: punkterna runt några ställen trycks in mot hjälmens mitt
    const dents = [
      { c: new THREE.Vector3(0.09, 0.23, 0.07), r: 0.07, d: 0.032 },
      { c: new THREE.Vector3(-0.06, 0.05, 0.11), r: 0.05, d: 0.022 },
      { c: new THREE.Vector3(-0.115, 0.2, -0.03), r: 0.07, d: 0.03 },
      { c: new THREE.Vector3(0.03, 0.27, -0.06), r: 0.06, d: 0.026 },
      { c: new THREE.Vector3(0.1, 0.08, -0.07), r: 0.05, d: 0.02 },
    ];
    const tilt = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.04, 0.08, 0.1));
    const v = new THREE.Vector3();
    for (const mesh of [...helmet.children]) {
      mesh.updateMatrix();
      const g = mesh.geometry;
      g.applyMatrix4(mesh.matrix);
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.set(1, 1, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        for (const dent of dents) {
          const dist = v.distanceTo(dent.c);
          if (dist >= dent.r) continue;
          const f = (1 - dist / dent.r) ** 2;
          const len = Math.hypot(v.x, v.z) || 1;
          v.x -= (v.x / len) * dent.d * f;
          v.z -= (v.z / len) * dent.d * f;
          v.y -= dent.d * f * 0.3 * Math.sign(v.y - 0.15);
        }
        v.y -= 0.13;
        v.applyMatrix4(tilt);
        v.y += 0.13;
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
    }
  }
}
