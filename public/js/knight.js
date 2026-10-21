// RIDDAREN – byggd av enkla former tills vi byter till en riktig 3D-modell (v0.5).
// Riddaren tittar mot +Z. Origo (0,0,0) är mellan fötterna.

import * as THREE from "three";

const METAL = 0x8d939b;
const METAL_DARK = 0x5d636b;
const LEATHER = 0x5a3c24;
const VISOR = 0x1c1c1e;

export class Knight {
  constructor(colorHex, name = null) {
    this.group = new THREE.Group();
    this.phase = 0;
    this.amp = 0;
    this.materials = [];
    this.geometries = [];

    const metal = this.mat(METAL);
    const metalDark = this.mat(METAL_DARK);
    const leather = this.mat(LEATHER);
    const cloth = this.mat(colorHex);
    const visor = this.mat(VISOR);
    const white = this.mat(0xf2efe6);

    // Ben (vrids vid höften)
    this.legL = this.limb(0.13, 0.85, 0.2, 0.85, metal, leather);
    this.legR = this.limb(-0.13, 0.85, 0.2, 0.85, metal, leather);
    this.group.add(this.legL, this.legR);

    // Överkropp (gungar lite när man går)
    this.upper = new THREE.Group();
    this.group.add(this.upper);

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
    this.armR.rotation.x = -0.5;
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
    this.armL.rotation.x = -0.9;
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

    if (name) this.addNameLabel(name, colorHex);
  }

  mat(color) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.1, flatShading: true });
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

  addNameLabel(name, colorHex) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    ctx.font = "bold 44px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(20, 14, 8, 0.85)";
    ctx.strokeText(name, 256, 48);
    ctx.fillStyle = "#" + new THREE.Color(colorHex).lerp(new THREE.Color(0xffffff), 0.55).getHexString();
    ctx.fillText(name, 256, 48);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.labelTexture = texture;
    const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false });
    this.materials.push(material);
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.4, 0.45, 1);
    sprite.position.y = 2.3;
    this.group.add(sprite);
  }

  // anim: 0 = står still, 1 = går, 2 = springer
  animate(dt, anim) {
    const targetAmp = anim === 2 ? 0.85 : anim === 1 ? 0.55 : 0;
    this.amp += (targetAmp - this.amp) * Math.min(1, dt * 10);
    if (anim > 0) this.phase += dt * (anim === 2 ? 11 : 8);

    const swing = Math.sin(this.phase) * this.amp;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armR.rotation.x = -0.5 + swing * 0.4;
    this.armL.rotation.x = -0.9 - swing * 0.15;
    this.upper.position.y = Math.abs(Math.sin(this.phase)) * 0.06 * this.amp;
  }

  dispose() {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    if (this.labelTexture) this.labelTexture.dispose();
    this.group.removeFromParent();
  }
}
