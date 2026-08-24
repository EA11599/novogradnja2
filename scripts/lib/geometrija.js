// Racunanje priblizne povrsine poligona zgrade iz niza [lon,lat] tocaka.
//
// Pristup: lokalna ravninska projekcija (stupnjevi -> metri, oko prosjecne
// sirine poligona) + standardna shoelace formula. Dovoljno precizno za
// obrise zgrada (desetci do stotine m2) - koristimo POSTOTAK promjene, ne
// apsolutnu preciznost, pa mali projekcijski pogresci (< 1%) nisu bitni.
// Izbjegavamo dodavanje @turf/area ovisnosti za ovako jednostavan racun.

const METARA_PO_STUPNJU_SIRINE = 111320; // priblizno, konstantno

function povrsinaPoligona(obris) {
  if (!Array.isArray(obris) || obris.length < 3) return null;

  const prosjecnaSirina = obris.reduce((zbroj, t) => zbroj + t[1], 0) / obris.length;
  const metaraPoStupnjuDuzine = METARA_PO_STUPNJU_SIRINE * Math.cos((prosjecnaSirina * Math.PI) / 180);

  // Projekcija svake tocke u metre, relativno prema prvoj tocki (proizvoljno ishodiste).
  const tockeMetri = obris.map(([lon, lat]) => [
    (lon - obris[0][0]) * metaraPoStupnjuDuzine,
    (lat - obris[0][1]) * METARA_PO_STUPNJU_SIRINE,
  ]);

  // Shoelace formula.
  let zbroj = 0;
  for (let i = 0; i < tockeMetri.length; i++) {
    const [x1, y1] = tockeMetri[i];
    const [x2, y2] = tockeMetri[(i + 1) % tockeMetri.length];
    zbroj += x1 * y2 - x2 * y1;
  }
  return Math.abs(zbroj) / 2;
}

// Opseg poligona u metrima, ista lokalna projekcija kao kod povrsine.
//
// Zasto nam treba: povrsina sama ne razlikuje pravokutnik od L-oblika iste
// plostine. Opseg to razlikuje - kod razvedenijeg oblika je veci. Zajedno s
// brojem vrhova daje dobru sliku je li se oblik stvarno promijenio ili je
// zgrada samo dogradjena.
function opsegPoligona(obris) {
  if (!Array.isArray(obris) || obris.length < 3) return null;

  const prosjecnaSirina = obris.reduce((zbroj, t) => zbroj + t[1], 0) / obris.length;
  const metaraPoStupnjuDuzine = METARA_PO_STUPNJU_SIRINE * Math.cos((prosjecnaSirina * Math.PI) / 180);

  let opseg = 0;
  for (let i = 0; i < obris.length; i++) {
    const [lon1, lat1] = obris[i];
    const [lon2, lat2] = obris[(i + 1) % obris.length];
    const dx = (lon2 - lon1) * metaraPoStupnjuDuzine;
    const dy = (lat2 - lat1) * METARA_PO_STUPNJU_SIRINE;
    opseg += Math.sqrt(dx * dx + dy * dy);
  }
  return opseg;
}

// Broj RAZLICITIH vrhova - zatvoreni poligon ponavlja prvu tocku na kraju,
// pa je za pravokutnik 5 tocaka zapravo 4 ugla.
function brojVrhova(obris) {
  if (!Array.isArray(obris) || obris.length < 3) return null;
  const prva = obris[0];
  const zadnja = obris[obris.length - 1];
  const zatvoren = prva[0] === zadnja[0] && prva[1] === zadnja[1];
  return zatvoren ? obris.length - 1 : obris.length;
}

// Oblik kao kratki tekst - jedan redak po zgradi umjesto stotinu.
// Zadrzavamo 6 decimala, tocno onoliko koliko pipeline ionako koristi, pa
// zapis ne unosi nikakvu dodatnu pogresku u racun povrsine.
function oblikUTekst(obris) {
  if (!Array.isArray(obris) || obris.length < 3) return null;
  return obris.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(" ");
}

function tekstUOblik(tekst) {
  if (!tekst) return null;
  return tekst.split(" ").map((par) => par.split(",").map(Number));
}

module.exports = { povrsinaPoligona, opsegPoligona, brojVrhova, oblikUTekst, tekstUOblik };
