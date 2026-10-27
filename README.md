# Brawlmedboysen – v0.21

Ett medeltida 3D-brawlspel för 2–6 spelare i webbläsaren.

**Spelsätt** (lobbyledaren väljer, även bana – Tornerplatsen eller Borggården i vinter –, dag eller kväll, sol, regn eller dimma och upp till 3 träningsmotståndare som servern styr; alla trycker på redo-knappen så man ser när alla är redo): **Alla mot alla** (först till 5 rundor), **Lag** (Röda mot Blå, välj lag själv eller slumpa, inga skador på lagkamrater) och **Turnering** (1 mot 1 med utslagsträd, bäst av 3 per duell, fripass om det inte går jämnt ut).

**Riddarna:** verklighetstrogna proportioner (lite olika långa och breda) och kroppar med ovala lemmar, muskler, bröst och skulderblad. Ansiktena är kantiga och handgjorda i stilen och slumpas fram ur ditt namn (samma ansikte varje gång): sju hudtoner, frisyrer (spretig, rufsig, långt, snaggat, tunnhårig, flint) i åtta hårfärger, skägg (stubb, mustasch, knävelborr, helskägg, långt flätat skägg med guldring, pipskägg), kraftiga ögonbryn, snett leende, tandlucka, ärr, lapp för ögat, plåster, blåtira, fräknar, pannband och ibland krigsmålning (röda ränder, blått band, svart dödskalle). Uttryck: sammanbiten när man laddar, flämtar med lite liv, flinar när man vinner, ögonen följer motståndaren. 7 utstyrslar (bland annat en gycklare med bjällror och en fattig vandrande riddare i rostig, lappad rustning), 11 huvudbonader (tunnhjälm, visirhjälm, järnhatt, hornhjälm, plymhjälm, kastrull, halmhatt, ringbrynjehuva, sjal som täcker ansiktet, pälsmössa eller barhuvad) med riktiga hjälmprydnader (vingar, plym, kam), 5 sköldar, 11 vapen: svärd, yxa, slagkedja, stridshammare och dolk med knogjärn i vänsterhanden (dolken är blixtsnabb, tar tag i folk på längre håll och hugger medan man brottas; knogjärnet parerar lika bra som en sköld men tar inte emot kast), samt spjut, tvåhandssvärd, stridsyxa, hillebard, slägga och en jättelik zweihänder utan sköld. Tvåhandsvapnen är långsammare men når längre och slår hårdare. Hammare krossar i stället för att hugga av, slår av hjälmar och får fienden att vingla; släggan kan fälla den. Vapnen får hack i eggen under matchen och kan bytas mellan rundorna (mushjulet eller Z/X), valfri tygmantel som fladdrar (och aldrig fastnar uppåt), vapenrock i tyg, bucklor, repor, smuts och blod som byggs på under matchen, hjälmar som kan flyga av, ansikten med näsa, kindben, ögonlock och ögonbryn som rör sig, stön och skrik. Namnskyltarna krymper så de inte går in i varandra, och datorstyrda riddare har en BOT-skylt.

**Rörelser:** lederna rör sig som fjädrar med tyngd (de yttersta lederna släpar efter, så slagen piskar), vikten flyttas över foten man står på, höfterna gungar, axlarna vrider sig mot höfterna, man lutar sig in i svängar och när man sätter fart eller bromsar, huvudet håller blicken stilla, och när man står still andas man, väger från fot till fot, rättar till greppet och tittar runt. Träffar knuffar kroppen så att den rycker till och sviktar tillbaka.

**Dödsfall:** huvudet av: kroppen står kvar en stund och vinglar innan knäna viker sig. Stöt i magen: tar sig om magen, backar, går ner på knä och faller framåt. Vanligt dödande slag: vacklar bort från slaget och viker sig. Tunga slag kastar iväg kroppen, och den som förlorar ett ben tippar åt det hållet.

**Strid:** varje vapen har egna rörelser (snabba slag växlar mellan hugg och bakhandshugg, tunga slag och stötar med hela kroppen), snabbt slag, tungt slag, stöt (ett riktigt utfallssteg med egen, längre väntetid), spark som kan fälla motståndaren, kasta vapnet, ta tag i någon och brottas (knuffa, kasta omkull eller slå), huka, rulla (går inte att träffa mitt i rullningen), tappade vapen som kan plockas upp, sittande utan ben, parering, hån-gester, skada per kroppsdel och avhuggna lemmar, ragdolls med leder som bara böjer sig åt rätt håll, blod som stänker, sprutar, torkar och bildar pölar. Servern avgör alla träffar.

**Arenan:** tornerbarriär av plankor med järnband, lera nedtill, hängande tygdraperier och vapensköldar, upptrampad lerig sand där blodet sjunker in, eldkorgar med eld och rök, träningsdocka som snurrar när man slår på den, torn byggda av riktiga plankor (med stege, fönsterluckor och tinnar), krattad sand med småsten och halmstrån, läktare med plankbänkar, snidade räcken, tak med fransar och ståplats längst bak, levande publik (axlar, armbågar, kläder med veck, smala och runda, tydligare ansikten) med barn, gamla med käpp, damer och adelsmän (reser sig, jublar, klappar, pekar, dricker, äter, dunkar grannen i ryggen och viftar med hatten), försäljare som går runt, folk som går på marknaden, en lägereld med gryta och rök vid tälten, tätare gräs med blommor, damm som svävar i luften, hundar, fåglar och flugor runt elden, kungapar som visar tummen upp eller ner, vakter och en härold med trumpet.

