// Unakrsna provjera: ako se NOVA DGU adresa (vidi dgu-nove-adrese.js)
// prostorno poklapa (nalazi unutar obrisa) s postojećom "novom OSM
// zgradom", to je puno jači kombinirani signal da je zgrada stvarno
// novoizgrađena - dva NEOVISNA službena/community izvora se slažu.
//
// Radi u oba smjera - može se pokrenuti i nakon tjednog OSM dohvata (nove
// zgrade + postojeće nove DGU adrese) i nakon mjesečnog DGU dohvata
// (postojeće OSM zgrade + nove DGU adrese) - idempotentno, uvijek
// preračunava na temelju trenutnog stanja oba skupa.
//
// Pokreće se: node scripts/dgu-osm-krizna-provjera.js

const fs = require("fs");
const path = require("path");
const cfg = require("./zgrade-config");

const REPO_ROOT = path.join(__dirname, "..");
const ZGRADE_DIR = path.join(REPO_ROOT, cfg.ZGRADE_DIR);
const ZGRADE_MANIFEST_PATH = path.join(ZGRADE_DIR, "manifest.json");
const DGU_NOVE_DIR = path.join(REPO_ROOT, "data", "dgu-nove-adrese");
const DGU_NOVE_MANIFEST_PATH = path.join(DGU_NOVE_DIR, "manifest.json");

function zatvoriPrsten(ring) {
  if (ring.length === 0) return ring;
  const [x0, y0] = ring[0];
  const [xl, yl] = ring[ring.length - 1];
  if (x0 !== xl || y0 !== yl) return [...ring, ring[0]];
  return ring;
}

// Jednostavan ray-casting point-in-polygon (bez turf ovisnosti - dovoljno
// za ovu malu, povremenu provjeru, ne treba grid-indeks jer su oba skupa
// mala, few stotina zapisa svaki).
function tockaUPoligonu(lon, lat, ring) {
  let unutra = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const presjek = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (presjek) unutra = !unutra;
  }
  return unutra;
}

function main() {
  if (!fs.existsSync(DGU_NOVE_MANIFEST_PATH)) {
    console.log("Nema dgu-nove-adrese manifesta - nema što unakrsno provjeriti.");
    return;
  }
  const dguNoveManifest = JSON.parse(fs.readFileSync(DGU_NOVE_MANIFEST_PATH, "utf8"));
  if (!dguNoveManifest.entries || dguNoveManifest.entries.length === 0) {
    console.log("Nema novih DGU adresa - nema što unakrsno provjeriti.");
    return;
  }
  const zadnjiDguNove = dguNoveManifest.entries[dguNoveManifest.entries.length - 1];
  const dguNovePodaci = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, zadnjiDguNove.file), "utf8"));
  console.log(`Učitano ${dguNovePodaci.features.length} novih DGU adresa (${zadnjiDguNove.date}).`);

  const zgradeManifest = JSON.parse(fs.readFileSync(ZGRADE_MANIFEST_PATH, "utf8"));
  if (zgradeManifest.entries.length === 0) {
    console.log("Nema zgrada - nema što unakrsno provjeriti.");
    return;
  }
  const zadnjiTo = new Date(zgradeManifest.entries[zgradeManifest.entries.length - 1].to);
  const cutoff = new Date(zadnjiTo);
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  const ciljaniZapisi = zgradeManifest.entries.filter((e) => new Date(e.to) > cutoff);
  console.log(`Ciljani zapisi zgrada (zadnjih 7 dana): ${ciljaniZapisi.map((e) => e.file).join(", ")}`);

  let ukupnoPoklapanja = 0;
  for (const entry of ciljaniZapisi) {
    const filePath = path.join(REPO_ROOT, entry.file);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

    let poklapanja = 0;
    data.features.forEach((f) => {
      if (!f.obris || f.obris.length < 3) return;
      const prsten = zatvoriPrsten(f.obris);
      const podudarna = dguNovePodaci.features.find((dg) => {
        const [lon, lat] = dg.geometry.coordinates;
        return tockaUPoligonu(lon, lat, prsten);
      });
      if (podudarna) {
        f.dguNovaAdresaPoklapanje = {
          street: podudarna.properties.street,
          houseNumber: podudarna.properties.houseNumber,
          datum: dguNovePodaci.datum,
        };
        poklapanja++;
      } else {
        // Ne brišemo postojeću oznaku ako je bila postavljena ranijim
        // pokretanjem s nekim drugim mjesečnim skupom - samo ne dodajemo
        // novu ako nema poklapanja u OVOM skupu.
      }
    });

    if (poklapanja > 0) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`  ${entry.file}: ${poklapanja} poklapanja.`);
      ukupnoPoklapanja += poklapanja;
    } else {
      console.log(`  ${entry.file}: 0 poklapanja.`);
    }
  }

  console.log(`\nUkupno poklapanja (OSM zgrada + nova DGU adresa unutar obrisa): ${ukupnoPoklapanja}.`);
}

main();
