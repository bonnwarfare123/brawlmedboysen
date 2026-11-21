"""
C07_stadsvakt_axlar_brost.py  –  Brawl med Boysen, Stadsvakten: AXELSKYDD + TABARD/EMBLEM
=========================================================================================
Klistra in i Scripting-fliken (stadsvakt.blend) och kör. Kräver C04 och C05 i samma mapp.
Kan köras om. Kör C10_spelmodell_export.py efteråt för spelet.

Vad skriptet gör
  1. Axelskydden görs om från en styv puff till vadderade SPAULDRAR i tyg: en rundad
     axelkappa + två överlappande lameller ned längs överarmen (de glider över varandra
     när armen lyfts i stället för att sträckas). Blåvita paneler som förut, 6 mm
     vadderad tjocklek, mörka läderpaspoaler längs varje nederkant.
  2. Infästning: lamellerna nitas till två läderremmar (fram och bak) med mässingsnitar;
     en snörad läderflik (arming point) fäster kappan i vadderingen vid kragen.
  3. Emblemet läggs ned mot tabarden (1 mm resp. 2 mm över tyget i stället för 2–4 mm),
     så att det ser applicerat/broderat ut och inte svävar.
  (Taggiga kanter vid tabardens sidor och kragen rättas i exporten C10, som nu lämnar
   en kant av dold yta kvar i stället för att skära hackigt.)

Vikter: kappan delar på bål och överarm upptill, lamellerna följer överarmen; exporten
(C10, "axel") ger samma fördelning i spelet.
"""

import bpy
import bmesh
import math
import os
import time
import importlib.util
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

C05_FIL = "C05_stadsvakt_B1_hjalm_axlar_armar.py"
STEG = "C07"
ERSATTS = ("SM_Stadsvakt_Axelskydd", "SM_Stadsvakt_Axelband", "SM_Stadsvakt_Axelrem")
R = []

PAN = 5                       # paneler (vit/blå) i bågen
PAN_SEG = 4                   # segment per panel (sömmarna ligger exakt på kanter)
BAGE = math.radians(250)      # lamellernas båge runt armen (öppen mot armhålan)
SEG = PAN * PAN_SEG
TJOCK = 0.006                 # vaddering


def ladda(fil, namn):
    mapp = os.path.dirname(bpy.data.filepath)
    spec = importlib.util.spec_from_file_location(namn, os.path.join(mapp, fil))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def ta_bort_gamla():
    n = 0
    for o in [o for o in bpy.data.objects if o.name.startswith(ERSATTS)]:
        if any(c.name.startswith("COL_Spelexport") or c.name.endswith("Arkiv") for c in o.users_collection):
            continue
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)
        n += 1
    return n


def mat(namn):
    m = bpy.data.materials.get(namn)
    if m is None:
        raise RuntimeError(f"Materialet {namn} saknas – kör C04/C05 först.")
    return m


