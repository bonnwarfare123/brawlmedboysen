"""
C13_platrustning_export.py  –  Brawl med Boysen: SPELMODELL FÖR PLÅTRUSTNINGEN
==============================================================================
Klistra in i Scripting-fliken i platrustning.blend och kör (efter C12). Använder det generella
exportskriptet C10_spelmodell_export.py (samma som Stadsvakten) med plåtrustningens inställningar
nedan. Resultatet: export/rustningar/plate.glb → kopieras till spelets public/models/rustningar/.
"""
# MARK: C13 v3
import bpy
import os
import importlib.util

KONFIG = {
    "nyckel": "plate",                     # rustningens nyckel i spelet ("Plåtrustning" i lobbyn)
    "namn": "Plåtrustning",
    "samling": "COL_Char_Platrustning",
    "rigg": "rig",
    "kropp": "body",
    "extra": ["Eye_Left", "Eye_Right"],
    "hoppa_over": ["Teeth"],
    "hjalm": ["Hjalm"],                    # hjälm, visir, kanter och nitar: en stel del som kan slås av
    "kjol": ["Kjol"],                      # hänger från höften och följer låren
    "axel": ["Axelskydd"],                 # följer överarmen nästan helt
    "bal": ["Balte", "Brostplat", "Halsskydd", "Nitar_Brost"],
    # dold yta: inre lager → yttre lager som täcker dem (huvudet tas INTE bort under hjälmen:
    # hjälmen kan slås av i spelet)
    "dold_yta": {
        "body": ["Underlager", "Brostplat", "Handskar", "Skor", "Benskydd", "Larskydd", "Armskydd",
                 "Underarm", "Kjol", "Halsskydd", "Axelskydd"],
        "Underlager": ["Brostplat", "Armskydd", "Underarm", "Larskydd", "Kjol", "Axelskydd", "Halsskydd"],
    },
    "kropp_bort": ["handL", "handR"],      # heltäckande plåthandskar: hudens fingrar bort
    "huvud_skala": 1.06,
    "axelbredd": 1.05,
    "hoft_behall": True,
    "kna_hojd": 0.515,
    "dekaler": [],
    "ej_bantning": ["Axelskydd_V_Kupa", "Axelskydd_H_Kupa", "Hjalm_Visir", "Knaskydd", "Armbage", "Nitar", "Spanne"],
    "hjalm_flytt": (0.0, 0.0, 0.0),
    "hjalm_kupa": 1.0,
    "hjalm_bratte": 1.0,
    "baka": True,
    "atlas": 2048,
    "kropp_tris": 6000,
    "mal_tris": 24000,                     # tung rustning: lite mer än Stadsvakten (19 000)
    "lagfarg": ["Tyg_Bla"],
    "material": [
        ("Tyg_Vit", "#ddd2bb", 0.9, 0.0), ("Tyg_Bla", "#2b4aa0", 0.9, 0.0),
        ("Stal_Visir", "#b9bcc2", 0.3, 1.0), ("Stal", "#b9bcc2", 0.3, 1.0),
        ("Massing", "#b08d45", 0.35, 0.9), ("Lader", "#5a3a22", 0.65, 0.0),
        ("Ringbrynja", "#6e6f72", 0.45, 0.9), ("Underlager", "#14100d", 0.92, 0.0),
    ],
    "ut": "export/rustningar/plate.glb",
}


def kor():
    p = os.path.join(bpy.path.abspath("//"), "C10_spelmodell_export.py")
    spec = importlib.util.spec_from_file_location("c10_plat", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.KONFIG = KONFIG
    m.R.clear()
    return m.kor()


if __name__ == "__main__":
    resultat_text = kor()
