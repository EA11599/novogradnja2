// OBRNUTI TEST: koliko nasih "novih" zgrada Microsoft vec ima na snimkama?
//
// Microsoftovi obrisi izvedeni su iz snimaka 2014.-2024. Ako se zgrada koju
// smo zabiljezili kao NOVU vec nalazi u tom skupu, ona je vidljiva na snimci
// od prije 2024. i sigurno nije novogradnja - netko ju je samo naknadno
// ucrtao u OSM.
//
// Skripta nista ne mijenja u repozitoriju. Rezultat se cita iz loga.
//
// TRAJANJE: pocice za Hrvatsku su oko 20 MB svaka, a nase zgrade su
// raspršene po cijeloj zemlji - racunaj 10 do 20 minuta.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const REPO_ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "data", "zgrade", "manifest.json");
const INDEKS_URL = "https://bfppub.blob.core.windows.net/$web/2026-08-13/dataset-links.csv";
const USER_AGENT = require("./zgrade-config").USER_AGENT ||
  "novogradnja2-pipeline/1.0 (kontakt: ea11599 na GitHubu)";

const CELIJA = 0.001;        // ~110 m, velicina celije prostorne mreze

// Koliki dio obrisa se mora preklapati da bismo rekli "to je ista zgrada".
//
// PRVA VERZIJA OVOG TESTA koristila je udaljenost sredista od 12 m i dala
// besmislen rezultat: svaka skupina zgrada poklapala se 75-89%, dakle mjerilo
// nije razlikovalo nista. Razlog: u hrvatskim naseljima kuce su razmaknute
// osam do deset metara, pa se nasa zgrada uredno "poklapala" sa susjedovom.
//
// Preklapanje povrsina taj problem nema - susjedova kuca se ne preklapa nimalo.
const PRAG_PREKLAPANJA = 0.30;

// Preklapanje racunamo uzorkovanjem: razapnemo mrezu tocaka preko obrisa i
// brojimo koliko ih pada i u drugi obris. Sutherland-Hodgman rezanje bilo bi
// tocnije, ali daje pogresne rezultate na konkavnim oblicima - a 15% nasih
// zgrada ima sedam ili vise uglova, dakle nisu pravokutnici.
const UZORAK = 16; // 16x16 mreza po obrisu

// ---------- Geometrija ----------
function quadkey(lon, lat, razina) {
  const n = Math.pow(2, razina);
  const x = Math.floor(((lon + 180) / 360) * n);
  const s = Math.sin((lat * Math.PI) / 180);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
  let qk = "";
  for (let i = razina; i > 0; i--) {
    let d = 0;
    const m = 1 << (i - 1);
    if ((x & m) !== 0) d += 1;
    if ((y & m) !== 0) d += 2;
    qk += d;
  }
  return qk;
}

function srediste(prsten) {
  let x = 0, y = 0;
  prsten.forEach((t) => { x += t[0]; y += t[1]; });
  return [x / prsten.length, y / prsten.length];
}

function uPoligonu([px, py], prsten) {
  let unutra = false;
  for (let i = 0, j = prsten.length - 1; i < prsten.length; j = i++) {
    const [xi, yi] = prsten[i];
    const [xj, yj] = prsten[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) unutra = !unutra;
  }
  return unutra;
}

function udaljenostM(a, b) {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((a[1] * Math.PI) / 180);
  const dx = (a[0] - b[0]) * mLon;
  const dy = (a[1] - b[1]) * mLat;
  return Math.sqrt(dx * dx + dy * dy);
}

// Udio obrisa A koji pada unutar obrisa B, procijenjen uzorkovanjem.
// Vraca broj izmedju 0 i 1, ili null ako obris A nema upotrebljivu povrsinu.
function udioPreklapanja(a, b) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  a.forEach(([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  });
  const korakX = (maxX - minX) / UZORAK;
  const korakY = (maxY - minY) / UZORAK;
  if (!(korakX > 0) || !(korakY > 0)) return null;

  let uA = 0, uOba = 0;
  for (let i = 0; i < UZORAK; i++) {
    for (let j = 0; j < UZORAK; j++) {
      const t = [minX + (i + 0.5) * korakX, minY + (j + 0.5) * korakY];
      if (!uPoligonu(t, a)) continue;
      uA++;
      if (uPoligonu(t, b)) uOba++;
    }
  }
  return uA === 0 ? null : uOba / uA;
}

function celija(lon, lat) {
  return Math.floor(lon / CELIJA) + ":" + Math.floor(lat / CELIJA);
}

// ---------- Nase zgrade ----------
function ucitajNase() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const zgrade = new Map();
  manifest.entries.forEach((e) => {
    const p = path.join(REPO_ROOT, e.file);
    if (!fs.existsSync(p)) return;
    (JSON.parse(fs.readFileSync(p, "utf8")).features || []).forEach((f) => {
      if (!f.lat || !f.lon || zgrade.has(f.id)) return;
      zgrade.set(f.id, {
        id: f.id,
        centar: [f.lon, f.lat],
        obris: (f.obris && f.obris.length >= 3) ? f.obris : null,
        masovni: !!f.masovniUnos,
        satelit: (f.satelitProvjera || {}).status || null,
        zupanija: f.zupanija || null,
      });
    });
  });
  return [...zgrade.values()];
}

