// MJUKA SAKER – tyg (mantel, vapenrock) och kedjor (slagkedjan).
//
// Båda använder samma enkla fysik ("Verlet"): varje punkt minns var den var förra
// bildrutan, så farten följer med av sig själv. Sedan dras punkterna mot rätt avstånd
// från sina grannar några gånger per bildruta, och knuffas ut ur kroppen och marken.

import * as THREE from "three";

const GRAVITY = -9.8;

// Knuffa ut en punkt ur alla klot (kroppen) och upp ur marken
function collide(p, i, colliders, ground) {
  for (const c of colliders) {
    const dx = p[i] - c.x;
    const dy = p[i + 1] - c.y;
    const dz = p[i + 2] - c.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < c.r * c.r && d2 > 1e-10) {
      const d = Math.sqrt(d2);
      const push = (c.r - d) / d;
      p[i] += dx * push;
      p[i + 1] += dy * push;
      p[i + 2] += dz * push;
    }
  }
  if (p[i + 1] < ground) p[i + 1] = ground;
}

// Matrisen (kolumnvis, som i three.js) gånger punkten
function transform(e, x, y, z, out, o) {
  out[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
  out[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
  out[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
}

// ---------------------------------------------------------------------------
// Tyg: ett rutnät av punkter. Översta raden sitter fast (t.ex. vid axlarna).
// widthTop/widthBottom: tyget kan vara bredare nertill (som en mantel).
// ---------------------------------------------------------------------------
export class Cloth {
  constructor({ cols, rows, widthTop, widthBottom = widthTop, height, material, stiffness = 1, damping = 0.97 }) {
    this.cols = cols;
    this.rows = rows;
    this.damping = damping;
    this.frozen = false;
    const n = cols * rows;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.inv = new Float32Array(n).fill(1); // 0 = sitter fast
    for (let c = 0; c < cols; c++) this.inv[c] = 0;
    this.dy = height / (rows - 1);
    this.widths = Array.from({ length: rows }, (_, r) => widthTop + ((widthBottom - widthTop) * r) / (rows - 1));

    // Fjädrar mellan grannar (raka, diagonala och "hoppa över en" för att tyget inte ska skrynklas för lätt)
    const cons = [];
    const id = (r, c) => r * cols + c;
    const dx = (r) => this.widths[r] / (cols - 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c + 1 < cols) cons.push(id(r, c), id(r, c + 1), dx(r));
        if (r + 1 < rows) cons.push(id(r, c), id(r + 1, c), Math.hypot(this.dy, (this.widths[r + 1] - this.widths[r]) * (c / (cols - 1) - 0.5)));
        if (r + 1 < rows && c + 1 < cols) cons.push(id(r, c), id(r + 1, c + 1), Math.hypot(this.dy, (dx(r) + dx(r + 1)) / 2));
        if (r + 1 < rows && c > 0) cons.push(id(r, c), id(r + 1, c - 1), Math.hypot(this.dy, (dx(r) + dx(r + 1)) / 2));
        if (stiffness > 0 && r + 2 < rows) cons.push(id(r, c), id(r + 2, c), this.dy * 2);
        if (stiffness > 0 && c + 2 < cols) cons.push(id(r, c), id(r, c + 2), dx(r) * 2);
      }
    }
    this.cons = new Float32Array(cons);

    // Ritningen: ett rutnät med samma punkter
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.positionAttr.setUsage?.(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", this.positionAttr);
    const uv = new Float32Array(n * 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        uv[id(r, c) * 2] = c / (cols - 1);
        uv[id(r, c) * 2 + 1] = 1 - r / (rows - 1);
      }
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const index = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = id(r, c);
        const b = id(r, c + 1);
        const d = id(r + 1, c);
        const e = id(r + 1, c + 1);
        index.push(a, d, b, b, d, e);
      }
    }
    geometry.setIndex(index);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.equipment = true; // siktet ska inte räkna tyget som kroppsdel
    this.started = false;
  }

  // Lägg tyget rakt nedhängande från fästpunkterna. back = [x, y, z] liten knuff bakåt per rad.
  reset(pins, back = [0, 0, 0]) {
    const { cols, rows, pos, prev } = this;
    const a = pins[0];
    const b = pins[cols - 1];
    const span = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    const ax = (b[0] - a[0]) / span; // riktningen längs fästpunkterna
    const az = (b[2] - a[2]) / span;
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[2] + b[2]) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 3;
        const along = (c / (cols - 1) - 0.5) * this.widths[r];
        pos[i] = r === 0 ? pins[c][0] : mx + ax * along + back[0] * r;
        pos[i + 1] = pins[c][1] - r * this.dy + back[1] * r;
        pos[i + 2] = r === 0 ? pins[c][2] : mz + az * along + back[2] * r;
      }
    }
    prev.set(pos);
    this.started = true;
  }

  // pins = världspositioner för översta raden, colliders = [{x, y, z, r}] i världen,
  // parentInverse = matrisen som gör om världskoordinater till ritningens förälder.
  // plane = { nx, nz, d }: tyget måste stanna på rätt sida om kroppen (nx·x + nz·z ≤ d),
  // så att t.ex. manteln aldrig hamnar framför riddaren när han vänder sig snabbt.
  update(dt, pins, colliders, parentInverse, ground = 0.02, plane = null) {
    if (this.frozen) return;
    if (!this.started) this.reset(pins);
    const { cols, pos, prev, inv, cons } = this;
    const n = this.inv.length;
    const steps = 2;
    const h = Math.min(dt, 1 / 30) / steps;
    const g = GRAVITY * h * h;
    // Om kroppen teleporterats (ny runda): börja om
    const jump = Math.hypot(pos[0] - pins[0][0], pos[1] - pins[0][1], pos[2] - pins[0][2]);
    if (jump > 1) this.reset(pins);

    for (let step = 0; step < steps; step++) {
      for (let k = 0; k < n; k++) {
        const i = k * 3;
        if (inv[k] === 0) {
          const p = pins[k % cols];
          prev[i] = pos[i];
          prev[i + 1] = pos[i + 1];
          prev[i + 2] = pos[i + 2];
          pos[i] = p[0];
          pos[i + 1] = p[1];
          pos[i + 2] = p[2];
          continue;
        }
        const vx = (pos[i] - prev[i]) * this.damping;
        const vy = (pos[i + 1] - prev[i + 1]) * this.damping;
        const vz = (pos[i + 2] - prev[i + 2]) * this.damping;
        prev[i] = pos[i];
        prev[i + 1] = pos[i + 1];
        prev[i + 2] = pos[i + 2];
        pos[i] += vx;
        pos[i + 1] += vy + g;
        pos[i + 2] += vz;
      }
      for (let iter = 0; iter < 4; iter++) {
        for (let c = 0; c < cons.length; c += 3) {
          const a = cons[c] * 3;
          const b = cons[c + 1] * 3;
          const wa = inv[cons[c]];
          const wb = inv[cons[c + 1]];
          const w = wa + wb;
          if (w === 0) continue;
          const dx = pos[b] - pos[a];
          const dy = pos[b + 1] - pos[a + 1];
          const dz = pos[b + 2] - pos[a + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = (d - cons[c + 2]) / (d * w);
          pos[a] += dx * diff * wa;
          pos[a + 1] += dy * diff * wa;
          pos[a + 2] += dz * diff * wa;
          pos[b] -= dx * diff * wb;
          pos[b + 1] -= dy * diff * wb;
          pos[b + 2] -= dz * diff * wb;
        }
        for (let k = cols; k < n; k++) {
          const i = k * 3;
          collide(pos, i, colliders, ground);
          if (plane) {
            const over = plane.nx * pos[i] + plane.nz * pos[i + 2] - plane.d;
            if (over > 0) {
              pos[i] -= plane.nx * over;
              pos[i + 2] -= plane.nz * over;
            }
          }
        }
      }
    }
    this.writeGeometry(parentInverse);
  }

  writeGeometry(parentInverse) {
    const out = this.positionAttr.array;
    const e = parentInverse.elements;
    const { pos } = this;
    for (let i = 0; i < pos.length; i += 3) transform(e, pos[i], pos[i + 1], pos[i + 2], out, i);
    this.positionAttr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere?.();
  }

  // Sluta röra sig och följ med en kroppsdel (t.ex. när riddaren dör och blir ragdoll)
  freeze(newParent) {
    if (this.frozen) return;
    this.frozen = true;
    if (newParent && this.mesh.parent) newParent.attach(this.mesh);
  }
}

