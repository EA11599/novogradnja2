#!/usr/bin/env node
//
// TESTNA skripta - Google Solar API (buildingInsights) nad postojecim kandidatima.
//
// Svrha nije verifikacija nego MJERENJE ISPLATIVOSTI: koliko nasih kandidata
// Google uopce prepoznaje kao zgradu, koliko su stare njegove snimke, i slaze
// li se njegova povrsina s onom koju racunamo iz OSM obrisa.
//
// Nista ne mijenja u podacima - samo cita i ispisuje izvjestaj.
//
// Koristenje:
//   set GOOGLE_MAPS_API_KEY=...           (Windows CMD)
//   $env:GOOGLE_MAPS_API_KEY="..."        (PowerShell)
//   node scripts/test-solar-api.js
//   node scripts/test-solar-api.js --broj 50 --kvaliteta HIGH
//
// Zastave:
//   --broj N          koliko kandidata testirati (zadano 20)
//   --kvaliteta Q     BASE | MEDIUM | HIGH (zadano BASE = najvise pogodaka)
//   --izlaz put.json  gdje spremiti puni izvjestaj (zadano solar-test-rezultat.json)
//   --pauza MS        razmak izmedju poziva (zadano 200)
//   --nasumicno       uzmi nasumican uzorak razbacan po svim datotekama i
//                     zupanijama umjesto prvih N iz najnovije datoteke
//   --kontrola        KONTROLNA SKUPINA: umjesto kandidata koristi DGU adrese
//                     (postojece kuce sa sluzbenom adresom - zgrada sigurno
//                     postoji). Ako Google ni njih ne prepoznaje, problem nije
//                     u nasim podacima nego u njegovoj pokrivenosti Hrvatske.

const fs = require('fs');
const path = require('path');
const { povrsinaPoligona } = require('./lib/geometrija');

const KLJUC = process.env.GOOGLE_MAPS_API_KEY;
const DIR_ZGRADE = path.join(__dirname, '..', 'data', 'zgrade');

// ---------- argumenti ----------

function zastava(ime, zadano) {
  const i = process.argv.indexOf('--' + ime);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : zadano;
}

const BROJ = parseInt(zastava('broj', '20'), 10);
const KVALITETA = zastava('kvaliteta', 'BASE').toUpperCase();
const IZLAZ = zastava('izlaz', 'solar-test-rezultat.json');
const PAUZA = parseInt(zastava('pauza', '200'), 10);
const NASUMICNO = process.argv.includes('--nasumicno');
const KONTROLA = process.argv.includes('--kontrola');

const DIR_DGU = path.join(__dirname, '..', 'data', 'dgu-adrese');

// Fisher-Yates mijesanje.
function promijesaj(niz) {
  for (let i = niz.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [niz[i], niz[j]] = [niz[j], niz[i]];
  }
  return niz;
}

// ---------- ucitavanje kandidata ----------

