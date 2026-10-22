// HUVUDFILEN – startskärm, lobby, rundor, 3D-scen, styrning, strid, kamera och spel-loop.

import * as THREE from "three";
import { CONFIG } from "./config.js";
import {
  COLORS, ARENA_RX, ARENA_RZ, ROOM_CODE_RE, VERSION, COMBAT, MATCH, ARMORS, HELMETS, SHIELDS, WEAPONS, CAPES, MODE_NAMES, TEAMS,
} from "./shared.js";
import { buildArena, makeSky } from "./arena.js";
import { Knight, setEnvironment } from "./knight.js";
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
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // mjuka skuggkanter
// Filmlik färgåtergivning: ljusa partier mättas mjukt istället för att bli platt vita
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const SKY = 0x9cc3e0;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 70, 230);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 500);

// Blått ljus från himlen, varmt brunt studsljus från marken och en varm eftermiddagssol
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x806040, 1.25));
const sun = new THREE.DirectionalLight(0xffe8c8, 2.7);
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
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 3;
scene.add(sun);

// Omgivning som blank metall speglar: himlen ovanför och marken nedanför
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(makeSky());
  const envGround = new THREE.Mesh(new THREE.CircleGeometry(300, 24), new THREE.MeshBasicMaterial({ color: 0x8a7a5a }));
  envGround.rotation.x = -Math.PI / 2;
  envGround.position.y = -2;
  envScene.add(envGround);
  setEnvironment(pmrem.fromScene(envScene, 0.04).texture);
  pmrem.dispose();
}

const arena = buildArena();
scene.add(arena.group);

const effects = new Effects(scene);
const debris = new Debris(30, 45); // döda kroppar och avhuggna delar
const RAGDOLL_BOUNDS = { rx: ARENA_RX + 0.55, rz: ARENA_RZ + 0.55 }; // staketet
const sound = new Sound(
  loadSetting("ljud", "pa") === "av",
  loadSetting("musik", "pa") === "pa",
  Number(loadSetting("musikvolym", "60")) / 100,
  Number(loadSetting("effektvolym", "100")) / 100,
);

// Mitt utseende (rustning, hjälm, sköld, vapen, mantel), sparas mellan gångerna
let myLook = { a: 0, h: 0, s: 0, w: 0, c: 0 };
try {
  myLook = { ...myLook, ...JSON.parse(loadSetting("utseende", "{}")) };
} catch {
  // trasig sparning – använd standard
}

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
// Spelsätt: "ffa" (alla mot alla), "team" (Röda mot Blå) eller "tourney" (turnering 1 mot 1)
let mode = "ffa";
let teamWins = [0, 0];
let bracket = null;      // turneringsträdet från servern
let bracketNames = {};   // namn och färg för alla som var med när turneringen startade
let duel = null;         // pågående duell { a, b, s: [vinster a, vinster b] }

// Vilken färg ska riddaren ha? I lagspel bär alla sitt lags färg.
function displayColor(player) {
  return mode === "team" && (player.team === 0 || player.team === 1) ? TEAMS[player.team].color : player.color;
}

// Ett tal räknat från spelarens id (samma hos alla spelare): ger varje riddare sitt eget ansikte
function seedOf(player) {
  let h = 7;
  for (const ch of player.id || "x") h = (h * 31 + ch.charCodeAt(0)) % 1000003;
  return h;
}

// Slitage (bucklor, repor, blod, smuts) som byggs på under en match. Ny riddare varje runda får samma slitage.
function freshWear() {
  return { dents: 0, scratches: 0, blood: 0, dirt: 0 };
}

let camYaw = 0;
let camPitch = 0.25;
let shake = 0;

function setPhase(p) {
  phase = p;
  document.body.dataset.phase = p;
  updateVolumePanel();
}

// Volymreglagen syns i lobbyn och när musen är släppt under spelet
function updateVolumePanel() {
  const panel = document.getElementById("volume-panel");
  if (!panel) return;
  const inGame = phase === "countdown" || phase === "round" || phase === "roundEnd" || phase === "matchEnd" || phase === "bracket";
  panel.hidden = !(phase === "lobby" || (inGame && document.pointerLockElement !== canvas));
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
  const size = lowQuality ? CONFIG.shadowMapSizeLow : CONFIG.shadowMapSize;
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  arena.setQuality(lowQuality); // eldkorgarnas ljus kostar lite extra
  $("quality-label").textContent = lowQuality ? "Låg" : "Hög";
  saveSetting("grafik", lowQuality ? "lag" : "hog");
}
applyQuality();

