"""
C11_stadsvakt_material.py  –  Brawl med Boysen, Stadsvakten: MATERIALLYFT (BlenderKit + egna lager)
=====================================================================================================
Klistra in i Scripting-fliken (stadsvakt.blend) och kör. Kräver C04 och C05 i samma mapp.
Ordning när allt körs om: C08 → C09 → C11 → C10 (C09 skriver över lädret med sin enklare version).

Texturerna kommer från BlenderKit (gratis, royalty free) och ligger inpackade i .blend-filen:
  Chainmail Armor Material, Leather Worn, White linen fabric, Forged Iron,
  Scratched Steel Metal, Scratched Brass Plating (repkartan).
Saknas en bild används den procedurella varianten för just det lagret.

Bilderna läggs på med lådprojektion i objektets rum (fungerar utan UV och i exportens bakning),
ringbrynjan med sin egen ytkarta (BRYNJA, i meter). Alla reliefer går via Bump (ingen tangentrymd behövs).

Material
  Ringbrynja   riktiga ringar (färg, metallic, roughness, relief, mörka hål) + anlöpning och lätt hängande veck
  Tyg          linnevävens struktur i färg (överlägg), roughness och relief; skuggning i vecken; samma färger
  Läder        åldrat läder: färgvariation och repor från texturen, ojämn roughness, slitna kanter,
               sömmar/veck/slitage från C09 behålls
  Hjälm        smitt järn: hamrad relief, ojämn roughness, fina repor, ljusare slitna kanter, lite rost i fördjupningar
  Mässing      repad mässing med mörkare ärg i fördjupningar
  Axelskydd    målade stålplåtar (ny: MAT_Stadsvakt_Malad_Vit / _Malad_Bla): halvmatt färg, penseldrag,
               nötta kanter där stålet syns, smuts i fogarna
"""

import bpy
import math
import os
import time
import importlib.util

C05_FIL = "C05_stadsvakt_B1_hjalm_axlar_armar.py"
P = "Stadsvakt"
R = []

BILD = {
    "brynja_f": "Chainmail Armor Material_BaseColor.jpg",
    "brynja_m": "Chainmail Armor Material_Metallic.jpg",
    "brynja_r": "Chainmail Armor Material_Roughness.jpg",
    "brynja_a": "Chainmail Armor Material_Alpha.jpg.001",
    "brynja_h": "Chainmail Armor Material_Displacement.jpg",
    "lader_f": "Leather_Worn_01_basecolor.jpg",
    "lader_r": "Leather_Worn_01_roughness.jpg",
    "lin_f": "white linen_BaseColor.jpg",
    "lin_r": "white linen_Roughness.jpg",
    "lin_h": "white linen_Displacement.jpg",
    "jarn_f": "Medieval_Forged_Iron_07302024_basecolor.jpg",
    "jarn_r": "Medieval_Forged_Iron_07302024_roughness.jpg",
    "jarn_ao": "Medieval_Forged_Iron_07302024_ambientocclusion.jpg",
    "repor_r": "Scratched Steel Metal_Roughness.jpg",
    "repor_k": "Cool_Scratch_Map_04.jpg",
}


def ladda(fil, namn):
    mapp = os.path.dirname(bpy.data.filepath)
    spec = importlib.util.spec_from_file_location(namn, os.path.join(mapp, fil))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# =============================================================== hjälp för bildlager
def bild(nyckel, data=False):
    im = bpy.data.images.get(BILD[nyckel])
    if im is None:
        return None
    if data:
        im.colorspace_settings.name = "Non-Color"
    return im


