// Microsoftovi obrisi zgrada kao OFFLINE negativni filtar.
//
// Zasto: Solar API odgovori u ~25% slucajeva i naplacuje se. Microsoftov skup
// se skine jednom, radi lokalno, pokriva sve kandidate i ne kosta nista.
// Logika je ista - ako MS ima zgradu na toj lokaciji, zgrada je postojala u
// vrijeme MS snimaka, dakle kandidat je vjerojatan lazni pozitiv.
//
// VAZNO: globalni MS skup nema datum snimke po zgradi. Znamo da je zgrada
// postojala "prije izdanja", ali ne kad. Zato ovo NIJE dokaz starosti nego
// jak indicij - stvarnu starost skupa treba izmjeriti empirijski (vidi
// scripts/proba-ms-obrisi.js i usporedbu s DOF-om 2023/24).
//
// Licenca MS podataka: CDLA Permissive 2.0 (dopusta komercijalnu upotrebu).
//
// Koristenje:
//   const { ucitajIndeks, provjeriKandidata } = require('./lib/ms-indeks');
//   const indeks = await ucitajIndeks();            // skine sto fali, cita cache
//   const nalaz = provjeriKandidata(indeks, lat, lon, obris);

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Izdanje Microsoftovog skupa. JEDNO mjesto - i skini-ms-hrvatska.js i
// dgu-ms-detektor.js citaju odavde, da se oznaka izdanja ne razidje izmedju
// preuzetih podataka i presuda donesenih nad njima.
const IZDANJE = '2026-08-13';
const INDEKS_URL = 'https://bfppub.blob.core.windows.net/$web/' + IZDANJE + '/dataset-links.csv';
const CACHE_DIR = path.join(__dirname, '..', '..', 'data', 'ms-obrisi');

const USER_AGENT = require('../zgrade-config').USER_AGENT ||
  'novogradnja2-pipeline/1.0 (kontakt: ea11599 na GitHubu)';

// Tolerancija za prostorno podudaranje. Ista vrijednost kao u
// proba-ms-obrisi.js - MS obris je strojno izveden i cesto malo pomaknut u
// odnosu na rucno crtani OSM obris.
const TOLERANCIJA_M = 8;

// Velicina celije prostornog indeksa u stupnjevima. 0.01 stupnja je ~1.1 km,
// dakle celija drzi nekoliko stotina zgrada - dovoljno sitno da pretraga bude
// brza, dovoljno krupno da indeks ne naraste previse.
const CELIJA = 0.01;

// ---------- geometrija ----------

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
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
  return povrsinaStupnjeva(prsten) * 111320 * mLon;
}

function uPoligonu(tocka, prsten) {
  const [px, py] = tocka;
  let unutra = false;
  for (let i = 0, j = prsten.length - 1; i < prsten.length; j = i++) {
    const [xi, yi] = prsten[i];
    const [xj, yj] = prsten[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      unutra = !unutra;
    }
  }
  return unutra;
}

