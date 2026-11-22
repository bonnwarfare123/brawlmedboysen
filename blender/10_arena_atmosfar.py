# 10_arena_atmosfar.py – Kungaborgen: flaggor, banér, ljuskällor och miljödetaljer
#
# Kör i borg_aktuell.blend (Text Editor > Run Script). Skriptet kan köras om: allt nytt ligger i
# samlingen COL_Atmosfar och byggs om från början varje gång. De gamla facklorna och banéren som
# ersätts flyttas till COL_Atmosfar_Ersatta (utesluten, exporteras inte) och lämnas orörda där.
#
# Vad som görs
#   1. MAT_Tyg_Herald: en tygatlas (1024 px) med åtta vapen/banér i rött, guld, blått och vitt,
#      plus säckväv, rep och festongtyg. Målas här i skriptet (numpy) – inga nedladdningar.
#   2. Nya banér på tomma murpartier (hittas med strålar från arenan), stångflaggor runt planen,
#      vimpelrader längs läktartaken, festonger över entréer och på läktarna.
#   3. De gamla banéren och flaggorna byggs om med veck, ringar och vind-vikter (samma material).
#   4. Nya väggfacklor i smide (ersätter de gamla lådfacklorna på samma platser), fackelstolpar,
#      eldkorgar och hängande lyktor.
#   5. Vapensköldar på skranket och över portarna, järnbeslag på portar och dörrar.
#   6. Tunnor, lådor, säckar, rep, hö och vapenställ i små grupper vid förråd och rustplatser.
#
# Rörelse i spelet: tyg och lågor får färgattributet "Vind" (glTF COLOR_0):
#   R = hur fritt punkten rör sig (0 = fäst, 1 = fri kant), G = typ (0 hängande banér, 0,5 vimpel,
#   1 stångflagga), B = fas. Spelet (borg.js) rör hörnen i shadern – ingen Blender-simulering.
#
# Prestanda: ett enda nytt material (MAT_Tyg_Herald = ett nytt ritanrop i spelet). Allt annat
# använder borgens befintliga material. Upprepade föremål är länkade kopior (instanser).

import bpy
import bmesh
import math
import os
import random
import time
import importlib.util
import numpy as np
from mathutils import Vector, Matrix

SAML = "COL_Atmosfar"
ARKIV = "COL_Atmosfar_Ersatta"
ATLAS = "MAT_Tyg_Herald"
ATLAS_S = 1024
R = []
UP = Vector((0, 0, 1))

ERSATT = ["Facklor_Eld", "Fackelhallare_Lyktstolpar", "Port_Facklor", "Port_Fackelhallare",
          "Laktare_Facklor", "Laktare_Fackelhallare"]
GAMLA_TYG = ["Flagga_1", "Flagga_2", "Flagga_3", "Flagga_4", "Flagga_5",
             "Gonfalon_1", "Gonfalon_2", "Gonfalon_3", "Gonfalon_4",
             "Baner_Karntorn_1", "Baner_Karntorn_2", "Baner_Kungaloge_1", "Baner_Kungaloge_2",
             "Baner_Inre_Port", "Baner_Laktare_Ost_1", "Baner_Laktare_Ost_2",
             "Baner_Laktare_Vast_1", "Baner_Laktare_Vast_2"]


# =====================================================================
# 1. TYGATLAS
# =====================================================================
# Färger (sRGB)
ROD = (0.55, 0.09, 0.08)
ROD_M = (0.40, 0.06, 0.06)
GULD = (0.86, 0.64, 0.20)
BLA = (0.12, 0.20, 0.45)
VIT = (0.86, 0.82, 0.72)
SACK = (0.50, 0.40, 0.27)
REP = (0.62, 0.52, 0.36)

CELL_H = 448            # banérrutor: 4 x 2 rutor à 256 x 448 px, sedan en remsa 128 px med 8 småbitar


def cell_uv(i):
    """UV-rektangel (u0, v0, u1, v1) för banérruta i (0–7). v1 = överkant."""
    c, r = i % 4, i // 4
    top = r * CELL_H
    return (c * 0.25, 1 - (top + CELL_H) / ATLAS_S, c * 0.25 + 0.25, 1 - top / ATLAS_S)


def remsa_uv(k):
    """UV-rektangel för småbit k (0–7) i nedersta remsan: 0 säckväv, 1 rep, 2–7 festongtyg."""
    return (k * 0.125, 0.0, k * 0.125 + 0.125, 0.125)


def _poly(x, y, pts):
    """Udda-jämn-test: mask för polygon (pts i samma koordinater som x, y)."""
    m = np.zeros(x.shape, dtype=bool)
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if y1 == y2:
            continue
        c = ((y1 > y) != (y2 > y))
        xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
        m ^= c & (x < xi)
    return m


def _stjarna(cx, cy, r1, r2, n, rot=-math.pi / 2):
    return [(cx + (r1 if k % 2 == 0 else r2) * math.cos(rot + k * math.pi / n),
             cy + (r1 if k % 2 == 0 else r2) * math.sin(rot + k * math.pi / n)) for k in range(2 * n)]


def _brus(h, w, skala, seed):
    rng = np.random.default_rng(seed)
    gh, gw = max(2, int(h / skala) + 2), max(2, int(w / skala) + 2)
    g = rng.random((gh, gw)).astype(np.float32)
    yy = np.linspace(0, gh - 1.001, h)
    xx = np.linspace(0, gw - 1.001, w)
    y0, x0 = yy.astype(int), xx.astype(int)
    fy, fx = (yy - y0)[:, None], (xx - x0)[None, :]
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]; b = g[y0][:, x0 + 1]; c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


def _vapen(i, x, y):
    """Ritar banér i. x 0..1 över bredden, y i bredd-enheter nedåt (0..1,75). Returnerar färg, broderi-mask."""
    H = CELL_H / 256.0
    col = np.zeros(x.shape + (3,), dtype=np.float32)
    emb = np.zeros(x.shape, dtype=bool)
    ex, ey = (x - 0.5) / 0.36, (y - 0.5) / 0.36          # vapnets koordinater (mitt i övre kvadraten)

    def fyll(mask, f):
        col[mask] = f

    if i == 0:      # Kungens: rött, gyllene krona, tre guldband nertill
        fyll(np.ones_like(x, bool), ROD)
        krona = _poly(ex, ey, [(-0.62, 0.2), (-0.66, -0.45), (-0.33, -0.08), (0, -0.62), (0.33, -0.08),
                               (0.66, -0.45), (0.62, 0.2)])
        krona |= (np.abs(ex) < 0.64) & (ey > 0.18) & (ey < 0.42)
        for px_, py_ in [(-0.66, -0.5), (0, -0.68), (0.66, -0.5)]:
            krona |= (ex - px_) ** 2 + (ey - py_) ** 2 < 0.1 ** 2
        emb |= krona
        band = np.zeros_like(emb)
        for yb in (1.18, 1.3, 1.42):
            band |= np.abs(y - yb) < 0.025
        emb |= band
        fyll(emb, GULD)
    elif i == 1:    # blått med gyllene sol
        fyll(np.ones_like(x, bool), BLA)
        r = np.sqrt(ex ** 2 + ey ** 2)
        sol = r < 0.34
        sol |= _poly(ex, ey, _stjarna(0, 0, 0.78, 0.36, 16))
        emb |= sol
        fyll(emb, GULD)
        ring = (r > 0.25) & (r < 0.29)
        fyll(ring, (0.70, 0.46, 0.10))
    elif i == 2:    # vitt med rött kors
        fyll(np.ones_like(x, bool), VIT)
        kors = (np.abs(x - 0.5) < 0.09) | (np.abs(y - 0.5) < 0.09)
        fyll(kors, ROD)
        emb |= kors
    elif i == 3:    # guld med två röda sparrar
        fyll(np.ones_like(x, bool), GULD)
        for a in (0.42, 0.78):
            s = y - (a - 0.55 * np.abs(x - 0.5))
            sp = (s > 0) & (s < 0.15)
            fyll(sp, ROD)
            emb |= sp
    elif i == 4:    # blått med liljor
        fyll(np.ones_like(x, bool), BLA)

        def lilja(cx, cy, sk):
            u, v = (x - cx) / sk, (y - cy) / sk
            m = _poly(u, v, [(0, -0.75), (0.18, -0.35), (0.12, 0.1), (0, 0.25), (-0.12, 0.1), (-0.18, -0.35)])
            for sg in (1, -1):
                m |= _poly(sg * u, v, [(0.1, 0.14), (0.2, -0.12), (0.34, -0.3), (0.52, -0.38), (0.68, -0.3), (0.72, -0.12),
                                       (0.64, 0.06), (0.58, -0.08), (0.5, -0.18), (0.38, -0.12), (0.28, 0.02), (0.24, 0.14)])
            m |= (np.abs(u) < 0.38) & (v > 0.12) & (v < 0.25)
            m |= _poly(u, v, [(-0.26, 0.25), (0.26, 0.25), (0.16, 0.56), (0, 0.38), (-0.16, 0.56)])
            return m
        li = lilja(0.5, 0.5, 0.36) | lilja(0.27, 1.05, 0.17) | lilja(0.73, 1.05, 0.17) | lilja(0.5, 1.4, 0.17)
        fyll(li, GULD)
        emb |= li
    elif i == 5:    # rött och guld i stolpar, blått huvud med tre stjärnor
        rand_ = (np.floor(x * 6) % 2) == 0
        fyll(rand_, ROD)
        fyll(~rand_, GULD)
        hv = y < 0.3
        fyll(hv, BLA)
        st = np.zeros_like(emb)
        for cx in (0.22, 0.5, 0.78):
            st |= _poly(x, y, _stjarna(cx, 0.15, 0.1, 0.04, 5))
        fyll(st, GULD)
        emb |= st
    elif i == 6:    # kluvet blått/vitt med gyllene borg
        fyll(x < 0.5, BLA)
        fyll(x >= 0.5, VIT)
        borg = (np.abs(ex) < 0.55) & (ey > -0.2) & (ey < 0.55)
        for mx in (-0.45, -0.15, 0.15, 0.45):
            borg |= (np.abs(ex - mx) < 0.1) & (ey > -0.42) & (ey <= -0.2)
        borg |= (np.abs(ex) < 0.2) & (ey > -0.62) & (ey <= -0.2)
        port = ((ex ** 2 + (ey - 0.25) ** 2 < 0.16 ** 2) | ((np.abs(ex) < 0.16) & (ey > 0.25))) & (ey < 0.55)
        fyll(borg & ~port, GULD)
        fyll(borg & port, (0.10, 0.08, 0.07))
        emb |= borg
    else:           # rött med vit bjälke snett
        fyll(np.ones_like(x, bool), ROD_M)
        s = (y - x * 1.0)
        bj = np.abs(s - 0.0) < 0.13
        fyll(bj, VIT)
        emb |= bj
        st = _poly(x, y, _stjarna(0.5, 1.2, 0.16, 0.065, 5))
        fyll(st, GULD)
        emb |= st

    # bård (inte i överkanten – där sitter fållen)
    kant = 0.05
    inne = (x > kant) & (x < 1 - kant) & (y < H - kant)
    bard = ~inne & ((x > 0.015) & (x < 0.985)) & (y < H - 0.015)
    bfarg = ROD if i in (2, 3) else GULD
    if i == 6:
        bfarg = ROD
    col[bard] = bfarg
    emb |= bard
    return col, emb, inne


