// VÄDER – regndroppar som faller runt kameran. (Dimman och den blöta sanden sköts i main.js och arena.js.)

import * as THREE from "three";

const DROPS = 1600;
const BOX = { x: 34, y: 20, z: 34 }; // regnet faller i en låda som följer med kameran
const FALL = 17;                     // meter per sekund
const WIND = [2.2, 0.8];             // regnet faller lite snett

export class Weather {
  constructor(scene) {
    const pos = new Float32Array(DROPS * 6);
    this.drops = new Float32Array(DROPS * 3);
    for (let i = 0; i < DROPS; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * BOX.x;
      this.drops[i * 3 + 1] = Math.random() * BOX.y;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * BOX.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xb8c8d8, transparent: true, opacity: 0.45, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
    this.kind = "sun";
  }

  set(kind) {
    this.kind = kind;
    this.rain.visible = kind === "rain";
  }

  update(dt, center) {
    if (this.kind !== "rain") return;
    const d = this.drops;
    const pos = this.rain.geometry.attributes.position.array;
    const len = 0.45;
    for (let i = 0; i < DROPS; i++) {
      let x = d[i * 3] + WIND[0] * dt;
      let y = d[i * 3 + 1] - FALL * dt;
      let z = d[i * 3 + 2] + WIND[1] * dt;
      if (y < 0) {
        y += BOX.y;
        x = (Math.random() - 0.5) * BOX.x;
        z = (Math.random() - 0.5) * BOX.z;
      }
      if (x > BOX.x / 2) x -= BOX.x;
      if (z > BOX.z / 2) z -= BOX.z;
      d[i * 3] = x;
      d[i * 3 + 1] = y;
      d[i * 3 + 2] = z;
      // Droppen är ett kort streck längs fallriktningen. Den följer kameran i sidled men inte i höjd.
      const wx = center.x + x;
      const wz = center.z + z;
      const k = i * 6;
      pos[k] = wx;
      pos[k + 1] = y;
      pos[k + 2] = wz;
      pos[k + 3] = wx - WIND[0] * (len / FALL);
      pos[k + 4] = y + len;
      pos[k + 5] = wz - WIND[1] * (len / FALL);
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }
}
