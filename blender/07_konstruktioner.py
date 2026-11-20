# =====================================================================
#  BRAWL MED BOYSEN – 07: KORRIGERA KONSTIGA KONSTRUKTIONER
#  Klistra in i Blenders Scripting-flik (borg_aktuell.blend) och kör.
#
#  Problem som hittades vid granskningen (renderingar från 8 vinklar + strålar
#  under varje objekt för att hitta sådant som svävar) och hur de rättas:
#
#   1. Kärntornets tak och murtornens tak (Murtorn_SV, Murtorn_NO):
#      Fas C gjorde om valmade tak till "sadeltak", men nocken blev bara 1,6 m
#      lång. Resultatet blev sneda stengavlar som ligger i takfallen och sticker
#      igenom taket som spetsiga stentrianglar.
#      → Riktiga sadeltak: nocken går hela vägen mellan gavlarna och gavlarna står
#        lodrätt, murade upp från tornets murkrön. Takfallen vilar på gavlarna.
#   2. Kämpeportarna (öst och väst): taket låg vridet 90° och hängde 2 m ut över
#      arenan och 2 m utanför porten, utan stöd (porten är bara en ram).
#      → Porten blir en täckt port: en andra portram 1,9 m bakom den första,
#        hammarband som binder ihop ramarna, sadeltak över båda ramarna med gaveln
#        mot arenan, nya vindskivor och gavelfyllning. Det gamla taket och dess
#        lösa vindskivor/gavelbräder tas bort.
#   3. Vaktkuren på norra tornet: stod i hörnet så att tinnarna skar rakt
#      igenom kuren.
#      → Flyttas in till mitten av tornets tak (fri från tinnarna).
#
#  Granskat men inte ändrat (fungerar redan konstruktivt): kärntornets hörntorn
#  (vilar på hörnens strävpelare), kungalogens sadeltak,
#  balkongen på stora salen (har stolpar ned till terrassen), vaktgångarna på
#  södra muren (trähurtsar på bjälkkonsoler), porttornen, läktarnas tak.
#
#  Regler: säkerhetskopia först, inga fungerande objekt raderas (bara lösa
#  bitar av gamla tak), inga nya material, arenan/kollision/spelmått orörda.
#  Kan köras flera gånger – redan rättade objekt hoppas över.
# =====================================================================
import bpy
import bmesh
import math
import os
import time
from mathutils import Vector, Matrix

UPP = Vector((0, 0, 1))
TAKTJOCKLEK = 0.15
SPRANG_GAVEL = 0.30
SPRANG_FOT = 0.25
MARK = "fix07"

TAK_MED_GAVEL = [("Karntorn_Tak", "SM_Gavel_Karntorn_Tak"),
                 ("Murtorn_SV_Tak", "SM_Gavel_Murtorn_SV_Tak"),
                 ("Murtorn_NO_Tak", "SM_Gavel_Murtorn_NO_Tak")]

R = []
dg = None


# ---------------------------------------------------------------- hjälp
def trianglar(o):
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    t = sum(len(p.vertices) - 2 for p in me.polygons)
    ev.to_mesh_clear()
    return t


def synliga():
    return [o for o in bpy.context.view_layer.objects if o.type == "MESH" and o.visible_get()]


def lutnings_uv(o):
    """UV i meter längs takytan (samma som Fas C): U längs takfoten, V uppför."""
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


def lad_uv(o, polys=None):
    """Lådprojektion i meter (sten, trä)."""
    me = o.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    mw = o.matrix_world
    for p in (polys if polys is not None else me.polygons):
        n = (mw.to_3x3() @ p.normal)
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            w = mw @ me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (w.x, w.y) if ax == 2 else ((w.y, w.z) if ax == 0 else (w.x, w.z))


def lada(bm, mn, mx):
    """Box mellan två hörn (världskoordinater) i en bmesh."""
    x0, y0, z0 = mn
    x1, y1, z1 = mx
    v = [bm.verts.new(p) for p in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                                   (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    fs = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return [bm.faces.new([v[i] for i in f]) for f in fs]


def prisma(bm, pts, djup):
    """Tjock polygon: pts (världen) + samma förskjutna med 'djup'."""
    a = [bm.verts.new(p) for p in pts]
    b = [bm.verts.new(p + djup) for p in pts]
    n = len(pts)
    fs = [bm.faces.new(a), bm.faces.new(list(reversed(b)))]
    for i in range(n):
        fs.append(bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n])))
    return fs


