// Provjerava nase zgrade protiv sluzbenog DGU skupa zgrada (INSPIRE tema BU,
// Temeljna topografska baza).
//
// ZASTO: satelitska provjera ne radi ondje gdje DGU nema ortofoto - takvih je
// 464 zgrade, od cega 270 u Medjimurju. Vektorski skup zgrada nema tu vrstu
// rupe, pa moze pokriti upravo te slucajeve.
//
// STO ZAKLJUCUJEMO: ako zgrada postoji u DGU skupu, postojala je u trenutku
// izrade tog skupa - dakle nije novogradnja. Ako je nema, to samo znaci da je
// nema u toj bazi; TTB nije potpun popis svih zgrada u zemlji.
//
// LICENCA: otvorena dozvola (data.gov.hr/otvorena-dozvola), ista pod kojom
// vec koristimo DGU adrese.
//
// Skripta nista ne mijenja u repozitoriju - ispisuje rezultat u log.
//
//   node scripts/proba-dgu-zgrade.js --struktura   (samo pogledaj GML)
//   node scripts/proba-dgu-zgrade.js               (puna usporedba)

const fs = require("fs");
const path = require("path");
const sax = require("sax");
const proj4 = require("proj4");
const unzipper = require("unzipper");
const cfg = require("./zgrade-config");

const DGU_URL = "https://geoportal.dgu.hr/services/atom/INSPIRE_Building_(BU-CORE2D).zip";
const REPO_ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "data", "zgrade", "manifest.json");
const TMP_DIR = path.join(REPO_ROOT, ".tmp-dgu-zgrade");

const SAMO_STRUKTURA = process.argv.includes("--struktura");

// Koliko sredista smiju biti razmaknuta da ih smatramo istom zgradom.
// Isti obrazac kao kod DGU adresa: dva izvora crtaju isti objekt malo
// drukcije, ali susjedova kuca je dalje od ovoga.
const TOLERANCIJA_M = 20;
const CELIJA = 0.0005; // ~55 m

// INSPIRE isporucuje u ETRS89/LAEA. Ista definicija kao u fetch-dgu-adrese.js.
proj4.defs(
  "EPSG:3035",
  "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs"
);
proj4.defs("EPSG:3765", "+proj=tmerc +lat_0=0 +lon_0=16.5 +k=0.9999 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs");

function udaljenostM(lon1, lat1, lon2, lat2) {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.sqrt(dx * dx + dy * dy);
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
      let centar = [f.lon, f.lat];
      if (f.obris && f.obris.length >= 3) {
        let x = 0, y = 0;
        f.obris.forEach(([a, b]) => { x += a; y += b; });
        centar = [x / f.obris.length, y / f.obris.length];
      }
      zgrade.set(f.id, {
        id: f.id,
        centar,
        satelit: (f.satelitProvjera || {}).status || null,
        zupanija: f.zupanija || "?",
        nadjena: false,
      });
    });
  });
  return [...zgrade.values()];
}

