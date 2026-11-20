"""
C05_stadsvakt_B1_hjalm_axlar_armar.py  –  Brawl med Boysen, Stadsvakten: SKRIPT B1
================================================================================
Förfining (inte nybygge) av Stadsvakten från skript A (C04).  Klistra in i
Scripting-fliken och kör.  Kräver att C04_stadsvakt_A_ny_basmodell.py ligger i
samma mapp som .blend-filen (skriptet lånar mått, material och verktyg därifrån –
C04 körs INTE om).

Vad B1 gör
  1. Sparar en kopia av .blend-filen i "versioner" (…_fore_B1_…).
  2. Hjälm: högre, lätt spetsig kettle hat-kupa med fyra upphöjda sömmar,
     snörning i rödbrunt läder längs sömmarna, nitat band runt kupans fot,
     brett nedåtsluttande brätte med rullad/förstärkt kant, synlig metall-
     tjocklek och ett mörkt läderfoder som täcker övergången mot huvudet.
     Matt, något brunaktig järnyta med roughness-variation.
  3. Ansikte/hals: hår som syns under hjälmen (tinningar, öron, nacke),
     kort helskägg längs käklinjen + mustasch. Kroppen/ansiktet ändras inte –
     skägget ger käklinjen. Ringbrynjan runt halsen behålls från A.
  4. Axlar: puffade, vadderade axelpartier i blåvita paneler med insydda
     sömmar (vit panel framåt), samt ett läderband som avslutar puffen mot
     överarmen.
  5. Ärmar: vadderingen byggs om med samma passform men med fler hörn i
     armarna, mjuka veck vid armbågarna och ett tydligare quiltat
     diamantmönster (mörkbrunt, matt).
  6. Allt nytt följer riggen: hjälmen viktas 100 % till head.x, hår/skägg
     ärver huvudets vikter, axelpartierna får vikter från närmaste kroppshörn
     (max 4 ben per hörn). Armature-modifierare på allt.

Kan köras om: tar bara bort det B1 själv ersätter. Riggen, kroppen och
deras vikter ändras aldrig. Kör man om skript A måste B1 köras igen.
Testat i Blender 5.3.
"""

import bpy
import bmesh
import math
import os
import time
import random
import importlib.util
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

VERSION = "B1 1.0"
A_FIL = "C04_stadsvakt_A_ny_basmodell.py"
STEG = "B1"
ERSATTS = ["SM_Stadsvakt_Hjalm", "SM_Stadsvakt_Hjalm_Kant", "SM_Stadsvakt_Hjalm_Nitar",
           "SM_Stadsvakt_Hjalm_Snorning", "SM_Stadsvakt_Axelskydd_V", "SM_Stadsvakt_Axelskydd_H",
           "SM_Stadsvakt_Vaddering"]
R = []


# =============================================================== hämta skript A som bibliotek
def ladda_A():
    mapp = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else ""
    kandidater = [os.path.join(mapp, A_FIL), os.path.join(mapp, "karaktarer", A_FIL)]
    for p in kandidater:
        if os.path.isfile(p):
            spec = importlib.util.spec_from_file_location("stadsvakt_A", p)
            A = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(A)          # __name__ != "__main__" → A körs inte
            return A
    raise RuntimeError(f"Hittar inte {A_FIL} bredvid .blend-filen ({mapp}). Lägg den där och kör igen.")


def sakerhetskopia():
    if globals().get("SKIPPA_KOPIA") or not bpy.data.filepath:
        return
    mapp = os.path.join(os.path.dirname(bpy.data.filepath), "versioner")
    os.makedirs(mapp, exist_ok=True)
    namn = os.path.splitext(os.path.basename(bpy.data.filepath))[0]
    ut = os.path.join(mapp, f"{namn}_fore_B1_{time.strftime('%Y%m%d_%H%M%S')}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=ut, copy=True)
    R.append(f"Säkerhetskopia: {ut}")


def rensa(A):
    bort = [o for o in bpy.data.objects
            if o.get(A.TAGG) and (o.get("steg") == STEG or o.name in ERSATTS)]
    n = len(bort)
    for o in bort:
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)
    return n


def markera(o, kroppsdel):
    o["steg"] = STEG
    o["kroppsdel"] = kroppsdel


