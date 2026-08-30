#!/usr/bin/env node
//
// DETEKTOR NOVOGRADNJE: nova DGU adresa x odsutnost u Microsoftu.
//
// Logika, u tri koraka:
//   1. Kucni broj se dodjeljuje NAKON izgradnje, na zahtjev vlasnika.
//   2. Microsoftov skup je izveden iz snimaka 2014.-2024., dakle NE MOZE
//      sadrzavati zgradu sagradjenu 2025. ili kasnije.
//   3. Dakle: nova DGU adresa (2026.) + Microsoft nema nista na toj lokaciji
//      = zgrada sagradjena nakon 2024. koja je sad dobila kucni broj.
//
// Suprotno: nova DGU adresa + Microsoft IMA zgradu = stara kuca koja je tek
// dobila broj (naknadna digitalizacija, legalizacija, podjela na vise adresa).
//
// Prednost nad OSM detekcijom: ne ovisi o tome kad ce netko ucrtati zgradu u
// OSM. Nasa mjerenja pokazuju da OSM pristup ima ~93% laznih pozitiva jer
// mapperi popunjavaju stare zgrade koje OSM nikad nije imao.
//
// Ocekivana pogreska: ~6%, koliko Microsoft promasuje i na sigurno postojecim
// kucama (izmjereno na kontrolnom uzorku DGU adresa: 94/100).
//
// Pokrece se NAKON dgu-nove-adrese.js.
//
// Koristenje:
//   node scripts/dgu-ms-detektor.js
//   node scripts/dgu-ms-detektor.js --datum 2026-08-18
//   node scripts/dgu-ms-detektor.js --strogo        (samo centar-u-obrisu)

const fs = require('fs');
const path = require('path');
const { ucitajIndeks, provjeriKandidata, stabilanId, IZDANJE } = require('./lib/ms-indeks');

const REPO_ROOT = path.join(__dirname, '..');
const NOVE_DIR = path.join(REPO_ROOT, 'data', 'dgu-nove-adrese');
const IZLAZ_DIR = path.join(REPO_ROOT, 'data', 'novogradnja');
const MANIFEST_PATH = path.join(IZLAZ_DIR, 'manifest.json');

function zastava(ime, zadano) {
  const i = process.argv.indexOf('--' + ime);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : zadano;
}

// Strogi nacin trazi da centar adrese padne UNUTAR MS obrisa. Blazi prihvaca
// i pogodak unutar 8 m tolerancije. Mjerenje je pokazalo da je skupina "blizu"
// nepouzdana kod usporedbe obrisa (medijan IoU 0.12 - uglavnom pogodi susjednu
// zgradu), ali kod ADRESNE tocke je drukcije: tocka je cesto na rubu parcele
// ili na ulaznim vratima, pa je tolerancija opravdana. Zadano je blaze, jer
// nas ovdje zanima "postoji li ovdje ista zgrada", ne "je li to bas ta".
const STROGO = process.argv.includes('--strogo');

function nadjiNajnovijuDatoteku() {
  const trazeni = zastava('datum', null);
  if (trazeni) {
    const p = path.join(NOVE_DIR, 'nove-' + trazeni + '.geojson');
    if (!fs.existsSync(p)) throw new Error('Ne postoji ' + p);
    return { putanja: p, datum: trazeni };
  }
  const datoteke = fs.readdirSync(NOVE_DIR)
    .filter(f => f.startsWith('nove-') && f.endsWith('.geojson'))
    .sort();
  if (!datoteke.length) throw new Error('Nema nijedne nove-*.geojson - pokreni prvo dgu-nove-adrese.js');
  const zadnja = datoteke[datoteke.length - 1];
  return {
    putanja: path.join(NOVE_DIR, zadnja),
    datum: zadnja.replace('nove-', '').replace('.geojson', ''),
  };
}

