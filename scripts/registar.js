#!/usr/bin/env node
//
// ZBIRNI REGISTAR KANDIDATA NOVOGRADNJE.
//
// Sto rjesava: dgu-ms-detektor.js pise zasebnu datoteku po datumu, pa je svaki
// tjedan otok za sebe. Registar je JEDNA lista kroz vrijeme, kljucirana po
// idStabilan (sinteticki kljuc iz centroida, ~1 m preciznosti).
//
// ---------------------------------------------------------------------------
// ZASTO SE PRESUDA ZAMRZAVA
// ---------------------------------------------------------------------------
// Presuda "novogradnja" znaci: na dan detekcije Microsoft (snimke 2014.-2024.)
// nije imao zgradu na toj lokaciji, a DGU je dodijelio kucni broj.
//
// Kad Microsoft jednom osvjezi hrvatske pocice i uhvati zgradu sagradjenu
// 2025., ista bi lokacija pri ponovnom racunanju ispala kao "legalizacija" -
// jer MS je sad ima. A ona JE bila novogradnja. Presuda je izjava o stanju u
// TRENUTKU DETEKCIJE i zato se nikad ne prepisuje.
//
// Registar to provodi tvrdo: postojeci zapis se ne dira. Ako ponovno
// pokretanje donese drukciju presudu za isti idStabilan, to se zabiljezi u
// polje "napomeneSustava" i prijavi u ispisu, ali izvorna presuda ostaje.
// ---------------------------------------------------------------------------
//
// Rucna potvrda: polje "provjera" mijenja se rucno ili drugom skriptom, i
// registar ga NIKAD ne prepisuje.
//   provjera.status: null | "potvrdjeno" | "odbaceno" | "za-provjeru"
//
// Koristenje:
//   node scripts/registar.js                      unesi sve iz data/novogradnja/
//   node scripts/registar.js --datum 2026-08-18   unesi samo taj datum
//   node scripts/registar.js --pregled            samo ispisi stanje
//   node scripts/registar.js --izvoz csv          izvezi u registar.csv
//   node scripts/registar.js --oznaci geo/45.6_16.9 --status odbaceno --biljeska "vidi se na DOF-u"

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const NOVOGRADNJA_DIR = path.join(REPO_ROOT, 'data', 'novogradnja');
const REGISTAR_PATH = path.join(REPO_ROOT, 'data', 'registar-novogradnje.json');

function zastava(ime, zadano) {
  const i = process.argv.indexOf('--' + ime);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : zadano;
}

function ucitajRegistar() {
  if (!fs.existsSync(REGISTAR_PATH)) {
    return { verzija: 1, azurirano: null, zapisi: {} };
  }
  return JSON.parse(fs.readFileSync(REGISTAR_PATH, 'utf8'));
}

function spremiRegistar(reg) {
  reg.azurirano = new Date().toISOString();
  fs.mkdirSync(path.dirname(REGISTAR_PATH), { recursive: true });
  fs.writeFileSync(REGISTAR_PATH, JSON.stringify(reg, null, 2));
}

// ---------- rucno oznacavanje ----------

function oznaci(reg) {
  const id = zastava('oznaci', null);
  const status = zastava('status', null);
  const biljeska = zastava('biljeska', '');

  const dopusteni = ['potvrdjeno', 'odbaceno', 'za-provjeru'];
  if (!dopusteni.includes(status)) {
    console.error('--status mora biti jedan od: ' + dopusteni.join(', '));
    process.exit(1);
  }
  const zapis = reg.zapisi[id];
  if (!zapis) {
    console.error('Nema zapisa s idStabilan = ' + id);
    process.exit(1);
  }

  zapis.provjera = {
    status,
    biljeska,
    kada: new Date().toISOString(),
  };
  spremiRegistar(reg);
  console.log('Označeno: ' + id + ' -> ' + status);
  console.log('  ' + zapis.adresa + ', ' + (zapis.naselje || ''));
}

// ---------- unos ----------