// ---------- Microsoft ----------
async function skini(url, opis) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} za ${opis}`);
  return Buffer.from(await res.arrayBuffer());
}

async function dohvatiPocice() {
  const csv = (await skini(INDEKS_URL, "indeks")).toString("utf8");
  const mapa = new Map();
  csv.split("\n").slice(1).forEach((r) => {
    const d = r.split(",");
    if (d[0] === "Croatia" && d[1] && d[2]) mapa.set(d[1].trim(), d[2].trim());
  });
  return mapa;
}

// ---------- Glavni tok ----------
async function main() {
  console.log("\n=== OBRNUTI TEST: koliko nasih zgrada Microsoft vec ima ===\n");

  const nase = ucitajNase();
  console.log(`Nasih zgrada: ${nase.length.toLocaleString("hr-HR")}`);

  // Grupiraj po Microsoftovoj pocici, da svaku skidamo samo jednom.
  const poPocici = new Map();
  nase.forEach((z) => {
    const qk = quadkey(z.centar[0], z.centar[1], 9);
    if (!poPocici.has(qk)) poPocici.set(qk, []);
    poPocici.get(qk).push(z);
  });
  console.log(`Rasprseno po ${poPocici.size} Microsoftovih pocica.\n`);

  const dostupne = await dohvatiPocice();
  const nadjen = new Set();
  const nadjenBezObrisa = new Set();
  let bezPocice = 0;
  let redniBroj = 0;

  for (const [qk, skupina] of [...poPocici.entries()].sort((a, b) => b[1].length - a[1].length)) {
    redniBroj++;
    const url = dostupne.get(qk);
    if (!url) {
      bezPocice += skupina.length;
      console.log(`  [${redniBroj}/${poPocici.size}] ${qk}: Microsoft nema tu pocicu (${skupina.length} nasih zgrada)`);
      continue;
    }

    // Celije koje nase zgrade zauzimaju - sve ostalo iz pocice odbacujemo
    // odmah, inace bi 245 tisuca poligona po pocici pojelo memoriju.
    const zanimljive = new Set();
    skupina.forEach((z) => {
      const gx = Math.floor(z.centar[0] / CELIJA);
      const gy = Math.floor(z.centar[1] / CELIJA);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) zanimljive.add((gx + dx) + ":" + (gy + dy));
      }
    });

    const gz = await skini(url, `pocica ${qk}`);
    const tekst = zlib.gunzipSync(gz).toString("utf8");

    const msMreza = new Map();
    let ukupno = 0, zadrzano = 0;
    tekst.split("\n").forEach((redak) => {
      if (!redak.trim()) return;
      ukupno++;
      let f;
      try { f = JSON.parse(redak); } catch (e) { return; }
      const prsten = f.geometry && f.geometry.coordinates && f.geometry.coordinates[0];
      if (!prsten || prsten.length < 3) return;
      const c = srediste(prsten);
      const k = celija(c[0], c[1]);
      if (!zanimljive.has(k)) return;
      zadrzano++;
      if (!msMreza.has(k)) msMreza.set(k, []);
      msMreza.get(k).push({ prsten, centar: c });
    });

    let pogodaka = 0;
    skupina.forEach((z) => {
      const gx = Math.floor(z.centar[0] / CELIJA);
      const gy = Math.floor(z.centar[1] / CELIJA);
      const kandidati = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const c = msMreza.get((gx + dx) + ":" + (gy + dy));
          if (c) kandidati.push(...c);
        }
      }

      if (!z.obris) {
        // Bez obrisa mozemo samo pitati pada li nase srediste u njihov obris.
        // Te zgrade drzimo odvojeno da ne kvare glavnu statistiku.
        z.bezObrisa = true;
        if (kandidati.some((ms) => uPoligonu(z.centar, ms.prsten))) {
          nadjenBezObrisa.add(z.id);
          pogodaka++;
        }
        return;
      }

      let najbolje = 0;
      for (const ms of kandidati) {
        // Gledamo oba smjera: mala zgrada moze biti potpuno unutar velike, a
        // da velika njome pokriva tek djelic svoje povrsine.
        const a = udioPreklapanja(z.obris, ms.prsten);
        if (a !== null && a > najbolje) najbolje = a;
        if (najbolje >= PRAG_PREKLAPANJA) break;
        const b = udioPreklapanja(ms.prsten, z.obris);
        if (b !== null && b > najbolje) najbolje = b;
        if (najbolje >= PRAG_PREKLAPANJA) break;
      }
      z.preklapanje = najbolje;
      if (najbolje >= PRAG_PREKLAPANJA) { nadjen.add(z.id); pogodaka++; }
    });

    console.log(`  [${redniBroj}/${poPocici.size}] ${qk}: nasih ${skupina.length}, ` +
      `MS u pocici ${ukupno.toLocaleString("hr-HR")} (zadrzano ${zadrzano.toLocaleString("hr-HR")}), ` +
      `poklapa se ${pogodaka} (${(100 * pogodaka / skupina.length).toFixed(0)}%)`);
  }

  // ---------- Rezultat ----------
  // Glavnu statistiku racunamo SAMO na zgradama koje imaju obris. Onima bez
  // obrisa mozemo mjeriti jedino srediste, sto je slabije mjerilo, pa bi
  // mijesanje to dvoje zamaglilo rezultat.
  const sObrisom = nase.filter((z) => z.obris);
  const ima = sObrisom.filter((z) => nadjen.has(z.id));
  const nema = sObrisom.filter((z) => !nadjen.has(z.id));
  const pct = (n) => (100 * n / Math.max(1, sObrisom.length)).toFixed(1) + "%";

  console.log(`\n${"=".repeat(62)}`);
  console.log(`REZULTAT (mjerilo: preklapanje obrisa >= ${(PRAG_PREKLAPANJA * 100).toFixed(0)}%)\n`);
  console.log(`  Nasih zgrada ukupno:                 ${nase.length.toLocaleString("hr-HR")}`);
  console.log(`  ... od toga s obrisom (mjerljive):   ${sObrisom.length.toLocaleString("hr-HR")}`);
  console.log(`  ... bez obrisa (samo srediste):      ${(nase.length - sObrisom.length).toLocaleString("hr-HR")} ` +
    `- od njih MS ima ${nadjenBezObrisa.size.toLocaleString("hr-HR")}`);
  console.log(``);
  console.log(`  Microsoft ih VEC IMA:                ${ima.length.toLocaleString("hr-HR")}  (${pct(ima.length)})`);
  console.log(`     -> vidljive na snimci do 2024., dakle vjerojatno NISU novogradnja`);
  console.log(`  Microsoft ih NEMA:                   ${nema.length.toLocaleString("hr-HR")}  (${pct(nema.length)})`);
  console.log(`     -> ozbiljni kandidati za pravu novogradnju`);
  if (bezPocice) console.log(`  Bez pokrivenosti pocicom:            ${bezPocice.toLocaleString("hr-HR")}`);

  // Raspodjela preklapanja - ako mjerilo valja, vrijednosti moraju biti
  // skupljene na krajevima (blizu 0 ili blizu 1), a ne razmazane po sredini.
  const kosare = [0, 0, 0, 0, 0];
  sObrisom.forEach((z) => {
    const p = z.preklapanje || 0;
    kosare[Math.min(4, Math.floor(p * 5))]++;
  });
  console.log(`\n  RASPODJELA NAJBOLJEG PREKLAPANJA`);
  ["0-20%", "20-40%", "40-60%", "60-80%", "80-100%"].forEach((ime, i) => {
    const udio = (100 * kosare[i] / sObrisom.length).toFixed(1);
    console.log(`    ${ime.padEnd(8)} ${String(kosare[i]).padStart(6)}  ${udio.padStart(5)}%  ${"#".repeat(Math.round(udio / 2))}`);
  });

  // Slaganje s postojecim signalima - ovo je prava provjera metode.
  function udio(popis, uvjet) {
    const skup = popis.filter((z) => z.obris).filter(uvjet);
    const s = skup.filter((z) => nadjen.has(z.id)).length;
    return { ukupno: skup.length, ima: s, pct: skup.length ? (100 * s / skup.length).toFixed(0) + "%" : "-" };
  }

  console.log(`\n  SLAGANJE S POSTOJECIM SIGNALIMA`);
  console.log(`  (koliki udio svake skupine Microsoft vec ima)\n`);
  const redovi = [
    ["masovni unos = da", (z) => z.masovni],
    ["masovni unos = ne", (z) => !z.masovni],
    ["satelit: stara", (z) => z.satelit === "stara"],
    ["satelit: kandidat", (z) => z.satelit === "kandidat"],
    ["satelit: nije provjereno", (z) => !z.satelit],
  ];
  redovi.forEach(([ime, uvjet]) => {
    const r = udio(sObrisom, uvjet);
    console.log(`    ${ime.padEnd(28)} ${String(r.ukupno).padStart(6)} zgrada, MS ima ${String(r.ima).padStart(6)} (${r.pct})`);
  });

  console.log(`\n  Ako se "satelit: stara" i "masovni unos = da" poklapaju s visokim`);
  console.log(`  postotkom, Microsoft potvrdjuje ono sto vec znamo - i moze se`);
  console.log(`  primijeniti na onih 86% zgrada koje satelit nikad nije provjerio.\n`);
}

main().catch((err) => {
  console.error("\nTest pukao:", err.message);
  process.exit(1);
});
