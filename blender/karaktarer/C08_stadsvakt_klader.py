"""
C08_stadsvakt_klader.py  –  Brawl med Boysen, Stadsvakten: TYG, VADDERING, RINGBRYNJA, TABARD
==============================================================================================
Klistra in i Scripting-fliken (stadsvakt.blend) och kör. Kräver C04 och C05 i samma mapp.
Kan köras om (originalformerna sparas första gången och används som utgångsläge).
Kör C10_spelmodell_export.py efteråt för spelet.

Vad skriptet gör
  1. Klassar plaggen (tyg / vadderat skydd / läder / ringbrynja / metall) och skriver en lista.
  2. Material (samma materialnamn, ny nodträd – PBR: färg, roughness, metallic, normal):
     - Tyg (vitt, blått, guld): ingen grov rutstruktur längre; fina trådar i varp/väft,
       mjuk färgvariation, lite smuts nedtill och slitna kanter. Guldkanten är ett
       kypertvävt band (diagonala ränder), inte metall.
     - Vaddering (gambesong, ärmar, kjol): diamantrutorna ersätts av längsgående
       sömkanaler (som på riktiga vadderade rockar) med ojämn bredd, rundade kuddar,
       stygn i sömmarna och fin linnestruktur.
     - Ringbrynja: riktiga ringar i rader (två förskjutna rutnät, ca 11 mm ringar)
       på en egen ytkarta (BRYNJA) runt halsen; blank stål på ringarna, mörka hål.
  3. Ringbrynjan: lite hopsjunken krage och manteln trycks in bakom tabarden
     (inga mörka hörn som sticker ut genom tyget i ryggen).
  4. Tabarden (fram och bak): det kantiga sicksack-vecket tas bort, tyget får tätare
     rutnät nedanför bältet, mjuka veck som fläktar ut från bältet, lätt A-form över
     höfterna, tyget pöser lite över bältet, fållen böljar mjukt och den gula fållkanten
     blir tjockare (vikt fåll). Tyget hålls utanför kjolen/hosorna och innanför bältet
     och väskan.

Vikter: oförändrade. Tabarden får sina vikter i exporten (C10, "kjol": bäcken + lår).
"""

import bpy
import bmesh
import math
import os
import time
import importlib.util
from mathutils import Vector
from mathutils.kdtree import KDTree

C05_FIL = "C05_stadsvakt_B1_hjalm_axlar_armar.py"
P = "Stadsvakt"
R = []
KILAR = 12                     # ringbrynjans kilar runt halsen


def ladda(fil, namn):
    mapp = os.path.dirname(bpy.data.filepath)
    spec = importlib.util.spec_from_file_location(namn, os.path.join(mapp, fil))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def mat(namn):
    m = bpy.data.materials.get(namn)
    if m is None:
        raise RuntimeError(f"Materialet {namn} saknas – kör C04/C05 först.")
    return m


def obj(namn):
    o = bpy.data.objects.get(f"SM_{P}_{namn}")
    if o is None:
        raise RuntimeError(f"Objektet SM_{P}_{namn} saknas – kör C04–C07 först.")
    return o


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# =============================================================== 1. klassning
KATEGORIER = (("Ringbrynja", "ringbrynja"), ("Vaddering", "vadderat skydd"), ("Tyg", "tyg"),
              ("Lader", "läder"), ("Metall", "metall"), ("Har", "hår"), ("Hud", "hud"))


def klassificera():
    kol = bpy.data.collections.get(f"COL_Char_{P}")
    rader = {}
    for o in sorted(kol.all_objects, key=lambda o: o.name):
        if o.type != "MESH":
            continue
        typer = []
        for m in o.data.materials:
            if not m:
                continue
            for nyckel, typ in KATEGORIER:
                if nyckel in m.name and typ not in typer:
                    typer.append(typ)
        rader.setdefault(" + ".join(typer) or "övrigt", []).append(o.name.replace(f"SM_{P}_", ""))
    R.append("Plagg och material:")
    for typ, namn in sorted(rader.items()):
        R.append(f"  {typ}: {', '.join(namn)}")


