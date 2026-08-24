// PROBA: koliko zgrada Microsoftov skup ima, a OpenStreetMap nema?
//
// Skripta nista ne mijenja u repozitoriju - samo ispisuje rezultat u log.
// Pokrece se rucno iz Actions taba (workflow "Proba: Microsoft obrisi zgrada").
//
// Sto radi, redom:
//   1. skine Microsoftovu indeksnu tablicu i nadje pocice za Hrvatsku
//   2. skine one koje pokrivaju odabrani grad (GeoJSONL u .csv.gz omotu)
//   3. skine OSM zgrade za isti okvir preko Overpassa
//   4. za svaku Microsoftovu zgradu provjeri postoji li OSM zgrada na tom mjestu
//   5. ispise brojke i nekoliko primjera s poveznicama na Google Maps
//
// Licenca podataka: CDLA Permissive 2.0 (dopusta i komercijalnu upotrebu).

const zlib = require("zlib");

const INDEKS_URL = "https://bfppub.blob.core.windows.net/$web/2026-08-13/dataset-links.csv";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Okviri gradova: [minLon, minLat, maxLon, maxLat]
const GRADOVI = {
  "varazdin":  [16.300, 46.280, 16.390, 46.330],
  "karlovac":  [15.510, 45.460, 15.580, 45.510],
  "zadar":     [15.190, 44.090, 15.280, 44.140],
  "osijek":    [18.630, 45.530, 18.730, 45.580],
  "split":     [16.400, 43.490, 16.510, 43.530],
  "trešnjevka":[15.930, 45.790, 15.980, 45.812],
};

// Zgrada se smatra "poznatom" ako joj srediste padne unutar nekog OSM obrisa,
// ili vrlo blizu njega. Tolerancija pokriva razliku u crtanju izmedju dva
// izvora - Microsoftov obris je strojno izveden i cesto malo pomaknut.
const TOLERANCIJA_M = 8;

// ---------- Quadkey -> okvir pocice ----------
// Microsoft dijeli svijet po Bing shemi pocica; quadkey je niz znamenki 0-3
// gdje svaka znamenka spusta jednu razinu detalja.
function quadkeyUOkvir(qk) {
  let x = 0, y = 0;
  const razina = qk.length;
  for (let i = 0; i < razina; i++) {
    const bit = razina - i;
    const maska = 1 << (bit - 1);
    switch (qk[i]) {
      case "0": break;
      case "1": x |= maska; break;
      case "2": y |= maska; break;
      case "3": x |= maska; y |= maska; break;
    }
  }
  const n = Math.pow(2, razina);
  const lon1 = (x / n) * 360 - 180;
  const lon2 = ((x + 1) / n) * 360 - 180;
  const lat1 = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat2 = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  return [lon1, Math.min(lat1, lat2), lon2, Math.max(lat1, lat2)];
}

