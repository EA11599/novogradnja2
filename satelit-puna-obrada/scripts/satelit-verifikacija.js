// Jednokratna satelitska verifikacija postojećih "novih" zgrada.
//
// Za svaku zgradu (bez prave OSM adrese, gdje je nesigurnost najveća) uzima
// mali isječak DGU ortofota (2023./24., mozaik dva snimanja - istok/jug 2023.,
// zapad 2024. - anoniman WMS) oko njene lokacije, šalje ga Claude API-ju s
// pitanjem "vidi li se izgrađena zgrada na ovoj snimci?", i sprema rezultat
// na feature kao `satelitProvjera`.
//
// VAŽNO - ograničenje: ovo NE dokazuje da je zgrada nova, samo pouzdano
// isključuje one koje su OČITO postojale već 2023./24. (DGU ortofoto je iz
// tog razdoblja). "Nema zgrade na snimci" = kandidat za stvarnu novogradnju
// (izgrađena nakon snimanja), NE potvrda datuma.
//
// OTPORNOST NA PREKID: posao može trajati preko sat vremena za ~1600
// zgrada, pa se datoteka sprema NAKON SVAKOG KOMADA (batch od BATCH_SIZE
// zgrada), ne samo na kraju - prekid na pola ne gubi dotadašnji rad.
// Ponovno pokretanje je idempotentno (već obrađene zgrade se preskaču).
//
// Pokreće se ručno: ANTHROPIC_API_KEY=... node scripts/satelit-verifikacija.js

const fs = require("fs");
const path = require("path");
const cfg = require("./zgrade-config");

const REPO_ROOT = path.join(__dirname, "..");
const ZGRADE_DIR = path.join(REPO_ROOT, cfg.ZGRADE_DIR);
const MANIFEST_PATH = path.join(ZGRADE_DIR, "manifest.json");

const DGU_WMS_BASE = "https://geoportal.dgu.hr/services/inspire/orthophoto_2023_2024/wms";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// Koliko zgrada obradujemo usporedno. Povecanjem se skracuje trajanje, ali
// se povecava pritisak na API i DGU WMS.
const ZADANI_BATCH = 5;

// ---------- Argumenti naredbenog retka ----------
//
// Bez argumenata skripta radi tocno kao i prije: zadnjih 7 dana. Tako tjedni
// pipeline ostaje nepromijenjen i brz.
//
//   --sve          obradi SVE datoteke iz manifesta, ne samo zadnjih 7 dana
//   --dana=N       vremenski prozor u danima (zadano 7)
//   --max=N        stani nakon N obradjenih zgrada u ovom pokretanju
//   --batch=N      koliko zgrada usporedno (zadano 5)
//
// POVIJEST (ispravljeno 24.8.2026.): skripta je gledala iskljucivo zadnjih 7
// dana, pa su starije datoteke zauvijek ostale neprovjerene - satelitska
// provjera je pokrivala 13% zgrada umjesto svih. Isti kvar imao je i
// backfill-obris.js. Zadano ponasanje je namjerno ostavljeno kakvo je bilo,
// a puna obrada se pokrece rucno s --sve, jer trosi API pozive po zgradi.
function argument(ime, zadano) {
  const a = process.argv.find((x) => x.startsWith(`--${ime}=`));
  if (!a) return zadano;
  const v = Number(a.split("=")[1]);
  return Number.isFinite(v) && v > 0 ? v : zadano;
}
const SVE_DATOTEKE = process.argv.includes("--sve");
const PROZOR_DANA = argument("dana", 7);
const MAX_ZGRADA = argument("max", Infinity);
const BATCH_SIZE = argument("batch", ZADANI_BATCH);

// Koliko komada obradimo prije nego spremimo datoteku. Spremanje nakon svakog
// komada znaci tisuce zapisivanja datoteke od par megabajta - nepotrebno
// sporo kod pune obrade.
const SPREMI_SVAKIH = 10;

// Broji zgrade obradjene u ovom pokretanju, za --max.
let obradjenoUkupno = 0;

if (!ANTHROPIC_API_KEY) {
  console.error("Nedostaje ANTHROPIC_API_KEY environment varijabla.");
  process.exit(1);
}

// ---------- Timeout helper - sprječava beskonačno visenje na mrežnom pozivu ----------

