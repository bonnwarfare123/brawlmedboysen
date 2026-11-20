"""
C04_stadsvakt_A_ny_basmodell.py  –  Brawl med Boysen, Stadsvakten: SKRIPT A
==========================================================================
Base Mesh Analysis & Character Silhouette för den NYA basmodellen
("Base Mesh Male Rigged GameReady": Auto-Rig Pro-riggen "rig" + meshen "body"
med färdigt ansikte, hud, ögon och tänder).

Samma arbetssätt som C03, men:
  * Ansiktet, huden och kroppens material rörs INTE (inget hår/skägg,
    inga formnycklar, inga materialbyten på kroppen).
  * Alla mått räknas från riggens leder (axel, armbåge, handled, höft,
    knä, vrist, nyckelben, hals, huvud) – inga fasta höjder.
  * Auto-Rig Pro-namnen på deformerande ben (arm_stretch, forearm_twist,
    thigh_twist, leg_stretch …) tolkas automatiskt.
  * Modellen är 1,95 m hög. Tomobjektet skalas till 1,85 m och flyttas till
    origo – bara objektets läge/skala, riggen, vikterna och viloposen rörs inte.
    (Ändra MAL_HOJD nedan, eller sätt den till None för att behålla 1,95 m.)
  * Förra basmodellen och dess utrustning flyttas till en dold arkivsamling.

Utrustningen byggs i riggens rum och är barn till riggen. Lager som skapas ur
kroppens yta (vaddering, hosor, stövlar, handskar) ärver riggens vikter och
har en Armature-modifierare. Stela delar kopplas till benen i skript D.

Säkerhet: kopia av .blend-filen i "versioner" innan något ändras. Kan köras om
(tar bara bort objekt märkta stadsvakt + metod "arp"). Exporterar inget.
Testat i Blender 5.3.
"""

import bpy
import bmesh
import math
import os
import random
import time
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

VERSION = "A 4.0 (ny basmodell, Auto-Rig Pro)"
TAGG = "stadsvakt"
SAMLING_TOPP = "COL_Characters"
SAMLING = "COL_Char_Stadsvakt"
ARKIV = "COL_Char_Stadsvakt_Procedurell_Arkiv"
ARKIV_BAS1 = "COL_Char_Stadsvakt_Basmodell1_Arkiv"
BAS1_SAMLING = "Rigged Low Poly Male Base Mesh"
METOD = "arp"
MAL_HOJD = 1.85                    # meter; None = behåll modellens egen höjd
P = "Stadsvakt"
BAS_TOMT = "Base Mesh Male Rigged GameReady"
RIGG = "rig"
KROPP = "body"
SK_NAMN = "SK_Stadsvakt_Proportioner"

R = []
L = {}                             # mått från riggen (fylls i av landmarken())
BALTE_Z = 1.0
FALL_Z = 0.8


# ---- hjälpfunktioner (samma som i C01/C02)

