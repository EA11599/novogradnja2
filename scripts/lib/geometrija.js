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

module.exports = { povrsinaPoligona };
