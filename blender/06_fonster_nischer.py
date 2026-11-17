# =====================================================================
#  BRAWL MED BOYSEN – FÖNSTERNISCHER (ersätter de platta svarta fönstren)
#  Klistra in i Blenders Scripting-flik och tryck "Run Script" (Alt+P).
#  Kör Fas B v1.3 först (materialen MAT_Fonster_Inre och MAT_Fonster_Varm måste finnas).
#
#  Utgångsläge (uppmätt): varje fönster är en 10 cm tjock svart låda som sticker ut 2 cm ur väggen.
#  Det finns ingen öppning bakom, därför ser fönstren ut som platta svarta fyrkanter.
#
#  Vad skriptet gör:
#   1. Säkerhetskopia i undermappen "versioner".
#   2. För varje fönster mäts väggens tjocklek bakom (stråle genom väggen) och en nisch skärs ut
#      med en Boolean-modifierare (Exact) på väggen. Djupet anpassas: högst 35 cm, aldrig genom väggen.
#      Nischens sidor får ljus huggen sten (trä på trähus), insidan ett mörkt brungrått material.
#      Väggarna ändras inte direkt – det är en modifierare som kan tas bort, och snittkropparna
#      ligger dolda i samlingen "99_Snitt".
#   3. Större fönster (bostäder, salar, porthus) får ett diskret träkors (SM_Fonsterkors).
#   4. Ungefär var tredje bostadsfönster får MAT_Fonster_Varm (spelet tänder ett svagt varmt sken
#      där på kvällen). Skottgluggar lyser aldrig.
#   5. De gamla svarta fönsterlådorna flyttas till "99_Arkiv" (de raderas inte).
#   6. Rapport: antal nischer, trianglar före/efter.
#  Kan köras flera gånger: snitt, kors och modifierare byggs om från början.
# =====================================================================
import bpy
import bmesh
import math
import os
import random
import time
from mathutils import Vector

FONSTER = ["Fonster_Karna", "Fonster_Porthus", "Fonster_Tradhus", "Skottgluggar_Torn", "Portmur_Skottgluggar"]
SKOTTGLUGG = ("Skottgluggar_Torn", "Portmur_Skottgluggar")
TRAHUS = ("Fonster_Tradhus",)
MAX_DJUP = 0.35
MIN_DJUP = 0.08
UTSTICK = 0.04          # snittet börjar så här långt utanför väggytan (ren kant)
VARM_ANDEL = 0.33
SNITT_SAMLING = "99_Snitt"
ARKIV = "99_Arkiv"


def synliga():
    return [o for o in bpy.context.view_layer.objects if o.type == "MESH" and o.visible_get()]


def trianglar():
    dg = bpy.context.evaluated_depsgraph_get()
    t = 0
    for o in synliga():
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        t += sum(len(p.vertices) - 2 for p in me.polygons)
        ev.to_mesh_clear()
    return t


def samling(namn, utesluten):
    c = bpy.data.collections.get(namn)
    if c is None:
        c = bpy.data.collections.new(namn)
        bpy.context.scene.collection.children.link(c)
    lc = bpy.context.view_layer.layer_collection.children.get(namn)
    if lc is not None:
        lc.exclude = utesluten
    return c


def delar(o):
    """Lösa delar (en låda per fönster) i världskoordinater: lista av (punkter, ytor)."""
    me = o.data
    mw = o.matrix_world
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    sett = set()
    ut = []
    for v in bm.verts:
        if v.index in sett:
            continue
        stack, komp = [v], []
        while stack:
            a = stack.pop()
            if a.index in sett:
                continue
            sett.add(a.index)
            komp.append(a)
            for e in a.link_edges:
                stack.append(e.other_vert(a))
        idx = {x.index for x in komp}
        ytor = [(mw @ f.calc_center_median(), (mw.to_3x3() @ f.normal).normalized(), f.calc_area(),
                 [mw @ x.co for x in f.verts]) for f in bm.faces if f.verts[0].index in idx]
        ut.append(ytor)
    bm.free()
    return ut


