// Sva podesiva podešavanja tjednog pipelinea za praćenje novih zgrada na
// jednom mjestu — promijeni ovdje, ništa drugo ne treba dirati.
module.exports = {
  // Koliko tjedana povijesti (diff-datoteka) čuvamo. 13 tjedana ≈ 3 mjeseca.
  RETENTION_WEEKS: 13,

  // ohsome filter — samo zgrade (way/relation geometrija, bez pojedinačnih
  // node-ova koji su npr. adresne točke unutar drugih objekata).
  OHSOME_FILTER: "building=* and geometry:polygon",

  // Kontakt koji šaljemo kao User-Agent na sve vanjske servise (Nominatim,
  // ohsome) — obavezna dobra praksa, zamijeni pravim kontaktom prije
  // prvog pravog pokretanja u produkciji.
  USER_AGENT: "novogradnja2-pipeline/1.0 (kontakt: ea11599 na GitHubu)",

  // Gdje se sprema (i keš-ira) granica Hrvatske, da je ne dohvaćamo iznova
  // svaki tjedan.
  BOUNDARY_FILE: "data/hr-granica.geojson",

  // Direktorij s tjednim diff-datotekama i njihovim manifestom.
  ZGRADE_DIR: "data/zgrade",

  // Ako je ovo prvo ikad pokretanje (nema prošlog manifesta), koliko dana
  // unatrag gledamo za "prvi" diff — ne želimo tražiti povijest cijelog
  // OSM-a, samo zadnjih X dana kao razuman početak.
  FIRST_RUN_LOOKBACK_DAYS: 7,
};
