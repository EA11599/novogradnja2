/* AlexiGEO - plutajući chat asistent
   Uključi se s jednim retkom prije </body>:
     <script src="assets/chat.js" defer></script>
   Radi na svakoj stranici koja ima prijavljenog Supabase korisnika. */

(function () {
  "use strict";

  var POSTAVKE = {
    funkcija: "https://stbknyvbduzrgnbmhpxl.supabase.co/functions/v1/chat",
    indeks: "data/teren-indeks.json",
    sheetjs: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
    naglasak: "#E0752D",
    maxPrikaz: 8,
    maxSlikaPx: 1400,
    velicine: { normalna: [380, 520], siroka: [760, 760] },
    minSirina: 320,
    minVisina: 320,
  };

  var BIBLIOTEKA = [
    {
      skupina: "Pomoć",
      stavke: [
        "Što znači ocjena Potvrđena novogradnja?",
        "Zašto neka zgrada ima ocjenu Izvori proturječe?",
        "Koja je razlika između Naknadno ucrtano i Adresiranje postojeće?",
        "Što znači kad uz izvor piše upitnik?",
        "Zašto neke zgrade nemaju adresu nego udaljenost od ulice?",
        "Što znači masovni unos i zašto snižava pouzdanost?",
      ],
    },
    {
      skupina: "Analitika",
      stavke: [
        "Potvrđene novogradnje po županijama",
        "Gdje se Microsoft i ortofoto najčešće ne slažu?",
        "Zgrade s ocjenom Promjena na postojećoj",
        "Potvrđene novogradnje u Splitsko-dalmatinskoj županiji",
        "Koliko je zgrada ocijenjeno kao naknadno ucrtano?",
        "Višekatnice s 3 ili više katova među novogradnjama",
      ],
    },
    {
      skupina: "Izvoz",
      stavke: [
        "Izvezi u Excel potvrđene novogradnje",
        "Izvezi zgrade gdje izvori proturječe",
        "Izvezi novogradnje u Primorsko-goranskoj županiji",
      ],
    },
    {
      skupina: "Trenutni ekran",
      stavke: [
        "Koliko je zgrada trenutno prikazano na ekranu?",
        "Od ovih na ekranu, koliko ih nema adresu?",
        "Izvezi u Excel ono što je sada na ekranu",
      ],
    },
  ];

  var POZDRAV =
    "Pitajte me kako se aplikacija koristi ili tražite zgrade po ulici, mjestu, tipu i statusu.\n\n" +
    "Na primjer: zgrade u Ilici u Zagrebu koje su kandidati za novogradnju.\n\n" +
    "Možete i zalijepiti snimku ekrana (Ctrl+V) pa pitati o njoj.";

  var poruke = [];
  var indeks = null;
  var zadnjaObrada = null;
  var ucitavanje = null;
  var zadnjiRezultat = [];
  var radi = false;
  var privitak = null;

  /* ---------- stil ---------- */

  var css = [
    ".ag-chat-btn{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:none;",
    "background:" + POSTAVKE.naglasak + ";color:#fff;font-size:24px;cursor:pointer;z-index:9998;",
    "box-shadow:0 4px 14px rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center}",
    ".ag-chat-btn:hover{filter:brightness(1.08)}",
    ".ag-chat-btn:focus-visible{outline:3px solid #1a1a1a;outline-offset:2px}",
    ".ag-chat{position:fixed;right:20px;bottom:88px;width:380px;max-width:calc(100vw - 32px);",
    "height:520px;max-height:calc(100vh - 120px);background:#fff;border:1px solid #ddd8cf;border-radius:14px;",
    "box-shadow:0 10px 34px rgba(0,0,0,.20);z-index:9999;display:none;flex-direction:column;overflow:hidden;",
    "font-family:inherit;color:#2f2f2d}",
    ".ag-chat.otvoren{display:flex}",
    ".ag-chat-head{padding:12px 14px;background:" + POSTAVKE.naglasak + ";color:#fff;display:flex;",
    "align-items:center;justify-content:space-between;font-size:15px;font-weight:500}",
    ".ag-chat-head button{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1;padding:0 4px}",
    ".ag-chat-tijelo{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;font-size:14px;line-height:1.5}",
    ".ag-m{max-width:88%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word}",
    ".ag-m.ja{align-self:flex-end;background:" + POSTAVKE.naglasak + ";color:#fff;border-bottom-right-radius:4px}",
    ".ag-m.bot{align-self:flex-start;background:#f4f1ea;border-bottom-left-radius:4px}",
    ".ag-m.greska{align-self:flex-start;background:#fceaea;color:#7c2020}",
    ".ag-rez{align-self:flex-start;width:100%;background:#f4f1ea;border-radius:12px;padding:10px 12px}",
    ".ag-rez b{font-weight:500}",
    ".ag-rez ul{margin:8px 0 0;padding-left:18px}",
    ".ag-rez li{margin:2px 0}",
    ".ag-rez .ag-akcije{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}",
    ".ag-rez button{border:1px solid #d8d2c8;background:#fff;border-radius:8px;padding:6px 10px;",
    "font-size:13px;cursor:pointer;font-family:inherit;color:#2f2f2d}",
    ".ag-rez button:hover{background:#efeae1}",
    ".ag-chat-noga{border-top:1px solid #e8e3da;padding:10px;display:flex;gap:8px}",
    ".ag-chat-noga textarea{flex:1;resize:none;border:1px solid #d8d2c8;border-radius:8px;padding:8px 10px;",
    "font-family:inherit;font-size:14px;height:40px;max-height:110px;color:#2f2f2d}",
    ".ag-chat-noga button{border:none;background:" + POSTAVKE.naglasak + ";color:#fff;border-radius:8px;",
    "width:40px;font-size:17px;cursor:pointer}",
    ".ag-chat-noga button:disabled{opacity:.5;cursor:default}",
    ".ag-tipka{align-self:flex-start;color:#8a857c;font-size:13px;padding:4px 2px}",
    ".ag-privitak{display:none;align-items:center;gap:8px;padding:8px 10px 0;border-top:1px solid #e8e3da}",
    ".ag-privitak.vidljiv{display:flex}",
    ".ag-privitak img{height:44px;width:44px;object-fit:cover;border-radius:6px;border:1px solid #d8d2c8}",
    ".ag-privitak span{font-size:12px;color:#8a857c;flex:1}",
    ".ag-privitak button{border:none;background:none;font-size:18px;cursor:pointer;color:#8a857c;padding:0 4px}",
    ".ag-m img{max-width:100%;border-radius:8px;margin-top:6px;display:block}",
    ".ag-chat.nadlijece{outline:2px dashed " + POSTAVKE.naglasak + ";outline-offset:-6px}",
    ".ag-grip{position:absolute;left:0;top:0;width:18px;height:18px;cursor:nwse-resize;z-index:2}",
    ".ag-grip::before{content:'';position:absolute;left:5px;top:5px;width:7px;height:7px;",
    "border-left:2px solid rgba(255,255,255,.65);border-top:2px solid rgba(255,255,255,.65)}",
    ".ag-chat-head .ag-sire,.ag-chat-head .ag-knjiga{font-size:15px;margin-right:2px}",
    ".ag-biblioteka{display:none;padding:12px 14px;overflow-y:auto;border-top:1px solid #e8e3da;",
    "background:#faf8f4;flex:1}",
    ".ag-biblioteka.otvorena{display:block}",
    ".ag-biblioteka h4{margin:12px 0 6px;font-size:12px;font-weight:500;color:#8a857c;",
    "text-transform:uppercase;letter-spacing:.04em}",
    ".ag-biblioteka h4:first-child{margin-top:0}",
    ".ag-biblioteka button{display:block;width:100%;text-align:left;border:1px solid #e2ddd3;",
    "background:#fff;border-radius:8px;padding:8px 10px;margin-bottom:6px;font-size:13px;",
    "font-family:inherit;color:#2f2f2d;cursor:pointer;line-height:1.4}",
    ".ag-biblioteka button:hover{background:#f2ede4;border-color:#d0c9bd}",
    "@media(max-width:520px){.ag-chat{right:8px!important;left:8px!important;width:auto!important;",
    "bottom:80px;height:calc(100vh - 110px)!important}",
    ".ag-grip{display:none}",
    ".ag-chat-btn{right:14px;bottom:14px}}",
  ].join("");

  var stil = document.createElement("style");
  stil.textContent = css;
  document.head.appendChild(stil);

  /* ---------- sučelje ---------- */

  var gumb = document.createElement("button");
  gumb.className = "ag-chat-btn";
  gumb.setAttribute("aria-label", "Otvori asistenta");
  gumb.textContent = "\u2709";

  var panel = document.createElement("div");
  panel.className = "ag-chat";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Asistent");
  panel.innerHTML =
    '<div class="ag-grip" title="Povucite za promjenu veličine"></div>' +
    '<div class="ag-chat-head"><span>Asistent</span><span>' +
    '<button type="button" class="ag-knjiga" aria-label="Primjeri pitanja">&#9776;</button>' +
    '<button type="button" class="ag-sire" aria-label="Proširi">&#9974;</button>' +
    '<button type="button" class="ag-zatvori" aria-label="Zatvori">&times;</button></span></div>' +
    '<div class="ag-chat-tijelo"></div>' +
    '<div class="ag-biblioteka"></div>' +
    '<div class="ag-privitak"><img alt="Priložena slika"><span></span>' +
    '<button type="button" aria-label="Ukloni sliku">&times;</button></div>' +
    '<div class="ag-chat-noga">' +
    '<textarea rows="1" placeholder="Pitajte nešto..." aria-label="Poruka"></textarea>' +
    '<button type="button" aria-label="Pošalji">&#9654;</button></div>';

  document.body.appendChild(gumb);
  document.body.appendChild(panel);

  var tijelo = panel.querySelector(".ag-chat-tijelo");
  var polje = panel.querySelector("textarea");
  var posalji = panel.querySelector(".ag-chat-noga button");
  var zatvori = panel.querySelector(".ag-chat-head .ag-zatvori");
  var sireGumb = panel.querySelector(".ag-chat-head .ag-sire");
  var grip = panel.querySelector(".ag-grip");
  var knjigaGumb = panel.querySelector(".ag-chat-head .ag-knjiga");
  var biblioteka = panel.querySelector(".ag-biblioteka");

  BIBLIOTEKA.forEach(function (grupa) {
    var h = document.createElement("h4");
    h.textContent = grupa.skupina;
    biblioteka.appendChild(h);
    grupa.stavke.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = t;
      b.addEventListener("click", function () {
        polje.value = t;
        prikaziBiblioteku(false);
        polje.style.height = "40px";
        polje.style.height = Math.min(polje.scrollHeight, 110) + "px";
        polje.focus();
      });
      biblioteka.appendChild(b);
    });
  });

  function prikaziBiblioteku(otvori) {
    biblioteka.classList.toggle("otvorena", otvori);
    tijelo.style.display = otvori ? "none" : "flex";
    knjigaGumb.setAttribute("aria-label", otvori ? "Zatvori primjere" : "Primjeri pitanja");
  }

  knjigaGumb.addEventListener("click", function () {
    prikaziBiblioteku(!biblioteka.classList.contains("otvorena"));
  });
  var trakaPrivitka = panel.querySelector(".ag-privitak");
  var slicica = trakaPrivitka.querySelector("img");
  var opisPrivitka = trakaPrivitka.querySelector("span");
  trakaPrivitka.querySelector("button").addEventListener("click", ocistiPrivitak);

  gumb.addEventListener("click", function () {
    panel.classList.toggle("otvoren");
    if (panel.classList.contains("otvoren")) {
      if (!tijelo.childNodes.length) dodajPoruku("bot", POZDRAV);
      polje.focus();
    }
  });
  zatvori.addEventListener("click", function () {
    panel.classList.remove("otvoren");
    gumb.focus();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel.classList.contains("otvoren")) {
      panel.classList.remove("otvoren");
      gumb.focus();
    }
  });
  polje.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      posaljiPoruku();
    }
  });
  polje.addEventListener("input", function () {
    polje.style.height = "40px";
    polje.style.height = Math.min(polje.scrollHeight, 110) + "px";
  });
  posalji.addEventListener("click", posaljiPoruku);

  function dodajPoruku(vrsta, tekst) {
    prikaziBiblioteku(false);
    var d = document.createElement("div");
    d.className = "ag-m " + vrsta;
    d.textContent = tekst;
    tijelo.appendChild(d);
    tijelo.scrollTop = tijelo.scrollHeight;
    return d;
  }



  /* ---------- veličina panela ---------- */

  function granice(w, h) {
    return [
      Math.max(POSTAVKE.minSirina, Math.min(w, window.innerWidth - 32)),
      Math.max(POSTAVKE.minVisina, Math.min(h, window.innerHeight - 110)),
    ];
  }

  function postaviVelicinu(w, h, zapamti) {
    var v = granice(w, h);
    panel.style.width = v[0] + "px";
    panel.style.height = v[1] + "px";
    var siroka = v[0] > POSTAVKE.velicine.normalna[0] + 40;
    sireGumb.innerHTML = siroka ? "&#9986;" : "&#9974;";
    sireGumb.setAttribute("aria-label", siroka ? "Smanji" : "Proširi");
    if (zapamti) {
      try {
        localStorage.setItem("ag-chat-velicina", v[0] + "x" + v[1]);
      } catch (e) {
        /* privatni način rada, veličina se onda ne pamti */
      }
    }
  }

  function vratiVelicinu() {
    var n = POSTAVKE.velicine.normalna;
    try {
      var z = (localStorage.getItem("ag-chat-velicina") || "").split("x");
      if (z.length === 2 && +z[0] && +z[1]) return postaviVelicinu(+z[0], +z[1], false);
    } catch (e) {
      /* preskoči */
    }
    postaviVelicinu(n[0], n[1], false);
  }

  sireGumb.addEventListener("click", function () {
    var n = POSTAVKE.velicine.normalna;
    var si = POSTAVKE.velicine.siroka;
    var trenutna = parseInt(panel.style.width, 10) || n[0];
    if (trenutna > n[0] + 40) postaviVelicinu(n[0], n[1], true);
    else postaviVelicinu(si[0], si[1], true);
  });

  grip.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    var x0 = e.clientX;
    var y0 = e.clientY;
    var w0 = panel.offsetWidth;
    var h0 = panel.offsetHeight;

    function vuci(ev) {
      postaviVelicinu(w0 + (x0 - ev.clientX), h0 + (y0 - ev.clientY), false);
    }
    function pusti(ev) {
      grip.removeEventListener("pointermove", vuci);
      grip.removeEventListener("pointerup", pusti);
      try {
        grip.releasePointerCapture(ev.pointerId);
      } catch (er) {
        /* preskoči */
      }
      postaviVelicinu(panel.offsetWidth, panel.offsetHeight, true);
    }
    grip.addEventListener("pointermove", vuci);
    grip.addEventListener("pointerup", pusti);
  });

  window.addEventListener("resize", function () {
    if (panel.classList.contains("otvoren")) {
      postaviVelicinu(panel.offsetWidth, panel.offsetHeight, false);
    }
  });

  vratiVelicinu();

  /* ---------- slike ---------- */

  function ocistiPrivitak() {
    privitak = null;
    trakaPrivitka.classList.remove("vidljiv");
    slicica.removeAttribute("src");
    opisPrivitka.textContent = "";
  }

  function smanji(datoteka) {
    return new Promise(function (ok, ne) {
      var citac = new FileReader();
      citac.onerror = function () {
        ne(new Error("Ne mogu pročitati sliku."));
      };
      citac.onload = function () {
        var img = new Image();
        img.onerror = function () {
          ne(new Error("Neispravna slika."));
        };
        img.onload = function () {
          var omjer = Math.min(1, POSTAVKE.maxSlikaPx / Math.max(img.width, img.height));
          var platno = document.createElement("canvas");
          platno.width = Math.round(img.width * omjer);
          platno.height = Math.round(img.height * omjer);
          platno.getContext("2d").drawImage(img, 0, 0, platno.width, platno.height);
          var url = platno.toDataURL("image/jpeg", 0.85);
          ok({
            media_type: "image/jpeg",
            data: url.split(",")[1],
            pregled: url,
            px: platno.width + "\u00d7" + platno.height,
          });
        };
        img.src = citac.result;
      };
      citac.readAsDataURL(datoteka);
    });
  }

  function primiSliku(datoteka) {
    if (!datoteka || datoteka.type.indexOf("image/") !== 0) return;
    smanji(datoteka)
      .then(function (s) {
        privitak = s;
        slicica.src = s.pregled;
        opisPrivitka.textContent = "Slika priložena (" + s.px + ")";
        trakaPrivitka.classList.add("vidljiv");
        polje.focus();
      })
      .catch(function (e) {
        dodajPoruku("greska", e.message);
      });
  }

  panel.addEventListener("paste", function (e) {
    var stavke = (e.clipboardData || {}).items || [];
    for (var i = 0; i < stavke.length; i++) {
      if (stavke[i].type.indexOf("image/") === 0) {
        e.preventDefault();
        primiSliku(stavke[i].getAsFile());
        return;
      }
    }
  });

  ["dragenter", "dragover"].forEach(function (d) {
    panel.addEventListener(d, function (e) {
      e.preventDefault();
      panel.classList.add("nadlijece");
    });
  });
  ["dragleave", "drop"].forEach(function (d) {
    panel.addEventListener(d, function (e) {
      e.preventDefault();
      panel.classList.remove("nadlijece");
    });
  });
  panel.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files;
    if (f && f.length) primiSliku(f[0]);
  });

  function bezStarihSlika() {
    // Slike zadržavamo samo u zadnje dvije poruke, inače svaki idući upit plaća istu sliku ponovno.
    return poruke.map(function (p, i) {
      if (i >= poruke.length - 2 || !Array.isArray(p.content)) return p;
      var tekst = p.content
        .filter(function (b) {
          return b.type === "text";
        })
        .map(function (b) {
          return b.text;
        })
        .join(" ");
      return { role: p.role, content: (tekst || "(slika)").trim() };
    });
  }

  /* ---------- prijava ---------- */

  function dohvatiToken() {
    var klijenti = [window.supabase, window.supabaseClient, window.sb, window.db];
    for (var i = 0; i < klijenti.length; i++) {
      var k = klijenti[i];
      if (k && k.auth && typeof k.auth.getSession === "function") {
        return k.auth.getSession().then(function (r) {
          return r && r.data && r.data.session ? r.data.session.access_token : izLokalne();
        });
      }
    }
    return Promise.resolve(izLokalne());
  }

  function izLokalne() {
    for (var i = 0; i < localStorage.length; i++) {
      var kljuc = localStorage.key(i);
      if (kljuc && kljuc.indexOf("sb-") === 0 && kljuc.indexOf("-auth-token") > -1) {
        try {
          var v = JSON.parse(localStorage.getItem(kljuc));
          if (v && v.access_token) return v.access_token;
          if (v && v.currentSession && v.currentSession.access_token) return v.currentSession.access_token;
        } catch (e) {
          /* preskoči */
        }
      }
    }
    return null;
  }

  /* ---------- razgovor ---------- */

  function posaljiPoruku() {
    var tekst = polje.value.trim();
    if ((!tekst && !privitak) || radi) return;
    var slika = privitak;
    polje.value = "";
    polje.style.height = "40px";

    var mjehur = dodajPoruku("ja", tekst || "Što je na ovoj slici?");
    if (slika) {
      var pregled = document.createElement("img");
      pregled.src = slika.pregled;
      pregled.alt = "Priložena slika";
      mjehur.appendChild(pregled);
      tijelo.scrollTop = tijelo.scrollHeight;
    }

    if (slika) {
      poruke.push({
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: slika.media_type, data: slika.data },
          },
          { type: "text", text: tekst || "Što je na ovoj slici?" },
        ],
      });
    } else {
      poruke.push({ role: "user", content: tekst });
    }
    ocistiPrivitak();

    radi = true;
    posalji.disabled = true;
    var cekaj = document.createElement("div");
    cekaj.className = "ag-tipka";
    cekaj.textContent = "razmišljam...";
    tijelo.appendChild(cekaj);
    tijelo.scrollTop = tijelo.scrollHeight;

    dohvatiToken()
      .then(function (token) {
        if (!token) throw new Error("Niste prijavljeni. Osvježite stranicu i prijavite se ponovno.");
        return fetch(POSTAVKE.funkcija, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ poruke: bezStarihSlika() }),
        });
      })
      .then(function (r) {
        return r.json().then(function (t) {
          if (!r.ok) throw new Error(t.greska || "Greška " + r.status);
          return t;
        });
      })
      .then(function (odg) {
        cekaj.remove();
        var zapamti = odg.tekst || "";
        if (odg.tekst) dodajPoruku("bot", odg.tekst);
        if (odg.filter) {
          return primijeniFilter(odg.filter).then(function (sazetak) {
            poruke.push({ role: "assistant", content: (zapamti + "\n" + sazetak).trim() });
          });
        }
        poruke.push({ role: "assistant", content: zapamti || "(bez odgovora)" });
      })
      .catch(function (e) {
        cekaj.remove();
        dodajPoruku("greska", e.message || "Nešto je pošlo po zlu.");
        poruke.pop();
      })
      .then(function () {
        radi = false;
        posalji.disabled = false;
        polje.focus();
      });
  }

  /* ---------- indeks ---------- */

  function ucitajIndeks() {
    if (indeks) return Promise.resolve(indeks);
    if (ucitavanje) return ucitavanje;
    ucitavanje = fetch(POSTAVKE.indeks)
      .then(function (r) {
        if (!r.ok) throw new Error("Ne mogu učitati indeks zgrada (" + r.status + ").");
        return r.json();
      })
      .then(function (d) {
        indeks = Array.isArray(d.zgrade) ? d.zgrade : [];
        // Sidro za razdoblja je najkasniji datum detekcije u podacima, dakle dan
        // zadnjeg tjednog pokretanja. Polje "generirano" je kad je datoteka
        // sastavljena, a to zna biti dan-dva kasnije, pa bi prozor ispao kraći
        // nego onaj koji aplikacija pokazuje na ekranu.
        zadnjaObrada = null;
        indeks.forEach(function (z) {
          if (z.d && (!zadnjaObrada || z.d > zadnjaObrada)) zadnjaObrada = z.d;
        });
        return indeks;
      });
    return ucitavanje;
  }

  /* ---------- filtriranje ---------- */

  var DOZVOLJENA = [
    "ulica", "mjesto", "zupanija", "tip", "katoviMin", "katoviMax",
    "satelit", "imaAdresu", "masovniUnos", "datumOd", "datumDo", "zadnjihDana", "saEkrana",
    "sortiraj", "limit", "izvezi",
    // Novo uz model kompozitne ocjene. Bez ovoga bi asistent mogao traziti
    // "potvrdjene novogradnje", ali bi ocisti() taj filtar tiho odbacio i
    // vratio bi cijeli popis - najgora vrsta greske, jer izgleda kao odgovor.
    "ocjena", "izvor", "status", "ms",
  ];
  var SATELIT = ["kandidat", "stara", "nema_snimke"];
  var OCJENE = [
    "potvrdjena-novogradnja", "vjerojatna-novogradnja", "promjena-na-postojecoj",
    "adresiranje-postojece", "naknadno-ucrtano", "proturjecje", "nedovoljno-podataka",
  ];
  var IZVORI_REDAKA = ["OSM", "DGU", "MS"];
  var STATUSI = ["nepotvrđeno", "potvrđeno", "odbačeno"];

  function ocisti(sirovi) {
    var f = {};
    if (!sirovi || typeof sirovi !== "object") return f;
    DOZVOLJENA.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(sirovi, k)) f[k] = sirovi[k];
    });
    if (f.satelit) {
      f.satelit = [].concat(f.satelit).filter(function (s) {
        return SATELIT.indexOf(s) > -1;
      });
      if (!f.satelit.length) delete f.satelit;
    }
    if (f.tip) {
      f.tip = [].concat(f.tip).filter(function (t) {
        return typeof t === "string" && t.length < 40;
      });
      if (!f.tip.length) delete f.tip;
    }
    [["ocjena", OCJENE], ["izvor", IZVORI_REDAKA], ["status", STATUSI]].forEach(function (par) {
      var kljuc = par[0], dopusteno = par[1];
      if (!f[kljuc]) return;
      f[kljuc] = [].concat(f[kljuc]).filter(function (v) {
        return dopusteno.indexOf(v) > -1;
      });
      if (!f[kljuc].length) delete f[kljuc];
    });
    ["katoviMin", "katoviMax", "limit", "zadnjihDana"].forEach(function (k) {
      if (k in f) {
        var n = Number(f[k]);
        if (isFinite(n)) f[k] = n;
        else delete f[k];
      }
    });
    ["datumOd", "datumDo"].forEach(function (k) {
      if (k in f && !/^\d{4}-\d{2}-\d{2}$/.test(String(f[k]))) delete f[k];
    });
    return f;
  }

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[čć]/g, "c")
      .replace(/đ/g, "d")
      .replace(/š/g, "s")
      .replace(/ž/g, "z")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function bezBroja(adresa) {
    return String(adresa || "").replace(/\s+\d+\s*[a-zA-ZčćžšđČĆŽŠĐ]?$/, "").trim();
  }

  function imaRijec(sijeno, igla) {
    var h = norm(sijeno);
    var n = norm(igla).trim();
    if (!n) return true;
    var esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + esc + "([^a-z0-9]|$)").test(h);
  }


  function razmak(a, b) {
    // Levenshtein: koliko znakova treba promijeniti da jedan niz postane drugi.
    if (a === b) return 0;
    var pret = [];
    for (var j = 0; j <= b.length; j++) pret[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var sad = [i];
      for (var k = 1; k <= b.length; k++) {
        sad[k] = Math.min(
          pret[k] + 1,
          sad[k - 1] + 1,
          pret[k - 1] + (a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1),
        );
      }
      pret = sad;
    }
    return pret[b.length];
  }

  function jezgra(naziv) {
    return norm(naziv).replace(/zupanija/g, "").replace(/[^a-z0-9]/g, "").trim();
  }

  function nadjiZupanije(unos, svi) {
    // Model zna pogriješiti slog u nazivu, npr. Splitsko-dalmatska umjesto
    // Splitsko-dalmatinska. Zato tražimo najbliži naziv, ne doslovan podniz.
    var cilj = jezgra(unos);
    if (!cilj) return null;
    var popis = [];
    svi.forEach(function (z) {
      if (z.z && popis.indexOf(z.z) === -1) popis.push(z.z);
    });

    var pogodci = popis.filter(function (k) {
      var kj = jezgra(k);
      return kj.indexOf(cilj) > -1 || cilj.indexOf(kj) > -1;
    });
    if (pogodci.length) return pogodci;

    var najbolji = null;
    var najmanji = 99;
    popis.forEach(function (k) {
      var d = razmak(jezgra(k), cilj);
      if (d < najmanji) {
        najmanji = d;
        najbolji = k;
      }
    });
    return najmanji <= 4 && najbolji ? [najbolji] : [];
  }

  // Prijevod zbijenog terenskog zapisa u dokaze koje Ocjena razumije. Isto kao
  // u teren.html - polja su kratka radi velicine datoteke.
  function ocjenaZapisa(z) {
    if (z.__ocj) return z.__ocj;
    if (typeof Ocjena === "undefined") return "nedovoljno-podataka";
    var DA = Ocjena.DA, NE = Ocjena.NE, NEP = Ocjena.NEPOZNATO;
    z.__ocj = Ocjena.ocijeni({
      noviObris: z.g ? DA : NE,
      ms: z.ms === 1 ? DA : z.ms === 0 ? NE : NEP,
      dof: z.s === "stara" ? DA : z.s === "kandidat" ? NE : NEP,
      dguNova: z.n === 1 ? DA : NE,
      dguVise: z.v == null ? NEP : (z.v > 1 ? DA : NE),
      osmOznake: NEP,
      osmObris: z.p === 1 ? DA : NE,
    }).stanje;
    return z.__ocj;
  }

  // Status rucne provjere zivi u Supabaseu, a chat.js ga sam ne dohvaca.
  // Stranica ga izlaze kao window.__statusZaId - dogovorena funkcija umjesto
  // kopanja po globalnim varijablama, koje se ionako razlikuju po stranici
  // (teren ima mapu statusa, puni pregled polje na svakom zapisu).
  function statusZapisa(z) {
    try {
      if (typeof window.__statusZaId === "function") return window.__statusZaId(z.i) || "nepotvrđeno";
    } catch (e) {}
    return "nepotvrđeno";
  }

  function odgovara(z, f) {
    if (f._ekran && !f._ekran[z.i]) return false;
    if (f.ulica) {
      if (!z.a) return false;
      if (!imaRijec(bezBroja(z.a), f.ulica)) return false;
    }
    if (f.mjesto && !imaRijec(z.m, f.mjesto)) return false;
    if (f._zupanije && f._zupanije.indexOf(z.z) === -1) return false;
    if (f.tip && f.tip.indexOf(z.t) === -1) return false;
    if (f.satelit && f.satelit.indexOf(z.s) === -1) return false;
    // Kompozitna ocjena se racuna iz istih dokaza kao u sucelju, preko
    // assets/ocjena.js - jedan izvor istine, bez druge implementacije.
    if (f.ocjena && f.ocjena.indexOf(ocjenaZapisa(z)) === -1) return false;
    if (f.izvor && f.izvor.indexOf(z.o || "OSM") === -1) return false;
    if (f.status && f.status.indexOf(statusZapisa(z)) === -1) return false;
    if (typeof f.ms === "boolean") {
      if (z.ms === null || z.ms === undefined) return false; // nepoznato nije ni da ni ne
      if ((z.ms === 1) !== f.ms) return false;
    }
    if (typeof f.imaAdresu === "boolean" && !!z.a !== f.imaAdresu) return false;
    if (typeof f.masovniUnos === "boolean" && (z.u === 1) !== f.masovniUnos) return false;
    if (f.katoviMin != null || f.katoviMax != null) {
      var k = parseInt(z.k, 10);
      if (!isFinite(k)) return false;
      if (f.katoviMin != null && k < f.katoviMin) return false;
      if (f.katoviMax != null && k > f.katoviMax) return false;
    }
    if (f.datumOd && (!z.d || z.d < f.datumOd)) return false;
    if (f.datumDo && (!z.d || z.d > f.datumDo)) return false;
    return true;
  }

  function primijeniFilter(sirovi) {
    var f = ocisti(sirovi);
    return ucitajIndeks().then(function (svi) {
      var upozorenja = [];

      if (f.zupanija) {
        f._zupanije = nadjiZupanije(f.zupanija, svi);
        if (f._zupanije && !f._zupanije.length) {
          upozorenja.push("Županiju \u201e" + f.zupanija + "\u201d ne prepoznajem.");
          delete f._zupanije;
          delete f.zupanija;
        } else if (f._zupanije && f._zupanije.length === 1 && jezgra(f._zupanije[0]) !== jezgra(f.zupanija)) {
          f.zupanija = f._zupanije[0];
        }
      }

      if (f.saEkrana) {
        var stanje = null;
        try {
          stanje = typeof window.agStanjeEkrana === "function" ? window.agStanjeEkrana() : null;
        } catch (e) {
          stanje = null;
        }
        if (stanje && Array.isArray(stanje.ids)) {
          f._ekran = {};
          stanje.ids.forEach(function (id) {
            f._ekran[id] = 1;
          });
          upozorenja.push(
            "Ograničeno na prikazano na ekranu" + (stanje.opis ? " (" + stanje.opis + ")" : "") + ".",
          );
        } else {
          upozorenja.push("Ne mogu pročitati što je na ekranu, pa sam pretražio cijeli indeks.");
          delete f.saEkrana;
        }
      }

      if (f.zadnjihDana > 0 && !f.datumOd) {
        var sidro = zadnjaObrada ? new Date(zadnjaObrada + "T00:00:00Z") : new Date();
        var d = new Date(sidro.getTime() - f.zadnjihDana * 86400000);
        f.datumOd = d.toISOString().slice(0, 10);
        if (zadnjaObrada) {
          upozorenja.push(
            "Razdoblje ide unatrag od zadnje obrade (" + zadnjaObrada + "), isto kao gumbi na ekranu.",
          );
        }
      }

      var rez = svi.filter(function (z) {
        return odgovara(z, f);
      });
      if (f.sortiraj === "adresa") {
        rez.sort(function (a, b) {
          return String(a.a || "").localeCompare(String(b.a || ""), "hr");
        });
      } else if (f.sortiraj === "katovi") {
        rez.sort(function (a, b) {
          return (parseInt(b.k, 10) || 0) - (parseInt(a.k, 10) || 0);
        });
      } else {
        rez.sort(function (a, b) {
          return String(b.d || "").localeCompare(String(a.d || ""));
        });
      }
      var ukupno = rez.length;
      var granica = f.limit && f.limit > 0 ? Math.min(f.limit, 5000) : 500;
      rez = rez.slice(0, granica);
      var odrezano = ukupno - rez.length;
      if (!rez.length) {
        var bezJednog = ["ulica", "mjesto", "zupanija", "tip", "satelit", "datumOd"];
        bezJednog.forEach(function (k) {
          if (f[k] == null) return;
          var probni = {};
          for (var p in f) if (p !== k && p !== "_zupanije" || (p === "_zupanije" && k !== "zupanija")) probni[p] = f[p];
          if (k === "zupanija") delete probni._zupanije;
          var koliko = svi.filter(function (z) {
            return odgovara(z, probni);
          }).length;
          if (koliko > 0) {
            var vr = Array.isArray(f[k]) ? f[k].join(", ") : f[k];
            upozorenja.push(
              "Bez uvjeta \u201e" + k + "\u201d (" + vr + ") bilo bi " + koliko + " zgrada.",
            );
          }
        });
      }

      zadnjiRezultat = rez;
      window.__agChatRezultat = rez;
      prikaziRezultat(rez, f, upozorenja, ukupno);
      if (f.izvezi && rez.length) uExcel(rez);
      var cist = {};
      for (var kl in f) if (kl.charAt(0) !== "_") cist[kl] = f[kl];
      return (
        "Primijenjen filtar: " + JSON.stringify(cist) + ". " +
        "Pronađeno " + ukupno + " zgrada" +
        (odrezano > 0
          ? ", prikazano prvih " + rez.length + ". Ako korisnik želi sve, ponovi pretragu s većim limitom."
          : ".") +
        (upozorenja.length ? " " + upozorenja.join(" ") : "") +
        " Ako korisnik traži jedan od ovih podskupova, ponovi isti filtar samo bez navedenog uvjeta, ostalo ostavi nepromijenjeno."
      );
    });
  }

  /* ---------- prikaz rezultata ---------- */


  function adresaZa(z) {
    if (z.a) return z.a;
    if (z.n && z.nd != null) return "~" + Math.round(z.nd) + " m od " + z.n;
    if (z.n) return "blizu: " + z.n;
    if (typeof z.y === "number" && typeof z.x === "number") {
      return z.y.toFixed(5) + ", " + z.x.toFixed(5);
    }
    return "bez adrese";
  }

  function opisFiltera(f) {
    var d = [];
    if (f.ulica) d.push("ulica " + f.ulica);
    if (f.mjesto) d.push(f.mjesto);
    if (f.zupanija) d.push(f.zupanija);
    if (f.tip) d.push("tip " + f.tip.join(", "));
    if (f.satelit) d.push(f.satelit.join(" ili "));
    if (f.ocjena) d.push(f.ocjena.map(function (k) {
      var st = (typeof Ocjena !== "undefined") ? Ocjena.stanjePoKljucu(k) : null;
      return st ? st.naziv : k;
    }).join(" ili "));
    if (f.izvor) d.push("izvor " + f.izvor.join(", "));
    if (f.status) d.push(f.status.join(" ili "));
    if (f.ms === true) d.push("Microsoft ima zgradu");
    if (f.ms === false) d.push("Microsoft nema zgradu");
    if (f.imaAdresu === true) d.push("s adresom");
    if (f.imaAdresu === false) d.push("bez adrese");
    if (f.masovniUnos === true) d.push("masovni unos");
    if (f.masovniUnos === false) d.push("bez masovnog unosa");
    if (f.saEkrana) d.push("s ekrana");
    if (f.katoviMin != null) d.push("min " + f.katoviMin + " kat.");
    if (f.katoviMax != null) d.push("max " + f.katoviMax + " kat.");
    if (f.zadnjihDana) d.push("zadnjih " + f.zadnjihDana + " dana");
    else if (f.datumOd) d.push("od " + f.datumOd);
    if (f.datumDo) d.push("do " + f.datumDo);
    return d.length ? d.join(" \u00b7 ") : "bez filtera";
  }

  function prikaziRezultat(rez, f, upozorenja, ukupno) {
    var box = document.createElement("div");
    box.className = "ag-rez";

    if (typeof ukupno !== "number") ukupno = rez.length;
    var naslov = document.createElement("div");
    naslov.innerHTML =
      ukupno > rez.length
        ? "<b>" + ukupno + " zgrada</b> \u00b7 prikazano prvih " + rez.length
        : "<b>" + ukupno + " zgrada</b>";
    box.appendChild(naslov);

    var pod = document.createElement("div");
    pod.style.cssText = "font-size:12px;color:#8a857c;margin-top:2px";
    pod.textContent = opisFiltera(f);
    box.appendChild(pod);

    (upozorenja || []).forEach(function (u) {
      var w = document.createElement("div");
      w.style.cssText = "font-size:12px;color:#8a5a12;margin-top:6px";
      w.textContent = u;
      box.appendChild(w);
    });

    if (rez.length) {
      var ul = document.createElement("ul");
      rez.slice(0, POSTAVKE.maxPrikaz).forEach(function (z) {
        var li = document.createElement("li");
        li.textContent = adresaZa(z) + (z.m ? ", " + z.m : "") + (z.d ? " (" + z.d + ")" : "");
        ul.appendChild(li);
      });
      box.appendChild(ul);
      if (rez.length > POSTAVKE.maxPrikaz) {
        var jos = document.createElement("div");
        jos.style.cssText = "font-size:12px;color:#8a857c;margin-top:4px";
        jos.textContent = "i još " + (rez.length - POSTAVKE.maxPrikaz) + " u Excelu.";
        box.appendChild(jos);
      }
      if (ukupno > rez.length) {
        var rez2 = document.createElement("div");
        rez2.style.cssText = "font-size:12px;color:#8a5a12;margin-top:4px";
        rez2.textContent =
          "Excel sadrži prvih " + rez.length + " od " + ukupno + ". Tražite veći broj ili suzite pretragu.";
        box.appendChild(rez2);
      }

      var akcije = document.createElement("div");
      akcije.className = "ag-akcije";

      var bExcel = document.createElement("button");
      bExcel.type = "button";
      bExcel.textContent = "Preuzmi Excel";
      bExcel.addEventListener("click", function () {
        uExcel(rez);
      });
      akcije.appendChild(bExcel);

      if (typeof window.agPrikaziNaKarti === "function") {
        var bKarta = document.createElement("button");
        bKarta.type = "button";
        bKarta.textContent = "Prikaži na karti";
        bKarta.addEventListener("click", function () {
          window.agPrikaziNaKarti(rez);
          panel.classList.remove("otvoren");
        });
        akcije.appendChild(bKarta);
      }
      box.appendChild(akcije);
    }

    tijelo.appendChild(box);
    tijelo.scrollTop = tijelo.scrollHeight;
  }

  /* ---------- Excel ---------- */

  function ucitajSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (ok, ne) {
      var s = document.createElement("script");
      s.src = POSTAVKE.sheetjs;
      s.onload = function () {
        ok();
      };
      s.onerror = function () {
        ne(new Error("Ne mogu učitati komponentu za Excel."));
      };
      document.head.appendChild(s);
    });
  }

  function uExcel(rez) {
    ucitajSheetJS()
      .then(function () {
        var zaglavlje = [
          "Adresa", "Adresa poznata", "Mjesto", "Županija", "Tip", "Katovi",
          "Satelitska presuda", "Masovni unos", "Datum detekcije", "OSM ID",
          "Lat", "Lon", "Karta",
        ];
        var redovi = rez.map(function (z) {
          return [
            adresaZa(z), z.a ? "da" : "ne", z.m || "\u2014", z.z || "\u2014",
            z.t || "\u2014", z.k || "\u2014", z.s || "\u2014",
            z.u === 1 ? "da" : "ne", z.d || "\u2014", z.i || "",
            z.y, z.x,
            "https://www.google.com/maps?q=" + z.y + "," + z.x,
          ];
        });
        var stupacKarte = zaglavlje.length - 1;
        var ws = window.XLSX.utils.aoa_to_sheet([zaglavlje].concat(redovi));
        for (var i = 0; i < redovi.length; i++) {
          var adr = window.XLSX.utils.encode_cell({ r: i + 1, c: stupacKarte });
          if (ws[adr]) {
            ws[adr].l = { Target: redovi[i][stupacKarte], Tooltip: "Otvori u Google Maps" };
            ws[adr].v = "karta";
          }
        }
        ws["!cols"] = [
          { wch: 36 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 14 },
          { wch: 8 }, { wch: 18 }, { wch: 13 }, { wch: 16 }, { wch: 18 },
          { wch: 11 }, { wch: 11 }, { wch: 10 },
        ];
        var wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Zgrade");
        var d = new Date().toISOString().slice(0, 10);
        window.XLSX.writeFile(wb, "alexigeo-pretraga-" + d + ".xlsx");
      })
      .catch(function (e) {
        dodajPoruku("greska", e.message);
      });
  }

  window.agChat = {
    otvori: function () {
      panel.classList.add("otvoren");
      if (!tijelo.childNodes.length) dodajPoruku("bot", POZDRAV);
      polje.focus();
    },
    rezultat: function () {
      return zadnjiRezultat;
    },
  };
})();
