// HUVUDFILEN – startskärm, lobby, rundor, 3D-scen, styrning, strid, kamera och spel-loop.

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { COLORS, ARENA_RX, ARENA_RZ, ROOM_CODE_RE, VERSION, COMBAT, MATCH } from "./shared.js";
import { buildArena } from "./arena.js";
import { Knight } from "./knight.js";
import { Effects } from "./effects.js";
import { Debris } from "./ragdoll.js";
import { Sound } from "./sound.js";
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
const sound = new Sound(loadSetting("ljud", "pa") === "av", loadSetting("musik", "pa") === "pa");

// ---------------------------------------------------------------------------
// Spelets tillstånd
// ---------------------------------------------------------------------------

// me = min egen riddare
// { id, name, color, kills, wins, knight, corpse, pos, vy, onGround, yaw, anim, hp, dead,
//   nextQuick, nextHeavy, nextParry, staggerUntil, attackUntil, diedAt }
let me = null;
const others = new Map(); // id -> { id, name, color, kills, wins, knight, corpse, target, targetYaw, anim, hp, dead }
let roomCode = null;
let wasFull = false;

// Fas från servern: lobby | countdown | round | roundEnd | matchEnd
let phase = "start";
let hostId = null;
let round = 0;
let countdownTimers = [];

let camYaw = 0;
let camPitch = 0.25;
let shake = 0;

function setPhase(p) {
  phase = p;
  document.body.dataset.phase = p;
}

function allPlayers() {
  return [me, ...others.values()].filter(Boolean);
}

function playerById(id) {
  if (me && me.id === id) return me;
  return others.get(id) || null;
}

function positionOf(player) {
  return player === me ? me.pos : player.knight.group.position;
}

// ---------------------------------------------------------------------------
// Grafik och ljud: G = byt grafikläge, M = ljud av/på
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

function applySound() {
  $("sound-label").textContent = sound.muted ? "Av" : "På";
  $("music-label").textContent = sound.musicOn ? "På" : "Av";
  saveSetting("ljud", sound.muted ? "av" : "pa");
  saveSetting("musik", sound.musicOn ? "pa" : "av");
}
applySound();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Startskärm (namn och färg)
// ---------------------------------------------------------------------------

$("version").textContent = VERSION;
$("rounds-to-win").textContent = MATCH.roundsToWin;

const urlRoom = (new URLSearchParams(location.search).get("rum") || "").toUpperCase();
const invited = ROOM_CODE_RE.test(urlRoom);

if (invited) {
  $("lobby-subtitle").textContent = `Du är inbjuden till rum ${urlRoom}`;
  $("join-button").textContent = "Gå med";
}

const nameInput = $("name-input");
nameInput.value = loadSetting("riddarnamn", "");

let selectedColor = Math.min(COLORS.length - 1, Math.max(0, parseInt(loadSetting("riddarfarg", "0"), 10) || 0));

function makeSwatches(container, isSelected, isDisabled, onPick) {
  container.innerHTML = "";
  COLORS.forEach((c, i) => {
    const button = document.createElement("button");
    button.className = "swatch" + (isSelected(i) ? " selected" : "");
    button.style.background = cssColor(i);
    button.title = c.name;
    button.type = "button";
    button.disabled = isDisabled(i);
    button.addEventListener("click", () => onPick(i));
    container.appendChild(button);
  });
}

function renderStartSwatches() {
  makeSwatches($("color-picker"), (i) => i === selectedColor, () => false, (i) => {
    selectedColor = i;
    renderStartSwatches();
  });
}
renderStartSwatches();

function showLobbyError(text) {
  $("lobby-error").textContent = text;
  $("lobby-error").hidden = false;
  $("join-button").disabled = false;
}