# =============================================================== originalform (för omkörning)
def utgangslage(o):
    """Första gången: spara formen. Senare: börja om från den sparade formen."""
    nyckel = "c08_original"
    namn = o.get(nyckel)
    spar = bpy.data.meshes.get(namn) if namn else None
    if spar is None:
        spar = o.data.copy()
        spar.name = f"ME_C08_original_{o.name}"
        spar.use_fake_user = True
        o[nyckel] = spar.name
        return "sparad"
    gammal = o.data
    ny = spar.copy()
    o.data = ny
    gnamn = gammal.name
    if gammal.users == 0:
        bpy.data.meshes.remove(gammal)
    ny.name = gnamn
    return "återställd"


# =============================================================== 2. material
def mat_tyg(A, m, bas, mork, ljus, rough=0.9, sheen=0.4, kypert=False):
    b = A.Nod(m)
    var = b.brus(3.0, 3.0)
    flack = b.brus(45.0, 2.0)
    f = b.blanda(b.ramp(var, 0.0, 0.45, 0.3, 0.75), b.farg(bas), b.farg(mork))
    f = b.blanda(b.ramp(flack, 0.0, 0.12, 0.4, 0.7), f, b.farg(mork))
    # smuts nedtill (fållen, underbenen) – svag och fläckig
    z = b.separera(b.obj)[2]
    smuts = b.math("MULTIPLY", b.ramp(z, 0.22, 0.0, 0.74, 0.98), b.ramp(b.brus(7.0, 4.0), 0.3, 1.0, 0.35, 0.7))
    f = b.blanda(smuts, f, b.farg("#5e5243"))
    # nötta kanter (Pointiness – syns i bakningen)
    f = b.blanda(b.math("MULTIPLY", b.kanter(), 0.3), f, b.farg(ljus))
    b.satt(["Base Color"], f)
    b.satt(["Metallic"], 0.0)
    b.satt(["Roughness"], b.ramp(var, rough - 0.03, rough + 0.04))
    b.satt(["Sheen Weight", "Sheen"], sheen)
    b.satt(["Sheen Roughness"], 0.6)
    b.satt(["Specular IOR Level", "Specular"], 0.3)
    # trådar: fina sträckta brus i varp (lodrätt) och väft (vågrätt) – inget upprepat rutnät
    n = b.bump(b.brus(320.0, 2.0, stracka=(1.0, 1.0, 0.08)), 0.06, 0.0004)
    n = b.bump(b.brus(320.0, 2.0, stracka=(0.08, 0.08, 1.0)), 0.06, 0.0004, n)
    if kypert:                                           # kypertband: diagonala ränder
        s = b.separera(b.obj)
        diag = b.math("SINE", b.math("MULTIPLY", b.math("ADD", s[0], b.math("ADD", s[1], s[2])), 2 * math.pi / 0.007))
        n = b.bump(diag, 0.18, 0.0005, n)
    n = b.bump(b.brus(14.0, 3.0), 0.05, 0.002, n)       # mjuka bucklor i tyget
    b.satt(["Normal"], n)
    return m


