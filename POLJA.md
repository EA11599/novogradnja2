# Polja u podacima

Referenca izvučena iz stvarnih datoteka, stanje **25.8.2026.**

Postoci pokazuju koliko je zapisa to polje stvarno popunjeno — polje popunjeno 0,1% postoji u shemi, ali ga u praksi gotovo nema.

---

## `data/zgrade/manifest.json`

Popis svih tjednih datoteka sa zgradama.

```json
{
  "entries": [
    {
      "date":  "2026-08-24",
      "from":  "2026-08-24T02:23:08Z",
      "to":    "2026-08-24T12:59:41Z",
      "count": 18,
      "file":  "data/zgrade/novo-20260824T125941.json"
    }
  ]
}
```

| Polje | Tip | Značenje |
|---|---|---|
| `date` | string | Datum pokretanja, `YYYY-MM-DD` |
| `from` | string | Početak promatranog razdoblja, ISO 8601 |
| `to` | string | Kraj razdoblja, ISO 8601 |
| `count` | number | Broj zgrada u datoteci |
| `file` | string | Putanja relativna na korijen repozitorija |

---

## `data/zgrade/novo-*.json`

Glavni skup. Struktura je `{ "features": [ ... ] }`.

### Polja zgrade

| Polje | Tip | Popunjeno | Primjer |
|---|---|---:|---|
| `id` | string | 100% | `"way/1550713933"` |
| `lat` | number | 100% | `45.30741057142858` |
| `lon` | number | 100% | `18.40587857142857` |
| `obris` | array | 100% | `[[18.405789, 45.307447], ...]` |
| `tags` | object | 100% | `{"building": "yes", ...}` |
| `zupanija` | string | 100% | `"Osječko-baranjska županija"` |
| `validFrom` | string | 100% | `"2026-08-19T01:46:24Z"` |
| `changeset` | number | 100% | `187666638` |
| `osmUser` | string | 100% | `"TheBladecatcher"` |
| `satelitProvjera` | object | 100% | vidi niže |
| `masovniUnos` | object \| — | 72,1% | vidi niže |
| `nearestStreet` | string \| — | 39,4% | `"Put hrmentuna"` |
| `nearestStreetDist` | number \| — | 39,4% | `49` (metara) |
| `dguAdresa` | object \| — | 37,7% | vidi niže |
| `dguBrojJedinica` | number \| — | 37,7% | `1` |
| `dguNovaAdresaPoklapanje` | object \| — | 0,1% | vidi niže |

**`id`** je OSM identifikator s prefiksom vrste — `way/…` ili `relation/…`.

**`obris`** je niz parova `[lon, lat]`, dakle **dužina pa širina**, GeoJSON redoslijed. Prsten nije nužno zatvoren.

**`lat` / `lon`** su središte, ne prva točka obrisa.

**Polja koja nedostaju ne postoje u zapisu** — nisu `null`. Provjeravaj postojanje, ne vrijednost.

### Stariji oblik zapisa

**9.298 zapisa** iz pet datoteka nastalih između 27.7. i 12.8.2026. nose i pet dodatnih polja na najvišoj razini:

| Polje | Tip | Napomena |
|---|---|---|
| `building` | string \| null | Duplikat `tags.building` |
| `name` | string \| null | Duplikat `tags.name` |
| `addr_street` | string \| null | Duplikat `tags["addr:street"]` |
| `addr_housenumber` | string \| null | Duplikat `tags["addr:housenumber"]` |
| `addr_city` | string \| null | Duplikat `tags["addr:city"]` |

Riječ je o zaostatku iz ranije verzije pipelinea. Sadržaj je isti kao u `tags`, samo s podvlakom umjesto dvotočke.

**Ne oslanjaj se na njih** — u novijim datotekama ih nema. Čitaj uvijek iz `tags`.

Pogođene datoteke: `novo-2026-07-27`, `novo-2026-08-03`, `novo-2026-08-10`, `novo-2026-08-12`, i jedna manja.

### `satelitProvjera` (100%)

```json
{
  "status": "stara",
  "obrazlozenje": "U centru kadra je vidljiva bijela građevina...",
  "izvor": "DGU ortofoto 2023/24",
  "provjereno": "2026-08-24T21:06:24.285Z"
}
```

