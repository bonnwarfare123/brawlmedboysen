// RIDDAREN – byggd av enkla former tills vi byter till en riktig 3D-modell.
// Riddaren tittar mot +Z. Origo (0,0,0) är mellan fötterna.
//
// Uppbyggnad:  group (position + vridning)
//                └ pose (lutning när man faller)
//                    ├ ben
//                    └ upper (överkropp, armar, hjälm)

import * as THREE from "three";
import { COMBAT } from "./shared.js";

const METAL = 0x8d939b;
const METAL_DARK = 0x5d636b;
const LEATHER = 0x5a3c24;
const VISOR = 0x1c1c1e;

// Rörelsekurvor för slagen: [tid, armens vinkel framåt, armens vinkel i sidled, överkroppens vridning]
const QUICK_KEYS = [
  [0.0, -0.5, 0.0, 0.0],
  [0.12, -2.3, -0.5, -0.4],
  [0.3, -0.1, 0.3, 0.35],
  [0.5, -0.5, 0.0, 0.0],
];
const HEAVY_KEYS = [
  [0.0, -2.9, 0.0, -0.3],
  [0.15, -3.0, 0.0, -0.35],
  [0.32, 0.15, 0.0, 0.3],
  [0.7, -0.5, 0.0, 0.0],
];
const PARRY_KEYS = [
  [0.0, -0.9, 0.0],
  [0.07, -1.75, -0.4],
  [0.3, -1.75, -0.4],
  [0.45, -0.9, 0.0],
];

