// VÄDER – regndroppar som faller runt kameran. (Dimman och den blöta sanden sköts i main.js och arena.js.)

import * as THREE from "three";
import { glowTexture } from "./textures.js";

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
    this.scene = scene;
    this.kind = "sun";
  }

  // snow = true i borggården: snöflingor i stället för regn (och snöstorm i stället för dimma)
  set(kind, snow = false) {
    this.kind = kind;
    this.snowing = snow && (kind === "rain" || kind === "fog");
    this.storm = snow && kind === "fog";
    this.rain.visible = kind === "rain" && !snow;
    if (this.snowing && !this.snow) this.makeSnow();
    if (this.snow) this.snow.visible = this.snowing;
  }

  makeSnow() {
    const N = 1800;
    this.flakes = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      this.flakes[i * 4] = (Math.random() - 0.5) * BOX.x;
      this.flakes[i * 4 + 1] = Math.random() * BOX.y;
      this.flakes[i * 4 + 2] = (Math.random() - 0.5) * BOX.z;
      this.flakes[i * 4 + 3] = Math.random() * 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.snow = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xffffff, size: 0.09, transparent: true, opacity: 0.9, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
    this.snowTime = 0;
  }

  updateSnow(dt, center) {
    this.snowTime += dt;
    const f = this.flakes;
    const pos = this.snow.geometry.attributes.position.array;
    const n = pos.length / 3;
    const wind = this.storm ? 4.5 : 0.8;
    const fall = this.storm ? 2.6 : 1.3;
    const t = this.snowTime;
    for (let i = 0; i < n; i++) {
      const ph = f[i * 4 + 3];
      let x = f[i * 4] + (wind + Math.sin(t * 0.8 + ph) * 0.6) * dt;
      let y = f[i * 4 + 1] - fall * (0.7 + (ph % 1) * 0.6) * dt;
      let z = f[i * 4 + 2] + Math.cos(t * 0.6 + ph * 1.3) * 0.5 * dt;
      if (y < 0) {
        y += BOX.y;
        x = (Math.random() - 0.5) * BOX.x;
        z = (Math.random() - 0.5) * BOX.z;
      }
      if (x > BOX.x / 2) x -= BOX.x;
      if (z > BOX.z / 2) z -= BOX.z;
      if (z < -BOX.z / 2) z += BOX.z;
      f[i * 4] = x;
      f[i * 4 + 1] = y;
      f[i * 4 + 2] = z;
      pos[i * 3] = center.x + x + Math.sin(t * 2 + ph * 7) * 0.05;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = center.z + z;
    }
    this.snow.geometry.attributes.position.needsUpdate = true;
  }

  update(dt, center) {
    if (this.snowing) return this.updateSnow(dt, center);
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

// DAMM I LUFTEN – små korn som svävar i solljuset över arenan (syns inte i regn).
// På kvällen blir de varma gnistor/flygfän som lyser svagt.
const MOTES = 420;
export class Motes {
  constructor(scene, rx = 15, rz = 11) {
    this.rx = rx;
    this.rz = rz;
    this.p = new Float32Array(MOTES * 4); // x, y, z, fas
    const pos = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 1.15;
      this.p[i * 4] = Math.sin(a) * rx * r;
      this.p[i * 4 + 1] = 0.2 + Math.random() * 4.5;
      this.p[i * 4 + 2] = Math.cos(a) * rz * r;
      this.p[i * 4 + 3] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      map: glowTexture(), color: 0xfff0d0, size: 0.045, sizeAttenuation: true,
      transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.time = 0;
    this.stir = 0;
    this.off = false;   // låg grafik
    this.kind = "sun";
    this.evening = false;
  }

  // kind: "sun" | "rain" | "fog", evening: true/false
  set(kind = this.kind, evening = this.evening) {
    this.kind = kind;
    this.evening = evening;
    this.points.visible = !this.off && kind !== "rain";
    const m = this.points.material;
    m.color.set(evening ? 0xffb060 : kind === "fog" ? 0xe8ecf0 : 0xfff0d0);
    m.opacity = evening ? 0.75 : kind === "fog" ? 0.3 : 0.5;
    m.size = evening ? 0.05 : 0.045;
  }

  // Damm virvlar upp lite mer när det slåss (stir 0..1)
  kick(amount = 0.3) {
    this.stir = Math.min(1, this.stir + amount);
  }

  update(dt) {
    if (!this.points.visible) return;
    this.time += dt;
    this.stir = Math.max(0, this.stir - dt * 0.3);
    const t = this.time;
    const pos = this.points.geometry.attributes.position.array;
    const p = this.p;
    const speed = 1 + this.stir * 3;
    for (let i = 0; i < MOTES; i++) {
      const ph = p[i * 4 + 3];
      p[i * 4] += (Math.sin(t * 0.3 + ph) * 0.12 + 0.05) * dt * speed;
      p[i * 4 + 1] += Math.sin(t * 0.5 + ph * 1.7) * 0.06 * dt * speed;
      p[i * 4 + 2] += Math.cos(t * 0.27 + ph * 0.8) * 0.1 * dt * speed;
      let x = p[i * 4], y = p[i * 4 + 1], z = p[i * 4 + 2];
      if ((x / this.rx) ** 2 + (z / this.rz) ** 2 > 1.35) { x = -x * 0.9; z = -z * 0.9; }
      if (y < 0.15) y = 4.6;
      if (y > 4.8) y = 0.2;
      p[i * 4] = x; p[i * 4 + 1] = y; p[i * 4 + 2] = z;
      // fladdrar lite i sidled
      pos[i * 3] = x + Math.sin(t * 2.1 + ph * 3) * 0.04;
      pos[i * 3 + 1] = y + Math.sin(t * 1.7 + ph * 5) * 0.03;
      pos[i * 3 + 2] = z;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
