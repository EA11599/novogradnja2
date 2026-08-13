// Jednokratni backfill: popunjava SVE sirove OSM oznake (building:levels,
// roof:shape, building:colour, itd.) za zapise dohvaćene prije nego je
// pipeline promijenjen da čuva cijeli tags objekt umjesto ručno odabranih
// polja. Isti pristup kao backfill-datumi.js (bbox + newer, meta uključuje
// tags), samo umjesto validFrom spaja nedostajuće ključeve u f.tags.
//
// Cilja zapise kojima SVI feature-i nemaju obris (obris:null) - to je
// pouzdan znak da su iz starog formata (stara shema nikad nije čuvala ni
// geometriju ni pune oznake), bez obzira imaju li već datum popunjen.
//
// Pokreće se ručno: node scripts/backfill-oznake.js

const fs = require("fs");
const path = require("path");
const cfg = require("./zgrade-config");

const REPO_ROOT = path.join(__dirname, "..");
const ZGRADE_DIR = path.join(REPO_ROOT, cfg.ZGRADE_DIR);
const MANIFEST_PATH = path.join(ZGRADE_DIR, "manifest.json");

async function posaljiUpit(fromISO) {
  const HR_BBOX = "42.30,13.30,46.60,19.50";
  const query = `
    [out:json][timeout:180];
    (
      way["building"](newer:"${fromISO}")(${HR_BBOX});
      relation["building"](newer:"${fromISO}")(${HR_BBOX});
    );
    out meta;
  `;

  const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

  for (const mirrorUrl of MIRRORS) {
    console.log(`Pokušavam mirror: ${mirrorUrl}`);
    const MAX_POKUSAJA = 2;
    for (let pokusaj = 1; pokusaj <= MAX_POKUSAJA; pokusaj++) {
      try {
        const res = await fetch(mirrorUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": cfg.USER_AGENT },
          body: new URLSearchParams({ data: query }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Overpass ${res.status}: ${text.slice(0, 500)}`);
        const parsed = JSON.parse(text);
        const elements = parsed.elements || [];
        const saTagovima = elements.filter((el) => el.tags && Object.keys(el.tags).length > 0).length;
        console.log(`  ${mirrorUrl}: vratio ${elements.length} elemenata, ${saTagovima} sa oznakama.`);
        if (saTagovima > 0 || elements.length === 0) return elements;
        console.log(`  Ovaj mirror nema oznake, pokušavam sljedeći...`);
        break;
      } catch (err) {
        if (pokusaj === 2) break;
        const jePrivremena = /50[234]/.test(err.message);
        if (!jePrivremena) break;
        const pauza = pokusaj * 15000;
        console.log(`  Privremena greška (pokušaj ${pokusaj}/2), čekam ${pauza / 1000}s...`);
        await new Promise((r) => setTimeout(r, pauza));
      }
    }
  }
  throw new Error("Nijedan mirror nije vratio elemente s oznakama.");
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  // Zapisi iz starog formata: SVI feature-i u njima nemaju obris (stara
  // shema nikad nije čuvala ni geometriju ni pune oznake zajedno).
  const zaPopravak = manifest.entries.filter((e) => {
    const data = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, e.file), "utf8"));
    return data.features.length > 0 && data.features.every((f) => !f.obris);
  });

  if (zaPopravak.length === 0) {
    console.log("Nema zapisa iz starog formata koji trebaju popravak oznaka.");
    return;
  }

  const najranijaGranica = zaPopravak.reduce((min, e) => (e.from < min ? e.from : min), zaPopravak[0].from);
  console.log(`Dohvaćam sve zgrade novije od ${najranijaGranica} (za ${zaPopravak.length} tjednih zapisa)...`);

  const elementi = await posaljiUpit(najranijaGranica);
  console.log(`Overpass vratio ${elementi.length} elemenata.`);

  // id -> puni tags objekt
  const tagoviPoId = {};
  elementi.forEach((el) => {
    if (el.tags) tagoviPoId[`${el.type}/${el.id}`] = el.tags;
  });

  for (const entry of zaPopravak) {
    const filePath = path.join(REPO_ROOT, entry.file);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    let dopunjeno = 0;
    data.features.forEach((f) => {
      const sveOznake = tagoviPoId[f.id];
      if (!sveOznake) return;
      let dodanoNesto = false;
      for (const [k, v] of Object.entries(sveOznake)) {
        // Ne prepisujemo vec postojece kljuceve (npr. addr:street koji smo
        // vec imali) - samo dodajemo one koji nedostaju.
        if (!(k in f.tags)) { f.tags[k] = v; dodanoNesto = true; }
      }
      if (dodanoNesto) dopunjeno++;
    });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`${entry.file}: dopunjeno oznaka za ${dopunjeno}/${data.features.length} zgrada`);
  }

  console.log("\nBackfill oznaka gotov.");
}

main().catch((err) => {
  console.error("Backfill pukao:", err.message);
  process.exit(1);
});
