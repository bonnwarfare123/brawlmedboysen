# Brawlmedboysen – v0.9

Ett medeltida 3D-brawlspel för 2–6 spelare i webbläsaren.

**Spelsätt** (lobbyledaren väljer): **Alla mot alla** (först till 5 rundor), **Lag** (Röda mot Blå, välj lag själv eller slumpa, inga skador på lagkamrater) och **Turnering** (1 mot 1 med utslagsträd, bäst av 3 per duell, fripass om det inte går jämnt ut).

**Riddarna:** 5 rustningar, 7 hjälmar (med riktiga ögonspringor och ett ansikte under), 5 sköldar, 3 vapen (svärd, yxa, slagkedja – alla lika starka), valfri tygmantel som fladdrar, vapenrock i tyg, bucklor, repor, smuts och blod som byggs på under matchen, hjälmar som kan flyga av, ansiktsuttryck, stön och skrik.

**Strid:** snabbt slag, tungt slag, stöt, spark, parering, hån-gester, skada per kroppsdel och avhuggna lemmar, ragdolls, blod som stänker, sprutar, torkar och bildar pölar. Servern avgör alla träffar.

**Arenan:** tornerbarriär med randigt tyg och sköldar, eldkorgar med eld och rök, träningsdocka som snurrar när man slår på den, levande publik (reser sig, jublar, viftar, kastar tomater på förlorare och rosor till vinnare), kungapar som visar tummen upp eller ner, vakter och en härold med trumpet.

## Styrning

- **Klicka** i spelet för att styra kameran med musen
- **Vänster mus:** klicka = snabbt slag, håll in och släpp = tungt slag
- **Q** eller **mittenknappen:** stöt (lång räckvidd men smal)
- **F:** spark (knuffar bort, bryter laddning och parering)
- **Höger mus:** parera (tryck precis innan motståndarens slag träffar)
- **1, 2, 3:** buga, peka och skratta, dansa
- **WASD** gå, **Shift** spring, **Mellanslag** hoppa, **Esc** släpp musen, **G** grafikläge, **M** ljud av/på, **N** musik av/på (volymreglage finns i lobbyn och när du trycker Esc)
- **Siktet** mitt på skärmen: kroppsdelen du pekar på lyser upp. Träffa den tillräckligt många gånger så åker den av.

## Mappar och filer

| Fil | Vad den gör |
|---|---|
| `public/index.html` | Själva webbsidan |
| `public/js/main.js` | Startskärm, styrning, kamera, spel-loop |
| `public/js/arena.js` | Bygger arenan av enkla former (barriär, läktare, kungaloge, eldkorgar, träningsdocka) |
| `public/js/crowd.js` | Publiken, kungaparet, vakterna, härolden och tomaterna/rosorna |
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
| `public/js/shared.js` | **Strids- och matchregler** (skada, räckvidd, väntetider, rundor, turneringen) som både spel och server använder |
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
