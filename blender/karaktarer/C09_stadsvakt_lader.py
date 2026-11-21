"""
C09_stadsvakt_lader.py  –  Brawl med Boysen, Stadsvakten: STÖVLAR, HANDSKAR, BÄLTE, VÄSKA, LÄDER
====================================================================================================
Klistra in i Scripting-fliken (stadsvakt.blend) och kör. Kräver C04, C05 och C08 i samma mapp.
Kan köras om: de gamla delarna flyttas första gången till samlingen
COL_Char_Stadsvakt_C09_Arkiv (dold), och nästa körning bygger om från början.
Kör C10_spelmodell_export.py efteråt för spelet.

Vad skriptet gör
  1. Läderstandard: ett gemensamt lädermaterial (brun, mörk, snöre, sula) med samma lager:
     färgvariation, narv och porer, mjuka veck, kantslitage, sömmar och slitage som styrs
     av två egenskaper på ytan (LADER_SOM = avstånd till sömmar, LADER_MASK = veck/slitage).
  2. Stövlar: byggs om från fotens verkliga form i skivor (häl, valv, tår), med en egen
     sula (mörkt läder, liten rand runt om), ovandel med söm över vristen, bakre söm i skaftet,
     stickad söm vid sulan och en nedvikt krage. Veck framtill vid vristen och slitage vid tå/häl.
     Byxbenet slutar inne i skaftet. Vikter från kroppen (följer fot och vad).
  3. Handskar: lite mjukare form, sömmar ("points") på handryggen, veck vid fingerlederna
     och slitage på knogarna. Manschetterna byggs om: tätare vid handleden, vidgar sig upp
     längs underarmen, snedskuren överkant, söm på insidan och kantsöm. Följer underarmen.
  4. Bälte: tunnare (5 mm) med rundade kanter, kantsömmar, lätt sänkt framtill. Spännet: rund
     ram och dorn. Bältesänden går ut genom spännet, genom en hälla, med rundad spets.
  5. Väska: på höger höft, kropp med rundade kanter och sömmar längs sidorna, lock med rundad
     nederkant och kantsöm, flik med mässingsknopp, två remmar som går runt bältet.
  6. Tabarden anpassas om (C08) så att den ligger innanför det nya bältet och väskan.
"""

import bpy
import bmesh
import math
import os
import time
import importlib.util
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

C05_FIL = "C05_stadsvakt_B1_hjalm_axlar_armar.py"
C08_FIL = "C08_stadsvakt_klader.py"
P = "Stadsvakt"
ARKIV = f"COL_Char_{P}_C09_Arkiv"
ERSATTS = ["Stovlar", "Manschetter", "Balte", "Balte_Ande", "Baltesspanne",
           "Vaska", "Vaska_Lock", "Vaska_Rem", "Vaska_Knapp"]
LANGT = 1.0                    # LADER_SOM: 1 + avstånd (m) → 0 = ingen egenskap = ingen söm
R = []


def ladda(fil, namn):
    mapp = os.path.dirname(bpy.data.filepath)
    spec = importlib.util.spec_from_file_location(namn, os.path.join(mapp, fil))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons) if o else 0


def obj(namn):
    return bpy.data.objects.get(f"SM_{P}_{namn}")


# =============================================================== 1. läderstandard
def mat_lader_std(A, m, bas, mork, ljus, rough=(0.48, 0.66), narv=1.0, trad="#b39c74"):
    b = A.Nod(m)
    var = b.brus(3.5, 3.0)
    flack = b.brus(22.0, 3.0)
    mask = b.separera(b.attribut("LADER_MASK"))
    veck_m, slit_m = mask[0], mask[1]
    som = b.separera(b.attribut("LADER_SOM"))

    def avst(c):
        return b.math("ABSOLUTE", b.math("SUBTRACT", c, LANGT))

    nara = None
    ranna = None
    for i in range(3):
        a = avst(som[i])
        n1 = b.ramp(a, 1.0, 0.0, 0.0005, 0.0012)            # tråden
        r1 = b.ramp(a, 1.0, 0.0, 0.0, 0.0024)               # nedtryckt sömfåra
        nara = n1 if nara is None else b.math("MAXIMUM", nara, n1)
        ranna = r1 if ranna is None else b.math("MAXIMUM", ranna, r1)
    o = b.separera(b.obj)
    strecksk = b.math("ADD", b.math("MULTIPLY", o[0], 0.7), b.math("ADD", b.math("MULTIPLY", o[1], 1.3), o[2]))
    streck = b.ramp(b.math("SINE", b.math("MULTIPLY", strecksk, 2 * math.pi / 0.0045)), 0.0, 1.0, -0.2, 0.5)
    stygn = b.math("MULTIPLY", nara, streck)
    # veck: tunna vågräta fåror där masken säger (vrist, fingerleder)
    veck = b.math("MULTIPLY", b.ramp(b.brus(55.0, 2.0, stracka=(1.0, 1.0, 7.0)), 0.0, 1.0, 0.45, 0.78), veck_m)
    slit = b.math("MAXIMUM", b.math("MULTIPLY", b.kanter(), 0.5),
                  b.math("MULTIPLY", slit_m, b.ramp(b.brus(28.0, 3.0), 0.35, 1.0, 0.35, 0.7)))
    f = b.blanda(b.ramp(var, 0.0, 1.0, 0.3, 0.75), b.farg(bas), b.farg(mork))
    f = b.blanda(b.ramp(flack, 0.0, 0.15, 0.4, 0.7), f, b.farg(mork))
    f = b.blanda(b.math("MULTIPLY", veck, 0.55), f, b.farg(mork))
    f = b.blanda(b.math("MULTIPLY", ranna, 0.35), f, b.farg(mork))
    f = b.blanda(b.math("MULTIPLY", slit, 0.55), f, b.farg(ljus))
    f = b.blanda(b.math("MULTIPLY", stygn, 0.85), f, b.farg(trad))
    b.satt(["Base Color"], f)
    b.satt(["Metallic"], 0.0)
    rr = b.ramp(var, rough[0], rough[1])
    rr = b.math("ADD", rr, b.math("MULTIPLY", slit, 0.12))
    rr = b.math("ADD", rr, b.math("MULTIPLY", veck, 0.06))
    b.satt(["Roughness"], rr)
    b.satt(["Specular IOR Level", "Specular"], 0.45)
    n = b.bump(b.voronoi(220.0), 0.10 * narv, 0.0004)                    # porer
    n = b.bump(b.brus(45.0, 3.0), 0.06 * narv, 0.001, n)                 # narv
    n = b.bump(b.math("SUBTRACT", 1.0, veck), 0.45, 0.0015, n)           # veck (fåror)
    n = b.bump(b.math("SUBTRACT", 1.0, ranna), 0.35, 0.0008, n)          # sömfåra
    n = b.bump(stygn, 0.25, 0.0004, n)                                   # tråden
    b.satt(["Normal"], n)
    return m


