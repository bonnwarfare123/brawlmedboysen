// LJUD OCH MUSIK – skapas direkt i koden med webbläsarens ljudmotor (Web Audio).
//
// - Lutan är en fysikmodell av en sträng som knäpps (Karplus-Strong), så den låter
//   som en riktig sträng i stället för ett pip.
// - Flöjten, trumman, stridshornet och rösterna är också uppbyggda i koden.
// - Ljud långt bort hörs svagare.
//
// EGNA LJUDFILER: lägg mp3-filer i mappen public/audio så används de i stället:
//   aj-1.mp3, aj-2.mp3 …     stön när man blir träffad (så många du vill, i nummerordning)
//   skrik-1.mp3, skrik-2.mp3 … skrik när man dör
//   musik.mp3                 bakgrundsmusik (spelas i loop)
//
// Webbläsare tillåter bara ljud efter ett klick, därför anropas unlock() vid knapptryck.

const MUSIC_MAX = 0.35; // musikens volym när reglaget står längst till höger

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// ---------- Melodin: en egen dans i medeltida stil (D-doriskt, 6/8-takt) ----------
// Varje takt = 6 åttondelar. Toner som MIDI-nummer (62 = D, 69 = A …) och längd i åttondelar.
const D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71, C5 = 72, D5 = 74, E5 = 76, F5 = 77, G5 = 79, A5 = 81;
const MELODY_BARS = [
  // Del A
  [[D5, 2], [E5, 1], [F5, 2], [E5, 1]],
  [[D5, 2], [C5, 1], [A4, 3]],
  [[C5, 2], [D5, 1], [E5, 2], [F5, 1]],
  [[G5, 3], [E5, 3]],
  [[F5, 2], [E5, 1], [D5, 2], [C5, 1]],
  [[A4, 2], [C5, 1], [D5, 3]],
  [[E5, 2], [C5, 1], [A4, 2], [G4, 1]],
  [[A4, 3], [D5, 3]],
  // Del B
  [[A5, 2], [G5, 1], [F5, 2], [G5, 1]],
  [[A5, 3], [D5, 3]],
  [[G5, 2], [F5, 1], [E5, 2], [D5, 1]],
  [[C5, 3], [E5, 3]],
  [[F5, 2], [G5, 1], [A5, 2], [F5, 1]],
  [[G5, 2], [E5, 1], [C5, 3]],
  [[D5, 2], [E5, 1], [C5, 2], [A4, 1]],
  [[D5, 6]],
];
// Ackord för lutan per takt: [bas, kvint, ters] (MIDI)
const DM = [50, 57, 65], AM = [45, 52, 60], CM = [48, 55, 64], FM = [41, 48, 57];
const CHORDS = [DM, AM, CM, CM, DM, DM, AM, DM, DM, DM, CM, AM, FM, CM, AM, DM];
const BAR = 6;

function buildSong() {
  const melody = [];
  const lute = [];
  MELODY_BARS.forEach((bar, b) => {
    let pos = b * BAR;
    for (const [note, len] of bar) {
      melody.push({ start: pos, len, note });
      pos += len;
    }
    // Lutan: bas – kvint – ters – bas(oktav) – kvint – ters
    const [root, fifth, third] = CHORDS[b];
    [root, fifth, third, root + 12, fifth, third].forEach((n, i) => lute.push({ start: b * BAR + i, note: n }));
  });
  return { melody, lute, length: MELODY_BARS.length * BAR };
}
const SONG = buildSong();

export class Sound {
  constructor(muted = false, musicOn = true, musicVolume = 0.6, sfxVolume = 1) {
    this.ctx = null;
    this.muted = muted;
    this.musicOn = musicOn;
    this.musicVolume = musicVolume; // 0–1, från reglaget
    this.sfxVolume = sfxVolume;     // 0–1, från reglaget
    this.listener = { x: 0, y: 0, z: 0 };
    this.strings = new Map(); // färdigräknade lutsträngar per ton
    this.files = { aj: [], skrik: [], musik: null };
    this.music = { playing: false, battle: false, step: 0, nextTime: 0, timer: null, fileSource: null };
  }

  unlock() {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.8;
        // Mjuk begränsning: riktigt höga toppar (skrik, många ljud på en gång) rundas av i stället för att spricka
        const soft = this.ctx.createWaveShaper();
        const curve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) {
          const x = ((i / 1023) * 2 - 1) * 2; // ingången skalas ner till hälften (se pre), så kurvan täcker -2..2
          curve[i] = Math.abs(x) < 0.6 ? x : Math.sign(x) * (0.6 + 0.4 * Math.tanh((Math.abs(x) - 0.6) / 0.4));
        }
        soft.curve = curve;
        soft.oversample = "2x";
        const pre = this.ctx.createGain();
        pre.gain.value = 0.5;
        this.master.connect(pre);
        pre.connect(soft);
        soft.connect(this.ctx.destination);
        this.musicBus = this.ctx.createGain();
        this.musicBus.connect(this.master);
        this.sfx = this.ctx.createGain(); // alla ljudeffekter går hit, så de kan sänkas separat
        this.sfx.connect(this.master);
        this.applyVolumes();
        // Lite rumsklang så det låter som en arena i stället för ett tomt rum
        this.reverb = this.ctx.createConvolver();
        this.reverb.buffer = this.makeImpulse(1.8);
        const wet = this.ctx.createGain();
        wet.gain.value = 0.25;
        this.reverb.connect(wet);
        wet.connect(this.sfx);

