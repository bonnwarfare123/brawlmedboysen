# =====================================================================
#  BRAWL MED BOYSEN – FAS E: BAKNING OCH GLB-EXPORT
#  Klistra in i Blenders Scripting-flik och tryck "Run Script" (Alt+P).
#  Kör Fas B–D först. Bakningen tar några minuter (Blender svarar inte under tiden).
#
#  Vad skriptet gör:
#   1. Säkerhetskopia i undermappen "versioner".
#   2. Bakar varje MAT_-material EN gång till sömlösa kakelbilder:
#        T_<material>_C.png  färg (sRGB)
#        T_<material>_R.png  roughness (Non-Color)
#        T_<material>_M.png  metallic (bara järn)
#        T_<material>_N.png  normal map i tangentrymd (Non-Color, OpenGL/glTF-standard)
#      Bilderna sparas i undermappen "texturer". Alla objekt med samma material delar bilderna.
#      Bakningen görs på en tillfällig platta som täcker exakt ett kakel, med "världs-delen"
#      (VARLD_FAKTOR) avstängd – smuts/mossa nertill görs i spelets shader i stället.
#   3. Skapar exportmaterial "<material>__B" som bara använder de bakade bilderna
#      (UV → Mapping (1/kakel) → bilder → Principled BSDF). glTF klarar bara den typen.
#   4. Exporterar export/borg.glb (bara synliga objekt, modifierare applicerade,
#      Y uppåt, texturer inbäddade som WebP, materialens egenskaper som "extras").
#   5. Lägger tillbaka procedurmaterialen på objekten, så att du kan fortsätta jobba i Blender.
#   6. Rapport: trianglar, objekt, material, texturer och filstorlek.
#
#  Inget i scenen raderas. Skalan (1 enhet = 1 m) och arenans mitt (0,0,0) ändras inte.
# =====================================================================
import bpy
import os
import time

BAKA_STORLEK_MAX = 1024     # högsta upplösning (materialets "bake_res" används, aldrig mer än detta)
NORMAL_HALV = True          # normal maps i halva upplösningen för material under 1024 px
WEBP_KVALITET = 78

UTMAPP_TEX = "texturer"
UTMAPP_EXPORT = "export"


def mappar():
    bas = bpy.path.abspath("//")
    tex = os.path.join(bas, UTMAPP_TEX)
    exp = os.path.join(bas, UTMAPP_EXPORT)
    os.makedirs(tex, exist_ok=True)
    os.makedirs(exp, exist_ok=True)
    return bas, tex, exp


def exportobjekt():
    """Synliga mesh-objekt + dolda Boolean-snitt som lämnar material i dem (fönsternischer)."""
    ut = []
    for o in bpy.context.view_layer.objects:
        if o.type == "MESH" and o.visible_get():
            ut.append(o)
            for md in o.modifiers:
                if md.type == "BOOLEAN" and md.show_render and md.object and md.object not in ut:
                    ut.append(md.object)
    return ut


def bakbara_material():
    """MAT_-material med procedur-noder (från Fas B) som används av synliga objekt."""
    anv = set()
    for o in exportobjekt():
        if True:
            for s in o.material_slots:
                if s.material:
                    anv.add(s.material)
    return sorted([m for m in anv if m.get("typ") and m.get("typ") != "enkel" and not m.name.endswith("__B")],
                  key=lambda m: m.name)