def nytt_objekt(namn, bm, mat_namn, kol, fas=None):
    gammal = bpy.data.objects.get(namn)
    if gammal:
        me_g = gammal.data
        bpy.data.objects.remove(gammal, do_unlink=True)
        if me_g.users == 0:
            bpy.data.meshes.remove(me_g)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(namn)
    bm.to_mesh(me)
    bm.free()
    mat = bpy.data.materials.get(mat_namn)
    if mat:
        me.materials.append(mat)
    o = bpy.data.objects.new(namn, me)
    kol.objects.link(o)
    o[MARK] = True
    lad_uv(o)
    if fas:
        b = o.modifiers.new("Fasning_07", "BEVEL")
        b.width = fas
        b.segments = 1
        b.limit_method = "ANGLE"
        b.angle_limit = math.radians(35)
    return o


# ---------------------------------------------------------------- 1. sadeltak med lodräta gavlar
def ratta_sadeltak(tak_namn, gavel_namn):
    tak = bpy.data.objects.get(tak_namn)
    gav = bpy.data.objects.get(gavel_namn)
    if not tak or not gav:
        return "finns inte – hoppas över"
    if tak.get(MARK):
        return "redan rättat"
    me = gav.data
    if len(me.vertices) != 12:
        return f"gaveln har {len(me.vertices)} hörn (väntade 12) – orörd"
    gmw = gav.matrix_world
    W = [gmw @ v.co for v in me.vertices]
    gavlar = []
    for k in range(2):
        A, B, C = W[6 * k], W[6 * k + 1], W[6 * k + 2]
        djup = W[6 * k + 3] - W[6 * k]
        M = (A + B) / 2
        Cn = Vector((M.x, M.y, C.z))               # lodrät gavel: spetsen över basens mitt
        gavlar.append((A, B, Cn, djup, M))
    # flytta gavelns spets (fram- och baksida) – resten av gaveln är redan rätt
    inv = gmw.inverted()
    for k, (A, B, Cn, djup, M) in enumerate(gavlar):
        me.vertices[6 * k + 2].co = inv @ Cn
        me.vertices[6 * k + 5].co = inv @ (Cn + djup)
    me.update()
    lad_uv(gav)

    # nytt takfall: nocken mellan gavlarnas spetsar, takfot längs gavlarnas baser
    (A1, B1, C1, d1, M1), (A2, B2, C2, d2, M2) = gavlar
    dr = M2 - M1
    dr.z = 0
    langd = dr.length
    dr.normalize()
    tvars = Vector((-dr.y, dr.x, 0))
    R1 = C1 + UPP * TAKTJOCKLEK
    R2 = C2 + UPP * TAKTJOCKLEK
    tinv = tak.matrix_world.inverted()
    bm = bmesh.new()
    for tecken in (1, -1):
        E1 = max((A1, B1), key=lambda p: tecken * p.dot(tvars))
        E2 = max((A2, B2), key=lambda p: tecken * p.dot(tvars))
        ned = (E1 - R1)
        ned.normalize()
        p = [E1 + ned * SPRANG_FOT - dr * SPRANG_GAVEL, E2 + ned * SPRANG_FOT + dr * SPRANG_GAVEL,
             R2 + dr * SPRANG_GAVEL, R1 - dr * SPRANG_GAVEL]
        f = bm.faces.new([bm.verts.new(tinv @ q) for q in p])
        if (tak.matrix_world.to_3x3() @ f.normal).z < 0:
            f.normal_flip()
    bm.to_mesh(tak.data)
    bm.free()
    tak.data.update()
    lutnings_uv(tak)
    tak[MARK] = True
    gav[MARK] = True
    vinkel = math.degrees(math.atan2(C1.z - A1.z, (A1 - M1).length))
    return f"sadeltak med nock {langd + 2 * SPRANG_GAVEL:.1f} m, lodräta stengavlar, taklutning {vinkel:.0f}°"


# ---------------------------------------------------------------- 2. täckta kämpeportar
def ta_bort_oar(o, villkor):
    """Tar bort sammanhängande delar av ett objekt där alla hörn uppfyller villkoret."""
    if not o:
        return 0
    bm = bmesh.new()
    bm.from_mesh(o.data)
    mw = o.matrix_world
    besokt, bort, antal = set(), [], 0
    for v in bm.verts:
        if v in besokt:
            continue
        stack, oar = [v], []
        besokt.add(v)
        while stack:
            x = stack.pop()
            oar.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y not in besokt:
                    besokt.add(y)
                    stack.append(y)
        if all(villkor(mw @ q.co) for q in oar):
            bort += oar
            antal += 1
    if bort:
        bmesh.ops.delete(bm, geom=bort, context="VERTS")
        bm.to_mesh(o.data)
        o.data.update()
    bm.free()
    return antal