        const length = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        this.loadFiles();
        if (this.rainOn) this.setRain(true); // regnet valdes innan ljudet låstes upp
        if (this.windLevel) this.setWind(this.windLevel);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch {
      this.ctx = null; // ingen ljudmotor – spelet fungerar ändå
    }
  }

  // Försök ladda egna ljudfiler från public/audio (saknas de används de inbyggda ljuden)
  async loadFiles() {
    const load = async (name) => {
      try {
        const res = await fetch(`audio/${name}`);
        if (!res.ok) return null;
        return await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        return null;
      }
    };
    for (const kind of ["aj", "skrik"]) {
      for (let i = 1; i <= 20; i++) {
        const buffer = await load(`${kind}-${i}.mp3`);
        if (!buffer) break;
        this.files[kind].push(buffer);
      }
    }
    this.files.musik = await load("musik.mp3");
    if (this.files.musik && this.music.playing) {
      this.stopMusic();
      this.startMusic(this.music.battle);
    }
  }

  makeImpulse(seconds) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
    return buffer;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.8;
  }

  setMusic(on) {
    this.musicOn = on;
    this.applyVolumes();
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    this.applyVolumes();
  }

  setSfxVolume(v) {
    this.sfxVolume = v;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.musicBus.gain.value = this.musicOn ? MUSIC_MAX * this.musicVolume : 0;
    this.sfx.gain.value = this.sfxVolume;
  }

  setListener(x, y, z) {
    this.listener.x = x;
    this.listener.y = y;
    this.listener.z = z;
  }

  volumeAt(pos) {
    if (!pos) return 1;
    const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
    return 1 / (1 + d * 0.1);
  }

  ready() {
    return this.ctx && !this.muted;
  }

  // ---------- Byggstenar ----------

  envelope(volume, start, attack, hold, release, destination = this.sfx, reverbAmount = 0.3) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + attack);
    if (hold > 0) g.gain.setValueAtTime(Math.max(0.0002, volume), start + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, start + attack + hold + release);
    g.connect(destination);
    if (reverbAmount > 0) {
      const send = this.ctx.createGain();
      send.gain.value = reverbAmount;
      g.connect(send);
      send.connect(this.reverb);
    }
    return g;
  }

  noiseBurst({ volume, attack = 0.005, decay, type = "bandpass", freq, freqEnd = null, q = 1, start = null, dest }) {
    const t = start ?? this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    if (freqEnd) filter.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    src.connect(filter);
    filter.connect(this.envelope(volume, t, attack, 0, decay, dest));
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + decay + 0.05);
  }

  tone({ volume, type = "sine", freq, freqEnd = null, attack = 0.005, hold = 0, decay, start = null, dest }) {
    const t = start ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + hold + decay);
    osc.connect(this.envelope(volume, t, attack, hold, decay, dest));
    osc.start(t);
    osc.stop(t + attack + hold + decay + 0.05);
  }

  playBuffer(buffer, volume, dest = this.sfx, rate = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g);
    g.connect(dest);
    src.start();
    return src;
  }

  // ---------- Instrument ----------

  // En knäppt sträng (Karplus-Strong): brus i en kort slinga som dämpas = strängljud
  stringBuffer(midi) {
    if (this.strings.has(midi)) return this.strings.get(midi);
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * 1.6);
    const buffer = this.ctx.createBuffer(1, length, rate);
    const out = buffer.getChannelData(0);
    const period = Math.max(2, Math.round(rate / midiToFreq(midi)));
    const loop = new Float32Array(period);
    for (let i = 0; i < period; i++) loop[i] = Math.random() * 2 - 1;
    let idx = 0;
    const decay = midi < 50 ? 0.997 : 0.994;
    for (let i = 0; i < length; i++) {
      const next = (idx + 1) % period;
      const value = (loop[idx] + loop[next]) * 0.5 * decay;
      out[i] = loop[idx];
      loop[idx] = value;
      idx = next;
    }
    this.strings.set(midi, buffer);
    return buffer;
  }

  lute(midi, time, volume = 0.5, dest = this.musicBus) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.stringBuffer(midi);
    const body = this.ctx.createBiquadFilter(); // lutans träkropp
    body.type = "peaking";
    body.frequency.value = 280;
    body.gain.value = 6;
    const soft = this.ctx.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 3200;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(body);
    body.connect(soft);
    soft.connect(g);
    g.connect(dest);
    src.start(time);
  }

  // Blockflöjt: mjuk ton med lite luftbrus och vibrato
  flute(midi, time, duration, volume = 0.35) {
    const f = midiToFreq(midi);
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f, time);
    const vibrato = this.ctx.createOscillator();
    vibrato.frequency.value = 5.2;
    const vibDepth = this.ctx.createGain();
    vibDepth.gain.setValueAtTime(0, time);
    vibDepth.gain.linearRampToValueAtTime(f * 0.006, time + Math.min(0.25, duration));
    vibrato.connect(vibDepth);
    vibDepth.connect(osc.frequency);
    const over = this.ctx.createOscillator();
    over.type = "triangle";
    over.frequency.setValueAtTime(f * 2, time);
    const overGain = this.ctx.createGain();
    overGain.gain.value = 0.12;
    over.connect(overGain);
    const env = this.envelope(volume, time, 0.04, Math.max(0, duration - 0.12), 0.08, this.musicBus, 0.4);
    osc.connect(env);
    overGain.connect(env);
    [osc, over, vibrato].forEach((o) => {
      o.start(time);
      o.stop(time + duration + 0.1);
    });
    this.noiseBurst({ volume: volume * 0.15, decay: 0.06, type: "highpass", freq: 3000, start: time, dest: this.musicBus });
  }

  // Ramtrumma: djup duns eller ljus knackning
  drum(time, deep = true, volume = 0.6, dest = this.musicBus) {
    if (deep) {
      this.tone({ volume, freq: 110, freqEnd: 50, decay: 0.3, start: time, dest });
      this.noiseBurst({ volume: volume * 0.35, decay: 0.08, type: "lowpass", freq: 600, start: time, dest });
    } else {
      this.tone({ volume: volume * 0.5, freq: 220, freqEnd: 160, decay: 0.08, start: time, dest });
      this.noiseBurst({ volume: volume * 0.4, decay: 0.05, type: "bandpass", freq: 1800, q: 1.5, start: time, dest });
    }
  }

  // Stridshorn: mässingsliknande ton (sågtand genom ett filter som öppnar sig)
  horn(midi, start, duration, volume = 0.35) {
    const f = midiToFreq(midi);
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(f * 0.97, start);
    osc.frequency.exponentialRampToValueAtTime(f, start + 0.06);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(300, start);
    filter.frequency.exponentialRampToValueAtTime(2200, start + 0.12);
    filter.frequency.exponentialRampToValueAtTime(900, start + duration);
    osc.connect(filter);
    filter.connect(this.envelope(volume, start, 0.06, Math.max(0, duration - 0.2), 0.15, this.sfx, 0.5));
    osc.start(start);
    osc.stop(start + duration + 0.1);
  }

  // ---------- Röster (stön och skrik) ----------
  // ---------- Röster ----------
  // Röstsyntes: två lätt förstimmade "stämband" (sågtandsvågor) med darr och ojämnhet i tonhöjden,
  // luft (brus), knarr (en ton en oktav under) och raspighet (förvrängning), genom fyra filter
  // ("formanter") som formar vokalerna. voice = 0–1 ger varje riddare sin egen röst.

  // Röstens "stämband": en vågform med samma övertoner som riktiga stämband (mjukare än en sågtand).
  // "pressed" = spänd röst (skrik), "soft" = avslappnad (stön, andning).
  glottalWave(pressed) {
    const key = pressed ? "pressed" : "soft";
    this.waves ||= {};
    if (!this.waves[key]) {
      const n = 48;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let h = 1; h < n; h++) {
        // Övertonerna avtar (spektral lutning); lite svagare jämna övertoner ger en mänskligare klang
        const tilt = pressed ? 1.05 : 1.6;
        imag[h] = (1 / Math.pow(h, tilt)) * (h % 2 === 0 ? 0.8 : 1);
      }
      this.waves[key] = this.ctx.createPeriodicWave(real, imag);
    }
    return this.waves[key];
  }

  // voice kan vara ett tal (0–1) eller { v, rasp, muffle } från main.js
  static voiceParams(voice) {
    return typeof voice === "number" ? { v: voice, rasp: 0.5, muffle: false } : { v: voice?.v ?? 0.5, rasp: voice?.rasp ?? 0.5, muffle: !!voice?.muffle };
  }

  vocal(pos, voice, { duration, contour, vowels, breath = 0.15, grit = 0, fry = 0, volume = 0.7, onset = 0, gurgle = 0, delay = 0, tremor = 0, crack = 0, nasal = 0, stop = 0 }) {
    const vp = Sound.voiceParams(voice);
    const t = this.ctx.currentTime + delay;
    const v = this.volumeAt(pos) * volume;
    if (v < 0.01) return;
    const base = (92 + vp.v * 62) * (0.95 + Math.random() * 0.1);
    const shift = 0.9 + vp.v * 0.22; // ljusare röst = högre formanter
    grit = Math.min(1, grit * (0.75 + vp.rasp * 0.5)); // vissa riddare har hesare röst än andra

    // Tonhöjden följer en kurva (t.ex. upp och sedan ner). Tät kurva så att ett "brustet" ställe blir skarpt.
    const N = 64;
    const curve = new Float32Array(N);
    const crackAt = 0.45 + Math.random() * 0.25;
    for (let i = 0; i < N; i++) {
      const f = (i / (N - 1)) * (contour.length - 1);
      const a = Math.floor(f);
      const b = Math.min(contour.length - 1, a + 1);
      let c = contour[a] + (contour[b] - contour[a]) * (f - a);
      // Rösten spricker: hoppar plötsligt upp (falsett) en kort stund
      const u = i / (N - 1);
      if (crack > 0 && u > crackAt && u < crackAt + 0.12) c *= 1 + 0.38 * crack;
      curve[i] = base * c;
    }
    const pressed = grit > 0.4;
    const voices = [];
    for (const detune of [-0.008, 0.009]) {
      const osc = this.ctx.createOscillator();
      osc.setPeriodicWave(this.glottalWave(pressed));
      osc.frequency.setValueCurveAtTime(curve.map((f) => f * (1 + detune)), t, duration);
      voices.push(osc);
    }
    // Ojämnhet i tonhöjden (jitter) och darr (vibrato/skakningar av smärta)
    const jitterSrc = this.ctx.createBufferSource();
    jitterSrc.buffer = this.noise;
    jitterSrc.loop = true;
    const jitterLp = this.ctx.createBiquadFilter();
    jitterLp.type = "lowpass";
    jitterLp.frequency.value = 22;
    const jitterGain = this.ctx.createGain();
    jitterGain.gain.value = base * (0.05 + grit * 0.1);
    jitterSrc.connect(jitterLp);
    jitterLp.connect(jitterGain);
    voices.forEach((o) => jitterGain.connect(o.frequency));
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5.2 + Math.random() * 2.5;
    const vibGain = this.ctx.createGain();
    vibGain.gain.setValueAtTime(0, t);
    vibGain.gain.linearRampToValueAtTime(base * (0.006 + tremor * 0.05), t + duration * 0.6);
    vib.connect(vibGain);
    voices.forEach((o) => vibGain.connect(o.frequency));

    // Stämbandens ljud mjukas upp (mer övertoner när man skriker)
    const glottis = this.ctx.createBiquadFilter();
    glottis.type = "lowpass";
    glottis.frequency.value = 1500 + grit * 3000;
    glottis.Q.value = 0.5;
    const mix = this.ctx.createGain();
    mix.gain.value = 0.55;
    voices.forEach((o) => o.connect(mix));
    // Ojämn styrka (shimmer): rösten fladdrar lite i volym
    const shim = this.ctx.createGain();
    shim.gain.value = 1;
    const shimSrc = this.ctx.createBufferSource();
    shimSrc.buffer = this.noise;
    shimSrc.loop = true;
    const shimLp = this.ctx.createBiquadFilter();
    shimLp.type = "lowpass";
    shimLp.frequency.value = 35;
    const shimDepth = this.ctx.createGain();
    shimDepth.gain.value = 0.18 + grit * 0.25;
    shimSrc.connect(shimLp);
    shimLp.connect(shimDepth);
    shimDepth.connect(shim.gain);
    mix.connect(shim);
    shim.connect(glottis);

    // Knarr: en våg en oktav under (låter som ett stön eller ett morrande)
    let fryOsc = null;
    if (fry > 0) {
      fryOsc = this.ctx.createOscillator();
      fryOsc.type = "square";
      fryOsc.frequency.setValueCurveAtTime(curve.map((f) => f * 0.5), t, duration);
      const g = this.ctx.createGain();
      g.gain.value = fry * 0.3;
      fryOsc.connect(g);
      g.connect(glottis);
    }

    // Raspighet: förvrängning
    let source = glottis;
    if (grit > 0) {
      const shaper = this.ctx.createWaveShaper();
      const n = 256;
      const c = new Float32Array(n);
      const k = 2 + grit * 26;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      }
      shaper.curve = c;
      glottis.connect(shaper);
      source = shaper;
    }

    // Luft i rösten
    const air = this.ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const airFilter = this.ctx.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.frequency.value = 1500 * shift;
    airFilter.Q.value = 0.5;
    const airGain = this.ctx.createGain();
    airGain.gain.value = breath;
    air.connect(airFilter);
    airFilter.connect(airGain);

    // Slutet: stängd hjälm = dovt och burkigt (som att ropa i en hink)
    let out = this.envelope(v, t, stop > 0 ? 0.008 : 0.025, duration * 0.55, duration * 0.45, this.sfx, vp.muffle ? 0.18 : 0.3);
    if (vp.muffle) {
      const ring = this.ctx.createBiquadFilter();
      ring.type = "peaking";
      ring.frequency.value = 820;
      ring.Q.value = 4;
      ring.gain.value = 6;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1500;
      lp.Q.value = 0.8;
      const boost = this.ctx.createGain();
      boost.gain.value = 0.75;
      ring.connect(lp);
      lp.connect(boost);
      boost.connect(out);
      out = ring;
    }
    // Gurgel (döende): rösten "bubblar" med en snabb darrning i styrkan
    let dest = out;
    let gurgleOsc = null;
    if (gurgle > 0) {
      const am = this.ctx.createGain();
      am.gain.value = 1 - gurgle * 0.5;
      gurgleOsc = this.ctx.createOscillator();
      gurgleOsc.frequency.setValueAtTime(12 + Math.random() * 4, t);
      gurgleOsc.frequency.linearRampToValueAtTime(24, t + duration);
      const depth = this.ctx.createGain();
      depth.gain.value = gurgle * 0.5;
      gurgleOsc.connect(depth);
      depth.connect(am.gain);
      am.connect(out);
      dest = am;
    }

    // Fyra formanter som glider genom vokalerna. Nasalt ("nngh") = munnen stängd: dämpade övre formanter.
    const steps = vowels.length;
    const gains = [1, 0.7 * (1 - nasal * 0.7), 0.32 * (1 - nasal * 0.6), 0.18];
    const widths = [80, 100, 150, 210];
    for (let i = 0; i < 4; i++) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      const f0 = vowels[0][i] * shift;
      bp.frequency.setValueAtTime(f0, t);
      bp.Q.value = f0 / widths[i];
      for (let s = 1; s < steps; s++) bp.frequency.linearRampToValueAtTime(vowels[s][i] * shift, t + (duration * s) / (steps - 1));
      const g = this.ctx.createGain();
      g.gain.value = gains[i] * 2.2;
      source.connect(bp);
      airGain.connect(bp);
      bp.connect(g);
      g.connect(dest);
    }
    // Lite av grundtonen direkt (bröströst), mer när munnen är stängd
    const chest = this.ctx.createBiquadFilter();
    chest.type = "lowpass";
    chest.frequency.value = 380;
    const chestGain = this.ctx.createGain();
    chestGain.gain.value = 0.35 + nasal * 0.5;
    source.connect(chest);
    chest.connect(chestGain);
    chestGain.connect(dest);

    // Start: ett "h" (utandning) eller ett tvärt stopp i halsen (ett litet klick innan rösten kommer)
    if (onset > 0) this.noiseBurst({ volume: v * onset * 0.45, attack: 0.008, decay: 0.06, type: "bandpass", freq: 1400 * shift, q: 1.2, start: t, dest: vp.muffle ? out : undefined });
    if (stop > 0) this.noiseBurst({ volume: v * stop * 0.5, attack: 0.001, decay: 0.012, type: "highpass", freq: 2500, start: Math.max(this.ctx.currentTime, t - 0.01), dest: vp.muffle ? out : undefined });

    const end = t + duration + 0.1;
    [...voices, jitterSrc, vib, shimSrc, air, fryOsc, gurgleOsc].forEach((node) => {
      if (!node) return;
      node.start(t);
      node.stop(end);
    });
  }

  // Flämtande andning (lite liv kvar eller trött): in och ut, hes
  pant(pos, voice = 0.5, strength = 1) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos) * 0.35 * strength;
    if (v < 0.02) return;
    const t = this.ctx.currentTime;
    const vp = Sound.voiceParams(voice);
    const dest = undefined;
    this.noiseBurst({ volume: v * 0.7, attack: 0.08, decay: 0.22, type: "bandpass", freq: 1100, freqEnd: 1500, q: 0.9, start: t, dest }); // in
    this.noiseBurst({ volume: v, attack: 0.03, decay: 0.3, type: "bandpass", freq: 900, freqEnd: 500, q: 0.8, start: t + 0.36, dest }); // ut
    if (Math.random() < 0.5) {
      const V = Sound.V;
      this.vocal(pos, voice, { duration: 0.22, delay: 0.37, contour: [0.9, 0.85, 0.75], vowels: [V.uh, V.u], breath: 0.8, grit: 0.2, fry: 0.8, volume: 0.16 * strength, nasal: 0.5 });
    }
  }

  // Vokaler (formanter F1–F4 för en mansröst)
  static V = {
    a: [730, 1090, 2440, 3400], o: [570, 840, 2410, 3300], u: [300, 870, 2240, 3300], e: [530, 1840, 2480, 3500],
    ae: [660, 1720, 2410, 3400], uh: [520, 1190, 2390, 3400], i: [270, 2290, 3010, 3500],
    n: [300, 1300, 2300, 3300], r: [490, 1350, 1690, 3300], // "nng" och ett morrande "rr"
  };

  pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  // Inspelade ljud (aj-1.mp3 osv.): samma röst för samma riddare, och dämpat bakom stängd hjälm
  playVoiceFile(buffer, pos, voice, volume) {
    const vp = Sound.voiceParams(voice);
    let dest = this.sfx;
    if (vp.muffle) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1600;
      const ring = this.ctx.createBiquadFilter();
      ring.type = "peaking";
      ring.frequency.value = 820;
      ring.Q.value = 4;
      ring.gain.value = 8;
      ring.connect(lp);
      lp.connect(this.sfx);
      dest = ring;
    }
    this.playBuffer(buffer, this.volumeAt(pos) * volume, dest, 0.9 + vp.v * 0.2);
  }

  // Ansträngning när man slår: "hngh!", "hah!", "uah!", "rrah!"
  grunt(pos, voice = 0.5, heavy = false) {
    if (!this.ready()) return;
    const V = Sound.V;
    const kind = Math.floor(Math.random() * 5);
    const d = heavy ? 0.26 + Math.random() * 0.12 : 0.12 + Math.random() * 0.06;
    if (kind === 0) {
      // "nngh!": munnen stängd, pressat
      this.vocal(pos, voice, { duration: d, contour: [1.0, 1.15, 1.05], vowels: [V.n, V.uh, V.n], breath: 0.25, grit: heavy ? 0.4 : 0.2, fry: 0.5, volume: heavy ? 0.6 : 0.42, nasal: 0.8, stop: 1 });
    } else if (kind === 1 && heavy) {
      // "rraah!": morrande
      this.vocal(pos, voice, { duration: d + 0.08, contour: [0.9, 1.3, 1.35, 1.0], vowels: [V.r, V.a, V.a, V.uh], breath: 0.3, grit: 0.6, fry: 0.6, volume: 0.68, onset: 0.4, stop: 0.6 });
    } else {
      const vowels = this.pick([[V.uh, V.uh], [V.a, V.uh], [V.e, V.uh], [V.ae, V.a]]);
      this.vocal(pos, voice, {
        duration: d, contour: heavy ? [0.95, 1.25, 1.18, 0.9] : [1.05, 1.15, 0.92],
        vowels, breath: 0.35, grit: heavy ? 0.35 : 0.15, fry: 0.45, volume: heavy ? 0.65 : 0.45, onset: 0.8, stop: 0.5,
      });
    }
    // Luften som går ut efteråt
    this.exhale(pos, d + 0.02, heavy ? 0.25 : 0.14, heavy ? 0.12 : 0.07);
  }

  // Smärta när man blir träffad: hårdare träff = högre, längre, mer raspigt och darrigt
  hurt(pos, voice = 0.5, amount = 0.6) {
    if (!this.ready()) return;
    if (this.files.aj.length) {
      this.playVoiceFile(this.pick(this.files.aj), pos, voice, 0.6 + amount * 0.4);
      return;
    }
    const V = Sound.V;
    if (amount > 0.75) {
      // "AAARGH" – med ett tvärt stopp i halsen först och en röst som kan spricka
      const vowels = this.pick([[V.a, V.a, V.uh], [V.ae, V.a, V.o], [V.e, V.a, V.uh], [V.r, V.a, V.a, V.uh]]);
      this.vocal(pos, voice, {
        duration: 0.4 + Math.random() * 0.2, contour: [1.3, 1.8, 1.65, 1.25, 0.9],
        vowels, breath: 0.25, grit: 0.55, fry: 0.25, volume: 0.85, onset: 0.6, stop: 1, tremor: 0.5, crack: Math.random() < 0.4 ? 1 : 0,
      });
      // ett andra, kortare stön när smärtan kommer ikapp
      this.vocal(pos, voice, { duration: 0.2, delay: 0.62 + Math.random() * 0.1, contour: [1.0, 1.05, 0.8], vowels: [V.n, V.uh], breath: 0.5, grit: 0.3, fry: 0.7, volume: 0.35, nasal: 0.6 });
    } else {
      // "uhh", "ngh", "ooh"
      const r = Math.random();
      const vowels = r < 0.35 ? [V.n, V.uh] : r < 0.7 ? [V.uh, V.u] : [V.o, V.uh];
      this.vocal(pos, voice, {
        duration: 0.18 + amount * 0.25 + Math.random() * 0.08, contour: [1.25, 1.35, 1.0, 0.85],
        vowels, breath: 0.3, grit: 0.15 + amount * 0.4, fry: 0.35, volume: 0.5 + amount * 0.3, onset: 0.7, stop: 0.6, nasal: r < 0.35 ? 0.7 : 0, tremor: 0.2,
      });
    }
  }

  // Vrål när en arm eller ett ben huggs av (men man lever): långt skrik som bryts ner i stötvisa stön
  roar(pos, voice = 0.5) {
    if (!this.ready()) return;
    if (this.files.skrik.length) return this.playVoiceFile(this.pick(this.files.skrik), pos, voice, 1);
    const V = Sound.V;
    const len = 0.9 + Math.random() * 0.4;
    this.vocal(pos, voice, {
      duration: len, contour: [1.5, 2.15, 2.25, 2.05, 2.2, 1.8, 1.3],
      vowels: [V.ae, V.a, V.a, V.a, V.o], breath: 0.3, grit: 0.75, fry: 0.15, volume: 0.9, onset: 0.4, stop: 1, tremor: 0.8, crack: 1,
    });
    // Andas in med ett pip och fortsätter stöna i stötar
    let at = len + 0.08;
    this.noiseBurst({ volume: this.volumeAt(pos) * 0.25, attack: 0.05, decay: 0.2, type: "bandpass", freq: 1800, freqEnd: 2400, q: 2, start: this.ctx.currentTime + at });
    at += 0.28;
    for (let i = 0; i < 3; i++) {
      this.vocal(pos, voice, {
        duration: 0.16 + Math.random() * 0.1, delay: at, contour: [1.3 - i * 0.1, 1.45 - i * 0.12, 1.1],
        vowels: [V.a, V.uh], breath: 0.45, grit: 0.45, fry: 0.4, volume: 0.5 - i * 0.1, stop: 0.8, tremor: 0.9,
      });
      at += 0.26 + Math.random() * 0.12;
    }
  }

  // Döende: ett tvärt smärtskrik (tre varianter), några kvävda stötar, ett gurglande och en sista utandning
  scream(pos, voice = 0.5) {
    if (!this.ready()) return;
    if (this.files.skrik.length) {
      this.playVoiceFile(this.pick(this.files.skrik), pos, voice, 1);
      return;
    }
    const V = Sound.V;
    const variant = Math.floor(Math.random() * 3);
    let cry;
    if (variant === 0) {
      // "AAARGH-hh": rösten spricker och sjunker mot slutet
      cry = 0.5 + Math.random() * 0.2;
      this.vocal(pos, voice, {
        duration: cry, contour: [1.35, 1.95, 2.05, 1.85, 1.3, 0.85],
        vowels: [V.ae, V.a, V.a, V.o, V.uh], breath: 0.35, grit: 0.7, fry: 0.25, volume: 0.85, onset: 0.5, stop: 1, tremor: 0.6, crack: 1,
      });
    } else if (variant === 1) {
      // Kvävt "NGHH-UHH!" (träffad i bröstet, luften går ur)
      cry = 0.3 + Math.random() * 0.08;
      this.vocal(pos, voice, {
        duration: cry, contour: [1.05, 1.5, 1.4, 0.9],
        vowels: [V.n, V.a, V.uh], breath: 0.45, grit: 0.55, fry: 0.55, volume: 0.75, stop: 1, nasal: 0.3, tremor: 0.4,
      });
    } else {
      // Långt klagande skrik
      cry = 0.75 + Math.random() * 0.2;
      this.vocal(pos, voice, {
        duration: cry, contour: [1.55, 2.2, 2.3, 2.1, 1.7, 1.15],
        vowels: [V.a, V.a, V.o, V.o, V.u], breath: 0.3, grit: 0.5, fry: 0.15, volume: 0.6, onset: 0.5, tremor: 0.7, crack: Math.random() < 0.5 ? 1 : 0,
      });
    }
    // Några kvävda, allt svagare stötar ("uh ... uh")
    let at = cry + 0.12 + Math.random() * 0.1;
    const gasps = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < gasps; i++) {
      this.vocal(pos, voice, {
        duration: 0.11 + Math.random() * 0.08, delay: at, contour: [0.85, 0.95, 0.72],
        vowels: [V.uh, V.u], breath: 0.6, grit: 0.25, fry: 0.9, volume: 0.38 * (1 - i * 0.25), onset: 0.6, tremor: 0.5,
      });
      at += 0.24 + Math.random() * 0.18;
    }
    // Gurglande (blod i halsen)
    this.vocal(pos, voice, {
      duration: 0.45, delay: at, contour: [0.7, 0.66, 0.6],
      vowels: [V.o, V.u], breath: 0.5, grit: 0.35, fry: 0.9, volume: 0.22, gurgle: 0.9,
    });
    at += 0.5;
    // Sista utandningen: luft som pyser ut och ett lågt rossel
    this.exhale(pos, at, 0.9, 0.3);
    this.vocal(pos, voice, {
      duration: 0.75, delay: at + 0.06, contour: [0.62, 0.52, 0.44],
      vowels: [V.uh, V.u, V.u], breath: 0.9, grit: 0.2, fry: 1, volume: 0.2, gurgle: 0.35,
    });
  }

  // En utandning (luft genom munnen) som sjunker och tystnar
  exhale(pos, delay, duration, volume) {
    const v = this.volumeAt(pos) * volume;
    if (v < 0.01) return;
    const t = this.ctx.currentTime + delay;
    this.noiseBurst({ volume: v, attack: 0.06, decay: duration, type: "bandpass", freq: 900, freqEnd: 280, q: 0.8, start: t });
  }

  // "HA HA HA!" när man pekar och skrattar
  laugh(pos, voice = 0.5) {
    if (!this.ready()) return;
    const V = Sound.V;
    const count = 4 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      this.vocal(pos, voice, {
        duration: 0.15, delay: i * (0.17 + Math.random() * 0.03),
        contour: [1.55 - i * 0.06, 1.6 - i * 0.06, 1.35 - i * 0.07],
        vowels: [V.a, V.ae], breath: 0.5, grit: 0.2, fry: 0.1, volume: 0.7, onset: 1,
      });
    }
  }

  // Dansen: ingen musik längre, bara lite jubel från publiken
  dance() {
    this.crowd(0.35);
  }

  // ---------- Stridsljud ----------

  // kind: "q" snabbt, "h" tungt, "t" stöt. weapon: 0 svärd, 1 yxa, 2 slagkedja
  swing(pos, heavy = false, kind = null, weapon = 0) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    if (weapon === 2) {
      // Slagkedja: kulan visslar runt och kedjan skramlar
      this.noiseBurst({ volume: 0.3 * v, attack: 0.05, decay: heavy ? 0.35 : 0.22, freq: 500, freqEnd: 1300, q: 5 });
      for (let i = 0; i < 5; i++) {
        this.tone({ volume: 0.05 * v, type: "triangle", freq: 2400 + Math.random() * 1800, decay: 0.03, start: this.ctx.currentTime + i * 0.035 + Math.random() * 0.02 });
      }
      return;
    }
    if (kind === "t") {
      this.noiseBurst({ volume: 0.45 * v, attack: 0.02, decay: 0.1, freq: weapon === 1 ? 900 : 1400, freqEnd: weapon === 1 ? 2400 : 3800, q: 4 });
      return;
    }
    const low = weapon === 1 ? 0.6 : 1; // yxan är tyngre: djupare sus
    this.noiseBurst({
      volume: 0.4 * v,
      attack: heavy ? 0.07 : 0.035,
      decay: (heavy ? 0.25 : 0.15) * (weapon === 1 ? 1.25 : 1),
      freq: (heavy ? 400 : 700) * low,
      freqEnd: (heavy ? 1600 : 2600) * low,
      q: 3,
    });
  }

  hit(pos, heavy = false, weapon = 0) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    const t = this.ctx.currentTime;
    // Duns i kroppen
    this.tone({ volume: (heavy ? 1 : 0.7) * v, freq: heavy ? 130 : 170, freqEnd: 40, decay: heavy ? 0.25 : 0.16 });
    // Köttigt smack
    this.noiseBurst({ volume: 0.6 * v, decay: 0.1, type: "lowpass", freq: 1800, freqEnd: 250, q: 1 });
    if (weapon === 1) {
      // Yxa: ett tungt "tunk" av trä och järn som biter i
      this.tone({ volume: 0.45 * v, freq: 105, freqEnd: 48, decay: 0.3 });
      this.noiseBurst({ volume: 0.45 * v, decay: 0.08, type: "bandpass", freq: 650, q: 4 });
      [1, 1.62].forEach((r, i) => this.tone({ volume: (0.07 / (i + 1)) * v, type: "triangle", freq: 1100 * r, decay: 0.09 }));
    } else if (weapon === 2) {
      // Slagkedja: krasande spikboll och skrammel
      for (let i = 0; i < 4; i++) {
        this.noiseBurst({ volume: 0.35 * v, decay: 0.025, type: "highpass", freq: 1800 + Math.random() * 2000, q: 1, start: t + i * 0.018 });
      }
      this.tone({ volume: 0.5 * v, freq: 90, freqEnd: 40, decay: 0.22 });
      for (let i = 0; i < 4; i++) this.tone({ volume: 0.04 * v, type: "triangle", freq: 2600 + Math.random() * 1500, decay: 0.04, start: t + 0.05 + i * 0.04 });
    } else if (weapon === 3) {
      // Hammare och slägga: dovt krasande duns, plåt som bucklas
      this.tone({ volume: (heavy ? 1.1 : 0.8) * v, freq: 75, freqEnd: 32, decay: 0.35 });
      this.noiseBurst({ volume: 0.55 * v, decay: 0.06, type: "bandpass", freq: 420, q: 2 });
      for (let i = 0; i < 3; i++) this.noiseBurst({ volume: 0.25 * v, decay: 0.02, type: "highpass", freq: 2500, q: 1, start: t + 0.02 + i * 0.025 });
      [1, 1.9].forEach((r, i) => this.tone({ volume: (0.08 / (i + 1)) * v, type: "triangle", freq: 380 * r, decay: 0.2 }));
    } else {
      // Svärd mot rustning: kort metallklang med några övertoner
      const f = 1500 + Math.random() * 600;
      [1, 1.47, 2.1].forEach((r, i) => this.tone({ volume: (0.12 / (i + 1)) * v, type: "triangle", freq: f * r, decay: 0.12 + i * 0.04 }));
    }
  }

  // Regn: ett brusande sus som pågår så länge det regnar (on = false stänger av)
  setRain(on) {
    this.rainOn = on;
    if (!this.ctx) return; // startas när ljudet låses upp
    if (on && !this.rainNode) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2400;
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 350;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.09, this.ctx.currentTime + 1.5);
      src.connect(lp);
      lp.connect(hp);
      hp.connect(g);
      g.connect(this.sfx);
      src.start();
      this.rainNode = { src, g };
    } else if (!on && this.rainNode) {
      const { src, g } = this.rainNode;
      g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.8);
      src.stop(this.ctx.currentTime + 0.9);
      this.rainNode = null;
    }
  }

  // Vind (snö i borggården): brus som tjuter och sveper, starkare i snöstorm
  setWind(level) {
    this.windLevel = level;
    if (!this.ctx) return;
    if (level > 0 && !this.windNode) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 500;
      bp.Q.value = 1.4;
      // Vinden sveper: filtret och styrkan rör sig långsamt
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.13;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 260;
      lfo.connect(lfoGain);
      lfoGain.connect(bp.frequency);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.sfx);
      src.start();
      lfo.start();
      this.windNode = { src, g, lfo };
    }
    if (this.windNode) {
      const { src, g, lfo } = this.windNode;
      const target = Math.max(0.0001, level * 0.07);
      g.gain.cancelScheduledValues(this.ctx.currentTime);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(target, this.ctx.currentTime + 1.2);
      if (level <= 0) {
        src.stop(this.ctx.currentTime + 1.3);
        lfo.stop(this.ctx.currentTime + 1.3);
        this.windNode = null;
      }
    }
  }

  // Gycklarens bjällror: några små klingande klockor
  bells(pos, loud = 1) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos) * loud;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const f = 2600 + Math.random() * 1400;
      this.tone({ volume: 0.05 * v, type: "sine", freq: f, decay: 0.25, start: t + i * 0.03 + Math.random() * 0.02 });
      this.tone({ volume: 0.02 * v, type: "sine", freq: f * 2.76, decay: 0.12, start: t + i * 0.03 });
    }
  }

  // Rullning: sus och en duns när man landar
  roll(pos) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    const t = this.ctx.currentTime;
    this.noiseBurst({ volume: 0.25 * v, attack: 0.08, decay: 0.3, type: "bandpass", freq: 500, freqEnd: 1200, q: 1 });
    this.tone({ volume: 0.4 * v, freq: 110, freqEnd: 45, decay: 0.15, start: t + 0.3 });
    this.noiseBurst({ volume: 0.3 * v, decay: 0.08, type: "lowpass", freq: 900, start: t + 0.3 });
  }

  // Någon ramlar omkull: tung duns och skrammel
  fall(pos) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    const t = this.ctx.currentTime;
    this.tone({ volume: 0.9 * v, freq: 90, freqEnd: 35, decay: 0.3, start: t + 0.2 });
    this.noiseBurst({ volume: 0.5 * v, decay: 0.15, type: "lowpass", freq: 700, start: t + 0.2 });
    for (let i = 0; i < 4; i++) this.tone({ volume: 0.04 * v, type: "triangle", freq: 1800 + Math.random() * 1500, decay: 0.06, start: t + 0.22 + i * 0.05 });
  }

  // Plockar upp ett vapen: klirr
  pickup(pos) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    const t = this.ctx.currentTime;
    [1, 1.5].forEach((r, i) => this.tone({ volume: 0.12 * v, type: "triangle", freq: 1300 * r, decay: 0.15, start: t + i * 0.06 }));
    this.noiseBurst({ volume: 0.15 * v, decay: 0.05, type: "highpass", freq: 2500 });
  }

  // Utroparens fanfar (kort)
  fanfare() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    this.horn(67, t, 0.12, 0.25);
    this.horn(72, t + 0.13, 0.3, 0.28);
  }

  // En hjälm som flyger av: klonk
  helmetOff(pos) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    const base = 620 + Math.random() * 120;
    [1, 2.7, 4.1].forEach((r, i) => this.tone({ volume: (0.25 / (i + 1)) * v, freq: base * r, decay: 0.5 - i * 0.1 }));
    this.noiseBurst({ volume: 0.3 * v, decay: 0.05, type: "highpass", freq: 3000, q: 0.5 });
  }

  // Parering. kind = "blade": stål mot stål (tvåhandsvapen och knytnävar), "shield": mot en träsköld med metallkant.
  clang(pos, kind = "blade") {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    const t = this.ctx.currentTime;
    // Själva smällen: ett mycket kort, skarpt knäpp över alla frekvenser
    this.noiseBurst({ volume: 0.75 * v, attack: 0.001, decay: 0.012, type: "highpass", freq: 3000, q: 0.5 });
    this.noiseBurst({ volume: 0.45 * v, attack: 0.001, decay: 0.035, type: "bandpass", freq: 2200, q: 1.5 });
    if (kind === "shield") {
      // Trä som tar emot: dov duns med knack, och lite klirr från metallkanten
      this.tone({ volume: 0.7 * v, freq: 150, freqEnd: 85, decay: 0.14 });
      this.noiseBurst({ volume: 0.65 * v, attack: 0.002, decay: 0.11, type: "lowpass", freq: 700 });
      this.noiseBurst({ volume: 0.35 * v, attack: 0.001, decay: 0.05, type: "bandpass", freq: 950, q: 4 });
      [1, 2.76, 5.4].forEach((r, i) => this.tone({ volume: (0.06 / (i + 1)) * v, type: "sine", freq: 1650 * r, decay: 0.25 - i * 0.06 }));
      return;
    }
    // Stål mot stål: en klinga ringer som en stav (ojämna övertoner som dör ut snabbare ju högre de är).
    // Varje överton finns två gånger med lite olika frekvens, så de "svävar" som riktig metall.
    const base = 1050 + Math.random() * 350;
    const modes = [1, 2.756, 5.404, 8.933];
    modes.forEach((r, i) => {
      for (const beat of [-1, 1]) {
        this.tone({
          volume: (0.13 / (i * 0.8 + 1)) * v, type: "sine",
          freq: base * r + beat * (2 + Math.random() * 3),
          attack: 0.001, decay: (0.9 - i * 0.18) * (0.8 + Math.random() * 0.4),
        });
      }
    });
    // Klingorna glider mot varandra: ett kort skrap som sjunker
    this.noiseBurst({ volume: 0.22 * v, attack: 0.01, decay: 0.16, type: "bandpass", freq: 4200, freqEnd: 1600, q: 3, start: t + 0.008 });
    // Lite tyngd i smällen
    this.tone({ volume: 0.3 * v, freq: 210, freqEnd: 120, decay: 0.06 });
  }

  sever(pos) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    this.noiseBurst({ volume: 0.6 * v, decay: 0.05, type: "highpass", freq: 2500, q: 0.7 });                  // krasch
    this.noiseBurst({ volume: 0.8 * v, attack: 0.02, decay: 0.4, type: "lowpass", freq: 2000, freqEnd: 200, q: 4 }); // blaskigt slafs
    this.tone({ volume: 0.6 * v, freq: 85, freqEnd: 35, decay: 0.35 });
  }

  // Tyst knaster i sanden när en fot sätts ner (plus lite skrammel för plåt)
  footstep(pos, metal = false, loud = 1) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos) * loud;
    if (v < 0.03) return;
    const f = 500 + Math.random() * 300;
    this.noiseBurst({ volume: 0.09 * v, attack: 0.004, decay: 0.07, type: "lowpass", freq: f, freqEnd: f * 0.5, q: 0.7 });
    if (metal) this.tone({ volume: 0.018 * v, type: "triangle", freq: 1300 + Math.random() * 500, decay: 0.08 });
  }

  // Sparkens svisch och dunsen när den träffar
  kick(pos) {
    if (!this.ready()) return;
    this.noiseBurst({ volume: 0.3 * this.volumeAt(pos), attack: 0.04, decay: 0.12, freq: 350, freqEnd: 900, q: 2 });
  }

  kickHit(pos) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    this.tone({ volume: 0.9 * v, freq: 95, freqEnd: 45, decay: 0.2 });
    this.noiseBurst({ volume: 0.5 * v, decay: 0.08, type: "lowpass", freq: 900, q: 0.8 });
    [1, 1.6].forEach((r, i) => this.tone({ volume: 0.1 * v / (i + 1), type: "triangle", freq: 900 * r, decay: 0.15 })); // plåtskrammel
  }

  // Publiken jublar
  crowd(strength = 1) {
    if (!this.ready()) return;
    for (let i = 0; i < 4; i++) {
      this.noiseBurst({
        volume: (0.12 * strength) / (1 + i * 0.3),
        attack: 0.2 + Math.random() * 0.2,
        decay: 1.4 + Math.random() * 0.8,
        freq: 700 + i * 450 + Math.random() * 200,
        q: 2 + Math.random() * 2,
      });
    }
    // Några "HEJ!" och "JAAA!"-rop i publiken
    const V = Sound.V;
    for (let i = 0; i < 3; i++) {
      this.vocal({ x: this.listener.x + 15, y: 3, z: this.listener.z }, Math.random(), {
        duration: 0.3 + Math.random() * 0.2, delay: 0.08 + Math.random() * 0.5,
        contour: [1.6, 1.9, 1.7], vowels: this.pick([[V.e, V.i], [V.a, V.a], [V.o, V.a]]),
        breath: 0.3, grit: 0.25, volume: 0.35 * strength, onset: 0.5,
      });
    }
  }

  // ---------- Nedräkning, start och vinst ----------

  // 3, 2, 1: tunga trumslag
  countdownBeat() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    this.drum(t, true, 0.9, this.sfx);
    this.drum(t + 0.12, false, 0.4, this.sfx);
  }

  // STRID!: stridshornet blåser och trummorna rullar
  battleHorn() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    this.horn(55, t, 0.35, 0.3);       // G
    this.horn(62, t + 0.35, 0.9, 0.35); // D (högre, lång)
    this.horn(50, t + 0.35, 0.9, 0.18); // D (låg, under)
    for (let i = 0; i < 6; i++) this.drum(t + i * 0.07, i % 2 === 0, 0.5, this.sfx);
    this.crowd(0.7);
  }

  // Liten lutslinga när någon vinner rundan
  roundWin() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    [62, 66, 69, 74].forEach((n, i) => this.lute(n, t + i * 0.08, 0.8, this.sfx));
    this.crowd(0.8);
  }

  // Fanfar med horn när någon vinner matchen
  matchWin() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    [[62, 0, 0.25], [66, 0.25, 0.25], [69, 0.5, 0.25], [74, 0.75, 1.2]].forEach(([n, d, len]) => this.horn(n, t + d, len, 0.32));
    [[50, 0.75, 1.2], [57, 0.75, 1.2]].forEach(([n, d, len]) => this.horn(n, t + d, len, 0.15));
    for (let i = 0; i < 4; i++) this.drum(t + 0.75 + i * 0.15, true, 0.6, this.sfx);
    this.crowd(1);
  }

  // ---------- Bakgrundsmusik ----------
  // Lugn i lobbyn (luta + flöjt), med trummor och lite högre tempo under strid.

  startMusic(battle = false) {
    if (!this.ctx) return;
    this.music.battle = battle;
    if (this.music.playing) return;
    this.music.playing = true;

    if (this.files.musik) {
      this.music.fileSource = this.playBuffer(this.files.musik, 1, this.musicBus);
      this.music.fileSource.loop = true;
      return;
    }
    this.music.step = 0;
    this.music.nextTime = this.ctx.currentTime + 0.1;
    this.music.timer = setInterval(() => this.scheduleMusic(), 50);
  }

  setBattleMusic(battle) {
    this.music.battle = battle;
  }

  stopMusic() {
    this.music.playing = false;
    if (this.music.timer) clearInterval(this.music.timer);
    this.music.timer = null;
    if (this.music.fileSource) {
      try {
        this.music.fileSource.stop();
      } catch {
        // redan stoppad
      }
      this.music.fileSource = null;
    }
  }

  // Lägger ut toner lite i förväg så musiken går jämnt även om spelet hackar
  scheduleMusic() {
    if (!this.music.playing || !this.ctx) return;
    const eighth = this.music.battle ? 0.16 : 0.2;
    while (this.music.nextTime < this.ctx.currentTime + 0.25) {
      const step = this.music.step % SONG.length;
      const t = this.music.nextTime;
      if (this.musicOn && !this.muted) {
        for (const n of SONG.melody) {
          if (n.start === step) this.flute(n.note, t, n.len * eighth * 0.95);
        }
        for (const n of SONG.lute) {
          if (n.start === step) this.lute(n.note, t, n.note < 50 ? 0.55 : 0.4);
        }
        const inBar = step % BAR;
        if (this.music.battle) {
          if (inBar === 0 || inBar === 3) this.drum(t, true, 0.5);
          if (inBar === 2 || inBar === 5) this.drum(t, false, 0.35);
        } else if (inBar === 0) {
          this.drum(t, true, 0.25);
        }
      }
      this.music.step += 1;
      this.music.nextTime += eighth;
    }
  }
}