// ---------- Preuzimanje ----------
async function preuzmi() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const gmlPath = path.join(TMP_DIR, "Building.gml");
  if (fs.existsSync(gmlPath)) {
    console.log(`  Vec preuzeto: ${(fs.statSync(gmlPath).size / 1024 / 1024).toFixed(0)} MB`);
    return gmlPath;
  }

  console.log(`  Preuzimam ${DGU_URL}`);
  const res = await fetch(DGU_URL, { headers: { "User-Agent": cfg.USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // Raspakiravamo u tijeku preuzimanja - cijeli ZIP u memoriji bi bio prevelik.
  const zipPath = path.join(TMP_DIR, "zgrade.zip");
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(zipPath, buf);
  console.log(`  Preuzeto: ${(buf.length / 1024 / 1024).toFixed(0)} MB`);

  const dir = await unzipper.Open.file(zipPath);
  console.log(`  U arhivi: ${dir.files.map((f) => `${f.path} (${(f.uncompressedSize / 1024 / 1024).toFixed(0)} MB)`).join(", ")}`);
  const gml = dir.files.find((f) => /\.gml$/i.test(f.path));
  if (!gml) throw new Error("U arhivi nema GML datoteke.");

  await new Promise((res2, rej) => {
    gml.stream().pipe(fs.createWriteStream(gmlPath)).on("finish", res2).on("error", rej);
  });
  fs.unlinkSync(zipPath);
  return gmlPath;
}

// ---------- Citanje GML-a ----------
// Citamo tokom, ne u memoriju: datoteka je prevelika da bi se ucitala odjednom.
function obradiGml(gmlPath, mreza, nase, samoStruktura) {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true });

    const elementi = {};          // za --struktura
    let uZgradi = false;
    let uKoordinatama = false;
    let uAtributu = null;
    let tekst = "";
    let tockeX = 0, tockeY = 0, brojTocaka = 0;
    let srs = null;
    let brojZgrada = 0, poklapanja = 0;

    // Atributi koje INSPIRE nosi uz svaku zgradu. conditionOfConstruction je
    // najzanimljiviji: sadrzi vrijednosti poput "functional",
    // "underConstruction" i "demolished" - dakle mozda i izravan podatak o
    // zgradama koje se upravo grade.
    let stanje = null, datum = null, priroda = null;
    const brojacStanja = {};
    const brojacGodina = {};

    // REDOSLIJED KOORDINATA
    //
    // EPSG:3035 je sluzbeno definiran kao (sjever, istok), obrnuto od
    // uobicajenog. Razni posluzitelji to razlicito tumace, pa se ne oslanjamo
    // na specifikaciju nego na same brojke: u Hrvatskoj je istocna koordinata
    // oko 4.900.000, a sjeverna oko 2.400.000. Razlika je tolika da se
    // redoslijed prepoznaje sam, na prvoj zgradi.
    let obrnutRedoslijed = null;

    parser.on("opentag", (n) => {
      const ime = n.name.replace(/^.*:/, "");
      if (samoStruktura) elementi[n.name] = (elementi[n.name] || 0) + 1;

      if (ime === "Building") {
        uZgradi = true;
        tockeX = tockeY = brojTocaka = 0;
      }
      if (!srs && n.attributes && n.attributes.srsName) srs = n.attributes.srsName;
      if (uZgradi && (ime === "posList" || ime === "pos")) {
        uKoordinatama = true;
        tekst = "";
      }
      if (uZgradi && (ime === "conditionOfConstruction" || ime === "beginLifespanVersion" || ime === "buildingNature")) {
        uAtributu = ime;
        tekst = "";
      }
    });

    parser.on("text", (t) => { if (uKoordinatama || uAtributu) tekst += " " + t; });

    parser.on("closetag", (naziv) => {
      const ime = naziv.replace(/^.*:/, "");

      if (uKoordinatama && (ime === "posList" || ime === "pos")) {
        uKoordinatama = false;
        const br = tekst.trim().split(/\s+/).map(Number).filter(Number.isFinite);
        for (let i = 0; i + 1 < br.length; i += 2) {
          tockeX += br[i]; tockeY += br[i + 1]; brojTocaka++;
        }
        tekst = "";
      }

      if (uAtributu && ime === uAtributu) {
        const v = tekst.trim();
        if (uAtributu === "conditionOfConstruction") stanje = v || null;
        else if (uAtributu === "beginLifespanVersion") datum = v || null;
        else if (uAtributu === "buildingNature") priroda = v || null;
        uAtributu = null;
        tekst = "";
      }

      if (ime === "Building") {
        uZgradi = false;
        brojZgrada++;

        if (stanje) brojacStanja[stanje] = (brojacStanja[stanje] || 0) + 1;
        if (datum && datum.length >= 4) {
          const g = datum.slice(0, 4);
          brojacGodina[g] = (brojacGodina[g] || 0) + 1;
        }
        if (brojTocaka > 0 && !samoStruktura) {
          let x = tockeX / brojTocaka;
          let y = tockeY / brojTocaka;

          // Prva zgrada odlucuje o redoslijedu za sve ostale.
          if (obrnutRedoslijed === null) {
            obrnutRedoslijed = x < y;
            console.log(`    Redoslijed koordinata: ${obrnutRedoslijed ? "sjever pa istok (zamjenjujem)" : "istok pa sjever"}`);
          }
          if (obrnutRedoslijed) { const t = x; x = y; y = t; }

          const izvor = (srs && srs.includes("3765")) ? "EPSG:3765" : "EPSG:3035";
          let lon, lat;
          try { [lon, lat] = proj4(izvor, "EPSG:4326", [x, y]); } catch (e) { return; }

          // Sigurnosna provjera na prvoj zgradi: pada li unutar Hrvatske?
          if (brojZgrada === 1 && (lon < 13 || lon > 20 || lat < 42 || lat > 47)) {
            console.log(`    UPOZORENJE: prva zgrada ispada na ${lat.toFixed(3)}, ${lon.toFixed(3)} - izvan Hrvatske. Pretvorba je vjerojatno kriva.`);
          }

          const gx = Math.floor(lon / CELIJA), gy = Math.floor(lat / CELIJA);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const c = mreza.get((gx + dx) + ":" + (gy + dy));
              if (!c) continue;
              for (const z of c) {
                if (z.nadjena) continue;
                if (udaljenostM(lon, lat, z.centar[0], z.centar[1]) <= TOLERANCIJA_M) {
                  z.nadjena = true;
                  z.dguStanje = stanje;
                  z.dguDatum = datum;
                  z.dguPriroda = priroda;
                  poklapanja++;
                }
              }
            }
          }
        }
        stanje = datum = priroda = null;

        if (brojZgrada % 200000 === 0) {
          console.log(`    ...procitano ${brojZgrada.toLocaleString("hr-HR")} zgrada, poklapanja ${poklapanja.toLocaleString("hr-HR")}`);
        }
      }
    });

    parser.on("error", (e) => reject(e));
    parser.on("end", () => resolve({ brojZgrada, poklapanja, srs, elementi, brojacStanja, brojacGodina }));
    fs.createReadStream(gmlPath).pipe(parser);
  });
}

