# =====================================================================
#  BRAWL MED BOYSEN – FAS C: GEOMETRI (tak, kanter, anslutningar, murvariation)
#  Klistra in i Blenders Scripting-flik och tryck "Run Script" (Alt+P).
#  Kör Fas B först (materialen MAT_... måste finnas).
#
#  Vad skriptet gör:
#   1. Säkerhetskopia i undermappen "versioner".
#   2. Kil-tak (massiva prismor med trekantiga gavlar i takmaterial) byggs om
#      till riktiga sadeltak: två takfall med tjocklek, synligt taksprång och
#      en gavel i sten (torn) eller trä (kungalogen) som eget objekt (SM_Gavel_...).
#   3. Massiva pyramid- och kontak på tornen görs om till takskal med
#      taksprång (takfoten sticker ut) och tjocklek. Bottenytan tas bort.
#   4. Diskreta avfasade kanter (Bevel, 1 segment, bara skarpa kanter) på sten-
#      och träobjekt som saknar det – men bara där det inte kostar för många
#      trianglar. Skriptet mäter varje objekt och tar bort fasningen igen om
#      ökningen blir för stor.
#   5. Föremål som svävar någon centimeter över marken sänks ner.
#   6. Variation mellan äldre och nyare mur: några murpartier får ett äldre,
#      mörkare och mer mossigt stenmaterial (MAT_Sten_Mur_Aldre).
#   7. Rapport med trianglar före/efter (bara synliga objekt = det som exporteras).
#
#  Arenans storlek, centrum, marken och allt man går på ändras INTE.
#  Skriptet kan köras flera gånger: redan ombyggda objekt hoppas över.
# =====================================================================
import bpy
import bmesh
import math
import os
import time
from mathutils import Vector

UPP = Vector((0, 0, 1))

# Kil-tak → sadeltak. Värde = gavelns material.
KILTAK = {
    "Karntorn_Tak": "MAT_Sten_Huggen",
    "Murtorn_NO_Tak": "MAT_Sten_Huggen",
    "Murtorn_SV_Tak": "MAT_Sten_Huggen",
    "Kungaloge_Tak": "MAT_Tra_Konstruktion",
}
# Pyramid- och kontak → takskal med taksprång
SPETSTAK = ["Kapell_Spira", "Karntorn_Trapptorn_Tak", "Torn_NV_fyrk_Tak", "Torn_SO_fyrk_Tak",
            "Torn_N_Vaktkur_Tak", "Porthus_Torn_O_Tak", "Porthus_Torn_V_Tak",
            "Torn_NO_rund_stort_Tak", "Torn_SV_rund_Tak", "Torn_V_rund_Tak"]
TAKSPRANG = 0.35      # m som takfoten sticker ut
TAKTJOCKLEK = 0.15    # m

# Fasning: hoppa över tyg, eld, glas, tunt järn, mark och redan detaljrika objekt
INGEN_FAS = ["Baner", "Flagga", "Gonfalon", "Festong", "Duk", "Eld", "Fonster_Karna", "Fonster_Porthus",
             "Fonster_Tradhus", "Beslag", "Gangjarn", "Mark_", "Arena", "Vag", "Tillfart", "Skrankgang",
             "Kvaderstenar", "Taknock", "Portgaller", "Lansar", "Facklor", "Skottglugg", "Byggstallning",
             "Flaggstang", "Banerstang", "Festong", "Grav", "Kulle", "Ho"]
MAX_TILLAGG_PER_OBJ = 400   # ett enskilt objekt får högst 400 nya trianglar av fasning
FAS_BUDGET = 6000            # totalt högst så många nya trianglar (≈ +15 % av utgångsläget).
                             # De objekt som har störst synlig yta per ny triangel fasas först.

# Murpartier som ska se äldre ut (mörkare, fuktigare, mer mossa)
ALDRE_MURAR = ["Mur_01", "Mur_04", "Mur_06", "Mur_09", "Murtorn_SV", "Torn_V_rund"]

