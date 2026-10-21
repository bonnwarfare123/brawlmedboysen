// HUVUDFILEN – startskärm, 3D-scen, styrning, strid, kamera och spel-loop.

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { COLORS, ARENA_RX, ARENA_RZ, ROOM_CODE_RE, VERSION, COMBAT } from "./shared.js";
import { buildArena } from "./arena.js";
import { Knight } from "./knight.js";
import { Effects } from "./effects.js";
import { Debris } from "./ragdoll.js";
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

function seconds() {
  return performance.now() / 1000;
}

// ---------------------------------------------------------------------------
// 3D-scenen
// ---------------------------------------------------------------------------

const canvas = $("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = CONFIG.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap; // snabbare än "mjuka" skuggor

const scene = new THREE.Scene();
const SKY = 0x9cc3e0;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 70, 230);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 500);

scene.add(new THREE.HemisphereLight(0xe4efff, 0x7a6448, 1.4));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.position.set(14, 24, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(CONFIG.shadowMapSize, CONFIG.shadowMapSize);
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

const effects = new Effects(scene);
const debris = new Debris(30, 45); // döda kroppar och avhuggna delar
const RAGDOLL_BOUNDS = { rx: ARENA_RX + 0.55, rz: ARENA_RZ + 0.55 }; // staketet

// ---------------------------------------------------------------------------
// Spelets tillstånd
// ---------------------------------------------------------------------------

// me = min egen riddare
// { id, name, color, kills, knight, pos, vy, onGround, yaw, anim, hp, dead,
//   nextQuick, nextHeavy, nextParry, staggerUntil, attackUntil, respawnAt }
let me = null;
const others = new Map(); // id -> { id, name, color, kills, knight, target, targetYaw, anim, hp, dead }
let roomCode = null;
let wasFull = false;

let camYaw = 0;
let camPitch = 0.25;
let shake = 0;

function playerById(id) {
  if (me && me.id === id) return me;
  return others.get(id) || null;
}

// ---------------------------------------------------------------------------
// Grafikläge: Hög (skuggor, skarp bild) eller Låg (för svagare datorer). Byt med G.
// ---------------------------------------------------------------------------

let lowQuality = loadSetting("grafik", "hog") === "lag";

function applyQuality() {
  renderer.setPixelRatio(lowQuality ? 1 : Math.min(window.devicePixelRatio, CONFIG.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  sun.castShadow = CONFIG.shadows && !lowQuality;
  $("quality-label").textContent = lowQuality ? "Låg" : "Hög";
  saveSetting("grafik", lowQuality ? "lag" : "hog");
}
applyQuality();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

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
// Nätverk: vad som händer när servern skickar något
// ---------------------------------------------------------------------------

const net = new Net({
  welcome(msg) {
    const you = msg.you;
    me = {
      id: you.id,
      name: you.name,
      color: you.color,
      kills: you.kills,
      knight: new Knight(colorHex(you.color)),
      corpse: null,
      pos: new THREE.Vector3(you.p[0], 0, you.p[2]),
      vy: 0,
      onGround: true,
      yaw: you.r,
      anim: 0,
      hp: you.hp,
      dead: false,
      nextQuick: 0,
      nextHeavy: 0,
      nextParry: 0,
      staggerUntil: 0,
      attackUntil: 0,
      respawnAt: 0,
    };
    camYaw = you.r;
    scene.add(me.knight.group);
    msg.players.forEach(addOther);

    history.replaceState(null, "", `?rum=${roomCode}`);
    $("room-code").textContent = roomCode;
    $("lobby").hidden = true;
    $("hud").hidden = false;
    renderPlayerList();
    renderHp();
  },

  join(msg) {
    addOther(msg.player);
    renderPlayerList();
  },

  leave(msg) {
    const other = others.get(msg.id);
    if (other) {
      other.knight.dispose();
      others.delete(msg.id);
      renderPlayerList();
    }
  },

  s(msg) {
    const other = others.get(msg.id);
    if (!other) return;
    other.target.set(msg.p[0], msg.p[1], msg.p[2]);
    other.targetYaw = msg.r;
    other.anim = msg.a;
  },

  // Någon annan börjar/slutar ladda ett tungt slag
  ch(msg) {
    const other = others.get(msg.id);
    if (other) other.knight.setCharging(msg.on === 1);
  },

  // Någon annan slår
  atk(msg) {
    const other = others.get(msg.id);
    if (other) other.knight.playAttack(msg.k);
  },

  // Någon annan parerar
  par(msg) {
    const other = others.get(msg.id);
    if (other) other.knight.playParry();
  },

  // Servern säger: ett slag pareredes
  parried(msg) {
    const defender = playerById(msg.id);
    const attacker = playerById(msg.by);
    if (defender) {
      defender.knight.playParry();
      effects.sparks(defender.knight.chestPosition(tmpVec).add(new THREE.Vector3(0, 0.2, 0)));
    }
    if (attacker) attacker.knight.playStagger();
    if (attacker === me) {
      me.staggerUntil = seconds() + COMBAT.parry.stagger;
      me.attackUntil = 0;
      stopCharging(false);
      callout("Parerad!");
    }
    if (defender === me) {
      me.nextParry = 0;
      callout("Parerat!");
    }
  },

  // Servern säger: någon blev träffad
  hit(msg) {
    const victim = playerById(msg.id);
    const attacker = playerById(msg.by);
    if (attacker) {
      attacker.kills = msg.kills;
    }
    if (!victim) return;

    victim.hp = msg.hp;
    const knight = victim.knight;
    knight.flash();
    const chest = knight.chestPosition(new THREE.Vector3());
    effects.blood(chest, msg.k === "h" ? 26 : 14);

    // Åt vilket håll flyger delarna? Bort från den som slog.
    const dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5);
    if (attacker) dir.copy(positionOf(victim)).sub(positionOf(attacker));
    dir.y = 0;
    dir.normalize();

    if (msg.sev) {
      const speed = msg.k === "h" ? 5 : 3;
      const up = msg.sev === "neck" || msg.sev === "waist" ? 4.5 : 3.5;
      debris.add(knight.sever(msg.sev, [dir.x * speed, up, dir.z * speed], scene, RAGDOLL_BOUNDS));
      effects.blood(chest, 20);
    }

    if (victim === me) {
      shake = msg.k === "h" ? 0.35 : 0.2;
      flashVignette();
      renderHp();
    } else {
      knight.setHp(msg.hp);
    }

    if (msg.dead) {
      victim.dead = true;
      effects.blood(chest, 30);
      // Kroppen blir en ragdoll; en ny (osynlig) riddare väntar på återuppståndelsen
      const force = msg.k === "h" ? 4 : 2.5;
      const corpse = knight.die([dir.x * force, 2, dir.z * force], scene, RAGDOLL_BOUNDS);
      debris.add(corpse);
      victim.corpse = corpse;
      victim.knight = createKnight(victim);
      victim.knight.group.visible = false;

      addKill(attacker ? attacker.name : "?", victim.name);
      if (victim === me) {
        me.respawnAt = seconds() + COMBAT.respawnSeconds;
        stopCharging(false);
        $("killer").textContent = attacker ? attacker.name : "okänd";
        $("death").hidden = false;
      }
      if (attacker === me) callout("Du högg ner " + victim.name + "!");
    }
    renderPlayerList();
  },

  respawn(msg) {
    const player = playerById(msg.id);
    if (!player) return;
    player.hp = msg.hp;
    player.dead = false;
    player.corpse = null;
    player.knight.group.visible = true;
    if (player === me) {
      me.pos.set(msg.p[0], 0, msg.p[2]);
      me.vy = 0;
      camYaw = msg.r;
      me.staggerUntil = 0;
      $("death").hidden = true;
      renderHp();
    } else {
      player.target.set(msg.p[0], msg.p[1], msg.p[2]);
      player.knight.group.position.copy(player.target);
      player.targetYaw = msg.r;
      player.knight.setHp(msg.hp);
    }
    renderPlayerList();
  },

  full() {
    wasFull = true;
    showLobbyError("Rummet är fullt (max 6 riddare).");
  },

  close(wasJoined) {
    if (wasJoined) {
      showStatus("Anslutningen till servern bröts.", true);
    } else if (!wasFull) {
      showLobbyError("Kunde inte ansluta till servern. Försök igen om en stund.");
    }
  },
});

const tmpVec = new THREE.Vector3();

function addOther(player) {
  if (others.has(player.id)) return;
  const knight = new Knight(colorHex(player.color), player.name);
  knight.group.position.set(player.p[0], player.p[1], player.p[2]);
  knight.group.rotation.y = player.r;
  knight.setHp(player.hp);
  scene.add(knight.group);
  if (player.dead) knight.group.visible = false;
  // Kroppsdelar som redan är avhuggna ramlar till marken
  for (const joint of player.severed || []) {
    debris.add(knight.sever(joint, [0, 0, 0], scene, RAGDOLL_BOUNDS));
  }
  others.set(player.id, {
    id: player.id,
    name: player.name,
    color: player.color,
    kills: player.kills || 0,
    knight,
    target: new THREE.Vector3(player.p[0], player.p[1], player.p[2]),
    targetYaw: player.r,
    anim: player.a || 0,
    hp: player.hp,
    dead: player.dead,
    corpse: null,
  });
}

// Ny riddare för en spelare (används vid död: den gamla kroppen blir ragdoll)
function createKnight(player) {
  const knight = new Knight(colorHex(player.color), player === me ? null : player.name);
  knight.group.position.copy(positionOf(player));
  knight.group.rotation.y = player === me ? me.yaw : player.targetYaw;
  scene.add(knight.group);
  return knight;
}

function positionOf(player) {
  return player === me ? me.pos : player.knight.group.position;
}

// ---------------------------------------------------------------------------
// Gränssnitt (HUD)
// ---------------------------------------------------------------------------

function renderPlayerList() {
  const list = $("player-list");
  list.innerHTML = "";
  const all = [me, ...others.values()].filter(Boolean).sort((a, b) => b.kills - a.kills);
  all.forEach((p) => {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = cssColor(p.color);
    const label = document.createElement("span");
    label.textContent = p.name + (p === me ? " (du)" : "");
    if (p.dead) label.className = "dead-name";
    const kills = document.createElement("span");
    kills.className = "kills";
    kills.textContent = p.kills + " ⚔";
    li.append(dot, label, kills);
    list.appendChild(li);
  });
}

function renderHp() {
  const pct = Math.max(0, (me.hp / COMBAT.maxHp) * 100);
  $("hp-fill").style.width = pct + "%";
  $("hp-fill").style.backgroundColor = pct > 50 ? "#4caf50" : pct > 25 ? "#e0a020" : "#d0302a";
  $("hp-text").textContent = Math.max(0, me.hp);
}

function setCooldown(id, readyAt, total, extraClass = null) {
  const el = $(id);
  const remaining = Math.max(0, readyAt - seconds());
  const fraction = total > 0 ? 1 - remaining / total : 1;
  el.querySelector(".cd-fill").style.width = Math.min(100, fraction * 100) + "%";
  el.classList.toggle("ready", remaining <= 0);
  el.classList.toggle("charged", extraClass === "charged");
}

function renderCooldowns() {
  if (!me) return;
  setCooldown("cd-q", me.nextQuick, COMBAT.quick.cooldown);
  if (charging) {
    const progress = Math.min(1, (seconds() - mouseDownAt) / COMBAT.heavy.charge);
    const el = $("cd-h");
    el.querySelector(".cd-fill").style.width = progress * 100 + "%";
    el.classList.toggle("charged", progress >= 1);
    el.classList.remove("ready");
  } else {
    setCooldown("cd-h", me.nextHeavy, COMBAT.heavy.cooldown);
  }
  setCooldown("cd-p", me.nextParry, COMBAT.parry.cooldown);

  if (me.dead) {
    $("respawn-timer").textContent = `Återuppstår om ${Math.max(0, Math.ceil(me.respawnAt - seconds()))}…`;
  }
}

let calloutTimer = null;
function callout(text) {
  const el = $("callout");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => el.classList.remove("show"), 900);
}

function flashVignette() {
  const el = $("damage-vignette");
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 80);
}

