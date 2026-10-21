// HUVUDFILEN – startskärm, 3D-scen, styrning, kamera och spel-loop.

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { COLORS, ARENA_RX, ARENA_RZ, ROOM_CODE_RE, VERSION } from "./shared.js";
import { buildArena } from "./arena.js";
import { Knight } from "./knight.js";
import { Net } from "./net.js";

// ---------------------------------------------------------------------------
// Hjälpfunktioner
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

function loadSetting(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // privat läge e.d. – ignorera
  }
}

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // utan förväxlingsbara tecken
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function angleLerp(from, to, t) {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

function colorHex(index) {
  return (COLORS[index] ?? COLORS[0]).hex;
}

function cssColor(index) {
  return "#" + colorHex(index).toString(16).padStart(6, "0");
}

// ---------------------------------------------------------------------------
// 3D-scenen
// ---------------------------------------------------------------------------

const canvas = $("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = CONFIG.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const SKY = 0x9cc3e0;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 70, 230);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 500);

scene.add(new THREE.HemisphereLight(0xe4efff, 0x7a6448, 1.4));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.position.set(14, 24, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -22;
sun.shadow.camera.right = 22;
sun.shadow.camera.top = 22;
sun.shadow.camera.bottom = -22;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 70;
sun.shadow.bias = -0.0005;
scene.add(sun);

const arena = buildArena();
scene.add(arena.group);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Spelets tillstånd
// ---------------------------------------------------------------------------

let me = null;               // { id, name, color, knight, pos, yaw, anim }
const others = new Map();    // id -> { id, name, color, knight, target, targetYaw, anim }
let roomCode = null;
let wasFull = false;

let camYaw = 0;
let camPitch = 0.25;

// ---------------------------------------------------------------------------
// Startskärm
// ---------------------------------------------------------------------------

$("version").textContent = VERSION;

const urlRoom = (new URLSearchParams(location.search).get("rum") || "").toUpperCase();
const invited = ROOM_CODE_RE.test(urlRoom);

if (invited) {
  $("lobby-subtitle").textContent = `Du är inbjuden till rum ${urlRoom}`;
  $("join-button").textContent = "Gå med i striden";
}

const nameInput = $("name-input");
nameInput.value = loadSetting("riddarnamn", "");

let selectedColor = Math.min(COLORS.length - 1, Math.max(0, parseInt(loadSetting("riddarfarg", "0"), 10) || 0));
COLORS.forEach((c, i) => {
  const button = document.createElement("button");
  button.className = "swatch" + (i === selectedColor ? " selected" : "");
  button.style.background = cssColor(i);
  button.title = c.name;
  button.type = "button";
  button.addEventListener("click", () => {
    selectedColor = i;
    document.querySelectorAll(".swatch").forEach((el, k) => el.classList.toggle("selected", k === i));
  });
  $("color-picker").appendChild(button);
});

function showLobbyError(text) {
  $("lobby-error").textContent = text;
  $("lobby-error").hidden = false;
  $("join-button").disabled = false;
}

$("join-button").addEventListener("click", () => {
  const name = nameInput.value.trim() || "Sir Klumpig";
  saveSetting("riddarnamn", name);
  saveSetting("riddarfarg", String(selectedColor));

  roomCode = invited ? urlRoom : makeRoomCode();
  $("join-button").disabled = true;
  $("lobby-error").hidden = true;
  wasFull = false;
  net.connect(roomCode, name, selectedColor);
});

nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("join-button").click();
});

// ---------------------------------------------------------------------------
// Nätverk
// ---------------------------------------------------------------------------

const net = new Net({
  onWelcome(msg) {
    const you = msg.you;
    me = {
      id: you.id,
      name: you.name,
      color: you.color,
      knight: new Knight(colorHex(you.color)),
      pos: new THREE.Vector3(you.p[0], 0, you.p[2]),
      yaw: you.r,
      anim: 0,
    };
    camYaw = you.r;
    scene.add(me.knight.group);
    msg.players.forEach(addOther);

    history.replaceState(null, "", `?rum=${roomCode}`);
    $("room-code").textContent = roomCode;
    $("lobby").hidden = true;
    $("hud").hidden = false;
    renderPlayerList();
  },

  onJoin(player) {
    addOther(player);
    renderPlayerList();
  },

  onLeave(id) {
    const other = others.get(id);
    if (other) {
      other.knight.dispose();
      others.delete(id);
      renderPlayerList();
    }
  },

  onState(msg) {
    const other = others.get(msg.id);
    if (!other) return;
    other.target.set(msg.p[0], msg.p[1], msg.p[2]);
    other.targetYaw = msg.r;
    other.anim = msg.a;
  },

  onFull() {
    wasFull = true;
    showLobbyError("Rummet är fullt (max 6 riddare).");
  },

  onClose(wasJoined) {
    if (wasJoined) {
      showStatus("Anslutningen till servern bröts.", true);
    } else if (!wasFull) {
      showLobbyError("Kunde inte ansluta till servern. Försök igen om en stund.");
    }
  },
});

function addOther(player) {
  if (others.has(player.id)) return;
  const knight = new Knight(colorHex(player.color), player.name);
  knight.group.position.set(player.p[0], player.p[1], player.p[2]);
  knight.group.rotation.y = player.r;
  scene.add(knight.group);
  others.set(player.id, {
    id: player.id,
    name: player.name,
    color: player.color,
    knight,
    target: new THREE.Vector3(player.p[0], player.p[1], player.p[2]),
    targetYaw: player.r,
    anim: player.a || 0,
  });
}

function renderPlayerList() {
  const list = $("player-list");
  list.innerHTML = "";
  const all = [me, ...others.values()].filter(Boolean);
  all.forEach((p) => {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = cssColor(p.color);
    const label = document.createElement("span");
    label.textContent = p.name + (p === me ? " (du)" : "");
    li.append(dot, label);
    list.appendChild(li);
  });
}

function showStatus(text, withReload = false) {
  const el = $("status");
  el.textContent = text;
  if (withReload) {
    const button = document.createElement("button");
    button.className = "small";
    button.textContent = "Anslut igen";
    button.addEventListener("click", () => location.reload());
    el.appendChild(button);
  }
  el.hidden = false;
}

$("copy-link").addEventListener("click", async () => {
  const link = `${location.origin}${location.pathname}?rum=${roomCode}`;
  try {
    await navigator.clipboard.writeText(link);
    $("copy-link").textContent = "Kopierad!";
    setTimeout(() => ($("copy-link").textContent = "Kopiera inbjudningslänk"), 1500);
  } catch {
    window.prompt("Kopiera länken:", link);
  }
});

// ---------------------------------------------------------------------------
// Styrning: tangentbord och mus
// ---------------------------------------------------------------------------

const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.code));
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

