// EFFEKTER – blodstänk, blodpölar och gnistor vid parering.
// Bara utseende; påverkar inte spelet.

import * as THREE from "three";

const MAX_PARTICLES = 200;
const MAX_STAINS = 80;
const GRAVITY = -14;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.stains = [];
    this.particleGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
    this.stainGeo = new THREE.CircleGeometry(1, 8);
    this.stainGeo.rotateX(-Math.PI / 2);
    this.bloodMat = new THREE.MeshBasicMaterial({ color: 0x8e0d0d });
    this.stainMat = new THREE.MeshBasicMaterial({
      color: 0x5e0a0a,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd860 });

    // Damm: mjuka runda moln (en liten ritad bild) som växer och tonar bort
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    this.dustTexture = new THREE.CanvasTexture(canvas);
    this.dustPool = [];
    this.dustActive = [];
  }

  // Dammoln vid fötterna (springer, landar, blir sparkad)
  dust(position, amount = 4, strength = 1) {
    for (let i = 0; i < amount; i++) {
      if (this.dustActive.length >= 70) break;
      let sprite = this.dustPool.pop();
      if (!sprite) {
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.dustTexture, color: 0xc2a27a, transparent: true, depthWrite: false,
        }));
      }
      const angle = Math.random() * Math.PI * 2;
      sprite.position.set(position.x + Math.cos(angle) * 0.15, 0.12, position.z + Math.sin(angle) * 0.15);
      sprite.userData = {
        life: 0,
        maxLife: 0.6 + Math.random() * 0.5,
        vx: Math.cos(angle) * (0.4 + Math.random() * 0.6) * strength,
        vz: Math.sin(angle) * (0.4 + Math.random() * 0.6) * strength,
        size: (0.3 + Math.random() * 0.25) * Math.sqrt(strength),
      };
      this.scene.add(sprite);
      this.dustActive.push(sprite);
    }
  }

  // Blodstänk från en punkt. amount ≈ hur kraftigt.
  blood(position, amount = 14) {
    for (let i = 0; i < amount; i++) {
      this.spawn(position, this.bloodMat, 2.5 + Math.random() * 3.5, true);
    }
  }

  // Gnistor när ett slag pareras
  sparks(position) {
    for (let i = 0; i < 12; i++) {
      this.spawn(position, this.sparkMat, 3 + Math.random() * 3, false);
    }
  }

  spawn(position, material, speed, leavesStain) {
    if (this.particles.length >= MAX_PARTICLES) {
      const old = this.particles.shift();
      old.mesh.removeFromParent();
    }
    const mesh = new THREE.Mesh(this.particleGeo, material);
    mesh.position.copy(position);
    const angle = Math.random() * Math.PI * 2;
    const up = 0.3 + Math.random() * 0.9;
    const velocity = new THREE.Vector3(Math.cos(angle), up, Math.sin(angle)).normalize().multiplyScalar(speed);
    this.scene.add(mesh);
    this.particles.push({ mesh, velocity, life: 1.2, leavesStain });
  }

  stain(x, z) {
    if (this.stains.length >= MAX_STAINS) {
      const old = this.stains.shift();
      old.removeFromParent();
    }
    const mesh = new THREE.Mesh(this.stainGeo, this.stainMat);
    mesh.position.set(x, 0.02, z);
    mesh.scale.setScalar(0.08 + Math.random() * 0.18);
    this.scene.add(mesh);
    this.stains.push(mesh);
  }

  // Städa bort allt blod (t.ex. när man går tillbaka till lobbyn)
  clear() {
    this.dustActive.forEach((d) => d.removeFromParent());
    this.dustPool.push(...this.dustActive);
    this.dustActive = [];
    this.particles.forEach((p) => p.mesh.removeFromParent());
    this.stains.forEach((m) => m.removeFromParent());
    this.particles = [];
    this.stains = [];
  }

  update(dt) {
    for (let i = this.dustActive.length - 1; i >= 0; i--) {
      const d = this.dustActive[i];
      const u = d.userData;
      u.life += dt;
      const f = u.life / u.maxLife;
      if (f >= 1) {
        d.removeFromParent();
        this.dustPool.push(d);
        this.dustActive.splice(i, 1);
        continue;
      }
      d.position.x += u.vx * dt;
      d.position.z += u.vz * dt;
      d.position.y += dt * 0.25;
      const size = u.size * (0.6 + f * 1.4);
      d.scale.set(size, size, size);
      d.material.opacity = 0.45 * (1 - f);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.velocity.y += GRAVITY * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.life -= dt;
      const landed = p.mesh.position.y <= 0.03;
      if (landed || p.life <= 0) {
        if (landed && p.leavesStain && Math.random() < 0.5) this.stain(p.mesh.position.x, p.mesh.position.z);
        p.mesh.removeFromParent();
        this.particles.splice(i, 1);
      }
    }
  }
}
