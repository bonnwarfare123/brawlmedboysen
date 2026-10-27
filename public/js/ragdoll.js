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

const GRAVITY = -12; // tyngdkraften för kroppar och lösa delar
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

// Extra punkter för vissa kroppsdelar (i delens egna koordinater). De gör att lederna
// kan få riktning: ett knä kan böjas bakåt men inte framåt, en armbåge bara åt ett håll.
const EXTRA_POINTS = {
  thighL: [0, -0.21, 0.09], thighR: [0, -0.21, 0.09],          // framsidan av låret
  upperArmL: [0, -0.145, -0.07], upperArmR: [0, -0.145, -0.07], // baksidan av överarmen
};

// Rörelsegränser: avståndet mellan två punkter (kroppsdel, punktnummer) måste ligga inom [min, max].
// min/max är meter, eller (om rel är satt) gånger avståndet i början.
function jointLimits(side) {
  return [
    { a: ["shin" + side, 1], b: ["thigh" + side, 0], min: 0.36 },            // knät böjs högst ~130°
    { a: ["shin" + side, 1], b: ["thigh" + side, 3], min: 0.6 },             // knät böjs inte framåt
    { a: ["thigh" + side, 1], b: ["torso", 1], min: 0.45 },                   // höften viks inte ihop helt
    { a: ["forearm" + side, 1], b: ["upperArm" + side, 0], min: 0.16 },      // armbågen
    { a: ["forearm" + side, 1], b: ["upperArm" + side, 3], min: 0.4 },       // armbågen böjs inte bakåt
    { a: ["foot" + side, 1], b: ["shin" + side, 0], rel: [0.85, 1.1] },      // fotleden
    { a: ["hand" + side, 1], b: ["forearm" + side, 0], rel: [0.8, 1.05] },   // handleden
  ];
}
const BODY_LIMITS = [
  ...jointLimits("L"), ...jointLimits("R"),
  { a: ["head", 1], b: ["torso", 0], rel: [0.86, 1.03] },  // nacken
  { a: ["torso", 1], b: ["pelvis", 1], rel: [0.82, 1.06] }, // ryggen
  { a: ["torso", 1], b: ["pelvis", 2], rel: [0.82, 1.06] },
];

const TENSION_TIME = 0.45; // så länge musklerna fortfarande håller emot (sekunder)