def bygg_atlas(texmapp):
    ss = 2
    S = ATLAS_S * ss
    C = np.zeros((S, S, 3), dtype=np.float32)
    E = np.zeros((S, S), dtype=np.float32)     # broderi/bård (upphöjt, lite blankare)
    G = np.zeros((S, S), dtype=np.float32)     # fålla/söm (nedsänkt)
    # --- banérrutor ---
    for i in range(8):
        c, r = i % 4, i // 4
        y0, x0 = r * CELL_H * ss, c * 256 * ss
        h, w = CELL_H * ss, 256 * ss
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        x = (xx + 0.5) / w
        y = (yy + 0.5) / w
        col, emb, inne = _vapen(i, x, y)
        # söm innanför bården och fålla i överkanten
        H = CELL_H / 256.0
        som = (np.abs(x - 0.062) < 0.004) | (np.abs(x - 0.938) < 0.004) | (np.abs(y - (H - 0.062)) < 0.004)
        som &= (y > 0.06)
        fall = y < 0.06
        col[som] *= 0.55
        col[fall] *= 0.82
        C[y0:y0 + h, x0:x0 + w] = col
        E[y0:y0 + h, x0:x0 + w] = emb
        G[y0:y0 + h, x0:x0 + w] = som * 1.0 + (np.abs(y - 0.06) < 0.006)
    # --- remsan: säckväv, rep, festongtyg ---
    ry0 = 2 * CELL_H * ss
    tw = 128 * ss
    for k in range(8):
        x0 = k * tw
        yy, xx = np.mgrid[0:tw, 0:tw].astype(np.float32)
        x, y = (xx + 0.5) / tw, (yy + 0.5) / tw
        if k == 0:      # säckväv
            vav = 0.5 + 0.5 * np.sin(xx * math.pi / 3.0) * np.sin(yy * math.pi / 3.0)
            col = np.array(SACK) * (0.82 + 0.3 * vav)[..., None]
            G[ry0:ry0 + tw, x0:x0 + tw] = vav * 0.6
        elif k == 1:    # rep (snodda trådar snett)
            s = np.sin((x * 6 + y * 6) * math.pi * 2)
            col = np.array(REP) * (0.75 + 0.3 * (0.5 + 0.5 * s))[..., None]
            G[ry0:ry0 + tw, x0:x0 + tw] = 0.5 - 0.5 * s
        else:           # festongtyg: färgfält med guld-/rödfrans nertill
            fält = {2: ROD, 3: BLA, 4: GULD, 5: VIT, 6: ROD, 7: BLA}[k]
            frans = {2: GULD, 3: GULD, 4: ROD, 5: ROD, 6: GULD, 7: VIT}[k]
            col = np.zeros((tw, tw, 3), dtype=np.float32) + np.array(fält)
            if k in (6, 7):     # randigt
                rand_ = (np.floor(x * 4) % 2) == 1
                col[rand_] = np.array(GULD if k == 6 else VIT)
            fr = y > 0.80
            col[fr] = np.array(frans) * (0.75 + 0.25 * (np.sin(x * math.pi * 48) > 0))[..., None][fr]
            bandm = (y > 0.74) & (y < 0.80)
            col[bandm] = np.array(frans)
            E[ry0:ry0 + tw, x0:x0 + tw] = (fr | bandm)
            G[ry0:ry0 + tw, x0:x0 + tw] = (np.abs(y - 0.06) < 0.01) * 1.0
        C[ry0:ry0 + tw, x0:x0 + tw] = col
    # --- tygets struktur, smuts och slitage (hela bilden) ---
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    vav = 0.5 + 0.5 * np.sin(xx * math.pi / 2.0) * np.sin(yy * math.pi / 2.0)
    flack = _brus(S, S, 90, 3) * 0.6 + _brus(S, S, 25, 4) * 0.4
    C *= (0.9 + 0.12 * flack + 0.04 * vav)[..., None]
    # slitage mot kanterna i varje banérruta: mörkare och lite blekt, nedre kanten smutsigast
    for i in range(8):
        c, r = i % 4, i // 4
        y0, x0 = r * CELL_H * ss, c * 256 * ss
        h, w = CELL_H * ss, 256 * ss
        yl = (np.arange(h, dtype=np.float32)[:, None] + 0.5) / h
        xl = (np.arange(w, dtype=np.float32)[None, :] + 0.5) / w
        kant = np.minimum(np.minimum(xl, 1 - xl) * 4, 1.0)
        ner = np.clip((yl - 0.78) / 0.22, 0, 1)
        n = _brus(h, w, 14, 10 + i)
        slit = (1 - kant) * (0.5 + 0.5 * n) * 0.35 + ner * (0.25 + 0.2 * n)
        blek = C[y0:y0 + h, x0:x0 + w].mean(axis=2, keepdims=True)
        blk = C[y0:y0 + h, x0:x0 + w]
        blk[:] = blk * (1 - slit[..., None] * 0.55) + blek * slit[..., None] * 0.25
    # --- ner till 1024 (kantutjämning) ---
    def ner(a):
        sh = a.shape
        return a.reshape(sh[0] // ss, ss, sh[1] // ss, ss, *sh[2:]).mean(axis=(1, 3))
    C1 = np.clip(ner(C), 0, 1)
    E1 = ner(E)
    G1 = ner(G)
    V1 = ner(vav)
    # roughness: tyg 0,9, broderi 0,6
    Rr = np.clip(0.9 - 0.3 * E1 + 0.05 * (V1 - 0.5), 0.3, 1.0)
    # höjd → normal map (halv upplösning)
    hgt = 0.6 * E1 - 0.8 * G1 + 0.25 * V1
    h2 = ner_halv(hgt)
    gy, gx = np.gradient(h2)
    st = 3.0
    nx, ny = -gx * st, gy * st       # bildens y går nedåt, UV v uppåt
    nz = np.ones_like(nx)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    N = np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], axis=-1)
    R2 = ner_halv(Rr)
    # Blender-bilder har första raden nederst: vänd
    bilder = {}
    bilder["C"] = skriv_bild(f"T_{ATLAS}_C", np.flipud(C1), False, texmapp)
    bilder["R"] = skriv_bild(f"T_{ATLAS}_R", np.flipud(np.repeat(R2[..., None], 3, axis=2)), True, texmapp)
    bilder["N"] = skriv_bild(f"T_{ATLAS}_N", np.flipud(N), True, texmapp)
    return bilder


