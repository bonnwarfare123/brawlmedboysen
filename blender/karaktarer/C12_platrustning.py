"""
C12_platrustning.py  –  Brawl med Boysen: PLÅTRUSTNING (bygger på Stadsvaktens basmodell)
=========================================================================================
Klistra in i Scripting-fliken i platrustning.blend och kör. Kräver C04_stadsvakt_A_ny_basmodell.py
i samma mapp (samma verktyg som Stadsvakten: mått från riggen, kroppens yta, vikter).

Basmodellen är densamma som Stadsvaktens (Auto-Rig Pro-riggen "rig", meshen "body", 1,85 m).
All rustning byggs i riggens rum och är barn till riggen. Plåtarna formas ur kroppens verkliga
mått: i varje ring längs armen/benet/bålen skjuts strålar ut till kroppens yta, formen jämnas
(bara de lägsta övertonerna behålls, så musklerna försvinner och plåten blir slät och läsbar)
och flyttas ut med ett spelrum. Delar som följer kroppens yta (handskar, skor) ärver vikterna.

Delar (alla SM_Platrustning_…):
  Hjalm, Hjalm_Visir, Hjalm_Kant, Hjalm_Nitar  spetsig bascinet med visir: ögonspringa, andningshål (i materialet)
  Halsskydd                                   två lameller mellan hjälm och bröst
  Brostplat, Brostplat_Kant                   helplåt med mittrygg, rullade kanter, utsvängd midja
  Axelskydd_V/H (+ _Lam1–3)                   kupa + tre överlappande lameller
  Armskydd_V/H, Armbage_V/H, Underarm_V/H     överarm, armbågskopp med vinge, underarm
  Handskar, Handskar_Kragar                   plåthandskar ur handens yta + utsvängda kragar
  Balte_Ovre, Balte_Nedre, Balte_Nitar        två läderbälten med mässingsnitar och spänne
  Kjol                                        blå och vita paneler med spetsiga flikar (lagfärg på de blå)
  Larskydd_V/H, Knaskydd_V/H, Benskydd_V/H    lår, knäkopp med vinge, benskena
  Skor, Skor_Lameller, Skor_Rem               spetsiga sabatons med lameller över vristen, mässingsrem
  Nitar                                       mässingsnitar på plåtarna
  Underlager                                  mörk vadderad arming doublet + ringbrynja i gliporna

Kan köras om: allt i COL_Char_Platrustning tas bort och byggs om. Säkerhetskopia i versioner/ först.
Material: BlenderKit (gratis, royalty free): Scratched Polished Steel, Dark Hammered Metal,
Aged Brown Leather; tyg och mässing från Stadsvakten (samma världsbild). Saknas en bild används färg.
Kör C10_spelmodell_export.py (med KONFIG för "plate") efteråt för spelet.  Testat i Blender 5.3.
MARK: C12 v2b doublet+brynja, inget band
"""
import bpy
import bmesh
import math
import os
import time
import importlib.util
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

P = "Platrustning"
SAMLING = f"COL_Char_{P}"
A_FIL = "C04_stadsvakt_A_ny_basmodell.py"
BK8 = os.path.join(os.path.dirname(os.path.dirname(bpy.path.abspath("//"))), "08_blenderkit_material.py")
R = []
PLAT = 0.0035          # godstjocklek
SEG = 28               # vinklar runt en ring