export class Ragdoll {
  // bodies: [{ object, local: [[x,y,z]...], world: [[x,y,z]...], radius, velocity: [vx,vy,vz], spin: [vx,vy,vz], name }]
  //   object  = 3D-objektet som ska flyttas (behöver position.set och quaternion.set)
  //   local   = kroppsdelens punkter i dess egna koordinater (minst 3)
  //   world   = samma punkter i världen just nu
  //   spin    = extra fart för punkterna längst bort, så delen snurrar
  //   name    = kroppsdelens namn (ger leder med rörelsegränser)
  // bounds: { rx, rz } – ovalen som staketet bildar
  constructor(bodies, bounds = null) {
    this.points = [];
    this.constraints = [];
    this.limits = [];
    this.tension = [];
    this.pairs = [];
    this.bodies = [];
    this.bounds = bounds;
    this.age = 0;
    this.acc = 0;

    for (const body of bodies) {
      // Lägg till en extra punkt för knän och armbågar (räknas ut från delens läge just nu)
      let local = body.local;
      let world = body.world;
      const extra = EXTRA_POINTS[body.name];
      if (extra && local.length === 3) {
        const t = solveTransform(local, world);
        const R = t.matrix;
        const e = [
          R[0][0] * extra[0] + R[0][1] * extra[1] + R[0][2] * extra[2] + t.position[0],
          R[1][0] * extra[0] + R[1][1] * extra[1] + R[1][2] * extra[2] + t.position[1],
          R[2][0] * extra[0] + R[2][1] * extra[1] + R[2][2] * extra[2] + t.position[2],
        ];
        local = [...local, extra];
        world = [...world, e];
      }
      const indices = [];
      world.forEach((w, k) => {
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
          body: this.bodies.length,
        });
      });
      // Stel kroppsdel: alla punkter håller sina inbördes avstånd
      for (let a = 0; a < indices.length; a++) {
        for (let b = a + 1; b < indices.length; b++) {
          this.constraints.push({ a: indices[a], b: indices[b], len: dist(local[a], local[b]) });
        }
      }
      this.bodies.push({ object: body.object, local, indices, name: body.name, linked: new Set() });
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
      if (best >= 0) {
        this.constraints.push({ a: body.indices[0], b: best, len: 0 });
        const other = this.points[best].body;
        body.linked.add(other);
        this.bodies[other].linked.add(bi);
      }
    });

    // Rörelsegränser för lederna (bara mellan delar som sitter ihop)
    const byName = new Map(this.bodies.map((b, i) => [b.name, i]));
    const point = ([name, k]) => {
      const bi = byName.get(name);
      if (bi === undefined) return -1;
      return this.bodies[bi].indices[k] ?? -1;
    };
    for (const limit of BODY_LIMITS) {
      const a = point(limit.a);
      const b = point(limit.b);
      if (a < 0 || b < 0) continue;
      const ba = this.points[a].body;
      const bb = this.points[b].body;
      if (!this.bodies[ba].linked.has(bb)) continue; // leden är avhuggen
      const d = this.distance(a, b);
      let min = limit.min ?? 0;
      let max = limit.max ?? Infinity;
      if (limit.rel) {
        min = d * limit.rel[0];
        max = d * limit.rel[1];
      }
      // Står leden redan utanför gränsen (mitt i ett slag)? Börja där och låt den glida in.
      min = Math.min(min, d);
      max = Math.max(max, d);
      this.limits.push({ a, b, min, max });
    }

    // Muskelspänning: i början håller delarna som sitter ihop sin vinkel, sedan blir kroppen slapp
    this.bodies.forEach((body, bi) => {
      for (const oi of body.linked) {
        if (oi < bi) continue;
        for (const ia of body.indices) {
          for (const ib of this.bodies[oi].indices) {
            if (this.distance(ia, ib) < 0.02) continue;
            this.tension.push({ a: ia, b: ib, len: this.distance(ia, ib) });
          }
        }
      }
    });

    // Kroppsdelar som inte sitter ihop får inte gå igenom varandra (armarna genom bålen, benen genom varandra)
    for (let i = 0; i < this.points.length; i++) {
      for (let j = i + 1; j < this.points.length; j++) {
        const pi = this.points[i];
        const pj = this.points[j];
        if (pi.body === pj.body || this.bodies[pi.body].linked.has(pj.body)) continue;
        const want = (pi.r + pj.r) * 0.9;
        const d = this.distance(i, j);
        this.pairs.push({ a: i, b: j, min: Math.min(want, d) });
      }
    }

    // Startläget för varje punkt (används av "musklerna" i drive, se nedan)
    this.pose0 = this.points.map((p) => [p.x, p.y, p.z]);
    this.sync();
  }

  // Muskler under de första sekunderna: kroppsdelar dras mot en målpose (startläget + en förskjutning).
  // drive = { until: sekunder, at(t) => { hold: { del: styrka 0–1 per steg, "*": standard }, shift: { del: [dx, dy, dz], "*": ... } } }
  // Så kan en kropp stå kvar en stund, vingla, gå ner på knä och sedan falla (styrkan går mot noll).
  setDrive(drive) {
    this.drive = drive;
  }

  applyDrive() {
    const d = this.drive;
    const t = this.simAge || 0;
    if (!d || t > d.until) return;
    const now = d.at(t);
    const zero = [0, 0, 0];
    for (const body of this.bodies) {
      const s = now.hold[body.name] ?? now.hold["*"] ?? 0;
      if (s <= 0) continue;
      const sh = now.shift[body.name] ?? now.shift["*"] ?? zero;
      for (const idx of body.indices) {
        const p = this.points[idx];
        const p0 = this.pose0[idx];
        const dx = (p0[0] + sh[0] - p.x) * s;
        const dy = (p0[1] + sh[1] - p.y) * s;
        const dz = (p0[2] + sh[2] - p.z) * s;
        p.x += dx;
        p.y += dy;
        p.z += dz;
        // musklerna bromsar också (annars studsar delarna runt målet)
        p.px += (p.x - p.px) * s * 0.6;
        p.py += (p.y - p.py) * s * 0.6;
        p.pz += (p.z - p.pz) * s * 0.6;
      }
    }
  }

  distance(a, b) {
    const p = this.points[a];
    const q = this.points[b];
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
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
      this.simAge = (this.simAge || 0) + STEP;
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
    this.sync();
  }

  // Flytta två punkter mot (eller från) varandra. stiffness 1 = hela vägen.
  pull(a, b, len, stiffness) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-9) return;
    const k = ((d - len) / d) * 0.5 * stiffness;
    a.x += dx * k;
    a.y += dy * k;
    a.z += dz * k;
    b.x -= dx * k;
    b.y -= dy * k;
    b.z -= dz * k;
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

    const age = this.simAge || 0;
    const driven = this.drive && age <= this.drive.until;
    const tension = driven ? 0.04 : age < TENSION_TIME ? 0.25 * (1 - age / TENSION_TIME) : 0;
    if (driven) this.applyDrive();
    const P = this.points;
    for (let it = 0; it < ITERATIONS; it++) {
      for (const c of this.constraints) this.pull(P[c.a], P[c.b], c.len, 1);
      if (tension > 0) for (const c of this.tension) this.pull(P[c.a], P[c.b], c.len, tension);
      // Lederna: bara om de är utanför sina gränser
      for (const l of this.limits) {
        const d = this.distance(l.a, l.b);
        if (d < l.min) this.pull(P[l.a], P[l.b], l.min, 0.6);
        else if (d > l.max) this.pull(P[l.a], P[l.b], l.max, 0.6);
      }
      // Kroppsdelarna knuffar undan varandra (varannan runda räcker)
      if (it % 2 === 0) {
        for (const c of this.pairs) {
          const a = P[c.a];
          const b = P[c.b];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dz = b.z - a.z;
          if (dx * dx + dy * dy + dz * dz < c.min * c.min) this.pull(a, b, c.min, 0.8);
        }
      }
      this.collide();
    }

    // Friktion mot marken (rustning mot sand glider inte långt)
    for (const p of this.points) {
      if (p.y <= p.r + 0.004) {
        p.px = p.x - (p.x - p.px) * 0.55;
        p.pz = p.z - (p.z - p.pz) * 0.55;
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
      const world = body.indices.slice(0, 3).map((i) => [this.points[i].x, this.points[i].y, this.points[i].z]);
      const t = solveTransform(body.local.slice(0, 3), world);
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
