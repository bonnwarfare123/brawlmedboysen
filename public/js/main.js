// HUVUDFILEN – startskärm, lobby, rundor, 3D-scen, styrning, strid, kamera och spel-loop.

import * as THREE from "three";
import { CONFIG } from "./config.js";
import {
  COLORS, ARENA_RX, ARENA_RZ, ROOM_CODE_RE, VERSION, COMBAT, MATCH, ARMORS, HELMETS, SHIELDS, WEAPONS, CAPES, MODE_NAMES, TEAMS,
  attackSpec, cooldownsAfter, weaponSpec, FISTS, TIMES, TIME_NAMES, MAX_BOTS, WEATHERS, AWARDS,
  MAPS, MAP_NAMES, INTRO_SECONDS,
} from "./shared.js";
import { buildArena, makeSky } from "./arena.js";
import { buildCastleArena } from "./castle.js";
import { Knight, setEnvironment } from "./knight.js";
import { Effects } from "./effects.js";
import { Debris } from "./ragdoll.js";
import { Sound } from "./sound.js";
import { Net } from "./net.js";
import { Weather, Motes } from "./weather.js";
import { PostFX } from "./postfx.js";
import { Keybinds, ACTIONS, keyName, FORBIDDEN } from "./keybinds.js";

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
const skyLight = new THREE.HemisphereLight(0xbfd8ff, 0x806040, 1.25);
scene.add(skyLight);
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
const envMaps = {};
function environmentFor(evening) {
  const key = evening ? "evening" : "day";
  if (!envMaps[key]) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(makeSky(evening));
    const envGround = new THREE.Mesh(new THREE.CircleGeometry(300, 24), new THREE.MeshBasicMaterial({ color: evening ? 0x4a3a2a : 0x8a7a5a }));
    envGround.rotation.x = -Math.PI / 2;
    envGround.position.y = -2;
    envScene.add(envGround);
    envMaps[key] = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();
  }
  return envMaps[key];
}
setEnvironment(environmentFor(false));

// Banan: tornerplatsen byggs direkt, borggården först när någon väljer den
let arena = buildArena();
scene.add(arena.group);
const arenas = { arena };
let mapKind = "arena";
function applyMap(kind) {
  kind = MAPS.includes(kind) ? kind : "arena";
  if (kind === mapKind) return;
  if (!arenas[kind]) arenas[kind] = kind === "castle" ? buildCastleArena() : buildArena();
  scene.remove(arena.group);
  arena = arenas[kind];
  scene.add(arena.group);
  mapKind = kind;
  adoptLights(arena);
  arena.setQuality?.(lowQuality);
  applyWeather(weatherKind);
  warmShaders();
}

// LJUSPOOL: banorna har många eldar med eget ljus (6–8 st). Varje ljus gör ALLA ytor dyrare att rita,
// så i stället finns bara 4 riktiga ljus, som hela tiden flyttas till de eldar som är närmast det man tittar på.
// Eldarna längre bort behåller lågor och sken. Antalet ljus ändras aldrig (annars måste allt byggas om och det rycker).
const LIGHT_POOL = 4;
const lightPool = [];
for (let i = 0; i < LIGHT_POOL; i++) {
  const l = new THREE.PointLight(0xff8a3a, 0, 8, 1.6);
  l.position.set(0, -50, 0);
  scene.add(l);
  lightPool.push(l);
}
const _lp = new THREE.Vector3();
const _look = new THREE.Vector3();
function adoptLights(a) {
  if (a.lightSources) return;
  // Småsaker på banan (småsten, muggar, nitar) kastar inga skuggor: syns inte, men kostar ritanrop
  a.group.updateMatrixWorld(true);
  const sc = new THREE.Vector3();
  a.group.traverse((o) => {
    if (!o.isMesh || !o.castShadow || !o.geometry || o.isInstancedMesh) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    o.getWorldScale(sc);
    if (o.geometry.boundingSphere.radius * Math.max(sc.x, sc.y, sc.z) < 0.06) o.castShadow = false;
  });
  a.lightSources = [];
  const found = [];
  a.group.traverse((o) => o.isPointLight && found.push(o));
  for (const l of found) {
    const home = l.parent;
    home.remove(l);
    a.lightSources.push({ light: l, home, world: new THREE.Vector3(), d: 0 });
  }
}
adoptLights(arena);
function updateLightPool() {
  const src = arena.lightSources || [];
  camera.getWorldDirection(_look).multiplyScalar(7).add(camera.position);
  for (const s of src) {
    s.home.updateWorldMatrix(true, false);
    s.world.copy(s.light.position).applyMatrix4(s.home.matrixWorld);
    s.d = s.world.distanceTo(_look);
  }
  const order = src.slice().sort((a, b) => a.d - b.d);
  for (let i = 0; i < LIGHT_POOL; i++) {
    const l = lightPool[i];
    const s = order[i];
    l.visible = !lowQuality; // låg grafik: inga eldljus alls (som förut)
    if (!s || !s.light.visible || !s.home.visible) {
      l.intensity = 0;
      continue;
    }
    // Det sista ljuset tonas mjukt när en annan eld nästan är lika nära (inget hopp när de byter)
    let fade = 1;
    if (i === LIGHT_POOL - 1 && order[i + 1]) fade = Math.min(1, (order[i + 1].d - s.d) / 4);
    l.position.copy(s.world);
    l.color.copy(s.light.color);
    l.distance = s.light.distance;
    l.decay = s.light.decay;
    l.intensity = s.light.intensity * fade;
  }
}

// Bygg alla shaders direkt (även för saker som är dolda just nu), så det inte rycker första gången något syns
function warmShaders() {
  try {
    const hidden = [];
    scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    const prevTarget = renderer.getRenderTarget();
    if (postfx && postfx.enabled) renderer.setRenderTarget(postfx.target);
    if (renderer.compileAsync) renderer.compileAsync(scene, camera).catch(() => {});
    else renderer.compile(scene, camera);
    renderer.setRenderTarget(prevTarget);
    for (const o of hidden) o.visible = false;
  } catch (err) {
    console.warn("Kunde inte förbygga shaders", err);
  }
}

// Dag eller kväll (lobbyledaren väljer). På kvällen står solen lågt och är orange,
// himlen är mörkare och eldkorgarna lyser upp arenan.
let timeOfDay = "day";
let weatherKind = "sun";
const weather = new Weather(scene);
const motes = new Motes(scene, ARENA_RX, ARENA_RZ);
// Glöd och färgton (stängs av på låg grafik). Om något går fel ritar vi som vanligt.
let postfx = null;
try {
  postfx = new PostFX(renderer, scene, camera);
} catch (err) {
  console.warn("Efterbehandling gick inte att starta", err);
}
warmShaders();
function applyTime(value) {
  timeOfDay = TIMES.includes(value) ? value : "day";
  applyAtmosphere();
}
// Sol, regn eller dimma
function applyWeather(value) {
  weatherKind = WEATHERS.includes(value) ? value : "sun";
  const winter = mapKind === "castle"; // i borggården blir regn till snö och dimma till snöstorm
  weather.set(weatherKind, winter);
  arena.setWet(weatherKind === "rain" || (winter && weatherKind === "fog"));
  effects.wet = weatherKind === "rain" && !winter;
  sound.setRain(weatherKind === "rain" && !winter);
  sound.setWind(winter ? (weatherKind === "fog" ? 1.2 : weatherKind === "rain" ? 0.6 : 0.25) : 0);
  applyAtmosphere();
  renderWeatherLabels();
}
// Väderknapparna heter annorlunda i borggården
function renderWeatherLabels() {
  const winter = mapKind === "castle";
  const names = winter ? { sun: "☀️ Klart", rain: "❄️ Snö", fog: "🌨️ Snöstorm" } : { sun: "🌤️ Sol", rain: "🌧️ Regn", fog: "🌫️ Dimma" };
  document.querySelectorAll(".weather-btn").forEach((b) => (b.textContent = names[b.dataset.weather]));
}
// Ljus, himmel och dimma räknas ut från både tid på dygnet och väder
function applyAtmosphere() {
  const evening = timeOfDay === "evening";
  const rain = weatherKind === "rain";
  const fog = weatherKind === "fog";
  let fogColor = evening ? 0x6a5a70 : SKY;
  if (rain) fogColor = evening ? 0x4a4a58 : 0x8a949e;
  if (fog) fogColor = evening ? 0x5a5662 : 0xb8bec4;
  const winter = mapKind === "castle";
  if (winter && rain) fogColor = evening ? 0x5c5a68 : 0xc4ccd6; // snöfall
  if (winter && fog) fogColor = evening ? 0x6a6874 : 0xd4dae2;  // snöstorm
  scene.background.set(fogColor);
  scene.fog.color.set(fogColor);
  scene.fog.near = fog ? 4 : rain ? 25 : evening ? 45 : 70;
  scene.fog.far = fog ? 42 : rain ? 110 : evening ? 180 : 230;
  const dim = rain ? 0.5 : fog ? 0.65 : 1; // molnigt: solen syns knappt
  skyLight.color.set(evening ? 0x8a8ac8 : 0xbfd8ff);
  skyLight.groundColor.set(winter ? (evening ? 0x6a6070 : 0xb8c0cc) : evening ? 0x5a3a28 : 0x806040); // snön lyser upp underifrån
  skyLight.intensity = (evening ? 0.7 : 1.25) * (rain || fog ? 1.15 : 1);
  sun.color.set(evening ? 0xff9a55 : rain || fog ? 0xdde4ea : 0xffe8c8);
  sun.intensity = (evening ? 1.6 : 2.7) * dim;
  if (evening) sun.position.set(26, 7, -14);
  else sun.position.set(14, 24, 10);
  renderer.toneMappingExposure = evening ? 1.15 : 1.05;
  setEnvironment(environmentFor(evening));
  arena.setTime(evening);
  arena.setOvercast?.(rain || fog);
  motes.set(weatherKind, evening);
  postfx?.setGrade(rain ? (winter ? "snow" : "rain") : fog ? "fog" : evening ? "evening" : winter ? "winter" : "day");
}

const effects = new Effects(scene);
// Större dammoln (fall, knuffar, ny runda) rör också upp dammet i luften
{
  const dust = effects.dust.bind(effects);
  effects.dust = (pos, n, spread) => {
    if (n >= 6) motes.kick(n / 40);
    return dust(pos, n, spread);
  };
}
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