def mat_vaddering(A, m):
    """Gambesong: längsgående sömkanaler (QUILT x = tvärs, y = längs), ojämna och rundade."""
    b = A.Nod(m)
    q = b.attribut("QUILT")
    s = b.separera(q)
    tvars, langs = s[0], s[1]
    ruta = 0.034
    # ojämn bredd: tvärkoordinaten vrids lite med ett lågfrekvent brus
    vrid = b.math("MULTIPLY", b.math("SUBTRACT", b.brus(9.0, 2.0, koord=q), 0.5), 0.010)
    u = b.math("ADD", tvars, vrid)
    tri = b.math("PINGPONG", u, ruta / 2)                       # 0 i sömmen, ruta/2 mitt i kanalen
    kudde = b.math("SQRT", b.ramp(tri, 0.0, 1.0, 0.0, ruta * 0.42))
    # kuddarna är olika fyllda och lite hoptryckta längs sömmarna
    fyll = b.ramp(b.brus(18.0, 2.0, koord=q), 0.75, 1.0, 0.3, 0.7)
    h = b.math("MULTIPLY", kudde, fyll)
    # stygn: korta streck längs sömmen
    nara = b.ramp(tri, 1.0, 0.0, 0.0, 0.0016)
    streck = b.ramp(b.math("SINE", b.math("MULTIPLY", langs, 2 * math.pi / 0.006)), 0.0, 1.0, 0.1, 0.6)
    st = b.math("MULTIPLY", nara, streck)
    var = b.brus(5.0, 3.0)
    bas = b.blanda(b.ramp(var, 0.0, 1.0, 0.3, 0.75), b.farg("#4d3626"), b.farg("#3b291c"))
    bas = b.blanda(b.ramp(h, 0.0, 0.25, 0.6, 1.0), bas, b.farg("#5b412e"))     # kuddtoppar ljusare
    f = b.blanda(b.ramp(h, 0.55, 0.0, 0.0, 0.55), bas, b.farg("#24180f"))      # sömmar mörka, aldrig svarta
    f = b.blanda(b.math("MULTIPLY", st, 0.4), f, b.farg("#6b5a45"))            # stygn
    b.satt(["Base Color"], f)
    b.satt(["Metallic"], 0.0)
    b.satt(["Roughness"], b.ramp(h, 0.96, 0.88))
    b.satt(["Sheen Weight", "Sheen"], 0.3)
    b.satt(["Sheen Roughness"], 0.6)
    b.satt(["Specular IOR Level", "Specular"], 0.25)
    n = b.bump(h, 0.6, 0.004)
    n = b.bump(st, 0.2, 0.0006, n)
    n = b.bump(b.brus(260.0, 2.0, stracka=(1.0, 1.0, 0.1)), 0.05, 0.0004, n)     # linnetrådar
    b.satt(["Normal"], n)
    return m


def mat_brynja(A, m):
    """Ringbrynja: rader av ringar på ytkartan BRYNJA (meter), två förskjutna rutnät."""
    b = A.Nod(m)
    s = b.separera(b.attribut("BRYNJA"))
    u, v = s[0], s[1]
    a, rad, R0, w = 0.011, 0.0085, 0.0058, 0.0015       # ringavstånd, radavstånd, ringradie, tråd

    def ring(du, dv):
        cu = b.math("MULTIPLY", b.math("SUBTRACT", b.math("FRACT", b.math("DIVIDE", b.math("ADD", u, du), a)), 0.5), a)
        cv = b.math("MULTIPLY", b.math("SUBTRACT", b.math("FRACT", b.math("DIVIDE", b.math("ADD", v, dv), rad)), 0.5), rad)
        d = b.math("SQRT", b.math("ADD", b.math("MULTIPLY", cu, cu), b.math("MULTIPLY", cv, cv)))
        t = b.math("ABSOLUTE", b.math("SUBTRACT", d, R0))
        return b.math("SQRT", b.ramp(t, 1.0, 0.0, 0.0, w))  # rundad tråd

    h = b.math("MAXIMUM", ring(0.0, 0.0), ring(a / 2, rad / 2))
    var = b.brus(6.0, 3.0)
    metall = b.blanda(b.ramp(var, 0.0, 1.0, 0.3, 0.75), b.farg("#8e9196"), b.farg("#6a6d72"))
    metall = b.blanda(b.ramp(b.brus(3.5, 4.0), 0.0, 0.45, 0.55, 0.8), metall, b.farg("#4a4744"))  # anlöpt/smutsigt
    f = b.blanda(h, b.farg("#141416"), metall)
    b.satt(["Base Color"], f)
    b.satt(["Metallic"], b.ramp(h, 0.2, 0.95))
    b.satt(["Roughness"], b.math("ADD", b.ramp(h, 0.85, 0.36), b.ramp(var, 0.0, 0.12)))
    b.satt(["Specular IOR Level", "Specular"], 0.5)
    n = b.bump(h, 0.9, 0.0018)
    n = b.bump(b.brus(120.0, 2.0), 0.05, 0.0004, n)
    b.satt(["Normal"], n)
    return m


