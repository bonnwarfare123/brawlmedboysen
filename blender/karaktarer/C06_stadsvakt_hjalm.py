"""
C06_stadsvakt_hjalm.py  –  Brawl med Boysen, Stadsvakten: HJÄLMEN (kettle hat) förfinad
======================================================================================
Klistra in i Scripting-fliken (stadsvakt.blend) och kör. Byter BARA hjälmens delar;
kropp, kläder, rigg och vikter rörs inte. Kräver C04 och C05 i samma mapp (lånar mått
och verktyg). Kan köras om. Kör C10_spelmodell_export.py efteråt för spelet.

Förebild: senmedeltida kettle hat (järnhatt), ca 1400–1470:
  - kupa smidd i fyra segment; skarvarna täcks av nitade skarvband som möts i en
    toppbricka (ersätter de tidigare korsade läderstygnen, som inte finns på riktiga hjälmar)
  - nitat förstärkningsband runt kupans fot
  - brätte i ett stycke som sluttar ca 17° nedåt, med rullad/vikt kant (tjockare kant)
  - mjuk hålkäl mellan kupa och brätte
  - läderfoder (synligt under brättet) och hakrem
  - hjälmen sitter med brättets kant strax ovanför ögonbrynen

Polygonbudget: ca 2 500 trianglar för hela hjälmen.
"""

import bpy
import bmesh
import math
import os
import time
import importlib.util
from mathutils import Vector, Matrix

C05_FIL = "C05_stadsvakt_B1_hjalm_axlar_armar.py"
DELAR_PREFIX = "SM_Stadsvakt_Hjalm"
STEG = "C06"
R = []

# ---- mått (i enheter av kuparadien rx, mätt från huvudet)
KLARING = 0.012          # foder mellan huvud och kupa (m)
KUPA_HOJD = 1.18         # kupans höjd över foten (× rx)
BRATTE_UT = 1.58         # brättets ytterradie (× rx)
BRATTE_FALL = 0.30       # brättets fall från kupans fot till kanten (× (BRATTE_UT-1) × rx) ≈ 17°
PLAT = 0.0035            # godstjocklek (m)
SEG = 32                 # segment runt hjälmen


def ladda(fil, namn):
    mapp = os.path.dirname(bpy.data.filepath)
    p = os.path.join(mapp, fil)
    if not os.path.isfile(p):
        raise RuntimeError(f"Hittar inte {fil} bredvid .blend-filen ({mapp}).")
    spec = importlib.util.spec_from_file_location(namn, p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def ta_bort_gamla():
    n = 0
    for o in [o for o in bpy.data.objects if o.name.startswith(DELAR_PREFIX)]:
        if any(c.name.startswith("COL_Spelexport") or c.name.endswith("Arkiv") for c in o.users_collection):
            continue
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)
        n += 1
    return n


# =============================================================== material
def mat_stal(A):
    """Smitt stål: mörkt grått, metallic, roughness som varierar (hamrat), ljusare slitna kanter,
    diskreta rostprickor i vecken – inte blankt som plast."""
    m = A.nytt_material(f"MAT_{A.P}_Metall_Hjalm")
    b = A.Nod(m)
    var = b.brus(3.0, 4.0)
    fl = b.brus(11.0, 5.0, 0.62)
    repor = b.brus(90.0, 2.0, 0.5, stracka=(1.0, 6.0, 1.0))
    hamr = b.voronoi(42.0)
    kant = b.kanter()
    rost = b.ramp(b.brus(7.0, 6.0, 0.7), 0.0, 1.0, 0.68, 0.80)
    f = b.blanda(b.ramp(var, 0.0, 1.0, 0.25, 0.75), b.farg("#6c6f72"), b.farg("#575a5d"))
    f = b.blanda(b.math("MULTIPLY", kant, 0.6), f, b.farg("#a9adb0"))           # slitna kanter
    f = b.blanda(b.math("MULTIPLY", rost, 0.55), f, b.farg("#5b3b26"))          # lite rost
    b.satt(["Base Color"], f)
    b.satt(["Metallic"], b.ramp(rost, 0.95, 0.45))
    r = b.ramp(fl, 0.40, 0.62)
    r = b.math("ADD", r, b.math("MULTIPLY", rost, 0.3))
    r = b.math("SUBTRACT", r, b.math("MULTIPLY", kant, 0.12))
    r = b.math("ADD", r, b.math("MULTIPLY", b.ramp(repor, 0.0, 1.0, 0.55, 0.75), 0.08))
    b.satt(["Roughness"], r)
    n = b.bump(hamr, 0.22, 0.0018)                                                # hammarslag
    n = b.bump(repor, 0.05, 0.0003, n)
    b.satt(["Normal"], n)
    return m


