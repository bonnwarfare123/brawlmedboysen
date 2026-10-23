// YTSTRUKTURER – ritas direkt i koden (inga bildfiler behövs).
// Varje struktur ritas en gång och återanvänds av alla riddare.

import * as THREE from "three";

const cache = new Map();

function seeded(seed) {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function makeTexture(key, size, draw, repeat = [1, 1], srgb = true) {
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 4;
  cache.set(key, texture);
  return texture;
}

// Ringbrynja: rader av små ringar, varannan rad förskjuten
export function chainmailTexture() {
  return makeTexture("chain", 128, (ctx, n) => {
    ctx.fillStyle = "#3a3d42";
    ctx.fillRect(0, 0, n, n);
    const r = 5;
    for (let row = 0; row < n / (r * 1.5) + 1; row++) {
      for (let col = 0; col < n / (r * 2) + 1; col++) {
        const x = col * r * 2 + (row % 2) * r;
        const y = row * r * 1.5;
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = "#c9ced6";
        ctx.beginPath();
        ctx.arc(x, y, r - 1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.5)"; // glans överst på varje ring
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, r - 1.5, Math.PI * 1.1, Math.PI * 1.7);
        ctx.stroke();
      }
    }
  }, [5, 5]);
}

// Läder: brunt med repor, nötta ljusare fläckar och mörkare skuggor
export function leatherTexture() {
  return makeTexture("leather", 256, (ctx, n) => {
    const rand = seeded(11);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = rand() < 0.5 ? "rgba(0,0,0,0.07)" : "rgba(255,240,220,0.08)";
      ctx.beginPath();
      ctx.ellipse(rand() * n, rand() * n, 6 + rand() * 22, 4 + rand() * 14, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Repor
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = rand() < 0.7 ? "rgba(255,235,200,0.35)" : "rgba(0,0,0,0.3)";
      ctx.lineWidth = 0.6 + rand();
      const x = rand() * n;
      const y = rand() * n;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + (rand() - 0.5) * 20, y + (rand() - 0.5) * 20, x + (rand() - 0.5) * 40, y + (rand() - 0.5) * 40);
      ctx.stroke();
    }
    // Sömmar
    ctx.strokeStyle = "rgba(230,210,170,0.6)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    for (const y of [6, n / 2, n - 6]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(n, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }, [2, 2]);
}

// Vadderat tyg (bondens jacka): stickningar i rutor, smuts och lappar
export function quiltTexture() {
  return makeTexture("quilt", 256, (ctx, n) => {
    const rand = seeded(23);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, n, n);
    // Mjuka "kuddar" mellan stygnen
    const cell = 32;
    for (let y = 0; y < n; y += cell) {
      for (let x = 0; x < n; x += cell) {
        const g = ctx.createRadialGradient(x + cell / 2, y + cell / 2, 2, x + cell / 2, y + cell / 2, cell * 0.7);
        g.addColorStop(0, "rgba(255,255,255,0.15)");
        g.addColorStop(1, "rgba(0,0,0,0.18)");
        ctx.fillStyle = g;
        ctx.fillRect(x, y, cell, cell);
      }
    }
    // Stygn diagonalt
    ctx.strokeStyle = "rgba(90,70,40,0.55)";
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.2;
    for (let i = -n; i < n * 2; i += cell) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + n, n);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i, n);
      ctx.lineTo(i + n, 0);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Smutsfläckar
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(70,50,25,${0.08 + rand() * 0.15})`;
      ctx.beginPath();
      ctx.ellipse(rand() * n, rand() * n, 5 + rand() * 25, 4 + rand() * 15, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // En lapp med grova stygn
    ctx.fillStyle = "rgba(120,90,60,0.35)";
    ctx.fillRect(150, 40, 60, 50);
    ctx.strokeStyle = "rgba(40,30,20,0.8)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const t = i / 12;
      const px = 150 + t * 60;
      ctx.beginPath();
      ctx.moveTo(px, 36);
      ctx.lineTo(px + 3, 44);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px, 86);
      ctx.lineTo(px + 3, 94);
      ctx.stroke();
    }
  }, [2, 2]);
}

// Ylle (bondens byxor och benlindor): diagonala lindor
export function wrapTexture() {
  return makeTexture("wrap", 128, (ctx, n) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, n, n);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 3;
    for (let i = -n; i < n * 2; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + n * 0.5, n);
      ctx.stroke();
    }
    const rand = seeded(5);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rand() * 0.08})`;
      ctx.fillRect(rand() * n, rand() * n, 2, 2);
    }
  }, [2, 3]);
}