function addKill(killer, victim) {
  const el = document.createElement("div");
  el.className = "kill";
  el.textContent = `${killer} ⚔ ${victim}`;
  $("killfeed").prepend(el);
  setTimeout(() => (el.style.opacity = "0"), 5000);
  setTimeout(() => el.remove(), 5600);
  while ($("killfeed").children.length > 5) $("killfeed").lastChild.remove();
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
window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (!me) return;
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) tryJump();
  }
  if (e.code === "KeyG" && !e.repeat) {
    lowQuality = !lowQuality;
    applyQuality();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  if (charging) stopCharging(true);
});

const locked = () => document.pointerLockElement === canvas;

canvas.addEventListener("click", () => {
  if (me && !locked()) canvas.requestPointerLock();
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("pointerlockchange", () => {
  $("click-hint").hidden = locked();
  if (!locked() && charging) stopCharging(true);
});

document.addEventListener("mousemove", (e) => {
  if (!locked()) return;
  camYaw -= e.movementX * CONFIG.mouseSensitivity;
  camPitch += e.movementY * CONFIG.mouseSensitivity;
  camPitch = Math.max(CONFIG.pitchMin, Math.min(CONFIG.pitchMax, camPitch));
});

// --- Strid ---
let mouseDown = false;
let mouseDownAt = 0;
let charging = false;

function canAct() {
  return me && !me.dead && seconds() >= me.staggerUntil;
}

document.addEventListener("mousedown", (e) => {
  if (!locked() || !me) return;
  if (e.button === 0) {
    mouseDown = true;
    mouseDownAt = seconds();
  } else if (e.button === 2) {
    tryParry();
  }
});

document.addEventListener("mouseup", (e) => {
  if (e.button !== 0 || !mouseDown) return;
  mouseDown = false;
  if (!me) return;

  if (charging) {
    const held = seconds() - mouseDownAt;
    if (held >= COMBAT.heavy.charge) {
      stopCharging(false);
      tryAttack("h");
    } else {
      stopCharging(true); // släppte för tidigt: blir ett snabbt slag i stället
      tryAttack("q");
    }
  } else {
    tryAttack("q");
  }
});

// Anropas varje bildruta: håller man inne tillräckligt länge börjar laddningen
function updateCharging() {
  if (!mouseDown || charging || !canAct()) return;
  if (seconds() - mouseDownAt < CONFIG.holdForHeavy) return;
  if (seconds() < me.nextHeavy) return;
  charging = true;
  me.knight.setCharging(true);
  net.send({ t: "ch", on: 1 });
}

function stopCharging(tellServer) {
  if (!charging) return;
  charging = false;
  if (me) me.knight.setCharging(false);
  if (tellServer) net.send({ t: "ch", on: 0 });
}

function tryAttack(kind) {
  if (!canAct()) return;
  const t = seconds();
  if (kind === "h" ? t < me.nextHeavy : t < me.nextQuick) return;

  const spec = kind === "h" ? COMBAT.heavy : COMBAT.quick;
  me.nextQuick = t + COMBAT.quick.cooldown;
  me.nextHeavy = t + (kind === "h" ? COMBAT.heavy.cooldown : COMBAT.quick.cooldown);
  me.attackUntil = t + spec.windup + 0.15;
  me.knight.playAttack(kind); // visa slaget direkt, servern avgör om det träffar
  sendStateNow(); // se till att servern har exakt var vi står och tittar
  net.send({ t: "atk", k: kind });
}

function tryParry() {
  if (!canAct() || seconds() < me.nextParry) return;
  me.nextParry = seconds() + COMBAT.parry.cooldown;
  me.knight.playParry();
  sendStateNow();
  net.send({ t: "par" });
}

function tryJump() {
  if (!me || me.dead || !me.onGround) return;
  me.vy = CONFIG.jumpSpeed;
  me.onGround = false;
}

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
  if (!me.dead) {
    if (keys.has("KeyW") || keys.has("ArrowUp")) move.add(forward);
    if (keys.has("KeyS") || keys.has("ArrowDown")) move.sub(forward);
    if (keys.has("KeyD") || keys.has("ArrowRight")) move.add(right);
    if (keys.has("KeyA") || keys.has("ArrowLeft")) move.sub(right);
  }

  const t = seconds();
  const moving = move.lengthSq() > 0;
  const running = moving && !charging && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
  if (moving) {
    let speed = running ? CONFIG.runSpeed : CONFIG.walkSpeed;
    speed *= COMBAT.legLossSpeed[Math.min(2, me.knight.legLoss)]; // avhuggna ben gör en långsam
    if (t < me.staggerUntil) speed *= CONFIG.staggerMoveFactor;
    else if (charging) speed *= CONFIG.chargeMoveFactor;
    else if (t < me.attackUntil) speed *= CONFIG.attackMoveFactor;
    move.normalize().multiplyScalar(speed * dt);
    me.pos.add(move);
  }
  me.anim = me.dead ? 0 : running ? 2 : moving ? 1 : 0;

  // Hopp och tyngdkraft
  if (!me.onGround) {
    me.vy -= CONFIG.gravity * dt;
    me.pos.y += me.vy * dt;
    if (me.pos.y <= 0) {
      me.pos.y = 0;
      me.vy = 0;
      me.onGround = true;
    }
  }

  // Riddaren tittar alltid åt samma håll som kameran (så man slår dit man tittar)
  if (!me.dead) me.yaw = camYaw;

  // Knuffa bort från andra levande riddare
  for (const other of others.values()) {
    if (other.dead) continue;
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
    if (dist < PLAYER_RADIUS && me.pos.y < 1.1) {
      if (dist > 0.0001) {
        me.pos.x = cx + (dx / dist) * PLAYER_RADIUS;
        me.pos.z = cz + (dz / dist) * PLAYER_RADIUS;
      } else {
        me.pos.z = c.maxZ + PLAYER_RADIUS;
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
  if (!me.dead) me.knight.animate(dt, me.anim);
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
    if (other.dead) continue; // kroppen är en ragdoll, den nya riddaren är osynlig
    group.rotation.y = angleLerp(group.rotation.y, other.targetYaw, t);
    other.knight.animate(dt, other.anim);
  }
}

// ---------------------------------------------------------------------------
// Kamera (tredjeperson, över axeln)
// ---------------------------------------------------------------------------

const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();

function updateCamera(dt) {
  if (!me) {
    // Startskärm: kameran svävar långsamt runt arenan
    const t = performance.now() * 0.00005;
    camera.position.set(Math.sin(t) * 24, 11, Math.cos(t) * 24);
    camera.lookAt(0, 1, 0);
    return;
  }
  forward.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  right.set(-Math.cos(camYaw), 0, Math.sin(camYaw));

  if (me.dead && me.corpse) {
    // Död: kameran följer den egna kroppen
    const c = me.corpse.center();
    camTarget.set(c[0], c[1] + 0.6, c[2]);
  } else {
    camTarget.copy(me.pos).addScaledVector(right, CONFIG.cameraShoulder);
    camTarget.y = me.pos.y * 0.6 + CONFIG.cameraHeight;
  }

  // Död: kameran drar sig bakåt och tittar ner på kroppen
  const d = CONFIG.cameraDistance + (me.dead ? 2.5 : 0);
  const pitch = me.dead ? Math.max(camPitch, 0.6) : camPitch;
  camPos.copy(camTarget).addScaledVector(forward, -Math.cos(pitch) * d);
  camPos.y += Math.sin(pitch) * d;
  camPos.y = Math.max(0.3, camPos.y);

  // Skakning vid träff
  if (shake > 0) {
    shake = Math.max(0, shake - dt);
    const s = shake * 0.35;
    camPos.x += (Math.random() - 0.5) * s;
    camPos.y += (Math.random() - 0.5) * s;
    camPos.z += (Math.random() - 0.5) * s;
  }

  camera.position.copy(camPos);
  camera.lookAt(camTarget);
}

// ---------------------------------------------------------------------------
// Skicka egen position till servern (bara när något ändrats, sparar gratiskvoten)
// ---------------------------------------------------------------------------

let sendTimer = 0;
let heartbeatTimer = 0;
let lastSent = { x: NaN, y: NaN, z: NaN, r: NaN, a: -1 };

function sendStateNow() {
  const x = Math.round(me.pos.x * 100) / 100;
  const y = Math.round(me.pos.y * 100) / 100;
  const z = Math.round(me.pos.z * 100) / 100;
  const r = Math.round(me.yaw * 100) / 100;
  net.send({ t: "s", p: [x, y, z], r, a: me.anim });
  lastSent = { x, y, z, r, a: me.anim };
  heartbeatTimer = 0;
  sendTimer = 0;
}

function updateNetwork(dt) {
  sendTimer += dt;
  heartbeatTimer += dt;
  if (sendTimer < 1 / CONFIG.sendRate) return;
  sendTimer = 0;
  if (me.dead) return; // servern ignorerar ändå positioner medan man är död

  const x = Math.round(me.pos.x * 100) / 100;
  const y = Math.round(me.pos.y * 100) / 100;
  const z = Math.round(me.pos.z * 100) / 100;
  const r = Math.round(me.yaw * 100) / 100;
  const changed = x !== lastSent.x || y !== lastSent.y || z !== lastSent.z || r !== lastSent.r || me.anim !== lastSent.a;

  if (changed || heartbeatTimer >= CONFIG.heartbeatSeconds) sendStateNow();
}

// Stumparna sprutar blod en stund efter att en kroppsdel huggits av
function updateBleeding(dt) {
  const knights = [me, ...others.values()].filter((p) => p && !p.dead).map((p) => p.knight);
  for (const knight of knights) {
    knight.forEachBleedingStump(dt, (pos, age) => {
      if (Math.random() < dt * 14 * (1 - age / 3)) effects.blood(pos, 2);
    });
  }
}

// ---------------------------------------------------------------------------
// Spel-loopen: körs varje bildruta
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();
let fpsFrames = 0;
let fpsStart = performance.now();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);

  // FPS-mätare (uppdateras varje halv sekund)
  fpsFrames++;
  const now = performance.now();
  if (now - fpsStart >= 500) {
    $("perf").firstChild.textContent = `FPS: ${Math.round((fpsFrames * 1000) / (now - fpsStart))} · Grafik: `;
    fpsFrames = 0;
    fpsStart = now;
  }

  if (me) {
    updateCharging();
    updateMe(dt);
    updateNetwork(dt);
    renderCooldowns();
  }
  updateOthers(dt);
  updateBleeding(dt);
  debris.update(dt);
  effects.update(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(frame);
