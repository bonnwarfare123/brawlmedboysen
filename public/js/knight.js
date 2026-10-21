// RIDDAREN – byggd av rundade former med riktiga leder.
// Riddaren tittar mot +Z. Origo (0,0,0) är mellan fötterna. Längd ca 1,8 m.
//
// Kroppen består av 15 delar som sitter ihop i leder:
//
//   pelvis (höfter)
//    ├ torso (bål)            ← midja
//    │  ├ head (huvud)        ← hals
//    │  ├ upperArmL/R         ← axel
//    │  │  └ forearmL/R       ← armbåge
//    │  │     └ handL/R       ← handled   (sköld i vänster, svärd i höger)
//    ├ thighL/R (lår)         ← höft
//    │  └ shinL/R (underben)  ← knä
//    │     └ footL/R (fot)    ← fotled
//
// Varje led kan huggas av. Då blir delen (och allt som sitter längre ut)
// en egen ragdoll som flyger iväg.

import * as THREE from "three";
import { COMBAT, JOINT_SEGMENT, LEG_JOINTS } from "./shared.js";
import { Ragdoll } from "./ragdoll.js";

const METAL = 0x9aa1aa;
const METAL_DARK = 0x60666f;
const LEATHER = 0x5a3c24;
const VISOR = 0x15151a;
const BLOOD = 0x7a0a0a;

// Rörelsekurvor: [tid, överarm framåt, överarm i sidled, underarm böj, bålens vridning]
const REST_R = [-0.3, 0, -0.9, 0];
const QUICK_KEYS = [
  [0.0, -0.3, 0.0, -0.9, 0.0],
  [0.12, -2.4, -0.4, -1.0, -0.4],
  [0.3, -0.6, 0.3, -0.2, 0.4],
  [0.5, -0.3, 0.0, -0.9, 0.0],
];
const HEAVY_KEYS = [
  [0.0, -2.9, 0.0, -0.6, -0.3],
  [0.15, -3.0, 0.0, -0.7, -0.35],
  [0.32, -0.5, 0.0, -0.1, 0.3],
  [0.7, -0.3, 0.0, -0.9, 0.0],
];
const CHARGE_POSE = [-2.9, 0, -0.6, -0.3];
// Sköldarmen: [tid, överarm framåt, överarm i sidled, underarm böj]
const REST_L = [-0.2, 0, -1.4];
const PARRY_KEYS = [
  [0.0, -0.2, 0.0, -1.4],
  [0.07, -0.9, -0.3, -1.2],
  [0.3, -0.9, -0.3, -1.2],
  [0.45, -0.2, 0.0, -1.4],
];

