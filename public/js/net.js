// NÄTVERK – pratar med spelrummet på servern via en WebSocket
// (en öppen "telefonlinje" mellan webbläsaren och servern).
//
// Varje meddelande från servern har en typ (t). Spelet registrerar en funktion
// per typ, t.ex. handlers.hit = (msg) => {...}.

export class Net {
  constructor(handlers) {
    this.handlers = handlers;
    this.ws = null;
    this.joined = false;
  }

  // joinData = { name, color, look } skickas när anslutningen öppnas
  connect(roomCode, joinData) {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${protocol}://${location.host}/ws/${roomCode}`);

    this.ws.addEventListener("open", () => {
      this.send({ t: "join", ...joinData });
    });

    this.ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.t === "welcome") this.joined = true;
      const handler = this.handlers[msg.t];
      if (handler) handler(msg);
    });

    this.ws.addEventListener("close", () => {
      if (this.handlers.close) this.handlers.close(this.joined);
      this.joined = false;
    });
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
