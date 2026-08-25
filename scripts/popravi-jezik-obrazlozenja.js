// Prepravlja postojeca obrazlozenja satelitske provjere na hrvatski standardni
// jezik.
//
// ZASTO: model je do 24.8.2026. odgovarao mjesavinom hrvatskog i srpskog -
// 563 obrazlozenja bilo je cirilicom, a jos vise ekavski ili sa srpskom
// rekcijom ("zgrada SA krovom"). Uputa je u medjuvremenu ispravljena, pa nova
// obrazlozenja izlaze ispravna, ali stara treba popraviti.
//
// Prevodimo SAMO TEKST, bez slika. Zato je ovo desetak puta jeftinije od
// ponovnog pokretanja satelitske provjere: nema ni ponovnog dohvata s DGU
// posluzitelja ni troska za slike.
//
// Skripta je ponovljiva - obrazlozenja koja su vec ispravna preskace.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "data", "zgrade", "manifest.json");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";

// Koliko obrazlozenja saljemo u jednom pozivu. Kratke recenice, pa ih stane
// puno - time se broj poziva smanjuje pedeseterostruko.
const PO_POZIVU = 50;

function argument(ime, zadano) {
  const a = process.argv.find((x) => x.startsWith(`--${ime}=`));
  if (!a) return zadano;
  const v = Number(a.split("=")[1]);
  return Number.isFinite(v) && v > 0 ? v : zadano;
}
const MAX_POZIVA = argument("max", Infinity);
const SAMO_PROBA = process.argv.includes("--proba");

// ---------- Prepoznavanje spornog teksta ----------
// Ne saljemo modelu ono sto je vec u redu. Provjere idu od sigurnih prema
// vjerojatnima.
const CIRILICA = /[\u0400-\u04FF]/;

// Ekavski oblici koji se pojavljuju u ovim obrazlozenjima. Namjerno trazimo
// cijele rijeci da "svetlo" ne uhvati "posvetljeno".
const EKAVICA = /\b(svetl\w*|bel\w*|mest\w*|dvorist\w*|objekat|objekt[ai]?\b|sused\w*|videt\w*|primet\w*|nalazi se zgrada)\b/i;

// Prijedlog "sa" ondje gdje standard trazi "s".
//
// U hrvatskom je "sa" opravdano samo ispred rijeci koje pocinju s, s, z, z
// (sa skolom, sa zenom) te u nekoliko okamenjenih slucajeva ("sa mnom").
// Sve ostalo - "sa krovom", "sa crvenim" - trazi "s".
//
// Prva verzija ovog pravila izuzimala je i suglasnicke skupove, pa je
// promasila najcesci slucaj u nasim podacima: "zgrada sa crvenim krovom".
const SA_KRIVO = /\bsa\s+(?![sšzžSŠZŽ])(?!mnom\b)/i;

// Model je ponegdje spojio engleske rijeci uz hrvatske ("jasnaStructura",
// "vidljivimStructurama"). Prepoznaje se po velikom slovu usred rijeci.
const SPOJENA_RIJEC = /[a-zčćšđž][A-ZČĆŠĐŽ]/;

// Ocito engleski ostaci.
const ENGLESKI = /\b(structure?s?|building|roof|visible|clearly)\b/i;

function trebaPopravak(tekst) {
  if (!tekst) return false;
  return CIRILICA.test(tekst) || EKAVICA.test(tekst) || SA_KRIVO.test(tekst) ||
         SPOJENA_RIJEC.test(tekst) || ENGLESKI.test(tekst);
}

// ---------- Prevodjenje ----------
async function prevediSkupinu(recenice) {
  const upit =
    "Ispod je popis kratkih rečenica koje opisuju što se vidi na zračnoj snimci. " +
    "Neke su pisane srpskim jezikom ili ćirilicom. Prepiši SVAKU na hrvatski standardni jezik, latinicom.\n\n" +
    "Pravila:\n" +
    "- ijekavica: svijetlo, bijelo, mjesto (ne svetlo, belo, mesto)\n" +
    "- prijedlog 's' ispred većine riječi ('s krovom'), 'sa' samo ispred s, š, z, ž ili suglasničkog skupa\n" +
    "- 'građevina' ili 'zgrada' umjesto 'objekat'\n" +
    "- zadrži ISTO značenje i približno istu duljinu, ne dodaji ništa novo\n" +
    "- ako je rečenica već ispravan hrvatski, prepiši je nepromijenjenu\n\n" +
    "Odgovori ISKLJUČIVO JSON poljem stringova, istog redoslijeda i iste duljine kao ulaz, bez ikakvog drugog teksta.\n\n" +
    JSON.stringify(recenice, null, 0);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: upit }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const podaci = await res.json();
  const tekst = (podaci.content || []).map((c) => c.text || "").join("").trim();
  const ocisceno = tekst.replace(/^```json\s*/i, "").replace(/```$/, "").trim();

  let polje;
  try { polje = JSON.parse(ocisceno); } catch (e) {
    throw new Error("Odgovor nije ispravan JSON: " + ocisceno.slice(0, 200));
  }
  if (!Array.isArray(polje) || polje.length !== recenice.length) {
    throw new Error(`Odgovor ima ${Array.isArray(polje) ? polje.length : "?"} stavki, ocekivano ${recenice.length}`);
  }
  return polje;
}

