// Jednokratna skripta: gradi `data/zgrade/geometrija-indeks.json` iz SVIH
// vec zabiljezenih zgrada (id -> povrsina). Ovo je preduvjet za novu
// funkciju "prosirenja postojecih zgrada" u fetch-zgrade.js - bez ovog
// indeksa pipeline nema s cime usporediti novu geometriju.
//
// Pokrece se rucno, JEDNOM: node scripts/backfill-geometrija-indeks.js

const fs = require("fs");
const path = require("path");
const { povrsinaPoligona } = require("./lib/geometrija");

const REPO_ROOT = path.join(__dirname, "..");
const ZGRADE_DIR = path.join(REPO_ROOT, "data", "zgrade");
const MANIFEST_PATH = path.join(ZGRADE_DIR, "manifest.json");
const INDEKS_PATH = path.join(ZGRADE_DIR, "geometrija-indeks.json");

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const indeks = {};
  let ukupno = 0, sObrisom = 0;

  manifest.entries.forEach((e) => {
    const putanja = path.join(REPO_ROOT, e.file);
    const podaci = JSON.parse(fs.readFileSync(putanja, "utf8"));
    podaci.features.forEach((f) => {
      ukupno++;
      if (f.obris && f.obris.length >= 3) {
        const povrsina = povrsinaPoligona(f.obris);
        if (povrsina !== null) {
          indeks[f.id] = { povrsina: Math.round(povrsina * 100) / 100 };
          sObrisom++;
        }
      }
    });
  });

  fs.writeFileSync(INDEKS_PATH, JSON.stringify(indeks, null, 2));
  console.log(`Gotovo. Indeks sadrzi ${sObrisom} / ${ukupno} zgrada (ostale nemaju obris - relacije ili nedostupna geometrija).`);
  console.log(`Spremljeno u: ${INDEKS_PATH}`);
}

main();
