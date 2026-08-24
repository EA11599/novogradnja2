// Jednokratna skripta: gradi `data/zgrade/geometrija-indeks.json` iz SVIH
// vec zabiljezenih zgrada (id -> povrsina). Ovo je preduvjet za novu
// funkciju "prosirenja postojecih zgrada" u fetch-zgrade.js - bez ovog
// indeksa pipeline nema s cime usporediti novu geometriju.
//
// Pokrece se rucno, JEDNOM: node scripts/backfill-geometrija-indeks.js

const fs = require("fs");
const path = require("path");
const { povrsinaPoligona, opsegPoligona, brojVrhova, oblikUTekst } = require("./lib/geometrija");

// Iste definicije kao u fetch-zgrade.js - indeks mora imati isti oblik
// zapisa, inace bi tjedna usporedba prijavila lazne promjene.
function brojKatova(tags) {
  const v = (tags || {})["building:levels"];
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function tipZgrade(tags) {
  const v = (tags || {}).building;
  return v ? String(v) : null;
}

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

  let ukupno = 0, sObrisom = 0, dodano = 0, bezObrisa = 0, dopunjenoPolja = 0;

  manifest.entries.forEach((e) => {
    const putanja = path.join(REPO_ROOT, e.file);
    const podaci = JSON.parse(fs.readFileSync(putanja, "utf8"));
    podaci.features.forEach((f) => {
      ukupno++;
      if (f.obris && f.obris.length >= 3) {
        sObrisom++;
        const tags = { ...(f.tags || {}) };
        const jedinica = f.dguBrojJedinica === undefined ? null : f.dguBrojJedinica;
        const dguAdresa = f.dguAdresa
          ? [f.dguAdresa.street, f.dguAdresa.houseNumber].filter(Boolean).join(" ") || null
          : null;

        if (indeks[f.id]) {
          // Zgradu vec pratimo. Povrsinu NE diramo - mozda ju je tjedni
          // pipeline u medjuvremenu azurirao. Polja koja indeks ranije nije
          // pamtio popunjavamo, inace bi prva usporedba bila slijepa za njih.
          let dopunjeno = false;
          if (indeks[f.id].tags === undefined) { indeks[f.id].tags = tags; dopunjeno = true; }
          if (indeks[f.id].jedinica === undefined) { indeks[f.id].jedinica = jedinica; dopunjeno = true; }
          if (indeks[f.id].dguAdresa === undefined) { indeks[f.id].dguAdresa = dguAdresa; dopunjeno = true; }
          if (indeks[f.id].oblik === undefined) {
            // Oblik popunjavamo iz datoteke SAMO ako povrsina u indeksu jos
            // odgovara onoj iz obrisa. Ako je pipeline u medjuvremenu zabiljezio
            // promjenu, obris iz datoteke je zastario i upisao bi lazno stanje.
            const p = povrsinaPoligona(f.obris);
            const istaPovrsina = p !== null && Math.abs(Math.round(p * 100) / 100 - indeks[f.id].povrsina) < 0.01;
            if (istaPovrsina) {
              const o = opsegPoligona(f.obris);
              indeks[f.id].oblik = oblikUTekst(f.obris);
              indeks[f.id].vrhova = brojVrhova(f.obris);
              indeks[f.id].opseg = o === null ? null : Math.round(o * 10) / 10;
              dopunjeno = true;
            }
          }
          // Polja iz ranije verzije indeksa vise se ne koriste - citaju se iz tags.
          delete indeks[f.id].tip;
          delete indeks[f.id].katovi;
          if (dopunjeno) dopunjenoPolja++;
          return;
        }

        const povrsina = povrsinaPoligona(f.obris);
        if (povrsina !== null) {
          const opseg = opsegPoligona(f.obris);
          indeks[f.id] = {
            povrsina: Math.round(povrsina * 100) / 100,
            oblik: oblikUTekst(f.obris),
            vrhova: brojVrhova(f.obris),
            opseg: opseg === null ? null : Math.round(opseg * 10) / 10,
            tags, jedinica, dguAdresa,
          };
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
  console.log(`Indeks: ${bilo} -> ${sada} (novo dodano: ${dodano}, dopunjeno oznakama/DGU podacima: ${dopunjenoPolja}).`);
  console.log(`Pokrivenost: ${(100 * sada / Math.max(1, ukupno)).toFixed(1)}% pracenih zgrada ima osnovicu za usporedbu.`);
  console.log(`Spremljeno u: ${INDEKS_PATH}`);
}

main();
