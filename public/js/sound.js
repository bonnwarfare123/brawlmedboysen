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
        this.master.connect(this.ctx.destination);
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
  // Röstsyntes: en surrande ton (stämbanden) genom filter som formar vokaler.
  // voice = 0–1, ger varje riddare sin egen röst.

  voiceSound(pos, voice, { duration, pitchStart, pitchEnd, vowels, rasp, volume }) {
    const t = this.ctx.currentTime;
    const v = this.volumeAt(pos) * volume;
    const base = 95 + voice * 70;
    const shift = 0.9 + voice * 0.25;

    const src = this.ctx.createOscillator();
    src.type = "sawtooth";
    src.frequency.setValueAtTime(base * pitchStart, t);
    src.frequency.exponentialRampToValueAtTime(base * pitchEnd, t + duration);
    const wobble = this.ctx.createOscillator(); // darr på rösten
    wobble.frequency.value = 6 + voice * 3;
    const wobbleDepth = this.ctx.createGain();
    wobbleDepth.gain.value = base * 0.04;
    wobble.connect(wobbleDepth);
    wobbleDepth.connect(src.frequency);

    const out = this.envelope(v, t, 0.02, duration * 0.5, duration * 0.5, this.sfx, 0.35);
    // Tre formanter (vokalens "färg") som glider från första till sista vokalen
    const [from, to] = vowels;
    for (let i = 0; i < 3; i++) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 6 + i * 2;
      bp.frequency.setValueAtTime(from[i] * shift, t);
      bp.frequency.linearRampToValueAtTime(to[i] * shift, t + duration);
      const g = this.ctx.createGain();
      g.gain.value = [1, 0.6, 0.25][i];
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
    }
    // Hes rasp
    if (rasp > 0) {
      this.noiseBurst({ volume: v * rasp, attack: 0.03, decay: duration, type: "bandpass", freq: 1200 * shift, q: 2 });
    }
    [src, wobble].forEach((o) => {
      o.start(t);
      o.stop(t + duration + 0.1);
    });
  }

  // Kort stön när man blir träffad
  hurt(pos, voice = 0.5) {
    if (!this.ready()) return;
    if (this.files.aj.length) {
      const b = this.files.aj[Math.floor(Math.random() * this.files.aj.length)];
      this.playBuffer(b, this.volumeAt(pos), this.sfx, 0.92 + voice * 0.16);
      return;
    }
    const vowelSets = [
      [[325, 700, 2530], [700, 1100, 2600]], // "uh-ah"
      [[450, 800, 2830], [600, 1000, 2700]], // "oh"
      [[400, 2000, 2550], [700, 1200, 2600]], // "eh-ah"
    ];
    this.voiceSound(pos, voice, {
      duration: 0.18 + Math.random() * 0.1,
      pitchStart: 1.25 + Math.random() * 0.2,
      pitchEnd: 0.9,
      vowels: vowelSets[Math.floor(Math.random() * vowelSets.length)],
      rasp: 0.25,
      volume: 0.7,
    });
  }

  // Skrik när man dör
  scream(pos, voice = 0.5) {
    if (!this.ready()) return;
    if (this.files.skrik.length) {
      const b = this.files.skrik[Math.floor(Math.random() * this.files.skrik.length)];
      this.playBuffer(b, this.volumeAt(pos), this.sfx, 0.92 + voice * 0.16);
      return;
    }
    this.voiceSound(pos, voice, {
      duration: 0.7 + Math.random() * 0.3,
      pitchStart: 1.9 + Math.random() * 0.4,
      pitchEnd: 0.75,
      vowels: [[800, 1150, 2900], [450, 800, 2830]], // "aaaa-ooh"
      rasp: 0.45,
      volume: 0.85,
    });
  }

  // ---------- Stridsljud ----------

  // kind: "q" snabbt, "h" tungt, "t" stöt
  swing(pos, heavy = false, kind = null) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    if (kind === "t") {
      this.noiseBurst({ volume: 0.45 * v, attack: 0.02, decay: 0.1, freq: 1400, freqEnd: 3800, q: 4 });
      return;
    }
    this.noiseBurst({
      volume: 0.4 * v,
      attack: heavy ? 0.07 : 0.035,
      decay: heavy ? 0.25 : 0.15,
      freq: heavy ? 400 : 700,
      freqEnd: heavy ? 1600 : 2600,
      q: 3,
    });
  }

  hit(pos, heavy = false) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    // Duns i kroppen
    this.tone({ volume: (heavy ? 1 : 0.7) * v, freq: heavy ? 130 : 170, freqEnd: 40, decay: heavy ? 0.25 : 0.16 });
    // Köttigt smack
    this.noiseBurst({ volume: 0.6 * v, decay: 0.1, type: "lowpass", freq: 1800, freqEnd: 250, q: 1 });
    // Svärd mot rustning: kort metallklang med några övertoner
    const f = 1500 + Math.random() * 600;
    [1, 1.47, 2.1].forEach((r, i) => this.tone({ volume: (0.12 / (i + 1)) * v, type: "triangle", freq: f * r, decay: 0.12 + i * 0.04 }));
  }

  clang(pos) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    const base = 470 + Math.random() * 90;
    [1, 2.32, 3.76, 5.4, 7.1].forEach((ratio, i) => {
      this.tone({ volume: (0.35 / (i + 1)) * v, freq: base * ratio * (1 + (Math.random() - 0.5) * 0.01), decay: 1.1 - i * 0.15 });
    });
    this.noiseBurst({ volume: 0.4 * v, decay: 0.04, type: "highpass", freq: 3500, q: 0.5 });
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

  // "HA HA HA!" när man pekar och skrattar
  laugh(pos, voice = 0.5) {
    if (!this.ready()) return;
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        if (!this.ready()) return;
        this.voiceSound(pos, voice, {
          duration: 0.16,
          pitchStart: 1.5 - i * 0.06,
          pitchEnd: 1.3 - i * 0.06,
          vowels: [[750, 1250, 2600], [700, 1150, 2600]],
          rasp: 0.35,
          volume: 0.75,
        });
      }, i * 190);
    }
  }

  // Liten lutslinga till dansen
  dance() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    [74, 72, 74, 77, 74, 72, 69, 74].forEach((n, i) => this.lute(n, t + i * 0.18, 0.6, this.sfx));
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
    // Några "HEJ!"-rop i publiken
    for (let i = 0; i < 3; i++) {
      const voice = Math.random();
      setTimeout(() => {
        if (!this.ready()) return;
        this.voiceSound({ x: this.listener.x + 15, y: 3, z: this.listener.z }, voice, {
          duration: 0.3,
          pitchStart: 1.7,
          pitchEnd: 1.4,
          vowels: [[600, 1700, 2600], [750, 1200, 2600]],
          rasp: 0.1,
          volume: 0.35 * strength,
        });
      }, 80 + Math.random() * 500);
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
