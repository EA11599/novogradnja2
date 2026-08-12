// Jednokratni backfill: postojeći podaci o zgradama (dohvaćeni prije nego
// je dodan izračun najbliže ceste) nemaju nearestStreet/nearestStreetDist
// polja. Ovo ih naknadno popunjava, bez ponovnog dohvata samih zgrada.
//
// Pokreće se ručno: node scripts/backfill-nearest-street.js
// ili preko GitHub Actions workflowa "backfill-najbliza-cesta.yml".

const fs = require("fs");
const path = require("path");
const cfg = require("./zgrade-config");
const { dodajNajblizuCestu } = require("./lib/najbliza-cesta");

const REPO_ROOT = path.join(__dirname, "..");
const ZGRADE_DIR = path.join(REPO_ROOT, cfg.ZGRADE_DIR);
const MANIFEST_PATH = path.join(ZGRADE_DIR, "manifest.json");

// Stariji zapisi (dohvaćeni prije nego je pipeline počeo čuvati puni
// tags objekt) imaju ravna polja (building, addr_street, addr_housenumber,
// addr_city) umjesto tags objekta. Normaliziramo ih u novi oblik prije
// računanja najbliže ceste, koja čita f.tags["addr:street"].
function normalizirajFeature(f) {
  if (f.tags) return f; // već novi format
  const tags = {};
  if (f.building) tags.building = f.building;
  if (f.name) tags.name = f.name;
  if (f.addr_street) tags["addr:street"] = f.addr_street;
  if (f.addr_housenumber) tags["addr:housenumber"] = f.addr_housenumber;
  if (f.addr_city) tags["addr:city"] = f.addr_city;
  f.tags = tags;
  if (f.obris === undefined) f.obris = null;
  return f;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  for (const entry of manifest.entries) {
    const filePath = path.join(REPO_ROOT, entry.file);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    data.features = data.features.map(normalizirajFeature);

    console.log(`\n${entry.file} (${data.features.length} zgrada)...`);
    await dodajNajblizuCestu(data.features);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  console.log("\nBackfill gotov.");
}

main().catch((err) => {
  console.error("Backfill pukao:", err.message);
  process.exit(1);
});
