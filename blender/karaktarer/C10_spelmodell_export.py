"""
C10_spelmodell_export.py  –  Brawl med Boysen: SPELMODELL FÖR EN RUSTNING (generell)
==================================================================================
Gör en karaktär från Blender spelbar. Klistra in i Scripting-fliken och kör
(stadsvakt.blend eller en annan karaktärsfil med samma basmodell och rigg).

Ändra bara KONFIG nedan för nästa karaktär (en per rustning i lobbyn).

Vad skriptet gör (originalobjekten ändras aldrig – allt görs på kopior)
  1. Kopierar kropp, ögon och all utrustning (tänderna hoppas över).
  2. Ger delar utan vikter vikter: stela kjolar/tabarder följer bäcken och lår
     (som riddarnas kjolar), bälte och väska följer bålen, övrigt får vikter
     från närmaste kroppshörn. Hjälmen blir en egen stel del.
  3. Poserar riggen (Auto-Rig Pro, FK) så att armarna hänger rakt ned – samma
     grundställning som riddarna i spelet – och "bakar" posen.
  4. Flyttar över vikterna från riggens 130+ ben till spelets 15 kroppsdelar
     (pelvis, torso, head, upperArm/forearm/hand L/R, thigh/shin/foot L/R).
  5. Anpassar modellen till riddarens skelett: benen till spelets fasta
     benlängder (fot-IK), armarnas/bålens mått sparas som "byggnad" som
     spelet använder för just den här rustningen.
  6. Tar bort dold yta (hud under kläder, vaddering under tabard …) och bantar
     till trianglarna i KONFIG.
  7. Delar modellen i sömmar mellan kroppsdelarna (för avhuggning) med
     bibehållna mjuka normaler, och sparar kroppsdelen per hörn (_REGION).
  8. Enkla spelmaterial (färg/roughness/metallic per material, lagfärg märkt).
  9. Exporterar <ut>.glb: en skinnad kropp + en stel hjälm + spelskelettet,
     plus mått i "extras".

Exporten hamnar i samlingen COL_Spelexport_<nyckel> (dold) för granskning.
Kan köras om – den gamla exporten tas bort först.  Testat i Blender 5.3.
"""

import bpy
import bmesh
import json
import math
import os
import time
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

# =============================================================== KONFIG (per rustning)
KONFIG = {
    "nyckel": "guard",                 # rustningens nyckel i spelet (KIT_STYLES i kit.js)
    "namn": "Stadsvakt",
    "samling": "COL_Char_Stadsvakt",   # utrustningen
    "rigg": "rig",
    "kropp": "body",
    "extra": ["Eye_Left", "Eye_Right"],  # följer med (huvud)
    "hoppa_over": ["Teeth"],           # namn som innehåller detta tas inte med
    "hjalm": ["Hjalm"],                # stela delar på huvudet som kan slås av
    "kjol": ["Tabard", "Kjol"],        # hänger från höften och följer låren
    "axel": ["Axelskydd", "Axelband", "Axelrem"],  # följer överarmen nästan helt (sträcks inte isär)
    "bal": ["Balte", "Vaska", "Emblem", "Ringbrynja"],   # följer bara bål/bäcken
    # dold yta: inre lager → yttre lager som täcker dem (namn innehåller …)
    "dold_yta": {
        "body": ["Vaddering", "Hosor", "Stovlar", "Handskar", "Tabard", "Kjol", "Ringbrynja",
                 "Har", "Skagg", "Hjalm_Foder", "Axelskydd", "Manschetter"],
        "Vaddering": ["Tabard", "Ringbrynja", "Axelskydd", "Manschetter"],
        "Hosor": ["Stovlar", "Kjol", "Tabard"],
        "Vaddering_Kjol": ["Tabard"],
    },
    "huvud_skala": 1.06,
    # anatomi i spelet (skelettet är spelets; bara modellens form anpassas)
    "axelbredd": 1.05,                 # bredare axlar/övre bröstkorg (atletisk), armarna följer med
    "hoft_behall": True,               # benen behåller modellens höftbredd (trycks inte ihop till spelets 0,10 m)
    "kna_hojd": 0.515,                 # var modellens knä hamnar (spelets knäled 0,50) – fördelar sträckningen
    "dekaler": ["Emblem"],             # tunna delar som ligger på tyget: ytan under dem bantas inte (annars sjunker de in)
    "ej_bantning": ["Axelskydd", "Axelband", "Hjalm", "Stovlar", "Manschetter"],  # handbyggda lågpolydelar      # hjälmen: bantning flyttar kupans yta över skarvbanden   # rundade delar som inte bantas (blir kantiga annars)               # lite större huvud (som riddarna), runt nacken
    "hjalm_flytt": (0.0, 0.0, 0.0),     # (C06 placerar hjälmen rätt på huvudet)
    "hjalm_kupa": 1.0,                # kupans storlek (måste rymma huvudet)
    "hjalm_bratte": 1.0,               # hur långt brättet når utanför kupan (1 = som i Blender)  # hjälmen djupare ned på huvudet (Blender: y bakåt, z upp)
    "baka": True,                      # baka alla material till en gemensam textur (färg, roughness,
    "atlas": 2048,                     #   metallic, normal map och skuggning i vecken)
    "kropp_tris": 7000,                # kroppen efter bantning
    "mal_tris": 19000,                 # hela modellen (kropp + utrustning + hjälm)
    "lagfarg": ["Tyg_Bla", "Malad_Bla"],            # material som tar spelarens färg
    # spelmaterial: namn innehåller → (färg, roughness, metallic)
    "material": [
        ("Malad_Vit", "#ddd3bd", 0.45, 0.0), ("Malad_Bla", "#2b4aa0", 0.45, 0.0),
        ("Tyg_Vit", "#ddd2bb", 0.9, 0.0), ("Tyg_Bla", "#2b4aa0", 0.9, 0.0),
        ("Tyg_Guld", "#c99a36", 0.6, 0.3), ("Vaddering", "#4a3324", 0.92, 0.0),
        ("Ringbrynja", "#5a5c60", 0.5, 0.85), ("Hjalm", "#6e665e", 0.55, 0.8),
        ("Metall", "#6e665e", 0.55, 0.8), ("Massing", "#b08d45", 0.35, 0.9),
        ("Lader_Snore", "#8e3f2a", 0.65, 0.0), ("Lader_Mork", "#3f2818", 0.7, 0.0),
        ("Lader", "#6f4629", 0.65, 0.0), ("Har", "#5c3d26", 0.75, 0.0),
        ("Sula", "#2c1b10", 0.8, 0.0),
    ],
    "ut": "export/rustningar/guard.glb",   # relativt .blend-filens mapp
}

