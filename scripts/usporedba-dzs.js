// Koliko nam izmice? Usporedba nasih nalaza sa sluzbenom statistikom.
//
// DZS svake godine popise SVE zavrsene zgrade u Hrvatskoj, i to fizickim
// obilaskom terena preko upravnih tijela zupanija. To je najbliza stvar
// istini koja postoji - i jedini nacin da izmjerimo vlastitu pokrivenost.
//
// Skripta nista ne mijenja u repozitoriju, samo ispisuje usporedbu.
//
// Izvor: DZS, Priopcenje GRAD-2025-2-1 "Zavrsene zgrade i stanovi u 2024."
// objavljeno 26. rujna 2025., tablica 6.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "data", "zgrade", "manifest.json");

// Broj zavrsenih zgrada u 2024., po zupanijama (DZS, tablica 6).
// "stambene" izdvajamo jer su za telekom jedine zanimljive - nestambene su
// hale, skladista i nadstresnice.
const DZS_2024 = {
  "Zagrebačka":              { ukupno: 622,  stambene: 512 },
  "Krapinsko-zagorska":      { ukupno: 223,  stambene: 144 },
  "Sisačko-moslavačka":      { ukupno: 124,  stambene: 88 },
  "Karlovačka":              { ukupno: 127,  stambene: 100 },
  "Varaždinska":             { ukupno: 298,  stambene: 201 },
  "Koprivničko-križevačka":  { ukupno: 131,  stambene: 89 },
  "Bjelovarsko-bilogorska":  { ukupno: 112,  stambene: 69 },
  "Primorsko-goranska":      { ukupno: 447,  stambene: 420 },
  "Ličko-senjska":           { ukupno: 176,  stambene: 141 },
  "Virovitičko-podravska":   { ukupno: 77,   stambene: 24 },
  "Požeško-slavonska":       { ukupno: 82,   stambene: 52 },
  "Brodsko-posavska":        { ukupno: 236,  stambene: 192 },
  "Zadarska":                { ukupno: 1095, stambene: 1022 },
  "Osječko-baranjska":       { ukupno: 337,  stambene: 252 },
  "Šibensko-kninska":        { ukupno: 94,   stambene: 90 },
  "Vukovarsko-srijemska":    { ukupno: 165,  stambene: 86 },
  "Splitsko-dalmatinska":    { ukupno: 809,  stambene: 771 },
  "Istarska":                { ukupno: 1239, stambene: 1156 },
  "Dubrovačko-neretvanska":  { ukupno: 180,  stambene: 160 },
  "Međimurska":              { ukupno: 225,  stambene: 172 },
  "Grad Zagreb":             { ukupno: 641,  stambene: 602 },
};

