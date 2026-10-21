// RAGDOLL – en liten egen fysikmotor för döda riddare och avhuggna kroppsdelar.
//
// Så fungerar det (förenklat):
// - Varje kroppsdel får några punkter som sitter fast i förhållande till varandra
//   (som en stel triangel). Det gör att delen behåller sin form.
// - Lederna är "nålar" som håller ihop två delars punkter. Huggs en led av tas
//   nålen bort, och delarna kan flyga isär.
// - Varje bildruta faller punkterna av tyngdkraften, och sedan rättas avstånden
//   till så att allt hänger ihop. Marken och staketet stoppar punkterna.
// - Till sist räknas varje kroppsdels position och vridning ut från dess punkter.
//
// Filen använder ingen 3D-motor, bara vanlig matematik, så den går att testa fristående.

const GRAVITY = -15;
const STEP = 1 / 60;
const ITERATIONS = 10;
const MAX_STEPS_PER_FRAME = 4;
const SIMULATE_SECONDS = 10; // därefter ligger delarna stilla (sparar prestanda)

// ---------- Vektorhjälp ----------

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Ett ortonormerat koordinatsystem (tre axlar) från tre punkter
function basis(p0, p1, p2) {
  const e1 = normalize(sub(p1, p0));
  const e3 = normalize(cross(e1, sub(p2, p0)));
  const e2 = cross(e3, e1);
  return [e1, e2, e3];
}

// Rotationsmatris (rad i, kolumn j) till kvaternion [x, y, z, w]
export function matrixToQuaternion(m) {
  const trace = m[0][0] + m[1][1] + m[2][2];
  let x, y, z, w;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m[2][1] - m[1][2]) * s;
    y = (m[0][2] - m[2][0]) * s;
    z = (m[1][0] - m[0][1]) * s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]);
    w = (m[2][1] - m[1][2]) / s;
    x = 0.25 * s;
    y = (m[0][1] + m[1][0]) / s;
    z = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]);
    w = (m[0][2] - m[2][0]) / s;
    x = (m[0][1] + m[1][0]) / s;
    y = 0.25 * s;
    z = (m[1][2] + m[2][1]) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]);
    w = (m[1][0] - m[0][1]) / s;
    x = (m[0][2] + m[2][0]) / s;
    y = (m[1][2] + m[2][1]) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}

// Räkna ut rotation (matris) och position som flyttar de lokala punkterna till de nuvarande
export function solveTransform(local, world) {
  const L = basis(local[0], local[1], local[2]);
  const W = basis(world[0], world[1], world[2]);
  // R = W * Lᵀ  (kolumnerna i W och L är axlarna)
  const R = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      R[i][j] = W[0][i] * L[0][j] + W[1][i] * L[1][j] + W[2][i] * L[2][j];
    }
  }
  const l0 = local[0];
  const rl0 = [
    R[0][0] * l0[0] + R[0][1] * l0[1] + R[0][2] * l0[2],
    R[1][0] * l0[0] + R[1][1] * l0[1] + R[1][2] * l0[2],
    R[2][0] * l0[0] + R[2][1] * l0[1] + R[2][2] * l0[2],
  ];
  const position = sub(world[0], rl0);
  return { position, quaternion: matrixToQuaternion(R), matrix: R };
}

// ---------- Ragdoll ----------

export class Ragdoll {
  // bodies: [{ object, local: [[x,y,z]...], world: [[x,y,z]...], radius, velocity: [vx,vy,vz], spin: [vx,vy,vz] }]
  //   object  = 3D-objektet som ska flyttas (behöver position.set och quaternion.set)
  //   local   = kroppsdelens punkter i dess egna koordinater (minst 3)
  //   world   = samma punkter i världen just nu
  //   spin    = extra fart för punkterna längst bort, så delen snurrar
  // bounds: { rx, rz } – ovalen som staketet bildar
  constructor(bodies, bounds = null) {
    this.points = [];
    this.constraints = [];
    this.bodies = [];
    this.bounds = bounds;
    this.age = 0;
    this.acc = 0;

    for (const body of bodies) {
      const indices = [];
      body.world.forEach((w, k) => {
        const v = body.velocity || [0, 0, 0];
        const s = k > 0 && body.spin ? body.spin : [0, 0, 0];
        const vx = (v[0] + s[0]) * STEP;
        const vy = (v[1] + s[1]) * STEP;
        const vz = (v[2] + s[2]) * STEP;
        indices.push(this.points.length);
        this.points.push({
          x: w[0], y: w[1], z: w[2],
          px: w[0] - vx, py: w[1] - vy, pz: w[2] - vz,
          r: body.radius ?? 0.05,
        });
      });
      // Stel kroppsdel: alla punkter håller sina inbördes avstånd
      for (let a = 0; a < indices.length; a++) {
        for (let b = a + 1; b < indices.length; b++) {
          this.constraints.push({ a: indices[a], b: indices[b], len: dist(body.local[a], body.local[b]) });
        }
      }
      this.bodies.push({ object: body.object, local: body.local, indices });
    }

    // Leder: varje kroppsdels första punkt (leden) nålas fast vid närmaste punkt på en annan del
    this.bodies.forEach((body, bi) => {
      const p = this.points[body.indices[0]];
      let best = -1;
      let bestDist = 0.06;
      this.bodies.forEach((other, oi) => {
        if (oi === bi) return;
        for (const idx of other.indices) {
          const q = this.points[idx];
          const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
          if (d < bestDist) {
            bestDist = d;
            best = idx;
          }
        }
      });
      if (best >= 0) this.constraints.push({ a: body.indices[0], b: best, len: 0 });
    });

    this.sync();
  }

