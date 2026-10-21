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
    this.particles.forEach((p) => p.mesh.removeFromParent());
    this.stains.forEach((m) => m.removeFromParent());
    this.particles = [];
    this.stains = [];
  }

  update(dt) {
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