// ---------- Glavni tok ----------
async function main() {
  if (!ANTHROPIC_API_KEY && !SAMO_PROBA) throw new Error("Nedostaje ANTHROPIC_API_KEY.");

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  // Skupimo sve sporne recenice iz svih datoteka. Iste recenice prevodimo
  // samo jednom, pa rezultat primijenimo svugdje gdje se pojavljuju.
  const sporne = new Map(); // tekst -> broj pojavljivanja
  let ukupno = 0;

  manifest.entries.forEach((e) => {
    const p = path.join(REPO_ROOT, e.file);
    if (!fs.existsSync(p)) return;
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    (d.features || []).forEach((f) => {
      const o = (f.satelitProvjera || {}).obrazlozenje;
      if (!o) return;
      ukupno++;
      if (trebaPopravak(o)) sporne.set(o, (sporne.get(o) || 0) + 1);
    });
  });

  const jedinstvene = [...sporne.keys()];
  const pogodjeno = [...sporne.values()].reduce((a, b) => a + b, 0);

  console.log(`Obrazlozenja ukupno:        ${ukupno.toLocaleString("hr-HR")}`);
  console.log(`Treba popravak:             ${pogodjeno.toLocaleString("hr-HR")}  (${(100 * pogodjeno / ukupno).toFixed(1)}%)`);
  console.log(`Jedinstvenih za prijevod:   ${jedinstvene.length.toLocaleString("hr-HR")}`);
  console.log(`Poziva prema API-ju:        ${Math.ceil(jedinstvene.length / PO_POZIVU)}\n`);

  if (jedinstvene.length === 0) { console.log("Nema sto popraviti."); return; }

  console.log("PRIMJERI SPORNIH:");
  jedinstvene.slice(0, 5).forEach((t) => console.log(`   ${t.slice(0, 110)}`));

  if (SAMO_PROBA) {
    console.log("\n--proba: stajem prije prevodjenja, nista nije promijenjeno.");
    return;
  }

  // ---------- Prijevod ----------
  const prijevodi = new Map();
  let poziv = 0;
  for (let i = 0; i < jedinstvene.length; i += PO_POZIVU) {
    if (poziv >= MAX_POZIVA) { console.log(`\nDosegnut limit od ${MAX_POZIVA} poziva - stajem.`); break; }
    const skupina = jedinstvene.slice(i, i + PO_POZIVU);
    poziv++;
    try {
      const rezultat = await prevediSkupinu(skupina);
      skupina.forEach((izvor, idx) => {
        const novi = String(rezultat[idx] || "").trim();
        if (novi) prijevodi.set(izvor, novi);
      });
      console.log(`  poziv ${poziv}/${Math.ceil(jedinstvene.length / PO_POZIVU)}: prevedeno ${skupina.length}`);
    } catch (err) {
      console.log(`  poziv ${poziv}: NEUSPJEH (${err.message.slice(0, 120)}) - skupina preskocena`);
    }
  }

  // ---------- Upis ----------
  let promijenjeno = 0;
  manifest.entries.forEach((e) => {
    const p = path.join(REPO_ROOT, e.file);
    if (!fs.existsSync(p)) return;
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    let dirnuto = false;
    (d.features || []).forEach((f) => {
      const s = f.satelitProvjera;
      if (!s || !s.obrazlozenje) return;
      const novi = prijevodi.get(s.obrazlozenje);
      if (novi && novi !== s.obrazlozenje) {
        s.obrazlozenje = novi;
        dirnuto = true;
        promijenjeno++;
      }
    });
    if (dirnuto) fs.writeFileSync(p, JSON.stringify(d, null, 2));
  });

  console.log(`\nPromijenjeno obrazlozenja: ${promijenjeno.toLocaleString("hr-HR")}`);

  const primjeri = [...prijevodi.entries()].slice(0, 5);
  if (primjeri.length) {
    console.log(`\nPRIMJERI PRIJEVODA:`);
    primjeri.forEach(([a, b]) => {
      console.log(`   prije: ${a.slice(0, 100)}`);
      console.log(`   posli: ${b.slice(0, 100)}\n`);
    });
  }
}

main().catch((err) => {
  console.error("Popravak jezika pukao:", err.message);
  process.exit(1);
});