def material(A):
    def hamta(namn):
        m = bpy.data.materials.get(namn) or bpy.data.materials.new(namn)
        return m
    M = {
        "brun": mat_lader_std(A, hamta(f"MAT_{P}_Lader_Brun"), "#6f4629", "#4e301b", "#93673f"),
        "mork": mat_lader_std(A, hamta(f"MAT_{P}_Lader_Mork"), "#3f2818", "#2c1c11", "#5c3e27", rough=(0.52, 0.7)),
        "sula": mat_lader_std(A, hamta(f"MAT_{P}_Sula"), "#2c1b10", "#1f130b", "#4a3424", rough=(0.72, 0.86), narv=0.6),
        "massing": bpy.data.materials.get(f"MAT_{P}_Metall_Massing"),
    }
    if bpy.data.materials.get(f"MAT_{P}_Lader_Snore"):
        mat_lader_std(A, bpy.data.materials[f"MAT_{P}_Lader_Snore"], "#8e3f2a", "#6a2c1d", "#b06a4c")
    R.append("Läderstandard: Lader_Brun, Lader_Mork, Lader_Snore och Sula (ny) har samma uppbyggnad.")
    return M


# =============================================================== egenskaper på ytan
def skriv_egenskaper(o, som, mask):
    """som/mask: listor per hörn (3 tal). som = avstånd (m) till sömmar, None = ingen söm."""
    me = o.data
    for namn in ("LADER_SOM", "LADER_MASK"):
        a = me.attributes.get(namn)
        if a:
            me.attributes.remove(a)
    a = me.attributes.new("LADER_SOM", "FLOAT_VECTOR", "POINT")
    b = me.attributes.new("LADER_MASK", "FLOAT_VECTOR", "POINT")
    for i in range(len(me.vertices)):
        s = som[i] if som else (None, None, None)
        a.data[i].vector = tuple(LANGT + (x if x is not None else 0.05) for x in s)
        b.data[i].vector = mask[i] if mask else (0.0, 0.0, 0.0)


# =============================================================== arkiv / omkörning
def arkivera_gamla(A):
    kol = bpy.data.collections[f"COL_Char_{P}"]
    ark = bpy.data.collections.get(ARKIV)
    if ark is None:
        ark = bpy.data.collections.new(ARKIV)
        bpy.context.scene.collection.children.link(ark)
        ark.hide_render = True
        lc = A.hitta_lc(ARKIV)
        if lc:
            lc.exclude = True
    flyttade, borttagna = 0, 0
    for namn in ERSATTS:
        o = obj(namn)
        if o is None:
            continue
        if o.get("c09"):
            bpy.data.objects.remove(o, do_unlink=True)
            borttagna += 1
            continue
        o.name = o.name + "_C04"
        for c in list(o.users_collection):
            c.objects.unlink(o)
        ark.objects.link(o)
        flyttade += 1
    for o in list(kol.all_objects):           # nya delar från förra körningen
        if o.get("c09"):
            bpy.data.objects.remove(o, do_unlink=True)
            borttagna += 1
    R.append(f"Gamla läderdelar: {flyttade} flyttade till {ARKIV}, {borttagna} från förra körningen borttagna")
    return kol


def nytt(A, namn, bm, kol, rig, mats, slat=True):
    o = A.nytt_objekt(f"SM_{P}_{namn}", bm, kol, rig, mats, slat=slat)
    o["c09"] = True
    return o