function okviriSePreklapaju(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

// ---------- Geometrija ----------
function srediste(prsten) {
  let x = 0, y = 0;
  prsten.forEach((t) => { x += t[0]; y += t[1]; });
  return [x / prsten.length, y / prsten.length];
}

function povrsinaStupnjeva(prsten) {
  let s = 0;
  for (let i = 0; i < prsten.length; i++) {
    const [x1, y1] = prsten[i];
    const [x2, y2] = prsten[(i + 1) % prsten.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s / 2);
}

// Priblizna povrsina u m2 - dovoljno za grubu procjenu velicine zgrade.
function povrsinaM2(prsten) {
  const lat = srediste(prsten)[1];
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
  return povrsinaStupnjeva(prsten) * 111320 * mLon;
}

// Je li tocka unutar poligona - metoda zrake.
function uPoligonu(tocka, prsten) {
  const [px, py] = tocka;
  let unutra = false;
  for (let i = 0, j = prsten.length - 1; i < prsten.length; j = i++) {
    const [xi, yi] = prsten[i];
    const [xj, yj] = prsten[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      unutra = !unutra;
    }
  }
  return unutra;
}

// ---------- Dohvat ----------
async function skini(url, opis) {
  process.stdout.write(`  ${opis}... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} za ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  return buf;
}

async function microsoftZgrade(okvir) {
  const csv = (await skini(INDEKS_URL, "indeksna tablica")).toString("utf8");
  const redci = csv.split("\n").slice(1).filter(Boolean);

  const hrvatske = redci
    .map((r) => {
      const d = r.split(",");
      return { lokacija: d[0], quadkey: d[1], url: d[2] && d[2].trim() };
    })
    .filter((r) => r.lokacija === "Croatia" && r.quadkey && r.url);

  console.log(`  pločica za Hrvatsku: ${hrvatske.length}`);

  const potrebne = hrvatske.filter((r) => okviriSePreklapaju(quadkeyUOkvir(r.quadkey), okvir));
  console.log(`  pločica koje pokrivaju grad: ${potrebne.length} (${potrebne.map((p) => p.quadkey).join(", ")})`);
  if (potrebne.length === 0) throw new Error("Nijedna pločica ne pokriva zadani okvir.");

  const zgrade = [];
  for (const p of potrebne) {
    const gz = await skini(p.url, `pločica ${p.quadkey}`);
    const tekst = zlib.gunzipSync(gz).toString("utf8");
    let ukupnoURetku = 0;
    tekst.split("\n").forEach((redak) => {
      if (!redak.trim()) return;
      ukupnoURetku++;
      let f;
      try { f = JSON.parse(redak); } catch (e) { return; }
      const prsten = f.geometry && f.geometry.coordinates && f.geometry.coordinates[0];
      if (!prsten || prsten.length < 3) return;
      const c = srediste(prsten);
      if (c[0] < okvir[0] || c[0] > okvir[2] || c[1] < okvir[1] || c[1] > okvir[3]) return;
      zgrade.push({
        prsten,
        centar: c,
        visina: (f.properties && f.properties.height > 0) ? f.properties.height : null,
        povrsina: Math.round(povrsinaM2(prsten)),
      });
    });
    console.log(`     zapisa u pločici: ${ukupnoURetku.toLocaleString("hr-HR")}, unutar okvira: ${zgrade.length.toLocaleString("hr-HR")}`);
  }
  return zgrade;
}

async function osmZgrade(okvir) {
  const [minLon, minLat, maxLon, maxLat] = okvir;
  const upit = `[out:json][timeout:300];
(way["building"](${minLat},${minLon},${maxLat},${maxLon});
 relation["building"](${minLat},${minLon},${maxLat},${maxLon}););
out geom;`;

  process.stdout.write("  OSM zgrade preko Overpassa... ");
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(upit),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const podaci = await res.json();

  const poligoni = [];
  (podaci.elements || []).forEach((el) => {
    if (el.type === "way" && Array.isArray(el.geometry)) {
      poligoni.push(el.geometry.map((t) => [t.lon, t.lat]));
    } else if (el.type === "relation" && Array.isArray(el.members)) {
      el.members.forEach((m) => {
        if (m.role === "outer" && Array.isArray(m.geometry)) {
          poligoni.push(m.geometry.map((t) => [t.lon, t.lat]));
        }
      });
    }
  });
  console.log(`${poligoni.length.toLocaleString("hr-HR")} obrisa`);
  return poligoni;
}

// ---------- Prostorni indeks ----------
// Bez njega bi usporedba bila svaka-sa-svakom: kod 20 tisuca zgrada s obje
// strane to je 400 milijuna provjera. S mrezom od ~100 m padne na nekoliko
// provjera po zgradi.
function napraviMrezu(poligoni) {
  const VELICINA = 0.001; // ~110 m
  const mreza = new Map();
  poligoni.forEach((p) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    p.forEach(([x, y]) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    });
    for (let gx = Math.floor(minX / VELICINA); gx <= Math.floor(maxX / VELICINA); gx++) {
      for (let gy = Math.floor(minY / VELICINA); gy <= Math.floor(maxY / VELICINA); gy++) {
        const k = gx + ":" + gy;
        if (!mreza.has(k)) mreza.set(k, []);
        mreza.get(k).push(p);
      }
    }
  });
  return {
    dohvati(tocka) {
      const gx = Math.floor(tocka[0] / VELICINA);
      const gy = Math.floor(tocka[1] / VELICINA);
      const van = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const p = mreza.get((gx + dx) + ":" + (gy + dy));
          if (p) van.push(...p);
        }
      }
      return van;
    },
  };
}

function udaljenostDoPoligona(tocka, prsten) {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((tocka[1] * Math.PI) / 180);
  let najmanja = Infinity;
  for (let i = 0; i < prsten.length; i++) {
    const [x1, y1] = prsten[i];
    const [x2, y2] = prsten[(i + 1) % prsten.length];
    const ax = (tocka[0] - x1) * mLon, ay = (tocka[1] - y1) * mLat;
    const bx = (x2 - x1) * mLon, by = (y2 - y1) * mLat;
    const duljina = bx * bx + by * by;
    const t = duljina === 0 ? 0 : Math.max(0, Math.min(1, (ax * bx + ay * by) / duljina));
    const dx = ax - t * bx, dy = ay - t * by;
    najmanja = Math.min(najmanja, Math.sqrt(dx * dx + dy * dy));
  }
  return najmanja;
}

// ---------- Glavni tok ----------
async function main() {
  const grad = (process.argv[2] || "varazdin").toLowerCase();
  const okvir = GRADOVI[grad];
  if (!okvir) {
    console.error(`Nepoznat grad "${grad}". Dostupni: ${Object.keys(GRADOVI).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n=== PROBA: ${grad.toUpperCase()} ===`);
  console.log(`Okvir: ${okvir.join(", ")}\n`);

  console.log("1) Microsoft obrisi");
  const ms = await microsoftZgrade(okvir);

  console.log("\n2) OpenStreetMap obrisi");
  const osm = await osmZgrade(okvir);

  console.log("\n3) Usporedba");
  const mreza = napraviMrezu(osm);
  const nedostaju = [];
  ms.forEach((z) => {
    const kandidati = mreza.dohvati(z.centar);
    const poznata = kandidati.some(
      (p) => uPoligonu(z.centar, p) || udaljenostDoPoligona(z.centar, p) <= TOLERANCIJA_M
    );
    if (!poznata) nedostaju.push(z);
  });

  const postotak = (100 * nedostaju.length) / Math.max(1, ms.length);
  console.log(`\n   Microsoft zgrada u okviru:      ${ms.length.toLocaleString("hr-HR")}`);
  console.log(`   OSM obrisa u okviru:            ${osm.length.toLocaleString("hr-HR")}`);
  console.log(`   NEMA ih u OSM-u:                ${nedostaju.length.toLocaleString("hr-HR")}  (${postotak.toFixed(1)}%)`);

  const velike = nedostaju.filter((z) => z.povrsina >= 300);
  const visoke = nedostaju.filter((z) => z.visina && z.visina >= 9);
  console.log(`   od toga vece od 300 m²:         ${velike.length.toLocaleString("hr-HR")}`);
  console.log(`   od toga vise od 9 m:            ${visoke.length.toLocaleString("hr-HR")}`);

  const zaPogledati = [...nedostaju].sort((a, b) => b.povrsina - a.povrsina).slice(0, 15);
  if (zaPogledati.length) {
    console.log(`\n   Najvece zgrade kojih u OSM-u nema - otvori i provjeri:\n`);
    zaPogledati.forEach((z, i) => {
      const [lon, lat] = z.centar;
      console.log(`   ${String(i + 1).padStart(2)}. ${String(z.povrsina).padStart(6)} m²` +
        (z.visina ? `, ${z.visina.toFixed(1)} m visine` : ", visina nepoznata"));
      console.log(`       https://www.google.com/maps/@?api=1&map_action=map&center=${lat.toFixed(6)},${lon.toFixed(6)}&zoom=20&basemap=satellite`);
    });
  }

  console.log(`\nGotovo. Podsjetnik: oko 1% Microsoftovih obrisa su lazni pozitivi,`);
  console.log(`pa ocekuj da ce poneki od gornjih biti nadstresnica ili sjena, ne zgrada.\n`);
}

main().catch((err) => {
  console.error("\nProba pukla:", err.message);
  process.exit(1);
});