// Nazivi zupanija u nasim podacima imaju sufiks "zupanija", DZS ga nema.
function normaliziraj(naziv) {
  if (!naziv) return null;
  return naziv.replace(/\s*županija\s*$/i, "").trim();
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const zgrade = new Map();
  manifest.entries.forEach((e) => {
    const p = path.join(REPO_ROOT, e.file);
    if (!fs.existsSync(p)) return;
    (JSON.parse(fs.readFileSync(p, "utf8")).features || []).forEach((f) => {
      if (!zgrade.has(f.id)) zgrade.set(f.id, f);
    });
  });

  // Koliko je nas sustav vidio, po zupanijama.
  const nase = {};
  let bezZupanije = 0;
  zgrade.forEach((f) => {
    const z = normaliziraj(f.zupanija);
    if (!z) { bezZupanije++; return; }
    if (!nase[z]) nase[z] = { ukupno: 0, kandidat: 0, stara: 0, neprovjereno: 0 };
    nase[z].ukupno++;
    const s = (f.satelitProvjera || {}).status;
    if (s === "kandidat") nase[z].kandidat++;
    else if (s === "stara") nase[z].stara++;
    else nase[z].neprovjereno++;
  });

  // Koliko dugo uopce pratimo? Bez toga usporedba s godisnjom brojkom nema smisla.
  const datumi = manifest.entries.map((e) => e.to).filter(Boolean).sort();
  const prvi = new Date(datumi[0]);
  const zadnji = new Date(datumi[datumi.length - 1]);
  const danaPracenja = Math.max(1, Math.round((zadnji - prvi) / 86400000));
  const udioGodine = danaPracenja / 365;

  console.log(`\n${"=".repeat(78)}`);
  console.log(`KOLIKO NAM IZMICE - usporedba sa sluzbenom statistikom`);
  console.log(`${"=".repeat(78)}\n`);
  console.log(`Pratimo od ${datumi[0].slice(0, 10)} do ${datumi[datumi.length - 1].slice(0, 10)}`);
  console.log(`= ${danaPracenja} dana, dakle ${(udioGodine * 100).toFixed(0)}% jedne godine.\n`);
  console.log(`DZS je u 2024. popisao 7.440 zavrsenih zgrada, od toga 6.343 stambene.`);
  console.log(`Razmjerno nasem razdoblju, ocekivali bismo oko ${Math.round(6343 * udioGodine)} novih stambenih zgrada.\n`);

  const redak = (a, b, c, d, e2, f2) =>
    String(a).padEnd(24) + String(b).padStart(7) + String(c).padStart(9) +
    String(d).padStart(10) + String(e2).padStart(11) + String(f2).padStart(9);

  console.log(redak("Zupanija", "DZS", "ocekiv.", "nasih", "kandidata", "pokriv."));
  console.log("-".repeat(78));

  let sumaOcekivano = 0, sumaKandidata = 0, sumaNasih = 0;
  const redovi = Object.keys(DZS_2024).map((zup) => {
    const dzs = DZS_2024[zup];
    const n = nase[zup] || { ukupno: 0, kandidat: 0, stara: 0, neprovjereno: 0 };
    const ocekivano = dzs.stambene * udioGodine;
    sumaOcekivano += ocekivano;
    sumaKandidata += n.kandidat;
    sumaNasih += n.ukupno;
    return { zup, dzs, n, ocekivano, pokrivenost: ocekivano > 0 ? (100 * n.kandidat / ocekivano) : 0 };
  }).sort((a, b) => b.dzs.stambene - a.dzs.stambene);

  redovi.forEach((r) => {
    console.log(redak(
      r.zup.slice(0, 23),
      r.dzs.stambene,
      Math.round(r.ocekivano),
      r.n.ukupno,
      r.n.kandidat,
      r.pokrivenost.toFixed(0) + "%"
    ));
  });

  console.log("-".repeat(78));
  console.log(redak("UKUPNO", 6343, Math.round(sumaOcekivano), sumaNasih, sumaKandidata,
    (100 * sumaKandidata / sumaOcekivano).toFixed(0) + "%"));
  if (bezZupanije) console.log(`\n(${bezZupanije} zgrada bez upisane zupanije, izostavljene)`);

  // ---------- Tumacenje ----------
  const pokrivenost = 100 * sumaKandidata / sumaOcekivano;
  const neprovjereno = Object.values(nase).reduce((s, x) => s + x.neprovjereno, 0);

  console.log(`\n${"-".repeat(78)}`);
  console.log(`STO OVO ZNACI\n`);
  console.log(`Nasih "kandidata" ima ${sumaKandidata}, a razmjerno razdoblju koje pratimo`);
  console.log(`ocekivalo bi se oko ${Math.round(sumaOcekivano)} stvarno zavrsenih stambenih zgrada.`);
  console.log(`Pokrivenost je dakle oko ${pokrivenost.toFixed(0)}%.\n`);
  console.log(`ALI: jos ${neprovjereno.toLocaleString("hr-HR")} nasih zgrada nije proslo satelitsku provjeru.`);
  if (neprovjereno > 0) {
    const stopa = sumaKandidata / Math.max(1, (sumaNasih - neprovjereno));
    console.log(`Uz dosadasnju stopu od ${(100 * stopa).toFixed(1)}% kandidata medju provjerenima,`);
    console.log(`ocekuje se jos oko ${Math.round(neprovjereno * stopa)} kandidata kad provjera zavrsi.`);
    console.log(`To bi pokrivenost podiglo na oko ${(100 * (sumaKandidata + neprovjereno * stopa) / sumaOcekivano).toFixed(0)}%.`);
  }
  console.log(`\nOprez pri tumacenju:`);
  console.log(`- DZS broji zgrade zavrsene u 2024.; nase se pojavljuju u OSM-u s kasnjenjem`);
  console.log(`  od nekoliko mjeseci do nekoliko godina, pa se razdoblja ne poklapaju tocno.`);
  console.log(`- DZS u zgrade ubraja i nadstresnice i podzemne garaze.`);
  console.log(`- Nasi "kandidati" nisu potvrdjene novogradnje nego zgrade kojih nema`);
  console.log(`  na ortofotu 2023./24. - dio njih moze biti i starije od toga.\n`);
}

main();
