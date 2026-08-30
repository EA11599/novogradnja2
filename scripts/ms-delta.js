#!/usr/bin/env node
//
// DELTA IZMEDJU DVA MICROSOFTOVA IZDANJA.
//
// Usporedjuje dvije lokalne snimke i vraca:
//   - NOVE zgrade  (poligon postoji u novom izdanju, nema ga u starom)
//   - NESTALE      (bilo u starom, nema u novom - najcesce rusenje ili
//                   ispravak lazne detekcije)
//   - PROSIRENE    (isti objekt, povrsina promijenjena preko praga)
//
// VAZNO O OCEKIVANJIMA: Microsoft izdanja nisu tjedna i ne obnavljaju uvijek
// Hrvatsku. Izdanje 2026-08-13 je osvjezilo 1.945 od 30.340 pocica globalno
// (~6%). Ako hrvatske pocice nisu bile medju njima, delta ce biti prazna -
// to nije kvar nego tocan rezultat.
//
// Kako se cuvaju izdanja: skini-ms-hrvatska.js sprema pocice u
// data/ms-obrisi/<quadkey>.json. Prije preuzimanja NOVOG izdanja preimenuj
// postojeci direktorij, npr:
//   ren data\ms-obrisi data\ms-obrisi-2026-08-13
// pa onda pokreni skini-ms-hrvatska.js za novo izdanje.
//
// Koristenje:
//   node scripts/ms-delta.js --staro data/ms-obrisi-2026-08-13 --novo data/ms-obrisi
//   node scripts/ms-delta.js --staro ... --novo ... --prag 25

const fs = require('fs');
const path = require('path');
const { iou, udaljenostM } = require('./lib/ms-indeks');

const REPO_ROOT = path.join(__dirname, '..');

function zastava(ime, zadano) {
  const i = process.argv.indexOf('--' + ime);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : zadano;
}

const STARO = zastava('staro', null);
const NOVO = zastava('novo', 'data/ms-obrisi');
const PRAG = parseInt(zastava('prag', '25'), 10);
const IZLAZ = zastava('izlaz', 'ms-delta-rezultat.json');

// Ista velicina celije kao u ms-indeks.js - ~1.1 km.
const CELIJA = 0.01;

// Dvije zgrade smatramo istim objektom ako im se obrisi preklapaju preko ovog
// praga. 0.3 je namjerno nisko: Microsoftov detektor izmedju izdanja zna malo
// drukcije povuci rub istog objekta, a i spaja susjedne objekte u jedan
// poligon. Previsok prag bi te varijacije lazno prijavio kao "nova zgrada".
const IOU_ISTI_OBJEKT = 0.3;

function ucitajIzdanje(dir) {
  const puni = path.isAbsolute(dir) ? dir : path.join(REPO_ROOT, dir);
  if (!fs.existsSync(puni)) throw new Error('Ne postoji direktorij ' + puni);

  const datoteke = fs.readdirSync(puni).filter(f => f.endsWith('.json'));
  if (!datoteke.length) throw new Error('Nema .json pločica u ' + puni);

  const celije = new Map();
  let ukupno = 0;
  const quadkeys = [];

  for (const d of datoteke) {
    const sadrzaj = JSON.parse(fs.readFileSync(path.join(puni, d), 'utf8'));
    if (!sadrzaj.zgrade) continue;
    quadkeys.push(sadrzaj.quadkey);
    for (const z of sadrzaj.zgrade) {
      const k = Math.floor(z.c[1] / CELIJA) + ':' + Math.floor(z.c[0] / CELIJA);
      if (!celije.has(k)) celije.set(k, []);
      celije.get(k).push(z);
      ukupno++;
    }
  }
  return { celije, ukupno, quadkeys, dir: puni };
}

// Nadji u drugom izdanju zgradu koja odgovara zadanoj.
function nadjiPar(izdanje, z) {
  const cLat = Math.floor(z.c[1] / CELIJA);
  const cLon = Math.floor(z.c[0] / CELIJA);

  let najbolji = null;
  let najboljiIou = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const lista = izdanje.celije.get((cLat + dy) + ':' + (cLon + dx));
      if (!lista) continue;
      for (const k of lista) {
        // Gruba predselekcija po udaljenosti centara - IoU je skup.
        if (udaljenostM(z.c[1], z.c[0], k.c[1], k.c[0]) > 50) continue;
        const v = iou(z.o, k.o);
        if (v > najboljiIou) { najboljiIou = v; najbolji = k; }
      }
    }
  }

  return najboljiIou >= IOU_ISTI_OBJEKT ? { zgrada: najbolji, iou: najboljiIou } : null;
}

