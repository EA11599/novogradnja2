// Sva podesiva podešavanja tjednog pipelinea za praćenje novih zgrada na
// jednom mjestu — promijeni ovdje, ništa drugo ne treba dirati.
module.exports = {
  // Koliko tjedana povijesti (diff-datoteka) čuvamo. 13 tjedana ≈ 3 mjeseca.
  RETENTION_WEEKS: 13,

  // Kontakt koji šaljemo kao User-Agent na Overpass API — obavezna dobra
  // praksa, zamijeni pravim kontaktom prije prvog pravog pokretanja u
  // produkciji.
  USER_AGENT: "novogradnja2-pipeline/1.0 (kontakt: ea11599 na GitHubu)",

  // Direktorij s tjednim diff-datotekama i njihovim manifestom.
  ZGRADE_DIR: "data/zgrade",

  // Ako je ovo prvo ikad pokretanje (nema prošlog manifesta), koliko dana
  // unatrag gledamo za "prvi" diff — ne želimo tražiti povijest cijelog
  // OSM-a, samo zadnjih X dana kao razuman početak.
  FIRST_RUN_LOOKBACK_DAYS: 7,

  // Prag promjene povrsine obrisa (u %) da se zgrada oznaci kao "moguce
  // prosirenje". Ispod ovoga tretiramo kao kozmeticku ispravku obrisa
  // (netko precizni je ucrtao isti objekt), ne stvarnu gradevinsku promjenu.
  PROSIRENJE_PRAG_POSTOTAK: 25,
};
