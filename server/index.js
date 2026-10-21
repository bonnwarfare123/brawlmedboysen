// SERVERN – körs hos Cloudflare.
//
// Två delar:
// 1. "Workern" tar emot anslutningar och skickar dem till rätt spelrum.
//    (Spelets vanliga filer, som index.html, skickas automatiskt av Cloudflare
//    från mappen "public" utan att passera här.)
// 2. "GameRoom" är ett Durable Object: en liten server per spelrum. Den håller
//    koll på spelarna, skickar vidare allas positioner och AVGÖR ALLA TRÄFFAR,
//    så att alla ser samma sak och ingen kan fuska.

import { DurableObject } from "cloudflare:workers";
import {
  MAX_PLAYERS, COLORS, NAME_MAX, ROOM_CODE_RE, COMBAT, ARENA_RX, ARENA_RZ,
  JOINT_PARENT, LIMB_JOINTS, KILL_ONLY_JOINTS,
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

function spawnPoint(index = null) {
  const angle = index === null ? Math.random() * Math.PI * 2 : (index / MAX_PLAYERS) * Math.PI * 2;
  const p = [round2(Math.sin(angle) * 6), 0, round2(Math.cos(angle) * 6)];
  const r = round2(angle + Math.PI); // titta mot mitten
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
    nextQuick: 0,
    nextHeavy: 0,
    nextParry: 0,
    lastParry: -100,
    staggerUntil: 0,
    chargeStart: null,
    ignoreStateUntil: 0,
    severed: [], // avhuggna leder sedan senaste återuppståndelse
  };
}

// Finns leden kvar? (varken den eller någon led innanför är avhuggen)
function jointAvailable(player, joint) {
  for (let j = joint; j; j = JOINT_PARENT[j]) {
    if (player.severed.includes(j)) return false;
  }
  return true;
}

