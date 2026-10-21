// SERVERN – körs hos Cloudflare.
//
// Två delar:
// 1. "Workern" tar emot anslutningar och skickar dem till rätt spelrum.
//    (Spelets vanliga filer, som index.html, skickas automatiskt av Cloudflare
//    från mappen "public" utan att passera här.)
// 2. "GameRoom" är ett Durable Object: en liten server per spelrum som håller
//    koll på vilka som är med och skickar vidare allas positioner.

import { DurableObject } from "cloudflare:workers";
import { MAX_PLAYERS, COLORS, NAME_MAX, ROOM_CODE_RE } from "../public/js/shared.js";

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

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // id -> { id, name, color, p:[x,y,z], r, a }
    this.players = new Map();

    // Om rummet "sov" (hibernation) och vaknar igen: återskapa spelarlistan
    // från informationen som sparats på varje anslutning.
    for (const ws of this.ctx.getWebSockets()) {
      const info = ws.deserializeAttachment();
      if (info && info.id) {
        this.players.set(info.id, { ...info, p: [0, 0, 0], r: 0, a: 0 });
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

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > 1000) return;

    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    const info = ws.deserializeAttachment();

    // --- En spelare vill gå med ---
    if (msg.t === "join") {
      if (info) return; // redan med

      if (this.players.size >= MAX_PLAYERS) {
        this.send(ws, { t: "full" });
        ws.close(4001, "Rummet är fullt");
        return;
      }

      const color = Number.isInteger(msg.color) && msg.color >= 0 && msg.color < COLORS.length ? msg.color : 0;

      // Placera ut spelaren på en cirkel runt mitten
      const slot = this.players.size;
      const angle = (slot / MAX_PLAYERS) * Math.PI * 2;
      const p = [round2(Math.sin(angle) * 6), 0, round2(Math.cos(angle) * 6)];
      const r = round2(angle + Math.PI); // titta mot mitten

      const player = { id: randomId(), name: cleanName(msg.name), color, p, r, a: 0 };
      ws.serializeAttachment({ id: player.id, name: player.name, color: player.color });
      this.players.set(player.id, player);

      this.send(ws, {
        t: "welcome",
        id: player.id,
        you: player,
        players: [...this.players.values()].filter((pl) => pl.id !== player.id),
      });
      this.broadcast({ t: "join", player }, ws);
      return;
    }

    if (!info) return;
    const player = this.players.get(info.id);
    if (!player) return;

    // --- Positionsuppdatering: spara och skicka vidare till de andra ---
    if (msg.t === "s" && Array.isArray(msg.p) && msg.p.length === 3) {
      player.p = [round2(finite(msg.p[0])), round2(finite(msg.p[1])), round2(finite(msg.p[2]))];
      player.r = round2(finite(msg.r));
      player.a = msg.a === 1 || msg.a === 2 ? msg.a : 0;
      this.broadcast({ t: "s", id: player.id, p: player.p, r: player.r, a: player.a }, ws);
    }
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