def kampeport(sida, kol):
    namn = "Kampeport_Vast" if sida < 0 else "Kampeport_Ost"
    port = bpy.data.objects.get(namn)
    tak = bpy.data.objects.get(namn + "_Tak")
    if not port or not tak:
        return f"{namn}: finns inte"
    if port.get(MARK):
        return f"{namn}: redan rättad"
    s = sida
    XF, XB = 13.30, 15.20          # främre (befintlig) och bakre (ny) portram, |x|
    Y1, Y2 = -6.30, -3.70          # stolparnas mitt
    YM = (Y1 + Y2) / 2
    def X(a):
        return s * a

    def bx(a0, a1):
        return (min(X(a0), X(a1)), max(X(a0), X(a1)))

    # --- ny portram + hammarband (läggs till i portens egen mesh)
    bm = bmesh.new()
    bm.from_mesh(port.data)
    gamla = set(bm.faces)
    pinv = port.matrix_world.inverted()
    nya_f = []
    x0, x1 = bx(XB - 0.18, XB + 0.18)
    for yc in (Y1, Y2):
        nya_f += lada(bm, (x0, yc - 0.18, 0.0), (x1, yc + 0.18, 3.0))           # stolpe
    x0, x1 = bx(XB - 0.25, XB + 0.25)
    nya_f += lada(bm, (x0, -6.50, 3.0), (x1, -3.50, 3.40))                       # överliggare
    x0, x1 = bx(XF - 0.25, XB + 0.25)
    for yc in (Y1, Y2):
        nya_f += lada(bm, (x0, yc - 0.17, 3.40), (x1, yc + 0.17, 3.62))          # hammarband
    # snedsträvor (knutband) mellan stolpe och överliggare, båda ramarna
    for xa in (XF, XB):
        for yc, riktn in ((Y1, 1), (Y2, -1)):
            p0 = Vector((X(xa), yc + riktn * 0.18, 2.45))
            p1 = Vector((X(xa), yc + riktn * 0.75, 3.0))
            t = (p1 - p0).normalized()
            n = Vector((1, 0, 0))
            b = t.cross(n).normalized() * 0.07
            pts = [p0 - b, p1 - b, p1 + b, p0 + b]
            nya_f += prisma(bm, [q - n * 0.07 for q in pts], n * 0.14)
    for v in bm.verts:
        if v.link_faces and all(f not in gamla for f in v.link_faces):
            v.co = pinv @ v.co
    bm.normal_update()
    bm.to_mesh(port.data)
    bm.free()
    port.data.update()
    nya_index = range(len(port.data.polygons) - len(nya_f), len(port.data.polygons))
    lad_uv(port, [port.data.polygons[i] for i in nya_index])

    # --- nytt tak (samma objekt och material): sadeltak med nocken längs passagen
    XA, XZ = 12.80, 15.50          # takets ändar (|x|), slutar före rustskjulets tak (15,55)
    YE1, YE2 = -6.85, -3.15
    ZFOT, ZNOCK = 3.42, 4.55
    tinv = tak.matrix_world.inverted()
    bm = bmesh.new()
    for ye in (YE1, YE2):
        p = [Vector((X(XA), ye, ZFOT)), Vector((X(XZ), ye, ZFOT)),
             Vector((X(XZ), YM, ZNOCK)), Vector((X(XA), YM, ZNOCK))]
        f = bm.faces.new([bm.verts.new(tinv @ q) for q in p])
        if (tak.matrix_world.to_3x3() @ f.normal).z < 0:
            f.normal_flip()
    bm.to_mesh(tak.data)
    bm.free()
    tak.data.update()
    lutnings_uv(tak)

    # --- gamla lösa vindskivor och gavelbräder från det vridna taket
    def gammal_bit(w):
        return 11.2 < abs(w.x) < 15.4 and -5.9 < w.y < -4.1 and w.z > 3.0
    n1 = ta_bort_oar(bpy.data.objects.get("Vindskivor_Portar"), gammal_bit)
    n2 = ta_bort_oar(bpy.data.objects.get("Gavelfyllning_Tra"), gammal_bit)

    # --- nya gavlar (gavelfyllning) och vindskivor, eget objekt
    bm = bmesh.new()
    halv = (YE2 - YE1) / 2
    lut = (ZNOCK - ZFOT) / halv
    for xa, inat in ((XA + 0.22, 1), (XZ - 0.22, -1)):
        # gavelfyllning (brädor) ovanpå överliggaren
        pts = [Vector((X(xa), -6.45, 3.62)), Vector((X(xa), -3.55, 3.62)),
               Vector((X(xa), YM, 3.62 + 1.45 * lut - 0.12))]
        prisma(bm, pts, Vector((s * inat * 0.05, 0, 0)))
        # vindskivor längs takets gavelkant
        for ye in (YE1, YE2):
            a = Vector((X(XA if inat > 0 else XZ), ye, ZFOT - 0.04))
            b = Vector((X(XA if inat > 0 else XZ), YM, ZNOCK + 0.06))
            t = (b - a).normalized()
            n = Vector((1, 0, 0))
            q = t.cross(n).normalized() * 0.11
            prisma(bm, [a - q, b - q, b + q, a + q], Vector((s * inat * 0.05, 0, 0)))
    g = nytt_objekt(f"SM_{namn}_Gavlar", bm, "MAT_Tra_Konstruktion", port.users_collection[0], fas=0.01)
    port[MARK] = True
    tak[MARK] = True
    return (f"{namn}: täckt port – ny bakre ram (2 stolpar, överliggare, knutband), hammarband, "
            f"sadeltak {XZ - XA:.1f} × {YE2 - YE1:.1f} m med gaveln mot arenan; "
            f"borttaget {n1} lösa vindskivor + {n2} gavelbräder; nytt {g.name}")


