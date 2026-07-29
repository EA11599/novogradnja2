# novogradnja2

Dvije povezane stranice, jedan repozitorij:

- **`index.html`** — usporedba dva OSM shapefile snimka zgrada (izvorna
  `novogradnja` funkcionalnost, nepromijenjena).
- **`dozvole.html`** — dnevnik izdanih dozvola s eDozvola oglasne ploče, s
  listom, filterima i kartom. Podaci dolaze iz automatskog dnevnog pipelinea
  (`scripts/fetch-dozvole.js`, pokreće ga GitHub Actions).

Navigacija na vrhu obje stranice omogućava prebacivanje između njih.

## Struktura podataka

```
data/
  manifest.json              ← snimci zgrada za usporedbu (index.html)
  zgrade_*.zip                ← sami shapefile snimci
  dozvole/
    dnevnik.json              ← rastući dnevnik dozvola (dozvole.html)
    manifest.json             ← status zadnjeg pokretanja pipelinea
```

Namjerno odvojeno od `data/manifest.json` (koji je vezan uz `index.html`
usporedbu) da ne dođe do sudara imena.

## Pipeline za dozvole

```
npm install
npm run fetch
```

Detalji, uključujući **otvoreno pitanje oko dohvata sadržaja PDF-a** i
**potrebnu izmjenu `NOMINATIM_USER_AGENT` prije prvog pokretanja**, opisani
su izravno u `scripts/fetch-dozvole.js` kao komentari uz relevantne funkcije.

## Kako postaviti na GitHub

```
git init
git add .
git commit -m "Prva verzija: usporedba zgrada + dozvole"
git branch -M main
git remote add origin https://github.com/EA11599/novogradnja2.git
git push -u origin main
```

Nakon push-a, uključi GitHub Pages (Settings → Pages → Deploy from branch →
main) da stranica postane javno dostupna, i provjeri da je Actions workflow
aktivan (Actions tab) za automatsko dnevno ažuriranje dozvola.
