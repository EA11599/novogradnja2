#!/usr/bin/env node
//
// Upisuje Microsoftov nalaz u svaki zapis u data/zgrade/novo-*.json.
//
// Bez ovoga sucelje ne moze racunati kompozitnu ocjenu - dokaz 'ms' bi ostao
// 'nepoznato' za sve zgrade. Radi offline nad lokalno preuzetim MS pocicama,
// pa ne kosta nista i moze se pustiti nad cijelom povijescu.
//
// Upisuje polje msProvjera:
//   { ima: true|false, izdanje: '2026-08-13', kako: ..., iou: ..., provjereno: ... }
//
// Presuda se NE prepisuje ako vec postoji za isto izdanje - isti princip kao
// u registru. Zapis nastao pod starijim izdanjem ostaje kakav jest osim ako
// se izricito ne trazi --prepisi.
//
// Pokreni PRIJE ovoga:  node scripts/skini-ms-hrvatska.js
//
// Koristenje:
//   node scripts/backfill-ms-oznaka.js
//   node scripts/backfill-ms-oznaka.js --datoteka novo-2026-08-17.json
//   node scripts/backfill-ms-oznaka.js --prepisi

const fs = require('fs');
const path = require('path');
const { ucitajIndeks, provjeriKandidata, IZDANJE } = require('./lib/ms-indeks');

const REPO_ROOT = path.join(__dirname, '..');
const ZGRADE_DIR = path.join(REPO_ROOT, 'data', 'zgrade');

function zastava(ime, zadano) {
  const i = process.argv.indexOf('--' + ime);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : zadano;
}

const SAMO = zastava('datoteka', null);
const PREPISI = process.argv.includes('--prepisi');

async function glavna() {
  const datoteke = fs.readdirSync(ZGRADE_DIR)
    .filter(f => f.startsWith('novo-') && f.endsWith('.json'))
    .filter(f => !SAMO || f === SAMO)
    .sort();

  if (!datoteke.length) throw new Error('Nema datoteka za obradu.');
  console.log('Datoteka za obradu: ' + datoteke.length + ' | MS izdanje: ' + IZDANJE + '\n');

  // Jedan indeks za sve - gradimo ga jednom nad cijelom Hrvatskom.
  console.log('Gradim MS indeks (cijela Hrvatska)...');
  const indeks = await ucitajIndeks();
  console.log('');

  let ukupno = 0, upisano = 0, preskoceno = 0, imaMs = 0;

  for (const datoteka of datoteke) {
    const putanja = path.join(ZGRADE_DIR, datoteka);
    const sadrzaj = JSON.parse(fs.readFileSync(putanja, 'utf8'));
    const znacajke = sadrzaj.features || [];
    let uOvoj = 0, sMs = 0;

    for (const f of znacajke) {
      ukupno++;
      if (typeof f.lat !== 'number' || typeof f.lon !== 'number') continue;

      if (f.msProvjera && f.msProvjera.izdanje === IZDANJE && !PREPISI) {
        preskoceno++;
        if (f.msProvjera.ima) sMs++;
        continue;
      }

      const nalaz = provjeriKandidata(indeks, f.lat, f.lon, f.obris);
      f.msProvjera = {
        ima: nalaz.ima,
        izdanje: IZDANJE,
        provjereno: new Date().toISOString(),
      };
      if (nalaz.ima) {
        f.msProvjera.kako = nalaz.kako;
        f.msProvjera.udaljenostM = nalaz.udaljenostCentara;
        f.msProvjera.povrsinaMs = nalaz.povrsinaMs;
        if (typeof nalaz.iou === 'number') f.msProvjera.iou = nalaz.iou;
        sMs++;
      }
      uOvoj++;
      upisano++;
    }

    imaMs += sMs;
    fs.writeFileSync(putanja, JSON.stringify(sadrzaj, null, 2));
    console.log(datoteka + ': ' + znacajke.length + ' zapisa, upisano ' + uOvoj
      + ', MS ima ' + sMs + ' (' + Math.round((sMs / Math.max(1, znacajke.length)) * 100) + '%)');
  }

  console.log('\n' + '='.repeat(60));
  console.log('Zapisa ukupno:  ' + ukupno);
  console.log('Upisano:        ' + upisano);
  console.log('Preskočeno:     ' + preskoceno + ' (već imaju nalaz za izdanje ' + IZDANJE + ')');
  console.log('MS ima zgradu:  ' + imaMs + ' (' + Math.round((imaMs / Math.max(1, ukupno)) * 100) + '%)');
  console.log('\nSučelje sada može računati kompozitnu ocjenu.');
}

glavna().catch(err => {
  console.error('\nPad skripte: ' + err.message);
  process.exit(1);
});
