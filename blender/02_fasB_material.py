# =====================================================================
#  BRAWL MED BOYSEN – FAS B: MATERIALUPPGRADERING (PBR utan plastkänsla)  v1.2
#  v1.1: lagade plankor, mossa främst på skuggsidan, nötta trappsteg (MAT_Sten_Trappa),
#        arenasand med mer grus längs skranket och upptrampad mitt
#  v1.2: sprickor bara på enstaka stenar och svagare
#  Klistra in i Blenders Scripting-flik och tryck "Run Script" (Alt+P).
#
#  Vad skriptet gör:
#   1. Sparar en säkerhetskopia i undermappen "versioner" bredvid din .blend-fil.
#   2. Skapar nya MAT_-material (sten, mark, trä, tak, järn, tyg, korsvirke, hö)
#      och byter ut de gamla BO_-materialen på objekten. De gamla materialen
#      SPARAS i filen (fake user), så inget originalmaterial försvinner.
#   3. Ger UV-karta (1 UV-ruta = 1 meter) till objekt som saknar UV.
#   4. Skriver en sammanfattning (textredigeraren "FAS_B_rapport" + konsolen).
#
#  Uppbyggnad av varje material (viktigt för bakningen i Fas E):
#   - "Kakel-delen" är periodisk: den upprepar sig sömlöst var "tile"-meter.
#     Den bakas senare EN gång per material till 1024/512-bilder (färg,
#     roughness, normal) och återanvänds av alla objekt med materialet.
#   - "Världs-delen" (smuts vid marken, mossa på låga skuggiga partier) beror
#     på var ytan står i världen och går inte att baka in i en kakelbild.
#     Den styrs av noden "VARLD_FAKTOR" (1 = på, 0 = av). I spelet görs samma
#     effekt i Three.js-shadern.
#
#  Skriptet kan köras flera gånger: befintliga MAT_-material byggs om på
#  plats i stället för att dupliceras.
# =====================================================================
import bpy
import bmesh
import math
import os
import time
from mathutils import Vector

TAU = 2 * math.pi


