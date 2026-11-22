# =====================================================================
#  BRAWL MED BOYSEN – KUNGABORGEN: LJUSBALANS I BLENDER-SCENEN
#  Klistra in i Scripting-fliken (borg_aktuell.blend) och kör. Kan köras om (sätter samma värden).
#  Spelet har sitt eget ljus (main.js, borgAtmosphere) – det här gäller Blender-bilderna,
#  och är avstämt mot spelets nya värden: varmare sol, ljusare och varmare skuggor.
# =====================================================================
import bpy

def kor():
    sc = bpy.context.scene
    R = ["BORGEN – LJUSBALANS"]
    w = sc.world
    bg = next((n for n in w.node_tree.nodes if n.type == "BACKGROUND"), None) if w and w.node_tree else None
    if bg:
        bg.inputs["Strength"].default_value = 0.62          # 0,42 → 0,62: himmelsljuset fyller skuggorna
        R.append("Himmelsljus 0,62 (förr 0,42)")
    sol = bpy.data.objects.get("Sol_Nyckel")
    if sol:
        sol.data.energy = 3.4
        sol.data.color = (1.0, 0.89, 0.76)                  # varm men inte orange eftermiddagssol
        sol.data.angle = 0.035                              # lite mjukare skuggkanter
        R.append("Sol 3,4 W/m², varmvit, mjukare skuggkant")
    for namn, e in (("Fyll_Lakare_Ost", 110.0), ("Fyll_Lakare_Vast", 110.0), ("Fyll_Adel_Ost", 55.0), ("Fyll_Adel_Vast", 55.0)):
        o = bpy.data.objects.get(namn)
        if o:
            o.data.energy = e
    R.append("Fyllljus under läktartaken 70 → 110 W, adelsläktarna 35 → 55 W (trä syns i skuggan)")
    sc.view_settings.exposure = -0.1
    R.append("Exponering −0,25 → −0,10 (samma kontrastkurva)")
    txt = "\n".join(R)
    print(txt)
    return txt

if __name__ == "__main__":
    resultat_text = kor()