function unesi(reg) {
  const samoDatum = zastava('datum', null);

  if (!fs.existsSync(NOVOGRADNJA_DIR)) {
    throw new Error('Ne postoji ' + NOVOGRADNJA_DIR + ' - pokreni prvo dgu-ms-detektor.js');
  }

  const datoteke = fs.readdirSync(NOVOGRADNJA_DIR)
    .filter(f => f.startsWith('novogradnja-') && f.endsWith('.json'))
    .filter(f => !samoDatum || f === 'novogradnja-' + samoDatum + '.json')
    .sort();

  if (!datoteke.length) throw new Error('Nema datoteka za unos.');

  let novih = 0, postojecih = 0;
  const sukobi = [];

  for (const datoteka of datoteke) {
    const d = JSON.parse(fs.readFileSync(path.join(NOVOGRADNJA_DIR, datoteka), 'utf8'));

    // U registar ulaze OBJE kategorije - i legalizacije su korisna povijest,
    // samo se drukcije filtriraju pri ispisu.
    const sve = [
      ...(d.novogradnja || []).map(z => ({ ...z, presuda: 'novogradnja' })),
      ...(d.legalizacija || []).map(z => ({ ...z, presuda: 'legalizacija' })),
    ];

    for (const z of sve) {
      const postojeci = reg.zapisi[z.idStabilan];

      if (postojeci) {
        postojecih++;
        // ZAMRZNUTO: presuda se ne prepisuje. Samo biljezimo neslaganje.
        if (postojeci.presuda !== z.presuda) {
          const novoIzdanje = z.msIzdanje || d.msIzdanje || '?';
          const napomena = 'Ponovno računanje ' + d.datum + ' (MS izdanje ' + novoIzdanje
            + ') dalo je "' + z.presuda + '"; izvorna presuda od ' + postojeci.prvoDetektirano
            + ' (MS izdanje ' + (postojeci.msIzdanje || '?') + ') ostaje "' + postojeci.presuda + '".';
          postojeci.napomeneSustava = postojeci.napomeneSustava || [];
          if (!postojeci.napomeneSustava.includes(napomena)) {
            postojeci.napomeneSustava.push(napomena);
            sukobi.push({
              id: z.idStabilan, adresa: z.adresa,
              staro: postojeci.presuda, novo: z.presuda,
              staroIzdanje: postojeci.msIzdanje || '?', novoIzdanje,
            });
          }
        }
        // Datum zadnjeg vidjenja smijemo osvjeziti - to nije presuda.
        postojeci.zadnjePotvrdjeno = d.datum;
        continue;
      }

      novih++;
      reg.zapisi[z.idStabilan] = {
        idStabilan: z.idStabilan,
        lat: z.lat,
        lon: z.lon,
        adresa: z.adresa,
        naselje: z.naselje || null,
        grad: z.grad || null,
        postanskiBroj: z.postanskiBroj || null,

        // --- zamrznuto u trenutku detekcije ---
        presuda: z.presuda,
        prvoDetektirano: d.datum,          // datum DGU delte u kojoj se adresa prvi put pojavila
        uneseno: new Date().toISOString(), // kad je registar zapis stvorio
        msIzdanje: z.msIzdanje || d.msIzdanje || null, // na kojem izdanju MS-a presuda pociva
        obrazlozenje: z.obrazlozenje,
        msNalaz: z.ms,
        izvorDatoteka: datoteka,

        // --- mijenja se ---
        zadnjePotvrdjeno: d.datum,
        provjera: { status: null, biljeska: '', kada: null },
        napomeneSustava: [],
      };
    }
  }

  spremiRegistar(reg);

  console.log('Obrađeno datoteka: ' + datoteke.length);
  console.log('Novih zapisa:      ' + novih);
  console.log('Već postojalo:     ' + postojecih + ' (presuda netaknuta)');

  if (sukobi.length) {
    console.log('\nNESLAGANJE PRESUDA (' + sukobi.length + ') - izvorna zadržana:');
    for (const s of sukobi.slice(0, 10)) {
      console.log('  ' + s.adresa + ': bilo "' + s.staro + '" (' + s.staroIzdanje
        + '), sad bi bilo "' + s.novo + '" (' + s.novoIzdanje + ')');
    }
    console.log('  Ovo je očekivano ako je Microsoft u međuvremenu osvježio pločice.');
  }
}