dg = None


def trianglar(o):
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    t = sum(len(p.vertices) - 2 for p in me.polygons)
    ev.to_mesh_clear()
    return t


def synliga():
    return [o for o in bpy.context.view_layer.objects if o.type == "MESH" and o.visible_get()]


def lagg_modifierare_forst(o, namn):
    """Flytta en modifierare så att den ligger före t.ex. Bevel."""
    while o.modifiers.find(namn) > 0:
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_move_up(modifier=namn)


def lutnings_uv(o):
    """UV i meter längs takytan: U längs takfoten, V uppför taket."""
    me = o.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    mw = o.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    for p in me.polygons:
        n = (nm @ p.normal).normalized()
        if abs(n.z) > 0.985:
            u, v = Vector((1, 0, 0)), Vector((0, 1, 0))
        else:
            u = UPP.cross(n)
            u.z = 0
            u.normalize()
            v = n.cross(u).normalized()
            if v.z < 0:
                v, u = -v, -u
        for li in p.loop_indices:
            w = mw @ me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (w.dot(u), w.dot(v))


def lad_uv(o):
    """Lådprojektion i meter (för gavlar)."""
    me = o.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    mw = o.matrix_world
    for p in me.polygons:
        n = (mw.to_3x3() @ p.normal)
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            w = mw @ me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (w.x, w.y) if ax == 2 else ((w.y, w.z) if ax == 0 else (w.x, w.z))


def egen_mesh(o):
    """Ge objektet en egen kopia av meshen om den delas med andra objekt."""
    if o.data.users > 1:
        o.data = o.data.copy()


# ---------------------------------------------------------------------
# 2. Kil-tak → sadeltak med gavel
# ---------------------------------------------------------------------
def bygg_om_kiltak(o, gavelmaterial):
    if o.get("fasC") == "sadeltak":
        return "redan klart"
    me = o.data
    if len(me.vertices) != 6 or sum(1 for p in me.polygons if len(p.vertices) == 3) != 2:
        return "inte en kil – orörd"
    egen_mesh(o)
    me = o.data
    mw = o.matrix_world
    inv = mw.inverted()
    W = [mw @ v.co for v in me.vertices]
    tris = [[W[i] for i in p.vertices] for p in me.polygons if len(p.vertices) == 3]
    t1, t2 = tris
    C1 = max(t1, key=lambda w: w.z)
    C2 = max(t2, key=lambda w: w.z)
    nock = C2 - C1
    langd = nock.length
    dr = nock.normalized()
    tvars = Vector((-dr.y, dr.x, 0)).normalized()

    def bas(t, C):
        b = [w for w in t if (w - C).length > 1e-6]
        b.sort(key=lambda w: w.dot(tvars))
        return b

    A1, B1 = bas(t1, C1)
    A2, B2 = bas(t2, C2)
    sprang_gavel = 0.3
    sprang_fot = 0.25
    bm = bmesh.new()
    for E1, E2 in ((A1, A2), (B1, B2)):
        ned = (E1 - C1).normalized()
        p = [E1 + ned * sprang_fot - dr * sprang_gavel, E2 + ned * sprang_fot + dr * sprang_gavel,
             C2 + dr * sprang_gavel, C1 - dr * sprang_gavel]
        f = bm.faces.new([bm.verts.new(inv @ q) for q in p])
        if (mw.to_3x3() @ f.normal).z < 0:
            f.normal_flip()
    bm.to_mesh(me)
    bm.free()
    me.update()
    if not o.modifiers.get("Tjocklek_FasC"):
        s = o.modifiers.new("Tjocklek_FasC", "SOLIDIFY")
        s.thickness = TAKTJOCKLEK
        s.offset = -1
        s.use_even_offset = True
        lagg_modifierare_forst(o, "Tjocklek_FasC")
    lutnings_uv(o)

    # gavlar: tjock trekant under takfallen, lite indragen
    gnamn = "SM_Gavel_" + o.name
    gammal = bpy.data.objects.get(gnamn)
    if gammal:
        bpy.data.objects.remove(gammal, do_unlink=True)
    gbm = bmesh.new()
    for (A, B, C, tecken) in ((A1, B1, C1, 1), (A2, B2, C2, -1)):
        inat = dr * tecken * 0.05
        djup = dr * tecken * 0.35
        pts = [A + inat, B + inat, C + inat - Vector((0, 0, TAKTJOCKLEK))]
        v = [gbm.verts.new(q) for q in pts] + [gbm.verts.new(q + djup) for q in pts]
        for f in [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]:
            gbm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(gbm, faces=gbm.faces)
    gme = bpy.data.meshes.new(gnamn)
    gbm.to_mesh(gme)
    gbm.free()
    mat = bpy.data.materials.get(gavelmaterial)
    if mat:
        gme.materials.append(mat)
    gob = bpy.data.objects.new(gnamn, gme)
    for c in o.users_collection:
        c.objects.link(gob)
    lad_uv(gob)
    fas = gob.modifiers.new("Fasning_FasC", "BEVEL")
    fas.width = 0.03
    fas.segments = 1
    fas.limit_method = "ANGLE"
    fas.angle_limit = math.radians(35)
    o["fasC"] = "sadeltak"
    return f"sadeltak, nock {langd:.1f} m, gavel i {gavelmaterial}"