# =============================================================== vikter
class Vikter:
    """Vikter från kroppens närmaste hörn (max 4 ben, normaliserade)."""

    def __init__(self, K):
        self.K = K
        bm = K.bm()
        dl = bm.verts.layers.deform.active
        self.co = [v.co.copy() for v in bm.verts]
        self.w = [dict(v[dl]) for v in bm.verts]
        bm.free()
        self.kd = KDTree(len(self.co))
        for i, c in enumerate(self.co):
            self.kd.insert(c, i)
        self.kd.balance()

    def fran_kropp(self, o, n=6, filter_fn=None):
        summa_per_v = []
        for v in o.data.vertices:
            s = {}
            for c, i, d in self.kd.find_n(v.co, n * 3):
                if filter_fn and not filter_fn(self.co[i]):
                    continue
                vikt = 1.0 / max(d, 0.004) ** 2
                for g, w in self.w[i].items():
                    s[g] = s.get(g, 0.0) + w * vikt
            summa_per_v.append(s)
        self._skriv(o, summa_per_v)

    def ett_ben(self, o, gnamn):
        gi = self.K.gnamn.index(gnamn)
        self._skriv(o, [{gi: 1.0} for _ in o.data.vertices])

    def _skriv(self, o, lista):
        o.vertex_groups.clear()
        grupper = {}
        for vi, s in enumerate(lista):
            topp = sorted(s.items(), key=lambda x: -x[1])[:4]
            tot = sum(w for _, w in topp) or 1.0
            for g, w in topp:
                if w / tot < 0.01:
                    continue
                if g not in grupper:
                    grupper[g] = o.vertex_groups.new(name=self.K.gnamn[g])
                grupper[g].add([vi], w / tot, "REPLACE")


def deformera(A, o, rig):
    A.koppla(o, rig, deform=True)


# =============================================================== material (B1-förfinade)
def mat_hjalm(A):
    """Matt, lite brunaktig järnyta: hamrad, fläckvis rost, ljusare slitna kanter."""
    m = A.nytt_material(f"MAT_{A.P}_Metall_Hjalm")
    b = A.Nod(m)
    var = b.brus(4.0, 5.0)
    fl = b.brus(14.0, 4.0, 0.6)
    hamr = b.voronoi(34.0)
    kant = b.kanter()
    f = b.blanda(b.ramp(var, 0.0, 1.0, 0.3, 0.72), b.farg("#6e665e"), b.farg("#4b4540"))
    rost = b.ramp(b.brus(8.0, 6.0, 0.65), 0.0, 1.0, 0.62, 0.78)
    f = b.blanda(b.math("MULTIPLY", rost, 0.7), f, b.farg("#5e3d27"))
    f = b.blanda(b.math("MULTIPLY", kant, 0.55), f, b.farg("#9a958d"))
    b.satt(["Base Color"], f)
    b.satt(["Metallic"], b.ramp(rost, 0.85, 0.35))
    r = b.ramp(fl, 0.42, 0.74)                        # roughness-variation
    r = b.math("ADD", r, b.math("MULTIPLY", rost, 0.18))
    r = b.math("SUBTRACT", r, b.math("MULTIPLY", kant, 0.14))
    b.satt(["Roughness"], r)
    n = b.bump(hamr, 0.18, 0.0025)
    n = b.bump(b.brus(70.0, 2.0), 0.08, 0.0006, n)     # repor/porer
    b.satt(["Normal"], n)
    return m


def mat_har_b1(A):
    """Mellanbrunt hår/skägg med strån (ljusare än i A, som konceptet)."""
    m = A.nytt_material(f"MAT_{A.P}_Har")
    b = A.Nod(m)
    strand = b.brus(70.0, 4.0, 0.6, stracka=(4.0, 4.0, 0.35))
    fl = b.brus(6.0, 2.0)
    f = b.blanda(b.ramp(strand, 0.0, 1.0, 0.3, 0.72), b.farg("#6e4b31"), b.farg("#3b2617"))
    f = b.blanda(b.ramp(fl, 0.0, 0.35, 0.4, 0.8), f, b.farg("#8a6343"))
    b.satt(["Base Color"], f)
    b.satt(["Roughness"], b.ramp(strand, 0.55, 0.75))
    b.satt(["Sheen Weight", "Sheen"], 0.3)
    b.satt(["Normal"], b.bump(strand, 0.7, 0.0025))
    return m


