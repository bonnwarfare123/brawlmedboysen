// Delade regler som både spelet (webbläsaren) och servern använder.
// Ändrar du något här gäller det på båda ställena.

export const VERSION = "0.17";

// STRIDSREGLER – servern använder dessa för att avgöra träffar.
// Tider i sekunder, avstånd i meter, vinklar i grader (åt varje håll).
export const COMBAT = {
  maxHp: 100,
  quick: { damage: 25, windup: 0.3, cooldown: 0.6, reach: 2.1, arc: 60 },
  heavy: { damage: 50, charge: 0.8, windup: 0.3, cooldown: 1.5, reach: 2.4, arc: 50 },
  thrust: { damage: 20, windup: 0.26, cooldown: 1.5, reach: 2.8, arc: 22 }, // stöt: lång men smal, egen längre väntetid
  // Spark: ingen skada, men knuffar bort och får motståndaren att vingla (bryter laddning och parering).
  // knockdown = chans att den sparkade ramlar omkull (alltid om den laddar ett tungt slag eller sparkas bakifrån)
  kick: { windup: 0.18, cooldown: 1.5, reach: 1.8, arc: 55, push: 9, stagger: 0.8, knockdown: 0.35 },
  // Omkullslagen: ligger på marken så här länge och tar extra skada under tiden
  down: { time: 1.1, damage: 1.3 },
  // Rullning (C + Mellanslag): går inte att träffa mellan iStart och iEnd sekunder in i rullningen
  roll: { time: 0.55, iStart: 0.08, iEnd: 0.4, cooldown: 1.6, distance: 3.4 },
  // Hukad (håll C): långsammare, huvudet svårt att träffa (räknas som bålen), egna slag går mot benen
  crouch: { speed: 0.5 },
  // Utan ben sitter man på marken och blöder så här mycket liv per sekund
  leglessBleed: 3,
  // Kasta vapnet (G): flyger rakt fram, skadan = snabbt slag x vapnets skada x damage
  throw: { speed: 17, range: 13, radius: 0.55, damage: 0.9, stagger: 0.5, windup: 0.22 },
  // Ta tag i någon (R): reach/arc = hur nära och rakt framför, hold = längsta greppet,
  // escape = antal knapptryck för att slita sig loss, shove = knuffen, punch = slag medan man håller fast
  grab: { reach: 1.5, arc: 50, cooldown: 2.5, hold: 2.8, escape: 7, shove: 13, punch: 10, punchCooldown: 0.55, moveFactor: 0.45 },
  emoteCooldown: 1.5,
  // window = hur länge en parering skyddar, lag = extra tid för fördröjningen på nätet
  parry: { window: 0.45, lag: 0.08, cooldown: 0.8, stagger: 0.9 },
  respawnSeconds: 4,

  // SIKTADE TRÄFFAR: varje arm- och bendel tål så här mycket skada innan den åker av.
  // (Snabbt slag = 25, tungt = 50. Hand 40 = två snabba eller ett tungt.)
  // Ett dödande slag hugger alltid av den kroppsdel man siktar på.
  limbHp: { hand: 31, forearm: 38, upperArm: 58, foot: 31, shin: 38, thigh: 58 },

  // OSIKTADE TRÄFFAR (siktet på bålen eller bredvid): liten chans (0–1) att något slumpmässigt åker
  randomSever: {
    quick: 0.065,      // snabbt slag som inte dödar
    heavy: 0.33,       // tungt slag som inte dödar
    quickKill: 0.52,   // snabbt slag som dödar
    heavyKill: 1.0,    // tungt slag som dödar
  },
  legLossSpeed: [1, 0.65, 0.4], // fart med 0, 1 eller 2 skadade ben
};

// UTSEENDE – bara kosmetiskt, alla är lika starka
export const ARMORS = ["Plåtrustning", "Ringbrynja", "Läderrustning", "Praktrustning", "Bonde", "Gycklare", "Vandrande riddare"];
export const HELMETS = ["Tunnhjälm", "Visirhjälm", "Järnhatt", "Hornhjälm", "Plymhjälm", "Kastrull", "Halmhatt"];
export const SHIELDS = ["Rund", "Droppformad", "Riddarsköld", "Bucklare", "Pavis"];
export const WEAPONS = [
  "Svärd", "Yxa", "Slagkedja", "Tvåhandssvärd", "Stridsyxa", "Hillebard", "Zweihänder", "Spjut", "Stridshammare", "Slägga", "Dolk",
];