# ---------------------------------------------------------------------
# 3. Pyramid/kon → takskal med taksprång
# ---------------------------------------------------------------------
def bygg_om_spetstak(o):
    if o.get("fasC") == "takskal":
        return "redan klart"
    egen_mesh(o)
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    zmax = max(v.co.z for v in bm.verts)
    topp = [v for v in bm.verts if v.co.z > zmax - 1e-4]
    if len(topp) != 1:
        bm.free()
        return "ingen enkel spets – orörd"
    a = topp[0]
    skala = sum(o.scale) / 3
    botten = [f for f in bm.faces if a not in f.verts]
    bmesh.ops.delete(bm, geom=botten, context="FACES_ONLY")
    for v in bm.verts:
        if v is a:
            continue
        d = v.co - a.co
        h = Vector((d.x, d.y, 0)).length
        if h > 1e-4:
            v.co = a.co + d * (1 + (TAKSPRANG / skala) / h)
    bm.normal_update()
    upp = sum((f.normal.z for f in bm.faces), 0.0)
    if upp < 0:
        for f in bm.faces:
            f.normal_flip()
    bm.to_mesh(me)
    bm.free()
    me.update()
    if not o.modifiers.get("Tjocklek_FasC"):
        s = o.modifiers.new("Tjocklek_FasC", "SOLIDIFY")
        s.thickness = TAKTJOCKLEK / skala
        s.offset = -1
        s.use_even_offset = True
        lagg_modifierare_forst(o, "Tjocklek_FasC")
    lutnings_uv(o)
    o["fasC"] = "takskal"
    return "takskal med taksprång"


# ---------------------------------------------------------------------
# 4. Fasade kanter där de gör nytta
# ---------------------------------------------------------------------
def fasa(o):
    global dg
    if any(m.type == "BEVEL" and m.name != "Fasning_FasC" for m in o.modifiers):
        return None
    if o.modifiers.get("Fasning_FasC"):   # från en tidigare körning: mät om från början
        o.modifiers.remove(o.modifiers["Fasning_FasC"])
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
    if any(k.lower() in o.name.lower() for k in INGEN_FAS):
        return None
    mats = [s.material.name for s in o.material_slots if s.material]
    if not any(m.startswith(("MAT_Sten", "MAT_Tra", "MAT_Korsvirke")) for m in mats):
        return None
    fore = trianglar(o)
    sten = any(m.startswith("MAT_Sten") for m in mats)
    b = o.modifiers.new("Fasning_FasC", "BEVEL")
    b.width = (0.03 if sten else 0.012) / (sum(o.scale) / 3)
    b.segments = 1
    b.limit_method = "ANGLE"
    b.angle_limit = math.radians(35)
    b.use_clamp_overlap = True
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    efter = trianglar(o)
    tillagg = efter - fore
    if tillagg > MAX_TILLAGG_PER_OBJ:
        o.modifiers.remove(b)
        return ("för dyr", o.name, fore, efter, 0.0)
    yta = sum(p.area for p in o.data.polygons) * (sum(o.scale) / 3) ** 2
    return ("fasad", o.name, fore, efter, yta / max(1, tillagg))


