// Jednokratni backfill: popunjava validFrom (timestamp) za zgrade koje su
// dohvaćene dok je pipeline još koristio "changed:" filter (koji je,
// otkrili smo, gubio meta podatke na Overpass serveru). Umjesto ponovnog
// dohvata svakog tjedna zasebno, radimo JEDAN veći upit (newer: od
// najranije granice koja treba popravak) i lokalno raspodijelimo svaki
// vraćeni element u pravi tjedni zapis na temelju njegovog stvarnog
// timestampa - ista logika kao redoviti pipeline, samo unatrag.
//
// Pokreće se ručno: node scripts/backfill-datumi.js

const fs = require("fs");
const path = require("path");
const cfg = require("./zgrade-config");

const REPO_ROOT = path.join(__dirname, "..");
const ZGRADE_DIR = path.join(REPO_ROOT, cfg.ZGRADE_DIR);
const MANIFEST_PATH = path.join(ZGRADE_DIR, "manifest.json");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

async function posaljiUpit(fromISO) {
  const query = `
    [out:json][timeout:180];
    area["ISO3166-1"="HR"][admin_level=2]->.hr;
    (
      way["building"](newer:"${fromISO}")(area.hr)(if:version()==1);
      relation["building"](newer:"${fromISO}")(area.hr)(if:version()==1);
    );
    out geom meta tags;
  `;

  const MAX_POKUSAJA = 3;
  for (let pokusaj = 1; pokusaj <= MAX_POKUSAJA; pokusaj++) {
    try {
      const res = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": cfg.USER_AGENT },
        body: new URLSearchParams({ data: query }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Overpass ${res.status}: ${text.slice(0, 500)}`);
      const parsed = JSON.parse(text);
      return parsed.elements || [];
    } catch (err) {
      if (pokusaj === MAX_POKUSAJA) throw err;
      const jePrivremena = /50[234]/.test(err.message);
      if (!jePrivremena) throw err;
      const pauza = pokusaj * 15000;
      console.log(`Privremena greška (pokušaj ${pokusaj}/${MAX_POKUSAJA}), čekam ${pauza / 1000}s...`);
      await new Promise((r) => setTimeout(r, pauza));
    }
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  // Zapisi kojima nedostaje datum, i najranija granica od koje treba dohvatiti
  const zaPopravak = manifest.entries.filter((e) => {
    const data = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, e.file), "utf8"));
    return data.features.some((f) => !f.validFrom);
  });

  if (zaPopravak.length === 0) {
    console.log("Nema zapisa koji trebaju popravak datuma.");
    return;
  }

  const najranijaGranica = zaPopravak.reduce((min, e) => (e.from < min ? e.from : min), zaPopravak[0].from);
  console.log(`Dohvaćam sve zgrade novije od ${najranijaGranica} (za ${zaPopravak.length} tjednih zapisa)...`);

  const elementi = await posaljiUpit(najranijaGranica);
  console.log(`Overpass vratio ${elementi.length} elemenata.`);

  // id -> timestamp lookup
  const timestampPoId = {};
  elementi.forEach((el) => {
    if (el.timestamp) timestampPoId[`${el.type}/${el.id}`] = el.timestamp;
  });

  for (const entry of zaPopravak) {
    const filePath = path.join(REPO_ROOT, entry.file);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    let popunjeno = 0;
    data.features.forEach((f) => {
      if (!f.validFrom && timestampPoId[f.id]) {
        f.validFrom = timestampPoId[f.id];
        popunjeno++;
      }
    });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`${entry.file}: popunjeno ${popunjeno}/${data.features.length}`);
  }

  console.log("\nBackfill datuma gotov.");
}

main().catch((err) => {
  console.error("Backfill pukao:", err.message);
  process.exit(1);
});
