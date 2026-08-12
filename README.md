# novogradnja2

Status: **`index.html`** (praćenje novih zgrada) je u aktivnoj upotrebi, na
razini cijele Hrvatske. **`dozvole.html`** postoji u repozitoriju ali je
privremeno isključena iz navigacije dok se ekstrakcija PDF dozvola ne
usavrši — kod ostaje netaknut za kasnije.

## Kako radi praćenje zgrada (novo, nacionalna razina)

Umjesto ranijeg ručnog uploada dva shapefile snimka, sad postoji **tjedni
automatski pipeline** (`scripts/fetch-zgrade.js`, pokreće ga GitHub Actions
— `.github/workflows/tjedni-pipeline-zgrade.yml`, svaki ponedjeljak):

1. Dohvati granicu Hrvatske (jednom, keš-irano u `data/hr-granica.geojson`).
2. Upitom prema **ohsome API-ju** (`contributions/geometry`,
   `contributionType=creation`) dohvati SVE zgrade novokreirane u OSM-u od
   zadnjeg pokretanja do sada — nacionalno, bez potrebe za skidanjem i
   lokalnim uspoređivanjem cijelog nacionalnog sloja zgrada (to bi bilo
   presporo i preveliko za besplatan GitHub repo).
3. Spremi tu razliku kao malu datoteku `data/zgrade/novo-YYYY-MM-DD.json`.
4. Obriši diff-datoteke starije od `RETENTION_WEEKS` (zadano 13 tjedana ≈ 3
   mjeseca — mijenja se u `scripts/zgrade-config.js`, jedno mjesto za sva
   podešavanja).

**Napomena:** ohsome API je u prošlosti znao vraćati 500 grešku i na
naizgled ispravne upite (vjerojatno privremeni server-side problem, ne
naša greška) — prvo pokretanje pipelinea treba provjeriti preko GitHub
Actions loga da stvarno prođe, prije nego se osloni na tjedni raspored.

## Struktura podataka

```
data/
  hr-granica.geojson          ← keš granice Hrvatske (Nominatim, dohvaća se jednom)
  zgrade/
    manifest.json              ← popis tjednih diff-datoteka (datum, broj novih zgrada)
    novo-YYYY-MM-DD.json        ← nove zgrade otkrivene tog tjedna
  dozvole/
    dnevnik.json                ← rastući dnevnik dozvola (dozvole.html, trenutno neaktivno)
    manifest.json
```

Stari `data/manifest.json` i `data/zgrade_*.zip` (ručni shapefile snimci)
ostaju u repozitoriju kao povijesni podaci dok se frontend ne prebaci na
novi format — vidi otvorenu stavku niže.

## Pipeline za dozvole (trenutno neaktivan u navigaciji)

```
npm install
npm run fetch
```

Detalji, uključujući **otvoreno pitanje oko dohvata sadržaja PDF-a** i
**potrebnu izmjenu `NOMINATIM_USER_AGENT` prije prvog pokretanja**, opisani
su izravno u `scripts/fetch-dozvole.js` kao komentari uz relevantne funkcije.

## Otvorene stavke

- [ ] **Frontend za `index.html` još čita stari format** (dva puna shapefile
      snimka iz `data/manifest.json`). Treba prebaciti na čitanje novog
      `data/zgrade/manifest.json` + spajanje `novo-*.json` datoteka po
      odabranom vremenskom prozoru. Sljedeći korak nakon što se potvrdi da
      pipeline stvarno vraća podatke.
- [ ] Notifikacije (email, kasnije push) — treba Supabase (baza pretplatnika)
      + Resend (slanje emailova); kuka je već ostavljena kao TODO komentar
      na dnu `scripts/fetch-zgrade.js`.
- [ ] Vlastita domena, kad bude budžeta.

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