# ---------------------------------------------------------------------
# Hjälpfunktioner för färger
# ---------------------------------------------------------------------
def srgb_till_linjar(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexfarg(h):
    h = h.lstrip("#")
    return tuple(srgb_till_linjar(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


# ---------------------------------------------------------------------
# Nodbyggare: liten verktygslåda för att bygga shader-noder i kod
# ---------------------------------------------------------------------
class Nodbyggare:
    def __init__(self, mat):
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.antal = 0

    def nod(self, typ, **egenskaper):
        n = self.nt.nodes.new(typ)
        # enkel automatisk placering i rutnät
        n.location = (-1800 + (self.antal // 14) * 210, 700 - (self.antal % 14) * 110)
        self.antal += 1
        for k, v in egenskaper.items():
            setattr(n, k, v)
        return n

    def satt(self, sock, x):
        if isinstance(x, (int, float)):
            sock.default_value = x
        elif isinstance(x, tuple):
            sock.default_value = x
        else:
            self.nt.links.new(x, sock)

    # --- matematik (flyttal) ---
    def m(self, op, a, b=0.0, c=0.0, klampa=False):
        n = self.nod("ShaderNodeMath", operation=op, use_clamp=klampa)
        self.satt(n.inputs[0], a)
        if len(n.inputs) > 1:
            self.satt(n.inputs[1], b)
        if len(n.inputs) > 2:
            self.satt(n.inputs[2], c)
        return n.outputs[0]

    def add(self, a, b): return self.m("ADD", a, b)
    def sub(self, a, b): return self.m("SUBTRACT", a, b)
    def mul(self, a, b): return self.m("MULTIPLY", a, b)
    def floor(self, a): return self.m("FLOOR", a)
    def fract(self, a): return self.m("FRACT", a)
    def mn(self, a, b): return self.m("MINIMUM", a, b)
    def mx(self, a, b): return self.m("MAXIMUM", a, b)
    def cos(self, a): return self.m("COSINE", a)
    def sin(self, a): return self.m("SINE", a)
    def absv(self, a): return self.m("ABSOLUTE", a)
    def madd(self, a, b, c): return self.m("MULTIPLY_ADD", a, b, c)  # a*b+c
    def klamp(self, a): return self.m("ADD", a, 0.0, klampa=True)

    def mjuk(self, x, fran, till):
        """smoothstep: 0 vid 'fran', 1 vid 'till' (kan vara omvänd)."""
        n = self.nod("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
        self.satt(n.inputs[0], x)
        n.inputs[1].default_value = fran
        n.inputs[2].default_value = till
        n.inputs[3].default_value = 0.0
        n.inputs[4].default_value = 1.0
        return n.outputs[0]

    # --- färger/vektorer ---
    def farg(self, h):
        n = self.nod("ShaderNodeRGB")
        n.outputs[0].default_value = hexfarg(h)
        return n.outputs[0]

    def vm(self, op, a, b=None):
        n = self.nod("ShaderNodeVectorMath", operation=op)
        self.satt(n.inputs[0], a)
        if b is not None:
            self.satt(n.inputs[1], b)
        return n.outputs[0]

    def vm_skalar(self, op, a, b):
        """Vektoroperation som ger ett tal (t.ex. skalärprodukt)."""
        n = self.nod("ShaderNodeVectorMath", operation=op)
        self.satt(n.inputs[0], a)
        self.satt(n.inputs[1], b)
        return n.outputs["Value"]

    def vskala(self, a, f):
        n = self.nod("ShaderNodeVectorMath", operation="SCALE")
        self.satt(n.inputs[0], a)
        self.satt(n.inputs["Scale"], f)
        return n.outputs[0]

    def blanda(self, a, b, f):
        """a + (b - a) * f  (fungerar för färger)"""
        return self.vm("ADD", a, self.vskala(self.vm("SUBTRACT", b, a), f))

    def ramp(self, fac, stopp):
        n = self.nod("ShaderNodeValToRGB")
        self.satt(n.inputs[0], fac)
        el = n.color_ramp.elements
        while len(el) > len(stopp):
            el.remove(el[-1])
        while len(el) < len(stopp):
            el.new(1.0)
        for e, (pos, h) in zip(el, stopp):
            e.position = pos
            e.color = hexfarg(h)
        return n.outputs[0]

    # --- sömlöst (periodiskt) brus ---
    # u och v går 0..1 per kakel. Vi lägger dem på två cirklar i 4D-brus,
    # så att mönstret möts perfekt i kanterna. "drag_u/drag_v" ≈ antal
    # mönsterdetaljer per kakel i varje riktning.
    def _torus(self, u, v, drag_u, drag_v, fro):
        ru = drag_u / TAU
        rv = drag_v / TAU
        au = self.mul(u, TAU)
        av = self.mul(v, TAU)
        x = self.madd(self.cos(au), ru, fro)
        y = self.mul(self.sin(au), ru)
        z = self.madd(self.cos(av), rv, fro * 0.37)
        w = self.mul(self.sin(av), rv)
        vek = self.nod("ShaderNodeCombineXYZ")
        self.satt(vek.inputs[0], x)
        self.satt(vek.inputs[1], y)
        self.satt(vek.inputs[2], z)
        return vek.outputs[0], w

    def brus(self, u, v, drag_u, drag_v=None, detalj=3.0, rufs=0.55, fro=0.0):
        vek, w = self._torus(u, v, drag_u, drag_v or drag_u, fro)
        n = self.nod("ShaderNodeTexNoise")
        n.noise_dimensions = "4D"
        if hasattr(n, "normalize"):
            n.normalize = True
        self.satt(n.inputs["Vector"], vek)
        self.satt(n.inputs["W"], w)
        n.inputs["Scale"].default_value = 1.0
        n.inputs["Detail"].default_value = detalj
        n.inputs["Roughness"].default_value = rufs
        return n.outputs["Fac"]

    def voronoi(self, u, v, drag, fro=0.0, kantavstand=False):
        vek, w = self._torus(u, v, drag, drag, fro)
        n = self.nod("ShaderNodeTexVoronoi")
        n.voronoi_dimensions = "4D"
        if kantavstand:
            n.feature = "DISTANCE_TO_EDGE"
        self.satt(n.inputs["Vector"], vek)
        self.satt(n.inputs["W"], w)
        n.inputs["Scale"].default_value = 1.0
        return n.outputs["Distance"], n.outputs.get("Color")  # "Color" finns inte i kantavstånds-läget

    def kanal(self, farg, i):
        n = self.nod("ShaderNodeSeparateColor")
        self.satt(n.inputs[0], farg)
        return n.outputs[i]

    # --- block (stenar, plankor, takpannor) ---
    def block(self, u, v, rader, kolumner, fog_kakel, ojamn=0.0):
        """Förskjutna rader. Returnerar: fog (1 i fogen), kant (avstånd till fog,
        i kakel-enheter), bu/bv (blockets mitt – samma för hela blocket), fv (0..1 inom raden)."""
        if ojamn > 0:
            v = self.add(v, self.mul(self.sub(self.brus(u, v, 6, 6, 2.0, 0.5, 11.0), 0.5), ojamn / rader))
            u = self.add(u, self.mul(self.sub(self.brus(u, v, 6, 6, 2.0, 0.5, 23.0), 0.5), ojamn / kolumner))
        r = self.mul(v, rader)
        rad = self.floor(r)
        fv = self.sub(r, rad)
        skift = self.mul(self.m("MODULO", rad, 2.0), 0.5)
        x = self.add(self.mul(u, kolumner), skift)
        kol = self.floor(x)
        fu = self.sub(x, kol)
        ex = self.mul(self.mn(fu, self.sub(1.0, fu)), 1.0 / kolumner)
        ey = self.mul(self.mn(fv, self.sub(1.0, fv)), 1.0 / rader)
        kant = self.mn(ex, ey)
        fog = self.sub(1.0, self.mjuk(kant, fog_kakel * 0.45, fog_kakel))
        bu = self.mul(self.sub(self.add(kol, 0.5), skift), 1.0 / kolumner)
        bv = self.mul(self.add(rad, 0.5), 1.0 / rader)
        return fog, kant, bu, bv, fv, fu

    def slump_per_block(self, bu, bv, fro):
        """Ett jämnt fördelat tal 0..1 per block (brus med mycket hög frekvens)."""
        b = self.brus(bu, bv, 57.0, 57.0, 0.0, 0.5, fro)
        return self.mjuk(b, 0.3, 0.7)


# ---------------------------------------------------------------------
# Materialtyper. Var och en returnerar (färg, roughness, metallic, höjd, sheen)
# ---------------------------------------------------------------------
def bygg_sten(b, u, v, p):
    fog, kant, bu, bv, fv, fu = b.block(u, v, p["rader"], p["kolumner"], p["fog"] / p["tile"], p.get("ojamn", 0.25))
    r = b.slump_per_block(bu, bv, 3.1)
    r2 = b.slump_per_block(bu, bv, 9.7)
    stor = b.brus(u, v, 3, 3, 3.0, 0.5, 1.0)          # stora fläckar
    mellan = b.brus(u, v, 14, 14, 4.0, 0.55, 2.0)     # ojämnheter i stenen
    fin = b.brus(u, v, 70, 70, 2.0, 0.6, 3.0)         # kornighet
    # stenens färg: blockvis mellan två toner + lite variation inom stenen
    sten = b.ramp(r, [(0.0, p["a"]), (0.55, p["b"]), (1.0, p.get("c", p["b"]))])
    sten = b.vskala(sten, b.madd(mellan, 0.22, b.madd(fin, 0.08, 0.84)))
    # fuktfläckar och svag mossa/jord (dämpat)
    fukt = b.mul(b.mjuk(stor, 0.58, 0.78), p.get("fukt", 0.5))
    sten = b.blanda(sten, b.vskala(sten, 0.72), fukt)
    mossa = b.mul(b.mjuk(b.brus(u, v, 5, 5, 3.0, 0.6, 4.0), 0.64, 0.8), p.get("mossa", 0.25))
    sten = b.blanda(sten, b.farg("#59603f"), b.mul(mossa, 0.6))
    # vittring: ljusare, slitna stenkanter
    slit = b.mul(b.sub(1.0, b.mjuk(kant, 0.0, p["fog"] / p["tile"] * 2.5)), 0.12)
    sten = b.blanda(sten, b.farg(p["b"]), slit)
    # fog (mörkare bruk med smuts)
    fogfarg = b.vskala(b.farg(p["fogfarg"]), b.madd(fin, 0.2, 0.9))
    farg = b.blanda(sten, fogfarg, fog)
    rough = b.klamp(b.add(b.madd(mellan, 0.12, p.get("rough", 0.8)),
                          b.sub(b.mul(fog, 0.12), b.mul(fukt, 0.25))))
    # höjd: rundade stenkanter, ojämn yta, nedsänkt fog, små sprickor
    # sprickor: tunna, och bara på enstaka stenar (inte ett nät över hela muren)
    spricka = b.mjuk(b.absv(b.sub(b.brus(u, v, 9, 9, 2.0, 0.5, 5.0), 0.5)), 0.005, 0.0)
    spricka = b.mul(spricka, b.mjuk(b.slump_per_block(bu, bv, 21.7), 0.9, 0.95))
    hojd = b.add(b.mul(b.mjuk(kant, 0.0, p["fog"] / p["tile"] * 3.0), 0.6),
                 b.madd(mellan, 0.3, b.mul(fin, 0.1)))
    hojd = b.sub(hojd, b.add(b.mul(fog, 0.35), b.mul(spricka, 0.25)))
    farg = b.blanda(farg, b.vskala(farg, 0.75), b.mul(spricka, 0.35))
    return farg, rough, 0.0, hojd, 0.0, r2


def bygg_kullersten(b, u, v, p):
    _, cell = b.voronoi(u, v, p["celler"], 1.0)
    d, _ = b.voronoi(u, v, p["celler"], 1.0, kantavstand=True)   # avstånd till närmaste fog
    r = b.kanal(cell, 0)
    g = b.kanal(cell, 1)
    fog = b.sub(1.0, b.mjuk(d, 0.03, 0.09))
    fin = b.brus(u, v, 60, 60, 2.0, 0.6, 2.0)
    sten = b.ramp(r, [(0.0, p["a"]), (0.6, p["b"]), (1.0, p["c"])])
    sten = b.vskala(sten, b.madd(fin, 0.12, 0.9))
    farg = b.blanda(sten, b.farg(p["fogfarg"]), fog)
    rough = b.klamp(b.madd(g, 0.15, b.madd(fog, 0.1, 0.72)))
    hojd = b.sub(b.mul(b.mjuk(d, 0.0, 0.3), 0.8), b.mul(fog, 0.3))
    return farg, rough, 0.0, hojd, 0.0, None


def bygg_mark(b, u, v, p):
    stor = b.brus(u, v, 2.5, 2.5, 3.0, 0.5, 1.0)      # sand / jord / packat
    mellan = b.brus(u, v, 10, 10, 4.0, 0.55, 2.0)
    fin = b.brus(u, v, 90, 90, 2.0, 0.6, 3.0)         # korn
    # små stenar och grus (glest, olika storlek)
    d1, c1 = b.voronoi(u, v, p.get("grus", 70), 4.0)
    sten1 = b.mul(b.sub(1.0, b.mjuk(d1, 0.18, 0.32)), b.mjuk(b.kanal(c1, 0), 0.72, 0.76))
    d2, c2 = b.voronoi(u, v, p.get("grus", 70) * 2.6, 6.0)
    sten2 = b.mul(b.sub(1.0, b.mjuk(d2, 0.15, 0.3)), b.mjuk(b.kanal(c2, 0), 0.6, 0.64))
    grus = b.mx(sten1, b.mul(sten2, 0.8))
    # skrapmärken: avlånga stråk (mycket detalj i ena riktningen)
    skrap = b.mjuk(b.absv(b.sub(b.brus(u, v, 4, 40, 2.0, 0.5, 7.0), 0.5)), 0.03, 0.0)
    skrap = b.mul(skrap, b.mjuk(b.brus(u, v, 3, 3, 2.0, 0.5, 8.0), 0.55, 0.7))
    # mörkare jordpartier
    jord = b.mjuk(stor, 0.6, 0.8)
    packat = b.mjuk(stor, 0.42, 0.25)
    farg = b.ramp(b.madd(mellan, 0.35, b.mul(stor, 0.65)),
                  [(0.0, p["sand_ljus"]), (0.5, p["sand"]), (1.0, p["sand_mork"])])
    farg = b.blanda(farg, b.farg(p["jord"]), b.mul(jord, 0.7))
    farg = b.vskala(farg, b.madd(fin, 0.14, 0.92))
    farg = b.blanda(farg, b.ramp(b.kanal(c1, 1), [(0.0, p["sten_a"]), (1.0, p["sten_b"])]), b.mul(grus, 0.85))
    farg = b.blanda(farg, b.vskala(farg, 0.82), b.mul(skrap, 0.6))
    rough = b.klamp(b.sub(b.madd(fin, 0.06, 0.93), b.add(b.mul(packat, 0.08), b.mul(grus, 0.18))))
    hojd = b.add(b.madd(mellan, 0.25, b.mul(fin, 0.18)), b.mul(grus, 0.7))
    hojd = b.sub(hojd, b.add(b.mul(skrap, 0.25), b.mul(packat, 0.08)))
    return farg, rough, 0.0, hojd, 0.0, None


def bygg_tra(b, u, v, p):
    fog, kant, bu, bv, fv, fu = b.block(u, v, p["plankor"], p.get("langd", 1), p["springa"] / p["tile"], 0.0)
    r = b.slump_per_block(bu, bv, 5.3)
    # ådring: lång längs plankan (u), tät tvärs över (v); egen förskjutning per planka
    adr = b.brus(b.add(u, b.mul(r, 0.37)), v, 3.0, p["plankor"] * 9.0, 4.0, 0.6, 2.0)
    adr2 = b.brus(u, v, 1.5, p["plankor"] * 26.0, 2.0, 0.5, 4.0)
    knut = b.mul(b.sub(1.0, b.mjuk(b.voronoi(u, v, 9.0, 3.0)[0], 0.0, 0.08)), 0.6)
    spricka = b.mjuk(b.absv(b.sub(b.brus(u, v, 2.0, p["plankor"] * 5.0, 2.0, 0.5, 6.0), 0.5)), 0.01, 0.0)
    farg = b.ramp(r, [(0.0, p["a"]), (0.6, p["b"]), (1.0, p.get("c", p["b"]))])
    farg = b.vskala(farg, b.madd(adr, 0.3, b.madd(adr2, 0.1, 0.76)))
    farg = b.blanda(farg, b.vskala(farg, 0.6), b.add(b.mul(knut, 0.5), b.mul(spricka, 0.6)))
    # slitna, ljusare kanter och grå väderbiten ton
    slit = b.mul(b.sub(1.0, b.mjuk(kant, 0.0, 0.012)), 0.25)
    farg = b.blanda(farg, b.farg(p.get("gra", "#8d877c")), b.add(b.mul(slit, 0.6), p.get("grahet", 0.15)))
    # lagade plankor: ungefär var tolfte planka är utbytt – ljusare, varmare och mindre grå
    lagad = b.mul(b.mjuk(b.slump_per_block(bu, bv, 17.3), 0.9, 0.94), p.get("lagade", 0.85))
    farg = b.blanda(farg, b.vm("MULTIPLY", farg, b.farg("#ffe9cf")), lagad)
    farg = b.blanda(farg, b.vskala(farg, 1.25), b.mul(lagad, 0.6))
    farg = b.blanda(farg, b.farg("#2b2219"), fog)
    rough = b.klamp(b.sub(b.madd(adr, 0.12, b.madd(fog, 0.15, p.get("rough", 0.7))), b.mul(lagad, 0.06)))
    hojd = b.add(b.mul(b.mjuk(kant, 0.0, 0.01), 0.4), b.mul(adr2, 0.25))
    hojd = b.sub(hojd, b.add(b.mul(spricka, 0.4), b.mul(fog, 0.4)))
    return farg, rough, 0.0, hojd, 0.0, None


def bygg_tak(b, u, v, p):
    fog, kant, bu, bv, fv, fu = b.block(u, v, p["rader"], p["kolumner"], p["springa"] / p["tile"], p.get("ojamn", 0.08))
    r = b.slump_per_block(bu, bv, 7.7)
    fin = b.brus(u, v, 40, 40, 3.0, 0.6, 2.0)
    stor = b.brus(u, v, 3, 3, 2.0, 0.5, 3.0)
    farg = b.ramp(r, [(0.0, p["a"]), (0.6, p["b"]), (1.0, p.get("c", p["b"]))])
    farg = b.vskala(farg, b.madd(fin, 0.18, 0.86))
    # överlapp: nederkanten på varje rad ligger ovanpå raden under → skugga strax ovanför fogen
    overlapp = b.sub(1.0, fv)                     # hög vid nederkanten (fv=0)
    farg = b.vskala(farg, b.madd(b.mjuk(fv, 0.0, 0.25), 0.25, 0.75))
    # lite lav/mossa och smuts i fläckar
    lav = b.mul(b.mjuk(stor, 0.66, 0.8), p.get("mossa", 0.2))
    farg = b.blanda(farg, b.farg("#6d7050"), b.mul(lav, 0.5))
    farg = b.blanda(farg, b.vskala(farg, 0.45), fog)
    rough = b.klamp(b.madd(fin, 0.1, b.madd(fog, 0.1, p.get("rough", 0.72))))
    hojd = b.add(b.mul(overlapp, 0.5), b.mul(fin, 0.12))
    if p.get("runda"):  # tegelpannornas rundning
        hojd = b.add(hojd, b.mul(b.sin(b.mul(fu, math.pi)), 0.5))
    hojd = b.sub(hojd, b.mul(fog, 0.3))
    return farg, rough, 0.0, hojd, 0.0, None


def bygg_jarn(b, u, v, p):
    stor = b.brus(u, v, 6, 6, 3.0, 0.55, 1.0)
    rep = b.mjuk(b.absv(b.sub(b.brus(u, v, 3, 50, 2.0, 0.5, 2.0), 0.5)), 0.02, 0.0)
    rost = b.mjuk(b.brus(u, v, 5, 5, 4.0, 0.6, 3.0), 0.62, 0.74)
    farg = b.blanda(b.vskala(b.farg(p["a"]), b.madd(stor, 0.25, 0.85)), b.farg("#6b4026"), b.mul(rost, 0.85))
    farg = b.blanda(farg, b.farg("#8a8a88"), b.mul(rep, 0.4))
    metall = b.sub(1.0, b.mul(rost, 0.9))
    rough = b.klamp(b.add(b.madd(stor, 0.25, 0.3), b.sub(b.mul(rost, 0.45), b.mul(rep, 0.1))))
    hojd = b.add(b.mul(rost, 0.4), b.mul(stor, 0.2))
    return farg, rough, metall, hojd, 0.0, None


def bygg_tyg(b, u, v, p):
    n = p.get("tradar", 60.0)
    wu = b.sin(b.mul(u, TAU * n))
    wv = b.sin(b.mul(v, TAU * n))
    vav = b.madd(b.mul(wu, wv), 0.5, 0.5)
    flack = b.brus(u, v, 4, 4, 3.0, 0.55, 1.0)
    farg = b.farg(p["a"])
    if p.get("motiv"):
        mot = p["motiv"]
        kant = b.mn(b.mn(u, b.sub(1.0, u)), b.mn(v, b.sub(1.0, v)))
        bard = b.sub(1.0, b.mjuk(kant, 0.05, 0.06))
        if mot == "cirkel":
            du = b.sub(u, 0.5)
            dv = b.mul(b.sub(v, 0.6), 1.6)
            d = b.m("SQRT", b.add(b.mul(du, du), b.mul(dv, dv)))
            figur = b.sub(1.0, b.mjuk(d, 0.17, 0.185))
        elif mot == "rand":
            figur = b.sub(1.0, b.mjuk(b.absv(b.sub(u, 0.5)), 0.09, 0.1))
        else:  # balk
            figur = b.sub(1.0, b.mjuk(b.absv(b.sub(v, 0.58)), 0.09, 0.1))
        farg = b.blanda(farg, b.farg(p["b"]), b.mx(bard, figur))
        # slitna, mörkare kanter
        farg = b.blanda(farg, b.vskala(farg, 0.6), b.sub(1.0, b.mjuk(kant, 0.0, 0.025)))
    farg = b.vskala(farg, b.madd(vav, 0.1, b.madd(flack, 0.12, 0.84)))
    rough = b.klamp(b.madd(flack, 0.06, 0.82))
    hojd = b.madd(vav, 0.6, b.mul(flack, 0.2))
    return farg, rough, 0.0, hojd, 0.6, None


def bygg_korsvirke(b, u, v, p):
    fu = b.fract(u)
    fv = b.fract(v)
    stolpe = b.mx(b.sub(1.0, b.mjuk(b.mn(fu, b.sub(1.0, fu)), 0.025, 0.03)),
                  b.sub(1.0, b.mjuk(b.absv(b.sub(fu, 0.5)), 0.018, 0.023)))
    regel = b.mx(b.sub(1.0, b.mjuk(b.mn(fv, b.sub(1.0, fv)), 0.03, 0.035)),
                 b.sub(1.0, b.mjuk(b.absv(b.sub(fv, 0.55)), 0.022, 0.027)))
    snedd = b.mul(b.sub(1.0, b.mjuk(b.absv(b.sub(b.fract(b.mul(u, 2.0)), b.mul(fv, 0.909))), 0.025, 0.032)),
                  b.mjuk(fv, 0.57, 0.56))
    timmer = b.mx(b.mx(stolpe, regel), snedd)
    smuts = b.brus(u, v, 3, 3, 3.0, 0.55, 1.0)
    fin = b.brus(u, v, 40, 40, 2.0, 0.6, 2.0)
    adr = b.brus(u, v, 4, 40, 3.0, 0.6, 3.0)
    puts = b.vskala(b.farg(p["puts"]), b.madd(smuts, 0.16, b.madd(fin, 0.06, 0.82)))
    tra = b.vskala(b.farg(p["tra"]), b.madd(adr, 0.3, 0.8))
    farg = b.blanda(puts, tra, timmer)
    rough = b.klamp(b.madd(timmer, -0.12, b.madd(fin, 0.06, 0.88)))
    hojd = b.add(b.mul(timmer, 0.5), b.mul(fin, 0.15))
    return farg, rough, 0.0, hojd, 0.0, None


def bygg_ho(b, u, v, p):
    strå = b.brus(u, v, 6, 80, 3.0, 0.6, 1.0)
    stor = b.brus(u, v, 3, 3, 2.0, 0.5, 2.0)
    farg = b.ramp(b.madd(strå, 0.7, b.mul(stor, 0.3)), [(0.2, "#6e5f3a"), (0.6, "#a08c58"), (0.9, "#c4b07a")])
    return farg, b.madd(strå, 0.1, 0.85), 0.0, b.mul(strå, 0.8), 0.0, None


BYGGARE = {"sten": bygg_sten, "kullersten": bygg_kullersten, "mark": bygg_mark, "tra": bygg_tra,
           "tak": bygg_tak, "jarn": bygg_jarn, "tyg": bygg_tyg, "korsvirke": bygg_korsvirke, "ho": bygg_ho}

# ---------------------------------------------------------------------
# Materiallista. tile = meter per kakel (UV i scenen = meter).
# bump = (styrka, avstånd). varld = smuts/mossa beroende på höjd i världen.
# ---------------------------------------------------------------------
STEN = dict(fukt=0.5, mossa=0.25)
MATERIAL = {
    # --- sten ---
    "BO_Mur":   ("MAT_Sten_Mur", "sten", 1024, dict(STEN, tile=2.0, rader=4, kolumner=3, fog=0.03,
                  a="#7f7a71", b="#958e82", c="#a39a8b", fogfarg="#4d4840", rough=0.82)),
    "BO_Karna": ("MAT_Sten_Huggen", "sten", 1024, dict(STEN, tile=2.0, rader=4, kolumner=2, fog=0.014, ojamn=0.1,
                  a="#8e877b", b="#a39b8d", c="#aea594", fogfarg="#5e584f", rough=0.78, mossa=0.15)),
    "BO_Port":  ("MAT_Sten_Port", "sten", 1024, dict(STEN, tile=2.0, rader=6, kolumner=4, fog=0.025,
                  a="#746d63", b="#877f72", c="#93897a", fogfarg="#433e37", rough=0.84, fukt=0.6)),
    "BO_Hallar": ("MAT_Sten_Hallar", "sten", 1024, dict(STEN, tile=2.0, rader=2, kolumner=2, fog=0.03, ojamn=0.15,
                  a="#7e786e", b="#8f887c", c="#9a9284", fogfarg="#463f34", rough=0.8, mossa=0.15)),
    "BO_Gard":  ("MAT_Sten_Kullersten", "kullersten", 1024, dict(tile=2.0, celler=16,
                  a="#6f6a62", b="#858076", c="#948c7e", fogfarg="#4a4236")),
    # --- mark (dämpad, jordnära – ingen klargul sand) ---
    "BO_Arena": ("MAT_Mark_Arena", "mark", 1024, dict(tile=4.0, grus=70, arena=True, sand_ljus="#a39377", sand="#94826a",
                  sand_mork="#806e58", jord="#6b5a47", sten_a="#8e887e", sten_b="#a8a296")),
    "BO_Vag":   ("MAT_Mark_Vag", "mark", 1024, dict(tile=4.0, grus=110, sand_ljus="#968873", sand="#857762",
                  sand_mork="#726552", jord="#5e5040", sten_a="#868076", sten_b="#a09a8e")),
    "BO_Mark":  ("MAT_Mark_Gras", "mark", 512, dict(tile=4.0, grus=40, sand_ljus="#87835e", sand="#74714f",
                  sand_mork="#625f43", jord="#5a4e3c", sten_a="#7d786e", sten_b="#938d80")),
    "BO_Grav":  ("MAT_Mark_Grav", "mark", 512, dict(tile=4.0, grus=40, sand_ljus="#5d5847", sand="#4f4a3c",
                  sand_mork="#423e32", jord="#3b352b", sten_a="#615c52", sten_b="#757064")),
    # --- trä (dämpat brungrått) ---
    "BO_Tra":   ("MAT_Tra_Konstruktion", "tra", 1024, dict(tile=2.0, plankor=8, springa=0.006, lodrat=True,
                  a="#5d4c3b", b="#6c5a46", c="#776451", grahet=0.18)),
    "BO_Publik": ("MAT_Tra_Laktare", "tra", 1024, dict(tile=2.0, plankor=10, langd=1, springa=0.008,
                  a="#6f5c47", b="#7e6a53", c="#8a765e", grahet=0.22)),
    "BO_Barriar": ("MAT_Tra_Barriar", "tra", 512, dict(tile=2.0, plankor=8, springa=0.007,
                  a="#7a664f", b="#8a755c", c="#957f65", grahet=0.15)),
    "BO_Dorr":  ("MAT_Tra_Dorr", "tra", 512, dict(tile=2.0, plankor=10, springa=0.01, lodrat=True,
                  a="#4c3c2d", b="#594736", c="#62503d", grahet=0.08, rough=0.65)),
    # --- tak ---
    "BO_Tak_Skiffer": ("MAT_Tak_Skiffer", "tak", 1024, dict(tile=1.0, rader=4, kolumner=3, springa=0.012,
                  a="#45484d", b="#53575d", c="#5e6268", rough=0.62, mossa=0.15)),
    "BO_Tak_Spon": ("MAT_Tak_Spon", "tak", 1024, dict(tile=1.0, rader=6, kolumner=7, springa=0.01, ojamn=0.15,
                  a="#61574a", b="#6f6455", c="#7c705f", rough=0.8, mossa=0.3)),
    "BO_Tak_Tegel": ("MAT_Tak_Tegel", "tak", 1024, dict(tile=1.0, rader=4, kolumner=4, springa=0.012, runda=True,
                  a="#7f5140", b="#8f5d47", c="#9a6a52", rough=0.75, mossa=0.2)),
    # --- metall ---
    "BO_Jarn":  ("MAT_Metall_Jarn", "jarn", 512, dict(tile=1.0, a="#3c3c3e")),
    # --- tyg ---
    "BO_Baner_Bla": ("MAT_Tyg_Linne_Bla", "tyg", 512, dict(tile=1.0, tradar=40, a="#2d3e66")),
    "BO_Baner_Rod": ("MAT_Tyg_Linne_Rod", "tyg", 512, dict(tile=1.0, tradar=40, a="#7a2b25")),
    "BO_Baner_Kung": ("MAT_Tyg_Linne_Guld", "tyg", 512, dict(tile=1.0, tradar=40, a="#9a7a35")),
    "BO_Tyg_Kung": ("MAT_Tyg_Kung", "tyg", 512, dict(tile=1.0, uv01=True, tradar=70, a="#a07d34", b="#6a1a16", motiv="cirkel")),
    "BO_Tyg_Bla": ("MAT_Tyg_Bla", "tyg", 512, dict(tile=1.0, uv01=True, tradar=70, a="#24396a", b="#b1923e", motiv="rand")),
    "BO_Tyg_Rod": ("MAT_Tyg_Rod", "tyg", 512, dict(tile=1.0, uv01=True, tradar=70, a="#7c2620", b="#b1923e", motiv="balk")),
    # --- övrigt ---
    "BO_Service": ("MAT_Korsvirke", "korsvirke", 1024, dict(tile=3.2, tile_v=2.6, puts="#c1b9a8", tra="#55463a")),
    "BO_Ho":    ("MAT_Ho", "ho", 512, dict(tile=1.0)),
}
BUMP = {"sten": (0.55, 0.03), "kullersten": (0.6, 0.03), "mark": (0.45, 0.02), "tra": (0.35, 0.01),
        "tak": (0.6, 0.02), "jarn": (0.25, 0.005), "tyg": (0.25, 0.004), "korsvirke": (0.4, 0.01), "ho": (0.5, 0.01)}
VARLD = {"sten": (0.55, True), "kullersten": (0.3, False), "mark": (0.0, False), "tra": (0.45, False),
         "korsvirke": (0.5, False)}  # (smuts nertill, mossa)
# Solens riktning (vågrätt) i scenen – samma som i spelet. Mossan växer mest på andra sidan.
SOL_HORISONTELL = (-0.62, 0.78, 0.0)
# Material som inte ersätter något BO_-material (tilldelas i Fas D)
EXTRA = {
    "MAT_Sten_Trappa": ("sten", 1024, dict(STEN, tile=2.0, rader=4, kolumner=2, fog=0.02, ojamn=0.12, trappa=True,
                        a="#857e73", b="#968e81", c="#a19888", fogfarg="#4d4840", rough=0.7, mossa=0.12)),
}
ENKLA = {  # material som inte behöver textur
    "BO_Eld":     ("MAT_Eld", dict(farg="#ffb050", emission=6.0)),
    "BO_Fonster": ("MAT_Fonster", dict(farg="#121316", rough=0.45)),
}


# ---------------------------------------------------------------------
# Bygg ett material
# ---------------------------------------------------------------------
def bygg_material(namn, typ, upplosning, p, ersatter):
    mat = bpy.data.materials.get(namn) or bpy.data.materials.new(namn)
    mat.use_nodes = True
    b = Nodbyggare(mat)
    tile_u = p["tile"]
    tile_v = p.get("tile_v", tile_u)

    # UV → kakel-koordinater (0..1 per kakel). Lodräta plankor: vrid 90°.
    tc = b.nod("ShaderNodeTexCoord")
    mp = b.nod("ShaderNodeMapping", name="KAKEL_MAPPNING", label="KAKEL_MAPPNING")
    b.satt(mp.inputs["Vector"], tc.outputs["UV"])
    if p.get("uv01"):
        mp.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
    else:
        mp.inputs["Scale"].default_value = (1.0 / tile_u, 1.0 / tile_v, 1.0)
    if p.get("lodrat"):
        mp.inputs["Rotation"].default_value = (0.0, 0.0, math.pi / 2)
    sep = b.nod("ShaderNodeSeparateXYZ")
    b.satt(sep.inputs[0], mp.outputs[0])
    u, v = sep.outputs[0], sep.outputs[1]

    farg, rough, metall, hojd, sheen, _ = BYGGARE[typ](b, u, v, p)

    # --- världs-del (bakas inte; samma effekt görs i spelets shader) ---
    vf = b.nod("ShaderNodeValue", name="VARLD_FAKTOR", label="VARLD_FAKTOR")
    vf.outputs[0].default_value = 1.0
    if typ in VARLD:
        smuts_styrka, med_mossa = VARLD[typ]
        geo = b.nod("ShaderNodeNewGeometry")
        pos = b.nod("ShaderNodeSeparateXYZ")
        b.satt(pos.inputs[0], geo.outputs["Position"])
        z = pos.outputs[2]
        smuts = b.mul(b.mul(b.sub(1.0, b.mjuk(z, 0.0, 1.3)), smuts_styrka), vf.outputs[0])
        farg = b.blanda(farg, b.vm("MULTIPLY", farg, b.farg("#9c8f7c")), smuts)
        farg = b.blanda(farg, b.vskala(farg, 0.8), b.mul(smuts, 0.5))
        rough = b.klamp(b.add(rough, b.mul(smuts, 0.05)))
        if med_mossa:
            bn = b.nod("ShaderNodeTexNoise")
            bn.inputs["Scale"].default_value = 0.45
            bn.inputs["Detail"].default_value = 3.0
            b.satt(bn.inputs["Vector"], geo.outputs["Position"])
            # riktad: mest på skuggsidan (bort från solen) och nära marken
            skugga = b.mjuk(b.vm_skalar("DOT_PRODUCT", geo.outputs["Normal"], SOL_HORISONTELL), 0.3, -0.5)
            mossa = b.mul(b.mul(b.mjuk(bn.outputs["Fac"], 0.58, 0.72), b.sub(1.0, b.mjuk(z, 0.2, 2.2))),
                          b.mul(vf.outputs[0], 0.45))
            mossa = b.klamp(b.mul(mossa, b.madd(skugga, 1.3, 0.35)))
            farg = b.blanda(farg, b.farg("#4e5636"), mossa)
        if p.get("arena"):
            # arenan: mer grus och mörkare jord längs skranket, upptrampat (slätare) i mitten
            ax = b.mul(pos.outputs[0], 1 / 13.0)
            ay = b.mul(pos.outputs[1], 1 / 9.3)
            d = b.m("SQRT", b.add(b.mul(ax, ax), b.mul(ay, ay)))
            kantzon = b.mul(b.mjuk(d, 0.78, 0.98), vf.outputs[0])
            mitt = b.mul(b.sub(1.0, b.mjuk(d, 0.0, 0.65)), vf.outputs[0])
            farg = b.blanda(farg, b.vskala(farg, 0.84), b.mul(kantzon, 0.7))
            farg = b.blanda(farg, b.vskala(farg, 0.95), mitt)
            rough = b.klamp(b.sub(b.add(rough, b.mul(kantzon, 0.04)), b.mul(mitt, 0.06)))
        if p.get("trappa"):
            # slitna trappsteg: översidorna är nötta – ljusare och blankare
            nz = b.nod("ShaderNodeSeparateXYZ")
            b.satt(nz.inputs[0], geo.outputs["Normal"])
            nott = b.mul(b.mjuk(nz.outputs[2], 0.8, 0.95), vf.outputs[0])
            farg = b.blanda(farg, b.vskala(farg, 1.15), b.mul(nott, 0.6))
            rough = b.klamp(b.sub(rough, b.mul(nott, 0.22)))

    # --- Principled BSDF ---
    bsdf = b.nod("ShaderNodeBsdfPrincipled")
    b.satt(bsdf.inputs["Base Color"], farg)
    b.satt(bsdf.inputs["Roughness"], rough)
    b.satt(bsdf.inputs["Metallic"], metall)
    if sheen and "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    bump = b.nod("ShaderNodeBump")
    bump.inputs["Strength"].default_value = BUMP[typ][0]
    bump.inputs["Distance"].default_value = BUMP[typ][1]
    b.satt(bump.inputs["Height"], hojd)
    b.satt(bsdf.inputs["Normal"], bump.outputs["Normal"])
    ut = b.nod("ShaderNodeOutputMaterial")
    b.nt.links.new(bsdf.outputs[0], ut.inputs["Surface"])
    bsdf.location = (1400, 300)
    ut.location = (1700, 300)

    # Uppgifter som Fas E (bakning) och spelet behöver
    mat["typ"] = typ
    mat["ersatter"] = ersatter
    mat["tile_u"] = tile_u
    mat["tile_v"] = tile_v
    mat["uv01"] = bool(p.get("uv01"))
    mat["bake_res"] = upplosning
    mat["varld_smuts"] = VARLD.get(typ, (0.0, False))[0]
    mat["varld_mossa"] = VARLD.get(typ, (0.0, False))[1]
    mat["trappa"] = bool(p.get("trappa"))
    mat["arena"] = bool(p.get("arena"))
    mat["sol_horisontell"] = list(SOL_HORISONTELL)
    if typ == "tyg":
        mat.use_backface_culling = False
    return mat, b.antal


def bygg_enkelt(namn, p, ersatter):
    mat = bpy.data.materials.get(namn) or bpy.data.materials.new(namn)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    ut = nt.nodes.new("ShaderNodeOutputMaterial")
    ut.location = (300, 0)
    nt.links.new(bsdf.outputs[0], ut.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = hexfarg(p["farg"])
    bsdf.inputs["Roughness"].default_value = p.get("rough", 0.8)
    if p.get("emission"):
        bsdf.inputs["Emission Color"].default_value = hexfarg(p["farg"])
        bsdf.inputs["Emission Strength"].default_value = p["emission"]
    mat["typ"] = "enkel"
    mat["ersatter"] = ersatter
    return mat


# ---------------------------------------------------------------------
# UV för objekt som saknar UV-karta (lådprojektion i meter, världskoordinater)
# ---------------------------------------------------------------------
def ge_uv(obj):
    me = obj.data
    if me.uv_layers:
        return False
    if me.users > 1:
        return False  # delad mesh: hoppa över hellre än att ändra andra objekt
    me.uv_layers.new(name="UVMap")
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    mw = obj.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    for f in bm.faces:
        n = (nm @ f.normal).normalized()
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            w = mw @ lp.vert.co
            if ax == 2:
                lp[uvl].uv = (w.x, w.y)
            elif ax == 0:
                lp[uvl].uv = (w.y, w.z)
            else:
                lp[uvl].uv = (w.x, w.z)
    bm.to_mesh(me)
    bm.free()
    return True


# ---------------------------------------------------------------------
# HUVUDPROGRAM
# ---------------------------------------------------------------------
def kor():
    rapport = []
    fel = []
    if not bpy.data.filepath:
        raise RuntimeError("Spara .blend-filen först (File > Save), så att säkerhetskopian får en plats.")

    # 1. Säkerhetskopia
    mapp = os.path.join(bpy.path.abspath("//"), "versioner")
    os.makedirs(mapp, exist_ok=True)
    kopia = os.path.join(mapp, time.strftime("fore_fasB_%Y%m%d_%H%M%S.blend"))
    bpy.ops.wm.save_as_mainfile(filepath=kopia, copy=True)
    rapport.append(f"Säkerhetskopia: {kopia}")

    # Mät före
    mesh_obj = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    mat_fore = len({s.material.name for o in mesh_obj for s in o.material_slots if s.material})

    # 2. Bygg material
    nya = {}
    for gammal, (nytt, typ, res, p) in MATERIAL.items():
        try:
            mat, antal = bygg_material(nytt, typ, res, p, gammal)
            nya[gammal] = mat
            rapport.append(f"  {nytt:24s} ← {gammal:15s} ({typ}, {res}px, {antal} noder)")
        except Exception as e:  # ett trasigt material ska inte stoppa resten
            fel.append(f"{nytt}: {e}")
    for nytt, (typ, res, p) in EXTRA.items():
        try:
            bygg_material(nytt, typ, res, p, "")
            rapport.append(f"  {nytt:24s} (extra, {typ}, {res}px)")
        except Exception as e:
            fel.append(f"{nytt}: {e}")
    for gammal, (nytt, p) in ENKLA.items():
        try:
            nya[gammal] = bygg_enkelt(nytt, p, gammal)
            rapport.append(f"  {nytt:24s} ← {gammal:15s} (enkelt)")
        except Exception as e:
            fel.append(f"{nytt}: {e}")

    # 3. Byt material på objekten (gamla behålls i filen)
    bytta = 0
    for o in mesh_obj:
        for s in o.material_slots:
            if s.material and s.material.name in nya:
                gammal = s.material
                gammal.use_fake_user = True
                s.material = nya[gammal.name]
                bytta += 1
    rapport.append(f"Materialplatser bytta: {bytta}")
    kvar = sorted({s.material.name for o in mesh_obj for s in o.material_slots
                   if s.material and not s.material.name.startswith("MAT_")})
    if kvar:
        rapport.append("Material som inte byttes (okända): " + ", ".join(kvar))

    # 4. UV för objekt utan UV
    uv_nya = [o.name for o in mesh_obj if ge_uv(o)]
    rapport.append(f"UV-karta skapad för {len(uv_nya)} objekt" + (": " + ", ".join(uv_nya) if uv_nya else ""))

    mat_efter = len({s.material.name for o in mesh_obj for s in o.material_slots if s.material})
    rapport.insert(1, f"Unika material på objekten: före {mat_fore}, efter {mat_efter}")
    rapport.insert(2, "Nya/ombyggda material:")
    if fel:
        rapport.append("FEL:")
        rapport += ["  " + f for f in fel]
    rapport.append("Klart. Titta i Material Preview (Z > Material Preview). Första gången tar det en stund"
                   " medan Blender förbereder shaders.")
    text = "FAS B – MATERIAL\n" + "\n".join(rapport)
    print(text)
    t = bpy.data.texts.get("FAS_B_rapport") or bpy.data.texts.new("FAS_B_rapport")
    t.clear()
    t.write(text)
    return text, fel


resultat_text, resultat_fel = kor()
