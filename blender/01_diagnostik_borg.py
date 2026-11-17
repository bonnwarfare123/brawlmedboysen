# =====================================================================
#  BRAWL MED BOYSEN – STEG 1: DIAGNOSTIK AV BORGSCENEN
#  Klistra in i Blenders Scripting-flik och tryck "Run Script" (Alt+P).
#
#  Skriptet ÄNDRAR INGENTING i modellerna. Det bara mäter och skriver en rapport:
#   - i Blenders textredigerare (texten "DIAGNOS_borg")
#   - som en fil "diagnos_borg.txt" bredvid din .blend-fil (om filen är sparad)
#   - i systemkonsolen (Window > Toggle System Console)
#  Alla siffror räknas fram ur scenen – inget är uppskattat.
# =====================================================================
import bpy
import bmesh
import os
import math
from collections import defaultdict, Counter

# ---------------------------------------------------------------------
# 1. Kategorier (efter objektnamnen i scenen). Första träffen vinner.
# ---------------------------------------------------------------------
KATEGORIER = [
    ("Tak och taknockar",          ["Tak", "Taknock", "Vindskiv", "Spira"]),
    ("Huvudport och porthus",      ["Porthus", "Portmur", "Porttorn", "Portvalv", "Portgaller",
                                    "Portblad", "Portpassage", "Port_"]),
    ("Torn",                       ["Torn", "Murtorn", "Karntorn", "Krona", "Vaktkur"]),
    ("Murar",                      ["Mur_", "Murar_", "Murgang", "Vaktgang", "Brostvarn", "Konsolband",
                                    "Sockel", "Kvadersten", "Gesims"]),
    ("Arenans sand och mark",      ["Arena", "Mark_", "Skrankgang", "Vag", "Paradvag", "Tillfart", "Grav"]),
    ("Barriär och skrank",         ["Skrank", "Barriar"]),
    ("Läktare och träplattformar", ["Laktare", "Lakare", "Adelslaktare", "Trakonstruktion", "Staplatser",
                                    "Kungaloge", "Paviljong", "Gangplank"]),
    ("Flaggor och banér",          ["Baner", "Flagga", "Gonfalon", "Tyg", "Festong", "Duk"]),
    ("Trappor och dörrar",         ["Trappa", "Trapp", "Dorr", "Racken"]),
    ("Mindre byggnader",           ["Kok", "Smedja", "Stall", "Kasern", "Forrad", "Kapell", "Salen",
                                    "Lank_", "Vaktrum", "Rustskjul", "Kampeport", "Turneringsport",
                                    "Overbyggd", "Brunn", "Gavl", "Fonster", "Balkong"]),
]


def kategori(namn):
    for kat, nycklar in KATEGORIER:
        if any(n.lower() in namn.lower() for n in nycklar):
            return kat
    return "Övrigt (rekvisita m.m.)"


# ---------------------------------------------------------------------
# 2. Mätfunktioner
# ---------------------------------------------------------------------
dg = bpy.context.evaluated_depsgraph_get()


def mat_mesh(obj):
    """Trianglar, ytor och UV-täthet för objektet efter modifierare."""
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    mw = obj.matrix_world
    world_area = 0.0
    uv_area = 0.0
    uvl = me.uv_layers.active
    for p in me.polygons:
        pts = [mw @ me.vertices[i].co for i in p.vertices]
        a = 0.0
        for k in range(1, len(pts) - 1):
            a += ((pts[k] - pts[0]).cross(pts[k + 1] - pts[0])).length / 2
        world_area += a
        if uvl:
            uvs = [uvl.data[li].uv for li in p.loop_indices]
            u = 0.0
            for k in range(1, len(uvs) - 1):
                e1 = uvs[k] - uvs[0]
                e2 = uvs[k + 1] - uvs[0]
                u += abs(e1.x * e2.y - e1.y * e2.x) / 2
            uv_area += u
    zs = [(mw @ v.co).z for v in me.vertices] or [0.0]
    ev.to_mesh_clear()
    # UV-enheter per meter (1.0 = 1 UV-ruta per meter)
    tathet = math.sqrt(uv_area / world_area) if world_area > 1e-6 and uv_area > 0 else 0.0
    return tris, world_area, tathet, min(zs), bool(uvl)