def mat_snore(A):
    return A.mat_lader(f"MAT_{A.P}_Lader_Snore", "#8e3f2a", "#6a2c1d", "#b06a4c")


def mat_vaddering_b1(A):
    """Tydligare quiltat diamantmönster: kuddar, djupa sömmar med stygn, matt mörkbrunt."""
    m = A.nytt_material(f"MAT_{A.P}_Vaddering")
    b = A.Nod(m)
    uv = b.separera(b.attribut("QUILT"))
    ruta = 0.040
    p = b.math("ADD", uv[0], uv[1])
    q = b.math("SUBTRACT", uv[0], uv[1])

    def kudde(x):
        tri = b.math("PINGPONG", x, ruta / 2)                  # 0 i sömmen
        return b.math("SMOOTH_MIN", b.math("DIVIDE", tri, ruta * 0.34), 1.0, 0.6)

    def stygn(x, y):                                         # streckade stygn längs sömmen
        tri = b.math("PINGPONG", x, ruta / 2)
        nara = b.ramp(tri, 1.0, 0.0, 0.0, 0.0025)
        streck = b.ramp(b.math("SINE", b.math("MULTIPLY", y, 520.0)), 0.0, 1.0, 0.1, 0.5)
        return b.math("MULTIPLY", nara, streck)

    h = b.math("MINIMUM", kudde(p), kudde(q))
    st = b.math("MAXIMUM", stygn(p, q), stygn(q, p))
    var = b.brus(5.0, 3.0)
    bas = b.blanda(b.ramp(var, 0.0, 1.0, 0.3, 0.75), b.farg("#4a3324"), b.farg("#38261a"))
    bas = b.blanda(b.ramp(h, 0.0, 0.2, 0.6, 1.0), bas, b.farg("#563c2a"))      # kuddarnas toppar lite ljusare
    f = b.blanda(b.ramp(h, 0.8, 0.0, 0.0, 0.6), bas, b.farg("#1b120b"))        # djupa sömmar
    f = b.blanda(b.math("MULTIPLY", st, 0.35), f, b.farg("#5e4c3a"))            # stygn
    b.satt(["Base Color"], f)
    b.satt(["Roughness"], b.ramp(h, 0.95, 0.86))
    b.satt(["Sheen Weight", "Sheen"], 0.35)
    b.satt(["Sheen Roughness"], 0.6)
    b.satt(["Specular IOR Level", "Specular"], 0.25)
    n = b.bump(h, 0.55, 0.005)
    n = b.bump(st, 0.25, 0.0008, n)
    n = b.bump(b.brus(55.0, 2.0), 0.08, 0.001, n)
    b.satt(["Normal"], n)
    return m


