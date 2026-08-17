// Jednokratni backfill: dohvaća geometriju (obris) za postojeće zgrade
// kojima nedostaje (obris:null zbog "out geom center;" bug-a - vidi
// napomenu u fetch-zgrade.js). Koristi ISTE way ID-jeve koji su već
// spremljeni, samo im dodaje poligon naknadno.
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
  const MAX_POKUSAJA = 5;
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
      const jePrivremena = /50[234]/.test(err.message);
      if (!jePrivremena || pokusaj === MAX_POKUSAJA) throw err;
      const pauza = pokusaj * 10000;
      console.log(`  Privremena greška (pokušaj ${pokusaj}/${MAX_POKUSAJA}), čekam ${pauza / 1000}s...`);
      await new Promise((r) => setTimeout(r, pauza));
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

  for (const entry of ciljaniZapisi) {
    const filePath = path.join(REPO_ROOT, entry.file);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

    const bezObrisa = data.features.filter((f) => !f.obris && f.id.startsWith("way/"));
    console.log(`\n${entry.file}: ${bezObrisa.length} way-zgrada bez obrisa (od ${data.features.length} ukupno).`);
    if (bezObrisa.length === 0) continue;

    const wayIds = bezObrisa.map((f) => f.id.replace("way/", ""));
    // Dijelimo u komade od 300 da izbjegnemo predugačke upite.
    const KOMAD = 300;
    const geometrijaPoId = {};
    for (let i = 0; i < wayIds.length; i += KOMAD) {
      const dio = wayIds.slice(i, i + KOMAD);
      const query = `[out:json][timeout:180];way(id:${dio.join(",")});out geom;`;
      console.log(`  Dohvaćam geometriju za ${dio.length} way-ova (${i + 1}-${i + dio.length}/${wayIds.length})...`);
      const elementi = await posaljiUpit(query);
      elementi.forEach((el) => {
        geometrijaPoId[`way/${el.id}`] = el.geometry || null;
      });
    }

    let popunjeno = 0;
    bezObrisa.forEach((f) => {
      const geom = geometrijaPoId[f.id];
      if (Array.isArray(geom) && geom.length > 0) {
        const obris = geom
          .filter((n) => n && typeof n.lat === "number" && typeof n.lon === "number")
          .map((n) => [+n.lon.toFixed(6), +n.lat.toFixed(6)]);
        if (obris.length >= 3) {
          f.obris = obris;
          const centroid = centroidOfRing(obris);
          f.lon = centroid[0];
          f.lat = centroid[1];
          popunjeno++;
        }
      }
    });

    console.log(`  Popunjeno: ${popunjeno}/${bezObrisa.length}.`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  console.log("\nBackfill obrisa gotov.");
}

main().catch((err) => {
  console.error("Backfill pukao:", err.message);
  process.exit(1);
});