$("join-button").addEventListener("click", () => {
  const name = nameInput.value.trim() || "Sir Klumpig";
  saveSetting("riddarnamn", name);
  saveSetting("riddarfarg", String(selectedColor));
  sound.unlock(); // webbläsaren tillåter ljud först efter ett klick

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
// Riddare: skapa, placera i lobbyn, bygga om inför runda
// ---------------------------------------------------------------------------

function createKnight(player) {
  const knight = new Knight(colorHex(player.color), player === me ? null : player.name);
  knight.group.userData.playerId = player.id;
  scene.add(knight.group);
  return knight;
}

// Ersätt spelarens riddare med en ny hel (t.ex. ny runda eller ny färg)
function rebuildKnight(player) {
  if (player.knight && player.knight.group.parent) player.knight.group.removeFromParent();
  player.knight = createKnight(player);
  player.knight.setHp(player.hp);
}

// I lobbyn står alla riddare på rad framför kameran
function lineup() {
  const list = allPlayers();
  list.forEach((p, i) => {
    const x = (i - (list.length - 1) / 2) * 1.5;
    const pos = new THREE.Vector3(x, 0, 2);
    if (p === me) {
      me.pos.copy(pos);
      me.yaw = 0;
    } else {
      p.target.copy(pos);
      p.targetYaw = 0;
    }
    p.knight.group.position.copy(pos);
    p.knight.group.rotation.y = 0;
    p.knight.group.visible = true;
  });
}

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
      wins: you.wins,
      knight: null,
      corpse: null,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(), // fart i sidled (mjukas upp för acceleration)
      vy: 0,
      onGround: true,
      yaw: 0,
      anim: 0,
      hp: you.hp,
      dead: you.dead,
      nextQuick: 0,
      nextHeavy: 0,
      nextParry: 0,
      staggerUntil: 0,
      attackUntil: 0,
      diedAt: 0,
    };
    me.knight = createKnight(me);
    msg.players.forEach(addOther);
    hostId = msg.host;
    round = msg.round;

    sound.startMusic(msg.phase !== "lobby");
    history.replaceState(null, "", `?rum=${roomCode}`);
    $("room-code").textContent = roomCode;
    $("lobby-room-code").textContent = roomCode;
    $("lobby").hidden = true;
    $("hud").hidden = false;

    if (msg.phase === "lobby") {
      enterLobby();
    } else {
      // Matchen pågår redan: titta på tills nästa runda
      setPhase(msg.phase);
      me.knight.group.visible = false;
      me.diedAt = -100;
      $("spectate").hidden = false;
      updateRoundBanner();
    }
    renderPlayerList();
    renderHp();
  },

  join(msg) {
    addOther(msg.player);
    if (phase === "lobby") lineup();
    renderPlayerList();
    renderLobby();
  },

  leave(msg) {
    const other = others.get(msg.id);
    if (other) {
      other.knight.dispose();
      others.delete(msg.id);
      if (phase === "lobby") lineup();
      renderPlayerList();
      renderLobby();
    }
  },

  host(msg) {
    hostId = msg.id;
    renderPlayerList();
    renderLobby();
  },

  color(msg) {
    const player = playerById(msg.id);
    if (!player) return;
    player.color = msg.color;
    if (player === me) {
      selectedColor = msg.color;
      saveSetting("riddarfarg", String(msg.color));
    }
    rebuildKnight(player);
    if (phase === "lobby") lineup();
    renderPlayerList();
    renderLobby();
  },

  // ----- Rundor -----

  countdown(msg) {
    setPhase("countdown");
    sound.setBattleMusic(true);
    round = msg.round;
    $("match-lobby").hidden = true;
    $("scoreboard").hidden = true;
    $("spectate").hidden = true;
    $("death").hidden = true;
    stopCharging(false);

    // Alla får en ny, hel riddare på sin startplats
    for (const s of msg.players) {
      const player = playerById(s.id);
      if (!player) continue;
      player.hp = COMBAT.maxHp;
      player.dead = false;
      player.corpse = null;
      rebuildKnight(player);
      if (player === me) {
        me.pos.set(s.p[0], 0, s.p[2]);
        me.vel.set(0, 0, 0);
        me.vy = 0;
        me.onGround = true;
        me.yaw = s.r;
        camYaw = s.r;
        camPitch = 0.25;
        me.staggerUntil = 0;
        me.nextQuick = me.nextHeavy = me.nextParry = 0;
      } else {
        player.target.set(s.p[0], s.p[1], s.p[2]);
        player.targetYaw = s.r;
        player.knight.group.position.copy(player.target);
        player.knight.group.rotation.y = s.r;
      }
    }
    renderHp();
    renderPlayerList();
    updateRoundBanner();

    // Nedräkning på skärmen: 3, 2, 1 (sedan "STRID!" när servern säger till)
    countdownTimers.forEach(clearTimeout);
    countdownTimers = [];
    for (let i = msg.seconds; i >= 1; i--) {
      countdownTimers.push(setTimeout(() => {
        callout(i === msg.seconds ? `Runda ${round} – ${i}` : String(i), 900);
        sound.countdownBeat();
      }, (msg.seconds - i) * 1000));
    }
  },

  round() {
    setPhase("round");
    callout("STRID!", 900);
    sound.battleHorn();
    arena.cheer(0.8);
    updateRoundBanner();
  },

  roundEnd(msg) {
    setPhase("roundEnd");
    applyWins(msg.wins);
    const winner = msg.winner && playerById(msg.winner);
    if (winner) {
      callout(winner === me ? "Du vann rundan!" : `${winner.name} vann rundan!`, 2500);
    } else {
      callout("Ingen vann rundan!", 2500);
    }
    sound.roundWin();
    arena.cheer(1);
    renderPlayerList();
    updateRoundBanner();
  },

  matchEnd(msg) {
    setPhase("matchEnd");
    applyWins(msg.wins);
    for (const [id, k] of Object.entries(msg.kills)) {
      const p = playerById(id);
      if (p) p.kills = k;
    }
    const winner = playerById(msg.winner);
    $("match-winner").textContent = winner ? (winner === me ? "Du vann matchen! 👑" : `${winner.name} vann matchen! 👑`) : "Matchen är slut";
    const tbody = $("score-table").querySelector("tbody");
    tbody.innerHTML = "";
    allPlayers()
      .sort((a, b) => b.wins - a.wins || b.kills - a.kills)
      .forEach((p) => {
        const tr = document.createElement("tr");
        if (winner && p.id === winner.id) tr.className = "winner";
        const name = document.createElement("td");
        name.textContent = p.name + (p === me ? " (du)" : "");
        const wins = document.createElement("td");
        wins.textContent = p.wins;
        const kills = document.createElement("td");
        kills.textContent = p.kills;
        tr.append(name, wins, kills);
        tbody.appendChild(tr);
      });
    $("scoreboard").hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
    sound.matchWin();
    arena.cheer(1.5);
    sound.setBattleMusic(false);
    renderPlayerList();
  },

  lobby() {
    for (const p of allPlayers()) {
      p.hp = COMBAT.maxHp;
      p.dead = false;
      p.corpse = null;
      p.wins = 0;
      rebuildKnight(p);
    }
    enterLobby();
    renderPlayerList();
  },

  // ----- Strid -----

  s(msg) {
    const other = others.get(msg.id);
    if (!other) return;
    other.target.set(msg.p[0], msg.p[1], msg.p[2]);
    other.targetYaw = msg.r;
    other.anim = msg.a;
  },

  ch(msg) {
    const other = others.get(msg.id);
    if (other) other.knight.setCharging(msg.on === 1);
  },

  atk(msg) {
    const other = others.get(msg.id);
    if (!other) return;
    other.knight.playAttack(msg.k);
    sound.swing(other.knight.group.position, msg.k === "h");
  },

  par(msg) {
    const other = others.get(msg.id);
    if (other) other.knight.playParry();
  },

  parried(msg) {
    const defender = playerById(msg.id);
    const attacker = playerById(msg.by);
    if (defender) {
      defender.knight.playParry();
      const spot = defender.knight.chestPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.2, 0));
      effects.sparks(spot);
      sound.clang(spot);
      arena.cheer(0.4);
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

  hit(msg) {
    const victim = playerById(msg.id);
    const attacker = playerById(msg.by);
    if (attacker) attacker.kills = msg.kills;
    if (!victim) return;

    victim.hp = msg.hp;
    const knight = victim.knight;
    knight.setHighlight(null);
    if (highlightedKnight === knight) highlightedKnight = null;
    knight.flash();
    const chest = knight.chestPosition(new THREE.Vector3());
    // Blodet sprutar där träffen landade (den siktade kroppsdelen), annars från bröstet
    const spot = (msg.seg && knight.segmentPosition(msg.seg, new THREE.Vector3())) || chest;
    effects.blood(spot, msg.k === "h" ? 26 : 14);
    sound.hit(spot, msg.k === "h");
    if (!msg.dead) sound.hurt(spot, voiceOf(victim));

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
      sound.sever(chest);
      sound.crowd(msg.sev === "neck" || msg.sev === "waist" ? 1 : 0.6);
      arena.cheer(msg.sev === "neck" || msg.sev === "waist" ? 1.2 : 0.7);
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
      sound.scream(chest, voiceOf(victim));
      arena.cheer(1);
      // Kroppen blir en ragdoll; en osynlig ny riddare står kvar tills nästa runda
      const force = msg.k === "h" ? 4 : 2.5;
      const corpse = knight.die([dir.x * force, 2, dir.z * force], scene, RAGDOLL_BOUNDS);
      debris.add(corpse);
      victim.corpse = corpse;
      victim.knight = createKnight(victim);
      victim.knight.group.position.copy(positionOf(victim));
      victim.knight.group.visible = false;

      addKill(attacker ? attacker.name : "?", victim.name);
      if (victim === me) {
        me.diedAt = seconds();
        stopCharging(false);
        $("killer").textContent = attacker ? attacker.name : "okänd";
        $("death").hidden = false;
      }
      if (attacker === me) callout("Du högg ner " + victim.name + "!");
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

function addOther(player) {
  if (others.has(player.id)) return;
  const other = {
    id: player.id,
    name: player.name,
    color: player.color,
    kills: player.kills || 0,
    wins: player.wins || 0,
    knight: null,
    corpse: null,
    target: new THREE.Vector3(player.p[0], player.p[1], player.p[2]),
    targetYaw: player.r,
    vel: new THREE.Vector3(),
    anim: player.a || 0,
    hp: player.hp,
    dead: player.dead,
  };
  others.set(player.id, other);
  other.knight = createKnight(other);
  other.knight.group.position.copy(other.target);
  other.knight.group.rotation.y = player.r;
  other.knight.setHp(player.hp);
  if (player.dead) other.knight.group.visible = false;
  // Kroppsdelar som redan är avhuggna ramlar till marken
  for (const joint of player.severed || []) {
    debris.add(other.knight.sever(joint, [0, 0, 0], scene, RAGDOLL_BOUNDS));
  }
}

// Varje riddare får sin egen röst (ljusare eller mörkare), räknad från spelarens id
function voiceOf(player) {
  let h = 0;
  for (const ch of player.id) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return h / 997;
}

function applyWins(wins) {
  for (const [id, w] of Object.entries(wins || {})) {
    const p = playerById(id);
    if (p) p.wins = w;
  }
}

// ---------------------------------------------------------------------------
// Lobbyn
// ---------------------------------------------------------------------------

function enterLobby() {
  setPhase("lobby");
  sound.setBattleMusic(false);
  round = 0;
  countdownTimers.forEach(clearTimeout);
  countdownTimers = [];
  if (document.pointerLockElement) document.exitPointerLock();
  $("scoreboard").hidden = true;
  $("death").hidden = true;
  $("spectate").hidden = true;
  $("match-lobby").hidden = false;
  stopCharging(false);
  debris.clear();
  effects.clear();
  if (me) me.dead = false;
  lineup();
  renderLobby();
  updateRoundBanner();
}

function renderLobby() {
  if (!me) return;
  const list = $("lobby-players");
  list.innerHTML = "";
  for (const p of allPlayers()) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = cssColor(p.color);
    const label = document.createElement("span");
    label.textContent = (p.id === hostId ? "👑 " : "") + p.name + (p === me ? " (du)" : "");
    li.append(dot, label);
    list.appendChild(li);
  }

  const taken = new Set([...others.values()].map((p) => p.color));
  makeSwatches($("lobby-colors"), (i) => i === me.color, (i) => taken.has(i), (i) => {
    if (i !== me.color) net.send({ t: "color", color: i });
  });

  const isHost = me.id === hostId;
  const count = allPlayers().length;
  $("start-button").hidden = !isHost;
  $("start-button").disabled = count < MATCH.minPlayers;
  if (isHost) {
    $("lobby-wait").textContent = count < MATCH.minPlayers
      ? "Skicka inbjudningslänken till dina vänner – minst två riddare behövs."
      : "Alla redo? Starta när du vill!";
  } else {
    const host = playerById(hostId);
    $("lobby-wait").textContent = `Väntar på att ${host ? host.name : "lobbyledaren"} startar matchen…`;
  }
}

