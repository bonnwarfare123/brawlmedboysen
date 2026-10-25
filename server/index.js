// SERVERN – körs hos Cloudflare.
//
// Två delar:
// 1. "Workern" tar emot anslutningar och skickar dem till rätt spelrum.
//    (Spelets vanliga filer, som index.html, skickas automatiskt av Cloudflare
//    från mappen "public" utan att passera här.)
// 2. "GameRoom" är ett Durable Object: en liten server per spelrum. Den håller
//    koll på spelarna, lobbyn och rundorna, skickar vidare allas positioner och
//    AVGÖR ALLA TRÄFFAR, så att alla ser samma sak och ingen kan fuska.
//
// Ett rum går igenom faserna:
//   lobby → countdown (3, 2, 1) → round (strid) → roundEnd → countdown → ... → matchEnd → lobby
// I turneringen visas trädet ("bracket") mellan duellerna:
//   lobby → bracket → countdown → round → roundEnd → ... → bracket → ... → matchEnd → lobby
//
// Spelsätt: "ffa" = alla mot alla, "team" = Röda mot Blå, "tourney" = 1 mot 1 med utslag

import { DurableObject } from "cloudflare:workers";
import {
  MAX_PLAYERS, COLORS, NAME_MAX, ROOM_CODE_RE, COMBAT, MATCH, ARENA_RX, ARENA_RZ,
  JOINT_PARENT, LIMB_JOINTS, KILL_ONLY_JOINTS, AIM_JOINT, ARMORS, HELMETS, SHIELDS,
  WEAPONS, CAPES, MODES, attackSpec, cooldownsAfter, weaponSpec, FISTS, TIMES, MAX_BOTS, BOT_NAMES, WEATHERS, AWARDS,
  MAPS, INTRO_SECONDS,
} from "../public/js/shared.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/ws\/([A-Za-z0-9]+)$/);

    if (match) {
      const code = match[1].toUpperCase();
      if (!ROOM_CODE_RE.test(code)) {
        return new Response("Ogiltig rumskod", { status: 400 });
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Förväntade en WebSocket-anslutning", { status: 426 });
      }
      // Samma rumskod ger alltid samma Durable Object
      const id = env.ROOMS.idFromName(code);
      return env.ROOMS.get(id).fetch(request);
    }

    return new Response("Hittades inte", { status: 404 });
  },
};

// ---------------------------------------------------------------------------

const TOLERANCE = 0.1;   // sekunder: tillåt lite ojämn nätverkstajming
const BODY_RADIUS = 0.4; // meter: en riddares "tjocklek" vid träffkontroll

function now() {
  return Date.now() / 1000;
}

function randomId() {
  return Math.random().toString(36).slice(2, 8);
}

