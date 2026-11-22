# =====================================================================
#  BRAWL MED BOYSEN – KUNGABORGEN: MATERIAL FRÅN BLENDERKIT
#  Klistra in i Scripting-fliken (borg_aktuell.blend) och kör.
#  Kräver att BlenderKit-tillägget är inloggat och att 05_fasE_bake_export.py ligger bredvid filen.
#
#  Körning 1: laddar ner de valda BlenderKit-materialen (gratis, royalty free / CC0) i bakgrunden.
#  Körning 2 (när nedladdningen är klar – skriptet säger till): bygger om materialen och exporterar.
#
#  Vad skriptet gör med varje valt material (MAT_Sten_Mur, MAT_Tra_Laktare …):
#   1. Tar BlenderKit-materialets bilder (färg, roughness, normal map, ev. metallic).
#   2. Tonar färgen mot borgens tidigare färg (samma medelfärg som de gamla bakade texturerna),
#      så paletten består men ytan blir riktig sten/trä/skiffer.
#   3. Sparar dem som T_<material>_C/R/N(/M).png i mappen texturer (samma namn som bakningen använder).
#   4. Bygger om Blender-materialet med bilderna (UV → kakel → bilder), så Blender visar samma sak.
#      Egenskaperna (smuts, mossa, trappa, kakelstorlek …) följer med till spelet som förut.
#   5. Gör exportmaterialet <material>__B och exporterar export/borg.glb (ingen bakning behövs).
#  Säkerhetskopia i versioner/ före ändringarna. Övriga material (tyg, eld, fönster, arenasand,
#  korsvirke) rörs inte.
# =====================================================================
import bpy
import os
import sys
import time
import importlib.util
import numpy as np

# material: (BlenderKit-id (början), sökord, kakel i meter, upplösning)
VAL = {
    "MAT_Sten_Mur":         ("93646829", "ashlar stone", 2.5, 1024),
    "MAT_Sten_Mur_Aldre":   ("a30d5097", "medieval stone wall", 2.0, 1024),
    "MAT_Sten_Huggen":      ("715b9424", "medieval stone wall", 2.5, 1024),
    "MAT_Sten_Port":        ("d549d87d", "castle wall", 2.5, 1024),
    "MAT_Sten_Hallar":      ("715b9424", "medieval stone wall", 2.0, 512),
    "MAT_Sten_Trappa":      ("715b9424", "medieval stone wall", 2.0, 512),
    "MAT_Sten_Kullersten":  ("b2f5e062", "cobblestone", 1.6, 1024),
    "MAT_Tra_Konstruktion": ("5a7b524b", "old wood planks", 1.4, 1024),
    "MAT_Tra_Laktare":      ("55dabd78", "old wood planks", 1.4, 1024),
    "MAT_Tra_Dorr":         ("2764cc77", "weathered wood", 1.2, 512),
    "MAT_Tra_Barriar":      ("98e7c533", "weathered wood", 1.4, 512),
    "MAT_Tak_Skiffer":      ("22e28363", "slate roof", 2.0, 1024),
    "MAT_Tak_Spon":         ("d8169f70", "wood shingles roof", 1.5, 1024),
    "MAT_Tak_Tegel":        ("c4b85783", "roof tiles", 1.5, 1024),
    "MAT_Metall_Jarn":      ("3175de84", "dark iron metal", 0.6, 512),
    "MAT_Mark_Vag":         ("170d6ae2", "dirt path", 3.0, 1024),
    "MAT_Mark_Gras":        ("3906f27c", "grass ground", 3.0, 1024),
    "MAT_Mark_Grav":        ("61e59981", "dirt path", 3.0, 512),
    "MAT_Mark_Arena":       ("550bfe17", "sand ground", 4.0, 1024),
}
# trä: BlenderKit-plankorna står lodrätt i bilden – vrids 90° så att de ligger som borgens gamla (vågräta)
ROTERA = {"MAT_Tra_Konstruktion", "MAT_Tra_Laktare", "MAT_Tra_Dorr", "MAT_Tra_Barriar"}
HALV_RN = True         # roughness och normal map i halva upplösningen (mindre fil, syns knappt)
TONING = 0.75          # hur mycket färgen dras mot borgens gamla medelfärg (0 = BlenderKits färg, 1 = helt)
SAMLING = "GR_BK_BORG"
R = []


def bk():
    namn = "bl_ext.user_default.blenderkit"
    if namn not in sys.modules:
        raise RuntimeError("BlenderKit-tillägget är inte aktiverat.")
    g = lambda s: sys.modules[f"{namn}.{s}"]
    api = bpy.context.preferences.addons[namn].preferences.api_key
    if not api:
        raise RuntimeError("Logga in i BlenderKit först.")
    return g("paths"), g("utils"), g("client_lib"), g("search"), g("download"), g("utils").get_headers(api)