def tillampa_modifierare(o):
    """Lägger in modifierarnas resultat i meshen utan operatorer (kontextfritt)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    ny = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    gammal = o.data
    o.modifiers.clear()
    namn = gammal.name
    o.data = ny
    if gammal.users == 0:
        bpy.data.meshes.remove(gammal)
    ny.name = namn


def skarpa_kanter(o, vinkel_grader):
    me = o.data
    if hasattr(me, "set_sharp_from_angle"):
        me.set_sharp_from_angle(angle=math.radians(vinkel_grader))


def satt_material_per_yta(o, funk):
    """funk(yta_center, normal) -> materialindex."""
    for p in o.data.polygons:
        p.material_index = funk(p.center, p.normal)


def bvh_av(objekt):
    """BVH av objektens UTVÄRDERADE form (t.ex. med Solidify), i objektens rum."""
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys, off = [], [], 0
    for o in objekt:
        oe = o.evaluated_get(dg)
        me = oe.to_mesh()
        verts += [v.co.copy() for v in me.vertices]
        polys += [[i + off for i in p.vertices] for p in me.polygons]
        off += len(me.vertices)
        oe.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys)


def stral(bvh, start, riktning):
    hit, nrm, idx, dist = bvh.ray_cast(Vector(start), Vector(riktning).normalized(), 2.0)
    return hit, nrm


def lathe(bm, profil, seg, rx=1.0, ry=1.0, matris=None, radiefunk=None, sluten=False):
    """Rotationskropp kring lokal Z. profil = [(r, z), ...] uppifrån och ned.
    r == 0 i första/sista punkten ger en sluten spets. Returnerar ringarna."""
    ringar = []
    for (r, z) in profil:
        if r <= 1e-6:
            ringar.append([bm.verts.new((0.0, 0.0, z))])
            continue
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            rr = r * (radiefunk(a, z) if radiefunk else 1.0)
            ring.append(bm.verts.new((rr * math.cos(a) * rx, rr * math.sin(a) * ry, z)))
        ringar.append(ring)
    for i in range(len(ringar) - 1):
        a_r, b_r = ringar[i], ringar[i + 1]
        if len(a_r) == 1:
            for k in range(seg):
                bm.faces.new((a_r[0], b_r[(k + 1) % seg], b_r[k]))
        elif len(b_r) == 1:
            for k in range(seg):
                bm.faces.new((a_r[k], a_r[(k + 1) % seg], b_r[0]))
        else:
            for k in range(seg):
                bm.faces.new((a_r[k], a_r[(k + 1) % seg], b_r[(k + 1) % seg], b_r[k]))
    if sluten:
        for ring in (ringar[0], ringar[-1]):
            if len(ring) > 2:
                bm.faces.new(ring)
    if matris is not None:
        bmesh.ops.transform(bm, matrix=matris, verts=[v for r in ringar for v in r])
    return ringar


def axel_matris(start, riktning):
    """Matris som lägger lokal +Z längs 'riktning' med origo i 'start'."""
    q = Vector((0, 0, 1)).rotation_difference(Vector(riktning).normalized())
    return Matrix.Translation(Vector(start)) @ q.to_matrix().to_4x4()


def solidify(o, tjocklek, offset=-1.0):
    m = o.modifiers.new("Tjocklek", "SOLIDIFY")
    m.thickness = tjocklek
    m.offset = offset
    m.use_even_offset = True
    m.use_quality_normals = True
    m.material_offset_rim = 0
    tillampa_modifierare(o)


def avfasa(o, bredd, seg=2, vinkel=40):
    m = o.modifiers.new("Avfasning", "BEVEL")
    m.width = bredd
    m.segments = seg
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(vinkel)
    m.harden_normals = False
    tillampa_modifierare(o)


# ---- material (procedurella; förfinas i skript C)

class Nod:
    """Liten nodbyggare som tål namnskillnader mellan Blender-versioner."""

    def __init__(self, mat):
        if getattr(mat, "node_tree", None) is None and hasattr(mat, "use_nodes"):
            mat.use_nodes = True           # äldre Blender; i 5.x har material alltid noder
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = -1400
        self.ut = self.nt.nodes.new("ShaderNodeOutputMaterial")
        self.ut.location = (400, 0)
        self.bsdf = self.nt.nodes.new("ShaderNodeBsdfPrincipled")
        self.bsdf.location = (100, 0)
        self.nt.links.new(self.bsdf.outputs[0], self.ut.inputs[0])
        tc = self.nt.nodes.new("ShaderNodeTexCoord")
        tc.location = (-1600, 0)
        self.obj = tc.outputs["Object"]

    def n(self, typ, **kw):
        nd = self.nt.nodes.new(typ)
        nd.location = (self.x, random.randint(-600, 600))
        self.x = min(self.x + 60, -150)
        for k, v in kw.items():
            setattr(nd, k, v)
        return nd

    def koppla(self, a, b):
        self.nt.links.new(a, b)

    @staticmethod
    def ingang(nd, *namn):
        for x in namn:
            s = nd.inputs.get(x)
            if s is not None:
                return s
        return None

    def satt(self, namnlista, varde):
        s = self.ingang(self.bsdf, *namnlista)
        if s is None:
            return
        if hasattr(varde, "bl_idname") or hasattr(varde, "node"):
            self.koppla(varde, s)
        else:
            s.default_value = varde

    # --- byggstenar
    def brus(self, skala, detalj=4.0, rough=0.55, koord=None, stracka=None):
        nd = self.n("ShaderNodeTexNoise")
        nd.inputs["Scale"].default_value = skala
        nd.inputs["Detail"].default_value = detalj
        nd.inputs["Roughness"].default_value = rough
        k = koord or self.obj
        if stracka:
            mp = self.n("ShaderNodeMapping")
            mp.inputs["Scale"].default_value = stracka
            self.koppla(k, mp.inputs["Vector"])
            k = mp.outputs[0]
        self.koppla(k, nd.inputs["Vector"])
        return nd.outputs["Fac"]

    def voronoi(self, skala, koord=None, slump=1.0, utgang="Distance", funktion="F1"):
        nd = self.n("ShaderNodeTexVoronoi")
        nd.feature = funktion
        nd.inputs["Scale"].default_value = skala
        s = nd.inputs.get("Randomness")
        if s:
            s.default_value = slump
        self.koppla(koord or self.obj, nd.inputs["Vector"])
        return nd.outputs[utgang]

    def ramp(self, inn, a, b, pa=0.0, pb=1.0):
        nd = self.n("ShaderNodeMapRange")
        nd.inputs["From Min"].default_value = pa
        nd.inputs["From Max"].default_value = pb
        nd.inputs["To Min"].default_value = a
        nd.inputs["To Max"].default_value = b
        nd.clamp = True
        self.koppla(inn, nd.inputs["Value"])
        return nd.outputs["Result"]

    def math(self, op, a, b=None, c=None):
        nd = self.n("ShaderNodeMath", operation=op)
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                nd.inputs[i].default_value = v
            else:
                self.koppla(v, nd.inputs[i])
        return nd.outputs[0]

    def farg(self, hexkod):
        h = hexkod.lstrip("#")
        c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
        return (*lin, 1.0)

    def blanda(self, fac, a, b):
        nd = self.n("ShaderNodeMix")
        nd.data_type = "RGBA"
        nd.blend_type = "MIX"
        fs = [s for s in nd.inputs if s.identifier.startswith("Factor")][0]
        sa = [s for s in nd.inputs if s.identifier == "A_Color"][0]
        sb = [s for s in nd.inputs if s.identifier == "B_Color"][0]
        for sock, v in ((fs, fac), (sa, a), (sb, b)):
            if isinstance(v, (tuple, list)):
                sock.default_value = v
            elif isinstance(v, (int, float)):
                sock.default_value = v
            else:
                self.koppla(v, sock)
        return [s for s in nd.outputs if s.identifier == "Result_Color"][0]

    def bump(self, hojd, styrka, avstand, normal=None):
        nd = self.n("ShaderNodeBump")
        nd.inputs["Strength"].default_value = styrka
        nd.inputs["Distance"].default_value = avstand
        self.koppla(hojd, nd.inputs["Height"])
        if normal is not None:
            self.koppla(normal, nd.inputs["Normal"])
        return nd.outputs["Normal"]

    def attribut(self, namn):
        nd = self.n("ShaderNodeAttribute")
        nd.attribute_name = namn
        return nd.outputs["Vector"]

    def separera(self, vek):
        nd = self.n("ShaderNodeSeparateXYZ")
        self.koppla(vek, nd.inputs[0])
        return nd.outputs

    def kanter(self):
        """Kantslitage (Pointiness – används vid bakning i Cycles)."""
        g = self.n("ShaderNodeNewGeometry")
        return self.ramp(g.outputs["Pointiness"], 0.0, 1.0, 0.52, 0.62)


def nytt_material(namn):
    m = bpy.data.materials.get(namn) or bpy.data.materials.new(namn)
    m[TAGG] = True
    return m


def mat_tyg(namn, bas, mork, sheen=0.35, rough=0.86, vav=250.0):
    m = nytt_material(namn)
    b = Nod(m)
    var = b.brus(7.0, 3.0)
    smuts = b.brus(2.5, 2.0)
    f = b.blanda(b.ramp(var, 0.0, 0.25, 0.35, 0.75), b.farg(bas), b.farg(mork))
    f = b.blanda(b.ramp(smuts, 0.0, 0.12, 0.55, 0.8), f, b.farg(mork))
    b.satt(["Base Color"], f)
    b.satt(["Roughness"], b.ramp(var, rough - 0.04, rough + 0.04))
    b.satt(["Sheen Weight", "Sheen"], sheen)
    b.satt(["Sheen Roughness"], 0.55)
    b.satt(["Specular IOR Level", "Specular"], 0.35)
    # vävstruktur: två korsande fina vågor
    sx = b.separera(b.obj)
    v1 = b.math("SINE", b.math("MULTIPLY", sx[0], vav))
    v2 = b.math("SINE", b.math("MULTIPLY", sx[2], vav))
    vavh = b.math("ADD", b.math("ABSOLUTE", v1), b.math("ABSOLUTE", v2))
    n = b.bump(vavh, 0.12, 0.0004)
    n = b.bump(b.brus(40.0, 2.0), 0.08, 0.001, n)
    b.satt(["Normal"], n)
    return m


def mat_vaddering(namn):
    """Quiltad vaddering: diagonala sömmar i ett rutmönster (attributet QUILT)."""
    m = nytt_material(namn)
    b = Nod(m)
    uv = b.separera(b.attribut("QUILT"))
    ruta = 0.042
    p = b.math("ADD", uv[0], uv[1])
    q = b.math("SUBTRACT", uv[0], uv[1])

    def kudde(x):
        tri = b.math("PINGPONG", x, ruta / 2)          # 0 vid sömmen, ruta/2 mitt i
        return b.math("SMOOTH_MIN", b.math("DIVIDE", tri, ruta * 0.18), 1.0, 0.4)

    h = b.math("MINIMUM", kudde(p), kudde(q))        # 0 i sömmarna, 1 i kudden
    var = b.brus(6.0, 3.0)
    bas = b.blanda(b.ramp(var, 0.0, 0.3, 0.3, 0.8), b.farg("#5a3f2b"), b.farg("#47311f"))
    # sömmarna lite mörkare – aldrig svarta
    f = b.blanda(b.ramp(h, 0.45, 0.0, 0.0, 0.8), bas, b.farg("#2e2016"))
    b.satt(["Base Color"], f)
    b.satt(["Roughness"], b.ramp(h, 0.92, 0.84))
    b.satt(["Sheen Weight", "Sheen"], 0.3)
    b.satt(["Specular IOR Level", "Specular"], 0.3)
    n = b.bump(h, 0.75, 0.006)
    n = b.bump(b.brus(60.0, 2.0), 0.08, 0.001, n)
    b.satt(["Normal"], n)
    return m


def mat_ringbrynja(namn):
    m = nytt_material(namn)
    b = Nod(m)
    d = b.voronoi(185.0, slump=0.0)
    ring = b.math("ABSOLUTE", b.math("SUBTRACT", d, 0.36))
    h = b.ramp(ring, 1.0, 0.0, 0.0, 0.16)            # 1 på ringen
    var = b.brus(12.0, 3.0)
    bas = b.blanda(b.ramp(var, 0.0, 0.5), b.farg("#4a4a4c"), b.farg("#36373a"))
    f = b.blanda(b.ramp(h, 0.55, 0.0), bas, b.farg("#202022"))
    b.satt(["Base Color"], f)
    b.satt(["Metallic"], b.ramp(h, 0.55, 0.95))
    b.satt(["Roughness"], b.ramp(var, 0.4, 0.58))
    b.satt(["Normal"], b.bump(h, 0.9, 0.002))
    return m


def mat_metall(namn, bas, mork, rough=(0.36, 0.62), rost=0.18):
    m = nytt_material(namn)
    b = Nod(m)
    var = b.brus(5.0, 5.0)
    hamr = b.voronoi(28.0)
    kant = b.kanter()
    f = b.blanda(b.ramp(var, 0.0, 0.6, 0.3, 0.75), b.farg(bas), b.farg(mork))
    rostmask = b.ramp(b.brus(9.0, 6.0, 0.65), 0.0, rost, 0.6, 0.78)
    f = b.blanda(rostmask, f, b.farg("#5b3a24"))
    f = b.blanda(b.math("MULTIPLY", kant, 0.5), f, b.farg("#8c8a86"))
    b.satt(["Base Color"], f)
    b.satt(["Metallic"], b.ramp(rostmask, 1.0, 0.4, 0.0, max(rost, 0.01)))
    r = b.ramp(var, rough[0], rough[1])
    r = b.math("ADD", r, b.math("MULTIPLY", rostmask, 0.3))
    r = b.math("SUBTRACT", r, b.math("MULTIPLY", kant, 0.12))
    b.satt(["Roughness"], r)
    n = b.bump(hamr, 0.12, 0.002)
    n = b.bump(b.brus(80.0, 2.0), 0.05, 0.0006, n)
    b.satt(["Normal"], n)
    return m


def mat_lader(namn, bas, mork, ljus):
    m = nytt_material(namn)
    b = Nod(m)
    var = b.brus(4.0, 4.0)
    veck = b.brus(9.0, 3.0, 0.5, stracka=(1.0, 1.0, 3.5))
    kant = b.kanter()
    f = b.blanda(b.ramp(var, 0.0, 0.55, 0.3, 0.8), b.farg(bas), b.farg(mork))
    f = b.blanda(b.math("MULTIPLY", kant, 0.6), f, b.farg(ljus))
    b.satt(["Base Color"], f)
    r = b.ramp(var, 0.52, 0.72)
    b.satt(["Roughness"], b.math("ADD", r, b.math("MULTIPLY", kant, 0.1)))
    b.satt(["Specular IOR Level", "Specular"], 0.45)
    n = b.bump(veck, 0.35, 0.002)
    n = b.bump(b.voronoi(160.0), 0.12, 0.0005, n)      # porer
    b.satt(["Normal"], n)
    return m


def mat_hud(namn):
    m = nytt_material(namn)
    b = Nod(m)
    var = b.brus(18.0, 3.0)
    rod = b.brus(3.0, 2.0)
    f = b.blanda(b.ramp(rod, 0.0, 0.35, 0.45, 0.75), b.farg("#c9997c"), b.farg("#b9796a"))
    f = b.blanda(b.ramp(var, 0.0, 0.12), f, b.farg("#a7826a"))
    b.satt(["Base Color"], f)
    b.satt(["Roughness"], b.ramp(var, 0.48, 0.6))
    b.satt(["Subsurface Weight", "Subsurface"], 0.12)
    s = Nod.ingang(b.bsdf, "Subsurface Radius")
    if s is not None:
        s.default_value = (1.0, 0.35, 0.2)
    s = Nod.ingang(b.bsdf, "Subsurface Scale")
    if s is not None:
        s.default_value = 0.008
    b.satt(["Normal"], b.bump(b.brus(220.0, 2.0), 0.06, 0.0004))
    return m


def mat_har(namn):
    m = nytt_material(namn)
    b = Nod(m)
    strand = b.brus(60.0, 4.0, 0.6, stracka=(4.0, 4.0, 0.4))
    f = b.blanda(b.ramp(strand, 0.0, 1.0, 0.35, 0.7), b.farg("#4a3322"), b.farg("#24170e"))
    b.satt(["Base Color"], f)
    b.satt(["Roughness"], b.ramp(strand, 0.5, 0.68))
    b.satt(["Sheen Weight", "Sheen"], 0.2)
    b.satt(["Normal"], b.bump(strand, 0.5, 0.002))
    return m


def mat_enkel(namn, hexkod, rough, metall=0.0):
    m = nytt_material(namn)
    b = Nod(m)
    b.satt(["Base Color"], b.farg(hexkod))
    b.satt(["Roughness"], rough)
    b.satt(["Metallic"], metall)
    return m


def skapa_material():
    M = {}
    M["hud"] = mat_hud(f"MAT_{P}_Hud")
    M["har"] = mat_har(f"MAT_{P}_Har")
    M["ogon"] = mat_enkel(f"MAT_{P}_Ogon", "#e9e3d6", 0.25)
    M["iris"] = mat_enkel(f"MAT_{P}_Iris", "#2c1b10", 0.15)
    M["vit"] = mat_tyg(f"MAT_{P}_Tyg_Vit", "#e3d8c2", "#c9bba0")
    M["bla"] = mat_tyg(f"MAT_{P}_Tyg_Bla", "#2b4aa0", "#203a80")
    M["guld"] = mat_tyg(f"MAT_{P}_Tyg_Guld", "#c99a36", "#a8792a", sheen=0.5, rough=0.7)
    M["vadd"] = mat_vaddering(f"MAT_{P}_Vaddering")
    M["brynja"] = mat_ringbrynja(f"MAT_{P}_Ringbrynja")
    M["jarn"] = mat_metall(f"MAT_{P}_Metall_Hjalm", "#5f5850", "#423c36", (0.40, 0.66))
    M["massing"] = mat_metall(f"MAT_{P}_Metall_Massing", "#b08d45", "#8a6a30", (0.3, 0.45), rost=0.0)
    M["lader"] = mat_lader(f"MAT_{P}_Lader_Brun", "#6f4629", "#4e301b", "#93673f")
    M["snitt"] = mat_enkel(f"MAT_{P}_Snitt", "#7d2b22", 0.55)   # snittytor vid avhuggning
    M["ladermork"] = mat_lader(f"MAT_{P}_Lader_Mork", "#3f2818", "#2c1c11", "#5c3e27")
    return M


def ror(bm, punkter, radier, seg, platt=1.0):
    """Rör längs punkter med slutna ändar (för mustasch, bryn, remmar)."""
    ringar = []
    for i, pt in enumerate(punkter):
        t = (punkter[min(i + 1, len(punkter) - 1)] - punkter[max(i - 1, 0)]).normalized()
        upp = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((0, 1, 0))
        a = t.cross(upp).normalized()
        b = t.cross(a).normalized()
        ring = []
        for k in range(seg):
            v = 2 * math.pi * k / seg
            ring.append(bm.verts.new(pt + a * math.cos(v) * radier[i] + b * math.sin(v) * radier[i] * platt))
        ringar.append(ring)
    for i in range(len(ringar) - 1):
        for k in range(seg):
            bm.faces.new((ringar[i][k], ringar[i][(k + 1) % seg], ringar[i + 1][(k + 1) % seg], ringar[i + 1][k]))
    bm.faces.new(list(reversed(ringar[0])))
    bm.faces.new(ringar[-1])


def nyckel_former(bm, mitt, vinkel, skala, utvidga):
    """En nyckel i XZ-planet (platt): ögla överst, skaft, ax nederst."""
    e = utvidga
    rot = Matrix.Rotation(vinkel, 3, "Y")

    def plan(x, z):
        return mitt + rot @ Vector((x * skala, 0, z * skala))

    # ögla (ring)
    ro, ri, n = 0.022 + e, max(0.011 - e, 0.004), 16
    ytter = [plan(ro * math.cos(2 * math.pi * k / n), 0.055 + ro * math.sin(2 * math.pi * k / n)) for k in range(n)]
    inner = [plan(ri * math.cos(2 * math.pi * k / n), 0.055 + ri * math.sin(2 * math.pi * k / n)) for k in range(n)]
    vo = [bm.verts.new(p) for p in ytter]
    vi = [bm.verts.new(p) for p in inner]
    for k in range(n):
        bm.faces.new((vo[k], vo[(k + 1) % n], vi[(k + 1) % n], vi[k]))

    def rekt(x0, z0, x1, z1):
        v = [bm.verts.new(plan(x0, z0)), bm.verts.new(plan(x1, z0)),
             bm.verts.new(plan(x1, z1)), bm.verts.new(plan(x0, z1))]
        bm.faces.new(v)

    rekt(-0.006 - e, 0.035, 0.006 + e, -0.075 - e)          # skaft
    rekt(0.004, -0.045 + e, 0.024 + e, -0.056 - e)          # ax, övre tand
    rekt(0.004, -0.062 + e, 0.020 + e, -0.075 - e)          # ax, nedre tand


# =============================================================== basmodellen
def hitta_bas():
    rig = bpy.data.objects.get(RIGG)
    kropp = bpy.data.objects.get(KROPP)
    if rig is None or rig.type != "ARMATURE":
        raise RuntimeError(f"Hittar ingen armature som heter '{RIGG}'.")
    if kropp is None or kropp.type != "MESH":
        raise RuntimeError(f"Hittar ingen mesh som heter '{KROPP}'.")
    if not any(m.type == "ARMATURE" and m.object == rig for m in kropp.modifiers):
        raise RuntimeError("Kroppen är inte kopplad till riggen med en Armature-modifierare.")
    return rig, kropp


def analys(rig, kropp):
    me = kropp.data
    B = rig.data.bones
    deform = [b.name for b in B if b.use_deform]
    gnamn = {g.index: g.name for g in kropp.vertex_groups}
    utan, max_inf, over4 = 0, 0, 0
    for v in me.vertices:
        w = [g for g in v.groups if g.weight > 1e-4]
        utan += (len(w) == 0)
        max_inf = max(max_inf, len(w))
        over4 += (len(w) > 4)
    saknar_ben = [n for n in gnamn.values() if n not in B]
    pose_andrad = [pb.name for pb in rig.pose.bones
                   if pb.location.length > 1e-5 or (pb.scale - Vector((1, 1, 1))).length > 1e-5
                   or (pb.rotation_mode == "QUATERNION" and pb.rotation_quaternion.angle > 1e-4)
                   or (pb.rotation_mode != "QUATERNION" and Vector(pb.rotation_euler).length > 1e-4)]
    co = [v.co for v in me.vertices]
    hojd = max(c.z for c in co) - min(c.z for c in co)
    ua = B.get("c_arm_twist_offset.l") or B.get("arm_twist.l") or B.get("upperarm_l")
    la = B.get("forearm_stretch.l") or B.get("lowerarm_l")
    vinkel = None
    if ua and la:
        d = (la.head_local - ua.head_local).normalized()
        vinkel = math.degrees(math.acos(max(-1, min(1, -d.z))))
    R.append("ANALYS AV BASMODELLEN")
    R.append(f"  Rigg: '{rig.name}', {len(B)} ben ({len(deform)} deformerande), rot-ben: "
             + ", ".join(b.name for b in B if b.parent is None))
    R.append(f"  Kropp: '{kropp.name}', {len(me.vertices)} hörn, "
             f"{sum(len(p.vertices) - 2 for p in me.polygons)} trianglar, {len(kropp.vertex_groups)} vertex groups")
    R.append(f"  Viktgrupper utan ben: {len(saknar_ben)}   hörn utan vikt: {utan}   "
             f"max påverkan/hörn: {max_inf} ({over4} hörn har > 4 – åtgärdas i skript D/E)")
    R.append(f"  Pose ändrad på {len(pose_andrad)} ben   pose-läge: {rig.data.pose_position}   "
             f"överarm {vinkel:.0f}° från lodlinjen (A-pose)" if vinkel else "")
    R.append(f"  Höjd {hojd:.3f} m   material: {[m.name for m in me.materials if m]}   "
             f"modifierare: {[m.type for m in kropp.modifiers]}")
    return {"pose_andrad": pose_andrad, "over4": over4}


def sakerhetskopia():
    if globals().get("SKIPPA_KOPIA") or not bpy.data.filepath:
        if not bpy.data.filepath:
            R.append("Säkerhetskopia: filen är inte sparad – ingen kopia gjord")
        return
    mapp = os.path.join(os.path.dirname(bpy.data.filepath), "versioner")
    os.makedirs(mapp, exist_ok=True)
    namn = os.path.splitext(os.path.basename(bpy.data.filepath))[0]
    ut = os.path.join(mapp, f"{namn}_fore_C04_{time.strftime('%Y%m%d_%H%M%S')}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=ut, copy=True)
    R.append(f"Säkerhetskopia: {ut}")


def arkivera_procedurell():
    """Den gamla procedurella Stadsvakten flyttas till en dold arkivsamling."""
    gamla = [o for o in bpy.data.objects if o.get(TAGG) and o.get("metod") not in ("basmesh", METOD)]
    ark0 = bpy.data.collections.get(ARKIV)
    if not gamla and not (ark0 and any(not o.name.endswith("_Arkiv") for o in ark0.objects)):
        return
    ark = bpy.data.collections.get(ARKIV) or bpy.data.collections.new(ARKIV)
    if ark.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(ark)
    for o in gamla:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        ark.objects.link(o)
        o["stadsvakt_arkiv"] = True
        del o[TAGG]
    for o in ark.objects:                         # egna namn så att nya delar slipper ".001"
        if not o.name.endswith("_Arkiv"):
            o.name = o.name + "_Arkiv"
            if o.data is not None and hasattr(o.data, "name") and not o.data.name.endswith("_Arkiv"):
                o.data.name = o.data.name + "_Arkiv"
    lc = hitta_lc(ark.name)
    if lc:
        lc.exclude = True
    R.append(f"Gamla procedurella modellen: {len(gamla)} objekt flyttade till '{ARKIV}' (dold)")


def hitta_lc(namn, lc=None):
    """Samlingens lager i vylagret, var den än ligger i hierarkin."""
    lc = lc or bpy.context.view_layer.layer_collection
    if lc.name == namn:
        return lc
    for c in lc.children:
        r = hitta_lc(namn, c)
        if r:
            return r
    return None


def arkivera_basmodell1():
    """Utrustningen som byggdes på förra basmodellen (C03) och själva modellen döljs."""
    gamla = [o for o in bpy.data.objects if o.get(TAGG) and o.get("metod") == "basmesh"]
    if gamla:
        ark = bpy.data.collections.get(ARKIV_BAS1) or bpy.data.collections.new(ARKIV_BAS1)
        if ark.name not in bpy.context.scene.collection.children:
            bpy.context.scene.collection.children.link(ark)
        for o in gamla:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            ark.objects.link(o)
            del o[TAGG]
            o["stadsvakt_arkiv"] = True
            if not o.name.endswith("_Bas1"):
                o.name = o.name + "_Bas1"
                if o.data is not None and not o.data.name.endswith("_Bas1"):
                    o.data.name = o.data.name + "_Bas1"
        lc = hitta_lc(ark.name)
        if lc:
            lc.exclude = True
        R.append(f"Förra basmodellens utrustning: {len(gamla)} objekt flyttade till '{ARKIV_BAS1}' (dold)")
    lc = hitta_lc(BAS1_SAMLING)
    if lc and not lc.exclude:
        lc.exclude = True
        R.append(f"Förra basmodellen ('{BAS1_SAMLING}') dold – inget raderat")


def samlingar():
    sc = bpy.context.scene
    topp = bpy.data.collections.get(SAMLING_TOPP) or bpy.data.collections.new(SAMLING_TOPP)
    if topp.name not in sc.collection.children:
        sc.collection.children.link(topp)
    kol = bpy.data.collections.get(SAMLING) or bpy.data.collections.new(SAMLING)
    if kol.name not in topp.children:
        topp.children.link(kol)
    return kol


def rensa():
    # egna objekt från tidigare körningar + ev. felarkiverade dubbletter (metod "arp" utan märkning)
    bort = [o for o in bpy.data.objects if o.get("metod") == METOD and (o.get(TAGG) or o.get("stadsvakt_arkiv"))]
    for o in bort:
        d = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if d is not None and d.users == 0 and isinstance(d, bpy.types.Mesh):
            bpy.data.meshes.remove(d)
    return len(bort)


def till_origo(kropp):
    t = bpy.data.objects.get(BAS_TOMT)
    if t is None:
        return
    if t.location.length > 1e-6:
        R.append(f"Basmodellen flyttad från {tuple(round(x, 3) for x in t.location)} till origo "
                 "(bara tomobjektets läge)")
        t.location = (0, 0, 0)
    if MAL_HOJD:
        hojd = max(v.co.z for v in kropp.data.vertices) - min(v.co.z for v in kropp.data.vertices)
        sk = MAL_HOJD / hojd
        if abs(t.scale.x - sk) > 1e-4:
            t.scale = (sk, sk, sk)
            R.append(f"Höjd {hojd:.3f} m → {MAL_HOJD:.2f} m: tomobjektet skalat {sk:.4f} "
                     "(objektskala, riggen/vikterna orörda – ändra MAL_HOJD för annan höjd)")
    bpy.context.view_layer.update()


def ben_huvud(rig, *namn):
    for n in namn:
        b = rig.data.bones.get(n)
        if b:
            return b.head_local.copy()
    raise RuntimeError("Hittar inget av benen: " + ", ".join(namn))


def landmarken(rig, kropp):
    """Leder och mått i riggens rum – allt annat i skriptet räknas härifrån."""
    global BALTE_Z, FALL_Z
    for s, k in ((1, "l"), (-1, "r")):
        L[("arm", s)] = (ben_huvud(rig, f"c_arm_twist_offset.{k}", f"arm_twist.{k}", f"upperarm_{k}"),
                         ben_huvud(rig, f"forearm_stretch.{k}", f"lowerarm_{k}"),
                         ben_huvud(rig, f"hand.{k}", f"hand_{k}"))
    L["hoft"] = ben_huvud(rig, "thigh_twist.l", "thigh_l").z
    L["kna"] = ben_huvud(rig, "leg_stretch.l", "calf_l").z
    L["vrist"] = ben_huvud(rig, "foot.l", "foot_l").z
    L["nyckel"] = ben_huvud(rig, "shoulder.l", "clavicle_l").z
    L["hals"] = ben_huvud(rig, "neck.x", "neck_01")
    L["huvudben"] = ben_huvud(rig, "head.x", "head")
    L["axel"] = L[("arm", 1)][0].z
    co = [v.co for v in kropp.data.vertices]
    L["topp"] = max(c.z for c in co)
    L["s"] = L["topp"] / 1.834                       # skala mot basmodellen som C03 kalibrerades på
    midja = [c for c in co if abs(c.z - (L["hoft"] + 0.2)) < 0.03 and abs(c.x) < 0.2]
    L["cy"] = (max(c.y for c in midja) + min(c.y for c in midja)) / 2 if midja else 0.0
    BALTE_Z = L["hoft"] + 0.15 * L["s"]
    FALL_Z = L["hoft"] - 0.165 * L["s"]
    R.append(f"Mått (riggens rum): axel {L['axel']:.3f}  nyckelben {L['nyckel']:.3f}  höft {L['hoft']:.3f}  "
             f"knä {L['kna']:.3f}  vrist {L['vrist']:.3f}  bälte {BALTE_Z:.3f}  fåll {FALL_Z:.3f}  skala {L['s']:.3f}")


def ogon_material_EJ_ANVAND(kropp):
    """Basmodellens ögon är egna öar i meshen: ögonglober (vita) och små irisdelar."""
    me = kropp.data
    og = bpy.data.materials.get(f"MAT_{P}_Ogon")
    ir = bpy.data.materials.get(f"MAT_{P}_Iris")
    if not og or not ir:
        return
    for m in (og, ir):
        if m.name not in [x.name for x in me.materials if x]:
            me.materials.append(m)
    idx = {x.name: i for i, x in enumerate(me.materials) if x}
    bm = bmesh.new()
    bm.from_mesh(me)
    sett, oar = set(), []
    for v in bm.verts:
        if v in sett:
            continue
        stack, ö = [v], []
        sett.add(v)
        while stack:
            x = stack.pop()
            ö.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y not in sett:
                    sett.add(y)
                    stack.append(y)
        oar.append(ö)
    oar.sort(key=len, reverse=True)
    antal = 0
    for ö in oar[1:]:                              # allt utom själva kroppen
        if len(ö) > 200:
            continue
        ytor = {f for v in ö for f in v.link_faces}
        if len(ö) > 30:                            # ögonglob: vit, iris där den tittar framåt
            mitt = sum((v.co for v in ö), Vector()) / len(ö)
            radie = max((v.co - mitt).length for v in ö)
            for f in ytor:
                riktning = (f.calc_center_median() - mitt) / max(radie, 1e-6)
                f.material_index = idx[ir.name] if riktning.y < -0.80 else idx[og.name]
        else:
            for f in ytor:
                f.material_index = idx[ir.name]
        antal += 1
    bm.to_mesh(me)
    bm.free()
    R.append(f"Ögon: {antal} ögondelar fick ögon-/irismaterial")


# =============================================================== kroppens yta
class Kropp:
    """Kroppens yta (med proportionsnyckeln) + vikter och ben, i riggens rum."""

    def __init__(self, kropp, rig, sk_index):
        self.obj, self.rig = kropp, rig
        self.sk_index = sk_index
        self.gnamn = [g.name for g in kropp.vertex_groups]
        self.B = rig.data.bones
        bm = self.bm()
        self.bvh = BVHTree.FromBMesh(bm)
        bm.free()

    def bm(self):
        bm = bmesh.new()
        if self.sk_index is None:
            bm.from_mesh(self.obj.data)
        else:
            bm.from_mesh(self.obj.data, use_shape_key=True, shape_key_index=self.sk_index)
        return bm

    def ben(self, n):
        return self.B[n].head_local.copy()

    def arm(self, s):
        a = L[("arm", s)]
        return a[0].copy(), a[1].copy(), a[2].copy()

    @staticmethod
    def grupp_typ(namn):
        n = namn.lower()
        if n.startswith(("head", "jaw", "c_lips", "c_teeth", "tong", "c_chin", "c_nose", "c_eye",
                         "c_cheek", "c_ear")):
            return "huvud"
        if n.startswith("neck"):
            return "hals"
        if n.startswith(("spine", "pelvis", "root")):
            return "bal"
        if n.startswith(("clavicle", "shoulder")):
            return "nyckelben"
        if n.startswith(("upperarm", "arm_", "c_arm_twist")):
            return "overarm"
        if n.startswith(("lowerarm", "forearm")):
            return "underarm"
        if n.startswith(("hand", "thumb", "index", "middle", "ring", "pinky",
                         "c_thumb", "c_index", "c_middle", "c_ring", "c_pinky")):
            return "hand"
        if n.startswith("thigh"):
            return "lar"
        if n.startswith(("calf", "leg")):
            return "vad"
        if n.startswith(("foot", "ball", "toes")):
            return "fot"
        return "annat"

    def yt_typ(self, f, dl):
        summa = {}
        for v in f.verts:
            for gi, w in v[dl].items():
                if gi < len(self.gnamn):
                    t = self.grupp_typ(self.gnamn[gi])
                    summa[t] = summa.get(t, 0.0) + w
        return max(summa, key=summa.get) if summa else "annat"


def arm_param(K, c, s):
    """(t längs armen från axelleden, avstånd, mittpunkt, riktning)."""
    ax, ab, hl = K.arm(s)
    d1, d2 = (ab - ax).normalized(), (hl - ab).normalized()
    L1 = (ab - ax).length
    t1 = max(-0.1, min(L1, (c - ax).dot(d1)))
    p1 = ax + d1 * t1
    t2 = max(0.0, (c - ab).dot(d2))
    p2 = ab + d2 * t2
    if (c - p1).length <= (c - p2).length or t2 <= 0.0:
        return t1, (c - p1).length, p1, d1
    return L1 + t2, (c - p2).length, p2, d2


def nytt_lager(K, namn, behall, offset, material, matfunk=None, efter=None, kol=None, smooth=True,
               dela=0, finmask=None, jamna_kant=0, mal_tris=None):
    """Kopierar kroppens ytor (behall(f, typ) == True), flyttar ut dem längs normalen
    (offset(v) meter) och gör ett eget objekt med samma vikter + Armature-modifierare."""
    bm = K.bm()
    dl = bm.verts.layers.deform.active
    typer = {f: K.yt_typ(f, dl) for f in bm.faces}
    bort = [f for f in bm.faces if not behall(f, typer[f])]
    bmesh.ops.delete(bm, geom=bort, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    if dela and bm.faces:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=dela, use_grid_fill=True, smooth=0.6)
        if finmask:
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if not finmask(f.calc_center_median())], context="FACES")
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    if not bm.faces:
        bm.free()
        R.append(f"  {namn}: inga ytor valdes – hoppades över")
        return None
    for _ in range(jamna_kant):                         # rundar av hackiga kanter
        kant = {v for e in bm.edges if e.is_boundary for v in e.verts}
        nya_k = {}
        for v in kant:
            gr = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(gr) == 2:
                nya_k[v] = v.co * 0.4 + (gr[0].co + gr[1].co) * 0.3
        for v, c in nya_k.items():
            v.co = c
    bm.normal_update()
    nya = {v: v.co + v.normal * offset(v) for v in bm.verts}
    for v, c in nya.items():
        v.co = c
    if efter:
        efter(bm, dl)
    for lag in list(bm.verts.layers.shape.values()):
        bm.verts.layers.shape.remove(lag)
    me = bpy.data.meshes.new(namn)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(namn, me)
    kol.objects.link(o)
    for g in K.gnamn:
        o.vertex_groups.new(name=g)
    for m in material:
        me.materials.append(m)
    if matfunk:
        for p in me.polygons:
            p.material_index = matfunk(p.center, p.normal)
    if smooth and hasattr(me, "shade_smooth"):
        me.shade_smooth()
    for uv in list(me.uv_layers)[1:]:
        me.uv_layers.remove(uv)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if mal_tris and tris > mal_tris:                     # lättare lager – vikterna följer med
        dm = o.modifiers.new("Decimera", "DECIMATE")
        dm.ratio = mal_tris / tris
        dm.use_collapse_triangulate = False
        tillampa_modifierare(o)
        if smooth and hasattr(o.data, "shade_smooth"):
            o.data.shade_smooth()
        R.append(f"  {namn}: {tris} → {sum(len(p.vertices) - 2 for p in o.data.polygons)} trianglar (decimerat)")
    koppla(o, K.rig, deform=True)
    return o


def koppla(o, rig, deform=False):
    o.parent = rig
    o.matrix_parent_inverse = Matrix.Identity(4)
    o[TAGG] = True
    o["metod"] = METOD
    if deform and not any(m.type == "ARMATURE" for m in o.modifiers):
        m = o.modifiers.new("Armature", "ARMATURE")
        m.object = rig


def nytt_objekt(namn, bm, kol, rig, material, slat=True):
    me = bpy.data.meshes.new(namn)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(namn, me)
    kol.objects.link(o)
    for m in material:
        me.materials.append(m)
    if slat and hasattr(me, "shade_smooth"):
        me.shade_smooth()
    koppla(o, rig)
    return o


# =============================================================== kläder ur kroppens yta
def bygg_vaddering(K, kol, M):
    def behall(f, typ):
        c = f.calc_center_median()
        if typ in ("overarm", "underarm"):
            return True
        if typ in ("bal", "nyckelben"):
            return c.z > L["hoft"] - 0.005 and not (c.z > L["nyckel"] + 0.035 and abs(c.x) < 0.09 * L["s"])
        return False

    def offset(v):
        c = v.co
        if abs(c.x) > 0.7 * L[("arm", 1)][0].x:
            s = 1 if c.x > 0 else -1
            t, dist, _, _ = arm_param(K, c, s)
            if dist < 0.13:
                Lo = (K.arm(s)[1] - K.arm(s)[0]).length
                if t < Lo:
                    return 0.017
                tot = Lo + (K.arm(s)[2] - K.arm(s)[1]).length
                return 0.016 - 0.007 * max(0.0, (t - Lo) / (tot - Lo))
        return 0.010

    o = nytt_lager(K, f"SM_{P}_Vaddering", behall, offset, [M["vadd"]], kol=kol, mal_tris=2600)
    me = o.data
    attr = me.attributes.new("QUILT", "FLOAT_VECTOR", "POINT")
    for v in me.vertices:
        c = v.co
        s = 1 if c.x > 0 else -1
        t, dist, centr, d = arm_param(K, c, s)
        if abs(c.x) > 0.7 * L[("arm", 1)][0].x and dist < 0.13:
            r = c - centr
            e1 = Vector((0, -1, 0))
            e1 = (e1 - d * e1.dot(d)).normalized()
            e2 = d.cross(e1)
            attr.data[v.index].vector = (math.atan2(r.dot(e2), r.dot(e1)) * 0.06, t, 0.0)
        else:
            attr.data[v.index].vector = (c.x, c.z, 0.0)
    return o


def bygg_hosor(K, kol, M):
    def behall(f, typ):
        c = f.calc_center_median()
        if typ in ("lar", "vad"):
            return c.z > L["vrist"] + 0.135
        return typ == "bal" and c.z <= L["hoft"] + 0.025

    return nytt_lager(K, f"SM_{P}_Hosor", behall, lambda v: 0.0045, [M["vit"], M["bla"]],
                      matfunk=lambda c, n: 0 if c.x < 0 else 1, kol=kol, mal_tris=1400)


def bygg_stovlar(K, kol, M):
    def behall(f, typ):
        c = f.calc_center_median()
        return typ == "fot" or (typ == "vad" and c.z < L["vrist"] + 0.23 * L["s"])

    def offset(v):                                        # skaftet vidgas ned mot foten
        return 0.013 + 0.014 * max(0.0, 1.0 - (v.co.z - L["vrist"]) / 0.11)

    def krage(bm, ring):
        """Rak överkant + nedvikt, lätt slokande krage för en stövel."""
        mitt = sum((v.co for v in ring), Vector()) / len(ring)
        ztopp = sum(v.co.z for v in ring) / len(ring) + 0.01
        ring.sort(key=lambda v: math.atan2(v.co.y - mitt.y, v.co.x - mitt.x))
        for v in ring:
            v.co.z = ztopp
        lager = [ring]
        for ut, upp in ((0.007, 0.012), (0.017, -0.072)):
            ny = []
            for v in lager[-1]:
                r = Vector((v.co.x - mitt.x, v.co.y - mitt.y, 0)).normalized()
                slok = 1.0 + 0.08 * math.sin(2 * math.atan2(r.y, r.x) + 0.6) if upp < 0 else 1.0
                ny.append(bm.verts.new(v.co + r * ut * slok + Vector((0, 0, upp))))
            lager.append(ny)
        for a, b in zip(lager, lager[1:]):
            n = len(a)
            for k in range(n):
                try:
                    bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
                except ValueError:
                    pass

    # Stövelns fot byggs som ett eget, rundat skal (kroppens tår syns annars igenom).
    # Kroppens fot mäts i skivor längs foten (y): bredd och höjd per skiva.
    ZF = L["vrist"] + 0.06
    ZSKAFT = L["vrist"] + 0.015                           # skaftet (kopierat lager) slutar här
    m = 0.013
    kbm = K.bm()
    kdl = kbm.verts.layers.deform.active
    fotv = [v for v in kbm.verts if v.co.z < ZF + 0.03]
    kd = KDTree(len(fotv))
    for i, v in enumerate(fotv):
        kd.insert(v.co, i)
    kd.balance()
    vikter = [dict(v[kdl]) for v in fotv]

    def skal(bm, dl, sida):
        pts = [v.co for v in fotv if v.co.z < ZF and v.co.x * sida > 0.02]
        y0, y1 = min(p.y for p in pts), max(p.y for p in pts)
        st = 0.014
        n = max(4, int((y1 - y0) / st) + 1)
        sk = [[1e9, -1e9, 0.0] for _ in range(n)]
        for p in pts:
            i = min(n - 1, int((p.y - y0) / st))
            sk[i][0] = min(sk[i][0], p.x); sk[i][1] = max(sk[i][1], p.x); sk[i][2] = max(sk[i][2], p.z)
        for i in range(n):
            if sk[i][0] > 1e8:
                sk[i] = list(sk[i - 1]) if i else list(sk[i + 1])
        jamn = []
        for i in range(n):                                # mjuk kontur
            gr = sk[max(0, i - 1):i + 2]
            jamn.append((min(g[0] for g in gr), max(g[1] for g in gr), max(g[2] for g in gr)))
        # sektioner: (y, cx, a, b) – tåhätta fram (-y), häl bak (+y)
        sekt = []
        cx0, a0, b0 = None, None, None
        for i, (xa, xb, zt) in enumerate(jamn):
            sekt.append((y0 + (i + 0.5) * st, (xa + xb) / 2, (xb - xa) / 2 + m, (zt + m) / 2))
        f, b_ = sekt[0], sekt[-1]
        tå = [(f[0] - m * k, f[1], f[2] * s_, f[3] * t_) for k, s_, t_ in ((0.55, 0.88, 0.85), (0.95, 0.6, 0.6))]
        hal = [(b_[0] + m * k, b_[1], b_[2] * s_, b_[3] * t_) for k, s_, t_ in ((0.6, 0.85, 0.95), (1.0, 0.55, 0.8))]
        sekt = list(reversed(tå)) + sekt + hal
        K_ = 16
        pexp = 2.6
        ringar = []
        for (y, cx, a, b) in sekt:
            ring = []
            for k in range(K_):
                th = 2 * math.pi * k / K_
                c, s2 = math.cos(th), math.sin(th)
                x = cx + a * math.copysign(abs(c) ** (2 / pexp), c)
                pz = pexp if s2 > 0 else 4.5                 # plattare, bredare sula
                x = cx + a * math.copysign(abs(c) ** (2 / pz), c)
                z = b + b * math.copysign(abs(s2) ** (2 / pz), s2)
                ring.append(bm.verts.new((x, y, max(0.0, z))))
            ringar.append(ring)
        for r0, r1 in zip(ringar, ringar[1:]):
            for k in range(K_):
                bm.faces.new((r0[k], r0[(k + 1) % K_], r1[(k + 1) % K_], r1[k]))
        nya = [v for r in ringar for v in r]
        for ring, yy in ((ringar[0], sekt[0][0] - m * 0.3), (ringar[-1], sekt[-1][0] + m * 0.3)):
            mitt = bm.verts.new((sum(v.co.x for v in ring) / K_, yy, sum(v.co.z for v in ring) / K_))
            nya.append(mitt)
            for k in range(K_):
                bm.faces.new((ring[k], ring[(k + 1) % K_], mitt))
        for v in nya:                                     # vikter från närmaste kroppshörn
            _, idx, _ = kd.find(v.co)
            v[dl].clear()
            for g, w in vikter[idx].items():
                v[dl][g] = w

    def efter(bm, dl):
        bort = [v for v in bm.verts if v.co.z < ZSKAFT]
        bmesh.ops.delete(bm, geom=bort, context="VERTS")
        for sida in (-1, 1):
            skal(bm, dl, sida)
        for v in bm.verts:
            if v.co.z < 0.012:
                v.co.z = 0.0                                  # platt sula
        kant = [e for e in bm.edges if e.is_boundary and all(v.co.z > L["vrist"] + 0.12 for v in e.verts)]
        alla = list({v for e in kant for v in e.verts})
        for sida in (-1, 1):                                  # en krage per stövel
            ring = [v for v in alla if v.co.x * sida > 0]
            if len(ring) > 3:
                krage(bm, ring)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    return nytt_lager(K, f"SM_{P}_Stovlar", behall, offset, [M["lader"], M["ladermork"]],
                      matfunk=lambda c, n: 1 if c.z < 0.014 else 0,
                      efter=efter, kol=kol, mal_tris=1400)


def bygg_handskar(K, kol, M):
    def behall(f, typ):
        if typ == "hand":
            return True
        if typ == "underarm":
            c = f.calc_center_median()
            s = 1 if c.x > 0 else -1
            hl = K.arm(s)[2]
            return (c - hl).length < 0.06
        return False

    o = nytt_lager(K, f"SM_{P}_Handskar", behall, lambda v: 0.0035, [M["lader"]], kol=kol, mal_tris=1800)
    # utsvängda manschetter (stela – kopplas till underarmen i skript D)
    bm = bmesh.new()
    for s in (-1, 1):
        ax, ab, hl = K.arm(s)
        d = (hl - ab).normalized()
        radier = []
        for t in (0.0, 0.04, 0.09, 0.13):
            p = hl - d * t
            r = 0.0
            for v in K.obj.data.vertices:
                q = v.co
                if abs((q - p).dot(d)) < 0.02:
                    vinkelratt = ((q - p) - d * (q - p).dot(d)).length
                    if vinkelratt < 0.075:
                        r = max(r, vinkelratt)
            radier.append(r)
        profil = [(radier[3] + 0.034, 0.135), (radier[3] + 0.036, 0.125), (radier[2] + 0.028, 0.09),
                  (radier[1] + 0.02, 0.045), (radier[0] + 0.016, 0.01), (radier[0] + 0.014, -0.006)]
        lathe(bm, profil, 18, matris=axel_matris(hl, -d), ry=0.85)
    mo = nytt_objekt(f"SM_{P}_Manschetter", bm, kol, K.rig, [M["lader"]])
    solidify(mo, 0.004, offset=-1.0)
    return [o, mo]


def anpassa_utat(K, bm, axelpunkt, marginal, extra=(), maxdist=0.06):
    """Flyttar ut hörn som hamnat innanför kroppen eller andra lager:
    strålar från formens axel och ut, den yttersta närliggande träffen gäller."""
    trad = [K.bvh] + [bvh_av([o]) for o in extra]
    for v in bm.verts:
        p = axelpunkt(v.co)
        r = v.co - p
        if r.length < 1e-5:
            continue
        hd_max = None
        for t in trad:
            hit, _ = stral(t, p, r)
            if hit:
                hd = (hit - p).length
                if hd < r.length + maxdist:
                    hd_max = hd if hd_max is None else max(hd_max, hd)
        if hd_max is not None and r.length < hd_max + marginal:
            v.co = p + r.normalized() * (hd_max + marginal)


def bygg_ringbrynja(K, kol, M, vadd=None):
    """Krage + axelmantel: rund rotationsform runt halsen som anpassas mot kroppen."""
    n1, n2 = L["hals"], L["huvudben"]
    bm = bmesh.new()
    zc, sk = L["nyckel"], L["s"]
    profil = [(r * sk, zc + dz * sk) for r, dz in
              ((0.072, 0.152), (0.076, 0.122), (0.084, 0.092), (0.104, 0.057), (0.135, 0.027),
               (0.165, 0.005), (0.188, -0.015), (0.20, -0.038), (0.205, -0.063))]
    lathe(bm, profil, 24, rx=1.0, ry=0.74, matris=Matrix.Translation((0, n1.y - 0.01, 0)))

    def axel(c):
        t = max(0.0, min(1.0, (c.z - n1.z) / max(0.01, n2.z - n1.z)))
        a = n1 + (n2 - n1) * t
        return Vector((0, a.y - 0.01, c.z))

    anpassa_utat(K, bm, axel, 0.008, extra=[vadd] if vadd else (), maxdist=0.035)
    for _ in range(3):
        bmesh.ops.smooth_vert(bm, verts=bm.verts[:], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    anpassa_utat(K, bm, axel, 0.007, extra=[vadd] if vadd else (), maxdist=0.035)
    o = nytt_objekt(f"SM_{P}_Ringbrynja", bm, kol, K.rig, [M["brynja"]])
    solidify(o, 0.005, offset=1.0)
    return o


def bygg_axelskydd(K, kol, M, vadd=None):
    """Vadderade axelskydd: välvd form runt överarmens topp, anpassad mot axeln."""
    delar = []
    for s in (-1, 1):
        ax, ab, hl = K.arm(s)
        d = (ab - ax).normalized()
        c = ax + Vector((s * 0.004, 0.0, 0.028)) * L["s"]
        mat = axel_matris(c, -d)                          # lokal +Z pekar upp mot axeln
        inv = mat.inverted()
        profil = [(r * L["s"], z * L["s"]) for r, z in
                  ((0.0, 0.07), (0.05, 0.064), (0.085, 0.044), (0.106, 0.012), (0.114, -0.03),
                   (0.11, -0.072), (0.099, -0.108), (0.088, -0.135), (0.082, -0.152), (0.079, -0.168))]

        def lober(a, z):
            if z > 0.06 * L["s"] or z < -0.15 * L["s"]:
                return 1.0
            return 0.92 + 0.08 * abs(math.sin(3 * a))     # sex vadderade paneler

        bm = bmesh.new()
        lathe(bm, profil, 36, matris=mat, radiefunk=lober)

        def axel(cc):
            lok = inv @ cc
            return mat @ Vector((0, 0, lok.z))

        anpassa_utat(K, bm, axel, 0.010, extra=[vadd] if vadd else ())
        o = nytt_objekt(f"SM_{P}_Axelskydd_" + ("V" if s > 0 else "H"), bm, kol, K.rig,
                        [M["vit"], M["bla"], M["ladermork"]])

        def klass(cc, n):
            lok = inv @ cc
            if lok.z < -0.145 * L["s"]:
                return 2
            a = math.atan2(lok.y, lok.x) % (2 * math.pi)
            return int(a / (math.pi / 3)) % 2

        satt_material_per_yta(o, klass)
        delar.append(o)
    return delar


def huvud_matt(K):
    bm = K.bm()
    dl = bm.verts.layers.deform.active
    huvudgrupper = {i for i, n in enumerate(K.gnamn) if K.grupp_typ(n) == "huvud"}
    pts = [v.co.copy() for v in bm.verts if sum(w for g, w in v[dl].items() if g in huvudgrupper) > 0.6]
    bm.free()
    zt = max(p.z for p in pts)
    ovre = [p for p in pts if p.z > zt - 0.09]
    cy = (max(p.y for p in ovre) + min(p.y for p in ovre)) / 2
    zh = min(p.z for p in pts if p.y < cy - 0.04)          # hakan
    return {"topp": zt, "haka": zh, "H": zt - zh, "cy": cy,
            "C": Vector((0, cy, (zt + zh) / 2)), "pts": pts}


def bygg_har_och_skagg(K, kol, M):
    hm = huvud_matt(K)
    C, H, zh = hm["C"], hm["H"], hm["haka"]

    def vinkel(c):
        return abs(math.degrees(math.atan2(c.x, -(c.y - C.y))))

    def rel(c):
        return (c.z - zh) / H                                 # 0 = haka, 1 = hjässa

    def fin_har(c):
        h, v = rel(c), vinkel(c)
        if v < 62:
            return h > 0.80                                   # pannan upp mot hårfästet
        if v < 100:
            return h > 0.56                                   # tinningar
        return h > 0.22                                       # bakhuvud och nacke

    def har_off(v):
        h = rel(v.co)
        lugg = 0.5 + 0.5 * math.sin(math.atan2(v.co.x, -(v.co.y - C.y)) * 11.0)
        return 0.007 + 0.006 * max(0.0, 0.75 - h) + 0.003 * lugg * max(0.0, 0.8 - h)

    har = nytt_lager(K, f"SM_{P}_Har", lambda f, typ: typ == "huvud", har_off, [M["har"]], kol=kol,
                     dela=1, finmask=lambda c: fin_har(c), jamna_kant=4)

    def fin_skagg(c):
        h, v = rel(c), vinkel(c)
        if v > 100:
            return False
        if h < 0.0:
            return c.y < C.y - 0.02 and c.z > zh - 0.035       # under hakan
        if v < 18 and 0.13 < h < 0.24:
            return False                                      # munnen
        if h < 0.17:
            return True                                       # haka
        return v > 52 and h < 0.46                            # käklinje upp mot polisongerna

    def skagg_off(v):
        h = rel(v.co)
        haka = math.exp(-((v.co.x / 0.04) ** 2 + ((h - 0.04) / 0.12) ** 2))
        return 0.005 + 0.004 * max(0.0, 0.45 - h) / 0.45 + 0.009 * haka

    skagg = nytt_lager(K, f"SM_{P}_Skagg", lambda f, typ: typ in ("huvud", "hals"), skagg_off, [M["har"]],
                       kol=kol, dela=1, finmask=lambda c: fin_skagg(c), jamna_kant=4)

    # mustasch och ögonbryn – läggs på ansiktets yta med strålar
    def yta(x, z, ut=0.0):
        h, n = stral(K.bvh, (x, C.y - 0.5, z), (0, 1, 0))
        return (h + Vector((0, -ut, 0))) if h else Vector((x, C.y - 0.12, z))

    bm = bmesh.new()
    zm = zh + 0.255 * H
    for sx in (-1, 1):
        pts = [yta(sx * x, zm - 2.2 * x * x - (0.0 if x < 0.02 else 0.8 * (x - 0.02)), 0.004)
               for x in (0.002, 0.012, 0.021, 0.029, 0.035)]
        ror(bm, pts, [0.0058, 0.0066, 0.006, 0.0048, 0.0034], 6, platt=0.7)
        zb = zh + 0.635 * H
        bryn = [yta(sx * x, zb + 0.25 * x - 3.0 * x * x, 0.003) for x in (0.012, 0.024, 0.036, 0.048, 0.058)]
        ror(bm, bryn, [0.0040, 0.0050, 0.0048, 0.0040, 0.0028], 6, platt=0.55)
    mb = nytt_objekt(f"SM_{P}_Mustasch_Bryn", bm, kol, K.rig, [M["har"]])
    return [har, skagg, mb], hm


# =============================================================== formade delar
def bygg_kjol(K, kol, M):
    bvh = K.bvh
    seg = 32
    z0, z1 = BALTE_Z - 0.035, FALL_Z + 0.01
    hojder = [z0 + (z1 - z0) * t for t in (0.0, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0)]
    cy = L["cy"]
    rad = {}
    for k in range(seg):
        a = 2 * math.pi * k / seg
        d = Vector((math.cos(a), math.sin(a), 0))
        for z in hojder:
            hit, _ = stral(bvh, Vector((0, cy, z)) + d * 0.30 * L["s"], -d)
            rad[(k, z)] = (hit - Vector((0, cy, z))).length if hit else 0.17
    bm = bmesh.new()
    ringar = []
    for z in hojder:
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            r = max(rad[(k, zz)] for zz in hojder if zz >= z) + 0.016 + 0.05 * (z0 - z)
            ring.append(bm.verts.new((r * math.cos(a), cy + r * math.sin(a), z)))
        ringar.append(ring)
    for i in range(len(ringar) - 1):
        for k in range(seg):
            bm.faces.new((ringar[i][k], ringar[i][(k + 1) % seg], ringar[i + 1][(k + 1) % seg], ringar[i + 1][k]))
    o = nytt_objekt(f"SM_{P}_Vaddering_Kjol", bm, kol, K.rig, [M["vadd"], M["ladermork"]])
    solidify(o, 0.008, offset=1.0)
    me = o.data
    attr = me.attributes.new("QUILT", "FLOAT_VECTOR", "POINT")
    for v in me.vertices:
        attr.data[v.index].vector = (math.atan2(v.co.y, v.co.x) * 0.18, v.co.z, 0.0)
    satt_material_per_yta(o, lambda c, n: 1 if c.z < z1 + 0.01 else 0)
    return o




def bygg_tabard(K, kol, M, stod):
    bvh = bvh_av(stod)
    sk = L["s"]
    TOPP = L["nyckel"] - 0.008
    cy = L["cy"]

    def bredd(z):
        pk = [(TOPP, 0.150 * sk), (TOPP - 0.095 * sk, 0.176 * sk), (BALTE_Z + 0.105 * sk, 0.168 * sk),
              (BALTE_Z, 0.160 * sk), (L["hoft"] + 0.015, 0.176 * sk), (FALL_Z - 0.02, 0.188 * sk)]
        for (z0, w0), (z1, w1) in zip(pk, pk[1:]):
            if z1 <= z <= z0:
                return w0 + (w1 - w0) * (z - z0) / (z1 - z0)
        return pk[-1][1] if z < pk[-1][0] else pk[0][1]

    rader = [TOPP - i * 0.032 for i in range(int((TOPP - (FALL_Z + 0.02)) / 0.032) + 1)]
    rader = [z for z in rader if z > FALL_Z + 0.022] + [FALL_Z + 0.022, FALL_Z]
    u_lista = [-1.0, -0.94] + [-0.9 + 1.8 * i / 14 for i in range(15)] + [0.94, 1.0]
    ZB = L["axel"] - 0.12 * sk

    def yy(xs, z, sida):
        h, _ = stral(bvh, (xs, cy + sida * 0.6, z), (0, -sida, 0))
        return h.y if h else cy + sida * 0.14

    alla = []
    for sida in (-1, 1):
        bm = bmesh.new()
        grid = []
        for z in rader:
            W = bredd(z)
            rad = []
            for u in u_lista:
                x = u * W
                xs = max(-0.15 * sk, min(0.15 * sk, x))
                if z > ZB:
                    ybas = yy(xs, z, sida)
                elif z > BALTE_Z:                          # tyget faller rakt från bröstet till bältet
                    t = (ZB - z) / (ZB - BALTE_Z)
                    ybas = yy(xs, ZB, sida) * (1 - t) + yy(xs, BALTE_Z, sida) * t
                else:
                    ybas = yy(xs, max(z, FALL_Z + 0.025), sida)
                gap = 0.014 if z > TOPP - 0.055 else (0.011 if z > BALTE_Z else 0.017)
                y = ybas + sida * gap
                y -= sida * 0.008 * max(0.0, abs(u) - 0.7) / 0.3
                if z < BALTE_Z:
                    y += sida * 0.02 * (BALTE_Z - z)
                    amp = 0.0045 * min(1.0, (BALTE_Z - z) / 0.12)
                    y += sida * amp * math.sin(2 * math.pi * x / 0.05 + (0.7 if sida > 0 else 0))
                if z < BALTE_Z + 0.01:                     # aldrig innanför kjolen (även mellan rutorna)
                    for dx, dz in ((0, 0), (0.012, 0), (-0.012, 0), (0, 0.016), (0, -0.016)):
                        h, _ = stral(bvh, (x + dx, cy + sida * 0.6, z + dz), (0, -sida, 0))
                        if h is not None and (y - h.y) * sida < 0.013:
                            y = h.y + sida * 0.013
                zz = z
                if z <= FALL_Z + 0.001:
                    zz = z + 0.006 * math.sin(x * 23.0 + sida) - 0.004 * (1 - abs(u))
                rad.append(bm.verts.new((x, y, zz)))
            grid.append(rad)
        for i in range(len(grid) - 1):
            for k in range(len(u_lista) - 1):
                bm.faces.new((grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]))
        namn = f"SM_{P}_Tabard_" + ("Fram" if sida < 0 else "Bak")
        o = nytt_objekt(namn, bm, kol, K.rig, [M["vit"], M["bla"], M["guld"], M["ladermork"]])

        def klass(c, n, sida=sida):
            if c.z < FALL_Z + 0.021:
                return 2
            if abs(c.x) > 0.94 * bredd(c.z):
                return 3
            vit = (c.x < 0) if sida < 0 else (c.x > 0)
            return 0 if vit else 1

        satt_material_per_yta(o, klass)
        solidify(o, 0.005, offset=1.0 if sida < 0 else -1.0)
        alla.append(o)
    return alla


def bygg_emblem(K, kol, M, tabard_fram):
    bvh = bvh_av([tabard_fram])
    mitt0 = Vector((-0.06 * L["s"], 0.0, L["nyckel"] - 0.14 * L["s"]))
    delar = []
    for namn, utv, lyft, mat in ((f"SM_{P}_Emblem_Kontur", 0.0042, 0.0022, M["ladermork"]),
                                 (f"SM_{P}_Emblem", 0.0, 0.0042, M["guld"])):
        bm = bmesh.new()
        for v in (math.radians(38), math.radians(-38)):
            nyckel_former(bm, mitt0, v, 1.12 * L["s"], utv)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0002)
        bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if e.calc_length() > 0.02], cuts=2, use_grid_fill=True)
        for v in bm.verts:
            h, n = stral(bvh, (v.co.x, -0.6, v.co.z), (0, 1, 0))
            if h:
                v.co = h + Vector((0, -lyft, 0))
        o = nytt_objekt(namn, bm, kol, K.rig, [mat], slat=False)
        solidify(o, 0.0012, offset=1.0)
        delar.append(o)
    return delar


def bygg_balte_vaska(K, kol, M, stod, tabard_fram):
    bvh = bvh_av(stod)
    seg, H, T = 40, 0.046, 0.011
    C0 = Vector((0, L["cy"], BALTE_Z))
    bm = bmesh.new()
    ringar = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        d = Vector((math.cos(a), math.sin(a), 0))
        start, r = C0.copy(), 0.17
        for _ in range(6):
            hit, _n = stral(bvh, start + d * 0.0005, d)
            if not hit or (hit - C0).length > 0.28 * L["s"]:
                break
            r = (hit - C0).length
            start = hit
        ri, ro = r + 0.002, r + 0.002 + T
        ringar.append([bm.verts.new(C0 + d * ri + Vector((0, 0, H / 2))),
                       bm.verts.new(C0 + d * ro + Vector((0, 0, H / 2 - 0.002))),
                       bm.verts.new(C0 + d * ro + Vector((0, 0, -H / 2 + 0.002))),
                       bm.verts.new(C0 + d * ri + Vector((0, 0, -H / 2)))])
    for k in range(seg):
        a, b = ringar[k], ringar[(k + 1) % seg]
        for j in range(4):
            bm.faces.new((a[j], b[j], b[(j + 1) % 4], a[(j + 1) % 4]))
    balte = nytt_objekt(f"SM_{P}_Balte", bm, kol, K.rig, [M["ladermork"]])
    skarpa_kanter(balte, 50)

    bvh2 = bvh_av([balte])
    hit, _ = stral(bvh2, (0.05, -0.6, BALTE_Z), (0, 1, 0))
    c = hit + Vector((0, -0.003, 0))
    bm = bmesh.new()
    yt, inr, dj = 0.031, 0.02, 0.008
    lag = []
    for dy in (0.0, -dj):
        lag.append([bm.verts.new(c + Vector((x, dy, z))) for (x, z) in ((-yt, -yt), (yt, -yt), (yt, yt), (-yt, yt))] +
                   [bm.verts.new(c + Vector((x, dy, z))) for (x, z) in ((-inr, -inr), (inr, -inr), (inr, inr), (-inr, inr))])
    fr, bk = lag[1], lag[0]
    for LL, rev in ((fr, False), (bk, True)):
        for k in range(4):
            f = (LL[k], LL[(k + 1) % 4], LL[4 + (k + 1) % 4], LL[4 + k])
            bm.faces.new(tuple(reversed(f)) if rev else f)
    for off in (0, 4):
        for k in range(4):
            a, b = fr[off + k], fr[off + (k + 1) % 4]
            a2, b2 = bk[off + k], bk[off + (k + 1) % 4]
            bm.faces.new((a, a2, b2, b) if off == 0 else (a, b, b2, a2))
    tv = [bm.verts.new(c + Vector((x, -dj - 0.001, z))) for (x, z) in ((-0.0025, -inr), (0.0025, -inr), (0.0025, inr), (-0.0025, inr))]
    bm.faces.new(tv)
    spanne = nytt_objekt(f"SM_{P}_Baltesspanne", bm, kol, K.rig, [M["massing"]], slat=False)
    bm = bmesh.new()
    lc = c + Vector((0.046, -0.004, 0))
    v = [bm.verts.new(lc + Vector((x, 0, z))) for (x, z) in ((-0.03, -0.019), (0.03, -0.019), (0.035, 0.0), (0.03, 0.019), (-0.03, 0.019))]
    bm.faces.new(v)
    ande = nytt_objekt(f"SM_{P}_Balte_Ande", bm, kol, K.rig, [M["ladermork"]], slat=False)
    solidify(ande, 0.005, offset=1.0)

    # läderväska på höger höft (karaktärens höger = -X)
    bvh3 = bvh_av([tabard_fram])
    X, Ztopp = -0.125 * L["s"], BALTE_Z - 0.006
    hit, nrm = stral(bvh3, (X, -0.6, Ztopp - 0.05), (0, 1, 0))
    bak_y = (hit.y if hit else -0.17) - 0.004
    vinkel = math.atan2(nrm.x, -nrm.y) if nrm else 0.0
    w, h, d = 0.15 * L["s"], 0.12 * L["s"], 0.05 * L["s"]
    rotm = Matrix.Translation(Vector((X, bak_y - d / 2, Ztopp - h / 2))) @ Matrix.Rotation(-vinkel, 4, "Z")

    def lada(namn, cx, cz, bw, bh, bd, cy=0.0, mat=None, avf=0.01):
        b = bmesh.new()
        bmesh.ops.create_cube(b, size=1.0)
        bmesh.ops.scale(b, vec=(bw, bd, bh), verts=b.verts)
        bmesh.ops.translate(b, vec=(cx, cy, cz), verts=b.verts)
        bmesh.ops.transform(b, matrix=rotm, verts=b.verts)
        o = nytt_objekt(namn, b, kol, K.rig, [mat or M["lader"]])
        avfasa(o, avf, 2, 30)
        return o

    vaska = [lada(f"SM_{P}_Vaska", 0, 0, w, h, d, avf=0.014),
             lada(f"SM_{P}_Vaska_Lock", 0, h * 0.2, w + 0.008, h * 0.62, 0.008, cy=-d / 2 - 0.003, avf=0.0035),
             lada(f"SM_{P}_Vaska_Rem", 0, -h * 0.05, 0.018, h * 0.42, 0.004, cy=-d / 2 - 0.0085, mat=M["ladermork"], avf=0.0015)]
    b = bmesh.new()
    bmesh.ops.create_uvsphere(b, u_segments=10, v_segments=6, radius=0.0085)
    bmesh.ops.scale(b, vec=(1.0, 0.55, 1.0), verts=b.verts)
    bmesh.ops.translate(b, vec=(0, -d / 2 - 0.011, -h * 0.17), verts=b.verts)
    bmesh.ops.transform(b, matrix=rotm, verts=b.verts)
    vaska.append(nytt_objekt(f"SM_{P}_Vaska_Knapp", b, kol, K.rig, [M["massing"]]))
    return [balte, spanne, ande] + vaska


def bygg_hjalm(K, kol, M, hm):
    """Kettle hat anpassad efter huvudets verkliga mått (+ hår)."""
    zb = hm["topp"] - 0.078                          # där kupan möter brättet
    nara = [p for p in hm["pts"] if abs(p.z - zb) < 0.025]
    rx = max(abs(p.x) for p in nara) + 0.026
    ry = max(abs(p.y - hm["cy"]) for p in nara) + 0.026
    kv = ry / rx
    yc = hm["cy"] + 0.004
    # profil i enheter av rx: kupa (rundad med svag spets) + sluttande brätte
    profil = [(0.0, 1.30), (0.25, 1.27), (0.48, 1.18), (0.68, 1.02), (0.84, 0.80), (0.95, 0.53),
              (1.0, 0.25), (1.01, 0.08), (1.01, 0.0),
              (1.17, -0.07), (1.37, -0.17), (1.57, -0.30), (1.72, -0.40), (1.82, -0.47), (1.86, -0.51)]
    profil = [(r * rx, z * rx) for r, z in profil]
    sommar = [0.0, math.pi / 2, math.pi, 1.5 * math.pi]

    def form(a, z):
        f = 1.0
        if z > 0.02:
            for s0 in sommar:
                da = math.atan2(math.sin(a - s0), math.cos(a - s0))
                f += 0.02 * math.exp(-(da / 0.05) ** 2)
        if -0.001 < z < 0.022:
            f += 0.018
        return f

    bm = bmesh.new()
    ringar = lathe(bm, profil, 36, rx=1.0, ry=kv, radiefunk=form, matris=Matrix.Translation((0, yc, zb)))
    hj = nytt_objekt(f"SM_{P}_Hjalm", bm, kol, K.rig, [M["jarn"]])
    solidify(hj, 0.0045, offset=-1.0)
    skarpa_kanter(hj, 60)
    # förstärkt, rullad ytterkant
    bm = bmesh.new()
    r_kant, z_kant = profil[-1]
    pts = [Vector((r_kant * math.cos(2 * math.pi * k / 48), yc + r_kant * kv * math.sin(2 * math.pi * k / 48),
                   zb + z_kant - 0.002)) for k in range(49)]
    ror(bm, pts, [0.0055] * len(pts), 8)
    kant = nytt_objekt(f"SM_{P}_Hjalm_Kant", bm, kol, K.rig, [M["jarn"]])
    # nitar runt bandet
    bm = bmesh.new()
    for k in range(16):
        a = 2 * math.pi * (k + 0.5) / 16
        r = profil[8][0] * 1.018 + 0.001
        p = Vector((r * math.cos(a), yc + r * kv * math.sin(a), zb + 0.011))
        n = Vector((math.cos(a), math.sin(a) / kv, 0)).normalized()
        vv = bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=3, radius=0.0055)["verts"]
        bmesh.ops.transform(bm, matrix=axel_matris(p, n) @ Matrix.Diagonal((1, 1, 0.55, 1)), verts=vv)
    nitar = nytt_objekt(f"SM_{P}_Hjalm_Nitar", bm, kol, K.rig, [M["jarn"]])
    # snörning (kryss) längs sömmarna
    bm = bmesh.new()
    for s0 in sommar:
        for zr in (0.30, 0.62, 0.93):
            zh_ = zr * rx
            r = rx
            for (r0, z0), (r1, z1) in zip(profil[:9], profil[1:9]):
                if z1 <= zh_ <= z0:
                    r = r0 + (r1 - r0) * (zh_ - z0) / (z1 - z0)
            r *= 1.02
            p = Vector((r * math.cos(s0), yc + r * kv * math.sin(s0), zb + zh_))
            n = Vector((math.cos(s0), math.sin(s0) / kv, 0.3)).normalized()
            tang = Vector((-math.sin(s0), math.cos(s0), 0)).normalized()
            upp = n.cross(tang).normalized()
            for vrid in (1, -1):
                a = (tang + upp * vrid).normalized() * 0.012
                b = n.cross(a).normalized() * 0.0024
                c0 = p + n * 0.0012
                bm.faces.new([bm.verts.new(c0 - a - b), bm.verts.new(c0 + a - b), bm.verts.new(c0 + a + b), bm.verts.new(c0 - a + b)])
    snore = nytt_objekt(f"SM_{P}_Hjalm_Snorning", bm, kol, K.rig, [M["lader"]], slat=False)
    solidify(snore, 0.0015, offset=1.0)
    R.append(f"Hjälm: kupa rx {rx:.3f} / ry {ry:.3f} m, fäste z {zb:.3f}, topp z {zb + profil[0][1] + 0.0045:.3f}")
    return [hj, kant, nitar, snore]


# =============================================================== huvudprogram
def kroppsdel_for(o):
    n = o.name
    if any(k in n for k in ("Hjalm", "Har", "Skagg", "Mustasch")):
        return "huvud"
    if n.endswith("_V") and "Axelskydd" in n:
        return "arm_v"
    if n.endswith("_H") and "Axelskydd" in n:
        return "arm_h"
    if any(k in n for k in ("Handskar", "Manschetter", "Vaddering")) and "Kjol" not in n:
        return "flera (vikter)"
    if any(k in n for k in ("Stovlar", "Hosor")):
        return "ben (vikter)"
    return "torso"


def trianglar(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def kor():
    random.seed(7)
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    rig, kropp = hitta_bas()
    sakerhetskopia()
    analys(rig, kropp)
    arkivera_procedurell()
    arkivera_basmodell1()
    borttagna = rensa()
    till_origo(kropp)
    kol = samlingar()
    M = skapa_material()
    landmarken(rig, kropp)
    K = Kropp(kropp, rig, None)

    delar = []
    vadd = bygg_vaddering(K, kol, M)
    delar += [vadd, bygg_hosor(K, kol, M), bygg_stovlar(K, kol, M)]
    delar += bygg_handskar(K, kol, M)
    delar.append(bygg_ringbrynja(K, kol, M, vadd))
    delar += bygg_axelskydd(K, kol, M, vadd)
    hm = huvud_matt(K)
    kjol = bygg_kjol(K, kol, M)
    delar.append(kjol)
    tab = bygg_tabard(K, kol, M, [vadd, kjol])
    delar += tab
    delar += bygg_emblem(K, kol, M, tab[0])
    delar += bygg_balte_vaska(K, kol, M, [kjol] + tab, tab[0])
    delar += bygg_hjalm(K, kol, M, hm)
    delar = [o for o in delar if o]
    for o in delar:
        o["kroppsdel"] = kroppsdel_for(o)

    bas = [o for o in rig.children if o.type == "MESH" and not o.get(TAGG)] + \
          [o for o in bpy.data.objects if o.type == "MESH" and o.parent == rig.parent and o != kropp
           and not o.get(TAGG) and any(m.type == "ARMATURE" and m.object == rig for m in o.modifiers)]
    bas = list(dict.fromkeys([kropp] + bas))
    tot = 0
    rader = []
    for o in bas:
        t = trianglar(o)
        tot += t
        rader.append(f"  {o.name:34s} {t:6d}   [basmodell]")
    for o in sorted(delar, key=lambda o: -trianglar(o)):
        t = trianglar(o)
        tot += t
        rader.append(f"  {o.name:34s} {t:6d}   [{o['kroppsdel']}]")
    utr = sum(trianglar(o) for o in delar)
    mats = {m.name for o in delar for m in o.data.materials if m}
    hojd = max((o.matrix_world @ Vector(c)).z for o in delar for c in o.bound_box)
    text = [f"STADSVAKT {VERSION}"] + R + [
        f"Borttaget från tidigare körning: {borttagna} objekt",
        f"Nya delar: {len(delar)}   utrustningens material: {len(mats)}   höjd med hjälm (världen): {hojd:.3f} m",
        f"Trianglar: utrustning {utr}, basmodell {tot - utr}, totalt {tot}"] + rader
    print("\n".join(text))
    return "\n".join(text)


if __name__ == "__main__":
    resultat_text = kor()
