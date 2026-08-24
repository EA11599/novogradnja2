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

  // NADOPUNJUJEMO postojeci indeks umjesto da ga gradimo od nule.
  //
  // ZASTO (bitno, 24.8.2026.): tjedni pipeline azurira povrsine u indeksu kad
  // detektira promjenu obrisa. Datoteke u data/zgrade cuvaju obris kakav je
  // bio kad je zgrada PRVI put zabiljezena i nikad se ne mijenjaju. Da indeks
  // gradimo od nule, vratili bismo te zgrade na staru povrsinu - i pipeline bi
  // sljedeci tjedan ponovno "otkrio" istu promjenu koju je vec zapisao.
  const postojeci = fs.existsSync(INDEKS_PATH)
    ? JSON.parse(fs.readFileSync(INDEKS_PATH, "utf8"))
    : {};
  const indeks = { ...postojeci };
  const bilo = Object.keys(postojeci).length;

  let ukupno = 0, sObrisom = 0, dodano = 0, bezObrisa = 0;

  manifest.entries.forEach((e) => {
    const putanja = path.join(REPO_ROOT, e.file);
    const podaci = JSON.parse(fs.readFileSync(putanja, "utf8"));
    podaci.features.forEach((f) => {
      ukupno++;
      if (f.obris && f.obris.length >= 3) {
        sObrisom++;
        if (indeks[f.id]) return; // vec imamo - ne diramo (mozda je azurirana)
        const povrsina = povrsinaPoligona(f.obris);
        if (povrsina !== null) {
          indeks[f.id] = { povrsina: Math.round(povrsina * 100) / 100 };
          dodano++;
        }
      } else {
        bezObrisa++;
      }
    });
  });

  fs.writeFileSync(INDEKS_PATH, JSON.stringify(indeks, null, 2));
  const sada = Object.keys(indeks).length;
  console.log(`Zgrada u datotekama: ${ukupno} (s obrisom: ${sObrisom}, bez obrisa: ${bezObrisa}).`);
  console.log(`Indeks: ${bilo} -> ${sada} (novo dodano: ${dodano}).`);
  console.log(`Pokrivenost: ${(100 * sada / Math.max(1, ukupno)).toFixed(1)}% pracenih zgrada ima osnovicu za usporedbu.`);
  console.log(`Spremljeno u: ${INDEKS_PATH}`);
}

main();