def provobjekt(id8):
    return bpy.data.objects.get(f"GR_BK_{id8}")


def nedladdat(id8):
    o = provobjekt(id8)
    return o is not None and o.data.materials and o.data.materials[0] is not None


def ladda_ner():
    paths, utils, cl, S, D, headers = bk()
    kol = bpy.data.collections.get(SAMLING)
    if kol is None:
        kol = bpy.data.collections.new(SAMLING)
        bpy.context.scene.collection.children.link(kol)
    kol.hide_render = True
    kol.hide_viewport = True
    startade = []
    for mat, (id8, sok, _, _) in VAL.items():
        if nedladdat(id8) or id8 in startade:
            continue
        url = f"{paths.BLENDKIT_API}/search/?query={sok.replace(' ', '+')}+asset_type:material+is_free:true&page_size=40&dict_parameters=1"
        res = cl.blocking_request(url, "GET", headers).json().get("results", [])
        hit = [x for x in res if x["assetBaseId"].startswith(id8)]
        if not hit:
            R.append(f"  {mat}: hittar inte BlenderKit-materialet {id8}")
            continue
        ad = S.parse_result(hit[0])
        o = provobjekt(id8)
        if o is None:
            me = bpy.data.meshes.new(f"GR_BK_{id8}")
            me.from_pydata([(0, 0, -300), (1, 0, -300), (1, 1, -300)], [], [(0, 1, 2)])
            me.materials.append(None)
            o = bpy.data.objects.new(f"GR_BK_{id8}", me)
            kol.objects.link(o)
        D.start_download(ad, model_location=(0, 0, 0), model_rotation=(0, 0, 0), target_object=o.name,
                         material_target_slot=0, resolution="resolution_1K")
        startade.append(id8)
        R.append(f"  laddar ner {hit[0]['name']} ({hit[0].get('license')}) → {mat}")
    return startade


# ---------------------------------------------------------------- bilder ur BlenderKit-materialet
def mal_for(sock, djup=0):
    ut = []
    for l in sock.links:
        n = l.to_node
        if n.type == "BSDF_PRINCIPLED":
            ut.append(l.to_socket.name)
        elif djup < 6:
            for o in n.outputs:
                ut += [f"{n.type}>{x}" for x in mal_for(o, djup + 1)]
    return ut


def kanaler(m):
    ut = {}
    for n in m.node_tree.nodes:
        if n.type != "TEX_IMAGE" or not n.image:
            continue
        namn = n.image.name.lower()
        mal = mal_for(n.outputs["Color"])
        if any("NORMAL_MAP" in d for d in mal) or "normal" in namn:
            ut.setdefault("N", n.image)
            ut["N_dx"] = "dx" in namn or "directx" in namn
        elif any(d.endswith("Roughness") for d in mal) or "rough" in namn or "gloss" in namn:
            ut.setdefault("R", n.image)
            ut["R_inv"] = any("INVERT" in d for d in mal) or "gloss" in namn
        elif any(d.endswith("Metallic") for d in mal) or "metal" in namn:
            ut.setdefault("M", n.image)
        elif (any(d.endswith("Base Color") for d in mal) or "color" in namn or "albedo" in namn or "diff" in namn) \
                and "ambient" not in namn and "_ao" not in namn and "occlusion" not in namn:
            ut.setdefault("C", n.image)
    return ut


def pixlar(img, s, vrid=False, normal=False):
    kop = img.copy()
    kop.scale(s, s)
    px = np.empty(s * s * 4, dtype=np.float32)
    kop.pixels.foreach_get(px)
    bpy.data.images.remove(kop)
    px = px.reshape(s, s, 4)
    if vrid:
        px = np.rot90(px, k=1).copy()               # (x, y) → (y, −x)
        if normal:
            nx, ny = px[:, :, 0] * 2 - 1, px[:, :, 1] * 2 - 1
            px[:, :, 0] = ny * 0.5 + 0.5
            px[:, :, 1] = -nx * 0.5 + 0.5
    return px.reshape(-1, 4)


def gammal_medelfarg(mat, texmapp):
    fil = os.path.join(texmapp, f"T_{mat}_C.png")
    if not os.path.exists(fil):
        return None
    img = bpy.data.images.load(fil, check_existing=False)
    try:
        px = pixlar(img, 64)
    finally:
        bpy.data.images.remove(img)
    return px[:, :3].mean(axis=0)


