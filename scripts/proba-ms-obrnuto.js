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
const TOLERANCIJA_M = 12;    // koliko sredista smiju biti razmaknuta da ih smatramo istom zgradom

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
      let poklapa = false;
      for (let dx = -1; dx <= 1 && !poklapa; dx++) {
        for (let dy = -1; dy <= 1 && !poklapa; dy++) {
          const kandidati = msMreza.get((gx + dx) + ":" + (gy + dy));
          if (!kandidati) continue;
          for (const ms of kandidati) {
            // Tri nacina da zakljucimo da je rijec o istoj zgradi.
            if (uPoligonu(z.centar, ms.prsten)) { poklapa = true; break; }
            if (z.obris && uPoligonu(ms.centar, z.obris)) { poklapa = true; break; }
            if (udaljenostM(z.centar, ms.centar) <= TOLERANCIJA_M) { poklapa = true; break; }
          }
        }
      }
      if (poklapa) { nadjen.add(z.id); pogodaka++; }
    });

    console.log(`  [${redniBroj}/${poPocici.size}] ${qk}: nasih ${skupina.length}, ` +
      `MS u pocici ${ukupno.toLocaleString("hr-HR")} (zadrzano ${zadrzano.toLocaleString("hr-HR")}), ` +
      `poklapa se ${pogodaka} (${(100 * pogodaka / skupina.length).toFixed(0)}%)`);
  }

  // ---------- Rezultat ----------
  const ima = nase.filter((z) => nadjen.has(z.id));
  const nema = nase.filter((z) => !nadjen.has(z.id));
  const pct = (n) => (100 * n / Math.max(1, nase.length)).toFixed(1) + "%";

  console.log(`\n${"=".repeat(62)}`);
  console.log(`REZULTAT\n`);
  console.log(`  Nasih zgrada ukupno:                 ${nase.length.toLocaleString("hr-HR")}`);
  console.log(`  Microsoft ih VEC IMA:                ${ima.length.toLocaleString("hr-HR")}  (${pct(ima.length)})`);
  console.log(`     -> vidljive na snimci do 2024., dakle vjerojatno NISU novogradnja`);
  console.log(`  Microsoft ih NEMA:                   ${nema.length.toLocaleString("hr-HR")}  (${pct(nema.length)})`);
  console.log(`     -> ozbiljni kandidati za pravu novogradnju`);
  if (bezPocice) console.log(`  Bez pokrivenosti pocicom:            ${bezPocice.toLocaleString("hr-HR")}`);

  // Slaganje s postojecim signalima - ovo je prava provjera metode.
  function udio(popis, uvjet) {
    const skup = popis.filter(uvjet);
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
    const r = udio(nase, uvjet);
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
