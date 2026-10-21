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

import { DurableObject } from "cloudflare:workers";
import {
  MAX_PLAYERS, COLORS, NAME_MAX, ROOM_CODE_RE, COMBAT, MATCH, ARENA_RX, ARENA_RZ,
  JOINT_PARENT, LIMB_JOINTS, KILL_ONLY_JOINTS, AIM_JOINT,
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

function newPlayerState(info) {
  return {
    ...info,
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
    lastParry: -100,
    staggerUntil: 0,
    chargeStart: null,
    severed: [],     // avhuggna leder den här rundan
    limbDamage: {},  // samlad skada per kroppsdel den här rundan
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
  player.lastParry = -100;
  player.staggerUntil = 0;
  player.chargeStart = null;
  player.a = 0;
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
  const damage = kind === "h" ? COMBAT.heavy.damage : COMBAT.quick.damage;

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
  const key = (kind === "h" ? "heavy" : "quick") + (dead ? "Kill" : "");
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

// Det som skickas till spelarna om en riddare (inte interna timers)
function publicPlayer(pl) {
  return {
    id: pl.id, name: pl.name, color: pl.color, p: pl.p, r: pl.r, a: pl.a,
    hp: pl.hp, dead: pl.dead, kills: pl.kills, wins: pl.wins, severed: pl.severed,
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
        this.handleAttack(ws, player, msg.k === "h" ? "h" : "q", msg.aim);
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

    const playerInfo = { id: randomId(), name: cleanName(msg.name), color };
    ws.serializeAttachment(playerInfo);

    const player = newPlayerState(playerInfo);
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
    });
    this.broadcast({ t: "join", player: publicPlayer(player) }, ws);
  }

  handleColor(ws, player, color) {
    if (this.phase !== "lobby") return;
    if (!Number.isInteger(color) || color < 0 || color >= COLORS.length) return;
    if ([...this.players.values()].some((p) => p !== player && p.color === color)) return; // upptagen
    player.color = color;
    ws.serializeAttachment({ id: player.id, name: player.name, color });
    this.broadcast({ t: "color", id: player.id, color });
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

  startCountdown() {
    this.round += 1;
    const token = this.setPhase("countdown");
    const list = [...this.players.values()];
    list.forEach((p, i) => {
      resetForRound(p);
      Object.assign(p, spawnPoint(i, list.length));
    });
    this.broadcast({
      t: "countdown",
      round: this.round,
      seconds: MATCH.countdown,
      players: list.map((p) => ({ id: p.id, p: p.p, r: p.r })),
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
    if (alive.length > 1) return;

    const winner = alive[0] || null;
    if (winner) winner.wins += 1;
    const token = this.setPhase("roundEnd");
    this.broadcast({ t: "roundEnd", winner: winner ? winner.id : null, wins: this.winsTable() });

    this.later(MATCH.roundEndDelay, token, () => {
      if (winner && winner.wins >= MATCH.roundsToWin && this.players.has(winner.id)) {
        this.matchEnd(winner);
      } else if (this.players.size >= MATCH.minPlayers) {
        this.startCountdown();
      } else {
        this.toLobby();
      }
    });
  }

  matchEnd(winner) {
    const token = this.setPhase("matchEnd");
    this.broadcast({ t: "matchEnd", winner: winner.id, wins: this.winsTable(), kills: this.killsTable() });
    this.later(MATCH.matchEndDelay, token, () => this.toLobby());
  }

  toLobby() {
    this.setPhase("lobby");
    this.round = 0;
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

    const spec = kind === "h" ? COMBAT.heavy : COMBAT.quick;

    if (kind === "h") {
      if (t < player.nextHeavy - TOLERANCE) return;
      if (player.chargeStart === null || t - player.chargeStart < COMBAT.heavy.charge - 0.2) return;
    } else if (t < player.nextQuick - TOLERANCE) {
      return;
    }

    player.chargeStart = null;
    player.nextQuick = t + COMBAT.quick.cooldown;
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

    const spec = kind === "h" ? COMBAT.heavy : COMBAT.quick;
    const fx = Math.sin(attacker.r);
    const fz = Math.cos(attacker.r);
    const minDot = Math.cos((spec.arc * Math.PI) / 180);

    // Vilka står inom räckhåll och framför den som slår?
    const targets = [];
    for (const target of this.players.values()) {
      if (target === attacker || target.dead) continue;
      const dx = target.p[0] - attacker.p[0];
      const dz = target.p[2] - attacker.p[2];
      const dy = Math.abs(target.p[1] - attacker.p[1]);
      const dist = Math.hypot(dx, dz);
      if (dist > spec.reach + BODY_RADIUS || dy > 1.6) continue;
      if (dist > 0.5 && (fx * dx + fz * dz) / dist < minDot) continue;
      targets.push(target);
    }

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
      });
    }
    this.checkRoundEnd();
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
    if (this.phase === "matchEnd" || this.phase === "roundEnd") return;
    if (this.phase !== "lobby" && this.players.size < MATCH.minPlayers) {
      // Inte nog med spelare kvar: tillbaka till lobbyn (den som är kvar vinner inget)
      this.toLobby();
      return;
    }
    this.checkRoundEnd();
  }
}