def ner_halv(a):
    sh = a.shape
    return a.reshape(sh[0] // 2, 2, sh[1] // 2, 2, *sh[2:]).mean(axis=(1, 3))


def skriv_bild(namn, rgb, data, texmapp):
    h, w = rgb.shape[:2]
    px = np.ones((h, w, 4), dtype=np.float32)
    px[..., :3] = rgb
    img = bpy.data.images.get(namn)
    if img is not None and tuple(img.size) != (w, h):
        bpy.data.images.remove(img)
        img = None
    if img is None:
        img = bpy.data.images.new(namn, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if data else "sRGB"
    img.pixels.foreach_set(np.clip(px, 0, 1).ravel())
    img.filepath_raw = os.path.join(texmapp, f"{namn}.png")
    img.file_format = "PNG"
    img.save()
    img.reload()
    return img


def atlas_material(bilder):
    m = bpy.data.materials.get(ATLAS) or bpy.data.materials.new(ATLAS)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    ut = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs[0], ut.inputs["Surface"])

    def tex(img):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        nt.links.new(tc.outputs["UV"], n.inputs["Vector"])
        return n
    nt.links.new(tex(bilder["C"]).outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex(bilder["R"]).outputs["Color"], bsdf.inputs["Roughness"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex(bilder["N"]).outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = 0.5
    m.use_backface_culling = False
    for k, v in {"typ": "tyg", "tile_u": 1.0, "tile_v": 1.0, "uv01": True, "bake_res": ATLAS_S,
                 "varld_smuts": 0.0, "varld_mossa": False, "trappa": False, "arena": False,
                 "varm_ljus": False, "bk_kalla": "atlas (skript 10)"}.items():
        m[k] = v
    return m


# =====================================================================
# 2. MESH-BYGGARE
# =====================================================================
class Bygg:
    """Samlar hörn, ytor, UV, material och vind-färg till ett mesh."""

    def __init__(self, namn):
        self.namn = namn
        self.V, self.F, self.UV, self.FM, self.W = [], [], [], [], []
        self.mats = []
        self.smooth = []

    def mat(self, namn):
        m = bpy.data.materials.get(namn)
        if m is None:
            raise RuntimeError(f"material saknas: {namn}")
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def vert(self, p, w=(0.0, 0.0, 0.0)):
        self.V.append(Vector(p))
        self.W.append(w)
        return len(self.V) - 1

    def face(self, idx, uvs, mi, smooth=False):
        self.F.append(list(idx))
        self.UV.append(list(uvs))
        self.FM.append(mi)
        self.smooth.append(smooth)

    # ---- enkla former med UV i meter (borgens kakelmaterial) ----
    def lada(self, c, storlek, mtx, mat):
        """Låda: centrum c, storlek (sx, sy, sz) i lokala axlar, mtx = 3x3 rotation."""
        mi = self.mat(mat)
        sx, sy, sz = (s / 2 for s in storlek)
        hörn = [Vector((x, y, z)) for x in (-sx, sx) for y in (-sy, sy) for z in (-sz, sz)]
        P = [self.vert(Vector(c) + mtx @ h) for h in hörn]
        ytor = [(0, 1, 3, 2, "x"), (4, 6, 7, 5, "x"), (0, 4, 5, 1, "y"), (2, 3, 7, 6, "y"), (0, 2, 6, 4, "z"), (1, 5, 7, 3, "z")]
        for a, b, cc, d, ax in ytor:
            ids = [P[a], P[b], P[cc], P[d]]
            uv = []
            for k in (a, b, cc, d):
                h = hörn[k]
                if ax == "x":
                    uv.append((h.y + sy, h.z + sz))
                elif ax == "y":
                    uv.append((h.x + sx, h.z + sz))
                else:
                    uv.append((h.x + sx, h.y + sy))
            self.face(ids, uv, mi)

    def cyl(self, p0, p1, r0, r1, seg, mat, lock=(False, False), w0=None, w1=None, smooth=True):
        mi = self.mat(mat)
        p0, p1 = Vector(p0), Vector(p1)
        ax = (p1 - p0)
        L = ax.length
        ax.normalize()
        t = ax.orthogonal().normalized()
        b = ax.cross(t)
        ring0, ring1 = [], []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            d = t * math.cos(a) + b * math.sin(a)
            ring0.append(self.vert(p0 + d * r0, w0 or (0, 0, 0)))
            ring1.append(self.vert(p1 + d * r1, w1 or (0, 0, 0)))
        omk = 2 * math.pi * max(r0, r1)
        for k in range(seg):
            k2 = (k + 1) % seg
            u0, u1 = omk * k / seg, omk * (k + 1) / seg
            self.face([ring0[k], ring0[k2], ring1[k2], ring1[k]], [(u0, 0), (u1, 0), (u1, L), (u0, L)], mi, smooth)
        if lock[0]:
            self.face(list(reversed(ring0)), [(0, 0)] * seg, mi)
        if lock[1]:
            self.face(ring1, [(0, 0)] * seg, mi)

    def svarv(self, bas, profil, seg, mat, w=None, vrid=0.0, smooth=True, skala_xy=(1.0, 1.0), lut=None):
        """Rotationskropp: profil = [(radie, höjd)], bas = punkt. w(höjdandel) -> vind-färg."""
        mi = self.mat(mat)
        bas = Vector(bas)
        hmax = max(h for _, h in profil) or 1.0
        ringar = []
        for j, (r, h) in enumerate(profil):
            ring = []
            for k in range(seg):
                a = 2 * math.pi * k / seg + vrid * h
                p = bas + Vector((math.cos(a) * r * skala_xy[0], math.sin(a) * r * skala_xy[1], h))
                if lut is not None:
                    p = p + Vector(lut) * (h / hmax) ** 2
                ring.append(self.vert(p, w(h / hmax) if w else (0, 0, 0)))
            ringar.append(ring)
        for j in range(len(profil) - 1):
            for k in range(seg):
                k2 = (k + 1) % seg
                a, b = ringar[j], ringar[j + 1]
                self.face([a[k], a[k2], b[k2], b[k]],
                          [(k / seg, profil[j][1]), ((k + 1) / seg, profil[j][1]), ((k + 1) / seg, profil[j + 1][1]), (k / seg, profil[j + 1][1])],
                          mi, smooth)

    def objekt(self, saml, plats=None):
        if not self.V:
            return None
        me = bpy.data.meshes.new(self.namn)
        me.from_pydata([tuple(v) for v in self.V], [], self.F)
        for m in self.mats:
            me.materials.append(m)
        uvl = me.uv_layers.new(name="UVMap")
        uvdata = [c for f in self.UV for c in f]
        uvl.data.foreach_set("uv", [x for c in uvdata for x in c])
        me.polygons.foreach_set("material_index", self.FM)
        me.polygons.foreach_set("use_smooth", self.smooth)
        if any(any(w) for w in self.W):
            ca = me.color_attributes.new("Vind", "FLOAT_COLOR", "POINT")
            ca.data.foreach_set("color", [x for w in self.W for x in (w[0], w[1], w[2], 1.0)])
            me.color_attributes.active_color = ca
            me.color_attributes.render_color_index = 0
        me.validate(clean_customdata=False)
        me.update()
        o = bpy.data.objects.new(self.namn, me)
        saml.objects.link(o)
        return o


def ram(n):
    """Lokala axlar för något som sitter på en vägg med normalen n: (höger, upp, ut)."""
    n = Vector((n.x, n.y, 0)).normalized()
    hoger = (-n).cross(UP).normalized()
    return hoger, UP.copy(), n


# =====================================================================
# 3. TYG: banér, flaggor, vimplar, festonger
# =====================================================================
def tyg_yta(B, mi_namn, nx, ny, pos_fn, uv_fn, w_fn, smooth=True):
    """Rutnät (nx x ny) där pos_fn(s, t), uv_fn(s, t), w_fn(s, t) ger hörnen. s 0..1 bredd, t 0..1 nedåt."""
    mi = B.mat(mi_namn)
    idx = [[B.vert(pos_fn(i / nx, j / ny), w_fn(i / nx, j / ny)) for i in range(nx + 1)] for j in range(ny + 1)]
    for j in range(ny):
        for i in range(nx):
            s0, s1, t0, t1 = i / nx, (i + 1) / nx, j / ny, (j + 1) / ny
            B.face([idx[j][i], idx[j + 1][i], idx[j + 1][i + 1], idx[j][i + 1]],
                   [uv_fn(s0, t0), uv_fn(s0, t1), uv_fn(s1, t1), uv_fn(s1, t0)], mi, smooth)


def kant_profil(form, djup):
    """Nederkantens längd som andel: s -> faktor (1 = full längd)."""
    if form == "svans":
        return lambda s: 1 - djup * (1 - abs(2 * s - 1))
    if form == "spets":
        return lambda s: 1 - djup * abs(2 * s - 1)
    return lambda s: 1.0


def cell_mapp(cell, proportion=None):
    """UV i banérruta. proportion = höjd/bredd: övre kvadraten (vapnet) får rätt form,
    resten av banéret delar på resten av rutan."""
    u0, v0, u1, v1 = cell_uv(cell)
    cw = u1 - u0
    H = CELL_H / 256.0

    def ty(t):
        if not proportion:
            return t * H
        y = t * proportion
        if y <= 1.0 or proportion <= 1.0:
            return min(y, H)
        return 1.0 + (y - 1.0) * (H - 1.0) / (proportion - 1.0)
    return lambda s, t: (u0 + 0.004 + s * (cw - 0.008), v1 - 0.003 - ty(t) * (cw - 0.004))


def cell_mapp_vriden(cell):
    """För stångflaggor: flaggans längd går nedåt i rutan, höjden tvärs – vapnet hamnar vid stången."""
    u0, v0, u1, v1 = cell_uv(cell)
    return lambda s, t: (u0 + 0.02 + t * (u1 - u0 - 0.04), v1 - 0.01 - s * (v1 - v0 - 0.02))


def baner_vagg(B, topp, n, bredd, hojd, cell, form="svans", seed=0, avstand=0.13, stang=True, typ=0.0):
    """Stort hängande banér på en vägg, med järnstång, konsoler och hällor."""
    rng = random.Random(seed)
    h_, u_, n_ = ram(n)
    prof = kant_profil(form, 0.16)
    fas = rng.random()
    veck_k = rng.choice((2.0, 2.5, 3.0))
    veck_f = rng.random() * 6.28

    def pos(s, t):
        tt = t * prof(s)
        veck = (0.012 + 0.045 * tt) * math.sin(2 * math.pi * veck_k * s + veck_f + tt * 0.8)
        buk = 0.03 * math.sin(math.pi * s) * tt
        bredd_t = 1 + 0.03 * tt
        return Vector(topp) + h_ * ((s - 0.5) * bredd * bredd_t) - u_ * (tt * hojd) + n_ * (avstand + veck + buk)

    uvf = cell_mapp(cell, hojd / bredd)
    tyg_yta(B, ATLAS, 6, 12, pos, lambda s, t: uvf(s, t * prof(s)), lambda s, t: (t * prof(s), typ, fas))
    # hällor runt stången
    if stang:
        mi = B.mat(ATLAS)
        hy = 0.075
        for k in range(5):
            s = 0.06 + 0.88 * k / 4
            bx = 0.05
            p = Vector(topp) + h_ * ((s - 0.5) * bredd) + n_ * avstand
            a = [p - h_ * bx, p + h_ * bx, p + h_ * bx + u_ * hy, p - h_ * bx + u_ * hy]
            b = [x + n_ * (-0.05) for x in a[2:]]
            ids = [B.vert(x) for x in a] + [B.vert(x) for x in b]
            uvp = uvf(s, 0.0)
            B.face([ids[0], ids[1], ids[2], ids[3]], [uvp] * 4, mi)
            B.face([ids[3], ids[2], ids[4], ids[5]], [uvp] * 4, mi)
        # järnstång med knoppar, två konsoler in i väggen
        y = Vector(topp) + u_ * (hy - 0.01) + n_ * (avstand - 0.025)
        a, b = y - h_ * (bredd / 2 + 0.1), y + h_ * (bredd / 2 + 0.1)
        B.cyl(a, b, 0.017, 0.017, 6, "MAT_Metall_Jarn")
        for p in (a, b):
            B.svarv(p - Vector((0, 0, 0.035)), [(0.0, 0.0), (0.03, 0.02), (0.035, 0.035), (0.02, 0.06), (0.0, 0.075)], 6, "MAT_Metall_Jarn")
        for p in (a + h_ * 0.06, b - h_ * 0.06):
            B.lada(p - n_ * (avstand / 2), (0.025, 0.025, avstand), Matrix((h_, u_, n_)).transposed(), "MAT_Metall_Jarn")


def stangflagga(B, fäste, rikt, langd, hojd, uv_fn, seed=0, form="svans", typ=1.0):
    """Flagga som sitter i en stång och vajar ut åt 'rikt' (vågrät)."""
    rng = random.Random(seed)
    r = Vector((rikt.x, rikt.y, 0)).normalized()
    sida = UP.cross(r).normalized()
    fas = rng.random()
    prof = kant_profil(form, 0.3)       # svans i fria änden

    def pos(s, t):
        ss = s * prof(t)
        vag = math.sin(ss * math.pi * 3.2 + fas * 6.28) * 0.13 * ss + math.sin(t * 2.5 + ss * 4) * 0.03 * ss
        hang = 0.12 * ss * ss
        return Vector(fäste) + r * (ss * langd) - UP * (t * hojd + hang) + sida * vag

    tyg_yta(B, ATLAS, 10, 4, pos, lambda s, t: uv_fn(s * prof(t), t), lambda s, t: (s * prof(t), typ, fas))


def flaggstang(B, fot, hojd, seed):
    fot = Vector(fot)
    B.lada(fot + Vector((0, 0, 0.2)), (0.5, 0.5, 0.4), Matrix.Identity(3), "MAT_Sten_Huggen")
    B.cyl(fot + Vector((0, 0, 0.35)), fot + Vector((0, 0, hojd)), 0.075, 0.055, 8, "MAT_Tra_Konstruktion")
    topp = fot + Vector((0, 0, hojd))
    B.svarv(topp, [(0.06, 0.0), (0.06, 0.04), (0.0, 0.04)], 8, "MAT_Metall_Jarn", smooth=False)
    B.svarv(topp + Vector((0, 0, 0.04)), [(0.0, 0.0), (0.05, 0.03), (0.055, 0.07), (0.03, 0.11), (0.01, 0.14), (0.0, 0.32)], 8, "MAT_Metall_Jarn")
    for k in range(3):
        z = 0.6 + k * 0.08
        B.cyl(fot + Vector((0, 0, z)), fot + Vector((0, 0, z + 0.03)), 0.08, 0.08, 8, "MAT_Metall_Jarn")
    return topp


def rep(B, punkter, r=0.009):
    ru = remsa_uv(1)
    mi = B.mat(ATLAS)
    for a, b in zip(punkter[:-1], punkter[1:]):
        ax = (b - a)
        L = ax.length
        ax.normalize()
        t = ax.orthogonal().normalized()
        bb = ax.cross(t)
        ra = [B.vert(a + (t * math.cos(k * math.pi / 2) + bb * math.sin(k * math.pi / 2)) * r) for k in range(4)]
        rb = [B.vert(b + (t * math.cos(k * math.pi / 2) + bb * math.sin(k * math.pi / 2)) * r) for k in range(4)]
        for k in range(4):
            k2 = (k + 1) % 4
            B.face([ra[k], ra[k2], rb[k2], rb[k]],
                   [(ru[0] + 0.03 * k, 0.02), (ru[0] + 0.03 * k + 0.03, 0.02), (ru[0] + 0.03 * k + 0.03, 0.02 + min(L, 1) * 0.08), (ru[0] + 0.03 * k, 0.02 + min(L, 1) * 0.08)], mi)


def kedjelinje(a, b, sank, n):
    a, b = Vector(a), Vector(b)
    return [a.lerp(b, k / n) - UP * (sank * 4 * (k / n) * (1 - k / n)) for k in range(n + 1)]


def vimpelrad(B, a, b, sank, seed, farger=(2, 4, 3, 5)):
    rng = random.Random(seed)
    L = (Vector(b) - Vector(a)).length
    n = max(2, int(L / 0.42))
    pts = kedjelinje(a, b, sank, max(8, n))
    rep(B, pts)
    lin = kedjelinje(a, b, sank, n)
    mi = B.mat(ATLAS)
    for k in range(n):
        p0, p1 = lin[k], lin[k + 1]
        mitt = (p0 + p1) / 2
        tang = (p1 - p0).normalized()
        bred = 0.3
        q0, q1 = mitt - tang * bred / 2, mitt + tang * bred / 2
        ner = Vector((0, 0, -1))
        sida = tang.cross(ner).normalized()
        spets = mitt + ner * (0.42 + rng.uniform(-0.03, 0.03)) + sida * rng.uniform(-0.04, 0.04)
        fas = rng.random()
        u0, v0, u1, v1 = remsa_uv(farger[k % len(farger)])
        i0 = B.vert(q0, (0, 0.5, fas))
        i1 = B.vert(q1, (0, 0.5, fas))
        i2 = B.vert(spets, (1, 0.5, fas))
        B.face([i0, i2, i1], [(u0 + 0.01, v1 - 0.01), ((u0 + u1) / 2, v1 - 0.09), (u1 - 0.01, v1 - 0.01)], mi)


def festong(B, a, b, djup, n, kakel, seed=0, avstand=0.04):
    """Draperi som hänger i en båge mellan a och b på en yta med normalen n."""
    rng = random.Random(seed)
    a, b = Vector(a), Vector(b)
    n = Vector((n.x, n.y, 0)).normalized()
    u0, v0, u1, v1 = remsa_uv(kakel)
    fas = rng.random()
    L = (b - a).length

    def pos(s, t):
        bage = djup * math.sin(math.pi * s) * t
        topp = a.lerp(b, s) - UP * (0.015 * math.sin(math.pi * s))
        veck = 0.025 * math.sin(s * math.pi * max(4, round(L * 4))) * t * math.sin(math.pi * s)
        return topp - UP * (0.12 * t + bage) + n * (avstand + veck + 0.05 * math.sin(math.pi * s) * t)

    def uv(s, t):
        return (u0 + 0.003 + s * (u1 - u0 - 0.006) * min(1.0, L / 1.2), v1 - 0.004 - t * (v1 - v0 - 0.008))

    tyg_yta(B, ATLAS, max(6, int(L * 6)), 4, pos, uv, lambda s, t: (t * 0.4, 0.0, fas))


def skold(B, mitt, n, storlek, cell, tjock=0.03, kant_mat="MAT_Metall_Jarn"):
    """Sköld (normandisk/'heater') mot en yta. Framsidan visar vapnet i cellens övre kvadrat."""
    h_, u_, n_ = ram(n)
    w = storlek
    # kontur i (x, y), y nedåt, x 0..1 över bredden: rak överkant, raka sidor, rundad spets
    kont = [(k / 4, 0.0) for k in range(5)] + [(1.0, 0.22), (1.0, 0.45)]
    for k in range(1, 6):
        a = k / 6 * math.pi / 2
        kont.append((0.5 + 0.5 * math.cos(a), 0.45 + 0.7 * math.sin(a)))
    kont.append((0.5, 1.15))
    for k in range(5, 0, -1):
        a = k / 6 * math.pi / 2
        kont.append((0.5 - 0.5 * math.cos(a), 0.45 + 0.7 * math.sin(a)))
    kont += [(0.0, 0.45), (0.0, 0.22)]
    u0, v0, u1, v1 = cell_uv(cell)
    cw = u1 - u0
    mi = B.mat(ATLAS)
    mitt = Vector(mitt)
    c3 = mitt + n_ * (tjock + 0.03)
    def p3(x, y, bulge=True):
        r2 = (x - 0.5) ** 2 * 4 + (y - 0.5) ** 2 * 2
        return mitt + h_ * ((x - 0.5) * w) - u_ * ((y - 0.55) * w) + n_ * (tjock + (0.025 * max(0, 1 - r2) if bulge else 0))
    ci = B.vert(p3(0.5, 0.5))

    def uvp(x, y):
        return (u0 + (0.01 + x * 0.98) * cw, v1 - (y * 0.8 + 0.1) * cw)
    ring = [B.vert(p3(x, y)) for x, y in kont]
    for k in range(len(kont)):
        k2 = (k + 1) % len(kont)
        B.face([ci, ring[k2], ring[k]], [uvp(0.5, 0.5), uvp(*kont[k2]), uvp(*kont[k])], mi)
    # kant och baksida
    mk = B.mat(kant_mat)
    bak = [B.vert(p3(x, y, False) - n_ * tjock) for x, y in kont]
    for k in range(len(kont)):
        k2 = (k + 1) % len(kont)
        B.face([ring[k], ring[k2], bak[k2], bak[k]], [(0, 0), (0.1, 0), (0.1, 0.03), (0, 0.03)], mk)


# =====================================================================
# 4. LJUSKÄLLOR: väggfackla, fackelstolpe, eldkorg, lykta
# =====================================================================
def lagor(B, bas, hojd, seed, antal=1, bredd=1.0):
    """Lågor: en huvudtunga och mindre tungor runt om, alla lutar lite åt olika håll."""
    rng = random.Random(seed)
    fas = rng.random()
    r0 = 0.06 * bredd
    for k in range(antal):
        if k == 0:
            off = Vector((0, 0, 0))
            h, r = hojd, r0
        else:
            a = 2 * math.pi * (k - 1) / max(1, antal - 1) + rng.uniform(-0.4, 0.4)
            off = Vector((math.cos(a), math.sin(a), 0)) * r0 * rng.uniform(0.7, 1.0)
            h, r = hojd * rng.uniform(0.5, 0.75), r0 * rng.uniform(0.55, 0.7)
        lut = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.12 * h + off * 0.5
        B.svarv(Vector(bas) + off, [(r * 0.7, 0.0), (r, 0.1 * h), (r * 0.9, 0.3 * h), (r * 0.55, 0.55 * h), (r * 0.25, 0.8 * h), (0.0, h)],
                5, "MAT_Eld", w=lambda f, fs=fas + k * 0.37: (f, 0.0, fs % 1.0), vrid=3.0 + k, smooth=True, lut=lut)


def eld_material_blender():
    """MAT_Eld i Blender: gul nertill, orange mot spetsen (färgattributet Vind = höjd i lågan).
    Spelet använder sitt eget eldmaterial (borg.js) med samma övergång."""
    m = bpy.data.materials.get("MAT_Eld")
    if m is None:
        return
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "Vind"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(at.outputs["Color"], sep.inputs[0])
    cr = nt.nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.elements[0].color = (1.0, 0.78, 0.38, 1)
    cr.color_ramp.elements[1].position = 1.0
    cr.color_ramp.elements[1].color = (0.95, 0.22, 0.04, 1)
    mid = cr.color_ramp.elements.new(0.45)
    mid.color = (1.0, 0.5, 0.12, 1)
    nt.links.new(sep.outputs[0], cr.inputs["Fac"])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 2.5
    nt.links.new(cr.outputs["Color"], em.inputs["Color"])
    ut = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], ut.inputs["Surface"])


def vaggfackla(B, vagg, n, seed):
    h_, u_, n_ = ram(n)
    M = Matrix((h_, u_, n_)).transposed()
    p = Vector(vagg)
    # väggplatta med spetsar uppe och nere
    B.lada(p + n_ * 0.012, (0.09, 0.30, 0.024), M, "MAT_Metall_Jarn")
    for sg in (1, -1):
        B.svarv(p + n_ * 0.012 + u_ * (0.15 * sg), [(0.045, 0.0), (0.0, 0.07 * sg)], 4, "MAT_Metall_Jarn", smooth=False)
    # arm och hållarring
    hp = p + n_ * 0.17 + u_ * 0.02
    B.lada(p + n_ * 0.09 + u_ * 0.02, (0.025, 0.025, 0.16), M, "MAT_Metall_Jarn")
    B.cyl(hp - u_ * 0.015, hp + u_ * 0.015, 0.042, 0.042, 6, "MAT_Metall_Jarn")
    # skaft (lutar lite ut) och korg
    lut = (u_ + n_ * 0.18).normalized()
    s0 = hp - lut * 0.2
    s1 = hp + lut * 0.14
    B.cyl(s0, s1, 0.022, 0.032, 6, "MAT_Tra_Konstruktion", lock=(True, False))
    B.cyl(s1, s1 + lut * 0.025, 0.04, 0.04, 6, "MAT_Metall_Jarn")
    a1, a2 = h_, lut.cross(h_).normalized()
    kb, kt = s1 + lut * 0.025, s1 + lut * 0.16
    for k in range(4):
        a = 2 * math.pi * k / 4 + math.pi / 4
        d = a1 * math.cos(a) + a2 * math.sin(a)
        B.cyl(kb + d * 0.045, kt + d * 0.072, 0.009, 0.009, 4, "MAT_Metall_Jarn", smooth=False)
    B.cyl(s1 + lut * 0.15, s1 + lut * 0.165, 0.074, 0.074, 6, "MAT_Metall_Jarn")
    bas = s1 + lut * 0.06
    lagor(B, bas, 0.36, seed, antal=1, bredd=1.15)
    return bas + UP * 0.15


def fackelstolpe(B, fot, hojd, seed):
    fot = Vector(fot)
    B.lada(fot + Vector((0, 0, 0.04)), (0.34, 0.34, 0.08), Matrix.Identity(3), "MAT_Metall_Jarn")
    B.lada(fot + Vector((0, 0, hojd / 2)), (0.07, 0.07, hojd), Matrix.Identity(3), "MAT_Metall_Jarn")
    for sg in (1, -1):
        for ax in (0, 1):
            d = Vector((sg, 0, 0)) if ax == 0 else Vector((0, sg, 0))
            B.cyl(fot + Vector((0, 0, 0.5)) , fot + d * 0.2 + Vector((0, 0, 0.06)), 0.015, 0.015, 4, "MAT_Metall_Jarn", smooth=False)
    topp = fot + Vector((0, 0, hojd))
    korg(B, topp, 0.17, 0.2, seed, lagh=0.5)
    return topp + Vector((0, 0, 0.3))


def korg(B, bas, r, h, seed, lagh=0.55, staver=8):
    bas = Vector(bas)
    B.cyl(bas, bas + Vector((0, 0, 0.03)), r * 0.45, r * 0.5, 8, "MAT_Metall_Jarn", lock=(True, True))
    for k in range(staver):
        a = 2 * math.pi * k / staver
        d = Vector((math.cos(a), math.sin(a), 0))
        B.cyl(bas + d * r * 0.45, bas + d * r + Vector((0, 0, h)), 0.011, 0.011, 4, "MAT_Metall_Jarn", smooth=False)
    B.cyl(bas + Vector((0, 0, h - 0.012)), bas + Vector((0, 0, h + 0.012)), r + 0.01, r + 0.01, 10, "MAT_Metall_Jarn")
    B.cyl(bas + Vector((0, 0, 0.04)), bas + Vector((0, 0, h * 0.5)), r * 0.5, r * 0.75, 8, "MAT_Metall_Jarn", lock=(False, True))
    lagor(B, bas + Vector((0, 0, h * 0.5)), lagh, seed, antal=2, bredd=r / 0.09)


def eldkorg(B, fot, seed):
    fot = Vector(fot)
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.3
        d = Vector((math.cos(a), math.sin(a), 0))
        B.cyl(fot + d * 0.42, fot + d * 0.24 + Vector((0, 0, 0.78)), 0.02, 0.022, 5, "MAT_Metall_Jarn")
        B.svarv(fot + d * 0.42, [(0.04, 0.0), (0.03, 0.03), (0.0, 0.03)], 5, "MAT_Metall_Jarn", smooth=False)
    B.cyl(fot + Vector((0, 0, 0.36)), fot + Vector((0, 0, 0.38)), 0.33, 0.33, 10, "MAT_Metall_Jarn")
    skal = fot + Vector((0, 0, 0.74))
    B.svarv(skal, [(0.10, 0.0), (0.28, 0.06), (0.36, 0.2), (0.39, 0.24), (0.36, 0.24), (0.32, 0.2)], 10, "MAT_Metall_Jarn")
    B.cyl(skal + Vector((0, 0, 0.17)), skal + Vector((0, 0, 0.18)), 0.30, 0.30, 10, "MAT_Metall_Jarn", lock=(False, True))
    lagor(B, skal + Vector((0, 0, 0.16)), 0.62, seed, antal=3, bredd=2.4)
    return skal + Vector((0, 0, 0.5))


def lykta(B, krok, n_kedja, seed):
    """Hängande smideslykta: krok = punkten i taket den hänger i."""
    krok = Vector(krok)
    z = krok.copy()
    for k in range(n_kedja):
        rot = Matrix.Rotation(math.pi / 2 * (k % 2), 3, "Z")
        B.lada(z - UP * 0.04, (0.035, 0.008, 0.07), rot, "MAT_Metall_Jarn")
        z -= UP * 0.06
    B.cyl(z - UP * 0.02, z, 0.025, 0.025, 6, "MAT_Metall_Jarn")
    topp = z - UP * 0.02
    B.svarv(topp - UP * 0.11, [(0.13, 0.0), (0.13, 0.015), (0.0, 0.11)], 4, "MAT_Metall_Jarn", smooth=False, vrid=0)
    kropp_ö = topp - UP * 0.11
    kropp_n = kropp_ö - UP * 0.30
    rot45 = Matrix.Rotation(math.pi / 4, 3, "Z")
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        d = Vector((math.cos(a), math.sin(a), 0)) * 0.12
        B.lada((kropp_ö + kropp_n) / 2 + d, (0.022, 0.022, 0.30), rot45, "MAT_Metall_Jarn")
    B.lada(kropp_n - UP * 0.015, (0.2, 0.2, 0.03), Matrix.Identity(3), "MAT_Metall_Jarn")
    B.lada((kropp_ö + kropp_n) / 2, (0.15, 0.15, 0.26), Matrix.Identity(3), "MAT_Fonster_Varm")
    B.svarv(kropp_n - UP * 0.08, [(0.0, 0.0), (0.04, 0.05), (0.05, 0.065)], 4, "MAT_Metall_Jarn", smooth=False)
    return (kropp_ö + kropp_n) / 2


# =====================================================================
# 5. MILJÖFÖREMÅL
# =====================================================================
def sack(B, fot, seed, storlek=1.0):
    rng = random.Random(seed)
    prof = [(0.12, 0.0), (0.2, 0.06), (0.23, 0.2), (0.21, 0.36), (0.15, 0.46), (0.06, 0.52), (0.07, 0.6), (0.0, 0.62)]
    prof = [(r * storlek * rng.uniform(0.93, 1.07), h * storlek) for r, h in prof]
    mi = B.mat(ATLAS)
    start = len(B.V)
    B.svarv(fot, prof, 8, ATLAS, skala_xy=(1.0, rng.uniform(0.75, 0.9)))
    u0, v0, u1, v1 = remsa_uv(0)
    for fi in range(len(B.F) - 8 * (len(prof) - 1), len(B.F)):
        B.UV[fi] = [(u0 + (u1 - u0) * min(1, max(0, uu)), v0 + (v1 - v0) * min(1, max(0, vv / 0.7))) for uu, vv in B.UV[fi]]
        B.FM[fi] = mi
    for k in range(start, len(B.V)):
        B.V[k] = B.V[k] + Vector((rng.uniform(-0.012, 0.012), rng.uniform(-0.012, 0.012), 0))


def repring(B, fot, seed):
    mi = B.mat(ATLAS)
    u0, v0, u1, v1 = remsa_uv(1)
    fot = Vector(fot)
    for lag in range(3):
        R0, r = 0.22 - lag * 0.012, 0.03
        z = 0.03 + lag * 0.05
        seg, sseg = 14, 4
        ids = []
        for i in range(seg):
            a = 2 * math.pi * i / seg + lag * 0.3
            c = fot + Vector((math.cos(a) * R0, math.sin(a) * R0, z))
            d = Vector((math.cos(a), math.sin(a), 0))
            ids.append([B.vert(c + (d * math.cos(b) + UP * math.sin(b)) * r) for b in (2 * math.pi * j / sseg for j in range(sseg))])
        for i in range(seg):
            i2 = (i + 1) % seg
            for j in range(sseg):
                j2 = (j + 1) % sseg
                B.face([ids[i][j], ids[i2][j], ids[i2][j2], ids[i][j2]],
                       [(u0 + 0.12 * i / seg, v0 + 0.03 * j), (u0 + 0.12 * (i + 1) / seg, v0 + 0.03 * j),
                        (u0 + 0.12 * (i + 1) / seg, v0 + 0.03 * (j + 1)), (u0 + 0.12 * i / seg, v0 + 0.03 * (j + 1))], mi, True)


def hostack(B, fot, seed):
    rng = random.Random(seed)
    B.svarv(fot, [(0.45, 0.0), (0.5, 0.15), (0.45, 0.4), (0.3, 0.62), (0.12, 0.75), (0.0, 0.78)], 9, "MAT_Ho",
            skala_xy=(1.0, rng.uniform(0.8, 1.0)), vrid=0.4)


def ovningsstall(B, fot, rikt, seed):
    """Ställ med träsvärd och två sköldar (träningsvapen)."""
    rng = random.Random(seed)
    r = Vector((rikt.x, rikt.y, 0)).normalized()
    s = UP.cross(r)
    M = Matrix((r, s, UP)).transposed()
    fot = Vector(fot)
    for sg in (-1, 1):
        B.lada(fot + r * (0.75 * sg) + UP * 0.6, (0.07, 0.07, 1.2), M, "MAT_Tra_Konstruktion")
        B.lada(fot + r * (0.75 * sg) + UP * 0.03, (0.08, 0.45, 0.06), M, "MAT_Tra_Konstruktion")
    B.lada(fot + UP * 1.12, (1.6, 0.06, 0.07), M, "MAT_Tra_Konstruktion")
    B.lada(fot + UP * 0.35 + s * 0.12, (1.5, 0.05, 0.05), M, "MAT_Tra_Konstruktion")
    for k in range(5):
        x = -0.55 + k * 0.27
        lut = Matrix.Rotation(rng.uniform(-0.08, 0.08), 3, "Y") @ Matrix.Rotation(0.18, 3, "X")
        bas = fot + r * x + s * 0.08 + UP * 0.02
        Mr = M @ lut
        B.lada(bas + Mr @ Vector((0, 0, 0.42)), (0.055, 0.018, 0.78), Mr, "MAT_Tra_Konstruktion")
        B.lada(bas + Mr @ Vector((0, 0, 0.82)), (0.2, 0.04, 0.035), Mr, "MAT_Tra_Konstruktion")
        B.lada(bas + Mr @ Vector((0, 0, 0.93)), (0.035, 0.03, 0.2), Mr, "MAT_Tra_Konstruktion")
    for k, sg in enumerate((-1, 1)):
        skold(B, fot + r * (0.4 * sg) - s * 0.06 + UP * 0.78, -s, 0.48, cell=(rng.randrange(8)), tjock=0.025, kant_mat="MAT_Tra_Konstruktion")


def beslag(B, p, h_, u_, n_, langd, seed):
    """Smitt gångjärnsband på en dörr: p = startpunkt på dörrytan, h_ = riktning längs bandet."""
    M = Matrix((h_, u_, n_)).transposed()
    B.lada(p + h_ * (langd / 2) + n_ * 0.012, (langd, 0.065, 0.016), M, "MAT_Metall_Jarn")
    slut = p + h_ * langd + n_ * 0.012
    B.lada(slut + h_ * 0.01, (0.07, 0.11, 0.016), M @ Matrix.Rotation(math.pi / 4, 3, "Z"), "MAT_Metall_Jarn")


# =====================================================================
# 6. SCENEN: strålar och fri yta
# =====================================================================
class Scen:
    def __init__(self, undanta):
        self.sc = bpy.context.scene
        self.dg = bpy.context.evaluated_depsgraph_get()
        self.undanta = set(undanta)

    def stråle(self, org, rikt, dist=50.0):
        org = Vector(org)
        rikt = Vector(rikt).normalized()
        for _ in range(6):
            hit, loc, nor, idx, ob, _m = self.sc.ray_cast(self.dg, org, rikt, distance=dist)
            if not hit:
                return None
            if ob.name in self.undanta or (ob.users_collection and ob.users_collection[0].name in (SAML, ARKIV)):
                dist -= (loc - org).length + 0.002
                org = loc + rikt * 0.002
                continue
            mat = None
            try:
                ev = ob.evaluated_get(self.dg)
                mi = ev.data.polygons[idx].material_index
                mat = ev.material_slots[mi].material.name if ev.material_slots and ev.material_slots[mi].material else None
            except Exception:
                pass
            return loc, nor, ob.name, mat
        return None

    def mark(self, x, y, z0=6.0):
        h = self.stråle((x, y, z0), (0, 0, -1), 20)
        return h

    def fri(self, x, y, r, hojd=2.0):
        """Är golvet plant och fritt i en cirkel med radien r?"""
        c = self.mark(x, y)
        if not c or c[1].z < 0.9:
            return None
        z = c[0].z
        for k in range(8):
            a = 2 * math.pi * k / 8
            h = self.mark(x + math.cos(a) * r, y + math.sin(a) * r)
            if not h or abs(h[0].z - z) > 0.08 or h[1].z < 0.9:
                return None
        for zz in (0.25, 0.9, hojd * 0.9):
            for k in range(8):
                a = 2 * math.pi * k / 8
                if self.stråle((x, y, z + zz), (math.cos(a), math.sin(a), 0), r):
                    return None
        if self.stråle((x, y, z + 0.1), (0, 0, 1), hojd):
            return None
        return z


def hitta_fri(S, x, y, r, hojd, maxd=0.9):
    for d in [0.0] + [0.15 * k for k in range(1, int(maxd / 0.15) + 1)]:
        steg = 1 if d == 0 else max(6, int(2 * math.pi * d / 0.15))
        for k in range(steg):
            a = 2 * math.pi * k / steg
            xx, yy = x + math.cos(a) * d, y + math.sin(a) * d
            z = S.fri(xx, yy, r, hojd)
            if z is not None:
                return xx, yy, z
    return None


def murplatser(S, bef, antal=10):
    """Letar tomma, plana stenmurar som syns från arenan."""
    kand = []
    for vp in [(0, 0, 1.7), (8, 3, 1.7), (-8, 3, 1.7), (0, -6, 1.7), (0, 7, 1.7), (9, -6, 1.7), (-9, -6, 1.7)]:
        for az in range(0, 360, 3):
            for el in (8, 14, 20, 27, 34, 42):
                a, e = math.radians(az), math.radians(el)
                d = Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e)))
                h = S.stråle(vp, d, 45)
                if not h:
                    continue
                p, n, ob, mat = h
                if not mat or "Sten" not in mat or abs(n.z) > 0.12:
                    continue
                if p.z < 6.0 or p.z > 17.0 or (p - Vector(vp)).length < 12:
                    continue
                if n.dot((Vector(vp) - p).normalized()) < 0.55:
                    continue
                kand.append((p.copy(), Vector((n.x, n.y, 0)).normalized()))
    valda = []
    rng = random.Random(5)
    rng.shuffle(kand)
    kand.sort(key=lambda c: -c[0].z)
    for p, n in kand:
        if any((p - q).length < 6.5 for q, *_ in valda) or any((p - q).length < 4 for q in bef):
            continue
        hojd = 4.4 if p.z > 11 else 3.6
        bredd = 1.5 if hojd > 4 else 1.3
        topp = p + UP * 1.2
        if topp.z - hojd < 3.0:
            continue
        h_, u_, n_ = ram(n)
        ok = True
        for s in (-0.6, 0.0, 0.6):
            for t in (-0.05, 0.25, 0.5, 0.75, 1.0):
                q = topp + h_ * (s * bredd * 1.1) - UP * (t * hojd) + n_ * 0.6
                hh = S.stråle(q, -n_, 1.0)
                if not hh or abs((hh[0] - q).length - 0.6) > 0.09 or hh[1].dot(n_) < 0.96 or not hh[3] or "Sten" not in hh[3]:
                    ok = False
                    break
            if not ok:
                break
        if not ok:
            continue
        # inget framför banéret (tak, läktare)
        for t in (0.2, 0.6, 0.95):
            if S.stråle(topp - UP * (t * hojd) + n_ * 0.15, n_, 2.5):
                ok = False
        if ok:
            valda.append((p, n, topp, bredd, hojd))
        if len(valda) >= antal:
            break
    return valda