// VAPNENS EGENSKAPER (gånger grundvärdena i COMBAT ovan; 1 = som svärdet)
//   damage = skada, speed = hur lång tid slaget tar (större = långsammare), recover = väntetid efter slaget,
//   reach = extra räckvidd i meter, arc = hur brett slaget tar (mindre = smalare), sever = hur lätt lemmar åker av,
//   thrust = stötens skada, twoHanded = ingen sköld (parerar med vapnet, kortare fönster)
//   thrustCd = stötens väntetid, helmetKnock = chans att slå av hjälmen, hitStagger = motståndaren vinglar (sekunder),
//   knockdown = tunga slag fäller motståndaren, blunt = trubbigt (hugger aldrig av något, krossar)
export const WEAPON_SPECS = [
  { key: "sword", damage: 1, speed: 1, recover: 1, reach: 0, arc: 1, sever: 1, thrust: 1.15 },
  { key: "axe", damage: 1.15, speed: 1.1, recover: 1.1, reach: 0, arc: 1, sever: 1.4, thrust: 0.7 },
  { key: "flail", damage: 1.05, speed: 1.05, recover: 1.2, reach: 0.1, arc: 1.1, sever: 1.1, thrust: 0.6, parryBypass: 0.4 },
  { key: "twohander", damage: 1.35, speed: 1.25, recover: 1.3, reach: 0.6, arc: 0.95, sever: 1.25, thrust: 1.2, twoHanded: true },
  { key: "daneaxe", damage: 1.55, speed: 1.4, recover: 1.45, reach: 0.4, arc: 1, sever: 1.8, thrust: 0.8, twoHanded: true },
  { key: "halberd", damage: 1.2, speed: 1.3, recover: 1.35, reach: 1.0, arc: 0.8, sever: 1.3, thrust: 1.5, thrustReach: 1.2, minRange: 1.0, twoHanded: true },
  { key: "zweihander", damage: 1.9, speed: 1.6, recover: 1.8, reach: 1.1, arc: 0.7, sever: 2.2, thrust: 1.3, twoHanded: true, whiffStagger: 0.9 },
  { key: "spear", damage: 0.85, speed: 0.95, recover: 0.95, reach: 0.7, arc: 0.7, sever: 0.6, thrust: 1.45, thrustReach: 1.3, thrustCd: 0.84, twoHanded: true },
  { key: "warhammer", damage: 0.95, speed: 1.05, recover: 1.05, reach: 0, arc: 0.9, sever: 0, thrust: 0.6, helmetKnock: 0.6, hitStagger: 0.35, blunt: true },
  { key: "maul", damage: 1.6, speed: 1.55, recover: 1.7, reach: 0.5, arc: 0.9, sever: 0, thrust: 0.6, twoHanded: true, helmetKnock: 0.4, hitStagger: 0.5, knockdown: true, blunt: true },
  { key: "dagger", damage: 0.6, speed: 0.7, recover: 0.65, reach: -0.5, arc: 1, sever: 0.5, thrust: 1.67, grabReach: 2.2, grabPunch: 16, grabCd: 1.8 },
];

// Utan vapen (vapenarmen avhuggen eller vapnet tappat): knytnävar
export const FISTS = -1;
export const FIST_SPEC = { key: "fists", damage: 0.3, speed: 0.8, recover: 0.8, reach: -0.7, arc: 1, sever: 0, thrust: 0.5, blunt: true };

export function weaponSpec(w) {
  if (w === FISTS) return FIST_SPEC;
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
  if (kind === "t") return { quick, heavy: quick, thrust: COMBAT.thrust.cooldown * ws.recover * (ws.thrustCd ?? 1) };
  return { quick, heavy: quick, thrust: quick };
}
export const CAPES = ["Nej", "Ja"];

// Tid på dygnet (lobbyledaren väljer)
export const TIMES = ["day", "evening"];
export const TIME_NAMES = { day: "Dag", evening: "Kväll" };

// Väder (lobbyledaren väljer)
export const WEATHERS = ["sun", "rain", "fog"];

// Banor (lobbyledaren väljer). Borggården har ett intro när matchen börjar.
export const MAPS = ["arena", "castle"];
export const MAP_NAMES = { arena: "Tornerplatsen", castle: "Borggården" };
export const INTRO_SECONDS = 10;

// Utmärkelser efter matchen: vem hade mest av vad?
export const AWARDS = [
  { key: "sev", title: "Slaktaren", text: "flest avhuggna lemmar" },
  { key: "dmg", title: "Krossaren", text: "mest skada" },
  { key: "parry", title: "Muren", text: "flest pareringar" },
  { key: "fell", title: "Klumpigast", text: "föll omkull flest gånger" },
  { key: "throwHit", title: "Kastaren", text: "flest träffande kast" },
  { key: "grabs", title: "Brottaren", text: "flest grepp" },
];

// Träningsmotståndare som servern styr
export const MAX_BOTS = 3;
export const BOT_NAMES = ["Sir Plåtburk", "Sir Halmdocka", "Sir Rostig", "Sir Vinglig", "Sir Bengt"];

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
  matchEndDelay: 16,   // sekunder för reprisen och prisceremonin innan alla går tillbaka till lobbyn
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
