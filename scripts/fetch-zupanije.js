// Jednokratni (ne tjedni) dohvat administrativnih granica svih hrvatskih
// županija preko Overpass API-ja. Granice županija se ne mijenjaju, pa ovo
// NIJE dio tjednog pipelinea — pokreće se ručno kad zatreba:
//   node scripts/fetch-zupanije.js
// ili preko GitHub Actions workflowa "dohvati-zupanije.yml" (workflow_dispatch,
// bez rasporeda).

const fs = require("fs");
const path = require("path");
const osmtogeojson = require("osmtogeojson");
const cfg = require("./zgrade-config");

const REPO_ROOT = path.join(__dirname, "..");
const OUTPUT_PATH = path.join(REPO_ROOT, "data", "zupanije.geojson");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// NAPOMENA: prvi pokušaj je koristio admin_level=6 + area["ISO3166-1"="HR"]
// filter, što je pogrešno vratilo SRPSKE upravne okruge (Overpass-ov area
// filter zna imati rubne slučajeve na granicama). Ispravno rješenje:
// hrvatske županije su admin_level=4 (ne 6), i filtriramo direktno po
// ISO3166-2 kodu (HR-01 do HR-21) — precizno, bez oslanjanja na area
// geometriju za samo filtriranje.
const QUERY = `
  [out:json][timeout:180];
  relation["boundary"="administrative"]["ISO3166-2"~"^HR-"];
  out geom;
`;

async function main() {
  console.log("Dohvaćam granice županija s Overpass-a...");
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": cfg.USER_AGENT,
    },
    body: new URLSearchParams({ data: QUERY }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Overpass ${res.status} ${res.statusText}\n${text.slice(0, 1000)}`);
  }

  const overpassJson = JSON.parse(text);
  console.log(`Overpass vratio ${overpassJson.elements.length} relacija.`);

  const geojson = osmtogeojson(overpassJson);

  // Pojednostavi svojstva na samo ono što nam treba (ime), da datoteka
  // ostane manja i frontend ne mora filtrirati OSM metapodatke.
  geojson.features = geojson.features
    .filter((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
    .map((f) => ({
      type: "Feature",
      properties: {
        naziv: f.properties.name || f.properties["name:hr"] || "Nepoznato",
      },
      geometry: f.geometry,
    }));

  console.log(`Zadržano ${geojson.features.length} poligona županija:`);
  geojson.features.forEach((f) => console.log(`  - ${f.properties.naziv}`));

  if (geojson.features.length !== 21) {
    console.log(`UPOZORENJE: očekivano točno 21 (20 županija + Grad Zagreb), dobiveno ${geojson.features.length}. Provjeri popis iznad prije korištenja.`);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(geojson));
  console.log(`Spremljeno u data/zupanije.geojson`);
}

main().catch((err) => {
  console.error("Dohvat županija pukao:", err.message);
  process.exit(1);
});
