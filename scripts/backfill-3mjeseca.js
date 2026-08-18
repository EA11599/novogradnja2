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

// Pronalazi sljedeću "prazninu" u pokrivenosti počevši od zadanog datuma -
// ne oslanja se samo na "najraniji zapis" jer to daje POGREŠAN odgovor
// nakon djelomičnog (prekinutog) backfilla: ako je backfill stao na pola
// (npr. 18.5.-27.5. gotovo, 27.5.-20.7. još nedostaje), "najraniji zapis"
// bi bio 18.5. - isti kao ciljani početak - pa bi skripta pogrešno
// zaključila da je sve gotovo i preskočila preostalu prazninu bez ikakvog
// upozorenja. Ovo umjesto toga stvarno prolazi kroz sortiranu vremensku
// liniju i traži prvi pravi prekid pokrivenosti.
function pronadjiSljedecuPrazninu(manifest, pocetakTrazenja, krajTrazenja) {
  const sortirano = [...manifest.entries].sort((a, b) => new Date(a.from) - new Date(b.from));
  let pokazivac = new Date(pocetakTrazenja);

  for (const e of sortirano) {
    const eFrom = new Date(e.from);
    const eTo = new Date(e.to);
    if (eFrom > pokazivac) {
      // Praznina pronađena - od pokazivača do početka ovog zapisa.
      const prazninaTo = eFrom < krajTrazenja ? eFrom : krajTrazenja;
      return { from: pokazivac, to: prazninaTo };
    }
    if (eTo > pokazivac) pokazivac = eTo;
    if (pokazivac >= krajTrazenja) break;
  }

  if (pokazivac < krajTrazenja) return { from: pokazivac, to: krajTrazenja };
  return null; // nema praznine - potpuno pokriveno
}

async function main() {
  const manifest = loadManifest();
  const zupanije = loadZupanije();

  if (manifest.entries.length === 0) {
    console.log("Manifest je prazan - normalan tjedni pipeline će sam pokriti početni period, backfill nije potreban.");
    return;
  }

  const pocetakBackfilla = new Date();
  pocetakBackfilla.setUTCMonth(pocetakBackfilla.getUTCMonth() - 3);

  // Krajnja granica traženja praznine - trenutak kad su počeli POUZDANO
  // kontinuirani (ne-backfillani) podaci. Uzimamo najkasniji "from" među
  // zapisima koji NISU dio backfilla (heuristika: prije prvog pokretanja
  // ove skripte) nije pouzdano odrediti, pa umjesto toga jednostavno
  // tražimo prazninu do "sada" - ako već postoji kontinuirana pokrivenost
  // do trenutnog vremena, praznina se neće naći.
  const sada = new Date();

  const praznina = pronadjiSljedecuPrazninu(manifest, pocetakBackfilla, sada);
  if (!praznina) {
    console.log("Već imamo kontinuiranu pokrivenost za zadnja 3 mjeseca - backfill nije potreban.");
    return;
  }

  console.log(`Backfill period (praznina u pokrivenosti): ${praznina.from.toISOString()} -> ${praznina.to.toISOString()}`);

  let tekuciFrom = new Date(praznina.from);
  const krajBackfilla = new Date(praznina.to);
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

    manifest.entries.sort((a, b) => new Date(a.to) - new Date(b.to));
    saveManifest(manifest);

    tekuciFrom = tekuciTo;
  }

  pruneOldEntries(manifest);
  saveManifest(manifest);

  console.log(`\nOvaj dio backfilla gotov. Manifest sad ima ${manifest.entries.length} zapisa. Pokreni skriptu ponovno da provjeriš ima li još praznina (npr. ako je Overpass rušio upite usred ovog pokretanja).`);
}

main().catch((err) => {
  console.error("Backfill pukao:", err.message);
  process.exit(1);
});