// Slumpa om och i så fall vilken led som huggs av vid en träff
function chooseSever(player, kind, dead, random = Math.random) {
  const key = (kind === "h" ? "heavy" : "quick") + (dead ? "Kill" : "");
  if (random() >= COMBAT.sever[key]) return null;
  const candidates = LIMB_JOINTS.filter((j) => jointAvailable(player, j));
  if (dead) {
    // Huvud och midja är extra roliga vid dråp: dubbel chans
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
    hp: pl.hp, dead: pl.dead, kills: pl.kills, severed: pl.severed,
  };
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map();

    // Om rummet "sov" (hibernation) och vaknar igen: återskapa spelarlistan
    // från informationen som sparats på varje anslutning.
    for (const ws of this.ctx.getWebSockets()) {
      const info = ws.deserializeAttachment();
      if (info && info.id) this.players.set(info.id, newPlayerState(info));
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
      case "s":
        this.handleState(ws, player, msg);
        break;
      case "ch":
        this.handleCharge(ws, player, msg);
        break;
      case "atk":
        this.handleAttack(ws, player, msg.k === "h" ? "h" : "q");
        break;
      case "par":
        this.handleParry(ws, player);
        break;
    }
  }

  // --- En spelare vill gå med ---
  handleJoin(ws, info, msg) {
    if (info) return; // redan med

    if (this.players.size >= MAX_PLAYERS) {
      this.send(ws, { t: "full" });
      ws.close(4001, "Rummet är fullt");
      return;
    }

    const color = Number.isInteger(msg.color) && msg.color >= 0 && msg.color < COLORS.length ? msg.color : 0;
    const playerInfo = { id: randomId(), name: cleanName(msg.name), color };
    ws.serializeAttachment(playerInfo);

    const player = newPlayerState(playerInfo);
    Object.assign(player, spawnPoint(this.players.size));
    this.players.set(player.id, player);

    this.send(ws, {
      t: "welcome",
      id: player.id,
      you: publicPlayer(player),
      players: [...this.players.values()].filter((pl) => pl.id !== player.id).map(publicPlayer),
    });
    this.broadcast({ t: "join", player: publicPlayer(player) }, ws);
  }

  // --- Positionsuppdatering: spara och skicka vidare till de andra ---
  handleState(ws, player, msg) {
    if (!Array.isArray(msg.p) || msg.p.length !== 3) return;
    if (player.dead || now() < player.ignoreStateUntil) return; // liket ligger kvar där det föll

    // Håll positionen inom arenan (skydd mot konstiga värden)
    const x = Math.max(-ARENA_RX, Math.min(ARENA_RX, finite(msg.p[0])));
    const y = Math.max(0, Math.min(5, finite(msg.p[1])));
    const z = Math.max(-ARENA_RZ, Math.min(ARENA_RZ, finite(msg.p[2])));
    player.p = [round2(x), round2(y), round2(z)];
    player.r = round2(finite(msg.r));
    player.a = msg.a === 1 || msg.a === 2 ? msg.a : 0;
    this.broadcast({ t: "s", id: player.id, p: player.p, r: player.r, a: player.a }, ws);
  }

  // --- Spelaren börjar/slutar ladda ett tungt slag (syns för de andra) ---
  handleCharge(ws, player, msg) {
    if (player.dead) return;
    const on = msg.on === 1;
    player.chargeStart = on ? now() : null;
    this.broadcast({ t: "ch", id: player.id, on: on ? 1 : 0 }, ws);
  }

  // --- Ett slag ---
  handleAttack(ws, player, kind) {
    const t = now();
    if (player.dead || t < player.staggerUntil) return;

    const spec = kind === "h" ? COMBAT.heavy : COMBAT.quick;

    if (kind === "h") {
      if (t < player.nextHeavy - TOLERANCE) return;
      // Det tunga slaget måste ha laddats tillräckligt länge
      if (player.chargeStart === null || t - player.chargeStart < COMBAT.heavy.charge - 0.2) return;
    } else if (t < player.nextQuick - TOLERANCE) {
      return;
    }

    player.chargeStart = null;
    player.nextQuick = t + COMBAT.quick.cooldown;
    player.nextHeavy = t + (kind === "h" ? COMBAT.heavy.cooldown : COMBAT.quick.cooldown);

    this.broadcast({ t: "atk", id: player.id, k: kind }, ws);

    // Träffen avgörs när svärdet faktiskt når fram (efter "windup")
    setTimeout(() => this.resolveAttack(player.id, kind), spec.windup * 1000);
  }

  resolveAttack(attackerId, kind) {
    const attacker = this.players.get(attackerId);
    if (!attacker || attacker.dead) return;

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
      if (facing <= 0) continue; // stod med ryggen till

      attacker.staggerUntil = t + COMBAT.parry.stagger;
      attacker.chargeStart = null;
      target.nextParry = t; // belöning: kan parera igen direkt
      this.broadcast({ t: "parried", id: target.id, by: attacker.id });
      return; // slaget stoppas helt
    }

    // Skada alla som träffades (ett slag kan träffa flera i en brawl)
    for (const target of targets) {
      target.hp = Math.max(0, target.hp - spec.damage);
      const dead = target.hp === 0;
      const sev = chooseSever(target, kind, dead);
      if (sev) target.severed.push(sev);
      if (dead) {
        target.dead = true;
        target.chargeStart = null;
        attacker.kills += 1;
        setTimeout(() => this.respawn(target.id), COMBAT.respawnSeconds * 1000);
      }
      this.broadcast({
        t: "hit",
        id: target.id,
        by: attacker.id,
        k: kind,
        hp: target.hp,
        dead,
        kills: attacker.kills,
        sev, // led som höggs av, eller null
      });
    }
  }

  // --- Parera ---
  handleParry(ws, player) {
    const t = now();
    if (player.dead || t < player.nextParry - TOLERANCE) return;
    player.lastParry = t;
    player.nextParry = t + COMBAT.parry.cooldown;
    this.broadcast({ t: "par", id: player.id }, ws);
  }

  respawn(id) {
    const player = this.players.get(id);
    if (!player) return; // har lämnat spelet
    player.hp = COMBAT.maxHp;
    player.dead = false;
    player.staggerUntil = 0;
    player.severed = [];
    player.ignoreStateUntil = now() + 0.5; // ignorera gamla positioner som är på väg
    Object.assign(player, spawnPoint());
    this.broadcast({ t: "respawn", id, p: player.p, r: player.r, hp: player.hp });
  }

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
  }
}