function sampleKeys(keys, t) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1];
      const b = keys[i];
      let k = (t - a[0]) / (b[0] - a[0]);
      k = k * k * (3 - 2 * k); // mjuk övergång
      return a.slice(1).map((v, j) => v + (b[j + 1] - v) * k);
    }
  }
  return keys[keys.length - 1].slice(1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class Knight {
  constructor(colorHex, name = null) {
    this.group = new THREE.Group();
    this.materials = [];
    this.seg = {};
    this.stumps = [];
    this.legLoss = 0;

    this.phase = 0;
    this.amp = 0;
    this.attack = null;
    this.charging = false;
    this.chargeAmount = 0;
    this.parryT = -1;
    this.staggerT = -1;
    this.flashT = 0;

    const m = {
      metal: this.mat(METAL, 0.45, 0.35),
      dark: this.mat(METAL_DARK, 0.5, 0.3),
      leather: this.mat(LEATHER, 0.85, 0),
      cloth: this.mat(colorHex, 0.8, 0),
      visor: this.mat(VISOR, 0.6, 0.2),
      white: this.mat(0xf2efe6, 0.8, 0),
      blade: this.mat(0xd3d8de, 0.3, 0.6),
      blood: this.mat(BLOOD, 0.5, 0),
    };
    m.cloth.side = THREE.DoubleSide; // kjolen är öppen nedtill
    this.m = m;

    // ---------- Kroppsdelarna ----------
    // segment(namn, förälder, ledens position i förälderns koordinater, punkter för fysiken, radie)

    const pelvis = this.segment("pelvis", this.group, [0, 1.0, 0],
      [[0, 0, 0], [0.1, -0.08, 0], [-0.1, -0.08, 0]], 0.1);
    pelvis.add(this.shape(new THREE.SphereGeometry(1, 14, 10), m.dark, [0, -0.04, 0], [0.16, 0.11, 0.12]));
    pelvis.add(this.shape(new THREE.CylinderGeometry(0.155, 0.2, 0.32, 14, 1, true), m.cloth, [0, -0.15, 0], [1, 1, 0.75])); // vapenrockens kjol
    pelvis.add(this.shape(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 14), m.leather, [0, 0.0, 0], [1, 1, 0.8]));        // bälte

    const torso = this.segment("torso", pelvis, [0, 0, 0],
      [[0, 0, 0], [0, 0.44, 0], [0.19, 0.4, 0], [-0.19, 0.4, 0], [0, 0.25, 0.12]], 0.13);
    torso.add(this.shape(new THREE.CapsuleGeometry(0.15, 0.2, 6, 14), m.cloth, [0, 0.24, 0], [1.25, 1, 0.78]));  // bröst med vapenrock
    torso.add(this.shape(new THREE.CylinderGeometry(0.09, 0.11, 0.08, 12), m.metal, [0, 0.44, 0]));              // halsskydd
    torso.add(this.shape(new THREE.BoxGeometry(0.05, 0.22, 0.01), m.white, [0, 0.26, 0.122]));                  // kors på bröstet
    torso.add(this.shape(new THREE.BoxGeometry(0.16, 0.05, 0.01), m.white, [0, 0.3, 0.12]));

    const head = this.segment("head", torso, [0, 0.46, 0],
      [[0, 0, 0], [0, 0.28, 0], [0, 0.12, 0.12]], 0.12);
    head.add(this.shape(new THREE.CylinderGeometry(0.115, 0.11, 0.2, 16), m.metal, [0, 0.13, 0]));                     // hjälm
    head.add(this.shape(new THREE.SphereGeometry(0.115, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.metal, [0, 0.23, 0])); // hjälmens topp
    head.add(this.shape(new THREE.BoxGeometry(0.16, 0.025, 0.02), m.visor, [0, 0.16, 0.108]));                          // ögonspringa
    head.add(this.shape(new THREE.BoxGeometry(0.012, 0.08, 0.02), m.visor, [0, 0.1, 0.112]));                           // andningsspringa
    head.add(this.shape(new THREE.BoxGeometry(0.035, 0.07, 0.22), m.cloth, [0, 0.36, -0.01]));                          // hjälmkam

    for (const side of ["L", "R"]) {
      const s = side === "L" ? 1 : -1;
      // Arm
      const upper = this.segment("upperArm" + side, torso, [0.2 * s, 0.41, 0],
        [[0, 0, 0], [0, -0.29, 0], [0.05 * s, -0.14, 0]], 0.055);
      upper.add(this.limbShape(0.056, 0.29, m.metal));
      upper.add(this.shape(new THREE.SphereGeometry(0.085, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.dark, [0.01 * s, -0.01, 0], [1.05, 0.85, 1.15])); // axelskydd

      const fore = this.segment("forearm" + side, upper, [0, -0.29, 0],
        [[0, 0, 0], [0, -0.26, 0], [0.05 * s, -0.13, 0]], 0.05);
      fore.add(this.limbShape(0.05, 0.26, m.metal));
      fore.add(this.shape(new THREE.SphereGeometry(0.058, 12, 8), m.dark, [0, 0, 0.01]));                     // armbågsskydd
      fore.add(this.shape(new THREE.CylinderGeometry(0.06, 0.052, 0.08, 12), m.dark, [0, -0.21, 0]));         // handskens krage

      const hand = this.segment("hand" + side, fore, [0, -0.26, 0],
        [[0, 0, 0], [0, -0.1, 0], [0.04 * s, -0.05, 0]], 0.045);
      hand.add(this.shape(new THREE.SphereGeometry(1, 12, 8), m.dark, [0, -0.05, 0.005], [0.045, 0.058, 0.05]));

      // Ben
      const thigh = this.segment("thigh" + side, pelvis, [0.1 * s, -0.08, 0],
        [[0, 0, 0], [0, -0.42, 0], [0.06 * s, -0.21, 0]], 0.075);
      thigh.add(this.limbShape(0.076, 0.42, m.metal));

      const shin = this.segment("shin" + side, thigh, [0, -0.42, 0],
        [[0, 0, 0], [0, -0.4, 0], [0.05 * s, -0.2, 0]], 0.06);
      shin.add(this.limbShape(0.06, 0.4, m.metal));
      shin.add(this.shape(new THREE.SphereGeometry(0.07, 12, 8), m.dark, [0, 0, 0.025], [1, 1, 1.15]));       // knäskydd

      const foot = this.segment("foot" + side, shin, [0, -0.4, 0],
        [[0, 0, 0], [0, -0.06, 0.18], [0.05 * s, -0.06, 0]], 0.05);
      const sabaton = this.shape(new THREE.CapsuleGeometry(0.045, 0.15, 4, 10), m.dark, [0, -0.055, 0.05], [1.1, 1, 1]);
      sabaton.rotation.x = Math.PI / 2;
      foot.add(sabaton);
    }

    // Svärd i höger hand (klingan längs +Y, vinklad så den pekar framåt-uppåt i vila)
    const sword = new THREE.Group();
    sword.add(this.shape(new THREE.BoxGeometry(0.05, 0.85, 0.012), m.blade, [0, 0.52, 0]));   // klinga
    sword.add(this.shape(new THREE.ConeGeometry(0.025, 0.08, 4), m.blade, [0, 0.985, 0], [1, 1, 0.25])); // spets
    sword.add(this.shape(new THREE.BoxGeometry(0.24, 0.035, 0.045), m.dark, [0, 0.085, 0]));  // parerstång
    sword.add(this.shape(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 8), m.leather, [0, 0, 0])); // fäste
    sword.add(this.shape(new THREE.SphereGeometry(0.03, 8, 6), m.dark, [0, -0.08, 0]));       // knapp
    sword.position.set(0, -0.06, 0.01);
    sword.rotation.x = 2.0;
    sword.userData.equipment = true; // siktet ska inte räkna svärdet som kroppsdel
    this.seg.handR.add(sword);

    // Sköld i vänster hand (vänd framåt i vila)
    const shield = new THREE.Group();
    const shieldGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.04, 20);
    shieldGeo.rotateX(Math.PI / 2);
    shield.add(this.shape(shieldGeo, m.cloth));
    shield.add(this.shape(new THREE.TorusGeometry(0.3, 0.018, 6, 24), m.dark));               // kant
    shield.add(this.shape(new THREE.BoxGeometry(0.07, 0.4, 0.01), m.white, [0, 0, 0.025]));   // kors
    shield.add(this.shape(new THREE.BoxGeometry(0.3, 0.07, 0.01), m.white, [0, 0.04, 0.025]));
    shield.add(this.shape(new THREE.SphereGeometry(0.05, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.dark, [0, 0, 0.02], [1, 1, 1], [Math.PI / 2, 0, 0])); // buckla
    shield.position.set(0.03, -0.08, 0);
    shield.rotation.x = 1.6;
    shield.userData.equipment = true;
    this.seg.handL.add(shield);

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

  // ---------- Byggverktyg ----------

  mat(color, roughness, metalness) {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    m.emissive = new THREE.Color(0xaa1010);
    m.emissiveIntensity = 0;
    this.materials.push(m);
    return m;
  }

  shape(geometry, material, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    return mesh;
  }

  // En rundad arm- eller bendel som hänger nedåt från leden
  limbShape(radius, length, material) {
    return this.shape(new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius), 4, 12), material, [0, -length / 2, 0]);
  }

  segment(name, parent, pivot, points, radius) {
    const g = new THREE.Group();
    g.position.set(pivot[0], pivot[1], pivot[2]);
    g.userData = { segment: name, points, radius, detached: false };
    parent.add(g);
    this.seg[name] = g;
    return g;
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
    this.label = new THREE.Sprite(material);
    this.label.scale.set(2.4, 0.6, 1);
    this.label.position.y = 2.3;
    this.group.add(this.label);
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

  chestPosition(target) {
    this.group.updateMatrixWorld(true);
    return target.set(0, 0.25, 0).applyMatrix4(this.seg.torso.matrixWorld);
  }

  // ---------- Hugga av och ragdoll ----------

  // Alla anslutna kroppsdelar från och med "root" och utåt
  subtree(root) {
    const list = [];
    root.traverse((obj) => {
      if (obj.userData && obj.userData.segment && !obj.userData.detached) list.push(obj);
    });
    return list;
  }

  makeRagdoll(segments, velocity, scene, bounds, spinAmount) {
    this.group.updateMatrixWorld(true);
    const tmp = new THREE.Vector3();
    const bodies = segments.map((s) => {
      const world = s.userData.points.map((p) => tmp.set(p[0], p[1], p[2]).applyMatrix4(s.matrixWorld).toArray());
      const jitter = () => (Math.random() - 0.5) * 1.5;
      return {
        object: s,
        local: s.userData.points,
        world,
        radius: s.userData.radius,
        velocity: [velocity[0] + jitter(), velocity[1] + jitter() * 0.5, velocity[2] + jitter()],
        spin: [jitter() * spinAmount, jitter() * spinAmount, jitter() * spinAmount],
      };
    });
    for (const s of segments) {
      s.userData.detached = true;
      scene.attach(s); // behåll positionen i världen men lossa från kroppen
      // Lösa delar får egna material, så de inte blinkar rött när riddaren träffas
      s.children.forEach((child) => {
        child.traverse((obj) => {
          if (obj.isMesh && !obj.userData?.segment) obj.material = this.calmMaterial(obj.material);
        });
      });
    }
    return new Ragdoll(bodies, bounds);
  }

  calmMaterial(material) {
    if (!this.calm) this.calm = new Map();
    if ([...this.calm.values()].includes(material)) return material; // redan lugn
    if (!this.calm.has(material)) {
      const copy = material.clone();
      copy.emissiveIntensity = 0;
      this.calm.set(material, copy);
    }
    return this.calm.get(material);
  }

  // Hugg av en led. Returnerar en ragdoll för den avhuggna delen (eller null).
  sever(joint, velocity, scene, bounds) {
    const segName = JOINT_SEGMENT[joint];
    const seg = segName && this.seg[segName];
    if (!seg || seg.userData.detached) return null;

    // Blodig stump på kroppen och på den lösa delen
    const parent = seg.parent;
    const stump = this.shape(new THREE.SphereGeometry(0.055, 10, 8), this.m.blood, seg.position.toArray());
    parent.add(stump);
    seg.add(this.shape(new THREE.SphereGeometry(0.05, 10, 8), this.m.blood));
    this.stumps.push({ object: parent, local: seg.position.clone(), time: 0 });
    if (LEG_JOINTS.includes(joint)) this.legLoss += 1;

    return this.makeRagdoll(this.subtree(seg), velocity, scene, bounds, 6);
  }

  // Hela riddaren blir en ragdoll (vid död). Riddaren själv ska inte användas efter detta.
  die(velocity, scene, bounds) {
    if (this.label) this.label.removeFromParent();
    const ragdoll = this.makeRagdoll(this.subtree(this.seg.pelvis), velocity, scene, bounds, 2);
    this.group.removeFromParent();
    return ragdoll;
  }

  // Var blöder stumparna? Anropar callback(position) för varje färsk stump.
  forEachBleedingStump(dt, callback) {
    const tmp = new THREE.Vector3();
    for (const s of this.stumps) {
      s.time += dt;
      if (s.time < 3) callback(tmp.copy(s.local).applyMatrix4(s.object.matrixWorld), s.time);
    }
  }

  // ---------- Animation varje bildruta ----------
  // anim: 0 = står still, 1 = går, 2 = springer

  rot(name, x, y = null, z = null) {
    const s = this.seg[name];
    if (!s || s.userData.detached) return;
    s.rotation.x = x;
    if (y !== null) s.rotation.y = y;
    if (z !== null) s.rotation.z = z;
  }

  animate(dt, anim) {
    // Gång: lår svänger, knän böjs bakåt
    const targetAmp = anim === 2 ? 0.85 : anim === 1 ? 0.55 : 0;
    this.amp += (targetAmp - this.amp) * Math.min(1, dt * 10);
    if (anim > 0) this.phase += dt * (anim === 2 ? 11 : 8);
    const swing = Math.sin(this.phase) * this.amp;

    this.rot("thighL", swing * 0.8 - 0.05);
    this.rot("thighR", -swing * 0.8 - 0.05);
    const kneeL = Math.max(0, swing) * 1.2 + 0.1;
    const kneeR = Math.max(0, -swing) * 1.2 + 0.1;
    this.rot("shinL", kneeL);
    this.rot("shinR", kneeR);
    this.rot("footL", -kneeL * 0.4 - 0.05);
    this.rot("footR", -kneeR * 0.4 - 0.05);
    if (!this.seg.pelvis.userData.detached) {
      this.seg.pelvis.position.y = 1.0 + Math.abs(Math.sin(this.phase)) * 0.04 * this.amp - 0.02 * Math.min(1, this.amp * 2);
    }

    // Svärdsarmen: vila, laddning eller slag
    let pose = [REST_R[0] + swing * 0.3, REST_R[1], REST_R[2], REST_R[3]];
    this.chargeAmount += ((this.charging ? 1 : 0) - this.chargeAmount) * Math.min(1, dt * 8);
    pose = pose.map((v, i) => lerp(v, CHARGE_POSE[i], this.chargeAmount));
    if (this.attack) {
      this.attack.t += dt;
      const keys = this.attack.kind === "h" ? HEAVY_KEYS : QUICK_KEYS;
      if (this.attack.t >= keys[keys.length - 1][0]) this.attack = null;
      else pose = sampleKeys(keys, this.attack.t);
    }
    this.rot("upperArmR", pose[0], 0, pose[1]);
    this.rot("forearmR", pose[2]);

    // Sköldarmen: vila eller parering
    let shield = [REST_L[0] - swing * 0.15, REST_L[1], REST_L[2]];
    if (this.parryT >= 0) {
      this.parryT += dt;
      if (this.parryT >= PARRY_KEYS[PARRY_KEYS.length - 1][0]) this.parryT = -1;
      else shield = sampleKeys(PARRY_KEYS, this.parryT);
    }
    this.rot("upperArmL", shield[0], 0, shield[1]);
    this.rot("forearmL", shield[2]);

    // Bålen: vridning vid slag, lutar bakåt när man vacklar
    let lean = 0;
    if (this.staggerT >= 0) {
      this.staggerT += dt;
      const d = COMBAT.parry.stagger;
      if (this.staggerT >= d) this.staggerT = -1;
      else lean = -0.35 * Math.sin((this.staggerT / d) * Math.PI);
    }
    this.rot("torso", lean, pose[3], 0);

    // Röd blinkning vid träff
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    const glow = this.flashT / 0.2;
    for (const mat of this.materials) {
      if (mat.emissive) mat.emissiveIntensity = glow;
    }
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj.isMesh && obj.geometry) obj.geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
    if (this.labelTexture) this.labelTexture.dispose();
    this.group.removeFromParent();
  }
}