$("start-button").addEventListener("click", () => {
  sound.unlock();
  net.send({ t: "start" });
});

function updateRoundBanner() {
  const inMatch = phase === "countdown" || phase === "round" || phase === "roundEnd";
  $("round-banner").textContent = inMatch ? `Runda ${round} · först till ${MATCH.roundsToWin}` : "";
}

// ---------------------------------------------------------------------------
// Gränssnitt (HUD)
// ---------------------------------------------------------------------------

function renderPlayerList() {
  const list = $("player-list");
  list.innerHTML = "";
  allPlayers()
    .sort((a, b) => b.wins - a.wins || b.kills - a.kills)
    .forEach((p) => {
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = cssColor(p.color);
      const label = document.createElement("span");
      label.textContent = (p.id === hostId ? "👑 " : "") + p.name + (p === me ? " (du)" : "");
      if (p.dead) label.className = "dead-name";
      const score = document.createElement("span");
      score.className = "kills";
      score.textContent = `${p.wins} 🏆 ${p.kills} ⚔`;
      li.append(dot, label, score);
      list.appendChild(li);
    });
}

function renderHp() {
  if (!me) return;
  const pct = Math.max(0, (me.hp / COMBAT.maxHp) * 100);
  $("hp-fill").style.width = pct + "%";
  $("hp-fill").style.backgroundColor = pct > 50 ? "#4caf50" : pct > 25 ? "#e0a020" : "#d0302a";
  $("hp-text").textContent = Math.max(0, me.hp);
}

