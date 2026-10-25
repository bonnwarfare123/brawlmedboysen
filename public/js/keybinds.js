// TANGENTER – varje handling kan ha upp till två knappar (tangent, musknapp eller mushjulet).
// Sparas i webbläsaren. Koderna är samma som webbläsarens (KeyW, Space, ShiftLeft ...),
// plus Mouse0–Mouse4 för musknapparna och WheelUp/WheelDown för mushjulet.

export const ACTIONS = [
  { id: "attack", name: "Slag (håll = tungt)", keys: ["Mouse0"] },
  { id: "parry", name: "Parera", keys: ["Mouse2"] },
  { id: "thrust", name: "Stöt", keys: ["KeyQ", "Mouse1"] },
  { id: "kick", name: "Spark", keys: ["KeyF"] },
  { id: "throw", name: "Kasta vapnet", keys: ["KeyG"] },
  { id: "grab", name: "Ta tag / slit dig loss", keys: ["KeyR"] },
  { id: "pickup", name: "Ta upp vapen", keys: ["KeyE"] },
  { id: "forward", name: "Gå framåt", keys: ["KeyW", "ArrowUp"] },
  { id: "back", name: "Gå bakåt", keys: ["KeyS", "ArrowDown"] },
  { id: "left", name: "Gå åt vänster", keys: ["KeyA", "ArrowLeft"] },
  { id: "right", name: "Gå åt höger", keys: ["KeyD", "ArrowRight"] },
  { id: "run", name: "Spring", keys: ["ShiftLeft", "ShiftRight"] },
  { id: "jump", name: "Hoppa", keys: ["Space"] },
  { id: "crouch", name: "Huka", keys: ["ControlLeft", "KeyC"] },
  { id: "roll", name: "Rulla (eller Huka + Hoppa)", keys: [] },
  { id: "prevWeapon", name: "Föregående vapen", keys: ["KeyZ", "WheelUp"] },
  { id: "nextWeapon", name: "Nästa vapen", keys: ["KeyX", "WheelDown"] },
  { id: "emote1", name: "Buga", keys: ["Digit1"] },
  { id: "emote2", name: "Peka och skratta", keys: ["Digit2"] },
  { id: "emote3", name: "Dansa", keys: ["Digit3"] },
  { id: "sound", name: "Ljud av/på", keys: ["KeyM"] },
  { id: "music", name: "Musik av/på", keys: ["KeyN"] },
  { id: "quality", name: "Grafikläge", keys: ["F2"] },
  { id: "stats", name: "Visa prestanda (ritanrop, ms)", keys: ["F3"] },
];

// Knappar som webbläsaren inte släpper till spelet
export const FORBIDDEN = new Set(["Escape", "F5", "F11", "F12", "MetaLeft", "MetaRight", "OSLeft", "OSRight", "ContextMenu"]);

const STORE = "tangenter";

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved && typeof saved === "object") return saved;
  } catch {
    // trasig eller blockerad lagring: standardknappar
  }
  return null;
}

export class Keybinds {
  constructor() {
    this.map = {};
    const saved = load();
    for (const a of ACTIONS) {
      const keys = saved && Array.isArray(saved[a.id]) ? saved[a.id].filter((k) => typeof k === "string" && !FORBIDDEN.has(k)).slice(0, 2) : a.keys;
      this.map[a.id] = [...keys];
    }
    this.listeners = [];
    this.rebuild();
  }

  rebuild() {
    this.byCode = new Map();
    for (const [id, keys] of Object.entries(this.map)) {
      for (const k of keys) {
        if (!this.byCode.has(k)) this.byCode.set(k, []);
        this.byCode.get(k).push(id);
      }
    }
  }

  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.map));
    } catch {
      // ignorera
    }
    this.rebuild();
    for (const fn of this.listeners) fn();
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  // Vilka handlingar sitter på den här knappen?
  actionsFor(code) {
    return this.byCode.get(code) || [];
  }

  is(action, code) {
    return this.map[action]?.includes(code) ?? false;
  }

  // Hålls någon av handlingens knappar nere? (pressed = mängd med nedtryckta koder)
  held(action, pressed, allow = () => true) {
    return (this.map[action] || []).some((k) => pressed.has(k) && allow(k));
  }

  keys(action) {
    return this.map[action] || [];
  }

  // Sätt en knapp på en handling (plats 0 eller 1). Används knappen redan av en annan handling
  // byter de plats, så att inget krockar.
  assign(action, slot, code) {
    if (FORBIDDEN.has(code)) return false;
    const mine = this.map[action];
    const old = mine[slot] ?? null;
    for (const [id, keys] of Object.entries(this.map)) {
      const i = keys.indexOf(code);
      if (i < 0 || (id === action && i === slot)) continue;
      if (old && !(id === action)) keys[i] = old;
      else keys.splice(i, 1);
    }
    while (mine.length < slot) mine.push(code);
    mine[slot] = code;
    this.map[action] = [...new Set(mine.filter(Boolean))].slice(0, 2);
    this.save();
    return true;
  }

  clear(action, slot) {
    this.map[action].splice(slot, 1);
    this.save();
  }

  reset() {
    for (const a of ACTIONS) this.map[a.id] = [...a.keys];
    this.save();
  }

  // Alla tangentbordskoder som används (för tangentlåset i helskärm)
  keyboardCodes() {
    return [...this.byCode.keys()].filter((k) => !k.startsWith("Mouse") && !k.startsWith("Wheel"));
  }

  // Kort text för en handling, t.ex. "Q" eller "Ctrl / C"
  label(action, all = false) {
    const keys = this.map[action] || [];
    if (!keys.length) return action === "roll" ? `${this.label("crouch")} + ${this.label("jump")}` : "–";
    return (all ? keys : keys.slice(0, 1)).map(keyName).join(" / ");
  }
}

// Läsbart namn på en knapp
export function keyName(code) {
  if (!code) return "–";
  const special = {
    Mouse0: "Vänster mus", Mouse1: "Mittenknappen", Mouse2: "Höger mus", Mouse3: "Musknapp 4", Mouse4: "Musknapp 5",
    WheelUp: "Hjulet upp", WheelDown: "Hjulet ner",
    Space: "Mellanslag", ShiftLeft: "Shift", ShiftRight: "Höger Shift", ControlLeft: "Ctrl", ControlRight: "Höger Ctrl",
    AltLeft: "Alt", AltRight: "AltGr", Tab: "Tab", CapsLock: "Caps Lock", Enter: "Enter", Backspace: "Backsteg",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Backquote: "§", Minus: "+", Equal: "´", BracketLeft: "Å", BracketRight: "¨", Semicolon: "Ö", Quote: "Ä",
    Backslash: "'", Comma: ",", Period: ".", Slash: "-", IntlBackslash: "<",
  };
  if (special[code]) return special[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  return code;
}