# =====================================================================
# 7. GAMLA BANÉR – nya med veck, samma material och UV
# =====================================================================
def bygg_om_baner(o, S, saml):
    me = o.data
    mw = o.matrix_world
    P = np.array([tuple(mw @ v.co) for v in me.vertices])
    mn, mx = P.min(axis=0), P.max(axis=0)
    ext = mx - mn
    loops = me.loops
    uvl = me.uv_layers.active
    if uvl is None:
        return None
    L = np.array([tuple(mw @ me.vertices[l.vertex_index].co) for l in loops])
    UVs = np.array([tuple(uvl.data[i].uv) for i in range(len(loops))])
    vertikal = ext[2] > max(ext[0], ext[1]) * 0.9
    tunn = 0 if ext[0] < ext[1] else 1
    lang = 1 - tunn
    c = (mn + mx) / 2
    mat = me.materials[0].name
    hojd = ext[2]
    if vertikal:
        # var sitter väggen?
        n = None
        for sg in (1, -1):
            d = Vector((0, 0, 0))
            d[tunn] = sg
            h = S.stråle(Vector(c) - d * 0.02, -d, 0.6)
            if h:
                n = d
                break
        fritt = n is None
        if fritt:
            d = Vector((0, 0, 0))
            d[tunn] = 1 if -c[tunn] > 0 else -1
            n = d
        h_, u_, n_ = ram(n)
        s_of = lambda p: (np.dot(p - c, np.array(h_)) / ext[lang] + 0.5)
        t_of = lambda p: (mx[2] - p[..., 2]) / hojd
        bredd = ext[lang]
    else:
        # vågrät flagga: hitta stången
        st = bpy.data.objects.get("Flaggstanger")
        stp = np.array([tuple(st.matrix_world @ v.co) for v in st.data.vertices]) if st else np.zeros((1, 3))
        nara = stp[(np.abs(stp[:, 2] - c[2]) < 2.0)]
        dl = np.abs(nara[:, :2] - c[:2]).sum(axis=1) if len(nara) else np.array([0.0])
        pol = nara[np.argmin(dl)] if len(nara) else c
        r = Vector((0, 0, 0))
        r[lang] = 1 if c[lang] > pol[lang] else -1
        fäste = Vector((0, 0, 0))
        fäste[lang] = mn[lang] if r[lang] > 0 else mx[lang]
        fäste[tunn] = c[tunn]
        fäste[2] = mx[2]
        s_of = lambda p: np.abs(p[..., lang] - fäste[lang]) / ext[lang]
        t_of = lambda p: (mx[2] - p[..., 2]) / hojd
        bredd = ext[lang]
    s = s_of(L)
    t = t_of(L)
    A = np.stack([s, t, np.ones_like(s)], axis=1)
    koef, *_ = np.linalg.lstsq(A, UVs, rcond=None)
    uvmap = lambda ss, tt: tuple(np.array([ss, tt, 1.0]) @ koef)
    # nederkantens (fria kantens) form
    Pv = P
    sv, tv = s_of(Pv), t_of(Pv)
    if vertikal:
        prof = []
        for k in range(5):
            m = np.abs(sv - k / 4) < 0.14
            prof.append(tv[m].max() if m.any() else 1.0)
        pf = lambda ss: float(np.interp(ss, [0, 0.25, 0.5, 0.75, 1.0], prof))
    else:
        prof = []
        for k in range(5):
            m = np.abs(tv - k / 4) < 0.14
            prof.append(sv[m].max() if m.any() else 1.0)
        pf = lambda tt: float(np.interp(tt, [0, 0.25, 0.5, 0.75, 1.0], prof))
    kung = o.name.startswith("Baner_Kungaloge")
    B = Bygg(("Kungaloge_Fana_" + o.name[-1]) if kung else o.name + "_ny")
    rng = random.Random(hash(o.name) % 1000)
    fas = rng.random()
    if vertikal:
        topp = Vector((c[0], c[1], mx[2]))
        hojd_ny = hojd
        if kung:
            topp.z = 3.76
            hojd_ny = hojd - (mx[2] - 3.76)
        topp[tunn] = (mn[tunn] if n[tunn] > 0 else mx[tunn]) if not fritt else c[tunn]
        avst = 0.0 if fritt else 0.035
        vk = rng.choice((2.0, 2.5, 3.0))

        def pos(ss, tt):
            t2 = tt * pf(ss)
            amp = 0.008 + 0.03 * t2
            veck = amp * math.sin(2 * math.pi * vk * ss + fas * 6 + t2)
            return topp + h_ * ((ss - 0.5) * bredd) - UP * (t2 * hojd_ny) + n_ * (avst + abs(veck) * (0 if fritt else 1) + (veck if fritt else 0))
        tyg_yta(B, mat, 6, 12, pos, lambda ss, tt: uvmap(ss, tt * pf(ss)),
                lambda ss, tt: (tt * pf(ss), 0.3 if fritt else 0.0, fas))
        # ringar i överkanten
        if True:
            for k in range(4):
                ss = 0.08 + 0.84 * k / 3
                q = topp + h_ * ((ss - 0.5) * bredd) + n_ * avst
                B.cyl(q - h_ * 0.008, q + h_ * 0.008, 0.028, 0.028, 6, "MAT_Metall_Jarn")
    else:
        rikt = Vector((0, 0, 0))
        rikt[lang] = r[lang]
        sida = UP.cross(rikt).normalized()

        def pos(ss, tt):
            s2 = ss * pf(tt)
            vag = math.sin(s2 * math.pi * 2.2 + fas * 6.28) * 0.07 * s2
            return fäste + rikt * (s2 * bredd) - UP * (tt * hojd + 0.08 * s2 * s2) + sida * vag
        tyg_yta(B, mat, 10, 4, pos, lambda ss, tt: uvmap(ss * pf(tt), tt), lambda ss, tt: (ss * pf(tt), 1.0, fas))
    return B.objekt(saml)


