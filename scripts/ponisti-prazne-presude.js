// Ponistava satelitske presude donesene na PRAZNOJ snimci.
//
// STO SE DOGODILO (25.8.2026.): DGU nema ortofoto pokrivenost svugdje. Ondje
// gdje je nema, WMS vraca jednobojnu bijelu sliku. Model je takvu sliku
// tumacio kao "prazno zemljiste, nema zgrade" i proglasavao je kandidatom za
// novogradnju.
//
// Posljedica je bila vidljiva u usporedbi s DZS statistikom: Medjimurska
// zupanija imala je 154 kandidata, a DZS za cijelu 2024. biljezi 172 zavrsene
// stambene zgrade u toj zupaniji. Tako nesto nije moguce.
//
// Ova skripta pronalazi takve zapise po tekstu obrazlozenja i ponistava im
// presudu, pa ih satelitska provjera moze ponoviti - sad s ispravljenom
// uputom koja prepoznaje praznu snimku.
//
// Pokretanje:
//   node scripts/ponisti-prazne-presude.js --proba    (samo prebroji)
//   node scripts/ponisti-prazne-presude.js            (ponisti)

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "data", "zgrade", "manifest.json");
const SAMO_PROBA = process.argv.includes("--proba");

// KOJE PRESUDE PONISTAVAMO
//
// Prvo sam pokusao prepoznati sporne po tekstu obrazlozenja, ali to ne radi:
// model istim rijecima ("prazna povrsina bez vidljivih gradjevina") opisuje i
// praznu bijelu plocicu i stvarnu oranicu. Iz teksta se to ne da razluciti.
//
// Zato ponistavamo SVE presude "kandidat" i "neizvjesno" i pustamo provjeru da
// odluci iznova - sad s uputom koja izricito razlikuje "vidim prazno
// zemljiste" od "nemam sto vidjeti".
//
// Presude "stara" ne diramo: da je snimka bila prazna, model ne bi mogao
// opisati krovove i gradjevine.
//
// Kandidata je oko 230, pa ponovna provjera stoji nekoliko centi.
const ZA_PONISTITI = new Set(["kandidat", "neizvjesno"]);

function trebaPonistiti(sp) {
  return sp && ZA_PONISTITI.has(sp.status);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  let pregledano = 0;
  const pogodjeni = [];

  manifest.entries.forEach((e) => {
    const p = path.join(REPO_ROOT, e.file);
    if (!fs.existsSync(p)) return;
    const podaci = JSON.parse(fs.readFileSync(p, "utf8"));
    let dirnuto = false;

    (podaci.features || []).forEach((f) => {
      const sp = f.satelitProvjera;
      if (!sp) return;
      pregledano++;
      if (!trebaPonistiti(sp)) return;

      pogodjeni.push({
        id: f.id,
        zupanija: f.zupanija || "?",
        stariStatus: sp.status,
        obrazlozenje: sp.obrazlozenje || "(bez obrazlozenja)",
      });

      if (!SAMO_PROBA) {
        delete f.satelitProvjera;
        dirnuto = true;
      }
    });

    if (dirnuto) fs.writeFileSync(p, JSON.stringify(podaci, null, 2));
  });

  // ---------- Izvjestaj ----------
  const poZupaniji = {};
  const poStatusu = {};
  pogodjeni.forEach((x) => {
    poZupaniji[x.zupanija] = (poZupaniji[x.zupanija] || 0) + 1;
    poStatusu[x.stariStatus] = (poStatusu[x.stariStatus] || 0) + 1;
  });

  console.log(`\nPregledano presuda:        ${pregledano.toLocaleString("hr-HR")}`);
  console.log(`Za ponovnu provjeru:        ${pogodjeni.length.toLocaleString("hr-HR")}\n`);

  console.log("PO STARIM STATUSIMA:");
  Object.entries(poStatusu).sort((a, b) => b[1] - a[1])
    .forEach(([s, n]) => console.log(`   ${String(s).padEnd(14)} ${n}`));

  console.log("\nPO ŽUPANIJAMA:");
  Object.entries(poZupaniji).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([z, n]) => console.log(`   ${z.slice(0, 28).padEnd(30)} ${n}`));

  console.log("\nPRIMJERI:");
  pogodjeni.slice(0, 5).forEach((x) =>
    console.log(`   [${x.stariStatus}] ${x.obrazlozenje.slice(0, 95)}`));

  if (SAMO_PROBA) {
    console.log("\n--proba: nista nije promijenjeno.");
  } else {
    console.log(`\nPonisteno ${pogodjeni.length} presuda. Pokreni satelitsku provjeru da ih obradi iznova.`);
  }
}

main();
