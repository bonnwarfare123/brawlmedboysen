// EFFEKTER – blod, gnistor, damm och fotspår. Bara utseende; påverkar inte spelet.
//
// Allt som finns i många exemplar (droppar, fläckar, fotspår) ritas med en enda
// "instansierad" ritning per sort, så att hundratals droppar inte sänker FPS:en.
//
// BLOD (v0.49): dropparna är platta bilder som alltid vänds mot kameran och sträcks ut i fartriktningen
// (inte längre blanka klot). Bilderna ligger i textures/blod.png (ritad av tools/blod_atlas.py):
// droppformer, fint stänk och ett träffstänk i fyra bilder. Hur blodet sprids beror på vapnet
// (hugg, stick eller trubbigt), träffriktningen, träffpunkten och om slaget var tungt.
// Två ritanrop för allt flygande blod: droppar och träffstänk. Fasta buffertar, inget skapas under spelet.

import * as THREE from "three";
import { splatterTexture, poolTexture, footprintTexture } from "./textures.js";

const GRAVITY = -9.8;
const MAX_DROPS = 700;
const MAX_BURSTS = 40;
const MAX_SPARKS = 80;
const SPLAT_VARIANTS = 4;
const SPLATS_PER_VARIANT = 45;
const MAX_POOLS = 24;
const MAX_PRINTS = 90;

const WET = new THREE.Color(0x7c0909);   // färskt blod
const DRY = new THREE.Color(0x3a1a0e);   // intorkat blod: mörkt brunrött, har sjunkit in i sanden
const PRINT = new THREE.Color(0x5e4630); // fotspår (lite mörkare sand)
const MUD_PRINT = new THREE.Color(0x2e2014); // fotspår i lera (regn): mörka och djupa
const DIRT = new THREE.Color(0x8a6a48);  // marken (fotspåren tonar mot den)
const BLOODY_PRINT = new THREE.Color(0x6a0c08); // fotspår efter att man gått genom en blodpöl
const RAIN_BLOOD = new THREE.Color(0x8a3a30);   // utspätt av regnet: ljusare och rosaaktigt
const MAX_WALL = 60;
// Sargens insida (där blodstänk fastnar): lite innanför plankorna
const WALL_RX = 13.62;
const WALL_RZ = 10.62;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _up = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

// ---------- Blodpartiklar: kamerariktade, utdragna bilder ur blod.png ----------
const BLOD_TEX = new THREE.TextureLoader().load(new URL("../textures/blod.png", import.meta.url).href);
BLOD_TEX.colorSpace = THREE.NoColorSpace; // ljushet + täckning, inte färg
BLOD_TEX.anisotropy = 4;
// Färskt blod (linjärt): mörkt, lite brunt rött – multipliceras med bildens ljushet och en slumpad nyans
const BLOD_FARG = new THREE.Color(0.2, 0.008, 0.006);

