// ==UserScript==
// @name         Plemiona - Auto fejk/off/burzak z listy + precyzyjny wysyłacz
// @namespace    pf-plemiona-autosend
// @version      0.6
// @description  Wklejasz listę zleceń (fejk/off/burzak), skrypt otwiera każdy cel w nowej karcie (co min. 5s), wybiera odpowiedni szablon wojsk, klika "Wyślij" i na ekranie potwierdzenia uzbraja panel "Precyzyjny wysylacz v2" (drugi skrypt) na losowy czas WYSYŁKI z pierwszych 5 minut okna, z milisekundami = losowa wielokrotność 100 (100-500).
// @match        *://*.plemiona.pl/game.php*
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

/*
 * ============================================================================
 * WAŻNE - RZECZY DO POTWIERDZENIA / MOŻLIWE DO POPRAWIENIA (oznaczone TODO):
 *
 * 1) Selektor przycisku "Wyślij wojska" na stronie doboru jednostek
 *    (ten co przenosi na ekran potwierdzenia). Obecnie skrypt próbuje
 *    kilku typowych selektorów - jeśli u Ciebie się nie zgadza,
 *    zobacz sekcję SUBMIT_SELECTOR poniżej i podmień na właściwy
 *    (Zbadaj element -> prawy klik na przycisk "Wyślij wojska").
 *
 * 2) Obsługa "Wyślij BURZAK" - selektory potwierdzone na realnym HTML
 *    (strona doboru wojsk + ekran potwierdzenia):
 *      - liczba katapult -> #unit_input_catapult
 *      - cel katapult -> #place_confirm_catapult_target select[name="building"],
 *        mapowany z nazwy budynku w rozpisce przez BUILDING_ALIASES
 *        (np. "KUŹNIA" -> "smith")
 *      - topornicy -> #unit_input_axe, z DZIELONEJ PULI 300 na wioskę
 *        źródłową: jeśli wioska ma więcej niż 1 zlecenie BURZAK na liście
 *        (licznik "BURZ x/N" w rozpisce), to min(300, dostępne w wiosce)
 *        jest dzielone równo na N zleceń (patrz getOrComputeAxePerOrder) -
 *        PIERWSZA karta danej wioski, która dotrze do tego kroku, liczy
 *        podział i zapisuje go w GM storage, kolejne karty tej samej
 *        wioski już tylko go odczytują (żeby podział był równy, a nie
 *        malejący w miarę faktycznych wysyłek).
 *      - zwiadowcy -> #unit_input_spy, losowo 1-5, ograniczone dostępnością
 *        w wiosce (0, jeśli zwiadowców brak).
 *    Treść "+ ..." w nawiasie rozpiski (np. "+ 0 wojska") NIE jest już
 *    parsowana ani używana - powyższa reguła (300 topornik / 1-5 zwiad)
 *    obowiązuje zawsze dla każdego zlecenia BURZAK, niezależnie od tego
 *    tekstu.
 *
 * 3) Zakładam, że panel "Precyzyjny wysylacz v2 (worker)" pojawia się
 *    na ekranie POTWIERDZENIA wysyłki (czyli po kliknięciu "Wyślij
 *    wojska", a przed kliknięciem finalnego "Tak, jestem pewien").
 *    Ten skrypt NIE klika finalnego przycisku potwierdzenia - to
 *    zostawiam Twojemu skryptowi "worker", który (jak rozumiem) sam
 *    klika w odpowiednim momencie po ms.
 * ============================================================================
 */