def lada(b, ruta):
    """Objektets koordinater skalade så att en bild täcker 'ruta' meter."""
    mp = b.n("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0 / ruta, 1.0 / ruta, 1.0 / ruta)
    b.koppla(b.obj, mp.inputs["Vector"])
    return mp.outputs[0]


def tex(b, nyckel, koord, data=False, box=True):
    im = bild(nyckel, data)
    if im is None:
        return None
    nd = b.n("ShaderNodeTexImage")
    nd.image = im
    nd.interpolation = "Linear"
    if box:
        nd.projection = "BOX"
        nd.projection_blend = 0.3
    b.koppla(koord, nd.inputs["Vector"])
    return nd


def gra(b, nd):
    """Bildens ljushet (0–1)."""
    bw = b.n("ShaderNodeRGBToBW")
    b.koppla(nd.outputs["Color"], bw.inputs[0])
    return bw.outputs[0]


def blanda_typ(b, typ, fac, a, c):
    nd = b.n("ShaderNodeMix")
    nd.data_type = "RGBA"
    nd.blend_type = typ
    fs = [s for s in nd.inputs if s.identifier.startswith("Factor")][0]
    sa = [s for s in nd.inputs if s.identifier == "A_Color"][0]
    sb = [s for s in nd.inputs if s.identifier == "B_Color"][0]
    for sock, v in ((fs, fac), (sa, a), (sb, c)):
        if isinstance(v, (tuple, list, int, float)):
            sock.default_value = v
        else:
            b.koppla(v, sock)
    return [s for s in nd.outputs if s.identifier == "Result_Color"][0]


def gra_till_farg(b, v):
    nd = b.n("ShaderNodeCombineColor")
    for i in range(3):
        b.koppla(v, nd.inputs[i])
    return nd.outputs[0]


def skuggning(b, f, styrka=0.3, avst=0.04):
    """Lite mörkare i fördjupningar och veck (Ambient Occlusion)."""
    ao = b.n("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = avst
    try:
        ao.samples = 8
    except Exception:
        pass
    return blanda_typ(b, "MULTIPLY", styrka, f, ao.outputs["Color"])


def kantmask(b):
    """Kantmask: egenskapen KANT (räknad i skriptet, syns i EEVEE och bakning) eller Pointiness (Cycles)."""
    nd = b.n("ShaderNodeAttribute")
    nd.attribute_name = "KANT"
    return b.math("MAXIMUM", b.kanter(), nd.outputs["Fac"])


def rakna_kanter(o):
    """KANT per hörn: hur utåtbuktande ytan är (0 platt/insjunken – 1 vass kant eller öppen kant)."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.normal_update()
    varden = []
    for v in bm.verts:
        if any(e.is_boundary for e in v.link_edges):
            varden.append(1.0)
            continue
        s, n = 0.0, 0
        for e in v.link_edges:
            w = e.other_vert(v)
            d = v.co - w.co
            if d.length > 1e-6:
                s += v.normal.dot(d.normalized())
                n += 1
        konv = s / n if n else 0.0
        varden.append(max(0.0, min(1.0, (konv - 0.04) / 0.22)))
    bm.free()
    me = o.data
    a = me.attributes.get("KANT")
    if a:
        me.attributes.remove(a)
    a = me.attributes.new("KANT", "FLOAT", "POINT")
    a.data.foreach_set("value", varden)


def avmattad(b, farg_ut, mattnad=0.4, ljus=1.0):
    hs = b.n("ShaderNodeHueSaturation")
    hs.inputs["Saturation"].default_value = mattnad
    hs.inputs["Value"].default_value = ljus
    b.koppla(farg_ut, hs.inputs["Color"])
    return hs.outputs[0]


# =============================================================== ringbrynja
def mat_brynja(A, m):
    b = A.Nod(m)
    q = b.attribut("BRYNJA")
    mp = b.n("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / 0.26, 1 / 0.26, 1.0)
    b.koppla(q, mp.inputs["Vector"])
    k = mp.outputs[0]
    tf = tex(b, "brynja_f", k, box=False)
    tr = tex(b, "brynja_r", k, data=True, box=False)
    tm = tex(b, "brynja_m", k, data=True, box=False)
    ta = tex(b, "brynja_a", k, data=True, box=False)
    th = tex(b, "brynja_h", k, data=True, box=False)
    if not (tf and tr and ta):
        R.append("Ringbrynja: BlenderKit-bilder saknas – behåller C08-materialet")
        return m
    v = b.separera(q)[1]
    anlop = b.ramp(b.brus(4.0, 4.0), 0.0, 1.0, 0.35, 0.75)
    f = avmattad(b, tf.outputs["Color"], 0.35, 1.25)
    f = blanda_typ(b, "MULTIPLY", b.math("MULTIPLY", anlop, 0.35), f, b.farg("#6d6a66"))
    hal = b.math("SUBTRACT", 1.0, ta.outputs["Color"])
    f = b.blanda(b.math("MULTIPLY", hal, 0.9), f, b.farg("#0b0b0c"))
    f = skuggning(b, f, 0.35, 0.03)
    b.satt(["Base Color"], f)
    utan_hal = b.math("SUBTRACT", 1.0, b.math("MULTIPLY", hal, 0.8))
    b.satt(["Metallic"], b.math("MULTIPLY", tm.outputs["Color"], utan_hal) if tm else utan_hal)
    rr = b.math("ADD", b.math("MULTIPLY", tr.outputs["Color"], 0.85), b.math("MULTIPLY", anlop, 0.12))
    rr = b.math("MAXIMUM", rr, b.math("MULTIPLY", hal, 0.85))
    b.satt(["Roughness"], rr)
    b.satt(["Specular IOR Level", "Specular"], 0.5)
    n = b.bump(th.outputs["Color"], 0.9, 0.003) if th else None
    # brynjan hänger i mjuka valkar (ojämna, svaga)
    valk = b.math("SINE", b.math("ADD", b.math("MULTIPLY", v, 2 * math.pi / 0.034),
                                 b.math("MULTIPLY", b.brus(6.0, 2.0), 3.0)))
    n = b.bump(valk, 0.18, 0.003, n)
    b.satt(["Normal"], n)
    R.append("Ringbrynja: BlenderKit-ringar (färg, metallic, roughness, relief, mörka hål) + anlöpning och valkar")
    return m


# =============================================================== tyg
def mat_tyg(A, m, bas, mork, ljus, rough=0.9, sheen=0.5, kypert=False):
    b = A.Nod(m)
    k = lada(b, 0.16)
    tf = tex(b, "lin_f", k)
    tr = tex(b, "lin_r", k, data=True)
    th = tex(b, "lin_h", k, data=True)
    var = b.brus(3.0, 3.0)
    flack = b.brus(45.0, 2.0)
    f = b.blanda(b.ramp(var, 0.0, 0.45, 0.3, 0.75), b.farg(bas), b.farg(mork))
    f = b.blanda(b.ramp(flack, 0.0, 0.12, 0.4, 0.7), f, b.farg(mork))
    if tf:                                                   # vävens struktur som överlägg på vår färg
        lum = b.ramp(gra(b, tf), 0.0, 1.0, 0.42, 0.78)
        f = blanda_typ(b, "OVERLAY", 0.55, f, gra_till_farg(b, lum))
    z = b.separera(b.obj)[2]
    smuts = b.math("MULTIPLY", b.ramp(z, 0.22, 0.0, 0.74, 0.98), b.ramp(b.brus(7.0, 4.0), 0.3, 1.0, 0.35, 0.7))
    f = b.blanda(smuts, f, b.farg("#5e5243"))
    f = b.blanda(b.math("MULTIPLY", kantmask(b), 0.3), f, b.farg(ljus))
    f = skuggning(b, f, 0.28, 0.05)
    b.satt(["Base Color"], f)
    b.satt(["Metallic"], 0.0)
    if tr:
        b.satt(["Roughness"], b.math("ADD", b.ramp(tr.outputs["Color"], rough - 0.07, rough + 0.06), b.ramp(var, -0.02, 0.03)))
    else:
        b.satt(["Roughness"], b.ramp(var, rough - 0.03, rough + 0.04))
    b.satt(["Sheen Weight", "Sheen"], sheen)
    b.satt(["Sheen Roughness"], 0.55)
    b.satt(["Specular IOR Level", "Specular"], 0.3)
    n = b.bump(th.outputs["Color"], 0.55, 0.0012) if th else b.bump(b.brus(320.0, 2.0, stracka=(1.0, 1.0, 0.08)), 0.06, 0.0004)
    if kypert:
        s = b.separera(b.obj)
        diag = b.math("SINE", b.math("MULTIPLY", b.math("ADD", s[0], b.math("ADD", s[1], s[2])), 2 * math.pi / 0.007))
        n = b.bump(diag, 0.18, 0.0005, n)
    n = b.bump(b.brus(14.0, 3.0), 0.06, 0.002, n)              # mjuka bucklor
    b.satt(["Normal"], n)
    return m


# =============================================================== läder (C09:s standard + åldrat läder)
def mat_lader(A, m, bas, mork, ljus, rough=(0.45, 0.72), narv=1.0, trad="#b39c74", ruta=0.22):
    b = A.Nod(m)
    k = lada(b, ruta)
    tf = tex(b, "lader_f", k)
    tr = tex(b, "lader_r", k, data=True)
    var = b.brus(3.5, 3.0)
    mask = b.separera(b.attribut("LADER_MASK"))
    veck_m, slit_m = mask[0], mask[1]
    som = b.separera(b.attribut("LADER_SOM"))
    nara, ranna = None, None
    for i in range(3):
        a = b.math("ABSOLUTE", b.math("SUBTRACT", som[i], 1.0))
        n1 = b.ramp(a, 1.0, 0.0, 0.0005, 0.0012)
        r1 = b.ramp(a, 1.0, 0.0, 0.0, 0.0024)
        nara = n1 if nara is None else b.math("MAXIMUM", nara, n1)
        ranna = r1 if ranna is None else b.math("MAXIMUM", ranna, r1)
    o = b.separera(b.obj)
    sk = b.math("ADD", b.math("MULTIPLY", o[0], 0.7), b.math("ADD", b.math("MULTIPLY", o[1], 1.3), o[2]))
    stygn = b.math("MULTIPLY", nara, b.ramp(b.math("SINE", b.math("MULTIPLY", sk, 2 * math.pi / 0.0045)), 0.0, 1.0, -0.2, 0.5))
    veck = b.math("MULTIPLY", b.ramp(b.brus(55.0, 2.0, stracka=(1.0, 1.0, 7.0)), 0.0, 1.0, 0.45, 0.78), veck_m)
    slit = b.math("MAXIMUM", b.math("MULTIPLY", kantmask(b), 0.6),
                  b.math("MULTIPLY", slit_m, b.ramp(b.brus(28.0, 3.0), 0.35, 1.0, 0.35, 0.7)))
    f = b.blanda(b.ramp(var, 0.0, 1.0, 0.3, 0.75), b.farg(bas), b.farg(mork))
    lum = None
    if tf:                                                   # åldrat läder: fläckar, nötning och repor från texturen
        lum = b.ramp(gra(b, tf), 0.0, 1.0, 0.06, 0.36)
        f = blanda_typ(b, "OVERLAY", 0.75, f, gra_till_farg(b, lum))
    f = b.blanda(b.math("MULTIPLY", veck, 0.55), f, b.farg(mork))
    f = b.blanda(b.math("MULTIPLY", ranna, 0.35), f, b.farg(mork))
    f = b.blanda(b.math("MULTIPLY", slit, 0.6), f, b.farg(ljus))
    f = b.blanda(b.math("MULTIPLY", stygn, 0.85), f, b.farg(trad))
    f = skuggning(b, f, 0.3, 0.03)
    b.satt(["Base Color"], f)
    b.satt(["Metallic"], 0.0)
    rr = b.ramp(tr.outputs["Color"], rough[0], rough[1]) if tr else b.ramp(var, rough[0], rough[1])
    rr = b.math("ADD", rr, b.math("MULTIPLY", slit, 0.12))
    rr = b.math("ADD", rr, b.math("MULTIPLY", veck, 0.06))
    rr = b.math("SUBTRACT", rr, b.math("MULTIPLY", b.ramp(var, 0.0, 1.0, 0.55, 0.8), 0.12))   # blankslitna partier
    b.satt(["Roughness"], rr)
    b.satt(["Specular IOR Level", "Specular"], 0.45)
    b.satt(["Coat Weight", "Coat"], 0.06)
    n = b.bump(lum, 0.30 * narv, 0.0008) if lum is not None else b.bump(b.voronoi(220.0), 0.10 * narv, 0.0004)
    n = b.bump(b.brus(45.0, 3.0), 0.05 * narv, 0.001, n)
    n = b.bump(b.math("SUBTRACT", 1.0, veck), 0.45, 0.0015, n)
    n = b.bump(b.math("SUBTRACT", 1.0, ranna), 0.35, 0.0008, n)
    n = b.bump(stygn, 0.25, 0.0004, n)
    b.satt(["Normal"], n)
    return m


# =============================================================== stål / järn / mässing
def mat_stal(A, m):
    b = A.Nod(m)
    k = lada(b, 0.30)
    k2 = lada(b, 0.22)
    tf = tex(b, "jarn_f", k)
    tr = tex(b, "jarn_r", k, data=True)
    tao = tex(b, "jarn_ao", k, data=True)
    ts = tex(b, "repor_r", k2, data=True)
    var = b.brus(4.0, 5.0)
    kant = kantmask(b)
    if tf:
        f = avmattad(b, tf.outputs["Color"], 0.25, 1.1)
        f = b.blanda(0.3, f, b.farg("#606367"))
    else:
        f = b.blanda(b.ramp(var, 0.0, 1.0, 0.3, 0.72), b.farg("#6c6f72"), b.farg("#575a5d"))
    repa = b.ramp(gra(b, ts), 0.0, 1.0, 0.5, 0.72) if ts else b.ramp(b.brus(200.0, 2.0, stracka=(1.0, 30.0, 1.0)), 0.0, 1.0, 0.7, 0.8)
    f = b.blanda(b.math("MULTIPLY", repa, 0.35), f, b.farg("#b9bdc0"))
    f = b.blanda(b.math("MULTIPLY", kant, 0.35), f, b.farg("#a3a7aa"))
    fordj = b.math("SUBTRACT", 1.0, tao.outputs["Color"]) if tao else b.ramp(var, 0.0, 0.3, 0.6, 0.8)
    rost = b.math("MULTIPLY", b.ramp(fordj, 0.0, 1.0, 0.25, 0.6), b.ramp(b.brus(9.0, 6.0, 0.65), 0.0, 1.0, 0.55, 0.7))
    f = b.blanda(b.math("MULTIPLY", rost, 0.75), f, b.farg("#5b3b24"))
    f = skuggning(b, f, 0.4, 0.04)
    b.satt(["Base Color"], f)
    b.satt(["Metallic"], b.math("SUBTRACT", 1.0, b.math("MULTIPLY", rost, 0.85)))
    rr = b.ramp(tr.outputs["Color"], 0.42, 0.74) if tr else b.ramp(var, 0.45, 0.68)
    rr = b.math("SUBTRACT", rr, b.math("MULTIPLY", repa, 0.12))
    rr = b.math("SUBTRACT", rr, b.math("MULTIPLY", kant, 0.1))
    rr = b.math("ADD", rr, b.math("MULTIPLY", rost, 0.35))
    b.satt(["Roughness"], rr)
    n = b.bump(tao.outputs["Color"], 0.35, 0.002) if tao else None
    n = b.bump(b.voronoi(34.0), 0.16, 0.003, n)                 # hamrad yta
    n = b.bump(b.math("SUBTRACT", 1.0, repa), 0.08, 0.0003, n)   # repor
    b.satt(["Normal"], n)
    return m


def mat_massing(A, m):
    b = A.Nod(m)
    k = lada(b, 0.12)
    ts = tex(b, "repor_k", k, data=True)
    var = b.brus(6.0, 4.0)
    kant = kantmask(b)
    f = b.blanda(b.ramp(var, 0.0, 1.0, 0.3, 0.75), b.farg("#b08d45"), b.farg("#8a6a30"))
    repa = b.ramp(gra(b, ts), 0.0, 1.0, 0.45, 0.75) if ts else b.ramp(var, 0.0, 0.2, 0.5, 0.8)
    f = b.blanda(b.math("MULTIPLY", kant, 0.6), f, b.farg("#dcc07a"))
    arg = b.ramp(b.brus(12.0, 5.0), 0.0, 1.0, 0.55, 0.75)
    f = b.blanda(b.math("MULTIPLY", arg, 0.45), f, b.farg("#4b3d1e"))
    f = skuggning(b, f, 0.45, 0.02)
    b.satt(["Base Color"], f)
    b.satt(["Metallic"], 1.0)
    rr = b.math("ADD", b.ramp(repa, 0.26, 0.5), b.math("MULTIPLY", arg, 0.2))
    b.satt(["Roughness"], rr)
    n = b.bump(repa, 0.1, 0.0003)
    n = b.bump(b.brus(60.0, 3.0), 0.05, 0.0006, n)
    b.satt(["Normal"], n)
    return m


# =============================================================== målade stålplåtar (axelskydd)
def mat_malad(A, m, farg, mork, ljus):
    b = A.Nod(m)
    k = lada(b, 0.28)
    tf = tex(b, "jarn_f", k)
    ts = tex(b, "repor_k", lada(b, 0.18), data=True)
    var = b.brus(4.0, 3.0)
    kant = kantmask(b)
    farg_ut = b.blanda(b.ramp(var, 0.0, 1.0, 0.3, 0.75), b.farg(farg), b.farg(mork))
    pensel = b.brus(90.0, 2.0, stracka=(1.0, 1.0, 0.08))         # svaga penseldrag längs plåten
    farg_ut = b.blanda(b.ramp(pensel, 0.0, 0.08, 0.4, 0.65), farg_ut, b.farg(mork))
    farg_ut = b.blanda(b.math("MULTIPLY", kant, 0.2), farg_ut, b.farg(ljus))     # nött färg mot kanten
    stal = b.blanda(0.4, avmattad(b, tf.outputs["Color"], 0.2, 1.1), b.farg("#55585c")) if tf else b.farg("#55585c")
    # avslagen färg: på kanterna (där plåten nöts) och några små nagg på ytan
    nagg = b.ramp(b.math("MULTIPLY", kant, b.brus(35.0, 4.0)), 0.0, 1.0, 0.44, 0.52)
    prick = b.ramp(b.brus(70.0, 6.0), 0.0, 1.0, 0.74, 0.76)
    if ts:
        prick = b.math("MAXIMUM", prick, b.ramp(gra(b, ts), 0.0, 1.0, 0.78, 0.86))
    av = b.math("MAXIMUM", nagg, b.math("MULTIPLY", prick, 0.8))
    f = b.blanda(av, farg_ut, stal)
    f = b.blanda(b.ramp(b.brus(5.0, 5.0), 0.0, 0.22, 0.5, 0.8), f, b.farg("#5a4d3c"))   # lätt smuts
    f = skuggning(b, f, 0.5, 0.03)                             # smuts i fogarna mellan lamellerna
    b.satt(["Base Color"], f)
    b.satt(["Metallic"], b.math("MULTIPLY", av, 0.95))
    smuts = b.ramp(b.brus(5.0, 5.0), 0.0, 1.0, 0.45, 0.75)
    rr = b.math("ADD", b.ramp(var, 0.5, 0.64), b.math("MULTIPLY", b.ramp(pensel, 0.0, 1.0, 0.4, 0.7), 0.08))
    rr = b.math("ADD", rr, b.math("MULTIPLY", smuts, 0.08))
    rr = b.math("SUBTRACT", rr, b.math("MULTIPLY", av, 0.05))
    b.satt(["Roughness"], rr)
    b.satt(["Specular IOR Level", "Specular"], 0.5)
    b.satt(["Coat Weight", "Coat"], 0.04)
    n = b.bump(b.math("SUBTRACT", 1.0, av), 0.35, 0.0004)       # färgskiktets kant runt naggen
    n = b.bump(pensel, 0.04, 0.0004, n)
    n = b.bump(b.brus(300.0, 2.0), 0.03, 0.0002, n)              # lätt "apelsinskal"
    n = b.bump(b.voronoi(30.0), 0.06, 0.002, n)                  # plåtens svaga hamring
    b.satt(["Normal"], n)
    return m


# =============================================================== huvudprogram
def kor():
    B1 = ladda(C05_FIL, "stadsvakt_B1")
    A = B1.ladda_A()
    if not globals().get("SKIPPA_KOPIA"):
        mapp = os.path.join(os.path.dirname(bpy.data.filepath), "versioner")
        os.makedirs(mapp, exist_ok=True)
        ut = os.path.join(mapp, time.strftime("stadsvakt_fore_C11_%Y%m%d_%H%M%S.blend"))
        bpy.ops.wm.save_as_mainfile(filepath=ut, copy=True)
        R.append(f"Säkerhetskopia: {ut}")
    saknas = [n for n in BILD.values() if bpy.data.images.get(n) is None]
    if saknas:
        R.append("Saknade bilder (procedurellt i stället): " + ", ".join(saknas))
    inpackade = 0
    for n in BILD.values():
        im = bpy.data.images.get(n)
        if im and not im.packed_file:
            try:
                im.pack()
                inpackade += 1
            except Exception as e:
                R.append(f"  kunde inte packa {n}: {e}")
        if im:
            im.use_fake_user = True
    R.append(f"Bilder inpackade i .blend: {inpackade} nya")

    nk = 0
    for o in bpy.data.collections[f"COL_Char_{P}"].all_objects:
        if o.type == "MESH" and len(o.data.vertices):
            rakna_kanter(o)
            nk += 1
    R.append(f"Kantmask (KANT) räknad på {nk} delar – kantslitage syns nu även i EEVEE")

    def m(namn):
        mm = bpy.data.materials.get(f"MAT_{P}_{namn}") or bpy.data.materials.new(f"MAT_{P}_{namn}")
        mm["baka"] = True                     # exporten (C10) bakar materialet trots att det har bilder
        return mm

    mat_brynja(A, m("Ringbrynja"))
    mat_tyg(A, m("Tyg_Vit"), "#e3d8c2", "#cbbda2", "#f1e9d8")
    mat_tyg(A, m("Tyg_Bla"), "#2b4aa0", "#213c84", "#4a66b4")
    mat_tyg(A, m("Tyg_Guld"), "#c99a36", "#a8792a", "#e2bd66", rough=0.66, sheen=0.6, kypert=True)
    R.append("Tyg: linnevävens struktur (färg, roughness, relief) + skuggning i vecken")
    mat_lader(A, m("Lader_Brun"), "#6f4629", "#4e301b", "#9a6c43")
    mat_lader(A, m("Lader_Mork"), "#3f2818", "#2c1c11", "#61432b", rough=(0.48, 0.76))
    mat_lader(A, m("Sula"), "#2c1b10", "#1f130b", "#4a3424", rough=(0.7, 0.9), narv=0.6)
    if bpy.data.materials.get(f"MAT_{P}_Lader_Snore"):
        mat_lader(A, m("Lader_Snore"), "#8e3f2a", "#6a2c1d", "#b06a4c")
    R.append("Läder: åldrat läder (Leather Worn) i brun, mörk, snöre och sula; sömmar/veck/slitage från C09 kvar")
    mat_stal(A, m("Metall_Hjalm"))
    mat_massing(A, m("Metall_Massing"))
    R.append("Metall: smitt järn till hjälmen (hamrad, repor, ojämn roughness, slitna kanter, lite rost); repad mässing")
    vit = mat_malad(A, m("Malad_Vit"), "#ddd3bd", "#c7bb9f", "#efe8d8")
    bla = mat_malad(A, m("Malad_Bla"), "#2b4aa0", "#203a80", "#4d69b6")
    n = 0
    for o in bpy.data.collections[f"COL_Char_{P}"].all_objects:
        if o.type != "MESH" or "Axelskydd" not in o.name:
            continue
        for i, mm in enumerate(o.data.materials):
            if mm and mm.name == f"MAT_{P}_Tyg_Vit":
                o.data.materials[i] = vit
                n += 1
            elif mm and mm.name == f"MAT_{P}_Tyg_Bla":
                o.data.materials[i] = bla
                n += 1
    R.append(f"Axelskydd: målade stålplåtar ({n} materialplatser bytta till Malad_Vit/Malad_Bla), läderkanten kvar")

    # städa bort BlenderKits provkuber (bilderna ligger kvar i våra material)
    kol = bpy.data.collections.get("GR_BK_PROV")
    if kol:
        for o in list(kol.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(kol)
        R.append("BlenderKits provkuber borttagna")
    txt = "\n".join(["STADSVAKT C11 – material"] + R)
    print(txt)
    return txt


if __name__ == "__main__":
    resultat_text = kor()
