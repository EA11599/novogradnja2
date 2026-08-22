// Tjedni pipeline: dohvaća SVE zgrade novokreirane u OSM-u na području
// Hrvatske u zadanom vremenskom prozoru.
//
// Koristi Overpass API (overpass-api.de), NE ohsome — Overpass radi nad
// glavnom OSM bazom koja se ažurira MINUTNO (gotovo uživo), dok ohsome ima
// vlastitu repliciranu bazu koja zna kasniti i tjednima za stvarnošću (to
// smo utvrdili u praksi: tražili "do danas", ohsome je imao podatke samo
// do prije 2+ tjedna).
//
// Da razlikujemo STVARNO nove zgrade od običnih izmjena postojećih (npr.
// netko doda adresu na staru zgradu), gledamo `version === 1` — to znači
// da je ovo prva verzija tog OSM elementa ikad, dakle stvarno nastao u
// ovom periodu, ne izmjena nečeg starijeg.
//
// Pokreće se preko GitHub Actions (.github/workflows/tjedni-pipeline-zgrade.yml)
// jednom tjedno. Može se pokrenuti i ručno: `npm run fetch:zgrade`.

const fs = require("fs");
const path = require("path");
const cfg = require("./zgrade-config");
const booleanPointInPolygon = require("@turf/boolean-point-in-polygon").default;
const { point: turfPoint } = require("@turf/helpers");
const { dodajNajblizuCestu } = require("./lib/najbliza-cesta");
const { dodajDguAdrese } = require("./lib/dgu-spajanje");
const { povrsinaPoligona } = require("./lib/geometrija");

const REPO_ROOT = path.join(__dirname, "..");
const ZGRADE_DIR = path.join(REPO_ROOT, cfg.ZGRADE_DIR);
const MANIFEST_PATH = path.join(ZGRADE_DIR, "manifest.json");
const ZUPANIJE_PATH = path.join(REPO_ROOT, "data", "zupanije.geojson");
const GEOMETRIJA_INDEKS_PATH = path.join(ZGRADE_DIR, "geometrija-indeks.json");
const PROSIRENJA_DIR = path.join(REPO_ROOT, "data", "prosirenja");
const PROSIRENJA_MANIFEST_PATH = path.join(PROSIRENJA_DIR, "manifest.json");
// Prag promjene povrsine da se nesto oznaci kao "moguce prosirenje" - ispod
// ovoga tretiramo kao kozmeticku ispravku obrisa (netko precizni je ucrtao
// isti objekt), ne stvarnu gradevinsku promjenu. Vrijednost u zgrade-config.js.
const PROSIRENJE_PRAG_POSTOTAK = cfg.PROSIRENJE_PRAG_POSTOTAK;

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Učitava granice županija (jednom po pokretanju) da svakoj novoj zgradi
// možemo pridružiti županiju preko point-in-polygon provjere. Ako datoteka
// još ne postoji (npr. dohvati-zupanije.yml se nikad nije pokrenuo), samo
// nastavljamo bez tog polja — ne rušimo cijeli pipeline zbog toga.
function loadZupanije() {
  if (!fs.existsSync(ZUPANIJE_PATH)) {
    console.log("Napomena: data/zupanije.geojson ne postoji — zgrade neće imati pridruženu županiju. Pokreni 'Dohvati granice zupanija' workflow.");
    return null;
  }
  return JSON.parse(fs.readFileSync(ZUPANIJE_PATH, "utf8"));
}