// Den hemliga nyckeln (= återställningskoden) är 12 tecken, t.ex. RIDD-7K4P-QX2M-9TAB
const KEY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function cleanKey(value) {
  const k = String(value ?? "").toUpperCase().replace(/^RIDD/, "").replace(/[^A-Z0-9]/g, "");
  return k.length === 12 && [...k].every((c) => KEY_CHARS.includes(c)) ? k : null;
}
async function hashKey(key) {
  const data = new TextEncoder().encode("brawlmedboysen:" + key);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const DEFAULT_NAME = "Namnlös riddare";

function cleanName(value) {
  const name = String(value ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, NAME_MAX);
  return name || DEFAULT_NAME;
}

// Utseende: { a: rustning, h: hjälm, s: sköld, w: vapen, c: mantel } som index i listorna
function cleanLook(look) {
  const pick = (v, list) => (Number.isInteger(v) && v >= 0 && v < list.length ? v : 0);
  return {
    a: pick(look?.a, ARMORS), h: pick(look?.h, HELMETS), s: pick(look?.s, SHIELDS),
    w: pick(look?.w, WEAPONS), c: pick(look?.c, CAPES),
  };
}

function shuffle(list, random = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Bygg ett utslagsträd. Går antalet inte jämnt ut får några "fripass" (b = null) i första omgången.
// rounds[0] = första omgången, sista = finalen. Varje match: { a, b, w, s: [vinster a, vinster b] }
// a/b = undefined betyder "inte avgjort än" (vinnaren från förra omgången kommer dit).
function buildBracket(ids, random = Math.random) {
  let size = 2;
  while (size < ids.length) size *= 2;
  const order = shuffle(ids, random);
  const byes = size - ids.length;
  const first = [];
  for (let i = 0; i < byes; i++) first.push({ a: order[i], b: null });
  for (let i = byes; i < order.length; i += 2) first.push({ a: order[i], b: order[i + 1] });
  const rounds = [shuffle(first, random).map((m) => ({ ...m, w: undefined, s: [0, 0] }))];
  for (let n = size / 4; n >= 1; n /= 2) {
    rounds.push(Array.from({ length: n }, () => ({ a: undefined, b: undefined, w: undefined, s: [0, 0] })));
  }
  return rounds;
}

function finite(n, fallback = 0) {
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Startplatser i en ring runt mitten, alla tittar inåt
function spawnPoint(index, count, offset = 0) {
  const angle = offset + (index / Math.max(count, 2)) * Math.PI * 2;
  const p = [round2(Math.sin(angle) * 6), 0, round2(Math.cos(angle) * 6)];
  const r = round2(angle + Math.PI);
  return { p, r };
}

// Lagen startar på var sin sida, på en rad, vända mot varandra
function teamSpawn(team, index, count) {
  const x = round2((index - (count - 1) / 2) * 2.2);
  const z = team === 0 ? -6 : 6;
  return { p: [x, 0, z], r: team === 0 ? 0 : round2(Math.PI) };
}

function newPlayerState(info) {
  return {
    ...info,
    look: cleanLook(info.look),
    p: [0, 0, 0],
    r: 0,
    a: 0,
    hp: COMBAT.maxHp,
    dead: false,
    kills: 0,
    wins: 0,
    nextQuick: 0,
    nextHeavy: 0,
    nextThrust: 0,
    nextParry: 0,
    nextKick: 0,
    nextEmote: 0,
    lastParry: -100,
    staggerUntil: 0,
    chargeStart: null,
    severed: [],     // avhuggna leder den här rundan
    limbDamage: {},  // samlad skada per kroppsdel den här rundan
    helmetOff: false,
    team: info.team === 0 || info.team === 1 ? info.team : null,
    cw: cleanLook(info.look).w, // vapnet man håller i just nu (FISTS = inget)
    downUntil: 0,    // ligger på marken (omsparkad) till den här tiden
    rollStart: -100, // när senaste rullningen började
    nextRoll: 0,
    crouch: false,
    legless: false,  // båda benen avhuggna: sitter på marken
    lastAttacker: null,
    bot: !!info.bot,
    ready: !!info.bot, // redo-knappen i lobbyn (träningsmotståndare är alltid redo)
    holding: null,   // id på den man håller fast
    heldBy: null,    // id på den som håller fast en
    nextGrab: 0,
    struggle: 0,
    stats: freshStats(),
  };
}

// Det som räknas under en match (för utmärkelserna efteråt)
function freshStats() {
  return { sev: 0, dmg: 0, parry: 0, fell: 0, throwHit: 0, grabs: 0 };
}

function resetForRound(player) {
  player.hp = COMBAT.maxHp;
  player.dead = false;
  player.severed = [];
  player.limbDamage = {};
  player.nextQuick = 0;
  player.nextHeavy = 0;
  player.nextThrust = 0;
  player.nextParry = 0;
  player.nextKick = 0;
  player.lastParry = -100;
  player.staggerUntil = 0;
  player.chargeStart = null;
  player.a = 0;
  player.helmetOff = false;
  player.cw = player.look.w;
  player.downUntil = 0;
  player.rollStart = -100;
  player.nextRoll = 0;
  player.crouch = false;
  player.legless = false;
  player.lastAttacker = null;
  player.holding = null;
  player.heldBy = null;
  player.nextGrab = 0;
  player.struggle = 0;
}

const LEFT_LEG = ["ankleL", "kneeL", "hipL"];
const RIGHT_LEG = ["ankleR", "kneeR", "hipR"];
const WEAPON_ARM = ["wristR", "elbowR", "shoulderR"];

// Har spelaren förlorat något av båda benen?
function isLegless(player) {
  return LEFT_LEG.some((j) => player.severed.includes(j)) && RIGHT_LEG.some((j) => player.severed.includes(j));
}

// Går det inte att träffa spelaren just nu (mitt i en rullning)?
function invulnerable(player, t) {
  const r = t - player.rollStart;
  return r >= COMBAT.roll.iStart && r <= COMBAT.roll.iEnd;
}

// Finns leden kvar? (varken den eller någon led innanför är avhuggen)
function jointAvailable(player, joint) {
  for (let j = joint; j; j = JOINT_PARENT[j]) {
    if (player.severed.includes(j)) return false;
  }
  return true;
}

// Avgör om och i så fall vilken led som huggs av vid en träff.
// aimSegment = kroppsdelen den som slog siktade på (eller null).
// damage = slagets skada, sever = vapnets förmåga att hugga av (yxor och stora svärd lättare)
// legsOnly = den som slog var hukad (slår mot benen)
function chooseSever(player, kind, dead, aimSegment = null, random = Math.random, damage = specOf(kind).damage, sever = 1, legsOnly = false) {
  if (sever <= 0) return null; // trubbiga vapen (hammare, knytnävar) krossar men hugger inte av

  // Siktade på en viss kroppsdel som finns kvar
  const aimed = aimSegment && AIM_JOINT[aimSegment];
  const torsoAim = aimed === "waist";
  if (aimed && jointAvailable(player, aimed) && !(torsoAim && !dead) && !(torsoAim && random() >= 0.5)) {
    if (KILL_ONLY_JOINTS.includes(aimed)) return dead ? aimed : null; // huvud bara vid dråp
    if (dead) return aimed;
    const type = aimSegment.replace(/[LR]$/, "");
    player.limbDamage[aimSegment] = (player.limbDamage[aimSegment] || 0) + damage * sever;
    return player.limbDamage[aimSegment] >= COMBAT.limbHp[type] ? aimed : null;
  }

  // Annars (bålen, bredvid eller redan avhuggen) liten slumpchans som förut
  const key = (kind === "h" ? "heavy" : "quick") + (dead ? "Kill" : ""); // stöt räknas som snabbt
  if (random() >= Math.min(1, COMBAT.randomSever[key] * sever)) return null;
  const candidates = LIMB_JOINTS.filter((j) => jointAvailable(player, j) && (!legsOnly || LEG_JOINTS_ALL.includes(j)));
  if (dead && !legsOnly) {
    for (const j of KILL_ONLY_JOINTS) {
      if (jointAvailable(player, j)) candidates.push(j, j);
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(random() * candidates.length)];
}

const LEG_JOINTS_ALL = ["ankleL", "kneeL", "hipL", "ankleR", "kneeR", "hipR"];

function specOf(kind) {
  return kind === "h" ? COMBAT.heavy : kind === "t" ? COMBAT.thrust : COMBAT.quick;
}

// Det som skickas till spelarna om en riddare (inte interna timers)
function publicPlayer(pl) {
  return {
    id: pl.id, name: pl.name, color: pl.color, look: pl.look, p: pl.p, r: pl.r, a: pl.a,
    hp: pl.hp, dead: pl.dead, kills: pl.kills, wins: pl.wins, severed: pl.severed,
    helmetOff: pl.helmetOff, team: pl.team, cw: pl.cw, bot: pl.bot ? 1 : 0, c: pl.crouch ? 1 : 0, ready: pl.ready ? 1 : 0,
  };
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map();
    this.phase = "lobby";
    this.hostId = null;
    this.round = 0;
    this.phaseToken = 0; // ökar vid varje fasbyte, så gamla timers inte gör något
    this.mode = "ffa";
    this.teamWins = [0, 0];
    this.bracket = null; // turneringsträdet
    this.duel = null;    // pågående duell: { ri, mi }
    this.time = "day";   // dag eller kväll
    this.weather = "sun"; // sol, regn eller dimma
    this.map = "arena";   // bana: tornerplatsen eller borggården
    this.items = new Map(); // tappade vapen på marken: id → { id, w, p }

    // Om rummet "sov" (hibernation) och vaknar igen: återskapa spelarlistan
    // från informationen som sparats på varje anslutning.
    for (const ws of this.ctx.getWebSockets()) {
      const info = ws.deserializeAttachment();
      if (info && info.id) {
        this.players.set(info.id, newPlayerState(info));
        if (!this.hostId) this.hostId = info.id;
      }
    }
    // Lobbyledaren och spelsättet sparas i rummets minne, så att de överlever när rummet somnar
    // (annars glömde servern vem som var ledare och startknappen slutade fungera efter en match).
    if (this.ctx.storage && this.ctx.blockConcurrencyWhile) {
      this.ctx.blockConcurrencyWhile(async () => {
        const saved = await this.ctx.storage.get(["host", "mode", "time", "bots", "weather", "map"]);
        if (MAPS.includes(saved.get("map"))) this.map = saved.get("map");
        if (WEATHERS.includes(saved.get("weather"))) this.weather = saved.get("weather");
        const host = saved.get("host");
        const mode = saved.get("mode");
        if (host && this.players.has(host)) this.hostId = host;
        if (MODES.includes(mode)) this.mode = mode;
        if (TIMES.includes(saved.get("time"))) this.time = saved.get("time");
        // Träningsmotståndarna har ingen anslutning: de sparas för sig
        const bots = saved.get("bots");
        if (Array.isArray(bots) && this.humans().length > 0) {
          for (const info of bots) if (!this.players.has(info.id)) this.players.set(info.id, newPlayerState({ ...info, bot: true }));
        }
      });
    }
  }

  // Spara något i rummets minne (finns inte i testerna, då händer inget)
  remember(key, value) {
    try {
      this.ctx.storage?.put(key, value);
    } catch {
      // ignorera
    }
  }

  setHost(id) {
    this.hostId = id;
    this.remember("host", id);
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // acceptWebSocket (i stället för accept) gör att rummet kan sova gratis
    // när inget händer.
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, data) {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // Anslutningen är redan stängd – ignorera
    }
  }

  broadcast(data, exceptWs = null) {
    const text = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exceptWs) continue;
      if (!ws.deserializeAttachment()) continue; // har inte gått med ännu
      try {
        ws.send(text);
      } catch {
        // ignorera
      }
    }
  }

  winsTable() {
    return Object.fromEntries([...this.players.values()].map((p) => [p.id, p.wins]));
  }

  killsTable() {
    return Object.fromEntries([...this.players.values()].map((p) => [p.id, p.kills]));
  }

  teamsTable() {
    return Object.fromEntries([...this.players.values()].map((p) => [p.id, p.team]));
  }

  // Spara spelarens uppgifter på anslutningen (överlever om rummet somnar)
  saveInfo(player) {
    for (const ws of this.ctx.getWebSockets()) {
      const info = ws.deserializeAttachment();
      if (info && info.id === player.id) {
        ws.serializeAttachment({ id: player.id, name: player.name, color: player.color, look: player.look, team: player.team, pid: info.pid ?? null });
      }
    }
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > 1000) return;

    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    const info = ws.deserializeAttachment();

    if (msg.t === "join") {
      this.handleJoin(ws, info, msg);
      return;
    }

    if (!info) return;
    const player = this.players.get(info.id);
    if (!player) return;

    switch (msg.t) {
      case "start":
        this.handleStart(player);
        break;
      case "color":
        this.handleColor(ws, player, msg.color);
        break;
      case "s":
        this.handleState(ws, player, msg);
        break;
      case "ch":
        this.handleCharge(ws, player, msg);
        break;
      case "atk":
        this.handleAttack(ws, player, msg.k === "h" ? "h" : msg.k === "t" ? "t" : "q", msg.aim);
        break;
      case "kick":
        this.handleKick(ws, player);
        break;
      case "emote":
        this.handleEmote(ws, player, msg.e);
        break;
      case "look":
        this.handleLook(ws, player, msg.look);
        break;
      case "mode":
        this.handleMode(player, msg.m);
        break;
      case "team":
        this.handleTeam(player, msg.team);
        break;
      case "shuffle":
        this.handleShuffle(player);
        break;
      case "par":
        this.handleParry(ws, player);
        break;
      case "roll":
        this.handleRoll(ws, player, msg.dir);
        break;
      case "pick":
        this.handlePickup(ws, player, msg.item);
        break;
      case "time":
        this.handleTime(player, msg.v);
        break;
      case "bot":
        this.handleBot(player, msg.add === 1);
        break;
      case "weather":
        this.handleWeather(player, msg.v);
        break;
      case "map":
        this.handleMap(player, msg.v);
        break;
      case "skip":
        this.handleSkipIntro(player);
        break;
      case "ready":
        this.handleReady(player, msg.on === 1);
        break;
      case "throw":
        this.handleThrow(ws, player);
        break;
      case "grab":
        this.handleGrab(ws, player);
        break;
      case "struggle":
        this.handleStruggle(player);
        break;
    }
  }

  // ===================== Lobby =====================

  // Topplistan (en gemensam för alla rum). Finns inte i testerna.
  board() {
    try {
      const B = this.env?.BOARD;
      return B ? B.get(B.idFromName("global")) : null;
    } catch {
      return null;
    }
  }

  async handleJoin(ws, info, msg) {
    if (info) return; // redan med
    this.joining ||= new Set();
    if (this.joining.has(ws)) return;
    // Topplistan: namnet "ägs" av den hemliga nyckeln i spelarens webbläsare
    let pid = null;
    const key = cleanKey(msg.key);
    const wantedName = cleanName(msg.name);
    const board = this.board();
    if (board && key && wantedName !== DEFAULT_NAME) {
      this.joining.add(ws);
      try {
        const res = await board.claim(await hashKey(key), wantedName);
        if (res && res.ok === false) {
          this.send(ws, { t: "nameTaken", name: wantedName });
          ws.close(4002, "Namnet är upptaget");
          return;
        }
        pid = res?.pid ?? null;
      } catch {
        // topplistan svarar inte: spela ändå, men utan att räknas
      } finally {
        this.joining.delete(ws);
      }
      if (ws.deserializeAttachment()) return;
      if (ws.readyState !== undefined && ws.readyState !== 1) return; // gick innan vi fick svar
    }

    // Fullt? Då får en träningsmotståndare gå (bara i lobbyn)
    if (this.players.size >= MAX_PLAYERS && this.phase === "lobby") {
      const bot = this.bots()[0];
      if (bot) this.removeBot(bot.id);
    }
    if (this.players.size >= MAX_PLAYERS) {
      this.send(ws, { t: "full" });
      ws.close(4001, "Rummet är fullt");
      return;
    }

    // Unika färger: är den önskade färgen tagen får man första lediga
    const taken = new Set([...this.players.values()].map((p) => p.color));
    let color = Number.isInteger(msg.color) && msg.color >= 0 && msg.color < COLORS.length ? msg.color : 0;
    if (taken.has(color)) color = COLORS.findIndex((_, i) => !taken.has(i));

    const playerInfo = { id: randomId(), name: wantedName, color, look: cleanLook(msg.look), team: null, pid };
    const player = newPlayerState(playerInfo);
    if (this.mode === "team") player.team = this.smallerTeam();
    playerInfo.team = player.team;
    ws.serializeAttachment(playerInfo);

    // Kommer man in mitt i en match får man titta på tills nästa runda
    player.dead = this.phase !== "lobby";
    this.players.set(player.id, player);
    if (!this.hostId || !this.players.has(this.hostId) || this.players.get(this.hostId).bot) this.setHost(player.id);

    this.send(ws, {
      t: "welcome",
      id: player.id,
      you: publicPlayer(player),
      players: [...this.players.values()].filter((pl) => pl.id !== player.id).map(publicPlayer),
      phase: this.phase,
      host: this.hostId,
      round: this.round,
      mode: this.mode,
      teamWins: this.teamWins,
      bracket: this.bracket,
      time: this.time,
      weather: this.weather,
      map: this.map,
      items: [...this.items.values()],
    });
    this.broadcast({ t: "join", player: publicPlayer(player) }, ws);
    this.sendBoard([ws]);
  }

  // Skicka topplistan (topp 10) och varje spelares eget kort
  async sendBoard(sockets = this.ctx.getWebSockets()) {
    const board = this.board();
    if (!board) return;
    const targets = sockets.map((ws) => ({ ws, info: ws.deserializeAttachment() })).filter((x) => x.info);
    if (!targets.length) return;
    try {
      const res = await board.top(targets.map((x) => x.info.pid).filter(Boolean));
      for (const { ws, info } of targets) {
        this.send(ws, { t: "board", top: res.top, total: res.total, me: (info.pid && res.mine[info.pid]) || null, ranked: !!info.pid });
      }
    } catch {
      // ignorera
    }
  }

  // Efter en match: skicka in resultatet till topplistan (bara om minst två riktiga spelare var med)
  async recordMatch(winner, team) {
    const humans = this.humans();
    if (humans.length < 2) return false;
    const board = this.board();
    const awardCount = {};
    for (const a of this.awards()) (awardCount[a.id] ||= []).push(a.key);
    const results = humans.filter((p) => p.pid).map((p) => ({
      pid: p.pid,
      win: this.mode === "team" ? team !== null && p.team === team : p.id === winner,
      kills: p.kills || 0,
      sev: p.stats?.sev || 0,
      awards: awardCount[p.id] || [],
      weapon: p.look?.w ?? 0,
    }));
    if (board && results.length) {
      try {
        await board.record(results);
      } catch {
        // ignorera
      }
    }
    return true;
  }

  handleColor(ws, player, color) {
    if (this.phase !== "lobby") return;
    if (!Number.isInteger(color) || color < 0 || color >= COLORS.length) return;
    if ([...this.players.values()].some((p) => p !== player && p.color === color)) return; // upptagen
    player.color = color;
    this.saveInfo(player);
    this.broadcast({ t: "color", id: player.id, color });
  }

  // Byt utseende i lobbyn. Mellan rundorna (nedräkning, paus, turneringsträdet) går det att byta vapen.
  handleLook(ws, player, look) {
    if (this.phase === "lobby") {
      player.look = cleanLook(look);
    } else if (["countdown", "roundEnd", "bracket"].includes(this.phase)) {
      const w = cleanLook(look).w;
      if (w === player.look.w) return;
      player.look = { ...player.look, w };
      if (this.phase === "countdown" && !player.dead) player.cw = w; // gäller direkt i rundan som börjar
    } else {
      return;
    }
    this.saveInfo(player);
    this.broadcast({ t: "look", id: player.id, look: player.look });
  }

  // Dag eller kväll (lobbyledaren väljer)
  handleTime(player, value) {
    if (player.id !== this.hostId || this.phase !== "lobby" || !TIMES.includes(value)) return;
    this.time = value;
    this.remember("time", value);
    this.broadcast({ t: "time", v: value });
  }

  // Sol, regn eller dimma (lobbyledaren väljer)
  handleWeather(player, value) {
    if (player.id !== this.hostId || this.phase !== "lobby" || !WEATHERS.includes(value)) return;
    this.weather = value;
    this.remember("weather", value);
    this.broadcast({ t: "weather", v: value });
  }

  handleMap(player, value) {
    if (player.id !== this.hostId || this.phase !== "lobby" || !MAPS.includes(value)) return;
    this.map = value;
    this.remember("map", value);
    this.broadcast({ t: "map", v: value });
  }

  // ----- Intro (Borggården): riddarna marscherar ut genom porten innan första rundan -----
  startIntro(then) {
    const token = this.setPhase("intro");
    this.introSkips = new Set();
    this.introThen = then;
    const list = [...this.players.values()];
    // Startplatserna bestäms redan nu, så att riddarna går dit de sedan börjar rundan
    if (this.mode !== "tourney") {
      this.placeFighters(list, null);
      this.presetPlaced = new Set(list.map((p) => p.id));
    }
    this.broadcast({
      t: "intro", seconds: INTRO_SECONDS,
      order: list.map((p) => p.id),
      spots: Object.fromEntries(list.map((p) => [p.id, { p: p.p, r: p.r }])),
    });
    this.later(INTRO_SECONDS, token, () => this.finishIntro());
  }

  finishIntro() {
    if (this.phase !== "intro") return;
    const then = this.introThen;
    this.introThen = null;
    if (this.players.size < MATCH.minPlayers) return this.toLobby();
    then?.();
  }

  // Alla riktiga spelare trycker Mellanslag: hoppa över introt
  handleSkipIntro(player) {
    if (this.phase !== "intro" || player.bot) return;
    this.introSkips.add(player.id);
    const humans = this.humans();
    this.broadcast({ t: "skipVote", n: this.introSkips.size, of: humans.length });
    if (humans.every((p) => this.introSkips.has(p.id))) this.finishIntro();
  }

  // Redo-knappen i lobbyn: alla ser vilka som är redo
  handleReady(player, on) {
    if (this.phase !== "lobby" || player.bot) return;
    player.ready = on;
    this.broadcast({ t: "ready", id: player.id, on: on ? 1 : 0 });
  }

  // ----- Träningsmotståndare (styrs av servern) -----

  humans() {
    return [...this.players.values()].filter((p) => !p.bot);
  }

  bots() {
    return [...this.players.values()].filter((p) => p.bot);
  }

  saveBots() {
    this.remember("bots", this.bots().map((b) => ({ id: b.id, name: b.name, color: b.color, look: b.look, team: b.team })));
  }

  handleBot(player, add) {
    if (player.id !== this.hostId || this.phase !== "lobby") return;
    if (add) {
      if (this.bots().length >= MAX_BOTS || this.players.size >= MAX_PLAYERS) return;
      const taken = new Set([...this.players.values()].map((p) => p.color));
      const usedNames = new Set(this.bots().map((b) => b.name));
      const name = BOT_NAMES.find((n) => !usedNames.has(n)) || "Sir Bot";
      const r = (n) => Math.floor(Math.random() * n);
      const info = {
        id: "bot" + randomId().slice(0, 3), name, bot: true,
        color: Math.max(0, COLORS.findIndex((_, i) => !taken.has(i))),
        look: { a: r(ARMORS.length), h: r(HELMETS.length), s: r(SHIELDS.length), w: r(WEAPONS.length), c: r(CAPES.length) },
        team: null,
      };
      const bot = newPlayerState(info);
      if (this.mode === "team") bot.team = this.smallerTeam();
      this.players.set(bot.id, bot);
      this.broadcast({ t: "join", player: publicPlayer(bot) });
    } else {
      const bot = this.bots().at(-1);
      if (bot) this.removeBot(bot.id);
    }
    this.saveBots();
  }

  removeBot(id) {
    this.players.delete(id);
    this.broadcast({ t: "leave", id });
    this.saveBots();
  }

  // ----- Spelsätt och lag -----

  smallerTeam(except = null) {
    const count = [0, 0];
    for (const p of this.players.values()) if (p !== except && p.team !== null) count[p.team] += 1;
    return count[0] <= count[1] ? 0 : 1;
  }

  // Ge alla utan lag ett lag, så att lagen blir så jämna som möjligt
  fillTeams() {
    for (const p of this.players.values()) {
      if (p.team === null) {
        p.team = this.smallerTeam(p);
        this.saveInfo(p);
      }
    }
  }

  broadcastTeams() {
    this.broadcast({ t: "teams", teams: this.teamsTable() });
  }

  handleMode(player, mode) {
    if (player.id !== this.hostId || this.phase !== "lobby" || !MODES.includes(mode)) return;
    this.mode = mode;
    this.remember("mode", mode);
    if (mode === "team") this.fillTeams();
    this.broadcast({ t: "mode", m: mode, teams: this.teamsTable() });
  }

  handleTeam(player, team) {
    if (this.phase !== "lobby" || this.mode !== "team" || (team !== 0 && team !== 1)) return;
    player.team = team;
    this.saveInfo(player);
    this.broadcastTeams();
  }

  // Lobbyledaren slumpar jämna lag
  handleShuffle(player) {
    if (player.id !== this.hostId || this.phase !== "lobby" || this.mode !== "team") return;
    shuffle([...this.players.values()]).forEach((p, i) => {
      p.team = i % 2;
      this.saveInfo(p);
    });
    this.broadcastTeams();
  }

  // Båda lagen måste ha minst en riddare: annars flyttas någon över
  balanceTeams() {
    this.fillTeams();
    const list = [...this.players.values()];
    for (const team of [0, 1]) {
      if (!list.some((p) => p.team === team)) {
        const other = list.filter((p) => p.team !== team);
        const mover = other[Math.floor(Math.random() * other.length)];
        mover.team = team;
        this.saveInfo(mover);
      }
    }
    this.broadcastTeams();
  }

  // Hån-gester: buga, peka och skratta, dansa
  handleEmote(ws, player, e) {
    if (![1, 2, 3].includes(e) || player.dead) return;
    if (this.phase === "countdown" || this.phase === "matchEnd") return;
    const t = now();
    if (t < player.nextEmote) return;
    player.nextEmote = t + COMBAT.emoteCooldown;
    this.broadcast({ t: "emote", id: player.id, e }, ws);
  }

  // Lobbyledaren startar matchen
  handleStart(player) {
    if (player.id !== this.hostId || this.phase !== "lobby") return;
    if (this.players.size < MATCH.minPlayers) return;
    for (const p of this.players.values()) {
      p.wins = 0;
      p.kills = 0;
      p.stats = freshStats();
    }
    this.round = 0;
    this.teamWins = [0, 0];
    this.bracket = null;
    this.duel = null;
    if (this.mode === "team") this.balanceTeams();
    if (this.mode === "tourney") {
      this.bracket = buildBracket([...this.players.keys()]);
      this.bracketNames = Object.fromEntries([...this.players.values()].map((p) => [p.id, { name: p.name, color: p.color }]));
      if (this.map === "castle") return this.startIntro(() => this.showBracket());
      this.showBracket();
      return;
    }
    if (this.map === "castle") return this.startIntro(() => this.startCountdown());
    this.startCountdown();
  }

  // ===================== Rundor =====================

  setPhase(phase) {
    this.phase = phase;
    this.phaseToken += 1;
    return this.phaseToken;
  }

  // Kör fn efter en stund, men bara om ingen annan fas har hunnit börja
  later(seconds, token, fn) {
    setTimeout(() => {
      if (token === this.phaseToken) fn();
    }, seconds * 1000);
  }

  // fighters = de som ska slåss (i turneringen bara två, de andra tittar på)
  startCountdown(fighters = null) {
    this.round += 1;
    const token = this.setPhase("countdown");
    const all = [...this.players.values()];
    const list = fighters ? all.filter((p) => fighters.includes(p.id)) : all;
    const spectators = all.filter((p) => !list.includes(p));
    if (this.presetPlaced && !fighters && list.every((p) => this.presetPlaced.has(p.id))) {
      this.presetPlaced = null; // introt har redan bestämt startplatserna
    } else {
      this.presetPlaced = null;
      this.placeFighters(list, fighters);
    }
    list.forEach((p) => resetForRound(p));
    this.items.clear();
    spectators.forEach((p) => {
      resetForRound(p);
      p.dead = true; // tittar på
    });
    this.broadcast({
      t: "countdown",
      round: this.round,
      seconds: MATCH.countdown,
      players: list.map((p) => ({ id: p.id, p: p.p, r: p.r })),
      spec: spectators.map((p) => p.id),
      duel: this.duelInfo(),
    });
    this.later(MATCH.countdown, token, () => {
      const roundToken = this.setPhase("round");
      this.broadcast({ t: "round", round: this.round });
      if (this.bots().length) this.botTick(roundToken);
    });
  }

  // Startplatser: slumpade varje runda (så man inte alltid står bredvid samma person)
  placeFighters(list, fighters) {
    if (this.mode === "team") {
      const flip = Math.random() < 0.5; // vilken sida lagen börjar på
      for (const team of [0, 1]) {
        const members = shuffle(list.filter((p) => p.team === team));
        members.forEach((p, i) => Object.assign(p, teamSpawn(flip ? 1 - team : team, i, members.length)));
      }
    } else if (fighters) {
      const order = Math.random() < 0.5 ? list : [...list].reverse();
      order.forEach((p, i) => Object.assign(p, { p: [0, 0, i === 0 ? -5 : 5], r: i === 0 ? 0 : round2(Math.PI) }));
    } else {
      const order = this.spawnOrder(list);
      const offset = Math.random() * Math.PI * 2; // ringen vrids också
      order.forEach((p, i) => Object.assign(p, spawnPoint(i, order.length, offset)));
    }
  }

  // Blanda ordningen i ringen så att så få som möjligt får samma granne som förra rundan
  spawnOrder(list) {
    const pairs = (order) => {
      const set = new Set();
      if (order.length < 3) return set;
      order.forEach((p, i) => {
        const q = order[(i + 1) % order.length];
        set.add([p.id, q.id].sort().join(":"));
      });
      return set;
    };
    const last = this.lastNeighbors || new Set();
    let best = null;
    let bestScore = Infinity;
    for (let tries = 0; tries < 12; tries++) {
      const order = shuffle(list);
      let score = 0;
      for (const pair of pairs(order)) if (last.has(pair)) score += 1;
      if (score < bestScore) {
        best = order;
        bestScore = score;
        if (score === 0) break;
      }
    }
    this.lastNeighbors = pairs(best);
    return best;
  }

  // Anropas när någon dör eller lämnar: är det bara en kvar vinner den rundan
  checkRoundEnd() {
    if (this.phase === "countdown" && this.players.size < MATCH.minPlayers) {
      this.toLobby();
      return;
    }
    if (this.phase !== "round") return;
    const alive = [...this.players.values()].filter((p) => !p.dead);

    if (this.mode === "team") {
      const teams = new Set(alive.map((p) => p.team));
      if (teams.size > 1) return;
      const team = alive.length ? alive[0].team : null;
      if (team !== null) {
        this.teamWins[team] += 1;
        for (const p of this.players.values()) if (p.team === team) p.wins += 1;
      }
      const token = this.setPhase("roundEnd");
      this.broadcast({ t: "roundEnd", winner: null, team, wins: this.winsTable(), teamWins: this.teamWins });
      this.later(MATCH.roundEndDelay, token, () => {
        if (team !== null && this.teamWins[team] >= MATCH.roundsToWin) this.matchEnd(null, team);
        else this.nextRoundOrLobby();
      });
      return;
    }

    if (alive.length > 1) return;
    const winner = alive[0] || null;
    if (winner) winner.wins += 1;
    const token = this.setPhase("roundEnd");

    if (this.mode === "tourney" && this.duel) {
      const match = this.currentMatch();
      if (winner) match.s[winner.id === match.a ? 0 : 1] += 1;
      this.broadcast({ t: "roundEnd", winner: winner ? winner.id : null, wins: this.winsTable(), duel: this.duelInfo() });
      this.later(MATCH.roundEndDelay, token, () => {
        if (winner && match.s[winner.id === match.a ? 0 : 1] >= MATCH.duelRoundsToWin) {
          this.finishDuel(winner.id);
        } else if (this.players.has(match.a) && this.players.has(match.b)) {
          this.startCountdown([match.a, match.b]);
        } else {
          this.finishDuel(this.players.has(match.a) ? match.a : match.b);
        }
      });
      return;
    }

    this.broadcast({ t: "roundEnd", winner: winner ? winner.id : null, wins: this.winsTable() });
    this.later(MATCH.roundEndDelay, token, () => {
      if (winner && winner.wins >= MATCH.roundsToWin && this.players.has(winner.id)) {
        this.matchEnd(winner.id);
      } else {
        this.nextRoundOrLobby();
      }
    });
  }

  nextRoundOrLobby() {
    if (this.players.size < MATCH.minPlayers) return this.toLobby();
    if (this.mode === "team") {
      // Finns det fortfarande folk i båda lagen?
      const list = [...this.players.values()];
      for (const team of [0, 1]) {
        if (!list.some((p) => p.team === team)) return this.matchEnd(null, 1 - team);
      }
    }
    this.startCountdown();
  }

  // ----- Turnering -----

  currentMatch() {
    return this.duel ? this.bracket[this.duel.ri][this.duel.mi] : null;
  }

  duelInfo() {
    const m = this.currentMatch();
    return m && this.mode === "tourney" ? { a: m.a, b: m.b, s: m.s, ri: this.duel.ri, mi: this.duel.mi } : null;
  }

  // Skriv in vinnaren och flytta den vidare till nästa omgång
  setMatchWinner(ri, mi, winnerId) {
    const match = this.bracket[ri][mi];
    match.w = winnerId ?? null;
    const next = this.bracket[ri + 1];
    if (next) next[Math.floor(mi / 2)][mi % 2 === 0 ? "a" : "b"] = match.w;
  }

  // Leta upp nästa duell. Matcher där någon saknas (fripass eller har lämnat) avgörs direkt.
  findNextDuel() {
    for (let ri = 0; ri < this.bracket.length; ri++) {
      for (let mi = 0; mi < this.bracket[ri].length; mi++) {
        const m = this.bracket[ri][mi];
        if (m.w !== undefined) continue;
        if (m.a === undefined || m.b === undefined) return null; // borde inte hända
        const present = [m.a, m.b].filter((id) => id && this.players.has(id));
        if (present.length === 2) return { ri, mi };
        this.setMatchWinner(ri, mi, present[0] ?? null);
      }
    }
    return null;
  }

  champion() {
    const final = this.bracket[this.bracket.length - 1][0];
    return final.w !== undefined ? final.w : undefined;
  }

  // Visa trädet en stund, sen börjar nästa duell
  showBracket() {
    const token = this.setPhase("bracket");
    this.duel = this.findNextDuel();
    const champ = this.champion();
    this.broadcast({ t: "bracket", bracket: this.bracket, names: this.bracketNames, next: this.duel, champion: champ ?? null });
    this.later(champ !== undefined ? 2 : MATCH.bracketDelay, token, () => {
      this.duel = this.findNextDuel();
      if (!this.duel) {
        const winner = this.champion();
        if (winner && this.players.has(winner)) this.matchEnd(winner);
        else this.toLobby();
        return;
      }
      const m = this.currentMatch();
      this.startCountdown([m.a, m.b]);
    });
  }

  finishDuel(winnerId) {
    const { ri, mi } = this.duel;
    this.setMatchWinner(ri, mi, winnerId);
    this.duel = null;
    this.showBracket();
  }

  // winner = spelarens id (eller null), team = vinnande lag i lagspel
  matchEnd(winner, team = null) {
    const token = this.setPhase("matchEnd");
    const counted = this.humans().length >= 2;
    this.recordMatch(winner, team);
    this.broadcast({
      t: "matchEnd", winner, team, mode: this.mode, counted,
      wins: this.winsTable(), kills: this.killsTable(), teamWins: this.teamWins,
      podium: this.podium(winner, team),
      awards: this.awards(),
    });
    this.later(MATCH.matchEndDelay, token, () => this.toLobby());
  }

  // Utmärkelser: den som hade mest av varje sak (minst 1) får en skylt
  awards() {
    const list = [];
    for (const award of AWARDS) {
      let best = null;
      for (const p of this.players.values()) {
        const v = p.stats?.[award.key] || 0;
        if (v > 0 && (!best || v > best.v)) best = { key: award.key, id: p.id, v: Math.round(v) };
      }
      if (best) list.push(best);
    }
    return list;
  }

  // Prispallen: [etta, tvåa, trea] (spelar-id, bara de som fortfarande är kvar)
  podium(winner, team) {
    const here = (id) => id && this.players.has(id);
    const byScore = (a, b) => b.wins - a.wins || b.kills - a.kills;
    let order = [];
    if (this.mode === "team" && team !== null) {
      // Vinnande laget: bäst (flest dråp) högst upp
      order = [...this.players.values()].filter((p) => p.team === team).sort((a, b) => b.kills - a.kills).map((p) => p.id);
    } else if (this.mode === "tourney" && this.bracket) {
      const final = this.bracket[this.bracket.length - 1][0];
      const loserOf = (m) => (m && m.w ? (m.a === m.w ? m.b : m.a) : null);
      const semis = this.bracket.length > 1 ? this.bracket[this.bracket.length - 2] : [];
      const thirds = semis.map(loserOf).filter(here).map((id) => this.players.get(id)).sort((a, b) => b.kills - a.kills);
      order = [winner ?? final.w, loserOf(final), thirds[0]?.id];
    } else {
      order = [...this.players.values()].sort(byScore).map((p) => p.id);
      if (winner) order = [winner, ...order.filter((id) => id !== winner)];
    }
    return [0, 1, 2].map((i) => (here(order[i]) ? order[i] : null));
  }

  toLobby() {
    this.setPhase("lobby");
    this.round = 0;
    this.duel = null;
    for (const p of this.players.values()) {
      resetForRound(p);
      p.ready = !!p.bot; // alla får trycka redo igen
    }
    this.broadcast({ t: "lobby" });
    this.sendBoard();
  }

  // ===================== Strid =====================

  // Bara levande spelare under en pågående runda får röra sig och slåss
  canFight(player) {
    return this.phase === "round" && !player.dead;
  }

  handleState(ws, player, msg) {
    if (!Array.isArray(msg.p) || msg.p.length !== 3) return;
    if (!this.canFight(player)) return;

    // Håll positionen inom arenan (skydd mot konstiga värden)
    const x = Math.max(-ARENA_RX, Math.min(ARENA_RX, finite(msg.p[0])));
    const y = Math.max(0, Math.min(5, finite(msg.p[1])));
    const z = Math.max(-ARENA_RZ, Math.min(ARENA_RZ, finite(msg.p[2])));
    // Utan ben sitter man kvar där man föll. Den som hålls fast står där den som håller den står.
    if (player.heldBy) {
      const holder = this.players.get(player.heldBy);
      if (holder) player.p = this.frontOf(holder);
    } else if (!player.legless) {
      player.p = [round2(x), round2(y), round2(z)];
    }
    player.r = round2(finite(msg.r));
    player.a = msg.a === 1 || msg.a === 2 ? msg.a : 0;
    player.crouch = msg.c === 1 && !player.legless;
    this.broadcast({ t: "s", id: player.id, p: player.p, r: player.r, a: player.a, c: player.crouch ? 1 : 0 }, ws);
    // Den man håller fast följer med
    if (player.holding) {
      const held = this.players.get(player.holding);
      if (held) {
        held.p = this.frontOf(player);
        held.r = round2(player.r + Math.PI);
        this.broadcast({ t: "s", id: held.id, p: held.p, r: held.r, a: 0, c: 0 });
      }
    }
  }

  // Punkten precis framför en spelare (där den man håller fast står)
  frontOf(player, dist = 0.8) {
    return [round2(player.p[0] + Math.sin(player.r) * dist), 0, round2(player.p[2] + Math.cos(player.r) * dist)];
  }

  // Ligger man på marken eller rullar kan man inte göra något annat
  busy(player, t) {
    return t < player.staggerUntil || t < player.downUntil || t - player.rollStart < COMBAT.roll.time || !!player.heldBy;
  }

  handleCharge(ws, player, msg) {
    if (!this.canFight(player)) return;
    const on = msg.on === 1;
    player.chargeStart = on ? now() : null;
    this.broadcast({ t: "ch", id: player.id, on: on ? 1 : 0 }, ws);
  }

  handleAttack(ws, player, kind, aim) {
    const t = now();
    if (!this.canFight(player) || this.busy(player, t)) return;
    if (player.holding) return this.grabPunch(player, t);

    const w = player.cw;
    const spec = attackSpec(kind, w);

    if (kind === "h") {
      if (t < player.nextHeavy - TOLERANCE) return;
      if (player.chargeStart === null || t - player.chargeStart < spec.charge - 0.2) return;
    } else if (kind === "t") {
      if (t < player.nextThrust - TOLERANCE) return; // stöten har en egen, längre väntetid
    } else if (t < player.nextQuick - TOLERANCE) {
      return;
    }

    player.chargeStart = null;
    const cds = cooldownsAfter(kind, w);
    player.nextQuick = t + cds.quick;
    player.nextHeavy = t + cds.heavy;
    player.nextThrust = Math.max(player.nextThrust, t + cds.thrust);

    // Vad siktade spelaren på? { id: motståndare, seg: kroppsdel }
    const aimInfo = aim && typeof aim.id === "string" && typeof aim.seg === "string" && AIM_JOINT[aim.seg]
      ? { id: aim.id, seg: aim.seg }
      : null;

    this.broadcast({ t: "atk", id: player.id, k: kind }, ws);
    const token = this.phaseToken;
    this.later(spec.windup, token, () => this.resolveAttack(player.id, kind, aimInfo));
    this.botsReact(player, spec, token);
  }

  resolveAttack(attackerId, kind, aimInfo) {
    const attacker = this.players.get(attackerId);
    if (!attacker || !this.canFight(attacker)) return;

    const t = now();
    if (t < attacker.staggerUntil) return; // blev själv parerad under tiden

    const w = attacker.cw;
    const ws = weaponSpec(w);
    const spec = attackSpec(kind, w);

    // Vilka står inom räckhåll och framför den som slår? (den som rullar just nu går inte att träffa)
    const targets = this.inCone(attacker, spec.reach, spec.arc).filter((p) => !invulnerable(p, t));

    // Zweihändern: ett tungt slag som missar får riddaren att snurra runt och vingla
    if (targets.length === 0 && kind === "h" && ws.whiffStagger) {
      attacker.staggerUntil = t + ws.whiffStagger;
      attacker.chargeStart = null;
      this.broadcast({ t: "whiff", id: attacker.id });
      return;
    }

    // Parering: tryckte någon av måltavlorna parera precis innan, vänd mot den som slår?
    // Med tvåhandsvapen parerar man med vapnet: kortare fönster. Slagkedjan går ibland runt skölden.
    for (const target of targets) {
      const sinceParry = t - target.lastParry;
      const window = COMBAT.parry.window * (weaponSpec(target.cw).twoHanded ? 0.7 : 1) + COMBAT.parry.lag;
      if (sinceParry < 0 || sinceParry > window || t < target.downUntil) continue;
      if (ws.parryBypass && Math.random() < ws.parryBypass) continue;
      const tx = Math.sin(target.r);
      const tz = Math.cos(target.r);
      const facing = tx * (attacker.p[0] - target.p[0]) + tz * (attacker.p[2] - target.p[2]);
      if (facing <= 0) continue;

      attacker.staggerUntil = t + COMBAT.parry.stagger;
      attacker.chargeStart = null;
      target.nextParry = t;
      this.broadcast({ t: "parried", id: target.id, by: attacker.id });
      target.stats.parry += 1;
      return;
    }

    for (const target of targets) {
      // Hillebarden är klumpig på nära håll: halv skada om man står för nära
      const dist = Math.hypot(target.p[0] - attacker.p[0], target.p[2] - attacker.p[2]);
      // Ligger man på marken tar man extra skada. Hukar man är huvudet svårt att träffa (räknas som bålen).
      const down = t < target.downUntil;
      let damage = Math.round(spec.damage * (ws.minRange && dist < ws.minRange ? 0.5 : 1) * (down ? COMBAT.down.damage : 1));
      let aimSeg = aimInfo && aimInfo.id === target.id ? aimInfo.seg : null;
      if (aimSeg === "head" && target.crouch) {
        aimSeg = "torso";
        damage = Math.round(damage * 0.85);
      }
      attacker.stats.dmg += Math.min(target.hp, damage);
      target.hp = Math.max(0, target.hp - damage);
      if (target.holding) this.releaseGrab(target, "hit"); // den som håller fast släpper när den blir träffad
      target.lastAttacker = attacker.id;
      const dead = target.hp === 0;
      const sev = chooseSever(target, kind, dead, aimSeg, Math.random, damage, ws.sever, attacker.crouch && !aimSeg);
      if (sev) {
        target.severed.push(sev);
        attacker.stats.sev += 1;
      }
      // Tunga slag kan slå av hjälmen (bara utseende). Siktar man på huvudet åker den alltid.
      // Hammare slår av hjälmar mycket lättare, även med snabba slag.
      let hk = 0;
      const knockChance = ws.helmetKnock ?? (kind === "h" ? MATCH.helmetKnockChance : 0);
      if ((kind === "h" || ws.helmetKnock) && !target.helmetOff && sev !== "neck" && ((kind === "h" && aimSeg === "head") || Math.random() < knockChance)) {
        target.helmetOff = true;
        hk = 1;
      }
      // Tappar vapnet: vapenarmen huggen av, eller död
      let drop = null;
      if ((dead || (sev && WEAPON_ARM.includes(sev))) && target.cw !== FISTS) {
        drop = this.dropWeapon(target);
      }
      // Trubbiga vapen får motståndaren att vingla; släggans tunga slag fäller den
      let st = 0;
      let kd = 0;
      if (!dead && ws.hitStagger) {
        target.staggerUntil = Math.max(target.staggerUntil, t + ws.hitStagger);
        target.chargeStart = null;
        st = 1;
      }
      if (!dead && ws.knockdown && kind === "h" && !target.legless) {
        this.knockDown(target, t);
        kd = 1;
      }
      // Båda benen borta: sitter på marken och blöder
      let ll = 0;
      if (!dead && sev && !target.legless && isLegless(target)) {
        target.legless = true;
        target.crouch = false;
        target.chargeStart = null;
        ll = 1;
        this.bleed(target, this.phaseToken);
      }
      if (dead) {
        target.dead = true;
        target.chargeStart = null;
        attacker.kills += 1;
      }
      this.broadcast({
        t: "hit",
        id: target.id,
        by: attacker.id,
        k: kind,
        hp: target.hp,
        dead,
        kills: attacker.kills,
        sev,
        seg: aimSeg, // kroppsdelen som träffades (om man siktade)
        hk,          // 1 = hjälmen flög av
        drop,        // vapnet som tappades: { id, w, p } (eller null)
        st, kd, ll,  // vinglar / fälld / sitter utan ben
      });
    }
    this.checkRoundEnd();
  }

  // Vilka står inom räckhåll och inom vinkeln framför spelaren?
  inCone(attacker, reach, arc) {
    const fx = Math.sin(attacker.r);
    const fz = Math.cos(attacker.r);
    const minDot = Math.cos((arc * Math.PI) / 180);
    const result = [];
    for (const target of this.players.values()) {
      if (target === attacker || target.dead) continue;
      if (this.mode === "team" && target.team === attacker.team) continue; // inga skador på lagkamrater
      const dx = target.p[0] - attacker.p[0];
      const dz = target.p[2] - attacker.p[2];
      const dy = Math.abs(target.p[1] - attacker.p[1]);
      const dist = Math.hypot(dx, dz);
      // Smala attacker (stöten) får lite extra bredd på nära håll, annars missar man lätt kroppen
      const bodyAngle = dist > 0.01 ? Math.atan(BODY_RADIUS / dist) : Math.PI;
      const allowed = Math.cos(Math.min(Math.PI, (arc * Math.PI) / 180 + bodyAngle));
      if (dist > reach + BODY_RADIUS || dy > 1.6) continue;
      if (dist > 0.5 && (fx * dx + fz * dz) / dist < Math.min(minDot, allowed)) continue;
      result.push(target);
    }
    return result;
  }

  // Spark: knuffar bort de som står framför, ingen skada. Kan fälla den sparkade.
  handleKick(ws, player) {
    const t = now();
    if (!this.canFight(player) || this.busy(player, t) || player.legless) return;
    if (player.holding) return this.releaseGrab(player, "down");
    if (t < player.nextKick - TOLERANCE) return;
    player.nextKick = t + COMBAT.kick.cooldown;
    player.chargeStart = null;
    this.broadcast({ t: "kick", id: player.id }, ws);
    this.later(COMBAT.kick.windup, this.phaseToken, () => {
      const t2 = now();
      if (!this.canFight(player) || t2 < player.staggerUntil) return;
      for (const target of this.inCone(player, COMBAT.kick.reach, COMBAT.kick.arc)) {
        if (invulnerable(target, t2)) continue;
        const dx = target.p[0] - player.p[0];
        const dz = target.p[2] - player.p[2];
        const len = Math.hypot(dx, dz) || 1;
        // Bakifrån: den sparkade tittar bort från den som sparkar
        const behind = Math.sin(target.r) * dx + Math.cos(target.r) * dz > 0.3 * len;
        const charging = target.chargeStart !== null;
        const down = !target.legless && (charging || behind || Math.random() < COMBAT.kick.knockdown);
        target.staggerUntil = Math.max(target.staggerUntil, t2 + COMBAT.kick.stagger);
        target.chargeStart = null;
        target.lastParry = -100; // sparken går inte att parera och bryter en parering
        if (down) this.knockDown(target, t2);
        this.broadcast({ t: "kicked", id: target.id, by: player.id, dir: [round2(dx / len), round2(dz / len)], down: down ? 1 : 0 });
      }
    });
  }

  // Omkull: ligger på marken en stund
  knockDown(target, t) {
    target.stats.fell += 1;
    if (target.holding) this.releaseGrab(target, "hit");
    target.downUntil = t + COMBAT.down.time;
    target.staggerUntil = Math.max(target.staggerUntil, target.downUntil);
    target.chargeStart = null;
    target.lastParry = -100;
  }

  // Rullning: går inte att träffa en kort stund mitt i
  handleRoll(ws, player, dir) {
    const t = now();
    if (!this.canFight(player) || player.legless || player.heldBy || player.holding || t < player.nextRoll - TOLERANCE) return;
    if (t < player.staggerUntil && t >= player.downUntil) return; // vinglar man kan man inte rulla (men man kan rulla upp från marken)
    if (!Array.isArray(dir) || dir.length !== 2) return;
    const len = Math.hypot(finite(dir[0]), finite(dir[1])) || 1;
    player.rollStart = t;
    player.nextRoll = t + COMBAT.roll.cooldown;
    player.downUntil = 0;
    player.staggerUntil = Math.min(player.staggerUntil, t);
    player.chargeStart = null;
    player.lastParry = -100;
    this.broadcast({ t: "roll", id: player.id, dir: [round2(finite(dir[0]) / len), round2(finite(dir[1]) / len)] }, ws);
  }

  // ----- Kasta vapnet (G) -----
  // Vapnet flyger rakt fram. Servern räknar ut direkt vem det träffar (den första i vägen) och var det landar,
  // skickar det till alla (så alla kan visa flygturen) och gör skadan när vapnet kommer fram.
  handleThrow(ws, player) {
    const t = now();
    if (!this.canFight(player) || this.busy(player, t) || player.holding || player.cw === FISTS) return;
    if (!jointAvailable(player, "wristR")) return;
    const T = COMBAT.throw;
    const w = player.cw;
    const fx = Math.sin(player.r);
    const fz = Math.cos(player.r);
    const start = [player.p[0] + fx * 0.5, 1.45, player.p[2] + fz * 0.5];
    // Hur långt innan staketet?
    let range = T.range;
    for (let d = 0; d <= T.range; d += 0.25) {
      const x = start[0] + fx * d;
      const z = start[2] + fz * d;
      if ((x / (ARENA_RX - 0.3)) ** 2 + (z / (ARENA_RZ - 0.3)) ** 2 > 1) {
        range = d;
        break;
      }
    }
    // Första riddaren i vägen
    let hit = null;
    let hitDist = range;
    for (const target of this.players.values()) {
      if (target === player || target.dead) continue;
      if (this.mode === "team" && target.team === player.team) continue;
      const dx = target.p[0] - player.p[0];
      const dz = target.p[2] - player.p[2];
      const along = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (along < 0.3 || along > hitDist || side > T.radius) continue;
      hit = target;
      hitDist = along;
    }
    const land = hit
      ? [round2(hit.p[0] - fx * 0.4), 0, round2(hit.p[2] - fz * 0.4)]
      : [round2(start[0] + fx * range), 0, round2(start[2] + fz * range)];
    const time = round2(T.windup + Math.max(0.15, (hit ? hitDist : range) / T.speed));
    const item = { id: "i" + randomId().slice(0, 4), w, p: land, r: round2(player.r + (Math.random() - 0.5)) };
    player.cw = FISTS;
    player.chargeStart = null;
    player.nextQuick = Math.max(player.nextQuick, t + T.windup + 0.2);
    this.broadcast({ t: "throw", id: player.id, w, from: start.map(round2), to: land, time, hit: hit ? hit.id : null, item });
    const token = this.phaseToken;
    this.later(time, token, () => {
      this.items.set(item.id, item);
      if (!hit || !this.players.has(hit.id) || hit.dead || invulnerable(hit, now())) return;
      const ws2 = weaponSpec(w);
      const damage = Math.round(COMBAT.quick.damage * ws2.damage * T.damage);
      const attacker = this.players.get(player.id);
      hit.hp = Math.max(0, hit.hp - damage);
      hit.lastAttacker = player.id;
      if (attacker) {
        attacker.stats.dmg += damage;
        attacker.stats.throwHit += 1;
      }
      const dead = hit.hp === 0;
      const sev = chooseSever(hit, "q", dead, null, Math.random, damage, ws2.sever);
      if (sev) {
        hit.severed.push(sev);
        if (attacker) attacker.stats.sev += 1;
      }
      let drop = null;
      if ((dead || (sev && WEAPON_ARM.includes(sev))) && hit.cw !== FISTS) drop = this.dropWeapon(hit);
      if (hit.holding) this.releaseGrab(hit, "hit");
      let ll = 0;
      if (!dead && sev && !hit.legless && isLegless(hit)) {
        hit.legless = true;
        hit.crouch = false;
        ll = 1;
        this.bleed(hit, token);
      }
      if (!dead) {
        hit.staggerUntil = Math.max(hit.staggerUntil, now() + T.stagger);
        hit.chargeStart = null;
      } else {
        hit.dead = true;
        hit.chargeStart = null;
        if (attacker) attacker.kills += 1;
      }
      this.broadcast({
        t: "hit", id: hit.id, by: player.id, k: "x", hp: hit.hp, dead, kills: attacker ? attacker.kills : 0,
        sev, seg: null, hk: 0, drop, st: dead ? 0 : 1, kd: 0, ll,
      });
      this.checkRoundEnd();
    });
  }

  // ----- Brottning: ta tag i någon (R) -----

  handleGrab(ws, player) {
    const t = now();
    if (!this.canFight(player)) return;
    if (player.holding) return this.releaseGrab(player, "shove"); // R igen: knuffa iväg
    if (player.heldBy) return this.handleStruggle(player);
    if (this.busy(player, t) || player.legless || t < player.nextGrab - TOLERANCE) return;
    // Med dolken når man längre och kan ta tag oftare
    const pws = weaponSpec(player.cw);
    player.nextGrab = t + (pws.grabCd ?? COMBAT.grab.cooldown);
    // Närmaste riddare precis framför
    const G = COMBAT.grab;
    let target = null;
    let best = Infinity;
    for (const p of this.inCone(player, pws.grabReach ?? G.reach, G.arc)) {
      const d = Math.hypot(p.p[0] - player.p[0], p.p[2] - player.p[2]);
      if (d < best) {
        best = d;
        target = p;
      }
    }
    this.broadcast({ t: "grabTry", id: player.id }, ws);
    if (!target || target.holding || target.heldBy || invulnerable(target, t)) return;
    // Den som parerar kan inte bli tagen: den som försökte vinglar till
    if (t - target.lastParry < COMBAT.parry.window + COMBAT.parry.lag) {
      player.staggerUntil = t + 0.6;
      this.broadcast({ t: "parried", id: target.id, by: player.id });
      target.stats.parry += 1;
      return;
    }
    player.holding = target.id;
    player.chargeStart = null;
    player.stats.grabs += 1;
    target.heldBy = player.id;
    target.chargeStart = null;
    target.struggle = 0;
    target.lastParry = -100;
    target.p = this.frontOf(player);
    target.r = round2(player.r + Math.PI);
    const grabId = (player.grabId = (player.grabId || 0) + 1);
    this.broadcast({ t: "grab", id: player.id, target: target.id, p: target.p, r: target.r });
    this.later(G.hold, this.phaseToken, () => {
      if (player.holding === target.id && player.grabId === grabId) this.releaseGrab(player, "timeout");
    });
  }

  // Den fasthållna trycker för att slita sig loss
  handleStruggle(player) {
    if (!player.heldBy) return;
    player.struggle += 1;
    const holder = this.players.get(player.heldBy);
    if (!holder) {
      player.heldBy = null;
      return;
    }
    if (player.struggle >= COMBAT.grab.escape) {
      this.releaseGrab(holder, "escape");
      holder.staggerUntil = now() + 0.6;
    } else {
      this.broadcast({ t: "struggle", id: player.id, n: player.struggle });
    }
  }

  // Slag med knytnäven medan man håller fast
  grabPunch(player, t) {
    if (t < player.nextQuick - TOLERANCE) return;
    const target = this.players.get(player.holding);
    if (!target || target.dead) return this.releaseGrab(player, "timeout");
    player.nextQuick = t + COMBAT.grab.punchCooldown;
    const damage = weaponSpec(player.cw).grabPunch ?? COMBAT.grab.punch; // dolken hugger i stället för att slå
    player.stats.dmg += Math.min(target.hp, damage);
    target.hp = Math.max(0, target.hp - damage);
    target.lastAttacker = player.id;
    const dead = target.hp === 0;
    this.broadcast({ t: "atk", id: player.id, k: "p" });
    if (dead) {
      target.dead = true;
      player.kills += 1;
      this.releaseGrab(player, "dead");
      if (target.cw !== FISTS) this.dropWeapon(target);
    }
    this.broadcast({
      t: "hit", id: target.id, by: player.id, k: "p", hp: target.hp, dead, kills: player.kills,
      sev: null, seg: "head", hk: 0, drop: null, st: 0, kd: 0, ll: 0,
    });
    if (dead) this.checkRoundEnd();
  }

  // Släpp greppet. how: "shove" (knuffas iväg), "down" (kastas omkull), "escape" (slet sig loss), "hit", "timeout", "dead"
  releaseGrab(holder, how) {
    const target = this.players.get(holder.holding);
    holder.holding = null;
    if (!target) return;
    target.heldBy = null;
    target.struggle = 0;
    const t = now();
    const dir = [round2(Math.sin(holder.r)), round2(Math.cos(holder.r))];
    if (how === "shove") target.staggerUntil = Math.max(target.staggerUntil, t + 0.9);
    if (how === "down") this.knockDown(target, t);
    this.broadcast({ t: "grabEnd", id: holder.id, target: target.id, how, dir });
  }

  // ----- Tappade vapen -----

  dropWeapon(player) {
    // Den som dör eller tappar vapnet släpper också sitt grepp
    if (player.holding) this.releaseGrab(player, "hit");
    if (player.heldBy) {
      const holder = this.players.get(player.heldBy);
      if (holder) this.releaseGrab(holder, "dead");
    }
    const id = "i" + randomId().slice(0, 4);
    const a = Math.random() * Math.PI * 2;
    const p = [
      round2(Math.max(-ARENA_RX + 0.5, Math.min(ARENA_RX - 0.5, player.p[0] + Math.sin(a) * 0.9))),
      0,
      round2(Math.max(-ARENA_RZ + 0.5, Math.min(ARENA_RZ - 0.5, player.p[2] + Math.cos(a) * 0.9))),
    ];
    const item = { id, w: player.cw, p, r: round2(Math.random() * Math.PI * 2) };
    this.items.set(id, item);
    player.cw = FISTS;
    return item;
  }

  // Plocka upp ett vapen från marken (E). Har man redan ett vapen läggs det ner i stället.
  handlePickup(ws, player, itemId) {
    const t = now();
    const item = this.items.get(itemId);
    if (!item || !this.canFight(player) || this.busy(player, t)) return;
    if (!jointAvailable(player, "wristR")) return; // ingen hand att hålla med
    if (Math.hypot(item.p[0] - player.p[0], item.p[2] - player.p[2]) > 2.2) return;
    this.items.delete(itemId);
    let drop = null;
    if (player.cw !== FISTS) {
      drop = { id: "i" + randomId().slice(0, 4), w: player.cw, p: [...item.p], r: item.r };
      this.items.set(drop.id, drop);
    }
    player.cw = item.w;
    player.chargeStart = null;
    this.broadcast({ t: "pick", id: player.id, item: itemId, w: item.w, drop });
  }

  // Utan ben blöder man: lite liv försvinner varje sekund
  bleed(player, token) {
    this.later(1, token, () => {
      if (!this.players.has(player.id) || player.dead || !player.legless || this.phase !== "round") return;
      player.hp = Math.max(0, player.hp - COMBAT.leglessBleed);
      const dead = player.hp === 0;
      const killer = this.players.get(player.lastAttacker);
      if (dead) {
        player.dead = true;
        if (killer) killer.kills += 1;
        if (player.cw !== FISTS) this.dropWeapon(player);
      }
      this.broadcast({ t: "hit", id: player.id, by: player.lastAttacker, k: "b", hp: player.hp, dead, kills: killer ? killer.kills : 0, sev: null, seg: null, hk: 0, drop: null });
      if (dead) this.checkRoundEnd();
      else this.bleed(player, token);
    });
  }

  handleParry(ws, player) {
    const t = now();
    if (!this.canFight(player) || t < player.downUntil || player.heldBy || player.holding || t < player.nextParry - TOLERANCE) return;
    player.lastParry = t;
    player.nextParry = t + COMBAT.parry.cooldown;
    this.broadcast({ t: "par", id: player.id }, ws);
  }

  // ===================== Träningsmotståndarnas hjärna =====================
  // Körs tio gånger i sekunden under en runda. Varje bot går mot närmaste fiende, håller lagom
  // avstånd, cirklar lite åt sidan och slår, stöter eller sparkar när den står rätt.

  botTick(token) {
    const DT = 0.1;
    this.later(DT, token, () => {
      const t = now();
      for (const bot of this.bots()) {
        if (bot.dead) continue;
        this.botThink(bot, t, DT);
      }
      if (this.bots().some((b) => !b.dead)) this.botTick(token);
    });
  }

  botThink(bot, t, dt) {
    bot.ai ??= { strafe: 1, strafeUntil: 0, nextAct: t + 0.6 + Math.random(), heavyAt: 0 };
    const ai = bot.ai;
    // Närmaste fiende
    let target = null;
    let best = Infinity;
    for (const p of this.players.values()) {
      if (p === bot || p.dead || (this.mode === "team" && p.team === bot.team)) continue;
      const d = Math.hypot(p.p[0] - bot.p[0], p.p[2] - bot.p[2]);
      if (d < best) {
        best = d;
        target = p;
      }
    }
    if (!target) return;

    // Brottning: fasthållen boten sliter, och en bot som håller fast någon slår, knuffar eller kastar omkull
    if (bot.heldBy) {
      if (Math.random() < 0.35) this.handleStruggle(bot);
      return;
    }
    if (bot.holding) {
      ai.holdT = (ai.holdT || 0) + dt;
      if (ai.holdT > 0.5 && Math.random() < 0.25) {
        const r = Math.random();
        if (r < 0.5) this.grabPunch(bot, t);
        else if (r < 0.75) this.releaseGrab(bot, "shove");
        else this.releaseGrab(bot, "down");
      }
      return;
    }
    ai.holdT = 0;

    // Utan vapen: gå och hämta det närmaste vapnet på marken
    if (bot.cw === FISTS && this.items.size && jointAvailable(bot, "wristR")) {
      let item = null;
      let bestItem = 8;
      for (const it of this.items.values()) {
        const d = Math.hypot(it.p[0] - bot.p[0], it.p[2] - bot.p[2]);
        if (d < bestItem) {
          bestItem = d;
          item = it;
        }
      }
      if (item && bestItem < 1.8 && !this.busy(bot, t)) {
        this.handlePickup(null, bot, item.id);
        return;
      }
      if (item && bestItem < best) target = { p: item.p, item: true, id: null };
    }

    const dx = target.p[0] - bot.p[0];
    const dz = target.p[2] - bot.p[2];
    const dist = Math.hypot(dx, dz) || 0.001;
    // Vänd sig mot fienden (lite trögt, så att man kan gå runt den)
    const want = Math.atan2(dx, dz);
    let diff = want - bot.r;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.r = round2(bot.r + Math.max(-5 * dt, Math.min(5 * dt, diff)));

    const busy = this.busy(bot, t);
    let moving = 0;
    if (!busy && !bot.legless && bot.chargeStart === null) {
      const reach = attackSpec("q", bot.cw).reach;
      const ideal = Math.max(1.2, reach - 0.35);
      const fx = dx / dist;
      const fz = dz / dist;
      let vx = 0;
      let vz = 0;
      if (dist > ideal + 0.25) {
        const speed = dist > 6 ? 5.5 : 3.4;
        vx += fx * speed;
        vz += fz * speed;
      } else if (dist < ideal - 0.5) {
        vx -= fx * 1.6;
        vz -= fz * 1.6;
      }
      // Cirkla åt sidan ibland
      if (t > ai.strafeUntil) {
        ai.strafe = Math.random() < 0.5 ? -1 : 1;
        ai.strafeUntil = t + 1.2 + Math.random() * 2;
      }
      if (dist < ideal + 1.5) {
        vx += -fz * ai.strafe * 1.3;
        vz += fx * ai.strafe * 1.3;
      }
      // Håll avstånd till alla andra riddare
      for (const p of this.players.values()) {
        if (p === bot || p.dead) continue;
        const ox = bot.p[0] - p.p[0];
        const oz = bot.p[2] - p.p[2];
        const od = Math.hypot(ox, oz);
        if (od > 0.01 && od < 1.0) {
          vx += (ox / od) * 3;
          vz += (oz / od) * 3;
        }
      }
      let x = bot.p[0] + vx * dt;
      let z = bot.p[2] + vz * dt;
      const rx = ARENA_RX - 0.6;
      const rz = ARENA_RZ - 0.6;
      const v = (x / rx) ** 2 + (z / rz) ** 2;
      if (v > 1) {
        x /= Math.sqrt(v);
        z /= Math.sqrt(v);
      }
      moving = Math.hypot(vx, vz) > 0.3 ? (Math.hypot(vx, vz) > 4.5 ? 2 : 1) : 0;
      bot.p = [round2(x), 0, round2(z)];
    }
    bot.a = moving;
    this.broadcast({ t: "s", id: bot.id, p: bot.p, r: bot.r, a: bot.a, c: 0 });

    // Ett laddat tungt slag släpps när det är klart
    if (ai.heavyAt && t >= ai.heavyAt) {
      ai.heavyAt = 0;
      if (bot.chargeStart !== null) this.handleAttack(null, bot, "h", this.botAim(target));
      return;
    }
    if (busy || t < ai.nextAct || bot.chargeStart !== null) return;
    const facing = Math.abs(diff) < 0.45;
    // Ibland kastar boten vapnet mot någon som står en bit bort
    if (!target.item && facing && Math.abs(diff) < 0.12 && dist > 4 && dist < 10 && bot.cw !== FISTS && Math.random() < 0.04) {
      ai.nextAct = t + 1;
      this.handleThrow(null, bot);
      return;
    }
    const reach = attackSpec("q", bot.cw).reach;
    if (!facing || dist > reach + 0.3) return;

    ai.nextAct = t + 0.45 + Math.random() * 0.7;
    if (target.item) return;
    const roll = Math.random();
    if (roll < 0.06 && t >= bot.nextGrab && !bot.legless) {
      this.handleGrab(null, bot);
      return;
    }
    if (roll < 0.12 && t >= bot.nextKick && !bot.legless) {
      this.handleKick(null, bot);
    } else if (roll < 0.35 && t >= bot.nextHeavy) {
      bot.chargeStart = t;
      ai.heavyAt = t + attackSpec("h", bot.cw).charge + 0.05;
      this.broadcast({ t: "ch", id: bot.id, on: 1 });
    } else if (roll < 0.5 && t >= bot.nextThrust) {
      this.handleAttack(null, bot, "t", this.botAim(target));
    } else if (t >= bot.nextQuick) {
      this.handleAttack(null, bot, "q", this.botAim(target));
    }
  }

  // Ibland siktar boten på en arm, ett ben eller huvudet
  botAim(target) {
    if (Math.random() < 0.55) return null;
    const segs = ["head", "upperArmR", "forearmR", "upperArmL", "thighL", "thighR", "shinL", "shinR"];
    return { id: target.id, seg: segs[Math.floor(Math.random() * segs.length)] };
  }

  // Någon slår: botar som står i vägen försöker ibland parera i rätt ögonblick
  botsReact(attacker, spec, token) {
    for (const bot of this.bots()) {
      if (bot === attacker || bot.dead || Math.random() > 0.35) continue;
      if (!this.inCone(attacker, spec.reach, spec.arc).includes(bot)) continue;
      const delay = Math.max(0, spec.windup - 0.18 - Math.random() * 0.1);
      this.later(delay, token, () => {
        if (!bot.dead && this.players.has(bot.id) && bot.chargeStart === null) this.handleParry(null, bot);
      });
    }
  }

  // ===================== Anslutning bryts =====================

  async webSocketClose(ws, code, reason) {
    this.removePlayer(ws);
    try {
      ws.close(code, reason);
    } catch {
      // redan stängd
    }
  }

  async webSocketError(ws) {
    this.removePlayer(ws);
  }

  removePlayer(ws) {
    const info = ws.deserializeAttachment();
    if (!info || !this.players.has(info.id)) return;
    // Brottades man? Då släpper greppet
    const leaving = this.players.get(info.id);
    if (leaving.holding) this.releaseGrab(leaving, "timeout");
    if (leaving.heldBy && this.players.get(leaving.heldBy)) this.releaseGrab(this.players.get(leaving.heldBy), "timeout");
    this.players.delete(info.id);
    this.broadcast({ t: "leave", id: info.id }, ws);

    // Ny lobbyledare om ledaren gick
    if (this.hostId === info.id) {
      const next = this.humans()[0];
      this.setHost(next ? next.id : null);
      if (this.hostId) this.broadcast({ t: "host", id: this.hostId });
    }

    // Bara träningsmotståndare kvar: de går också
    if (this.humans().length === 0) {
      for (const bot of this.bots()) this.players.delete(bot.id);
      this.saveBots();
    }
    if (this.players.size === 0) {
      this.setPhase("lobby");
      this.round = 0;
      return;
    }
    if (this.phase === "matchEnd") return;
    if (this.phase !== "lobby" && this.players.size < MATCH.minPlayers) {
      // Inte nog med spelare kvar: tillbaka till lobbyn (den som är kvar vinner inget)
      this.toLobby();
      return;
    }
    // Turnering: lämnar en av duellanterna vinner den andra duellen direkt
    if (this.mode === "tourney" && this.duel && ["countdown", "round", "roundEnd"].includes(this.phase)) {
      const m = this.currentMatch();
      if (m.a === info.id || m.b === info.id) {
        this.finishDuel(m.a === info.id ? m.b : m.a);
        return;
      }
    }
    if (this.phase === "roundEnd" || this.phase === "bracket") return;
    if (this.mode === "team" && this.phase === "round") {
      const list = [...this.players.values()];
      for (const team of [0, 1]) {
        if (!list.some((p) => p.team === team)) return this.matchEnd(null, 1 - team);
      }
    }
    this.checkRoundEnd();
  }
}


