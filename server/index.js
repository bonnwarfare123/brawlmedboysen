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
  WEAPONS, CAPES, MODES,
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

function cleanName(value) {
  const name = String(value ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, NAME_MAX);
  return name || "Namnlös riddare";
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
function spawnPoint(index, count) {
  const angle = (index / Math.max(count, 2)) * Math.PI * 2;
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
  };
}

function resetForRound(player) {
  player.hp = COMBAT.maxHp;
  player.dead = false;
  player.severed = [];
  player.limbDamage = {};
  player.nextQuick = 0;
  player.nextHeavy = 0;
  player.nextParry = 0;
  player.nextKick = 0;
  player.lastParry = -100;
  player.staggerUntil = 0;
  player.chargeStart = null;
  player.a = 0;
  player.helmetOff = false;
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
function chooseSever(player, kind, dead, aimSegment = null, random = Math.random) {
  const damage = specOf(kind).damage;

  // Siktade på en viss kroppsdel som finns kvar
  const aimed = aimSegment && AIM_JOINT[aimSegment];
  const torsoAim = aimed === "waist";
  if (aimed && jointAvailable(player, aimed) && !(torsoAim && !dead) && !(torsoAim && random() >= 0.5)) {
    if (KILL_ONLY_JOINTS.includes(aimed)) return dead ? aimed : null; // huvud bara vid dråp
    if (dead) return aimed;
    const type = aimSegment.replace(/[LR]$/, "");
    player.limbDamage[aimSegment] = (player.limbDamage[aimSegment] || 0) + damage;
    return player.limbDamage[aimSegment] >= COMBAT.limbHp[type] ? aimed : null;
  }

  // Annars (bålen, bredvid eller redan avhuggen) liten slumpchans som förut
  const key = (kind === "h" ? "heavy" : "quick") + (dead ? "Kill" : ""); // stöt räknas som snabbt
  if (random() >= COMBAT.randomSever[key]) return null;
  const candidates = LIMB_JOINTS.filter((j) => jointAvailable(player, j));
  if (dead) {
    for (const j of KILL_ONLY_JOINTS) {
      if (jointAvailable(player, j)) candidates.push(j, j);
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(random() * candidates.length)];
}

function specOf(kind) {
  return kind === "h" ? COMBAT.heavy : kind === "t" ? COMBAT.thrust : COMBAT.quick;
}

// Det som skickas till spelarna om en riddare (inte interna timers)
function publicPlayer(pl) {
  return {
    id: pl.id, name: pl.name, color: pl.color, look: pl.look, p: pl.p, r: pl.r, a: pl.a,
    hp: pl.hp, dead: pl.dead, kills: pl.kills, wins: pl.wins, severed: pl.severed,
    helmetOff: pl.helmetOff, team: pl.team,
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

    // Om rummet "sov" (hibernation) och vaknar igen: återskapa spelarlistan
    // från informationen som sparats på varje anslutning.
    for (const ws of this.ctx.getWebSockets()) {
      const info = ws.deserializeAttachment();
      if (info && info.id) {
        this.players.set(info.id, newPlayerState(info));
        if (!this.hostId) this.hostId = info.id;
      }
    }
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
        ws.serializeAttachment({ id: player.id, name: player.name, color: player.color, look: player.look, team: player.team });
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
    }
  }

  // ===================== Lobby =====================

  handleJoin(ws, info, msg) {
    if (info) return; // redan med

    if (this.players.size >= MAX_PLAYERS) {
      this.send(ws, { t: "full" });
      ws.close(4001, "Rummet är fullt");
      return;
    }

    // Unika färger: är den önskade färgen tagen får man första lediga
    const taken = new Set([...this.players.values()].map((p) => p.color));
    let color = Number.isInteger(msg.color) && msg.color >= 0 && msg.color < COLORS.length ? msg.color : 0;
    if (taken.has(color)) color = COLORS.findIndex((_, i) => !taken.has(i));

    const playerInfo = { id: randomId(), name: cleanName(msg.name), color, look: cleanLook(msg.look), team: null };
    const player = newPlayerState(playerInfo);
    if (this.mode === "team") player.team = this.smallerTeam();
    playerInfo.team = player.team;
    ws.serializeAttachment(playerInfo);

    // Kommer man in mitt i en match får man titta på tills nästa runda
    player.dead = this.phase !== "lobby";
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;

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
    });
    this.broadcast({ t: "join", player: publicPlayer(player) }, ws);
  }

  handleColor(ws, player, color) {
    if (this.phase !== "lobby") return;
    if (!Number.isInteger(color) || color < 0 || color >= COLORS.length) return;
    if ([...this.players.values()].some((p) => p !== player && p.color === color)) return; // upptagen
    player.color = color;
    this.saveInfo(player);
    this.broadcast({ t: "color", id: player.id, color });
  }

  // Byt rustning, hjälm eller sköld (bara i lobbyn)
  handleLook(ws, player, look) {
    if (this.phase !== "lobby") return;
    player.look = cleanLook(look);
    this.saveInfo(player);
    this.broadcast({ t: "look", id: player.id, look: player.look });
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
    }
    this.round = 0;
    this.teamWins = [0, 0];
    this.bracket = null;
    this.duel = null;
    if (this.mode === "team") this.balanceTeams();
    if (this.mode === "tourney") {
      this.bracket = buildBracket([...this.players.keys()]);
      this.bracketNames = Object.fromEntries([...this.players.values()].map((p) => [p.id, { name: p.name, color: p.color }]));
      this.showBracket();
      return;
    }
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
    if (this.mode === "team") {
      for (const team of [0, 1]) {
        const members = list.filter((p) => p.team === team);
        members.forEach((p, i) => Object.assign(p, teamSpawn(team, i, members.length)));
      }
    } else if (fighters) {
      list.forEach((p, i) => Object.assign(p, { p: [0, 0, i === 0 ? -5 : 5], r: i === 0 ? 0 : round2(Math.PI) }));
    } else {
      list.forEach((p, i) => Object.assign(p, spawnPoint(i, list.length)));
    }
    list.forEach((p) => resetForRound(p));
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
      this.setPhase("round");
      this.broadcast({ t: "round", round: this.round });
    });
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
    this.broadcast({
      t: "matchEnd", winner, team, mode: this.mode,
      wins: this.winsTable(), kills: this.killsTable(), teamWins: this.teamWins,
    });
    this.later(MATCH.matchEndDelay, token, () => this.toLobby());
  }

  toLobby() {
    this.setPhase("lobby");
    this.round = 0;
    this.duel = null;
    for (const p of this.players.values()) resetForRound(p);
    this.broadcast({ t: "lobby" });
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
    player.p = [round2(x), round2(y), round2(z)];
    player.r = round2(finite(msg.r));
    player.a = msg.a === 1 || msg.a === 2 ? msg.a : 0;
    this.broadcast({ t: "s", id: player.id, p: player.p, r: player.r, a: player.a }, ws);
  }

  handleCharge(ws, player, msg) {
    if (!this.canFight(player)) return;
    const on = msg.on === 1;
    player.chargeStart = on ? now() : null;
    this.broadcast({ t: "ch", id: player.id, on: on ? 1 : 0 }, ws);
  }

  handleAttack(ws, player, kind, aim) {
    const t = now();
    if (!this.canFight(player) || t < player.staggerUntil) return;

    const spec = specOf(kind);

    if (kind === "h") {
      if (t < player.nextHeavy - TOLERANCE) return;
      if (player.chargeStart === null || t - player.chargeStart < COMBAT.heavy.charge - 0.2) return;
    } else if (t < player.nextQuick - TOLERANCE) {
      return;
    }

    player.chargeStart = null;
    player.nextQuick = t + spec.cooldown;
    player.nextHeavy = t + (kind === "h" ? COMBAT.heavy.cooldown : COMBAT.quick.cooldown);

    // Vad siktade spelaren på? { id: motståndare, seg: kroppsdel }
    const aimInfo = aim && typeof aim.id === "string" && typeof aim.seg === "string" && AIM_JOINT[aim.seg]
      ? { id: aim.id, seg: aim.seg }
      : null;

    this.broadcast({ t: "atk", id: player.id, k: kind }, ws);
    const token = this.phaseToken;
    this.later(spec.windup, token, () => this.resolveAttack(player.id, kind, aimInfo));
  }

  resolveAttack(attackerId, kind, aimInfo) {
    const attacker = this.players.get(attackerId);
    if (!attacker || !this.canFight(attacker)) return;

    const t = now();
    if (t < attacker.staggerUntil) return; // blev själv parerad under tiden

    const spec = specOf(kind);

    // Vilka står inom räckhåll och framför den som slår?
    const targets = this.inCone(attacker, spec.reach, spec.arc);

    // Parering: tryckte någon av måltavlorna parera precis innan, vänd mot den som slår?
    for (const target of targets) {
      const sinceParry = t - target.lastParry;
      if (sinceParry < 0 || sinceParry > COMBAT.parry.window) continue;
      const tx = Math.sin(target.r);
      const tz = Math.cos(target.r);
      const facing = tx * (attacker.p[0] - target.p[0]) + tz * (attacker.p[2] - target.p[2]);
      if (facing <= 0) continue;

      attacker.staggerUntil = t + COMBAT.parry.stagger;
      attacker.chargeStart = null;
      target.nextParry = t;
      this.broadcast({ t: "parried", id: target.id, by: attacker.id });
      return;
    }

    for (const target of targets) {
      target.hp = Math.max(0, target.hp - spec.damage);
      const dead = target.hp === 0;
      const aimSeg = aimInfo && aimInfo.id === target.id ? aimInfo.seg : null;
      const sev = chooseSever(target, kind, dead, aimSeg);
      if (sev) target.severed.push(sev);
      // Tunga slag kan slå av hjälmen (bara utseende). Siktar man på huvudet åker den alltid.
      let hk = 0;
      if (kind === "h" && !target.helmetOff && sev !== "neck" && (aimSeg === "head" || Math.random() < MATCH.helmetKnockChance)) {
        target.helmetOff = true;
        hk = 1;
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

  // Spark: knuffar bort de som står framför, ingen skada
  handleKick(ws, player) {
    const t = now();
    if (!this.canFight(player) || t < player.staggerUntil || t < player.nextKick - TOLERANCE) return;
    player.nextKick = t + COMBAT.kick.cooldown;
    player.chargeStart = null;
    this.broadcast({ t: "kick", id: player.id }, ws);
    this.later(COMBAT.kick.windup, this.phaseToken, () => {
      if (!this.canFight(player) || now() < player.staggerUntil) return;
      for (const target of this.inCone(player, COMBAT.kick.reach, COMBAT.kick.arc)) {
        const dx = target.p[0] - player.p[0];
        const dz = target.p[2] - player.p[2];
        const len = Math.hypot(dx, dz) || 1;
        target.staggerUntil = now() + COMBAT.kick.stagger;
        target.chargeStart = null;
        target.lastParry = -100; // sparken går inte att parera och bryter en parering
        this.broadcast({ t: "kicked", id: target.id, by: player.id, dir: [round2(dx / len), round2(dz / len)] });
      }
    });
  }

  handleParry(ws, player) {
    const t = now();
    if (!this.canFight(player) || t < player.nextParry - TOLERANCE) return;
    player.lastParry = t;
    player.nextParry = t + COMBAT.parry.cooldown;
    this.broadcast({ t: "par", id: player.id }, ws);
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
    this.players.delete(info.id);
    this.broadcast({ t: "leave", id: info.id }, ws);

    // Ny lobbyledare om ledaren gick
    if (this.hostId === info.id) {
      const next = this.players.keys().next();
      this.hostId = next.done ? null : next.value;
      if (this.hostId) this.broadcast({ t: "host", id: this.hostId });
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

