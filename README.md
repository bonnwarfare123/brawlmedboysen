# Brawlmedboysen – v0.14

Ett medeltida 3D-brawlspel för 2–6 spelare i webbläsaren.

**Spelsätt** (lobbyledaren väljer, även dag eller kväll, sol, regn eller dimma och upp till 3 träningsmotståndare som servern styr; alla trycker på redo-knappen så man ser när alla är redo): **Alla mot alla** (först till 5 rundor), **Lag** (Röda mot Blå, välj lag själv eller slumpa, inga skador på lagkamrater) och **Turnering** (1 mot 1 med utslagsträd, bäst av 3 per duell, fripass om det inte går jämnt ut).

**Riddarna:** 6 utstyrslar (bland annat en gycklare med bjällror), 7 hjälmar med riktiga hjälmprydnader (vingar, plym, kam), 5 sköldar, 10 vapen: svärd, yxa, slagkedja, spjut och stridshammare med sköld, samt tvåhandssvärd, stridsyxa, hillebard, slägga och en jättelik zweihänder utan sköld. Tvåhandsvapnen är långsammare men når längre och slår hårdare. Hammare krossar i stället för att hugga av, slår av hjälmar och får fienden att vingla; släggan kan fälla den. Vapnen får hack i eggen under matchen och kan bytas mellan rundorna (mushjulet eller Z/X), valfri tygmantel som fladdrar, vapenrock i tyg, bucklor, repor, smuts och blod som byggs på under matchen, hjälmar som kan flyga av, ansiktsuttryck, stön och skrik.

**Strid:** varje vapen har egna rörelser (snabba slag växlar mellan hugg och bakhandshugg, tunga slag och stötar med hela kroppen), snabbt slag, tungt slag, stöt (ett riktigt utfallssteg med egen, längre väntetid), spark som kan fälla motståndaren, kasta vapnet, ta tag i någon och brottas (knuffa, kasta omkull eller slå), huka, rulla (går inte att träffa mitt i rullningen), tappade vapen som kan plockas upp, sittande utan ben, parering, hån-gester, skada per kroppsdel och avhuggna lemmar, ragdolls med leder som bara böjer sig åt rätt håll, blod som stänker, sprutar, torkar och bildar pölar. Servern avgör alla träffar.

**Arenan:** tornerbarriär med randigt tyg och sköldar, eldkorgar med eld och rök, träningsdocka som snurrar när man slår på den, torn byggda av riktiga plankor (med stege, fönsterluckor och tinnar), krattad sand med småsten och halmstrån, levande publik med barn, gamla med käpp, damer och adelsmän (reser sig, jublar, klappar, pekar, dricker, äter, dunkar grannen i ryggen och viftar med hatten), försäljare som går runt, hundar, fåglar och flugor runt elden, kungapar som visar tummen upp eller ner, vakter och en härold med trumpet.

**Efter matchen:** först visas matchens sista dråp i repris från en annan vinkel. Sedan reser sig en prispall ur sanden, de tre bästa ställer sig på den och firar, resten applåderar framför, och utmärkelser delas ut (Slaktaren, Muren, Klumpigast, Kastaren, Brottaren …).

## Styrning

