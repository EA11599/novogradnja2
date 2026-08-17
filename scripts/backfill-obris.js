// Jednokratni backfill: dohvaća geometriju (obris) za postojeće zgrade
// kojima nedostaje (obris:null zbog "out geom center;" bug-a - vidi
// napomenu u fetch-zgrade.js). Koristi ISTE way ID-jeve koji su već
// spremljeni, samo im dodaje poligon naknadno.
//
// OTPORNOST NA PREKID: sprema se nakon SVAKOG komada (300 way-ova), ne
// samo na kraju cijele datoteke - prekid usred obrade ne gubi dotadašnji
// rad. Greška na jednoj datoteci ne prekida obradu ostalih. Idempotentno -
// ponovno pokretanje preskače već popunjene zgrade.
//
// Pokreće se ručno: node scripts/backfill-obris.js

const fs = require("fs");
const path = require("path");
const cfg = require("./zgrade-config");

const REPO_ROOT = path.join(__dirname, "..");
const ZGRADE_DIR = path.join(REPO_ROOT, cfg.ZGRADE_DIR);
const MANIFEST_PATH = path.join(ZGRADE_DIR, "manifest.json");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

function centroidOfRing(ring) {
  if (!ring || ring.length === 0) return [null, null];
  let sx = 0, sy = 0;
  for (const [x, y] of ring) { sx += x; sy += y; }
  return [sx / ring.length, sy / ring.length];
}

async function posaljiUpit(query) {
  const MAX_POKUSAJA = 6;
  for (let pokusaj = 1; pokusaj <= MAX_POKUSAJA; pokusaj++) {
    try {
      const queryUniknjen = `// pokusaj-${pokusaj}-${Date.now()}\n${query}`;
      const res = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": cfg.USER_AGENT },
        body: new URLSearchParams({ data: queryUniknjen }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Overpass ${res.status}: ${text.slice(0, 500)}`);
      const parsed = JSON.parse(text);
      return parsed.elements || [];
    } catch (err) {
      // VAŽNO: 429 (rate limit) MORA biti u ovom popisu - ranija verzija ga
      // je propustila (samo 50[234]), pa je skripta odmah pukla na prvi
      // rate-limit umjesto da pokuša ponovno.
      const jePrivremena = /42[89]|50[0234]/.test(err.message);
      if (!jePrivremena || pokusaj === MAX_POKUSAJA) throw err;
      // 429 traži dulju pauzu od običnog 502/504 - rate limit se ne
      // oporavlja za par sekundi.
      const je429 = /429/.test(err.message);
      const pauza = je429 ? pokusaj * 20000 : pokusaj * 10000;
      console.log(`  Privremena greška (pokušaj ${pokusaj}/${MAX_POKUSAJA}), čekam ${pauza / 1000}s: ${err.message.split("\n")[0].slice(0, 100)}`);
      await new Promise((r) => setTimeout(r, pauza));
    }
  }
}

async function obradiDatoteku(entry) {
  const filePath = path.join(REPO_ROOT, entry.file);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

  const bezObrisa = data.features.filter((f) => !f.obris && f.id.startsWith("way/"));
  console.log(`\n${entry.file}: ${bezObrisa.length} way-zgrada bez obrisa (od ${data.features.length} ukupno).`);
  if (bezObrisa.length === 0) return;

  const wayIds = bezObrisa.map((f) => f.id.replace("way/", ""));
  const featurePoId = {};
  bezObrisa.forEach((f) => { featurePoId[f.id] = f; });

  const KOMAD = 300;
  for (let i = 0; i < wayIds.length; i += KOMAD) {
    const dio = wayIds.slice(i, i + KOMAD);
    const query = `[out:json][timeout:180];way(id:${dio.join(",")});out geom;`;
    console.log(`  Dohvaćam geometriju za ${dio.length} way-ova (${i + 1}-${i + dio.length}/${wayIds.length})...`);
    const elementi = await posaljiUpit(query);

    let popunjenoUKomadu = 0;
    elementi.forEach((el) => {
      const f = featurePoId[`way/${el.id}`];
      if (!f || !Array.isArray(el.geometry) || el.geometry.length === 0) return;
      const obris = el.geometry
        .filter((n) => n && typeof n.lat === "number" && typeof n.lon === "number")
        .map((n) => [+n.lon.toFixed(6), +n.lat.toFixed(6)]);
      if (obris.length >= 3) {
        f.obris = obris;
        const centroid = centroidOfRing(obris);
        f.lon = centroid[0];
        f.lat = centroid[1];
        popunjenoUKomadu++;
      }
    });
    console.log(`    Popunjeno u ovom komadu: ${popunjenoUKomadu}/${dio.length}.`);

    // Spremi NAKON SVAKOG KOMADA - prekid usred obrade ne gubi dotadašnji rad.
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    // Mala pauza između komada - smanjuje rizik od rate-limita na javnom serveru.
    if (i + KOMAD < wayIds.length) {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const zadnjiTo = new Date(manifest.entries[manifest.entries.length - 1].to);
  const cutoff = new Date(zadnjiTo);
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  const ciljaniZapisi = manifest.entries.filter((e) => new Date(e.to) > cutoff);

  console.log(`Ciljani zapisi: ${ciljaniZapisi.map((e) => e.file).join(", ")}`);

  const greske = [];
  for (const entry of ciljaniZapisi) {
    try {
      await obradiDatoteku(entry);
    } catch (err) {
      // Greška na JEDNOJ datoteci ne smije prekinuti obradu ostalih -
      // nastavi na sljedeću, prijavi na kraju.
      console.error(`  GREŠKA na ${entry.file}: ${err.message.split("\n")[0]}`);
      greske.push(entry.file);
    }
  }

  if (greske.length > 0) {
    console.log(`\nZavršeno s greškama na: ${greske.join(", ")} - ponovno pokreni skriptu da nastavi (idempotentno, preskače već gotovo).`);
    process.exit(1);
  }
  console.log("\nBackfill obrisa gotov, bez grešaka.");
}

main().catch((err) => {
  console.error("Backfill pukao:", err.message);
  process.exit(1);
});
