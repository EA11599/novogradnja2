// Za zgrade koje NEMAJU addr:street oznaku u OSM-u, ali IMAJU punu geometriju
// (obris), provjerava je li neka DGU adresna točka doslovno UNUTAR tog
// obrisa (ne samo blizu, kao "najbliža cesta") — pouzdanije od procjene.
//
// Grid index (ne brute-force protiv svih DGU točaka u županiji, koje zna
// biti i 150k+ — testiranje svake zgrade protiv svih bilo bi presporo):
// DGU točke se raspoređuju u mrežu ćelija po zaokruženim koordinatama, pa
// se za svaku zgradu testiraju samo točke iz obližnjih ćelija.

const fs = require("fs");
const path = require("path");
const booleanPointInPolygon = require("@turf/boolean-point-in-polygon").default;

const REPO_ROOT = path.join(__dirname, "..", "..");
const DGU_DIR = path.join(REPO_ROOT, "data", "dgu-adrese");
const CELL = 0.002; // ~200m po ćeliji na ovoj geografskoj širini

function slug(naziv) {
  return naziv
    .replace(/đ/g, "dj").replace(/Đ/g, "Dj")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function cellKey(lon, lat) {
  return Math.floor(lon / CELL) + "_" + Math.floor(lat / CELL);
}

const kesGridovaPoZupaniji = {}; // slug -> grid objekt, da se ista županija ne učitava dvaput u istom pokretanju

function ucitajGridZaZupaniju(nazivZupanije) {
  const key = slug(nazivZupanije);
  if (kesGridovaPoZupaniji[key] !== undefined) return kesGridovaPoZupaniji[key];

  const filePath = path.join(DGU_DIR, `${key}.geojson`);
  if (!fs.existsSync(filePath)) {
    console.log(`  Napomena: nema DGU podataka za "${nazivZupanije}" (${key}.geojson ne postoji).`);
    kesGridovaPoZupaniji[key] = null;
    return null;
  }

  const geojson = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const grid = {};
  geojson.features.forEach((f) => {
    const [lon, lat] = f.geometry.coordinates;
    const k = cellKey(lon, lat);
    (grid[k] = grid[k] || []).push({ lon, lat, props: f.properties });
  });
  kesGridovaPoZupaniji[key] = grid;
  return grid;
}

function zatvoriPrsten(ring) {
  if (ring.length === 0) return ring;
  const [x0, y0] = ring[0];
  const [xl, yl] = ring[ring.length - 1];
  if (x0 !== xl || y0 !== yl) return [...ring, ring[0]];
  return ring;
}

// Vraća SVE DGU properties (street, houseNumber, settlement, postcode, city)
// pronađene unutar obrisa zgrade - ne staje na prvoj. Broj pronađenih
// adresa je signal je li zgrada obiteljska kuća (1 adresa) ili stambena
// zgrada s više jedinica (2+ adresa, svaki stan ima svoju službenu adresu).
function pronadjiSveDguAdrese(feature) {
  if (!feature.obris || feature.obris.length < 3 || !feature.zupanija) return [];

  const grid = ucitajGridZaZupaniju(feature.zupanija);
  if (!grid) return [];

  const lons = feature.obris.map((p) => p[0]);
  const lats = feature.obris.map((p) => p[1]);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);

  const cMinLon = Math.floor(minLon / CELL), cMaxLon = Math.floor(maxLon / CELL);
  const cMinLat = Math.floor(minLat / CELL), cMaxLat = Math.floor(maxLat / CELL);

  const poly = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [zatvoriPrsten(feature.obris)] } };

  const rezultati = [];
  for (let cx = cMinLon - 1; cx <= cMaxLon + 1; cx++) {
    for (let cy = cMinLat - 1; cy <= cMaxLat + 1; cy++) {
      const kandidati = grid[cx + "_" + cy];
      if (!kandidati) continue;
      for (const kandidat of kandidati) {
        if (booleanPointInPolygon([kandidat.lon, kandidat.lat], poly)) {
          // Uz atribute nosimo i koordinatu - bez nje se adresna tocka ne
          // moze oznaciti na karti, a upravo je raspored tocaka unutar obrisa
          // ono sto otkriva podjelu objekta na vise jedinica.
          rezultati.push({ ...kandidat.props, lon: kandidat.lon, lat: kandidat.lat });
        }
      }
    }
  }
  return rezultati;
}

// Zadržano radi kompatibilnosti - vraća samo prvu pronađenu adresu (ili null).
function pronadjiDguAdresu(feature) {
  const sve = pronadjiSveDguAdrese(feature);
  return sve.length > 0 ? sve[0] : null;
}

// Primjenjuje pronadjiSveDguAdrese na cijeli niz feature-a (mutira ih u
// mjestu - dodaje dguAdresa i dguBrojJedinica polja). Vraća broj pronađenih
// poklapanja, radi ispisa.
function dodajDguAdrese(features) {
  let nadjeno = 0;
  for (const f of features) {
    if (f.tags && f.tags["addr:street"]) continue; // već ima OSM adresu, ne treba DGU
    const sveAdrese = pronadjiSveDguAdrese(f);
    if (sveAdrese.length > 0) {
      f.dguAdresa = sveAdrese[0]; // glavna prikazana adresa - i dalje prva
      f.dguBrojJedinica = sveAdrese.length; // broj DGU adresa unutar obrisa
      // Cijeli popis s koordinatama, za oznacavanje na karti.
      f.dguTocke = sveAdrese.map(a => ({
        street: a.street || null, houseNumber: a.houseNumber || null,
        settlement: a.settlement || null, postcode: a.postcode || null,
        city: a.city || null, lon: a.lon, lat: a.lat,
      }));
      nadjeno++;
    }
  }
  return nadjeno;
}

module.exports = { dodajDguAdrese, pronadjiDguAdresu, pronadjiSveDguAdrese, slug };