# =============================================================== laddning och grund
def ladda(fil, namn):
    p = os.path.join(bpy.path.abspath("//"), fil)
    spec = importlib.util.spec_from_file_location(namn, p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def samling():
    sc = bpy.context.scene
    topp = bpy.data.collections.get("COL_Characters") or bpy.data.collections.new("COL_Characters")
    if topp.name not in sc.collection.children:
        sc.collection.children.link(topp)
    kol = bpy.data.collections.get(SAMLING) or bpy.data.collections.new(SAMLING)
    if kol.name not in topp.children:
        topp.children.link(kol)
    for o in list(kol.objects):
        d = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if d is not None and d.users == 0 and isinstance(d, bpy.types.Mesh):
            bpy.data.meshes.remove(d)
    return kol


def sakerhetskopia():
    if not bpy.data.filepath:
        return
    mapp = os.path.join(os.path.dirname(bpy.data.filepath), "versioner")
    os.makedirs(mapp, exist_ok=True)
    p = os.path.join(mapp, time.strftime(f"{P.lower()}_fore_C12_%Y%m%d_%H%M%S.blend"))
    bpy.ops.wm.save_as_mainfile(filepath=p, copy=True)
    R.append(f"Säkerhetskopia: {p}")


def obj(A, namn, bm, kol, rig, mat, del_="", smooth=True):
    o = A.nytt_objekt(f"SM_{P}_{namn}", bm, kol, rig, mat, slat=smooth)
    o[P.lower()] = True
    o["kroppsdel"] = del_
    return o


def tjocklek(A, o, t=PLAT, skarp=40):
    A.solidify(o, t, offset=-1.0)
    A.skarpa_kanter(o, skarp)


# =============================================================== kroppens yta per del
def bvh_typer(K, typer, extra=None):
    """BVH av kroppens ytor av vissa typer (bål, armar, ben …) – strålar träffar bara dem."""
    bm = K.bm()
    dl = bm.verts.layers.deform.active
    bort = []
    for f in bm.faces:
        t = K.yt_typ(f, dl)
        if t not in typer and not (extra and extra(f.calc_center_median())):
            bort.append(f)
    bmesh.ops.delete(bm, geom=bort, context="FACES")
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def ram(d, ref):
    """Ram kring axeln d: U pekar mot 'ref' (vinkelrätt mot d), V = d × U (U, V, d högerhänt)."""
    d = d.normalized()
    U = (ref - d * ref.dot(d))
    if U.length < 1e-6:
        U = d.orthogonal()
    U.normalize()
    V = d.cross(U).normalized()
    return U, V


def radier(bvh, centra, U, V, maxd=0.4, harm=3, z_slat=2):
    """Strålar från axeln ut till kroppens yta i SEG riktningar per ring. Resultatet jämnas:
    bara de lägsta övertonerna runt ringen behålls (slät plåt, inga muskler) och ringarna
    jämnas längs axeln. Missar fylls från grannarna."""
    n = len(centra)
    Rr = np.full((n, SEG), np.nan)
    for i, c in enumerate(centra):
        for k in range(SEG):
            a = 2 * math.pi * k / SEG
            d = U[i] * math.cos(a) + V[i] * math.sin(a)
            hit = bvh.ray_cast(c, d, maxd)
            if hit[0] is not None:
                Rr[i, k] = hit[3]
    for i in range(n):
        rad = Rr[i]
        if np.all(np.isnan(rad)):
            continue
        ok = ~np.isnan(rad)
        idx = np.arange(SEG)
        rad[~ok] = np.interp(idx[~ok], idx[ok], rad[ok], period=SEG)
    for i in range(n):                     # helt tomma ringar: ta grannens
        if np.all(np.isnan(Rr[i])):
            j = min(range(n), key=lambda j: abs(j - i) if not np.all(np.isnan(Rr[j])) else 1e9)
            Rr[i] = Rr[j]
    F = np.fft.rfft(Rr, axis=1)
    F[:, harm + 1:] = 0
    Rr = np.fft.irfft(F, n=SEG, axis=1)
    for _ in range(z_slat):
        Rr[1:-1] = (Rr[:-2] + 2 * Rr[1:-1] + Rr[2:]) / 4
    return Rr


def ror_skal(centra, U, V, Rr, behall=None, matfunk=None):
    """Rörformat skal: ringar runt axeln med radier Rr[i][k]. behall(i, k, punkt) väljer ytor.
    Normalerna pekar utåt."""
    bm = bmesh.new()
    ringar = []
    for i, c in enumerate(centra):
        ringar.append([bm.verts.new(c + (U[i] * math.cos(2 * math.pi * k / SEG) + V[i] * math.sin(2 * math.pi * k / SEG)) * Rr[i][k])
                       for k in range(SEG)])
    for i in range(len(ringar) - 1):
        for k in range(SEG):
            k2 = (k + 1) % SEG
            q = (ringar[i][k], ringar[i][k2], ringar[i + 1][k2], ringar[i + 1][k])
            if behall is None or behall(i, k, sum((v.co for v in q), Vector()) / 4):
                f = bm.faces.new(q)
                if matfunk:
                    f.material_index = matfunk(i, k)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    return bm


def kantloopar(bm):
    """Skalets öppna kanter som ordnade punktlistor (slutna loopar får första punkten sist)."""
    kanter = [e for e in bm.edges if e.is_boundary]
    gr = {}
    for e in kanter:
        for v in e.verts:
            gr.setdefault(v, []).append(e)
    sett, ut = set(), []
    for e0 in kanter:
        if e0 in sett:
            continue
        sett.add(e0)
        loop = [e0.verts[0], e0.verts[1]]
        while True:
            v = loop[-1]
            nasta = [e for e in gr[v] if e not in sett]
            if not nasta:
                break
            e = nasta[0]
            sett.add(e)
            w = e.other_vert(v)
            if w == loop[0]:
                loop.append(w)
                break
            loop.append(w)
        if len(loop) > 3:
            ut.append([v.co.copy() for v in loop])
    return ut


def rullkant(A, bm_kalla, namn, kol, rig, mat, r=0.0045, del_="", jamna=2):
    """Rullad kant (smidd vulst) längs skalets öppna kanter."""
    bm = bmesh.new()
    for loop in kantloopar(bm_kalla):
        pts = [p.copy() for p in loop]
        for _ in range(jamna):
            pts = [pts[0]] + [(pts[i - 1] + pts[i] * 2 + pts[i + 1]) / 4 for i in range(1, len(pts) - 1)] + [pts[-1]]
        if len(pts) > 40:
            pts = pts[::2] + ([pts[-1]] if len(pts) % 2 == 0 else [])
        if len(pts) > 4:
            A.ror(bm, pts, [r] * len(pts), 5, platt=0.75)
    if not bm.verts:
        bm.free()
        return None
    return obj(A, namn, bm, kol, rig, mat, del_)


def nit(bm, p, n, r=0.006, h=0.0035):
    """Liten välvd mässingsnit på ytan p med normalen n."""
    q = Vector((0, 0, 1)).rotation_difference(n.normalized())
    M = Matrix.Translation(p) @ q.to_matrix().to_4x4()
    ringar = []
    for rr, z in ((r, 0.0), (r * 0.7, h * 0.8), (0.0, h)):
        if rr == 0.0:
            ringar.append([bm.verts.new(M @ Vector((0, 0, z)))])
        else:
            ringar.append([bm.verts.new(M @ Vector((rr * math.cos(2 * math.pi * k / 6), rr * math.sin(2 * math.pi * k / 6), z))) for k in range(6)])
    for a, b in zip(ringar, ringar[1:]):
        if len(b) == 1:
            for k in range(6):
                bm.faces.new((a[k], a[(k + 1) % 6], b[0]))
        else:
            for k in range(6):
                bm.faces.new((a[k], a[(k + 1) % 6], b[(k + 1) % 6], b[k]))


def arm_radie(K, p, d, maxr=0.09):
    """Största avståndet från axeln (p, d) till kroppens hörn i en tunn skiva."""
    r = 0.0
    for v in K.obj.data.vertices:
        q = v.co - p
        if abs(q.dot(d)) < 0.018:
            vr = (q - d * q.dot(d)).length
            if vr < maxr:
                r = max(r, vr)
    return r


def yta(bvh_skal, p, riktning, avst=0.25):
    """Punkt och normal på ett skal (strålen skjuts inifrån axeln utåt)."""
    hit = bvh_skal.ray_cast(p, riktning.normalized(), avst)
    if hit[0] is None:
        return None, None
    return hit[0], hit[1]


# =============================================================== material
def bk_kanaler(namn_id):
    o = bpy.data.objects.get(f"GR_BK_{namn_id}")
    if not o or not o.data.materials or not o.data.materials[0]:
        return {}
    m = o.data.materials[0]
    ut = {}
    for n in m.node_tree.nodes:
        if n.type != "TEX_IMAGE" or not n.image:
            continue
        x = n.image.name.lower()
        if "normal" in x:
            ut["N"] = n.image
        elif "rough" in x or "gloss" in x:
            ut["R"] = n.image
            ut["R_inv"] = "gloss" in x
        elif "metal" in x:
            ut["M"] = n.image
        elif "disp" in x or "height" in x:
            ut["H"] = n.image
        elif "spec" in x:
            ut["S"] = n.image
        else:
            ut["C"] = n.image
    for k in ("N", "R", "M", "H", "S"):
        if k in ut:
            ut[k].colorspace_settings.name = "Non-Color"
    return ut


def ny_mat(namn):
    m = bpy.data.materials.get(namn) or bpy.data.materials.new(namn)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    ut = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(b.outputs[0], ut.inputs["Surface"])
    return m, nt, b


def lada_bild(nt, bild, vek, skala, data=False):
    """Bild med lådprojektion i objektets rum (fungerar utan UV och i exportens bakning)."""
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (skala, skala, skala)
    nt.links.new(vek, mp.inputs["Vector"])
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bild
    t.projection = "BOX"
    t.projection_blend = 0.25
    nt.links.new(mp.outputs[0], t.inputs["Vector"])
    return t


def mat_stal(namn, ton=(0.60, 0.615, 0.64), hal=False):
    """Polerat men använt stål: BlenderKits repade stål (färg, roughness, normal) + svag hamrad relief
    från Dark Hammered Metal, mörkare i fogar och veck (AO), ljusare nötta kanter. Kontrollerad roughness
    0,16–0,42 – inte spegelblankt, inte plast. hal=True: visirets andningshål (mörka prickar i ett fält)."""
    m, nt, b = ny_mat(namn)
    st = bk_kanaler("44f99cae")
    ha = bk_kanaler("c88d56fa")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vek = tc.outputs["Object"]
    b.inputs["Metallic"].default_value = 1.0
    farg = nt.nodes.new("ShaderNodeRGB")
    farg.outputs[0].default_value = (*ton, 1)
    col = farg.outputs[0]
    if "C" in st:
        t = lada_bild(nt, st["C"], vek, 3.0)
        bw = nt.nodes.new("ShaderNodeRGBToBW")
        nt.links.new(t.outputs["Color"], bw.inputs[0])
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs[1].default_value, mr.inputs[2].default_value = 0.2, 0.8
        mr.inputs[3].default_value, mr.inputs[4].default_value = 0.82, 1.08
        nt.links.new(bw.outputs[0], mr.inputs[0])
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.blend_type = "MULTIPLY"
        mx.inputs["Factor"].default_value = 1.0
        nt.links.new(col, mx.inputs[6])
        nt.links.new(mr.outputs[0], mx.inputs[7])
        col = mx.outputs[2]
    # mörkare i fogar (AO)
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.04
    aom = nt.nodes.new("ShaderNodeMapRange")
    aom.inputs[3].default_value, aom.inputs[4].default_value = 0.55, 1.0
    nt.links.new(ao.outputs["AO"], aom.inputs[0])
    mx2 = nt.nodes.new("ShaderNodeMix")
    mx2.data_type = "RGBA"
    mx2.blend_type = "MULTIPLY"
    mx2.inputs["Factor"].default_value = 1.0
    nt.links.new(col, mx2.inputs[6])
    nt.links.new(aom.outputs[0], mx2.inputs[7])
    col = mx2.outputs[2]
    rough = None
    if "R" in st:
        t = lada_bild(nt, st["R"], vek, 3.0, True)
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs[3].default_value, mr.inputs[4].default_value = 0.22, 0.46
        nt.links.new(t.outputs["Color"], mr.inputs[0])
        rough = mr.outputs[0]
    else:
        b.inputs["Roughness"].default_value = 0.28
    nrm_ut = None
    if "N" in st:
        t = lada_bild(nt, st["N"], vek, 3.0, True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 0.35
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nrm_ut = nm.outputs[0]
    if "H" in ha:
        t = lada_bild(nt, ha["H"], vek, 2.2, True)
        bp = nt.nodes.new("ShaderNodeBump")
        bp.inputs["Strength"].default_value = 0.18
        bp.inputs["Distance"].default_value = 0.002
        nt.links.new(t.outputs["Color"], bp.inputs["Height"])
        if nrm_ut:
            nt.links.new(nrm_ut, bp.inputs["Normal"])
        nrm_ut = bp.outputs[0]
    if hal:
        # andningshål: prickmönster där ytattributet HAL = 1 (sätts på visiret)
        at = nt.nodes.new("ShaderNodeAttribute")
        at.attribute_name = "HAL"
        vo = nt.nodes.new("ShaderNodeTexVoronoi")
        vo.inputs["Scale"].default_value = 95.0
        vo.inputs["Randomness"].default_value = 0.0
        nt.links.new(vek, vo.inputs["Vector"])
        lt = nt.nodes.new("ShaderNodeMath")
        lt.operation = "LESS_THAN"
        lt.inputs[1].default_value = 0.22
        nt.links.new(vo.outputs["Distance"], lt.inputs[0])
        mu = nt.nodes.new("ShaderNodeMath")
        mu.operation = "MULTIPLY"
        nt.links.new(lt.outputs[0], mu.inputs[0])
        nt.links.new(at.outputs["Fac"], mu.inputs[1])
        mx3 = nt.nodes.new("ShaderNodeMix")
        mx3.data_type = "RGBA"
        nt.links.new(mu.outputs[0], mx3.inputs["Factor"])
        nt.links.new(col, mx3.inputs[6])
        mx3.inputs[7].default_value = (0.01, 0.01, 0.01, 1)
        col = mx3.outputs[2]
        inv = nt.nodes.new("ShaderNodeMath")
        inv.operation = "SUBTRACT"
        inv.inputs[0].default_value = 1.0
        nt.links.new(mu.outputs[0], inv.inputs[1])
        nt.links.new(inv.outputs[0], b.inputs["Metallic"])
        if rough is not None:
            mxr = nt.nodes.new("ShaderNodeMix")
            nt.links.new(mu.outputs[0], mxr.inputs["Factor"])
            nt.links.new(rough, mxr.inputs[2])
            mxr.inputs[3].default_value = 1.0
            rough = mxr.outputs[0]
    nt.links.new(col, b.inputs["Base Color"])
    if rough is not None:
        nt.links.new(rough, b.inputs["Roughness"])
    if nrm_ut:
        nt.links.new(nrm_ut, b.inputs["Normal"])
    return m


def mat_lader(namn, ton=(0.33, 0.20, 0.11)):
    m, nt, b = ny_mat(namn)
    la = bk_kanaler("e608539c")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vek = tc.outputs["Object"]
    if "C" in la:
        t = lada_bild(nt, la["C"], vek, 6.0)
        hs = nt.nodes.new("ShaderNodeHueSaturation")
        hs.inputs["Value"].default_value = 0.85
        nt.links.new(t.outputs["Color"], hs.inputs["Color"])
        nt.links.new(hs.outputs[0], b.inputs["Base Color"])
    else:
        b.inputs["Base Color"].default_value = (*ton, 1)
    b.inputs["Roughness"].default_value = 0.62
    if "N" in la:
        t = lada_bild(nt, la["N"], vek, 6.0, True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 0.5
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs[0], b.inputs["Normal"])
    return m


def kopia(kalla, namn, fallback):
    k = bpy.data.materials.get(kalla)
    if k is None:
        m = bpy.data.materials.get(namn) or bpy.data.materials.new(namn)
        m.diffuse_color = (*fallback, 1)
        return m
    gam = bpy.data.materials.get(namn)
    if gam is not None and gam != k:
        bpy.data.materials.remove(gam)
    m = k.copy()
    m.name = namn
    return m


def mat_underlager(namn):
    """Arming doublet: kraftigt, mörkt ylletyg med längsgående vadderade kanaler och sömmar.
    Bygger på Stadsvaktens vaddering (ytkartan QUILT: x = tvärs kanalerna, y = längs, i meter)
    men mörkare och kallare, så att det skiljer sig tydligt från både stålet och det bruna lädret."""
    m = kopia("MAT_Stadsvakt_Vaddering", namn, (0.035, 0.027, 0.022))
    if not m.use_nodes:
        return m
    nd = m.node_tree.nodes
    farg = {"Mix": {"A": (0.040, 0.031, 0.026), "B": (0.022, 0.017, 0.014)},   # tyg: ljusare/mörkare fläckar
            "Mix.001": {"B": (0.072, 0.056, 0.044)},                          # kanalernas toppar (slitet ylle)
            "Mix.002": {"B": (0.008, 0.006, 0.005)},                          # djupt i sömmarna
            "Mix.003": {"B": (0.120, 0.095, 0.068)}}                          # sömtråden
    for n, d in farg.items():
        if n in nd:
            for k, v in d.items():
                nd[n].inputs[k].default_value = (*v, 1)
    if "Bump" in nd:
        nd["Bump"].inputs["Strength"].default_value = 0.85                   # tydligare vaddering
    b = nd.get("Principled BSDF")
    if b:                                     # lite, mörk sheen: ylle – inte grå "hud" i strykljus
        b.inputs["Sheen Weight"].default_value = 0.12
        b.inputs["Sheen Tint"].default_value = (0.45, 0.38, 0.32, 1)
        b.inputs["Specular IOR Level"].default_value = 0.15
    return m


def mat_brynja(namn):
    """Ringbrynja i gliporna (armhålor, armbågsveck, knäveck, hals, gren): Stadsvaktens brynja
    (BlenderKit Chainmail Armor Material på ytkartan BRYNJA i meter)."""
    return kopia("MAT_Stadsvakt_Ringbrynja", namn, (0.30, 0.30, 0.31))


def material():
    M = {
        "stal": mat_stal(f"MAT_{P}_Stal"),
        "visir": mat_stal(f"MAT_{P}_Stal_Visir", hal=True),
        "lader": mat_lader(f"MAT_{P}_Lader"),
        "massing": kopia("MAT_Stadsvakt_Metall_Massing", f"MAT_{P}_Metall_Massing", (0.69, 0.55, 0.27)),
        "bla": kopia("MAT_Stadsvakt_Tyg_Bla", f"MAT_{P}_Tyg_Bla", (0.12, 0.22, 0.55)),
        "vit": kopia("MAT_Stadsvakt_Tyg_Vit", f"MAT_{P}_Tyg_Vit", (0.85, 0.82, 0.74)),
        "under": mat_underlager(f"MAT_{P}_Underlager"),
        "brynja": mat_brynja(f"MAT_{P}_Ringbrynja"),
    }
    for m in M.values():
        m["baka"] = True                         # C10 bakar även material med bilder till spelets gemensamma textur
    R.append("Material: stål (BlenderKit Scratched Polished Steel + Dark Hammered Metal), läder (Aged Brown Leather), "
             "tyg och mässing från Stadsvakten")
    return M


# =============================================================== delarna
def bygg_underlager(A, K, kol, M, rig, L):
    """Arming doublet + ringbrynja: kroppens yta (bål, hals, armar, lår, knän) utflyttad och kraftigt
    utjämnad, så att muskler och anatomi försvinner och formen läses som vadderat tyg. Ringbrynja
    (eget material) på ytorna i gliporna mellan plåtarna. Täcker allt mellan plåtarna."""
    def behall(f, typ):
        c = f.calc_center_median()
        if typ in ("bal", "nyckelben", "hals", "overarm", "underarm", "lar"):
            return True
        if typ == "vad":
            return c.z > L["kna"] - 0.08
        return False

    def offset(v):
        return 0.012                                   # vaddering: lite tjockare än förut (0,008)

    def efter(bm, dl):
        # jämna ut anatomin (inte kanterna, så att gliporna förblir täckta), sedan tillbaka ut
        inre = [v for v in bm.verts if not v.is_boundary]
        fore = {v: v.co.copy() for v in inre}
        for _ in range(6):
            bmesh.ops.smooth_vert(bm, verts=inre, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bm.normal_update()
        for v in inre:                                  # krympningen från utjämningen läggs tillbaka längs normalen
            krymp = (fore[v] - v.co).dot(v.normal)
            if krymp > 0:
                v.co += v.normal * krymp

    ax = {s: L[("arm", s)][0] for s in (1, -1)}
    ab = {s: L[("arm", s)][1] for s in (1, -1)}

    def matfunk(c, n):
        s = 1 if c.x > 0 else -1
        a = ax[s]
        if (c - a).length < 0.14 and c.z < a.z - 0.015 and abs(c.x) > abs(a.x) - 0.10:
            return 1                                    # armhålan
        if (c - ab[s]).length < 0.065 and n.y < -0.05:
            return 1                                    # armbågsvecket (framsidan, −y)
        if abs(c.z - L["kna"]) < 0.07 and n.y > 0.2 and c.z < L["hoft"]:
            return 1                                    # knävecket
        if abs(c.x) < 0.10 and L["hoft"] - 0.15 < c.z < L["hoft"] + 0.02:
            return 1                                    # grenen (under kjolen)
        if c.z > L["nyckel"] + 0.015 and abs(c.x) < 0.09:
            return 1                                    # halsen under hjälm och halsskydd
        return 0

    o = A.nytt_lager(K, f"SM_{P}_Underlager", behall, offset, [M["under"], M["brynja"]], matfunk=matfunk,
                     efter=efter, kol=kol, jamna_kant=1, mal_tris=3000)
    if o:
        o[P.lower()] = True
        o["kroppsdel"] = "torso"
        ytkartor(A, K, L, o)
        n_b = sum(1 for p in o.data.polygons if p.material_index == 1)
        R.append(f"Underlager: arming doublet + ringbrynja ({n_b} av {len(o.data.polygons)} ytor brynja)")
    return o


def ytkartor(A, K, L, o):
    """QUILT och BRYNJA per hörn (meter): x runt kroppsdelen, y längs den. Bål och ben runt en lodrät
    axel (skarven bak), armar runt armens axel. Vinkeln räknas per yta från ytans mitt så att skarven
    aldrig smetas ut."""
    me = o.data
    for n in ("QUILT", "BRYNJA"):
        a = me.attributes.get(n)
        if a:
            me.attributes.remove(a)
    q = me.attributes.new("QUILT", "FLOAT_VECTOR", "CORNER")
    br = me.attributes.new("BRYNJA", "FLOAT_VECTOR", "CORNER")
    cy = L["cy"]
    axx = abs(L[("arm", 1)][0].x)
    ben = {}
    for s in (1, -1):
        pts = [v.co for v in me.vertices if s * v.co.x > 0.02 and v.co.z < L["hoft"] - 0.12]
        ben[s] = (sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts)) if pts else (s * 0.1, cy)

    def del_(c):
        s = 1 if c.x > 0 else -1
        if abs(c.x) > 0.7 * axx:
            t, dist, _, _ = A.arm_param(K, c, s)
            if dist < 0.13:
                return ("arm", s)
        if c.z < L["hoft"] - 0.06 and abs(c.x) > 0.015:
            return ("ben", s)
        return ("bal", 0)

    def vinkel(c, typ, s):
        if typ == "arm":
            t, dist, centr, d = A.arm_param(K, c, s)
            r = c - centr
            e1 = Vector((0, -1, 0))
            e1 = (e1 - d * e1.dot(d)).normalized()
            e2 = d.cross(e1)
            return math.atan2(r.dot(e2), r.dot(e1)), 0.055, t
        if typ == "ben":
            bx, by = ben[s]
            return math.atan2(c.x - bx, -(c.y - by)), 0.075, c.z
        return math.atan2(c.x, -(c.y - cy)), max(0.08, math.hypot(c.x, c.y - cy)), c.z

    for p in me.polygons:
        typ, s = del_(p.center)
        w0, _, _ = vinkel(p.center, typ, s)
        for li in p.loop_indices:
            c = me.vertices[me.loops[li].vertex_index].co
            w, rho, v = vinkel(c, typ, s)
            w = w0 + ((w - w0 + math.pi) % (2 * math.pi) - math.pi)
            q.data[li].vector = (w * rho, v, 0.0)
            br.data[li].vector = (w * rho, v, 0.0)


def bygg_hjalm(A, K, kol, M, rig):
    hm = A.huvud_matt(K)
    topp, haka, H = hm["topp"], hm["haka"], hm["H"]
    oga = bpy.data.objects.get("Eye_Left")
    if oga:
        p_v = sum(((oga.matrix_world @ Vector(c)) for c in oga.bound_box), Vector()) / 8
        z_oga = (rig.matrix_world.inverted() @ p_v).z
    else:
        z_oga = haka + 0.55 * H
    zb = haka + 0.66 * H                                     # pannan
    nara = [p for p in hm["pts"] if abs(p.z - zb) < 0.012]
    rx = max(abs(p.x) for p in nara) + 0.024
    yf, yb = min(p.y for p in nara), max(p.y for p in nara)
    yc = (yf + yb) / 2
    ry = (yb - yf) / 2 + 0.024
    kv = ry / rx
    z_spets = topp + 0.11
    z_bot = haka - 0.045
    # kupa: spetsig (ogiv) från spetsen till pannan, sedan raka sidor ned över nacken, liten utsvängning nertill
    prof = []
    for i in range(13):
        t = i / 12
        r = 0.6 * t + 0.4 * (1 - (1 - t) ** 2)
        prof.append((r * rx if i else 0.0, z_spets - (z_spets - zb) * t ** 1.15))
    for i, (rr, dz) in enumerate(((1.0, -0.03), (0.99, -0.07), (0.975, -0.11), (0.985, -0.15))):
        prof.append((rr * rx, zb + dz))
    prof.append((1.0 * rx, z_bot + 0.012))
    prof.append((1.025 * rx, z_bot))
    bm = bmesh.new()
    seg = 32
    A.lathe(bm, prof, seg, rx=1.0, ry=kv, matris=Matrix.Translation((0, yc, 0)))
    # ansiktsöppningen (visiret täcker den): bort framtill under pannan
    oppning = math.radians(72)
    bort = []
    for f in bm.faces:
        c = f.calc_center_median()
        a = math.atan2((c.y - yc) / kv, c.x)
        if c.z < zb - 0.012 and abs(a + math.pi / 2) < oppning:
            bort.append(f)
    bmesh.ops.delete(bm, geom=bort, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    kant_bm = bm.copy()
    hj = obj(A, "Hjalm", bm, kol, rig, [M["stal"]], "head")
    tjocklek(A, hj)
    # visir: framför ansiktet, lätt framskjutet i mitten, ögonspringa och andningshål
    vbm = bmesh.new()
    z0, z1 = zb + 0.018, z_bot + 0.015
    rader = 16
    grad = 22
    a0, a1 = -math.pi / 2 - math.radians(80), -math.pi / 2 + math.radians(80)
    vs = []
    for i in range(rader + 1):
        z = z0 + (z1 - z0) * i / rader
        rad = []
        for k in range(grad + 1):
            a = a0 + (a1 - a0) * k / grad
            da = (a + math.pi / 2) / math.radians(80)
            fram = 0.026 * max(0.0, math.cos(da * math.pi / 2)) ** 1.5 * math.sin(math.pi * min(1, max(0, (z0 - z) / (z0 - z1) * 1.1)))
            r = rx * 1.035 + 0.004 + fram
            rad.append(vbm.verts.new((math.cos(a) * r, yc + math.sin(a) * r * kv - fram * 0.25, z)))
        vs.append(rad)
    for i in range(rader):
        for k in range(grad):
            q = (vs[i][k], vs[i + 1][k], vs[i + 1][k + 1], vs[i][k + 1])
            c = sum((v.co for v in q), Vector()) / 4
            da = abs(((a0 + (a1 - a0) * (k + 0.5) / grad) + math.pi / 2) / math.radians(80))
            if z_oga - 0.008 < c.z < z_oga + 0.012 and da < 0.72:
                continue                                       # ögonspringan
            vbm.faces.new(q)
    vkant = vbm.copy()
    vi = obj(A, "Hjalm_Visir", vbm, kol, rig, [M["visir"]], "head")
    # HAL-attributet: 1 i andningshålens fält
    attr = vi.data.attributes.new("HAL", "FLOAT", "POINT")
    for v in vi.data.vertices:
        c = v.co
        attr.data[v.index].value = 1.0 if (z_oga - 0.078 < c.z < z_oga - 0.022 and abs(c.x) < rx * 0.42) else 0.0
    tjocklek(A, vi, 0.003)
    # mässingskanter: kupans nederkant och visirets kant
    bm = bmesh.new()
    for loop in kantloopar(kant_bm) + kantloopar(vkant):
        pts = loop[::2] + ([loop[-1]] if len(loop) % 2 == 0 else []) if len(loop) > 40 else loop
        if len(pts) > 4:
            A.ror(bm, pts, [0.004] * len(pts), 5, platt=0.8)
    kant_bm.free()
    vkant.free()
    obj(A, "Hjalm_Kant", bm, kol, rig, [M["massing"]], "head")
    # nitar: visirets gångjärn på sidorna + rad längs kupans nederkant
    bm = bmesh.new()
    for s in (1, -1):
        nit(bm, Vector((s * rx * 1.05, yc - ry * 0.05, z_oga + 0.005)), Vector((s, 0, 0)), r=0.011, h=0.006)
    for k in range(12):
        a = -math.pi / 2 + math.radians(85) + k * math.radians(190) / 11
        p = Vector((math.cos(a) * rx * 1.045, yc + math.sin(a) * rx * 1.045 * kv, z_bot + 0.03))
        nit(bm, p, Vector((math.cos(a), math.sin(a), 0)), r=0.0055)
    obj(A, "Hjalm_Nitar", bm, kol, rig, [M["massing"]], "head")
    R.append(f"  Hjälm: spets {z_spets - zb:.2f} över pannan, visir med ögonspringa (z {z_oga:.3f}) och andningshål")
    return {"zb": zb, "z_bot": z_bot, "rx": rx, "yc": yc, "kv": kv}


def torso_ringar(K, z_lista, bvh):
    """Ringar runt bålen: mittpunkt (x 0, y = bålens mitt i höjd z), U = x, V = y."""
    me = K.obj.data
    co = [v.co for v in me.vertices]
    centra, U, V = [], [], []
    for z in z_lista:
        skiva = [c for c in co if abs(c.z - z) < 0.02 and abs(c.x) < 0.16]
        cy = (max(c.y for c in skiva) + min(c.y for c in skiva)) / 2 if skiva else 0.0
        centra.append(Vector((0, cy, z)))
        U.append(Vector((1, 0, 0)))
        V.append(Vector((0, 1, 0)))
    return centra, U, V


def bygg_brost(A, K, kol, M, rig, L):
    bvh = bvh_typer(K, {"bal", "nyckelben", "hals"})
    z_bot = A.BALTE_Z + 0.005
    z_top = L["nyckel"] + 0.05
    n = 22
    z_lista = [z_bot + (z_top - z_bot) * i / (n - 1) for i in range(n)]
    centra, U, V = torso_ringar(K, z_lista, bvh)
    Rr = radier(bvh, centra, U, V, maxd=0.45, harm=4, z_slat=3)
    arm_z = L["axel"] - 0.11
    for i, z in enumerate(z_lista):
        for k in range(SEG):
            a = 2 * math.pi * k / SEG
            fram = -math.sin(a)                         # 1 rakt fram (−y)
            Rr[i, k] += 0.026 + 0.012 * max(0.0, fram) ** 2
            # mittrygg på bröstplåten
            da = math.atan2(math.cos(a), -math.sin(a))
            if fram > 0 and z > z_bot + 0.04:
                Rr[i, k] += 0.009 * math.exp(-(da / 0.16) ** 2) * min(1.0, (z - z_bot) / 0.12)
        # utsvängd midja nederst
        if i == 0:
            Rr[i] += 0.012
        elif i == 1:
            Rr[i] += 0.004

    def behall(i, k, c):
        a = 2 * math.pi * (k + 0.5) / SEG
        sid = abs(math.cos(a))
        if c.z > arm_z and sid > 0.78:
            return False                               # armhål
        if c.z > L["nyckel"] - 0.035 and sid < 0.42:
            return False                               # halsöppning fram och bak
        if c.z > L["nyckel"] + 0.005 and sid > 0.62:
            return False
        return True
    bm = ror_skal(centra, U, V, Rr, behall)
    kant = bm.copy()
    skal = BVHTree.FromBMesh(kant)                    # bröstplåtens yttre yta (före godstjockleken)
    bp = obj(A, "Brostplat", bm, kol, rig, [M["stal"]], "torso")
    tjocklek(A, bp)
    rullkant(A, kant, "Brostplat_Kant", kol, rig, [M["stal"]], r=0.0055, del_="torso")
    kant.free()
    # sidonitar
    bm = bmesh.new()
    for s in (1, -1):
        for z in (z_bot + 0.05, z_bot + 0.13, z_bot + 0.21):
            p, nn = yta(skal, Vector((0, centra[0].y, z)), Vector((s, 0.05, 0)), 0.5)
            if p:
                nit(bm, p, nn if nn.dot(Vector((s, 0, 0))) > 0 else -nn)
    obj(A, "Nitar_Brost", bm, kol, rig, [M["massing"]], "torso")
    R.append(f"  Bröstplåt: {n} ringar, mittrygg, utsvängd midja, armhål från z {arm_z:.2f}")
    return bp, skal, centra[0].y


def bygg_band(A, K, kol, M, rig, L, skal, cy):
    """Blått band snett över bröstet och ryggen: över vänster axel ned till höger höft."""
    bm = bmesh.new()
    bredd = 0.075
    for sida in (-1, 1):                               # fram (−y) och bak (+y)
        start = Vector((0.12, cy, L["nyckel"] - 0.012))
        slut = Vector((-0.17, cy, A.BALTE_Z + 0.06))
        rader = []
        for i in range(17):
            t = i / 16
            q = start.lerp(slut, t)
            d = (slut - start).normalized()
            tv = Vector((d.z, 0, -d.x)).normalized()     # tvärs bandet i planet
            rad = []
            for w in (-0.5, 0.5):
                pq = q + tv * w * bredd
                p, nn = yta(skal, Vector((pq.x * 0.3, cy, pq.z)), Vector((pq.x, sida * 0.35, 0)) - Vector((pq.x * 0.3, 0, 0)), 0.6)
                if p is None and rader:                   # strålen missade: följ föregående rad
                    p, nn = rader[-1][len(rad)].co + (q - rader[-1][len(rad)].co) * 0 + Vector((0, 0, q.z - rader[-1][len(rad)].co.z)), Vector((0, sida, 0))
                    nn = Vector((0, sida, 0))
                    rad.append(p)
                    continue
                if p is None:
                    p, nn = pq + Vector((0, sida * 0.12, 0)), Vector((0, sida, 0))
                if nn.dot(Vector((0, sida, 0))) < 0:
                    nn = -nn
                rad.append(p + nn * 0.006)
            rader.append([bm.verts.new(x) for x in rad])
        for r0, r1 in zip(rader, rader[1:]):
            f = (r0[0], r0[1], r1[1], r1[0]) if sida < 0 else (r0[1], r0[0], r1[0], r1[1])
            bm.faces.new(f)
    b = obj(A, "Band", bm, kol, rig, [M["bla"]], "torso")
    tjocklek(A, b, 0.003)
    return b


def bygg_hals(A, K, kol, M, rig, L, hj):
    hals = L["hals"]
    me = K.obj.data
    skiva = [v.co for v in me.vertices if abs(v.co.z - (hals.z + 0.02)) < 0.015 and abs(v.co.x) < 0.1]
    rx = max(abs(c.x) for c in skiva) + 0.03
    yf, yb = min(c.y for c in skiva), max(c.y for c in skiva)
    yc = (yf + yb) / 2
    ry = (yb - yf) / 2 + 0.03
    bm = bmesh.new()
    z_top, z_l = hj["z_bot"] + 0.035, L["nyckel"] + 0.0
    for j, (za, zb_, ra, rb) in enumerate(((z_top, (z_top + z_l) / 2 - 0.005, 1.0, 1.18), ((z_top + z_l) / 2 + 0.008, z_l - 0.03, 1.15, 1.85))):
        prof = [(rx * ra, za), (rx * (ra + rb) / 2, (za + zb_) / 2), (rx * rb, zb_)]
        A.lathe(bm, prof, 32, rx=1.0, ry=ry / rx, matris=Matrix.Translation((0, yc, 0)))
    kant = bm.copy()
    o = obj(A, "Halsskydd", bm, kol, rig, [M["stal"]], "torso")
    tjocklek(A, o)
    rullkant(A, kant, "Halsskydd_Kant", kol, rig, [M["stal"]], r=0.0035, del_="torso", jamna=0)
    kant.free()


def bygg_axlar(A, K, kol, M, rig, L):
    bvh = bvh_typer(K, {"overarm", "nyckelben"})
    for s, namn in ((1, "V"), (-1, "H")):
        ax, ab, hl = K.arm(s)
        d = (ab - ax).normalized()
        sido = Vector((s, 0, 0))
        U, V = ram(d, sido)
        # kupa: halvklot över axelleden, öppen mot halsen
        c0 = ax + Vector((0, 0, 0.015))
        r_arm = arm_radie(K, ax + d * 0.06, d, 0.12) or 0.06
        R0 = min(r_arm, 0.07) + 0.05
        bm = bmesh.new()
        utat = (sido * 0.75 + Vector((0, 0, 0.66))).normalized()
        prof = [(0.0, R0)] + [(R0 * math.sin(math.radians(t)), R0 * math.cos(math.radians(t))) for t in range(10, 82, 9)]
        A.lathe(bm, prof, 28, matris=A.axel_matris(c0, utat))
        bort = [f for f in bm.faces if (f.calc_center_median() - c0).normalized().dot(-sido) > -0.05]
        bmesh.ops.delete(bm, geom=bort, context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        kant = bm.copy()
        k = obj(A, f"Axelskydd_{namn}_Kupa", bm, kol, rig, [M["stal"]], "upperArm")
        tjocklek(A, k)
        rullkant(A, kant, f"Axelskydd_{namn}_Kant", kol, rig, [M["stal"]], r=0.005, del_="upperArm")
        kant.free()
        # tre lameller ned över överarmen, varje lite större och överlappande
        nitbm = bmesh.new()
        for j in range(3):
            t0 = 0.03 + j * 0.045
            t1 = t0 + 0.058
            ra = (arm_radie(K, ax + d * t0, d, 0.12) or r_arm) + 0.042 + 0.004 * j
            rb = (arm_radie(K, ax + d * t1, d, 0.12) or r_arm) + 0.048 + 0.004 * j
            bm = bmesh.new()
            ringar = []
            bage = math.radians(250)
            for t, rr in ((t0, ra), ((t0 + t1) / 2, (ra + rb) / 2 + 0.003), (t1, rb + 0.004)):
                c = ax + d * t
                ringar.append([bm.verts.new(c + (U * math.cos(a) + V * math.sin(a)) * rr)
                               for a in [(-bage / 2 + bage * q / 20) for q in range(21)]])
            for r0, r1 in zip(ringar, ringar[1:]):
                for q in range(20):
                    bm.faces.new((r0[q], r0[q + 1], r1[q + 1], r1[q]))
            kant = bm.copy()
            lo = obj(A, f"Axelskydd_{namn}_Lam{j + 1}", bm, kol, rig, [M["stal"]], "upperArm")
            tjocklek(A, lo)
            rullkant(A, kant, f"Axelskydd_{namn}_Lam{j + 1}_Kant", kol, rig, [M["stal"]], r=0.0038, del_="upperArm", jamna=0)
            kant.free()
            for a in (-bage / 2 + 0.12, bage / 2 - 0.12):
                cc = ax + d * ((t0 + t1) / 2)
                nn = (U * math.cos(a) + V * math.sin(a))
                nit(nitbm, cc + nn * ((ra + rb) / 2 + 0.006), nn)
        obj(A, f"Axelskydd_{namn}_Nitar", nitbm, kol, rig, [M["massing"]], "upperArm")
    R.append("  Axelskydd: kupa + tre överlappande lameller per sida, nitar")


def bygg_armar(A, K, kol, M, rig, L):
    bvh = bvh_typer(K, {"overarm", "underarm"})
    for s, namn in ((1, "V"), (-1, "H")):
        ax, ab, hl = K.arm(s)
        d1, d2 = (ab - ax).normalized(), (hl - ab).normalized()
        L1, L2 = (ab - ax).length, (hl - ab).length
        for del_, (p0, d, t0, t1, ref_namn, utok) in (
                ("upperArm", (ax, d1, 0.16, L1 - 0.035, f"Armskydd_{namn}", 0.022)),
                ("forearm", (ab, d2, 0.045, L2 - 0.035, f"Underarm_{namn}", 0.02))):
            U, V = ram(d, Vector((s, 0, 0)))
            n = 8
            centra = [p0 + d * (t0 + (t1 - t0) * i / (n - 1)) for i in range(n)]
            Rr = radier(bvh, centra, [U] * n, [V] * n, maxd=0.2, harm=2, z_slat=2) + utok
            if del_ == "forearm":
                Rr[-1] += 0.004
            bm = ror_skal(centra, [U] * n, [V] * n, Rr)
            kant = bm.copy()
            o = obj(A, ref_namn, bm, kol, rig, [M["stal"]], del_)
            tjocklek(A, o)
            rullkant(A, kant, ref_namn + "_Kant", kol, rig, [M["stal"]], r=0.0038, del_=del_, jamna=0)
            kant.free()
        # armbågskopp: kupa bakom armbågen + vinge utåt
        bak = (d1 - d2)
        if bak.length < 0.05:
            bak = Vector((0, 1, 0))
        bak = (bak.normalized() + Vector((0, 0.6, 0))).normalized()
        hit = bvh.ray_cast(ab, bak, 0.2)
        r_ab = hit[3] if hit[0] is not None else 0.045
        c = ab + bak * (r_ab - 0.01)
        bm = bmesh.new()
        Rk = 0.05
        prof = [(0.0, Rk)] + [(Rk * math.sin(math.radians(t)), Rk * math.cos(math.radians(t))) for t in range(15, 80, 12)]
        A.lathe(bm, prof, 20, matris=A.axel_matris(c, bak))
        # vinge: en välvd skiva utåt-bakåt
        sido = Vector((s, 0, 0))
        vc = c + sido * (Rk * 0.55) + bak * 0.005
        vingn = (sido + bak * 0.4).normalized()
        A.lathe(bm, [(0.0, 0.012), (0.03, 0.006), (0.052, 0.0)], 18, matris=A.axel_matris(vc, vingn))
        kant = bm.copy()
        o = obj(A, f"Armbage_{namn}", bm, kol, rig, [M["stal"]], "forearm")
        tjocklek(A, o)
        nb = bmesh.new()
        nit(nb, vc + vingn * 0.013, vingn, r=0.008)
        obj(A, f"Armbage_{namn}_Nit", nb, kol, rig, [M["massing"]], "forearm")
        kant.free()
    R.append("  Armar: överarms- och underarmsskenor, armbågskopp med vinge")


def bygg_handskar(A, K, kol, M, rig, L):
    def behall(f, typ):
        return typ == "hand"

    def offset(v):
        return 0.006
    o = A.nytt_lager(K, f"SM_{P}_Handskar", behall, offset, [M["stal"]], kol=kol, dela=0, jamna_kant=2, mal_tris=1200)
    if o:
        o[P.lower()] = True
        o["kroppsdel"] = "hand"
        A.skarpa_kanter(o, 50)
    # handplåt över handryggen (mellanhanden) med rullad kant
    armar = {s: K.arm(s) for s in (1, -1)}

    def behall_plat(f, typ):
        if typ != "hand" or f.normal.z < 0.3:
            return False
        c = f.calc_center_median()
        s = 1 if c.x > 0 else -1
        ax, ab, hl = armar[s]
        d = (hl - ab).normalized()
        t = (c - hl).dot(d)
        return -0.005 < t < 0.085

    pl = A.nytt_lager(K, f"SM_{P}_Handskar_Plat", behall_plat, lambda v: 0.014, [M["stal"]], kol=kol, jamna_kant=2)
    if pl:
        pl[P.lower()] = True
        pl["kroppsdel"] = "hand"
        bmk = bmesh.new()
        bmk.from_mesh(pl.data)
        tjocklek(A, pl, 0.003)
        rullkant(A, bmk, "Handskar_Plat_Kant", kol, rig, [M["stal"]], r=0.003, del_="hand", jamna=1)
        bmk.free()
    # utsvängda kragar vid handleden
    bm = bmesh.new()
    for s in (1, -1):
        ax, ab, hl = K.arm(s)
        d = (hl - ab).normalized()
        r = (arm_radie(K, hl, d, 0.1) or 0.035)
        prof = [(r + 0.012, 0.0), (r + 0.024, -0.045), (r + 0.04, -0.075)]
        A.lathe(bm, [(rr, -z) for rr, z in prof], 20, matris=A.axel_matris(hl + d * 0.035, -d))
    kant = bm.copy()
    kr = obj(A, "Handskar_Kragar", bm, kol, rig, [M["stal"]], "hand")
    tjocklek(A, kr)
    rullkant(A, kant, "Handskar_Kragar_Kant", kol, rig, [M["massing"]], r=0.0035, del_="hand", jamna=0)
    kant.free()


def bygg_balten(A, K, kol, M, rig, L, skal_brost):
    bvh = bvh_typer(K, {"bal", "lar"})
    nitbm = bmesh.new()
    for namn, z, h in (("Balte_Ovre", A.BALTE_Z + 0.02, 0.042), ("Balte_Nedre", A.BALTE_Z - 0.055, 0.036)):
        n = 3
        z_l = [z + h / 2 - h * i / (n - 1) for i in range(n)]
        centra, U, V = torso_ringar(K, z_l, bvh)
        Rr = radier(bvh, centra, U, V, maxd=0.45, harm=3, z_slat=0)
        Rr[:] = Rr.mean(axis=0)
        Rr += 0.056 if namn == "Balte_Ovre" else 0.066
        for k in range(SEG):                                    # bröstplåten är tjockare framtill
            Rr[:, k] += 0.012 * max(0.0, -math.sin(2 * math.pi * k / SEG)) ** 2
        bm = ror_skal(centra, U, V, Rr)
        o = obj(A, namn, bm, kol, rig, [M["lader"]], "torso" if "Ovre" in namn else "pelvis")
        tjocklek(A, o, 0.005)
        for k in range(SEG):
            if k % 3 == 0:
                a = 2 * math.pi * k / SEG
                nn = Vector((math.cos(a), math.sin(a), 0))
                nit(nitbm, centra[1] + nn * (Rr[1, k] + 0.001), nn, r=0.0065)
        # spänne framtill
        a = -math.pi / 2
        p = centra[1] + Vector((0, -1, 0)) * (Rr[1, SEG * 3 // 4] + 0.003)
        sp = bmesh.new()
        bmesh.ops.create_cube(sp, size=1.0, matrix=Matrix.Translation(p) @ Matrix.Diagonal((0.055, 0.008, h * 1.25, 1)))
        inner = bmesh.ops.create_cube(sp, size=1.0, matrix=Matrix.Translation(p + Vector((0, -0.002, 0))) @ Matrix.Diagonal((0.036, 0.009, h * 0.7, 1)))
        obj(A, namn + "_Spanne", sp, kol, rig, [M["massing"]], "torso")
    obj(A, "Balte_Nitar", nitbm, kol, rig, [M["massing"]], "torso")


def bygg_kjol(A, K, kol, M, rig, L):
    """Blå och vita paneler från det nedre bältet till mitt på låret, spetsiga flikar, mjuka veck."""
    z_top = A.BALTE_Z + 0.004                       # under det övre bältet (ingen glipa mot bröstplåten)
    z_hem = L["kna"] + 0.24
    n = 9
    z_l = [z_top - (z_top - z_hem) * i / (n - 1) for i in range(n)]
    co = [v.co for v in K.obj.data.vertices]
    # höftens bredd och djup (bål + lår) i varje höjd; benen tillsammans som en ellips
    centra, U, V = [], [], []
    Rr = np.zeros((n, SEG))
    for i, z in enumerate(z_l):
        skiva = [c for c in co if abs(c.z - z) < 0.025 and abs(c.x) < 0.3 and abs(c.y) < 0.3]
        xm = max(abs(c.x) for c in skiva)
        yf, yb = min(c.y for c in skiva), max(c.y for c in skiva)
        cy = (yf + yb) / 2
        centra.append(Vector((0, cy, z)))
        U.append(Vector((1, 0, 0)))
        V.append(Vector((0, 1, 0)))
        ut = 0.03 + 0.05 * (i / (n - 1)) ** 1.3
        ax_, ay_ = xm + ut, (yb - yf) / 2 + ut
        for k in range(SEG):
            a = 2 * math.pi * k / SEG
            Rr[i, k] = 1.0 / math.sqrt((math.cos(a) / ax_) ** 2 + (math.sin(a) / ay_) ** 2)
    for _ in range(2):
        Rr[1:-1] = np.maximum(Rr[1:-1], (Rr[:-2] + Rr[2:]) / 2)
    PAN = 14
    per = SEG // PAN
    for i in range(n):
        for k in range(SEG):
            fas = (k % per) / per
            Rr[i, k] += 0.008 * math.sin(math.pi * fas) * (i / (n - 1))
    bm = ror_skal(centra, U, V, Rr, matfunk=lambda i, k: (k // per) % 2)
    # spetsiga flikar: varje panels nederkant dras ned i mitten
    sista = [v for v in bm.verts if abs(v.co.z - z_l[-1]) < 1e-5]
    for v in sista:
        a = math.atan2(v.co.y - centra[-1].y, v.co.x) % (2 * math.pi)
        k = round(a / (2 * math.pi) * SEG) % SEG
        if k % per == 1 or per == 1:
            v.co.z -= 0.045                       # panelens mitt: spetsen
    kj = obj(A, "Kjol", bm, kol, rig, [M["bla"], M["vit"]], "pelvis")
    tjocklek(A, kj, 0.004)
    R.append(f"  Kjol: {PAN} paneler, fåll z {z_hem:.2f}, spetsiga flikar")


def bygg_ben(A, K, kol, M, rig, L):
    bvh = bvh_typer(K, {"lar", "vad"})
    for s, k_ in ((1, "l"), (-1, "r")):
        namn = "V" if s > 0 else "H"
        hoft = A.ben_huvud(rig, f"thigh_twist.{k_}", f"thigh_stretch.{k_}", f"thigh_{k_}")
        kna = A.ben_huvud(rig, f"leg_stretch.{k_}", f"leg_twist.{k_}", f"calf_{k_}")
        vrist = A.ben_huvud(rig, f"foot.{k_}", f"foot_{k_}")
        d1, d2 = (kna - hoft).normalized(), (vrist - kna).normalized()
        L1, L2 = (kna - hoft).length, (vrist - kna).length
        fram = Vector((0, -1, 0))
        for del_, p0, d, t0, t1, del_namn, utok, n in (
                ("thigh", hoft, d1, 0.10, L1 - 0.06, f"Larskydd_{namn}", 0.026, 9),
                ("shin", kna, d2, 0.07, L2 + 0.004, f"Benskydd_{namn}", 0.024, 10)):
            U, V = ram(d, fram)
            centra = [p0 + d * (t0 + (t1 - t0) * i / (n - 1)) for i in range(n)]
            Rr = radier(bvh, centra, [U] * n, [V] * n, maxd=0.25, harm=2, z_slat=2) + utok
            if del_ == "shin":
                Rr[-1] += 0.012                        # utsvängd nederkant
                Rr[-2] += 0.004
                # skenans mittrygg framtill
                for i in range(n):
                    for k in range(SEG):
                        a = 2 * math.pi * k / SEG
                        Rr[i, k] += 0.006 * math.exp(-((math.atan2(math.sin(a), math.cos(a))) / 0.22) ** 2)
                behall = None
            else:
                # lårskyddet täcker fram och sidor (remmar baktill)
                behall = None                           # helt runt låret (som i konceptet)
            bm = ror_skal(centra, [U] * n, [V] * n, Rr, behall)
            kant = bm.copy()
            o = obj(A, del_namn, bm, kol, rig, [M["stal"]], del_)
            tjocklek(A, o)
            rullkant(A, kant, del_namn + "_Kant", kol, rig, [M["stal"]], r=0.0042, del_=del_, jamna=0)
            kant.free()
        # knäkopp med vinge
        U, V = ram(d1, fram)
        hit = bvh.ray_cast(kna, fram, 0.25)
        r_k = hit[3] if hit[0] is not None else 0.06
        c = kna + fram * (r_k - 0.012)
        bm = bmesh.new()
        Rk = 0.068
        prof = [(0.0, Rk)] + [(Rk * math.sin(math.radians(t)), Rk * math.cos(math.radians(t))) for t in range(14, 84, 10)]
        A.lathe(bm, prof, 22, matris=A.axel_matris(c, fram))
        sido = Vector((s, 0, 0))
        vc = c + sido * (Rk * 0.62) + Vector((0, 0.01, 0))
        vingn = (sido + fram * 0.3).normalized()
        A.lathe(bm, [(0.0, 0.012), (0.034, 0.006), (0.058, 0.0)], 18, matris=A.axel_matris(vc, vingn))
        o = obj(A, f"Knaskydd_{namn}", bm, kol, rig, [M["stal"]], "shin")
        tjocklek(A, o)
        nb = bmesh.new()
        nit(nb, c + fram * (Rk + 0.001), fram, r=0.009)
        nit(nb, vc + vingn * 0.013, vingn, r=0.008)
        obj(A, f"Knaskydd_{namn}_Nitar", nb, kol, rig, [M["massing"]], "shin")
    R.append("  Ben: lårskydd (fram och sidor), knäkopp med vinge, benskena med mittrygg")


def bygg_skor(A, K, kol, M, rig, L):
    """Sabatons: en slät plåtsko runt foten (tvärsnitt från fotens verkliga bredd och höjd),
    platt sula, rundad häl och en spets som går 5 cm förbi tårna."""
    bm_k = K.bm()
    dl = bm_k.verts.layers.deform.active
    fotgr = {i for i, n in enumerate(K.gnamn) if K.grupp_typ(n) == "fot"}
    fot = [v.co.copy() for v in bm_k.verts if sum(w for g, w in v[dl].items() if g in fotgr) > 0.5]
    bm_k.free()
    bm = bmesh.new()
    for s, k_ in ((1, "l"), (-1, "r")):
        vrist = A.ben_huvud(rig, f"foot.{k_}", f"foot_{k_}")
        P_ = [c for c in fot if c.x * s > 0.0]
        z0 = min(c.z for c in P_)
        y_hal, y_ta = max(c.y for c in P_), min(c.y for c in P_)
        z_topp = vrist.z + 0.0
        st = 14
        ringar = []
        for i in range(st + 1):
            t = i / st
            y = y_hal + 0.016 - (y_hal + 0.016 - (y_ta - 0.05)) * t
            skiva = [c for c in P_ if abs(c.y - y) < 0.024]
            if not skiva and y > y_ta and t < 0.5:          # bakom hälen: samma tvärsnitt som hälen
                skiva = [c for c in P_ if c.y > y_hal - 0.03]
            if skiva and y > y_ta:
                x0, x1 = min(c.x for c in skiva), max(c.x for c in skiva)
                h = max(c.z for c in skiva)
            else:                                      # förbi tårna: spetsen
                u = min(1.0, (y_ta - y) / 0.05)
                xc = (ringar_x[-1][0] + ringar_x[-1][1]) / 2 if ringar else vrist.x
                bw = (ringar_x[-1][1] - ringar_x[-1][0]) if ringar else 0.08
                x0, x1 = xc - bw / 2 * (1 - u) ** 1.4, xc + bw / 2 * (1 - u) ** 1.4
                h = z0 + (ringar_x[-1][2] - z0 if ringar else 0.05) * (1 - 0.7 * u)
            if i == 0:
                ringar_x = []
            ringar_x.append((x0, x1, h))
            xc = (x0 + x1) / 2
            hw = (x1 - x0) / 2 + (0.012 if y > y_ta else 0.012 * (1 - min(1.0, (y_ta - y) / 0.05)))
            top = min(h + 0.014, z_topp)
            hh = max(top - z0, 0.012)
            ring = []
            for q in range(13):                        # båge över foten, från ena sulkanten till den andra
                a = math.pi * q / 12
                ring.append(bm.verts.new((xc + math.cos(a) * hw, y, z0 + 0.008 + math.sin(a) * (hh - 0.008))))
            ring.append(bm.verts.new((xc - hw * 0.92, y, z0)))      # sulan
            ring.append(bm.verts.new((xc + hw * 0.92, y, z0)))
            ringar.append(ring)
        m = len(ringar[0])
        for r0, r1 in zip(ringar, ringar[1:]):
            for q in range(m):
                q2 = (q + 1) % m
                bm.faces.new((r0[q], r1[q], r1[q2], r0[q2]))
        bm.faces.new(list(reversed(ringar[0])))
        bm.faces.new(ringar[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = obj(A, "Skor", bm, kol, rig, [M["stal"]], "foot")
    tjocklek(A, o, 0.003)
    # lameller över vristen (följer skons yta) och mässingsrem runt fotleden
    sko = BVHTree.FromPolygons([v.co for v in o.data.vertices], [list(p.vertices) for p in o.data.polygons]) if o else None
    lam = bmesh.new()
    rem = bmesh.new()
    for s, k_ in ((1, "l"), (-1, "r")):
        vrist = A.ben_huvud(rig, f"foot.{k_}", f"foot_{k_}")
        r = arm_radie(K, vrist + Vector((0, 0, 0.02)), Vector((0, 0, 1)), 0.1) or 0.05
        A.lathe(rem, [(r + 0.018, 0.012), (r + 0.02, 0.0), (r + 0.018, -0.012)], 24, matris=Matrix.Translation(vrist + Vector((0, 0.005, 0.01))))
        if sko is None:
            continue
        for j in range(4):
            y = vrist.y - 0.035 - j * 0.026
            rader = []
            for dy in (-0.012, 0.012):
                rad = []
                for q in range(9):
                    x = vrist.x + (q / 8 - 0.5) * 0.10
                    hit = sko.ray_cast(Vector((x, y + dy, vrist.z + 0.25)), Vector((0, 0, -1)), 0.5)
                    if hit[0] is not None and hit[0].z > vrist.z - 0.09:
                        rad.append(hit[0] + Vector((0, 0, 0.004)) - Vector((0, dy * 0.15, 0)))
                rader.append(rad)
            if len(rader[0]) == len(rader[1]) >= 4:
                v0 = [lam.verts.new(p) for p in rader[0]]
                v1 = [lam.verts.new(p + Vector((0, 0, 0.003 * (j % 2)))) for p in rader[1]]
                for a, b, c_, d_ in zip(v0, v0[1:], v1[1:], v1):
                    lam.faces.new((a, d_, c_, b))
    if lam.faces:
        lo = obj(A, "Skor_Lameller", lam, kol, rig, [M["stal"]], "foot")
        tjocklek(A, lo, 0.003)
    else:
        lam.free()
    obj(A, "Skor_Rem", rem, kol, rig, [M["massing"]], "foot")


# =============================================================== huvudprogram
def kor():
    t0 = time.time()
    R.clear()
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    A = ladda(A_FIL, "A_c04")
    sakerhetskopia()
    rig, kropp = A.hitta_bas()
    A.landmarken(rig, kropp)
    L = A.L
    K = A.Kropp(kropp, rig, None)
    kol = samling()
    M = material()
    R.append(f"PLÅTRUSTNING – {time.strftime('%Y-%m-%d %H:%M')}")
    bygg_underlager(A, K, kol, M, rig, L)
    hj = bygg_hjalm(A, K, kol, M, rig)
    bp, skal, cy = bygg_brost(A, K, kol, M, rig, L)
    # bandet över bröstet är borttaget (v2): bröstplåten är ren metall, blått/vitt sitter på kjolen
    bygg_hals(A, K, kol, M, rig, L, hj)
    bygg_axlar(A, K, kol, M, rig, L)
    bygg_armar(A, K, kol, M, rig, L)
    bygg_handskar(A, K, kol, M, rig, L)
    bygg_balten(A, K, kol, M, rig, L, skal)
    bygg_kjol(A, K, kol, M, rig, L)
    bygg_ben(A, K, kol, M, rig, L)
    bygg_skor(A, K, kol, M, rig, L)
    # alla delar är barn till riggen; delar utan vikter får dem i exporten (C10)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in kol.objects if o.type == "MESH")
    R.append(f"Delar: {len(kol.objects)}, {tris} trianglar (utan kroppen)")
    bpy.ops.wm.save_mainfile()
    R.append(f"Tid {time.time() - t0:.1f} s")
    txt = "\n".join(R)
    t = bpy.data.texts.get("C12_rapport") or bpy.data.texts.new("C12_rapport")
    t.clear()
    t.write(txt)
    print(txt)
    return txt


if __name__ == "__main__":
    resultat_text = kor()
