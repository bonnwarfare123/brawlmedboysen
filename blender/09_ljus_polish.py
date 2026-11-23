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
        bg.inputs["Strength"].default_value = 0.8           # 0,62 → 0,8: mer indirekt ljus in under tak och läktare
        R.append("Himmelsljus 0,8 (förr 0,62)")
    sol = bpy.data.objects.get("Sol_Nyckel")
    if sol:
        sol.data.energy = 3.1
        sol.data.color = (1.0, 0.89, 0.76)                  # varm men inte orange eftermiddagssol
        sol.data.angle = 0.035                              # lite mjukare skuggkanter
        R.append("Sol 3,1 W/m² (förr 3,4), varmvit, mjukare skuggkant – mindre överexponering i sanden")
    for namn, e in (("Fyll_Lakare_Ost", 170.0), ("Fyll_Lakare_Vast", 170.0), ("Fyll_Adel_Ost", 85.0), ("Fyll_Adel_Vast", 85.0)):
        o = bpy.data.objects.get(namn)
        if o:
            o.data.energy = e
    R.append("Fyllljus under läktartaken 110 → 170 W, adelsläktarna 55 → 85 W (trä läsbart i skuggan)")
    sc.view_settings.exposure = -0.08
    R.append("Exponering −0,08")
    txt = "\n".join(R)
    print(txt)
    return txt

if __name__ == "__main__":
    resultat_text = kor()
