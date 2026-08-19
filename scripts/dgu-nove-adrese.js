// Detekcija NOVIH DGU adresa - PROSTORNA usporedba (koordinate), ne
// tekstualna (ulica+kućni broj). Cilj: uhvatiti lokacije koje NIKAD prije
// nisu imale nijednu DGU adresu u blizini - npr. prazno zemljište na kraju
// ulice koje dobije prvi kućni broj kad počne gradnja.
//
// VAŽNO - zašto prostorno, ne tekstualno: da smo uspoređivali samo tekst
// "ulica+broj", administrativno preimenovanje ili ispravak POSTOJEĆE
// adrese (npr. "45" -> "45A"/"45B") bi se lažno prijavilo kao "nova
// adresa", iako lokacija oduvijek ima adresu - nema veze sa stvarnom
// gradnjom. Prostorna provjera to izbjegava: gleda je li na TOJ LOKACIJI
// (unutar praga od PRAG_UDALJENOSTI_M) ikad prije postojala bilo koja DGU
// adresa, bez obzira na njen tekst.
//
// I dalje vrijedi ista opća napomena kao za OSM: "nova DGU adresa" nije
// automatski "nova zgrada" - može biti i naknadno digitalizirana stara
// lokacija koja ranije nije bila u DGU bazi.
//
// Pokreće se NAKON fetch-dgu-adrese.js, u istom mjesečnom workflowu.
// Obrađuje po ŽUPANIJI (ne sve odjednom) da izbjegne memorijski problem
// koji smo imali ranije s punim nacionalnim skupom u memoriji.
//
// Pokreće se: node scripts/dgu-nove-adrese.js

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const DGU_DIR = path.join(REPO_ROOT, "data", "dgu-adrese");
const BASELINE_DIR = path.join(REPO_ROOT, "data", "dgu-baza-adresa");
const NOVE_DIR = path.join(REPO_ROOT, "data", "dgu-nove-adrese");
const MANIFEST_PATH = path.join(NOVE_DIR, "manifest.json");

const PRAG_UDALJENOSTI_M = 20; // radijus unutar kojeg smatramo "ista lokacija"
const CELL = 0.002; // ~200m po ćeliji - dovoljno velika da prag (20m) uvijek stane u susjedne ćelije

function cellKey(lon, lat) {
  return `${Math.floor(lon / CELL)}_${Math.floor(lat / CELL)}`;
}

function udaljenostM(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * 111320;
  const dLon = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function izgradiGrid(tocke) {
  const grid = {};
  tocke.forEach(([lon, lat]) => {
    const k = cellKey(lon, lat);
    (grid[k] = grid[k] || []).push([lon, lat]);
  });
  return grid;
}

function imaLiBlizuTocke(grid, lon, lat) {
  const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const kandidati = grid[`${cx + dx}_${cy + dy}`];
      if (!kandidati) continue;
      for (const [klon, klat] of kandidati) {
        if (udaljenostM(lon, lat, klon, klat) <= PRAG_UDALJENOSTI_M) return true;
      }
    }
  }
  return false;
}

function ucitajBaznuDatoteku(putanja) {
  if (!fs.existsSync(putanja)) return null;
  const tekst = fs.readFileSync(putanja, "utf8");
  if (tekst.length === 0) return [];
  const prviRedak = tekst.split("\n", 1)[0];
  if (prviRedak.includes("|")) return null;
  return tekst.split("\n").map((redak) => redak.split(",").map(Number));
}

function main() {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  fs.mkdirSync(NOVE_DIR, { recursive: true });

  const datumOznaka = new Date().toISOString().slice(0, 10);
  const nazivDatoteke = `nove-${datumOznaka}.geojson`;

  const nazivSlojeva = fs.readdirSync(DGU_DIR).filter((f) => f.endsWith(".geojson"));
  console.log(`Obrađujem ${nazivSlojeva.length} županijskih datoteka (prostorna provjera, prag ${PRAG_UDALJENOSTI_M}m)...`);

  let ukupnoNovih = 0;
  let prviPutUkupno = 0;
  const sveNoveFeatures = [];

  for (const naziv of nazivSlojeva) {
    const slug = naziv.replace(".geojson", "");
    const trenutnaPutanja = path.join(DGU_DIR, naziv);
    const baznaPutanja = path.join(BASELINE_DIR, `${slug}.txt`);

    const trenutni = JSON.parse(fs.readFileSync(trenutnaPutanja, "utf8"));
    const baznaTocke = ucitajBaznuDatoteku(baznaPutanja);

    if (baznaTocke === null) {
      prviPutUkupno += trenutni.features.length;
      console.log(`  ${slug}: PRVI PUT (nema bazne liste ili je stara/nekompatibilna) - gradim novu baznu liniju, ne prijavljujem "nove".`);
    } else {
      const grid = izgradiGrid(baznaTocke);
      const noveZaOvuZupaniju = trenutni.features.filter((f) => {
        const [lon, lat] = f.geometry.coordinates;
        return !imaLiBlizuTocke(grid, lon, lat);
      });
      ukupnoNovih += noveZaOvuZupaniju.length;
      console.log(`  ${slug}: ${noveZaOvuZupaniju.length} prostorno novih adresa (od ${trenutni.features.length} ukupno).`);
      sveNoveFeatures.push(...noveZaOvuZupaniju);
    }

    const noveKoordinate = trenutni.features.map((f) => f.geometry.coordinates.join(","));
    fs.writeFileSync(baznaPutanja, noveKoordinate.join("\n"));
  }

  if (sveNoveFeatures.length > 0) {
    const filePath = path.join(NOVE_DIR, nazivDatoteke);
    fs.writeFileSync(
      filePath,
      JSON.stringify({ type: "FeatureCollection", datum: datumOznaka, count: sveNoveFeatures.length, features: sveNoveFeatures }, null, 2)
    );

    const manifest = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) : { entries: [] };
    manifest.entries.push({ date: datumOznaka, count: sveNoveFeatures.length, file: `data/dgu-nove-adrese/${nazivDatoteke}` });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

    console.log(`\nUkupno prostorno novih DGU adresa: ${ukupnoNovih}. Spremljeno u ${nazivDatoteke}.`);
  } else if (prviPutUkupno > 0) {
    console.log(`\nPrvi put pokrenuto (ili format promijenjen) - bazna lista spremljena (${prviPutUkupno} adresa ukupno). "Nove" adrese će se prijaviti od sljedećeg pokretanja.`);
  } else {
    console.log("\nNema prostorno novih DGU adresa ovaj put.");
  }
}

main();