# =============================================================== 3. ytkartor
def quilt_till_horn(o):
    """QUILT punkt → hörn, så att sömmen bak på ärmen/kjolen inte smetas ut över en ytrad."""
    me = o.data
    a = me.attributes.get("QUILT")
    if a is None:
        return f"{o.name}: QUILT saknas"
    if a.domain == "CORNER":
        return f"{o.name}: QUILT redan per hörn"
    vals = [tuple(d.vector) for d in a.data]
    me.attributes.remove(a)
    ny = me.attributes.new("QUILT", "FLOAT_VECTOR", "CORNER")
    lagade = 0
    for p in me.polygons:
        us = [vals[me.loops[li].vertex_index] for li in p.loop_indices]
        x = [c[0] for c in us]
        if max(x) - min(x) > 0.12 and min(x) < 0 < max(x) and min(abs(c) for c in x) > 0.6 * max(abs(c) for c in x):
            varv = 2 * max(abs(c) for c in x)          # hela omkretsen
            us = [((c[0] + varv) if c[0] < 0 else c[0], c[1], c[2]) for c in us]
            lagade += 1
        for li, c in zip(p.loop_indices, us):
            ny.data[li].vector = c
    return f"{o.name}: QUILT per hörn ({lagade} ytor över skarven lagade)"


def brynja_karta(o, yc, rho_topp, ztopp):
    me = o.data
    a = me.attributes.get("BRYNJA")
    if a:
        me.attributes.remove(a)
    a = me.attributes.new("BRYNJA", "FLOAT_VECTOR", "CORNER")
    # Brynjan är sydd i kilar (som riktiga brynjor där ringar läggs till när den vidgas):
    # inom varje kil räknas ringarna från kilens mittlinje, så att raderna inte sneddras.
    KIL = 2 * math.pi / KILAR
    for p in me.polygons:
        c0 = p.center
        k = round(math.atan2(c0.x, -(c0.y - yc)) / KIL)
        for li in p.loop_indices:
            c = me.vertices[me.loops[li].vertex_index].co
            w = math.atan2(c.x, -(c.y - yc)) - k * KIL
            w = (w + math.pi) % (2 * math.pi) - math.pi
            rho = math.hypot(c.x, c.y - yc)
            a.data[li].vector = (w * rho + 0.37 * k, (c.z - ztopp) - 0.8 * (rho - rho_topp), 0.0)


