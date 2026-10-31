// BORGGÅRDEN – extra liv och detaljer (v0.25)
// Spår i leran, rekvisita (vedtrave, säckar, kärra, bänk med sejdlar, halmbalar), vimpelgirlanger,
// glöd från eldkorgarna, rök från facklorna, varma ljuspölar på snön, kall dis vid murarna och
// lätta snöflingor i luften. Allt är billigt: få ritanrop (instanser och sammanslagna former).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PALETTE, mat, mesh, seededRandom } from "./arena.js";
import { strawTexture, glowTexture } from "./textures.js";

// ---------- Spår i leran ----------
// En bild över hela stridsytan (upprepas inte): fotspår i slingrande stråk, skrapmärken, släpspår
// och uppkastade lerklumpar. Ligger ovanpå marken som ett genomskinligt lager.
export function tracksTexture(size = 1024) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const rand = seededRandom(5151);
  const h = size / 2;
  const inside = (r = 0.92) => {
    for (;;) {
      const x = (rand() * 2 - 1) * h * r;
      const y = (rand() * 2 - 1) * h * r;
      if (x * x + y * y < (h * r) ** 2) return [h + x, h + y];
    }
  };
  // Fotspår: par av små ovaler längs en böjd väg
  for (let trail = 0; trail < 46; trail++) {
    let [x, y] = inside(0.88);
    let dir = rand() * Math.PI * 2;
    const steps = 8 + Math.floor(rand() * 20);
    const stride = 22 + rand() * 8;
    for (let s = 0; s < steps; s++) {
      dir += (rand() - 0.5) * 0.35;
      x += Math.cos(dir) * stride * 0.5;
      y += Math.sin(dir) * stride * 0.5;
      if ((x - h) ** 2 + (y - h) ** 2 > (h * 0.95) ** 2) break;
      const side = s % 2 ? 1 : -1;
      const px = x + Math.cos(dir + Math.PI / 2) * 4.5 * side;
      const py = y + Math.sin(dir + Math.PI / 2) * 4.5 * side;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(dir);
      ctx.fillStyle = `rgba(28,18,10,${0.2 + rand() * 0.18})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.5, 2.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(190,170,150,0.12)"; // uppskjuten kant framför tån
      ctx.beginPath();
      ctx.ellipse(6, 0, 1.6, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  // Skrapmärken där någon halkat eller vridit sig
  for (let i = 0; i < 80; i++) {
    const [x, y] = inside();
    const a = rand() * Math.PI * 2;
    const len = 18 + rand() * 46;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    const g = ctx.createLinearGradient(-len / 2, 0, len / 2, 0);
    g.addColorStop(0, "rgba(25,16,8,0)");
    g.addColorStop(0.3, `rgba(25,16,8,${0.18 + rand() * 0.14})`);
    g.addColorStop(1, "rgba(25,16,8,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-len / 2, -2 - rand() * 3, len, 4 + rand() * 4);
    ctx.fillStyle = "rgba(200,180,160,0.1)";
    ctx.fillRect(-len / 2, 3, len * 0.8, 1.5);
    ctx.restore();
  }
  // Släpspår: två slingrande linjer (någon har släpats ut från planen)
  for (let i = 0; i < 7; i++) {
    let [x, y] = inside(0.75);
    let dir = rand() * Math.PI * 2;
    const len = 12 + Math.floor(rand() * 18);
    for (const off of [-5, 5]) {
      let px = x, py = y, d = dir;
      const r2 = seededRandom(900 + i);
      ctx.strokeStyle = "rgba(30,20,12,0.22)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(d + Math.PI / 2) * off, py + Math.sin(d + Math.PI / 2) * off);
      for (let s = 0; s < len; s++) {
        d += (r2() - 0.5) * 0.2;
        px += Math.cos(d) * 9;
        py += Math.sin(d) * 9;
        ctx.lineTo(px + Math.cos(d + Math.PI / 2) * off, py + Math.sin(d + Math.PI / 2) * off);
      }
      ctx.stroke();
    }
  }
  // Uppkastade lerklumpar och mörka blöta fläckar
  for (let i = 0; i < 260; i++) {
    const [x, y] = inside(0.95);
    const r = 1 + rand() * 3;
    ctx.fillStyle = `rgba(30,20,12,${0.25 + rand() * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(210,190,170,0.15)";
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 30; i++) {
    const [x, y] = inside(0.9);
    const r = 14 + rand() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(20,14,10,${0.12 + rand() * 0.1})`);
    g.addColorStop(1, "rgba(20,14,10,0)");
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.5 + rand() * 0.5);
    ctx.translate(-x, -y);
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- Rekvisita ----------
const bark = () => mat(0x4a3220);
const woodCut = () => mat(0xb8905a);

// Vedtrave med en huggkubbe och en yxa i
export function makeWoodpile(rand) {
  const g = new THREE.Group();
  for (let row = 0; row < 4; row++) {
    const n = 5 - row;
    for (let i = 0; i < n; i++) {
      const r = 0.1 + rand() * 0.025;
      const x = (i - (n - 1) / 2) * 0.23;
      const y = 0.11 + row * 0.19;
      const len = 1.1 + rand() * 0.2;
      const log = mesh(new THREE.CylinderGeometry(r, r, len, 8), 0x4a3220);
      log.rotation.x = Math.PI / 2;
      log.position.set(x, y, (rand() - 0.5) * 0.08);
      g.add(log);
      for (const s of [1, -1]) {
        const end = mesh(new THREE.CircleGeometry(r * 0.92, 8), 0xb8905a, false);
        end.position.set(x, y, log.position.z + s * (len / 2 + 0.002));
        end.rotation.y = s > 0 ? 0 : Math.PI;
        g.add(end);
      }
    }
  }
  const snow = mesh(new THREE.BoxGeometry(0.55, 0.06, 1.15), 0xf4f6fa, false);
  snow.position.y = 0.84;
  g.add(snow);
  // Huggkubbe och yxa
  const block = mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.45, 10), 0x5a3c24);
  block.position.set(0.95, 0.225, 0.2);
  g.add(block);
  const top = mesh(new THREE.CircleGeometry(0.235, 10), 0xb08a58, false);
  top.rotation.x = -Math.PI / 2;
  top.position.set(0.95, 0.452, 0.2);
  g.add(top);
  const handle = mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.7, 6), PALETTE.wood);
  handle.position.set(0.95, 0.72, 0.28);
  handle.rotation.x = 0.5;
  g.add(handle);
  const head = mesh(new THREE.BoxGeometry(0.05, 0.12, 0.2), 0x55585e);
  head.position.set(0.95, 0.47, 0.17);
  head.rotation.x = 0.5;
  g.add(head);
  for (let i = 0; i < 5; i++) {
    const chip = mesh(new THREE.BoxGeometry(0.08, 0.02, 0.04), 0xb8905a, false);
    chip.position.set(0.7 + rand() * 0.6, 0.012, -0.2 + rand() * 0.8);
    chip.rotation.y = rand() * 3;
    g.add(chip);
  }
  return g;
}

// Säckar med mjöl eller säd, knutna med rep
export function makeSacks(rand, n = 4) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const x = (i % 2) * 0.42 - 0.2 + (rand() - 0.5) * 0.08;
    const z = Math.floor(i / 2) * 0.38 + (rand() - 0.5) * 0.08;
    const lying = i === n - 1;
    const sack = mesh(new THREE.SphereGeometry(1, 10, 8), 0xa08a62);
    sack.scale.set(0.2, lying ? 0.17 : 0.3, 0.18);
    sack.position.set(x, lying ? 0.17 : 0.28, z);
    if (lying) sack.rotation.z = Math.PI / 2;
    g.add(sack);
    if (!lying) {
      const neck = mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.12, 8), 0x968058);
      neck.position.set(x, 0.6, z);
      g.add(neck);
      const tie = mesh(new THREE.TorusGeometry(0.055, 0.012, 4, 10), 0x6a5838, false);
      tie.rotation.x = Math.PI / 2;
      tie.position.set(x, 0.58, z);
      g.add(tie);
      const cap = mesh(new THREE.SphereGeometry(0.11, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xf4f6fa, false);
      cap.scale.set(1, 0.35, 1);
      cap.position.set(x, 0.55, z);
      if (rand() < 0.6) g.add(cap);
    }
  }
  return g;
}

// Kärra med två hjul, lastad med en tunna och säckar
export function makeCart(rand) {
  const g = new THREE.Group();
  const bed = new THREE.Group();
  bed.position.y = 0.55;
  bed.rotation.x = -0.12; // lutar fram mot handtagen
  g.add(bed);
  const plank = (w, h, d, x, y, z, color = PALETTE.wood) => {
    const b = mesh(new THREE.BoxGeometry(w, h, d), color);
    b.position.set(x, y, z);
    bed.add(b);
    return b;
  };
  for (let i = 0; i < 4; i++) plank(0.24, 0.05, 1.5, -0.36 + i * 0.24, 0, 0, i % 2 ? PALETTE.wood : PALETTE.woodLight);
  for (const s of [1, -1]) {
    plank(0.05, 0.28, 1.5, s * 0.49, 0.16, 0, PALETTE.woodDark);
    plank(0.04, 0.04, 2.6, s * 0.42, -0.06, 0.55, PALETTE.woodDark); // skaklar
    for (const z of [-0.6, 0, 0.6]) plank(0.06, 0.32, 0.06, s * 0.52, 0.14, z, 0x3a2a1c);
  }
  plank(1.0, 0.28, 0.05, 0, 0.16, -0.75, PALETTE.woodDark);
  // Last
  const barrel = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 12), PALETTE.wood);
  barrel.position.set(-0.18, 0.28, -0.35);
  bed.add(barrel);
  for (const y of [0.1, 0.46]) {
    const hoop = mesh(new THREE.TorusGeometry(0.23, 0.015, 4, 14), 0x2e2a28, false);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.set(-0.18, y, -0.35);
    bed.add(hoop);
  }
  const sacks = makeSacks(rand, 2);
  sacks.position.set(0.15, 0.02, 0.15);
  sacks.scale.setScalar(0.85);
  bed.add(sacks);
  const snow = mesh(new THREE.BoxGeometry(0.9, 0.04, 0.5), 0xf4f6fa, false);
  snow.position.set(0, 0.33, 0.45);
  bed.add(snow);
  // Hjulen
  for (const s of [1, -1]) {
    const wheel = new THREE.Group();
    wheel.position.set(s * 0.6, 0.45, -0.05);
    wheel.rotation.y = Math.PI / 2;
    g.add(wheel);
    const rim = mesh(new THREE.TorusGeometry(0.42, 0.045, 5, 18), PALETTE.woodDark);
    wheel.add(rim);
    const tyre = mesh(new THREE.TorusGeometry(0.455, 0.012, 4, 18), 0x3a3a3e, false);
    wheel.add(tyre);
    for (let i = 0; i < 6; i++) {
      const spoke = mesh(new THREE.BoxGeometry(0.035, 0.8, 0.035), PALETTE.wood, false);
      spoke.rotation.z = (i / 6) * Math.PI;
      wheel.add(spoke);
    }
    const hub = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 8), 0x3a2a1c);
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
  }
  return g;
}

// Bänk med sejdlar, en kanna och en bit bröd (någon har gått iväg för att titta)
export function makeBench(rand) {
  const g = new THREE.Group();
  const seat = mesh(new THREE.BoxGeometry(1.8, 0.07, 0.34), PALETTE.woodLight);
  seat.position.y = 0.46;
  g.add(seat);
  for (const x of [-0.72, 0.72]) {
    for (const z of [-0.12, 0.12]) {
      const leg = mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), PALETTE.woodDark);
      leg.position.set(x, 0.22, z);
      leg.rotation.x = z > 0 ? 0.12 : -0.12;
      g.add(leg);
    }
  }
  const brace = mesh(new THREE.BoxGeometry(1.5, 0.05, 0.04), PALETTE.woodDark);
  brace.position.set(0, 0.18, 0);
  g.add(brace);
  const mug = (x, z, color) => {
    const m = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 10), color);
    m.position.set(x, 0.555, z);
    g.add(m);
    const handle = mesh(new THREE.TorusGeometry(0.03, 0.008, 4, 8, Math.PI), color, false);
    handle.position.set(x + 0.05, 0.555, z);
    handle.rotation.z = -Math.PI / 2;
    g.add(handle);
  };
  mug(-0.5, 0.04, 0x7a5434);
  mug(-0.32, -0.06, 0x8a8e94);
  mug(0.4, 0.03, 0x7a5434);
  const jug = mesh(new THREE.SphereGeometry(0.09, 10, 8), 0x8a5a3a);
  jug.scale.set(1, 1.3, 1);
  jug.position.set(0.05, 0.6, 0.02);
  g.add(jug);
  const neck = mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.08, 8), 0x8a5a3a);
  neck.position.set(0.05, 0.74, 0.02);
  g.add(neck);
  const bread = mesh(new THREE.SphereGeometry(0.08, 8, 6), 0xc0884a);
  bread.scale.set(1.3, 0.6, 0.9);
  bread.position.set(0.7, 0.53, -0.02);
  g.add(bread);
  // Snö på ena änden av bänken
  const snow = mesh(new THREE.BoxGeometry(0.5, 0.03, 0.34), 0xf4f6fa, false);
  snow.position.set(-0.75, 0.51, 0);
  if (rand() < 0.7) g.add(snow);
  return g;
}

// Halmbalar
let strawMat = null;
export function makeHay(rand) {
  if (!strawMat) strawMat = new THREE.MeshStandardMaterial({ color: 0xd8c080, map: strawTexture(), roughness: 0.95 });
  const g = new THREE.Group();
  const bale = (x, y, z, ry) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 0.5), strawMat);
    b.position.set(x, y, z);
    b.rotation.y = ry;
    b.castShadow = b.receiveShadow = true;
    g.add(b);
    for (const k of [-0.22, 0.22]) {
      const s = mesh(new THREE.BoxGeometry(0.02, 0.43, 0.51), 0x8a7040, false);
      s.position.set(x + Math.cos(ry) * k, y, z - Math.sin(ry) * k);
      s.rotation.y = ry;
      g.add(s);
    }
  };
  bale(0, 0.21, 0, 0.1);
  bale(0.15, 0.21, 0.55, -0.15);
  bale(0.05, 0.63, 0.28, 0.3 + rand() * 0.2);
  const snow = mesh(new THREE.BoxGeometry(0.85, 0.05, 0.45), 0xf4f6fa, false);
  snow.position.set(0.05, 0.86, 0.28);
  snow.rotation.y = 0.35;
  g.add(snow);
  return g;
}

// ---------- Vimpelgirlanger ----------
// Rep med små trekantiga vimplar som hänger i bågar mellan punkter. En enda instansierad form.
export function makeGarlands(spans, colors = [PALETTE.red, PALETTE.blue, PALETTE.gold, PALETTE.white]) {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute("position", new THREE.Float32BufferAttribute([-0.11, 0, 0, 0.11, 0, 0, 0, -0.26, 0], 3));
  tri.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  let count = 0;
  const per = [];
  for (const [a, b, sag] of spans) {
    const n = Math.max(3, Math.round(a.distanceTo(b) / 0.32));
    per.push(n);
    count += n;
  }
  const flags = new THREE.InstancedMesh(tri, new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), count);
  const ropeGeos = [];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let k = 0;
  spans.forEach(([a, b, sag], si) => {
    const n = per[si];
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    ropeGeos.push(new THREE.TubeGeometry(curve, 16, 0.012, 3, false));
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const p = curve.getPoint(t);
      dummy.position.copy(p);
      dummy.rotation.set(0, Math.atan2(dir.x, dir.z) + Math.PI / 2, Math.sin(i * 1.7 + si) * 0.12);
      dummy.updateMatrix();
      flags.setMatrixAt(k, dummy.matrix);
      flags.setColorAt(k, color.set(colors[(i + si) % colors.length]));
      k++;
    }
  });
  flags.castShadow = false;
  flags.receiveShadow = true;
  const g = new THREE.Group();
  g.userData.noMerge = true;
  g.add(flags);
  const rope = new THREE.Mesh(mergeGeometries(ropeGeos), mat(0x5a4a38));
  ropeGeos.forEach((geo) => geo.dispose());
  g.add(rope);
  return g;
}

// ---------- Glöd, rök, ljuspölar, dis och snöflingor ----------

// Gnistor/glöd som stiger ur eldkorgarna (ett enda punktmoln för alla)
export function makeEmbers(sources) {
  const PER = 14;
  const n = sources.length * PER;
  const pos = new Float32Array(n * 3);
  const life = new Float32Array(n);
  const vel = [];
  for (let i = 0; i < n; i++) {
    life[i] = Math.random();
    vel.push(new THREE.Vector3());
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    map: glowTexture(), color: 0xffa040, size: 0.07, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  points.frustumCulled = false;
  points.userData.noMerge = true;
  const update = (dt, time) => {
    for (let i = 0; i < n; i++) {
      const src = sources[Math.floor(i / PER)];
      life[i] += dt * (0.45 + (i % 5) * 0.08);
      if (life[i] >= 1) {
        life[i] -= 1;
        vel[i].set((Math.random() - 0.5) * 0.4, 0.8 + Math.random() * 0.9, (Math.random() - 0.5) * 0.4);
        pos[i * 3] = src.x + (Math.random() - 0.5) * 0.3;
        pos[i * 3 + 1] = src.y;
        pos[i * 3 + 2] = src.z + (Math.random() - 0.5) * 0.3;
      }
      pos[i * 3] += (vel[i].x + Math.sin(time * 3 + i) * 0.25) * dt;
      pos[i * 3 + 1] += vel[i].y * dt;
      pos[i * 3 + 2] += (vel[i].z + Math.cos(time * 2.6 + i) * 0.25) * dt;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return { points, update };
}

// Varm ljuspöl på marken under en eld (syns tydligt mot den kalla snön)
let poolTex = null;
export function makeWarmPool(radius = 2.4) {
  if (!poolTex) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,170,90,0.85)");
    g.addColorStop(0.4, "rgba(255,130,60,0.35)");
    g.addColorStop(1, "rgba(255,110,40,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    poolTex = new THREE.CanvasTexture(c);
    poolTex.colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.renderOrder = 1;
  m.userData.noMerge = true;
  return m;
}

// Rökslinga (några mjuka bollar som stiger och växer)
let smokeMat = null;
export function makeSmoke(count = 3, color = 0x4a4644, opacity = 0.18) {
  if (!smokeMat) smokeMat = new Map();
  const g = new THREE.Group();
  g.userData.noMerge = true;
  const parts = [];
  for (let i = 0; i < count; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false }));
    s.userData.phase = i / count;
    g.add(s);
    parts.push(s);
  }
  const update = (time, rate = 0.3, rise = 1.8, grow = 1.2) => {
    for (const s of parts) {
      const k = (time * rate + s.userData.phase) % 1;
      s.position.set(Math.sin(time * 0.6 + s.userData.phase * 9) * 0.1 + k * 0.3, k * rise, k * 0.12);
      s.scale.setScalar(0.25 + k * grow);
      s.material.opacity = opacity * Math.sin(k * Math.PI);
    }
  };
  return { group: g, update };
}

// Kall dis längs murarnas fot (ger djup: det som är långt bort blir blåare och ljusare)
export function makeColdHaze(rx, rz, height = 2.4) {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 64;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.55, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0.8)");
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 64);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, height, 64, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xc8d4e2, alphaMap: tex, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.BackSide, fog: true }),
  );
  m.scale.set(rx, 1, rz);
  m.position.y = height / 2;
  m.renderOrder = 2;
  m.userData.noMerge = true;
  return m;
}

// Lätta snöflingor som alltid svävar i luften över gården (inte ett snöfall, bara lite liv)
export function makeFlurries(rx, rz, n = 320) {
  const pos = new Float32Array(n * 3);
  const rand = seededRandom(31);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rand() * 2 - 1) * rx;
    pos[i * 3 + 1] = rand() * 12;
    pos[i * 3 + 2] = (rand() * 2 - 1) * rz;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xffffff, size: 0.045, transparent: true, opacity: 0.75, depthWrite: false }));
  points.frustumCulled = false;
  points.userData.noMerge = true;
  const update = (dt, time) => {
    for (let i = 0; i < n; i++) {
      let y = pos[i * 3 + 1] - dt * (0.35 + (i % 7) * 0.05);
      pos[i * 3] += Math.sin(time * 0.7 + i * 1.3) * dt * 0.25 + dt * 0.12;
      pos[i * 3 + 2] += Math.cos(time * 0.5 + i * 0.7) * dt * 0.2;
      if (y < 0) {
        y += 12;
        pos[i * 3] = (Math.random() * 2 - 1) * rx;
        pos[i * 3 + 2] = (Math.random() * 2 - 1) * rz;
      }
      if (pos[i * 3] > rx) pos[i * 3] -= rx * 2;
      pos[i * 3 + 1] = y;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return { points, update };
}