// ---------- pregled ----------

function pregled(reg) {
  const zapisi = Object.values(reg.zapisi);
  if (!zapisi.length) {
    console.log('Registar je prazan.');
    return;
  }

  const nov = zapisi.filter(z => z.presuda === 'novogradnja');
  const leg = zapisi.filter(z => z.presuda === 'legalizacija');

  console.log('='.repeat(60));
  console.log('REGISTAR (ažurirano ' + (reg.azurirano || '-') + ')');
  console.log('='.repeat(60));
  console.log('Ukupno zapisa:  ' + zapisi.length);
  console.log('  novogradnja:  ' + nov.length);
  console.log('  legalizacija: ' + leg.length);

  const brojPo = (lista, kljuc) => {
    const m = {};
    for (const z of lista) m[z[kljuc] || '-'] = (m[z[kljuc] || '-'] || 0) + 1;
    return m;
  };

  console.log('\nStatus ručne provjere (samo novogradnja):');
  const st = brojPo(nov.map(z => ({ s: z.provjera.status || 'neprovjereno' })), 's');
  for (const [k, v] of Object.entries(st)) console.log('  ' + k.padEnd(14) + v);

  console.log('\nPo datumu detekcije:');
  const po = brojPo(nov, 'prvoDetektirano');
  for (const k of Object.keys(po).sort()) console.log('  ' + k + '  ' + po[k]);

  console.log('\nPo izdanju Microsofta na kojem presuda počiva:');
  const izd = brojPo(nov, 'msIzdanje');
  for (const k of Object.keys(izd).sort()) console.log('  ' + k + '  ' + izd[k]);

  const zaProvjeru = nov.filter(z => !z.provjera.status);
  if (zaProvjeru.length) {
    console.log('\nNeprovjereno (prvih 15):');
    for (const z of zaProvjeru.slice(0, 15)) {
      console.log('  ' + z.idStabilan.padEnd(24) + ' ' + (z.adresa + ',').padEnd(34)
        + ' ' + (z.naselje || '') + '  https://www.google.com/maps?q=' + z.lat + ',' + z.lon);
    }
    if (zaProvjeru.length > 15) console.log('  ... i još ' + (zaProvjeru.length - 15));
  }
}

// ---------- izvoz ----------

function izvoz(reg) {
  const zapisi = Object.values(reg.zapisi).filter(z => z.presuda === 'novogradnja');
  const polja = ['idStabilan', 'adresa', 'naselje', 'grad', 'postanskiBroj',
    'lat', 'lon', 'prvoDetektirano', 'msIzdanje', 'statusProvjere', 'biljeska', 'karta'];

  const escape = v => {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const redci = [polja.join(';')];
  for (const z of zapisi) {
    redci.push([
      z.idStabilan, z.adresa, z.naselje, z.grad, z.postanskiBroj,
      z.lat, z.lon, z.prvoDetektirano, z.msIzdanje || '',
      z.provjera.status || '', z.provjera.biljeska || '',
      'https://www.google.com/maps?q=' + z.lat + ',' + z.lon,
    ].map(escape).join(';'));
  }

  const put = path.join(REPO_ROOT, 'registar.csv');
  // BOM da Excel na hrvatskom Windowsu ispravno procita dijakritiku.
  fs.writeFileSync(put, '\ufeff' + redci.join('\r\n'), 'utf8');
  console.log('Izvezeno ' + zapisi.length + ' zapisa u registar.csv');
}

// ---------- glavni tok ----------

function glavna() {
  const reg = ucitajRegistar();

  if (process.argv.includes('--oznaci')) return oznaci(reg);
  if (process.argv.includes('--izvoz')) return izvoz(reg);
  if (process.argv.includes('--pregled')) return pregled(reg);

  unesi(reg);
  console.log('');
  pregled(reg);
}

try { glavna(); } catch (err) {
  console.error('\nPad skripte: ' + err.message);
  process.exit(1);
}
