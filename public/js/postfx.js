// EFTERBEHANDLING AV BILDEN (bara på hög grafik, F2 stänger av)
//
// 1. Glöd: det som är riktigt ljust (eld, facklor, solblänk i rustningar) får ett mjukt sken runt sig.
//    Bilden krymps i flera steg (halv, fjärdedel ...) och förstoras sedan igen, så skenet blir mjukt och billigt.
// 2. Färgton: lite mer mättnad och kontrast, varmare på kvällen, gråare i regn, och mörkare hörn (vinjett).
//
// Allt är skrivet här (inga tillägg från three.js behövs).

import * as THREE from "three";

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Nedskalning: 4 punkter i en ruta (mjukt). Första steget plockar bara ut det ljusa (tröskel med mjuk kant).
const DOWN_FRAG = /* glsl */ `
  uniform sampler2D src;
  uniform vec2 texel;
  uniform float threshold;
  uniform float useThreshold;
  varying vec2 vUv;
  vec3 pick(vec2 uv) {
    vec3 c = texture2D(src, uv).rgb;
    if (useThreshold > 0.5) {
      float l = max(c.r, max(c.g, c.b));
      float knee = threshold * 0.3;
      float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee + 1e-4);
      float w = max(soft, l - threshold) / max(l, 1e-4);
      c *= w;
      c = min(c, vec3(8.0)); // inga enstaka superljusa prickar som blinkar
    }
    return c;
  }
  void main() {
    vec2 o = texel * 0.5;
    vec3 c = pick(vUv + vec2(-o.x, -o.y)) + pick(vUv + vec2(o.x, -o.y)) + pick(vUv + vec2(-o.x, o.y)) + pick(vUv + vec2(o.x, o.y));
    gl_FragColor = vec4(c * 0.25, 1.0);
  }
`;

// Uppskalning: 9 punkter (tält), läggs ovanpå nästa större steg
const UP_FRAG = /* glsl */ `
  uniform sampler2D src;
  uniform vec2 texel;
  uniform float radius;
  varying vec2 vUv;
  void main() {
    vec2 o = texel * radius;
    vec3 c = texture2D(src, vUv).rgb * 4.0;
    c += (texture2D(src, vUv + vec2(o.x, 0.0)).rgb + texture2D(src, vUv - vec2(o.x, 0.0)).rgb
        + texture2D(src, vUv + vec2(0.0, o.y)).rgb + texture2D(src, vUv - vec2(0.0, o.y)).rgb) * 2.0;
    c += texture2D(src, vUv + o).rgb + texture2D(src, vUv - o).rgb
       + texture2D(src, vUv + vec2(o.x, -o.y)).rgb + texture2D(src, vUv + vec2(-o.x, o.y)).rgb;
    gl_FragColor = vec4(c / 16.0, 1.0);
  }
`;