async function fetchSTimeoutom(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Zahtjev nije odgovorio unutar ${timeoutMs / 1000}s (timeout)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Generički retry helper za privremene greške (429/502/503/504) ----------

async function saRetryem(fn, opis, maxPokusaja = 4) {
  let zadnjaGreska;
  for (let pokusaj = 1; pokusaj <= maxPokusaja; pokusaj++) {
    try {
      return await fn();
    } catch (err) {
      zadnjaGreska = err;
      const jePrivremena = /42[89]|50[0234]|timeout/i.test(err.message);
      if (!jePrivremena || pokusaj === maxPokusaja) throw err;
      const pauza = pokusaj * 5000;
      console.log(`    ${opis}: privremena greška (pokušaj ${pokusaj}/${maxPokusaja}), čekam ${pauza / 1000}s: ${err.message.slice(0, 150)}`);
      await new Promise((r) => setTimeout(r, pauza));
    }
  }
  throw zadnjaGreska;
}

// ---------- 1. Otkrivanje točnog naziva WMS sloja (GetCapabilities) ----------

let keširaniNazivSloja = null;

async function otkrijNazivSloja() {
  if (keširaniNazivSloja) return keširaniNazivSloja;

  const url = `${DGU_WMS_BASE}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1`;
  const res = await fetchSTimeoutom(url, { headers: { "User-Agent": cfg.USER_AGENT } });
  if (!res.ok) throw new Error(`GetCapabilities ${res.status} ${res.statusText}`);
  const xml = await res.text();

  const nazivi = [...xml.matchAll(/<Layer[^>]*>\s*<Name>([^<]+)<\/Name>/g)].map((m) => m[1]);
  if (nazivi.length === 0) {
    console.error("Nijedan <Layer><Name> nije pronađen. Prvih 3000 znakova odgovora:");
    console.error(xml.slice(0, 3000));
    throw new Error("Nije moguće otkriti naziv WMS sloja - vidi ispis GetCapabilities odgovora iznad.");
  }
  console.log(`GetCapabilities pronašao slojeve: ${nazivi.join(", ")} - koristim prvi.`);
  keširaniNazivSloja = nazivi[0];
  return keširaniNazivSloja;
}

// ---------- 2. Sastavljanje WMS GetMap URL-a za isječak oko zgrade ----------

function izracunajBbox(lat, lon, poluOpsegM = 25) {
  const dLat = poluOpsegM / 111000;
  const dLon = poluOpsegM / (111000 * Math.cos((lat * Math.PI) / 180));
  return {
    minLon: lon - dLon,
    minLat: lat - dLat,
    maxLon: lon + dLon,
    maxLat: lat + dLat,
  };
}

async function dohvatiIsjecak(lat, lon, nazivSloja) {
  return saRetryem(async () => {
    const bbox = izracunajBbox(lat, lon);
    const params = new URLSearchParams({
      SERVICE: "WMS",
      VERSION: "1.1.1",
      REQUEST: "GetMap",
      LAYERS: nazivSloja,
      STYLES: "",
      FORMAT: "image/png",
      SRS: "EPSG:4326",
      WIDTH: "300",
      HEIGHT: "300",
      BBOX: `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
    });
    const url = `${DGU_WMS_BASE}?${params.toString()}`;
    const res = await fetchSTimeoutom(url, { headers: { "User-Agent": cfg.USER_AGENT } });
    if (!res.ok) throw new Error(`WMS GetMap ${res.status} ${res.statusText}`);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("image")) {
      const text = await res.text();
      throw new Error(`WMS nije vratio sliku (${contentType}): ${text.slice(0, 500)}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    // Heuristika: prava zračna snimka (300x300, puna vizualnog detalja -
    // krovovi, vegetacija, ceste) se PNG-om gotovo nikad ne komprimira
    // ispod ~1.5KB. Prazna/jednobojna "nema pokrivenosti" pločica (rub DGU
    // pokrivenosti, otoci bez snimke, more...) obično je puno manja od toga
    // (često <500B). Namjerno konzervativan prag (nizak) - bolje propustiti
    // par stvarno praznih pločica Claude-u (par centi) nego riskirati da
    // lažno odbacimo stvarnu zgradu s neuobičajeno uniformnim krovom.
    if (buffer.length < 1500) {
      return { prazno: true, velicinaBajtova: buffer.length };
    }
    return { prazno: false, base64: buffer.toString("base64") };
  }, "DGU WMS");
}

// ---------- 3. Poziv Claude API-ja za klasifikaciju slike ----------

async function pitajClaude(base64Slika) {
  return saRetryem(async () => {
    const body = {
      model: ANTHROPIC_MODEL,
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: base64Slika } },
            {
              type: "text",
              text:
                "Ovo je isječak zračne/satelitske snimke (DGU ortofoto), oko 50x50 metara, centriran na zadanu lokaciju. " +
                "Vidi li se u centru kadra izgrađena zgrada (krov, građevina)? Odgovori ISKLJUČIVO u JSON formatu, bez ikakvog drugog teksta: " +
                '{"vidljivaZgrada": true/false/null, "obrazlozenje": "kratko, jedna rečenica"}. ' +
                "Koristi null ako je snimka nejasna, oblačna, prekrivena ili se ne može pouzdano procijeniti.",
            },
          ],
        },
      ],
    };

    const res = await fetchSTimeoutom("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    }, 60000);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 500)}`);
    }

    const data = await res.json();
    const tekst = (data.content || []).map((c) => c.text || "").join("");
    try {
      const match = tekst.match(/\{[\s\S]*\}/);
      return JSON.parse(match ? match[0] : tekst);
    } catch {
      throw new Error(`Claude odgovor nije valjan JSON: ${tekst.slice(0, 300)}`);
    }
  }, "Anthropic API");
}