def skriv(namn, px, s, data, texmapp):
    img = bpy.data.images.get(namn)
    if img is not None and tuple(img.size) != (s, s):
        bpy.data.images.remove(img)
        img = None
    if img is None:
        img = bpy.data.images.new(namn, s, s, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if data else "sRGB"
    img.pixels.foreach_set(np.clip(px, 0, 1).astype(np.float32).ravel())
    img.filepath_raw = os.path.join(texmapp, f"{namn}.png")
    img.file_format = "PNG"
    img.save()
    img.reload()
    return img


def pixlar_vrid_normal(n, s):
    px = np.rot90(n.reshape(s, s, 4), k=1).copy()
    nx, ny = px[:, :, 0] * 2 - 1, px[:, :, 1] * 2 - 1
    px[:, :, 0] = ny * 0.5 + 0.5
    px[:, :, 1] = -nx * 0.5 + 0.5
    return px.reshape(-1, 4)


def bygg_bilder(mat, k, s, texmapp, metall):
    bilder = {}
    v = mat in ROTERA
    s2 = max(256, s // 2) if HALV_RN else s
    c = pixlar(k["C"], s, v)
    mal_rgb = gammal_medelfarg(mat, texmapp)
    if mal_rgb is not None:
        egen = c[:, :3].mean(axis=0)
        faktor = 1.0 + TONING * (mal_rgb / np.maximum(egen, 1e-3) - 1.0)
        c[:, :3] *= faktor
    c[:, 3] = 1.0
    bilder["C"] = skriv(f"T_{mat}_C", c, s, False, texmapp)
    if "R" in k:
        r = pixlar(k["R"], s2, v)
        rv = r[:, 0:1]
        if k.get("R_inv"):
            rv = 1.0 - rv
        r = np.concatenate([rv, rv, rv, np.ones_like(rv)], axis=1)
    else:
        r = np.full((s2 * s2, 4), 0.75, dtype=np.float32)
    bilder["R"] = skriv(f"T_{mat}_R", r, s2, True, texmapp)
    if "N" in k:
        n = pixlar(k["N"], s2)
        if k.get("N_dx"):
            n[:, 1] = 1.0 - n[:, 1]                    # DirectX → OpenGL (glTF)
        if v:
            n = pixlar_vrid_normal(n, s2)
        n[:, 3] = 1.0
    else:
        n = np.tile(np.array([0.5, 0.5, 1.0, 1.0], dtype=np.float32), (s2 * s2, 1))
    bilder["N"] = skriv(f"T_{mat}_N", n, s2, True, texmapp)
    if metall:
        if "M" in k:
            mm = pixlar(k["M"], s2, v)
            mv = mm[:, 0:1]
        else:
            mv = np.full((s2 * s2, 1), 0.9, dtype=np.float32)
        bilder["M"] = skriv(f"T_{mat}_M", np.concatenate([mv, mv, mv, np.ones_like(mv)], axis=1), s2, True, texmapp)
    return bilder


def bygg_blender_material(m, bilder, kakel):
    """Blender-materialet visar samma bilder som spelet (UV i meter → kakel → bilder)."""
    nt = m.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.name = "KAKEL_MAPPNING"
    mp.inputs["Scale"].default_value = (1.0 / kakel, 1.0 / kakel, 1.0)
    nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    ut = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs[0], ut.inputs["Surface"])

    def tex(img):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        nt.links.new(mp.outputs[0], n.inputs["Vector"])
        return n

    farg = tex(bilder["C"]).outputs["Color"]
    farg = variation(nt, m, farg)
    nt.links.new(farg, bsdf.inputs["Base Color"])
    nt.links.new(tex(bilder["R"]).outputs["Color"], bsdf.inputs["Roughness"])
    if "M" in bilder:
        nt.links.new(tex(bilder["M"]).outputs["Color"], bsdf.inputs["Metallic"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex(bilder["N"]).outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])


VARIATION = {"mark": 0.12, "tak": 0.12, "sten": 0.10, "kullersten": 0.10, "tra": 0.10, "jarn": 0.05}


def variation(nt, m, farg):
    """Samma världsberoende lager som spelets shader (borg.js): storskalig färgvariation
    (bryter kakelupprepningen), smuts nertill på murar/trä och arenans slitage – så att
    Blender-bilderna visar det man ser i spelet."""
    typ = m.get("typ", "")
    styrka = VARIATION.get(typ, 0.0)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])

    def mattenod(op, a, b=None):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                nt.links.new(v, n.inputs[i])
        return n.outputs[0]

    def blanda(fac, a, b, typ_="MIX"):
        n = nt.nodes.new("ShaderNodeMix")
        n.data_type = "RGBA"
        n.blend_type = typ_
        nt.links.new(fac, n.inputs[0]) if not isinstance(fac, (int, float)) else setattr(n.inputs[0], "default_value", fac)
        for sock, v in ((n.inputs[6], a), (n.inputs[7], b)):
            if isinstance(v, tuple):
                sock.default_value = v
            else:
                nt.links.new(v, sock)
        return n.outputs[2]

    if styrka:
        brus = nt.nodes.new("ShaderNodeTexNoise")
        brus.inputs["Scale"].default_value = 0.16 * 2.0
        brus.inputs["Detail"].default_value = 2.0
        nt.links.new(geo.outputs["Position"], brus.inputs["Vector"])
        f = mattenod("ADD", 1.0 - styrka, mattenod("MULTIPLY", brus.outputs["Fac"], 2 * styrka))
        farg = _mult(nt, farg, f)
    smuts = float(m.get("varld_smuts", 0.0))
    if smuts:
        z = sep.outputs[2]
        t = mattenod("SUBTRACT", 1.0, mattenod("MINIMUM", 1.0, mattenod("MAXIMUM", 0.0, mattenod("DIVIDE", z, 1.3))))
        mork = _mult(nt, farg, (0.332, 0.275, 0.202, 1.0))
        farg = blanda(mattenod("MULTIPLY", t, smuts), farg, mork)
    if m.get("arena"):
        x = mattenod("DIVIDE", sep.outputs[0], 13.0)
        y = mattenod("DIVIDE", sep.outputs[1], 9.3)
        d = mattenod("SQRT", mattenod("ADD", mattenod("MULTIPLY", x, x), mattenod("MULTIPLY", y, y)))
        kant = mattenod("MINIMUM", 1.0, mattenod("MAXIMUM", 0.0, mattenod("DIVIDE", mattenod("SUBTRACT", d, 0.78), 0.2)))
        f = mattenod("SUBTRACT", 1.0, mattenod("MULTIPLY", kant, 0.112))
        farg = _mult(nt, farg, f)
    return farg


