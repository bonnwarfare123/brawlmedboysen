# =====================================================================
#  BRAWL MED BOYSEN – FAS D: SLITAGE, GROUNDING OCH DETALJER
#  Klistra in i Blenders Scripting-flik och tryck "Run Script" (Alt+P).
#  Kör först Fas B (02_fasB_material.py, v1.1) och Fas C (03_fasC_geometri.py).
#
#  Vad skriptet gör (riktat – inget brusfilter över hela borgen):
#   1. Säkerhetskopia i undermappen "versioner".
#   2. Trappor av sten får materialet MAT_Sten_Trappa (nötta, blankare steg).
#   3. Det äldre murmaterialet byggs om från det nya MAT_Sten_Mur (så det får
#      riktad mossa m.m. från Fas B v1.1) och behåller sina murpartier.
#   4. Grounding: där murar, torn och socklar möter marken läggs
#        - en smal, oregelbunden grusremsa (SM_Grus_Murfot, ett enda objekt)
#        - glest utströdda, halvt nedsjunkna stenar (SM_Grundstenar, ett enda objekt)
#      Inget läggs innanför arenans skrank och inget på marken man slåss på.
#   5. Rapport med trianglar och objekt före/efter.
#
#  Kan köras flera gånger: SM_Grus_Murfot och SM_Grundstenar skapas om från början.
# =====================================================================
import bpy
import bmesh
import math
import os
import random
import time
from mathutils import Vector, Matrix, Euler

SAMLING = "COL_Environment_Detaljer"
STENMATERIAL = ("MAT_Sten_Mur", "MAT_Sten_Mur_Aldre", "MAT_Sten_Huggen", "MAT_Sten_Port")
INTE_MURFOT = ("Brostvarn", "Krenelering", "Konsolband", "Gesims", "Kvadersten", "Fonster", "Skottglugg",
               "Krona", "Trappa", "trappa", "Trapptorn", "Skorsten", "Vaktkur", "Murgang", "Vaktgang", "Gavel")
ARENA_RX, ARENA_RY = 14.5, 10.5     # ellips (lite större än skranket): här läggs ingenting
GRUS_BREDD = (0.28, 0.55)           # m från murfoten
STEN_AVSTAND = 0.9                  # m mellan möjliga stenar längs murfoten
STEN_CHANS = 0.22
STEN_STORLEK = (0.10, 0.28)         # m


def synliga():
    return [o for o in bpy.context.view_layer.objects if o.type == "MESH" and o.visible_get()]


def trianglar_totalt():
    dg = bpy.context.evaluated_depsgraph_get()
    t = 0
    for o in synliga():
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        t += sum(len(p.vertices) - 2 for p in me.polygons)
        ev.to_mesh_clear()
    return t


def samling():
    c = bpy.data.collections.get(SAMLING)
    if c is None:
        c = bpy.data.collections.new(SAMLING)
        bpy.context.scene.collection.children.link(c)
    return c


def i_arenan(p):
    return (p.x / ARENA_RX) ** 2 + (p.y / ARENA_RY) ** 2 < 1.0


# ---------------------------------------------------------------------
# 2. Trappor
# ---------------------------------------------------------------------
def trappor(R):
    mat = bpy.data.materials.get("MAT_Sten_Trappa")
    if not mat:
        R.append("  MAT_Sten_Trappa saknas – kör Fas B v1.1 först. Trappor orörda.")
        return
    n = 0
    for o in synliga():
        namn = o.name.lower()
        if "trapp" not in namn or "trapptorn" in namn or "brostvarn" in namn or "racken" in namn:
            continue
        for s in o.material_slots:
            if s.material and s.material.name.startswith("MAT_Sten") and s.material != mat:
                s.material = mat
                n += 1
                R.append(f"  {o.name}: → MAT_Sten_Trappa")
    if not n:
        R.append("  inga nya (redan klart)")


# ---------------------------------------------------------------------
# 3. Äldre murmaterial byggs om från nya MAT_Sten_Mur
# ---------------------------------------------------------------------
def aldre_mur(R):
    bas = bpy.data.materials.get("MAT_Sten_Mur")
    gammal = bpy.data.materials.get("MAT_Sten_Mur_Aldre")
    if not bas:
        return
    ny = bas.copy()
    nt = ny.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    ut = bsdf.inputs["Base Color"].links[0].from_socket
    ton = nt.nodes.new("ShaderNodeVectorMath")
    ton.operation = "MULTIPLY"
    ton.name = ton.label = "ALDRE_TON"
    ton.inputs[1].default_value = (0.8, 0.8, 0.74)
    nt.links.new(ut, ton.inputs[0])
    nt.links.new(ton.outputs[0], bsdf.inputs["Base Color"])
    r = bsdf.inputs["Roughness"].links[0].from_socket
    rn = nt.nodes.new("ShaderNodeMath")
    rn.operation = "ADD"
    rn.use_clamp = True
    rn.inputs[1].default_value = 0.05
    nt.links.new(r, rn.inputs[0])
    nt.links.new(rn.outputs[0], bsdf.inputs["Roughness"])
    ny["ersatter"] = "BO_Mur (äldre parti)"
    ny["aldre_ton"] = [0.8, 0.8, 0.74]
    flyttade = 0
    if gammal:
        for o in bpy.data.objects:
            if o.type != "MESH":
                continue
            for s in o.material_slots:
                if s.material == gammal:
                    s.material = ny
                    flyttade += 1
        bpy.data.materials.remove(gammal)
    ny.name = "MAT_Sten_Mur_Aldre"
    R.append(f"  MAT_Sten_Mur_Aldre ombyggd från nya MAT_Sten_Mur ({flyttade} materialplatser)")