function setCooldown(id, readyAt, total) {
  const el = $(id);
  const remaining = Math.max(0, readyAt - seconds());
  const fraction = total > 0 ? 1 - remaining / total : 1;
  el.querySelector(".cd-fill").style.width = Math.min(100, fraction * 100) + "%";
  el.classList.toggle("ready", remaining <= 0);
  el.classList.remove("charged");
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
  if (me.dead) $("respawn-timer").textContent = "Väntar på nästa runda…";
}

let calloutTimer = null;
function callout(text, ms = 900) {
  const el = $("callout");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => el.classList.remove("show"), ms);
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

async function copyInviteLink(button) {
  const link = `${location.origin}${location.pathname}?rum=${roomCode}`;
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(link);
    button.textContent = "Kopierad!";
    setTimeout(() => (button.textContent = original), 1500);
  } catch {
    window.prompt("Kopiera länken:", link);
  }
}
$("copy-link").addEventListener("click", (e) => copyInviteLink(e.currentTarget));
$("lobby-copy-link").addEventListener("click", (e) => copyInviteLink(e.currentTarget));

// ---------------------------------------------------------------------------
// Styrning: tangentbord och mus
// ---------------------------------------------------------------------------

const keys = new Set();
window.addEventListener("keydown", (e) => {
  if (document.activeElement === nameInput) return;
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
  if (e.code === "KeyM" && !e.repeat) {
    sound.unlock();
    sound.setMuted(!sound.muted);
    applySound();
  }
  if (e.code === "KeyN" && !e.repeat) {
    sound.unlock();
    sound.setMusic(!sound.musicOn);
    applySound();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  if (charging) stopCharging(true);
});

const locked = () => document.pointerLockElement === canvas;
const playing = () => phase === "countdown" || phase === "round" || phase === "roundEnd";

canvas.addEventListener("click", () => {
  if (me && playing() && !locked()) canvas.requestPointerLock();
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
  return me && phase === "round" && !me.dead && seconds() >= me.staggerUntil;
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
  sound.swing(me.pos, kind === "h");
  sendStateNow(); // se till att servern har exakt var vi står och tittar
  const msg = { t: "atk", k: kind };
  if (aim) msg.aim = { id: aim.id, seg: aim.seg }; // kroppsdelen under siktet
  net.send(msg);
}

function tryParry() {
  if (!canAct() || seconds() < me.nextParry) return;
  me.nextParry = seconds() + COMBAT.parry.cooldown;
  me.knight.playParry();
  sendStateNow();
  net.send({ t: "par" });
}

function tryJump() {
  if (!me || me.dead || !me.onGround || phase !== "round") return;
  me.vy = CONFIG.jumpSpeed;
  me.onGround = false;
}

// ---------------------------------------------------------------------------
// Siktet: vilken kroppsdel på vilken motståndare pekar mitten av skärmen på?
// ---------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
raycaster.camera = camera;
const screenCenter = new THREE.Vector2(0, 0);
let aim = null; // { id, seg }
let highlightedKnight = null;

function updateAim() {
  aim = null;
  if (phase !== "round" || !me || me.dead) {
    $("crosshair").classList.remove("on-target");
    if (highlightedKnight) highlightedKnight.setHighlight(null);
    highlightedKnight = null;
    return;
  }
  const targets = [...others.values()].filter((o) => !o.dead && o.knight.group.visible).map((o) => o.knight.group);
  raycaster.setFromCamera(screenCenter, camera);
  raycaster.far = CONFIG.cameraDistance + COMBAT.heavy.reach + 2;
  const hits = raycaster.intersectObjects(targets, true);
  for (const hit of hits) {
    if (!hit.object.isMesh) continue; // t.ex. namnskylten
    let seg = null;
    let equipment = false;
    let obj = hit.object;
    while (obj) {
      if (obj.userData?.equipment) equipment = true;
      if (!seg && obj.userData?.segment) seg = obj.userData.segment;
      if (obj.userData?.playerId) {
        if (!equipment && seg) aim = { id: obj.userData.playerId, seg };
        break;
      }
      obj = obj.parent;
    }
    if (aim) break;
  }
  $("crosshair").classList.toggle("on-target", aim !== null);

  // Lys upp kroppsdelen under siktet
  const knight = aim ? others.get(aim.id)?.knight : null;
  if (highlightedKnight && highlightedKnight !== knight) highlightedKnight.setHighlight(null);
  if (knight) knight.setHighlight(aim.seg);
  highlightedKnight = knight;
}

// ---------------------------------------------------------------------------
// Rörelse och kollision
// ---------------------------------------------------------------------------

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const wantedVel = new THREE.Vector3();
const PLAYER_RADIUS = 0.4;

// Riddarens fart uttryckt framåt/åt sidan i förhållande till dit den tittar
function motionOf(vel, yaw, airborne) {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  return {
    speed: Math.hypot(vel.x, vel.z),
    forward: vel.x * fx + vel.z * fz,
    side: vel.x * fz - vel.z * fx, // positivt = åt vänster
    airborne,
  };
}

function updateMe(dt) {
  forward.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  right.set(-Math.cos(camYaw), 0, Math.sin(camYaw));

  const canMove = phase === "round" && !me.dead;
  move.set(0, 0, 0);
  if (canMove) {
    if (keys.has("KeyW") || keys.has("ArrowUp")) move.add(forward);
    if (keys.has("KeyS") || keys.has("ArrowDown")) move.sub(forward);
    if (keys.has("KeyD") || keys.has("ArrowRight")) move.add(right);
    if (keys.has("KeyA") || keys.has("ArrowLeft")) move.sub(right);
  }

  const t = seconds();
  const moving = move.lengthSq() > 0;
  const running = moving && !charging && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
  wantedVel.set(0, 0, 0);
  if (moving) {
    let speed = running ? CONFIG.runSpeed : CONFIG.walkSpeed;
    speed *= COMBAT.legLossSpeed[Math.min(2, me.knight.legLoss)]; // avhuggna ben gör en långsam
    if (t < me.staggerUntil) speed *= CONFIG.staggerMoveFactor;
    else if (charging) speed *= CONFIG.chargeMoveFactor;
    else if (t < me.attackUntil) speed *= CONFIG.attackMoveFactor;
    wantedVel.copy(move).normalize().multiplyScalar(speed);
  }
  // Acceleration och inbromsning (sämre grepp i luften)
  const accel = me.onGround ? CONFIG.acceleration : CONFIG.airControl;
  me.vel.lerp(wantedVel, 1 - Math.exp(-dt * accel));
  me.pos.addScaledVector(me.vel, dt);
  const groundSpeed = Math.hypot(me.vel.x, me.vel.z);
  me.anim = canMove ? (groundSpeed > 4.5 ? 2 : groundSpeed > 0.3 ? 1 : 0) : 0;

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

  // Under strid tittar riddaren åt samma håll som kameran (så man slår dit man tittar)
  if (phase === "countdown" || canMove) me.yaw = camYaw;

  if (canMove) {
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
  }

  me.knight.group.position.copy(me.pos);
  me.knight.group.rotation.y = me.yaw;
  if (!me.dead) me.knight.animate(dt, motionOf(me.vel, me.yaw, !me.onGround));
}

let lobbyEmoteTimer = 2;
const prevPos = new THREE.Vector3();
const measuredVel = new THREE.Vector3();

function updateOthers(dt) {
  const t = 1 - Math.exp(-dt * 12); // mjuk förflyttning mot senaste kända position
  for (const other of others.values()) {
    const group = other.knight.group;
    prevPos.copy(group.position);
    if (group.position.distanceTo(other.target) > 5) {
      group.position.copy(other.target); // för långt efter: hoppa direkt
      other.vel.set(0, 0, 0);
    } else {
      group.position.lerp(other.target, t);
      // Uppmät farten från hur riddaren faktiskt flyttar sig, så benen hänger med
      measuredVel.copy(group.position).sub(prevPos).divideScalar(Math.max(dt, 0.001));
      measuredVel.y = 0;
      other.vel.lerp(measuredVel, 1 - Math.exp(-dt * 10));
    }
    if (other.dead) continue; // kroppen är en ragdoll, den nya riddaren är osynlig
    group.rotation.y = angleLerp(group.rotation.y, other.targetYaw, t);
    other.knight.animate(dt, motionOf(other.vel, group.rotation.y, group.position.y > 0.05));
  }

  // I lobbyn viftar riddarna med svärdet ibland, för stämningens skull
  if (phase === "lobby") {
    lobbyEmoteTimer -= dt;
    if (lobbyEmoteTimer <= 0) {
      lobbyEmoteTimer = 1.5 + Math.random() * 2.5;
      const list = allPlayers();
      const pick = list[Math.floor(Math.random() * list.length)];
      if (pick) pick.knight.playAttack(Math.random() < 0.3 ? "h" : "q");
    }
  }
}

// ---------------------------------------------------------------------------
// Kamera
// ---------------------------------------------------------------------------

const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();

function orbitCamera(radius, height, speed, lookY) {
  const t = performance.now() * speed;
  camera.position.set(Math.sin(t) * radius, height, Math.cos(t) * radius);
  camera.lookAt(0, lookY, 0);
}

function updateCamera(dt) {
  if (!me || phase === "start") {
    orbitCamera(24, 11, 0.00005, 1); // startskärm: svävar runt arenan
    return;
  }
  if (phase === "lobby") {
    // Riddarna på rad; kameran lite åt vänster så lobbyrutan inte skymmer dem
    camera.position.set(-1.4, 1.7, 7.2);
    camera.lookAt(-1.4, 1.1, 2);
    return;
  }
  if (phase === "matchEnd" || (me.dead && !me.corpse) || (me.dead && seconds() - me.diedAt > 3)) {
    orbitCamera(18, 9, 0.00008, 0.5); // åskådare: överblick över arenan
    return;
  }

  forward.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  right.set(-Math.cos(camYaw), 0, Math.sin(camYaw));

  if (me.dead && me.corpse) {
    // Nyss död: kameran följer den egna kroppen en stund
    const c = me.corpse.center();
    camTarget.set(c[0], c[1] + 0.6, c[2]);
  } else {
    camTarget.copy(me.pos).addScaledVector(right, CONFIG.cameraShoulder);
    camTarget.y = me.pos.y * 0.6 + CONFIG.cameraHeight;
  }

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
  if (me.dead || phase !== "round") return; // servern tar bara emot positioner under strid

  const x = Math.round(me.pos.x * 100) / 100;
  const y = Math.round(me.pos.y * 100) / 100;
  const z = Math.round(me.pos.z * 100) / 100;
  const r = Math.round(me.yaw * 100) / 100;
  const changed = x !== lastSent.x || y !== lastSent.y || z !== lastSent.z || r !== lastSent.r || me.anim !== lastSent.a;

  if (changed || heartbeatTimer >= CONFIG.heartbeatSeconds) sendStateNow();
}

// Stumparna sprutar blod en stund efter att en kroppsdel huggits av
function updateBleeding(dt) {
  const knights = allPlayers().filter((p) => !p.dead).map((p) => p.knight);
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
    $("fps").textContent = `FPS: ${Math.round((fpsFrames * 1000) / (now - fpsStart))}`;
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
  arena.update(dt);
  updateCamera(dt);
  updateAim();
  sound.setListener(camera.position.x, camera.position.y, camera.position.z);
  renderer.render(scene, camera);
}

setPhase("start");
renderer.setAnimationLoop(frame);
