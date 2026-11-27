// Prestandapanelen (F8). Avstängd som standard och kostar då nästan inget (bara tidtagning per bild).
// Värden som webbläsaren inte kan mäta säkert visas som "–" med en förklaring, aldrig som gissningar.
//
// Mäts:
//  FPS nu / snitt (10 s) / 1 % låg (den långsammaste procenten bilder de senaste 10 s)
//  Bildtid (ms mellan bilder), CPU-tid för spelets logik och för att skicka ritkommandon
//  GPU-tid via EXT_disjoint_timer_query_webgl2 (finns i Chrome/Edge på de flesta datorer, inte i Firefox/Safari)
//  Ritanrop och trianglar (three.js räknar alla pass: skuggor, scen, efterbehandling)
//  Ljus, skuggkartor, synliga objekt, partiklar, JS-minne (bara Chrome), nätverkets svarstid (ping till servern)

const HIST = 600; // bilder i historiken (10 s vid 60 bilder/s)

export class PerfOverlay {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.on = false;
    this.el = null;
    this.dt = new Float32Array(HIST); // ms mellan bilder
    this.cpuLogic = new Float32Array(HIST);
    this.cpuRender = new Float32Array(HIST);
    this.n = 0;
    this.i = 0;
    this.last = 0;
    this.t0 = 0;
    this.tLogic = 0;
    this.calls = 0;
    this.tris = 0;
    this.gpuMs = null;
    this.gpu = null;
    this.nextDraw = 0;
    this.countAt = 0;
    this.counts = { lights: 0, shadows: 0, meshes: 0 };
    this.extra = {}; // partiklar, ping o.d. (sätts från spelet)
    this.rec = null; // inspelning för tester (__perf.record)
  }

  toggle() {
    this.on = !this.on;
    if (this.on && !this.el) {
      this.el = document.createElement("div");
      this.el.id = "perf-overlay";
      document.body.appendChild(this.el);
      this.initGpu();
    }
    if (this.el) this.el.hidden = !this.on;
  }

  initGpu() {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension && gl.getExtension("EXT_disjoint_timer_query_webgl2");
    this.gpu = ext ? { gl, ext, pending: [], active: null } : false;
  }

  // Början på en bild
  begin() {
    const now = performance.now();
    if (this.last) {
      this.dt[this.i] = now - this.last;
      this.n = Math.min(HIST, this.n + 1);
    }
    this.last = now;
    this.t0 = now;
  }

  // Logiken klar, nu ritas bilden
  beginRender() {
    this.tLogic = performance.now();
    if (this.on && this.gpu) {
      const { gl, ext } = this.gpu;
      if (!this.gpu.active && this.gpu.pending.length < 4) {
        const q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        this.gpu.active = q;
      }
    }
  }

  end() {
    const now = performance.now();
    if (this.on && this.gpu && this.gpu.active) {
      const { gl, ext } = this.gpu;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      this.gpu.pending.push(this.gpu.active);
      this.gpu.active = null;
    }
    this.cpuLogic[this.i] = this.tLogic - this.t0;
    this.cpuRender[this.i] = now - this.tLogic;
    const r = this.renderer.info.render;
    this.calls = r.calls;
    this.tris = r.triangles;
    if (this.rec) this.rec.push([this.dt[this.i], this.cpuLogic[this.i], this.cpuRender[this.i], this.calls, this.tris]);
    this.i = (this.i + 1) % HIST;
    if (this.on) {
      this.pollGpu();
      if (now >= this.nextDraw) {
        this.nextDraw = now + 250;
        this.draw(now);
      }
    }
  }

  pollGpu() {
    const { gl, ext, pending } = this.gpu || {};
    if (!pending) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (pending.length) {
      const q = pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      pending.shift();
      if (!disjoint) {
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        this.gpuMs = this.gpuMs == null ? ns / 1e6 : this.gpuMs * 0.8 + (ns / 1e6) * 0.2;
      }
      gl.deleteQuery(q);
    }
  }

  stats() {
    const n = this.n;
    if (!n) return null;
    const arr = [];
    let sum = 0, lsum = 0, rsum = 0;
    for (let k = 0; k < n; k++) {
      const idx = (this.i - 1 - k + HIST * 2) % HIST;
      arr.push(this.dt[idx]);
      sum += this.dt[idx];
      lsum += this.cpuLogic[idx];
      rsum += this.cpuRender[idx];
    }
    // senaste halvsekunden för "nu"
    let recent = 0, rc = 0;
    for (let k = 0; k < n && recent < 500; k++) { recent += arr[k]; rc++; }
    const sorted = arr.slice().sort((a, b) => b - a);
    const worst = sorted.slice(0, Math.max(1, Math.floor(n / 100)));
    const worstAvg = worst.reduce((a, b) => a + b, 0) / worst.length;
    return {
      fps: (rc * 1000) / recent,
      avg: (n * 1000) / sum,
      low1: 1000 / worstAvg,
      frameMs: sum / n,
      maxMs: sorted[0],
      logicMs: lsum / n,
      renderMs: rsum / n,
    };
  }

  countScene(now) {
    if (now < this.countAt) return;
    this.countAt = now + 1000;
    let lights = 0, shadows = 0, meshes = 0;
    this.scene.traverseVisible((o) => {
      if (o.isLight && o.intensity > 0) {
        lights++;
        if (o.castShadow) shadows++;
      } else if (o.isMesh || o.isPoints || o.isSprite) meshes++;
    });
    this.counts = { lights, shadows, meshes };
  }

  draw(now) {
    const s = this.stats();
    if (!s) return;
    this.countScene(now);
    const mem = this.renderer.info.memory;
    const heap = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + " MB" : "– (bara Chrome)";
    const gpu = this.gpu === false ? "– (stöds inte här)" : this.gpuMs == null ? "mäter …" : this.gpuMs.toFixed(2) + " ms";
    const x = this.extra;
    const row = (k, v, cls = "") => `<div class="${cls}"><span>${k}</span><b>${v}</b></div>`;
    const fpsCls = s.fps >= 55 ? "ok" : s.fps >= 30 ? "warn" : "bad";
    this.el.innerHTML =
      `<h4>Prestanda <small>F8</small></h4>` +
      row("FPS nu", s.fps.toFixed(0), fpsCls) +
      row("FPS snitt (10 s)", s.avg.toFixed(0)) +
      row("1 % låg", s.low1.toFixed(0)) +
      row("Bildtid", `${s.frameMs.toFixed(1)} ms (max ${s.maxMs.toFixed(0)})`) +
      row("CPU logik", s.logicMs.toFixed(2) + " ms") +
      row("CPU ritning", s.renderMs.toFixed(2) + " ms") +
      row("GPU", gpu) +
      row("Ritanrop", this.calls) +
      row("Trianglar", (this.tris / 1000).toFixed(0) + " k") +
      row("Ljus / skuggkartor", `${this.counts.lights} / ${this.counts.shadows}`) +
      row("Synliga objekt", this.counts.meshes) +
      row("Partiklar", x.particles ?? "–") +
      row("Geometrier / texturer", `${mem.geometries} / ${mem.textures}`) +
      row("JS-minne", heap) +
      row("Grafikminne", "– (kan inte mätas i webbläsaren)") +
      row("Ping", x.ping != null ? x.ping.toFixed(0) + " ms" : "–") +
      (x.quality ? row("Grafik", x.quality) : "") +
      (x.res ? row("Upplösning", x.res) : "");
  }
}
