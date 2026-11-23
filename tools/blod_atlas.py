# blod_atlas.py – ritar blodtexturen till spelet (public/textures/blod.png)
#
#   python3 tools/blod_atlas.py          (behöver numpy och Pillow)
#
# 512 x 512 px, 4 x 4 rutor à 128 px. RGB = ljushet (multipliceras med blodets färg i shadern),
# A = täckning. I varje ruta pekar "uppåt" (v = 1) åt det håll partikeln flyger.
#   rad 0: droppar (droppform med svans, droppe med satelliter, oregelbunden klump, tunn sträng)
#   rad 1: fint stänk (små kluster av droppar)
#   rad 2: träffstänk A, 4 bilder (smalt, för hugg och stick)
#   rad 3: träffstänk B, 4 bilder (brett, för trubbiga vapen)
import math
import os
import numpy as np
from PIL import Image

CELL = 128
SS = 3                      # överprovtagning för mjuka kanter
N = CELL * SS


def grid():
    y, x = np.mgrid[0:N, 0:N].astype(np.float32)
    return (x + 0.5) / N, 1.0 - (y + 0.5) / N   # u åt höger, v uppåt


def d_cirkel(u, v, cx, cy, r):
    return np.hypot(u - cx, v - cy) - r


def d_kon(u, v, ax, ay, ar, bx, by, br):
    """Avstånd till en rundad kon (kapsel med olika radier i ändarna)."""
    pax, pay = u - ax, v - ay
    bax, bay = bx - ax, by - ay
    L2 = bax * bax + bay * bay
    h = np.clip((pax * bax + pay * bay) / L2, 0.0, 1.0)
    r = ar + (br - ar) * h
    return np.hypot(pax - bax * h, pay - bay * h) - r


def smin(a, b, k=0.02):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def brus(seed, skala):
    rng = np.random.default_rng(seed)
    g = rng.random((skala + 2, skala + 2)).astype(np.float32)
    yy = np.linspace(0, skala, N)
    xx = np.linspace(0, skala, N)
    y0, x0 = yy.astype(int), xx.astype(int)
    fy, fx = (yy - y0)[:, None], (xx - x0)[None, :]
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a, b = g[y0][:, x0], g[y0][:, x0 + 1]
    c, d = g[y0 + 1][:, x0], g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy) * 2 - 1


def skugga(d, tjock=0.06, opak=1.0, seed=0):
    """SDF -> (ljushet, täckning). Tjocka partier mörkare och mer täckande, tunna kanter lite ljusare och
    halvgenomskinliga. Bara en svag, matt ljusning upptill – inget blankt glas."""
    aa = 1.5 / N
    alfa = np.clip(0.5 - d / aa, 0.0, 1.0)
    t = np.clip(-d / tjock, 0.0, 1.0)
    u, v = grid()
    ljus = 0.62 + 0.18 * (1 - t) ** 2 - 0.12 * t
    ljus += 0.08 * np.clip(1 - np.hypot(u - 0.42, v - 0.62) / 0.25, 0, 1) * t
    ljus += 0.04 * brus(seed + 9, 12)
    tack = alfa * (0.72 + 0.28 * np.sqrt(t)) * opak
    return np.clip(ljus, 0, 1), np.clip(tack, 0, 1)


def ruta(d, **kw):
    l, a = skugga(d, **kw)
    rgb = np.repeat(l[..., None], 3, axis=2)
    img = np.concatenate([rgb, a[..., None]], axis=2)
    return img.reshape(CELL, SS, CELL, SS, 4).mean(axis=(1, 3))


def droppar():
    u, v = grid()
    ut = []
    # 1: droppform: rund front, smal svans bakåt
    d = d_kon(u, v, 0.5, 0.70, 0.17, 0.5, 0.12, 0.025)
    d += 0.006 * brus(1, 6)
    ut.append(ruta(d, tjock=0.12, seed=1))
    # 2: droppe med små satelliter bakom
    d = d_kon(u, v, 0.5, 0.72, 0.15, 0.5, 0.36, 0.05)
    for cx, cy, r in ((0.47, 0.24, 0.04), (0.54, 0.14, 0.028), (0.49, 0.06, 0.018)):
        d = np.minimum(d, d_cirkel(u, v, cx, cy, r))
    ut.append(ruta(d + 0.005 * brus(2, 6), tjock=0.1, seed=2))
    # 3: oregelbunden klump
    a = np.arctan2(v - 0.55, u - 0.5)
    r = 0.22 * (1 + 0.16 * np.sin(3 * a + 0.7) + 0.09 * np.sin(5 * a + 2.1))
    d = np.hypot(u - 0.5, (v - 0.55) * 0.85) - r
    d = smin(d, d_kon(u, v, 0.5, 0.45, 0.07, 0.48, 0.12, 0.02), 0.04)
    ut.append(ruta(d + 0.01 * brus(3, 8), tjock=0.12, seed=3))
    # 4: tunn sträng (ligament) med förtjockning i fronten
    d = d_kon(u, v, 0.5, 0.86, 0.085, 0.5, 0.06, 0.012)
    d = smin(d, d_cirkel(u, v, 0.5, 0.86, 0.09), 0.03)
    ut.append(ruta(d + 0.004 * brus(4, 6), tjock=0.07, seed=4))
    return ut