# =============================================================== axlarna
def bygg_sida(A, B1, K, kol, M, V, vadd, s):
    L = A.L
    sk = L["s"]
    ax, ab, hl = K.arm(s)
    d = (ab - ax).normalized()                       # nedåt längs överarmen
    c = ax + Vector((s * 0.004, 0.0, 0.022)) * sk
    mat0 = A.axel_matris(c, -d)                      # lokal +Z upp mot axeln
    inv0 = mat0.inverted()
    ut = inv0.to_3x3() @ Vector((s, 0, 0))           # rakt ut åt sidan, i lokala koordinater
    a_ut = math.atan2(ut.y, ut.x)
    fram = inv0.to_3x3() @ Vector((0, -1, 0))
    a_fram = math.atan2(fram.y, fram.x)
    r_arm = B1.arm_radie(K, ax + d * 0.12 * sk, d)

    def axelpunkt(cc):
        lok = inv0 @ cc
        return mat0 @ Vector((0, 0, lok.z))

    w = BAGE / PAN
    # bågens start läggs på en panelsöm, så att en vit panel hamnar mitt fram
    start = a_fram - w / 2 + round((a_ut - BAGE / 2 - (a_fram - w / 2)) / w) * w
    vinklar = [start + BAGE * i / SEG for i in range(SEG + 1)]

    def panel(a):                                    # 0 = vit, 1 = blå; vit panel mitt fram
        t = (a - a_fram) / w + 0.5
        return int(math.floor(t + 1e-6)) % 2

    def skal(namn, profil, ring_top=False):
        """Bågformat vadderat skal: profil [(r, z)] uppifrån; returnerar (objekt, nedre kantpunkter)."""
        bm = bmesh.new()
        rader = []
        for (r, z) in profil:
            rad = []
            for a in vinklar:
                # lätt kudd-form mellan panelsömmarna
                t = ((a - a_fram) / w + 0.5) % 1.0
                kudde = 1.0 + 0.035 * math.sin(math.pi * t) ** 0.7
                rad.append(bm.verts.new(mat0 @ Vector((r * kudde * math.cos(a), r * kudde * math.sin(a), z))))
            rader.append(rad)
        for r0, r1 in zip(rader, rader[1:]):
            for i in range(SEG):
                bm.faces.new((r0[i], r0[i + 1], r1[i + 1], r1[i]))
        for _ in range(2):
            A.anpassa_utat(K, bm, axelpunkt, 0.008, extra=[vadd], maxdist=0.05)
            bmesh.ops.smooth_vert(bm, verts=bm.verts[:], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        A.anpassa_utat(K, bm, axelpunkt, 0.007, extra=[vadd], maxdist=0.05)
        kant = [v.co.copy() for v in rader[-1]]
        # panelfärg bestäms per kolumn innan tjockleken läggs på (raka sömmar)
        for f in bm.faces:
            lok = inv0 @ f.calc_center_median()
            f.material_index = panel(math.atan2(lok.y, lok.x))
        zmin = min((inv0 @ v.co).z for v in rader[-1])
        o = A.nytt_objekt(namn, bm, kol, K.rig, [M["vit"], M["bla"], M["ladermork"]])
        A.solidify(o, TJOCK, offset=1.0)
        # läderkant: nedersta 8 mm (fram, bak och kanten)
        for p in o.data.polygons:
            lok = inv0 @ p.center                    # (meshens koordinater = riggens, som mat0)
            if lok.z < zmin + 0.008:
                p.material_index = 2
        return o, kant

    nm = "V" if s > 0 else "H"
    delar = []
    # axelkappa: rundad över axelkulan, ned till överarmens början
    rk = r_arm + 0.030
    kappa_prof = [(0.040 * sk, 0.068 * sk), (0.066 * sk, 0.060 * sk), (0.086 * sk, 0.040 * sk),
                  (0.096 * sk, 0.012 * sk), (rk + 0.004, -0.022 * sk), (rk, -0.048 * sk)]
    kappa, k0 = skal(f"SM_{A.P}_Axelskydd_{nm}_Kappa", kappa_prof)
    delar.append(kappa)
    # två lameller, varje överlappar den under med ~1,5 cm (övre utanpå)
    kanter = [k0]
    for i, (z0, z1, extra) in enumerate(((-0.036, -0.082, 0.020), (-0.070, -0.114, 0.012))):
        prof = [((r_arm + extra + 0.004), z0 * sk), ((r_arm + extra + 0.006), (z0 + z1) / 2 * sk),
                ((r_arm + extra + 0.003), z1 * sk)]
        lam, kk = skal(f"SM_{A.P}_Axelskydd_{nm}_Lam{i + 1}", prof)
        delar.append(lam)
        kanter.append(kk)


    # två lodräta remmar (fram och bak) som lamellerna är nitade till + nitar
    bm = bmesh.new()
    nitar = bmesh.new()

    def nit(p, n, r=0.0034):
        vv = bmesh.ops.create_uvsphere(nitar, u_segments=6, v_segments=3, radius=r)["verts"]
        bmesh.ops.delete(nitar, geom=[v for v in vv if v.co.z < -1e-5], context="VERTS")
        vv = [v for v in vv if v.is_valid]
        bmesh.ops.transform(nitar, matrix=A.axel_matris(p, n) @ Matrix.Diagonal((1, 1, 0.55, 1)), verts=vv)

    tmp = bmesh.new()
    for o in delar[:3]:
        tmp.from_mesh(o.data)
    bvh = BVHTree.FromBMesh(tmp)
    for a in (a_fram + 0.55 * s * -1, a_fram + math.pi - 0.55 * s * -1):
        if abs(math.atan2(math.sin(a - a_ut), math.cos(a - a_ut))) > BAGE / 2 - 0.15:
            continue
        rad = []
        for i in range(9):
            z = (0.045 - 0.16 * i / 8) * sk
            p0 = mat0 @ Vector((0.25 * math.cos(a), 0.25 * math.sin(a), z))
            hit = bvh.ray_cast(p0, (axelpunkt(p0) - p0).normalized(), 0.3)
            if hit[0] is None:
                continue
            rad.append((hit[0] + hit[1] * 0.0012, hit[1]))
        if len(rad) < 3:
            continue
        tang = None
        prev = None
        for i, (p, n) in enumerate(rad):
            t = (rad[min(i + 1, len(rad) - 1)][0] - rad[max(i - 1, 0)][0]).normalized()
            b = n.cross(t).normalized() * 0.008
            v4 = [bm.verts.new(p - b), bm.verts.new(p + b), bm.verts.new(p + b + n * 0.0025), bm.verts.new(p - b + n * 0.0025)]
            if prev:
                for k in range(4):
                    bm.faces.new((prev[k], prev[(k + 1) % 4], v4[(k + 1) % 4], v4[k]))
            prev = v4
            if i in (1, 4, 7):
                nit(p + n * 0.0026, n)
    tmp.free()
    # snörad flik (arming point) från kappans överkant in mot kragen
    topp = mat0 @ Vector((0.03 * math.cos(a_ut + math.pi * 0.9 * s), 0.03 * math.sin(a_ut + math.pi * 0.9 * s), 0.07 * sk))
    inre = topp + Vector((-s * 0.035, 0.0, -0.006))
    A.ror(bm, [topp + Vector((0, 0, 0.006)), (topp + inre) / 2 + Vector((0, 0, 0.008)), inre + Vector((0, 0, 0.004))],
          [0.005, 0.005, 0.004], 4, platt=0.35)
    rem = A.nytt_objekt(f"SM_{A.P}_Axelrem_{nm}", bm, kol, K.rig, [M["lader"]])
    nitobj = A.nytt_objekt(f"SM_{A.P}_Axelrem_{nm}_Nitar", nitar, kol, K.rig, [M["massing"]])
    delar += [rem, nitobj]

    for o in delar:
        V.fran_kropp(o, filter_fn=lambda q: q.z > L["nyckel"] - 0.30)
        B1.deformera(A, o, K.rig)
        o["steg"] = STEG
        o["kroppsdel"] = "arm_v" if s > 0 else "arm_h"
    return delar


# =============================================================== emblemet
def lagg_emblem(A):
    tab = bpy.data.objects.get(f"SM_{A.P}_Tabard_Fram")
    if not tab:
        return "tabarden saknas"
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(tab, dg)
    ut = []
    for namn, lyft in ((f"SM_{A.P}_Emblem_Kontur", 0.0009), (f"SM_{A.P}_Emblem", 0.0018)):
        o = bpy.data.objects.get(namn)
        if not o or o.get("c07_nedlagt"):
            continue
        me = o.data
        # emblemet är ett tunt skal: varje hörn behåller sin tjocklek men läggs närmare tyget
        for v in me.vertices:
            loc, n, i, dist = bvh.find_nearest(v.co)
            if loc is None:
                continue
            u = (v.co - loc)
            sida = 1.0 if u.dot(n) >= 0 else -1.0
            tj = max(0.0, u.dot(n) * sida - (0.0042 if "Kontur" not in namn else 0.0022))
            v.co = loc + n * (lyft + tj)
        me.update()
        o["c07_nedlagt"] = True
        ut.append(namn.split("_")[-1])
    return "emblem nedlagt mot tyget: " + ", ".join(ut)


def kor():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    B1 = ladda(C05_FIL, "stadsvakt_B1")
    A = B1.ladda_A()
    rig, kropp = A.hitta_bas()
    if not globals().get("SKIPPA_KOPIA"):
        mapp = os.path.join(os.path.dirname(bpy.data.filepath), "versioner")
        os.makedirs(mapp, exist_ok=True)
        ut = os.path.join(mapp, time.strftime("stadsvakt_fore_C07_%Y%m%d_%H%M%S.blend"))
        bpy.ops.wm.save_as_mainfile(filepath=ut, copy=True)
        R.append(f"Säkerhetskopia: {ut}")
    R.append(f"Borttagna gamla axeldelar: {ta_bort_gamla()}")
    A.landmarken(rig, kropp)
    K = A.Kropp(kropp, rig, None)
    V = B1.Vikter(K)
    kol = A.samlingar()
    M = {"vit": mat(f"MAT_{A.P}_Tyg_Vit"), "bla": mat(f"MAT_{A.P}_Tyg_Bla"),
         "ladermork": mat(f"MAT_{A.P}_Lader_Mork"), "lader": mat(f"MAT_{A.P}_Lader_Brun"),
         "massing": mat(f"MAT_{A.P}_Metall_Massing")}
    vadd = bpy.data.objects[f"SM_{A.P}_Vaddering"]
    delar = []
    for s in (1, -1):
        delar += bygg_sida(A, B1, K, kol, M, V, vadd, s)
    t = sum(len(p.vertices) - 2 for o in delar for p in o.data.polygons)
    R.append(f"Axlar: kappa + 2 lameller per sida, läderkant, remmar med nitar, "
             f"snörad flik – {len(delar)} delar, {t} trianglar")
    R.append(lagg_emblem(A))
    txt = "\n".join(["STADSVAKT C07 – axlar och bröst"] + R)
    print(txt)
    return txt


if __name__ == "__main__":
    resultat_text = kor()