// ---------- 4. Obrada jedne zgrade ----------

function statusIzOdgovora(odgovor) {
  const v = odgovor && odgovor.vidljivaZgrada;
  if (v === true || v === "true") return "stara";
  if (v === false || v === "false") return "kandidat";
  return "neizvjesno";
}

async function obradiFeature(f, nazivSloja) {
  if (f.satelitProvjera && f.satelitProvjera.status !== "greska") return "preskočeno";
  if (f.lat === null || f.lon === null) {
    f.satelitProvjera = { status: "bez-koordinata", obrazlozenje: null, izvor: "DGU ortofoto 2023/24", provjereno: new Date().toISOString() };
    return "bez-koordinata";
  }

  try {
    const isjecak = await dohvatiIsjecak(f.lat, f.lon, nazivSloja);
    if (isjecak.prazno) {
      f.satelitProvjera = {
        status: "neizvjesno",
        obrazlozenje: `DGU nema pokrivenost na ovoj lokaciji (prazan isječak, ${isjecak.velicinaBajtova}B)`,
        izvor: "DGU ortofoto 2023/24",
        provjereno: new Date().toISOString(),
      };
      return f.satelitProvjera.status;
    }
    const odgovor = await pitajClaude(isjecak.base64);
    f.satelitProvjera = {
      status: statusIzOdgovora(odgovor),
      obrazlozenje: odgovor.obrazlozenje || null,
      izvor: "DGU ortofoto 2023/24",
      provjereno: new Date().toISOString(),
    };
    return f.satelitProvjera.status;
  } catch (err) {
    f.satelitProvjera = { status: "greska", obrazlozenje: err.message.slice(0, 300), izvor: "DGU ortofoto 2023/24", provjereno: new Date().toISOString() };
    return "greska";
  }
}

// ---------- 5. Glavna petlja - batch obrada + inkrementalno spremanje ----------