function udaljenostM(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111320;
  const dLon = (lon2 - lon1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

// Najmanja udaljenost od tocke do ruba poligona.
function udaljenostDoRuba(tocka, prsten) {
  const [px, py] = tocka;
  const mLon = 111320 * Math.cos((py * Math.PI) / 180);
  let najmanja = Infinity;

  for (let i = 0; i < prsten.length; i++) {
    const [x1, y1] = prsten[i];
    const [x2, y2] = prsten[(i + 1) % prsten.length];
    // U metre pa obicna geometrija segmenta.
    const ax = (x1 - px) * mLon, ay = (y1 - py) * 111320;
    const bx = (x2 - px) * mLon, by = (y2 - py) * 111320;
    const dx = bx - ax, dy = by - ay;
    const duljina2 = dx * dx + dy * dy;
    let t = duljina2 === 0 ? 0 : -(ax * dx + ay * dy) / duljina2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy;
    najmanja = Math.min(najmanja, Math.sqrt(qx * qx + qy * qy));
  }
  return najmanja;
}

// IoU - omjer presjeka i unije dvaju poligona, preko rasterizacije mrezom.
// Nije egzaktan kao pravi geometrijski presjek, ali je bez ovisnosti i
// sasvim dovoljan za odluku "ista zgrada ili nije".
function iou(prstenA, prstenB, korakM = 1) {
  const svi = prstenA.concat(prstenB);
  const lats = svi.map(t => t[1]), lons = svi.map(t => t[0]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);

  const srLat = (minLat + maxLat) / 2;
  const korakLat = korakM / 111320;
  const korakLon = korakM / (111320 * Math.cos((srLat * Math.PI) / 180));

  let presjek = 0, unija = 0;
  for (let lat = minLat; lat <= maxLat; lat += korakLat) {
    for (let lon = minLon; lon <= maxLon; lon += korakLon) {
      const a = uPoligonu([lon, lat], prstenA);
      const b = uPoligonu([lon, lat], prstenB);
      if (a && b) presjek++;
      if (a || b) unija++;
    }
  }
  return unija === 0 ? 0 : presjek / unija;
}

// ---------- quadkey ----------

function quadkeyUOkvir(qk) {
  let x = 0, y = 0;
  const razina = qk.length;
  for (let i = 0; i < razina; i++) {
    const maska = 1 << (razina - i - 1);
    switch (qk[i]) {
      case '0': break;
      case '1': x |= maska; break;
      case '2': y |= maska; break;
      case '3': x |= maska; y |= maska; break;
    }
  }
  const n = Math.pow(2, razina);
  const lon1 = (x / n) * 360 - 180;
  const lon2 = ((x + 1) / n) * 360 - 180;
  const lat1 = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat2 = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  return [lon1, Math.min(lat1, lat2), lon2, Math.max(lat1, lat2)];
}

// ---------- preuzimanje ----------

async function skini(url, opis) {
  process.stdout.write('  ' + opis + '... ');
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' za ' + url);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log((buf.length / 1024 / 1024).toFixed(1) + ' MB');
  return buf;
}

// Skine popis pocica za Hrvatsku iz Microsoftove indeksne tablice.
async function popisPlocica() {
  const csv = (await skini(INDEKS_URL, 'indeksna tablica')).toString('utf8');
  return csv.split('\n').slice(1).filter(Boolean)
    .map(r => {
      const d = r.split(',');
      return { lokacija: d[0], quadkey: d[1], url: d[2] && d[2].trim() };
    })
    .filter(r => r.lokacija === 'Croatia' && r.quadkey && r.url);
}

// Skine jednu pocicu i spremi je kao kompaktan JSON u cache. Cuvamo samo ono
// sto nam treba - obris, centar, povrsinu, visinu - da datoteke ostanu male.
async function pripremiPlocicu(p) {
  const putanja = path.join(CACHE_DIR, p.quadkey + '.json');
  if (fs.existsSync(putanja)) return putanja;

  const gz = await skini(p.url, 'pločica ' + p.quadkey);
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

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(putanja, JSON.stringify({ quadkey: p.quadkey, broj: zgrade.length, zgrade }));
  console.log('     spremljeno zgrada: ' + zgrade.length.toLocaleString('hr-HR'));
  return putanja;
}

// ---------- indeks ----------

function kljucCelije(lat, lon) {
  return Math.floor(lat / CELIJA) + ':' + Math.floor(lon / CELIJA);
}

// Ucita pocice u memoriju i izgradi prostorni indeks po celijama.
// okvir (opcionalno): [minLon, minLat, maxLon, maxLat] - ucitaj samo pocice
// koje ga sijeku. Bez njega se ucitava cijela Hrvatska.
async function ucitajIndeks(okvir = null) {
  const sve = await popisPlocica();
  const potrebne = okvir
    ? sve.filter(p => {
        const o = quadkeyUOkvir(p.quadkey);
        return !(o[2] < okvir[0] || o[0] > okvir[2] || o[3] < okvir[1] || o[1] > okvir[3]);
      })
    : sve;

  console.log('  pločica za učitati: ' + potrebne.length + ' (od ukupno ' + sve.length + ' za Hrvatsku)');

  const celije = new Map();
  let ukupno = 0;

  for (const p of potrebne) {
    const putanja = await pripremiPlocicu(p);
    const { zgrade } = JSON.parse(fs.readFileSync(putanja, 'utf8'));
    for (const z of zgrade) {
      const k = kljucCelije(z.c[1], z.c[0]);
      if (!celije.has(k)) celije.set(k, []);
      celije.get(k).push(z);
      ukupno++;
    }
  }

  console.log('  zgrada u indeksu: ' + ukupno.toLocaleString('hr-HR'));
  return { celije, ukupno };
}

// Vrati sve MS zgrade iz celije oko tocke i osam susjednih - zgrada blizu ruba
// celije inace bi promakla.
function kandidatiOko(indeks, lat, lon) {
  const cLat = Math.floor(lat / CELIJA);
  const cLon = Math.floor(lon / CELIJA);
  const rezultat = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const k = (cLat + dy) + ':' + (cLon + dx);
      const lista = indeks.celije.get(k);
      if (lista) rezultat.push(...lista);
    }
  }
  return rezultat;
}

