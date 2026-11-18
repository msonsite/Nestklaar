# Nestklaar

Gedeelde verhuis- en inboedelchecklist met kostenoverzicht. Werkt als website én als installeerbare app op iPhone en Android (PWA). Iedereen die de link heeft, werkt live samen in dezelfde lijst via Supabase. Aanmelden is niet nodig.

Zonder Supabase werkt de app meteen in lokale modus: alles blijft dan op het toestel.

## Wat zit erin

```
index.html              app-scherm
css/app.css             opmaak (licht en donker)
js/app.js               app-logica
js/store.js             opslag: lokaal of Supabase
js/data.js              de standaardlijst (456 items in 18 ruimtes)
js/config.js            jouw Supabase-gegevens
supabase/schema.sql     database, beveiliging en live updates
manifest.webmanifest    app-naam, kleuren en iconen
sw.js                   offline openen
icons/                  logo en app-iconen
```

## 1. Supabase klaarzetten (±5 min)

1. Ga in je Supabase-project naar **SQL Editor → New query**, plak de volledige inhoud van `supabase/schema.sql` en klik **Run**. Dit maakt de tabel aan en vult ze met de standaardlijst.
2. Je Project URL en publishable key staan al in `js/config.js`.

Er is geen aanmelding: iedereen die de app opent, ziet en bewerkt dezelfde lijst. Wie het adres niet kent, vindt de app niet zomaar, maar het is ook niet afgeschermd. Zet er dus niets geheims in. Zelf toegevoegde items kunnen verwijderd worden; de standaardlijst blijft altijd staan.

## 2. Online zetten met GitHub Pages

1. Maak een nieuwe repository op GitHub, bv. `nestklaar`.
2. Upload alle bestanden uit deze map (sleep ze in **Add file → Upload files**, of gebruik git).
3. Ga naar **Settings → Pages**, kies **Deploy from a branch**, branch `main`, map `/ (root)` en bewaar.
4. Na een minuutje staat de app op `https://<jouw-gebruikersnaam>.github.io/nestklaar/`.

Elke keer dat je iets pusht naar `main`, wordt de site automatisch bijgewerkt. Verhoog dan ook `VERSION` in `sw.js` (bv. `nestklaar-v2`), zodat geïnstalleerde apps de nieuwe versie ophalen.

## 3. Als app installeren

- **iPhone/iPad:** open de link in Safari → deelknop → **Zet op beginscherm**.
- **Android:** open de link in Chrome → menu ⋮ → **App installeren**.

De app opent dan schermvullend met eigen icoon en naam, zonder adresbalk.

## 4. Samen gebruiken

Open het menu (⋯ rechtsboven) en tik op **Deel de link**, of stuur gewoon het adres door. Vinkjes, bedragen en eigen items verschijnen meteen bij iedereen.

## Aanpassen

- **Naam of kleuren:** `APP_NAME` in `js/config.js`, de titels in `index.html` en `manifest.webmanifest`, de kleuren bovenaan `css/app.css`.
- **Logo:** vervang `icons/logo.svg` en de PNG's (192×192, 512×512, een *maskable* 512×512 met wat extra rand, en `apple-touch-icon.png` van 180×180).
- **Standaardlijst:** die staat in `supabase/schema.sql` (gedeelde lijst) en in `js/data.js` (ruimtevolgorde en lokale modus).

## Later naar de App Store of Play Store?

Een PWA volstaat om zelf en met anderen te gebruiken. Wil je ooit echt in de stores, dan kan deze map ongewijzigd in een [Capacitor](https://capacitorjs.com)-project als `www`-map. Daarvoor heb je een Apple Developer-account (€99/jaar) en/of Google Play-account (eenmalig $25) nodig.

## Lokaal testen

```bash
python3 -m http.server 8000
```

Open daarna `http://localhost:8000`. Een service worker werkt niet als je `index.html` gewoon dubbelklikt; gebruik dus een lokale server.