function glavna() {
  if (!STARO) {
    console.error('Nedostaje --staro. Primjer:');
    console.error('  node scripts/ms-delta.js --staro data/ms-obrisi-2026-08-13 --novo data/ms-obrisi');
    process.exit(1);
  }

  console.log('Učitavam staro izdanje...');
  const staro = ucitajIzdanje(STARO);
  console.log('  ' + staro.quadkeys.length + ' pločica, ' + staro.ukupno.toLocaleString('hr-HR') + ' zgrada');

  console.log('Učitavam novo izdanje...');
  const novo = ucitajIzdanje(NOVO);
  console.log('  ' + novo.quadkeys.length + ' pločica, ' + novo.ukupno.toLocaleString('hr-HR') + ' zgrada');

  // Usporedjujemo samo pocice koje postoje u OBA izdanja - inace bi sve
  // zgrade iz pocice koja fali lazno ispale kao "nove" ili "nestale".
  const zajednicke = new Set(staro.quadkeys.filter(q => novo.quadkeys.includes(q)));
  console.log('\nZajedničkih pločica: ' + zajednicke.size);
  if (zajednicke.size === 0) throw new Error('Nema zajedničkih pločica - provjeri direktorije.');

  const nove = [];
  const prosirene = [];
  const nestale = [];

  console.log('\nTražim nove i proširene...');
  let obradjeno = 0;
  for (const [, lista] of novo.celije) {
    for (const z of lista) {
      obradjeno++;
      if (obradjeno % 50000 === 0) process.stdout.write('  ' + obradjeno.toLocaleString('hr-HR') + '\r');

      const par = nadjiPar(staro, z);
      if (!par) {
        nove.push({ lat: z.c[1], lon: z.c[0], povrsina: z.p });
      } else {
        const promjena = (z.p - par.zgrada.p) / Math.max(1, par.zgrada.p);
        if (Math.abs(promjena) * 100 >= PRAG) {
          prosirene.push({
            lat: z.c[1], lon: z.c[0],
            povrsinaStara: par.zgrada.p,
            povrsinaNova: z.p,
            promjenaPostotak: Math.round(promjena * 100),
            iou: Math.round(par.iou * 100) / 100,
          });
        }
      }
    }
  }

  console.log('\nTražim nestale...');
  for (const [, lista] of staro.celije) {
    for (const z of lista) {
      if (!nadjiPar(novo, z)) nestale.push({ lat: z.c[1], lon: z.c[0], povrsina: z.p });
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('DELTA');
  console.log('='.repeat(60));
  console.log('Nove zgrade:    ' + nove.length.toLocaleString('hr-HR'));
  console.log('Proširene:      ' + prosirene.length.toLocaleString('hr-HR') + ' (prag ' + PRAG + '%)');
  console.log('Nestale:        ' + nestale.length.toLocaleString('hr-HR'));

  if (nove.length === 0 && prosirene.length === 0 && nestale.length === 0) {
    console.log('\nSve nula znači da hrvatske pločice nisu bile obnovljene u novom');
    console.log('izdanju. To je točan rezultat, ne kvar.');
  }

  if (nove.length) {
    console.log('\nPrimjeri novih:');
    for (const n of nove.slice(0, 10)) {
      console.log('  ' + n.povrsina + ' m²  https://www.google.com/maps?q=' + n.lat + ',' + n.lon);
    }
  }

  fs.writeFileSync(IZLAZ, JSON.stringify({
    pokrenuto: new Date().toISOString(),
    staro: STARO, novo: NOVO, prag: PRAG,
    zajednickihPlocica: zajednicke.size,
    nove, prosirene, nestale,
  }, null, 2));
  console.log('\nSpremljeno: ' + IZLAZ);
}

try { glavna(); } catch (err) {
  console.error('\nPad skripte: ' + err.message);
  process.exit(1);
}