# ---------------------------------------------------------------------
# 4. Grounding vid murfoten
# ---------------------------------------------------------------------
def murfotskanter():
    """Nedre kanter på lodräta ytor hos sten-objekt som står på marken: (p1, p2, utåt)."""
    dg = bpy.context.evaluated_depsgraph_get()
    kanter = []
    for o in synliga():
        if any(k in o.name for k in INTE_MURFOT):
            continue
        mats = [s.material.name for s in o.material_slots if s.material]
        if not any(m in STENMATERIAL for m in mats):
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = o.matrix_world
        nm = mw.to_3x3().inverted().transposed()
        W = [mw @ v.co for v in me.vertices]
        if not W:
            ev.to_mesh_clear()
            continue
        zmin = min(w.z for w in W)
        if not (-0.15 < zmin < 0.35):
            ev.to_mesh_clear()
            continue
        for p in me.polygons:
            n = (nm @ p.normal)
            if abs(n.normalized().z) > 0.3:
                continue
            nh = Vector((n.x, n.y, 0))
            if nh.length < 1e-6:
                continue
            nh.normalize()
            vs = list(p.vertices)
            for i in range(len(vs)):
                a, b = W[vs[i]], W[vs[(i + 1) % len(vs)]]
                if a.z < zmin + 0.05 and b.z < zmin + 0.05 and (b - a).length > 0.3:
                    mitt = (a + b) / 2
                    if not i_arenan(mitt):
                        kanter.append((a.copy(), b.copy(), nh.copy(), o.name))
        ev.to_mesh_clear()
    return kanter


def markhojd(p, standard):
    """Höjden på marken/golvet just där (stråle rakt nedåt). Grus-/stenobjekten själva ignoreras."""
    dg = bpy.context.evaluated_depsgraph_get()
    start = Vector((p.x, p.y, p.z + 1.5))
    for _ in range(8):
        traff, plats, _n, _i, obj, _m = bpy.context.scene.ray_cast(dg, start, Vector((0, 0, -1)), distance=4.0)
        if not traff:
            return standard
        # hoppa över våra egna objekt och allt som ligger högre än 25 cm över murfoten (trappor, bänkar …)
        if (obj and obj.name in ("SM_Grus_Murfot", "SM_Grundstenar")) or plats.z > p.z + 0.25:
            start = plats - Vector((0, 0, 0.001))
            continue
        return plats.z
    return standard


def grus_remsa(kanter, rng):
    bm = bmesh.new()
    for a, b, n, _ in kanter:
        langd = (b - a).length
        steg = max(1, int(math.ceil(langd / 1.2)))
        pts_in = [a.lerp(b, i / steg) for i in range(steg + 1)]
        pts_ut = [p + n * rng.uniform(*GRUS_BREDD) for p in pts_in]
        # varje punkt läggs 1,2 cm ovanpå den mark som faktiskt finns där (gårdens stenläggning m.m.)
        def pa_marken(q):
            prov = q + n * 0.05
            return Vector((q.x, q.y, markhojd(prov, q.z) + 0.012))
        vin = [bm.verts.new(pa_marken(p)) for p in pts_in]
        vut = [bm.verts.new(pa_marken(p)) for p in pts_ut]
        for i in range(steg):
            f = bm.faces.new([vin[i], vin[i + 1], vut[i + 1], vut[i]])
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
    return bm


