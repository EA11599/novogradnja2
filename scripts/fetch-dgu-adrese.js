// Mjesečni (ne tjedni) dohvat DGU (Državna geodetska uprava) adresnog
// registra za CIJELU Hrvatsku, preko javnog INSPIRE ATOM servisa
// (anonimno, bez prijave). Rezultat se NE sprema u git repo (fajl je
// prevelik da bi ga tjedno/mjesečno commitali — repo bi ubrzano rastao),
// nego se objavljuje kao GitHub Release asset, jedan fajl po županiji.
//
// Pokreće se preko GitHub Actions (.github/workflows/mjesecni-dgu-adrese.yml),
// jednom mjesečno. Može se pokrenuti i ručno: `npm run fetch:dgu`.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
const sax = require("sax");
const proj4 = require("proj4");
const unzipper = require("unzipper");
const booleanPointInPolygon = require("@turf/boolean-point-in-polygon").default;
const { point: turfPoint } = require("@turf/helpers");
const cfg = require("./zgrade-config");

const DGU_URL = "https://geoportal.dgu.hr/services/atom/INSPIRE_Addresses_(AD).zip";
const REPO_ROOT = path.join(__dirname, "..");
const TMP_DIR = path.join(REPO_ROOT, ".tmp-dgu");
const ZIP_PATH = path.join(TMP_DIR, "adrese.zip");
const GML_PATH = path.join(TMP_DIR, "Address.gml");

proj4.defs(
  "EPSG:3035",
  "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs"
);

// "Ulica X 25 Naselje 10000 Grad" -> [ulica, kućni broj, naselje, poštanski broj, grad]
const ADDRESS_PATTERN = /^(.+?)\s+(\d+[A-Za-z]?(?:\/\d+)?)\s+(.+?)\s+(\d{5})\s+(.+)$/;

function slug(naziv) {
  return naziv
    .replace(/đ/g, "dj").replace(/Đ/g, "Dj")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function preuzmiZip() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  console.log(`Preuzimam ${DGU_URL} ...`);
  const res = await fetch(DGU_URL, { headers: { "User-Agent": cfg.USER_AGENT } });
  if (!res.ok) throw new Error(`DGU preuzimanje ${res.status} ${res.statusText}`);
  await pipeline(res.body, fs.createWriteStream(ZIP_PATH));
  const { size } = fs.statSync(ZIP_PATH);
  console.log(`Preuzeto: ${(size / 1024 / 1024).toFixed(1)} MB`);
}

async function raspakirajGml() {
  console.log("Raspakiravam Address.gml iz zipa (streaming)...");
  const directory = await unzipper.Open.file(ZIP_PATH);
  const entry = directory.files.find((f) => /Address\.gml$/i.test(f.path));
  if (!entry) throw new Error("Address.gml nije pronađen u preuzetom zipu.");
  await pipeline(entry.stream(), fs.createWriteStream(GML_PATH));
  const { size } = fs.statSync(GML_PATH);
  console.log(`Raspakirano: ${(size / 1024 / 1024).toFixed(1)} MB`);
}

// Strujno parsira Address.gml (prevelik za učitati cijelog u memoriju odjednom)
// i za svaki <ad:Address> zapis vraća {lat, lon, tekstAdrese} preko callbacka.
function parsirajGmlStrujno(onZapis) {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, {});
    let unutarAdrese = false;
    let trenutniTag = null;
    let pos = null; // "x y" tekst iz <gml:pos>
    let altId = null;

    parser.on("opentag", (node) => {
      const naziv = node.name.split(":").pop();
      if (naziv === "Address") { unutarAdrese = true; pos = null; altId = null; }
      trenutniTag = naziv;
    });

    parser.on("text", (text) => {
      if (!unutarAdrese) return;
      if (trenutniTag === "pos") pos = (pos || "") + text;
      if (trenutniTag === "alternativeIdentifier") altId = (altId || "") + text;
    });

    parser.on("closetag", (nodeName) => {
      const naziv = nodeName.split(":").pop();
      if (naziv === "Address") {
        if (pos && altId) {
          // INSPIRE GML za EPSG:3035 obično slijedi "authority-compliant"
          // redoslijed osi (sjever, istok / Y, X), NE uobičajeni (istok,
          // sjever) na koji smo navikli iz web-mapping konteksta. Zato prvi
          // broj tretiramo kao Y (northing), drugi kao X (easting).
          const [y, x] = pos.trim().split(/\s+/).map(Number);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            onZapis(x, y, altId.trim());
          }
        }
        unutarAdrese = false;
      }
    });

    parser.on("error", reject);
    parser.on("end", resolve);

    fs.createReadStream(GML_PATH).pipe(parser);
  });
}