// ---------- Glavni tok ----------
async function main() {
  console.log("\n=== DGU SLUZBENE ZGRADE (INSPIRE BU) ===\n");

  const nase = ucitajNase();
  console.log(`Nasih zgrada: ${nase.length.toLocaleString("hr-HR")}`);

  const mreza = new Map();
  nase.forEach((z) => {
    const k = Math.floor(z.centar[0] / CELIJA) + ":" + Math.floor(z.centar[1] / CELIJA);
    if (!mreza.has(k)) mreza.set(k, []);
    mreza.get(k).push(z);
  });

  const gmlPath = await preuzmi();
  console.log(`\nCitam GML...`);
  const r = await obradiGml(gmlPath, mreza, nase, SAMO_STRUKTURA);

  const ispisiAtribute = () => {
    console.log(`\nSTANJE GRADNJE (conditionOfConstruction):`);
    Object.entries(r.brojacStanja).sort((a, b) => b[1] - a[1]).forEach(([k, n]) =>
      console.log(`   ${String(n).padStart(10).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}  ${k}`));
    console.log(`\nGODINA ZAPISA (beginLifespanVersion):`);
    Object.entries(r.brojacGodina).sort().slice(-8).forEach(([g, n]) =>
      console.log(`   ${g}: ${n.toLocaleString("hr-HR")}`));
  };

  if (SAMO_STRUKTURA) {
    console.log(`\nSRS: ${r.srs}`);
    console.log(`Zgrada u GML-u: ${r.brojZgrada.toLocaleString("hr-HR")}`);
    ispisiAtribute();
    console.log(`\nNAJCESCI ELEMENTI:`);
    Object.entries(r.elementi).sort((a, b) => b[1] - a[1]).slice(0, 25)
      .forEach(([e, n]) => console.log(`   ${String(n).padStart(10)}  ${e}`));
    return;
  }

  const nadjene = nase.filter((z) => z.nadjena);
  const nema = nase.filter((z) => !z.nadjena);

  console.log(`\n${"=".repeat(64)}`);
  console.log(`REZULTAT\n`);
  console.log(`  DGU zgrada u skupu:        ${r.brojZgrada.toLocaleString("hr-HR")}`);
  console.log(`  SRS izvora:                ${r.srs}`);
  console.log(`  Nasih zgrada:              ${nase.length.toLocaleString("hr-HR")}`);
  console.log(`  Postoji i u DGU skupu:     ${nadjene.length.toLocaleString("hr-HR")}  (${(100 * nadjene.length / nase.length).toFixed(1)}%)`);
  console.log(`  Nema je u DGU skupu:       ${nema.length.toLocaleString("hr-HR")}  (${(100 * nema.length / nase.length).toFixed(1)}%)`);

  // Ovo je prava provjera metode: slaze li se DGU sa satelitskom presudom?
  console.log(`\n  SLAGANJE SA SATELITSKOM PROVJEROM`);
  console.log(`  (koliki udio svake skupine DGU vec ima)\n`);
  [["kandidat", "kandidat (nema je na ortofotu)"],
   ["stara", "stara (vidi se na ortofotu)"],
   ["nema_snimke", "nema_snimke (ortofoto ne postoji)"]].forEach(([k, opis]) => {
    const skup = nase.filter((z) => z.satelit === k);
    const n = skup.filter((z) => z.nadjena).length;
    const pct = skup.length ? (100 * n / skup.length).toFixed(0) + "%" : "-";
    console.log(`    ${opis.padEnd(36)} ${String(skup.length).padStart(6)} zgrada, DGU ima ${String(n).padStart(6)} (${pct})`);
  });

  ispisiAtribute();

  // Ako medju NASIM zgradama ima ijedna oznacena kao "u izgradnji", to je
  // izravan sluzbeni podatak o novogradnji.
  const uIzgradnji = nase.filter((z) => z.dguStanje && /underConstruction|projected/i.test(z.dguStanje));
  if (uIzgradnji.length) {
    console.log(`\n  NASE ZGRADE OZNACENE KAO U IZGRADNJI ILI PLANIRANE: ${uIzgradnji.length}`);
    uIzgradnji.slice(0, 10).forEach((z) =>
      console.log(`     ${z.id}  ${z.zupanija.slice(0, 24).padEnd(26)} ${z.dguStanje}  ${z.dguDatum || ""}`));
  }

  console.log(`\n  Ako "stara" ima visok postotak, a "kandidat" nizak, DGU potvrdjuje`);
  console.log(`  satelitsku provjeru i moze je zamijeniti ondje gdje ortofoto ne postoji.`);
  console.log(`  Poseban pogled je skupina "nema_snimke" - za nju je DGU jedini izvor.\n`);
}

main().catch((err) => {
  console.error("\nProba pukla:", err.message);
  process.exit(1);
});