def grund_stenar(kanter, rng):
    bm = bmesh.new()
    for a, b, n, _ in kanter:
        langd = (b - a).length
        antal = int(langd / STEN_AVSTAND)
        tangent = (b - a).normalized()
        for i in range(antal):
            if rng.random() > STEN_CHANS:
                continue
            p = a + tangent * ((i + rng.random()) * STEN_AVSTAND) + n * rng.uniform(0.05, 0.35)
            r = rng.uniform(*STEN_STORLEK)
            res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
            vs = res["verts"]
            hz = markhojd(p, p.z)
            rot = Euler((rng.uniform(0, 6.3), rng.uniform(0, 6.3), rng.uniform(0, 6.3))).to_matrix()
            for v in vs:
                v.co = rot @ (v.co * rng.uniform(0.8, 1.15))      # ojämn form
                v.co.x *= r * rng.uniform(0.9, 1.3)
                v.co.y *= r * rng.uniform(0.9, 1.3)
                v.co.z *= r * 0.6
                v.co += Vector((p.x, p.y, hz + r * 0.15))   # ca en tredjedel under marken
    return bm


def lad_uv(o):
    me = o.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    for p in me.polygons:
        ax = max(range(3), key=lambda i: abs(p.normal[i]))
        for li in p.loop_indices:
            w = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (w.x, w.y) if ax == 2 else ((w.y, w.z) if ax == 0 else (w.x, w.z))


def skapa_objekt(namn, bm, material, col):
    gammal = bpy.data.objects.get(namn)
    if gammal:
        me_gammal = gammal.data
        bpy.data.objects.remove(gammal, do_unlink=True)
        if me_gammal.users == 0:
            bpy.data.meshes.remove(me_gammal)
    me = bpy.data.meshes.new(namn)
    bm.to_mesh(me)
    bm.free()
    m = bpy.data.materials.get(material)
    if m:
        me.materials.append(m)
    o = bpy.data.objects.new(namn, me)
    col.objects.link(o)
    lad_uv(o)
    return o


# ---------------------------------------------------------------------
# HUVUDPROGRAM
# ---------------------------------------------------------------------
def kor():
    if not bpy.data.filepath:
        raise RuntimeError("Spara .blend-filen först (File > Save).")
    if not bpy.data.materials.get("MAT_Sten_Mur"):
        raise RuntimeError("Kör Fas B (02_fasB_material.py) först.")
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    R = []
    mapp = os.path.join(bpy.path.abspath("//"), "versioner")
    os.makedirs(mapp, exist_ok=True)
    kopia = os.path.join(mapp, time.strftime("fore_fasD_%Y%m%d_%H%M%S.blend"))
    bpy.ops.wm.save_as_mainfile(filepath=kopia, copy=True)
    R.append(f"Säkerhetskopia: {kopia}")

    # gamla grounding-objekt räknas inte in i "före" vid omkörning
    for namn in ("SM_Grus_Murfot", "SM_Grundstenar"):
        o = bpy.data.objects.get(namn)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
    fore_obj, fore_tris = len(synliga()), trianglar_totalt()

    R.append("\nSLITNA TRAPPOR:")
    trappor(R)
    R.append("\nÄLDRE MURPARTIER:")
    aldre_mur(R)

    R.append("\nGROUNDING VID MURFOTEN:")
    rng = random.Random(1337)   # samma resultat varje gång
    kanter = murfotskanter()
    col = samling()
    grus = skapa_objekt("SM_Grus_Murfot", grus_remsa(kanter, rng), "MAT_Mark_Vag", col)
    stenar = skapa_objekt("SM_Grundstenar", grund_stenar(kanter, rng), "MAT_Sten_Mur", col)
    total = sum((a - b).length for a, b, _, _ in kanter)
    objekt_med = sorted({k[3] for k in kanter})
    R.append(f"  Murfot hittad: {len(kanter)} kanter, {total:.0f} m, på {len(objekt_med)} objekt")
    R.append(f"  SM_Grus_Murfot: {len(grus.data.polygons)} ytor  |  SM_Grundstenar: "
             f"{len(stenar.data.polygons)} trianglar (≈{len(stenar.data.polygons) // 20} stenar)")

    bpy.context.view_layer.update()
    efter_obj, efter_tris = len(synliga()), trianglar_totalt()
    R.insert(1, f"Synliga objekt: före {fore_obj}, efter {efter_obj}")
    R.insert(2, f"Trianglar (synliga): före {fore_tris}, efter {efter_tris} "
                f"({(efter_tris - fore_tris) / max(1, fore_tris) * 100:+.1f} %)")
    R.append("\nBegränsningar:")
    R.append("  - Skador på enskilda utsatta hörn kräver unika texturer per objekt; i stället har alla stenkanter")
    R.append("    vittring i materialet och mossan/smutsen är riktad efter höjd och skuggsida.")
    R.append("  - Mossa, smuts och nötta trappsteg beror på läge/riktning i världen och bakas inte in i")
    R.append("    kakeltexturerna – spelets shader gör samma sak (Fas E).")
    text = "FAS D – SLITAGE OCH GROUNDING\n" + "\n".join(R)
    print(text)
    t = bpy.data.texts.get("FAS_D_rapport") or bpy.data.texts.new("FAS_D_rapport")
    t.clear()
    t.write(text)
    return text


resultat_text = kor()