  get asleep() {
    return this.age > SIMULATE_SECONDS;
  }

  // Ungefärlig mittpunkt (första kroppsdelens led), t.ex. för kameran
  center() {
    const p = this.points[this.bodies[0].indices[0]];
    return [p.x, p.y, p.z];
  }

  update(dt) {
    this.age += dt;
    if (this.asleep) return;
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
      this.step();
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
    this.sync();
  }

  step() {
    const g = GRAVITY * STEP * STEP;
    for (const p of this.points) {
      const vx = (p.x - p.px) * 0.995;
      const vy = (p.y - p.py) * 0.995;
      const vz = (p.z - p.pz) * 0.995;
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
      p.x += vx;
      p.y += vy + g;
      p.z += vz;
    }

    for (let it = 0; it < ITERATIONS; it++) {
      for (const c of this.constraints) {
        const a = this.points[c.a];
        const b = this.points[c.b];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 1e-9) continue;
        const k = ((d - c.len) / d) * 0.5;
        a.x += dx * k;
        a.y += dy * k;
        a.z += dz * k;
        b.x -= dx * k;
        b.y -= dy * k;
        b.z -= dz * k;
      }
      this.collide();
    }

    // Friktion mot marken
    for (const p of this.points) {
      if (p.y <= p.r + 0.002) {
        p.px = p.x - (p.x - p.px) * 0.7;
        p.pz = p.z - (p.z - p.pz) * 0.7;
      }
    }
  }

  collide() {
    for (const p of this.points) {
      if (p.y < p.r) p.y = p.r;
      if (this.bounds) {
        const v = (p.x / this.bounds.rx) ** 2 + (p.z / this.bounds.rz) ** 2;
        if (v > 1) {
          const s = 1 / Math.sqrt(v);
          p.x *= s;
          p.z *= s;
        }
      }
    }
  }

  // Flytta och vrid 3D-objekten så att de följer punkterna
  sync() {
    for (const body of this.bodies) {
      const world = body.indices.map((i) => [this.points[i].x, this.points[i].y, this.points[i].z]);
      const t = solveTransform(body.local, world);
      body.object.position.set(t.position[0], t.position[1], t.position[2]);
      body.object.quaternion.set(t.quaternion[0], t.quaternion[1], t.quaternion[2], t.quaternion[3]);
    }
  }

  dispose() {
    for (const body of this.bodies) {
      body.object.traverse?.((obj) => {
        if (obj.isMesh && obj.geometry) obj.geometry.dispose();
      });
      body.object.removeFromParent?.();
    }
  }
}

// ---------- Hög med döda kroppar och lösa kroppsdelar ----------

export class Debris {
  constructor(maxCount = 30, lifeSeconds = 45) {
    this.items = [];
    this.maxCount = maxCount;
    this.lifeSeconds = lifeSeconds;
  }

  add(ragdoll) {
    if (!ragdoll) return;
    this.items.push(ragdoll);
    while (this.items.length > this.maxCount) this.items.shift().dispose();
  }

  clear() {
    this.items.forEach((r) => r.dispose());
    this.items = [];
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const r = this.items[i];
      r.update(dt);
      // Gamla delar sjunker långsamt ner i marken och försvinner
      const over = r.age - this.lifeSeconds;
      if (over > 0) {
        for (const body of r.bodies) body.object.position.y -= 0.12 * dt;
        if (over > 3) {
          r.dispose();
          this.items.splice(i, 1);
        }
      }
    }
  }
}