# ---------------------------------------------------------------------
# 6. Äldre murmaterial
# ---------------------------------------------------------------------
def aldre_murmaterial():
    bas = bpy.data.materials.get("MAT_Sten_Mur")
    if not bas:
        return None
    m = bpy.data.materials.get("MAT_Sten_Mur_Aldre")
    if m is None:
        m = bas.copy()
        m.name = "MAT_Sten_Mur_Aldre"
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        ut = bsdf.inputs["Base Color"].links[0].from_socket
        ton = nt.nodes.new("ShaderNodeVectorMath")
        ton.operation = "MULTIPLY"
        ton.name = ton.label = "ALDRE_TON"
        ton.inputs[1].default_value = (0.8, 0.8, 0.74)   # mörkare, lite grönbrun
        ton.location = (bsdf.location.x - 220, bsdf.location.y + 260)
        nt.links.new(ut, ton.inputs[0])
        nt.links.new(ton.outputs[0], bsdf.inputs["Base Color"])
        r = bsdf.inputs["Roughness"].links[0].from_socket
        rn = nt.nodes.new("ShaderNodeMath")
        rn.operation = "ADD"
        rn.use_clamp = True
        rn.inputs[1].default_value = 0.05
        rn.location = (bsdf.location.x - 220, bsdf.location.y + 120)
        nt.links.new(r, rn.inputs[0])
        nt.links.new(rn.outputs[0], bsdf.inputs["Roughness"])
        m["ersatter"] = "BO_Mur (äldre parti)"
        m["aldre_ton"] = [0.8, 0.8, 0.74]
    return m