canvas.addEventListener("click", () => {
  if (me && document.pointerLockElement !== canvas) canvas.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  $("click-hint").hidden = document.pointerLockElement === canvas;
});

document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== canvas) return;
  camYaw -= e.movementX * CONFIG.mouseSensitivity;
  camPitch += e.movementY * CONFIG.mouseSensitivity;
  camPitch = Math.max(CONFIG.pitchMin, Math.min(CONFIG.pitchMax, camPitch));
});

// ---------------------------------------------------------------------------
// Rörelse och kollision
// ---------------------------------------------------------------------------

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const PLAYER_RADIUS = 0.4;

function updateMe(dt) {
  forward.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  right.set(-Math.cos(camYaw), 0, Math.sin(camYaw));

  move.set(0, 0, 0);
  if (keys.has("KeyW") || keys.has("ArrowUp")) move.add(forward);
  if (keys.has("KeyS") || keys.has("ArrowDown")) move.sub(forward);
  if (keys.has("KeyD") || keys.has("ArrowRight")) move.add(right);
  if (keys.has("KeyA") || keys.has("ArrowLeft")) move.sub(right);

  const moving = move.lengthSq() > 0;
  const running = moving && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
  if (moving) {
    move.normalize().multiplyScalar((running ? CONFIG.runSpeed : CONFIG.walkSpeed) * dt);
    me.pos.add(move);
  }
  me.anim = running ? 2 : moving ? 1 : 0;

  // Riddaren tittar alltid åt samma håll som kameran (bra för närstrid senare)
  me.yaw = camYaw;

  // Knuffa bort från andra riddare
  for (const other of others.values()) {
    const dx = me.pos.x - other.knight.group.position.x;
    const dz = me.pos.z - other.knight.group.position.z;
    const dist = Math.hypot(dx, dz);
    const minDist = PLAYER_RADIUS * 2;
    if (dist < minDist && dist > 0.0001) {
      me.pos.x += (dx / dist) * (minDist - dist);
      me.pos.z += (dz / dist) * (minDist - dist);
    }
  }

  // Hinder (t.ex. mittbarriären)
  for (const c of arena.colliders) {
    const cx = Math.max(c.minX, Math.min(c.maxX, me.pos.x));
    const cz = Math.max(c.minZ, Math.min(c.maxZ, me.pos.z));
    const dx = me.pos.x - cx;
    const dz = me.pos.z - cz;
    const dist = Math.hypot(dx, dz);
    if (dist < PLAYER_RADIUS) {
      if (dist > 0.0001) {
        me.pos.x = cx + (dx / dist) * PLAYER_RADIUS;
        me.pos.z = cz + (dz / dist) * PLAYER_RADIUS;
      } else {
        me.pos.z = c.maxZ + PLAYER_RADIUS; // står mitt i: knuffa ut framåt
      }
    }
  }

  // Håll riddaren innanför staketet (ovalen)
  const rx = ARENA_RX - PLAYER_RADIUS;
  const rz = ARENA_RZ - PLAYER_RADIUS;
  const v = (me.pos.x / rx) ** 2 + (me.pos.z / rz) ** 2;
  if (v > 1) {
    const s = 1 / Math.sqrt(v);
    me.pos.x *= s;
    me.pos.z *= s;
  }

  me.knight.group.position.copy(me.pos);
  me.knight.group.rotation.y = me.yaw;
  me.knight.animate(dt, me.anim);
}

