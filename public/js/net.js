// NÄTVERK – pratar med spelrummet på servern via en WebSocket
// (en öppen "telefonlinje" mellan webbläsaren och servern).

export class Net {
  constructor(handlers) {
    this.handlers = handlers; // { onWelcome, onJoin, onLeave, onState, onFull, onClose }
    this.ws = null;
    this.joined = false;
  }

  connect(roomCode, name, color) {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${protocol}://${location.host}/ws/${roomCode}`);

    this.ws.addEventListener("open", () => {
      this.send({ t: "join", name, color });
    });

    this.ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (msg.t) {
        case "welcome":
          this.joined = true;
          this.handlers.onWelcome(msg);
          break;
        case "join":
          this.handlers.onJoin(msg.player);
          break;
        case "leave":
          this.handlers.onLeave(msg.id);
          break;
        case "s":
          this.handlers.onState(msg);
          break;
        case "full":
          this.handlers.onFull();
          break;
      }
    });

    this.ws.addEventListener("close", () => {
      this.handlers.onClose(this.joined);
      this.joined = false;
    });
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