# =============================================================== hjälmen
def bygg(A, B1, K, kol, M, V):
    hm = A.huvud_matt(K)
    topp, haka, H = hm["topp"], hm["haka"], hm["H"]
    # kupans fot: ett par cm ovanför ögonbrynen (bryn ≈ 70 % upp från hakan)
    bryn = haka + 0.62 * H
    zb = bryn + 0.032
    nara = [p for p in hm["pts"] if abs(p.z - zb) < 0.012]
    hx = max(abs(p.x) for p in nara)
    hy_f = min(p.y for p in nara)
    hy_b = max(p.y for p in nara)
    yc = (hy_f + hy_b) / 2
    rx = hx + KLARING
    ry = (hy_b - hy_f) / 2 + KLARING
    kv = ry / rx
    kupa_h = max(KUPA_HOJD, (topp + 0.010 - zb) / rx)

    # profil (r, z) i enheter av rx, uppifrån och ned: rundad kupa, hålkäl, sluttande brätte
    kupa = [(0.0, kupa_h), (0.16, kupa_h - 0.018), (0.34, kupa_h - 0.075), (0.52, kupa_h - 0.18),
            (0.68, kupa_h * 0.72), (0.81, kupa_h * 0.54), (0.91, kupa_h * 0.36), (0.97, kupa_h * 0.19),
            (1.0, kupa_h * 0.07), (1.0, 0.0)]
    fall = BRATTE_FALL * (BRATTE_UT - 1.0)
    hal = [(1.02, -0.012), (1.055, -0.028)]
    bratte = [(1.0 + t * (BRATTE_UT - 1.0), -0.028 - (fall - 0.028) * t) for t in (0.25, 0.5, 0.75, 1.0)]
    profil = [(r * rx, z * rx) for r, z in kupa + hal + bratte]
    nk = len(kupa)

    def ytpunkt(a, zr, ut=0.0):
        """Punkt på kupans yta (zr i enheter av rx över foten) + utåt ut (m)."""
        for (r0, z0), (r1, z1) in zip(profil[:nk], profil[1:nk]):
            if z1 <= zr * rx <= z0 and abs(z0 - z1) > 1e-9:
                t = (zr * rx - z0) / (z1 - z0)
                r = r0 + (r1 - r0) * t
                dr, dz = r1 - r0, z1 - z0
                nrm = Vector((dz * math.cos(a), dz * math.sin(a) / kv, -dr)).normalized()
                if nrm.z < -0.2 and zr > 0.5:
                    nrm = -nrm
                p = Vector((r * math.cos(a), yc + r * kv * math.sin(a), zb + zr * rx))
                n_ut = Vector((math.cos(a) * (abs(dz) + 1e-6), math.sin(a) / kv * (abs(dz) + 1e-6), abs(dr)))
                n_ut.normalize()
                return p + n_ut * ut, n_ut
        return Vector((0, yc, zb + kupa_h * rx + ut)), Vector((0, 0, 1))

    delar = []
    stal = M["stal"]

    # 1. kupa + brätte i ett stycke med godstjocklek
    bm = bmesh.new()
    A.lathe(bm, profil, SEG, rx=1.0, ry=kv, matris=Matrix.Translation((0, yc, zb)))
    hj = A.nytt_objekt(f"{DELAR_PREFIX}", bm, kol, K.rig, [stal])
    A.solidify(hj, PLAT, offset=-1.0)
    delar.append(hj)

    # 2. rullad kant runt brättet (tjockare, avrundad kant som på smidda brätten)
    r_k, z_k = profil[-1]
    bm = bmesh.new()
    pts = [Vector((r_k * math.cos(2 * math.pi * k / 40), yc + r_k * kv * math.sin(2 * math.pi * k / 40),
                   zb + z_k - PLAT * 0.5)) for k in range(41)]
    A.ror(bm, pts, [0.0042] * len(pts), 6, platt=0.8)
    delar.append(A.nytt_objekt(f"{DELAR_PREFIX}_Kant", bm, kol, K.rig, [stal]))

    # 3. förstärkningsband runt kupans fot + fyra skarvband över kupan + toppbricka
    bm = bmesh.new()
    rb = rx * 1.0 + 0.0008
    band = [(rb + 0.0002, 0.024), (rb + 0.0020, 0.0228), (rb + 0.0022, 0.0015), (rb + 0.0006, -0.0005)]
    A.lathe(bm, band, SEG, ry=kv, matris=Matrix.Translation((0, yc, zb)))
    sommar = [-math.pi / 2, 0.0, math.pi / 2, math.pi]       # fram (−Y), sidor, bak
    for a in sommar:
        rad_v, rad_h = [], []
        zrs = [0.24 + i * (kupa_h - 0.16 - 0.24) / 9 for i in range(10)]
        tang = Vector((-math.sin(a), math.cos(a) * kv, 0)).normalized()
        for zr in zrs:
            p, n = ytpunkt(a, zr, 0.0006)
            w = 0.011 * (1.0 - 0.35 * (zr / kupa_h))           # bandet smalnar mot toppen
            rad_v.append((p - tang * w, n))
            rad_h.append((p + tang * w, n))
        vs = []
        for (pv, n), (ph, _) in zip(rad_v, rad_h):
            vs.append([bm.verts.new(pv), bm.verts.new(ph), bm.verts.new(ph + n * 0.0022), bm.verts.new(pv + n * 0.0022)])
        for r0, r1 in zip(vs, vs[1:]):
            for k in range(4):
                bm.faces.new((r0[k], r0[(k + 1) % 4], r1[(k + 1) % 4], r1[k]))
        bm.faces.new(list(reversed(vs[0])))
        bm.faces.new(vs[-1])
    topp_p = Vector((0, yc, zb + kupa_h * rx))
    A.lathe(bm, [(0.0, 0.0028), (0.018, 0.0018), (0.026, 0.0)], 16,
            matris=Matrix.Translation(topp_p))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    delar.append(A.nytt_objekt(f"{DELAR_PREFIX}_Band", bm, kol, K.rig, [stal]))

    # 4. nitar: runt fotbandet och längs skarvbanden (kupolformade nithuvuden)
    bm = bmesh.new()

    def nit(p, n, r=0.0045):
        vv = bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=3, radius=r)["verts"]
        bmesh.ops.delete(bm, geom=[v for v in vv if v.co.z < -1e-5], context="VERTS")
        vv = [v for v in vv if v.is_valid]
        bmesh.ops.transform(bm, matrix=A.axel_matris(p, n) @ Matrix.Diagonal((1, 1, 0.55, 1)), verts=vv)

    antal = 0
    for k in range(16):
        a = 2 * math.pi * (k + 0.5) / 16
        r = rb + 0.0021
        nit(Vector((r * math.cos(a), yc + r * kv * math.sin(a), zb + 0.012)),
            Vector((math.cos(a), math.sin(a) / kv, 0)).normalized())
        antal += 1
    for a in sommar:
        for zr in (0.42, 0.78, 1.0):
            p, n = ytpunkt(a, zr, 0.0026)
            nit(p, n, 0.0036)
            antal += 1
    nit(topp_p + Vector((0, 0, 0.0028)), Vector((0, 0, 1)), 0.005)
    delar.append(A.nytt_objekt(f"{DELAR_PREFIX}_Nitar", bm, kol, K.rig, [stal]))

    # 5. läderfoder (syns som en mörk kant under brättet och mot pannan)
    bm = bmesh.new()
    fod = [(rx - 0.002, 0.012), (rx - KLARING + 0.0045, 0.003), (rx - KLARING + 0.0035, -0.006),
           (rx - KLARING + 0.004, -0.011)]
    A.lathe(bm, fod, 32, ry=(ry - 0.002) / (rx - 0.002), matris=Matrix.Translation((0, yc, zb)))
    fo = A.nytt_objekt(f"{DELAR_PREFIX}_Foder", bm, kol, K.rig, [M["ladermork"]])
    A.solidify(fo, 0.002, offset=-1.0)
    delar.append(fo)

    # 6. hakrem: från fodret bakom tinningen, ned längs käken till under hakan
    bm = bmesh.new()
    C = hm["C"]
    for s in (-1, 1):
        start = Vector((s * (rx - KLARING + 0.004), yc + 0.012, zb - 0.010))
        pts = []
        for i in range(9):
            t = i / 8
            z = (zb - 0.010) + (haka - 0.012 - (zb - 0.010)) * t
            nara = [p for p in hm["pts"] if abs(p.z - z) < 0.01 and p.x * s > 0 and abs(p.y - (yc + 0.01 - 0.05 * t)) < 0.03]
            x = (max(abs(p.x) for p in nara) + 0.010) * s if nara else start.x * (1 - 0.6 * t)
            x *= (1.0 - 0.85 * max(0.0, t - 0.75) / 0.25)        # möts under hakan
            pts.append(Vector((x, yc + 0.012 - 0.055 * t, z)))
        A.ror(bm, pts, [0.0060] * len(pts), 4, platt=0.28)
    delar.append(A.nytt_objekt(f"{DELAR_PREFIX}_Hakrem", bm, kol, K.rig, [M["ladermork"]]))

    for o in delar:
        V.ett_ben(o, "head.x")
        B1.deformera(A, o, K.rig)
        o["steg"] = STEG
        o["kroppsdel"] = "huvud"
    t = sum(len(p.vertices) - 2 for o in delar for p in o.data.polygons)
    vinkel = math.degrees(math.atan2(fall, BRATTE_UT - 1.0))
    R.append(f"Hjälm: kupa {2 * rx:.3f} × {2 * ry:.3f} m, höjd {kupa_h * rx:.3f} m, brätte Ø {2 * r_k:.2f} m "
             f"({vinkel:.0f}° fall), fot {zb - haka:.3f} m över hakan (bryn ≈ {bryn - haka:.3f})")
    R.append(f"Delar: {len(delar)}, nitar {antal}, trianglar {t}")
    return delar