- **Klicka** i spelet för att styra kameran med musen
- **Vänster mus:** klicka = snabbt slag, håll in och släpp = tungt slag
- **Q** eller **mittenknappen:** stöt (lång räckvidd men smal, går bara att göra ungefär var 1,5 sekund)
- **F:** spark (knuffar bort, bryter laddning och parering, kan fälla – alltid bakifrån eller mot någon som laddar)
- **Ctrl** (eller **C**): huka (långsammare, huvudet svårt att träffa, dina slag går mot benen) · **Ctrl + Mellanslag:** rulla, även upp från marken. Spelet går i helskärm när du klickar för att spela; Ctrl fungerar bara där (i Chrome och Edge), annars används C. Helskärmen stängs av med `fullscreen: false` i `config.js`.
- **E:** ta upp ett vapen som ligger på marken
- **G:** kasta vapnet rakt fram (gör skada om det träffar, sedan slåss du med knytnävarna tills du tar upp ett vapen)
- **R:** ta tag i den som står framför dig. Sedan: **vänster mus** slå, **R** knuffa iväg, **F** kasta omkull. Blir du fasthållen: tryck **R** snabbt för att slita dig loss
- **Mushjulet** eller **Z / X** mellan rundorna: byt vapen
- **Höger mus:** parera (tryck precis innan motståndarens slag träffar; skyddar i 0,45 s, går att göra var 0,8 s)
- **1, 2, 3:** buga, peka och skratta, dansa
- **WASD** gå, **Shift** spring, **Mellanslag** hoppa, **Esc** släpp musen, **F2** grafikläge, **M** ljud av/på, **N** musik av/på (volymreglage finns i lobbyn och när du trycker Esc)
- **Siktet** mitt på skärmen: kroppsdelen du pekar på lyser upp. Träffa den tillräckligt många gånger så åker den av.

## Mappar och filer

| Fil | Vad den gör |
|---|---|
| `public/index.html` | Själva webbsidan |
| `public/js/main.js` | Startskärm, styrning, kamera, spel-loop |
| `public/js/arena.js` | Bygger arenan av enkla former (barriär, läktare, kungaloge, plankstorn, eldkorgar, träningsdocka, prispall) |
| `public/js/crowd.js` | Publiken, kungaparet, vakterna och härolden |
| `public/js/cloth.js` | Fysik för tyg (mantel, vapenrock) och kedjan på slagkedjan |
| `public/js/knight.js` | Bygger riddaren (15 kroppsdelar med leder), ansikte, rustningar, hjälmar, vapen, skador, animationer och kapning |
| `public/js/ik.js` | Räknar ut hur benen ska böjas så att fötterna står på marken |
| `public/js/textures.js` | Ritar mönster i koden: ringbrynja, läder, vapensköldar, blodfläckar m.m. |
| `public/js/net.js` | Pratar med servern |
| `public/js/effects.js` | Blod (droppar, strålar, fläckar, pölar), gnistor, damm och fotspår |
| `public/js/ragdoll.js` | Egen fysik för döda kroppar och avhuggna delar |
| `public/js/sound.js` | Alla ljud och musiken, skapade direkt i koden |
| `public/audio/` | Lägg egna ljudfiler här (se LAS-MIG.txt i mappen) |
| `public/js/config.js` | **Inställningar** – fart, kamera, hopp m.m. Ändra här! |
| `public/js/shared.js` | **Strids- och matchregler** (skada, räckvidd, väntetider, vapnens egenskaper i `WEAPON_SPECS`, rundor, turneringen) som både spel och server använder |
| `server/index.js` | Servern (Cloudflare Worker + Durable Object) |
| `wrangler.jsonc` | Talar om för Cloudflare hur allt ska publiceras |

## Publicera första gången

1. Ladda upp **innehållet** i zip-filen till repots översta nivå på GitHub
   (`wrangler.jsonc` ska ligga direkt i repot, inte i en undermapp).
2. Gå till Cloudflare → **Workers & Pages** → **Create** → välj att importera ett
   GitHub-repo (*Import a repository*) och välj ditt repo.
3. Döp projektet till **brawlmedboysen** (måste matcha `name` i `wrangler.jsonc`;
   det tekniska namnet syns bara i webbadressen, inte i spelet).
   Lämna byggkommandot tomt och låt deploy-kommandot vara `npx wrangler deploy`.
4. Klicka **Deploy**. Efter en minut får du en länk som slutar på `.workers.dev`.

Därefter publiceras varje ny uppladdning till GitHub automatiskt.

## Gratisgränser

Allt körs på Cloudflares gratisplan. Räcker kvoten inte till en dag slutar
servern svara tills gränsen nollställs kl. 01:00 (vintertid) eller 02:00 (sommartid) svensk tid.
Det kan aldrig bli någon faktura.