# ---------------------------------------------------------------------
# HUVUDPROGRAM
# ---------------------------------------------------------------------
def kor():
    global dg
    if not bpy.data.filepath:
        raise RuntimeError("Spara .blend-filen först (File > Save).")
    if not bpy.data.materials.get("MAT_Sten_Mur"):
        raise RuntimeError("Kör Fas B (02_fasB_material.py) först.")
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    R = []
    mapp = os.path.join(bpy.path.abspath("//"), "versioner")
    os.makedirs(mapp, exist_ok=True)
    kopia = os.path.join(mapp, time.strftime("fore_fasC_%Y%m%d_%H%M%S.blend"))
    bpy.ops.wm.save_as_mainfile(filepath=kopia, copy=True)
    R.append(f"Säkerhetskopia: {kopia}")

    dg = bpy.context.evaluated_depsgraph_get()
    fore_obj = synliga()
    fore_tris = sum(trianglar(o) for o in fore_obj)

    R.append("\nTAK – kil-tak till sadeltak:")
    for namn, gmat in KILTAK.items():
        o = bpy.data.objects.get(namn)
        R.append(f"  {namn}: " + (bygg_om_kiltak(o, gmat) if o else "finns inte"))

    R.append("\nTAK – pyramid/kon till takskal:")
    for namn in SPETSTAK:
        o = bpy.data.objects.get(namn)
        R.append(f"  {namn}: " + (bygg_om_spetstak(o) if o else "finns inte"))

    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    R.append("\nFASADE KANTER:")
    kandidater, dyra = [], []
    for o in synliga():
        r = fasa(o)
        if r and r[0] == "fasad":
            kandidater.append(r)
        elif r:
            dyra.append(r)
    # mest synlig yta per ny triangel först, tills budgeten är slut
    kandidater.sort(key=lambda r: -r[4])
    anvant = 0
    fasade, utanfor = [], []
    for r in kandidater:
        tillagg = r[3] - r[2]
        if anvant + tillagg <= FAS_BUDGET:
            anvant += tillagg
            fasade.append(r)
        else:
            o = bpy.data.objects[r[1]]
            m = o.modifiers.get("Fasning_FasC")
            if m:
                o.modifiers.remove(m)
            utanfor.append(r)
    R.append(f"  Fasning tillagd på {len(fasade)} objekt (+{anvant} trianglar, budget {FAS_BUDGET})")
    if utanfor:
        R.append(f"  {len(utanfor)} objekt fick ingen fasning (budgeten slut – minst synlig nytta): "
                 + ", ".join(r[1] for r in utanfor[:10]) + (" …" if len(utanfor) > 10 else ""))
    if dyra:
        R.append(f"  {len(dyra)} objekt hoppades över (över {MAX_TILLAGG_PER_OBJ} nya trianglar var): "
                 + ", ".join(f"{r[1]} ({r[2]}→{r[3]})" for r in dyra[:10]) + (" …" if len(dyra) > 10 else ""))

    R.append("\nANSLUTNINGAR – föremål som svävade 0,5–5 cm över marken:")
    sankta = 0
    EJ_SANKA = ("Baner", "Flagga", "Skrank", "Skoldar", "Arena", "Mark", "Vag", "vag", "Golv", "Tillfart")
    for o in synliga():
        # vägar och golv ligger med flit några cm över marken (annars flimmer) – återställ om de sänkts
        if any(k in o.name for k in EJ_SANKA):
            if o.get("fasC_sankt"):
                o.location.z += o["fasC_sankt"]
                del o["fasC_sankt"]
                R.append(f"  {o.name}: återställd (ska ligga ovanpå marken)")
            continue
        if o.get("fasC_sankt"):
            continue
        zmin = min((o.matrix_world @ v.co).z for v in o.data.vertices) if o.data.vertices else 0
        if 0.005 < zmin < 0.05:
            o.location.z -= zmin
            o["fasC_sankt"] = round(zmin, 3)
            sankta += 1
            R.append(f"  {o.name}: sänkt {zmin * 100:.1f} cm")
    if not sankta:
        R.append("  inga")

    R.append("\nMURVARIATION – äldre partier:")
    am = aldre_murmaterial()
    if am:
        for namn in ALDRE_MURAR:
            o = bpy.data.objects.get(namn)
            if not o:
                continue
            for s in o.material_slots:
                if s.material and s.material.name == "MAT_Sten_Mur":
                    s.material = am
                    R.append(f"  {namn} → MAT_Sten_Mur_Aldre")

    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    efter_obj = synliga()
    efter_tris = sum(trianglar(o) for o in efter_obj)
    R.insert(1, f"Synliga objekt: före {len(fore_obj)}, efter {len(efter_obj)}")
    R.insert(2, f"Trianglar (synliga): före {fore_tris}, efter {efter_tris} "
                f"({(efter_tris - fore_tris) / max(1, fore_tris) * 100:+.1f} %)")
    R.append("\nInte gjort automatiskt (kräver handarbete eller ger för lite per triangel):")
    R.append("  - Djupare fönsternischer: väggarna har inga hål, så glaset kan inte flyttas in utan att försvinna.")
    R.append("  - Gavlarna på de vanliga sadeltaken är redan riktiga gavlar (sten/korsvirke) och är orörda.")
    text = "FAS C – GEOMETRI\n" + "\n".join(R)
    print(text)
    t = bpy.data.texts.get("FAS_C_rapport") or bpy.data.texts.new("FAS_C_rapport")
    t.clear()
    t.write(text)
    return text


resultat_text = kor()