def kor():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    B1 = ladda(C05_FIL, "stadsvakt_B1")
    A = B1.ladda_A()
    rig, kropp = A.hitta_bas()
    if not globals().get("SKIPPA_KOPIA"):
        mapp = os.path.join(os.path.dirname(bpy.data.filepath), "versioner")
        os.makedirs(mapp, exist_ok=True)
        ut = os.path.join(mapp, time.strftime("stadsvakt_fore_C06_%Y%m%d_%H%M%S.blend"))
        bpy.ops.wm.save_as_mainfile(filepath=ut, copy=True)
        R.append(f"Säkerhetskopia: {ut}")
    R.append(f"Borttagna gamla hjälmdelar: {ta_bort_gamla()}")
    A.landmarken(rig, kropp)
    K = A.Kropp(kropp, rig, None)
    V = B1.Vikter(K)
    kol = A.samlingar()
    # befintliga material återanvänds (skapa_material skulle skriva över B1:s förfiningar)
    M = {"ladermork": bpy.data.materials.get(f"MAT_{A.P}_Lader_Mork")}
    if M["ladermork"] is None:
        M["ladermork"] = A.mat_lader(f"MAT_{A.P}_Lader_Mork", "#3f2818", "#2c1c11", "#5c3e27")
    M["stal"] = mat_stal(A)
    bygg(A, B1, K, kol, M, V)
    txt = "\n".join(["STADSVAKT C06 – hjälm"] + R)
    print(txt)
    return txt


if __name__ == "__main__":
    resultat_text = kor()
