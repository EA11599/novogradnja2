#!/usr/bin/env node
//
// Preuzimanje SVIH Microsoftovih pocica zgrada za Hrvatsku.
//
// Uz podatke sprema i SNIMKU indeksne tablice s datumom u imenu. To je bitno:
// Microsoft ne arhivira starije verzije dataset-links.csv - pri selidbi
// hostinga u srpnju 2026. rekli su da se stare verzije nece preseliti. Ako
// snimke ne cuvamo sami, vremenska delta izmedju izdanja nije moguca.
//
// Pokreni jednom sad, pa ponovo nakon svakog Microsoftovog izdanja. Za godinu
// dana imamo vlastitu povijest.
//
// Koristenje:
//   node scripts/skini-ms-hrvatska.js
//   node scripts/skini-ms-hrvatska.js --osvjezi     (ponovo skida i vec spremljene)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPO_ROOT = path.join(__dirname, '..');
const MS_DIR = path.join(REPO_ROOT, 'data', 'ms-obrisi');
const SNIMKE_DIR = path.join(MS_DIR, 'snimke');

// NAPOMENA: ovo je NOVA adresa. Stari minedbuildings.z5.web.core.windows.net
// vise se ne azurira - Microsoft je u srpnju 2026. preselio hosting.
// Oznaka izdanja dolazi iz lib/ms-indeks.js - jedno mjesto za izmjenu kad
// Microsoft objavi novo izdanje.
const { IZDANJE, INDEKS_URL } = require('./lib/ms-indeks');

const USER_AGENT = require('./zgrade-config').USER_AGENT ||
  'novogradnja2-pipeline/1.0 (kontakt: ea11599 na GitHubu)';

const OSVJEZI = process.argv.includes('--osvjezi');

function srediste(prsten) {
  let x = 0, y = 0;
  for (const t of prsten) { x += t[0]; y += t[1]; }
  return [x / prsten.length, y / prsten.length];
}

function povrsinaStupnjeva(prsten) {
  let s = 0;
  for (let i = 0; i < prsten.length; i++) {
    const [x1, y1] = prsten[i];
    const [x2, y2] = prsten[(i + 1) % prsten.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s / 2);
}

function povrsinaM2(prsten) {
  const lat = srediste(prsten)[1];
  return povrsinaStupnjeva(prsten) * 111320 * (111320 * Math.cos((lat * Math.PI) / 180));
}

async function skini(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

async function glavna() {
  fs.mkdirSync(MS_DIR, { recursive: true });
  fs.mkdirSync(SNIMKE_DIR, { recursive: true });

  console.log('Izdanje: ' + IZDANJE);
  process.stdout.write('Preuzimam indeksnu tablicu... ');
  const csvBuf = await skini(INDEKS_URL);
  console.log((csvBuf.length / 1024 / 1024).toFixed(1) + ' MB');

  // Arhiviraj indeks s datumom - ovo je nasa vremenska crta.
  const snimkaPut = path.join(SNIMKE_DIR, 'dataset-links-' + IZDANJE + '.csv');
  if (!fs.existsSync(snimkaPut)) {
    fs.writeFileSync(snimkaPut, csvBuf);
    console.log('Arhivirana snimka indeksa: ' + path.relative(REPO_ROOT, snimkaPut));
  } else {
    console.log('Snimka indeksa za ovo izdanje vec postoji.');
  }

  const redci = csvBuf.toString('utf8').split('\n').slice(1).filter(Boolean);
  const hrvatske = redci
    .map(r => {
      const d = r.split(',');
      return { lokacija: d[0], quadkey: d[1], url: d[2] && d[2].trim() };
    })
    .filter(r => r.lokacija === 'Croatia' && r.quadkey && r.url);

  console.log('\nPločica za Hrvatsku: ' + hrvatske.length + '\n');

  let ukupnoZgrada = 0;
  let preskoceno = 0;

  for (let i = 0; i < hrvatske.length; i++) {
    const p = hrvatske[i];
    const putanja = path.join(MS_DIR, p.quadkey + '.json');
    const redniBroj = '[' + String(i + 1).padStart(2) + '/' + hrvatske.length + ']';

    if (fs.existsSync(putanja) && !OSVJEZI) {
      const { broj } = JSON.parse(fs.readFileSync(putanja, 'utf8'));
      ukupnoZgrada += broj;
      preskoceno++;
      console.log(redniBroj + ' ' + p.quadkey + ' - vec spremljeno (' + broj.toLocaleString('hr-HR') + ')');
      continue;
    }

    process.stdout.write(redniBroj + ' ' + p.quadkey + ' - preuzimam... ');
    const gz = await skini(p.url);
    const tekst = zlib.gunzipSync(gz).toString('utf8');

    const zgrade = [];
    for (const redak of tekst.split('\n')) {
      if (!redak.trim()) continue;
      let f;
      try { f = JSON.parse(redak); } catch (e) { continue; }
      const prsten = f.geometry && f.geometry.coordinates && f.geometry.coordinates[0];
      if (!prsten || prsten.length < 3) continue;
      const c = srediste(prsten);
      zgrade.push({
        o: prsten.map(t => [Number(t[0].toFixed(6)), Number(t[1].toFixed(6))]),
        c: [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))],
        p: Math.round(povrsinaM2(prsten)),
        v: (f.properties && f.properties.height > 0) ? Math.round(f.properties.height * 10) / 10 : null,
      });
    }

    fs.writeFileSync(putanja, JSON.stringify({
      quadkey: p.quadkey, izdanje: IZDANJE, broj: zgrade.length, zgrade,
    }));

    ukupnoZgrada += zgrade.length;
    console.log((gz.length / 1024 / 1024).toFixed(1) + ' MB -> '
      + zgrade.length.toLocaleString('hr-HR') + ' zgrada');
  }

  console.log('\n' + '='.repeat(60));
  console.log('Pločica ukupno:  ' + hrvatske.length + ' (preskočeno jer već postoji: ' + preskoceno + ')');
  console.log('Zgrada ukupno:   ' + ukupnoZgrada.toLocaleString('hr-HR'));
  console.log('Direktorij:      ' + path.relative(REPO_ROOT, MS_DIR));
  console.log('\nPODSJETNIK: dodaj data/ms-obrisi/*.json u .gitignore,');
  console.log('ali NEMOJ ignorirati data/ms-obrisi/snimke/ - to je povijest izdanja.');
}

glavna().catch(err => {
  console.error('\nPad skripte: ' + err.message);
  process.exit(1);
});
