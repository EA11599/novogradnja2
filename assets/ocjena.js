// Tro-stanjni dokazi i kompozitna ocjena adrese.
//
// Radi i u pregledniku (window.Ocjena) i u Node-u (require).
//
// ---------------------------------------------------------------------------
// ZASTO TRI STANJA, A NE DVA
// ---------------------------------------------------------------------------
// Stara kvacica je spajala "izvor kaze NE" i "izvor nije stigao" u isto.
// To je uzrok ispisa tipa "OSM atributna promjena (0)" - nula nije znacila
// da nijedna zgrada nema promjenu, nego da ni za jednu ne znamo.
//
//   'da'       - izvor potvrdjuje da zgrada tu postoji / da je dokaz prisutan
//   'ne'       - izvor je provjerio i nema je
//   'nepoznato'- izvor nije stigao: nema snimke, spajanje nije uspjelo,
//                podatak jos nije preuzet
//
// Nepoznato se NIKAD ne pretvara u 'ne'. Devet kandidata sa statusom
// 'nema_snimke' u nasem mjerenju nisu "nema zgrade" nego "DOF nije imao
// snimku" - da ih tretiramo kao 'ne', umjetno bismo napuhali novogradnju.
// ---------------------------------------------------------------------------

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ocjena = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DA = 'da', NE = 'ne', NEPOZNATO = 'nepoznato';

  // Redoslijed je i redoslijed prikaza u sucelju.
  var IZVORI = [
    { kljuc: 'noviObris', naziv: 'Novi OSM obris',         opis: 'Poligon je NOVO ucrtan u promatranom razdoblju, a ne postojeći kojemu se obris promijenio.' },
    { kljuc: 'ms',        naziv: 'Microsoft obris',        opis: 'Zgrada postoji u Microsoftovom skupu (snimke do 2024.)' },
    { kljuc: 'dof',       naziv: 'Ortofoto 2023./24.',     opis: 'Zgrada se vidi na državnom ortofotu' },
    { kljuc: 'dguNova',   naziv: 'Nova DGU adresa',        opis: 'Na lokaciji se pojavila nova adresa u DGU registru' },
    { kljuc: 'dguVise',   naziv: 'Više DGU adresa',        opis: 'Na istom obrisu evidentirano je više kućnih brojeva' },
    { kljuc: 'osmOznake', naziv: 'OSM promjena oznaka',    opis: 'Promijenjen je tip zgrade, broj katova ili broj stanova' },
    { kljuc: 'osmObris',  naziv: 'OSM promjena obrisa',    opis: 'Tlocrt zgrade promijenjen preko praga' }
  ];

  var STANJA = [
    { kljuc: 'potvrdjena-novogradnja', naziv: 'Potvrđena novogradnja', boja: '#16A34A',
      opis: 'Nema je ni Microsoft ni ortofoto, a dodijeljena je nova adresa.' },
    { kljuc: 'vjerojatna-novogradnja', naziv: 'Vjerojatna novogradnja', boja: '#F59E0B',
      opis: 'Microsoft je nema, ali drugi izvor ne može potvrditi.' },
    { kljuc: 'promjena-na-postojecoj', naziv: 'Promjena na postojećoj', boja: '#8B5CF6',
      opis: 'Postojeći objekt je proširen, prenamijenjen ili podijeljen na više jedinica.' },
    { kljuc: 'adresiranje-postojece',  naziv: 'Adresiranje postojeće', boja: '#0EA5E9',
      opis: 'Objekt je postojao prije, tek sad je dobio kućni broj.' },
    { kljuc: 'naknadno-ucrtano',       naziv: 'Naknadno ucrtano', boja: '#6B7280',
      opis: 'Stara zgrada koju je netko tek sada ucrtao u OpenStreetMap.' },
    { kljuc: 'proturjecje',            naziv: 'Izvori proturječe', boja: '#DC2626',
      opis: 'Microsoft i ortofoto se ne slažu - traži ručnu provjeru.' },
    { kljuc: 'nedovoljno-podataka',    naziv: 'Nedovoljno podataka', boja: '#4B5563',
      opis: 'Nijedan izvor još nije dao nalaz.' }
  ];

  // ---------- izvlacenje tro-stanjnih dokaza iz sirovog zapisa ----------

  // f je zapis zgrade iz data/zgrade/novo-*.json, prosiren onim sto imamo.
  // ctx nosi ono sto ne stoji na samom zapisu (npr. skup ID-eva zgrada s
  // promjenom obrisa, koji se ucitava iz zasebnog panela).
  function dokazi(f, ctx) {
    ctx = ctx || {};
    var d = {};

    // --- Novi OSM obris ---
    // Razlikuje NOVO ucrtan poligon od postojeceg kojemu se obris promijenio.
    // Retci iz panela promjena nose oznaku izPromjena - njihov obris postoji
    // odavno, samo mu se promijenio oblik.
    //
    // NAPOMENA: ne postoji dokaz "ima OSM obris uopce". Aplikacija ucitava
    // samo tjednu deltu, ne sloj svih OSM zgrada, pa se za DGU adresnu tocku
    // NE MOZE reci ima li OSM negdje ucrtanu zgradu na toj lokaciji. Sve sto
    // znamo je da je nema u nasoj delti - a to nije isto.
    var imaObris = !!(f.obris && f.obris.length >= 3);
    if (!imaObris) d.noviObris = NE;
    else d.noviObris = f.izPromjena ? NE : DA;

    // --- Microsoft ---
    // msProvjera upisuje backfill-ms-oznaka.js. Ako ga nema, ne izmisljamo.
    if (f.msProvjera && typeof f.msProvjera.ima === 'boolean') {
      d.ms = f.msProvjera.ima ? DA : NE;
    } else {
      d.ms = NEPOZNATO;
    }

    // --- DGU ortofoto ---
    // status 'stara'    -> zgrada se vidi na snimci  -> da
    // status 'kandidat' -> ne vidi se                -> ne
    // 'nema_snimke' ili nista -> nepoznato
    var sp = f.satelitProvjera || {};
    if (sp.status === 'stara') d.dof = DA;
    else if (sp.status === 'kandidat') d.dof = NE;
    else d.dof = NEPOZNATO;

    // --- Nova DGU adresa ---
    // Poklapanje se racuna za sve zgrade, pa je odsutnost stvarni 'ne'.
    d.dguNova = f.dguNovaAdresaPoklapanje ? DA : NE;

    // --- Vise DGU adresa ---
    var broj = f.dguAdrese ? f.dguAdrese.length : null;
    if (broj === null) d.dguVise = NEPOZNATO;
    else d.dguVise = broj > 1 ? DA : NE;

    // --- OSM promjena oznaka ---
    if (f.oznakePromjena === undefined && !ctx.znaOznake) d.osmOznake = NEPOZNATO;
    else d.osmOznake = f.oznakePromjena ? DA : NE;

    // --- OSM promjena obrisa ---
    // Panel prosirenja se ucitava neovisno; dok ne zavrsi, ne znamo nista.
    if (!ctx.znaObrise) d.osmObris = NEPOZNATO;
    else d.osmObris = (ctx.zgradeSPromjenom && ctx.zgradeSPromjenom.has(f.id)) ? DA : NE;

    return d;
  }

  // ---------- kompozitna ocjena ----------

  // Stablo odluke, namjerno deterministicno i objasnjivo - klijent mora moci
  // dobiti odgovor na pitanje "zasto ovdje pise ovo".
  function ocijeni(d) {
    var razlozi = [];

    // 1. Proturjecje ima prednost pred svime. Ako se dva snimkovna izvora iz
    //    istog razdoblja ne slazu, svaka daljnja presuda stoji na klimavom.
    if (d.ms === DA && d.dof === NE) {
      return { stanje: 'proturjecje', sigurnost: 'niska',
        razlozi: ['Microsoft ima zgradu, ortofoto 2023./24. je ne pokazuje.'] };
    }
    if (d.ms === NE && d.dof === DA) {
      return { stanje: 'proturjecje', sigurnost: 'niska',
        razlozi: ['Ortofoto pokazuje zgradu, Microsoft je nema - vjerojatna rupa u Microsoftovoj pokrivenosti.'] };
    }

    // 2. Promjena na postojecem objektu. Ovo je zaseban dogadjaj i ne ovisi o
    //    tome je li zgrada nova - hvata "kuca postala zgrada".
    if (d.osmOznake === DA || d.osmObris === DA || d.dguVise === DA) {
      if (d.osmOznake === DA) razlozi.push('Promijenjene su OSM oznake (tip, katovi ili broj stanova).');
      if (d.osmObris === DA) razlozi.push('Tlocrt je promijenjen preko praga.');
      if (d.dguVise === DA) razlozi.push('Na istom obrisu evidentirano je više kućnih brojeva.');
      return { stanje: 'promjena-na-postojecoj', sigurnost: 'srednja', razlozi: razlozi };
    }

    // 3. Objekt je postojao prije - grana "ima ga na snimkama".
    if (d.ms === DA || d.dof === DA) {
      var izvor = d.ms === DA ? 'Microsoft (snimke do 2024.)' : 'ortofoto 2023./24.';
      if (d.dguNova === DA) {
        return { stanje: 'adresiranje-postojece', sigurnost: 'visoka',
          razlozi: [izvor + ' ima zgradu, a adresa je dodijeljena tek sada.'] };
      }
      return { stanje: 'naknadno-ucrtano', sigurnost: 'visoka',
        razlozi: [izvor + ' već ima ovu zgradu - u OpenStreetMap je unesena naknadno.'] };
    }

    // 4. Grana "nema ga na snimkama".
    if (d.ms === NE) {
      if (d.dof === NE) {
        razlozi.push('Ne vidi je ni Microsoft (do 2024.) ni ortofoto 2023./24.');
        if (d.dguNova === DA) razlozi.push('Dodijeljena je nova DGU adresa.');
        return { stanje: 'potvrdjena-novogradnja', sigurnost: 'visoka', razlozi: razlozi };
      }
      // dof je nepoznato
      razlozi.push('Microsoft je nema (snimke do 2024.), ortofoto ne može potvrditi.');
      if (d.dguNova === DA) razlozi.push('Dodijeljena je nova DGU adresa.');
      return { stanje: 'vjerojatna-novogradnja', sigurnost: 'srednja', razlozi: razlozi };
    }

    // 5. ms je nepoznat.
    if (d.dof === NE) {
      return { stanje: 'vjerojatna-novogradnja', sigurnost: 'niska',
        razlozi: ['Ortofoto 2023./24. je ne pokazuje, Microsoft podatak nedostaje.'] };
    }

    return { stanje: 'nedovoljno-podataka', sigurnost: 'nema',
      razlozi: ['Nijedan izvor još nije dao nalaz za ovu lokaciju.'] };
  }

  // Skraceni put: sirovi zapis -> puna ocjena.
  function ocijeniZapis(f, ctx) {
    var d = dokazi(f, ctx);
    var o = ocijeni(d);
    o.dokazi = d;
    return o;
  }

  // Prolazi li zapis kroz tro-stanjni filtar.
  // filtar je objekt oblika { ms: 'da'|'ne'|null, dof: ..., ... }; null znaci
  // "ne filtriraj po ovom izvoru". I-logika medju odabranima.
  function prolaziFiltar(d, filtar) {
    for (var k in filtar) {
      if (!filtar[k]) continue;
      if (d[k] !== filtar[k]) return false;
    }
    return true;
  }

  function stanjePoKljucu(kljuc) {
    for (var i = 0; i < STANJA.length; i++) if (STANJA[i].kljuc === kljuc) return STANJA[i];
    return null;
  }

  return {
    DA: DA, NE: NE, NEPOZNATO: NEPOZNATO,
    IZVORI: IZVORI, STANJA: STANJA,
    dokazi: dokazi,
    ocijeni: ocijeni,
    ocijeniZapis: ocijeniZapis,
    prolaziFiltar: prolaziFiltar,
    stanjePoKljucu: stanjePoKljucu
  };
}));