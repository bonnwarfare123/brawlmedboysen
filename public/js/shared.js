// Delade regler som både spelet (webbläsaren) och servern använder.
// Ändrar du något här gäller det på båda ställena.

export const VERSION = "0.10";

// STRIDSREGLER – servern använder dessa för att avgöra träffar.
// Tider i sekunder, avstånd i meter, vinklar i grader (åt varje håll).
export const COMBAT = {
  maxHp: 100,
  quick: { damage: 25, windup: 0.3, cooldown: 0.6, reach: 2.1, arc: 60 },
  heavy: { damage: 50, charge: 0.8, windup: 0.3, cooldown: 1.5, reach: 2.4, arc: 50 },
  thrust: { damage: 20, windup: 0.26, cooldown: 1.5, reach: 2.8, arc: 22 }, // stöt: lång men smal, egen längre väntetid
  // Spark: ingen skada, men knuffar bort och får motståndaren att vingla (bryter laddning och parering)
  kick: { windup: 0.18, cooldown: 1.5, reach: 1.7, arc: 55, push: 7, stagger: 0.6 },
  emoteCooldown: 1.5,
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

// UTSEENDE – bara kosmetiskt, alla är lika starka
export const ARMORS = ["Plåtrustning", "Ringbrynja", "Läderrustning", "Praktrustning", "Bonde"];
export const HELMETS = ["Tunnhjälm", "Visirhjälm", "Järnhatt", "Hornhjälm", "Plymhjälm", "Kastrull", "Halmhatt"];
export const SHIELDS = ["Rund", "Droppformad", "Riddarsköld", "Bucklare", "Pavis"];
export const WEAPONS = ["Svärd", "Yxa", "Slagkedja", "Tvåhandssvärd", "Stridsyxa", "Hillebard", "Zweihänder"];

// VAPNENS EGENSKAPER (gånger grundvärdena i COMBAT ovan; 1 = som svärdet)
//   damage = skada, speed = hur lång tid slaget tar (större = långsammare), recover = väntetid efter slaget,
//   reach = extra räckvidd i meter, arc = hur brett slaget tar (mindre = smalare), sever = hur lätt lemmar åker av,
//   thrust = stötens skada, twoHanded = ingen sköld (parerar med vapnet, kortare fönster)
export const WEAPON_SPECS = [
  { key: "sword", damage: 1, speed: 1, recover: 1, reach: 0, arc: 1, sever: 1, thrust: 1.15 },
  { key: "axe", damage: 1.15, speed: 1.1, recover: 1.1, reach: 0, arc: 1, sever: 1.4, thrust: 0.7 },
  { key: "flail", damage: 1.05, speed: 1.05, recover: 1.2, reach: 0.1, arc: 1.1, sever: 1.1, thrust: 0.6, parryBypass: 0.4 },
  { key: "twohander", damage: 1.35, speed: 1.25, recover: 1.3, reach: 0.6, arc: 0.95, sever: 1.25, thrust: 1.2, twoHanded: true },
  { key: "daneaxe", damage: 1.55, speed: 1.4, recover: 1.45, reach: 0.4, arc: 1, sever: 1.8, thrust: 0.8, twoHanded: true },
  { key: "halberd", damage: 1.2, speed: 1.3, recover: 1.35, reach: 1.0, arc: 0.8, sever: 1.3, thrust: 1.5, thrustReach: 1.2, minRange: 1.0, twoHanded: true },
  { key: "zweihander", damage: 1.9, speed: 1.6, recover: 1.8, reach: 1.1, arc: 0.7, sever: 2.2, thrust: 1.3, twoHanded: true, whiffStagger: 0.9 },
];

export function weaponSpec(w) {
  return WEAPON_SPECS[w] || WEAPON_SPECS[0];
}

// Ett slags egenskaper med ett visst vapen. kind: "q" snabbt, "h" tungt, "t" stöt
export function attackSpec(kind, w) {
  const base = kind === "h" ? COMBAT.heavy : kind === "t" ? COMBAT.thrust : COMBAT.quick;
  const ws = weaponSpec(w);
  return {
    damage: Math.round(base.damage * ws.damage * (kind === "t" ? ws.thrust : 1)),
    windup: base.windup * ws.speed,
    cooldown: base.cooldown * ws.recover,
    charge: kind === "h" ? COMBAT.heavy.charge * ws.speed : 0,
    reach: base.reach + (kind === "t" ? ws.thrustReach ?? ws.reach : ws.reach),
    arc: base.arc * ws.arc,
  };
}

// Väntetider efter ett slag: när kan man slå snabbt, tungt eller stöta igen? (sekunder från nu)
export function cooldownsAfter(kind, w) {
  const ws = weaponSpec(w);
  const quick = COMBAT.quick.cooldown * ws.recover;
  if (kind === "h") return { quick, heavy: COMBAT.heavy.cooldown * ws.recover, thrust: Math.max(quick, 0.9 * ws.recover) };
  if (kind === "t") return { quick, heavy: quick, thrust: COMBAT.thrust.cooldown * ws.recover };
  return { quick, heavy: quick, thrust: quick };
}
export const CAPES = ["Nej", "Ja"];

// SPELSÄTT
export const MODES = ["ffa", "team", "tourney"];
export const MODE_NAMES = { ffa: "Alla mot alla", team: "Lag", tourney: "Turnering 1 mot 1" };
export const TEAMS = [
  { name: "Röda laget", color: 1 }, // färgindex i COLORS
  { name: "Blå laget", color: 0 },
];

// MATCHREGLER
export const MATCH = {
  roundsToWin: 5,      // först till så många rundvinster vinner matchen
  minPlayers: 2,       // minst så många för att kunna starta
  countdown: 3,        // sekunder innan rundan börjar
  roundEndDelay: 4,    // sekunder mellan rundor
  matchEndDelay: 13,   // sekunder för prisceremonin innan alla går tillbaka till lobbyn
  duelRoundsToWin: 2,  // turnering: bäst av 3 rundor per duell
  bracketDelay: 6,     // sekunder turneringsträdet visas mellan duellerna
  helmetKnockChance: 0.15, // chans att hjälmen flyger av vid tunga slag som inte siktar på huvudet
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