def analysera_material(m):
    """Hur 'platt' är materialet? Kollar vad som är kopplat till Principled BSDF."""
    info = {"noder": 0, "bilder": 0, "procedur": 0, "bas_kopplad": False,
            "rough_kopplad": False, "normal_kopplad": False, "rough_varde": None,
            "metallic": None, "principled": False}
    if not m.use_nodes or not m.node_tree:
        info["rough_varde"] = round(m.roughness, 3)
        return info
    info["noder"] = len(m.node_tree.nodes)
    for n in m.node_tree.nodes:
        if n.type == "TEX_IMAGE":
            info["bilder"] += 1
        elif n.type in {"TEX_NOISE", "TEX_VORONOI", "TEX_MUSGRAVE", "TEX_WAVE", "TEX_BRICK", "TEX_MAGIC",
                        "TEX_GRADIENT", "TEX_WHITE_NOISE"}:
            info["procedur"] += 1
        elif n.type == "BSDF_PRINCIPLED":
            info["principled"] = True
            info["bas_kopplad"] = n.inputs["Base Color"].is_linked
            info["rough_kopplad"] = n.inputs["Roughness"].is_linked
            info["normal_kopplad"] = n.inputs["Normal"].is_linked
            if not n.inputs["Roughness"].is_linked:
                info["rough_varde"] = round(n.inputs["Roughness"].default_value, 3)
            if not n.inputs["Metallic"].is_linked:
                info["metallic"] = round(n.inputs["Metallic"].default_value, 3)
    return info


# ---------------------------------------------------------------------
# 3. Gå igenom scenen
# ---------------------------------------------------------------------
objekt = [o for o in bpy.context.scene.objects if o.type == "MESH"]
per_obj = []
per_kat = defaultdict(lambda: {"obj": 0, "tris": 0, "namn": []})
mat_anv = defaultdict(list)
mod_raknare = Counter()
utan_uv = []
svavande = []

for o in objekt:
    tris, area, tathet, zmin, har_uv = mat_mesh(o)
    kat = kategori(o.name)
    mods = [m.type for m in o.modifiers]
    mod_raknare.update(mods)
    mats = [s.material.name for s in o.material_slots if s.material]
    for mn in mats:
        mat_anv[mn].append(o.name)
    if not har_uv:
        utan_uv.append(o.name)
    # nära marken men inte på den (0,5–30 cm ovanför noll) = möjlig glipa mot marken
    if 0.005 < zmin < 0.30 and kat not in ("Arenans sand och mark", "Flaggor och banér"):
        svavande.append((o.name, round(zmin, 3)))
    per_obj.append({"namn": o.name, "kat": kat, "tris": tris, "area": area, "tathet": tathet,
                    "mods": mods, "mats": mats, "skala": tuple(round(s, 3) for s in o.scale),
                    "rot": any(abs(r) > 1e-4 for r in o.rotation_euler)})
    k = per_kat[kat]
    k["obj"] += 1
    k["tris"] += tris
    k["namn"].append(o.name)

material_info = {m.name: analysera_material(m) for m in bpy.data.materials if m.users > 0}

# ---------------------------------------------------------------------
# 4. Bedöm plastkänsla per objekt (de 8 punkterna i uppdraget)
# ---------------------------------------------------------------------
def problem_for(o):
    p = []
    infos = [material_info.get(mn) for mn in o["mats"] if mn in material_info]
    if infos and all(i["bilder"] == 0 and i["procedur"] == 0 and not i["bas_kopplad"] for i in infos):
        p.append("1 enkelt material (ingen textur)")
    if infos and all(not i["rough_kopplad"] for i in infos):
        p.append("2 ingen roughness-variation")
    if "BEVEL" not in o["mods"] and o["kat"] not in ("Flaggor och banér", "Arenans sand och mark"):
        p.append("3 inga avfasade kanter (Bevel saknas)")
    if infos and all(not i["normal_kopplad"] for i in infos):
        p.append("4 ingen ytstruktur (normal map saknas)")
    if o["tathet"] and (o["tathet"] < 0.25 or o["tathet"] > 4):
        p.append(f"5 tveksam materialskala ({o['tathet']:.2f} UV/m)")
    return p