function pronadjiZupaniju(zupanije, lon, lat) {
  if (!zupanije || lon === null || lat === null) return null;
  const pt = turfPoint([lon, lat]);
  for (const f of zupanije.features) {
    if (booleanPointInPolygon(pt, f)) return f.properties.naziv;
  }
  return null;
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {

    return { entries: [] };
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function saveManifest(manifest) {
  fs.mkdirSync(ZGRADE_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function loadGeometrijaIndeks() {
  if (!fs.existsSync(GEOMETRIJA_INDEKS_PATH)) return {};
  return JSON.parse(fs.readFileSync(GEOMETRIJA_INDEKS_PATH, "utf8"));
}

function saveGeometrijaIndeks(indeks) {
  fs.mkdirSync(ZGRADE_DIR, { recursive: true });
  fs.writeFileSync(GEOMETRIJA_INDEKS_PATH, JSON.stringify(indeks, null, 2));
}

function loadProsirenjaManifest() {
  if (!fs.existsSync(PROSIRENJA_MANIFEST_PATH)) return { entries: [] };
  return JSON.parse(fs.readFileSync(PROSIRENJA_MANIFEST_PATH, "utf8"));
}

function saveProsirenjaManifest(manifest) {
  fs.mkdirSync(PROSIRENJA_DIR, { recursive: true });
  fs.writeFileSync(PROSIRENJA_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

// Za svaki version>1 kandidat koji vec IMAMO u geometrija-indeksu (dakle
// zgrada koju vec pratimo), dohvaca novu geometriju, racuna novu povrsinu,
// usporedjuje sa starom, i zapisuje "prosirenje" ako je promjena preko
// PROSIRENJE_PRAG_POSTOTAK. Ne dira zgrade koje nikad nismo vidjeli - te su
// izvan naseg dosega (postojale su na OSM-u prije nego smo poceli pratiti).
async function obradiIzmijenjeneZgrade(izmijenjeniKandidati, fromISO, toISO, indeks) {
  const poznati = izmijenjeniKandidati.filter((el) => !!indeks[`${el.type}/${el.id}`]);
  console.log(`  [Prosirenja] Od ${izmijenjeniKandidati.length} izmijenjenih kandidata, ${poznati.length} vec pratimo.`);
  if (poznati.length === 0) return [];

  const wayIds = poznati.filter((el) => el.type === "way").map((el) => el.id);
  const relationIds = poznati.filter((el) => el.type === "relation").map((el) => el.id);
  const geometrijaPoId = await dohvatiGeometrijuZaElemente(wayIds, relationIds);

  const prosirenja = [];
  poznati.forEach((el) => {
    const id = `${el.type}/${el.id}`;
    const g = geometrijaPoId[id];
    if (!Array.isArray(g) || g.length < 3) return; // samo way s punim obrisom - relacije preskacemo

    const obris = g
      .filter((n) => n && typeof n.lat === "number" && typeof n.lon === "number")
      .map((n) => [+n.lon.toFixed(6), +n.lat.toFixed(6)]);
    const novaPovrsina = povrsinaPoligona(obris);
    const staraPovrsina = indeks[id].povrsina;
    if (novaPovrsina === null || !staraPovrsina) return;

    const postotak = ((novaPovrsina - staraPovrsina) / staraPovrsina) * 100;
    if (Math.abs(postotak) < PROSIRENJE_PRAG_POSTOTAK) {
      // Promjena je unutar praga - vjerojatno kozmeticka ispravka obrisa,
      // ne stvarno prosirenje. I dalje azuriramo indeks na novu povrsinu
      // (da se buduce usporedbe rade prema najnovijem stanju), ali ne
      // zapisujemo kao "prosirenje".
      indeks[id].povrsina = Math.round(novaPovrsina * 100) / 100;
      return;
    }

    prosirenja.push({
      id,
      obris,
      staraPovrsina: Math.round(staraPovrsina * 100) / 100,
      novaPovrsina: Math.round(novaPovrsina * 100) / 100,
      postotak: Math.round(postotak * 10) / 10,
      tags: el.tags || {},
      changeset: el.changeset || null,
      osmUser: el.user || null,
      detektiranoOd: fromISO,
      detektiranoDo: toISO,
      validFrom: el.timestamp || null,
    });

    indeks[id].povrsina = Math.round(novaPovrsina * 100) / 100;
  });

  console.log(`  [Prosirenja] Pronadjeno ${prosirenja.length} zgrada s promjenom povrsine preko ${PROSIRENJE_PRAG_POSTOTAK}%.`);
  return prosirenja;
}

// Overpass zahtijeva TOČAN format "yyyy-mm-ddThh:mm:ssZ" (sa sekundama).
// Stari zapisi u manifestu (spremljeni dok je pipeline još koristio ohsome)
// znaju biti u formatu bez sekundi (npr. "2026-07-27T09:00Z") — ovo
// normalizira bilo koji ispravan ISO string u točan oblik koji Overpass
// očekuje.
function normalizeTimestamp(ts) {
  return new Date(ts).toISOString().slice(0, 19) + "Z";
}

// Vrijeme od kojeg gledamo nove zgrade: odmah nakon zadnjeg zabilježenog
// pokretanja (bez rupa i bez preklapanja), ili — ako je ovo prvi put —
// FIRST_RUN_LOOKBACK_DAYS dana unatrag od pravog "sada" (Overpass je uživo,
// pa za razliku od ohsome-a ovdje "sada" stvarno znači sada).
function computeFromTimestamp(manifest) {
  if (manifest.entries.length > 0) {
    return normalizeTimestamp(manifest.entries[manifest.entries.length - 1].to);
  }
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - cfg.FIRST_RUN_LOOKBACK_DAYS);
  return normalizeTimestamp(d);
}

// Izdvojeno iz fetchNoveZgrade da se moze ponovno koristiti i za "izmijenjene"
// (version>1) elemente - identicna logika, razlicit ulazni skup ID-jeva.
async function dohvatiGeometrijuZaElemente(wayIds, relationIds) {
  let geomElementi = [];
  if (wayIds.length > 0) {
    const wayQuery = `
      [out:json][timeout:180];
      way(id:${wayIds.join(",")});
      out geom;
    `;
    const wayElementi = await posaljiUpit(wayQuery, { ocekujMeta: false });
    geomElementi = geomElementi.concat(wayElementi);
  }
  if (relationIds.length > 0) {
    const relationQuery = `
      [out:json][timeout:180];
      relation(id:${relationIds.join(",")});
      out center;
    `;
    const relationElementi = await posaljiUpit(relationQuery, { ocekujMeta: false });
    geomElementi = geomElementi.concat(relationElementi);
  }

  const geometrijaPoId = {};
  geomElementi.forEach((el) => {
    geometrijaPoId[`${el.type}/${el.id}`] = el.geometry || el.center || null;
  });
  return geometrijaPoId;
}

async function fetchNoveZgrade(fromISO, toISO) {
  // VAŽNO: koristimo "newer:from" (NE "changed:from,to"). Otkrili smo da
  // Overpass gubi "meta" polja (timestamp, version, ...) kad se koristi
  // "changed:" filter s dva argumenta — potvrđeno testirano, čak i BEZ
  // if:version() filtera. "newer:" nema taj problem.
  //
  // "newer:" ima samo donju granicu (nema "do" datuma) — zato RUČNO
  // filtriramo elemente po njihovom stvarnom timestamp polju da ostanu
  // samo oni unutar [fromISO, toISO).
  //
  // DVOPROLAZNI PRISTUP (otkriveno 17.8. - bitno): kombinacija "geom" +
  // "meta" na VELIKOM nacionalnom upitu (tisuće elemenata) dosljedno gubi
  // meta podatke, čak i uz cache-buster koji isključuje keširanje kao
  // uzrok. Manji upiti (samo "meta", bez "geom") pouzdano rade i za velike
  // odgovore (potvrđeno: 58464/58464 s timestampom u ranijem backfillu).
  // Zato: prvi prolaz dohvaća samo meta+tags (lagano, pouzdano) da
  // utvrdimo KOJE zgrade su stvarno nove; drugi prolaz dohvaća geometriju
  // SAMO za taj (puno manji) filtrirani skup, po eksplicitnim ID-jevima.
  const HR_BBOX = "42.30,13.30,46.60,19.50"; // minLat,minLon,maxLat,maxLon

  // "out meta;" (NE "out meta tags;") - eksplicitno kombiniranje "meta" i
  // "tags" zajedno je (opet, otkriveno 17.8.) dosljedno gubilo meta na
  // velikim nacionalnim upitima, iako "meta" već po Overpass hijerarhiji
  // (ids < skel < body < meta) sam po sebi uključuje tags. Samo "out meta;"
  // je dokazano pouzdano (58464/58464 elemenata s timestampom u backfillu).
  const metaQuery = `
    [out:json][timeout:180];
    (
      way["building"](newer:"${fromISO}")(${HR_BBOX});
      relation["building"](newer:"${fromISO}")(${HR_BBOX});
    );
    out meta;
  `;

  console.log("  Prolaz 1/2: dohvaćam meta+tags (bez geometrije, lagan upit)...");
  const metaElementi = await posaljiUpit(metaQuery);

  const odFiltrirano = metaElementi.filter((el) => {
    if (!el.timestamp) return false;
    if (Number(el.version) !== 1) return false;
    return el.timestamp >= fromISO && el.timestamp < toISO;
  });
  console.log(`  Nakon filtriranja po vremenskom prozoru i version===1 [${fromISO}, ${toISO}): ${odFiltrirano.length}/${metaElementi.length} elemenata.`);

  // Iz ISTOG meta-prolaza (bez dodatnog Overpass poziva) izdvajamo i
  // IZMIJENJENE (version>1) elemente unutar istog vremenskog prozora - ovo
  // je sirovi kandidatski skup za "prosirenja postojecih zgrada" funkciju.
  // Geometrija se za njih NE dohvaca ovdje (ta odluka - treba li nam uopce
  // - dolazi kasnije, nakon sto se provjeri jesu li nam vec poznati).
  const izmijenjeniKandidati = metaElementi.filter((el) => {
    if (!el.timestamp) return false;
    if (Number(el.version) <= 1) return false;
    return el.timestamp >= fromISO && el.timestamp < toISO;
  });
  console.log(`  Kandidati za promjenu geometrije (version>1) [${fromISO}, ${toISO}): ${izmijenjeniKandidati.length}/${metaElementi.length} elemenata.`);

  if (odFiltrirano.length === 0) return { nove: [], izmijenjeniKandidati };

  // Drugi prolaz: dohvati geometriju SAMO za filtrirane elemente, po
  // eksplicitnim ID-jevima - puno manji upit (stotine, ne tisuće).
  const wayIds = odFiltrirano.filter((el) => el.type === "way").map((el) => el.id);
  const relationIds = odFiltrirano.filter((el) => el.type === "relation").map((el) => el.id);

  console.log(`  Prolaz 2/2: dohvaćam geometriju za ${wayIds.length} way + ${relationIds.length} relation elemenata...`);

  // VAŽNO (otkriveno 17.8.): "out geom center;" zajedno na istom izlazu je
  // dosljedno vraćao SAMO center, nikad geometry - čak i za way-ove kojima
  // je geometry trebao biti trivijalan (out geom radi pouzdano samostalno,
  // dokazano cijelu sesiju). Rješenje: razdvojiti izlaz po tipu - way-ovi
  // dobivaju "out geom;" (samostalno), relacije "out center;" (samostalno),
  // nikad kombinirano u istoj out naredbi.
  const geometrijaPoId = await dohvatiGeometrijuZaElemente(wayIds, relationIds);
  console.log(`  Geom prolaz vratio ${Object.keys(geometrijaPoId).length} elemenata.`);

  // Spoji: meta podaci iz prvog prolaza + geometrija iz drugog prolaza.
  let spojenoBrojac = 0, nespojenoBrojac = 0;
  const spojeno = odFiltrirano.map((el) => {
    const g = geometrijaPoId[`${el.type}/${el.id}`];
    if (Array.isArray(g)) { spojenoBrojac++; return { ...el, geometry: g }; }
    if (g && typeof g.lat === "number") { spojenoBrojac++; return { ...el, center: g }; }
    nespojenoBrojac++;
    return el; // geometrija nedostupna - toSlimFeature će ovo tretirati kao točku bez obrisa
  });
  console.log(`  Spajanje meta+geometrija: ${spojenoBrojac} uspješno spojeno, ${nespojenoBrojac} bez geometrije.`);

  return { nove: spojeno, izmijenjeniKandidati };
}

async function posaljiUpit(query, { ocekujMeta = true } = {}) {
  // NAPOMENA (bitno, otkriveno 17.8.): javni Overpass server je load-
  // balansiran preko više backend node-ova. Za VELIKE upite s "geom"+"meta"
  // zajedno, meta zna dosljedno nedostajati (potvrđeno cache-busterom da
  // nije keširanje) - zato smo prešli na dvoprolazni pristup gdje ovaj
  // problem zaobilazimo posve (meta-upit nikad ne traži geom). Retry ovdje
  // ostaje kao opća zaštita od 502/503/504 i sličnih privremenih grešaka.
  const MAX_POKUSAJA = 6;
  let najveciBrojElemenataBezMeta = 0;
  let zadnjaGreska;

  for (let pokusaj = 1; pokusaj <= MAX_POKUSAJA; pokusaj++) {
    try {
      const queryUniknjen = `// pokusaj-${pokusaj}-${Date.now()}-${Math.random().toString(36).slice(2)}\n${query}`;
      const res = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": cfg.USER_AGENT,
        },
        body: new URLSearchParams({ data: queryUniknjen }),
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Overpass ${res.status} ${res.statusText}\nOdgovor: ${text.slice(0, 1500)}`);
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`Overpass je vratio ne-JSON odgovor (vjerojatno greška/rate-limit):\n${text.slice(0, 1500)}`);
      }

      if (parsed.remark) {
        console.log(`  Overpass remark: ${parsed.remark}`);
      }

      const elements = parsed.elements || [];

      if (!ocekujMeta) {
        // Drugi prolaz (samo geometrija) - meta nije ni tražena, ne
        // provjeravamo je.
        console.log(`  Pokušaj ${pokusaj}/${MAX_POKUSAJA}: vratio ${elements.length} elemenata (geometrija).`);
        return elements;
      }

      const saTimestampom = elements.filter((el) => el.timestamp).length;
      console.log(`  Pokušaj ${pokusaj}/${MAX_POKUSAJA}: vratio ${elements.length} elemenata, ${saTimestampom} sa timestampom.`);

      if (elements.length === 0 && najveciBrojElemenataBezMeta === 0) {
        return elements;
      }
      if (saTimestampom > 0) {
        console.log(`  Primjer prvog elementa (radi provjere): ${JSON.stringify(elements[0]).slice(0, 300)}`);
        return elements;
      }

      najveciBrojElemenataBezMeta = Math.max(najveciBrojElemenataBezMeta, elements.length);
      console.log(`  UPOZORENJE: odgovor bez meta podataka, pokušavam ponovno...`);
    } catch (err) {
      zadnjaGreska = err;
      const jePrivremena = /50[234]/.test(err.message);
      console.log(`  Pokušaj ${pokusaj}/${MAX_POKUSAJA} neuspio: ${err.message.split("\n")[0]}${jePrivremena ? " (privremeno, pokušavam ponovno)" : ""}`);
    }
    if (pokusaj < MAX_POKUSAJA) {
      const pauzaMs = pokusaj * 12000;
      console.log(`  Čekam ${pauzaMs / 1000}s prije sljedećeg pokušaja...`);
      await new Promise((r) => setTimeout(r, pauzaMs));
    }
  }

  if (zadnjaGreska) throw zadnjaGreska;
  throw new Error(`Overpass dosljedno vraća elemente bez meta podataka nakon ${MAX_POKUSAJA} pokušaja (${najveciBrojElemenataBezMeta} elemenata bez timestampa) - vjerojatno svi node-ovi trenutno imaju problem, pokušaj kasnije.`);
}

function toSlimFeature(el, zupanije) {
  const tags = el.tags || {};
  // "out geom" daje puni niz čvorova za way (el.geometry: [{lat,lon},...]) —
  // to je pravi obris zgrade, ne samo centar. Za relacije (multipoligoni,
  // rijetki slučaj — svega par posto zgrada) Overpass vraća složeniju
  // strukturu (members s pod-geometrijama); to za sada ne rastavljamo u
  // poligon (frontend će za njih prikazati samo točku), da ne kompliciramo
  // pipeline radi manjine slučajeva.
  let obris = null;
  let lat = null, lon = null;

  if (el.type === "way" && Array.isArray(el.geometry) && el.geometry.length > 0) {
    obris = el.geometry
      .filter((n) => n && typeof n.lat === "number" && typeof n.lon === "number")
      .map((n) => [+n.lon.toFixed(6), +n.lat.toFixed(6)]);
    const centroid = centroidOfRing(obris);
    lat = centroid[1];
    lon = centroid[0];
  } else if (el.center) {
    lat = typeof el.center.lat === "number" ? +el.center.lat.toFixed(6) : null;
    lon = typeof el.center.lon === "number" ? +el.center.lon.toFixed(6) : null;
  }

  return {
    id: `${el.type}/${el.id}`,
    lat,
    lon,
    obris, // niz [lon,lat] točaka ili null (relacije / nedostupna geometrija)
    tags,  // SVE sirove OSM oznake (building, addr:*, building:levels, name, ...) — ne biramo unaprijed koje su bitne
    zupanija: pronadjiZupaniju(zupanije, lon, lat),
    validFrom: el.timestamp || null,
    changeset: el.changeset || null,
    osmUser: el.user || null,
  };
}

function centroidOfRing(ring) {
  if (!ring || ring.length === 0) return [null, null];
  let sx = 0, sy = 0;
  for (const [x, y] of ring) { sx += x; sy += y; }
  return [sx / ring.length, sy / ring.length];
}

function pruneOldEntries(manifest) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - cfg.RETENTION_WEEKS * 7);

  const kept = [];
  for (const entry of manifest.entries) {
    if (new Date(entry.to) < cutoff) {
      const p = path.join(REPO_ROOT, entry.file);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        console.log(`Obrisan star snimak (izvan ${cfg.RETENTION_WEEKS} tj. retencije): ${entry.file}`);
      }
    } else {
      kept.push(entry);
    }
  }
  manifest.entries = kept;
}

const MAX_DANA_PO_UPITU = 3; // veći periodi se dijele na komade ove veličine (smanjeno s 7 na 3 - manji upiti su pouzdaniji)

// Detekcija "masovnog unosa": ako je puno zgrada (iznad praga) uneseno u
// ISTOM changesetu (jedna uređivačka sesija), vjerojatnije je da je riječ o
// digitalizaciji postojećeg naselja s ortofota nego o organskoj novogradnji
// (koja je obično raštrkana, od različitih korisnika). Ne dokazuje ništa
// samo po sebi - samo dodatni signal, vidi UI za napomenu korisniku.
const PRAG_MASOVNOG_UNOSA = 20;

function oznaciMasovniUnos(features) {
  const poChangesetu = {};
  features.forEach((f) => {
    if (!f.changeset) return;
    (poChangesetu[f.changeset] = poChangesetu[f.changeset] || []).push(f);
  });

  let oznaceno = 0;
  Object.entries(poChangesetu).forEach(([changeset, grupa]) => {
    if (grupa.length >= PRAG_MASOVNOG_UNOSA) {
      grupa.forEach((f) => {
        f.masovniUnos = { changeset: Number(changeset), brojZgrada: grupa.length, korisnik: grupa[0].osmUser };
        oznaceno++;
      });
    }
  });
  return oznaceno;
}

async function obradiJedanKomad(fromISO, toISO, manifest, zupanije) {
  console.log(`Dohvaćam: ${fromISO} -> ${toISO}`);
  const { nove: elements, izmijenjeniKandidati } = await fetchNoveZgrade(fromISO, toISO);
  const sveFeatures = elements.map((el) => toSlimFeature(el, zupanije));

  // VAŽNO: bbox (koristimo ga umjesto area filtera zbog meta-problema)
  // NIJE precizan oblik Hrvatske - hvata i djeliće susjednih zemalja
  // (Slovenija, Bosna, Srbija, Crna Gora, Mađarska). Zgrade koje
  // pronadjiZupaniju() nije uspio smjestiti ni u jednu od 21 županije su
  // (gotovo sigurno) izvan Hrvatske - odbacujemo ih ovdje, prije spremanja.
  const features = sveFeatures.filter((f) => f.zupanija);
  const odbaceno = sveFeatures.length - features.length;
  if (odbaceno > 0) {
    console.log(`  Odbačeno ${odbaceno} zgrada bez pridružene županije (izvan Hrvatske, bbox rub).`);
  }

  console.log(`  Tražim DGU adrese unutar obrisa zgrada bez addr:street...`);
  const dguNadjeno = dodajDguAdrese(features);
  console.log(`  DGU adresa pronađena za ${dguNadjeno} zgrada.`);

  console.log(`  Računam najbližu cestu za preostale zgrade bez adrese...`);
  await dodajNajblizuCestu(features);

  const brojMasovnih = oznaciMasovniUnos(features);
  if (brojMasovnih > 0) {
    console.log(`  Označeno ${brojMasovnih} zgrada kao "masovni unos" (isti changeset, puno zgrada odjednom).`);
  }

  const dateLabel = toISO.slice(0, 10); // samo za "date" prikazno polje u manifestu
  // Naziv DATOTEKE koristi puno vrijeme (ne samo datum) da se izbjegne sudar
  // kad dva komada u istom danu (npr. ručno pokretanje pipelinea više puta
  // dnevno) dobiju isto ime i drugi tiho prepiše prvi - to se stvarno
  // dogodilo 13.8. i izgubili smo 146 zapisa prije ovog popravka.
  const fileTimeLabel = toISO.replace(/[-:]/g, "").replace("T", "T").slice(0, 15); // npr. 20260813T120814
  const fileName = `novo-${fileTimeLabel}.json`;
  const filePath = path.join(ZGRADE_DIR, fileName);

  fs.mkdirSync(ZGRADE_DIR, { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({ from: fromISO, to: toISO, count: features.length, features }, null, 2)
  );

  manifest.entries.push({
    date: dateLabel,
    from: fromISO,
    to: toISO,
    count: features.length,
    file: `${cfg.ZGRADE_DIR}/${fileName}`,
  });

  // Spremamo manifest odmah nakon SVAKOG komada (ne tek na kraju) — ako
  // idući komad pukne (npr. Overpass opet 504-ica), već obrađeni komadi
  // ostaju sačuvani i ne moramo ih ponavljati kod idućeg pokretanja.
  saveManifest(manifest);
  console.log(`Gotovo: ${features.length} novih zgrada -> ${fileName}`);

  // ---------- Geometrijski indeks + prosirenja postojecih zgrada ----------
  const geometrijaIndeks = loadGeometrijaIndeks();

  // Nove zgrade koje upravo spremamo dodajemo u indeks odmah - da ih ubuduce
  // mozemo prepoznati ako se NJIHOVA geometrija kasnije promijeni.
  features.forEach((f) => {
    if (f.obris && f.obris.length >= 3) {
      const p = povrsinaPoligona(f.obris);
      if (p !== null) geometrijaIndeks[f.id] = { povrsina: Math.round(p * 100) / 100 };
    }
  });

  console.log(`  Provjeravam ima li promjena geometrije na vec pracenim zgradama...`);
  const prosirenja = await obradiIzmijenjeneZgrade(izmijenjeniKandidati, fromISO, toISO, geometrijaIndeks);
  saveGeometrijaIndeks(geometrijaIndeks);

  if (prosirenja.length > 0) {
    const prosirenjaManifest = loadProsirenjaManifest();
    const prosirenjaFileName = `prosirenje-${fileTimeLabel}.json`;
    const prosirenjaFilePath = path.join(PROSIRENJA_DIR, prosirenjaFileName);
    fs.mkdirSync(PROSIRENJA_DIR, { recursive: true });
    fs.writeFileSync(
      prosirenjaFilePath,
      JSON.stringify({ from: fromISO, to: toISO, count: prosirenja.length, features: prosirenja }, null, 2)
    );
    prosirenjaManifest.entries.push({
      date: dateLabel,
      from: fromISO,
      to: toISO,
      count: prosirenja.length,
      file: `data/prosirenja/${prosirenjaFileName}`,
    });
    saveProsirenjaManifest(prosirenjaManifest);
    console.log(`  Spremljeno ${prosirenja.length} prosirenja -> ${prosirenjaFileName}`);
  }
}

async function main() {
  const manifest = loadManifest();
  const zupanije = loadZupanije();
  const fromISO = computeFromTimestamp(manifest);
  const toISO = normalizeTimestamp(new Date());

  if (new Date(toISO) <= new Date(fromISO)) {
    console.log("Nema novog vremenskog prozora za obraditi — preskačem.");
    return;
  }

  console.log(`Ukupan period: ${fromISO} -> ${toISO}`);

  // Veći periodi (npr. netko nije pokretao pipeline par tjedana, ili se
  // baš sad nakupio zaostatak dok smo debug-irali) dijelimo na tjedne
  // komade — jedan veliki nacionalni upit zna izazvati 504 Gateway Timeout
  // na javnom Overpass serveru, dok manji komadi prolaze pouzdano.
  let tekuciFrom = new Date(fromISO);
  const krajniTo = new Date(toISO);

  while (tekuciFrom < krajniTo) {
    let tekuciTo = new Date(tekuciFrom);
    tekuciTo.setUTCDate(tekuciTo.getUTCDate() + MAX_DANA_PO_UPITU);
    if (tekuciTo > krajniTo) tekuciTo = krajniTo;

    await obradiJedanKomad(
      normalizeTimestamp(tekuciFrom),
      normalizeTimestamp(tekuciTo),
      manifest,
      zupanije
    );

    tekuciFrom = tekuciTo;
  }

  pruneOldEntries(manifest);
  saveManifest(manifest);

  console.log(`Sve gotovo. Manifest sad ima ${manifest.entries.length} tjednih zapisa (retencija: ${cfg.RETENTION_WEEKS} tj.).`);

  // TODO (sljedeći korak): ako je features.length > 0, ovdje pozvati
  // notifikacijsku funkciju (Supabase + Resend) za sve prijavljene emailove.
  // Namjerno izostavljeno dok baza pretplatnika ne postoji.
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Pipeline pukao:", err.message);
    process.exit(1);
  });
}

module.exports = {
  loadManifest,
  saveManifest,
  loadZupanije,
  normalizeTimestamp,
  obradiJedanKomad,
  pruneOldEntries,
  MAX_DANA_PO_UPITU,
};