def stråle(dg, start, riktning, langd):
    traff, plats, _n, _i, obj, _m = bpy.context.scene.ray_cast(dg, start, riktning, distance=langd)
    return (plats, obj) if traff else (None, None)


def behall(bm, ytor):
    """Kopiera fönsterlådan som den är (den får nischernas mörkbruna insida i stället för svart)."""
    for _c, _n, _a, pts in ytor:
        bm.faces.new([bm.verts.new(p) for p in pts])


def lad_uv(me):
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    for p in me.polygons:
        ax = max(range(3), key=lambda i: abs(p.normal[i]))
        for li in p.loop_indices:
            w = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (w.x, w.y) if ax == 2 else ((w.y, w.z) if ax == 0 else (w.x, w.z))


def kor():
    if not bpy.data.filepath:
        raise RuntimeError("Spara .blend-filen först (File > Save).")
    for m in ("MAT_Fonster_Inre", "MAT_Fonster_Varm", "MAT_Sten_Huggen", "MAT_Tra_Konstruktion", "MAT_Tra_Dorr"):
        if not bpy.data.materials.get(m):
            raise RuntimeError(f"Materialet {m} saknas – kör 02_fasB_material.py (v1.3) först.")
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    R = []
    mapp = os.path.join(bpy.path.abspath("//"), "versioner")
    os.makedirs(mapp, exist_ok=True)
    kopia = os.path.join(mapp, time.strftime("fore_fonster_%Y%m%d_%H%M%S.blend"))
    bpy.ops.wm.save_as_mainfile(filepath=kopia, copy=True)
    R.append(f"Säkerhetskopia: {kopia}")

    # Ta bort resultat från en tidigare körning
    for o in list(bpy.data.objects):
        if o.name.startswith("SNITT_") or o.name in ("SM_Fonsterkors", "SM_Fonster_Platta", "SM_Fonster_Varmt"):
            bpy.data.objects.remove(o, do_unlink=True)
    for o in bpy.data.objects:
        if o.type == "MESH":
            m = o.modifiers.get("Fonsternisch")
            if m:
                o.modifiers.remove(m)
    # Fönsterlådorna ska synas medan vi mäter (de kan ligga i arkivet från en tidigare körning)
    arkiv = samling(ARKIV, True)
    fonster_obj = [bpy.data.objects.get(n) for n in FONSTER if bpy.data.objects.get(n)]
    for o in fonster_obj:
        if arkiv in o.users_collection and o.get("ursprunglig_samling"):
            dit = bpy.data.collections.get(o["ursprunglig_samling"])
            if dit:
                dit.objects.link(o)
                arkiv.objects.unlink(o)
    bpy.context.view_layer.update()
    fore = trianglar()

    # Lådorna döljs medan vi skjuter strålar mot väggarna
    for o in fonster_obj:
        o.hide_viewport = True
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()

    snitt_per_vagg = {}       # väggobjekt -> bmesh med snittkroppar
    kors = bmesh.new()
    varmt = bmesh.new()       # varma fönster: en tunn platta strax framför nischens bakvägg
    platta = bmesh.new()      # fönster där en nisch inte får plats: behåll formen men med mörkbrun insida
    rng = random.Random(7)
    antal, hoppade = 0, []
    mats = {"sida_sten": 0, "sida_tra": 1, "inre": 2, "varm": 3}
    for o in fonster_obj:
        for ytor in delar(o):
            stora = sorted(ytor, key=lambda y: -y[2])[:2]
            if len(stora) < 2:
                continue
            # Vilken av de två stora ytorna är utsidan? Den vars väggyta ligger närmast bakom (lådan sticker ut 2 cm)
            kandidater = []
            for c, n, area, pts in stora:
                plats, vagg = stråle(dg, c + n * 0.3, -n, 0.6)
                if plats is not None:
                    kandidater.append(((c + n * 0.3 - plats).length - 0.3, c, n, area, pts, plats, vagg))
            if not kandidater:
                hoppade.append(f"{o.name}: ingen vägg bakom")
                behall(platta, ytor)
                continue
            kandidater.sort(key=lambda k: k[0])
            _, c, n, area, pts, ytan, vagg = kandidater[0]
            # Väggens tjocklek: från strax innanför ytan och vidare inåt tills strålen kommer ut på andra sidan
            inne = ytan - n * 0.01
            ut, _o2 = stråle(dg, inne, -n, 3.0)
            tjock = (ut - inne).length if ut is not None else 3.0
            djup = max(MIN_DJUP, min(MAX_DJUP, tjock - 0.08))
            if tjock < MIN_DJUP + 0.06:
                hoppade.append(f"{o.name}: väggen för tunn ({tjock:.2f} m)")
                behall(platta, ytor)
                continue
            # Fönstrets rektangel i väggens plan
            upp = Vector((0, 0, 1))
            sid = upp.cross(n)
            if sid.length < 1e-4:
                continue
            sid.normalize()
            hs = [(p - c).dot(sid) for p in pts]
            vs = [(p - c).dot(upp) for p in pts]
            b0, b1, h0, h1 = min(hs), max(hs), min(vs), max(vs)
            plan = c - n * ((c - ytan).dot(n))          # mitten på väggytan
            fram = plan + n * UTSTICK
            bak = plan - n * djup
            bm = snitt_per_vagg.setdefault(vagg.name, bmesh.new())
            hornen = [(b0, h0), (b1, h0), (b1, h1), (b0, h1)]
            vf = [bm.verts.new(fram + sid * x + upp * y) for x, y in hornen]
            vb = [bm.verts.new(bak + sid * x + upp * y) for x, y in hornen]
            skottglugg = o.name in SKOTTGLUGG
            sidmat = mats["sida_tra"] if o.name in TRAHUS else mats["sida_sten"]
            varm = (not skottglugg) and (b1 - b0) * (h1 - h0) > 0.3 and rng.random() < VARM_ANDEL
            inremat = mats["inre"]   # Booleans materialöverföring tappar ett fjärde material – varm yta läggs separat
            if varm:
                vv = [varmt.verts.new(bak + n * 0.004 + sid * x + upp * y) for x, y in hornen]
                varmt.faces.new(vv)
            f = bm.faces.new([vf[0], vf[1], vf[2], vf[3]])
            f.material_index = mats["inre"]                       # framsidan (utanför väggen, används inte)
            f = bm.faces.new([vb[3], vb[2], vb[1], vb[0]])
            f.material_index = inremat                            # nischens insida
            for i in range(4):
                j = (i + 1) % 4
                f = bm.faces.new([vf[i], vb[i], vb[j], vf[j]])
                f.material_index = sidmat                         # nischens sidor (smygar)
            # träkors i större fönster (inte skottgluggar)
            if not skottglugg and (b1 - b0) > 0.45 and (h1 - h0) > 0.7:
                mitt = plan - n * (djup * 0.55)
                for (x0, x1, y0, y1) in (((b0 + b1) / 2 - 0.03, (b0 + b1) / 2 + 0.03, h0, h1),
                                         (b0, b1, h0 + (h1 - h0) * 0.62 - 0.03, h0 + (h1 - h0) * 0.62 + 0.03)):
                    q = [mitt + sid * x + upp * y for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
                    fr = [kors.verts.new(p + n * 0.03) for p in q]
                    bk = [kors.verts.new(p - n * 0.03) for p in q]
                    kors.faces.new(fr)
                    kors.faces.new(list(reversed(bk)))
                    for i in range(4):
                        j = (i + 1) % 4
                        kors.faces.new([fr[i], bk[i], bk[j], fr[j]])
            antal += 1

    for o in fonster_obj:
        o.hide_viewport = False

    # Snittkroppar + Boolean-modifierare på väggarna
    snitt_col = samling(SNITT_SAMLING, False)
    matlista = [bpy.data.materials["MAT_Sten_Huggen"], bpy.data.materials["MAT_Tra_Konstruktion"],
                bpy.data.materials["MAT_Fonster_Inre"], bpy.data.materials["MAT_Fonster_Varm"]]
    for vaggnamn, bm in snitt_per_vagg.items():
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new("SNITT_" + vaggnamn)
        bm.to_mesh(me)
        bm.free()
        for m in matlista:
            me.materials.append(m)
        lad_uv(me)
        so = bpy.data.objects.new("SNITT_" + vaggnamn, me)
        snitt_col.objects.link(so)
        so.display_type = "WIRE"
        so.hide_render = True
        vagg = bpy.data.objects[vaggnamn]
        mod = vagg.modifiers.new("Fonsternisch", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.solver = "EXACT"
        mod.object = so
        if hasattr(mod, "material_mode"):
            mod.material_mode = "TRANSFER"
        # före fasning m.m.
        while vagg.modifiers.find("Fonsternisch") > 0:
            with bpy.context.temp_override(object=vagg, active_object=vagg):
                bpy.ops.object.modifier_move_up(modifier="Fonsternisch")
    snitt_col.hide_viewport = True     # snitten syns inte (och exporteras inte), men används av modifierarna
    lc = bpy.context.view_layer.layer_collection.children.get(SNITT_SAMLING)
    if lc:
        lc.hide_viewport = True

    # Fönster utan nisch
    if len(platta.faces):
        me = bpy.data.meshes.new("SM_Fonster_Platta")
        platta.to_mesh(me)
        me.materials.append(bpy.data.materials["MAT_Fonster_Inre"])
        lad_uv(me)
        po = bpy.data.objects.new("SM_Fonster_Platta", me)
        samling("COL_Environment_Detaljer", False).objects.link(po)
    platta.free()

    # Varma fönster (spelet tänder dem på kvällen)
    if len(varmt.faces):
        # hörnordningen ger normalen sid × upp = n, alltså utåt mot betraktaren
        me = bpy.data.meshes.new("SM_Fonster_Varmt")
        varmt.to_mesh(me)
        me.materials.append(bpy.data.materials["MAT_Fonster_Varm"])
        lad_uv(me)
        vo = bpy.data.objects.new("SM_Fonster_Varmt", me)
        samling("COL_Environment_Detaljer", False).objects.link(vo)
    antal_varma = len(varmt.faces)
    varmt.free()

    # Träkorsen
    if len(kors.faces):
        me = bpy.data.meshes.new("SM_Fonsterkors")
        kors.to_mesh(me)
        me.materials.append(bpy.data.materials["MAT_Tra_Dorr"])
        lad_uv(me)
        ko = bpy.data.objects.new("SM_Fonsterkors", me)
        samling("COL_Environment_Detaljer", False).objects.link(ko)
    kors.free()

    # Gamla svarta lådor till arkivet (sparar var de låg)
    for o in fonster_obj:
        if arkiv not in o.users_collection:
            o["ursprunglig_samling"] = o.users_collection[0].name
            for c in list(o.users_collection):
                c.objects.unlink(o)
            arkiv.objects.link(o)

    bpy.context.view_layer.update()
    efter = trianglar()
    R.append(f"Varma fönster: {antal_varma}")
    R.append(f"Nischer: {antal} fönster på {len(snitt_per_vagg)} väggar: " + ", ".join(sorted(snitt_per_vagg)))
    if hoppade:
        R.append(f"Ingen plats för nisch ({len(hoppade)} st, behåller formen med mörkbrun insida): "
                 + "; ".join(hoppade[:8]) + (" …" if len(hoppade) > 8 else ""))
    R.append(f"Trianglar (synliga): före {fore}, efter {efter} ({(efter - fore) / max(1, fore) * 100:+.1f} %)")
    text = "FÖNSTERNISCHER\n" + "\n".join(R)
    print(text)
    t = bpy.data.texts.get("FONSTER_rapport") or bpy.data.texts.new("FONSTER_rapport")
    t.clear()
    t.write(text)
    return text


resultat_text = kor()
