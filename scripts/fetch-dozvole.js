// Dnevni pipeline za praćenje izdanih dozvola preko eDozvola oglasne ploče.
// Pokreće se preko GitHub Actions (vidi .github/workflows/dnevni-pipeline.yml),
// ali radi identično i lokalno: `npm install && npm run fetch`
//
// STATUS DIJELOVA (29.07.2026):
//   ✅ POTVRĐENO RADI:  case-acts/search (lista dozvola, ne treba PDF)
//   ✅ POTVRĐENO RADI:  regex ekstrakcija adrese/tipa iz teksta PDF-a
//   ⚠️  NEPOTVRĐENO:    mehanički dohvat SADRŽAJA PDF-a bez ljudskog klika
//                       (vidi fetchDocumentBuffer ispod — ima fallback ako ne uspije)

const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

const API_BASE = "https://edozvola.gov.hr/api";
const DATA_DIR = path.join(__dirname, "..", "data", "dozvole");
const DNEVNIK_PATH = path.join(DATA_DIR, "dnevnik.json");
const MANIFEST_PATH = path.join(DATA_DIR, "manifest.json");

// Vrste akata koje želimo zadržati u listi. Sve ostalo (javni pozivi,
// rješenja o izmjeni i sl.) se odbacuje. Lako proširiti/skratiti.
const RELEVANT_ACT_TYPES = new Set([
  "Građevinska dozvola",
  "Lokacijska dozvola",
  "Uporabna dozvola",
]);

// Regex obrazac potvrđen na stvarnom primjeru rješenja:
// "na k.č.br. X, K.O. Y – lokacija; Z"
const LOCATION_PATTERN =
  /na k\.č\.br\.\s*([\d/]+),\s*K\.O\.\s*([A-ZŠĐČĆŽ ]+)\s*[–-]\s*lokacija;\s*(.+?)(?:,\s*u skladu\b|\.\s|\n|$)/is;
const BUILDING_TYPE_PATTERN =
  /–\s*(izgradnja|rekonstrukcija)[^,]*,\s*([\d.]+[a-z]?)\s*skupine/i;

function isCompany(name) {
  return /d\.o\.o\.|j\.d\.o\.o\.|d\.d\.|obrt|j\.t\.d\./i.test(name || "");
}

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// --- KORAK 1: Lista akata (potvrđeno radi, nema CORS problema server-side) ---
async function fetchCaseActsPage(page, size = 50) {
  const url =
    `${API_BASE}/cases/case-acts/search?page=${page}&size=${size}` +
    `&column=createdDate&direction=desc&searchParam=`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`case-acts/search vratio status ${res.status}`);
  return res.json();
}

// Dohvaća sve nove akte dok ne naiđe na već obrađeni idCaseAct (dedupe)
// ili dok ne prođe kroz razuman broj stranica (sigurnosna kočnica).
async function fetchNewCaseActs(seenIds, maxPages = 20) {
  const collected = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await fetchCaseActsPage(page);
    if (!data.content || data.content.length === 0) break;

    let hitKnown = false;
    for (const item of data.content) {
      if (seenIds.has(item.idCaseAct)) {
        hitKnown = true;
        continue;
      }
      if (RELEVANT_ACT_TYPES.has(item.name)) {
        collected.push(item);
      }
    }
    if (hitKnown || data.last) break;

    // Pristojna pauza prema serveru između stranica.
    await new Promise((r) => setTimeout(r, 500));
  }
  return collected;
}

// --- KORAK 2: Sadržaj PDF-a — OVO JE NEPOTVRĐENI DIO ---
//
// Poznato: GET /api/cases/case-acts/{id}/preview-file vraća JSON oblika
//   { "url": "/document-preview/case-act/{uuid}", ... }
// a ta ruta je frontend (SPA) stranica, ne sirovi PDF. Kad je otvorena
// "hladno" (bez postojeće anonimne sesije iz normalnog učitavanja stranice),
// preusmjerava na NIAS prijavu — testirano i potvrđeno.
//
// Moguće da postoji zaseban API poziv koji ta SPA stranica interno radi da
// dohvati stvarni sadržaj (npr. base64 ili blob) koristeći anonimni token
// koji aplikacija sama sebi dodijeli pri učitavanju (vidjeli smo pozive
// poput "authenticate-public-user", "init?client_id=edozvolaPublicCli...").
// Taj poziv NIJE identificiran — sljedeći korak prije nego se ovo osloni na
// automatizaciju je otvoriti jedan dokument normalno (ne hladno) i pogledati
// Network tab ZA VRIJEME prikaza PDF-a, ne za vrijeme klika na ikonu.
//
// Dok se to ne potvrdi, funkcija pokušava direktan pristup i JASNO javlja
// neuspjeh po stavci, umjesto da tiho vrati prazne podatke.
async function fetchDocumentText(idCaseAct) {
  try {
    const previewRes = await fetch(
      `${API_BASE}/cases/case-acts/${idCaseAct}/preview-file`,
      { headers: { Accept: "application/json" } }
    );
    if (!previewRes.ok) return { text: null, reason: `preview-file status ${previewRes.status}` };
    const preview = await previewRes.json();
    if (!preview.url) return { text: null, reason: "preview-file nema 'url' polje" };

    const docRes = await fetch(`https://edozvola.gov.hr${preview.url}`);
    const contentType = docRes.headers.get("content-type") || "";

    if (contentType.includes("application/pdf")) {
      const buf = Buffer.from(await docRes.arrayBuffer());
      const parsed = await pdfParse(buf);
      return { text: parsed.text, reason: null };
    }

    // Nije PDF (vjerojatno HTML stranica prijave/SPA shell) — poznati neuspjeh.
    return { text: null, reason: `document-preview nije vratio PDF (content-type: ${contentType})` };
  } catch (err) {
    return { text: null, reason: `greška: ${err.message}` };
  }
}

