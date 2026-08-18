// Jednokratni backfill: popunjava nedostajući period između "3 mjeseca
// unatrag od danas" i najranijeg postojećeg zapisa u manifestu. Koristi
// ISTU, već testiranu pipeline logiku (dvoprolazni Overpass dohvat, DGU
// spajanje, najbliža cesta, detekcija masovnog unosa) iz fetch-zgrade.js -
// ne duplicira kod.
//
// VAŽNO: manifest.entries se puni KRONOLOŠKI STARIJIM zapisima na kraj
// niza (jer obradiJedanKomad uvijek radi push, ne insert) - zato na kraju
// SORTIRAMO cijeli niz po datumu prije spremanja. Bez toga bi "zadnji
// zapis = najnoviji" pretpostavka (koju koristi frontend i ostale skripte
// za "zadnjih 7 dana" prozor) bila pogrešna.
//
// Pokreće se ručno: node scripts/backfill-3mjeseca.js

const {
  loadManifest,
  saveManifest,
  loadZupanije,
  normalizeTimestamp,
  obradiJedanKomad,
  pruneOldEntries,
  MAX_DANA_PO_UPITU,
} = require("./fetch-zgrade");

async function main() {
  const manifest = loadManifest();
  const zupanije = loadZupanije();

  if (manifest.entries.length === 0) {
    console.log("Manifest je prazan - normalan tjedni pipeline će sam pokriti početni period, backfill nije potreban.");
    return;
  }

  const najraniji = manifest.entries.reduce((min, e) => (new Date(e.from) < new Date(min.from) ? e : min));
  const krajBackfilla = new Date(najraniji.from); // do ovoga već imamo podatke

  const pocetakBackfilla = new Date();
  pocetakBackfilla.setUTCMonth(pocetakBackfilla.getUTCMonth() - 3);

  if (pocetakBackfilla >= krajBackfilla) {
    console.log("Već imamo podatke za zadnja 3 mjeseca (ili više) - backfill nije potreban.");
    console.log(`Najraniji postojeći zapis: ${najraniji.from}, ciljani početak: ${pocetakBackfilla.toISOString()}`);
    return;
  }

  console.log(`Backfill period: ${pocetakBackfilla.toISOString()} -> ${krajBackfilla.toISOString()}`);
  console.log(`(Postojeći podaci pokrivaju od ${najraniji.from} nadalje - ne diramo taj dio.)`);

  let tekuciFrom = new Date(pocetakBackfilla);
  while (tekuciFrom < krajBackfilla) {
    let tekuciTo = new Date(tekuciFrom);
    tekuciTo.setUTCDate(tekuciTo.getUTCDate() + MAX_DANA_PO_UPITU);
    if (tekuciTo > krajBackfilla) tekuciTo = krajBackfilla;

    await obradiJedanKomad(
      normalizeTimestamp(tekuciFrom),
      normalizeTimestamp(tekuciTo),
      manifest,
      zupanije
    );

    // KRITIČNO: sortiraj i spremi nakon SVAKOG komada, ne tek na kraju -
    // obradiJedanKomad gura starije zapise na kraj niza (push), a backfill
    // je dugotrajan (~20 komada) pa se lako može prekinuti na pola. Bez
    // ovoga bi prekid ostavio manifest u nesortiranom stanju, kvareći
    // "zadnji zapis = najnoviji" pretpostavku koju frontend i ostale
    // skripte koriste za "zadnjih 7 dana" prozor.
    manifest.entries.sort((a, b) => new Date(a.to) - new Date(b.to));
    saveManifest(manifest);

    tekuciFrom = tekuciTo;
  }

  pruneOldEntries(manifest);
  saveManifest(manifest);

  console.log(`\nBackfill gotov. Manifest sad ima ${manifest.entries.length} zapisa.`);
}

main().catch((err) => {
  console.error("Backfill pukao:", err.message);
  process.exit(1);
});