function sampleKeys(keys, t) {
  if (t <= keys[0][0]) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1];
      const b = keys[i];
      let k = (t - a[0]) / (b[0] - a[0]);
      k = k * k * (3 - 2 * k); // mjuk övergång
      return a.map((v, j) => v + (b[j] - v) * k);
    }
  }
  return keys[keys.length - 1];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class Knight {
  constructor(colorHex, name = null) {
    this.group = new THREE.Group();
    this.pose = new THREE.Group();
    this.group.add(this.pose);

    this.phase = 0;
    this.amp = 0;
    this.materials = [];
    this.geometries = [];

    // Stridstillstånd (bara utseende – servern bestämmer vad som händer)
    this.attack = null;   // { kind, t }
    this.charging = false;
    this.chargeAmount = 0;
    this.parryT = -1;
    this.staggerT = -1;
    this.dead = false;
    this.fall = 0;
    this.flashT = 0;

    const metal = this.mat(METAL);
    const metalDark = this.mat(METAL_DARK);
    const leather = this.mat(LEATHER);
    const cloth = this.mat(colorHex);
    const visor = this.mat(VISOR);
    const white = this.mat(0xf2efe6);

    // Ben (vrids vid höften)
    this.legL = this.limb(0.13, 0.85, 0.2, 0.85, metal, leather);
    this.legR = this.limb(-0.13, 0.85, 0.2, 0.85, metal, leather);
    this.pose.add(this.legL, this.legR);

    // Överkropp
    this.upper = new THREE.Group();
    this.pose.add(this.upper);

    this.upper.add(this.box(0.5, 0.6, 0.3, metal, 0, 1.2, 0));        // bröst
    this.upper.add(this.box(0.55, 0.72, 0.34, cloth, 0, 1.08, 0));    // vapenrock
    this.upper.add(this.box(0.57, 0.07, 0.36, leather, 0, 0.92, 0));  // bälte

    // Hjälm
    this.upper.add(this.cylinder(0.18, 0.18, 0.32, 10, metal, 0, 1.66, 0));
    this.upper.add(this.box(0.24, 0.04, 0.03, visor, 0, 1.7, 0.175)); // ögonspringa
    this.upper.add(this.box(0.05, 0.1, 0.32, cloth, 0, 1.86, 0));     // hjälmkam i spelarens färg

    // Axelskydd
    this.upper.add(this.box(0.2, 0.12, 0.24, metalDark, 0.34, 1.46, 0));
    this.upper.add(this.box(0.2, 0.12, 0.24, metalDark, -0.34, 1.46, 0));

    // Höger arm med svärd
    this.armR = this.limb(-0.34, 1.42, 0.15, 0.6, metal, metalDark);
    const sword = new THREE.Group();
    sword.add(this.box(0.06, 0.9, 0.02, this.mat(0xc9ced4), 0, 0.55, 0)); // klinga
    sword.add(this.box(0.26, 0.04, 0.05, metalDark, 0, 0.09, 0));        // parerstång
    sword.add(this.box(0.04, 0.16, 0.04, leather, 0, 0, 0));             // fäste
    sword.position.set(0, -0.6, 0);
    sword.rotation.x = 1.3;
    this.armR.add(sword);
    this.upper.add(this.armR);

    // Vänster arm med sköld
    this.armL = this.limb(0.34, 1.42, 0.15, 0.6, metal, metalDark);
    const shield = new THREE.Group();
    shield.add(this.cylinder(0.34, 0.34, 0.05, 12, cloth, 0, 0, 0, Math.PI / 2));
    shield.add(this.box(0.08, 0.42, 0.02, white, 0, 0, 0.035));
    shield.add(this.box(0.32, 0.08, 0.02, white, 0, 0.04, 0.035));
    shield.position.set(0.04, -0.5, 0.12);
    shield.rotation.x = 0.9;
    this.armL.add(shield);
    this.upper.add(this.armL);

    this.group.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    this.name = name;
    this.colorHex = colorHex;
    if (name) this.createLabel();
  }

  mat(color) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.1, flatShading: true });
    m.emissive = new THREE.Color(0xaa1010);
    m.emissiveIntensity = 0;
    this.materials.push(m);
    return m;
  }

  box(w, h, d, material, x, y, z) {
    const g = new THREE.BoxGeometry(w, h, d);
    this.geometries.push(g);
    const m = new THREE.Mesh(g, material);
    m.position.set(x, y, z);
    return m;
  }

  cylinder(rTop, rBottom, h, segments, material, x, y, z, rotX = 0) {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, segments);
    this.geometries.push(g);
    const m = new THREE.Mesh(g, material);
    m.position.set(x, y, z);
    m.rotation.x = rotX;
    return m;
  }

  // En arm eller ett ben: ledpunkt överst, hänger nedåt
  limb(x, y, thickness, length, material, endMaterial) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    pivot.add(this.box(thickness, length, thickness, material, 0, -length / 2, 0));
    pivot.add(this.box(thickness + 0.03, 0.12, thickness + 0.06, endMaterial, 0, -length + 0.06, 0.02));
    return pivot;
  }

  // ---------- Namnskylt med livmätare ----------

  createLabel() {
    this.labelCanvas = document.createElement("canvas");
    this.labelCanvas.width = 512;
    this.labelCanvas.height = 128;
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTexture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: this.labelTexture, depthWrite: false });
    this.materials.push(material);
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.4, 0.6, 1);
    sprite.position.y = 2.35;
    this.group.add(sprite);
    this.setHp(COMBAT.maxHp);
  }

  setHp(hp) {
    if (!this.labelCanvas) return;
    const ctx = this.labelCanvas.getContext("2d");
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = "bold 44px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(20, 14, 8, 0.85)";
    ctx.strokeText(this.name, 256, 42);
    ctx.fillStyle = "#" + new THREE.Color(this.colorHex).lerp(new THREE.Color(0xffffff), 0.55).getHexString();
    ctx.fillText(this.name, 256, 42);

    // Livmätare
    const w = 260;
    const x = 256 - w / 2;
    ctx.fillStyle = "rgba(20, 14, 8, 0.8)";
    ctx.fillRect(x - 4, 88, w + 8, 26);
    ctx.fillStyle = "#4a1410";
    ctx.fillRect(x, 92, w, 18);
    ctx.fillStyle = hp > 50 ? "#4caf50" : hp > 25 ? "#e0a020" : "#d0302a";
    ctx.fillRect(x, 92, (w * Math.max(0, hp)) / COMBAT.maxHp, 18);
    this.labelTexture.needsUpdate = true;
  }

  // ---------- Stridshändelser (anropas från spelet) ----------

  playAttack(kind) {
    this.attack = { kind, t: 0 };
    this.charging = false;
  }

  setCharging(on) {
    this.charging = on;
  }

  playParry() {
    this.parryT = 0;
  }

  playStagger() {
    this.staggerT = 0;
    this.attack = null;
    this.charging = false;
  }

  flash() {
    this.flashT = 0.2;
  }

  setDead(dead) {
    this.dead = dead;
    if (dead) {
      this.attack = null;
      this.charging = false;
    } else {
      this.fall = 0;
    }
  }

  // Ungefärlig position för svärdsspetsen/kroppen, för effekter
  chestPosition(target) {
    return target.set(0, 1.2, 0).applyMatrix4(this.group.matrixWorld);
  }

  // ---------- Animation varje bildruta ----------
  // anim: 0 = står still, 1 = går, 2 = springer

  animate(dt, anim) {
    // Gång
    const targetAmp = this.dead ? 0 : anim === 2 ? 0.85 : anim === 1 ? 0.55 : 0;
    this.amp += (targetAmp - this.amp) * Math.min(1, dt * 10);
    if (anim > 0 && !this.dead) this.phase += dt * (anim === 2 ? 11 : 8);
    const swing = Math.sin(this.phase) * this.amp;

    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.upper.position.y = Math.abs(Math.sin(this.phase)) * 0.06 * this.amp;

    // Svärdsarmen: vila, laddning eller slag
    let armX = -0.5 + swing * 0.4;
    let armZ = 0;
    let twist = 0;

    this.chargeAmount += ((this.charging ? 1 : 0) - this.chargeAmount) * Math.min(1, dt * 8);
    armX = lerp(armX, -2.9, this.chargeAmount);
    twist = lerp(twist, -0.3, this.chargeAmount);

    if (this.attack) {
      this.attack.t += dt;
      const keys = this.attack.kind === "h" ? HEAVY_KEYS : QUICK_KEYS;
      if (this.attack.t >= keys[keys.length - 1][0]) {
        this.attack = null;
      } else {
        [, armX, armZ, twist] = sampleKeys(keys, this.attack.t);
      }
    }
    this.armR.rotation.x = armX;
    this.armR.rotation.z = armZ;
    this.upper.rotation.y = twist;

    // Sköldarmen: vila eller parering
    let shieldX = -0.9 - swing * 0.15;
    let shieldZ = 0;
    if (this.parryT >= 0) {
      this.parryT += dt;
      if (this.parryT >= PARRY_KEYS[PARRY_KEYS.length - 1][0]) {
        this.parryT = -1;
      } else {
        [, shieldX, shieldZ] = sampleKeys(PARRY_KEYS, this.parryT);
      }
    }
    this.armL.rotation.x = shieldX;
    this.armL.rotation.z = shieldZ;

    // Vacklar bakåt efter att ha blivit parerad
    let lean = 0;
    if (this.staggerT >= 0) {
      this.staggerT += dt;
      const d = COMBAT.parry.stagger;
      if (this.staggerT >= d) {
        this.staggerT = -1;
      } else {
        lean = -0.35 * Math.sin((this.staggerT / d) * Math.PI);
      }
    }
    this.upper.rotation.x = lean;

    // Faller omkull när man dör (riktig ragdoll kommer i v0.4)
    const fallTarget = this.dead ? 1 : 0;
    this.fall += (fallTarget - this.fall) * Math.min(1, dt * 6);
    this.pose.rotation.x = -Math.PI / 2 * this.fall;
    this.pose.position.y = 0.15 * this.fall;

    // Röd blinkning vid träff
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    const glow = this.flashT / 0.2;
    for (const m of this.materials) {
      if (m.emissive) m.emissiveIntensity = glow;
    }
  }

  dispose() {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    if (this.labelTexture) this.labelTexture.dispose();
    this.group.removeFromParent();
  }
}