# =============================================================== spelets skelett (från knight.js)
BEN = ["pelvis", "torso", "head", "upperArmL", "forearmL", "handL", "upperArmR", "forearmR", "handR",
       "thighL", "shinL", "footL", "thighR", "shinR", "footR"]
FORALDER = {"pelvis": None, "torso": "pelvis", "head": "torso",
            "upperArmL": "torso", "forearmL": "upperArmL", "handL": "forearmL",
            "upperArmR": "torso", "forearmR": "upperArmR", "handR": "forearmR",
            "thighL": "pelvis", "shinL": "thighL", "footL": "shinL",
            "thighR": "pelvis", "shinR": "thighR", "footR": "shinR"}
# Riddarens fasta ben (fot-IK i ik.js räknar med dem): höft ±0,1 / 0,92, knä 0,50, fotled 0,10
HOFT_X, HOFT_Z, KNA_Z, VRIST_Z = 0.10, 0.92, 0.50, 0.10
BAKEN_Z = 1.0

R = []


# =============================================================== hjälp
def har(namn, lista):
    return any(k in namn for k in lista)


def ARP_till_spel(g):
    """ARP-gruppnamn → [(spelben, andel)]."""
    n = g.lower()
    s = "L" if n.endswith(".l") else ("R" if n.endswith(".r") else "")
    huvud = ("head", "jaw", "c_lips", "c_teeth", "tong", "c_chin", "c_nose", "c_eye", "c_cheek", "c_ear")
    if n.startswith(huvud):
        return [("head", 1.0)]
    if n.startswith("neck"):
        return [("head", 0.55), ("torso", 0.45)]
    if n.startswith("root"):
        return [("pelvis", 1.0)]
    if n.startswith("spine_01"):
        return [("pelvis", 0.55), ("torso", 0.45)]
    if n.startswith("spine"):
        return [("torso", 1.0)]
    if n.startswith("shoulder") or n.startswith("clavicle"):
        return [("torso", 1.0)]
    if not s:
        return []
    if "forearm" in n:
        return [("forearm" + s, 1.0)]
    if n.startswith(("c_arm_twist", "arm_")):
        return [("upperArm" + s, 1.0)]
    fingrar = ("hand", "c_pinky", "pinky", "c_ring", "ring", "c_middle", "middle",
               "c_index", "index", "thumb", "c_thumb")
    if n.startswith(fingrar):
        return [("hand" + s, 1.0)]
    if n.startswith("thigh"):
        return [("thigh" + s, 1.0)]
    if n.startswith("leg_"):
        return [("shin" + s, 1.0)]
    if n.startswith(("foot", "toes")):
        return [("foot" + s, 1.0)]
    return []


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def normera(w, maxn=4):
    topp = sorted(((k, v) for k, v in w.items() if v > 1e-4), key=lambda x: -x[1])[:maxn]
    tot = sum(v for _, v in topp) or 1.0
    return {k: v / tot for k, v in topp}


def tris_me(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


def ta_bort_samling(namn):
    kol = bpy.data.collections.get(namn)
    if not kol:
        return
    for o in list(kol.objects):
        d = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if d and d.users == 0:
            if isinstance(d, bpy.types.Mesh):
                bpy.data.meshes.remove(d)
            elif isinstance(d, bpy.types.Armature):
                bpy.data.armatures.remove(d)
    bpy.data.collections.remove(kol)


# =============================================================== 1. pose: armarna rakt ned (ARP FK)
def varld(rig, ben):
    return rig.matrix_world @ rig.pose.bones[ben].head


def posera_armar(rig):
    pb = rig.pose.bones
    sparat = {}
    for s in ("l", "r"):
        ik = pb.get(f"c_hand_ik.{s}")
        arm = pb.get(f"c_arm_fk.{s}")
        fore = pb.get(f"c_forearm_fk.{s}")
        if not (ik and arm and fore):
            R.append(f"  (hittar inte ARP-armens FK-ben på sida {s} – armarna poseras inte)")
            continue
        sparat[s] = (ik.get("ik_fk_switch", 0.0), arm.rotation_mode, arm.rotation_euler.copy(),
                     fore.rotation_mode, fore.rotation_euler.copy())
        ik["ik_fk_switch"] = 1.0
        arm.rotation_mode = "XYZ"
        fore.rotation_mode = "XYZ"
        S, E, W = f"c_arm_twist_offset.{s}", f"forearm_stretch.{s}", f"hand.{s}"

        def fel():
            bpy.context.view_layer.update()
            a, e, w = varld(rig, S), varld(rig, E), varld(rig, W)
            d1 = e - a
            d2 = w - e
            return d1.x ** 2 + d1.y ** 2 + 0.6 * (d2.x ** 2 + d2.y ** 2)

        for ben in (arm, fore, arm, fore):
            steg = math.radians(10)
            while steg > math.radians(0.3):
                for ax in (0, 2):
                    bast = fel()
                    for t in (1, -1):
                        e = ben.rotation_euler.copy()
                        e[ax] += t * steg
                        gammal = ben.rotation_euler.copy()
                        ben.rotation_euler = e
                        if fel() < bast - 1e-9:
                            break
                        ben.rotation_euler = gammal
                steg *= 0.5
        # knuten hand runt ett grepp (som riddarnas): fingrarna böjs in mot handflatan
        fingrar = []
        for f, vinkel in (("index", -72), ("middle", -76), ("ring", -80), ("pinky", -84), ("thumb", -35)):
            for led in (1, 2, 3):
                b = pb.get(f"c_{f}{led}.{s}")
                if b is None or (f == "thumb" and led == 1):
                    continue
                fingrar.append((b, b.rotation_mode, b.rotation_euler.copy()))
                b.rotation_mode = "XYZ"
                b.rotation_euler = Euler((math.radians(vinkel), 0, 0))
        sparat[s] = sparat[s] + (fingrar,)
        bpy.context.view_layer.update()
        a, e, w = varld(rig, S), varld(rig, E), varld(rig, W)
        R.append(f"  arm {s}: överarm {math.degrees(math.atan2(Vector((e - a).xy).length, -(e - a).z)):.1f}° "
                 f"från lodrätt, underarm {math.degrees(math.atan2(Vector((w - e).xy).length, -(w - e).z)):.1f}°")
    bpy.context.view_layer.update()
    return sparat


def aterstall_pose(rig, sparat):
    pb = rig.pose.bones
    for s, (sw, m1, e1, m2, e2, fingrar) in sparat.items():
        for b, m, e in fingrar:
            b.rotation_euler = e
            b.rotation_mode = m
        pb[f"c_hand_ik.{s}"]["ik_fk_switch"] = sw
        pb[f"c_arm_fk.{s}"].rotation_euler = e1
        pb[f"c_arm_fk.{s}"].rotation_mode = m1
        pb[f"c_forearm_fk.{s}"].rotation_euler = e2
        pb[f"c_forearm_fk.{s}"].rotation_mode = m2
    bpy.context.view_layer.update()


# =============================================================== 2. kopior med vikter
class Kroppsvikter:
    """Kroppens hörn i vila (världen) med spelvikter – för stela delar."""

    def __init__(self, kropp):
        me = kropp.data
        mw = kropp.matrix_world
        gn = [g.name for g in kropp.vertex_groups]
        self.co, self.spel, self.arp = [], [], []
        for v in me.vertices:
            arp = {gn[g.group]: g.weight for g in v.groups if g.weight > 1e-4}
            sp = {}
            for n, w in arp.items():
                for b, a in ARP_till_spel(n):
                    sp[b] = sp.get(b, 0) + w * a
            self.co.append(mw @ v.co)
            self.arp.append(arp)
            self.spel.append(normera(sp, 15))
        self.kd = KDTree(len(self.co))
        for i, c in enumerate(self.co):
            self.kd.insert(c, i)
        self.kd.balance()

    def narmast(self, p, filt=None, n=6, arp=False):
        s = {}
        for c, i, d in self.kd.find_n(p, n * 4):
            if filt and not filt(self.spel[i]):
                continue
            w = 1.0 / max(d, 0.004) ** 2
            for k, v in (self.arp[i] if arp else self.spel[i]).items():
                s[k] = s.get(k, 0) + v * w
            n -= 1
            if n <= 0:
                break
        return s


def kopiera(o, kol):
    k = o.copy()
    k.data = o.data.copy()
    k.name = "EXP_" + o.name
    kol.objects.link(k)
    k.parent = None
    k.matrix_world = o.matrix_world.copy()
    return k


# =============================================================== 3. omriktning till riddarens skelett
def likform(Jm0, Jm1, Jk0, Jk1):
    """Avbildar modellens ben [Jm0→Jm1] på riddarens [Jk0→Jk1]: vridning + längd längs benet."""
    dm = (Jm1 - Jm0)
    dk = (Jk1 - Jk0)
    lm, lk = dm.length, dk.length
    dm.normalize()
    dk.normalize()
    rot = dm.rotation_difference(dk).to_matrix()
    s = lk / max(lm, 1e-6)

    def f(v):
        u = v - Jm0
        a = u.dot(dm)
        u2 = u + dm * a * (s - 1.0)
        return Jk0 + rot @ u2
    return f, rot


# =============================================================== 4. bakning till en gemensam textur
def lin_fran_hex(h):
    h = h.lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]