# =============================================================== hjälm
def bygg_hjalm(A, K, kol, M, hm, V):
    L = A.L
    zb = hm["topp"] - 0.078                         # kupans fot (samma passform som A)
    nara = [p for p in hm["pts"] if abs(p.z - zb) < 0.025]
    rx = max(abs(p.x) for p in nara) + 0.026
    ry = max(abs(p.y - hm["cy"]) for p in nara) + 0.026
    kv = ry / rx
    yc = hm["cy"] + 0.004
    # profil i enheter av rx: högre kupa med svag spets, rak sida, sluttande brätte
    kupa = [(0.0, 1.50), (0.10, 1.485), (0.24, 1.44), (0.42, 1.34), (0.60, 1.19), (0.75, 1.00),
            (0.87, 0.77), (0.95, 0.52), (0.995, 0.27), (1.01, 0.10), (1.01, 0.0)]
    bratte = [(1.08, -0.045), (1.22, -0.13), (1.39, -0.24), (1.56, -0.36), (1.71, -0.47),
              (1.82, -0.55), (1.88, -0.60)]
    profil = [(r * rx, z * rx) for r, z in kupa + bratte]
    nk = len(kupa)
    sommar = [math.pi / 4 + k * math.pi / 2 for k in range(4)]   # sömmar diagonalt (syns framifrån)

    def form(a, z):
        f = 1.0
        if z > 0.015:                                # upphöjda sömmar
            for s0 in sommar:
                da = math.atan2(math.sin(a - s0), math.cos(a - s0))
                f += 0.034 * math.exp(-(da / 0.075) ** 2)
        if z < -0.01:                                # brättet hänger lite mer fram/bak
            f *= 1.0 + 0.03 * math.cos(2 * a) * min(1.0, -z / (0.3 * rx))
        return f

    bm = bmesh.new()
    A.lathe(bm, profil, 40, rx=1.0, ry=kv, radiefunk=form, matris=Matrix.Translation((0, yc, zb)))
    hj = A.nytt_objekt(f"SM_{A.P}_Hjalm", bm, kol, K.rig, [M["hjalm"]])
    A.solidify(hj, 0.005, offset=-1.0)               # synlig metalltjocklek
    A.skarpa_kanter(hj, 55)

    # förstärkt, rullad ytterkant (följer brättets form)
    r_k, z_k = profil[-1]
    bm = bmesh.new()
    pts = []
    for k in range(49):
        a = 2 * math.pi * k / 48
        f = form(a, z_k)
        pts.append(Vector((r_k * f * math.cos(a), yc + r_k * f * kv * math.sin(a), zb + z_k - 0.0025)))
    A.ror(bm, pts, [0.0058] * len(pts), 6)
    kant = A.nytt_objekt(f"SM_{A.P}_Hjalm_Kant", bm, kol, K.rig, [M["hjalm"]])

    # förstärkningsband runt kupans fot
    bm = bmesh.new()
    rb = rx * 1.01
    bandprofil = [(rb + 0.0005, 0.033), (rb + 0.0045, 0.030), (rb + 0.0055, 0.004), (rb + 0.002, -0.001)]
    A.lathe(bm, bandprofil, 40, ry=kv, matris=Matrix.Translation((0, yc, zb)))
    band = A.nytt_objekt(f"SM_{A.P}_Hjalm_Band", bm, kol, K.rig, [M["hjalm"]])

    # nitar: runt bandet + längs varje söm
    bm = bmesh.new()

    def nit(p, n, r=0.0052):
        vv = bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=4, radius=r)["verts"]
        bmesh.ops.delete(bm, geom=[v for v in vv if v.co.z < -1e-5], context="VERTS")
        vv = [v for v in vv if v.is_valid]
        bmesh.ops.transform(bm, matrix=A.axel_matris(p, n) @ Matrix.Diagonal((1, 1, 0.6, 1)), verts=vv)

    for k in range(20):
        a = 2 * math.pi * (k + 0.5) / 20
        r = rb + 0.005
        nit(Vector((r * math.cos(a), yc + r * kv * math.sin(a), zb + 0.0165)),
            Vector((math.cos(a), math.sin(a) / kv, 0)).normalized())

    def kupa_r(zh):
        for (r0, z0), (r1, z1) in zip(profil[:nk], profil[1:nk]):
            if z1 <= zh <= z0:
                return r0 + (r1 - r0) * (zh - z0) / (z1 - z0) if abs(z1 - z0) > 1e-9 else r0
        return rx

    for s0 in sommar:
        for zr in (0.22, 0.52, 0.82, 1.10):
            zh_ = zr * rx
            r = kupa_r(zh_) * 1.034
            p = Vector((r * math.cos(s0), yc + r * kv * math.sin(s0), zb + zh_))
            n = Vector((math.cos(s0), math.sin(s0) / kv, 0.25 + 0.5 * zr)).normalized()
            nit(p, n, 0.0042)
    # upphöjda sömskenor från bandet upp mot toppen
    for s0 in sommar:
        pts = []
        for i in range(9):
            zr = 0.03 + i * (1.36 - 0.03) / 8
            zh_ = zr * rx
            r = kupa_r(zh_) * 1.012 + 0.001
            pts.append(Vector((r * math.cos(s0), yc + r * kv * math.sin(s0), zb + zh_)))
        A.ror(bm, pts, [0.0048] * 8 + [0.003], 6)
    nitar = A.nytt_objekt(f"SM_{A.P}_Hjalm_Nitar", bm, kol, K.rig, [M["hjalm"]])

    # snörning: korsade läderstygn mellan nitarna längs sömmarna
    bm = bmesh.new()
    for s0 in sommar:
        for zr in (0.37, 0.67, 0.96, 1.22):
            zh_ = zr * rx
            r = kupa_r(zh_) * 1.034 + 0.0015
            p = Vector((r * math.cos(s0), yc + r * kv * math.sin(s0), zb + zh_))
            n = Vector((math.cos(s0), math.sin(s0) / kv, 0.25 + 0.5 * zr)).normalized()
            tang = Vector((-math.sin(s0), math.cos(s0) * kv, 0)).normalized()
            upp = n.cross(tang).normalized()
            for vrid in (1, -1):
                a = (tang + upp * vrid).normalized() * 0.019
                bb = n.cross(a).normalized() * 0.0036
                c0 = p + n * 0.0012
                bm.faces.new([bm.verts.new(c0 - a - bb), bm.verts.new(c0 + a - bb),
                              bm.verts.new(c0 + a + bb), bm.verts.new(c0 - a + bb)])
    snore = A.nytt_objekt(f"SM_{A.P}_Hjalm_Snorning", bm, kol, K.rig, [M["snore"]], slat=False)
    A.solidify(snore, 0.0016, offset=1.0)

    # läderfoder: mörkt band mellan hjälmens kant och huvudet
    bm = bmesh.new()
    huvud_r = rx - 0.026
    fod = [(rx - 0.004, 0.012), (huvud_r + 0.010, 0.004), (huvud_r + 0.0065, -0.008), (huvud_r + 0.0055, -0.014)]
    A.lathe(bm, fod, 32, ry=(ry - 0.004) / (rx - 0.004), matris=Matrix.Translation((0, yc, zb)))
    foder = A.nytt_objekt(f"SM_{A.P}_Hjalm_Foder", bm, kol, K.rig, [M["ladermork"]])
    A.solidify(foder, 0.002, offset=-1.0)

    delar = [hj, kant, band, nitar, snore, foder]
    for o in delar:
        V.ett_ben(o, "head.x")
        deformera(A, o, K.rig)
        markera(o, "huvud")
    topp = zb + profil[0][1]
    R.append(f"Hjälm: kupa rx {rx:.3f} / ry {ry:.3f} m, fot z {zb:.3f}, topp z {topp:.3f}, "
             f"brätte Ø {2 * r_k:.2f} m")
    return delar, zb