// ---------------------------------------------------------------------------
// Kedja: punkter på rad, den första sitter fast i handtaget. Den sista är tung (kulan).
// ---------------------------------------------------------------------------
export class Chain {
  constructor(count, linkLength, endRadius = 0.07) {
    this.count = count; // antal punkter efter fästet
    this.len = linkLength;
    this.endRadius = endRadius;
    this.pos = new Float32Array((count + 1) * 3);
    this.prev = new Float32Array((count + 1) * 3);
    this.started = false;
  }

  reset(anchor) {
    for (let k = 0; k <= this.count; k++) {
      this.pos[k * 3] = anchor[0];
      this.pos[k * 3 + 1] = anchor[1] - k * this.len;
      this.pos[k * 3 + 2] = anchor[2];
    }
    this.prev.set(this.pos);
    this.started = true;
  }

  update(dt, anchor, colliders = []) {
    if (!this.started) this.reset(anchor);
    const { pos, prev, count, len } = this;
    if (Math.hypot(pos[0] - anchor[0], pos[1] - anchor[1], pos[2] - anchor[2]) > 1) this.reset(anchor);
    const steps = 3;
    const h = Math.min(dt, 1 / 30) / steps;
    const g = GRAVITY * h * h;
    for (let step = 0; step < steps; step++) {
      prev[0] = pos[0];
      prev[1] = pos[1];
      prev[2] = pos[2];
      pos[0] = anchor[0];
      pos[1] = anchor[1];
      pos[2] = anchor[2];
      for (let k = 1; k <= count; k++) {
        const i = k * 3;
        const vx = (pos[i] - prev[i]) * 0.995;
        const vy = (pos[i + 1] - prev[i + 1]) * 0.995;
        const vz = (pos[i + 2] - prev[i + 2]) * 0.995;
        prev[i] = pos[i];
        prev[i + 1] = pos[i + 1];
        prev[i + 2] = pos[i + 2];
        pos[i] += vx;
        pos[i + 1] += vy + g;
        pos[i + 2] += vz;
      }
      for (let iter = 0; iter < 12; iter++) {
        for (let k = 0; k < count; k++) {
          const a = k * 3;
          const b = a + 3;
          // Fästet rör sig inte; kulan längst ut är tyngre än länkarna
          const wa = k === 0 ? 0 : 1;
          const wb = k + 1 === count ? 0.35 : 1;
          const w = wa + wb;
          const dx = pos[b] - pos[a];
          const dy = pos[b + 1] - pos[a + 1];
          const dz = pos[b + 2] - pos[a + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = (d - len) / (d * w);
          pos[a] += dx * diff * wa;
          pos[a + 1] += dy * diff * wa;
          pos[a + 2] += dz * diff * wa;
          pos[b] -= dx * diff * wb;
          pos[b + 1] -= dy * diff * wb;
          pos[b + 2] -= dz * diff * wb;
        }
        for (let k = 1; k <= count; k++) collide(pos, k * 3, colliders, k === count ? this.endRadius : 0.01);
      }
    }
  }

  point(k, target) {
    return target.set(this.pos[k * 3], this.pos[k * 3 + 1], this.pos[k * 3 + 2]);
  }
}
