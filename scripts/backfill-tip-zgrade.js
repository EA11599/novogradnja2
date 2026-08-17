// Jednokratni backfill: ponovno pokreće DGU spajanje (koje sad broji SVE
// DGU adrese unutar obrisa, ne samo prvu) na postojećim zgradama unutar
// zadnjih 7 dana - dodaje im dguBrojJedinica polje koje ranije nije
// postojalo. Brzo je (samo lokalna grid pretraga, bez mrežnih poziva).
//
// Pokreće se ručno: node scripts/backfill-tip-zgrade.js

const fs = require("fs");
const path = require("path");
const cfg = require("./zgrade-config");
const { dodajDguAdrese } = require("./lib/dgu-spajanje");

const REPO_ROOT = path.join(__dirname, "..");
const ZGRADE_DIR = path.join(REPO_ROOT, cfg.ZGRADE_DIR);
const MANIFEST_PATH = path.join(ZGRADE_DIR, "manifest.json");

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.entries.length === 0) {
    console.log("Manifest je prazan, nema što obraditi.");
    return;
  }

  // Isti prozor kao satelit-verifikacija.js i frontend "1 tjedan" - zadnjih
  // 7 dana od najnovijeg zapisa.
  const zadnjiTo = new Date(manifest.entries[manifest.entries.length - 1].to);
  const cutoff = new Date(zadnjiTo);
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  const ciljaniZapisi = manifest.entries.filter((e) => new Date(e.to) > cutoff);

  console.log(`Ciljani zapisi (zadnjih 7 dana): ${ciljaniZapisi.map((e) => e.file).join(", ")}`);

  let ukupnoNadjeno = 0;
  for (const entry of ciljaniZapisi) {
    const filePath = path.join(REPO_ROOT, entry.file);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

    const nadjeno = dodajDguAdrese(data.features);
    ukupnoNadjeno += nadjeno;
    console.log(`${entry.file}: DGU adresa (s brojem jedinica) pronađena za ${nadjeno}/${data.features.length} zgrada.`);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  console.log(`\nUkupno dopunjeno: ${ukupnoNadjeno} zgrada.`);
}

main();
