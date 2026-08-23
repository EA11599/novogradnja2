// ============================================================
//  dnevnik.js - zapisnik rada + dijagnostika za podrsku
//  Ukljucuje se u svaku stranicu POSLIJE supabase UMD skripte:
//    <script src="assets/dnevnik.js"></script>
//
//  Dvije svrhe:
//   1) evidencija rada  - tko je sto radio (kategorije prijava/pregled/evidencija)
//   2) DIJAGNOSTIKA     - zasto je nekome zapelo (kategorije greska/sustav)
//
//  Vecinu dijagnostike hvatamo AUTOMATSKI, bez diranja postojeceg koda:
//   - neuhvacene JS greske i odbijena obecanja (promise rejections)
//   - svaki console.warn / console.error koji aplikacija vec ispisuje
//   - svaki alert() koji je korisnik vidio
//   - svaki neuspjeli mrezni dohvat (fetch), s adresom i HTTP statusom
//
//  Javno API:
//    Dnevnik.postaviKorisnika(user)
//    Dnevnik.zapisi(kategorija, dogadjaj, detalji)
//    Dnevnik.zapisiOdgodjeno(kat, dog, detalji, ms)
//    Dnevnik.greska(gdje, err, detalji)
//    Dnevnik.isprazni()
//    Dnevnik.sesija      - oznaka posjeta (sve sto je jedan covjek radio u jednoj kartici)
// ============================================================
(function () {
  'use strict';

  var SB_URL = 'https://stbknyvbduzrgnbmhpxl.supabase.co';
  var SB_KEY = 'sb_publishable_TLFe8iXPlR95yOtExi7XVg_XrX22ERK';

  var STRANICA = (function () {
    var p = (location.pathname.split('/').pop() || 'index.html');
    return p.replace(/\.html?$/, '') || 'index';
  })();

  // ---------- oznaka sesije ----------
  // Ista za sve stranice otvorene u istoj kartici (index -> review -> natrag).
  // Bez nje se ne moze izvuci "sve sto se dogodilo tom korisniku u tih 5 minuta".
  var SESIJA = (function () {
    try {
      var s = sessionStorage.getItem('dnevnik_sesija');
      if (!s) {
        s = (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8));
        sessionStorage.setItem('dnevnik_sesija', s);
      }
      return s;
    } catch (e) {
      return 'bez-sesije-' + Math.random().toString(36).slice(2, 8);
    }
  })();

  // Datum zadnje izmjene HTML-a koji korisnik STVARNO ima u pregledniku.
  // Kljucno kad netko javi gresku koja je vec popravljena - odmah se vidi
  // ima li on staru verziju u cacheu.
  var VERZIJA = (function () {
    try { return document.lastModified || null; } catch (e) { return null; }
  })();

  var red = [];
  var timer = null;
  var odgode = {};
  var korisnik = { id: null, email: null, ime: null };
  var zadnji = { kljuc: null, vrijeme: 0 };

  // Ogranicenja da jedna pokvarena petlja ne napuni bazu u minuti.
  var MAX_GRESAKA = 40;
  var brojGresaka = 0;

  function postaviKorisnika(user) {
    if (!user) { korisnik = { id: null, email: null, ime: null }; return; }
    var meta = user.user_metadata || {};
    korisnik = {
      id: user.id || null,
      email: user.email || null,
      ime: meta.puno_ime || meta.full_name || meta.name || user.email || null
    };
  }

  function zapisi(kategorija, dogadjaj, detalji) {
    try {
      var kljuc = kategorija + '|' + dogadjaj + '|' + JSON.stringify(detalji || {});
      var sada = Date.now();
      if (kljuc === zadnji.kljuc && (sada - zadnji.vrijeme) < 2000) return;
      zadnji = { kljuc: kljuc, vrijeme: sada };

      red.push({
        sesija: SESIJA,
        verzija: VERZIJA,
        korisnik_id: korisnik.id,
        korisnik_email: korisnik.email,
        korisnik_ime: korisnik.ime,
        kategorija: kategorija,
        dogadjaj: dogadjaj,
        stranica: STRANICA,
        detalji: detalji || null,
        ua: navigator.userAgent ? String(navigator.userAgent).slice(0, 300) : null
      });

      if (red.length >= 25) isprazni();
      else if (!timer) timer = setTimeout(isprazni, 4000);
    } catch (e) {
      if (window.console && console.__izvorniWarn) console.__izvorniWarn('Dnevnik:', e);
    }
  }

  function zapisiOdgodjeno(kategorija, dogadjaj, detalji, ms) {
    var k = kategorija + '|' + dogadjaj;
    if (odgode[k]) clearTimeout(odgode[k]);
    odgode[k] = setTimeout(function () {
      delete odgode[k];
      var d = null;
      try { d = (typeof detalji === 'function') ? detalji() : detalji; } catch (e) { d = null; }
      zapisi(kategorija, dogadjaj, d);
    }, ms || 1500);
  }

  // ---------- greske ----------
  function opisGreske(err) {
    if (!err) return null;
    if (typeof err === 'string') return err.slice(0, 500);
    return {
      poruka: (err.message || String(err)).slice(0, 500),
      kod: err.code || err.status || null,
      // Prvih nekoliko redaka stacka - dovoljno da se vidi funkcija, a da
      // zapis ne naraste.
      stack: err.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ').slice(0, 700) : null
    };
  }

  function greska(gdje, err, detalji) {
    if (brojGresaka >= MAX_GRESAKA) return;
    brojGresaka++;
    var d = detalji || {};
    d.gdje = gdje;
    d.greska = opisGreske(err);
    zapisi('greska', 'greska', d);
    isprazni(); // greske saljemo odmah - mozda je stranica na rubu pucanja
  }

  // Neuhvacene greske u kodu
  window.addEventListener('error', function (e) {
    if (brojGresaka >= MAX_GRESAKA) return;
    // Greske pri ucitavanju <script>/<img> nemaju e.error
    if (e && e.target && e.target !== window && e.target.src) {
      brojGresaka++;
      zapisi('greska', 'resurs_se_nije_ucitao', { adresa: String(e.target.src).slice(0, 300) });
      return;
    }
    brojGresaka++;
    zapisi('greska', 'js_greska', {
      poruka: (e && e.message ? String(e.message) : 'nepoznato').slice(0, 500),
      datoteka: e && e.filename ? String(e.filename).slice(0, 200) : null,
      redak: e ? e.lineno : null,
      stack: (e && e.error && e.error.stack) ? String(e.error.stack).split('\n').slice(0, 4).join(' | ').slice(0, 700) : null
    });
    isprazni();
  }, true);

  // Odbijena obecanja (await bez try/catch) - vrlo cest uzrok "vrti se u prazno"
  window.addEventListener('unhandledrejection', function (e) {
    if (brojGresaka >= MAX_GRESAKA) return;
    brojGresaka++;
    zapisi('greska', 'neuhvacena_promise_greska', { greska: opisGreske(e && e.reason) });
    isprazni();
  });

  // ---------- presretanje console.warn / console.error ----------
  // Aplikacija na 12-ak mjesta vec ispisuje korisne poruke u konzolu
  // ("Datoteka nedostupna, preskacem...", "Dohvat recenzija nije uspio..."),
  // ali ih vidi samo onaj tko ima otvoren F12. Ovako ih vidimo i mi.
  (function () {
    if (!window.console) return;
    var izvorniWarn = console.warn ? console.warn.bind(console) : function () {};
    var izvorniError = console.error ? console.error.bind(console) : function () {};
    console.__izvorniWarn = izvorniWarn;

    function tekst(args) {
      try {
        return Array.prototype.slice.call(args).map(function (a) {
          if (a instanceof Error) return a.message;
          if (typeof a === 'object') { try { return JSON.stringify(a).slice(0, 200); } catch (e) { return '[objekt]'; } }
          return String(a);
        }).join(' ').slice(0, 600);
      } catch (e) { return '[neprikazivo]'; }
    }

    console.warn = function () {
      izvorniWarn.apply(null, arguments);
      if (brojGresaka < MAX_GRESAKA) { brojGresaka++; zapisi('sustav', 'upozorenje', { poruka: tekst(arguments) }); }
    };
    console.error = function () {
      izvorniError.apply(null, arguments);
      if (brojGresaka < MAX_GRESAKA) { brojGresaka++; zapisi('greska', 'console_error', { poruka: tekst(arguments) }); }
    };
  })();

  // ---------- presretanje alert() ----------
  // Svaki dijalog koji je korisnik vidio. Kad javi "izbacilo mi je neku
  // gresku", ovdje pise tocno koju.
  (function () {
    var izvorniAlert = window.alert;
    if (typeof izvorniAlert !== 'function') return;
    window.alert = function (poruka) {
      try { zapisi('sustav', 'poruka_korisniku', { tekst: String(poruka).slice(0, 400) }); } catch (e) {}
      return izvorniAlert.apply(window, arguments);
    };
  })();

  // ---------- presretanje fetch-a (samo neuspjeli dohvati) ----------
  (function () {
    var izvorniFetch = window.fetch;
    if (typeof izvorniFetch !== 'function') return;
    window.fetch = function (ulaz, opcije) {
      var adresa = '';
      try { adresa = (typeof ulaz === 'string') ? ulaz : (ulaz && ulaz.url) || ''; } catch (e) {}
      // NIKAD ne biljezi vlastite pozive prema dnevniku - beskonacna petlja.
      var vlastiti = adresa.indexOf('/rest/v1/dnevnik') !== -1;
      var pocetak = Date.now();
      return izvorniFetch.apply(this, arguments).then(function (odgovor) {
        if (!vlastiti && odgovor && !odgovor.ok && brojGresaka < MAX_GRESAKA) {
          brojGresaka++;
          zapisi('greska', 'dohvat_neuspjesan', {
            adresa: adresa.slice(0, 300),
            status: odgovor.status,
            trajanje_ms: Date.now() - pocetak
          });
        }
        return odgovor;
      }).catch(function (err) {
        if (!vlastiti && brojGresaka < MAX_GRESAKA) {
          brojGresaka++;
          zapisi('greska', 'dohvat_pukao', {
            adresa: adresa.slice(0, 300),
            greska: opisGreske(err),
            trajanje_ms: Date.now() - pocetak
          });
          isprazni();
        }
        throw err;
      });
    };
  })();

  // ---------- kontekst preglednika ----------
  // Salje se jednom po sesiji. Rjesava pola support pitanja unaprijed:
  // koji preglednik, koliki ekran, koja verzija stranice, kakva veza.
  function posaljiKontekst() {
    var v = {};
    try {
      v.ekran = window.innerWidth + 'x' + window.innerHeight;
      v.zoom = window.devicePixelRatio || null;
      v.jezik = navigator.language || null;
      v.online = navigator.onLine;
      v.platforma = navigator.platform || null;
      if (navigator.connection && navigator.connection.effectiveType) v.veza = navigator.connection.effectiveType;
      if (window.performance && performance.timing && performance.timing.loadEventEnd) {
        v.ucitavanje_ms = performance.timing.loadEventEnd - performance.timing.navigationStart;
      }
    } catch (e) {}
    zapisi('sustav', 'kontekst_preglednika', v);
  }
  if (document.readyState === 'complete') setTimeout(posaljiKontekst, 0);
  else window.addEventListener('load', function () { setTimeout(posaljiKontekst, 300); });

  // Gubitak i povratak mreze - cest uzrok "sve mi je stalo"
  window.addEventListener('offline', function () { zapisi('sustav', 'mreza_prekinuta', {}); });
  window.addEventListener('online', function () { zapisi('sustav', 'mreza_vracena', {}); });

  // ---------- slanje ----------
  function tokenSync() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('sb-') === 0 && k.indexOf('-auth-token') > 0) {
          var v = JSON.parse(localStorage.getItem(k));
          if (v && v.access_token) return v.access_token;
          if (v && v.currentSession && v.currentSession.access_token) return v.currentSession.access_token;
        }
      }
    } catch (e) {}
    return null;
  }

  function isprazni(pri_zatvaranju) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (red.length === 0) return;
    var paket = red;
    red = [];

    var zaglavlja = {
      'Content-Type': 'application/json',
      'apikey': SB_KEY,
      'Prefer': 'return=minimal'
    };
    var t = tokenSync();
    if (t) zaglavlja['Authorization'] = 'Bearer ' + t;

    try {
      // Namjerno originalni fetch preko window.fetch - nas omotac ionako
      // preskace adrese dnevnika.
      fetch(SB_URL + '/rest/v1/dnevnik', {
        method: 'POST',
        keepalive: !!pri_zatvaranju,
        headers: zaglavlja,
        body: JSON.stringify(paket)
      }).catch(function () {});
    } catch (e) {}
  }

  window.addEventListener('pagehide', function () { isprazni(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') isprazni(true);
  });

  window.Dnevnik = {
    postaviKorisnika: postaviKorisnika,
    zapisi: zapisi,
    zapisiOdgodjeno: zapisiOdgodjeno,
    greska: greska,
    isprazni: isprazni,
    sesija: SESIJA,
    stranica: STRANICA
  };
})();