# =============================================================== hår, skägg, mustasch
def bygg_har_skagg(A, K, kol, M, hm, zb_hjalm):
    C, H, zh = hm["C"], hm["H"], hm["haka"]

    def vinkel(c):                                   # 0 = rakt fram, 180 = bak
        return abs(math.degrees(math.atan2(c.x, -(c.y - C.y))))

    def rel(c):
        return (c.z - zh) / H

    # hår: bara det som syns under hjälmen (tinningar, runt öronen, nacke)
    def behall_har(f, typ):
        if typ not in ("huvud", "hals"):
            return False
        c = f.calc_center_median()
        if c.z > zb_hjalm + 0.02:
            return False                             # under kupan – syns inte
        h, v = rel(c), vinkel(c)
        if v < 58:
            return False                             # ansiktet
        if v < 95:
            return h > 0.50                          # tinning/polisong
        return h > 0.20                              # bakhuvud och nacke

    def har_off(v):
        h = rel(v.co)
        lugg = 0.5 + 0.5 * math.sin(math.atan2(v.co.x, -(v.co.y - C.y)) * 13.0 + v.co.z * 40.0)
        return 0.006 + 0.007 * max(0.0, 0.7 - h) + 0.004 * lugg

    har = A.nytt_lager(K, f"SM_{A.P}_Har", behall_har, har_off, [M["har"]], kol=kol,
                       jamna_kant=3, mal_tris=1100)

    # skägg: kort helskägg längs käklinjen, haka och under hakan
    def behall_skagg(f, typ):
        if typ not in ("huvud", "hals"):
            return False
        c = f.calc_center_median()
        h, v = rel(c), vinkel(c)
        if v > 98:
            return False
        if h < 0.0:
            return c.y < C.y - 0.015 and c.z > zh - 0.045       # under hakan
        if v < 20 and 0.12 < h < 0.25:
            return False                                       # munnen
        if h < 0.18:
            return True                                        # haka
        if v < 45:
            return h < 0.20                                    # kinderna fria
        return h < 0.36 + 0.0025 * max(0.0, v - 60)            # käklinje upp mot polisongen

    def skagg_off(v):
        h = rel(v.co)
        haka = math.exp(-((v.co.x / 0.045) ** 2 + ((h - 0.03) / 0.13) ** 2))
        return 0.0045 + 0.004 * max(0.0, 0.45 - h) / 0.45 + 0.008 * haka

    skagg = A.nytt_lager(K, f"SM_{A.P}_Skagg", behall_skagg, skagg_off, [M["har"]], kol=kol,
                         jamna_kant=3, mal_tris=900)

    # mustasch (ingen ögonbryn – modellen har egna)
    def yta(x, z, ut=0.0):
        h, n = A.stral(K.bvh, (x, C.y - 0.5, z), (0, 1, 0))
        return (h + Vector((0, -ut, 0))) if h else Vector((x, C.y - 0.12, z))

    bm = bmesh.new()
    zm = zh + 0.262 * H
    for sx in (-1, 1):
        pts = [yta(sx * x, zm - 2.0 * x * x - (0.0 if x < 0.02 else 0.9 * (x - 0.02)), 0.004)
               for x in (0.002, 0.011, 0.020, 0.028, 0.034, 0.038)]
        A.ror(bm, pts, [0.0072, 0.0082, 0.0078, 0.0066, 0.0052, 0.0034], 6, platt=0.7)
    mu = A.nytt_objekt(f"SM_{A.P}_Mustasch", bm, kol, K.rig, [M["har"]])

    delar = [o for o in (har, skagg) if o]
    for o in delar:
        markera(o, "huvud")
    return delar, mu