# =====================================================================
# HUVUDPROGRAM
# =====================================================================
def samling(namn, exkludera=False):
    c = bpy.data.collections.get(namn)
    if c is None:
        c = bpy.data.collections.new(namn)
        bpy.context.scene.collection.children.link(c)
    if exkludera:
        def hitta(lc):
            if lc.collection == c:
                return lc
            for ch in lc.children:
                r = hitta(ch)
                if r:
                    return r
        lc = hitta(bpy.context.view_layer.layer_collection)
        if lc:
            lc.exclude = True
    return c


def rensa(c):
    for o in list(c.objects):
        d = o.data
        bpy.data.objects.remove(o)
        if d is not None and d.users == 0:
            if isinstance(d, bpy.types.Mesh):
                bpy.data.meshes.remove(d)
            elif isinstance(d, bpy.types.Light):
                bpy.data.lights.remove(d)


def arkivera(namn, arkiv):
    o = bpy.data.objects.get(namn)
    if o is None:
        return None
    if arkiv not in o.users_collection:
        o["atm_fran"] = ",".join(c.name for c in o.users_collection)
        for c in list(o.users_collection):
            c.objects.unlink(o)
        arkiv.objects.link(o)
    return o


def ljus(saml, namn, p, styrka, radie=0.08):
    ld = bpy.data.lights.new(namn, "POINT")
    ld.energy = styrka
    ld.color = (1.0, 0.62, 0.3)
    ld.shadow_soft_size = radie
    o = bpy.data.objects.new(namn, ld)
    o.location = p
    saml.objects.link(o)
    return o