// --- KORAK 3: Geokodiranje adrese (Nominatim, besplatan OSM geokoder) ---
//
// Poštivanje Nominatim uvjeta korištenja: max 1 zahtjev/sekundi, vlastiti
// User-Agent koji identificira aplikaciju. VAŽNO: prije pravog korištenja
// zamijeni "kontakt@tvoja-domena.hr" ispod stvarnim kontaktom — Nominatim
// blokira zahtjeve s generičkim/lažnim User-Agentom.
const NOMINATIM_USER_AGENT = "dozvole-pipeline/1.0 (kontakt@tvoja-domena.hr)";

async function geocodeAddress(addressText) {
  try {
    const query = encodeURIComponent(`${addressText}, Hrvatska`);
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=hr&q=${query}`;
    const res = await fetch(url, { headers: { "User-Agent": NOMINATIM_USER_AGENT } });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results.length) return null;
    return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
  } catch {
    return null;
  }
}

function extractFromPdfText(pdfText) {
  const locMatch = pdfText.match(LOCATION_PATTERN);
  const typeMatch = pdfText.match(BUILDING_TYPE_PATTERN);
  if (!locMatch) return null;
  const [, cadastralParcel, cadastralMunicipality, addressText] = locMatch;
  return {
    cadastralParcel: cadastralParcel.trim(),
    cadastralMunicipality: cadastralMunicipality.trim(),
    address: addressText.trim(),
    buildingType: typeMatch ? `${typeMatch[1]}, skupina ${typeMatch[2]}` : null,
  };
}

// --- Glavni tijek ---
async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const dnevnik = loadJson(DNEVNIK_PATH, []);
  const manifest = loadJson(MANIFEST_PATH, { lastRun: null, totalEntries: 0 });
  const seenIds = new Set(dnevnik.map((d) => d.idCaseAct));

  console.log(`Postojeći dnevnik: ${dnevnik.length} zapisa. Tražim nove...`);

  const newActs = await fetchNewCaseActs(seenIds);
  console.log(`Pronađeno ${newActs.length} novih relevantnih akata.`);

  for (const act of newActs) {
    const { text, reason } = await fetchDocumentText(act.idCaseAct);
    const extracted = text ? extractFromPdfText(text) : null;

    let coordinates = null;
    if (extracted?.address) {
      // Pauza PRIJE geokodiranja — poštuje Nominatim ograničenje od 1 zahtjeva/s,
      // odvojeno od pauze prema edozvola.gov.hr niže u petlji.
      await new Promise((r) => setTimeout(r, 1100));
      coordinates = await geocodeAddress(extracted.address);
      if (!coordinates) {
        console.warn(`  ⚠ Geokodiranje nije uspjelo za: ${extracted.address}`);
      }
    }

    const entry = {
      idCaseAct: act.idCaseAct,
      classification: act.classification,
      actType: act.name,
      createdDate: act.createdDate,
      roughLocation: act.locations || null,
      applicant: isCompany(act.applicantName) ? act.applicantName : "Privatni investitor",
      address: extracted?.address || null,
      buildingType: extracted?.buildingType || null,
      cadastralParcel: extracted?.cadastralParcel || null,
      cadastralMunicipality: extracted?.cadastralMunicipality || null,
      coordinates: coordinates,
      documentStatus: text ? (extracted ? "ok" : "pdf_bez_prepoznatog_obrasca") : "pdf_nedostupan",
      documentIssue: reason,
      noticeBoardUrl: "https://edozvola.gov.hr/notice-board",
    };

    dnevnik.push(entry);
    seenIds.add(act.idCaseAct);

    if (!text) {
      console.warn(`  ⚠ ${act.classification}: ${reason}`);
    }

    // Pristojna pauza prije sljedećeg PDF poziva.
    await new Promise((r) => setTimeout(r, 800));
  }

  dnevnik.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));

  saveJson(DNEVNIK_PATH, dnevnik);
  saveJson(MANIFEST_PATH, {
    lastRun: new Date().toISOString(),
    totalEntries: dnevnik.length,
    newThisRun: newActs.length,
  });

  console.log(`Gotovo. Dnevnik sad ima ${dnevnik.length} zapisa (+${newActs.length} novih).`);
}

main().catch((err) => {
  console.error("Pipeline pao s greškom:", err);
  process.exit(1);
});
