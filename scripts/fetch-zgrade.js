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

const REPO_ROOT = path.join(__dirname, "..");
const ZGRADE_DIR = path.join(REPO_ROOT, cfg.ZGRADE_DIR);
const MANIFEST_PATH = path.join(ZGRADE_DIR, "manifest.json");
const ZUPANIJE_PATH = path.join(REPO_ROOT, "data", "zupanije.geojson");

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

async function fetchNoveZgrade(fromISO, toISO) {
  // VAŽNO: koristimo "newer:from" (NE "changed:from,to"). Otkrili smo da
  // Overpass gubi "meta" polja (timestamp, version, ...) kad se koristi
  // "changed:" filter s dva argumenta — potvrđeno testirano, čak i BEZ
  // if:version() filtera. "newer:" nema taj problem (naš prvi tjedni
  // dohvat, koji je koristio newer:, ima ispravne datume za sve zgrade).
  //
  // "newer:" ima samo donju granicu (nema "do" datuma) — zato RUČNO
  // filtriramo elemente po njihovom stvarnom timestamp polju da ostanu
  // samo oni unutar [fromISO, toISO), umjesto da se oslanjamo na servera
  // da to napravi. Ovo rješava i dupliciranje između tjednih komada (svaki
  // komad je prije dohvaćao cijeli preostali rep unatrag) I nedostajuće
  // datume — riješeno oboje odjednom.
  //
  // NAPOMENA (jako bitno, opsežno testirano): I area["ISO3166-1"="HR"]->.hr
  // filter I if:version() klauzula ZASEBNO brišu meta podatke (timestamp,
  // version, ...) na ovom Overpass serveru — potvrđeno izravnim testovima,
  // neovisno jedno o drugom i neovisno o newer/changed izboru. Rješenje:
  // koristimo bounding box (ne area) I version===1 provjeru RADIMO NA
  // KLIJENTU (ne if: na serveru). Bbox nije precizan oblik države (uhvati
  // i djeliće susjednih zemalja), rješavamo to naknadno - zgrade kojima
  // pronadjiZupaniju() ne nađe županiju (izvan Hrvatske) se odbacuju niže.
  const HR_BBOX = "42.30,13.30,46.60,19.50"; // minLat,minLon,maxLat,maxLon
  const query = `
    [out:json][timeout:180];
    (
      way["building"](newer:"${fromISO}")(${HR_BBOX});
      relation["building"](newer:"${fromISO}")(${HR_BBOX});
    );
    out geom meta tags;
  `;

  // Sav retry (i za meta problem i za privremene HTTP greške poput 504) je
  // sad unutar posaljiUpit, u jednoj petlji - vidi tamo za detalje.
  const elements = await posaljiUpit(query);
  // Ručno filtriranje po timestamp polju - "newer:" nema gornju granicu
  // pa je server mogao vratiti i elemente novije od našeg toISO (već
  // obrađene u idućem tjednom pokretanju). Elementi bez timestampa se
  // preskaču (ne možemo potvrditi da pripadaju ovom prozoru).
  // Number(el.version)===1 je NAŠA zamjena za if:version()==1 (koji smo
  // morali maknuti sa servera jer briše meta podatke) - Number() jer
  // Overpass zna vratiti version kao string.
  const odFiltrirano = elements.filter((el) => {
    if (!el.timestamp) return false;
    if (Number(el.version) !== 1) return false;
    return el.timestamp >= fromISO && el.timestamp < toISO;
  });
  console.log(`  Nakon filtriranja po vremenskom prozoru i version===1 [${fromISO}, ${toISO}): ${odFiltrirano.length}/${elements.length} elemenata.`);
  return odFiltrirano;
}

async function posaljiUpit(query) {
  // NAPOMENA (bitno, otkriveno 17.8.): javni Overpass server je load-
  // balansiran preko više backend node-ova, i BAREM JEDAN od njih briše
  // meta podatke (timestamp, version) čak i s ispravnim upitom (bbox, bez
  // if:version()) — nasumično, isti upit ista skripta zna raditi ili ne
  // raditi ovisno koji node servisira zahtjev.
  //
  // kumi.systems mirror smo probali kao fallback, ali dosljedno vraća 0
  // elemenata za "newer:" upite (vjerojatno ne podržava taj filter na isti
  // način) — NIJE pouzdana zamjena. Umjesto prebacivanja na drugi mirror,
  // ponavljamo ISTI (glavni) server, jer je problem nasumičan po node-u -
  // ponavljanje vrlo vjerojatno pogodi "dobar" node unutar par pokušaja.
  const MAX_POKUSAJA = 6;
  let najveciBrojElemenataBezMeta = 0;
  let zadnjaGreska;

  for (let pokusaj = 1; pokusaj <= MAX_POKUSAJA; pokusaj++) {
    try {
      // Cache-buster: mijenjamo tekst upita svaki pokušaj (bezopasan
      // komentar s nasumičnim brojem) da izbjegnemo da Overpass vrati
      // identičan keširani odgovor kao prošli put - vidjeli smo tri puta
      // zaredom IDENTIČAN broj elemenata (9399) bez meta podataka, što jako
      // sugerira keširanje na serverskoj strani, ne stvarno ponovno
      // izvršavanje upita.
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
      const saTimestampom = elements.filter((el) => el.timestamp).length;
      console.log(`  Pokušaj ${pokusaj}/${MAX_POKUSAJA}: vratio ${elements.length} elemenata, ${saTimestampom} sa timestampom.`);

      if (elements.length === 0 && najveciBrojElemenataBezMeta === 0) {
        // Stvarno prazan odgovor, i nijedan prošli pokušaj nije nagovijestio
        // da ima podataka - legitimna nula.
        return elements;
      }
      if (saTimestampom > 0) {
        console.log(`  Primjer prvog elementa (radi provjere): ${JSON.stringify(elements[0]).slice(0, 300)}`);
        return elements;
      }

      // Elementi postoje (znamo da IMA podataka za ovaj period), ali bez
      // meta - loš node. Pamtimo da smo to vidjeli i pokušavamo ponovno.
      najveciBrojElemenataBezMeta = Math.max(najveciBrojElemenataBezMeta, elements.length);
      console.log(`  UPOZORENJE: odgovor bez meta podataka (poznat problem loše rutiranog node-a), pokušavam ponovno...`);
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

async function obradiJedanKomad(fromISO, toISO, manifest, zupanije) {
  console.log(`Dohvaćam: ${fromISO} -> ${toISO}`);
  const elements = await fetchNoveZgrade(fromISO, toISO);
  const features = elements.map((el) => toSlimFeature(el, zupanije));

  console.log(`  Tražim DGU adrese unutar obrisa zgrada bez addr:street...`);
  const dguNadjeno = dodajDguAdrese(features);
  console.log(`  DGU adresa pronađena za ${dguNadjeno} zgrada.`);

  console.log(`  Računam najbližu cestu za preostale zgrade bez adrese...`);
  await dodajNajblizuCestu(features);

  const dateLabel = toISO.slice(0, 10);
  const fileName = `novo-${dateLabel}.json`;
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

main().catch((err) => {
  console.error("Pipeline pukao:", err.message);
  process.exit(1);
});

