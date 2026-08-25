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

// Najveca dopustena udaljenost izmedju nove DGU adrese i sredista zgrade.
//
// Ranije se trazilo da adresa padne TOCNO unutar obrisa. To je bilo prestrogo
// iz dva razloga: 30% zgrada uopce nema obris, a DGU tocka cesto stoji na
// ulazu u parcelu, ne na krovu. Rezultat je bio jedno jedino poklapanje na
// 133 nove adrese.
//
// 25 m je kompromis: pokriva razmak od ulaza do kuce, a jos uvijek je manje od
// tipicnog razmaka izmedju susjednih kuca u nasim naseljima (8-10 m rubno, ali
// sredista su obicno 15-25 m razmaknuta). Dodatnu zastitu daje pravilo da se
// svaka adresa veze samo za NAJBLIZU zgradu.
const MAX_UDALJENOST_M = 25;

function sredisteObrisa(obris) {
  let x = 0, y = 0;
  obris.forEach(([lon, lat]) => { x += lon; y += lat; });
  return [x / obris.length, y / obris.length];
}

function udaljenostM(lon1, lat1, lon2, lat2) {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.sqrt(dx * dx + dy * dy);
}

function main() {
  if (!fs.existsSync(DGU_NOVE_MANIFEST_PATH)) {
    console.log("Nema dgu-nove-adrese manifesta - nema sto unakrsno provjeriti.");
    return;
  }
  const dguNoveManifest = JSON.parse(fs.readFileSync(DGU_NOVE_MANIFEST_PATH, "utf8"));
  if (!dguNoveManifest.entries || dguNoveManifest.entries.length === 0) {
    console.log("Nema novih DGU adresa - nema sto unakrsno provjeriti.");
    return;
  }

  // SVE serije novih adresa, ne samo zadnja. Zaliha raste svakim dohvatom, a
  // zgrada zabiljezena u svibnju moze dobiti adresu tek u kolovozu.
  const adrese = [];
  dguNoveManifest.entries.forEach((e) => {
    const p = path.join(REPO_ROOT, e.file);
    if (!fs.existsSync(p)) return;
    const podaci = JSON.parse(fs.readFileSync(p, "utf8"));
    (podaci.features || []).forEach((dg) => {
      const k = dg.geometry && dg.geometry.coordinates;
      if (!k) return;
      adrese.push({
        lon: k[0], lat: k[1],
        street: (dg.properties || {}).street,
        houseNumber: (dg.properties || {}).houseNumber,
        datum: podaci.datum || e.date || null,
      });
    });
  });
  console.log(`Ucitano ${adrese.length} novih DGU adresa iz ${dguNoveManifest.entries.length} serija.`);

  // SVE zgrade, ne samo zadnjih 7 dana.
  const zgradeManifest = JSON.parse(fs.readFileSync(ZGRADE_MANIFEST_PATH, "utf8"));
  const zgrade = [];
  const datoteke = new Map();

  zgradeManifest.entries.forEach((e) => {
    const p = path.join(REPO_ROOT, e.file);
    if (!fs.existsSync(p)) return;
    const podaci = JSON.parse(fs.readFileSync(p, "utf8"));
    datoteke.set(e.file, { putanja: p, podaci, dirnuto: false });
    (podaci.features || []).forEach((f) => {
      let centar = null;
      if (f.obris && f.obris.length >= 3) centar = sredisteObrisa(f.obris);
      else if (f.lat && f.lon) centar = [f.lon, f.lat];
      if (!centar) return;
      zgrade.push({ f, centar, prsten: (f.obris && f.obris.length >= 3) ? zatvoriPrsten(f.obris) : null, datoteka: e.file });
    });
  });
  console.log(`Ucitano ${zgrade.length} zgrada iz ${datoteke.size} datoteka.\n`);

  // Prostorna mreza, inace bi bilo 133 x 28.000 usporedbi po seriji.
  const CELIJA = 0.0005; // ~55 m
  const mreza = new Map();
  zgrade.forEach((z) => {
    const k = Math.floor(z.centar[0] / CELIJA) + ":" + Math.floor(z.centar[1] / CELIJA);
    if (!mreza.has(k)) mreza.set(k, []);
    mreza.get(k).push(z);
  });

  let poklapanja = 0, unutarObrisa = 0, bezPoklapanja = 0;

  adrese.forEach((a) => {
    const gx = Math.floor(a.lon / CELIJA);
    const gy = Math.floor(a.lat / CELIJA);
    const kandidati = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const c = mreza.get((gx + dx) + ":" + (gy + dy));
        if (c) kandidati.push(...c);
      }
    }

    // Svaka adresa se veze SAMO za najblizu zgradu. Bez toga bi jedna adresa
    // oznacila i susjedove kuce kao kandidate za novogradnju.
    let najbolja = null, najmanja = Infinity;
    kandidati.forEach((z) => {
      // Adresa unutar obrisa uvijek pobjeduje - to je najjaci moguci dokaz.
      const unutra = z.prsten && tockaUPoligonu(a.lon, a.lat, z.prsten);
      const d = unutra ? 0 : udaljenostM(a.lon, a.lat, z.centar[0], z.centar[1]);
      if (d < najmanja) { najmanja = d; najbolja = z; }
    });

    if (!najbolja || najmanja > MAX_UDALJENOST_M) { bezPoklapanja++; return; }

    najbolja.f.dguNovaAdresaPoklapanje = {
      street: a.street,
      houseNumber: a.houseNumber,
      datum: a.datum,
      udaljenostM: Math.round(najmanja * 10) / 10,
      unutarObrisa: najmanja === 0,
    };
    datoteke.get(najbolja.datoteka).dirnuto = true;
    poklapanja++;
    if (najmanja === 0) unutarObrisa++;
  });

  datoteke.forEach((d) => {
    if (d.dirnuto) fs.writeFileSync(d.putanja, JSON.stringify(d.podaci, null, 2));
  });

  console.log(`Poklapanja:              ${poklapanja} od ${adrese.length} adresa`);
  console.log(`  od toga unutar obrisa: ${unutarObrisa}`);
  console.log(`  na udaljenosti do ${MAX_UDALJENOST_M} m: ${poklapanja - unutarObrisa}`);
  console.log(`Bez poklapanja:          ${bezPoklapanja}`);
}

main();