async function glavna() {
  const { putanja, datum } = nadjiNajnovijuDatoteku();
  const ulaz = JSON.parse(fs.readFileSync(putanja, 'utf8'));
  const adrese = ulaz.features || [];

  console.log('Datoteka: ' + path.basename(putanja));
  console.log('Novih DGU adresa: ' + adrese.length);
  console.log('Način: ' + (STROGO ? 'strogo (centar u obrisu)' : 'blago (uklj. 8 m tolerancija)') + '\n');

  if (!adrese.length) {
    console.log('Nema adresa za obraditi.');
    return;
  }

  // Ucitaj samo pocice koje pokrivaju ove adrese.
  const lons = adrese.map(f => f.geometry.coordinates[0]);
  const lats = adrese.map(f => f.geometry.coordinates[1]);
  const okvir = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];

  console.log('Gradim MS indeks...');
  const indeks = await ucitajIndeks(okvir);

  console.log('\nProvjeravam...\n');

  const novogradnja = [];
  const legalizacija = [];

  for (const f of adrese) {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties || {};
    const nalaz = provjeriKandidata(indeks, lat, lon);

    const msPostoji = STROGO
      ? (nalaz.ima && nalaz.kako === 'centar-u-obrisu')
      : nalaz.ima;

    const zapis = {
      idStabilan: stabilanId(lat, lon),
      lat, lon,
      adresa: (p.street || '?') + ' ' + (p.houseNumber || ''),
      naselje: p.settlement || null,
      grad: p.city || null,
      postanskiBroj: p.postcode || null,
      ms: nalaz,
      msIzdanje: IZDANJE,
      presuda: msPostoji ? 'legalizacija' : 'novogradnja',
      obrazlozenje: msPostoji
        ? 'Microsoft (izdanje ' + IZDANJE + ', snimke do 2024.) ima zgradu na ovoj lokaciji - objekt je postojao prije, adresa je naknadno dodijeljena.'
        : 'Microsoft (izdanje ' + IZDANJE + ', snimke do 2024.) nema zgradu na ovoj lokaciji, a adresa je dodijeljena ' + datum + '. - vjerojatno sagrađeno nakon 2024.',
    };

    (msPostoji ? legalizacija : novogradnja).push(zapis);
  }

  // ---------- ispis ----------

  console.log('NOVOGRADNJA (' + novogradnja.length + '):');
  for (const z of novogradnja.slice(0, 25)) {
    console.log('  ' + (z.adresa + ',').padEnd(38) + ' ' + (z.naselje || '')
      + '  https://www.google.com/maps?q=' + z.lat + ',' + z.lon);
  }
  if (novogradnja.length > 25) console.log('  ... i još ' + (novogradnja.length - 25));

  const post = n => Math.round((n / adrese.length) * 100);
  console.log('\n' + '='.repeat(60));
  console.log('SAŽETAK (' + adrese.length + ' novih DGU adresa)');
  console.log('='.repeat(60));
  console.log('Novogradnja:    ' + novogradnja.length + ' (' + post(novogradnja.length) + '%)');
  console.log('Legalizacija:   ' + legalizacija.length + ' (' + post(legalizacija.length) + '%)');
  console.log('\nOčekivana pogreška ~6% (koliko MS promašuje i na postojećim kućama).');

  // ---------- spremanje ----------

  fs.mkdirSync(IZLAZ_DIR, { recursive: true });
  const naziv = 'novogradnja-' + datum + '.json';
  fs.writeFileSync(path.join(IZLAZ_DIR, naziv), JSON.stringify({
    datum,
    izvor: path.basename(putanja),
    msIzdanje: IZDANJE,
    nacin: STROGO ? 'strogo' : 'blago',
    ukupno: adrese.length,
    brojNovogradnja: novogradnja.length,
    brojLegalizacija: legalizacija.length,
    novogradnja,
    legalizacija,
  }, null, 2));

  const manifest = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
    : { entries: [] };
  manifest.entries = manifest.entries.filter(e => e.date !== datum);
  manifest.entries.push({
    date: datum,
    count: novogradnja.length,
    ukupno: adrese.length,
    file: 'data/novogradnja/' + naziv,
  });
  manifest.entries.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log('\nSpremljeno: data/novogradnja/' + naziv);
}

glavna().catch(err => {
  console.error('\nPad skripte: ' + err.message);
  process.exit(1);
});