**Grafik:** på hög grafik (F2) får ljusa saker ett mjukt glöd-sken, och färgtonen anpassas efter dag, kväll, regn och dimma (varmare på kvällen, gråare i regn, mörka hörn). Mjuka, fluffiga moln driver sakta över himlen på båda banorna (och blir ett grått molntäcke när det regnar eller snöar). På låg grafik stängs glöd, skuggor och dammet av. **F3** visar bilder per sekund, ritanrop och hur många millisekunder varje bild tar. Alla shaders byggs när banan laddas (inga ryck första gången något syns), bara de 4 eldarna närmast det du tittar på lyser upp omgivningen, och molnen och tyget kostar mindre.

**Topplista:** en gemensam lista för alla rum som visas i lobbyn (matchvinster, dråp och matcher), med ditt eget kort (placering, bästa vinstsvit, avhuggna lemmar, vilket vapen du vinner mest med). Ditt namn är ditt: en hemlig nyckel i webbläsaren gör att ingen annan kan ta det. Byter du dator använder du din återställningskod (lobbyn → "Visa min kod", och på startskärmen "Har du en återställningskod?"). Matcher räknas bara när minst två riktiga spelare är med.

**Borggården:** en borg i vinter med skarpa stenmurar (sockel, strävpelare, istappar och facklor), snötäckta torn med spåntak, egna små läktare för publiken (bara några få står uppe på murarna), en djup portgång med fackla och vindbrygga, smedja, ställningar med räcken och eldkorgar. Marken är lika detaljerad som på Tornerplatsen: upptrampad lera med snöslask, frusna pölar och småsten. När matchen börjar dras fällgallret upp och riddarna marscherar ut genom porten medan härolden ropar ut deras namn (tryck Mellanslag om alla vill hoppa över). Regn blir snöfall och dimma blir snöstorm, och man ser andedräkten i kylan.

**Startplatser** slumpas om varje runda, så man hamnar bredvid olika spelare.

**Efter matchen:** först visas matchens sista dråp i repris från en annan vinkel. Sedan reser sig en prispall ur sanden, de tre bästa ställer sig på den och firar, resten applåderar framför, och utmärkelser delas ut (Slaktaren, Muren, Klumpigast, Kastaren, Brottaren …).

## Styrning

Alla knappar kan bytas: tryck **⌨️ Tangenter** i lobbyn eller i menyn när musen är släppt (Esc). Här är standardknapparna:

- **Klicka** i spelet för att styra kameran med musen
- **Vänster mus:** klicka = snabbt slag, håll in och släpp = tungt slag
- **Q** eller **mittenknappen:** stöt (lång räckvidd men smal, går bara att göra ungefär var 1,5 sekund)
- **F:** spark, var 2:a sekund (knuffar bort, bryter laddning och parering, kan fälla – alltid bakifrån eller mot någon som laddar)
- **Ctrl** (eller **C**): huka (långsammare, huvudet svårt att träffa, dina slag går mot benen) · **Ctrl + Mellanslag:** rulla, även upp från marken. Spelet går i helskärm när du klickar för att spela; Ctrl fungerar bara där (i Chrome och Edge), annars används C. Helskärmen stängs av med `fullscreen: false` i `config.js`.
- **E:** ta upp ett vapen som ligger på marken
- **G:** kasta vapnet rakt fram (gör skada om det träffar, sedan slåss du med knytnävarna tills du tar upp ett vapen). Vapnet flyger på riktigt (ungefär 9,5 meter) och viner när det kommer: kliv åt sidan, rulla eller huka för att undvika det, parera för att slå bort det, eller ta emot det med skölden rakt framifrån (då tar du en tredjedel av skadan, och skölden är inte uppe mitt i ett slag, en spark, när du laddar ett tungt slag eller brottas)
- **R:** ta tag i den som står framför dig. Sedan: **vänster mus** slå, **R** knuffa iväg, **F** kasta omkull (1,5 sekunders väntetid). Den som ligger ner, eller precis har rest sig, går inte att ta tag i. Blir du fasthållen: tryck **R** snabbt för att slita dig loss
- **Mushjulet** eller **Z / X** mellan rundorna: byt vapen
- **Höger mus:** parera (tryck precis innan motståndarens slag träffar; skyddar i 0,45 s, går att göra var 0,8 s)
- **1, 2, 3:** buga, peka och skratta, dansa
- **WASD** gå, **Shift** spring, **Mellanslag** hoppa, **Esc** släpp musen, **F2** grafikläge, **F3** prestanda, **M** ljud av/på, **N** musik av/på (volymreglage finns i lobbyn och när du trycker Esc)
- **Siktet** mitt på skärmen: kroppsdelen du pekar på lyser upp. Träffa den tillräckligt många gånger så åker den av.

## Mappar och filer

| Fil | Vad den gör |
|---|---|
| `public/index.html` | Själva webbsidan |
| `public/js/main.js` | Startskärm, styrning, kamera, spel-loop |
| `public/js/arena.js` | Bygger arenan av enkla former (barriär, läktare, kungaloge, plankstorn, eldkorgar, träningsdocka, prispall) |
| `server/index.js` (Leaderboard) | Den gemensamma topplistan (ett eget Durable Object som heter BOARD i `wrangler.jsonc`) |
| `public/js/castle.js` | Borggården (vinterbanan) med porten som öppnas i introt |
| `public/js/keybinds.js` | Knappar som går att byta (sparas i webbläsaren) |
| `public/js/postfx.js` | Glöd och färgton (efterbehandling av bilden, bara på hög grafik) |
| `public/js/crowd.js` | Publiken, kungaparet, vakterna och härolden |
| `public/js/face.js` | Ansiktena: huvudets form, målad hud, hår, skägg, näsa (slumpas ur namnet) |
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