def stank():
    u, v = grid()
    ut = []
    for k in range(4):
        rng = np.random.default_rng(40 + k)
        d = d_cirkel(u, v, 0.5, 0.52, 0.11 + 0.03 * rng.random())
        for _ in range(7 + k * 2):
            a = rng.uniform(0, 2 * math.pi)
            rr = rng.uniform(0.12, 0.36)
            d = np.minimum(d, d_cirkel(u, v, 0.5 + math.cos(a) * rr, 0.52 + math.sin(a) * rr, rng.uniform(0.012, 0.045)))
        ut.append(ruta(d + 0.008 * brus(50 + k, 8), tjock=0.06, seed=50 + k))
    return ut


def traffstank(seed, bredd, n_strimmor):
    """4 bilder: en klump som slits upp i strimmor utåt (mest framåt), sedan lossnar droppar och allt tonar."""
    u, v = grid()
    rng = np.random.default_rng(seed)
    strimmor = []
    for i in range(n_strimmor):
        a = math.pi / 2 + rng.normal(0, bredd)          # framåt = uppåt i rutan
        strimmor.append((a, rng.uniform(0.55, 1.0), rng.uniform(0.022, 0.05)))
    ut = []
    for f in range(4):
        t = (f + 1) / 4
        cx, cy = 0.5, 0.32
        kropp = 0.12 * (1.0 - 0.6 * t)
        d = d_cirkel(u, v, cx, cy, kropp)
        a = np.arctan2(v - cy, u - cx)
        d += kropp * 0.12 * np.sin(5 * a + seed)
        for a0, langd, r0 in strimmor:
            L = langd * (0.16 + 0.36 * t)
            ex, ey = cx + math.cos(a0) * L, cy + math.sin(a0) * L
            sx, sy = cx + math.cos(a0) * L * (0.15 + 0.55 * t), cy + math.sin(a0) * L * (0.15 + 0.55 * t)
            if f < 2:
                d = smin(d, d_kon(u, v, cx, cy, r0 * 1.4, ex, ey, r0 * 0.5), 0.03)
            else:
                # strängen har brustit: droppar på rad bakom spetsen
                d = np.minimum(d, d_kon(u, v, sx, sy, r0 * 0.6, ex, ey, r0 * 0.9))
                for q in (0.45, 0.7):
                    d = np.minimum(d, d_cirkel(u, v, cx + (ex - cx) * q * (1 + 0.15 * f), cy + (ey - cy) * q * (1 + 0.15 * f), r0 * 0.55))
        d += 0.006 * brus(seed + f, 10)
        opak = [1.0, 0.95, 0.8, 0.55][f]
        img = ruta(d, tjock=0.05, opak=opak, seed=seed + f)
        # tona ut mot rutans kant så att inget klipps av synligt
        k = np.linspace(0, 1, CELL)
        kant = np.clip(np.minimum(k, 1 - k) / 0.08, 0, 1)
        img[..., 3] *= np.outer(kant, kant)
        ut.append(img)
    return ut


def main():
    rader = [droppar(), stank(), traffstank(7, 0.55, 9), traffstank(21, 1.05, 12)]
    atlas = np.zeros((4 * CELL, 4 * CELL, 4), dtype=np.float32)
    for r, rad in enumerate(rader):
        for c, img in enumerate(rad):
            atlas[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = img
    # Färgen i genomskinliga pixlar = närmaste blodets ljushet (inga mörka kanter vid filtrering)
    atlas[..., :3] = np.where(atlas[..., 3:4] > 0.002, atlas[..., :3], 0.6)
    ut = os.path.join(os.path.dirname(__file__), "..", "public", "textures", "blod.png")
    Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(ut, optimize=True)
    print("skrev", os.path.normpath(ut), os.path.getsize(ut) // 1024, "kB")


if __name__ == "__main__":
    main()