# =============================================================== axlar
def arm_radie(K, p, d, maxr=0.09):
    r = 0.0
    for v in K.obj.data.vertices:
        q = v.co - p
        if abs(q.dot(d)) < 0.018:
            vr = (q - d * q.dot(d)).length
            if vr < maxr:
                r = max(r, vr)
    return r


def bygg_axlar(A, K, kol, M, vadd, V):
    L = A.L
    sk = L["s"]
    delar = []
    for s in (-1, 1):
        ax, ab, hl = K.arm(s)
        d = (ab - ax).normalized()
        c = ax + Vector((s * 0.006, 0.0, 0.03)) * sk
        mat0 = A.axel_matris(c, -d)                    # lokal +Z mot axeln
        PAN = 6
        steg = 2 * math.pi / PAN
        # vrid så att sömmarna hamnar på segmentgränser och en vit panel pekar rakt fram (-Y)
        fram = mat0.inverted().to_3x3() @ Vector((0, -1, 0))
        a0 = math.atan2(fram.y, fram.x)
        mat = mat0 @ Matrix.Rotation(a0 - steg / 2, 4, "Z")
        inv = mat.inverted()
        r_arm = arm_radie(K, ax + d * 0.13 * sk, d)
        # puff: rundad topp, största volym på mitten, smalnar mot bandet
        profil = [(0.0, 0.062), (0.040, 0.059), (0.068, 0.047), (0.087, 0.027), (0.097, 0.002),
                  (0.099, -0.027), (0.094, -0.056), (0.084, -0.080), (0.074, -0.097)]
        profil = [(r * sk, z * sk) for r, z in profil]
        z_slut = profil[-1][1]
        rb = r_arm + 0.022                              # tätt mot överarmen
        profil.append((rb, z_slut - 0.010 * sk))

        def panel_form(a, z):
            if z > 0.068 * sk:
                return 1.0
            sida = abs(math.sin(PAN / 2 * a))                        # 0 i sömmen, 1 mitt på panelen
            djup = 0.055 if z > z_slut + 0.02 * sk else 0.02
            return (1.0 - djup) + djup * sida ** 0.55

        bm = bmesh.new()
        ringar = A.lathe(bm, profil, 36, matris=mat, radiefunk=panel_form)

        def axelpunkt(cc):
            lok = inv @ cc
            return mat @ Vector((0, 0, lok.z))

        for marg in (0.009, 0.008):                     # anpassa – jämna ut – anpassa (inga knölar)
            A.anpassa_utat(K, bm, axelpunkt, marg, extra=[vadd], maxdist=0.04)
            for _ in range(3):
                bmesh.ops.smooth_vert(bm, verts=bm.verts[:], factor=0.45,
                                      use_axis_x=True, use_axis_y=True, use_axis_z=True)
        A.anpassa_utat(K, bm, axelpunkt, 0.007, extra=[vadd], maxdist=0.04)
        nedre = [(inv @ v.co) for v in ringar[-1]]      # puffens nedersta ring – bandet följer den
        namn = f"SM_{A.P}_Axelskydd_" + ("V" if s > 0 else "H")
        o = A.nytt_objekt(namn, bm, kol, K.rig, [M["vit"], M["bla"]])

        def klass(cc, n):
            lok = inv @ cc
            a = math.atan2(lok.y, lok.x) % (2 * math.pi)
            return int(a / steg) % 2                  # 0 = vit (fram), 1 = blå

        A.satt_material_per_yta(o, klass)
        V.fran_kropp(o, filter_fn=lambda q: q.z > L["nyckel"] - 0.30)
        deformera(A, o, K.rig)
        markera(o, "arm_v" if s > 0 else "arm_h")
        delar.append(o)

        # läderband som avslutar puffen mot överarmen (följer puffens sista ring)
        bm = bmesh.new()
        pts = []
        for lok in nedre[::2] + [nedre[0]]:
            rad = Vector((lok.x, lok.y, 0))
            pts.append(mat @ (lok + rad.normalized() * 0.0035 + Vector((0, 0, 0.004))))
        A.ror(bm, pts, [0.0070] * len(pts), 6, platt=0.5)
        bo = A.nytt_objekt(f"SM_{A.P}_Axelband_" + ("V" if s > 0 else "H"), bm, kol, K.rig, [M["lader"]])
        V.fran_kropp(bo)
        deformera(A, bo, K.rig)
        markera(bo, "arm_v" if s > 0 else "arm_h")
        delar.append(bo)
    R.append(f"Axlar: puff {PAN} paneler/sida (vit fram), läderband vid överarmen")
    return delar