def baka_atlas(objs, K, mapp):
    """Bakar utrustningens procedurella material till EN textur (färg+skuggning, roughness/metallic,
    normal map). Kropp och ögon behåller sina bilder. Lagfärgens tyg bakas i gråskala så att spelet
    kan färga det. Resultat: 2 utrustningsmaterial i stället för ett per plagg."""
    import numpy as np
    sc = bpy.context.scene
    motor = sc.render.engine
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    stl = int(K.get("atlas", 2048))
    texmapp = os.path.join(mapp, "texturer")
    os.makedirs(texmapp, exist_ok=True)

    def har_bild(m):
        # färdiga bildmaterial (kropp, ögon) bakas inte – utom material märkta "baka" (t.ex. C11:s med BlenderKit-bilder)
        return m is not None and not m.get("baka") and m.node_tree is not None and \
            any(n.type == "TEX_IMAGE" and n.image for n in m.node_tree.nodes)

    # andra objekt syns inte vid bakningen (skuggningen ska bara komma från modellen själv)
    dolda = [o for o in bpy.context.view_layer.objects if o not in objs and not o.hide_render]
    for o in dolda:
        o.hide_render = True

    # arbetskopior av materialen (originalen rörs inte)
    original = {}
    kopia = {}
    for o in objs:
        for i, sl in enumerate(o.material_slots):
            m = sl.material
            if m is None:
                continue
            if m not in kopia:
                kopia[m] = m.copy()
                original[kopia[m]] = m
            o.data.materials[i] = kopia[m]

    # ny UV-karta "Atlas": bara utrustningens ytor packas (kroppens hud har egen bild)
    for o in objs:
        me = o.data
        uv = me.uv_layers.get("Atlas") or me.uv_layers.new(name="Atlas")
        me.uv_layers.active = uv
        uv.active_render = True
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    for o in objs:
        bm = bmesh.from_edit_mesh(o.data)
        for f in bm.faces:
            m = o.material_slots[f.material_index].material if f.material_index < len(o.material_slots) else None
            f.select = m is not None and not har_bild(m)
        bmesh.update_edit_mesh(o.data)
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    def bild(namn, data):
        img = bpy.data.images.get(namn)
        if img:
            bpy.data.images.remove(img)
        img = bpy.data.images.new(namn, stl, stl, alpha=False, float_buffer=False)
        img.colorspace_settings.name = "Non-Color" if data else "sRGB"
        return img

    attrapp = bpy.data.images.get("TMP_attrapp") or bpy.data.images.new("TMP_attrapp", 8, 8)
    mats = list(kopia.values())
    tmp = {}
    for m in mats:
        nt = m.node_tree
        t = nt.nodes.new("ShaderNodeTexImage")
        t.name = "TMP_BAKMAL"
        nt.nodes.active = t
        if har_bild(original[m]):
            t.image = attrapp                       # kroppens/ögonens bilder skrivs aldrig över
            tmp[m] = None
            continue
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        ut = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) \
            or next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if not bsdf or not ut:
            tmp[m] = None
            continue
        yta = ut.inputs["Surface"].links[0].from_socket if ut.inputs["Surface"].is_linked else None
        emit = nt.nodes.new("ShaderNodeEmission")
        emit.name = "TMP_EMIT"
        lag = har(original[m].name, K["lagfarg"])
        regel = next((r for r in K["material"] if r[0] in original[m].name), None)
        tmp[m] = {"t": t, "bsdf": bsdf, "ut": ut, "yta": yta, "emit": emit, "lag": lag,
                  "k": 0.85 / max(0.02, sum(c * w for c, w in zip(lin_fran_hex(regel[1]) if regel else (0.5, 0.5, 0.5),
                                                                      (0.2126, 0.7152, 0.0722))))}

    def koppla(kanal):
        for m, d in tmp.items():
            if d is None:
                continue
            nt = m.node_tree
            for l in list(d["emit"].inputs["Color"].links):
                nt.links.remove(l)
            ing = d["bsdf"].inputs[kanal]
            if kanal == "Base Color" and d["lag"]:
                bw = nt.nodes.get("TMP_BW") or nt.nodes.new("ShaderNodeRGBToBW")
                bw.name = "TMP_BW"
                mul = nt.nodes.get("TMP_MUL") or nt.nodes.new("ShaderNodeMath")
                mul.name = "TMP_MUL"
                mul.operation = "MULTIPLY"
                mul.use_clamp = True
                mul.inputs[1].default_value = d["k"]
                if ing.is_linked:
                    nt.links.new(ing.links[0].from_socket, bw.inputs[0])
                else:
                    bw.inputs[0].default_value = ing.default_value
                nt.links.new(bw.outputs[0], mul.inputs[0])
                nt.links.new(mul.outputs[0], d["emit"].inputs["Color"])
            elif ing.is_linked:
                nt.links.new(ing.links[0].from_socket, d["emit"].inputs["Color"])
            else:
                v = ing.default_value
                d["emit"].inputs["Color"].default_value = tuple(v) if hasattr(v, "__len__") else (v, v, v, 1.0)
            nt.links.new(d["emit"].outputs[0], d["ut"].inputs["Surface"])

    def aterkoppla():
        for m, d in tmp.items():
            if d and d["yta"]:
                m.node_tree.links.new(d["yta"], d["ut"].inputs["Surface"])

    def satt_mal(img):
        for m, d in tmp.items():
            if d:
                d["t"].image = img

    bilder = {}
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = True
    try:
        for kanal, nyckel, data in (("Base Color", "C", False), ("Roughness", "R", True), ("Metallic", "M", True)):
            img = bild(f"T_{K['nyckel']}_{nyckel}", data)
            satt_mal(img)
            koppla(kanal)
            sc.cycles.samples = 4                   # kantutjämning (fina mönster som ringbrynjan)
            bpy.ops.object.bake(type="EMIT")
            bilder[nyckel] = img
        aterkoppla()
        img = bild(f"T_{K['nyckel']}_N", True)
        satt_mal(img)
        sc.cycles.samples = 4
        sc.render.bake.normal_space = "TANGENT"
        bpy.ops.object.bake(type="NORMAL")
        bilder["N"] = img
        img = bild(f"T_{K['nyckel']}_AO", True)
        satt_mal(img)
        sc.cycles.samples = 24
        ls = sc.world.light_settings if sc.world else None
        gammal_dist = ls.distance if ls else None
        if ls:
            ls.distance = 0.035                    # bara veck och överlapp (3,5 cm), inte hela kroppen
        bpy.ops.object.bake(type="AO")
        if ls:
            ls.distance = gammal_dist
        bilder["AO"] = img
    finally:
        aterkoppla()
        for m, d in tmp.items():
            nt = m.node_tree
            for n in [n for n in nt.nodes if n.name.startswith("TMP_")]:
                nt.nodes.remove(n)
        for o in dolda:
            o.hide_render = False
        sc.render.engine = motor

    # färg × skuggning i vecken, roughness + metallic i en bild (glTF: G = roughness, B = metallic)
    def px(img):
        a = np.empty(stl * stl * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        return a.reshape(-1, 4)
    c, r, mt, ao = px(bilder["C"]), px(bilder["R"]), px(bilder["M"]), px(bilder["AO"])
    f = 0.62 + 0.38 * np.clip(ao[:, :1], 0, 1)
    c[:, :3] *= f
    bilder["C"].pixels.foreach_set(c.ravel())
    orm = np.ones_like(c)
    orm[:, 1] = r[:, 0]
    orm[:, 2] = mt[:, 0]
    imo = bild(f"T_{K['nyckel']}_ORM", True)
    imo.pixels.foreach_set(orm.ravel())
    for nyckel, img in (("C", bilder["C"]), ("ORM", imo), ("N", bilder["N"])):
        img.filepath_raw = os.path.join(texmapp, f"T_{K['nyckel']}_{nyckel}.png")
        img.file_format = "PNG"
        img.save()
    for n in ("R", "M", "AO"):
        bpy.data.images.remove(bilder[n])

    # två material (vanligt + lagfärg) med samma bilder
    def slutmaterial(namn, lag):
        m = bpy.data.materials.get(namn)
        if m:
            bpy.data.materials.remove(m)
        m = bpy.data.materials.new(namn)
        if m.node_tree is None:
            m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes.get("Principled BSDF")
        tc = nt.nodes.new("ShaderNodeTexImage")
        tc.image = bilder["C"]
        to = nt.nodes.new("ShaderNodeTexImage")
        to.image = imo
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = bilder["N"]
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tc.outputs["Color"], b.inputs["Base Color"])
        nt.links.new(to.outputs["Color"], sep.inputs[0])
        nt.links.new(sep.outputs[1], b.inputs["Roughness"])
        nt.links.new(sep.outputs[2], b.inputs["Metallic"])
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
        m["lag"] = 1 if lag else 0
        m.diffuse_color = (0.8, 0.8, 0.8, 1) if lag else (0.5, 0.42, 0.35, 1)
        return m

    utr = slutmaterial(f"MAT_{K['nyckel']}_Utrustning", False)
    utr_lag = slutmaterial(f"MAT_{K['nyckel']}_Utrustning_Lag", True)

    # ytorna får de nya materialen; atlasens UV flyttas till den vanliga UV-kartan
    for o in objs:
        me = o.data
        gamla = [sl.material for sl in o.material_slots]
        nya = []
        def idx(m):
            if m not in nya:
                nya.append(m)
            return nya.index(m)
        karta = {}
        for i, m in enumerate(gamla):
            if m is None:
                karta[i] = idx(utr)
            elif har_bild(original.get(m, m)):
                karta[i] = idx(original.get(m, m))
            else:
                karta[i] = idx(utr_lag if har(original.get(m, m).name, K["lagfarg"]) else utr)
        uv0 = me.uv_layers.get("UVMap") or me.uv_layers[0]
        uva = me.uv_layers["Atlas"]
        nya_index = []
        for p in me.polygons:
            gm = gamla[p.material_index] if p.material_index < len(gamla) else None
            if gm is None or not har_bild(original.get(gm, gm)):
                for li in p.loop_indices:
                    uv0.data[li].uv = uva.data[li].uv
            nya_index.append(karta.get(p.material_index, 0))
        me.materials.clear()                       # (nollställer ytornas materialnummer)
        for m in nya:
            me.materials.append(m)
        me.polygons.foreach_set("material_index", nya_index)
        me.update()
        me.uv_layers.remove(me.uv_layers["Atlas"])
        me.uv_layers.active = me.uv_layers[0]
    for m in list(kopia.values()):
        bpy.data.materials.remove(m)
    R.append(f"Bakat: {stl}px färg (med skuggning i vecken), roughness/metallic och normal map → "
             f"{texmapp}")