// Ett tal räknat från spelarens namn (samma hos alla spelare): ger varje riddare sitt eget ansikte,
// och samma ansikte varje gång man spelar med samma namn
function seedOf(player) {
  let h = 7;
  for (const ch of (player.name || "").toLowerCase().trim() || player.id || "x") h = (h * 31 + ch.charCodeAt(0)) % 1000003;
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
  if (p !== "countdown" && p !== "roundEnd" && p !== "bracket") pendingWeapon = null;
  if (me) renderWeaponBar();
  if (p === "countdown" || p === "intro") warmShaders(); // alla riddare finns nu: bygg deras shaders innan striden
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

// Ljud för vapnen: 0 = klinga, 1 = yxblad (djupare sus), 2 = kedja, 3 = trubbigt (hammare, knytnäve)
const SWING_SOUND = [0, 1, 2, 0, 1, 1, 0, 0, 1, 1, 0];
const HIT_SOUND = [0, 1, 2, 0, 1, 1, 0, 0, 3, 3];
function swingSound(player) {
  const w = weaponOf(player);
  return w === FISTS ? 0 : SWING_SOUND[w] ?? 0;
}
function soundWeapon(player) {
  const w = weaponOf(player);
  return w === FISTS ? 3 : HIT_SOUND[w] ?? 0;
}
// Vapnet riddaren håller i just nu (kan vara ett upplockat vapen, eller FISTS = inget)
function weaponOf(player) {
  return player?.cw ?? player?.look?.w ?? 0;
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
  if (postfx) {
    postfx.enabled = !lowQuality;
    postfx.setSize(window.innerWidth, window.innerHeight);
  }
  motes.off = lowQuality;
  motes.set();
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
  postfx?.setSize(window.innerWidth, window.innerHeight);
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

// ---------------------------------------------------------------------------
// Topplistan: en hemlig nyckel i webbläsaren gör att ditt namn är ditt.
// Nyckeln är samma sak som återställningskoden (RIDD-XXXX-XXXX-XXXX).
// ---------------------------------------------------------------------------
const KEY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function cleanKey(value) {
  const k = String(value ?? "").toUpperCase().replace(/^RIDD/, "").replace(/[^A-Z0-9]/g, "");
  return k.length === 12 && [...k].every((c) => KEY_CHARS.includes(c)) ? k : null;
}
function myKey() {
  let key = cleanKey(loadSetting("nyckel", ""));
  if (!key) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    key = [...bytes].map((b) => KEY_CHARS[b % KEY_CHARS.length]).join("");
    saveSetting("nyckel", key);
  }
  return key;
}
function prettyKey(key) {
  return "RIDD-" + key.slice(0, 4) + "-" + key.slice(4, 8) + "-" + key.slice(8, 12);
}
$("restore-button").addEventListener("click", () => {
  const key = cleanKey($("restore-input").value);
  if (!key) {
    $("restore-msg").textContent = "Det där ser inte ut som en kod. Den ser ut så här: RIDD-XXXX-XXXX-XXXX";
    return;
  }
  saveSetting("nyckel", key);
  $("restore-msg").textContent = "✔ Koden är sparad. Skriv ditt gamla namn och gå in i spelet.";
  $("restore-input").value = "";
});
$("show-code").addEventListener("click", () => {
  const box = $("code-box");
  box.hidden = !box.hidden;
  $("my-code").textContent = prettyKey(myKey());
  $("show-code").textContent = box.hidden ? "🔑 Visa min kod" : "🔑 Dölj koden";
});
$("copy-code").addEventListener("click", () => {
  navigator.clipboard?.writeText(prettyKey(myKey())).then(() => {
    $("copy-code").textContent = "Kopierad!";
    setTimeout(() => ($("copy-code").textContent = "Kopiera"), 1500);
  }).catch(() => {});
});

let boardTopName = null; // den som leder topplistan (får extra jubel i introt)
function renderBoard(msg) {
  boardTopName = msg.top?.[0]?.name?.toLowerCase() ?? null;
  const tbody = $("board-table").querySelector("tbody");
  tbody.innerHTML = "";
  const meRow = msg.me;
  const row = (r, isMe) => {
    const tr = document.createElement("tr");
    if (isMe) tr.className = "me";
    for (const v of [r.rank ?? "–", r.name, r.wins, r.kills, r.matches]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  };
  const top = msg.top || [];
  for (const r of top) row(r, meRow && r.rank === meRow.rank);
  // Är jag inte bland de tio visas min rad längst ner
  if (meRow && meRow.rank && meRow.rank > top.length) {
    const gap = document.createElement("tr");
    gap.className = "gap";
    gap.innerHTML = "<td colspan='5'>⋯</td>";
    tbody.appendChild(gap);
    row(meRow, true);
  }
  $("board-empty").hidden = top.length > 0;
  const card = $("my-card");
  card.hidden = !msg.ranked;
  if (meRow) {
    $("my-title").textContent = meRow.name;
    $("my-rank").textContent = meRow.rank ? "#" + meRow.rank : "–";
    $("my-wins").textContent = meRow.wins;
    $("my-kills").textContent = meRow.kills;
    $("my-matches").textContent = meRow.matches;
    $("my-streak").textContent = meRow.best + (meRow.streak >= 2 ? ` (nu ${meRow.streak}🔥)` : "");
    $("my-sev").textContent = meRow.sev;
    const extra = [];
    if (meRow.matches > 0) extra.push(`${Math.round((meRow.kills / meRow.matches) * 10) / 10} dråp per match`);
    if (meRow.award) {
      const a = AWARDS.find((x) => x.key === meRow.award[0]);
      if (a) extra.push(`Oftast: ${a.title ?? a.name ?? a.key} ×${meRow.award[1]}`);
    }
    if (meRow.weapon && WEAPONS[Number(meRow.weapon[0])]) extra.push(`Vinner mest med: ${WEAPONS[Number(meRow.weapon[0])]}`);
    $("my-extra").textContent = extra.join(" · ") || "Spela en match så syns dina siffror här.";
  }
  $("board").hidden = false;
}

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
  net.connect(roomCode, { name, color: selectedColor, look: myLook, key: myKey() });
});

nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("join-button").click();
});

// ---------------------------------------------------------------------------
// Riddare: skapa, placera i lobbyn, bygga om inför runda
// ---------------------------------------------------------------------------

const _stepPos = new THREE.Vector3();