# ---------------------------------------------------------------- 3. vaktkuren
def flytta_vaktkur():
    kur = bpy.data.objects.get("Torn_N_Vaktkur")
    tak = bpy.data.objects.get("Torn_N_Vaktkur_Tak")
    torn = bpy.data.objects.get("Torn_N_fyrk")
    if not kur or not torn:
        return "finns inte"
    if kur.get(MARK):
        return "redan flyttad"
    tw = [torn.matrix_world @ Vector(c) for c in torn.bound_box]
    mitt = Vector(((min(w.x for w in tw) + max(w.x for w in tw)) / 2, (min(w.y for w in tw) + max(w.y for w in tw)) / 2))
    kw = [kur.matrix_world @ Vector(c) for c in kur.bound_box]
    kmitt = Vector(((min(w.x for w in kw) + max(w.x for w in kw)) / 2, (min(w.y for w in kw) + max(w.y for w in kw)) / 2))
    d = mitt - kmitt
    for o in (kur, tak):
        if o:
            o.location.x += d.x
            o.location.y += d.y
            o[MARK] = True
    return f"flyttad {d.length:.2f} m in till tornets mitt (fri från tinnarna)"


# ---------------------------------------------------------------- huvudprogram
def kor():
    global dg
    if not bpy.data.filepath:
        raise RuntimeError("Spara .blend-filen först (File > Save).")
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    if not globals().get("SKIPPA_KOPIA"):
        mapp = os.path.join(bpy.path.abspath("//"), "versioner")
        os.makedirs(mapp, exist_ok=True)
        kopia = os.path.join(mapp, time.strftime("fore_07_%Y%m%d_%H%M%S.blend"))
        bpy.ops.wm.save_as_mainfile(filepath=kopia, copy=True)
        R.append(f"Säkerhetskopia: {kopia}")

    dg = bpy.context.evaluated_depsgraph_get()
    fore_tris = sum(trianglar(o) for o in synliga())
    fore_mat = len({s.material.name for o in synliga() for s in o.material_slots if s.material})
    fore_obj = len(synliga())

    R.append("\n1. TAK MED STENGAVLAR (sneda gavlar genom taket → riktiga sadeltak):")
    for t, g in TAK_MED_GAVEL:
        R.append(f"  {t}: {ratta_sadeltak(t, g)}")

    R.append("\n2. KÄMPEPORTARNA (vridet tak utan stöd → täckt port):")
    for s in (-1, 1):
        R.append("  " + kampeport(s, None))

    # hörntornen vilar redan på strävpelarna – konsoler från en tidigare testkörning tas bort
    gammal = bpy.data.objects.get("SM_Karntorn_Hornturn_Konsoler")
    if gammal:
        me_g = gammal.data
        bpy.data.objects.remove(gammal, do_unlink=True)
        if me_g.users == 0:
            bpy.data.meshes.remove(me_g)

    R.append("\n3. VAKTKUREN PÅ NORRA TORNET (tinnarna skar igenom):")
    R.append("  Torn_N_Vaktkur: " + flytta_vaktkur())

    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    efter_tris = sum(trianglar(o) for o in synliga())
    efter_mat = len({s.material.name for o in synliga() for s in o.material_slots if s.material})
    efter_obj = len(synliga())
    R.append(f"\nTRIANGLAR (synliga objekt = det som exporteras): {fore_tris} → {efter_tris} "
             f"({efter_tris - fore_tris:+d})")
    R.append(f"MATERIAL i bruk: {fore_mat} → {efter_mat}   objekt: {fore_obj} → {efter_obj}")
    R.append("Inget i arenan, skranket eller marken har ändrats. Kör 05_fasE_bake_export.py för ny borg.glb.")
    txt = "\n".join(R)
    print(txt)
    return txt


if __name__ == "__main__":
    resultat_text = kor()
