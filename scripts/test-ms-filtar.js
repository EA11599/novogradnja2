#!/usr/bin/env node
//
// Microsoftovi obrisi kao negativni filtar nad nasim kandidatima.
//
// Ista logika kao test-solar-api.js, ali offline i besplatno:
//   - ako MS ima zgradu na lokaciji kandidata, zgrada je postojala u vrijeme
//     MS snimaka -> vjerojatan lazni pozitiv
//   - ako MS nema nista -> kandidat ostaje zanimljiv
//
// Sazetak je namjerno istog oblika kao kod Solar testa da se brojke mogu
// izravno usporediti.
//
// Koristenje:
//   node scripts/test-ms-filtar.js --broj 200
//   node scripts/test-ms-filtar.js --broj 50 --kontrola
//
// Zastave:
//   --broj N          koliko provjeriti (zadano 200)
//   --kontrola        KONTROLA: umjesto kandidata koristi DGU adrese
//                     (postojece kuce). Ocekujemo VISOK postotak - ako ga
//                     nema, MS pokrivenost je losa i filtar ne vrijedi.
//   --izlaz put.json  gdje spremiti izvjestaj (zadano ms-test-rezultat.json)

const fs = require('fs');
const path = require('path');
const { povrsinaPoligona } = require('./lib/geometrija');
const { ucitajIndeks, provjeriKandidata, stabilanId } = require('./lib/ms-indeks');

const DIR_ZGRADE = path.join(__dirname, '..', 'data', 'zgrade');
const DIR_DGU = path.join(__dirname, '..', 'data', 'dgu-adrese');

function zastava(ime, zadano) {
  const i = process.argv.indexOf('--' + ime);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : zadano;
}

const BROJ = parseInt(zastava('broj', '200'), 10);
const IZLAZ = zastava('izlaz', 'ms-test-rezultat.json');
const KONTROLA = process.argv.includes('--kontrola');

function promijesaj(niz) {
  for (let i = niz.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [niz[i], niz[j]] = [niz[j], niz[i]];
  }
  return niz;
}

// ---------- uzorkovanje (ravnomjerno po zupanijama) ----------

function ucitajKandidate(koliko) {
  const datoteke = fs.readdirSync(DIR_ZGRADE)
    .filter(f => f.startsWith('novo-') && f.endsWith('.json'));

  const svi = [];
  for (const datoteka of datoteke) {
    let sadrzaj;
    try {
      sadrzaj = JSON.parse(fs.readFileSync(path.join(DIR_ZGRADE, datoteka), 'utf8'));
    } catch (err) { continue; }
    for (const f of (sadrzaj.features || [])) {
      if (typeof f.lat === 'number' && typeof f.lon === 'number') svi.push(f);
    }
  }

  const poZupaniji = {};
  for (const k of svi) {
    const z = k.zupanija || 'nepoznato';
    (poZupaniji[z] = poZupaniji[z] || []).push(k);
  }
  for (const z of Object.keys(poZupaniji)) promijesaj(poZupaniji[z]);

  const zupanije = promijesaj(Object.keys(poZupaniji));
  const odabir = [];
  let krug = 0;
  while (odabir.length < koliko && krug < 5000) {
    let dodano = false;
    for (const z of zupanije) {
      if (odabir.length >= koliko) break;
      if (poZupaniji[z][krug]) { odabir.push(poZupaniji[z][krug]); dodano = true; }
    }
    if (!dodano) break;
    krug++;
  }
  return odabir;
}

function ucitajKontrolu(koliko) {
  const datoteke = promijesaj(fs.readdirSync(DIR_DGU).filter(f => f.endsWith('.geojson')));
  const odabir = [];
  const poDatoteci = Math.max(1, Math.ceil(koliko / datoteke.length));

  for (const datoteka of datoteke) {
    if (odabir.length >= koliko) break;
    let sadrzaj;
    try {
      sadrzaj = JSON.parse(fs.readFileSync(path.join(DIR_DGU, datoteka), 'utf8'));
    } catch (err) { continue; }
    const znacajke = sadrzaj.features || [];
    if (!znacajke.length) continue;

    for (let i = 0; i < poDatoteci && odabir.length < koliko; i++) {
      const f = znacajke[Math.floor(Math.random() * znacajke.length)];
      const koord = f.geometry && f.geometry.coordinates;
      if (!koord || typeof koord[0] !== 'number') continue;
      const p = f.properties || {};
      odabir.push({
        id: 'dgu/' + (p.street || '?') + ' ' + (p.houseNumber || '?'),
        lat: koord[1], lon: koord[0],
        zupanija: datoteka.replace('.geojson', ''),
        obris: null, validFrom: null,
      });
    }
  }
  return odabir;
}

