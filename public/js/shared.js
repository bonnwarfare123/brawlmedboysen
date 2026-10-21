// Delade regler som både spelet (webbläsaren) och servern använder.
// Ändrar du något här gäller det på båda ställena.

export const VERSION = "0.1.1";

// Max antal spelare i ett rum
export const MAX_PLAYERS = 6;

// Färger spelarna kan välja (index skickas över nätet, inte själva färgen)
export const COLORS = [
  { name: "Blå", hex: 0x2f5fb3 },
  { name: "Röd", hex: 0xb8322f },
  { name: "Gul", hex: 0xd9a521 },
  { name: "Grön", hex: 0x3f8a3a },
  { name: "Lila", hex: 0x7a3fa0 },
  { name: "Orange", hex: 0xd96a1e },
  { name: "Svart", hex: 0x2a2a2e },
  { name: "Vit", hex: 0xe8e4da },
];

// Arenans spelbara yta är en oval (ellips) med dessa radier i meter
export const ARENA_RX = 13;
export const ARENA_RZ = 10;

// Rumskoder: 4–8 tecken, bara A–Z och 0–9
export const ROOM_CODE_RE = /^[A-Z0-9]{4,8}$/;

export const NAME_MAX = 20;
