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

  // Prag promjene povrsine obrisa (u %) ispod kojeg se promjena NE zapisuje.
  //
  // Postavljeno na 0 = zapisujemo SVAKU stvarnu promjenu povrsine, koliko god
  // malu. Odluka od 24.8.2026.: tjedni volumen je red velicine dvije zgrade,
  // pa je korisnije vidjeti sve i sam procijeniti, nego da filtar propusti
  // pravu dogradnju jer je ispod nekog broja.
  //
  // VAZNO: nula NE znaci da zapisujemo izmjene bez promjene geometrije.
  // Zgrade kojima je netko promijenio samo oznake (npr. building:levels)
  // takodjer imaju vecu verziju, ali im je povrsina identicna - te se
  // preskacu zasebnom provjerom, inace bi zatrpale popis.
  //
  // Ako popis ikad postane preglasan, podigni ovaj broj natrag (npr. 5 ili 10).
  PROSIRENJE_PRAG_POSTOTAK: 0,
};