// ---------- glavni tok ----------

async function glavna() {
  const uzorak = KONTROLA ? ucitajKontrolu(BROJ) : ucitajKandidate(BROJ);
  if (!uzorak.length) throw new Error('Uzorak je prazan - provjeri data/ direktorije.');

  console.log('Nacin: ' + (KONTROLA ? 'KONTROLA (DGU adrese)' : 'kandidati (nasumicno po zupanijama)'));
  console.log('Uzorak: ' + uzorak.length
    + ' | zupanija: ' + new Set(uzorak.map(k => k.zupanija || '?')).size);

  // Ucitaj samo pocice koje pokrivaju uzorak, ne cijelu Hrvatsku.
  const lats = uzorak.map(k => k.lat), lons = uzorak.map(k => k.lon);
  const okvir = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  console.log('\nGradim MS indeks...');
  const indeks = await ucitajIndeks(okvir);

  console.log('\nProvjeravam...');
  const rezultati = [];

  for (const k of uzorak) {
    const povrsinaOsm = k.obris ? Math.round(povrsinaPoligona(k.obris)) : null;
    const nalaz = provjeriKandidata(indeks, k.lat, k.lon, k.obris);

    rezultati.push({
      id: k.id,
      idStabilan: stabilanId(k.lat, k.lon),
      lat: k.lat, lon: k.lon,
      zupanija: k.zupanija || null,
      validFrom: k.validFrom || null,
      povrsinaOsm,
      nasStatus: k.satelitProvjera ? k.satelitProvjera.status : null,
      ms: nalaz,
    });
  }

  // ---------- sazetak ----------

  const ima = rezultati.filter(r => r.ms.ima);
  const post = n => Math.round((n / rezultati.length) * 100);

  console.log('\n' + '='.repeat(60));
  console.log('SAZETAK (' + rezultati.length + ')');
  console.log('='.repeat(60));
  console.log('MS ima zgradu:        ' + ima.length + ' (' + post(ima.length) + '%)');
  console.log('MS nema nista:        ' + (rezultati.length - ima.length));

  const uObrisu = ima.filter(r => r.ms.kako === 'centar-u-obrisu');
  console.log('  od toga u obrisu:   ' + uObrisu.length + ' (ostalo unutar tolerancije)');

  const sIou = ima.filter(r => typeof r.ms.iou === 'number');
  if (sIou.length) {
    const vrijednosti = sIou.map(r => r.ms.iou).sort((a, b) => a - b);
    const medijan = vrijednosti[Math.floor(vrijednosti.length / 2)];
    const dobri = sIou.filter(r => r.ms.iou >= 0.5).length;
    console.log('\nPoklapanje obrisa (IoU):');
    console.log('  IoU >= 0.5:         ' + dobri + '/' + sIou.length + ' (ista zgrada)');
    console.log('  medijan IoU:        ' + medijan.toFixed(2));
  }

  const sVisinom = ima.filter(r => r.ms.visinaMs);
  if (sVisinom.length) {
    const v = sVisinom.map(r => r.ms.visinaMs).sort((a, b) => a - b);
    console.log('\nVisine iz MS-a dostupne za ' + sVisinom.length + '/' + ima.length
      + ' | medijan ' + v[Math.floor(v.length / 2)] + ' m');
    console.log('  -> polazna crta za detekciju "kuca postala zgrada"');
  }

  if (!KONTROLA) {
    const stari = rezultati.filter(r => r.nasStatus === 'stara');
    if (stari.length) {
      const slaganje = stari.filter(r => r.ms.ima).length;
      console.log('\nSlaganje s DGU ortofoto provjerom:');
      console.log('  nas status "stara": ' + stari.length
        + ', od toga MS potvrdio: ' + slaganje
        + ' (' + Math.round((slaganje / stari.length) * 100) + '%)');
    }
  }

  fs.writeFileSync(IZLAZ, JSON.stringify({
    pokrenuto: new Date().toISOString(),
    nacin: KONTROLA ? 'kontrola' : 'kandidati',
    ukupno: rezultati.length,
    prepoznato: ima.length,
    rezultati,
  }, null, 2));

  console.log('\nPuni izvjestaj: ' + IZLAZ);
}

glavna().catch(err => {
  console.error('\nPad skripte: ' + err.message);
  process.exit(1);
});