| `status` | Zapisa | Značenje |
|---|---:|---|
| `stara` | 27.243 | Zgrada se vidi na ortofotu — nije nova |
| `nema_snimke` | 464 | DGU nema pokrivenost za tu lokaciju |
| `kandidat` | 275 | Nema je na ortofotu — kandidat za novogradnju |

Mogu se pojaviti i `neizvjesno` te `greska`, ali ih trenutno nema nijedan.

### `dguAdresa` (37,7%)

```json
{
  "street": "Put Vrisja",
  "houseNumber": "8",
  "settlement": "Sukošan",
  "postcode": "23206",
  "city": "Sukošan"
}
```

Sva podpolja su `string` i uvijek popunjena kad objekt postoji.

### `masovniUnos` (72,1%)

```json
{ "changeset": 183125020, "brojZgrada": 23, "korisnik": "Vedran V" }
```

Postoji ako je zgrada ucrtana u sklopu unosa više zgrada odjednom.

### `dguNovaAdresaPoklapanje` (0,1%)

```json
{ "street": "Ulica Ratimira Hercega", "houseNumber": "22A", "datum": "2026-08-18" }
```

Nakon zadnje izmjene unakrsne provjere dobiva još dva polja — `udaljenostM` (number) i `unutarObrisa` (boolean) — ali ona se pojavljuju tek nakon sljedećeg tjednog pokretanja.

### `tags`

OSM oznake, prenesene bez izmjena. Najčešći ključevi:

| Ključ | Zapisa |
|---|---:|
| `building` | 27.982 |
| `addr:housenumber` | 2.458 |
| `addr:street` | 2.265 |
| `ref:HR:kucni_broj` | 1.547 |
| `roof:shape` | 529 |
| `building:levels` | 527 |
| `addr:city` | 408 |
| `addr:postcode` | 386 |

Sve vrijednosti su `string`, uključujući brojeve — `building:levels` je `"1"`, ne `1`.

---

## `data/teren-indeks.json`

Lagani indeks za mobitel. Nazivi su skraćeni jer se kod 28.000 zapisa razlika mjeri u stotinama kilobajta.

```json
{
  "generirano": "2026-08-25T15:20:35.584Z",
  "tjedanaUnatrag": 26,
  "broj": 27978,
  "zgrade": [ ... ]
}
```

| Polje | Tip | Puni naziv | Primjer |
|---|---|---|---|
| `i` | string | id | `"way/1520792490"` |
| `y` | number | lat | `44.0539` |
| `x` | number | lon | `15.30709` |
| `a` | string \| null | adresa | `"Ulica Zvonimira Rihtmana 2"` |
| `m` | string \| null | mjesto | `"Sukošan"` |
| `z` | string \| null | županija | `"Zadarska županija"` |
| `t` | string \| null | tip (`tags.building`) | `"guardhouse"` |
| `k` | string \| null | katovi | `"1"` |
| `s` | string \| null | satelitska presuda | `"stara"` |
| `u` | number | masovni unos, `0` ili `1` | `0` |
| `d` | string \| null | datum detekcije | `"2026-05-27"` |

Ovdje polja **jesu** `null` kad nedostaju, za razliku od glavnog skupa.

Koordinate su zaokružene na **5 decimala**, oko metar točnosti.

---

## `data/zgrade/geometrija-indeks.json`

Stanje svake praćene zgrade, za usporedbu s idućim tjednom. Objekt s OSM identifikatorom kao ključem.

```json
{
  "way/1516307844": {
    "povrsina": 317.43,
    "oblik": "15.307054,44.053907 15.307105,44.053930 ...",
    "vrhova": 4,
    "opseg": 18.3,
    "tags": { "building": "house" },
    "jedinica": 1,
    "dguAdresa": "Put Vrisja 8"
  }
}
```

| Polje | Tip | Značenje |
|---|---|---|
| `povrsina` | number | Kvadratnih metara, dvije decimale |
| `oblik` | string | Tlocrt kao `"lon,lat lon,lat …"`, 6 decimala |
| `vrhova` | number | Broj različitih uglova |
| `opseg` | number | Metara, jedna decimala |
| `tags` | object | Sve OSM oznake |
| `jedinica` | number \| null | Broj DGU adresa unutar obrisa |
| `dguAdresa` | string \| null | Adresa kao jedan niz |