// Halm (halmhatten)
export function strawTexture() {
  return makeTexture("straw", 128, (ctx, n) => {
    const rand = seeded(31);
    ctx.fillStyle = "#d9bf6a";
    ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 300; i++) {
      ctx.strokeStyle = rand() < 0.5 ? "rgba(140,105,40,0.5)" : "rgba(255,240,170,0.5)";
      ctx.lineWidth = 1;
      const y = rand() * n;
      const x = rand() * n;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 10 + rand() * 20, y + (rand() - 0.5) * 3);
      ctx.stroke();
    }
  }, [3, 1]);
}

// Lätt slitage på metall: små repor och fläckar (används som ojämnhet i ytan)
export function metalWearTexture() {
  return makeTexture("metalwear", 256, (ctx, n) => {
    const rand = seeded(47);
    ctx.fillStyle = "#c8c8c8";
    ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 120; i++) {
      ctx.strokeStyle = rand() < 0.5 ? "rgba(255,255,255,0.6)" : "rgba(60,60,60,0.5)";
      ctx.lineWidth = 0.5 + rand();
      const x = rand() * n;
      const y = rand() * n;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 30);
      ctx.stroke();
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(90,90,90,${rand() * 0.3})`;
      ctx.beginPath();
      ctx.arc(rand() * n, rand() * n, 2 + rand() * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [2, 2], false);
}

// ---------- Vapenmönster (heraldik) på sköld och vapenrock ----------
// Mönstret bestäms av spelarens färg, så varje riddare får sin egen vapensköld.

const DIVISIONS = ["kors", "kvadrerad", "sparre", "ränder", "snedbalk", "kluven"];
const CHARGES = ["stjärna", "halvmåne", "kors", "ring", "lilja", "torn"];

function drawCharge(ctx, kind, cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (kind === "stjärna") {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.42 : r;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
  } else if (kind === "halvmåne") {
    ctx.arc(cx, cy, r, 0.3, Math.PI * 2 - 0.3);
    ctx.arc(cx + r * 0.45, cy, r * 0.78, Math.PI * 2 - 0.6, 0.6, true);
    ctx.closePath();
  } else if (kind === "kors") {
    const w = r * 0.32;
    ctx.rect(cx - w, cy - r, w * 2, r * 2);
    ctx.rect(cx - r, cy - w, r * 2, w * 2);
  } else if (kind === "ring") {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2, true);
  } else if (kind === "lilja") {
    // Förenklad lilja: tre blad och ett band
    ctx.ellipse(cx, cy - r * 0.35, r * 0.22, r * 0.65, 0, 0, Math.PI * 2);
    ctx.ellipse(cx - r * 0.45, cy - r * 0.05, r * 0.18, r * 0.5, -0.6, 0, Math.PI * 2);
    ctx.ellipse(cx + r * 0.45, cy - r * 0.05, r * 0.18, r * 0.5, 0.6, 0, Math.PI * 2);
    ctx.rect(cx - r * 0.5, cy + r * 0.25, r, r * 0.18);
  } else {
    // Torn
    ctx.rect(cx - r * 0.5, cy - r * 0.4, r, r * 1.3);
    for (let i = 0; i < 3; i++) ctx.rect(cx - r * 0.5 + i * r * 0.38, cy - r * 0.7, r * 0.24, r * 0.32);
  }
  ctx.fill("evenodd");
  ctx.stroke();
}

export function heraldryTexture(colorHex, variant = 0) {
  const key = `herald-${colorHex}-${variant}`;
  return makeTexture(key, 256, (ctx, n) => {
    const base = "#" + colorHex.toString(16).padStart(6, "0");
    const light = "#f2ecdc";
    const gold = "#d9a521";
    const pick = (colorHex >> 3) + variant * 7;
    const division = DIVISIONS[pick % DIVISIONS.length];
    const charge = CHARGES[(pick >> 2) % CHARGES.length];
    const second = colorHex === 0xe8e4da ? "#2a2a2e" : light;

    ctx.fillStyle = base;
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = second;
    if (division === "kors") {
      ctx.fillRect(n * 0.43, 0, n * 0.14, n);
      ctx.fillRect(0, n * 0.4, n, n * 0.14);
    } else if (division === "kvadrerad") {
      ctx.fillRect(n / 2, 0, n / 2, n / 2);
      ctx.fillRect(0, n / 2, n / 2, n / 2);
    } else if (division === "sparre") {
      ctx.beginPath();
      ctx.moveTo(0, n * 0.85);
      ctx.lineTo(n / 2, n * 0.35);
      ctx.lineTo(n, n * 0.85);
      ctx.lineTo(n, n);
      ctx.lineTo(n / 2, n * 0.55);
      ctx.lineTo(0, n);
      ctx.fill();
    } else if (division === "ränder") {
      for (let i = 1; i < 6; i += 2) ctx.fillRect((i * n) / 6, 0, n / 6, n);
    } else if (division === "snedbalk") {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(n * 0.25, 0);
      ctx.lineTo(n, n * 0.75);
      ctx.lineTo(n, n);
      ctx.lineTo(n * 0.75, n);
      ctx.lineTo(0, n * 0.25);
      ctx.fill();
    } else {
      ctx.fillRect(n / 2, 0, n / 2, n);
    }
    // Märket i mitten, i guld med svart kant
    const centred = division === "kors" || division === "kvadrerad" || division === "kluven";
    if (!centred || charge !== "kors") drawCharge(ctx, charge, n / 2, n * 0.47, n * 0.2, gold);

    // Slitage: repor och flagnad färg
    const rand = seeded(colorHex + variant);
    for (let i = 0; i < 50; i++) {
      ctx.strokeStyle = rand() < 0.6 ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)";
      ctx.lineWidth = 0.8 + rand() * 1.5;
      const x = rand() * n;
      const y = rand() * n;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 30);
      ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = "rgba(110,80,50,0.35)"; // träet syns där färgen flagnat
      ctx.beginPath();
      ctx.ellipse(rand() * n, rand() * n, 2 + rand() * 7, 2 + rand() * 4, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// ---------- Blodstänk på marken (flera varianter) ----------
export function splatterTexture(variant) {
  return makeTexture(`splat-${variant}`, 128, (ctx, n) => {
    const rand = seeded(100 + variant * 13);
    ctx.clearRect(0, 0, n, n);
    ctx.fillStyle = "#ffffff";
    const cx = n * 0.42;
    const cy = n / 2;
    // Huvudfläck med ojämn kant
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = n * (0.16 + rand() * 0.08);
      ctx.lineTo(cx + Math.cos(a) * r * 1.2, cy + Math.sin(a) * r);
    }
    ctx.fill();
    // Utdragna stänk åt höger (stänket flög åt det hållet) och små satellitdroppar
    for (let i = 0; i < 9; i++) {
      const a = (rand() - 0.5) * 1.4;
      const d = n * (0.22 + rand() * 0.25);
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      const r = 1.5 + rand() * 4;
      ctx.beginPath();
      ctx.ellipse(x, y, r * (1.5 + rand() * 2), r, a, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2;
      const d = n * (0.15 + rand() * 0.32);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.8 + rand() * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// Blodpöl: rund med mjuk kant
export function poolTexture() {
  // Blodpöl: oregelbunden form med mjuk kant, en mörkare intorkad rand och några små stänk runt om
  return makeTexture("pool2", 256, (ctx, n) => {
    const rand = seeded(77);
    ctx.clearRect(0, 0, n, n);
    const blob = (cx, cy, base, wobble, points = 40) => {
      ctx.beginPath();
      const phase = rand() * 6;
      for (let i = 0; i <= points; i++) {
        const a = (i / points) * Math.PI * 2;
        const r = base * (1 + Math.sin(a * 3 + phase) * wobble + Math.sin(a * 7 + phase * 2) * wobble * 0.4);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.fill();
    };
    // Mörk rand (färgen multipliceras med blodets färg, så grå = mörkare)
    ctx.filter = "blur(5px)";
    ctx.fillStyle = "rgb(120,120,120)";
    blob(n / 2, n / 2, n * 0.36, 0.13);
    for (let i = 0; i < 4; i++) blob(n / 2 + (rand() - 0.5) * n * 0.4, n / 2 + (rand() - 0.5) * n * 0.4, n * (0.1 + rand() * 0.08), 0.2, 20);
    // Blankare, ljusare mitt
    ctx.filter = "blur(8px)";
    ctx.fillStyle = "rgb(255,255,255)";
    blob(n / 2, n / 2, n * 0.3, 0.12);
    // Små stänk runt om
    ctx.filter = "blur(1.5px)";
    ctx.fillStyle = "rgb(110,110,110)";
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2;
      const r = n * (0.4 + rand() * 0.08);
      ctx.beginPath();
      ctx.arc(n / 2 + Math.cos(a) * r, n / 2 + Math.sin(a) * r, 1.5 + rand() * 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.filter = "none";
  });
}

// Fotspår: en spetsig sula med mjuk kant (svagt intryck i sanden, inte ett streck)
export function footprintTexture() {
  return makeTexture("footprint", 64, (ctx, n) => {
    ctx.clearRect(0, 0, n, n);
    const sole = (alpha, inset) => {
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(n / 2, n * 0.04 + inset);                                   // tåspets
      ctx.quadraticCurveTo(n * 0.7 - inset, n * 0.3, n * 0.66 - inset, n * 0.52);
      ctx.quadraticCurveTo(n * 0.62 - inset, n * 0.66, n * 0.64 - inset, n * 0.8);
      ctx.quadraticCurveTo(n * 0.64 - inset, n * 0.96 - inset, n / 2, n * 0.96 - inset); // häl
      ctx.quadraticCurveTo(n * 0.36 + inset, n * 0.96 - inset, n * 0.36 + inset, n * 0.8);
      ctx.quadraticCurveTo(n * 0.38 + inset, n * 0.66, n * 0.34 + inset, n * 0.52);
      ctx.quadraticCurveTo(n * 0.3 + inset, n * 0.3, n / 2, n * 0.04 + inset);
      ctx.fill();
    };
    sole(0.25, 0);
    sole(0.35, 2);
    sole(0.3, 4);
    // Häl och trampdyna trycks ner mer
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.ellipse(n / 2, n * 0.84, n * 0.1, n * 0.08, 0, 0, Math.PI * 2);
    ctx.ellipse(n / 2, n * 0.38, n * 0.11, n * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
  }, [1, 1], false);
}

// Tyg (mantlar): fin vävstruktur och mjuka veck
export function linenTexture() {
  return makeTexture("linen", 256, (ctx, n) => {
    const rand = seeded(61);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < n; i += 2) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.04})`;
      ctx.fillRect(0, i, n, 1);
      ctx.fillStyle = `rgba(0,0,0,${0.02 + rand() * 0.03})`;
      ctx.fillRect(i, 0, 1, n);
    }
    // Veck och nötta partier
    for (let i = 0; i < 14; i++) {
      const x = rand() * n;
      const g = ctx.createLinearGradient(x - 10, 0, x + 10, 0);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.5, `rgba(0,0,0,${0.05 + rand() * 0.08})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - 10, 0, 20, n);
    }
    // Kantband längst ner (på manteln)
    ctx.fillStyle = "rgba(255,230,160,0.35)";
    ctx.fillRect(0, n - 10, n, 5);
  }, [1, 1]);
}

// Tandad fåll (vapenrockens nederkant): vitt = tyg, svart = genomskinligt
export function daggedTexture() {
  return makeTexture("dagged", 128, (ctx, n) => {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, n, n * 0.86);
    // Rundade flikar ("dagging") längst ner
    const tabs = 6;
    for (let i = 0; i < tabs; i++) {
      const cx = ((i + 0.5) / tabs) * n;
      ctx.beginPath();
      ctx.ellipse(cx, n * 0.86, n / tabs / 2.4, n * 0.12, 0, 0, Math.PI);
      ctx.fill();
    }
  }, [1, 1], false);
}

// ---------- Arenan ----------

// Plankor med träådring och spikhål (läktare och barriär)
export function plankTexture() {
  return makeTexture("planks", 256, (ctx, n) => {
    const rand = seeded(83);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, n, n);
    const boards = 4;
    const h = n / boards;
    for (let b = 0; b < boards; b++) {
      const y0 = b * h;
      ctx.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.08})`; // varje planka har lite egen ton
      ctx.fillRect(0, y0, n, h);
      // Ådring: vågiga linjer längs plankan
      for (let i = 0; i < 9; i++) {
        ctx.strokeStyle = `rgba(60,35,15,${0.12 + rand() * 0.15})`;
        ctx.lineWidth = 0.6 + rand() * 1.2;
        const yy = y0 + 4 + rand() * (h - 8);
        ctx.beginPath();
        ctx.moveTo(0, yy);
        for (let x = 0; x <= n; x += 16) ctx.lineTo(x, yy + Math.sin(x * 0.05 + i) * 2 + (rand() - 0.5) * 1.5);
        ctx.stroke();
      }
      // Kvist
      if (rand() < 0.7) {
        ctx.fillStyle = "rgba(60,35,15,0.35)";
        ctx.beginPath();
        ctx.ellipse(rand() * n, y0 + h / 2, 6, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Fog mellan plankorna och spikar
      ctx.fillStyle = "rgba(30,18,8,0.55)";
      ctx.fillRect(0, y0, n, 2);
      ctx.fillStyle = "rgba(40,40,40,0.8)";
      for (const x of [10, n / 2, n - 10]) {
        ctx.beginPath();
        ctx.arc(x, y0 + h * 0.3, 1.6, 0, Math.PI * 2);
        ctx.arc(x, y0 + h * 0.7, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [2, 1]);
}

// Ränder i två färger (tyg på barriären och läktartaken). Lodräta ränder.
export function stripeTexture(colorA, colorB, stripes = 8) {
  return makeTexture(`stripes-${colorA}-${colorB}-${stripes}`, 256, (ctx, n) => {
    const a = "#" + colorA.toString(16).padStart(6, "0");
    const b = "#" + colorB.toString(16).padStart(6, "0");
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 ? b : a;
      ctx.fillRect((i * n) / stripes, 0, n / stripes + 1, n);
    }
    // Tygstruktur och skuggor i vecken
    const rand = seeded(colorA + 3);
    for (let y = 0; y < n; y += 2) {
      ctx.fillStyle = `rgba(0,0,0,${0.02 + rand() * 0.03})`;
      ctx.fillRect(0, y, n, 1);
    }
    for (let i = 0; i < stripes * 2; i++) {
      const x = ((i + 0.5) * n) / (stripes * 2);
      const g = ctx.createLinearGradient(x - 8, 0, x + 8, 0);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.5, "rgba(0,0,0,0.12)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - 8, 0, 16, n);
    }
  }, [1, 1]);
}

// Hermelin (vit päls med svarta svansspetsar) till kungens mantel
export function ermineTexture() {
  return makeTexture("ermine", 128, (ctx, n) => {
    ctx.fillStyle = "#f4f1ea";
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = "#151515";
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const cx = (x + (y % 2) * 0.5) * (n / 4) + 8;
        const cy = y * (n / 4) + 10;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - 4, cy + 12);
        ctx.lineTo(cx + 4, cy + 12);
        ctx.fill();
        ctx.fillRect(cx - 1, cy - 4, 2, 5);
      }
    }
  }, [2, 1]);
}