# =============================================================== huvudprogram
def kor():
    K = KONFIG
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    rig = bpy.data.objects[K["rigg"]]
    kropp = bpy.data.objects[K["kropp"]]
    mapp = os.path.dirname(bpy.data.filepath)
    kolnamn = f"COL_Spelexport_{K['nyckel']}"
    ta_bort_samling(kolnamn)
    kol = bpy.data.collections.new(kolnamn)
    bpy.context.scene.collection.children.link(kol)

    R.append(f"SPELMODELL {K['namn']} ({K['nyckel']})")

    # --- källobjekt
    kallor = [kropp] + [bpy.data.objects[n] for n in K["extra"] if bpy.data.objects.get(n)]
    for o in bpy.data.collections[K["samling"]].all_objects:
        if o.type == "MESH" and not o.hide_render and not har(o.name, K["hoppa_over"]) and o not in kallor:
            kallor.append(o)
    R.append(f"Källor: {len(kallor)} objekt")
    KV = Kroppsvikter(kropp)

    # --- kopior, klass och (för delar som poseras) ARP-vikter i vila
    klass = {}
    kopior = []
    for o in kallor:
        k = kopiera(o, kol)
        kopior.append(k)
        harvikt = len(k.vertex_groups) > 0 and any(len(v.groups) for v in k.data.vertices)
        if har(o.name, K["hjalm"]):
            klass[k] = "hjalm"
        elif har(o.name, K["kjol"]):
            klass[k] = "kjol"
        elif har(o.name, K["bal"]) and not harvikt:
            klass[k] = "bal"
        else:
            klass[k] = "pose"
            if not harvikt:
                mw = k.matrix_world
                k.vertex_groups.clear()
                grupper = {}
                for v in k.data.vertices:
                    w = normera(KV.narmast(mw @ v.co, arp=True), 4)
                    for n, x in w.items():
                        if n not in grupper:
                            grupper[n] = k.vertex_groups.new(name=n)
                        grupper[n].add([v.index], x, "REPLACE")
            if not any(m.type == "ARMATURE" for m in k.modifiers):
                am = k.modifiers.new("Armature", "ARMATURE")
                am.object = rig
            for m in k.modifiers:
                if m.type == "ARMATURE":
                    m.object = rig

    def kjolvikt(p):
        zt = smooth(0.98, 1.12, p.z)
        w = {"torso": zt, "pelvis": 1 - zt}
        t = smooth(0.0, 1.0, (HOFT_Z - 0.02 - p.z) / 0.32)   # nedanför höften: följer låren
        if t > 0:
            a = smooth(-0.07, 0.07, p.x)
            w["pelvis"] = w.get("pelvis", 0) * (1 - 0.6 * t)
            w["thighL"] = 0.6 * t * a
            w["thighR"] = 0.6 * t * (1 - a)
        return normera(w)

    def balfilt(sp):
        return bool(sp) and max(sp, key=sp.get) in ("pelvis", "torso", "head")

    # --- posera armarna och baka allt (världskoordinater)
    R.append("Pose (armarna rakt ned, som riddarna):")
    sparat = posera_armar(rig)
    dg = bpy.context.evaluated_depsgraph_get()
    J = {}
    for nyckel, ben in (("axelL", "c_arm_twist_offset.l"), ("armbL", "forearm_stretch.l"), ("handL", "hand.l"),
                        ("axelR", "c_arm_twist_offset.r"), ("armbR", "forearm_stretch.r"), ("handR", "hand.r"),
                        ("hoftL", "thigh_twist.l"), ("knaL", "leg_stretch.l"), ("vristL", "foot.l"),
                        ("hoftR", "thigh_twist.r"), ("knaR", "leg_stretch.r"), ("vristR", "foot.r"),
                        ("nacke", "neck.x"), ("huvud", "head.x")):
        J[nyckel] = varld(rig, ben).copy()
    pbn = rig.pose.bones
    for S, s in (("L", "l"), ("R", "r")):
        pts = []
        for f in ("index", "middle", "ring", "pinky"):
            b1, b3 = pbn.get(f"c_{f}1.{s}"), pbn.get(f"c_{f}3.{s}")
            if b1 and b3:
                pts += [rig.matrix_world @ b1.head, rig.matrix_world @ b3.tail]
        J["grepp" + S] = (sum(pts, Vector()) / len(pts)) if pts else J["hand" + S] + Vector((0, 0, -0.07))
    data = {}     # kopia → (co-lista, spelvikter-lista, mesh)
    for k in kopior:
        ev = k.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        me.transform(k.matrix_world)
        gn = [g.name for g in k.vertex_groups]
        if klass[k] == "pose":
            sv = []
            for v in me.vertices:
                w = {}
                for g in v.groups:
                    if g.group < len(gn):
                        for b, a in ARP_till_spel(gn[g.group]):
                            w[b] = w.get(b, 0) + g.weight * a
                if not w:
                    w = normera(KV.narmast(v.co))
                sv.append(normera(w))
            if har(k.name, K.get("axel", [])):
                sv = []
                for v in me.vertices:
                    S = "L" if v.co.x > 0 else "R"
                    w_ua = 0.72 + 0.28 * smooth(0.0, 0.07, J["axel" + S].z - v.co.z)
                    sv.append({"upperArm" + S: w_ua, "torso": 1 - w_ua})
        elif klass[k] == "hjalm":
            sv = [{"head": 1.0} for _ in me.vertices]
        elif klass[k] == "kjol":
            sv = [kjolvikt(v.co) for v in me.vertices]
        else:
            sv = [normera(KV.narmast(v.co, balfilt)) for v in me.vertices]
        gammal = k.data
        k.data = me
        k.modifiers.clear()
        k.vertex_groups.clear()
        k.matrix_world = Matrix.Identity(4)
        if gammal.users == 0:
            bpy.data.meshes.remove(gammal)
        data[k] = sv
    aterstall_pose(rig, sparat)

    # --- byggnad (riddarens mått för den här rustningen) och riddarens leder
    dz = HOFT_Z - (J["hoftL"].z + J["hoftR"].z) / 2
    axel_z = (J["axelL"].z + J["axelR"].z) / 2 + dz
    axel_x = (J["axelL"].x - J["axelR"].x) / 2
    tall = (axel_z - BAKEN_Z) / 0.41
    broad = axel_x / 0.212 * K.get("axelbredd", 1.0)
    overarm = ((J["armbL"] - J["axelL"]).length + (J["armbR"] - J["axelR"]).length) / 2
    underarm = ((J["handL"] - J["armbL"]).length + (J["handR"] - J["armbR"]).length) / 2
    armY, foreY = overarm / 0.29, underarm / 0.26
    huvud_z = BAKEN_Z + 0.46 * tall
    Jk = {"pelvis": Vector((0, 0, BAKEN_Z)), "torso": Vector((0, 0, BAKEN_Z)), "head": Vector((0, 0, huvud_z))}
    for S, sx in (("L", 1), ("R", -1)):
        a = Vector((sx * 0.212 * broad, 0, axel_z))
        e = a - Vector((0, 0, 0.29 * armY))
        h = e - Vector((0, 0, 0.26 * foreY))
        Jk["upperArm" + S], Jk["forearm" + S], Jk["hand" + S] = a, e, h
        Jk["thigh" + S] = Vector((sx * HOFT_X, 0, HOFT_Z))
        Jk["shin" + S] = Vector((sx * HOFT_X, 0, KNA_Z))
        Jk["foot" + S] = Vector((sx * HOFT_X, 0, VRIST_Z))
    R.append(f"Byggnad: tall {tall:.3f}  broad {broad:.3f}  överarm {overarm:.3f} m (armY {armY:.3f})  "
             f"underarm {underarm:.3f} m (foreY {foreY:.3f})  höjdjustering {dz:+.3f} m")

    # --- omriktning per ben
    upp = Vector((0, 0, dz))
    T = {"pelvis": lambda v: v + upp, "torso": lambda v: v + upp}
    nacke = J["nacke"] + upp
    T["head"] = lambda v, d=(Jk["head"] - nacke): v + upp + d
    for S, s in (("L", "L"), ("R", "R")):
        fa, _ = likform(J["axel" + S], J["armb" + S], Jk["upperArm" + S], Jk["forearm" + S])
        fu, ru = likform(J["armb" + S], J["hand" + S], Jk["forearm" + S], Jk["hand" + S])
        hand0 = J["hand" + S]
        T["upperArm" + S] = fa
        T["forearm" + S] = fu
        T["hand" + S] = lambda v, h0=hand0, r=ru, hk=Jk["hand" + S]: hk + r @ (v - h0)
        # benens form: raka ben på modellens egen höftbredd, knät där kna_hojd säger;
        # spelets leder (Jk) ligger kvar – höftleden sitter då lite innanför låret, som på en människa
        hx = J["hoft" + S].x if K.get("hoft_behall") else Jk["thigh" + S].x
        Hm = Vector((hx, 0, HOFT_Z))
        Km = Vector((hx, 0, K.get("kna_hojd", KNA_Z)))
        Am = Vector((hx, 0, VRIST_Z))
        ft, _ = likform(J["hoft" + S], J["kna" + S], Hm, Km)
        fs, rs = likform(J["kna" + S], J["vrist" + S], Km, Am)
        v0 = J["vrist" + S]
        T["thigh" + S] = ft
        T["shin" + S] = fs
        T["foot" + S] = lambda v, a0=v0, r=rs, ak=Am: ak + r @ (v - a0)
    for k, sv in data.items():
        me = k.data
        for v, w in zip(me.vertices, sv):
            p = v.co.copy()
            ny = Vector()
            tot = 0.0
            for b, x in w.items():
                ny += T[b](p) * x
                tot += x
            v.co = ny / tot if tot > 0 else p + upp
        me.update()
    # bredare övre bröstkorg/skuldror (armarna har redan flyttats ut med sina leder)
    ab = K.get("axelbredd", 1.0)
    if ab != 1.0:
        for k, sv in data.items():
            for v, w in zip(k.data.vertices, sv):
                wt = w.get("torso", 0.0) + w.get("pelvis", 0.0) * 0.5
                if wt > 0:
                    f = smooth(BAKEN_Z + 0.2, axel_z - 0.02, v.co.z) * (1 - smooth(axel_z + 0.04, axel_z + 0.14, v.co.z))
                    v.co.x *= 1 + (ab - 1) * wt * f
            k.data.update()
    hs = K.get("huvud_skala", 1.0)
    hf = Vector(K.get("hjalm_flytt", (0, 0, 0)))
    for k, sv in data.items():
        me = k.data
        for v, w in zip(me.vertices, sv):
            h = w.get("head", 0.0)
            if hs != 1.0 and h > 0:
                v.co = Jk["head"] + (v.co - Jk["head"]) * (1 + (hs - 1) * h)
            if klass[k] == "hjalm":
                v.co += hf
        me.update()
    # mindre hjälm: kupan lite, brättet mer (mätt från hjälmens mittaxel)
    hv = [v.co for k in data if klass[k] == "hjalm" for v in k.data.vertices]
    if hv:
        cx = (min(p.x for p in hv) + max(p.x for p in hv)) / 2
        cy = (min(p.y for p in hv) + max(p.y for p in hv)) / 2
        ztopp = max(p.z for p in hv)
        rk = 0.0
        for p in hv:                               # kupans radie: bredaste punkten 6–9 cm under toppen
            if ztopp - 0.13 < p.z < ztopp - 0.09:
                rk = max(rk, Vector((p.x - cx, p.y - cy)).length)
        rk = rk or 0.13
        ks, bs = K.get("hjalm_kupa", 1.0), K.get("hjalm_bratte", 1.0)
        zfot = ztopp - 0.2
        for k in data:
            if klass[k] != "hjalm":
                continue
            for v in k.data.vertices:
                d = Vector((v.co.x - cx, v.co.y - cy))
                r = d.length
                rn = r * ks if r <= rk else rk * ks + (r - rk) * bs
                if r > 1e-6:
                    d *= rn / r
                z = zfot + (v.co.z - zfot) * ks
                if r > rk:                         # brättet följer med kupans kant nedåt/uppåt
                    z += (r - rk) * (1 - bs) * 0.25
                v.co = Vector((cx + d.x, cy + d.y, z))
            k.data.update()
        R.append(f"Hjälm: kupa ×{ks}, brätte ×{bs} (kuparadie {rk:.3f} m)")
    grepp = {}
    for S in ("L", "R"):
        g = T["hand" + S](J["grepp" + S]) - Jk["hand" + S]
        grepp[S] = [round(g.x, 4), round(g.z, 4), round(-g.y, 4)]       # riddarens koordinater (y upp, z fram)
    R.append(f"Grepp (knuten hand, från handleden): V {grepp['L']}  H {grepp['R']}")

    # --- dold yta
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = {k: BVHTree.FromObject(k, dg) for k in kopior}
    namn_av = {k: k.name[4:] for k in kopior}
    for k in kopior:
        nm = namn_av[k]
        nyckel = next((n for n in sorted(K["dold_yta"], key=len, reverse=True)
                       if (nm == n if n == K["kropp"] else n in nm)), None)
        if nyckel is None:
            continue
        yttre = [b for o, b in bvh.items() if o is not k and har(namn_av[o], K["dold_yta"][nyckel])]
        if not yttre:
            continue
        me = k.data
        bm = bmesh.new()
        bm.from_mesh(me)
        sv = data[k]
        dl = bm.verts.layers.int.new("_idx")
        for i, v in enumerate(bm.verts):
            v[dl] = i
        bort = []
        for f in bm.faces:
            c = f.calc_center_median()
            n = f.normal
            if n.length < 0.5:
                continue
            hit = False
            for b in yttre:
                if b.ray_cast(c + n * 0.002, n, 0.05)[0] is not None:
                    hit = True
                    break
            if hit:
                bort.append(f)
        # lämna en kant av dold yta kvar (två rader) så att gränsen inte syns som hackiga tänder
        bs = set(bort)
        for _ in range(2):
            kvar = [f for f in bs if any(g not in bs for e in f.edges for g in e.link_faces)]
            for f in kvar:
                bs.discard(f)
        bort = list(bs)
        fore = len(bm.faces)
        bmesh.ops.delete(bm, geom=bort, context="FACES_ONLY")
        losa = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=losa, context="VERTS")
        nya_sv = [sv[v[dl]] for v in bm.verts]
        bm.verts.layers.int.remove(dl)
        bm.to_mesh(me)
        bm.free()
        data[k] = nya_sv
        R.append(f"  dold yta {namn_av[k]}: {len(bort)} av {fore} ytor borttagna")
    for k in [k for k in kopior if len(k.data.polygons) == 0]:
        kopior.remove(k)
        del data[k]
        bpy.data.objects.remove(k, do_unlink=True)

    # --- vikter som vertex groups (spelben) – så att decimering tar med dem
    for k in kopior:
        k.vertex_groups.clear()
        g = {b: k.vertex_groups.new(name=b) for b in BEN}
        for i, w in enumerate(data[k]):
            for b, x in w.items():
                g[b].add([i], x, "REPLACE")

    # --- bantning
    dekal_pts = [v.co.copy() for k in kopior if har(namn_av[k], K.get("dekaler", [])) for v in k.data.vertices]
    dekal_kd = KDTree(max(1, len(dekal_pts)))
    for i, c in enumerate(dekal_pts):
        dekal_kd.insert(c, i)
    dekal_kd.balance()

    def decimera(k, mal):
        t0 = tris_me(k.data)
        if t0 <= mal:
            return
        # materialgränser och öppna kanter skyddas (vikt 0), så att t.ex. tabardens gula fåll,
        # vit/blå-sömmen och ärmslutens kanter inte blir sågtandade när resten bantas
        bmg = bmesh.new()
        bmg.from_mesh(k.data)
        skydd = set()
        for e in bmg.edges:
            if e.is_boundary or len({f.material_index for f in e.link_faces}) > 1:
                skydd.update(v.index for v in e.verts)
        if dekal_pts and not har(namn_av[k], K.get("dekaler", [])):
            for v in bmg.verts:
                if dekal_kd.find(v.co)[2] < 0.025:
                    skydd.add(v.index)
        bmg.free()
        vg = k.vertex_groups.new(name="TMP_BANTNING")
        vg.add(list(range(len(k.data.vertices))), 1.0, "REPLACE")
        if skydd:
            vg.add(list(skydd), 0.0, "REPLACE")
        m = k.modifiers.new("Dec", "DECIMATE")
        m.ratio = max(0.05, mal / t0)
        m.use_collapse_triangulate = True
        m.vertex_group = vg.name
        m.vertex_group_factor = 1.0
        dg2 = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(k.evaluated_get(dg2), preserve_all_data_layers=True, depsgraph=dg2)
        gammal = k.data
        k.modifiers.remove(m)
        k.data = me
        tmp = k.vertex_groups.get("TMP_BANTNING")     # (gruppnamnen ligger i meshen i nyare Blender)
        if tmp:
            k.vertex_groups.remove(tmp)
        bpy.data.meshes.remove(gammal)

    kropp_k = next(k for k in kopior if namn_av[k] == K["kropp"])
    decimera(kropp_k, K["kropp_tris"])
    ovr = [k for k in kopior if k is not kropp_k]
    summa = sum(tris_me(k.data) for k in kopior)
    if summa > K["mal_tris"]:
        rest = K["mal_tris"] - tris_me(kropp_k.data)
        stora = [k for k in ovr if tris_me(k.data) > 500 and not har(namn_av[k], K.get("ej_bantning", []))]
        sma = sum(tris_me(k.data) for k in ovr if k not in stora)
        stor = sum(tris_me(k.data) for k in stora)
        kvot = max(0.25, (rest - sma) / max(1, stor))
        R.append(f"Bantning: {len(stora)} delar ({stor} tri) → kvot {kvot:.2f}; små/obantade delar {sma} tri")
        for k in stora:
            decimera(k, int(tris_me(k.data) * kvot))

    # --- sömmar per kroppsdel + region + mjuka normaler
    for k in kopior:
        me = k.data
        gn = [g.name for g in k.vertex_groups]
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.normal_update()
        dl = bm.verts.layers.deform.active
        reg = bm.faces.layers.int.new("_reg")
        nrm = {}
        for v in bm.verts:
            nrm[v.index] = v.normal.copy()
        orig = bm.verts.layers.int.new("_o")
        for v in bm.verts:
            v[orig] = v.index
        for f in bm.faces:
            s = {}
            for v in f.verts:
                for gi, w in (v[dl].items() if dl else []):
                    s[gi] = s.get(gi, 0) + w
            f[reg] = BEN.index(gn[max(s, key=s.get)]) if s else 0
        kant = [e for e in bm.edges if len(e.link_faces) == 2 and e.link_faces[0][reg] != e.link_faces[1][reg]]
        bmesh.ops.split_edges(bm, edges=kant)
        regv = bm.verts.layers.float.new("_REGION")
        for v in bm.verts:
            v[regv] = float(v.link_faces[0][reg]) if v.link_faces else 0.0
        on = [nrm[v[orig]] for v in bm.verts]
        bm.verts.layers.int.remove(orig)
        bm.faces.layers.int.remove(reg)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = True
        me.normals_split_custom_set_from_vertices(on)
        for a in [a.name for a in me.color_attributes]:     # färger per hörn behövs inte i spelet
            me.color_attributes.remove(me.color_attributes[a])
        if me.uv_layers:
            me.uv_layers[0].name = "UVMap"
        else:
            me.uv_layers.new(name="UVMap")
        # _REGION som punktattribut (float) finns nu i mesh.attributes

    # --- slå ihop: kropp (skinnad) och hjälm (stel)
    def sla_ihop(lista, namn):
        if not lista:
            return None
        with bpy.context.temp_override(active_object=lista[0], selected_editable_objects=lista,
                                       selected_objects=lista):
            bpy.ops.object.join()
        o = lista[0]
        o.name = namn
        o.data.name = namn
        return o

    hjalmar = [k for k in kopior if klass[k] == "hjalm"]
    ovriga = [k for k in kopior if klass[k] != "hjalm"]
    kroppobj = sla_ihop(ovriga, f"SM_{K['nyckel']}_Kropp")
    hjalmobj = sla_ihop(hjalmar, f"SM_{K['nyckel']}_Hjalm")
    if hjalmobj:
        hjalmobj.vertex_groups.clear()

    # --- spelmaterial
    def spelmaterial(m):
        if m is None:
            return None
        nm = m.name + "__S"
        ut = bpy.data.materials.get(nm)
        har_bild = m.node_tree is not None and any(n.type == "TEX_IMAGE" and n.image for n in m.node_tree.nodes)
        if har_bild:
            return m                                      # kropp och ögon: behåll texturerna
        regel = next((r for r in K["material"] if r[0] in m.name), None)
        farg, rough, metal = (regel[1:] if regel else ("#808080", 0.8, 0.0))
        if ut is None:
            ut = bpy.data.materials.new(nm)
            if ut.node_tree is None:
                ut.use_nodes = True
        b = ut.node_tree.nodes.get("Principled BSDF")
        h = farg.lstrip("#")
        rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
        b.inputs["Base Color"].default_value = (*lin, 1)
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
        ut.diffuse_color = (*lin, 1)                     # syns också i Blenders enkla vy
        ut.roughness = rough
        ut.metallic = metal
        ut["lag"] = 1 if har(m.name, K["lagfarg"]) else 0
        return ut

    slutliga = [o for o in (kroppobj, hjalmobj) if o]
    if K.get("baka"):
        baka_atlas(slutliga, K, mapp)
    else:
        for k in slutliga:
            for i, sl in enumerate(k.material_slots):
                k.data.materials[i] = spelmaterial(sl.material)

    # --- spelskelettet
    ad = bpy.data.armatures.new(f"ARM_{K['nyckel']}")
    arm = bpy.data.objects.new(f"ARM_{K['nyckel']}", ad)
    kol.objects.link(arm)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    with bpy.context.temp_override(active_object=arm, object=arm):
        bpy.ops.object.mode_set(mode="EDIT")
        eb = ad.edit_bones
        for b in BEN:
            e = eb.new(b)
            e.head = Jk[b]
            barn = [c for c, p in FORALDER.items() if p == b and not c.startswith(("thigh",))]
            if b in ("pelvis",):
                e.tail = Jk[b] + Vector((0, 0, 0.1))
            elif b == "torso":
                e.tail = Jk["head"]
            elif b == "head":
                e.tail = Jk[b] + Vector((0, 0, 0.25))
            elif b.startswith("foot"):
                e.tail = Jk[b] + Vector((0, -0.15, -0.08))
            elif b.startswith("hand"):
                e.tail = Jk[b] + Vector((0, 0, -0.1))
            else:
                nasta = {"upperArm": "forearm", "forearm": "hand", "thigh": "shin", "shin": "foot"}[b[:-1]] + b[-1]
                e.tail = Jk[nasta]
            e.use_deform = True
        for b, p in FORALDER.items():
            if p:
                eb[b].parent = eb[p]
        bpy.ops.object.mode_set(mode="OBJECT")
    kroppobj.parent = arm
    kroppobj.matrix_parent_inverse = Matrix.Identity(4)
    am = kroppobj.modifiers.new("Armature", "ARMATURE")
    am.object = arm
    if hjalmobj:
        hjalmobj.parent = None

    meta = {"byggnad": {"tall": round(tall, 4), "broad": round(broad, 4), "armY": round(armY, 4),
                        "foreY": round(foreY, 4)},
            "brost": {"rx": 0.2 * broad, "rz": 0.15, "ar": 0.075},
            "huvud": [round(x, 4) for x in Jk["head"]], "grepp": grepp, "version": 2, "nyckel": K["nyckel"]}
    arm["spelmodell"] = json.dumps(meta)
    kroppobj["spelmodell"] = json.dumps(meta)

    # --- export
    ut = os.path.join(mapp, K["ut"])
    os.makedirs(os.path.dirname(ut), exist_ok=True)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    valda = [o for o in (kroppobj, hjalmobj, arm) if o]
    for o in valda:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=ut, export_format="GLB", use_selection=True, export_apply=True,
                              export_skins=True, export_animations=False, export_extras=True,
                              export_attributes=True, export_yup=True, export_texcoords=True,
                              export_normals=True, export_materials="EXPORT",
                              export_image_format="WEBP")
    kol.hide_viewport = True
    kol.hide_render = True
    lc = bpy.context.view_layer.layer_collection.children.get(kolnamn)
    if lc:
        lc.exclude = False
        lc.hide_viewport = True

    t_kropp = tris_me(kroppobj.data)
    t_hjalm = tris_me(hjalmobj.data) if hjalmobj else 0
    mats = len([m for m in kroppobj.data.materials if m]) + (len(hjalmobj.data.materials) if hjalmobj else 0)
    R.append(f"Trianglar: kropp+utrustning {t_kropp}, hjälm {t_hjalm}, totalt {t_kropp + t_hjalm} "
             f"(mål {K['mal_tris']})")
    R.append(f"Ritanrop (material): {mats}")
    R.append(f"Export: {ut}  ({os.path.getsize(ut) / 1024:.0f} kB)")
    txt = "\n".join(R)
    print(txt)
    return txt


if __name__ == "__main__":
    resultat_text = kor()