**Postoje tri varijante zapisa**, ovisno o tome je li backfill prošao:

| Varijanta | Zapisa |
|---|---:|
| Sva polja | 27.962 |
| Samo `povrsina` | 1.753 |
| Bez `oblik`/`vrhova`/`opseg` | 3 |

Zapisi sa samo `povrsina` su zgrade bez obrisa u izvornim datotekama; dobit će ostala polja pri prvoj izmjeni.

---

## `data/prosirenja/*.json`

Promjene na već poznatim zgradama. Trenutno **prazno** — prvi zapisi nastaju pri tjednom pokretanju.

| Polje | Tip | Značenje |
|---|---|---|
| `id` | string | OSM identifikator |
| `obris` | array | Novi obris |
| `staraPovrsina` | number | Prije promjene |
| `novaPovrsina` | number | Poslije |
| `postotak` | number | Promjena površine, jedna decimala, može biti negativna |
| `promjene` | array | Popis promjena, vidi niže |
| `stariOblik` | string \| null | Prethodni tlocrt |
| `stareOznake` | object | Prethodne OSM oznake |
| `mogucaPrenamjena` | boolean | Upućuje li na prelazak u višestambenu |
| `razloziPrenamjene` | array\<string\> | Zašto je tako ocijenjeno |
| `tags` | object | Nove OSM oznake |
| `changeset` | number \| null | OSM changeset izmjene |
| `osmUser` | string \| null | Tko je izmijenio |
| `detektiranoOd` / `detektiranoDo` | string | Razdoblje, ISO 8601 |
| `validFrom` | string \| null | Vrijeme izmjene u OSM-u |

### Stavka u `promjene`

```json
{ "polje": "oznaka:building", "oznaka": "building",
  "staro": "house", "novo": "apartments", "tehnicka": false }
```

`polje` može biti `povrsina`, `oblik`, `dgu:broj_adresa`, `dgu:adresa` ili `oznaka:<naziv>` za bilo koju OSM oznaku.

Kod `oblik` dolaze još `vrsta` (string, npr. `"točnije precrtan (razvedeniji oblik)"`) i `detalji` (array stringova).

`tehnicka` označava bilješke urednika poput `source` ili `note`.

---

## `data/dgu-nove-adrese/`

`manifest.json`:

```json
{ "entries": [ { "date": "2026-08-18", "count": 133,
                 "file": "data/dgu-nove-adrese/nove-2026-08-18.geojson" } ] }
```

Same datoteke su **GeoJSON FeatureCollection** s dodatnim poljem `datum` u korijenu:

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [17.057361, 45.560742] },
  "properties": {
    "street": "Ulica Stjepana Radića",
    "houseNumber": "6A",
    "settlement": "Blagorodovac",
    "postcode": "43280",
    "city": "Garešnica"
  }
}
```

---

## Tablice u Supabaseu

### `zgrada_review`

| Stupac | Tip | Značenje |
|---|---|---|
| `zgrada_id` | text | OSM identifikator, primarni ključ |
| `status` | text | `nepotvrđeno`, `potvrđeno`, `odbačeno` |
| `napomena` | text \| null | Slobodan tekst |
| `azurirao` | text | Ime ili email |
| `azurirano_at` | timestamptz | Vrijeme izmjene |

`dgu_review` ima istu strukturu, samo je ključ `dgu_kljuc`.

### `dnevnik`

| Stupac | Tip | Značenje |
|---|---|---|
| `id` | bigint | Primarni ključ |
| `vrijeme` | timestamptz | Postavlja baza, ne preglednik |
| `sesija` | text | Jedan posjet = jedna oznaka |
| `verzija` | text | Verzija stranice u korisnikovom pregledniku |
| `korisnik_id` | uuid \| null | Iz `auth.users` |
| `korisnik_email` | text \| null | |
| `korisnik_ime` | text \| null | |
| `kategorija` | text | `prijava`, `pregled`, `evidencija`, `greska`, `sustav` |
| `dogadjaj` | text | Npr. `promjena_recenzije` |
| `stranica` | text \| null | `index`, `review`, `teren`, `login` |
| `detalji` | jsonb \| null | Kontekst događaja |
| `ua` | text \| null | User-Agent, do 300 znakova |
