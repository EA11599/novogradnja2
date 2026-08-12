const fs = require("fs");
const path = require("path");
const cfg = require("../zgrade-config");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BOUNDARY_PATH = path.join(REPO_ROOT, cfg.BOUNDARY_FILE);

// Nominatim relacija za Hrvatsku (osm_id 214885, admin_level 2, provjereno
// na www.openstreetmap.org/relation/214885). Dohvaćamo je jednom preko
// Nominatim "polygon_geojson=1" i spremamo lokalno — nema smisla ponavljati
// ovaj poziv svaki tjedan jer se granica države ne mijenja.
const NOMINATIM_URL =
  "https://nominatim.openstreetmap.org/lookup?osm_ids=R214885&format=json&polygon_geojson=1";

async function getHrGranica() {
  if (fs.existsSync(BOUNDARY_PATH)) {
    return JSON.parse(fs.readFileSync(BOUNDARY_PATH, "utf8"));
  }

  console.log("Granica Hrvatske nije keš-irana, dohvaćam s Nominatima...");
  const res = await fetch(NOMINATIM_URL, {
    headers: { "User-Agent": cfg.USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`Nominatim lookup neuspio: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0 || !data[0].geojson) {
    throw new Error(
      "Nominatim nije vratio geojson granicu — provjeri je li osm_id R214885 još ispravan."
    );
  }

  // ohsome bpolys očekuje FeatureCollection (ili GeoJSON geometry) — spremamo
  // kao Feature radi jasnoće i buduće ponovne upotrebe (npr. za prikaz na karti).
  const feature = {
    type: "Feature",
    properties: { name: "Hrvatska", source: "Nominatim R214885" },
    geometry: data[0].geojson,
  };

  fs.mkdirSync(path.dirname(BOUNDARY_PATH), { recursive: true });
  fs.writeFileSync(BOUNDARY_PATH, JSON.stringify(feature));
  console.log(`Granica spremljena u ${cfg.BOUNDARY_FILE}`);
  return feature;
}

module.exports = { getHrGranica, BOUNDARY_PATH };
