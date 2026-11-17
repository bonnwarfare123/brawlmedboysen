// BENLÖSARE (IK, "inverse kinematics") och fotplacering.
//
// I stället för att svänga benen fram och tillbaka bestämmer vi VAR foten ska stå,
// och räknar sedan ut hur höft och knä måste böjas för att foten ska hamna där.
// Då står fötterna stilla på marken när de nuddar den, och glider inte.
//
// Filen är ren matematik (ingen 3D-motor) så den går att testa fristående.

export const THIGH = 0.42; // lårets längd
export const SHIN = 0.40;  // underbenets längd

// Räkna ut ledvinklar för ett ben.
// target = fotledens position relativt höften, i höftens koordinater (x = vänster, y = upp, z = framåt).
// Returnerar { hipX, hipZ, knee }:
//   hipX = lårets vinkel framåt/bakåt (minus = framåt, så som riddarens leder är byggda)
//   hipZ = lårets vinkel ut åt sidan
//   knee = knäböj (plus = foten bakåt)
// upper/lower = längden på de två delarna (lår och underben som standard; används även för armar)
export function solveLeg(target, upper = THIGH, lower = SHIN) {
  const THIGH = upper;
  const SHIN = lower;
  const [X, Y, Z] = target;
  const maxReach = THIGH + SHIN - 0.0005;
  let D = Math.hypot(X, Y, Z);
  let tx = X;
  let ty = Y;
  let tz = Z;
  if (D > maxReach) {
    // För långt bort: sträck benet så långt det går åt rätt håll
    const s = maxReach / D;
    tx *= s;
    ty *= s;
    tz *= s;
    D = maxReach;
  }
  if (D < Math.abs(THIGH - SHIN) + 0.02) D = Math.abs(THIGH - SHIN) + 0.02;

  // Knät: cosinussatsen
  const cosKnee = (D * D - THIGH * THIGH - SHIN * SHIN) / (2 * THIGH * SHIN);
  const knee = Math.acos(Math.max(-1, Math.min(1, cosKnee)));

  // Benkedjan i lårets egna koordinater (innan låret vrids): (0, a, b)
  const a = -THIGH - SHIN * Math.cos(knee);
  const b = -SHIN * Math.sin(knee);

  // Sidovinkel (Z-rotation görs först): x = -a·sin(hipZ)
  const hipZ = Math.asin(Math.max(-1, Math.min(1, tx / -a)));
  const yRot = a * Math.cos(hipZ);
  const zRot = b;

  // Framåtvinkel (X-rotation): vrider (yRot, zRot) till (ty, tz)
  const hipX = Math.atan2(tz, ty) - Math.atan2(zRot, yRot);
  return { hipX: wrapAngle(hipX), hipZ, knee };
}

// En arm (armbågen böjs framåt, tvärtom mot knät): spegla framåt/bakåt och använd samma lösare.
// target = handledens position i axelns koordinater. Returnerar { upperX, upperZ, elbow }.
export function solveArm(target, upper = 0.29, lower = 0.26) {
  const { hipX, hipZ, knee } = solveLeg([target[0], target[1], -target[2]], upper, lower);
  return { upperX: -hipX, upperZ: hipZ, elbow: -knee };
}

