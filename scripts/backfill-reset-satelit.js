// Jednokratna skripta: resetira `satelitProvjera` polje za zgrade unutar
// prozora koji SATELIT-VERIFIKACIJA.JS STVARNO KORISTI - usidreno na zadnji
// manifest unos minus N dana (zadano 7), NE na "danasnji" datum. Ovo je
// namjerno isto sidro kao u satelit-verifikacija.js (vidi tamo `cutoff`) -
// da bi ova skripta tocno pogodila iste datoteke koje ce ta skripta obraditi.
//
// Zadano ponasanje: resetira SVE zgrade u prozoru (bez obzira na trenutni
// satelitProvjera status) - koristi se npr. nakon promjene metodologije
// (novi ortofoto sloj, ili siri filter koji sad ukljucuje i adresirane
// zgrade) kad zelimo POTPUNO ponovno provjeriti cijeli tjedan, ne samo
// nadopuniti ono sto jos nije provjereno.
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
  if (manifest.entries.length === 0) {
    console.log("Manifest je prazan - nema što resetirati.");
    return;
  }

  // Isto sidro kao satelit-verifikacija.js: zadnji manifest unos, NE "danas".
  const zadnjiTo = new Date(manifest.entries[manifest.entries.length - 1].to);
  const granica = new Date(zadnjiTo);
  granica.setUTCDate(granica.getUTCDate() - brojDana);

  const uProzoru = manifest.entries.filter((e) => new Date(e.to) > granica);
  if (uProzoru.length === 0) {
    console.log(`Nema zapisa unutar zadnjih ${brojDana} dana (od zadnjeg unosa) - ništa za resetirati.`);
    return;
  }

  console.log(`Resetiram satelitsku provjeru (SVE, ne samo neprovjerene) za zapise unutar zadnjih ${brojDana} dana od zadnjeg unosa (${zadnjiTo.toISOString()}):`);
  let ukupnoResetirano = 0;

  uProzoru.forEach((e) => {
    const putanja = path.join(REPO_ROOT, e.file);
    const podaci = JSON.parse(fs.readFileSync(putanja, "utf8"));
    let resetiranoUOvoj = 0;

    podaci.features.forEach((f) => {
      if (f.satelitProvjera) {
        delete f.satelitProvjera;
        resetiranoUOvoj++;
      }
    });

    fs.writeFileSync(putanja, JSON.stringify(podaci, null, 2));
    console.log(`  ${e.file}: resetirano ${resetiranoUOvoj} / ${podaci.features.length} zgrada.`);
    ukupnoResetirano += resetiranoUOvoj;
  });

  console.log(`\nUkupno resetirano: ${ukupnoResetirano} zgrada. Pokreni satelit-verifikacija.js da ih ponovno obradi.`);
}

main();