function createKnight(player) {
  const look = { ...player.look, w: weaponOf(player) };
  const name = player === me ? null : player.name;
  const knight = new Knight(colorHex(displayColor(player)), name, look, { seed: seedOf(player), bot: !!player.bot });
  knight.group.userData.playerId = player.id;
  scene.add(knight.group);
  if (player.wear) knight.applyWear(player.wear);
  if (player.helmetOff) knight.removeHelmet();
  // Fotspår i sanden och små knaster-ljud när fötterna sätts ner
  const metal = player.look && (player.look.a === 0 || player.look.a === 3);
  // Zweihänderns spets ritar ett spår och dammar i sanden
  knight.onWeaponDrag = (x, z) => {
    if (phase !== "round" && phase !== "countdown") return;
    _stepPos.set(x, 0.05, z);
    effects.dust(_stepPos, 1, 0.5);
  };
  knight.onFootstep = (side, [x, z], yaw) => {
    if (phase !== "round" && phase !== "countdown") return;
    effects.footprint(x, z, yaw, side, player.id);
    _stepPos.set(x, 0, z);
    sound.footstep(_stepPos, metal, player === me ? 0.6 : 1);
    if (player.look?.a === 5 && Math.random() < 0.5) sound.bells(_stepPos, player === me ? 0.5 : 0.8); // gycklarens bjällror
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
// Prisceremonin efter matchen: prispallen reser sig, de tre bästa ställer sig på den
// och resten står framför och applåderar. Kameran glider runt pallen.
// ---------------------------------------------------------------------------

const CEREMONY_WAIT = 2.2; // sekunder att se sista dråpet innan pallen kommer (utan repris)
const CEREMONY_RISE = 1.7; // så lång tid tar det för pallen att resa sig
let ceremony = null;       // { at, placed, ranks: Map(id → 1–3), clappers: [id] }

function podiumOrder(msg) {
  if (Array.isArray(msg.podium)) return msg.podium;
  // Äldre server: sortera själv
  const list = allPlayers().sort((a, b) => b.wins - a.wins || b.kills - a.kills).map((p) => p.id);
  if (msg.winner) return [msg.winner, ...list.filter((id) => id !== msg.winner)].slice(0, 3);
  return list.slice(0, 3);
}

function startCeremony(msg) {
  const ranks = new Map();
  podiumOrder(msg).forEach((id, i) => {
    if (id && playerById(id)) ranks.set(id, i + 1);
  });
  // Först en repris av matchens sista dråp (om det finns inspelat), sedan prispallen
  const replayLength = startReplay();
  ceremony = { at: seconds() + (replayLength > 0 ? REPLAY_DELAY + replayLength + 0.5 : CEREMONY_WAIT), placed: false, risen: false, ranks, clappers: [] };
}

function ceremonyActive() {
  return !!(ceremony && ceremony.risen);
}

function endCeremony() {
  stopReplay();
  ceremony = null;
  arena.podium.hide();
  $("scoreboard").hidden = true;
  $("scoreboard").classList.remove("corner");
}

function updateCeremony(dt) {
  if (!ceremony || phase !== "matchEnd") return;
  const t = seconds() - ceremony.at;
  if (t < 0) return;
  if (!ceremony.risen) {
    // Pallen reser sig. Kropparna och de avhuggna delarna försvinner i ett dammoln.
    ceremony.risen = true;
    arena.podium.show();
    debris.clear();
    pendingPools.length = 0;
    $("death").hidden = true;
    $("spectate").hidden = true;
    const c = new THREE.Vector3(0, 0.2, 0);
    effects.dust(c, 30, 3);
    sound.kickHit?.(c);
    for (const p of allPlayers()) {
      p.dead = false;
      p.corpse = null;
      p.spectating = false;
      p.hp = COMBAT.maxHp;
      rebuildKnight(p);
      p.knight.group.visible = false;
    }
    arena.cheer(1);
  }
  if (!ceremony.placed && t >= CEREMONY_RISE) {
    ceremony.placed = true;
    ceremony.clappers = allPlayers().filter((p) => !ceremony.ranks.has(p.id)).map((p) => p.id);
    for (const p of allPlayers()) {
      const rank = ceremony.ranks.get(p.id);
      p.knight.group.visible = true;
      p.knight.playVictory(rank === 1 ? 1 : rank ? 2 : 3);
      const pos = positionOf(p);
      effects.dust(rank ? arena.podium.spot(rank) : pos, 6, 1);
    }
    arena.heraldBlow();
    arena.royalReact(true);
    arena.cheer(1.5);
    sound.matchWin();
    $("scoreboard").hidden = false;
  }
  if (!ceremony.placed) return;
  // Alla står på sin plats och gör sin segergest
  const yaw = arena.podium.yaw();
  const n = ceremony.clappers.length;
  for (const p of allPlayers()) {
    const rank = ceremony.ranks.get(p.id);
    const spot = rank ? arena.podium.spot(rank) : arena.podium.crowdSpot(ceremony.clappers.indexOf(p.id), n);
    const k = p.knight;
    k.group.position.copy(spot);
    // De som står framför vänder sig mot pallen
    k.group.rotation.y = rank ? yaw : Math.atan2(-spot.x, -spot.z);
    k.groundY = spot.y;
    if (p === me) {
      me.pos.copy(spot);
      me.yaw = k.group.rotation.y;
      me.vel.set(0, 0, 0);
    } else {
      p.target.copy(spot);
      p.targetYaw = k.group.rotation.y;
    }
    k.animate(dt, { speed: 0, forward: 0, side: 0, airborne: false });
  }
  // Publiken jublar då och då
  if (Math.random() < dt * 0.5) arena.cheer(0.6);
}

// ---------------------------------------------------------------------------
// Repris: alla riddares kroppsdelar spelas in (30 gånger i sekunden, de senaste 10 sekunderna).
// När matchen är slut visas matchens sista dråp igen från en annan vinkel.
// ---------------------------------------------------------------------------

const REC_RATE = 30;
const REC_SECONDS = 10;
const REPLAY_BEFORE = 2.2; // sekunder före dråpet
const REPLAY_AFTER = 1.5;  // och efter
const REPLAY_DELAY = 0.6;  // paus innan reprisen börjar
const recording = [];      // { t, objs: [Object3D], data: Float32Array, visible: [] }
let recTimer = 0;
let lastKill = null;       // { t, killer, victim, pos: Vector3, dir: Vector3 }
let replay = null;         // { start, end, at, startedAt, touched: Set, center, side }

// Allt som ska spelas in: riddarnas grupper och kroppsdelar, och lösa kroppsdelar på marken
function recordTargets() {
  const list = [];
  for (const p of allPlayers()) {
    const k = p.knight;
    if (!k || !k.group.parent) continue;
    list.push(k.group);
    for (const seg of Object.values(k.seg)) if (!seg.userData.detached) list.push(seg);
  }
  for (const r of debris.items) for (const b of r.bodies) if (b.object.parent) list.push(b.object);
  return list;
}

function recordFrame(dt) {
  if (replay || !(phase === "round" || phase === "roundEnd")) return;
  recTimer += dt;
  if (recTimer < 1 / REC_RATE) return;
  recTimer = 0;
  const objs = recordTargets();
  // Återanvänd den äldsta bilden när bufferten är full
  const frame = recording.length >= REC_RATE * REC_SECONDS ? recording.shift() : { data: new Float32Array(0) };
  if (frame.data.length < objs.length * 16) frame.data = new Float32Array(objs.length * 16 + 64);
  frame.t = seconds();
  frame.objs = objs;
  frame.visible = objs.map((o) => o.visible);
  objs.forEach((o, i) => frame.data.set(o.matrixWorld.elements, i * 16));
  recording.push(frame);
}

function noteKillForReplay(attacker, victim) {
  if (!victim) return;
  const pos = positionOf(victim).clone();
  const dir = attacker ? pos.clone().sub(positionOf(attacker)).setY(0) : new THREE.Vector3(1, 0, 0);
  if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
  dir.normalize();
  lastKill = { t: seconds(), pos, dir, from: attacker ? positionOf(attacker).clone() : pos.clone() };
}

// Returnerar hur lång reprisen blir (0 = ingen)
function startReplay() {
  if (!lastKill || !recording.length || seconds() - lastKill.t > REC_SECONDS - REPLAY_BEFORE) return 0;
  const start = Math.max(recording[0].t, lastKill.t - REPLAY_BEFORE);
  const end = Math.min(recording[recording.length - 1].t, lastKill.t + REPLAY_AFTER);
  if (end - start < 1) return 0;
  const center = lastKill.pos.clone().lerp(lastKill.from, 0.5);
  // Kameran ställs vid sidan av slaget (vinkelrätt mot riktningen), så man ser båda riddarna
  const side = new THREE.Vector3(-lastKill.dir.z, 0, lastKill.dir.x);
  replay = { start, end, startedAt: seconds() + REPLAY_DELAY, touched: new Set(), center, side, ended: false };
  lastKill = null;
  return end - start;
}

const _inv = new THREE.Matrix4();
const _rm = new THREE.Matrix4();
function updateReplay() {
  if (!replay) return false;
  const now = seconds();
  if (now < replay.startedAt) return false;
  const t = replay.start + (now - replay.startedAt);
  if (t > replay.end) {
    stopReplay();
    return false;
  }
  // Bilden närmast tiden t
  let frame = recording[0];
  for (const f of recording) {
    if (f.t > t) break;
    frame = f;
  }
  document.body.classList.add("replay");
  $("replay-label").hidden = false;
  // Sätt varje del där den var: lokal matris = (förälderns inspelade matris)⁻¹ × inspelad världsmatris
  const index = new Map(frame.objs.map((o, i) => [o, i]));
  frame.objs.forEach((o, i) => {
    if (!o.parent) return;
    _rm.fromArray(frame.data, i * 16);
    const pi = index.get(o.parent);
    if (pi !== undefined) _inv.fromArray(frame.data, pi * 16).invert();
    else _inv.copy(o.parent.matrixWorld).invert();
    o.matrixAutoUpdate = false;
    o.matrix.multiplyMatrices(_inv, _rm);
    o.matrixWorldNeedsUpdate = true;
    o.visible = frame.visible[i];
    replay.touched.add(o);
  });
  // Kameran glider långsamt runt dråpet
  const k = (t - replay.start) / Math.max(0.1, replay.end - replay.start);
  const c = replay.center;
  const s = replay.side;
  const swing = (k - 0.5) * 0.9;
  camera.position.set(
    c.x + (s.x * Math.cos(swing) - s.z * Math.sin(swing)) * 4.2,
    1.5 + k * 0.4,
    c.z + (s.z * Math.cos(swing) + s.x * Math.sin(swing)) * 4.2,
  );
  camera.lookAt(c.x, 1.0, c.z);
  return true;
}

function stopReplay() {
  if (!replay) return;
  for (const o of replay.touched) {
    o.matrixAutoUpdate = true;
  }
  // Kroppar på marken tillbaka där fysiken har dem
  for (const r of debris.items) r.sync();
  replay = null;
  document.body.classList.remove("replay");
  $("replay-label").hidden = true;
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
      cw: you.cw ?? you.look.w,
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
      nextThrust: 0,
      nextParry: 0,
      staggerUntil: 0,
      attackUntil: 0,
      diedAt: 0,
      crouch: false,     // hukar (håll C)
      rollStart: -100,   // när rullningen började
      rollDir: new THREE.Vector3(),
      nextRoll: 0,
      downUntil: 0,      // ligger på marken (omsparkad) till den här tiden
      legless: false,    // båda benen avhuggna: sitter på marken
      ready: !!you.ready, // redo-knappen i lobbyn
      holding: null,     // id på den jag håller fast
      heldBy: null,      // id på den som håller fast mig
    };
    me.knight = createKnight(me);
    msg.players.forEach(addOther);
    hostId = msg.host;
    round = msg.round;
    applyTime(msg.time);
    applyWeather(msg.weather);
    applyMap(msg.map);

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
    const changedWeapon = (player.look?.w ?? 0) !== (msg.look.w ?? 0);
    player.look = msg.look;
    if (player === me) {
      myLook = { ...msg.look };
      saveSetting("utseende", JSON.stringify(myLook));
      renderWeaponBar();
    }
    if (phase === "lobby") {
      player.cw = msg.look.w;
      rebuildKnight(player);
      lineup();
      renderLobby();
    } else if (phase === "countdown" && changedWeapon && !player.dead && !player.spectating) {
      // Bytte vapen under nedräkningen: gäller redan i rundan som börjar
      player.cw = msg.look.w;
      const pos = positionOf(player).clone();
      const yaw = player === me ? me.yaw : player.knight.group.rotation.y;
      rebuildKnight(player);
      player.knight.group.position.copy(pos);
      player.knight.group.rotation.y = yaw;
      effects.dust(pos, 4, 0.8);
      sound.pickup(pos);
    }
    // Mellan rundorna i övrigt: det nya vapnet kommer nästa runda
  },

  // Lobbyledaren valde dag eller kväll
  time(msg) {
    applyTime(msg.v);
    renderLobby();
  },

  // Lobbyledaren valde väder
  weather(msg) {
    applyWeather(msg.v);
    renderLobby();
  },

  // Lobbyledaren valde bana
  map(msg) {
    applyMap(msg.v);
    renderLobby();
  },

  // Borggården: riddarna marscherar ut genom porten innan första rundan
  intro(msg) {
    setPhase("intro");
    $("match-lobby").hidden = true;
    $("scoreboard").hidden = true;
    $("bracket").hidden = true;
    $("death").hidden = true;
    $("spectate").hidden = true;
    if (document.pointerLockElement) document.exitPointerLock();
    intro = { start: seconds(), dur: msg.seconds, order: msg.order, spots: msg.spots, announced: new Set(), skipped: false };
    sound.setBattleMusic(true);
    arena.cheer(0.8);
    callout(`Välkomna till ${MAP_NAMES[mapKind]}!`, 1800);
  },

  skipVote(msg) {
    if (phase !== "intro") return;
    callout(`Hoppa över: ${msg.n} av ${msg.of} har tryckt`, 1200);
  },

  // Någon tryckte på redo-knappen
  ready(msg) {
    const p = playerById(msg.id);
    if (!p) return;
    p.ready = msg.on === 1;
    renderLobby();
  },

  // Någon kastade sitt vapen: det flyger rakt fram tills servern säger var det tog vägen (throwEnd)
  throw(msg) {
    const p = playerById(msg.id);
    if (!p) return;
    const knight = p.knight;
    if (p !== me) knight.playAttack("x");
    const windup = COMBAT.throw.windup;
    const w = msg.w;
    p.cw = FISTS;
    // Vapnet lämnar handen när kastet släpps
    setTimeout(() => {
      if (knight.disposed || p.knight !== knight) return;
      const hand = knight.segmentPosition("handR", new THREE.Vector3()) || new THREE.Vector3(...msg.from);
      const end = pendingThrowEnds.get(msg.item.id);
      pendingThrowEnds.delete(msg.item.id);
      spawnItem(msg.item, knight, hand, w, {
        flight: { from: new THREE.Vector3(...msg.from), dir: msg.dir, range: msg.range, speed: msg.speed, owner: p },
      });
      if (end) finishThrow(end);
      knight.dropWeapon();
      sound.swing(hand, true, "h", SWING_SOUND[w] ?? 0);
    }, windup * 1000);
    if (p === me) renderCooldowns();
  },

  // Kastet är klart (se finishThrow)
  throwEnd(msg) {
    finishThrow(msg);
  },

  // Brottning
  grabTry(msg) {
    const p = playerById(msg.id);
    if (p && p !== me) p.knight.setGrab("reach");
  },

  grab(msg) {
    const holder = playerById(msg.id);
    const target = playerById(msg.target);
    if (!holder || !target) return;
    holder.knight.setGrab("hold");
    target.knight.setGrab("held");
    holder.holding = target.id;
    target.heldBy = holder.id;
    sound.grunt(positionOf(holder), voiceOf(holder), true);
    sound.kickHit(positionOf(target));
    arena.cheer(0.5);
    if (target === me) {
      stopCharging(false);
      me.vel.set(0, 0, 0);
      callout(`${holder.name} har tagit tag i dig! Tryck ${K("grab")} snabbt för att slita dig loss`, 1800);
    }
    if (holder === me) callout("Vänsterklick: slå · R: knuffa iväg · F: kasta omkull", 2000);
  },

  struggle(msg) {
    const p = playerById(msg.id);
    if (p) p.knight.playStruggle();
  },

  grabEnd(msg) {
    const holder = playerById(msg.id);
    const target = playerById(msg.target);
    if (holder) {
      holder.knight.setGrab(null);
      holder.holding = null;
    }
    if (!target) return;
    target.knight.setGrab(null);
    target.heldBy = null;
    if (target === me) nextGrabTry = seconds() + 1; // inte ta tag direkt av alla knapptryck man slet med
    const pos = positionOf(target);
    if (msg.how === "shove") {
      target.knight.playStagger();
      effects.dust(pos, 8, 1.5);
      sound.kickHit(pos);
      arena.cheer(0.6);
      if (target === me) {
        me.knock.set(msg.dir[0] * COMBAT.grab.shove, 0, msg.dir[1] * COMBAT.grab.shove);
        me.staggerUntil = seconds() + 0.9;
        shake = 0.2;
      }
    } else if (msg.how === "down") {
      target.knight.playKnockdown();
      sound.fall(pos);
      effects.dust(pos, 14, 2);
      arena.cheer(1);
      if (target === me) {
        knockMeDown();
        shake = 0.3;
        callout(`Kastad omkull! (${K("roll")} rullar undan)`, 1300);
      }
    } else if (msg.how === "escape") {
      if (holder) holder.knight.playStagger();
      sound.grunt(pos, voiceOf(target), true);
      if (holder === me) me.staggerUntil = seconds() + 0.6;
      if (target === me) callout("Du slet dig loss!", 900);
    }
  },

  // Någon rullar
  roll(msg) {
    const other = others.get(msg.id);
    if (!other || other.dead) return;
    const yaw = other.knight.group.rotation.y;
    other.knight.playRoll(localDir(msg.dir, yaw));
    sound.roll(other.knight.group.position);
  },

  // Någon plockade upp ett vapen från marken (och lade kanske ner sitt gamla)
  pick(msg) {
    const player = playerById(msg.id);
    removeItem(msg.item);
    if (!player) return;
    if (msg.drop) spawnItem(msg.drop, player.knight, positionOf(player), weaponOf(player));
    player.cw = msg.w;
    player.knight.setWeapon(msg.w);
    sound.pickup(positionOf(player));
    if (player === me) {
      callout("Du tog upp: " + (WEAPONS[msg.w] ?? "vapen"), 1200);
      me.nextQuick = me.nextHeavy = me.nextThrust = seconds() + 0.3;
    }
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
    if (msg.down) {
      victim.knight.playKnockdown();
      sound.fall(pos);
      effects.dust(pos, 14, 2);
      arena.cheer(0.8);
      if (msg.by === me?.id) callout(`${victim.name} ramlade omkull!`, 1100);
    } else {
      victim.knight.playStagger();
      effects.dust(pos, 7, 1.6);
      arena.cheer(0.3);
    }
    sound.kickHit(pos);
    if (victim === me) {
      me.knock.set(msg.dir[0] * COMBAT.kick.push, 0, msg.dir[1] * COMBAT.kick.push);
      me.staggerUntil = seconds() + COMBAT.kick.stagger;
      if (msg.down) knockMeDown();
      stopCharging(false);
      shake = msg.down ? 0.3 : 0.15;
      callout(msg.down ? `Du ramlade! (${K("roll")} rullar undan)` : "Sparkad!", msg.down ? 1300 : 900);
    }
  },

  // ----- Rundor -----

  countdown(msg) {
    if (intro) {
      intro = null;
      arena.closeGate?.();
    }
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
    clearItems();
    // Ny match: rustningarna är hela och rena igen
    if (round === 1) {
      for (const p of allPlayers()) p.wear = freshWear();
      recording.length = 0;
      lastKill = null;
    }
    for (const p of allPlayers()) {
      p.helmetOff = false;
      p.cw = p.look?.w ?? 0; // alla börjar rundan med sitt valda vapen
    }
    for (const p of allPlayers()) {
      p.holding = null;
      p.heldBy = null;
    }
    if (me) {
      me.crouch = false;
      me.legless = false;
      me.downUntil = 0;
      me.rollStart = -100;
      me.nextRoll = 0;
    }
    renderWeaponBar();

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
        me.nextQuick = me.nextHeavy = me.nextThrust = me.nextParry = 0;
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
    // Utmärkelser: vem hade mest av vad?
    $("score-counted").textContent = msg.counted === false ? "Matchen räknades inte till topplistan (minst två riktiga spelare behövs)." : msg.counted ? "Matchen är sparad på topplistan." : "";
    const awardList = $("awards");
    awardList.innerHTML = "";
    for (const a of msg.awards || []) {
      const info = AWARDS.find((x) => x.key === a.key);
      const p = playerById(a.id);
      if (!info || !p) continue;
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = info.title;
      li.append(b, ` ${p.name}${p === me ? " (du)" : ""} – ${info.text} (${a.v})`);
      awardList.appendChild(li);
    }
    $("scoreboard").hidden = true;
    $("scoreboard").classList.add("corner");
    if (document.pointerLockElement) document.exitPointerLock();
    arena.cheer(1.5);
    sound.roundWin();
    sound.setBattleMusic(false);
    renderPlayerList();
    startCeremony(msg);
  },

  lobby() {
    duel = null;
    teamWins = [0, 0];
    $("bracket").hidden = true;
    endCeremony();
    clearItems();
    for (const p of allPlayers()) {
      p.cw = p.look?.w ?? 0;
      p.ready = !!p.bot;
      p.holding = null;
      p.heldBy = null;
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
    other.knight.setCrouch(msg.c === 1);
  },

  ch(msg) {
    const other = others.get(msg.id);
    if (other) other.knight.setCharging(msg.on === 1);
  },

  atk(msg) {
    if (msg.k === "p" && msg.id === me?.id) return; // mitt eget slag visas redan
    const other = others.get(msg.id);
    if (!other) return;
    other.knight.playAttack(msg.k);
    const pos = other.knight.group.position;
    sound.swing(pos, msg.k === "h" || weaponSpec(weaponOf(other)).twoHanded, msg.k, swingSound(other));
    sound.grunt(pos, voiceOf(other), msg.k === "h");
    checkQuintain(other, msg.k);
  },

  // Zweihändern missade ett tungt slag: riddaren snurrar runt av tyngden
  whiff(msg) {
    const player = playerById(msg.id);
    if (!player || player.dead) return;
    player.knight.playWhiff();
    const pos = positionOf(player);
    effects.dust(pos, 8, 1.4);
    sound.grunt(pos, voiceOf(player), true);
    arena.cheer(0.25);
    if (player === me) {
      me.staggerUntil = seconds() + (weaponSpec(weaponOf(me)).whiffStagger ?? 0.9);
      stopCharging(false);
      callout("Bom! Svärdet drog med dig runt", 1400);
    }
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
      // Tvåhandsvapen och knytnävar parerar med stål, de andra med skölden
      const w = weaponOf(defender);
      const shield = w !== FISTS && !weaponSpec(w).twoHanded && !weaponSpec(w).noShield && !defender.knight.seg.handL.userData.detached;
      sound.clang(spot, shield ? "shield" : "blade");
      if (shield) effects.dust(spot, 2, 0.4); // flisor från skölden
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
    const chest = knight.chestPosition(new THREE.Vector3());
    const bleeding = msg.k === "b"; // utan ben: blöder lite varje sekund (ingen träff)
    // Kastet fastnade i skölden: lite skada, inget blod (skölden smällen syns i throwEnd)
    if (msg.sh && !msg.dead) {
      if (victim === me) renderHp();
      else knight.setHp(msg.hp);
      sound.hurt(chest, voiceOf(victim), 0.35);
      return;
    }

    // Åt vilket håll flyger delarna och blodet? Bort från den som slog.
    const dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5);
    if (attacker && !bleeding) dir.copy(positionOf(victim)).sub(positionOf(attacker));
    dir.y = 0;
    dir.normalize();
    const heavy = msg.k === "h";

    if (bleeding) {
      effects.blood(chest.clone().setY(0.3), 4, dir, 0.4);
      if (victim === me) renderHp();
      else knight.setHp(msg.hp);
    } else {
      knight.setHighlight(null);
      if (highlightedKnight === knight) highlightedKnight = null;
      knight.flash();
      // Blodet sprutar där träffen landade (den siktade kroppsdelen), annars från bröstet
      const spot = (msg.seg && knight.segmentPosition(msg.seg, new THREE.Vector3())) || chest;
      const blunt = weaponSpec(weaponOf(attacker)).blunt;
      effects.blood(spot, heavy ? 26 : blunt ? 10 : 14, dir, heavy ? 1.3 : 1);
      sound.hit(spot, heavy, soundWeapon(attacker));
      if (!msg.dead && !msg.sev) sound.hurt(spot, voiceOf(victim), heavy ? 1 : 0.55);

      // Hjälmen flyger av (tunga slag mot huvudet, hammare)
      if (msg.hk) {
        const helmet = knight.knockHelmet([dir.x * 3 + (Math.random() - 0.5), 3.5, dir.z * 3 + (Math.random() - 0.5)], scene, RAGDOLL_BOUNDS);
        if (helmet) {
          debris.add(helmet);
          sound.helmetOff(spot);
          arena.cheer(0.5);
        }
        victim.helmetOff = true;
      }

      // Bucklor, repor, smuts och blod sparas så att de syns resten av matchen. Hammare bucklar mer.
      if (!victim.wear) victim.wear = freshWear();
      const dentSeg = msg.seg && msg.seg !== "pelvis" ? msg.seg : "torso";
      victim.wear.dents += knight.addWear(dentSeg, heavy || blunt);
      if (blunt) victim.wear.dents += knight.addWear(dentSeg, true);
      victim.wear.scratches += heavy ? 2 : 1;
      victim.wear.blood += heavy ? 2 : 1;
      victim.wear.dirt = Math.min(1, victim.wear.dirt + 0.05);

      // Riddaren rycker till bort från slaget, får blod på rustningen; vapnet blir blodigt och får hack i eggen
      const yaw = knight.group.rotation.y;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      knight.playHit([-(dir.x * c - dir.z * s), -(dir.x * s + dir.z * c)]);
      for (let i = 0; i < (heavy ? 3 : 2); i++) knight.addBloodSplat(i === 0 ? dentSeg : Math.random() < 0.5 ? "torso" : dentSeg);
      if (attacker && attacker.knight) {
        attacker.knight.bloodySword();
        if (Math.random() < (heavy ? 0.5 : 0.25) && attacker.knight.addNick()) {
          if (!attacker.wear) attacker.wear = freshWear();
          attacker.wear.nicks = (attacker.wear.nicks || 0) + 1;
        }
      }
    }

    // Vapnet tappas (vapenarmen huggen av, eller död) och hamnar på marken
    if (msg.drop) {
      spawnItem(msg.drop, knight, chest, weaponOf(victim));
      knight.dropWeapon();
      victim.cw = FISTS;
      if (victim === me && !msg.dead) callout("Du tappade vapnet! Tryck E vid ett vapen för att ta upp det", 1800);
    }

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

    // Trubbiga vapen: vinglar till. Släggan: ramlar omkull.
    if (msg.st && !msg.dead) {
      knight.playStagger();
      if (victim === me) me.staggerUntil = Math.max(me.staggerUntil, seconds() + (weaponSpec(weaponOf(attacker)).hitStagger ?? 0.3));
    }
    if (msg.kd && !msg.dead) {
      knight.playKnockdown();
      sound.fall(positionOf(victim));
      effects.dust(positionOf(victim), 12, 1.8);
      if (victim === me) knockMeDown();
    }
    // Båda benen borta: sitter på marken resten av rundan
    if (msg.ll && !msg.dead) {
      knight.setLegless();
      victim.legless = true;
      if (victim === me) {
        me.legless = true;
        me.crouch = false;
        me.vel.set(0, 0, 0);
        stopCharging(false);
        callout("Du har inga ben kvar! Du kan bara vrida dig, slå och parera", 2200);
      }
    }

    if (!bleeding) {
      if (victim === me) {
        shake = msg.k === "h" ? 0.35 : 0.2;
        flashVignette();
        renderHp();
      } else {
        knight.setHp(msg.hp);
      }
    }

    if (msg.dead) {
      victim.dead = true;
      effects.blood(chest, bleeding ? 10 : 30, dir, 1.4);
      sound.scream(chest, voiceOf(victim));
      arena.cheer(1);
      arena.royalReact(Math.random() < 0.7); // kungen visar tummen upp (eller ner)
      // Kroppen blir en ragdoll; en osynlig ny riddare står kvar tills nästa runda
      const force = msg.k === "h" ? 4 : bleeding ? 0.5 : 2.5;
      // Hur kroppen faller beror på vad som hände (se Knight.deathDrive)
      const legSev = /^(ankle|knee|hip)([LR])$/.exec(msg.sev || "");
      const style = msg.sev === "neck" ? "decap"
        : legSev ? "leg"
        : bleeding ? "slump"
        : msg.k === "t" ? "gut"
        : msg.k === "h" || weaponSpec(weaponOf(attacker)).knockdown ? "heavy"
        : "stumble";
      const corpse = knight.die([dir.x * force, bleeding ? 0.5 : 2, dir.z * force], scene, RAGDOLL_BOUNDS, style, { side: legSev ? legSev[2] : null });
      debris.add(corpse);
      poolLater(corpse, msg.sev === "neck" || msg.sev === "waist" ? 1.5 : 1.1);
      victim.corpse = corpse;
      victim.knight = createKnight(victim);
      victim.knight.group.position.copy(positionOf(victim));
      victim.knight.group.visible = false;

      addKill(attacker ? attacker.name : "?", victim.name);
      noteKillForReplay(attacker, victim);
      if (victim === me) {
        me.diedAt = seconds();
        stopCharging(false);
        $("killer").textContent = attacker ? attacker.name : "okänd";
        $("death").hidden = false;
      }
      if (attacker === me && !bleeding) callout("Du högg ner " + victim.name + "!");
    }
    renderPlayerList();
  },

  full() {
    wasFull = true;
    showLobbyError("Rummet är fullt (max 6 riddare).");
  },

  nameTaken(msg) {
    wasFull = true;
    showLobbyError(`Namnet "${msg.name}" används redan av någon annan på topplistan. Välj ett annat namn, eller skriv in din återställningskod nedanför om namnet är ditt.`);
    $("restore").open = true;
  },

  board(msg) {
    renderBoard(msg);
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
    cw: player.cw ?? player.look?.w ?? 0,
    bot: !!player.bot,
    ready: !!player.ready,
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
  if (player.c) other.knight.setCrouch(true);
  // Kroppsdelar som redan är avhuggna ramlar till marken
  for (const joint of player.severed || []) {
    debris.add(other.knight.sever(joint, [0, 0, 0], scene, RAGDOLL_BOUNDS));
  }
}

// Varje riddare får sin egen röst (ljusare eller mörkare), räknad från spelarens id
// rasp = hur hes rösten är, muffle = stängd hjälm (låter dovt)
function voiceOf(player) {
  let h = 0;
  let h2 = 7;
  for (const ch of player.id) {
    h = (h * 31 + ch.charCodeAt(0)) % 997;
    h2 = (h2 * 17 + ch.charCodeAt(0)) % 991;
  }
  const k = player.knight;
  return { v: h / 997, rasp: h2 / 991, muffle: !!(k && k.closedHelmet && !k.helmetOff && !player.helmetOff) };
}

// ----- Introt i borggården -----
let intro = null;
const _ip = new THREE.Vector3();
const _iq = new THREE.Vector3();
function introPath(id, index) {
  const [gateIn, gateOut, lowGate] = arena.gatePath || [new THREE.Vector3(0, 0, -20), new THREE.Vector3(0, 0, -15), new THREE.Vector3(0, 0, -9)];
  const out = gateIn.clone().normalize();
  const queue = gateIn.clone().addScaledVector(out, 1 + index * 1.1); // de väntar på rad innanför porten
  const spot = intro.spots?.[id];
  const end = spot ? new THREE.Vector3(spot.p[0], 0, spot.p[2]) : new THREE.Vector3((index - 2) * 1.5, 0, -2);
  return { pts: [queue, gateIn, gateOut, lowGate, end], yaw: spot ? spot.r : 0 };
}
function pointOnPath(pts, dist, out, dirOut) {
  for (let i = 0; i < pts.length - 1; i++) {
    const len = pts[i].distanceTo(pts[i + 1]);
    if (dist <= len || i === pts.length - 2) {
      const f = Math.min(1, len > 0 ? dist / len : 1);
      out.lerpVectors(pts[i], pts[i + 1], f);
      dirOut.subVectors(pts[i + 1], pts[i]).normalize();
      return f >= 1 && i === pts.length - 2;
    }
    dist -= len;
  }
  return true;
}
function updateIntro(dt) {
  if (!intro) {
    orbitCamera(18, 9, 0.00008, 0.5); // kom in mitt i introt: titta på borggården
    return;
  }
  const e = seconds() - intro.start;
  if (e > 1.4 && e < intro.dur - 1.3) arena.openGate?.();
  else if (e >= intro.dur - 1.3) arena.closeGate?.();
  const players = intro.order.map((id) => playerById(id)).filter(Boolean);
  const SPEED = 2.3;
  let follow = null;
  players.forEach((p, i) => {
    const knight = p.knight;
    if (!knight) return;
    const { pts, yaw } = introPath(p.id, i);
    const startT = 2.4 + i * 0.9;
    const walked = Math.max(0, e - startT) * SPEED;
    const done = pointOnPath(pts, walked, _ip, _iq);
    knight.group.position.copy(_ip);
    const targetYaw = done ? yaw : Math.atan2(_iq.x, _iq.z);
    knight.group.rotation.y = angleLerp(knight.group.rotation.y, targetYaw, 1 - Math.exp(-dt * 8));
    const moving = walked > 0 && !done;
    knight.animate(dt, { speed: moving ? SPEED : 0, forward: moving ? SPEED : 0, side: 0, airborne: false });
    if (p === me) me.pos.copy(_ip);
    // Härolden ropar ut namnet när riddaren kliver ut genom porten
    const passed = walked > pts[0].distanceTo(pts[1]) + 0.6;
    if (passed && !intro.announced.has(p.id)) {
      intro.announced.add(p.id);
      const leader = boardTopName && p.name.toLowerCase() === boardTopName;
      callout(leader ? `👑 ${p.name}! 👑` : `${p.name}!`, 1100);
      arena.cheer(leader ? 1.3 : 0.7);
      sound.crowd?.(leader ? 1.2 : 0.8);
      if (i === 0) arena.heraldBlow?.();
    }
    if (walked > 0 && !done) follow = knight.group.position;
  });
  // Kameran: svep över borggården, sedan vid porten och följer riddarna, till sist en överblick
  if (e < 2.4) {
    const a = -0.9 + e * 0.32;
    camera.position.set(Math.sin(a) * 24, 13 - e * 1.5, Math.cos(a) * 22);
    camera.lookAt(0, 1, -4);
  } else if (follow && e < intro.dur - 1.8) {
    const g = (arena.gatePath || [])[2] || new THREE.Vector3(0, 0, -9);
    _iq.set(g.x * 0.4 + 2.2, 2.4, g.z + 5.5);
    camera.position.lerp(_iq, 1 - Math.exp(-dt * 2));
    camera.lookAt(follow.x, 1.4, follow.z);
  } else {
    _iq.set(0, 9, 15);
    camera.position.lerp(_iq, 1 - Math.exp(-dt * 1.2));
    camera.lookAt(0, 1, -1);
  }
}

// I borggården syns andedräkten som små moln i kylan
function updateBreath(dt) {
  if (mapKind !== "castle" || phase === "start") return;
  for (const p of allPlayers()) {
    if (p.dead || !p.knight || p.knight.group.parent !== scene) continue;
    p.breathT = (p.breathT ?? Math.random() * 2) - dt;
    if (p.breathT > 0) continue;
    const tired = p.hp !== undefined && p.hp < 35;
    p.breathT = tired ? 0.9 : 2 + Math.random() * 0.8;
    const head = p.knight.seg.head;
    head.updateWorldMatrix(true, false);
    _ip.set(0, 0.09, 0.16).applyMatrix4(head.matrixWorld);
    effects.spawnPuff(_ip, 0xf4f6fa, tired ? 0.4 : 0.28, 0.08, 1.1, 0.15, 0.12);
  }
}

// Riddarna tittar på närmaste motståndare (irisen i ögonen följer)
const _gaze = new Map();
function updateGaze() {
  const list = allPlayers().filter((p) => p.knight && !p.dead);
  for (const p of list) {
    const a = positionOf(p);
    let best = null;
    let bd = Infinity;
    for (const q of list) {
      if (q === p) continue;
      const b = positionOf(q);
      const d = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (!best) {
      p.knight.gazeTarget = null;
      continue;
    }
    const v = _gaze.get(p.id) || new THREE.Vector3();
    _gaze.set(p.id, v);
    p.knight.gazeTarget = v.set(best.x, (best.y || 0) + 1.6, best.z);
  }
}

// Flämtar när man har lite liv kvar
function updatePanting(dt) {
  if (phase !== "round") return;
  for (const p of allPlayers()) {
    if (p.dead || !p.knight || p.hp > 35) continue;
    p.pantT = (p.pantT ?? Math.random()) - dt;
    if (p.pantT <= 0) {
      p.pantT = 0.95 + Math.random() * 0.5 - (35 - p.hp) * 0.008;
      sound.pant(positionOf(p), voiceOf(p), 0.6 + (35 - p.hp) / 50);
    }
  }
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
// Vapen på marken: tappade vapen ligger kvar och kan plockas upp med E
// ---------------------------------------------------------------------------

const items = new Map(); // id → { id, w, p, group, from, t }
const pendingThrowEnds = new Map(); // throwEnd som kom innan vapnet lämnade handen

// Kastet är klart: i sanden, parerat, i skölden eller en träff (skadan kommer som ett vanligt "hit")
function finishThrow(msg) {
  const item = items.get(msg.item);
  if (!item) {
    pendingThrowEnds.set(msg.item, msg); // kom fram innan vapnet hann lämna handen här
    return;
  }
  item.p = msg.p;
  const target = playerById(msg.id);
  if (item.flight) {
    // Faller ner från där det är nu till där servern lade det
    item.from = item.group.position.clone();
    item.flight = null;
    item.t = 0;
    item.fly = msg.how === "land" ? 0.12 : 0.35;
    item.bounced = msg.how === "parry" || msg.how === "shield";
  }
  if (!target) return;
  const spot = target.knight.chestPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.15, 0));
  if (msg.how === "parry") {
    target.knight.playParry();
    effects.sparks(spot);
    sound.clang(spot, "blade");
    arena.cheer(0.6);
    if (target === me) callout("Parerade kastet!");
  } else if (msg.how === "shield") {
    target.knight.playParry();
    sound.clang(spot, "shield");
    effects.dust(spot, 3, 0.5);
    arena.cheer(0.4);
    if (target === me) {
      me.staggerUntil = Math.max(me.staggerUntil, seconds() + COMBAT.throw.shieldStagger);
      callout("Skölden tog emot!");
    }
  }
}


let armory = null;       // en osynlig riddare som bygger vapenmodeller när ingen annan kan

// Lägg ut ett vapen. builder = riddaren vars material används, from = varifrån det flyger
// opts.fly = flygtid i sekunder (kastat vapen: rakt och snurrande), annars en kort båge ner till marken
function spawnItem(item, builder, from, kind = item.w, opts = {}) {
  if (!item || items.has(item.id)) return;
  let model = null;
  try {
    model = (builder && !builder.disposed ? builder : getArmory()).buildItemModel(kind);
  } catch {
    model = getArmory().buildItemModel(kind);
  }
  if (!model) return;
  const spec = weaponSpec(kind);
  // Ligg platt: klingor med bredsidan nedåt, yxor och hammare med bladet åt sidan
  const sideways = ["axe", "daneaxe", "halberd", "warhammer", "maul"].includes(spec.key);
  model.rotation.set(Math.PI / 2, sideways ? Math.PI / 2 : 0, 0);
  const lift = spec.key === "maul" ? 0.075 : spec.key === "warhammer" ? 0.04 : 0.025;
  const group = new THREE.Group();
  group.add(model);
  group.rotation.y = item.r ?? 0;
  scene.add(group);
  const entry = {
    id: item.id, w: item.w, p: item.p, group, lift,
    from: from ? from.clone() : new THREE.Vector3(item.p[0], 1, item.p[2]),
    t: 0,
    fly: opts.fly ?? 0.5,
    thrown: !!opts.flight,
    flight: opts.flight ?? null,
    flown: 0,
    warned: false,
  };
  group.position.copy(entry.from);
  items.set(item.id, entry);
}

function getArmory() {
  if (!armory) armory = new Knight(0x8a8a8a, null, { a: 0, h: 2, s: 0, w: 0, c: 0 }, { seed: 3 });
  return armory;
}

function removeItem(id) {
  const item = items.get(id);
  if (!item) return;
  item.group.removeFromParent();
  items.delete(id);
}

function clearItems() {
  pendingThrowEnds.clear();
  for (const id of [...items.keys()]) removeItem(id);
}

// Vapnen flyger i en båge från handen till marken och snurrar; sen ligger de still.
// Kastade vapen flyger rakt fram med serverns fart tills throwEnd kommer.
function throwHeight(f) {
  return f < 0.7 ? 1.45 : 1.45 * (1 - ((f - 0.7) / 0.3) ** 2);
}

function updateItems(dt) {
  for (const item of items.values()) {
    const g = item.group;
    if (item.flight) {
      const F = item.flight;
      item.flown = Math.min(F.range, item.flown + F.speed * dt);
      const f = item.flown / Math.max(0.01, F.range);
      // Från handen glider det in på serverns linje under första metern
      const blend = Math.min(1, item.flown / 1.2);
      const lx = F.from.x + F.dir[0] * item.flown;
      const lz = F.from.z + F.dir[1] * item.flown;
      const ly = Math.max(item.lift, throwHeight(f));
      g.position.set(
        item.from.x + (lx - item.from.x) * blend,
        item.from.y + (ly - item.from.y) * blend,
        item.from.z + (lz - item.from.z) * blend,
      );
      g.children[0].rotation.x = Math.PI / 2 + item.flown * 0.9;
      // Ett vinande när det kommer mot en (en varning)
      if (!item.warned && me && !me.dead && F.owner !== me) {
        const dx = me.pos.x - g.position.x;
        const dz = me.pos.z - g.position.z;
        const ahead = dx * F.dir[0] + dz * F.dir[1];
        const side = Math.abs(dx * F.dir[1] - dz * F.dir[0]);
        if (ahead > 0 && ahead < 5 && side < 1.6) {
          item.warned = true;
          sound.swing(g.position, true, "h", SWING_SOUND[item.w] ?? 0);
        }
      }
      continue;
    }
    const FLY = item.fly;
    if (item.t >= FLY) continue;
    item.t = Math.min(FLY, item.t + dt);
    const f = item.t / FLY;
    if (item.thrown) {
      // Faller ner till marken (studsar lite upp om det parerades eller tog i skölden)
      const hop = item.bounced ? Math.sin(f * Math.PI) * 0.5 : 0;
      g.position.set(
        item.from.x + (item.p[0] - item.from.x) * f,
        item.from.y * (1 - f * f) + item.lift * f * f + hop,
        item.from.z + (item.p[2] - item.from.z) * f,
      );
      g.children[0].rotation.x += dt * (item.bounced ? 16 : 6) * (1 - f);
    } else {
      g.position.set(
        item.from.x + (item.p[0] - item.from.x) * f,
        item.from.y * (1 - f) + item.lift * f + Math.sin(f * Math.PI) * 0.6,
        item.from.z + (item.p[2] - item.from.z) * f,
      );
      g.children[0].rotation.z = (1 - f) * 5;
    }
    if (f >= 1) {
      g.children[0].rotation.z = 0;
      g.children[0].rotation.x = Math.PI / 2;
      effects.dust(g.position, item.thrown ? 6 : 3, item.thrown ? 1 : 0.6);
      sound.pickup?.(g.position);
    }
  }
  // Står man nära ett vapen visas en ledtråd
  let near = null;
  if (me && phase === "round" && !me.dead && !me.knight.seg.handR.userData.detached) {
    let best = 2.0;
    for (const item of items.values()) {
      if (item.flight) continue;
      const d = Math.hypot(item.p[0] - me.pos.x, item.p[2] - me.pos.z);
      if (d < best) {
        best = d;
        near = item;
      }
    }
  }
  nearItem = near;
  const hint = $("pickup-hint");
  if (near) {
    hint.textContent = `${K("pickup")} – ${weaponOf(me) === FISTS ? "ta upp" : "byt till"} ${WEAPONS[near.w] ?? "vapen"}`;
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
}
let nearItem = null;

function tryPickup() {
  if (!nearItem || !canAct()) return;
  net.send({ t: "pick", item: nearItem.id });
}

// ---------------------------------------------------------------------------
// Rulla, huka och ramla
// ---------------------------------------------------------------------------

// En riktning i världen [x, z] uttryckt i riddarens egna koordinater (+x = vänster, +z = framåt)
function localDir(dir, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [dir[0] * c - dir[1] * s, dir[0] * s + dir[1] * c];
}

function rolling() {
  return me && seconds() - me.rollStart < COMBAT.roll.time;
}

function isDown() {
  return me && seconds() < me.downUntil;
}

function knockMeDown() {
  me.downUntil = seconds() + COMBAT.down.time;
  me.staggerUntil = Math.max(me.staggerUntil, me.downUntil);
  me.vel.set(0, 0, 0);
  me.crouch = false;
}

// Ctrl (eller C) + Mellanslag: rulla åt det håll man går (framåt om man står still). Går också att rulla upp från marken.
function tryRoll() {
  if (!me || me.dead || phase !== "round" || me.legless || me.holding || me.heldBy) return;
  const t = seconds();
  if (t < me.nextRoll || rolling() || !me.onGround) return;
  if (t < me.staggerUntil && !isDown()) return;
  const dir = new THREE.Vector3();
  forward.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  right.set(-Math.cos(camYaw), 0, Math.sin(camYaw));
  if (binds.held("forward", keys)) dir.add(forward);
  if (binds.held("back", keys)) dir.sub(forward);
  if (binds.held("right", keys)) dir.add(right);
  if (binds.held("left", keys)) dir.sub(right);
  if (dir.lengthSq() < 0.01) dir.copy(forward);
  dir.normalize();
  me.rollStart = t;
  me.nextRoll = t + COMBAT.roll.cooldown;
  me.rollDir.copy(dir);
  me.downUntil = 0;
  me.staggerUntil = Math.min(me.staggerUntil, t);
  stopCharging(true);
  me.yaw = camYaw;
  me.knight.playRoll(localDir([dir.x, dir.z], me.yaw));
  sound.roll(me.pos);
  sendStateNow();
  net.send({ t: "roll", dir: [Math.round(dir.x * 100) / 100, Math.round(dir.z * 100) / 100] });
}

// ---------------------------------------------------------------------------
// Byta vapen mellan rundorna (mushjulet eller ◀ ▶)
// ---------------------------------------------------------------------------

function canSwapWeapon() {
  return me && (phase === "countdown" || phase === "roundEnd" || phase === "bracket");
}

let pendingWeapon = null;
let weaponSendTimer = null;
function changeWeapon(dir) {
  if (!canSwapWeapon()) return;
  const current = pendingWeapon ?? me.look.w ?? 0;
  pendingWeapon = (current + dir + WEAPONS.length) % WEAPONS.length;
  renderWeaponBar();
  sound.unlock();
  clearTimeout(weaponSendTimer);
  // Vänta lite så att man kan scrolla förbi flera vapen utan att skicka varje
  weaponSendTimer = setTimeout(() => {
    if (pendingWeapon === null || !canSwapWeapon()) return;
    const look = { ...me.look, w: pendingWeapon };
    pendingWeapon = null;
    net.send({ t: "look", look });
  }, 250);
}

function renderWeaponBar() {
  const bar = $("weapon-bar");
  if (!bar) return;
  const show = canSwapWeapon() && !me.spectating;
  bar.hidden = !show;
  if (!show) return;
  const w = pendingWeapon ?? me.look.w ?? 0;
  $("weapon-name").textContent = WEAPONS[w] ?? "";
  $("weapon-desc").textContent = WEAPON_INFO[w] ?? "";
  $("weapon-when").textContent = phase === "countdown" ? "Gäller direkt i rundan som börjar" : "Gäller från nästa runda";
}

// Kort beskrivning av varje vapen (lobbyn och vapenraden)
const WEAPON_INFO = [
  "Allround med sköld. Bra stöt.",
  "Med sköld. Lite hårdare, hugger av lemmar lättare.",
  "Med sköld. Går ibland runt pareringar.",
  "Tvåhandsvapen. Längre och hårdare, långsammare.",
  "Tvåhandsvapen. Väldigt hårt, hugger av allt.",
  "Tvåhandsvapen. Längst räckvidd, svag på nära håll.",
  "Tvåhandsvapen. Enormt! Missar du ett tungt slag snurrar du runt.",
  "Tvåhandsvapen. Bästa stöten och lång räckvidd, svaga hugg.",
  "Med sköld. Slår av hjälmar och får fienden att vingla.",
  "Tvåhandsvapen. Långsam. Tunga slag fäller fienden. Krossar i stället för att hugga.",
  "Med knogjärn (parerar lika bra som en sköld, men tar inte emot kast). Blixtsnabb men kort. Tar tag på längre håll och hugger medan du brottas.",
];

document.addEventListener("wheel", (e) => {
  if (rebinding) return;
  const code = e.deltaY > 0 ? "WheelDown" : "WheelUp";
  if (binds.is("nextWeapon", code)) changeWeapon(1);
  else if (binds.is("prevWeapon", code)) changeWeapon(-1);
}, { passive: true });
document.querySelectorAll("[data-wswap]").forEach((b) => b.addEventListener("click", () => changeWeapon(Number(b.dataset.wswap))));

// ---------------------------------------------------------------------------
// Lobbyn
// ---------------------------------------------------------------------------

function enterLobby() {
  endCeremony();
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
  $("lobby-rules").textContent = `Rustning, hjälm och mantel är bara utseende. Vapnen är olika – tvåhandsvapen har ingen sköld. ${K("throw")} kastar vapnet, ${K("grab")} tar tag i någon.`;
  // Dag eller kväll, och träningsmotståndare (bara lobbyledaren väljer)
  document.querySelectorAll(".time-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.time === timeOfDay);
    b.disabled = !isHost;
  });
  document.querySelectorAll(".weather-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.weather === weatherKind);
    b.disabled = !isHost;
  });
  document.querySelectorAll(".map-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.map === mapKind);
    b.disabled = !isHost;
  });
  $("ready-button").textContent = me.ready ? "✅ Redo! (tryck för att ångra)" : "Jag är redo";
  $("ready-button").classList.toggle("active", !!me.ready);
  const botCount = allPlayers().filter((p) => p.bot).length;
  $("bot-row").hidden = !isHost && botCount === 0;
  $("bot-add").disabled = !isHost || botCount >= MAX_BOTS || allPlayers().length >= 6;
  $("bot-remove").disabled = !isHost || botCount === 0;
  $("bot-count").textContent = botCount === 0 ? "Inga" : String(botCount);
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
    label.textContent = (p.id === hostId ? "👑 " : "") + p.name + (p === me ? " (du)" : "") + (p.bot ? " 🤖" : "");
    const ready = document.createElement("span");
    ready.className = "ready-mark";
    ready.textContent = p.ready ? "✅ redo" : "⏳";
    li.append(dot, label, ready);
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
  // Tvåhandsvapen: ingen sköld
  const lspec = weaponSpec(me.look.w ?? 0);
  const twoHanded = lspec.twoHanded;
  $("look-s").textContent = twoHanded ? "— (tvåhandsvapen)" : lspec.noShield ? "Knogjärn (dolken)" : SHIELDS[me.look.s] ?? "";
  document.querySelectorAll('[data-look="s"]').forEach((b) => (b.disabled = !!twoHanded || !!lspec.noShield));
  $("look-w").textContent = WEAPONS[me.look.w ?? 0] ?? "";
  $("weapon-info").textContent = WEAPON_INFO[me.look.w ?? 0] ?? "";
  $("look-c").textContent = CAPES[me.look.c ?? 0] ?? "";

  const count = allPlayers().length;
  $("start-button").hidden = !isHost;
  $("start-button").disabled = count < MATCH.minPlayers;
  const readyCount = allPlayers().filter((p) => p.ready).length;
  const allReady = readyCount === count;
  $("start-button").classList.toggle("all-ready", allReady && count >= MATCH.minPlayers);
  if (isHost) {
    $("lobby-wait").textContent = count < MATCH.minPlayers
      ? "Skicka inbjudningslänken till dina vänner – minst två riddare behövs."
      : allReady ? "Alla är redo – starta matchen!" : `${readyCount} av ${count} är redo. Du kan starta ändå.`;
  } else {
    const host = playerById(hostId);
    $("lobby-wait").textContent = `${readyCount} av ${count} redo · väntar på att ${host ? host.name : "lobbyledaren"} startar matchen…`;
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

document.querySelectorAll(".time-btn").forEach((button) => {
  button.addEventListener("click", () => {
    if (!me || phase !== "lobby" || me.id !== hostId) return;
    net.send({ t: "time", v: button.dataset.time });
  });
});
document.querySelectorAll(".weather-btn").forEach((button) => {
  button.addEventListener("click", () => {
    if (!me || phase !== "lobby" || me.id !== hostId) return;
    net.send({ t: "weather", v: button.dataset.weather });
  });
});
document.querySelectorAll(".map-btn").forEach((button) => {
  button.addEventListener("click", () => {
    if (!me || phase !== "lobby" || me.id !== hostId) return;
    net.send({ t: "map", v: button.dataset.map });
  });
});
$("ready-button").addEventListener("click", () => {
  if (!me || phase !== "lobby") return;
  sound.unlock();
  net.send({ t: "ready", on: me.ready ? 0 : 1 });
});
$("bot-add").addEventListener("click", () => {
  if (me && phase === "lobby") net.send({ t: "bot", add: 1 });
});
$("bot-remove").addEventListener("click", () => {
  if (me && phase === "lobby") net.send({ t: "bot", add: 0 });
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
      label.textContent = (p.id === hostId ? "👑 " : "") + p.name + (p === me ? " (du)" : "") + (p.bot ? " 🤖" : "");
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
  const w = weaponOf(me);
  setCooldown("cd-q", me.nextQuick, attackSpec("q", w).cooldown);
  setCooldown("cd-t", me.nextThrust, attackSpec("t", w).cooldown);
  if (charging) {
    const progress = Math.min(1, (seconds() - mouseDownAt) / attackSpec("h", w).charge);
    const el = $("cd-h");
    el.querySelector(".cd-fill").style.width = progress * 100 + "%";
    el.classList.toggle("charged", progress >= 1);
    el.classList.remove("ready");
  } else {
    setCooldown("cd-h", me.nextHeavy, attackSpec("h", w).cooldown);
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

const keys = new Set(); // nedtryckta knappar (tangenter och Mouse0–4)
const binds = new Keybinds();

// ----- Rutan där man byter knappar -----
let rebinding = null; // { action, slot, at } medan man väntar på en ny knapp
function renderKeysPanel() {
  const tbody = $("keys-table").querySelector("tbody");
  tbody.innerHTML = "";
  for (const a of ACTIONS) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = a.name;
    tr.appendChild(name);
    for (const slot of [0, 1]) {
      const td = document.createElement("td");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "small";
      const code = binds.keys(a.id)[slot];
      const waiting = rebinding && rebinding.action === a.id && rebinding.slot === slot;
      b.textContent = waiting ? "Tryck en knapp…" : code ? keyName(code) : a.id === "roll" && slot === 0 ? "(Huka + Hoppa)" : "–";
      if (waiting) b.classList.add("waiting");
      if (!code && !waiting) b.classList.add("empty");
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        rebinding = { action: a.id, slot: Math.min(slot, binds.keys(a.id).length), at: performance.now() };
        renderKeysPanel();
      });
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (binds.keys(a.id)[slot]) binds.clear(a.id, slot);
        rebinding = null;
        renderKeysPanel();
      });
      td.appendChild(b);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}
function finishRebind(code) {
  if (!rebinding) return;
  if (performance.now() - rebinding.at < 150) return; // samma klick som startade
  if (code !== "Escape" && !FORBIDDEN.has(code)) binds.assign(rebinding.action, rebinding.slot, code);
  rebinding = null;
  renderKeysPanel();
}
window.addEventListener("keydown", (e) => {
  if (!rebinding) return;
  e.preventDefault();
  e.stopPropagation();
  finishRebind(e.code);
}, true);
window.addEventListener("mousedown", (e) => {
  if (!rebinding) return;
  if (e.button === 0 && e.target.closest && e.target.closest("#keys-table button") && performance.now() - rebinding.at < 150) return;
  e.preventDefault();
  e.stopPropagation();
  finishRebind("Mouse" + e.button);
}, true);
window.addEventListener("wheel", (e) => {
  if (!rebinding) return;
  finishRebind(e.deltaY > 0 ? "WheelDown" : "WheelUp");
}, { capture: true, passive: true });
document.querySelectorAll(".keys-open").forEach((b) => b.addEventListener("click", () => {
  if (document.pointerLockElement) document.exitPointerLock();
  rebinding = null;
  renderKeysPanel();
  $("keys-panel").hidden = false;
}));
$("keys-close").addEventListener("click", () => {
  rebinding = null;
  $("keys-panel").hidden = true;
});
$("keys-reset").addEventListener("click", () => {
  binds.reset();
  rebinding = null;
  renderKeysPanel();
});

// Hjälptexten längst ner och tipsen visar de knappar man själv valt
const K = (action) => binds.label(action);
function renderHelp() {
  const b = (t) => `<b>${t}</b>`;
  const move = ["forward", "left", "back", "right"].map((a) => binds.label(a)).join("");
  const moveTxt = move.length === 4 ? move : ["forward", "left", "back", "right"].map((a) => binds.label(a)).join(" ");
  $("help-text").innerHTML =
    `${b(K("attack"))} slag (håll = tungt) · ${b(K("parry"))} parera · ${b(binds.label("thrust", true))} stöt · ${b(K("kick"))} spark · ` +
    `${b(K("pickup"))} ta upp vapen · ${b(K("throw"))} kasta vapnet · ${b(K("grab"))} ta tag i någon · ${b([1, 2, 3].map((n) => K("emote" + n)).join(" "))} gester<br>` +
    `${b(moveTxt)} gå · ${b(K("run"))} spring · ${b(K("jump"))} hoppa · ${b(binds.label("crouch", true))} huka · ${b(K("roll"))} rulla · ` +
    `${b("Esc")} släpp musen · ${b(K("quality"))} grafik · ${b(K("sound"))} ljud · ${b(K("music"))} musik`;
  $("weapon-keys").textContent = `${binds.label("prevWeapon", true)} och ${binds.label("nextWeapon", true)}`;
}
binds.onChange(renderHelp);
renderHelp();

// En knapp trycktes ner (tangent eller musknapp). Gör det som knappen är inställd på.
function pressCode(code, e, repeat = false) {
  const acts = binds.actionsFor(code);
  if (!acts.length) return;
  if (!me) return;
  const has = (a) => acts.includes(a);
  if (has("jump") && phase === "intro") {
    e?.preventDefault?.();
    if (!repeat && intro && !intro.skipped) {
      intro.skipped = true;
      net.send({ t: "skip" });
    }
    return;
  }
  if (has("jump")) {
    e?.preventDefault?.();
    // Huka + Hoppa = rulla, annars hoppa
    if (!repeat) {
      if (me.heldBy) net.send({ t: "struggle" }); // fasthållen: sliter för att komma loss
      else if (crouchHeld() || isDown()) tryRoll();
      else tryJump();
    }
  }
  if (has("stats") && !repeat) {
    e?.preventDefault?.();
    showStats = !showStats;
  }
  if (has("quality") && !repeat) {
    e?.preventDefault?.();
    lowQuality = !lowQuality;
    applyQuality();
  }
  if (repeat) return;
  if (has("attack") && locked()) {
    mouseDown = true;
    mouseDownAt = seconds();
    attackCode = code;
  }
  if (has("parry") && locked()) tryParry();
  if (has("roll")) {
    if (me.heldBy) net.send({ t: "struggle" });
    else tryRoll();
  }
  if (has("thrust") && locked()) {
    e?.preventDefault?.();
    tryAttack("t");
  }
  if (has("kick") && locked()) tryKick();
  if (has("pickup")) tryPickup();
  if (has("throw") && locked()) tryThrow();
  if (has("grab") && locked()) tryGrab();
  if (has("prevWeapon")) changeWeapon(-1);
  if (has("nextWeapon")) changeWeapon(1);
  for (const n of [1, 2, 3]) if (has("emote" + n)) tryEmote(n);
  if (has("sound")) {
    sound.unlock();
    sound.setMuted(!sound.muted);
    applySound();
  }
  if (has("music")) {
    sound.unlock();
    sound.setMusic(!sound.musicOn);
    applySound();
  }
}

// En knapp släpptes: bara slaget bryr sig (håll inne = tungt slag)
function releaseCode(code) {
  if (code === attackCode) releaseAttack();
}

window.addEventListener("keydown", (e) => {
  if (rebinding) return;
  if (document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  if (keyboardLocked && (e.ctrlKey || e.code.startsWith("Control"))) e.preventDefault(); // inga genvägar (Ctrl+W m.fl.) mitt i striden
  if (binds.actionsFor(e.code).length && (e.code === "Space" || e.code === "Tab" || e.code.startsWith("Arrow"))) e.preventDefault();
  keys.add(e.code);
  pressCode(e.code, e, e.repeat);
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
  releaseCode(e.code);
});
window.addEventListener("blur", () => {
  keys.clear();
  if (charging) stopCharging(true);
});

const locked = () => document.pointerLockElement === canvas;
const playing = () => phase === "countdown" || phase === "round" || phase === "roundEnd" || phase === "bracket";

canvas.addEventListener("click", () => {
  if (me && playing() && !locked()) {
    canvas.requestPointerLock();
    enterFullscreen();
  }
});

// ---------------------------------------------------------------------------
// Helskärm och Ctrl: i vanligt läge stänger Ctrl+W fliken (det kan en webbsida inte stoppa).
// I helskärm låser vi tangenterna (Chrome och Edge), då hamnar Ctrl+W i spelet i stället.
// Ctrl hukar bara när låset är på; C fungerar alltid.
// ---------------------------------------------------------------------------

let keyboardLocked = false;
// Alla knappar som spelet använder låses i helskärm, plus Ctrl och Tab (så att Ctrl+W m.fl. inte stänger fliken)
const lockKeys = () => [...new Set(["ControlLeft", "ControlRight", "Tab", "KeyW", ...binds.keyboardCodes()])];

async function enterFullscreen() {
  if (!CONFIG.fullscreen || !document.documentElement.requestFullscreen) return;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    if (navigator.keyboard?.lock) {
      await navigator.keyboard.lock(lockKeys());
      keyboardLocked = true;
    }
  } catch {
    keyboardLocked = false; // webbläsaren sa nej: då gäller C
  }
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    keyboardLocked = false;
    try {
      navigator.keyboard?.unlock?.();
    } catch {
      // inget att låsa upp
    }
  }
});