(function () {
  'use strict';

  // ---- KONFIGURACJA ----
  const MIN_TAB_DELAY_MS = 5000;      // min. odstęp między otwieraniem kolejnych kart
  const TAB_DELAY_JITTER_MS = 3000;   // + losowy jitter, żeby wyglądało naturalnie
  const FIRST_MINUTES_WINDOW = 5 * 60; // pierwsze 5 minut okna (w sekundach)
  const MS_OPTIONS = [100, 200, 300, 400, 500];

  // Nazwy szablonów wojsk (dokładnie tak jak w panelu "Szablony wojsk")
  const TEMPLATE_NAME_FEJK = 'fejk';
  const TEMPLATE_NAME_OFF = 'OFF - 5 FEJK';

  // TODO: sprawdź czy to faktycznie trafia w przycisk "Wyślij wojska"
  const SUBMIT_SELECTOR =
    '#troop_confirm_go, input[type=submit][name=attack], input[type=submit][value*="Wyślij"], input[type="submit"][value*="wojska"]';

  // Potwierdzone na podstawie realnego HTML strony doboru wojsk.
  const CATAPULT_INPUT_SELECTOR = '#unit_input_catapult, input[name="catapult"]';

  // Potwierdzone: select celu katapult jest na ekranie POTWIERDZENIA ataku
  // (nie na stronie doboru wojsk!), w postaci:
  // <div id="place_confirm_catapult_target"><select name="building">...</select></div>
  const CATAPULT_TARGET_SELECT_SELECTOR = '#place_confirm_catapult_target select[name="building"]';

  // Mapowanie nazw budynków z rozpiski (dowolna pisownia/skrót po polsku)
  // na wartości <option> w selekcie celu katapult. Jeśli w Twojej liście
  // używasz innych określeń niż poniższe, dopisz je do odpowiedniej tablicy.
  const BUILDING_ALIASES = {
    main: ['ratusz', 'tusz', 'hq', 'głow', 'glow'],
    barracks: ['koszary', 'kosz'],
    stable: ['stajnia', 'staj'],
    garage: ['warsztat', 'wars'],
    snob: ['pałac', 'palac', 'snob', 'akademia'],
    smith: ['kuźnia', 'kuznia', 'kuz'],
    place: ['plac zbiórki', 'plac zbiorki', 'zbiórka', 'zbiorka', 'plac'],
    statue: ['piedestał', 'piedestal', 'posąg', 'posag', 'pie'],
    market: ['rynek', 'ryn'],
    wood: ['tartak', 'drewno', 'drew'],
    stone: ['cegielnia', 'glina', 'ceg'],
    iron: ['huta żelaza', 'huta zelaza', 'żelazo', 'zelazo', 'huta', 'hz'],
    farm: ['zagroda', 'farma'],
    storage: ['spichlerz', 'spichrz', 'magazyn', 'spich'],
    wall: ['mury', 'mur', 'wall'],
  };

  function resolveBuildingCode(text) {
    if (!text) return null;
    const norm = text.trim().toLowerCase();
    for (const [code, aliases] of Object.entries(BUILDING_ALIASES)) {
      if (aliases.some((alias) => norm.includes(alias))) return code;
    }
    return null;
  }

  // ---- BURZAK: topornicy (dzielona pula 300/wioska) + zwiadowcy ----
  // Potwierdzone na podstawie realnego HTML strony doboru wojsk.
  const UNIT_INPUT_SELECTORS = {
    axe: '#unit_input_axe, input[name="axe"]',
    spy: '#unit_input_spy, input[name="spy"]',
  };

  const AXE_POOL_PER_VILLAGE = 300; // łączna pula toporników NA WIOSKĘ ŹRÓDŁOWĄ (dzielona między jej burzaki)
  const SPY_MIN = 1;
  const SPY_MAX = 5; // losowa liczba zwiadowców 1-5, ograniczona dostępnością w wiosce

  function setUnitInputValue(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Ile jednostek danego typu jest FAKTYCZNIE dostępnych w tej wiosce teraz
  // (atrybut data-all-count na polu inputa - potwierdzony w realnym HTML).
  function getAvailableUnitCount(inputEl) {
    const raw = inputEl.getAttribute('data-all-count');
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function axePoolPerOrderKey(village) {
    return `pf_axe_per_order_v${village}`;
  }

  // Liczy podział TYLKO RAZ na wioskę (pierwsza karta-burzak tej wioski,
  // która tu dotrze) i zapamiętuje wynik w GM storage - kolejne karty tej
  // samej wioski odczytują już gotową wartość. Dzięki temu podział jest
  // RÓWNY (np. 300/2=150 każda), a nie malejący w miarę faktycznych
  // wysyłek ("kto pierwszy, ten więcej") ani błędny przez to, że ktoś
  // wkleił listę częściami (dlatego N bierzemy z "BURZ x/N" WPISANEGO W
  // TREŚĆ TEGO KONKRETNEGO zlecenia, a NIE z liczenia wpisów w tym, co
  // akurat zostało wklejone do okna - to drugie zawodzi przy wklejaniu
  // listy w kawałkach).
  function getOrComputeAxePerOrder(village, availableNow, burzakTotalForVillage) {
    const cached = GM_getValue(axePoolPerOrderKey(village), null);
    if (cached != null) return cached;

    const n = burzakTotalForVillage || 1;
    const totalToUse = Math.min(AXE_POOL_PER_VILLAGE, availableNow);
    const perOrder = Math.floor(totalToUse / n);
    GM_setValue(axePoolPerOrderKey(village), perOrder);
    console.log(
      '[PF] Podział toporników dla wioski', village, ': dostępne=', availableNow,
      ', pula=', AXE_POOL_PER_VILLAGE, ', burzaków (z "BURZ x/N" w rozpisce)=', n, '-> ', perOrder, 'na burzaka'
    );
    return perOrder;
  }

  // ---- HELPERY ----
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitFor(fn, timeout = 15000, interval = 150) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        let val;
        try {
          val = fn();
        } catch (e) {
          val = null;
        }
        if (val) {
          clearInterval(iv);
          resolve(val);
        } else if (Date.now() - t0 > timeout) {
          clearInterval(iv);
          resolve(null);
        }
      }, interval);
    });
  }

  function pad(n, len = 2) {
    return String(n).padStart(len, '0');
  }

  // ---- PARSOWANIE WKLEJONEJ LISTY ----
  // Obsługuje DWA formaty wpisu (rozpoznawane automatycznie):
  //
  // A) BBCode (np. z forum/planera):
  // 85. [b][color=#00a500]Wyślij FEJK[100 off][/color] (4 z 5)[/b]
  // [b]2026-08-19 [color=#ff0000]13:24:14 - 14:24:14[/color][/b]
  // 479|470 [b]->[/b] 432|546
  // [url=https://pl230.plemiona.pl/game.php?village=2715&screen=place&target=6528]Wyślij FEJK[/url]
  //
  // B) Markdown:
  // 33. Wyślij FEJK[100 off] (1 z 6)
  // 2026-08-19 10:36:58 - 11:36:58
  // [F 14 (431|452) K44 ](https://.../info_village?...id=6922)-> [UWAGA LECI GRUBAS (422|545) K54 ](https://.../info_village?...id=8173)
  // [Wyślij FEJK](https://pl230.plemiona.pl/game.php?village=6922&screen=place&target=8173)
  //
  function stripTags(s) {
    // usuwa wszystkie znaczniki w nawiasach kwadratowych (BBCode [b], [color=...],
    // [100 off] itp.) - używane TYLKO do wyciągania numeru/typu/daty, NIE do linku
    return s.replace(/\[[^\]]*\]/g, '');
  }

  function parseInput(text) {
    const blocks = text
      .split(/\n(?=\s*\d+\.\s)/)
      .map((b) => b.trim())
      .filter(Boolean);

    const orders = [];
    for (const rawBlock of blocks) {
      const stripped = stripTags(rawBlock);

      const numMatch = stripped.match(/^(\d+)\.\s*Wyślij\s+(FEJK|OFF|BURZAK)/i);
      if (!numMatch) {
        console.warn('[PF] Pominięto wpis (brak typu Wyślij FEJK/OFF/BURZAK):', rawBlock.slice(0, 60));
        continue;
      }
      const num = numMatch[1];
      const type = numMatch[2].toUpperCase();

      const dateMatch = stripped.match(
        /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s*-\s*(\d{2}:\d{2}:\d{2})/
      );
      if (!dateMatch) {
        console.warn('[PF] Pominięto wpis (brak daty/godzin):', rawBlock.slice(0, 60));
        continue;
      }
      const [, dateStr, startTime] = dateMatch;

      // link wyciągamy z RAW bloku (nie ze "stripped"), bo tam jest URL.
      // UWAGA: treść wewnątrz [url=...]...[/url] bywa dodatkowo owinięta w
      // zagnieżdżone tagi (np. [color=...][b]Wyślij FAKE[/b][/color]), więc
      // NIE możemy zabraniać nawiasów kwadratowych w środku - używamy
      // "dopasuj wszystko, niechciwie, do najbliższego [/url]".
      let url = null;
      const bbLinkMatch = rawBlock.match(/\[url=(https?:\/\/[^\]]+)\][\s\S]*?\[\/url\]/i);
      if (bbLinkMatch) {
        url = bbLinkMatch[1];
      } else {
        const mdLinkMatch = rawBlock.match(/\[Wyślij[^\]]*\]\((https?:\/\/[^\)]+)\)/i);
        if (mdLinkMatch) url = mdLinkMatch[1];
      }
      if (!url) {
        console.warn('[PF] Pominięto wpis (brak linku "Wyślij ..."):', rawBlock.slice(0, 60));
        continue;
      }

      // Katapulty: wzorzec "<liczba>k na <BUDYNEK>" pojawia się w nawiasie
      // zarówno przy czystym BURZAKU ("150k na KUŹNIA + 0 wojska"), jak i
      // przy OFF-ie z dorzuconymi katapultami ("15260 off + 100k na KUŹNIA").
      // Szukamy go NIEZALEŻNIE od typu wpisu.
      let catapultCount = null;
      let catapultTarget = null;

      const bracketMatch = rawBlock.match(/Wyślij\s+(?:FEJK|OFF|BURZAK)\s*\[([^\]]*)\]/i);
      const bracketContent = bracketMatch ? bracketMatch[1] : '';

      const catMatch = bracketContent.match(/(\d+)\s*k\s*na\s+([^\+\]]+)/i);
      if (catMatch) {
        catapultCount = parseInt(catMatch[1], 10);
        catapultTarget = catMatch[2].trim();
      }

      if (type === 'BURZAK' && !bracketMatch) {
        console.warn('[PF] Wpis BURZAK bez nawiasu [...] z danymi katapult - sprawdź format:', rawBlock.slice(0, 60));
      }

      // "BURZ x/N" w nagłówku wpisu (np. "(2 z 7 | FEJK 1/5 | BURZ 1/2)")
      // mówi, ile ŁĄCZNIE zleceń BURZAK ma ta wioska źródłowa - potrzebne
      // do podziału puli 300 toporników. Czytamy to z KAŻDEGO wpisu (nie
      // tylko BURZAK), bo to jedyne wiarygodne źródło - liczenie wpisów w
      // tym, co akurat wklejono, zawodzi przy wklejaniu listy w kawałkach.
      let burzTotal = null;
      const burzTotalMatch = stripped.match(/BURZ\s+\d+\s*\/\s*(\d+)/i);
      if (burzTotalMatch) burzTotal = parseInt(burzTotalMatch[1], 10);

      orders.push({ num, type, dateStr, startTime, url, catapultCount, catapultTarget, burzTotal });
    }
    return orders;
  }

  // ---- MODAL DO WKLEJANIA LISTY ----
  function showInputModal() {
    if (document.getElementById('pf-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'pf-modal';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#f4e4bc;border:2px solid #804000;border-radius:6px;padding:14px;width:560px;max-width:92vw;font-size:12px;font-family:Verdana,Arial,sans-serif;">
        <b>Wklej listę fejków / offów / burzaków</b>
        <textarea id="pf-textarea" style="width:100%;height:260px;margin-top:8px;font-family:monospace;font-size:11px;box-sizing:border-box;"></textarea>
        <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
          <label style="font-size:11px;">
            <input type="checkbox" id="pf-bg" checked> otwieraj karty w tle (nieaktywne)
          </label>
          <div>
            <button id="pf-start" style="padding:4px 12px;cursor:pointer;">Start</button>
            <button id="pf-cancel" style="padding:4px 12px;cursor:pointer;">Anuluj</button>
          </div>
        </div>
        <div id="pf-status" style="margin-top:6px;font-family:monospace;white-space:pre-wrap;max-height:140px;overflow:auto;"></div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('pf-cancel').onclick = () => overlay.remove();
    document.getElementById('pf-start').onclick = () => {
      const text = document.getElementById('pf-textarea').value;
      const bg = document.getElementById('pf-bg').checked;
      const orders = parseInput(text);
      const statusEl = document.getElementById('pf-status');
      if (!orders.length) {
        statusEl.textContent = 'Nie znaleziono żadnych poprawnych wpisów w tekście.';
        return;
      }
      statusEl.textContent = `Znaleziono ${orders.length} wpis(ów). Startuję...\n`;
      resetBurzakPoolCache(orders);
      scheduleOrders(orders, !bg, statusEl);
    };
  }

  // Zanim otworzymy jakąkolwiek kartę: skasuj ewentualny zapamiętany podział
  // puli toporników z POPRZEDNIEGO uruchomienia listy dla wiosek, które mają
  // BURZAKA w TYM uruchomieniu - żeby getOrComputeAxePerOrder policzył go
  // na nowo (a nie użył nieaktualnej wartości sprzed np. wczoraj).
  function resetBurzakPoolCache(orders) {
    const villages = new Set();
    for (const order of orders) {
      if (order.type !== 'BURZAK') continue;
      try {
        const village = new URL(order.url).searchParams.get('village');
        if (village) villages.add(village);
      } catch (e) {
        /* ignoruj */
      }
    }
    villages.forEach((village) => GM_deleteValue(axePoolPerOrderKey(village)));
  }

  function scheduleOrders(orders, active, statusEl) {
    let i = 0;
    function next() {
      if (i >= orders.length) {
        statusEl.textContent += `Gotowe - otworzono ${orders.length} kart(y).\n`;
        return;
      }
      const order = orders[i];
      try {
        openOrderTab(order, active);
        statusEl.textContent += `[${i + 1}/${orders.length}] #${order.num} (${order.type}) - otwarto kartę\n`;
        statusEl.scrollTop = statusEl.scrollHeight;
      } catch (e) {
        statusEl.textContent += `[${i + 1}/${orders.length}] #${order.num} - BŁĄD: ${e.message}\n`;
      }
      i++;
      const delay = MIN_TAB_DELAY_MS + Math.random() * TAB_DELAY_JITTER_MS;
      setTimeout(next, delay);
    }
    next();
  }

  function encodeOrder(order) {
    const payload = {
      type: order.type,
      dateStr: order.dateStr,
      startTime: order.startTime,
      catapultCount: order.catapultCount,
      catapultTarget: order.catapultTarget,
      burzTotal: order.burzTotal,
    };
    return encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
  }

  function decodeOrder(encoded) {
    return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(encoded)))));
  }

  // ---- TRWAŁE PRZECHOWYWANIE ZLECENIA (przeżywa nawigację/przeładowanie strony) ----
  // Po kliknięciu "Wyślij atak" strona może się przeładować na ekran
  // potwierdzenia - to NISZCZY kontekst JS naszego skryptu, a #hash w adresie
  // zwykle nie przechodzi dalej przy takim przeładowaniu.
  //
  // UWAGA: NIE używamy tu GM_setValue (to jest magazyn WSPÓLNY dla całego
  // konta/wszystkich kart) - gdyby z tej samej wioski leciało więcej niż
  // jedno zlecenie na liście, dwie otwarte karty nadpisywałyby sobie
  // nawzajem zapis pod tym samym kluczem i obie kończyły na tym samym
  // (ostatnio zapisanym) czasie. Zamiast tego używamy sessionStorage,
  // który jest izolowany PER KARTA (przeglądarka trzyma go osobno dla
  // każdej karty/okna), ale mimo to przeżywa przeładowanie/nawigację w
  // obrębie tej samej karty - dokładnie to, czego potrzebujemy, i bez
  // ryzyka kolizji między równolegle otwartymi kartami.
  const PENDING_KEY = 'pf_pending_order';

  function saveOrderToStorage(order) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ order, ts: Date.now() }));
      console.log('[PF] Zapisano zlecenie w sessionStorage tej karty.');
    } catch (e) {
      console.error('[PF] Nie udało się zapisać zlecenia w sessionStorage:', e);
    }
  }

  function loadOrderFromStorage() {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // wygasa po 2h - zabezpieczenie przed starymi/nieużytymi wpisami
      if (Date.now() - parsed.ts > 2 * 60 * 60 * 1000) {
        sessionStorage.removeItem(PENDING_KEY);
        return null;
      }
      return parsed.order;
    } catch (e) {
      return null;
    }
  }

  function clearOrderFromStorage() {
    try {
      sessionStorage.removeItem(PENDING_KEY);
    } catch (e) {
      /* ignoruj */
    }
  }

  function getUrlParams() {
    const params = new URLSearchParams(location.search);
    return { village: params.get('village'), target: params.get('target') };
  }

  function openOrderTab(order, active) {
    const encoded = encodeOrder(order);
    const sep = order.url.includes('#') ? '&' : '#';
    const url = order.url + sep + 'pf_order=' + encoded;

    // Nie zapisujemy tu nic do storage - sessionStorage jest per-karta,
    // więc karta jeszcze nieotwarta i tak nie ma do niego dostępu. Zapis
    // nastąpi w handleTargetTabIfNeeded() zaraz po otwarciu, gdy karta
    // odczyta zlecenie z #hash.
    GM_openInTab(url, { active, insert: true, setParent: true });
  }

  // ---- OBSŁUGA KARTY DOCELOWEJ (screen=place&target=...) ----
  function computeSendTime(order) {
    const [y, mo, d] = order.dateStr.split('-').map(Number);
    const [h, mi, s] = order.startTime.split(':').map(Number);
    const start = new Date(y, mo - 1, d, h, mi, s, 0);

    const randomSeconds = Math.floor(Math.random() * FIRST_MINUTES_WINDOW);
    const target = new Date(start.getTime() + randomSeconds * 1000);
    const ms = MS_OPTIONS[Math.floor(Math.random() * MS_OPTIONS.length)];

    // Format oczekiwany przez panel "Precyzyjny wysylacz": [DD.MM] HH:MM:SS:mmm
    return `${pad(target.getDate())}.${pad(target.getMonth() + 1)} ${pad(
      target.getHours()
    )}:${pad(target.getMinutes())}:${pad(target.getSeconds())}:${pad(ms, 3)}`;
  }

  async function selectTemplateByName(name) {
    const links = await waitFor(() => {
      const all = document.querySelectorAll('a.troop_template_selector');
      return all.length ? all : null;
    });
    if (!links) {
      console.error('[PF] Panel szablonów wojsk się nie pojawił.');
      return false;
    }
    const link = [...links].find(
      (a) => a.textContent.trim().toLowerCase() === name.toLowerCase()
    );
    if (!link) {
      console.error('[PF] Nie znaleziono szablonu o nazwie:', name);
      return false;
    }
    link.click();
    return true;
  }

  // Krok 1 (strona doboru wojsk, PRZED "Wyślij atak"): wpisujemy liczbę
  // katapult. Dotyczy KAŻDEGO typu wpisu, jeśli rozpiska podaje katapulty
  // (czysty BURZAK, ale też OFF z dorzuconymi katapultami typu
  // "15260 off + 100k na KUŹNIA").
  async function applyCatapultCount(order) {
    const catInput = document.querySelector(CATAPULT_INPUT_SELECTOR);
    if (!catInput) {
      console.error('[PF] Nie znaleziono pola liczby katapult - SPRAWDŹ SELEKTOR (CATAPULT_INPUT_SELECTOR).');
      return;
    }
    catInput.value = order.catapultCount;
    catInput.dispatchEvent(new Event('input', { bubbles: true }));
    catInput.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[PF] Ustawiono liczbę katapult:', order.catapultCount);
  }

  // Dodatkowe wojska poza katapultami - dotyczy TYLKO czystego BURZAKA
  // (przy OFF-ie wojska off pochodzą z szablonu, a katapulty są obsłużone
  // osobno przez applyCatapultCount/applyCatapultTarget). Reguła:
  //   - topornicy: dzielona pula 300/wioskę (patrz getOrComputeAxePerOrder)
  //   - zwiadowcy: losowo 1-5, ograniczone dostępnością w wiosce
  async function applyBurzakExtras(order) {
    const { village } = getUrlParams();

    const axeInput = document.querySelector(UNIT_INPUT_SELECTORS.axe);
    if (axeInput) {
      const availableNow = getAvailableUnitCount(axeInput);
      const perOrder = village
        ? getOrComputeAxePerOrder(village, availableNow, order.burzTotal)
        : Math.min(AXE_POOL_PER_VILLAGE, availableNow);
      const toSend = Math.max(0, Math.min(perOrder, availableNow));
      if (toSend > 0) {
        setUnitInputValue(axeInput, toSend);
        console.log('[PF] Topornicy: wysyłam', toSend, '(dostępne w wiosce teraz:', availableNow, ')');
      } else {
        console.log('[PF] Topornicy: 0 do wysłania (brak dostępnych lub pula na tę wioskę wyczerpana) - pomijam.');
      }
    } else {
      console.error('[PF] Nie znaleziono pola topornika - SPRAWDŹ SELEKTOR (UNIT_INPUT_SELECTORS.axe).');
    }

    const spyInput = document.querySelector(UNIT_INPUT_SELECTORS.spy);
    if (spyInput) {
      const availableSpy = getAvailableUnitCount(spyInput);
      const desiredSpy = SPY_MIN + Math.floor(Math.random() * (SPY_MAX - SPY_MIN + 1));
      const toSendSpy = Math.min(desiredSpy, availableSpy);
      if (toSendSpy > 0) {
        setUnitInputValue(spyInput, toSendSpy);
        console.log('[PF] Zwiadowcy: wysyłam', toSendSpy, '(dostępne w wiosce:', availableSpy, ')');
      } else {
        console.log('[PF] Zwiadowcy: brak dostępnych w wiosce - pomijam.');
      }
    } else {
      console.error('[PF] Nie znaleziono pola zwiadowcy - SPRAWDŹ SELEKTOR (UNIT_INPUT_SELECTORS.spy).');
    }
  }

  // Krok 2 (ekran POTWIERDZENIA ataku, PO "Wyślij atak"): wybieramy budynek
  // z <select id="place_confirm_catapult_target"> zgodnie z rozpiską.
  // Dotyczy KAŻDEGO typu wpisu, jeśli rozpiska podaje cel katapult.
  async function applyCatapultTarget(order) {
    if (!order.catapultTarget) {
      console.warn('[PF] Brak celu katapult w rozpiece - zostawiam domyślny wybór budynku.');
      return;
    }

    const select = await waitFor(() => document.querySelector(CATAPULT_TARGET_SELECT_SELECTOR), 8000);
    if (!select) {
      console.error('[PF] Nie znaleziono selecta celu katapult na ekranie potwierdzenia (#place_confirm_catapult_target).');
      return;
    }

    const code = resolveBuildingCode(order.catapultTarget);
    if (!code) {
      console.warn('[PF] Nie rozpoznano nazwy budynku z rozpiski: "' + order.catapultTarget + '" - dopisz alias do BUILDING_ALIASES. Zostawiam domyślny wybór.');
      return;
    }

    const optionExists = [...select.options].some((o) => o.value === code);
    if (!optionExists) {
      console.warn('[PF] Rozpoznany kod budynku "' + code + '" nie występuje w tym selekcie - sprawdź.');
      return;
    }

    select.value = code;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[PF] Ustawiono cel katapult na budynek:', code, '(z rozpiski: "' + order.catapultTarget + '")');
  }

  function setWorkerTime(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Panel #ps_time bywa dodany do DOM ZANIM drugi skrypt skończy własną
  // inicjalizację (liczenie marszu / offsetu serwera - widać to po tekście
  // w #ps_status). Jeśli wpiszemy czas za wcześnie, worker potrafi go
  // nadpisać/wyczyścić przy dokończeniu swojej inicjalizacji - stąd wygląda
  // to tak, jakby "nic nie wstawił". Czekamy więc najpierw na sam input,
  // a potem dodatkowo na sygnał że worker skończył liczenie.
  async function waitForWorkerReady(timeout = 20000) {
    const timeInput = await waitFor(() => document.getElementById('ps_time'), timeout);
    if (!timeInput) return null;

    await waitFor(() => {
      const status = document.getElementById('ps_status');
      return status && /offset\s*serw/i.test(status.textContent) ? status : null;
    }, 10000);

    await sleep(400); // dodatkowy mały bufor bezpieczeństwa
    return timeInput;
  }

  async function runOrder(order) {
    try {
      await runOrderInner(order);
    } catch (e) {
      console.error('[PF] Nieoczekiwany błąd podczas przetwarzania zlecenia:', e);
    }
  }

  async function runOrderInner(order) {
    console.log('[PF] Przetwarzam zlecenie:', order);

    const alreadyAtConfirm = !!document.getElementById('ps_time');

    if (!alreadyAtConfirm) {
      if (order.type === 'FEJK') {
        await selectTemplateByName(TEMPLATE_NAME_FEJK);
      } else if (order.type === 'OFF') {
        await selectTemplateByName(TEMPLATE_NAME_OFF);
      }

      // Katapulty dotyczą KAŻDEGO typu wpisu, jeśli rozpiska je podaje
      // (czysty BURZAK, albo OFF z dorzuconymi katapultami).
      if (order.catapultCount != null) {
        await applyCatapultCount(order);
      }
      if (order.type === 'BURZAK') {
        await applyBurzakExtras(order);
      }

      await sleep(400);

      const submitBtn = document.querySelector(SUBMIT_SELECTOR);
      if (!submitBtn) {
        console.error('[PF] Nie znaleziono przycisku "Wyślij wojska" - SPRAWDŹ SUBMIT_SELECTOR.');
        return;
      }
      console.log('[PF] Klikam "Wyślij wojska"...');
      submitBtn.click();
    } else {
      console.log('[PF] Strona już jest na ekranie potwierdzenia (wznowienie po przeładowaniu) - pomijam dobór wojsk.');
    }

    if (order.catapultTarget) {
      console.log('[PF] Wybieram cel katapult na ekranie potwierdzenia...');
      await applyCatapultTarget(order);
    }

    console.log('[PF] Czekam aż panel "Precyzyjny wysylacz" będzie gotowy...');
    const timeInput = await waitForWorkerReady();
    if (!timeInput) {
      console.error('[PF] Nie doczekałem się gotowego panelu "Precyzyjny wysylacz" (#ps_time). Sprawdź czy drugi skrypt się uruchamia na tej stronie.');
      return;
    }

    const sendRadio = document.querySelector('input[name="ps_mode"][value="send"]');
    if (sendRadio) {
      sendRadio.click();
    } else {
      console.warn('[PF] Nie znaleziono radiobuttona trybu "Godzina wysylki" - sprawdź ręcznie.');
    }

    const timeStr = computeSendTime(order);
    setWorkerTime(timeInput, timeStr);

    // weryfikacja czy worker nie nadpisał/wyczyścił wartości po swojej inicjalizacji
    await sleep(300);
    if (timeInput.value !== timeStr) {
      console.warn('[PF] Wartość pola czasu została nadpisana przez worker - wpisuję ponownie.');
      setWorkerTime(timeInput, timeStr);
      await sleep(200);
    }

    const armBtn = document.getElementById('ps_arm');
    if (!armBtn) {
      console.error('[PF] Nie znaleziono przycisku UZBROJ (#ps_arm).');
      return;
    }
    armBtn.click();
    console.log('[PF] Uzbrojono wysyłkę na', timeStr, 'dla zlecenia #' + order.num);

    clearOrderFromStorage();
  }

  function handleTargetTabIfNeeded() {
    const { village, target } = getUrlParams();
    console.log('[PF] Sprawdzam stronę. village=', village, 'target=', target, 'hash=', location.hash);

    if (!village) {
      console.log('[PF] Brak parametru village w URL - to nie jest strona wysyłki, kończę.');
      return;
    }

    let order = null;

    const hashMatch = location.hash.match(/pf_order=([^&]+)/);
    if (hashMatch) {
      try {
        order = decodeOrder(hashMatch[1]);
        saveOrderToStorage(order);
        console.log('[PF] Wykryto zlecenie w #hash:', order);
      } catch (e) {
        console.error('[PF] Nie udało się zdekodować zlecenia z URL:', e);
      }
    }

    if (!order) {
      order = loadOrderFromStorage();
      if (order) {
        console.log('[PF] Brak #hash (pewnie przeładowanie strony) - wznawiam zlecenie odczytane z sessionStorage tej karty:', order);
      } else {
        console.log('[PF] Brak zlecenia w #hash i brak zapisanego w sessionStorage tej karty - nic do zrobienia na tej stronie.');
      }
    }

    if (!order) return;

    runOrder(order);
  }

  // ---- PRZYCISK URUCHAMIAJĄCY ----
  function addLauncherButton() {
    if (document.getElementById('pf-launcher-btn') || !document.body) return;
    const btn = document.createElement('button');
    btn.id = 'pf-launcher-btn';
    btn.textContent = '📋 Fejki/Off/Burzaki';
    btn.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:99998;padding:8px 12px;background:#804000;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,.3);';
    btn.onclick = showInputModal;
    document.body.appendChild(btn);
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Wklej listę fejków/off/burzak', showInputModal);
  }

  addLauncherButton();
  handleTargetTabIfNeeded();
})();