$("music-volume").value = Math.round(sound.musicVolume * 100);
$("sfx-volume").value = Math.round(sound.sfxVolume * 100);
$("music-volume").addEventListener("input", (e) => {
  sound.unlock();
  sound.setMusicVolume(Number(e.target.value) / 100);
  saveSetting("musikvolym", e.target.value);
});
$("sfx-volume").addEventListener("input", (e) => {
  sound.unlock();
  sound.setSfxVolume(Number(e.target.value) / 100);
  saveSetting("effektvolym", e.target.value);
});

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
  net.connect(roomCode, { name, color: selectedColor, look: myLook });
});

nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("join-button").click();
});

// ---------------------------------------------------------------------------
// Riddare: skapa, placera i lobbyn, bygga om inför runda
// ---------------------------------------------------------------------------

const _stepPos = new THREE.Vector3();

function createKnight(player) {
  const knight = new Knight(colorHex(displayColor(player)), player === me ? null : player.name, player.look, { seed: seedOf(player) });
  knight.group.userData.playerId = player.id;
  scene.add(knight.group);
  if (player.wear) knight.applyWear(player.wear);
  if (player.helmetOff) knight.removeHelmet();
  // Fotspår i sanden och små knaster-ljud när fötterna sätts ner
  const metal = player.look && (player.look.a === 0 || player.look.a === 3);
  knight.onFootstep = (side, [x, z], yaw) => {
    if (phase !== "round" && phase !== "countdown") return;
    effects.footprint(x, z, yaw, side);
    _stepPos.set(x, 0, z);
    sound.footstep(_stepPos, metal, player === me ? 0.6 : 1);
  };
  return knight;
}

// Ersätt spelarens riddare med en ny hel (t.ex. ny runda eller ny färg)
function rebuildKnight(player) {
  if (player.knight) {
    player.knight.removeTrail();
    if (player.knight.group.parent) player.knight.group.removeFromParent();
  }
  player.knight = createKnight(player);
  player.knight.setHp(player.hp);
}