let ctrlHintShown = false;
function crouchHeld() {
  const isCtrl = (k) => k.startsWith("Control");
  if (binds.held("crouch", keys, (k) => !isCtrl(k))) return true;
  if (!binds.held("crouch", keys, isCtrl)) return false;
  if (keyboardLocked) return true;
  if (!ctrlHintShown && phase === "round") {
    ctrlHintShown = true;
    const other = binds.keys("crouch").find((k) => !isCtrl(k));
    callout(`Ctrl hukar bara i helskärm (Chrome/Edge).${other ? ` Använd ${keyName(other)}!` : ""}`, 2200);
  }
  return false;
}

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
  return me && phase === "round" && !me.dead && seconds() >= me.staggerUntil && !isDown() && !rolling() && !me.heldBy;
}

document.addEventListener("mousedown", (e) => {
  if (rebinding || !locked() || !me) return;
  if (e.button === 1) e.preventDefault();
  const code = "Mouse" + e.button;
  keys.add(code);
  pressCode(code, e);
});

document.addEventListener("mouseup", (e) => {
  const code = "Mouse" + e.button;
  keys.delete(code);
  releaseCode(code);
});

let attackCode = null; // knappen som håller i slaget just nu
function releaseAttack() {
  if (!mouseDown) return;
  mouseDown = false;
  attackCode = null;
  if (!me) return;

  if (charging) {
    const held = seconds() - mouseDownAt;
    if (held >= attackSpec("h", weaponOf(me)).charge) {
      stopCharging(false);
      tryAttack("h");
    } else {
      stopCharging(true); // släppte för tidigt: blir ett snabbt slag i stället
      tryAttack("q");
    }
  } else {
    tryAttack("q");
  }
}

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
  // Håller man fast någon blir det ett knytnävsslag
  if (me.holding) {
    if (t < me.nextQuick) return;
    me.nextQuick = t + COMBAT.grab.punchCooldown;
    me.knight.playAttack("p");
    sound.swing(me.pos, false, "q", 0);
    sound.grunt(me.pos, voiceOf(me), false);
    net.send({ t: "atk", k: "q" });
    return;
  }
  if (kind === "h" ? t < me.nextHeavy : kind === "t" ? t < me.nextThrust : t < me.nextQuick) {
    if (kind === "t") callout("Stöten är inte redo än", 600);
    return;
  }

  const w = weaponOf(me);
  const spec = attackSpec(kind, w);
  const cds = cooldownsAfter(kind, w);
  me.nextQuick = t + cds.quick;
  me.nextHeavy = t + cds.heavy;
  me.nextThrust = Math.max(me.nextThrust, t + cds.thrust);
  me.attackUntil = t + spec.windup + 0.15;
  me.knight.playAttack(kind); // visa slaget direkt, servern avgör om det träffar
  sound.swing(me.pos, kind === "h" || weaponSpec(weaponOf(me)).twoHanded, kind, swingSound(me));
  sound.grunt(me.pos, voiceOf(me), kind === "h");
  checkQuintain(me, kind);
  if (kind === "t") me.knock.addScaledVector(forward.set(Math.sin(me.yaw), 0, Math.cos(me.yaw)), 4.5); // utfallssteg framåt
  sendStateNow(); // se till att servern har exakt var vi står och tittar
  const msg = { t: "atk", k: kind };
  if (aim) msg.aim = { id: aim.id, seg: aim.seg }; // kroppsdelen under siktet
  net.send(msg);
}

