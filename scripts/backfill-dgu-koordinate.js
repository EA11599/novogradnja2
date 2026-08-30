#!/usr/bin/env node
//
// Dopunjava postojece zapise poljem dguTocke - popisom DGU adresnih tocaka
// unutar obrisa, S KOORDINATAMA.
//
// Zasto: dgu-spajanje.js je dosad spremao samo atribute adrese (ulica, kucni
// broj), bez lon/lat. Bez koordinate se tocka ne moze oznaciti na karti, a
// upravo raspored tocaka unutar jednog obrisa otkriva podjelu objekta na vise
// jedinica - tj. slucaj "kuca postala zgrada".
//
// Ne dira postojeca polja dguAdresa i dguBrojJedinica; samo dodaje dguTocke.
//
// Koristenje:
//   node scripts/backfill-dgu-koordinate.js
//   node scripts/backfill-dgu-koordinate.js --datoteka novo-2026-08-17.json

const fs = require('fs');
const path = require('path');
const { pronadjiSveDguAdrese } = require('./lib/dgu-spajanje');

const ZGRADE_DIR = path.join(__dirname, '..', 'data', 'zgrade');

function zastava(ime, zadano) {
  const i = process.argv.indexOf('--' + ime);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : zadano;
}

const SAMO = zastava('datoteka', null);

function glavna() {
  const datoteke = fs.readdirSync(ZGRADE_DIR)
    .filter(f => f.startsWith('novo-') && f.endsWith('.json'))
    .filter(f => !SAMO || f === SAMO)
    .sort();

  if (!datoteke.length) throw new Error('Nema datoteka za obradu.');
  console.log('Datoteka za obradu: ' + datoteke.length + '\n');

  let ukupno = 0, sTockama = 0, viseJedinica = 0;

  for (const datoteka of datoteke) {
    const putanja = path.join(ZGRADE_DIR, datoteka);
    const sadrzaj = JSON.parse(fs.readFileSync(putanja, 'utf8'));
    const znacajke = sadrzaj.features || [];
    let uOvoj = 0;

    for (const f of znacajke) {
      ukupno++;
      if (!f.obris || f.obris.length < 3) continue;

      const sve = pronadjiSveDguAdrese(f);
      if (!sve.length) continue;

      f.dguTocke = sve.map(a => ({
        street: a.street || null, houseNumber: a.houseNumber || null,
        settlement: a.settlement || null, postcode: a.postcode || null,
        city: a.city || null, lon: a.lon, lat: a.lat,
      }));

      uOvoj++;
      sTockama++;
      if (sve.length > 1) viseJedinica++;
    }

    fs.writeFileSync(putanja, JSON.stringify(sadrzaj, null, 2));
    console.log(datoteka + ': ' + znacajke.length + ' zapisa, s DGU točkama ' + uOvoj);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Zapisa ukupno:        ' + ukupno);
  console.log('S DGU točkama:        ' + sTockama);
  console.log('S više od jedne:      ' + viseJedinica + '  <- kandidati za "kuća postala zgrada"');
}

try { glavna(); } catch (err) {
  console.error('\nPad skripte: ' + err.message);
  process.exit(1);
}
