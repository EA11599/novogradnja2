// Za zgrade bez addr:street oznake, računa najbližu imenovanu cestu i
// udaljenost u metrima — koristi Overpass (way["highway"]["name"] unutar
// bbox-a) + jednostavan grid-bucket index za brzu pretragu.
//
// NAMJERNO se ovo radi OVDJE (u pipeline-u, Node.js), NE u pregledniku:
// izravni pozivi prema overpass-api.de iz preglednika s GitHub Pages
// domene blokirani su CORS politikom servera (potvrđeno u praksi — server
// ne šalje Access-Control-Allow-Origin zaglavlje za taj tip zahtjeva).
// Node fetch nema CORS ograničenja, pa se isti upit odavde izvrši bez
// problema.

const cfg = require("../zgrade-config");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180, dlambda = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlambda / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchCeste(bbox) {
  const query = `[out:json][timeout:60];way["highway"]["name"](${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon});out geom;`;

  const MAX_POKUSAJA = 3;
  for (let pokusaj = 1; pokusaj <= MAX_POKUSAJA; pokusaj++) {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": cfg.USER_AGENT,
      },
      body: new URLSearchParams({ data: query }),
    });
    if (res.ok) {
      const body = await res.json();
      return (body.elements || [])
        .map((el) => ({
          name: el.tags && el.tags.name,
          points: (el.geometry || []).map((p) => [p.lat, p.lon]),
        }))
        .filter((r) => r.name && r.points.length);
    }
    // 429 (rate limit) i 502/503/504 su privremeni - pokušaj ponovno uz pauzu
    const jePrivremena = res.status === 429 || (res.status >= 502 && res.status <= 504);
    if (!jePrivremena || pokusaj === MAX_POKUSAJA) {
      throw new Error(`Overpass ${res.status} ${res.statusText}`);
    }
    const pauza = pokusaj * 20000;
    console.log(`    Overpass ${res.status} (pokušaj ${pokusaj}/${MAX_POKUSAJA}), čekam ${pauza / 1000}s...`);
    await new Promise((r) => setTimeout(r, pauza));
  }
}

// Mutira features u mjestu - dodaje nearestStreet / nearestStreetDist
// zgradama koje nemaju addr:street. Grupira po županiji da bbox ne bude
// prevelik (cijela država odjednom bi bila presporo/preveliko).
async function dodajNajblizuCestu(features) {
  const bezAdrese = features.filter((f) => f.tags && !f.tags["addr:street"] && !f.dguAdresa && f.lat !== null && f.lon !== null);
  if (bezAdrese.length === 0) return;

  const poZupaniji = {};
  bezAdrese.forEach((f) => {
    const key = f.zupanija || "__bez__";
    (poZupaniji[key] = poZupaniji[key] || []).push(f);
  });

  for (const [zupanija, skupina] of Object.entries(poZupaniji)) {
    const lats = skupina.map((f) => f.lat), lons = skupina.map((f) => f.lon);
    const bbox = {
      minLat: Math.min(...lats) - 0.01,
      maxLat: Math.max(...lats) + 0.01,
      minLon: Math.min(...lons) - 0.01,
      maxLon: Math.max(...lons) + 0.01,
    };
    try {
      const ceste = await fetchCeste(bbox);
      if (ceste.length === 0) continue;

      const CELL = 0.003;
      const grid = {};
      const key = (lat, lon) => Math.floor(lat / CELL) + "_" + Math.floor(lon / CELL);
      ceste.forEach((r) =>
        r.points.forEach(([lat, lon]) => {
          const k = key(lat, lon);
          (grid[k] = grid[k] || []).push([lat, lon, r.name]);
        })
      );

      let nadjeno = 0;
      skupina.forEach((f) => {
        const cLat = Math.floor(f.lat / CELL), cLon = Math.floor(f.lon / CELL);
        let best = null, bestDist = Infinity;
        for (let dl = -2; dl <= 2; dl++) {
          for (let dn = -2; dn <= 2; dn++) {
            const pts = grid[cLat + dl + "_" + (cLon + dn)];
            if (!pts) continue;
            pts.forEach(([lat, lon, name]) => {
              const d = haversineM(f.lat, f.lon, lat, lon);
              if (d < bestDist) { bestDist = d; best = name; }
            });
          }
        }
        if (best) { f.nearestStreet = best; f.nearestStreetDist = Math.round(bestDist); nadjeno++; }
      });
      console.log(`  Najbliža cesta (${zupanija || "bez županije"}): ${nadjeno}/${skupina.length} zgrada.`);
    } catch (err) {
      console.log(`  Najbliža cesta nije dohvaćena za ${zupanija || "bez županije"}: ${err.message}`);
    }
    // mala pauza između županija - smanjuje rizik od rate-limita na javnom serveru
    await new Promise((r) => setTimeout(r, 2000));
  }
}

module.exports = { dodajNajblizuCestu };
