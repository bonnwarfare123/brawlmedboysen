# Brawlmedboysen – v0.7

Ett medeltida 3D-brawlspel för 2–6 spelare i webbläsaren.

**v0.7 innehåller:** lobby där lobbyledaren startar matchen, rundor (först till 5), 5 rustningar, 6 hjälmar och 5 sköldformer att välja mellan, snabbt slag, tungt slag, stöt, spark, parering, hån-gester, skada per kroppsdel och avhuggna lemmar, ragdolls, mjuka rörelser, medeltida musik med volymreglage, och en levande arena med publik, by och natur. Servern avgör alla träffar.

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
| `public/js/arena.js` | Bygger arenan av enkla former |
| `public/js/knight.js` | Bygger riddaren (15 kroppsdelar med leder), animationer och kapning |
| `public/js/net.js` | Pratar med servern |
| `public/js/effects.js` | Blodstänk och gnistor |
| `public/js/ragdoll.js` | Egen fysik för döda kroppar och avhuggna delar |
| `public/js/sound.js` | Alla ljud och musiken, skapade direkt i koden |
| `public/audio/` | Lägg egna ljudfiler här (se LAS-MIG.txt i mappen) |
| `public/js/config.js` | **Inställningar** – fart, kamera, hopp m.m. Ändra här! |
| `public/js/shared.js` | **Strids- och matchregler** (skada, räckvidd, väntetider, rundor) som både spel och server använder |
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