def ladda_05():
    fil = os.path.join(bpy.path.abspath("//"), "05_fasE_bake_export.py")
    spec = importlib.util.spec_from_file_location("fasE", fil)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def kor(exportera=True):
    t0 = time.time()
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    E = ladda_05()
    bas, texmapp, exp = E.mappar()
    kopia = os.path.join(bas, "versioner", time.strftime("fore_atmosfar_%Y%m%d_%H%M%S.blend"))
    os.makedirs(os.path.dirname(kopia), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=kopia, copy=True)
    R.append("BORGEN – ATMOSFÄR, FLAGGOR OCH DETALJER")
    R.append(f"Säkerhetskopia: {kopia}")
    E.mata(R, "Före")

    saml = samling(SAML)
    arkiv = samling(ARKIV, exkludera=True)
    rensa(saml)
    for n in ERSATT + GAMLA_TYG:
        arkivera(n, arkiv)
    bpy.context.view_layer.update()

    # --- tygatlas ---
    bilder = bygg_atlas(texmapp)
    am = atlas_material(bilder)
    eld_material_blender()
    E.exportmaterial(am, bilder, 1.0, 1.0)
    R.append(f"Tygatlas: {ATLAS} ({ATLAS_S} px färg, {ATLAS_S // 2} px roughness/normal)")

    S = Scen(ERSATT + GAMLA_TYG)
    rng = random.Random(42)
    antal = {}

    def räkna(k, n=1):
        antal[k] = antal.get(k, 0) + n

    # ---------- 1. Nya banér på murarna ----------
    bef = []
    for n in GAMLA_TYG:
        o = bpy.data.objects.get(n)
        if o:
            bef.append(o.matrix_world @ (sum((Vector(b) for b in o.bound_box), Vector()) / 8))
    B = Bygg("SM_Baner_Murar")
    platser = murplatser(S, bef, antal=10)
    for k, (p, n, topp, bredd, hojd) in enumerate(platser):
        cell = [0, 1, 4, 6, 5, 2, 3, 7][k % 8]
        baner_vagg(B, topp, n, bredd, hojd, cell, form=("svans", "spets", "rak")[k % 3], seed=k)
        räkna("stora banér på murar")
    if platser:
        B.objekt(saml)
    R.append("  Banér på murar: " + ", ".join(f"({p.x:.1f}, {p.y:.1f}, {topp.z:.1f})" for p, n, topp, *_ in platser))

    # ---------- 2. Gamla banér och flaggor, ombyggda ----------
    for n in GAMLA_TYG:
        o = bpy.data.objects.get(n)
        if o and bygg_om_baner(o, S, saml):
            räkna("ombyggda banér/flaggor")

    # ---------- 3. Stångflaggor runt planen ----------
    B = Bygg("SM_Flaggstanger_Arena")
    stanger = []
    for k, (x, y, rikt) in enumerate([(14.5, -10.0, (1, 0)), (-14.5, -10.0, (-1, 0)), (14.6, 9.2, (1, 0)), (-14.6, 9.2, (-1, 0)),
                                       (4.2, -9.95, (1, 0)), (-4.2, -9.95, (-1, 0))]):
        f = hitta_fri(S, x, y, 0.22, 3.0, 0.3)
        z = None
        if f:
            x, y, z = f
        if z is None:
            R.append(f"  Flaggstång ({x}, {y}) – inte fri plats, hoppar över")
            continue
        hojd = 7.0 if abs(x) > 10 else 6.2
        topp = flaggstang(B, (x, y, z), hojd, k)
        cell = [1, 1, 2, 2, 5, 5][k]
        langd = 2.4 if abs(x) > 10 else 1.9
        stangflagga(B, topp - UP * 0.12, Vector(rikt), langd, 0.75, cell_mapp_vriden(cell), seed=k, form="svans")
        rep(B, [topp - UP * 0.1 + Vector((0.07, 0, 0)), Vector((x + 0.08, y, z + 1.1))])
        stanger.append(Vector((x, y, z)) + UP * (hojd - 0.3))
        räkna("flaggstänger runt planen")
    B.objekt(saml)

    # ---------- 4. Vimpelrader ----------
    B = Bygg("SM_Vimplar")
    rader = []
    for sg in (1, -1):
        rader.append(((15.25 * sg, -2.4, 5.5), (15.25 * sg, 8.2, 5.5), 0.3))           # läktartakens framkant
        x0, x1 = (8.4, 17.0) if sg > 0 else (-8.5, -13.1)
        rader.append(((x0, 12.92, 5.12), (x1, 12.92, 5.12), 0.25))                       # adelsläktarnas tak
        rader.append(((4.55 * sg, 11.2, 6.95), (8.45 * sg, 12.95, 5.2), 0.35))           # kungalogen → adelsläktaren
    södra = [p for p in stanger if p.y < -9]
    for sg in (1, -1):
        sid = sorted([p for p in södra if p.x * sg > 0], key=lambda p: abs(p.x))
        if len(sid) == 2:
            rader.append((tuple(sid[0] - UP * 1.6), tuple(sid[1] - UP * 1.6), 0.45))
    for k, (a, b, sank) in enumerate(rader):
        vimpelrad(B, a, b, sank, seed=k, farger=((2, 4, 3, 5) if k % 2 else (3, 5, 2, 4)))
        räkna("vimpelrader")
    B.objekt(saml)

    # ---------- 5. Festonger: läktarnas räcken, kungalogens tak, portarna ----------
    B = Bygg("SM_Festonger")
    for sg in (1, -1):
        hinder = [(-0.4, 1.4), (4.1, 5.9)]          # befintliga små banér på läktarfronten
        y = -2.1
        while y < 7.9:
            y2 = min(y + 1.6, 7.95)
            if not any(not (y2 < a or y > b) for a, b in hinder) and y2 - y > 0.8:
                # hitta räckets ovankant
                topp = None
                for zz in [3.0 - 0.05 * k for k in range(50)]:
                    h = S.stråle((13.9 * sg, (y + y2) / 2, zz), (sg, 0, 0), 2.6)
                    if h and abs(h[0].x) < 15.75:
                        topp = (h[0].x, zz)
                        break
                if topp:
                    xf = topp[0] - 0.01 * sg
                    festong(B, (xf, y, topp[1] - 0.02), (xf, y2, topp[1] - 0.02), 0.32, Vector((-sg, 0, 0)),
                            2 if sg > 0 else 3, seed=int(y * 10))
                    räkna("festonger")
            y = y2 + 0.05
    festong(B, (-4.3, 11.12, 6.95), (0.0, 11.12, 6.95), 0.38, Vector((0, -1, 0)), 6, seed=1, avstand=-0.02)
    festong(B, (0.0, 11.12, 6.95), (4.3, 11.12, 6.95), 0.38, Vector((0, -1, 0)), 6, seed=2, avstand=-0.02)
    räkna("festonger", 2)
    # portöppningar: Kämpeportarna (öst/väst) och turneringsporten i söder
    for namn, mitt, n, bredd in [("Kampeport_Vast", (-13.0, -5.0), Vector((1, 0, 0)), 2.2),
                                  ("Kampeport_Ost", (13.0, -5.0), Vector((-1, 0, 0)), 2.2),
                                  ("Turneringsport_Syd", (0.0, -9.6), Vector((0, 1, 0)), 3.6)]:
        h_, u_, n_ = ram(n)
        fram = Vector((mitt[0], mitt[1], 0)) + n_ * 1.5
        overkant = None
        for zz in [1.8 + 0.05 * k for k in range(50)]:
            h = S.stråle(fram + UP * zz, -n_, 2.2)
            if h and (h[0] - (fram + UP * zz)).length < 1.7:
                overkant = (h[0], zz)
                break
        if overkant:
            p = overkant[0] + n_ * 0.02 + UP * 0.22
            festong(B, p - h_ * (bredd / 2), p + h_ * (bredd / 2), 0.3, n_, 7 if "Ost" in namn else (3 if "Vast" in namn else 6), seed=7)
            räkna("festonger")
        else:
            R.append(f"  {namn}: hittade inte portens överkant – ingen festong")
    B.objekt(saml)

    # ---------- 6. Sköldar på skranket och över portarna ----------
    B = Bygg("SM_Skoldar")
    mål = [(x, 9.4) for x in (-10, -6, -2, 2, 6, 10)] + [(x, -9.4) for x in (-10, -6.5, 6.5, 10)] + \
          [(sg * 13.4, y) for sg in (1, -1) for y in (-0.5, 3.5, 7.0)]
    for k, (x, y) in enumerate(mål):
        d = Vector((x, y, 0)).normalized()
        h = S.stråle((0, 0, 0.85), Vector((x, y, 0)), 16)
        if not h or not h[3] or "Barriar" not in h[3]:
            continue
        n = Vector((h[1].x, h[1].y, 0)).normalized()
        cell = (1, 4, 6) [k % 3] if x < -12 else ((0, 5, 7)[k % 3] if x > 12 else [0, 1, 2, 3, 4, 5, 6, 7][k % 8])
        skold(B, h[0] + UP * 0.02, n, 0.52, cell)
        räkna("sköldar på skranket")
    for namn, mitt, n in [("Kampeport_Vast", (-13.0, -5.0), Vector((1, 0, 0))), ("Kampeport_Ost", (13.0, -5.0), Vector((-1, 0, 0))),
                          ("Turneringsport_Syd", (0.0, -9.5), Vector((0, 1, 0)))]:
        h_, u_, n_ = ram(n)
        q = Vector((mitt[0], mitt[1], 4.05)) + n_ * 1.2
        h = S.stråle(q, -n_, 1.8)
        if h:
            skold(B, h[0] + UP * 0.05, n_, 0.75, {"Kampeport_Vast": 4, "Kampeport_Ost": 0, "Turneringsport_Syd": 6}[namn], tjock=0.04)
            räkna("sköldar över portar")
    B.objekt(saml)

    # ---------- 7. Facklor, stolpar, eldkorgar, lyktor ----------
    gamla = []
    import bmesh as _bm
    for n in ["Facklor_Eld", "Port_Facklor", "Laktare_Facklor"]:
        o = bpy.data.objects.get(n)
        if not o:
            continue
        bm = _bm.new()
        bm.from_mesh(o.data)
        bm.verts.ensure_lookup_table()
        sedd = set()
        for v in bm.verts:
            if v.index in sedd:
                continue
            st, comp = [v], []
            sedd.add(v.index)
            while st:
                x = st.pop()
                comp.append(o.matrix_world @ x.co)
                for e in x.link_edges:
                    y = e.other_vert(x)
                    if y.index not in sedd:
                        sedd.add(y.index)
                        st.append(y)
            mn = Vector([min(p[i] for p in comp) for i in range(3)])
            mx = Vector([max(p[i] for p in comp) for i in range(3)])
            gamla.append(((mn + mx) / 2, mx - mn))
        bm.free()
    Bf = Bygg("SM_Facklor_Smide")
    eldpunkter = []
    for k, (c, st) in enumerate(gamla):
        bast = None
        for j in range(16):
            a = j * math.pi / 8
            d = Vector((math.cos(a), math.sin(a), 0))
            h = S.stråle(c - UP * 0.45, d, 0.9)
            if h and (bast is None or (h[0] - c).length < bast[0]):
                bast = ((h[0] - c + UP * 0.45).length, h)
        if bast and bast[0] < 0.8:
            h = bast[1]
            n = Vector((h[1].x, h[1].y, 0)).normalized()
            vagg = Vector((h[0].x, h[0].y, c.z - 0.36))
            eldpunkter.append(vaggfackla(Bf, vagg, n, seed=k))
            räkna("väggfacklor (ersätter de gamla)")
        else:
            z = S.mark(c.x, c.y)
            fot = Vector((c.x, c.y, z[0].z if z else 0.0))
            eldpunkter.append(fackelstolpe(Bf, fot, c.z - 0.42 - fot.z, seed=k))
            räkna("fackelstolpar (ersätter de gamla)")
    Bf.objekt(saml)
    Be = Bygg("SM_Eldkorgar")
    eldkorgar = []
    for k, (x, y) in enumerate([(13.9, -10.25), (-13.9, -10.25), (9.6, 10.6), (-9.6, 10.6), (12.6, -11.4), (-12.6, -11.4)]):
        if len(eldkorgar) >= 4:
            break
        f = hitta_fri(S, x, y, 0.45, 1.6, 0.45)
        z = None
        if f:
            x, y, z = f
        if z is None:
            R.append(f"  Eldkorg ({x}, {y}) – inte fri plats")
            continue
        eldkorgar.append(eldkorg(Be, (x, y, z), seed=k))
        räkna("eldkorgar")
    Be.objekt(saml)
    Bl = Bygg("SM_Lyktor")
    lyktor = []
    for sg in (1, -1):
        for y in (-1.7, 3.0, 7.6):
            h = S.stråle((15.7 * sg, y, 4.6), (0, 0, 1), 2.0)
            if h and h[0].z < 6.4:
                lyktor.append(lykta(Bl, h[0], 4, seed=int(y * 10)))
                räkna("lyktor")
    for x in (-12.9, -8.8, 8.8, 12.9, 16.7):
        h = S.stråle((x, 13.15, 4.2), (0, 0, 1), 2.0)
        if h and h[0].z < 6.4:
            lyktor.append(lykta(Bl, h[0], 3, seed=int(x * 10)))
            räkna("lyktor")
    if lyktor:
        Bl.objekt(saml)
    befintliga = [o.matrix_world.translation for o in bpy.context.view_layer.objects if o.type == "LIGHT" and o.data.type == "POINT"]
    for k, p in enumerate(eldpunkter):
        if not any((q - p).length < 0.9 for q in befintliga):
            ljus(saml, f"LJ_Fackla_{k:02d}", p, 25)
    for k, p in enumerate(eldkorgar):
        ljus(saml, f"LJ_Eldkorg_{k:02d}", p, 70, 0.2)

    # ---------- 8. Järnbeslag på portar och dörrar ----------
    Bb = Bygg("SM_Beslag")
    o = bpy.data.objects.get("Portblad_och_Dorrar")
    if o:
        for p in o.data.polygons:
            n = (o.matrix_world.to_3x3() @ p.normal).normalized()
            if abs(n.z) > 0.1 or p.area < 1.0:
                continue
            vs = [o.matrix_world @ o.data.vertices[i].co for i in p.vertices]
            zmin, zmax = min(v.z for v in vs), max(v.z for v in vs)
            if zmax - zmin < 1.6:
                continue
            h_, u_, n_ = ram(n)
            hs = [v.dot(h_) for v in vs]
            bredd = max(hs) - min(hs)
            if bredd < 0.7:
                continue
            c = sum(vs, Vector()) / len(vs)
            vanster = c + h_ * (min(hs) - c.dot(h_) + 0.04)
            for f in (0.2, 0.8):
                q = Vector((vanster.x, vanster.y, zmin + (zmax - zmin) * f))
                beslag(Bb, q, h_, u_, n_, min(bredd * 0.7, 1.4), seed=0)
            räkna("dörrar med beslag")
    Bb.objekt(saml)

    # ---------- 9. Föremål i grupper ----------
    tunna = bpy.data.objects.get("Bas_Tunna_Original")
    lada_ = bpy.data.objects.get("Bas_Lada_Original")
    stall = bpy.data.objects.get("Bas_Spjutstall_Original")
    Bs = Bygg("SM_Sackar_Rep_Ho")
    Bo = Bygg("SM_Ovningsvapen")

    def instans(src, x, y, z, rot, namn):
        if src is None:
            return None
        o = bpy.data.objects.new(namn, src.data)            # länkad kopia: samma mesh
        o.location = (x, y, z)
        o.rotation_euler = (0, 0, rot)
        saml.objects.link(o)
        return o

    grupper = [
        ("Rustplats väst", (-16.6, -9.3), [("ovning", 0, 0, math.pi / 2), ("tunna", 1.1, 0.25, 0), ("sack", 1.0, -0.45, 0)]),
        ("Rustplats öst", (18.1, -8.8), [("lada", 0, 0, 0.3), ("rep", -0.7, 0.1, 0), ("tunna", 0.2, 0.85, 0)]),
        ("Gården sydväst", (-8.1, -13.6), [("lada", 0, 0, 0.2), ("lada", 0.85, 0.05, -0.1), ("lada2", 0.4, 0.0, 0.5), ("tunna", -0.9, 0.1, 0), ("sack", -0.6, -0.65, 0)]),
        ("Gården sydost", (8.1, -13.6), [("tunna", 0, 0, 0), ("tunna", 0.8, 0.15, 1), ("rep", -0.75, -0.2, 0), ("sack", 0.2, -0.7, 0), ("sack", 0.65, -0.75, 0)]),
        ("Läktarslut nordost", (17.4, 10.9), [("tunna", 0, 0, 0), ("sack", 0.65, -0.2, 0), ("sack", 0.9, 0.35, 0)]),
        ("Stallet", (-14.2, -13.4), [("ho", 0, 0, 0), ("ho", 0.85, 0.2, 0), ("sack", 0.4, -0.7, 0)]),
    ]
    for gnamn, (gx, gy), saker in grupper:
        lagda = 0
        for k, (typ, dx, dy, rot) in enumerate(saker):
            x, y = gx + dx, gy + dy
            r = {"ovning": 0.85, "spjut": 0.95, "tunna": 0.42, "lada": 0.45, "lada2": 0.3, "sack": 0.25, "rep": 0.25, "ho": 0.5}[typ]
            if typ == "lada2":
                z = S.mark(x, y, 3.0)
                if z is None:
                    continue
                instans(lada_, x, y, z[0].z, rot, f"Lada_Atm_{gnamn[:4]}_{k}")
                lagda += 1
                continue
            f = hitta_fri(S, x, y, r, 1.2 if typ not in ("ovning", "spjut") else 2.4, 0.6)
            if f is None:
                continue
            x, y, z = f
            if typ == "tunna":
                instans(tunna, x, y, z, rot, f"Tunna_Atm_{gnamn[:4]}_{k}")
            elif typ == "lada":
                instans(lada_, x, y, z, rot, f"Lada_Atm_{gnamn[:4]}_{k}")
            elif typ == "spjut":
                instans(stall, x, y, z, rot, f"Spjutstall_Atm_{gnamn[:4]}_{k}")
            elif typ == "ovning":
                ovningsstall(Bo, (x, y, z), Vector((math.cos(rot), math.sin(rot), 0)), seed=k)
            elif typ == "sack":
                sack(Bs, Vector((x, y, z)), seed=k + int(gx))
            elif typ == "rep":
                repring(Bs, (x, y, z), seed=k)
            elif typ == "ho":
                hostack(Bs, Vector((x, y, z)), seed=k)
            lagda += 1
        räkna("föremål i grupper", lagda)
        R.append(f"  {gnamn}: {lagda} av {len(saker)} föremål fick plats")
    Bs.objekt(saml)
    Bo.objekt(saml)
    # lådan ovanpå: lyft den andra lådan i gruppen sydväst
    for o in saml.objects:
        if o.name.startswith("Lada_Atm_Gård") and o.name.endswith("_2"):
            o.location.z += 0.8

    for k, v in antal.items():
        R.append(f"  {k}: {v}")
    R.append("Eldpunkter för spelets ljus (Blender x, y, z):")
    R.append("  eldkorgar: " + ", ".join(f"[{p.x:.2f}, {p.y:.2f}, {p.z:.2f}]" for p in eldkorgar))
    # räkna trianglar i nya objekt
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in saml.objects if o.type == "MESH")
    R.append(f"Nya objekt: {len([o for o in saml.objects if o.type == 'MESH'])}, {tris} trianglar (instanser räknade var för sig)")
    E.mata(R, "Efter")
    if exportera:
        E.exportera(exp, R)
    bpy.ops.wm.save_mainfile()
    R.append(f"Tid: {time.time() - t0:.0f} s")
    txt = "\n".join(R)
    print(txt)
    t = bpy.data.texts.get("ATMOSFAR_rapport") or bpy.data.texts.new("ATMOSFAR_rapport")
    t.clear()
    t.write(txt)
    return txt


if __name__ == "__main__":
    resultat_text = kor()
