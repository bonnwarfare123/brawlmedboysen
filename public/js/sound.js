// LJUD – alla ljud skapas direkt i koden med webbläsarens ljudmotor (Web Audio).
// Inga ljudfiler behöver laddas ner. Ljud långt bort hörs svagare.
//
// Webbläsare tillåter bara ljud efter att man klickat på sidan, därför
// anropas unlock() när man klickar på "Skapa rum" / "Gå med".

export class Sound {
  constructor(muted = false) {
    this.ctx = null;
    this.master = null;
    this.muted = muted;
    this.listener = { x: 0, y: 0, z: 0 };
    this.noise = null;
  }

  unlock() {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.7;
        this.master.connect(this.ctx.destination);
        // En sekund brus som återanvänds till svisch, träffar och publik
        const length = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch {
      this.ctx = null; // ingen ljudmotor – spelet fungerar ändå
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.7;
  }

  setListener(x, y, z) {
    this.listener.x = x;
    this.listener.y = y;
    this.listener.z = z;
  }

  // Volym efter avstånd till kameran
  volumeAt(pos) {
    if (!pos) return 1;
    const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
    return 1 / (1 + d * 0.12);
  }

  ready() {
    return this.ctx && !this.muted;
  }

  // ---------- Byggstenar ----------

  gain(volume, start, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
    g.connect(this.master);
    return g;
  }

  noiseBurst({ volume, attack = 0.005, decay, type = "bandpass", freq, freqEnd = null, q = 1 }) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    if (freqEnd) filter.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    src.connect(filter);
    filter.connect(this.gain(volume, t, attack, decay));
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + decay + 0.05);
  }

  tone({ volume, type = "sine", freq, freqEnd = null, attack = 0.005, decay, delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    osc.connect(this.gain(volume, t, attack, decay));
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  // ---------- Spelets ljud ----------

  // Svärdet svischar genom luften
  swing(pos, heavy = false) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    this.noiseBurst({
      volume: 0.35 * v,
      attack: heavy ? 0.06 : 0.03,
      decay: heavy ? 0.22 : 0.14,
      freq: heavy ? 500 : 900,
      freqEnd: heavy ? 1800 : 2800,
      q: 2.5,
    });
  }

  // Svärd mot rustning och kött
  hit(pos, heavy = false) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    this.tone({ volume: (heavy ? 0.9 : 0.6) * v, freq: heavy ? 140 : 180, freqEnd: 45, decay: heavy ? 0.22 : 0.15 });
    this.noiseBurst({ volume: 0.5 * v, decay: 0.12, type: "lowpass", freq: 1400, freqEnd: 300, q: 0.7 });
    this.tone({ volume: 0.12 * v, type: "triangle", freq: 1900 + Math.random() * 400, decay: 0.08 }); // plåtklonk
  }

  // Lyckad parering: metallisk klang
  clang(pos) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    const base = 480 + Math.random() * 80;
    [1, 2.51, 4.07, 6.3].forEach((ratio, i) => {
      this.tone({ volume: (0.32 / (i + 1)) * v, type: "sine", freq: base * ratio, decay: 0.7 - i * 0.12 });
    });
    this.noiseBurst({ volume: 0.3 * v, decay: 0.05, type: "highpass", freq: 3000, q: 0.5 });
  }

  // En kroppsdel huggs av
  sever(pos) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    this.noiseBurst({ volume: 0.7 * v, attack: 0.01, decay: 0.35, type: "lowpass", freq: 2200, freqEnd: 250, q: 3 });
    this.tone({ volume: 0.5 * v, freq: 90, freqEnd: 40, decay: 0.3 });
  }

  // Ett riddar-"oof" när någon dör
  death(pos) {
    if (!this.ready()) return;
    const v = this.volumeAt(pos);
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    const pitch = 150 + Math.random() * 60;
    osc.frequency.setValueAtTime(pitch, t);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.55, t + 0.4);
    const formant = this.ctx.createBiquadFilter();
    formant.type = "bandpass";
    formant.frequency.setValueAtTime(750, t);
    formant.frequency.exponentialRampToValueAtTime(400, t + 0.4);
    formant.Q.value = 3;
    osc.connect(formant);
    formant.connect(this.gain(0.6 * v, t, 0.02, 0.4));
    osc.start(t);
    osc.stop(t + 0.5);
  }

  // Publiken jublar (styrka 0–1)
  crowd(strength = 1) {
    if (!this.ready()) return;
    this.noiseBurst({ volume: 0.18 * strength, attack: 0.25, decay: 1.6, freq: 1100, freqEnd: 800, q: 0.6 });
    this.noiseBurst({ volume: 0.1 * strength, attack: 0.3, decay: 1.3, freq: 2400, q: 1.2 });
  }

  // Nedräkning: 3, 2, 1 (låg) och STRID (hög)
  beep(go = false) {
    if (!this.ready()) return;
    this.tone({ volume: 0.3, type: "square", freq: go ? 880 : 520, decay: go ? 0.35 : 0.15 });
  }

  // Fanfar när någon vinner
  fanfare(big = false) {
    if (!this.ready()) return;
    const notes = big ? [523, 659, 784, 1047, 784, 1047] : [523, 659, 784];
    notes.forEach((f, i) => {
      this.tone({ volume: 0.18, type: "square", freq: f, decay: i === notes.length - 1 ? 0.5 : 0.12, delay: i * 0.13 });
    });
  }
}