// Träningsdockan snurrar om slaget träffar den (bara på riktigt hos varje spelare, servern bryr sig inte)
function checkQuintain(player, kind) {
  const spec = attackSpec(kind, weaponOf(player));
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
  if (me?.holding && canAct()) {
    if (seconds() < me.nextKick) return;
    me.nextKick = seconds() + COMBAT.grab.downCooldown;
    net.send({ t: "kick" }); // kasta omkull den man håller fast
    return;
  }
  if (!canAct() || me.legless || seconds() < me.nextKick) return;
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
  if (!canAct() || me.holding || seconds() < me.nextParry) return;
  me.nextParry = seconds() + COMBAT.parry.cooldown;
  me.knight.playParry();
  sendStateNow();
  net.send({ t: "par" });
}

// G: kasta vapnet rakt fram
function tryThrow() {
  if (!canAct() || me.holding || weaponOf(me) === FISTS || me.knight.seg.handR.userData.detached) return;
  stopCharging(true);
  me.knight.playAttack("x");
  me.attackUntil = seconds() + 0.5;
  me.nextQuick = Math.max(me.nextQuick, seconds() + COMBAT.throw.windup + 0.2);
  sound.grunt(me.pos, voiceOf(me), true);
  sendStateNow();
  net.send({ t: "throw" });
}