// Krattad sand: bågformade krattspår, halmstrån, småsten och gamla mörka fläckar
export function rakedSandTexture() {
  return makeTexture("sand", 512, (ctx, n) => {
    const rand = seeded(19);
    ctx.fillStyle = "#8f6e4b";
    ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = rand() < 0.5 ? "rgba(120,92,62,0.45)" : "rgba(160,128,92,0.4)";
      ctx.beginPath();
      ctx.ellipse(rand() * n, rand() * n, 4 + rand() * 16, 3 + rand() * 10, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Krattspår: grupper av parallella linjer
    for (let g = 0; g < 7; g++) {
      const y = rand() * n;
      const bend = (rand() - 0.5) * 60;
      for (let k = 0; k < 6; k++) {
        ctx.strokeStyle = k % 2 ? "rgba(70,50,30,0.22)" : "rgba(190,160,120,0.22)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-10, y + k * 5);
        ctx.quadraticCurveTo(n / 2, y + k * 5 + bend, n + 10, y + k * 5);
        ctx.stroke();
      }
    }
    // Halmstrån
    for (let i = 0; i < 90; i++) {
      ctx.strokeStyle = rand() < 0.5 ? "rgba(220,190,110,0.85)" : "rgba(190,160,80,0.8)";
      ctx.lineWidth = 1.2;
      const x = rand() * n;
      const y = rand() * n;
      const a = rand() * Math.PI;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * (6 + rand() * 10), y + Math.sin(a) * (6 + rand() * 10));
      ctx.stroke();
    }
    // Småsten
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = rand() < 0.5 ? "rgba(90,80,70,0.8)" : "rgba(180,170,150,0.8)";
      ctx.beginPath();
      ctx.arc(rand() * n, rand() * n, 0.8 + rand() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // Gamla, intorkade blodfläckar
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = "rgba(80,25,15,0.25)";
      ctx.beginPath();
      ctx.ellipse(rand() * n, rand() * n, 8 + rand() * 18, 6 + rand() * 12, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [6, 6]);
}

// Mjuk rund glöd (eld, ljus)
export function glowTexture() {
  return makeTexture("glow", 64, (ctx, n) => {
    const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.3, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
  });
}

// Fina sandkorn och små gropar (används som höjdkarta så sanden får struktur i ljuset)
export function sandGrainTexture() {
  return makeTexture("sandGrain", 256, (ctx, n) => {
    const rand = seeded(57);
    const img = ctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = 110 + rand() * 60;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // Små gropar och kullar (fotsteg, hovar, klumpar)
    for (let i = 0; i < 70; i++) {
      const x = rand() * n;
      const y = rand() * n;
      const r = 3 + rand() * 9;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rand() < 0.5;
      g.addColorStop(0, dark ? "rgba(40,40,40,0.5)" : "rgba(230,230,230,0.45)");
      g.addColorStop(1, "rgba(128,128,128,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Krattspår som höjdskillnad
    for (let k = 0; k < 10; k++) {
      ctx.strokeStyle = k % 2 ? "rgba(60,60,60,0.35)" : "rgba(210,210,210,0.3)";
      ctx.lineWidth = 3;
      const y = (k / 10) * n;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(n * 0.3, y + 6, n * 0.6, y - 6, n, y);
      ctx.stroke();
    }
  }, [1, 1], false);
}

// Siffra på prispallen: tyg i en färg med guldkant och en stor siffra.
// aspect = höjd/bredd för stegets framsida, så siffran inte blir hoptryckt.
export function podiumTexture(color, number, aspect = 1) {
  const w = 256;
  const h = Math.max(64, Math.round(w * aspect));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  const rand = seeded(5 + number);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rand() < 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.05)";
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1);
  }
  ctx.strokeStyle = "#d9a521";
  ctx.lineWidth = 10;
  ctx.strokeRect(7, 7, w - 14, h - 14);
  ctx.lineWidth = 2.5;
  ctx.strokeRect(20, 20, w - 40, h - 40);
  const size = Math.min(150, h * 0.62);
  ctx.font = `bold ${Math.round(size)}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillText(String(number), w / 2 + 4, h / 2 + size * 0.06 + 4);
  ctx.fillStyle = "#f0c53a";
  ctx.fillText(String(number), w / 2, h / 2 + size * 0.06);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
