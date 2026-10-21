// Delade regler som både spelet (webbläsaren) och servern använder.
// Ändrar du något här gäller det på båda ställena.

export const VERSION = "0.6";

// STRIDSREGLER – servern använder dessa för att avgöra träffar.
// Tider i sekunder, avstånd i meter, vinklar i grader (åt varje håll).
export const COMBAT = {
  maxHp: 100,
  quick: { damage: 25, windup: 0.3, cooldown: 0.6, reach: 2.1, arc: 60 },
  heavy: { damage: 50, charge: 0.8, windup: 0.3, cooldown: 1.5, reach: 2.4, arc: 50 },
  parry: { window: 0.35, cooldown: 1.0, stagger: 0.9 },
  respawnSeconds: 4,

  // SIKTADE TRÄFFAR: varje arm- och bendel tål så här mycket skada innan den åker av.
  // (Snabbt slag = 25, tungt = 50. Hand 40 = två snabba eller ett tungt.)
  // Ett dödande slag hugger alltid av den kroppsdel man siktar på.
  limbHp: { hand: 40, forearm: 50, upperArm: 75, foot: 40, shin: 50, thigh: 75 },

  // OSIKTADE TRÄFFAR (siktet på bålen eller bredvid): liten chans (0–1) att något slumpmässigt åker
  randomSever: {
    quick: 0.05,       // snabbt slag som inte dödar
    heavy: 0.25,       // tungt slag som inte dödar
    quickKill: 0.4,    // snabbt slag som dödar
    heavyKill: 1.0,    // tungt slag som dödar
  },
  legLossSpeed: [1, 0.65, 0.4], // fart med 0, 1 eller 2 skadade ben
};

// MATCHREGLER
export const MATCH = {
  roundsToWin: 5,      // först till så många rundvinster vinner matchen
  minPlayers: 2,       // minst så många för att kunna starta
  countdown: 3,        // sekunder innan rundan börjar
  roundEndDelay: 4,    // sekunder mellan rundor
  matchEndDelay: 8,    // sekunder resultattavlan visas innan alla går tillbaka till lobbyn
};

// Vilken led huggs av om man siktar på en viss kroppsdel?
export const AIM_JOINT = {
  upperArmL: "shoulderL", forearmL: "elbowL", handL: "wristL",
  upperArmR: "shoulderR", forearmR: "elbowR", handR: "wristR",
  thighL: "hipL", shinL: "kneeL", footL: "ankleL",
  thighR: "hipR", shinR: "kneeR", footR: "ankleR",
  head: "neck",
  torso: "waist", pelvis: "waist", // bara vid dödande slag: kluven på mitten
};

// Lederna som kan huggas av, och vilken kroppsdel som lossnar
export const JOINT_SEGMENT = {
  wristL: "handL", elbowL: "forearmL", shoulderL: "upperArmL",
  wristR: "handR", elbowR: "forearmR", shoulderR: "upperArmR",
  ankleL: "footL", kneeL: "shinL", hipL: "thighL",
  ankleR: "footR", kneeR: "shinR", hipR: "thighR",
  neck: "head", waist: "torso",
};

// Vilken led sitter innanför? (är den avhuggen finns inte leden längre ut kvar)
export const JOINT_PARENT = {
  wristL: "elbowL", elbowL: "shoulderL", shoulderL: "waist",
  wristR: "elbowR", elbowR: "shoulderR", shoulderR: "waist",
  ankleL: "kneeL", kneeL: "hipL", hipL: null,
  ankleR: "kneeR", kneeR: "hipR", hipR: null,
  neck: "waist", waist: null,
};

export const LIMB_JOINTS = [
  "wristL", "elbowL", "shoulderL", "wristR", "elbowR", "shoulderR",
  "ankleL", "kneeL", "hipL", "ankleR", "kneeR", "hipR",
];
export const LEG_JOINTS = ["ankleL", "kneeL", "hipL", "ankleR", "kneeR", "hipR"];
export const KILL_ONLY_JOINTS = ["neck", "waist"]; // kan bara huggas av med ett dödande slag

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