const BLOD_VERT = `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iA;   // storlek, täckning, ruta i blod.png, nyans
attribute float iS;  // hur mycket farten drar ut bilden
varying vec2 vUv;
varying float vAlpha;
varying float vTint;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
  float sp = length(vv.xy);
  vec2 ax = sp > 1e-5 ? vv.xy / sp : vec2(0.0, 1.0);
  vec2 px = vec2(ax.y, -ax.x);
  float size = iA.x;
  float len = size * (1.0 + min(sp * iS, 4.0));
  // fronten ligger vid partikeln, svansen släpar efter
  mvPosition.xy += px * position.x * size + ax * (position.y * len - (len - size) * 0.5);
  gl_Position = projectionMatrix * mvPosition;
  float cell = iA.z;
  vUv = (vec2(mod(cell, 4.0), 3.0 - floor(cell / 4.0)) + uv) / 4.0;
  vAlpha = iA.y;
  vTint = iA.w;
  #include <fog_vertex>
}`;
const BLOD_FRAG = `
uniform sampler2D uMap;
uniform vec3 uFarg;
uniform float uLjus;
varying vec2 vUv;
varying float vAlpha;
varying float vTint;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vAlpha;
  if (a < 0.03) discard;
  vec3 col = uFarg * (0.7 + 0.6 * vTint) * (t.rgb / 0.62) * uLjus;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function bloodMaterial() {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uFarg: { value: new THREE.Color() }, uLjus: { value: 1 } }]),
    vertexShader: BLOD_VERT, fragmentShader: BLOD_FRAG,
    transparent: true, depthWrite: false, fog: true,
  });
  mat.uniforms.uMap.value = BLOD_TEX;
  mat.uniforms.uFarg.value.copy(BLOD_FARG);
  return mat;
}

// En samling partiklar med fasta buffertar (en ringbuffert: när den är full återanvänds den äldsta)
class Particles {
  constructor(scene, max, material) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute("position", plane.getAttribute("position"));
    geo.setAttribute("uv", plane.getAttribute("uv"));
    const attr = (name, k) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * k), k);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    this.aPos = attr("iPos", 3);
    this.aVel = attr("iVel", 3);
    this.aA = attr("iA", 4);
    this.aS = attr("iS", 1);
    geo.instanceCount = max;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.max = max;
    this.next = 0;
    this.alive = 0;
    this.p = Array.from({ length: max }, () => ({
      alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0, life: 0, maxLife: 1,
      cell: 0, tint: 1, stretch: 0, drag: 1, splat: false, grow: 0, frames: 0,
    }));
  }

  spawn() {
    const d = this.p[this.next];
    this.next = (this.next + 1) % this.max;
    if (!d.alive) this.alive++;
    d.alive = true;
    return d;
  }

  kill(i) {
    const d = this.p[i];
    if (d.alive) this.alive--;
    d.alive = false;
    this.aA.array[i * 4] = 0;
  }

  write(i) {
    const d = this.p[i];
    const f = d.life / d.maxLife;                      // 1 → 0
    const fade = Math.min(1, f / 0.3);                 // tonar bort sista tredjedelen
    const o3 = i * 3;
    this.aPos.array[o3] = d.pos.x; this.aPos.array[o3 + 1] = d.pos.y; this.aPos.array[o3 + 2] = d.pos.z;
    this.aVel.array[o3] = d.vel.x; this.aVel.array[o3 + 1] = d.vel.y; this.aVel.array[o3 + 2] = d.vel.z;
    const cell = d.frames ? d.cell + Math.min(d.frames - 1, Math.floor((1 - f) * d.frames)) : d.cell;
    const o4 = i * 4;
    this.aA.array[o4] = d.size * (1 + d.grow * (1 - f));
    this.aA.array[o4 + 1] = d.frames ? 1 : fade;
    this.aA.array[o4 + 2] = cell;
    this.aA.array[o4 + 3] = d.tint;
    this.aS.array[i] = d.stretch;
  }

  flush() {
    this.aPos.needsUpdate = this.aVel.needsUpdate = this.aA.needsUpdate = this.aS.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.max; i++) this.kill(i);
    this.alive = 0;
    this.flush();
  }
}

const _f = new THREE.Vector3();
const _sd = new THREE.Vector3();
const _bp = new THREE.Vector3();
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;

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

    // Blod i luften: droppar/stänk (dras ut i farten) och träffstänk (fyra bilder, en femtedels sekund)
    this.bloodMat = bloodMaterial();
    this.drops = new Particles(scene, MAX_DROPS, this.bloodMat);
    this.bursts = new Particles(scene, MAX_BURSTS, this.bloodMat);
    this.bursts.mesh.renderOrder = 4;

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
      d.mesh.material.roughness = 0.5; // fuktigt men inte glasblankt
      scene.add(d.mesh);
      this.splats.push(d);
    }
    this.pools = groundDecals(poolTexture(), MAX_POOLS, 0);
    // Pölarna har mjuk kant och är blanka (speglar himlen) tills de torkat
    this.pools.mesh.material.alphaTest = 0.02;
    this.pools.mesh.material.roughness = 0.2;
    this.pools.mesh.material.metalness = 0.15;
    scene.add(this.pools.mesh);
    this.prints = groundDecals(footprintTexture(), MAX_PRINTS, 0);
    this.prints.mesh.material.roughness = 1;
    this.prints.mesh.material.alphaTest = 0.01; // mjuk kant, inget skarpt streck
    this.prints.mesh.material.opacity = 0.7;
    scene.add(this.prints.mesh);
    this.colorTimer = 0;

    // Blodstänk på sargen (lodräta fläckar som rinner lite nedåt)
    {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0, -0.25, 0); // fläcken rinner nedåt från träffpunkten
      const mat = new THREE.MeshStandardMaterial({
        map: splatterTexture(1), transparent: true, alphaTest: 0.35, depthWrite: false,
        roughness: 0.35, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -3,
      });
      this.wall = { mesh: new THREE.InstancedMesh(geo, mat, MAX_WALL), items: new Array(MAX_WALL).fill(null), next: 0 };
      for (let i = 0; i < MAX_WALL; i++) {
        this.wall.mesh.setMatrixAt(i, HIDDEN);
        this.wall.mesh.setColorAt(i, WET);
      }
      this.wall.mesh.frustumCulled = false;
      scene.add(this.wall.mesh);
    }
    // Vem som har blod under fötterna (gick genom en pöl): id → antal blodiga steg kvar
    this.bloodyFeet = new Map();

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

  // Blod vid en träff.
  //   position = träffpunkten, amount = ungefär hur mycket, dir = bort från den som slog (vågrätt),
  //   power = slagets kraft, opts.typ = "hugg" | "stick" | "krossa" | "dropp", opts.tung = tungt slag
  // Hugg: ett brett, platt solfjäderstänk åt sidan (längs eggens väg). Stick: en smal, snabb stråle
  // framåt och lite bakåt ur såret. Krossa: kortare, rundare stänk åt alla håll och mycket fint stoft.
  blood(position, amount = 14, dir = null, power = 1, opts = {}) {
    const typ = opts.typ || "hugg";
    const tung = !!opts.tung;
    if (dir) _f.copy(dir);
    else _f.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    _f.y = 0;
    if (_f.lengthSq() < 1e-6) _f.set(1, 0, 0);
    _f.normalize();
    _sd.set(-_f.z, 0, _f.x);                             // sidled (längs hugget)
    const sida = Math.random() < 0.5 ? 1 : -1;           // åt vilket håll eggen svepte
    // Många samtidiga strider: färre partiklar när bufferten börjar bli full
    const last = this.drops.alive / MAX_DROPS;
    const n = Math.max(1, Math.round(amount * (tung ? 1.25 : 1) * (last > 0.55 ? 1 - last : 1)));
    const fart = power * (tung ? 1.2 : 1);

    for (let i = 0; i < n; i++) {
      const fin = Math.random() < (typ === "krossa" ? 0.6 : 0.45);   // fint stänk eller riktiga droppar
      let fwd, side, up, speed;
      if (typ === "stick") {
        const bak = Math.random() < 0.18;                            // lite blod sprutar tillbaka ur ingångshålet
        fwd = bak ? -0.7 : 1; side = gauss() * 0.22; up = 0.12 + Math.random() * 0.35; speed = 3.5 + Math.random() * 4.5;
      } else if (typ === "krossa") {
        fwd = 0.35 + Math.random() * 0.5; side = gauss() * 0.9; up = 0.35 + Math.random() * 0.8; speed = 1.4 + Math.random() * 2.8;
      } else if (typ === "dropp") {
        fwd = 0.1; side = gauss() * 0.3; up = -0.2; speed = 0.3 + Math.random() * 0.6;
      } else {
        fwd = 0.55 + Math.random() * 0.5; side = sida * (0.4 + Math.random() * 0.9) + gauss() * 0.25; up = 0.2 + Math.random() * 0.75; speed = 2.4 + Math.random() * 4;
      }
      _v.copy(_f).multiplyScalar(fwd).addScaledVector(_sd, side);
      _v.y += up;
      _v.normalize().multiplyScalar(speed * fart * (fin ? 0.8 : 1));
      // startpunkt: lite utspridd runt såret (och längs eggen vid hugg)
      _bp.copy(position).addScaledVector(_sd, typ === "hugg" ? (Math.random() - 0.5) * 0.18 : (Math.random() - 0.5) * 0.05);
      _bp.y += (Math.random() - 0.5) * 0.06;
      const r = Math.random();
      const size = fin ? 0.012 + Math.random() * 0.018 : r < 0.7 ? 0.014 + Math.random() * 0.012 : r < 0.95 ? 0.026 + Math.random() * 0.014 : 0.04 + Math.random() * 0.02;
      this.spawnDrop(_bp, _v, size, !fin || Math.random() < 0.25, fin ? 4 + Math.floor(Math.random() * 4) : null);
    }

    // Träffstänket: en kort, oregelbunden stänkbild i träffögonblicket (inte vid dropp)
    if (typ !== "dropp") {
      const b = this.bursts.spawn();
      b.pos.copy(position);
      if (typ === "hugg") b.vel.copy(_f).multiplyScalar(0.6).addScaledVector(_sd, sida).normalize();
      else b.vel.copy(_f).add(_v.set(0, typ === "krossa" ? 0.5 : 0.15, 0)).normalize();
      b.size = (typ === "krossa" ? 0.34 : typ === "stick" ? 0.24 : 0.3) * Math.sqrt(power) * (tung ? 1.3 : 1);
      b.grow = 0.45;
      b.life = b.maxLife = 0.16 + Math.random() * 0.06;
      b.cell = typ === "krossa" ? 12 : 8;
      b.frames = 4;
      b.tint = 0.6 + Math.random() * 0.3;
      b.stretch = 0;
      b.drag = 0;
      b.splat = false;
      // ett andra, mindre stänk för tunga slag
      if (tung) {
        const c = this.bursts.spawn();
        c.pos.copy(position).addScaledVector(_f, 0.05);
        c.vel.copy(b.vel).add(_v.set(0, 0.6, 0)).normalize();
        Object.assign(c, { size: b.size * 0.7, grow: 0.6, life: b.maxLife * 1.2, maxLife: b.maxLife * 1.2, cell: 8, frames: 4, tint: 0.5, stretch: 0, drag: 0, splat: false });
      }
      // lite mörkt stoft bara vid tunga och trubbiga träffar
      if (tung || typ === "krossa") this.mist(position, Math.min(1.2, amount / 18) * power);
    }
  }

  // Pulserande stråle ur en stump (dir = utåt från kroppen)
  spurt(position, dir, strength = 1) {
    const count = 3 + Math.floor(strength * 4);
    for (let i = 0; i < count; i++) {
      const v = _v.copy(dir).multiplyScalar(2.5 + strength * 2.5);
      v.x += (Math.random() - 0.5) * 0.8;
      v.y += 0.8 + (Math.random() - 0.5) * 0.6;
      v.z += (Math.random() - 0.5) * 0.8;
      this.spawnDrop(position, v, 0.014 + Math.random() * 0.016, Math.random() < 0.35, Math.random() < 0.5 ? 3 : 0);
    }
  }

  // En droppe. cell = bild i blod.png (null = slumpad droppform), splat = lämnar fläck där den landar
  spawnDrop(position, velocity, size, splat, cell = null) {
    const d = this.drops.spawn();
    d.pos.copy(position);
    d.vel.copy(velocity);
    d.size = size;
    const fin = cell !== null && cell >= 4;
    d.cell = cell !== null ? cell : [0, 0, 1, 2, 3][Math.floor(Math.random() * 5)];
    d.life = d.maxLife = fin ? 0.3 + Math.random() * 0.25 : 0.7 + Math.random() * 0.6;
    d.stretch = fin ? 0.06 : 0.28;
    // luftmotstånd: små droppar bromsas mer
    d.drag = fin ? 2.6 : 0.25 + 0.006 / size;
    d.tint = 0.4 + Math.random() * 0.6;
    d.grow = 0;
    d.frames = 0;
    d.splat = splat;
  }

  // Ett rött moln vid kraftiga träffar
  mist(position, strength = 1) {
    // mörkt, kort och litet (förr ett stort rosa moln)
    const n = Math.round(1 + strength * 1.5);
    for (let i = 0; i < n; i++) {
      this.spawnPuff(position, 0x3a0505, 0.28, 0.14 + Math.random() * 0.1, 0.22 + Math.random() * 0.15, 0.6 * strength, 0.05);
    }
  }

  // Ljusstyrkan på blodet i luften följer dagsljuset (kvällen mörkare)
  setLight(v) {
    this.bloodMat.uniforms.uLjus.value = v;
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

  // Stänk på sargens insida där droppen träffade
  wallSplat(x, y, z, size) {
    const i = this.wall.next;
    this.wall.next = (this.wall.next + 1) % MAX_WALL;
    // Punkten på sargen och riktningen in mot arenan
    const k = 1 / Math.hypot(x / WALL_RX, z / WALL_RZ);
    const wx = x * k;
    const wz = z * k;
    const nx = -wx / (WALL_RX * WALL_RX);
    const nz = -wz / (WALL_RZ * WALL_RZ);
    _q.setFromAxisAngle(_up, Math.atan2(nx, nz));
    _p.set(wx, Math.min(0.75, Math.max(0.08, y)), wz);
    const s = size * (0.8 + Math.random() * 0.6);
    _s.set(s, s * (1.3 + Math.random() * 0.8), 1);
    _m.compose(_p, _q, _s);
    this.wall.mesh.setMatrixAt(i, _m);
    this.wall.mesh.setColorAt(i, WET);
    this.wall.items[i] = { born: this.time };
    this.wall.mesh.instanceMatrix.needsUpdate = true;
    this.wall.mesh.instanceColor.needsUpdate = true;
  }

  // Blodpöl som sakta växer (under döda kroppar och avhuggna delar)
  pool(x, z, size = 0.8) {
    const i = this.pools.next;
    this.pools.next = (this.pools.next + 1) % MAX_POOLS;
    this.pools.items[i] = { x, z, size, born: this.time, angle: Math.random() * Math.PI * 2, sx: 0.85 + Math.random() * 0.35, sz: 0.85 + Math.random() * 0.35 };
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
  footprint(x, z, yaw, side, who = null) {
    if ((x / 13) ** 2 + (z / 10) ** 2 > 1) return;
    // Gick man genom en färsk blodpöl blir de närmaste stegen röda
    let bloody = 0;
    if (who !== null) {
      for (const p of this.pools.items) {
        if (!p || this.time - p.born > 45) continue;
        const r = p.size * 0.42 * Math.min(1, (this.time - p.born) / 6 + 0.2);
        if ((x - p.x) ** 2 + (z - p.z) ** 2 < r * r) {
          this.bloodyFeet.set(who, 9);
          break;
        }
      }
      bloody = this.bloodyFeet.get(who) || 0;
      if (bloody > 0) this.bloodyFeet.set(who, bloody - 1);
    }
    const i = this.prints.next;
    this.prints.next = (this.prints.next + 1) % MAX_PRINTS;
    const lx = side === "L" ? 0.02 : -0.02;
    _q.setFromAxisAngle(_up, yaw + Math.PI);
    _p.set(x + lx * Math.cos(yaw), 0.013, z - lx * Math.sin(yaw));
    if (this.wet) _s.set(0.15, 1, 0.33); // i leran blir spåren större
    else _s.set(0.12, 1, 0.28);
    _m.compose(_p, _q, _s);
    this.prints.mesh.setMatrixAt(i, _m);
    const base = this.wet ? MUD_PRINT : PRINT;
    const col = bloody > 0 ? new THREE.Color().copy(base).lerp(BLOODY_PRINT, Math.min(1, bloody / 6)) : base;
    this.prints.mesh.setColorAt(i, col);
    this.prints.items[i] = { born: this.time, color: col.clone() };
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
    this.drops.clear();
    this.bursts.clear();
    for (const d of this.sparkData) d.alive = false;
    this.bloodyFeet.clear();
    for (const set of [...this.splats, this.pools, this.prints, this.wall]) {
      set.items.fill(null);
      for (let i = 0; i < set.items.length; i++) set.mesh.setMatrixAt(i, HIDDEN);
      set.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- Varje bildruta ----------

  update(dt) {
    this.time += dt;

    // Droppar: tyngdkraft, luftmotstånd, kort liv. Landar de lämnar de en fläck på marken eller sargen.
    const P = this.drops;
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = P.p[i];
      if (!d.alive) continue;
      d.vel.y += GRAVITY * dt;
      d.vel.multiplyScalar(Math.max(0, 1 - d.drag * dt));
      d.pos.addScaledVector(d.vel, dt);
      d.life -= dt;
      // Träffar sargen?
      if (d.pos.y < 1.15 && (d.pos.x / WALL_RX) ** 2 + (d.pos.z / WALL_RZ) ** 2 > 1) {
        if (d.splat || d.size > 0.026) this.wallSplat(d.pos.x, d.pos.y, d.pos.z, d.size * (5 + Math.random() * 4));
        P.kill(i);
        continue;
      }
      if (d.pos.y <= 0.02 || d.life <= 0) {
        if (d.pos.y <= 0.02 && d.splat) this.splat(d.pos.x, d.pos.z, d.size * (6 + Math.random() * 5), d.vel.x, d.vel.z);
        P.kill(i);
        continue;
      }
      P.write(i);
    }
    P.flush();
    // Träffstänk: står kvar vid såret och spelar sina fyra bilder
    const Bu = this.bursts;
    for (let i = 0; i < MAX_BURSTS; i++) {
      const d = Bu.p[i];
      if (!d.alive) continue;
      d.life -= dt;
      if (d.life <= 0) {
        Bu.kill(i);
        continue;
      }
      d.pos.y -= dt * 0.4;
      Bu.write(i);
    }
    Bu.flush();

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
      // Växer snabbt först, sedan sakta vidare (och mer i regn när vattnet sprider ut blodet)
      const spread = 1 + Math.min(0.25, age / 60) + (this.wet ? Math.min(0.5, age / 30) : 0);
      const s = p.size * (0.15 + 0.85 * (1 - (1 - grow) ** 2)) * spread;
      _s.set(s * (p.sx || 1), 1, s * (p.sz || 1));
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
      for (const set of [...this.splats, this.pools, this.wall]) {
        set.items.forEach((item, i) => {
          if (!item) return;
          const age = this.time - item.born;
          if (this.wet) {
            // I regn: blodet späds ut (ljusare, rosa) och tonar sakta bort i den blöta sanden
            c.copy(WET).lerp(RAIN_BLOOD, Math.min(1, age / 8)).lerp(set === this.wall ? RAIN_BLOOD : DIRT, Math.min(0.85, Math.max(0, age - 10) / 50));
          } else {
            c.copy(WET).lerp(DRY, Math.min(1, age / 25));
          }
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
          c.copy(item.color || PRINT).lerp(DIRT, f);
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
