# Brawlmedboysen – v0.3

Ett medeltida 3D-brawlspel för 2–6 spelare i webbläsaren.

**v0.3 innehåller:** arena, enkla riddare, rum med inbjudningslänk, multiplayer, snabbt och tungt slag, parering, hopp, liv, död, återuppståndelse, blod och dråpräkning. Servern avgör alla träffar.

## Styrning

- **Klicka** i spelet för att styra kameran med musen
- **Vänster mus:** klicka = snabbt slag, håll in och släpp = tungt slag
- **Höger mus:** parera (tryck precis innan motståndarens slag träffar)
- **WASD** gå, **Shift** spring, **Mellanslag** hoppa, **Esc** släpp musen, **G** grafikläge

## Mappar och filer

| Fil | Vad den gör |
|---|---|
| `public/index.html` | Själva webbsidan |
| `public/js/main.js` | Startskärm, styrning, kamera, spel-loop |
| `public/js/arena.js` | Bygger arenan av enkla former |
| `public/js/knight.js` | Bygger riddaren och gånganimationen |
| `public/js/net.js` | Pratar med servern |
| `public/js/effects.js` | Blodstänk och gnistor |
| `public/js/config.js` | **Inställningar** – fart, kamera, hopp m.m. Ändra här! |
| `public/js/shared.js` | **Stridsregler** (skada, räckvidd, väntetider) som både spel och server använder |
| `server/index.js` | Servern (Cloudflare Worker + Durable Object) |
| `wrangler.jsonc` | Talar om för Cloudflare hur allt ska publiceras |

## Publicera första gången

1. Ladda upp **innehållet** i zip-filen till repots översta nivå på GitHub
   (`wrangler.jsonc` ska ligga direkt i repot, inte i en undermapp).
2. Gå till Cloudflare → **Workers & Pages** → **Create** → välj att importera ett
   GitHub-repo (*Import a repository*) och välj ditt repo.
3. Döp projektet till **riddarbrawl** (måste matcha `name` i `wrangler.jsonc`;
   det tekniska namnet syns bara i webbadressen, inte i spelet).
   Lämna byggkommandot tomt och låt deploy-kommandot vara `npx wrangler deploy`.
4. Klicka **Deploy**. Efter en minut får du en länk som slutar på `.workers.dev`.

Därefter publiceras varje ny uppladdning till GitHub automatiskt.

## Gratisgränser

Allt körs på Cloudflares gratisplan. Räcker kvoten inte till en dag slutar
servern svara tills gränsen nollställs kl. 01:00 (vintertid) eller 02:00 (sommartid) svensk tid.
Det kan aldrig bli någon faktura.
