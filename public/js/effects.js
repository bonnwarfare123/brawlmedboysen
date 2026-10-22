// EFFEKTER – blod, gnistor, damm och fotspår. Bara utseende; påverkar inte spelet.
//
// Allt som finns i många exemplar (droppar, fläckar, fotspår) ritas med en enda
// "instansierad" ritning per sort, så att hundratals droppar inte sänker FPS:en.

import * as THREE from "three";
import { splatterTexture, poolTexture, footprintTexture } from "./textures.js";

const GRAVITY = -14;
const MAX_DROPS = 500;
const MAX_SPARKS = 80;
const SPLAT_VARIANTS = 4;
const SPLATS_PER_VARIANT = 45;
const MAX_POOLS = 24;
const MAX_PRINTS = 90;

const WET = new THREE.Color(0x7c0909);   // färskt blod
const DRY = new THREE.Color(0x3a0705);   // intorkat blod
const PRINT = new THREE.Color(0x5e4630); // fotspår (lite mörkare sand)
const DIRT = new THREE.Color(0x8a6a48);  // marken (fotspåren tonar mot den)

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _up = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

// En platt bild på marken (instansierad), t.ex. blodfläckar eller fotspår
function groundDecals(texture, count, renderOrder) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    map: texture, transparent: true, alphaTest: 0.35, depthWrite: false,
    roughness: 0.3, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2 - renderOrder,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < count; i++) {
    mesh.setMatrixAt(i, HIDDEN);
    mesh.setColorAt(i, WET);
  }
  mesh.renderOrder = renderOrder;
  mesh.frustumCulled = false;
  return { mesh, items: new Array(count).fill(null), next: 0 };
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;

    // Droppar: utdragna i farten, så de ser ut som stänk och strimmor
    const dropGeo = new THREE.SphereGeometry(1, 6, 5);
    this.drops = new THREE.InstancedMesh(dropGeo, new THREE.MeshStandardMaterial({ color: 0x8e0b0b, roughness: 0.25, metalness: 0.1 }), MAX_DROPS);
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.drops.frustumCulled = false;
    this.dropData = Array.from({ length: MAX_DROPS }, () => ({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0, life: 0, splat: false }));
    this.nextDrop = 0;
    for (let i = 0; i < MAX_DROPS; i++) this.drops.setMatrixAt(i, HIDDEN);
    scene.add(this.drops);

    // Gnistor vid parering
    this.sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffd860 }), MAX_SPARKS);
    this.sparkMesh.frustumCulled = false;
    this.sparkData = Array.from({ length: MAX_SPARKS }, () => ({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0 }));
    this.nextSpark = 0;
    for (let i = 0; i < MAX_SPARKS; i++) this.sparkMesh.setMatrixAt(i, HIDDEN);
    scene.add(this.sparkMesh);

    // Blodfläckar på marken (flera former), pölar och fotspår
    this.splats = [];
    for (let v = 0; v < SPLAT_VARIANTS; v++) {
      const d = groundDecals(splatterTexture(v), SPLATS_PER_VARIANT, 1);
      scene.add(d.mesh);
      this.splats.push(d);
    }
    this.pools = groundDecals(poolTexture(), MAX_POOLS, 0);
    scene.add(this.pools.mesh);
    this.prints = groundDecals(footprintTexture(), MAX_PRINTS, 0);
    this.prints.mesh.material.roughness = 1;
    this.prints.mesh.material.alphaTest = 0.01; // mjuk kant, inget skarpt streck
    this.prints.mesh.material.opacity = 0.7;
    scene.add(this.prints.mesh);
    this.colorTimer = 0;

    // Moln: mjuka runda bilder som växer och tonar bort (damm och blodmoln)
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    this.puffTexture = new THREE.CanvasTexture(canvas);
    this.puffPool = [];
    this.puffs = [];
  }

  // ---------- Blod ----------

  // Blodstänk från en punkt. dir = varifrån slaget kom är bakom, stänket flyger åt dir
  blood(position, amount = 14, dir = null, power = 1) {
    for (let i = 0; i < amount; i++) {
      const v = _v.set(Math.random() - 0.5, 0.25 + Math.random() * 0.8, Math.random() - 0.5);
      if (dir) v.addScaledVector(dir, 1.1);
      v.normalize().multiplyScalar((2 + Math.random() * 4) * power);
      // Blandade storlekar: mest små droppar, några större klumpar
      const size = Math.random() < 0.15 ? 0.03 + Math.random() * 0.025 : 0.01 + Math.random() * 0.017;
      this.spawnDrop(position, v, size, true);
    }
    this.mist(position, Math.min(1.5, amount / 15) * power);
  }

  // Pulserande stråle ur en stump (dir = utåt från kroppen)
  spurt(position, dir, strength = 1) {
    const count = 3 + Math.floor(strength * 4);
    for (let i = 0; i < count; i++) {
      const v = _v.copy(dir).multiplyScalar(2.5 + strength * 2.5);
      v.x += (Math.random() - 0.5) * 0.8;
      v.y += 0.8 + (Math.random() - 0.5) * 0.6;
      v.z += (Math.random() - 0.5) * 0.8;
      this.spawnDrop(position, v, 0.012 + Math.random() * 0.012, Math.random() < 0.35);
    }
  }

  spawnDrop(position, velocity, size, splat) {
    const d = this.dropData[this.nextDrop];
    this.nextDrop = (this.nextDrop + 1) % MAX_DROPS;
    d.alive = true;
    d.pos.copy(position);
    d.vel.copy(velocity);
    d.size = size;
    d.life = 1.6;
    d.splat = splat;
  }

  // Ett rött moln vid kraftiga träffar
  mist(position, strength = 1) {
    const n = Math.round(2 + strength * 2);
    for (let i = 0; i < n; i++) {
      this.spawnPuff(position, 0x8a1010, 0.5, 0.25 + Math.random() * 0.2, 0.35 + Math.random() * 0.25, 0.8 * strength, 0.15);
    }
  }

  // Stänkfläck på marken, utdragen åt det håll droppen flög
  splat(x, z, size, dx = 0, dz = 0) {
    const set = this.splats[Math.floor(Math.random() * SPLAT_VARIANTS)];
    const i = set.next;
    set.next = (set.next + 1) % SPLATS_PER_VARIANT;
    const angle = dx || dz ? Math.atan2(-dz, dx) : Math.random() * Math.PI * 2;
    _q.setFromAxisAngle(_up, angle);
    _p.set(x, 0.015 + Math.random() * 0.004, z);
    _s.set(size * 1.4, 1, size);
    _m.compose(_p, _q, _s);
    set.mesh.setMatrixAt(i, _m);
    set.mesh.setColorAt(i, WET);
    set.items[i] = { born: this.time };
    set.mesh.instanceMatrix.needsUpdate = true;
    set.mesh.instanceColor.needsUpdate = true;
  }

  // Blodpöl som sakta växer (under döda kroppar och avhuggna delar)
  pool(x, z, size = 0.8) {
    const i = this.pools.next;
    this.pools.next = (this.pools.next + 1) % MAX_POOLS;
    this.pools.items[i] = { x, z, size, born: this.time, angle: Math.random() * Math.PI * 2 };
    this.pools.mesh.setColorAt(i, WET);
    this.pools.mesh.instanceColor.needsUpdate = true;
  }

  // ---------- Gnistor, damm, fotspår ----------

  sparks(position) {
    for (let i = 0; i < 14; i++) {
      const d = this.sparkData[this.nextSpark];
      this.nextSpark = (this.nextSpark + 1) % MAX_SPARKS;
      d.alive = true;
      d.pos.copy(position);
      d.vel.set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 3);
      d.life = 0.5;
    }
  }

  dust(position, amount = 4, strength = 1) {
    for (let i = 0; i < amount; i++) {
      this.spawnPuff({ x: position.x, y: 0.12, z: position.z }, 0xc2a27a, 0.45, 0.3 + Math.random() * 0.25, 0.6 + Math.random() * 0.5, strength, 0.25);
    }
  }

  // Ett fotspår i sanden (bara inne på arenan, tonar bort med tiden)
  footprint(x, z, yaw, side) {
    if ((x / 13) ** 2 + (z / 10) ** 2 > 1) return;
    const i = this.prints.next;
    this.prints.next = (this.prints.next + 1) % MAX_PRINTS;
    const lx = side === "L" ? 0.02 : -0.02;
    _q.setFromAxisAngle(_up, yaw + Math.PI);
    _p.set(x + lx * Math.cos(yaw), 0.013, z - lx * Math.sin(yaw));
    _s.set(0.12, 1, 0.28);
    _m.compose(_p, _q, _s);
    this.prints.mesh.setMatrixAt(i, _m);
    this.prints.mesh.setColorAt(i, PRINT);
    this.prints.items[i] = { born: this.time };
    this.prints.mesh.instanceMatrix.needsUpdate = true;
    this.prints.mesh.instanceColor.needsUpdate = true;
  }

  spawnPuff(position, color, opacity, size, life, strength, rise) {
    if (this.puffs.length >= 90) return;
    let sprite = this.puffPool.pop();
    if (!sprite) {
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTexture, transparent: true, depthWrite: false }));
    }
    sprite.material.color.setHex(color);
    const angle = Math.random() * Math.PI * 2;
    sprite.position.set(position.x + Math.cos(angle) * 0.12, position.y, position.z + Math.sin(angle) * 0.12);
    sprite.userData = {
      life: 0, maxLife: life, opacity, rise,
      vx: Math.cos(angle) * (0.4 + Math.random() * 0.6) * strength,
      vz: Math.sin(angle) * (0.4 + Math.random() * 0.6) * strength,
      size: size * Math.sqrt(Math.max(0.2, strength)),
    };
    this.scene.add(sprite);
    this.puffs.push(sprite);
  }

  // Städa bort allt (t.ex. när man går tillbaka till lobbyn)
  clear() {
    this.puffs.forEach((p) => p.removeFromParent());
    this.puffPool.push(...this.puffs);
    this.puffs = [];
    for (const d of this.dropData) d.alive = false;
    for (const d of this.sparkData) d.alive = false;
    for (const set of [...this.splats, this.pools, this.prints]) {
      set.items.fill(null);
      for (let i = 0; i < set.items.length; i++) set.mesh.setMatrixAt(i, HIDDEN);
      set.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- Varje bildruta ----------

  update(dt) {
    this.time += dt;

    // Droppar
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = this.dropData[i];
      if (!d.alive) continue;
      d.vel.y += GRAVITY * dt;
      d.pos.addScaledVector(d.vel, dt);
      d.life -= dt;
      if (d.pos.y <= 0.02 || d.life <= 0) {
        if (d.pos.y <= 0.02 && d.splat) this.splat(d.pos.x, d.pos.z, d.size * (8 + Math.random() * 6), d.vel.x, d.vel.z);
        d.alive = false;
        this.drops.setMatrixAt(i, HIDDEN);
        continue;
      }
      // Sträck ut droppen i fartriktningen
      const speed = d.vel.length();
      _q.setFromUnitVectors(_z, _v.copy(d.vel).divideScalar(speed || 1));
      _s.set(d.size, d.size, d.size * (1 + speed * 0.9));
      _m.compose(d.pos, _q, _s);
      this.drops.setMatrixAt(i, _m);
    }
    this.drops.instanceMatrix.needsUpdate = true;

    // Gnistor
    for (let i = 0; i < MAX_SPARKS; i++) {
      const d = this.sparkData[i];
      if (!d.alive) continue;
      d.vel.y += GRAVITY * dt;
      d.pos.addScaledVector(d.vel, dt);
      d.life -= dt;
      if (d.life <= 0 || d.pos.y < 0) {
        d.alive = false;
        this.sparkMesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      _q.setFromUnitVectors(_z, _v.copy(d.vel).normalize());
      _s.set(0.015, 0.015, 0.06);
      _m.compose(d.pos, _q, _s);
      this.sparkMesh.setMatrixAt(i, _m);
    }
    this.sparkMesh.instanceMatrix.needsUpdate = true;

    // Pölar växer
    let poolsChanged = false;
    this.pools.items.forEach((p, i) => {
      if (!p) return;
      const age = this.time - p.born;
      const grow = Math.min(1, age / 6);
      _q.setFromAxisAngle(_up, p.angle);
      _p.set(p.x, 0.012, p.z);
      const s = p.size * (0.15 + 0.85 * (1 - (1 - grow) ** 2));
      _s.set(s, 1, s);
      _m.compose(_p, _q, _s);
      this.pools.mesh.setMatrixAt(i, _m);
      poolsChanged = true;
    });
    if (poolsChanged) this.pools.mesh.instanceMatrix.needsUpdate = true;

    // Blod torkar och mörknar, fotspår tonar bort (uppdateras två gånger i sekunden)
    this.colorTimer += dt;
    if (this.colorTimer > 0.5) {
      this.colorTimer = 0;
      const c = new THREE.Color();
      for (const set of [...this.splats, this.pools]) {
        set.items.forEach((item, i) => {
          if (!item) return;
          c.copy(WET).lerp(DRY, Math.min(1, (this.time - item.born) / 25));
          set.mesh.setColorAt(i, c);
        });
        set.mesh.instanceColor.needsUpdate = true;
      }
      this.prints.items.forEach((item, i) => {
        if (!item) return;
        const f = Math.min(1, (this.time - item.born) / 20);
        if (f >= 1) {
          this.prints.items[i] = null;
          this.prints.mesh.setMatrixAt(i, HIDDEN);
          this.prints.mesh.instanceMatrix.needsUpdate = true;
        } else {
          c.copy(PRINT).lerp(DIRT, f);
          this.prints.mesh.setColorAt(i, c);
        }
      });
      this.prints.mesh.instanceColor.needsUpdate = true;
    }

    // Moln
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const d = this.puffs[i];
      const u = d.userData;
      u.life += dt;
      const f = u.life / u.maxLife;
      if (f >= 1) {
        d.removeFromParent();
        this.puffPool.push(d);
        this.puffs.splice(i, 1);
        continue;
      }
      d.position.x += u.vx * dt;
      d.position.z += u.vz * dt;
      d.position.y += dt * u.rise;
      const size = u.size * (0.6 + f * 1.4);
      d.scale.set(size, size, size);
      d.material.opacity = u.opacity * (1 - f);
    }
  }
}