async function main() {
  await preuzmiZip();
  await raspakirajGml();

  const zupanije = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "data", "zupanije.geojson"), "utf8"));
  const OUT_DIR = path.join(REPO_ROOT, ".tmp-dgu-out");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Umjesto gomilanja svih zapisa u memoriji pa pisanja na kraju (što je
  // uzrokovalo "heap out of memory" na ~1.6M zadržanih zapisa), otvaramo
  // po jedan write stream za svaku županiju odmah, i pišemo svaki zapis
  // NA DISK čim se obradi. U svakom trenutku držimo u memoriji samo
  // trenutni zapis, ne cijelu povijest.
  const poZupaniji = {}; // slug -> { naziv, poly, stream, count, prviZapis }
  zupanije.features.forEach((f) => {
    const key = slug(f.properties.naziv);
    const stream = fs.createWriteStream(path.join(OUT_DIR, `${key}.geojson`));
    stream.write('{"type":"FeatureCollection","features":[');
    poZupaniji[key] = { naziv: f.properties.naziv, poly: f, stream, count: 0, prviZapis: true };
  });

  let ukupno = 0, zadrzano = 0, regexNeuspio = 0, izvanZupanije = 0, ispisanoUzoraka = 0;

  console.log("Parsiram Address.gml (strujno, cijela Hrvatska)...");
  await parsirajGmlStrujno((x, y, altId) => {
    ukupno++;
    const m = altId.match(ADDRESS_PATTERN);
    if (!m) { regexNeuspio++; return; }
    const [, street, houseNumber, settlement, postcode, city] = m;

    const [lon, lat] = proj4("EPSG:3035", "EPSG:4326", [x, y]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

    // Dijagnostika: ispiši prvih 5 primjera da odmah vidimo jesu li
    // koordinate razumne za Hrvatsku (lon ~13-19, lat ~42-46) prije nego
    // čekamo cijelu obradu do kraja.
    if (ispisanoUzoraka < 5) {
      console.log(`  UZORAK: "${altId}" -> raw(${x.toFixed(1)}, ${y.toFixed(1)}) -> lon/lat(${lon.toFixed(4)}, ${lat.toFixed(4)})`);
      ispisanoUzoraka++;
    }

    const pt = turfPoint([lon, lat]);
    let nasaoZupaniju = null;
    for (const key of Object.keys(poZupaniji)) {
      if (booleanPointInPolygon(pt, poZupaniji[key].poly)) { nasaoZupaniju = key; break; }
    }
    if (!nasaoZupaniju) { izvanZupanije++; return; }

    const zapis = poZupaniji[nasaoZupaniju];
    const feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [+lon.toFixed(6), +lat.toFixed(6)] },
      properties: { street, houseNumber, settlement, postcode, city },
    };
    zapis.stream.write((zapis.prviZapis ? "" : ",") + JSON.stringify(feature));
    zapis.prviZapis = false;
    zapis.count++;
    zadrzano++;

    if (ukupno % 200000 === 0) console.log(`  ...obrađeno ${ukupno.toLocaleString()} zapisa`);
  });

  console.log(`\nUkupno pregledano zapisa: ${ukupno.toLocaleString()}`);
  console.log(`Zadržano (adresa prepoznata + unutar neke županije): ${zadrzano.toLocaleString()}`);
  console.log(`Adresa nije prepoznata regexom: ${regexNeuspio.toLocaleString()}`);
  console.log(`Izvan svih županijskih poligona: ${izvanZupanije.toLocaleString()}`);

  for (const [, zapis] of Object.entries(poZupaniji)) {
    zapis.stream.end("]}");
    await new Promise((resolve) => zapis.stream.on("finish", resolve));
    console.log(`  ${zapis.naziv}: ${zapis.count.toLocaleString()} adresa`);
  }

  // Čišćenje privremenih velikih datoteka (zip + gml) - ne trebaju nakon parsiranja.
  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  console.log(`\nGotovo. Izlazne datoteke su u ${OUT_DIR} — sljedeći korak (workflow) ih uploada kao Release assets.`);
}

main().catch((err) => {
  console.error("DGU dohvat pukao:", err.message);
  process.exit(1);
});