# =============================================================== ärmar (vaddering)
def bygg_vaddering_b1(A, K, kol, M):
    L = A.L
    Lo_s = {s: (K.arm(s)[1] - K.arm(s)[0]).length for s in (-1, 1)}

    def behall(f, typ):
        c = f.calc_center_median()
        if typ in ("overarm", "underarm"):
            return True
        if typ in ("bal", "nyckelben"):
            return c.z > L["hoft"] - 0.005 and not (c.z > L["nyckel"] + 0.035 and abs(c.x) < 0.09 * L["s"])
        return False

    def armbage_veck(c, s):
        """Mjuka utåtgående veck runt armbågen, mest på insidan (armvecket)."""
        t, dist, centr, d = A.arm_param(K, c, s)
        Lo = Lo_s[s]
        u = t - Lo
        if abs(u) > 0.075 or dist > 0.13:
            return 0.0
        r = (c - centr)
        if r.length < 1e-6:
            return 0.0
        fram = Vector((0, -1, 0))
        fram = (fram - d * fram.dot(d)).normalized()
        inne = max(0.0, r.normalized().dot(fram))        # 1 i armvecket
        vag = max(0.0, math.sin(2 * math.pi * u / 0.034 + 0.6 * s)) ** 1.5
        fade = math.cos(0.5 * math.pi * u / 0.075)
        return 0.0065 * vag * fade * (0.35 + 0.65 * inne)

    def offset(v):
        c = v.co
        if abs(c.x) > 0.7 * L[("arm", 1)][0].x:
            s = 1 if c.x > 0 else -1
            t, dist, _, _ = A.arm_param(K, c, s)
            if dist < 0.13:
                Lo = Lo_s[s]
                tot = Lo + (K.arm(s)[2] - K.arm(s)[1]).length
                bas = 0.017 if t < Lo else 0.016 - 0.007 * max(0.0, (t - Lo) / (tot - Lo))
                return bas + armbage_veck(c, s)
        return 0.010

    o = A.nytt_lager(K, f"SM_{A.P}_Vaddering", behall, offset, [M["vadd"]], kol=kol, mal_tris=3300)
    me = o.data
    attr = me.attributes.new("QUILT", "FLOAT_VECTOR", "POINT")
    for v in me.vertices:
        c = v.co
        s = 1 if c.x > 0 else -1
        t, dist, centr, d = A.arm_param(K, c, s)
        if abs(c.x) > 0.7 * L[("arm", 1)][0].x and dist < 0.13:
            r = c - centr
            e1 = Vector((0, -1, 0))
            e1 = (e1 - d * e1.dot(d)).normalized()
            e2 = d.cross(e1)
            omkr = max(0.03, dist)                                     # verklig båglängd runt armen
            attr.data[v.index].vector = (math.atan2(r.dot(e2), r.dot(e1)) * omkr, t, 0.0)
        elif abs(v.normal.z) > 0.6:
            attr.data[v.index].vector = (c.x, c.y, 0.0)                # ovansida (axlar)
        elif abs(v.normal.x) > 0.75:
            attr.data[v.index].vector = (c.y, c.z, 0.0)                # sidor
        else:
            attr.data[v.index].vector = (c.x, c.z, 0.0)
    markera(o, "flera (vikter)")
    return o