// Slutbilden: scenen + glöd, tonkurva (samma som spelet annars använder), sedan färgton och vinjett
const FINAL_FRAG = /* glsl */ `
  uniform sampler2D scene;
  uniform sampler2D bloom;
  uniform float strength;
  uniform float saturation, contrast, vignette;
  uniform vec3 tint, lift;
  varying vec2 vUv;
  void main() {
    vec3 hdr = texture2D(scene, vUv).rgb + texture2D(bloom, vUv).rgb * strength;
    gl_FragColor = vec4(hdr, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    vec3 col = gl_FragColor.rgb * tint;
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, saturation);
    col = (col - 0.5) * contrast + 0.5;
    col = col + lift * (1.0 - col);
    vec2 d = vUv - 0.5;
    col *= 1.0 - vignette * smoothstep(0.2, 0.9, dot(d, d) * 2.4);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

// Färgtoner för tid på dygnet och väder
const GRADES = {
  day: { saturation: 1.1, contrast: 1.05, tint: [1.02, 1.0, 0.965], lift: [0.0, 0.004, 0.012], vignette: 0.24, bloom: 0.3, threshold: 1.2 },
  evening: { saturation: 1.06, contrast: 1.07, tint: [1.07, 0.98, 0.9], lift: [0.02, 0.006, 0.03], vignette: 0.34, bloom: 0.6, threshold: 0.9 },
  rain: { saturation: 0.82, contrast: 1.04, tint: [0.95, 0.985, 1.03], lift: [0.012, 0.018, 0.03], vignette: 0.3, bloom: 0.3, threshold: 1.0 },
  fog: { saturation: 0.86, contrast: 0.97, tint: [0.99, 1.0, 1.02], lift: [0.03, 0.03, 0.035], vignette: 0.2, bloom: 0.4, threshold: 1.0 },
};

const LEVELS = 5;

// Samma tonkurva som three.js ACESFilmic (för att räkna baklänges, se skyColor nedan)
function aces(c, exposure) {
  const v = c.map((x) => (x * exposure) / 0.6);
  const i = [
    0.59719 * v[0] + 0.35458 * v[1] + 0.04823 * v[2],
    0.076 * v[0] + 0.90834 * v[1] + 0.01566 * v[2],
    0.0284 * v[0] + 0.13383 * v[1] + 0.83777 * v[2],
  ].map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  return [
    1.60475 * i[0] - 0.53108 * i[1] - 0.07367 * i[2],
    -0.10208 * i[0] + 1.10813 * i[1] - 0.00605 * i[2],
    -0.00327 * i[0] - 0.07276 * i[1] + 1.07602 * i[2],
  ].map((x) => Math.min(1, Math.max(0, x)));
}

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = true;
    // Scenen ritas först i en egen bild med kantutjämning och "mer än vitt" ljus
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.levels = Array.from({ length: LEVELS }, () => new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false }));
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    const mat = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
    this.down = mat(DOWN_FRAG, { src: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0.95 }, useThreshold: { value: 1 } });
    this.up = mat(UP_FRAG, { src: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 1.0 } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.final = mat(FINAL_FRAG, {
      scene: { value: this.target.texture },
      bloom: { value: this.levels[0].texture },
      strength: { value: 0.35 },
      saturation: { value: 1.1 },
      contrast: { value: 1.05 },
      tint: { value: new THREE.Vector3(1, 1, 1) },
      lift: { value: new THREE.Vector3() },
      vignette: { value: 0.25 },
    }, { toneMapped: true });
    this.setSize(window.innerWidth, window.innerHeight);
    this.setGrade("day");
  }

  setGrade(kind) {
    const g = GRADES[kind] || GRADES.day;
    const u = this.final.uniforms;
    u.saturation.value = g.saturation;
    u.contrast.value = g.contrast;
    u.tint.value.set(...g.tint);
    u.lift.value.set(...g.lift);
    u.vignette.value = g.vignette;
    u.strength.value = g.bloom;
    this.down.uniforms.threshold.value = g.threshold;
  }

  setSize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, size.x);
    const h = Math.max(1, size.y);
    this.target.setSize(w, h);
    this.levels.forEach((t, i) => t.setSize(Math.max(1, Math.round(w / 2 ** (i + 1))), Math.max(1, Math.round(h / 2 ** (i + 1)))));
  }

  skyColor(color, exposure) {
    const key = color.getHex() + ":" + exposure;
    this._skyCache ||= new Map();
    let out = this._skyCache.get(key);
    if (!out) {
      const want = [color.r, color.g, color.b];
      const c = want.slice();
      for (let k = 0; k < 40; k++) {
        const got = aces(c, exposure);
        for (let j = 0; j < 3; j++) c[j] = Math.max(0, c[j] + (want[j] - got[j]) * 1.2);
      }
      out = new THREE.Color(c[0], c[1], c[2]);
      if (this._skyCache.size > 64) this._skyCache.clear();
      this._skyCache.set(key, out);
    }
    return out;
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render() {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(this.scene, this.camera);
      return;
    }
    // Himlen går annars inte genom tonkurvan. Här gör den det, så vi väljer färger som
    // efter kurvan blir exakt samma himmel som utan efterbehandling (och lägger tillbaka dem efteråt).
    const exposure = r.toneMappingExposure;
    const bg = this.scene.background;
    const saved = [];
    if (bg && bg.isColor) saved.push([bg, bg.getHex()]);
    if (!this.skies || this.scene.children.length !== this._childCount) {
      this._childCount = this.scene.children.length;
      this.skies = [];
      this.scene.traverse((o) => o.userData.skyUniforms && this.skies.push(o.userData.skyUniforms));
    }
    for (const u of this.skies) for (const k of ["top", "horizon"]) if (u[k]) saved.push([u[k].value, u[k].value.getHex()]);
    for (const [c] of saved) c.copy(this.skyColor(c, exposure));
    r.setRenderTarget(this.target);
    r.render(this.scene, this.camera);
    for (const [c, hex] of saved) c.setHex(hex);
    const autoClear = r.autoClear;
    // Krymp i steg (första steget tar bara det ljusa)
    let src = this.target;
    for (let i = 0; i < LEVELS; i++) {
      this.down.uniforms.src.value = src.texture;
      this.down.uniforms.texel.value.set(1 / src.width, 1 / src.height);
      this.down.uniforms.useThreshold.value = i === 0 ? 1 : 0;
      this.pass(this.down, this.levels[i]);
      src = this.levels[i];
    }
    // Förstora igen och lägg ihop
    r.autoClear = false;
    for (let i = LEVELS - 1; i > 0; i--) {
      const s = this.levels[i];
      this.up.uniforms.src.value = s.texture;
      this.up.uniforms.texel.value.set(1 / s.width, 1 / s.height);
      this.pass(this.up, this.levels[i - 1]);
    }
    r.autoClear = autoClear;
    this.pass(this.final, null);
  }
}