async function obradiDatoteku(entry, nazivSloja, brojaci) {
  const filePath = path.join(REPO_ROOT, entry.file);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

  const zaProvjeru = data.features.filter(
    (f) => (!f.satelitProvjera || f.satelitProvjera.status === "greska")
  );
  console.log(`\n${entry.file}: ${zaProvjeru.length} zgrada za obradu (od ${data.features.length} ukupno).`);

  let komad = 0;
  let promijenjeno = false;

  for (let i = 0; i < zaProvjeru.length; i += BATCH_SIZE) {
    if (obradjenoUkupno >= MAX_ZGRADA) {
      if (promijenjeno) fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`  Dosegnut limit od ${MAX_ZGRADA} zgrada za ovo pokretanje - stajem.`);
      return "limit";
    }

    const preostaloDoLimita = MAX_ZGRADA - obradjenoUkupno;
    const batch = zaProvjeru.slice(i, i + Math.min(BATCH_SIZE, preostaloDoLimita));
    const rezultati = await Promise.all(batch.map((f) => obradiFeature(f, nazivSloja)));
    rezultati.forEach((status, idx) => {
      brojaci[status] = (brojaci[status] || 0) + 1;
      obradjenoUkupno++;
      const f = batch[idx];
      console.log(`  [${i + idx + 1}/${zaProvjeru.length}] ${f.id}: ${status}${f.satelitProvjera?.obrazlozenje ? " - " + f.satelitProvjera.obrazlozenje : ""}`);
    });
    promijenjeno = true;

    // Spremamo svakih nekoliko komada, ne nakon svakog. Kod pune obrade bi
    // inace bilo tisuce zapisivanja datoteke od par megabajta.
    if (++komad % SPREMI_SVAKIH === 0) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      promijenjeno = false;
    }
  }

  if (promijenjeno) fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return "gotovo";
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.entries.length === 0) {
    console.log("Manifest je prazan, nema što obraditi.");
    return;
  }

  let ciljaniZapisi;
  if (SVE_DATOTEKE) {
    ciljaniZapisi = manifest.entries;
    console.log(`Način: SVE datoteke iz manifesta (${ciljaniZapisi.length}).`);
  } else {
    const zadnjiTo = new Date(manifest.entries[manifest.entries.length - 1].to);
    if (isNaN(zadnjiTo.getTime())) {
      throw new Error(`Neispravan datum u zadnjem manifest zapisu: "${manifest.entries[manifest.entries.length - 1].to}"`);
    }
    const cutoff = new Date(zadnjiTo);
    cutoff.setUTCDate(cutoff.getUTCDate() - PROZOR_DANA);
    ciljaniZapisi = manifest.entries.filter((e) => new Date(e.to) > cutoff);
    console.log(`Način: zadnjih ${PROZOR_DANA} dana (${ciljaniZapisi.length} datoteka).`);
  }

  if (ciljaniZapisi.length === 0) {
    console.log("UPOZORENJE: nijedan zapis ne upada u prozor - provjeri manifest, ovo je neuobičajeno.");
    return;
  }

  // Prebroji koliko posla stvarno ima, da se zna na cemu smo prije pocetka.
  let zaObraduUkupno = 0;
  ciljaniZapisi.forEach((e) => {
    const p = path.join(REPO_ROOT, e.file);
    if (!fs.existsSync(p)) return;
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    zaObraduUkupno += (d.features || []).filter(
      (f) => !f.satelitProvjera || f.satelitProvjera.status === "greska"
    ).length;
  });

  const planirano = Math.min(zaObraduUkupno, MAX_ZGRADA);
  const satiProcjena = ((planirano / BATCH_SIZE) * 3.5) / 3600;
  console.log(`Neprovjerenih zgrada: ${zaObraduUkupno.toLocaleString("hr-HR")}`);
  console.log(`U ovom pokretanju obradit ću najviše: ${planirano.toLocaleString("hr-HR")}`);
  console.log(`Usporedno: ${BATCH_SIZE} | procjena trajanja: ~${satiProcjena.toFixed(1)} h`);
  console.log(`Skripta je ponovljiva - vec provjerene zgrade preskace, pa se moze pokretati u vise navrata.\n`);

  const nazivSloja = await otkrijNazivSloja();
  console.log(`Koristim WMS sloj: ${nazivSloja}`);

  const brojaci = {};
  let zaustavljeno = false;
  for (const entry of ciljaniZapisi) {
    const ishod = await obradiDatoteku(entry, nazivSloja, brojaci);
    if (ishod === "limit") { zaustavljeno = true; break; }
  }

  console.log("\n--- Sažetak ---");
  Object.entries(brojaci).forEach(([status, broj]) => console.log(`  ${status}: ${broj}`));
  console.log(`  UKUPNO obradjeno u ovom pokretanju: ${obradjenoUkupno.toLocaleString("hr-HR")}`);
  if (zaustavljeno) {
    console.log(`\n  Stalo na zadanom limitu. Pokreni workflow ponovno da nastavi -`);
    console.log(`  vec provjerene zgrade se preskacu, pa se nastavlja tocno gdje je stalo.`);
  }
}

main().catch((err) => {
  console.error("Satelitska verifikacija pukla:", err.message);
  process.exit(1);
});