# =============================================================== huvudprogram
def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def kor():
    random.seed(11)
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    A = ladda_A()
    rig, kropp = A.hitta_bas()
    sakerhetskopia()
    gamla = {n: tris(bpy.data.objects[n]) for n in ERSATTS if bpy.data.objects.get(n)}
    borttagna = rensa(A)
    A.landmarken(rig, kropp)
    K = A.Kropp(kropp, rig, None)
    V = Vikter(K)
    kol = A.samlingar()
    M = A.skapa_material()
    M["hjalm"] = mat_hjalm(A)
    M["snore"] = mat_snore(A)
    M["har"] = mat_har_b1(A)
    M["vadd"] = mat_vaddering_b1(A)

    nya = []
    vadd = bygg_vaddering_b1(A, K, kol, M)
    nya.append(vadd)
    hm = A.huvud_matt(K)
    hj, zb = bygg_hjalm(A, K, kol, M, hm, V)
    nya += hj
    hs, mu = bygg_har_skagg(A, K, kol, M, hm, zb)
    V.ett_ben(mu, "head.x")
    deformera(A, mu, rig)
    markera(mu, "huvud")
    nya += hs + [mu]
    nya += bygg_axlar(A, K, kol, M, vadd, V)

    # ---- rapport
    alla = [o for o in bpy.data.objects if o.get(A.TAGG) and o.type == "MESH"
            and o.get("metod") == A.METOD and not any(c.name.endswith("Arkiv") for c in o.users_collection)]
    utr = sum(tris(o) for o in alla)
    bas = tris(kropp) + sum(tris(o) for o in bpy.data.objects
                            if o.type == "MESH" and o != kropp and not o.get(A.TAGG)
                            and any(m.type == "ARMATURE" and m.object == rig for m in o.modifiers))
    draws = sum(max(1, len([m for m in o.data.materials if m])) for o in alla)
    utan_rigg = [o.name for o in nya if not any(m.type == "ARMATURE" and m.object == rig for m in o.modifiers)
                 or len(o.vertex_groups) == 0]
    max_inf = max((len([g for g in v.groups if g.weight > 0]) for o in nya for v in o.data.vertices), default=0)
    rader = [f"  {o.name:32s} {tris(o):6d}  ({o['kroppsdel']})" for o in sorted(nya, key=lambda o: -tris(o))]
    text = [f"STADSVAKT {VERSION}"] + R + [
        f"Ersatta delar (gamla trianglar): " + ", ".join(f"{k.replace('SM_Stadsvakt_', '')} {v}" for k, v in gamla.items()),
        f"Borttaget: {borttagna} objekt   nya: {len(nya)}",
        f"Rigg: alla nya delar har Armature + vikter: {'JA' if not utan_rigg else 'NEJ ' + str(utan_rigg)}"
        f"   max ben/hörn i nya delar: {max_inf}",
        f"Trianglar: utrustning {utr}  basmodell {bas}  totalt {utr + bas}",
        f"Draw calls (objekt × material, utrustning): ca {draws}"] + rader
    if utr + bas > 25000:
        text.append("VARNING: över 25k trianglar totalt – åtgärdas i skript E (förenklad spelkropp, dold hud, tänder).")
    print("\n".join(text))
    return "\n".join(text)


if __name__ == "__main__":
    resultat_text = kor()