// ===========================================================================
// TOPPLISTAN – en enda gemensam för alla rum (ett eget Durable Object med namnet "global")
//
// Sparas i minnet:
//   k:<hash av nyckeln>  → spelar-id     (nyckeln själv sparas aldrig, bara en "fingeravtryck"-kod av den)
//   n:<namn i små bokst> → spelar-id     (vem som äger namnet)
//   p:<spelar-id>        → { name, wins, kills, matches, sev, streak, best, awards, weapons }
// ===========================================================================

export class Leaderboard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rows = null;
  }

  async load() {
    if (this.rows) return;
    const rows = new Map();
    const list = await this.ctx.storage.list({ prefix: "p:" });
    for (const [, row] of list) rows.set(row.pid, row);
    this.rows = rows;
  }

  // Ta (eller behåll) ett namn. Svarar { ok: true, pid } eller { ok: false } om någon annan äger namnet.
  async claim(keyHash, name) {
    await this.load();
    if (typeof keyHash !== "string" || keyHash.length !== 64) return { ok: false };
    name = cleanName(name);
    const lname = name.toLowerCase();
    let pid = await this.ctx.storage.get("k:" + keyHash);
    const owner = await this.ctx.storage.get("n:" + lname);
    if (owner && owner !== pid) return { ok: false };
    if (!pid) {
      pid = randomId() + randomId();
      await this.ctx.storage.put("k:" + keyHash, pid);
    }
    let row = this.rows.get(pid);
    if (!row) row = { pid, name, wins: 0, kills: 0, matches: 0, sev: 0, streak: 0, best: 0, awards: {}, weapons: {} };
    // Bytt namn: det gamla namnet blir ledigt, siffrorna följer med
    const old = row.name.toLowerCase();
    if (old !== lname && (await this.ctx.storage.get("n:" + old)) === pid) await this.ctx.storage.delete("n:" + old);
    row.name = name;
    this.rows.set(pid, row);
    await this.ctx.storage.put({ ["n:" + lname]: pid, ["p:" + pid]: row });
    return { ok: true, pid };
  }

  async record(results) {
    await this.load();
    if (!Array.isArray(results)) return;
    const puts = {};
    for (const r of results.slice(0, 6)) {
      const row = this.rows.get(r?.pid);
      if (!row) continue;
      row.matches += 1;
      row.kills += Math.max(0, Math.min(200, Math.round(finite(r.kills))));
      row.sev += Math.max(0, Math.min(200, Math.round(finite(r.sev))));
      if (r.win) {
        row.wins += 1;
        row.streak += 1;
        row.best = Math.max(row.best, row.streak);
        const w = String(Math.round(finite(r.weapon)));
        row.weapons[w] = (row.weapons[w] || 0) + 1;
      } else {
        row.streak = 0;
      }
      for (const key of Array.isArray(r.awards) ? r.awards.slice(0, 8) : []) {
        if (AWARDS.some((a) => a.key === key)) row.awards[key] = (row.awards[key] || 0) + 1;
      }
      puts["p:" + row.pid] = row;
    }
    if (Object.keys(puts).length) await this.ctx.storage.put(puts);
  }

  sorted() {
    return [...this.rows.values()].filter((r) => r.matches > 0).sort((a, b) => b.wins - a.wins || b.kills - a.kills || a.matches - b.matches || a.name.localeCompare(b.name));
  }

  async top(pids = []) {
    await this.load();
    const list = this.sorted();
    const pub = (r, i) => ({ rank: i + 1, name: r.name, wins: r.wins, kills: r.kills, matches: r.matches });
    const mine = {};
    for (const pid of Array.isArray(pids) ? pids.slice(0, 6) : []) {
      const row = this.rows.get(pid);
      if (!row) continue;
      const i = list.indexOf(row);
      const topEntry = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])[0] || null;
      mine[pid] = {
        rank: i >= 0 ? i + 1 : null, name: row.name, wins: row.wins, kills: row.kills, matches: row.matches,
        sev: row.sev, streak: row.streak, best: row.best, award: topEntry(row.awards), weapon: topEntry(row.weapons),
      };
    }
    return { top: list.slice(0, 10).map(pub), total: list.length, mine };
  }
}