function updateOthers(dt) {
  const t = 1 - Math.exp(-dt * 12); // mjuk förflyttning mot senaste kända position
  for (const other of others.values()) {
    const group = other.knight.group;
    if (group.position.distanceTo(other.target) > 5) {
      group.position.copy(other.target); // för långt efter: hoppa direkt
    } else {
      group.position.lerp(other.target, t);
    }
    group.rotation.y = angleLerp(group.rotation.y, other.targetYaw, t);
    other.knight.animate(dt, other.anim);
  }
}

// ---------------------------------------------------------------------------
// Kamera (tredjeperson, över axeln)
// ---------------------------------------------------------------------------

const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();

function updateCamera() {
  if (!me) {
    // Startskärm: kameran svävar långsamt runt arenan
    const t = performance.now() * 0.00005;
    camera.position.set(Math.sin(t) * 24, 11, Math.cos(t) * 24);
    camera.lookAt(0, 1, 0);
    return;
  }
  forward.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  right.set(-Math.cos(camYaw), 0, Math.sin(camYaw));

  camTarget.copy(me.pos).addScaledVector(right, CONFIG.cameraShoulder);
  camTarget.y += CONFIG.cameraHeight;

  const d = CONFIG.cameraDistance;
  camPos.copy(camTarget).addScaledVector(forward, -Math.cos(camPitch) * d);
  camPos.y += Math.sin(camPitch) * d;
  camPos.y = Math.max(0.3, camPos.y);

  camera.position.copy(camPos);
  camera.lookAt(camTarget);
}

// ---------------------------------------------------------------------------
// Skicka egen position till servern (bara när något ändrats, sparar gratiskvoten)
// ---------------------------------------------------------------------------

let sendTimer = 0;
let heartbeatTimer = 0;
let lastSent = { x: NaN, z: NaN, r: NaN, a: -1 };

function updateNetwork(dt) {
  sendTimer += dt;
  heartbeatTimer += dt;
  if (sendTimer < 1 / CONFIG.sendRate) return;
  sendTimer = 0;

  const x = Math.round(me.pos.x * 100) / 100;
  const z = Math.round(me.pos.z * 100) / 100;
  const r = Math.round(me.yaw * 100) / 100;
  const changed = x !== lastSent.x || z !== lastSent.z || r !== lastSent.r || me.anim !== lastSent.a;

  if (changed || heartbeatTimer >= CONFIG.heartbeatSeconds) {
    net.send({ t: "s", p: [x, 0, z], r, a: me.anim });
    lastSent = { x, z, r, a: me.anim };
    heartbeatTimer = 0;
  }
}

// ---------------------------------------------------------------------------
// Spel-loopen: körs varje bildruta
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (me) {
    updateMe(dt);
    updateNetwork(dt);
  }
  updateOthers(dt);
  updateCamera();
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(frame);