# =============================================================== 2D-hjälp
def konvext_holje(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts

    def kryss(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and kryss(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and kryss(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def radie_i_riktning(holje, c, th):
    dx, dy = math.cos(th), math.sin(th)
    bast = None
    n = len(holje)
    for i in range(n):
        ax, ay = holje[i]
        bx, by = holje[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        den = dx * ey - dy * ex
        if abs(den) < 1e-12:
            continue
        wx, wy = ax - c[0], ay - c[1]
        t = (wx * ey - wy * ex) / den
        u = (wx * dy - wy * dx) / den
        if t > 0 and -1e-6 <= u <= 1 + 1e-6:
            bast = t if bast is None else max(bast, t)
    return bast


def vinkeldiff(a, b):
    return (a - b + math.pi) % (2 * math.pi) - math.pi


# =============================================================== 2. stövlar
NIVAER = [0.012, 0.026, 0.042, 0.060, 0.082, 0.106, 0.135, 0.170, 0.210, 0.250, 0.292]
N_STOVEL = 20


def stovlar(A, K, V, kol, M):
    rig = K.rig
    kbm = K.bm()
    kropp = [v.co.copy() for v in kbm.verts if v.co.z < 0.40]
    kbm.free()
    hosor = obj("Hosor")
    hos = [v.co.copy() for v in hosor.data.vertices if v.co.z < 0.40] if hosor else []
    delar = []
    for s, k in ((1, "l"), (-1, "r")):
        B = rig.data.bones
        fot = B[f"foot.{k}"].head_local.copy()
        vad = B[f"leg_stretch.{k}"].tail_local.copy()
        ta = B[f"toes_01.{k}"].tail_local.copy()
        th_ta = math.atan2(ta.y - fot.y, ta.x - fot.x)
        kp = [p for p in kropp if p.x * s > 0.04]
        hp = [p for p in hos if p.x * s > 0.04]

        def mitt(z):
            if z <= fot.z:
                return (fot.x, fot.y)
            t = (z - fot.z) / (vad.z - fot.z)
            return (fot.x + (vad.x - fot.x) * t, fot.y + (vad.y - fot.y) * t)

        vinklar = []
        for i in range(N_STOVEL):
            u = -1 + 2 * i / N_STOVEL                     # i = 0 → bakåt (u = -1), tätt runt tån
            vinklar.append(th_ta + math.pi * math.copysign(abs(u) ** 1.5, u))
        ringar_r = []
        for z in NIVAER:
            band = 0.014 if z < 0.15 else 0.012
            pts = [(round(p.x, 4), round(p.y, 4)) for p in kp if abs(p.z - z) < band]
            if z > 0.18:
                pts += [(round(p.x, 4), round(p.y, 4)) for p in hp if abs(p.z - z) < band]
            h = konvext_holje(pts)
            c = mitt(z)
            rr = []
            for th in vinklar:
                r = radie_i_riktning(h, c, th) if len(h) >= 3 else None
                rr.append(r if r is not None else (ringar_r[-1][len(rr)] if ringar_r else 0.05))
            marg = 0.009 if z < 0.15 else 0.007
            rr = [r + marg for r in rr]
            rr = [max(rr[i], 0.25 * rr[i - 1] + 0.5 * rr[i] + 0.25 * rr[(i + 1) % N_STOVEL]) for i in range(N_STOVEL)]
            ringar_r.append(rr)
        # skaftet: jämnt uppåt, lätt utsvängt överst; tån lite längre
        for j in range(len(NIVAER)):
            if NIVAER[j] >= 0.17 and 0 < j < len(NIVAER) - 1:
                ringar_r[j] = [max(a, (b + c) / 2) for a, b, c in zip(ringar_r[j], ringar_r[j - 1], ringar_r[j + 1])]
        ringar_r[-1] = [r + 0.003 for r in ringar_r[-1]]
        # tåhätta: rundad sett uppifrån (inte spetsig) och lite högre (rundad framkant sett från sidan)
        for j, z in enumerate(NIVAER):
            if z < 0.07:
                rt = max(ringar_r[j][i] for i, th in enumerate(vinklar) if abs(vinkeldiff(th, th_ta)) < 0.35)
                for i, th in enumerate(vinklar):
                    dt = abs(vinkeldiff(th, th_ta))
                    if dt < math.radians(35):
                        ringar_r[j][i] = max(ringar_r[j][i], rt * (1 - 3.2 * (1 - math.cos(dt))))
                    ringar_r[j][i] += 0.008 * max(0.0, math.cos(dt)) ** 8
        for j, z in enumerate(NIVAER):
            if 0.012 < z < 0.08:
                for i, th in enumerate(vinklar):
                    fram = max(0.0, math.cos(vinkeldiff(th, th_ta))) ** 4
                    ringar_r[j][i] = max(ringar_r[j][i], ringar_r[0][i] - (z - 0.012) * (0.6 + 1.6 * (z - 0.012) / 0.06) * fram - 1.0 * (1 - fram))

        bm = bmesh.new()
        info = []                                         # (vinkel, z, del) per hörn
        ringar = []
        for j, z in enumerate(NIVAER):
            c = mitt(z)
            ring = []
            for i, th in enumerate(vinklar):
                r = ringar_r[j][i]
                ring.append(bm.verts.new((c[0] + r * math.cos(th), c[1] + r * math.sin(th), z)))
                info.append((th, z, "ovan", r))
            ringar.append(ring)
        for a, b in zip(ringar, ringar[1:]):
            for i in range(N_STOVEL):
                bm.faces.new((a[i], a[(i + 1) % N_STOVEL], b[(i + 1) % N_STOVEL], b[i]))
        c0 = mitt(NIVAER[0])
        bot = bm.verts.new((sum(v.co.x for v in ringar[0]) / N_STOVEL, sum(v.co.y for v in ringar[0]) / N_STOVEL, NIVAER[0]))
        info.append((0.0, NIVAER[0], "botten", 0.0))
        for i in range(N_STOVEL):
            bm.faces.new((ringar[0][(i + 1) % N_STOVEL], ringar[0][i], bot))
        # nedvikt krage
        ztopp = NIVAER[-1]
        ct = mitt(ztopp)
        kr = [ringar[-1]]
        for ut, dz, namn in ((0.004, 0.007, "lapp"), (0.010, 0.003, "krage"), (0.017, -0.050, "krage_ned"),
                             (0.011, -0.053, "krage_in")):
            ring = []
            for i, th in enumerate(vinklar):
                r = ringar_r[-1][i] + ut * (1.0 + 0.10 * math.sin(2 * th + 0.6) if namn == "krage_ned" else 1.0)
                ring.append(bm.verts.new((ct[0] + r * math.cos(th), ct[1] + r * math.sin(th), ztopp + dz)))
                info.append((th, ztopp + dz, namn, r))
            kr.append(ring)
        for a, b in zip(kr, kr[1:]):
            for i in range(N_STOVEL):
                bm.faces.new((a[i], a[(i + 1) % N_STOVEL], b[(i + 1) % N_STOVEL], b[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.verts.index_update()
        o = nytt(A, f"Stovel_{'V' if s > 0 else 'H'}", bm, kol, rig, [M["brun"]])
        # sömmar och masker
        som, mask = [], []
        for (th, z, d, r) in info:
            dt = vinkeldiff(th, th_ta)
            if d in ("ovan", "botten"):
                hojd = 0.050 + 0.068 * ((1 + math.cos(dt)) / 2) ** 1.5    # ovandelens söm över vristen
                bak = abs(vinkeldiff(th, th_ta + math.pi)) * max(r, 0.03)  # bakre söm (på en hörnrad)
                som.append((z - hojd, z - 0.019, bak))
                fram = max(0.0, math.cos(dt))
                veck = smooth(0.09, 0.115, z) * (1 - smooth(0.16, 0.19, z)) * (fram ** 1.5 + 0.35 * max(0.0, -math.cos(dt)))
                slit = fram ** 6 * (1 - smooth(0.03, 0.06, z)) + 0.7 * max(0.0, -math.cos(dt)) ** 4 * (1 - smooth(0.02, 0.05, z))
                mask.append((veck, slit, 0.0))
            else:
                som.append((z - (ztopp - 0.044), None, None))             # kantsöm på kragen
                mask.append((0.0, 0.25 if d == "krage_ned" else 0.0, 0.0))
        skriv_egenskaper(o, som, mask)
        V.fran_kropp(o, filter_fn=lambda c: c.z < 0.42)
        A.koppla(o, rig, deform=True)
        delar.append(o)

        # sula: rand runt ovandelens nedre ring
        bm = bmesh.new()
        sr = []
        for r_add, z, namn in ((-0.004, 0.017, "in"), (0.0045, 0.017, "rand"), (0.0055, 0.008, "sida"), (0.003, 0.0012, "kant")):
            ring = []
            for i, th in enumerate(vinklar):
                r = ringar_r[0][i] + r_add
                ring.append(bm.verts.new((c0[0] + r * math.cos(th), c0[1] + r * math.sin(th), z)))
            sr.append((ring, namn))
        for (a, _), (b, _) in zip(sr, sr[1:]):
            for i in range(N_STOVEL):
                bm.faces.new((a[i], a[(i + 1) % N_STOVEL], b[(i + 1) % N_STOVEL], b[i]))
        mitt_b = bm.verts.new((c0[0], c0[1], 0.0))
        sista = sr[-1][0]
        for i in range(N_STOVEL):
            bm.faces.new((sista[i], sista[(i + 1) % N_STOVEL], mitt_b))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        so = nytt(A, f"Stovel_{'V' if s > 0 else 'H'}_Sula", bm, kol, rig, [M["sula"]])
        som, mask = [], []
        tillagg = {"in": -0.004, "rand": 0.0045, "sida": 0.0055, "kant": 0.003}
        for ring, namn in sr:
            for i in range(N_STOVEL):
                d = tillagg[namn] - 0.002                 # randens söm 2 mm utanför ovandelen
                som.append((d if namn in ("in", "rand") else 0.01, None, None))
                mask.append((0.0, 0.6 if namn == "kant" else 0.0, 0.0))
        som.append((None, None, None))
        mask.append((0.0, 0.3, 0.0))
        skriv_egenskaper(so, som, mask)
        V.fran_kropp(so, filter_fn=lambda c: c.z < 0.15)
        A.koppla(so, rig, deform=True)
        delar.append(so)
    # en stövel per sida i samma objekt (färre delar)
    grupper = {"Stovlar": [o for o in delar if not o.name.endswith("_Sula")],
               "Stovlar_Sula": [o for o in delar if o.name.endswith("_Sula")]}
    for namn, ihop in grupper.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in ihop:
            o.select_set(True)
        bpy.context.view_layer.objects.active = ihop[0]
        bpy.ops.object.join()
        ihop[0].name = f"SM_{P}_{namn}"
        ihop[0].data.name = f"SM_{P}_{namn}"
        ihop[0]["c09"] = True
    st, su = obj("Stovlar"), obj("Stovlar_Sula")
    R.append(f"Stövlar: ovandel+skaft+krage {tris(st)} tri, sulor {tris(su)} tri (två stövlar)")
    return [st, su]


# =============================================================== 3. handskar och manschetter
def handskar(A, K, C08, kol, M):
    o = obj("Handskar")
    st = C08.utgangslage(o)
    rig = K.rig
    B = rig.data.bones
    bm = bmesh.new()
    bm.from_mesh(o.data)
    # mjukare form (bevarar kanten vid handleden)
    kant = {v for e in bm.edges if e.is_boundary for v in e.verts}
    inre = [v for v in bm.verts if v not in kant]
    bmesh.ops.smooth_vert(bm, verts=inre, factor=0.35, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    for v in inre:
        v.co += v.normal * 0.0018                      # tjockare läder (huden ska inte synas när handen knyts)
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    som, mask = [], []
    ram = {}
    for s, k in ((1, "l"), (-1, "r")):
        hl = B[f"hand.{k}"].head_local.copy()
        mid = B[f"middle1.{k}"].head_local.copy()
        idx = B[f"index1.{k}"].head_local.copy()
        pin = B[f"pinky1.{k}"].head_local.copy()
        tum = B[f"thumb1.{k}"].tail_local.copy()
        d = (mid - hl).normalized()
        tv = (idx - pin)
        tv = (tv - d * tv.dot(d)).normalized()
        n = d.cross(tv).normalized()
        if (tum - hl).dot(n) > 0:
            n = -n                                         # tummen sitter på handflatans sida
        leder = []
        for led in (1, 2, 3):
            pts = [B[f"{f}{led}.{k}"].head_local for f in ("index", "middle", "ring", "pinky") if B.get(f"{f}{led}.{k}")]
            if pts:
                leder.append(sum(((p - hl).dot(d) for p in pts)) / len(pts))
        ram[s] = (hl, d, tv, n, leder)
    for v in o.data.vertices:
        s = 1 if v.co.x > 0 else -1
        hl, d, tv, n, leder = ram[s]
        q = v.co - hl
        t, u, h = q.dot(d), q.dot(tv), q.dot(n)
        rygg = h > 0
        sl = []
        for ui in (-0.013, 0.0, 0.013):                   # tre sömmar ("points") på handryggen
            dd = u - ui
            if not (rygg and 0.012 < t < leder[0] - 0.02 if leder else False):
                dd = dd + math.copysign(0.05, dd if dd != 0 else 1.0)
            sl.append(dd)
        som.append(tuple(sl))
        veck = sum(math.exp(-((t - tj) / 0.0065) ** 2) for tj in leder) if leder else 0.0
        veck += 0.6 * math.exp(-((t - 0.045) / 0.01) ** 2) * (0.0 if rygg else 1.0)     # handflatans veck
        slit = (math.exp(-((t - leder[0]) / 0.012) ** 2) if leder else 0.0) * (1.0 if rygg else 0.2)
        mask.append((min(1.0, veck), slit, 0.0))
    skriv_egenskaper(o, som, mask)
    R.append(f"Handskar: form {st}, mjukare yta, sömmar på handryggen, veck vid lederna; {tris(o)} tri")

    # manschetter
    bm = bmesh.new()
    sida_info = []
    kbvh = A.bvh_av([K.obj, o, obj("Vaddering")])      # ärmen ska också rymmas i manschetten
    SEG = 16
    for s, k in ((1, "l"), (-1, "r")):
        ax, ab, hl = K.arm(s)
        d = (hl - ab).normalized()
        e1 = d.cross(Vector((0, 0, 1)))
        if e1.length < 1e-4:
            e1 = Vector((1, 0, 0))
        e1.normalize()
        if e1.dot(Vector((s, 0, 0))) < 0:
            e1 = -e1                                         # e1 pekar utåt (bort från kroppen)
        e2 = d.cross(e1).normalized()
        T = [-0.012, 0.004, 0.035, 0.068, 0.098]
        ringar = []
        for j, tt in enumerate(T + [None]):
            mat_r = []
            for i in range(SEG):
                th = 2 * math.pi * i / SEG
                rikt = e1 * math.cos(th) + e2 * math.sin(th)
                t = tt if tt is not None else 0.118 + 0.022 * math.cos(th)   # snedskuren överkant, längst utåt
                p = hl - d * t
                r = None
                hit, _, _, _ = kbvh.ray_cast(p + rikt * 0.07, -rikt, 0.07)   # bara armen (inte bålen)
                if hit is not None and (hit - p).length < 0.065:
                    r = (hit - p).length
                mat_r.append((th, t, p, rikt, r))
            giltiga = sorted(x[4] for x in mat_r if x[4] is not None) or [0.03]
            median = giltiga[len(giltiga) // 2]
            ring = []
            for (th, t, p, rikt, r) in mat_r:
                r = median if r is None else min(r, median * 1.6)
                marg = 0.006 + 0.016 * smooth(-0.012, 0.12, t)
                ring.append(bm.verts.new(p + rikt * (r + marg)))
                sida_info.append((s, th, t))
            ringar.append(ring)
        # mjuk radie runt varje ring
        for ring in ringar:
            mitt = sum((v.co for v in ring), Vector()) / SEG
            ny = []
            for i in range(SEG):
                a, b_, c = ring[i - 1].co, ring[i].co, ring[(i + 1) % SEG].co
                ny.append(b_ * 0.5 + (a + c) * 0.25)
            for v, c in zip(ring, ny):
                v.co = c
        for a, b_ in zip(ringar, ringar[1:]):
            for i in range(SEG):
                bm.faces.new((a[i], a[(i + 1) % SEG], b_[(i + 1) % SEG], b_[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mo = nytt(A, "Manschetter", bm, kol, rig, [M["brun"]])
    som, mask = [], []
    for (s, th, t) in sida_info:
        inne = abs(vinkeldiff(th, math.pi)) * 0.045                        # söm på insidan
        topp = 0.118 + 0.022 * math.cos(th)
        som.append((inne, (topp - 0.007) - t, t - (-0.012 + 0.006)))
        mask.append((0.3 * smooth(0.0, 0.02, t) * (1 - smooth(0.03, 0.06, t)), 0.0, 0.0))
    skriv_egenskaper(mo, som, mask)
    sm = mo.modifiers.new("Tjocklek", "SOLIDIFY")       # jämn tjocklek utan "even offset" (gav spikar i snedskärningen)
    sm.thickness = 0.0035
    sm.offset = -1.0
    sm.use_even_offset = False
    A.tillampa_modifierare(mo)
    # stel mot underarmen
    mo.vertex_groups.clear()
    for s, k in ((1, "l"), (-1, "r")):
        gn = next((g for g in (f"forearm_twist.{k}", f"forearm_stretch.{k}") if g in K.gnamn), None)
        if gn:
            g = mo.vertex_groups.new(name=gn)
            g.add([v.index for v in mo.data.vertices if v.co.x * s > 0], 1.0, "REPLACE")
    A.koppla(mo, rig, deform=True)
    R.append(f"Manschetter: ombyggda, följer underarmen; {tris(mo)} tri")
    return [o, mo]


# =============================================================== 4. bälte, spänne, ände
def ror_slinga(bm, punkter, radie, seg=6):
    """Slutet rör längs en sluten punktslinga."""
    n = len(punkter)
    ringar = []
    for i, p in enumerate(punkter):
        t = (punkter[(i + 1) % n] - punkter[i - 1]).normalized()
        a = t.cross(Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))).normalized()
        b = t.cross(a).normalized()
        ringar.append([bm.verts.new(p + (a * math.cos(2 * math.pi * k / seg) + b * math.sin(2 * math.pi * k / seg)) * radie)
                       for k in range(seg)])
    for i in range(n):
        r0, r1 = ringar[i], ringar[(i + 1) % n]
        for k in range(seg):
            bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))


def remsa(bm, banor, tjock):
    """Läderremsa: banor = [(punkt, upp-vektor, halvbredd), ...] längs remmen; normalen = upp × tangent."""
    lager = []
    n = len(banor)
    for sgn in (1, -1):
        rad = []
        for i, (p, upp, hb) in enumerate(banor):
            t = (banor[min(i + 1, n - 1)][0] - banor[max(i - 1, 0)][0]).normalized()
            ut = t.cross(upp).normalized()
            q = p + ut * (tjock / 2 * sgn)
            rad.append((bm.verts.new(q + upp * hb), bm.verts.new(q - upp * hb)))
        lager.append(rad)
    fr, bk = lager
    for i in range(n - 1):
        bm.faces.new((fr[i][0], fr[i][1], fr[i + 1][1], fr[i + 1][0]))
        bm.faces.new((bk[i][1], bk[i][0], bk[i + 1][0], bk[i + 1][1]))
        bm.faces.new((fr[i][0], fr[i + 1][0], bk[i + 1][0], bk[i][0]))
        bm.faces.new((fr[i + 1][1], fr[i][1], bk[i][1], bk[i + 1][1]))
    for i in (0, n - 1):
        f = (fr[i][0], bk[i][0], bk[i][1], fr[i][1])
        bm.faces.new(f if i == n - 1 else tuple(reversed(f)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def balte_och_vaska(A, K, kol, M, gammal_z):
    rig = K.rig
    cy = A.L["cy"]
    zb = gammal_z
    H, T, SEG = 0.040, 0.005, 40
    stod = A.bvh_av([o for o in (obj("Tabard_Fram"), obj("Tabard_Bak"), obj("Vaddering"), obj("Vaddering_Kjol")) if o])
    C0 = Vector((0, cy, zb))
    rr = []
    for k in range(SEG):
        a = 2 * math.pi * k / SEG
        d = Vector((math.cos(a), math.sin(a), 0))
        rmax = 0.14
        for dz in (-H / 2, 0.0, H / 2):
            start = C0 + Vector((0, 0, dz))
            for _ in range(8):
                hit, _ = A.stral(stod, start + d * 0.0005, d)
                if not hit or (hit - (C0 + Vector((0, 0, dz)))).length > 0.30:
                    break
                rmax = max(rmax, Vector((hit.x - C0.x, hit.y - C0.y, 0)).length)
                start = hit
        rr.append(rmax + 0.0015)
    for _ in range(2):
        rr = [max(rr[i], 0.25 * rr[i - 1] + 0.5 * rr[i] + 0.25 * rr[(i + 1) % SEG]) for i in range(SEG)]

    def zc(a):
        return zb - 0.006 * max(0.0, -math.sin(a)) ** 2       # lätt sänkt framtill

    def rad_vid(a):
        f = (a % (2 * math.pi)) / (2 * math.pi) * SEG
        i = int(f) % SEG
        w = f - int(f)
        return rr[i] * (1 - w) + rr[(i + 1) % SEG] * w

    prof = [(0.0, H / 2), (T - 0.0015, H / 2), (T, H / 2 - 0.0015), (T, -H / 2 + 0.0015), (T - 0.0015, -H / 2), (0.0, -H / 2)]
    bm = bmesh.new()
    ringar, som = [], []
    for k in range(SEG):
        a = 2 * math.pi * k / SEG
        d = Vector((math.cos(a), math.sin(a), 0))
        ring = []
        for (ro, zo) in prof:
            ring.append(bm.verts.new(C0 + d * (rr[k] + ro) + Vector((0, 0, zc(a) - zb + zo))))
            som.append(((H / 2 - 0.004) - zo, zo - (-H / 2 + 0.004), None))
        ringar.append(ring)
    for k in range(SEG):
        a_, b_ = ringar[k], ringar[(k + 1) % SEG]
        for j in range(len(prof) - 1):
            bm.faces.new((a_[j], b_[j], b_[j + 1], a_[j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    balte = nytt(A, "Balte", bm, kol, rig, [M["mork"]])
    skriv_egenskaper(balte, som, None)

    def punkt(a, ut, dz=0.0):
        d = Vector((math.cos(a), math.sin(a), 0))
        return C0 + d * (rad_vid(a) + ut) + Vector((0, 0, zc(a) - zb + dz))

    def ram(a):
        d = Vector((math.cos(a), math.sin(a), 0))
        t = Vector((-math.sin(a), math.cos(a), 0))
        return d, t

    # spänne strax till vänster om mitten (karaktärens vänster = +x)
    rf = rad_vid(-math.pi / 2)
    a_s = -math.pi / 2 + math.asin(0.05 / rf)
    d_s, t_s = ram(a_s)
    mitt_s = punkt(a_s, T + 0.004)
    bm = bmesh.new()
    wt, hz, rk = 0.017, 0.026, 0.008
    slinga = []
    for (cx, cz, a0) in ((wt - rk, hz - rk, 0), (-wt + rk, hz - rk, 90), (-wt + rk, -hz + rk, 180), (wt - rk, -hz + rk, 270)):
        for j in range(4):
            v = math.radians(a0 + 90 * j / 4)
            x, z = cx + rk * math.cos(v), cz + rk * math.sin(v)
            bage = -0.004 * (x / wt) ** 2                       # ramen följer bältets böj
            slinga.append(mitt_s + t_s * x + Vector((0, 0, z)) + d_s * bage)
    ror_slinga(bm, slinga, 0.0026, 6)
    A.ror(bm, [mitt_s - t_s * wt + d_s * 0.0015, mitt_s + d_s * 0.0035, mitt_s + t_s * (wt + 0.002) + d_s * 0.002],
          [0.0016, 0.0016, 0.0013], 5)
    spanne = nytt(A, "Baltesspanne", bm, kol, rig, [M["massing"]])

    # bältesände: ut genom spännet, genom en hälla, rundad spets
    bm = bmesh.new()
    langd = 0.115
    steg = 12
    banor = []
    for i in range(steg + 1):
        a = a_s + (wt + 0.002 + langd * i / steg) / rf
        hb = (H / 2 - 0.0015)
        rest = (steg - i) / 3
        if rest < 1:
            hb *= max(0.25, math.sqrt(max(0.0, 1 - (1 - rest) ** 2)))
        banor.append((punkt(a, T + 0.0028), Vector((0, 0, 1)), hb))
    remsa(bm, banor, 0.004)
    a_h = a_s + (wt + 0.035) / rf
    d_h, t_h = ram(a_h)
    hh = []
    for (ro, zo) in ((-0.0015, H / 2 + 0.0025), (T + 0.0075, H / 2 + 0.0025), (T + 0.0075, -H / 2 - 0.0025), (-0.0015, -H / 2 - 0.0025)):
        hh.append((ro, zo))
    hal = []
    for sgn in (-1, 1):
        hal.append([bm.verts.new(punkt(a_h, ro) + Vector((0, 0, zo)) + t_h * 0.006 * sgn) for (ro, zo) in hh])
    for j in range(4):
        bm.faces.new((hal[0][j], hal[0][(j + 1) % 4], hal[1][(j + 1) % 4], hal[1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ande = nytt(A, "Balte_Ande", bm, kol, rig, [M["mork"]])
    skriv_egenskaper(ande, None, [(0.0, 0.2, 0.0)] * len(ande.data.vertices))

    # väska på höger höft (karaktärens höger = -x), lite åt sidan så att låret går fritt
    a_p = -math.pi / 2 - 0.78
    d_p, t_p = ram(a_p)
    w, h, dj = 0.13, 0.11, 0.045
    ztop = zb - 0.004
    bakre = punkt(a_p, T + 0.003)
    bas = Vector((bakre.x, bakre.y, ztop))
    lut = 0.09

    def lok(tt, nn, zz):                                   # väskans rum: t längs bältet, n utåt, z upp
        return bas + t_p * tt + d_p * (nn + max(0.0, -zz) * lut) + Vector((0, 0, zz))

    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        x, y, z = v.co
        v.co = lok(x * w, (y + 0.5) * dj, (z - 0.5) * h)
    vaska = nytt(A, "Vaska", bm, kol, rig, [M["brun"]])
    A.avfasa(vaska, 0.011, 2, 30)
    som, mask = [], []
    for v in vaska.data.vertices:
        q = v.co - bas
        z = q.z
        nn = q.dot(d_p) - max(0.0, -z) * lut
        som.append((nn - (dj - 0.005), nn - 0.005, None))
        mask.append((0.0, 0.5 * (1 - smooth(-h + 0.004, -h + 0.02, z)), 0.0))
    skriv_egenskaper(vaska, som, mask)

    # lock: över ovansidan och ned framtill, rundad nederkant
    bm = bmesh.new()
    W2 = w / 2 + 0.004
    bana = [(0.000, 0.003), (dj * 0.45, 0.0065), (dj + 0.003, 0.003), (dj + 0.0055, -0.007),
            (dj + 0.0058, -0.030), (dj + 0.0058, -0.064)]
    nt = 9
    rader = []
    for j, (nn, zz) in enumerate(bana):
        rad = []
        for i in range(nt):
            tt = -W2 + 2 * W2 * i / (nt - 1)
            z = zz
            if j == len(bana) - 1:
                z = zz + 0.024 * (abs(tt) / W2) ** 3
            rad.append(bm.verts.new(lok(tt, nn, z)))
        rader.append(rad)
    for a_, b_ in zip(rader, rader[1:]):
        for i in range(nt - 1):
            bm.faces.new((a_[i], a_[i + 1], b_[i + 1], b_[i]))
    lock = nytt(A, "Vaska_Lock", bm, kol, rig, [M["brun"]])
    som, mask = [], []
    langs = [0.0]
    for j in range(1, len(bana)):
        langs.append(langs[-1] + math.hypot(bana[j][0] - bana[j - 1][0], bana[j][1] - bana[j - 1][1]))
    for j in range(len(bana)):
        for i in range(nt):
            tt = -W2 + 2 * W2 * i / (nt - 1)
            fran_botten = langs[-1] - langs[j]
            som.append((fran_botten - 0.005 if j >= 3 else 0.02, (W2 - abs(tt)) - 0.005, None))
            mask.append((0.0, 0.3 if j == len(bana) - 1 else 0.0, 0.0))
    skriv_egenskaper(lock, som, mask)
    A.solidify(lock, 0.0035, offset=1.0)
    lock_botten = -0.064

    # flik från lockets nederkant och mässingsknopp på väskan
    bm = bmesh.new()
    fl = []
    for i in range(8):
        zz = lock_botten + 0.012 - 0.036 * i / 7
        hb = 0.0085 if i < 6 else 0.0085 * (0.75 if i == 6 else 0.4)
        nn = dj + 0.0030 + 0.0075 * smooth(lock_botten - 0.004, lock_botten + 0.004, zz)   # på locket → ned mot väskan
        fl.append((lok(0.0, nn, zz), t_p.copy(), hb))
    remsa(bm, fl, 0.003)
    rem = nytt(A, "Vaska_Rem", bm, kol, rig, [M["mork"]])
    skriv_egenskaper(rem, None, [(0.0, 0.3, 0.0)] * len(rem.data.vertices))
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.0062)
    for v in bm.verts:
        x, y, z = v.co
        v.co = lok(x, dj + 0.0048 + y * 0.45, lock_botten - 0.015 + z)
    knapp = nytt(A, "Vaska_Knapp", bm, kol, rig, [M["massing"]])

    # två remmar på väskans baksida som går runt bältet
    bm = bmesh.new()
    zt_b = (zc(a_p) - zb + H / 2) - (ztop - zb)
    zb_b = (zc(a_p) - zb - H / 2) - (ztop - zb)
    for tt in (-0.035, 0.035):
        bana_r = [(-0.0018, -0.035), (-0.0018, zt_b - 0.004), (-0.003, zt_b + 0.0035), (-(T + 0.0035), zt_b + 0.004),
                  (-(T + 0.0055), zt_b - 0.002), (-(T + 0.0055), zb_b - 0.002)]
        banor = [(lok(tt, nn, zz), t_p.copy(), 0.008) for (nn, zz) in bana_r]
        remsa(bm, banor, 0.0028)
    hallare = nytt(A, "Vaska_Hallare", bm, kol, rig, [M["mork"]])
    skriv_egenskaper(hallare, None, [(0.0, 0.2, 0.0)] * len(hallare.data.vertices))
    vaska_delar = [vaska, lock, rem, knapp, hallare]
    R.append(f"Bälte {tris(balte)} tri, spänne {tris(spanne)}, ände+hälla {tris(ande)}, "
             f"väska {sum(tris(x) for x in vaska_delar)} tri")
    return [balte, spanne, ande] + vaska_delar


# =============================================================== 5. kontroll: skär något genom kroppen?
def genomskarning(A, K, delar, under):
    """Andel hörn i delarna som ligger innanför kroppen eller lagret under (stråle mot riggens mittaxel)."""
    bvh = A.bvh_av(under)
    ut = {}
    for o in delar:
        inne = 0
        for v in o.data.vertices:
            c = Vector((0, A.L["cy"], v.co.z))
            r = Vector((v.co.x - c.x, v.co.y - c.y, 0))
            if r.length < 1e-4:
                continue
            hit, _ = A.stral(bvh, v.co + r.normalized() * 0.15, -r.normalized())
            if hit is not None and (Vector((hit.x, hit.y, 0)) - Vector((c.x, c.y, 0))).length > r.length + 0.001:
                inne += 1
        ut[o.name.replace(f"SM_{P}_", "")] = inne
    return ut


# =============================================================== huvudprogram
def kor():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    B1 = ladda(C05_FIL, "stadsvakt_B1")
    A = B1.ladda_A()
    C08 = ladda(C08_FIL, "stadsvakt_C08")
    rig, kropp = A.hitta_bas()
    if not globals().get("SKIPPA_KOPIA"):
        mapp = os.path.join(os.path.dirname(bpy.data.filepath), "versioner")
        os.makedirs(mapp, exist_ok=True)
        ut = os.path.join(mapp, time.strftime("stadsvakt_fore_C09_%Y%m%d_%H%M%S.blend"))
        bpy.ops.wm.save_as_mainfile(filepath=ut, copy=True)
        R.append(f"Säkerhetskopia: {ut}")
    A.landmarken(rig, kropp)
    K = A.Kropp(kropp, rig, None)
    V = B1.Vikter(K)
    fore = {n: tris(obj(n)) for n in ERSATTS + ["Handskar"]}
    gb = bpy.data.objects.get(f"SM_{P}_Balte_C04") or obj("Balte")
    gammal_z = (min(v.co.z for v in gb.data.vertices) + max(v.co.z for v in gb.data.vertices)) / 2
    kol = arkivera_gamla(A)
    M = material(A)

    nya = stovlar(A, K, V, kol, M)
    nya += handskar(A, K, C08, kol, M)
    nya += balte_och_vaska(A, K, kol, M, gammal_z)

    # tabarden läggs om innanför det nya bältet och väskan (samma steg som i C08)
    balte = obj("Balte")
    zb0 = min(v.co.z for v in balte.data.vertices)
    zb1 = max(v.co.z for v in balte.data.vertices)
    under = A.bvh_av([obj("Vaddering_Kjol"), obj("Hosor"), obj("Vaddering")])
    utanpa = A.bvh_av([o for o in kol.all_objects if o.type == "MESH" and ("Balte" in o.name or "Vaska" in o.name)])
    for namn, sida in (("Tabard_Fram", -1), ("Tabard_Bak", 1)):
        o = obj(namn)
        C08.utgangslage(o)
        _, ut_n, in_n = C08.tabard(A, o, sida, zb0, zb1, A.FALL_Z, under, utanpa, A.L["cy"])
        R.append(f"{namn}: omlagd ({in_n} punkter in bakom bälte/väska)")

    # kontroll
    g = genomskarning(A, K, [obj(n) for n in ("Vaska", "Vaska_Lock", "Balte", "Stovlar", "Manschetter")], [obj("Tabard_Fram"), obj("Tabard_Bak"), obj("Vaddering"), obj("Vaddering_Kjol"), kropp])
    R.append("Hörn innanför tabard/kropp (0 = inget skär igenom): " + ", ".join(f"{k} {v}" for k, v in g.items()))
    efter = {n: tris(obj(n)) for n in ERSATTS + ["Handskar", "Stovlar_Sula", "Vaska_Hallare"]}
    R.append("Trianglar före → efter: " + ", ".join(f"{n} {fore.get(n, 0)}→{efter.get(n, 0)}" for n in efter))
    R.append(f"Läder totalt: {sum(fore.values())} → {sum(efter.values())} tri")
    txt = "\n".join(["STADSVAKT C09 – läder"] + R)
    print(txt)
    return txt


if __name__ == "__main__":
    resultat_text = kor()