// R: ta tag i någon framför (håller man redan fast någon: knuffa iväg den; är man fasthållen: slit)
let nextGrabTry = 0;
function tryGrab() {
  if (!me || me.dead || phase !== "round") return;
  if (me.heldBy) {
    net.send({ t: "struggle" });
    return;
  }
  if (me.holding) {
    net.send({ t: "grab" });
    return;
  }
  if (!canAct() || me.legless || seconds() < nextGrabTry) return;
  nextGrabTry = seconds() + (weaponSpec(weaponOf(me)).grabCd ?? COMBAT.grab.cooldown);
  stopCharging(true);
  me.knight.setGrab("reach");
  sendStateNow();
  net.send({ t: "grab" });
}

function tryJump() {
  if (!me || me.dead || !me.onGround || phase !== "round" || me.legless || isDown() || rolling()) return;
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
  raycaster.far = CONFIG.cameraDistance + COMBAT.heavy.reach + 1.2 + 2; // + längsta vapnet
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

  const t = seconds();
  const inRound = phase === "round" && !me.dead;
  const roll = inRound && rolling();
  const down = inRound && isDown();
  // Utan ben, omkull eller mitt i en rullning styr man inte själv vart man går
  const canMove = inRound && !me.legless && !down && !roll && !me.heldBy;
  // Huka: håll C (inte i luften, inte utan ben)
  me.crouch = canMove && me.onGround && crouchHeld();
  me.knight.setCrouch(me.crouch);
  move.set(0, 0, 0);
  if (canMove) {
    if (binds.held("forward", keys)) move.add(forward);
    if (binds.held("back", keys)) move.sub(forward);
    if (binds.held("right", keys)) move.add(right);
    if (binds.held("left", keys)) move.sub(right);
  }

  const moving = move.lengthSq() > 0;
  const running = moving && !charging && !me.crouch && binds.held("run", keys);
  wantedVel.set(0, 0, 0);
  if (moving) {
    let speed = running ? CONFIG.runSpeed : CONFIG.walkSpeed;
    speed *= COMBAT.legLossSpeed[Math.min(2, me.knight.legLoss)]; // avhuggna ben gör en långsam
    if (me.crouch) speed *= COMBAT.crouch.speed;
    if (me.holding) speed *= COMBAT.grab.moveFactor; // släpar runt på någon
    if (t < me.staggerUntil) speed *= CONFIG.staggerMoveFactor;
    else if (charging) speed *= CONFIG.chargeMoveFactor;
    else if (t < me.attackUntil) speed *= CONFIG.attackMoveFactor;
    wantedVel.copy(move).normalize().multiplyScalar(speed);
  }
  // Acceleration och inbromsning (sämre grepp i luften)
  const accel = me.onGround ? CONFIG.acceleration : CONFIG.airControl;
  if (roll) {
    // Rullningen: snabbt i början, saktar in mot slutet
    const f = (t - me.rollStart) / COMBAT.roll.time;
    const speed = (COMBAT.roll.distance / COMBAT.roll.time) * 1.6 * (1 - f);
    me.vel.copy(me.rollDir).multiplyScalar(speed);
  } else if (me.legless || down) {
    me.vel.multiplyScalar(Math.exp(-dt * 10));
  } else {
    me.vel.lerp(wantedVel, 1 - Math.exp(-dt * accel));
  }
  me.pos.addScaledVector(me.vel, dt);
  // Fasthållen: står precis framför den som håller fast en, vänd mot den
  if (inRound && me.heldBy) {
    const holder = others.get(me.heldBy);
    if (holder) {
      const hy = holder.knight.group.rotation.y;
      const hp = holder.knight.group.position;
      me.pos.set(hp.x + Math.sin(hy) * 0.8, 0, hp.z + Math.cos(hy) * 0.8);
      me.yaw = hy + Math.PI;
      me.vel.set(0, 0, 0);
    }
  }
  // Knuff (spark eller utfall) som avtar snabbt
  me.pos.addScaledVector(me.knock, dt);
  me.knock.multiplyScalar(Math.exp(-dt * 5));
  const groundSpeed = Math.hypot(me.vel.x, me.vel.z);
  me.anim = canMove ? (groundSpeed > 4.5 ? 2 : groundSpeed > 0.3 ? 1 : 0) : 0;
  if (me.legless) me.pos.y = 0;

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

  // Under strid tittar riddaren åt samma håll som kameran (så man slår dit man tittar).
  // Utan ben kan man fortfarande vrida sig; omkull eller i en rullning inte.
  if (phase === "countdown" || canMove || (inRound && me.legless)) me.yaw = camYaw;

  if (inRound && !me.legless) {
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

  if (ceremonyActive()) return; // prisceremonin styr riddaren
  me.knight.group.position.copy(me.pos);
  me.knight.group.rotation.y = me.yaw;
  if (!me.dead) {
    me.knight.animate(dt, motionOf(roll || down ? _still : me.vel, me.yaw, !me.onGround));
    me.knight.updateTrail(scene);
  }
}

const _still = new THREE.Vector3();
let lobbyEmoteTimer = 2;
const prevPos = new THREE.Vector3();
const measuredVel = new THREE.Vector3();

function updateOthers(dt) {
  const t = 1 - Math.exp(-dt * 12); // mjuk förflyttning mot senaste kända position
  for (const other of others.values()) {
    if (ceremonyActive()) break; // prisceremonin styr riddarna
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
    other.knight.farAway = camera.position.distanceToSquared(group.position) > 18 * 18;
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
  if (phase === "matchEnd" && ceremonyActive()) {
    // Kameran gungar fram och tillbaka framför prispallen (som vänder sig mot kungen, -Z)
    const t = seconds() - ceremony.at;
    const a = Math.PI + Math.sin(t * 0.22) * 0.75;
    const r = 7.2 - Math.min(1, t / 6) * 1.4;
    camera.position.set(Math.sin(a) * r, 2.3 + Math.sin(t * 0.3) * 0.3, Math.cos(a) * r);
    camera.lookAt(0, 1.3, 0);
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
    camTarget.y = me.pos.y * 0.6 + CONFIG.cameraHeight - me.knight.crouchAmt * 0.3 - (me.legless ? 0.6 : 0) - (isDown() ? 0.5 : 0);
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
let lastSent = { x: NaN, y: NaN, z: NaN, r: NaN, a: -1, c: 0 };

function sendStateNow() {
  const x = Math.round(me.pos.x * 100) / 100;
  const y = Math.round(me.pos.y * 100) / 100;
  const z = Math.round(me.pos.z * 100) / 100;
  const r = Math.round(me.yaw * 100) / 100;
  const c = me.crouch ? 1 : 0;
  net.send({ t: "s", p: [x, y, z], r, a: me.anim, c });
  lastSent = { x, y, z, r, a: me.anim, c };
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
  const changed = x !== lastSent.x || y !== lastSent.y || z !== lastSent.z || r !== lastSent.r || me.anim !== lastSent.a || (me.crouch ? 1 : 0) !== lastSent.c;

  if (changed || heartbeatTimer >= CONFIG.heartbeatSeconds) sendStateNow();
}

// Stumparna sprutar blod en stund efter att en kroppsdel huggits av
function updateBleeding(dt) {
  const knights = allPlayers().filter((p) => !p.dead).map((p) => p.knight);
  for (const knight of knights) {
    knight.forEachBleedingStump(dt, (pos, age, dir) => {
      // Pulserande strålar i hjärtats takt ("dunk-dunk"): hjärtat slår långsammare och
      // strålarna blir svagare när blodet tar slut, sedan bara droppar
      const strength = Math.max(0, 1 - age / 4);
      const beat = (a) => a * 2.1 - a * a * 0.12;
      const b1 = beat(age);
      const b0 = beat(Math.max(0, age - dt));
      if (strength > 0 && Math.floor(b1) !== Math.floor(b0)) {
        effects.spurt(pos, dir, strength);
        effects.spurt(pos, dir, strength * 0.8);
      } else if (strength > 0 && Math.floor(b1 - 0.22) !== Math.floor(b0 - 0.22)) {
        effects.spurt(pos, dir, strength * 0.45); // andra slaget i "dunk-dunk"
      } else if (Math.random() < dt * (2 + 6 * strength)) {
        effects.blood(pos, 1, dir, 0.25);
      }
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

// Färskt blod droppar från vapnet efter en träff
const _tip = new THREE.Vector3();
const _base = new THREE.Vector3();
const _dropVel = new THREE.Vector3();
function updateBladeDrips(dt) {
  const now = performance.now() / 1000;
  for (const p of allPlayers()) {
    const k = p.knight;
    if (!k || p.dead || !k.bladeHitAt || !k.weapon || k.wIndex === FISTS) continue;
    const age = now - k.bladeHitAt;
    if (age > 6 || Math.random() > dt * (3.5 - age * 0.5)) continue;
    k.trailEnds(_tip, _base);
    _tip.lerp(_base, Math.random() * 0.5);
    _dropVel.set((Math.random() - 0.5) * 0.3, -0.4, (Math.random() - 0.5) * 0.3);
    effects.spawnDrop(_tip, _dropVel, 0.008 + Math.random() * 0.006, true);
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

let showStats = false; // F3: visa ritanrop och hur lång tid varje bild tar
let frameCalls = 0;
let frameMs = 0;
renderer.info.autoReset = false;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);

  // FPS-mätare (uppdateras varje halv sekund)
  fpsFrames++;
  const now = performance.now();
  if (now - fpsStart >= 500) {
    $("fps").textContent = `FPS: ${Math.round((fpsFrames * 1000) / (now - fpsStart))}` +
      (showStats ? ` · ${frameCalls} ritanrop · ${(frameMs / fpsFrames).toFixed(1)} ms/bild` : "");
    fpsFrames = 0;
    frameMs = 0;
    fpsStart = now;
  }

  const replaying = replay && seconds() >= replay.startedAt;
  if (phase === "intro") updateIntro(dt);
  else if (!replaying) {
    if (me) {
      updateCharging();
      updateMe(dt);
      updateNetwork(dt);
      renderCooldowns();
    }
    updateOthers(dt);
  }
  updateCeremony(dt);
  updateItems(dt);
  weather.update(dt, camera.position);
  motes.update(dt);
  if (!replaying) {
    updateBleeding(dt);
    debris.update(dt);
    updateBladeDrips(dt);
  }
  effects.update(dt);
  updatePanting(dt);
  updateGaze();
  updateFightCenter(dt);
  arena.update(dt, smoothCenter);
  updateBreath(dt);
  if (!updateReplay() && phase !== "intro") updateCamera(dt);
  recordFrame(dt);
  updateAim();
  sound.setListener(camera.position.x, camera.position.y, camera.position.z);
  updateLightPool();
  renderer.info.reset();
  if (postfx) postfx.render();
  else renderer.render(scene, camera);
  if (showStats) {
    frameCalls = renderer.info.render.calls;
    frameMs += performance.now() - now;
  }
}

setPhase("start");
renderer.setAnimationLoop(frame);