// Uzimamo iz najnovijih tjednih datoteka unatrag, jer nas zanimaju kandidati
// koje bi korisnik stvarno gledao u aplikaciji.
function ucitajKandidate(koliko) {
  if (!fs.existsSync(DIR_ZGRADE)) {
    throw new Error('Ne postoji ' + DIR_ZGRADE + ' - pokreni iz korijena repozitorija.');
  }

  const datoteke = fs.readdirSync(DIR_ZGRADE)
    .filter(f => f.startsWith('novo-') && f.endsWith('.json'))
    .sort()
    .reverse();

  // Nasumicni nacin: skupi SVE kandidate pa promijesaj. Bez toga uzimamo
  // uzastopne zapise iz jedne datoteke, a oni cesto dolaze iz jedne mapperske
  // sesije na jednoj lokaciji - uzorak tada mjeri jedno naselje, ne Hrvatsku.
  const sviKandidati = [];
  for (const datoteka of datoteke) {
    if (!NASUMICNO && sviKandidati.length >= koliko) break;
    let sadrzaj;
    try {
      sadrzaj = JSON.parse(fs.readFileSync(path.join(DIR_ZGRADE, datoteka), 'utf8'));
    } catch (err) {
      console.warn('  preskacem ' + datoteka + ' (' + err.message + ')');
      continue;
    }
    for (const f of (sadrzaj.features || [])) {
      if (!NASUMICNO && sviKandidati.length >= koliko) break;
      if (typeof f.lat !== 'number' || typeof f.lon !== 'number') continue;
      sviKandidati.push({ ...f, _datoteka: datoteka });
    }
  }

  if (!NASUMICNO) return sviKandidati.slice(0, koliko);

  // Ravnomjerno po zupanijama: uzmi redom po jednu iz svake, pa opet u krug.
  const poZupaniji = {};
  for (const k of sviKandidati) {
    const z = k.zupanija || 'nepoznato';
    (poZupaniji[z] = poZupaniji[z] || []).push(k);
  }
  for (const z of Object.keys(poZupaniji)) promijesaj(poZupaniji[z]);

  const zupanije = promijesaj(Object.keys(poZupaniji));
  const odabir = [];
  let krug = 0;
  while (odabir.length < koliko && krug < 1000) {
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

// KONTROLNA SKUPINA: nasumicne DGU adrese. Svaka ima sluzbeni kucni broj,
// dakle na toj lokaciji gotovo sigurno stoji zgrada - i to zgrada starija od
// nasih kandidata. Ovo mjeri cistu Googleovu pokrivenost, bez utjecaja
// kvalitete nasih podataka.
function ucitajKontrolu(koliko) {
  if (!fs.existsSync(DIR_DGU)) {
    throw new Error('Ne postoji ' + DIR_DGU + ' - kontrolni nacin nije moguc.');
  }

  const datoteke = promijesaj(fs.readdirSync(DIR_DGU).filter(f => f.endsWith('.geojson')));
  const odabir = [];

  // Iz svake zupanije uzmi otprilike jednak broj, dok ne skupimo dovoljno.
  const poDatoteci = Math.max(1, Math.ceil(koliko / datoteke.length));

  for (const datoteka of datoteke) {
    if (odabir.length >= koliko) break;
    let sadrzaj;
    try {
      sadrzaj = JSON.parse(fs.readFileSync(path.join(DIR_DGU, datoteka), 'utf8'));
    } catch (err) {
      console.warn('  preskacem ' + datoteka + ' (' + err.message + ')');
      continue;
    }
    const znacajke = sadrzaj.features || [];
    if (!znacajke.length) continue;

    for (let i = 0; i < poDatoteci && odabir.length < koliko; i++) {
      const f = znacajke[Math.floor(Math.random() * znacajke.length)];
      const koord = f.geometry && f.geometry.coordinates;
      if (!koord || typeof koord[0] !== 'number') continue;
      const p = f.properties || {};
      odabir.push({
        id: 'dgu/' + (p.street || '?') + ' ' + (p.houseNumber || '?'),
        lat: koord[1],
        lon: koord[0],
        zupanija: datoteka.replace('.geojson', ''),
        obris: null,
        validFrom: null,
        _datoteka: datoteka,
      });
    }
  }
  return odabir;
}

// ---------- Solar API ----------

async function dohvatiSolar(lat, lon) {
  const url = 'https://solar.googleapis.com/v1/buildingInsights:findClosest'
    + '?location.latitude=' + lat
    + '&location.longitude=' + lon
    + '&requiredQuality=' + KVALITETA
    + '&key=' + KLJUC;

  const odgovor = await fetch(url);

  // 404 nije greska nego rezultat: Google nema zgradu na toj lokaciji.
  if (odgovor.status === 404) return { nadjeno: false, razlog: 'NEMA_ZGRADE' };

  if (!odgovor.ok) {
    const tekst = await odgovor.text();
    return { nadjeno: false, razlog: 'HTTP_' + odgovor.status, detalj: tekst.slice(0, 200) };
  }

  return { nadjeno: true, podaci: await odgovor.json() };
}

// Udaljenost u metrima izmedju dvije tocke (dovoljno precizno na ovim skalama).
function udaljenostMetri(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111320;
  const dLon = (lon2 - lon1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function formatirajDatum(d) {
  if (!d || !d.year) return '-';
  return String(d.day).padStart(2, '0') + '.' + String(d.month).padStart(2, '0') + '.' + d.year;
}

// ---------- glavni tok ----------

async function glavna() {
  if (!KLJUC) {
    console.error('GRESKA: nedostaje GOOGLE_MAPS_API_KEY u okruzenju.');
    console.error('PowerShell:  $env:GOOGLE_MAPS_API_KEY="tvoj-kljuc"');
    process.exit(1);
  }

  const kandidati = KONTROLA ? ucitajKontrolu(BROJ) : ucitajKandidate(BROJ);

  const nacin = KONTROLA
    ? 'KONTROLA (DGU adrese - postojece zgrade)'
    : (NASUMICNO ? 'nasumicni uzorak kandidata' : 'prvih N kandidata');
  console.log('Nacin: ' + nacin);
  console.log('Ucitano: ' + kandidati.length + ' | kvaliteta: ' + KVALITETA);

  const brojZupanija = new Set(kandidati.map(k => k.zupanija || '?')).size;
  console.log('Razlicitih zupanija u uzorku: ' + brojZupanija + '\n');

  const rezultati = [];

  for (let i = 0; i < kandidati.length; i++) {
    const k = kandidati[i];
    const povrsinaOsm = k.obris ? povrsinaPoligona(k.obris) : null;

    let red = {
      id: k.id,
      lat: k.lat,
      lon: k.lon,
      zupanija: k.zupanija || null,
      validFrom: k.validFrom || null,
      povrsinaOsm: povrsinaOsm !== null ? Math.round(povrsinaOsm) : null,
      nasStatus: k.satelitProvjera ? k.satelitProvjera.status : null,
    };

    try {
      const odg = await dohvatiSolar(k.lat, k.lon);

      if (!odg.nadjeno) {
        red.googleNasao = false;
        red.razlog = odg.razlog;
        if (odg.detalj) red.detalj = odg.detalj;
      } else {
        const p = odg.podaci;
        const sp = p.solarPotential || {};
        const povrsinaGoogle = sp.wholeRoofStats ? sp.wholeRoofStats.groundAreaMeters2 : null;

        red.googleNasao = true;
        red.imageryDate = p.imageryDate || null;
        red.imageryQuality = p.imageryQuality || null;
        red.povrsinaGoogle = povrsinaGoogle !== null ? Math.round(povrsinaGoogle) : null;
        red.udaljenostM = p.center
          ? Math.round(udaljenostMetri(k.lat, k.lon, p.center.latitude, p.center.longitude))
          : null;

        // Slaze li se povrsina? Koristimo isti prag od 25% kao i za prosirenja.
        if (povrsinaOsm && povrsinaGoogle) {
          const odstupanje = Math.abs(povrsinaGoogle - povrsinaOsm) / povrsinaOsm;
          red.odstupanjePovrsine = Math.round(odstupanje * 100);
        }

        // Kljucni zakljucak: je li Googleova snimka starija od naseg OSM unosa?
        // Ako jest, a zgrada je vec vidljiva - vjerojatno nije nova gradnja
        // nego stara zgrada koju je netko tek sad ucrtao u OSM.
        if (p.imageryDate && k.validFrom) {
          const snimka = new Date(p.imageryDate.year, p.imageryDate.month - 1, p.imageryDate.day);
          const unos = new Date(k.validFrom);
          red.snimkaStarijaOdUnosa = snimka < unos;
          red.razlikaDana = Math.round((unos - snimka) / 86400000);
        }
      }
    } catch (err) {
      red.googleNasao = false;
      red.razlog = 'IZNIMKA';
      red.detalj = err.message;
    }

    rezultati.push(red);

    const oznaka = red.googleNasao
      ? 'DA   snimka ' + formatirajDatum(red.imageryDate)
        + ' | ' + (red.imageryQuality || '?')
        + ' | OSM ' + (red.povrsinaOsm !== null ? red.povrsinaOsm + 'm2' : '?')
        + ' vs Google ' + (red.povrsinaGoogle !== null ? red.povrsinaGoogle + 'm2' : '?')
        + ' | udalj ' + (red.udaljenostM !== null ? red.udaljenostM + 'm' : '?')
      : 'NE   ' + red.razlog;

    console.log(String(i + 1).padStart(3) + '. ' + k.id.padEnd(18) + ' ' + oznaka);

    if (PAUZA > 0 && i < kandidati.length - 1) {
      await new Promise(r => setTimeout(r, PAUZA));
    }
  }

  // ---------- sazetak ----------

  const nadjeni = rezultati.filter(r => r.googleNasao);
  const nenadjeni = rezultati.filter(r => !r.googleNasao);
  const greske = nenadjeni.filter(r => r.razlog !== 'NEMA_ZGRADE');
  const sSnimkom = nadjeni.filter(r => r.imageryDate);

  console.log('\n' + '='.repeat(60));
  console.log('SAZETAK (' + rezultati.length + ' kandidata)');
  console.log('='.repeat(60));
  console.log('Google prepoznao zgradu:    ' + nadjeni.length
    + ' (' + Math.round((nadjeni.length / rezultati.length) * 100) + '%)');
  console.log('Google nema zgradu:         ' + (nenadjeni.length - greske.length));
  if (greske.length) {
    console.log('Greske (API/kvota/kljuc):   ' + greske.length
      + '  -> ' + [...new Set(greske.map(g => g.razlog))].join(', '));
  }

  if (sSnimkom.length) {
    const godine = {};
    for (const r of sSnimkom) {
      godine[r.imageryDate.year] = (godine[r.imageryDate.year] || 0) + 1;
    }
    console.log('\nGodine snimaka:');
    for (const g of Object.keys(godine).sort()) {
      console.log('  ' + g + ': ' + godine[g]);
    }

    const kvalitete = {};
    for (const r of nadjeni) {
      const q = r.imageryQuality || 'nepoznato';
      kvalitete[q] = (kvalitete[q] || 0) + 1;
    }
    console.log('\nKvaliteta snimke: '
      + Object.entries(kvalitete).map(([k, v]) => k + '=' + v).join(', '));

    const starije = sSnimkom.filter(r => r.snimkaStarijaOdUnosa === true);
    console.log('\nSnimka starija od OSM unosa: ' + starije.length + '/' + sSnimkom.length);
    console.log('  -> to su kandidati kod kojih Google VEC vidi zgradu, a mi je');
    console.log('     tek sad primjecujemo. Vjerojatni lazni pozitivi.');
  }

  const sPovrsinom = nadjeni.filter(r => typeof r.odstupanjePovrsine === 'number');
  if (sPovrsinom.length) {
    const slazu = sPovrsinom.filter(r => r.odstupanjePovrsine <= 25);
    const medijan = sPovrsinom.map(r => r.odstupanjePovrsine).sort((a, b) => a - b)[Math.floor(sPovrsinom.length / 2)];
    console.log('\nPoklapanje povrsine (OSM vs Google):');
    console.log('  unutar 25%: ' + slazu.length + '/' + sPovrsinom.length
      + ' | medijan odstupanja: ' + medijan + '%');
  }

  fs.writeFileSync(IZLAZ, JSON.stringify({
    pokrenuto: new Date().toISOString(),
    kvaliteta: KVALITETA,
    ukupno: rezultati.length,
    prepoznato: nadjeni.length,
    rezultati,
  }, null, 2));

  console.log('\nPuni izvjestaj: ' + IZLAZ);
}

glavna().catch(err => {
  console.error('\nPad skripte: ' + err.message);
  process.exit(1);
});
