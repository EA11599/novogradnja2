// Jednokratna skripta: resetira `satelitProvjera` polje SAMO za zgrade iz
// zadnjih N dana (zadano 7), da ih idući normalan pokrenut satelit-verifikacija.js
// ponovno obradi - ovaj put s novim (2023./24.) ortofoto slojem umjesto starog
// 2022. sloja.
//
// NE dira zgrade izvan tog prozora (4 tjedna, 3 mjeseca) - te ostaju na
// starom sloju dok se prirodno ne osvježe protokom vremena (svaki tjedan
// novi ulazak u "zadnjih 7 dana" prozor).
//
// Pokreće se ručno: node scripts/backfill-reset-satelit.js [broj-dana]

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const ZGRADE_DIR = path.join(REPO_ROOT, "data", "zgrade");
const MANIFEST_PATH = path.join(ZGRADE_DIR, "manifest.json");

const brojDana = parseInt(process.argv[2], 10) || 7;

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  const granica = new Date();
  granica.setUTCDate(granica.getUTCDate() - brojDana);

  const uProzoru = manifest.entries.filter((e) => new Date(e.to) > granica);
  if (uProzoru.length === 0) {
    console.log(`Nema zapisa unutar zadnjih ${brojDana} dana - ništa za resetirati.`);
    return;
  }

  console.log(`Resetiram satelitsku provjeru za zapise unutar zadnjih ${brojDana} dana:`);
  let ukupnoResetirano = 0;

  uProzoru.forEach((e) => {
    const putanja = path.join(REPO_ROOT, e.file);
    const podaci = JSON.parse(fs.readFileSync(putanja, "utf8"));
    let resetiranoUOvoj = 0;

    podaci.features.forEach((f) => {
      // Diramo samo vec uspjesno provjerene (ne "greska" - te se ionako
      // same ponovno pokusavaju svaki put zbog postojece idempotentne logike).
      if (f.satelitProvjera && f.satelitProvjera.status !== "greska") {
        delete f.satelitProvjera;
        resetiranoUOvoj++;
      }
    });

    fs.writeFileSync(putanja, JSON.stringify(podaci, null, 2));
    console.log(`  ${e.file}: resetirano ${resetiranoUOvoj} zgrada.`);
    ukupnoResetirano += resetiranoUOvoj;
  });

  console.log(`\nUkupno resetirano: ${ukupnoResetirano} zgrada. Pokreni satelit-verifikacija.js da ih ponovno obradi novim slojem.`);
}

main();