# ---------------------------------------------------------------------
# 5. Skriv rapporten
# ---------------------------------------------------------------------
R = []
w = R.append
tot_tris = sum(o["tris"] for o in per_obj)
w("=" * 70)
w("DIAGNOS – " + (bpy.data.filepath or "(osparad fil)"))
w("=" * 70)
w(f"Mesh-objekt:          {len(objekt)}  (varav synliga och exporteras: {sum(1 for o in objekt if o.visible_get())})")
w(f"Trianglar totalt:     {tot_tris:,}  (efter modifierare)".replace(",", " "))
w(f"Trianglar i synliga objekt (det som exporteras): {sum(o['tris'] for o in per_obj if bpy.data.objects[o['namn']].visible_get()):,}".replace(",", " "))
w("  (dolda objekt, t.ex. i 99_Arkiv och 16z_Basmodeller, räknas i totalen men följer inte med i exporten)")
w(f"Unika material (används): {len(material_info)}")
w(f"Modifierare:          " + (", ".join(f"{k} x{v}" for k, v in mod_raknare.most_common()) or "inga"))
w(f"Objekt utan UV-karta: {len(utan_uv)}" + (f"  ({', '.join(utan_uv[:10])}{' …' if len(utan_uv) > 10 else ''})" if utan_uv else ""))
w(f"Objekt med oapplicerad skala: {sum(1 for o in per_obj if o['skala'] != (1.0, 1.0, 1.0))}")
w(f"Objekt med oapplicerad rotation: {sum(1 for o in per_obj if o['rot'])}")
w("")
w("-" * 70)
w("PER KATEGORI")
w("-" * 70)
for kat, _ in KATEGORIER + [("Övrigt (rekvisita m.m.)", [])]:
    if kat not in per_kat:
        continue
    k = per_kat[kat]
    w(f"{kat:30s} {k['obj']:4d} objekt  {k['tris']:8d} trianglar")
w("")
w("-" * 70)
w("MATERIAL")
w("-" * 70)
w(f"{'Namn':22s} {'obj':>4s} {'bild':>4s} {'proc':>4s} {'bas':>4s} {'rough':>7s} {'norm':>4s} {'metal':>5s}")
for mn, i in sorted(material_info.items()):
    rough = "länk" if i["rough_kopplad"] else (str(i["rough_varde"]) if i["rough_varde"] is not None else "-")
    w(f"{mn:22s} {len(mat_anv.get(mn, [])):4d} {i['bilder']:4d} {i['procedur']:4d} "
      f"{'ja' if i['bas_kopplad'] else 'nej':>4s} {rough:>7s} {'ja' if i['normal_kopplad'] else 'nej':>4s} "
      f"{str(i['metallic']) if i['metallic'] is not None else 'länk':>5s}")
w("  (bild = bildtexturer, proc = procedurtexturer, bas/norm = om Base Color / Normal är kopplade)")
w("")
w("-" * 70)
w("TYNGSTA OBJEKTEN (flest trianglar)")
w("-" * 70)
for o in sorted(per_obj, key=lambda o: -o["tris"])[:15]:
    w(f"{o['tris']:7d}  {o['namn']}  [{o['kat']}]")
w("")
w("-" * 70)
w("PLASTKÄNSLA – vad som saknas per kategori (antal objekt)")
w("-" * 70)
kat_problem = defaultdict(Counter)
for o in per_obj:
    for p in problem_for(o):
        kat_problem[o["kat"]][p.split(" (")[0]] += 1
for kat, c in kat_problem.items():
    w(f"{kat} ({per_kat[kat]['obj']} objekt):")
    for p, n in sorted(c.items()):
        w(f"    {n:4d} x  {p}")
w("")
w("Punkterna som inte går att mäta automatiskt (6 felaktiga tak-/byggnadsformer, 7 slitage,")
w("8 dåliga anslutningar) bedöms visuellt. Möjliga glipor mot marken (objekt 0,5–30 cm ovanför noll):")
for n, z in sorted(svavande, key=lambda t: t[1])[:25]:
    w(f"    {z:6.3f} m  {n}")
if not svavande:
    w("    inga hittades")
w("")
w("-" * 70)
w("ALLA OBJEKT (namn | kategori | trianglar | UV per meter | modifierare | material)")
w("-" * 70)
for o in sorted(per_obj, key=lambda o: (o["kat"], o["namn"])):
    w(f"{o['namn']} | {o['kat']} | {o['tris']} | {o['tathet']:.2f} | {','.join(o['mods']) or '-'} | {','.join(o['mats']) or '-'}")

text = "\n".join(R)
print(text)

# I Blenders textredigerare
t = bpy.data.texts.get("DIAGNOS_borg") or bpy.data.texts.new("DIAGNOS_borg")
t.clear()
t.write(text)

# Som fil bredvid .blend-filen (ingen hårdkodad sökväg)
if bpy.data.filepath:
    ut = os.path.join(bpy.path.abspath("//"), "diagnos_borg.txt")
    with open(ut, "w", encoding="utf-8") as f:
        f.write(text)
    print("\nRapporten sparad:", ut)
else:
    print("\nFilen är inte sparad – rapporten finns bara i textredigeraren (DIAGNOS_borg).")