// Kontroll åt andra hållet: var hamnar fotleden med givna vinklar? (används i testerna)
export function legEnd(hipX, hipZ, knee) {
  const a = -THIGH - SHIN * Math.cos(knee);
  const b = -SHIN * Math.sin(knee);
  // Rz(hipZ)
  const x1 = -a * Math.sin(hipZ);
  const y1 = a * Math.cos(hipZ);
  const z1 = b;
  // Rx(hipX)
  return [x1, y1 * Math.cos(hipX) - z1 * Math.sin(hipX), y1 * Math.sin(hipX) + z1 * Math.cos(hipX)];
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Fotplacering: håller reda på var varje fot står i världen.
//
// I rörelse används en gångcykel (fas som räknas fram av sträckan man gått):
// varje fot står still på marken en del av cykeln och svingar fram resten.
// Stilla: fötterna står kvar tills kroppen flyttat eller vridit sig för långt
// från stridsställningen – då tas ett korrigeringssteg (som när man vänder sig).
// ---------------------------------------------------------------------------

// GÅNGEN – justerbara värden. Stegtakten bestäms av farten (som hos en människa: snabbare = fler
// steg, men framför allt LÄNGRE steg). Förr var steget alltid kort, så benen trummade i hög fart.
export const GAIT = {
  cadenceBase: 0.72,     // gångcykler per sekund i mycket låg fart (en cykel = två steg)
  cadencePerSpeed: 0.19, // så mycket ökar takten per meter/sekund
  groundTravel: 0.86,    // så långt (meter) kroppen hinner medan en fot står kvar på marken (benets räckvidd)
  sideTravelCut: 0.44,   // åt sidan når benet mycket kortare: så mycket kortare blir den sträckan
  minStance: 0.24,       // minsta andel av cykeln som foten står på marken (resten är sving och svävfas)
  maxStance: 0.62,       // största andel (långsam gång: alltid en fot i marken)
  runFrom: 2.2,          // under den här farten går man
  runFull: 5,            // vid den här farten springer man för fullt
  sprintFrom: 4.35,      // över den här farten ser det ut som sprint (framåtlutad, pumpande armar)
  sprintFull: 4.9,
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
// 0 = gå, 1 = spring för fullt
export const gaitRun = (speed) => clamp01((speed - GAIT.runFrom) / (GAIT.runFull - GAIT.runFrom));
// 0 = vanlig fart, 1 = sprint
export const gaitSprint = (speed) => clamp01((speed - GAIT.sprintFrom) / (GAIT.sprintFull - GAIT.sprintFrom));

// Steglängd (meter per hel gångcykel) för en viss fart. Kortare steg när man går bakåt eller åt sidan.
// forward/side = fart i riddarens egen riktning.
export function gaitStride(speed, forward, side) {
  const len = Math.hypot(forward, side) || 1;
  const sideness = Math.abs(side) / len;
  const back = Math.max(0, -forward) / len;
  const cadence = GAIT.cadenceBase + GAIT.cadencePerSpeed * speed;
  // Åt sidan kan benen inte kliva lika långt som framåt (höften når inte), så man tar korta, snabba sidsteg
  return Math.max(0.5, (speed / cadence) * (1 - 0.55 * sideness) * (1 - 0.2 * back));
}
// Andel av cykeln som en fot står på marken. Långa steg = kort tid i marken (resten svävar man).
// Åt sidan (sideness 1) hinner kroppen bara flytta sig en kortare bit medan foten står kvar.
export const gaitStance = (stride, sideness = 0) =>
  Math.min(GAIT.maxStance, Math.max(GAIT.minStance, (GAIT.groundTravel - GAIT.sideTravelCut * sideness) / stride));

const MIN_GAP = 0.13; // fötterna får aldrig korsa varandra: minst så här långt isär i sidled

// Stridsställning: vänster fot (sköldsidan) lite fram, höger lite bak
const STANCE = { L: [0.15, 0.08], R: [-0.15, -0.1] }; // [sida, framåt]
const SIDE_OFFSET = { L: 0.11, R: -0.11 };           // fotbredd när man går

export class FootPlanner {
  constructor() {
    this.feet = { L: null, R: null };
    this.lastPos = null;
    this.lastStepped = "R";
    this.vel = [0, 0]; // utjämnad fart, så fötterna inte byter mål hela tiden
  }

  // Idealplats för en fot runt kroppen (världskoordinater [x, z])
  ideal(side, pos, yaw, moving) {
    const [sx, sz] = moving ? [SIDE_OFFSET[side], 0] : STANCE[side];
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // lokal x = vänster, lokal z = framåt. Vänster i världen = (cos, -sin), framåt = (sin, cos)
    return [pos[0] + sx * c + sz * s, pos[2] - sx * s + sz * c];
  }

  reset(pos, yaw) {
    for (const side of ["L", "R"]) {
      const [x, z] = this.ideal(side, pos, yaw, false);
      this.feet[side] = { plant: [x, z], from: [x, z], swing: null, current: [x, 0, z], pitch: 0 };
    }
    this.lastPos = [...pos];
  }

  // pos = kroppens position [x, y, z], yaw = vridning, vel = fart [vx, vz], phase = gångcykelns fas (radianer)
  // Returnerar fötternas positioner i världen: { L: [x, y, z], R: [...] } och anropar onStep(side, [x, z]) vid nedsättning.
  update(dt, pos, yaw, vel, phase, run, onStep, stride = null) {
    if (!this.feet.L || !this.lastPos || Math.hypot(pos[0] - this.lastPos[0], pos[2] - this.lastPos[2]) > 1.5) {
      this.reset(pos, yaw);
      this.vel = [vel[0], vel[1]];
    }
    this.lastPos = [...pos];
    const k = 1 - Math.exp(-dt * 10);
    this.vel = [this.vel[0] + (vel[0] - this.vel[0]) * k, this.vel[1] + (vel[1] - this.vel[1]) * k];
    const v = this.vel;
    const speed = Math.hypot(v[0], v[1]);
    if (stride === null) {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      stride = gaitStride(speed, v[0] * s + v[1] * c, v[0] * c - v[1] * s);
    }

    if (speed > 0.3) this.gait(pos, yaw, v, speed, phase, run, onStep, stride);
    else this.idle(dt, pos, yaw, onStep);

    return { L: this.feet.L.current, R: this.feet.R.current, pitchL: this.feet.L.pitch, pitchR: this.feet.R.pitch };
  }

  // Sidledsposition för en punkt (plus = åt vänster om kroppen)
  lateral(x, z, pos, yaw) {
    return (x - pos[0]) * Math.cos(yaw) - (z - pos[2]) * Math.sin(yaw);
  }

  gait(pos, yaw, vel, speed, phase, run, onStep, stride) {
    // Hur mycket av rörelsen går åt sidan (0 = rakt fram/bak, 1 = rakt åt sidan)?
    const sideness = Math.abs((vel[0] * Math.cos(yaw) - vel[1] * Math.sin(yaw)) / speed);
    const stance = gaitStance(stride, sideness); // andel av cykeln foten står på marken
    const cycleTime = stride / speed;
    const lift = 0.09 + 0.2 * run;
    const dirX = vel[0] / speed;
    const dirZ = vel[1] / speed;

    // Åt sidan: "sidogalopp". Ledande foten kliver långt ut, den andra stänger snabbt efter (en kvarts cykel
    // i stället för en halv), sedan svävar man en kort stund. Annars hinner kroppen före fötterna och benen släpar efter.
    const latV = vel[0] * Math.cos(yaw) - vel[1] * Math.sin(yaw); // plus = åt vänster
    const lead = latV > 0 ? "L" : "R";
    const close = 0.5 - 0.25 * sideness; // hur långt efter den ledande foten den andra sätts ner (andel av cykeln)
    const offsets = lead === "L" ? [["L", 0], ["R", 1 - close]] : [["L", 0.5 - close], ["R", 0.5]];
    const leadReach = sideness * Math.max(0, (stride * (0.5 - close) + MIN_GAP) / 2 - 0.05);

    for (const [side, offset] of offsets) {
      const foot = this.feet[side];
      let f = (phase / (Math.PI * 2) + offset) % 1;
      if (f < 0) f += 1;

      if (f < stance) {
        // Står på marken
        if (foot.swing !== null) {
          foot.plant = [foot.current[0], foot.current[2]];
          foot.swing = null;
          onStep?.(side, foot.plant);
        }
        foot.current = [foot.plant[0], 0, foot.plant[1]];
        // Hälen lyfter mot slutet av steget
        foot.pitch = smooth(Math.max(0, (f / stance - 0.6) / 0.4)) * (0.45 + 0.25 * run);
      } else {
        // Svingar fram
        const s = (f - stance) / (1 - stance);
        if (foot.swing === null) foot.from = [...foot.plant];
        foot.swing = s;
        // Var ska foten landa? Där kroppen är vid nedsättningen, plus ett halvt steg framåt
        const remaining = (1 - s) * (1 - stance) * cycleTime;
        const [ix, iz] = this.ideal(side, pos, yaw, true);
        const ahead = (stride * stance) / 2 + (side === lead ? leadReach : 0);
        let tx = ix + vel[0] * remaining + dirX * ahead;
        let tz = iz + vel[1] * remaining + dirZ * ahead;
        // Korsa inte benen: vänster fot ska alltid landa till vänster om den högra (och tvärtom)
        const other = this.feet[side === "L" ? "R" : "L"].current;
        const lat = this.lateral(tx, tz, pos, yaw);
        const otherLat = this.lateral(other[0], other[2], pos, yaw);
        const wanted = side === "L" ? Math.max(lat, otherLat + MIN_GAP) : Math.min(lat, otherLat - MIN_GAP);
        if (wanted !== lat) {
          tx += (wanted - lat) * Math.cos(yaw);
          tz -= (wanted - lat) * Math.sin(yaw);
        }
        // Foten hänger kvar bakom en kort stund (frånskjutet), dras sedan fram och sätts ner mjukt
        const e = smooth(Math.min(1, s * (1 + 0.12 * run)) ** (1 + 0.35 * run));
        // Hälen sparkar upp bakom kroppen i början av svinget när man springer
        const up = Math.sin(Math.PI * s ** (1 - 0.35 * run));
        foot.current = [
          foot.from[0] + (tx - foot.from[0]) * e,
          up * lift,
          foot.from[1] + (tz - foot.from[1]) * e,
        ];
        // Tårna pekar bakåt-neråt efter frånskjutet, och upp precis innan hälen sätts ner
        foot.pitch = s < 0.35 ? (0.3 + 0.5 * run) * (1 - s / 0.35) : -0.3 * smooth(Math.max(0, (s - 0.6) / 0.4));
      }
    }
  }

  idle(dt, pos, yaw, onStep) {
    // Fortsätt ett pågående steg
    for (const side of ["L", "R"]) {
      const foot = this.feet[side];
      if (foot.swing === null) {
        foot.current = [foot.plant[0], 0, foot.plant[1]];
        foot.pitch *= 0.8;
        continue;
      }
      foot.swing = Math.min(1, foot.swing + dt / 0.22);
      const [tx, tz] = this.ideal(side, pos, yaw, false);
      const e = smooth(foot.swing);
      foot.current = [
        foot.from[0] + (tx - foot.from[0]) * e,
        Math.sin(Math.PI * foot.swing) * 0.08,
        foot.from[1] + (tz - foot.from[1]) * e,
      ];
      foot.pitch = 0;
      if (foot.swing >= 1) {
        foot.plant = [tx, tz];
        foot.swing = null;
        onStep?.(side, foot.plant);
      }
    }
    // Starta ett nytt korrigeringssteg om en fot hamnat för långt från ställningen (bara en fot åt gången)
    if (this.feet.L.swing !== null || this.feet.R.swing !== null) return;
    let worst = null;
    let worstDist = 0.2;
    for (const side of ["L", "R"]) {
      const [ix, iz] = this.ideal(side, pos, yaw, false);
      const d = Math.hypot(this.feet[side].plant[0] - ix, this.feet[side].plant[1] - iz);
      // Föredra foten som inte steg senast, så det blir ett naturligt "trampa runt"
      const score = d + (side === this.lastStepped ? -0.03 : 0);
      if (score > worstDist) {
        worstDist = score;
        worst = side;
      }
    }
    if (worst) {
      const foot = this.feet[worst];
      foot.from = [...foot.plant];
      foot.swing = 0;
      this.lastStepped = worst;
    }
  }
}
