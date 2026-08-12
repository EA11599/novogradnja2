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

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  for (const entry of manifest.entries) {
    const filePath = path.join(REPO_ROOT, entry.file);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

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
