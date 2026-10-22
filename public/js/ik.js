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

// Steglängd (meter per hel gångcykel). Kortare steg när man går bakåt eller åt sidan.
// run = 0 (gå) till 1 (spring), forward/side = fart i riddarens egen riktning.
export function gaitStride(run, forward, side) {
  const speed = Math.hypot(forward, side) || 1;
  const sideness = Math.abs(side) / speed;
  const back = Math.max(0, -forward) / speed;
  return (1.35 + 0.65 * run) * (1 - 0.3 * sideness) * (1 - 0.25 * back);
}

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
      stride = gaitStride(run, v[0] * s + v[1] * c, v[0] * c - v[1] * s);
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
    const stance = 0.6 - 0.22 * run; // andel av cykeln foten står på marken
    const cycleTime = stride / speed;
    const lift = 0.1 + 0.14 * run;
    const dirX = vel[0] / speed;
    const dirZ = vel[1] / speed;

    for (const [side, offset] of [["L", 0], ["R", 0.5]]) {
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
        foot.pitch = smooth(Math.max(0, (f / stance - 0.7) / 0.3)) * 0.45;
      } else {
        // Svingar fram
        const s = (f - stance) / (1 - stance);
        if (foot.swing === null) foot.from = [...foot.plant];
        foot.swing = s;
        // Var ska foten landa? Där kroppen är vid nedsättningen, plus ett halvt steg framåt
        const remaining = (1 - s) * (1 - stance) * cycleTime;
        const [ix, iz] = this.ideal(side, pos, yaw, true);
        const ahead = (stride * stance) / 2;
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
        const e = smooth(s);
        foot.current = [
          foot.from[0] + (tx - foot.from[0]) * e,
          Math.sin(Math.PI * s) * lift,
          foot.from[1] + (tz - foot.from[1]) * e,
        ];
        // Tårna upp precis innan hälen sätts ner
        foot.pitch = s < 0.3 ? 0.3 * (1 - s / 0.3) : -0.3 * smooth(Math.max(0, (s - 0.6) / 0.4));
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