// Glavna provjera. Vraca:
//   { ima: false }                                  - MS nema nista na toj lokaciji
//   { ima: true, kako: 'centar-u-obrisu' | 'blizu', ... }
//
// obris (opcionalno) - ako ga posaljes, racuna se i IoU pa dobijes mjeru
// koliko se dva obrisa stvarno poklapaju, a ne samo da su blizu.
function provjeriKandidata(indeks, lat, lon, obris = null) {
  const blizu = kandidatiOko(indeks, lat, lon);
  if (blizu.length === 0) return { ima: false, pregledano: 0 };

  let najbolji = null;

  for (const z of blizu) {
    const d = udaljenostM(lat, lon, z.c[1], z.c[0]);
    // Gruba predselekcija - preskoci sve dalje od 100 m.
    if (d > 100) continue;

    const unutra = uPoligonu([lon, lat], z.o);
    const doRuba = unutra ? 0 : udaljenostDoRuba([lon, lat], z.o);

    if (!unutra && doRuba > TOLERANCIJA_M) continue;

    const nalaz = {
      kako: unutra ? 'centar-u-obrisu' : 'blizu',
      udaljenostCentara: Math.round(d),
      udaljenostDoRuba: Math.round(doRuba),
      povrsinaMs: z.p,
      visinaMs: z.v,
    };

    if (obris && obris.length >= 3) {
      nalaz.iou = Math.round(iou(obris, z.o) * 100) / 100;
      nalaz.odstupanjePovrsine = Math.round(Math.abs(z.p - povrsinaM2(obris)) / Math.max(1, povrsinaM2(obris)) * 100);
    }

    // Bolji je onaj s vecim IoU, a ako IoU nemamo - onaj blizi.
    if (!najbolji) najbolji = nalaz;
    else if (nalaz.iou !== undefined && najbolji.iou !== undefined) {
      if (nalaz.iou > najbolji.iou) najbolji = nalaz;
    } else if (nalaz.udaljenostCentara < najbolji.udaljenostCentara) {
      najbolji = nalaz;
    }
  }

  if (!najbolji) return { ima: false, pregledano: blizu.length };
  return { ima: true, pregledano: blizu.length, ...najbolji };
}

// Stabilan sinteticki ID iz geometrije. Ne oslanja se ni na koji vanjski
// registar, postoji od prve detekcije, i prezivi izmedju MS izdanja dok se
// centroid ne pomakne vise od ~1 m. DGU adresa je ATRIBUT, ne identitet -
// jer nove zgrade jos nemaju kucni broj, a jedna zgrada moze imati vise
// adresa (bas taj slucaj zelimo uhvatiti kao "kuca postala zgrada").
function stabilanId(lat, lon) {
  // 5 decimala ~ 1.1 m na ovoj sirini.
  return 'geo/' + lat.toFixed(5) + '_' + lon.toFixed(5);
}

module.exports = {
  ucitajIndeks,
  provjeriKandidata,
  stabilanId,
  IZDANJE,
  INDEKS_URL,
  // izlozeno za testove i druge skripte
  iou,
  uPoligonu,
  povrsinaM2,
  udaljenostM,
  quadkeyUOkvir,
  TOLERANCIJA_M,
};