# =============================================================== 4. tabarden
def tabard(A, o, sida, zb0, zb1, fall_z, under, utanpa, cy):
    """sida: -1 fram, +1 bak (utåt = sida * y)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    f0 = len(bm.faces)

    def granne_i_rad(v):
        return [g for g in (e.other_vert(v) for e in v.link_edges)
                if abs(g.co.x - v.co.x) > 0.008 and abs(g.co.z - v.co.z) < 0.5 * abs(g.co.x - v.co.x)]

    # a) bort med det gamla korta sicksack-vecket nedanför bältet (period ≈ 2 kolumner)
    ny = {}
    for v in bm.verts:
        if v.co.z < zb0 + 0.01:
            g = granne_i_rad(v)
            if len(g) == 2:
                ny[v] = (2 * v.co.y + g[0].co.y + g[1].co.y) / 4
    for v, y in ny.items():
        v.co.y = y

    # b) tätare kolumner nedanför bältet (vecken behöver fler punkter)
    kant = [e for e in bm.edges if e.verts[0].co.z < zb1 and e.verts[1].co.z < zb1
            and abs(e.verts[0].co.x - e.verts[1].co.x) > 0.008
            and abs(e.verts[0].co.z - e.verts[1].co.z) < 0.5 * abs(e.verts[0].co.x - e.verts[1].co.x)]
    bmesh.ops.subdivide_edges(bm, edges=kant, cuts=1, use_grid_fill=True)

    # halva bredden per höjd (för att dämpa vecken vid läderkanten)
    hw = {}
    for v in bm.verts:
        k = round(v.co.z / 0.01)
        hw[k] = max(hw.get(k, 0.0), abs(v.co.x))

    def halvbredd(z):
        k = round(z / 0.01)
        return max(hw.get(k, 0.0), hw.get(k - 1, 0.0), hw.get(k + 1, 0.0), 0.05)

    fas = (0.0, 1.9) if sida < 0 else (2.4, 0.7)
    fall_rad = fall_z + 0.012

    def veck(x, t):
        xs = x / (1.0 + 0.35 * t)                                # vecken fläktar ut nedåt
        return 0.62 * math.sin(2 * math.pi * xs / 0.105 + fas[0]) + 0.38 * math.sin(2 * math.pi * xs / 0.064 + fas[1])

    for v in bm.verts:
        x, y, z = v.co
        t = max(0.0, min(1.0, (zb0 - z) / (zb0 - fall_z)))
        if t > 0:
            e = 1.0 - 0.45 * smooth(0.72, 1.0, abs(x) / halvbredd(z))
            amp = 0.013 * t ** 0.7 * e
            y += sida * (amp * veck(x, t) + 0.006 * t)          # veck + lätt båge ut över låren
            x *= 1.0 + 0.06 * t                                  # A-form över höfterna
        if zb1 < z < zb1 + 0.07:                                  # tyget pöser lite över bältet
            y += sida * 0.004 * math.sin(math.pi * (z - zb1) / 0.07)
        if z < fall_rad:                                          # fållen: mjuk bölja, tyngst mitt fram
            xr = abs(x) / halvbredd(z)
            z = fall_z + 0.005 * math.sin(2 * math.pi * x / 0.23 + 1.3 * sida) - 0.004 * (1 - xr * xr) \
                + 0.002 * veck(x, 1.0)
        v.co = Vector((x, y, z))

    # c) vikt fåll: de två nedersta raderna tjockare (längs normalen, båda skalen)
    bm.normal_update()
    flytt = []
    for v in bm.verts:
        if v.co.z < fall_rad:
            flytt.append((v, v.normal * 0.0013))
        elif v.co.z < fall_z + 0.03:
            flytt.append((v, v.normal * 0.0008))
    for v, d in flytt:
        v.co += d

    # d) frigång: utanför kjol/hosor (≥ 7 mm), innanför bälte/väska (≥ 3 mm)
    kd = KDTree(len(bm.verts))
    for i, v in enumerate(bm.verts):
        kd.insert(v.co, i)
    kd.balance()
    bm.verts.ensure_lookup_table()

    def sprid(skift):
        ut = {}
        for i, s in skift.items():
            for (_, j, _) in kd.find_range(bm.verts[i].co, 0.009):
                if abs(s) > abs(ut.get(j, 0.0)):
                    ut[j] = s
        return ut

    ut_skift, in_skift = {}, {}
    for v in bm.verts:
        if v.co.z > zb1 + 0.08:
            continue
        behov = 0.0
        for dx in (0.0, 0.01, -0.01):
            h, _ = A.stral(under, (v.co.x + dx, cy + sida * 0.6, v.co.z), (0, -sida, 0))
            if h is not None:
                behov = max(behov, 0.007 - (v.co.y - h.y) * sida)
        if behov > 0:
            ut_skift[v.index] = behov
        h, _ = A.stral(utanpa, (v.co.x, cy, v.co.z), (0, sida, 0))
        if h is not None and (h - Vector((v.co.x, cy, v.co.z))).length < 0.35:
            over = (v.co.y - h.y) * sida + 0.003
            if over > 0:
                in_skift[v.index] = over
    for i, s in sprid(ut_skift).items():
        bm.verts[i].co.y += sida * s
    for i, s in sprid(in_skift).items():
        bm.verts[i].co.y -= sida * s

    # e) insidan mot kroppen syns aldrig (den täcks av tyget självt) – bara en rad innanför
    #    kanterna behålls, så att tygkanten fortfarande ser tjock ut från sidan och underifrån
    bm.normal_update()
    kant_ytor = {f for f in bm.faces if abs(f.normal.y) < 0.3}
    bort = [f for f in bm.faces if f.normal.y * sida < -0.3
            and not any(g in kant_ytor for e in f.edges for g in e.link_faces)]
    bmesh.ops.delete(bm, geom=bort, context="FACES")

    bm.to_mesh(o.data)
    bm.free()
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.update()
    return len(o.data.polygons) - f0, len(ut_skift), len(in_skift)


# =============================================================== 5. ringbrynjan
def ringbrynja(A, o, tabarder):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    top = max(v.co.z for v in bm.verts)
    ring = [v.co for v in bm.verts if v.co.z > top - 0.02]
    yc = (max(c.y for c in ring) + min(c.y for c in ring)) / 2
    rho_topp = min(math.hypot(c.x, c.y - yc) for c in ring)
    # kragen sjunker ihop lite (mjuka valkar runt halsen)
    for v in bm.verts:
        rho = math.hypot(v.co.x, v.co.y - yc)
        if rho < 0.11:
            k = (0.11 - rho) / 0.11
            rikt = Vector((v.co.x, v.co.y - yc, 0.0)).normalized()
            v.co += rikt * (0.0012 * k * math.sin(2 * math.pi * v.co.z / 0.028))
    # manteln ligger UTANPÅ vadderingen (≥ 3 mm) – annars sticker brunt tyg upp genom ringarna
    vadd = A.bvh_av([obj("Vaddering")])
    mitt = Vector((0.0, yc, top - 0.12))
    bm.normal_update()
    nrm = {}
    behov = {}
    for v in bm.verts:
        n = v.normal.copy()
        if n.dot(v.co - mitt) < 0:
            n = -n
        nrm[v.index] = n
        hit, _, _, _ = vadd.ray_cast(v.co + n * 0.06, -n, 0.12)
        if hit is None:
            continue
        s = 0.003 - (v.co - hit).dot(n)
        if 0 < s <= 0.015:                      # djupare = under axelskydden/tabarden, syns inte
            behov[v.index] = s
    kd = KDTree(len(bm.verts))
    for v in bm.verts:
        kd.insert(v.co, v.index)
    kd.balance()
    bm.verts.ensure_lookup_table()
    spridd = {}
    for i, s in behov.items():
        rad = 0.02
        for (_, j, d) in kd.find_range(bm.verts[i].co, rad):
            s2 = s * (1.0 - smooth(0.4 * rad, rad, d))   # mjuk övergång till grannarna
            if s2 > spridd.get(j, 0.0):
                spridd[j] = s2
    for j, s in spridd.items():
        bm.verts[j].co += nrm[j] * s
    R.append(f"Ringbrynja: {len(behov)} punkter låg i vadderingen, {len(spridd)} flyttade ut "
             f"(max {max(behov.values(), default=0) * 1000:.0f} mm)")
    # manteln in bakom tabarden (fram och bak)
    bvh = A.bvh_av(tabarder)
    tabard_topp = max(v.co.z for t in tabarder for v in t.data.vertices)
    flyttade = 0
    for v in bm.verts:
        if v.co.z > tabard_topp + 0.005:
            continue
        sida = 1 if v.co.y > yc else -1
        h, _ = A.stral(bvh, (v.co.x, yc, v.co.z), (0, sida, 0))
        if h is not None and (v.co.y - h.y) * sida > -0.004:
            v.co.y = h.y - sida * 0.004
            flyttade += 1
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    brynja_karta(o, yc, rho_topp, top)
    return flyttade


# =============================================================== huvudprogram
def kor():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    B1 = ladda(C05_FIL, "stadsvakt_B1")
    A = B1.ladda_A()
    rig, kropp = A.hitta_bas()
    if not globals().get("SKIPPA_KOPIA"):
        mapp = os.path.join(os.path.dirname(bpy.data.filepath), "versioner")
        os.makedirs(mapp, exist_ok=True)
        ut = os.path.join(mapp, time.strftime("stadsvakt_fore_C08_%Y%m%d_%H%M%S.blend"))
        bpy.ops.wm.save_as_mainfile(filepath=ut, copy=True)
        R.append(f"Säkerhetskopia: {ut}")
    A.landmarken(rig, kropp)
    cy = A.L["cy"]
    klassificera()

    # material
    mat_tyg(A, mat(f"MAT_{P}_Tyg_Vit"), "#e3d8c2", "#cbbda2", "#f1e9d8")
    mat_tyg(A, mat(f"MAT_{P}_Tyg_Bla"), "#2b4aa0", "#213c84", "#4a66b4")
    mat_tyg(A, mat(f"MAT_{P}_Tyg_Guld"), "#c99a36", "#a8792a", "#e2bd66", rough=0.66, sheen=0.6, kypert=True)
    mat_vaddering(A, mat(f"MAT_{P}_Vaddering"))
    mat_brynja(A, mat(f"MAT_{P}_Ringbrynja"))
    R.append("Material: Tyg_Vit/Bla/Guld, Vaddering och Ringbrynja har nya nodträd (samma namn).")

    # ytkartor för vadderingen
    for n in ("Vaddering", "Vaddering_Kjol"):
        R.append(quilt_till_horn(obj(n)))

    # tabarden
    balte = obj("Balte")
    zb0 = min(v.co.z for v in balte.data.vertices)
    zb1 = max(v.co.z for v in balte.data.vertices)
    under = A.bvh_av([obj("Vaddering_Kjol"), obj("Hosor"), obj("Vaddering")])
    utanpa_obj = [o for o in bpy.data.collections[f"COL_Char_{P}"].all_objects
                  if o.type == "MESH" and ("Balte" in o.name or "Vaska" in o.name)]
    utanpa = A.bvh_av(utanpa_obj)
    tabarder = []
    for namn, sida in (("Tabard_Fram", -1), ("Tabard_Bak", 1)):
        o = obj(namn)
        t0 = tris(o)
        st = utgangslage(o)
        t1 = tris(o)
        nya, ut_n, in_n = tabard(A, o, sida, zb0, zb1, A.FALL_Z, under, utanpa, cy)
        tabarder.append(o)
        R.append(f"{namn}: form {st}; veck, A-form, pös över bältet, mjuk fåll, vikt fållkant; "
                 f"{t1} → {tris(o)} trianglar (före körningen {t0}); "
                 f"{ut_n} punkter flyttade ut från kjolen, {in_n} in bakom bälte/väska")

    # ringbrynjan
    o = obj("Ringbrynja")
    t0 = tris(o)
    st = utgangslage(o)
    n = ringbrynja(A, o, tabarder)
    R.append(f"Ringbrynja: form {st}; {n} punkter in bakom tabarden; ytkarta BRYNJA; {t0} → {tris(o)} trianglar")
    R.append(f"Bälte z {zb0:.3f}–{zb1:.3f}, fåll {A.FALL_Z:.3f}")

    txt = "\n".join(["STADSVAKT C08 – tyg och skydd"] + R)
    print(txt)
    return txt


if __name__ == "__main__":
    resultat_text = kor()