// I lobbyn står alla riddare på rad framför kameran
function lineup() {
  // I lagspel står Röda laget till vänster och Blå laget till höger
  const list = mode === "team" ? allPlayers().sort((a, b) => (a.team ?? 2) - (b.team ?? 2)) : allPlayers();
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
    mode = msg.mode || "ffa";
    teamWins = msg.teamWins || [0, 0];
    bracket = msg.bracket || null;
    me = {
      id: you.id,
      name: you.name,
      color: you.color,
      look: you.look,
      team: you.team ?? null,
      wear: freshWear(),
      helmetOff: false,
      kills: you.kills,
      wins: you.wins,
      knight: null,
      corpse: null,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(), // fart i sidled (mjukas upp för acceleration)
      knock: new THREE.Vector3(), // knuff från sparkar och utfall, avtar snabbt
      nextKick: 0,
      nextEmote: 0,
      wasOnGround: true,
      dustTimer: 0,
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
      $("spectate").textContent = "Matchen pågår – du är med från nästa runda";
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

  // Lobbyledaren bytte spelsätt
  mode(msg) {
    mode = msg.m;
    applyTeams(msg.teams);
    for (const p of allPlayers()) rebuildKnight(p);
    if (phase === "lobby") lineup();
    renderLobby();
    renderPlayerList();
  },

  // Någon bytte lag (eller lagen slumpades)
  teams(msg) {
    applyTeams(msg.teams);
    for (const p of allPlayers()) rebuildKnight(p);
    if (phase === "lobby") lineup();
    renderLobby();
    renderPlayerList();
  },

  // Turneringsträdet: visas mellan duellerna
  bracket(msg) {
    setPhase("bracket");
    bracket = msg.bracket;
    bracketNames = msg.names || bracketNames;
    $("match-lobby").hidden = true;
    $("death").hidden = true;
    $("spectate").hidden = true;
    renderBracket(msg.next, msg.champion);
    $("bracket").hidden = false;
    updateRoundBanner();
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

  look(msg) {
    const player = playerById(msg.id);
    if (!player) return;
    player.look = msg.look;
    if (player === me) {
      myLook = { ...msg.look };
      saveSetting("utseende", JSON.stringify(myLook));
    }
    rebuildKnight(player);
    if (phase === "lobby") lineup();
    renderLobby();
  },

  emote(msg) {
    const other = others.get(msg.id);
    if (!other) return;
    other.knight.playEmote(msg.e);
    emoteSound(msg.e, other.knight.group.position, other);
  },

  kick(msg) {
    const other = others.get(msg.id);
    if (!other) return;
    other.knight.playKick();
    sound.kick(other.knight.group.position);
  },

  // Någon blev sparkad: den vinglar och flyger bakåt (den sparkade sköter själv sin knuff)
  kicked(msg) {
    const victim = playerById(msg.id);
    if (!victim) return;
    const pos = positionOf(victim);
    victim.knight.playStagger();
    effects.dust(pos, 7, 1.6);
    sound.kickHit(pos);
    arena.cheer(0.3);
    if (victim === me) {
      me.knock.set(msg.dir[0] * COMBAT.kick.push, 0, msg.dir[1] * COMBAT.kick.push);
      me.staggerUntil = seconds() + COMBAT.kick.stagger;
      stopCharging(false);
      shake = 0.15;
      callout("Sparkad!");
    }
  },

  // ----- Rundor -----

  countdown(msg) {
    setPhase("countdown");
    sound.setBattleMusic(true);
    round = msg.round;
    duel = msg.duel || null;
    $("match-lobby").hidden = true;
    $("scoreboard").hidden = true;
    $("bracket").hidden = true;
    $("spectate").hidden = true;
    $("death").hidden = true;
    stopCharging(false);
    arena.clearThrown();
    // Ny match: rustningarna är hela och rena igen
    if (round === 1) for (const p of allPlayers()) p.wear = freshWear();
    for (const p of allPlayers()) p.helmetOff = false;

    // De som inte slåss (turneringen) tittar på från läktaren
    for (const id of msg.spec || []) {
      const player = playerById(id);
      if (!player) continue;
      player.dead = true;
      player.corpse = null;
      player.spectating = true;
      rebuildKnight(player);
      player.knight.group.visible = false;
    }
    if (me && (msg.spec || []).includes(me.id)) {
      $("spectate").textContent = duel ? `Du tittar på duellen: ${nameOf(duel.a)} mot ${nameOf(duel.b)}` : "Du tittar på";
      $("spectate").hidden = false;
    }

    // Alla får en ny, hel riddare på sin startplats
    for (const s of msg.players) {
      const player = playerById(s.id);
      if (!player) continue;
      player.hp = COMBAT.maxHp;
      player.dead = false;
      player.spectating = false;
      player.corpse = null;
      rebuildKnight(player);
      if (player === me) {
        me.pos.set(s.p[0], 0, s.p[2]);
        me.vel.set(0, 0, 0);
        me.knock.set(0, 0, 0);
        me.nextKick = 0;
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
    arena.heraldBlow();
    arena.cheer(0.8);
    updateRoundBanner();
  },

  roundEnd(msg) {
    setPhase("roundEnd");
    applyWins(msg.wins);
    if (msg.teamWins) teamWins = msg.teamWins;
    if (msg.duel) duel = msg.duel;
    const winner = msg.winner && playerById(msg.winner);
    let winners = [];
    if (mode === "team" && (msg.team === 0 || msg.team === 1)) {
      const mine = me && me.team === msg.team;
      callout(mine ? `Ditt lag vann rundan!` : `${TEAMS[msg.team].name} vann rundan!`, 2500);
      winners = allPlayers().filter((p) => p.team === msg.team && !p.dead);
    } else if (winner) {
      callout(winner === me ? "Du vann rundan!" : `${winner.name} vann rundan!`, 2500);
      winners = [winner];
    } else {
      callout("Ingen vann rundan!", 2500);
    }
    // Publiken kastar rosor till vinnaren och tomater på förlorarna
    for (const p of winners) arena.throwAt("rose", positionOf(p).clone(), 7);
    for (const p of allPlayers()) {
      if (!p.corpse || p.spectating) continue;
      const c = p.corpse.center();
      arena.throwAt("tomato", new THREE.Vector3(c[0], 0, c[2]), 6);
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
    if (msg.teamWins) teamWins = msg.teamWins;
    if (mode === "team" && (msg.team === 0 || msg.team === 1)) {
      const mine = me && me.team === msg.team;
      $("match-winner").textContent = mine ? `Ditt lag vann matchen! 👑` : `${TEAMS[msg.team].name} vann matchen! 👑`;
    } else if (mode === "tourney") {
      $("match-winner").textContent = winner ? (winner === me ? "Du är turneringens mästare! 👑" : `${winner.name} är turneringens mästare! 👑`) : "Turneringen är slut";
    } else {
      $("match-winner").textContent = winner ? (winner === me ? "Du vann matchen! 👑" : `${winner.name} vann matchen! 👑`) : "Matchen är slut";
    }
    $("bracket").hidden = true;
    const tbody = $("score-table").querySelector("tbody");
    tbody.innerHTML = "";
    allPlayers()
      .sort((a, b) => b.wins - a.wins || b.kills - a.kills)
      .forEach((p) => {
        const tr = document.createElement("tr");
        if ((winner && p.id === winner.id) || (mode === "team" && p.team === msg.team)) tr.className = "winner";
        const name = document.createElement("td");
        name.textContent = p.name + (p === me ? " (du)" : "") + (mode === "team" && p.team !== null ? (p.team === 0 ? " 🟥" : " 🟦") : "");
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
    duel = null;
    teamWins = [0, 0];
    $("bracket").hidden = true;
    arena.clearThrown();
    for (const p of allPlayers()) {
      p.hp = COMBAT.maxHp;
      p.dead = false;
      p.spectating = false;
      p.corpse = null;
      p.wins = 0;
      p.wear = freshWear();
      p.helmetOff = false;
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
    const pos = other.knight.group.position;
    sound.swing(pos, msg.k === "h", msg.k, other.look?.w ?? 0);
    sound.grunt(pos, voiceOf(other), msg.k === "h");
    checkQuintain(other, msg.k);
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

    // Åt vilket håll flyger delarna och blodet? Bort från den som slog.
    const dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5);
    if (attacker) dir.copy(positionOf(victim)).sub(positionOf(attacker));
    dir.y = 0;
    dir.normalize();

    const heavy = msg.k === "h";
    effects.blood(spot, heavy ? 26 : 14, dir, heavy ? 1.3 : 1);
    sound.hit(spot, heavy, attacker?.look?.w ?? 0);
    if (!msg.dead && !msg.sev) sound.hurt(spot, voiceOf(victim), heavy ? 1 : 0.55);

    // Hjälmen flyger av (tunga slag mot huvudet)
    if (msg.hk) {
      const helmet = knight.knockHelmet([dir.x * 3 + (Math.random() - 0.5), 3.5, dir.z * 3 + (Math.random() - 0.5)], scene, RAGDOLL_BOUNDS);
      if (helmet) {
        debris.add(helmet);
        sound.helmetOff(spot);
        arena.cheer(0.5);
      }
      victim.helmetOff = true;
    }

    // Bucklor, repor, smuts och blod sparas så att de syns resten av matchen
    if (!victim.wear) victim.wear = freshWear();
    victim.wear.dents += knight.addWear(msg.seg && msg.seg !== "pelvis" ? msg.seg : "torso", heavy);
    victim.wear.scratches += heavy ? 2 : 1;
    victim.wear.blood += heavy ? 2 : 1;
    victim.wear.dirt = Math.min(1, victim.wear.dirt + 0.05);

    // Riddaren rycker till bort från slaget, får blod på rustningen; svärdet blir blodigt
    const yaw = knight.group.rotation.y;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    knight.playHit([-(dir.x * c - dir.z * s), -(dir.x * s + dir.z * c)]);
    const splatSeg = msg.seg && msg.seg !== "pelvis" ? msg.seg : "torso";
    for (let i = 0; i < (heavy ? 3 : 2); i++) knight.addBloodSplat(i === 0 ? splatSeg : Math.random() < 0.5 ? "torso" : splatSeg);
    if (attacker && attacker.knight) attacker.knight.bloodySword();

    if (msg.sev) {
      const speed = msg.k === "h" ? 5 : 3;
      const up = msg.sev === "neck" || msg.sev === "waist" ? 4.5 : 3.5;
      const part = knight.sever(msg.sev, [dir.x * speed, up, dir.z * speed], scene, RAGDOLL_BOUNDS);
      debris.add(part);
      if (part) poolLater(part, 0.45);
      effects.blood(chest, 20, dir, 1.2);
      sound.sever(chest);
      if (!msg.dead) sound.roar(chest, voiceOf(victim)); // vrålar av smärta
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
      effects.blood(chest, 30, dir, 1.4);
      sound.scream(chest, voiceOf(victim));
      arena.cheer(1);
      arena.royalReact(Math.random() < 0.7); // kungen visar tummen upp (eller ner)
      // Kroppen blir en ragdoll; en osynlig ny riddare står kvar tills nästa runda
      const force = msg.k === "h" ? 4 : 2.5;
      const corpse = knight.die([dir.x * force, 2, dir.z * force], scene, RAGDOLL_BOUNDS);
      debris.add(corpse);
      poolLater(corpse, msg.sev === "neck" || msg.sev === "waist" ? 1.5 : 1.1);
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
    look: player.look,
    kills: player.kills || 0,
    wins: player.wins || 0,
    knight: null,
    corpse: null,
    target: new THREE.Vector3(player.p[0], player.p[1], player.p[2]),
    targetYaw: player.r,
    vel: new THREE.Vector3(),
    dustTimer: 0,
    lastY: 0,
    anim: player.a || 0,
    hp: player.hp,
    dead: player.dead,
    team: player.team ?? null,
    helmetOff: !!player.helmetOff,
    wear: freshWear(),
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

function applyTeams(teams) {
  for (const [id, t] of Object.entries(teams || {})) {
    const p = playerById(id);
    if (p) p.team = t;
  }
}

function nameOf(id) {
  const p = playerById(id);
  return p ? p.name : bracketNames[id]?.name ?? "?";
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
  $("bracket").hidden = true;
  $("death").hidden = true;
  $("spectate").hidden = true;
  $("match-lobby").hidden = false;
  stopCharging(false);
  debris.clear();
  effects.clear();
  pendingPools.length = 0;
  if (me) me.dead = false;
  lineup();
  renderLobby();
  updateRoundBanner();
}

const MODE_INFO = {
  ffa: () => `Alla mot alla. Sist kvar vinner rundan · först till ${MATCH.roundsToWin} rundvinster vinner matchen.`,
  team: () => `Röda mot Blå. Laget med någon kvar vinner rundan · först till ${MATCH.roundsToWin}. Man kan inte skada sina lagkamrater.`,
  tourney: () => "Utslagsturnering 1 mot 1, bäst av 3 i varje duell. De andra tittar på från läktaren. Går det inte jämnt ut får någon fripass.",
};

function renderLobby() {
  if (!me) return;
  const isHost = me.id === hostId;
  // Spelsätt: lobbyledaren väljer, de andra ser vad som är valt
  document.querySelectorAll(".mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.disabled = !isHost;
  });
  $("mode-info").textContent = MODE_INFO[mode]();
  $("lobby-rules").textContent = "Vapen, rustning och mantel är bara utseende – alla är lika starka.";
  $("team-row").hidden = mode !== "team";
  $("color-row").hidden = mode === "team";
  $("shuffle-button").hidden = !isHost;
  document.querySelectorAll(".team-btn").forEach((b) => b.classList.toggle("active", Number(b.dataset.team) === me.team));

  const list = $("lobby-players");
  list.innerHTML = "";
  const addRow = (p) => {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = cssColor(displayColor(p));
    const label = document.createElement("span");
    label.textContent = (p.id === hostId ? "👑 " : "") + p.name + (p === me ? " (du)" : "");
    li.append(dot, label);
    list.appendChild(li);
  };
  if (mode === "team") {
    for (const team of [0, 1]) {
      const head = document.createElement("li");
      head.className = "team-head";
      head.textContent = TEAMS[team].name;
      head.style.color = cssColor(TEAMS[team].color);
      list.appendChild(head);
      allPlayers().filter((p) => p.team === team).forEach(addRow);
    }
  } else {
    allPlayers().forEach(addRow);
  }

  const taken = new Set([...others.values()].map((p) => p.color));
  makeSwatches($("lobby-colors"), (i) => i === me.color, (i) => taken.has(i), (i) => {
    if (i !== me.color) net.send({ t: "color", color: i });
  });

  $("look-a").textContent = ARMORS[me.look.a] ?? "";
  $("look-h").textContent = HELMETS[me.look.h] ?? "";
  $("look-s").textContent = SHIELDS[me.look.s] ?? "";
  $("look-w").textContent = WEAPONS[me.look.w ?? 0] ?? "";
  $("look-c").textContent = CAPES[me.look.c ?? 0] ?? "";

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

// ◀ ▶ för rustning, hjälm och sköld
const LOOK_LISTS = { a: ARMORS, h: HELMETS, s: SHIELDS, w: WEAPONS, c: CAPES };
document.querySelectorAll("[data-look]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!me || phase !== "lobby") return;
    const key = button.dataset.look;
    const list = LOOK_LISTS[key];
    const look = { w: 0, c: 0, ...me.look };
    look[key] = (look[key] + Number(button.dataset.dir) + list.length) % list.length;
    net.send({ t: "look", look });
  });
});

document.querySelectorAll(".mode-btn").forEach((button) => {
  button.addEventListener("click", () => {
    if (!me || phase !== "lobby" || me.id !== hostId) return;
    net.send({ t: "mode", m: button.dataset.mode });
  });
});
document.querySelectorAll(".team-btn").forEach((button) => {
  button.addEventListener("click", () => {
    if (!me || phase !== "lobby") return;
    net.send({ t: "team", team: Number(button.dataset.team) });
  });
});
$("shuffle-button").addEventListener("click", () => {
  if (me && phase === "lobby") net.send({ t: "shuffle" });
});

$("start-button").addEventListener("click", () => {
  sound.unlock();
  net.send({ t: "start" });
});

function updateRoundBanner() {
  const inMatch = phase === "countdown" || phase === "round" || phase === "roundEnd";
  let text = "";
  if (inMatch && mode === "tourney" && duel) {
    text = `Duell: ${nameOf(duel.a)} ${duel.s[0]} – ${duel.s[1]} ${nameOf(duel.b)} · bäst av 3`;
  } else if (inMatch && mode === "team") {
    text = `Runda ${round} · Röda ${teamWins[0]} – ${teamWins[1]} Blå · först till ${MATCH.roundsToWin}`;
  } else if (inMatch) {
    text = `Runda ${round} · först till ${MATCH.roundsToWin}`;
  }
  $("round-banner").textContent = text;
}

// Ritar turneringsträdet: en kolumn per omgång, finalen längst till höger
function renderBracket(next, champion) {
  const tree = $("bracket-tree");
  tree.innerHTML = "";
  if (!bracket) return;
  const roundName = (ri) => {
    const left = bracket.length - ri;
    return left === 1 ? "Final" : left === 2 ? "Semifinal" : left === 3 ? "Kvartsfinal" : `Omgång ${ri + 1}`;
  };
  bracket.forEach((matches, ri) => {
    const col = document.createElement("div");
    col.className = "bracket-round";
    const h = document.createElement("h3");
    h.textContent = roundName(ri);
    col.appendChild(h);
    matches.forEach((m, mi) => {
      const box = document.createElement("div");
      box.className = "bracket-match" + (next && next.ri === ri && next.mi === mi ? " current" : "");
      for (const [slot, id] of [[0, m.a], [1, m.b]]) {
        const row = document.createElement("div");
        row.className = "bracket-slot";
        if (id === undefined) {
          row.classList.add("empty");
          row.textContent = "?";
        } else if (id === null) {
          row.classList.add("empty");
          row.textContent = "fripass";
        } else {
          if (m.w !== undefined && m.w !== null) row.classList.add(m.w === id ? "won" : "lost");
          const dot = document.createElement("span");
          dot.className = "dot";
          const info = bracketNames[id];
          dot.style.background = cssColor(info ? info.color : 0);
          const name = document.createElement("span");
          name.textContent = nameOf(id) + (me && id === me.id ? " (du)" : "");
          const score = document.createElement("span");
          score.className = "score";
          score.textContent = m.b === null ? "" : m.s[slot];
          row.append(dot, name, score);
        }
        box.appendChild(row);
      }
      col.appendChild(box);
    });
    tree.appendChild(col);
  });
  if (champion) {
    const champ = document.createElement("div");
    champ.className = "bracket-champion";
    champ.textContent = "👑 " + nameOf(champion);
    tree.appendChild(champ);
  }
  if (champion) {
    $("bracket-title").textContent = "Turneringen är avgjord!";
    $("bracket-next").textContent = `${nameOf(champion)} är turneringens mästare!`;
  } else if (next) {
    const m = bracket[next.ri][next.mi];
    $("bracket-title").textContent = "Turneringen";
    $("bracket-next").textContent = `Nästa duell: ${nameOf(m.a)} mot ${nameOf(m.b)}`;
  }
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
      dot.style.background = cssColor(displayColor(p));
      const label = document.createElement("span");
      label.textContent = (p.id === hostId ? "👑 " : "") + p.name + (p === me ? " (du)" : "");
      if (p.dead) label.className = "dead-name";
      if (p.spectating) label.className = "";
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
  if (e.repeat) return;
  if (e.code === "KeyQ" && locked()) tryAttack("t");
  if (e.code === "KeyF" && locked()) tryKick();
  if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3") tryEmote(Number(e.code.slice(5)));
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
const playing = () => phase === "countdown" || phase === "round" || phase === "roundEnd" || phase === "bracket";

canvas.addEventListener("click", () => {
  if (me && playing() && !locked()) canvas.requestPointerLock();
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("pointerlockchange", () => {
  $("click-hint").hidden = locked();
  updateVolumePanel();
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
  } else if (e.button === 1) {
    e.preventDefault();
    tryAttack("t"); // mittenknappen = stöt
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

  const spec = kind === "h" ? COMBAT.heavy : kind === "t" ? COMBAT.thrust : COMBAT.quick;
  me.nextQuick = t + spec.cooldown;
  me.nextHeavy = t + (kind === "h" ? COMBAT.heavy.cooldown : COMBAT.quick.cooldown);
  me.attackUntil = t + spec.windup + 0.15;
  me.knight.playAttack(kind); // visa slaget direkt, servern avgör om det träffar
  sound.swing(me.pos, kind === "h", kind, me.look?.w ?? 0);
  sound.grunt(me.pos, voiceOf(me), kind === "h");
  checkQuintain(me, kind);
  if (kind === "t") me.knock.addScaledVector(forward.set(Math.sin(me.yaw), 0, Math.cos(me.yaw)), 3); // litet utfall framåt
  sendStateNow(); // se till att servern har exakt var vi står och tittar
  const msg = { t: "atk", k: kind };
  if (aim) msg.aim = { id: aim.id, seg: aim.seg }; // kroppsdelen under siktet
  net.send(msg);
}

// Träningsdockan snurrar om slaget träffar den (bara på riktigt hos varje spelare, servern bryr sig inte)
function checkQuintain(player, kind) {
  const spec = kind === "h" ? COMBAT.heavy : kind === "t" ? COMBAT.thrust : COMBAT.quick;
  setTimeout(() => {
    if (phase !== "round" && phase !== "lobby" && phase !== "roundEnd") return;
    const pos = positionOf(player);
    const yaw = player === me ? me.yaw : player.knight.group.rotation.y;
    if (arena.quintain.hit(pos.x, pos.z, yaw, spec.reach, kind === "h" ? 1.5 : 1)) {
      sound.hit(arena.quintain.group.position.clone().setY(1.5), false, 1);
      arena.cheer(0.15);
    }
  }, spec.windup * 1000);
}

function tryKick() {
  if (!canAct() || seconds() < me.nextKick) return;
  me.nextKick = seconds() + COMBAT.kick.cooldown;
  me.attackUntil = seconds() + 0.4;
  stopCharging(true);
  me.knight.playKick();
  sound.kick(me.pos);
  sendStateNow();
  net.send({ t: "kick" });
}

// Hån-gester: 1 = buga, 2 = peka och skratta, 3 = dansa
function tryEmote(e) {
  if (!me || me.dead || seconds() < me.nextEmote) return;
  if (!(phase === "lobby" || phase === "round" || phase === "roundEnd")) return;
  me.nextEmote = seconds() + COMBAT.emoteCooldown;
  me.knight.playEmote(e);
  emoteSound(e, me.pos, me);
  net.send({ t: "emote", e });
}

function emoteSound(e, pos, player) {
  if (e === 2) sound.laugh(pos, voiceOf(player));
  if (e === 3) sound.dance();
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
  const targets = [...others.values()]
    .filter((o) => !o.dead && o.knight.group.visible && !(mode === "team" && o.team === me.team))
    .map((o) => o.knight.group);
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
  // Knuff (spark eller utfall) som avtar snabbt
  me.pos.addScaledVector(me.knock, dt);
  me.knock.multiplyScalar(Math.exp(-dt * 5));
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

  // Damm när man springer och när man landar efter ett hopp
  if (!me.dead && phase === "round") {
    if (me.onGround && !me.wasOnGround) {
      effects.dust(me.pos, 6, 1.2);
      me.knight.playLand();
    }
    me.dustTimer += dt;
    if (me.onGround && groundSpeed > 5 && me.dustTimer > 0.2) {
      me.dustTimer = 0;
      effects.dust(me.pos, 1, 0.7);
    }
  }
  me.wasOnGround = me.onGround;

  me.knight.group.position.copy(me.pos);
  me.knight.group.rotation.y = me.yaw;
  if (!me.dead) {
    me.knight.animate(dt, motionOf(me.vel, me.yaw, !me.onGround));
    me.knight.updateTrail(scene);
  }
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
    // Damm när de springer och landar
    const y = group.position.y;
    if (other.lastY > 0.05 && y <= 0.05) {
      effects.dust(group.position, 6, 1.2);
      other.knight.playLand();
    }
    other.lastY = y;
    other.dustTimer += dt;
    if (y < 0.05 && Math.hypot(other.vel.x, other.vel.z) > 5 && other.dustTimer > 0.2) {
      other.dustTimer = 0;
      effects.dust(group.position, 1, 0.7);
    }
    group.rotation.y = angleLerp(group.rotation.y, other.targetYaw, t);
    other.knight.animate(dt, motionOf(other.vel, group.rotation.y, group.position.y > 0.05));
    other.knight.updateTrail(scene);
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

function orbitCamera(radius, height, speed, lookY, center = null) {
  const t = performance.now() * speed;
  const cx = center ? center.x : 0;
  const cz = center ? center.z : 0;
  camera.position.set(cx + Math.sin(t) * radius, height, cz + Math.cos(t) * radius);
  camera.lookAt(cx, lookY, cz);
}

// Mitten av striden: snittet av alla levande riddare (publiken och åskådarkameran tittar dit)
const fightCenter = new THREE.Vector3();
const smoothCenter = new THREE.Vector3();
function updateFightCenter(dt) {
  fightCenter.set(0, 0, 0);
  let n = 0;
  for (const p of allPlayers()) {
    if (p.dead || !p.knight || !p.knight.group.visible) continue;
    fightCenter.add(positionOf(p));
    n += 1;
  }
  if (n > 0) fightCenter.divideScalar(n);
  fightCenter.y = 0;
  smoothCenter.lerp(fightCenter, 1 - Math.exp(-dt * 2));
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
  if (phase === "bracket" || phase === "matchEnd") {
    orbitCamera(18, 9, 0.00008, 0.5); // överblick över arenan
    return;
  }
  if (me.spectating || (me.dead && !me.corpse) || (me.dead && seconds() - me.diedAt > 3)) {
    orbitCamera(9.5, 4.5, 0.00009, 1.0, smoothCenter); // åskådare: kameran svävar runt striden
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
    knight.forEachBleedingStump(dt, (pos, age, dir) => {
      // Pulserande strålar i hjärtats takt, som blir svagare med tiden
      const strength = Math.max(0, 1 - age / 3.5);
      const pulse = Math.sin(age * Math.PI * 2 * 2.2) > 0.3;
      if (pulse && Math.random() < dt * 30) effects.spurt(pos, dir, strength);
      else if (Math.random() < dt * 6 * strength) effects.blood(pos, 1, dir, 0.4);
    });
  }
  // Blodpölar växer fram under döda kroppar och avhuggna delar när de har landat
  const now = seconds();
  for (let i = pendingPools.length - 1; i >= 0; i--) {
    const p = pendingPools[i];
    if (now < p.at) continue;
    pendingPools.splice(i, 1);
    if (!p.ragdoll.bodies || !p.ragdoll.points) continue;
    const c = p.ragdoll.center();
    if (c[1] < 1.2 && (c[0] / 15) ** 2 + (c[2] / 12) ** 2 < 1) effects.pool(c[0], c[2], p.size * (0.8 + Math.random() * 0.4));
  }
}

const pendingPools = [];
function poolLater(ragdoll, size) {
  if (pendingPools.length < 30) pendingPools.push({ ragdoll, size, at: seconds() + 1.2 });
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
  updateFightCenter(dt);
  arena.update(dt, smoothCenter);
  updateCamera(dt);
  updateAim();
  sound.setListener(camera.position.x, camera.position.y, camera.position.z);
  renderer.render(scene, camera);
}

setPhase("start");
renderer.setAnimationLoop(frame);