def _mult(nt, farg, f):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = "MULTIPLY"
    n.inputs[0].default_value = 1.0
    nt.links.new(farg, n.inputs[6])
    if isinstance(f, tuple):
        n.inputs[7].default_value = f
    else:
        c = nt.nodes.new("ShaderNodeCombineColor")
        for i in range(3):
            nt.links.new(f, c.inputs[i])
        nt.links.new(c.outputs[0], n.inputs[7])
    return n.outputs[2]


def ladda_05():
    fil = os.path.join(bpy.path.abspath("//"), "05_fasE_bake_export.py")
    spec = importlib.util.spec_from_file_location("fasE", fil)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def bygg_och_exportera():
    E = ladda_05()
    bas, texmapp, exp = E.mappar()
    kopia = os.path.join(bas, "versioner", time.strftime("fore_blenderkit_%Y%m%d_%H%M%S.blend"))
    os.makedirs(os.path.dirname(kopia), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=kopia, copy=True)
    R.append(f"Säkerhetskopia: {kopia}")
    E.mata(R, "Före")
    klara = 0
    for mat, (id8, _, kakel, s) in VAL.items():
        m = bpy.data.materials.get(mat)
        o = provobjekt(id8)
        if m is None or o is None or not o.data.materials or o.data.materials[0] is None:
            R.append(f"  {mat}: hoppar över (material eller nedladdning saknas)")
            continue
        km = o.data.materials[0]
        k = kanaler(km)
        if "C" not in k:
            R.append(f"  {mat}: {km.name} har ingen färgbild – hoppar över")
            continue
        metall = m.get("typ") == "jarn"
        bilder = bygg_bilder(mat, k, s, texmapp, metall)
        m["tile_u"] = kakel
        m["tile_v"] = kakel
        m["uv01"] = False
        m["bake_res"] = s
        m["bk_kalla"] = km.name
        bygg_blender_material(m, bilder, kakel)
        E.exportmaterial(m, bilder, kakel, kakel)
        klara += 1
        R.append(f"  {mat:22s} ← {km.name} ({s}px, kakel {kakel} m, {''.join(sorted(b for b in bilder))})")
    R.append(f"Material bytta: {klara} av {len(VAL)}")
    E.mata(R, "Efter")
    E.exportera(exp, R)
    # provobjekten (dolda, exporteras inte) får ligga kvar så att skriptet kan köras om utan ny nedladdning
    bpy.ops.wm.save_mainfile()


def kor():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    R.append("BORGEN – MATERIAL FRÅN BLENDERKIT")
    saknas = [id8 for (id8, *_r) in VAL.values() if not nedladdat(id8)]
    if saknas:
        ladda_ner()
        R.append(f"Nedladdning startad ({len(set(saknas))} material). Vänta tills BlenderKit är klar och kör skriptet igen.")
    else:
        bygg_och_exportera()
    txt = "\n".join(R)
    print(txt)
    return txt


if __name__ == "__main__":
    resultat_text = kor()
