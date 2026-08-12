// Tjedni pipeline: dohvaća SVE zgrade novokreirane u OSM-u na području
// Hrvatske u zadanom vremenskom prozoru (koristi ohsome "contributions"
// endpoint — vraća samo ono što je stvarno promijenjeno/dodano, pa ne
// moramo skidati i lokalno uspoređivati cijeli nacionalni sloj zgrada
// svaki put, što ne bi stalo u besplatan GitHub repo).
//
// Pokreće se preko GitHub Actions (.github/workflows/tjedni-pipeline-zgrade.yml)
// jednom tjedno. Može se pokrenuti i ručno: `npm run fetch:zgrade`.

// Tjedni pipeline: dohvaća SVE zgrade novokreirane u OSM-u na području
// Hrvatske u zadanom vremenskom prozoru.
//
// Koristi Overpass API (overpass-api.de), NE ohsome — Overpass radi nad
// glavnom OSM bazom koja se ažurira MINUTNO (gotovo uživo), dok ohsome ima
// vlastitu repliciranu bazu koja zna kasniti i tjednima za stvarnošću (to
// smo utvrdili u praksi: tražili "do danas", ohsome je imao podatke samo
// do prije 2+ tjedna). Overpass-ov `newer:` filter efikasno vraća samo
// elemente promijenjene/nastale nakon zadanog trenutka, bez potrebe da
// skidamo cijeli nacionalni sloj zgrada.
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

const REPO_ROOT = path.join(__dirname, "..");
const ZGRADE_DIR = path.join(REPO_ROOT, cfg.ZGRADE_DIR);
const MANIFEST_PATH = path.join(ZGRADE_DIR, "manifest.json");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

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

async function fetchNoveZgrade(fromISO) {
  const query = `
    [out:json][timeout:180];
    area["ISO3166-1"="HR"][admin_level=2]->.hr;
    (
      way["building"](newer:"${fromISO}")(area.hr)(if:version()==1);
      relation["building"](newer:"${fromISO}")(area.hr)(if:version()==1);
    );
    out center meta tags;
  `;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": cfg.USER_AGENT,
    },
    body: new URLSearchParams({ data: query }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Overpass ${res.status} ${res.statusText}\nOdgovor: ${text.slice(0, 1500)}`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Overpass je vratio ne-JSON odgovor (vjerojatno greška/rate-limit):\n${text.slice(0, 1500)}`);
  }

  // version === 1 => prva verzija tog elementa ikad => stvarno nov, ne
  // izmjena postojeće zgrade koja je slučajno uhvaćena "newer" filterom.
  // Number(...) jer Overpass zna vratiti version kao string, a strogo ===1
  // bi tad uvijek bilo false (upravo ovo je uzrokovalo 0 rezultata ranije).
  return (parsed.elements || []).filter((el) => Number(el.version) === 1);
}

function toSlimFeature(el) {
  const tags = el.tags || {};
  const center = el.center || {};
  return {
    id: `${el.type}/${el.id}`,
    lat: typeof center.lat === "number" ? +center.lat.toFixed(6) : null,
    lon: typeof center.lon === "number" ? +center.lon.toFixed(6) : null,
    building: tags.building || null,
    name: tags.name || null,
    addr_street: tags["addr:street"] || null,
    addr_housenumber: tags["addr:housenumber"] || null,
    addr_city: tags["addr:city"] || null,
    validFrom: el.timestamp || null,
  };
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
  const manifest = loadManifest();
  const fromISO = computeFromTimestamp(manifest);
  const toISO = normalizeTimestamp(new Date());

  if (new Date(toISO) <= new Date(fromISO)) {
    console.log("Nema novog vremenskog prozora za obraditi — preskačem.");
    return;
  }

  console.log(`Dohvaćam nove zgrade u Hrvatskoj (Overpass, gotovo uživo): ${fromISO} -> ${toISO}`);
  const elements = await fetchNoveZgrade(fromISO);
  const features = elements.map(toSlimFeature);

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