# ---------------------------------------------------------------------
# Bakning
# ---------------------------------------------------------------------
def bakplatta():
    """Platta med UV 0..1 (= hela bakbilden). Materialets kakelmappning sätts till 1 under bakningen,
    så att plattan visar exakt ett kakel."""
    namn = "TMP_Bakplatta"
    gammal = bpy.data.objects.get(namn)
    if gammal:
        bpy.data.objects.remove(gammal, do_unlink=True)
    me = bpy.data.meshes.new(namn)
    me.from_pydata([(0, 0, -200), (1, 0, -200), (1, 1, -200), (0, 1, -200)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for li, (x, y) in zip(range(4), [(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[li].uv = (x, y)
    ob = bpy.data.objects.new(namn, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def ny_bild(namn, storlek, data):
    img = bpy.data.images.get(namn)
    if img and (img.size[0] != storlek):
        bpy.data.images.remove(img)
        img = None
    if img is None:
        img = bpy.data.images.new(namn, storlek, storlek, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if data else "sRGB"
    return img


def kalla(sock):
    """Det som är kopplat till en ingång (eller None om den bara har ett värde)."""
    return sock.links[0].from_socket if sock.is_linked else None


def baka_material(m, texmapp, R):
    sc = bpy.context.scene
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    ut = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if not bsdf or not ut:
        R.append(f"  {m.name}: saknar Principled/Output – hoppar över")
        return None
    storlek = min(BAKA_STORLEK_MAX, int(m.get("bake_res", 512)))
    tile_u = 1.0 if m.get("uv01") else float(m.get("tile_u", 1.0))
    tile_v = 1.0 if m.get("uv01") else float(m.get("tile_v", tile_u))

    platta = bakplatta()
    mappning = nt.nodes.get("KAKEL_MAPPNING")
    mappning_skala = tuple(mappning.inputs["Scale"].default_value) if mappning else None
    if mappning:
        mappning.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
    platta.data.materials.append(m)
    bpy.ops.object.select_all(action="DESELECT")
    platta.select_set(True)
    bpy.context.view_layer.objects.active = platta

    vf = nt.nodes.get("VARLD_FAKTOR")
    vf_gammal = vf.outputs[0].default_value if vf else None
    if vf:
        vf.outputs[0].default_value = 0.0

    tex_nod = nt.nodes.new("ShaderNodeTexImage")
    tex_nod.name = "TMP_BAKMAL"
    nt.nodes.active = tex_nod
    yta_lank = ut.inputs["Surface"].links[0] if ut.inputs["Surface"].is_linked else None
    yta_kalla = yta_lank.from_socket if yta_lank else None
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.name = "TMP_EMIT"

    bilder = {}
    try:
        def baka_kanal(suffix, ingang, data, storl):
            img = ny_bild(f"T_{m.name}_{suffix}", storl, data)
            tex_nod.image = img
            src = kalla(bsdf.inputs[ingang])
            if src is not None:
                nt.links.new(src, emit.inputs["Color"])
            else:
                v = bsdf.inputs[ingang].default_value
                emit.inputs["Color"].default_value = tuple(v) if hasattr(v, "__len__") else (v, v, v, 1.0)
                for l in list(emit.inputs["Color"].links):
                    nt.links.remove(l)
            nt.links.new(emit.outputs[0], ut.inputs["Surface"])
            sc.cycles.samples = 1
            bpy.ops.object.bake(type="EMIT", margin=2, use_clear=True)
            img.filepath_raw = os.path.join(texmapp, f"T_{m.name}_{suffix}.png")
            img.file_format = "PNG"
            img.save()
            return img

        bilder["C"] = baka_kanal("C", "Base Color", False, storlek)
        bilder["R"] = baka_kanal("R", "Roughness", True, storlek)
        if bsdf.inputs["Metallic"].is_linked or bsdf.inputs["Metallic"].default_value > 0.01:
            bilder["M"] = baka_kanal("M", "Metallic", True, storlek)

        # normal map (Bump-noden i materialet ger ytstrukturen)
        if yta_kalla:
            nt.links.new(yta_kalla, ut.inputs["Surface"])
        nstorl = storlek if (storlek >= 1024 or not NORMAL_HALV) else max(256, storlek // 2)
        img = ny_bild(f"T_{m.name}_N", nstorl, True)
        tex_nod.image = img
        sc.cycles.samples = 4
        sc.render.bake.normal_space = "TANGENT"
        bpy.ops.object.bake(type="NORMAL", margin=2, use_clear=True)
        img.filepath_raw = os.path.join(texmapp, f"T_{m.name}_N.png")
        img.file_format = "PNG"
        img.save()
        bilder["N"] = img
    finally:
        # återställ materialet exakt som det var
        if yta_kalla:
            nt.links.new(yta_kalla, ut.inputs["Surface"])
        nt.nodes.remove(emit)
        nt.nodes.remove(tex_nod)
        if vf:
            vf.outputs[0].default_value = vf_gammal
        if mappning:
            mappning.inputs["Scale"].default_value = mappning_skala
        me = platta.data
        bpy.data.objects.remove(platta, do_unlink=True)
        bpy.data.meshes.remove(me)
    R.append(f"  {m.name:24s} {storlek}px  " + " ".join(sorted(bilder)))
    return bilder, tile_u, tile_v


# ---------------------------------------------------------------------
# Exportmaterial med bara bildtexturer
# ---------------------------------------------------------------------
def exportmaterial(m, bilder, tile_u, tile_v):
    namn = m.name + "__B"
    b = bpy.data.materials.get(namn) or bpy.data.materials.new(namn)
    b.use_nodes = True
    nt = b.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / tile_u, 1 / tile_v, 1.0)
    nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    ut = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs[0], ut.inputs["Surface"])

    def bild(img):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        n.extension = "REPEAT"
        nt.links.new(mp.outputs[0], n.inputs["Vector"])
        return n

    nt.links.new(bild(bilder["C"]).outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bild(bilder["R"]).outputs["Color"], bsdf.inputs["Roughness"])
    if "M" in bilder:
        nt.links.new(bild(bilder["M"]).outputs["Color"], bsdf.inputs["Metallic"])
    else:
        bsdf.inputs["Metallic"].default_value = 0.0
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(bild(bilder["N"]).outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if m.get("typ") == "tyg" and "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = 0.6
    b.use_backface_culling = m.use_backface_culling
    for k in m.keys():           # tile, typ, världseffekter … följer med som glTF "extras"
        b[k] = m[k]
    b["kakel_u"] = tile_u
    b["kakel_v"] = tile_v
    b.use_fake_user = True
    return b


def enkla_exportmaterial():
    """Eld och fönster behöver ingen bakning – kopiera bara egenskaperna."""
    par = {}
    for m in bpy.data.materials:
        if m.get("typ") == "enkel" and not m.name.endswith("__B"):
            par[m] = m
    return par


# ---------------------------------------------------------------------
# HUVUDPROGRAM
# ---------------------------------------------------------------------
def mata(R, rubrik):
    dg = bpy.context.evaluated_depsgraph_get()
    obj = [o for o in bpy.context.view_layer.objects if o.type == "MESH" and o.visible_get()]
    t = 0
    for o in obj:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        t += sum(len(p.vertices) - 2 for p in me.polygons)
        ev.to_mesh_clear()
    mats = {s.material.name for o in obj for s in o.material_slots if s.material}
    R.append(f"{rubrik}: {len(obj)} synliga objekt, {t} trianglar, {len(mats)} material")
    return len(obj), t, len(mats)


def forbered(R):
    if not bpy.data.filepath:
        raise RuntimeError("Spara .blend-filen först (File > Save).")
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bas, tex, exp = mappar()
    kopia = os.path.join(bas, "versioner", time.strftime("fore_fasE_%Y%m%d_%H%M%S.blend"))
    os.makedirs(os.path.dirname(kopia), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=kopia, copy=True)
    R.append(f"Säkerhetskopia: {kopia}")
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    return tex, exp


def exportera(exp, R):
    """Byt till bakade material, exportera, byt tillbaka."""
    bytta = []
    for o in exportobjekt():
        for i, s in enumerate(o.material_slots):
            if s.material and not s.material.name.endswith("__B"):
                b = bpy.data.materials.get(s.material.name + "__B")
                if b:
                    bytta.append((s, s.material))
                    s.material = b
    ut = os.path.join(exp, "borg.glb")
    # Färgattributet "Vind" (tyg och eld, skript 10) följer med som COLOR_0: spelet använder det
    # för vind i flaggor och fladder i lågor. Namnen på exportinställningen skiljer mellan Blender-versioner.
    farg = {}
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    if "export_vertex_color" in props:
        farg["export_vertex_color"] = "ACTIVE"
        if "export_active_vertex_color_when_no_material" in props:
            farg["export_active_vertex_color_when_no_material"] = True
        if "export_all_vertex_colors" in props:
            farg["export_all_vertex_colors"] = False
    elif "export_colors" in props:
        farg["export_colors"] = True
    try:
        bpy.ops.export_scene.gltf(
            filepath=ut, export_format="GLB", use_visible=True, export_apply=True, export_yup=True,
            export_texcoords=True, export_normals=True, export_tangents=False,
            export_materials="EXPORT", export_image_format="WEBP", export_image_quality=WEBP_KVALITET,
            export_extras=True, export_lights=False, export_cameras=False, export_animations=False, **farg)
    finally:
        for s, mat in bytta:
            s.material = mat
    storlek = os.path.getsize(ut)
    R.append(f"Export: {ut}  ({storlek / 1048576:.2f} MB)  – procedurmaterialen är tillbaka på {len(bytta)} platser")
    return ut, storlek


def kor_allt():
    R = ["FAS E – BAKNING OCH EXPORT"]
    tex, exp = forbered(R)
    mata(R, "Scen")
    sc = bpy.context.scene
    gammal_motor = sc.render.engine
    R.append("Bakade material:")
    antal_bilder = 0
    for m in bakbara_material():
        if m.get("bk_kalla"):                    # BlenderKit-material (08): bilderna finns redan – ingen bakning
            bilder = {k: bpy.data.images.get(f"T_{m.name}_{k}") for k in "CRMN"}
            bilder = {k: v for k, v in bilder.items() if v}
            if "C" in bilder and "N" in bilder and "R" in bilder:
                exportmaterial(m, bilder, float(m.get("tile_u", 1.0)), float(m.get("tile_v", 1.0)))
                antal_bilder += len(bilder)
                R.append(f"  {m.name:24s} BlenderKit ({m['bk_kalla']}) – ingen bakning")
                continue
        res = baka_material(m, tex, R)
        if res:
            bilder, tu, tv = res
            exportmaterial(m, bilder, tu, tv)
            antal_bilder += len(bilder)
    for m in enkla_exportmaterial():
        if not bpy.data.materials.get(m.name + "__B"):
            b = m.copy()
            b.name = m.name + "__B"
            b.use_fake_user = True
    R.append(f"Unika texturer: {antal_bilder} (i mappen {UTMAPP_TEX})")
    exportera(exp, R)
    sc.render.engine = gammal_motor
    bpy.ops.wm.save_mainfile()
    text = "\n".join(R)
    print(text)
    t = bpy.data.texts.get("FAS_E_rapport") or bpy.data.texts.new("FAS_E_rapport")
    t.clear()
    t.write(text)
    return text


if __name__ == "__main__":
    resultat_text = kor_allt()
