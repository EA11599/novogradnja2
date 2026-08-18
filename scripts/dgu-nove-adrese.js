// Detekcija NOVIH DGU adresa - usporedba trenutnog DGU snapshota (koji je
// upravo dohvatio fetch-dgu-adrese.js) s "baznom" listom adresa iz
// prošlog mjeseca. Adrese koje su nove (postoje sad, nisu postojale prije)
// mogu ukazivati na novu gradnju - ALI, isto kao i s OSM podacima, "nova
// DGU adresa" NIJE nužno "nova zgrada" - može biti i naknadno
// unesen/ispravljen stariji zapis (DGU administrativno ažuriranje).
//
// Pokreće se NAKON fetch-dgu-adrese.js, u istom mjesečnom workflowu.
// Obrađuje po ŽUPANIJI (ne sve odjednom) da izbjegne memorijski problem
// koji smo imali ranije s punim nacionalnim skupom u memoriji.
//
// Prvi put kad se pokrene (nema bazne liste) - sprema trenutno stanje kao
// baznu listu, ne prijavljuje "nove" adrese (nemamo s čim usporediti).
//
// Pokreće se: node scripts/dgu-nove-adrese.js

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const DGU_DIR = path.join(REPO_ROOT, "data", "dgu-adrese");
const BASELINE_DIR = path.join(REPO_ROOT, "data", "dgu-baza-adresa");
const NOVE_DIR = path.join(REPO_ROOT, "data", "dgu-nove-adrese");
const MANIFEST_PATH = path.join(NOVE_DIR, "manifest.json");

function kljucAdrese(p) {
  // Kombinacija ulica+kućni broj+naselje kao pseudo-ID - DGU export nema
  // eksplicitan jedinstven ID koji trenutno čuvamo, ova kombinacija bi
  // trebala biti stabilna i jedinstvena unutar županije.
  return `${p.street}|${p.houseNumber}|${p.settlement}`.toLowerCase();
}

function main() {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  fs.mkdirSync(NOVE_DIR, { recursive: true });

  const datumOznaka = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const nazivDatoteke = `nove-${datumOznaka}.geojson`;

  const nazivSlojeva = fs.readdirSync(DGU_DIR).filter((f) => f.endsWith(".geojson"));
  console.log(`Obrađujem ${nazivSlojeva.length} županijskih datoteka...`);

  let ukupnoNovih = 0;
  let prviPutUkupno = 0;
  const sveNoveFeatures = [];

  for (const naziv of nazivSlojeva) {
    const slug = naziv.replace(".geojson", "");
    const trenutnaPutanja = path.join(DGU_DIR, naziv);
    const baznaPutanja = path.join(BASELINE_DIR, `${slug}.txt`);

    const trenutni = JSON.parse(fs.readFileSync(trenutnaPutanja, "utf8"));

    let baznaSet = null;
    if (fs.existsSync(baznaPutanja)) {
      const tekst = fs.readFileSync(baznaPutanja, "utf8");
      baznaSet = new Set(tekst.length > 0 ? tekst.split("\n") : []);
    }

    const noveZaOvuZupaniju = [];
    const noviKljucevi = [];

    trenutni.features.forEach((f) => {
      const kljuc = kljucAdrese(f.properties);
      noviKljucevi.push(kljuc);
      if (baznaSet !== null && !baznaSet.has(kljuc)) {
        noveZaOvuZupaniju.push(f);
      }
    });

    if (baznaSet === null) {
      prviPutUkupno += trenutni.features.length;
      console.log(`  ${slug}: PRVI PUT (nema bazne liste) - spremam ${trenutni.features.length} adresa kao bazu, ne prijavljujem "nove".`);
    } else {
      ukupnoNovih += noveZaOvuZupaniju.length;
      console.log(`  ${slug}: ${noveZaOvuZupaniju.length} novih adresa (od ${trenutni.features.length} ukupno).`);
      sveNoveFeatures.push(...noveZaOvuZupaniju);
    }

    // Uvijek ažuriraj baznu listu na trenutno stanje - za sljedeću usporedbu.
    fs.writeFileSync(baznaPutanja, noviKljucevi.join("\n"));
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

    console.log(`\nUkupno novih DGU adresa: ${ukupnoNovih}. Spremljeno u ${nazivDatoteke}.`);
  } else if (prviPutUkupno > 0) {
    console.log(`\nPrvi put pokrenuto - bazna lista spremljena (${prviPutUkupno} adresa ukupno). "Nove" adrese će se prijaviti od sljedećeg pokretanja.`);
  } else {
    console.log("\nNema novih DGU adresa ovaj put.");
  }
}

main();
