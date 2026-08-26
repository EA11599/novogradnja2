// Gradi laki indeks za terenski ekran (teren.html).
//
// ZASTO POSTOJI: podaci u data/zgrade zauzimaju oko 23 MB. Tehnicar na terenu
// treba samo znati koje su zgrade blizu njega i koja im je adresa - obris,
// oznake, satelitska provjera i ostalo mu ne trebaju dok stoji pred kucom.
// Ovaj indeks sadrzi po zgradi samo ono nuzno i time pada na oko 2 MB, sto
// GitHub Pages jos i gzipa na nekoliko stotina kilobajta.
//
// Pokrece se na kraju tjednog pipelinea, poslije dgu-osm-krizne-provjere,
// da uhvati i DGU adrese koje ona pripise.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const ZGRADE_DIR = path.join(REPO_ROOT, "data", "zgrade");
const MANIFEST_PATH = path.join(ZGRADE_DIR, "manifest.json");
const IZLAZ_PATH = path.join(REPO_ROOT, "data", "teren-indeks.json");

// Koliko tjedana unatrag ulazi u terenski indeks. Zgrada stara godinu dana
// vise nije "novogradnja za provjeru" i samo bi punila popis.
const TJEDANA_UNATRAG = 26;

function adresaZgrade(f) {
  const t = f.tags || {};
  const osm = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
  if (osm) return osm;
  const d = f.dguAdresa || {};
  const dgu = [d.street, d.houseNumber].filter(Boolean).join(" ");
  return dgu || null;
}

function mjestoZgrade(f) {
  const d = f.dguAdresa || {};
  return d.settlement || d.city || null;
}

// Id-evi zgrada koje se pojavljuju medju promjenama na postojecim zgradama.
// Terenski ekran nema pristup tim datotekama, pa mu zastavicu pripremamo ovdje.
function idjeviSPromjenom() {
  const p = path.join(REPO_ROOT, "data", "prosirenja", "manifest.json");
  if (!fs.existsSync(p)) return new Set();
  const manifest = JSON.parse(fs.readFileSync(p, "utf8"));
  const idjevi = new Set();
  (manifest.entries || []).forEach((e) => {
    const f = path.join(REPO_ROOT, e.file);
    if (!fs.existsSync(f)) return;
    (JSON.parse(fs.readFileSync(f, "utf8")).features || []).forEach((x) => idjevi.add(x.id));
  });
  return idjevi;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const sPromjenom = idjeviSPromjenom();
  const granica = new Date(Date.now() - TJEDANA_UNATRAG * 7 * 24 * 3600 * 1000);

  const zgrade = [];
  const vidjeni = new Set();
  let preskoceno = 0;

  manifest.entries.forEach((e) => {
    if (e.to && new Date(e.to) < granica) { preskoceno++; return; }

    const putanja = path.join(REPO_ROOT, e.file);
    if (!fs.existsSync(putanja)) return;
    const podaci = JSON.parse(fs.readFileSync(putanja, "utf8"));

    (podaci.features || []).forEach((f) => {
      if (!f.lat || !f.lon) return;
      if (vidjeni.has(f.id)) return;
      vidjeni.add(f.id);

      // Koordinate na 5 decimala = oko 1 metar. Za "koja je zgrada blizu
      // mene" je to i vise nego dovoljno, a zapis je kraci.
      // Kratki nazivi polja nisu stil nego ustednja: kod 28.000 zgrada
      // razlika izmedju "zupanija" i "z" je vise stotina kilobajta.
      const t = f.tags || {};
      const sp = f.satelitProvjera || {};
      zgrade.push({
        i: f.id,
        y: Math.round(f.lat * 1e5) / 1e5,
        x: Math.round(f.lon * 1e5) / 1e5,
        a: adresaZgrade(f),
        m: mjestoZgrade(f),
        z: f.zupanija || null,
        t: t.building || null,
        k: t["building:levels"] || null,          // katovi
        s: sp.status || null,                      // satelitska presuda
        u: f.masovniUnos ? 1 : 0,                  // masovni unos
        n: f.dguNovaAdresaPoklapanje ? 1 : 0,      // nova DGU adresa na lokaciji
        p: sPromjenom.has(f.id) ? 1 : 0,           // OSM atributna promjena
        d: e.to ? e.to.slice(0, 10) : null,        // kad je detektirana
      });
    });
  });

  const izlaz = {
    generirano: new Date().toISOString(),
    tjedanaUnatrag: TJEDANA_UNATRAG,
    broj: zgrade.length,
    zgrade,
  };

  fs.writeFileSync(IZLAZ_PATH, JSON.stringify(izlaz));
  const mb = fs.statSync(IZLAZ_PATH).size / 1024 / 1024;
  console.log(`Terenski indeks: ${zgrade.length} zgrada, ${mb.toFixed(2)} MB (preskoceno ${preskoceno} starijih datoteka).`);
  console.log(`Spremljeno u: ${IZLAZ_PATH}`);
}

main();
