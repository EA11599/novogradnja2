// Tjedni pipeline: dohvaća SVE zgrade novokreirane u OSM-u na području
// Hrvatske u zadanom vremenskom prozoru (koristi ohsome "contributions"
// endpoint — vraća samo ono što je stvarno promijenjeno/dodano, pa ne
// moramo skidati i lokalno uspoređivati cijeli nacionalni sloj zgrada
// svaki put, što ne bi stalo u besplatan GitHub repo).
//
// Pokreće se preko GitHub Actions (.github/workflows/tjedni-pipeline-zgrade.yml)
// jednom tjedno. Može se pokrenuti i ručno: `npm run fetch:zgrade`.

const fs = require("fs");
const path = require("path");
const cfg = require("./zgrade-config");
const { getHrGranica } = require("./lib/hr-granica");

const REPO_ROOT = path.join(__dirname, "..");
const ZGRADE_DIR = path.join(REPO_ROOT, cfg.ZGRADE_DIR);
const MANIFEST_PATH = path.join(ZGRADE_DIR, "manifest.json");

const OHSOME_URL = "https://api.ohsome.org/v1/contributions/geometry";
const OHSOME_METADATA_URL = "https://api.ohsome.org/v1/metadata";

// ohsome-ova podatkovna baza (OSHDB) NIJE ažurna "uživo" do ovog trenutka —
// replicira se s kašnjenjem (u praksi i do par tjedana). Zato prije svakog
// upita pitamo /metadata do kojeg trenutka stvarno ima podataka, umjesto da
// nagađamo "sada" — inače ohsome vrati 404 s porukom da traženi period
// izlazi izvan raspoloživog raspona.
async function getOhsomeLatestTimestamp() {
  const res = await fetch(OHSOME_METADATA_URL, {
    headers: { "User-Agent": cfg.USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`ohsome /metadata neuspio: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.extractRegion.temporalExtent.toTimestamp;
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

// Vrijeme od kojeg gledamo nove zgrade: ili odmah nakon zadnjeg zabilježenog
// pokretanja (bez rupa i bez preklapanja), ili — ako je ovo prvi put —
// FIRST_RUN_LOOKBACK_DAYS dana unatrag OD onoga što ohsome stvarno ima
// (toISO), ne od pravog "sada" — ohsome-ova baza kasni za stvarnošću, pa bi
// računanje od pravog "sada" moglo dati period koji uopće ne postoji u
// njihovim podacima.
function computeFromTimestamp(manifest, toISO) {
  if (manifest.entries.length > 0) {
    return manifest.entries[manifest.entries.length - 1].to;
  }
  const d = new Date(toISO);
  d.setUTCDate(d.getUTCDate() - cfg.FIRST_RUN_LOOKBACK_DAYS);
  return d.toISOString().slice(0, 19);
}

async function fetchNoveZgrade(granica, fromISO, toISO) {
  const body = new URLSearchParams({
    bpolys: JSON.stringify({ type: "FeatureCollection", features: [granica] }),
    filter: cfg.OHSOME_FILTER,
    time: `${fromISO},${toISO}`,
    // "/contributions/geometry" NE podržava contributionType kao filter
    // parametar (to postoji samo na /contributions/count i sličnima) —
    // umjesto toga tražimo metadata, koja uz svaki element vrati zastavicu
    // @creation/@deletion/@tagChange/@geometryChange, pa filtriramo lokalno.
    properties: "metadata,tags",
    clipGeometry: "true",
  });

  const res = await fetch(OHSOME_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": cfg.USER_AGENT,
    },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    // ohsome zna vratiti 500 i na naizgled ispravne upite (viđeno ranije s
    // /elements/count) — ispisujemo puno tijelo odgovora da se odmah vidi
    // je li problem u upitu ili u samom servisu.
    throw new Error(
      `ohsome ${res.status} ${res.statusText}\nOdgovor: ${text.slice(0, 1000)}`
    );
  }
  const parsed = JSON.parse(text);
  // Lokalni filter: zadrži samo elemente koji su STVARNO novonastali u ovom
  // periodu (ne tag/geometry promjene postojećih zgrada).
  parsed.features = (parsed.features || []).filter(
    (f) => f.properties && f.properties["@creation"] === true
  );
  return parsed;
}

function toSlimFeature(f) {
  const props = f.properties || {};
  const [lon, lat] = centroidOf(f.geometry);
  return {
    id: props["@osmId"] || props.osmId || null,
    lat: lat !== null ? +lat.toFixed(6) : null,
    lon: lon !== null ? +lon.toFixed(6) : null,
    building: props.building || null,
    name: props.name || null,
    addr_street: props["addr:street"] || null,
    addr_housenumber: props["addr:housenumber"] || null,
    addr_city: props["addr:city"] || null,
    validFrom: props["@timestamp"] || null,
  };
}

// Vrlo jednostavan centroid (aritmetička sredina vanjskog prstena) — dovoljno
// precizan za prikaz markera na karti, ne za geometrijske proračune.
function centroidOf(geometry) {
  if (!geometry) return [null, null];
  let ring;
  if (geometry.type === "Polygon") ring = geometry.coordinates[0];
  else if (geometry.type === "MultiPolygon") ring = geometry.coordinates[0][0];
  else return [null, null];
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

async function main() {
  const granica = await getHrGranica();
  const manifest = loadManifest();

  const toISO = (await getOhsomeLatestTimestamp()).slice(0, 19);
  const fromISO = computeFromTimestamp(manifest, toISO);

  if (new Date(toISO) <= new Date(fromISO)) {
    console.log("Nema novog vremenskog prozora za obraditi (ohsome jos nema svježijih podataka od zadnjeg pokretanja) — preskačem.");
    return;
  }

  console.log(`Dohvaćam nove zgrade u Hrvatskoj: ${fromISO} → ${toISO}`);
  const geojson = await fetchNoveZgrade(granica, fromISO, toISO);
  const features = (geojson.features || []).map(toSlimFeature);

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

  pruneOldEntries(manifest);
  saveManifest(manifest);

  console.log(`Gotovo: ${features.length} novih zgrada spremljeno u ${fileName}.`);
  console.log(`Manifest sad ima ${manifest.entries.length} tjednih zapisa (retencija: ${cfg.RETENTION_WEEKS} tj.).`);

  // TODO (sljedeći korak): ako je features.length > 0, ovdje pozvati
  // notifikacijsku funkciju (Supabase + Resend) za sve prijavljene emailove.
  // Namjerno izostavljeno dok baza pretplatnika ne postoji.
}

main().catch((err) => {
  console.error("Pipeline pukao:", err.message);
  process.exit(1);
});
