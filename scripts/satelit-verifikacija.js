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
const BATCH_SIZE = 5; // koliko zgrada obrađujemo usporedno prije nego spremimo napredak

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

  for (let i = 0; i < zaProvjeru.length; i += BATCH_SIZE) {
    const batch = zaProvjeru.slice(i, i + BATCH_SIZE);
    const rezultati = await Promise.all(batch.map((f) => obradiFeature(f, nazivSloja)));
    rezultati.forEach((status, idx) => {
      brojaci[status] = (brojaci[status] || 0) + 1;
      const f = batch[idx];
      console.log(`  [${i + idx + 1}/${zaProvjeru.length}] ${f.id}: ${status}${f.satelitProvjera?.obrazlozenje ? " - " + f.satelitProvjera.obrazlozenje : ""}`);
    });

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.entries.length === 0) {
    console.log("Manifest je prazan, nema što obraditi.");
    return;
  }

  const zadnjiTo = new Date(manifest.entries[manifest.entries.length - 1].to);
  if (isNaN(zadnjiTo.getTime())) {
    throw new Error(`Neispravan datum u zadnjem manifest zapisu: "${manifest.entries[manifest.entries.length - 1].to}"`);
  }
  const cutoff = new Date(zadnjiTo);
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  const ciljaniZapisi = manifest.entries.filter((e) => new Date(e.to) > cutoff);

  if (ciljaniZapisi.length === 0) {
    console.log("UPOZORENJE: nijedan zapis ne upada u zadnjih 7 dana - provjeri manifest, ovo je neuobičajeno.");
    return;
  }

  console.log(`Ciljani zapisi (zadnjih 7 dana): ${ciljaniZapisi.map((e) => e.file).join(", ")}`);

  const nazivSloja = await otkrijNazivSloja();
  console.log(`Koristim WMS sloj: ${nazivSloja}`);

  const brojaci = {};
  for (const entry of ciljaniZapisi) {
    await obradiDatoteku(entry, nazivSloja, brojaci);
  }

  console.log("\n--- Sažetak ---");
  Object.entries(brojaci).forEach(([status, broj]) => console.log(`  ${status}: ${broj}`));
}

main().catch((err) => {
  console.error("Satelitska verifikacija pukla:", err.message);
  process.exit(1);
});
