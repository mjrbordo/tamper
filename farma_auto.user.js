// ==UserScript==
// @name         Auto Farm
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  Automatyczne farmienie w Plemionach — wybór szablonu wg wyniku ostatniego ataku
// @updateURL    https://cdn.jsdelivr.net/gh/mjrbordo/tamper@main/farma_auto.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/mjrbordo/tamper@main/farma_auto.user.js
// @author       Bordo
// @match        https://*.plemiona.pl/*screen=am_farm*
// @match        https://*.tribalwars.net/*screen=am_farm*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    //  KONFIGURACJA
    // ═══════════════════════════════════════════════════════════════════════════

    const CONFIG = {
        // Szablon dla wioski gdy ostatni atak wrócił PEŁNY (pojemność wojsk była limitem)
        // 'A', 'B', lub null (pomiń wioskę)
        templateOnFull: 'A',

        // Szablon dla wioski gdy ostatni atak wrócił NIEPEŁNY (wioska była pusta/prawie pusta)
        // 'A', 'B', lub null (pomiń wioskę)
        templateOnNotFull: 'B',

        // Minimalny interwał między kliknięciami (ms) — nie ustawiaj poniżej 200
        minInterval: 200,

        // Losowy dodatkowy czas do interwału (ms) — humanizuje klikanie
        // Faktyczny czas = minInterval + random(0, randomExtra)
        randomExtra: 200,

        // Opóźnienie po załadowaniu strony przed startem (ms)
        pageLoadDelay: 2000,
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  STAŁE
    // ═══════════════════════════════════════════════════════════════════════════

    const STORAGE_KEY = 'autoFarmTW';

    // ═══════════════════════════════════════════════════════════════════════════
    //  STAN
    // ═══════════════════════════════════════════════════════════════════════════

    function loadState() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
        catch { return {}; }
    }

    function saveState(s) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  ANALIZA WIERSZA TABELI
    //
    //  Każdy wiersz: <tr id="village_XXXXX">
    //
    //  Kolumna 2 (ikona bitwy):
    //    img[src*="green"]  → Pełna wygrana
    //    img[src*="blue"]   → Zwiad
    //    img[src*="yellow"] → Wygrana z stratami
    //    img[src*="red"]    → Porażka
    //
    //  Kolumna 3 (ikona łupu):
    //    img[src*="0.webp"] data-title zawiera "Częściowy" → wioska była pusta (mało surowców)
    //    brak ikony lub inna → pełny łup (pojemność wojsk była limitem)
    //
    //  Przyciski szablonów:
    //    a.farm_icon_a  → szablon A
    //    a.farm_icon_b  → szablon B
    //    Klasa farm_icon_disabled + start_locked → atak jeszcze w drodze (disabled)
    // ═══════════════════════════════════════════════════════════════════════════

    function analyzeRow(row) {
        // Czy atak jest w trakcie (farm_icon_disabled na przycisku A lub B)?
        const anyDisabled = row.querySelector('a.farm_icon_disabled');

        // Ikona łupu — obecność img z "Częściowy" w data-title
        // Gra używa 0.webp dla "częściowy łup" — wojska wzięły tyle ile mogły,
        // ale wioska miała więcej (lub wioska była pusta)
        // data-title: "Częściowy łup: Twoi żołnierze zrabowali wszystko, co udało im się znaleźć"
        // oznacza że wioska była (prawie) pusta — to NIE jest pełny łup z perspektywy gracza
        const lootIcon = row.querySelector('td:nth-child(3) img');
        const lootTitle = lootIcon ? (lootIcon.getAttribute('data-title') || '') : '';

        // "Pełny łup" = atak wrócił z pełnymi sakwami (pojemność wojsk była limitem, nie zawartość wioski)
        // Gra pokazuje ikonę 0.webp + "Częściowy łup" gdy wioska była pusta
        // Brak tej ikony (lub inna) = wojska wróciły pełne
        const isFullHaul = !lootTitle.includes('Częściowy') && !lootTitle.includes('zrabowali wszystko');

        // Ikona bitwy
        const battleIcon = row.querySelector('td:nth-child(2) img');
        const battleSrc  = battleIcon ? (battleIcon.getAttribute('src') || '') : '';
        const isGreenWin = battleSrc.includes('green');

        return {
            villageId:  row.id.replace('village_', ''),
            inProgress: !!anyDisabled,
            isFullHaul,
            isGreenWin,
            btnA: row.querySelector('a.farm_icon_a:not(.decoration)'),
            btnB: row.querySelector('a.farm_icon_b:not(.decoration)'),
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  WYBÓR PRZYCISKU
    // ═══════════════════════════════════════════════════════════════════════════

    function chooseButton(analysis, cfg) {
        if (analysis.inProgress) return null; // atak w trakcie — pomiń

        const template = analysis.isFullHaul ? cfg.templateOnFull : cfg.templateOnNotFull;

        if (!template) return null;
        if (template === 'A') return analysis.btnA;
        if (template === 'B') return analysis.btnB;
        return null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  GŁÓWNA PĘTLA FARMIENIA
    // ═══════════════════════════════════════════════════════════════════════════

    async function runFarm(cfg) {
        const rows = Array.from(document.querySelectorAll('tr[id^="village_"]'));

        if (rows.length === 0) {
            setStatus('Brak wiosek na liście');
            return { sent: 0, skipped: 0, disabled: 0 };
        }

        let sent = 0, skipped = 0, disabled = 0;

        // Budujemy kolejkę kliknięć najpierw — bez czekania
        const queue = [];
        for (const row of rows) {
            const info = analyzeRow(row);
            if (info.inProgress) { disabled++; continue; }
            const btn = chooseButton(info, cfg);
            if (!btn) { skipped++; continue; }
            if (btn.classList.contains('farm_icon_disabled')) { disabled++; continue; }
            queue.push({ btn, info });
        }

        setStatus(`Wysyłam ${queue.length} ataków...`);

        // Klikamy z interwałem
        for (const { btn, info } of queue) {
            // Sprawdź jeszcze raz czy nie stał się disabled w międzyczasie
            if (btn.classList.contains('farm_icon_disabled') || btn.classList.contains('start_locked')) {
                disabled++;
                continue;
            }

            btn.click();
            sent++;

            updateProgress(sent, queue.length);

            // Interwał: minInterval + losowe extra — humanizuje i respektuje limit serwera
            const waitMs = cfg.minInterval + Math.floor(Math.random() * cfg.randomExtra);
            await delay(waitMs);
        }

        return { sent, skipped, disabled };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  STYLE
    // ═══════════════════════════════════════════════════════════════════════════

    function injectStyles() {
        document.head.appendChild(Object.assign(document.createElement('style'), {
            textContent: `
            #afPanel {
                position: fixed; top: 60px; right: 12px; width: 210px;
                background: rgba(245,240,225,0.97); border: 1px solid #967444;
                border-radius: 4px; padding: 8px; z-index: 9999;
                font-family: Arial, sans-serif; font-size: 11px;
                box-shadow: 0 2px 6px rgba(0,0,0,.25); user-select: none;
            }
            #afPanel h3 {
                margin: 0 0 6px; font-size: 12px; color: #784B25;
                text-align: center; border-bottom: 1px solid #c8a96e; padding-bottom: 4px;
            }
            #afPanel .sec { color: #784B25; font-weight: bold; margin: 7px 0 3px; }
            #afPanel .row {
                display: flex; align-items: center; justify-content: space-between;
                color: #4A3011; margin-bottom: 4px;
            }
            #afPanel select {
                padding: 2px 4px; border: 1px solid #967444; border-radius: 2px;
                font-size: 11px; background: #fff; color: #333; width: 80px;
            }
            #afPanel input[type="number"] {
                width: 64px; padding: 2px 4px; border: 1px solid #967444;
                border-radius: 2px; font-size: 11px; text-align: center;
                background: #fff; color: #333;
            }
            #afPanel .btn-row { display: flex; gap: 5px; margin-top: 8px; }
            #afPanel button {
                flex: 1; padding: 4px 2px; border: 1px solid #967444;
                border-radius: 2px; background: #c8a96e; color: #4A3011;
                cursor: pointer; font-size: 11px; font-weight: bold;
            }
            #afPanel button:hover { background: #b8946a; }
            #afPanel button:disabled { opacity: .5; cursor: default; }
            #afPanel .btn-on { background: #4a8020 !important; color: #fff !important; border-color: #306010 !important; }
            #afPanel .btn-on:hover { background: #3a6818 !important; }
            #afPanel #afStatus {
                margin-top: 6px; padding: 3px 4px; background: rgba(255,255,255,.5);
                border-radius: 2px; color: #5C3C1D; font-size: 10px;
                min-height: 14px; text-align: center;
            }
            #afPanel #afProgress {
                margin-top: 3px; height: 4px; background: #ddd; border-radius: 2px; overflow: hidden;
            }
            #afPanel #afProgressBar {
                height: 100%; width: 0%; background: #4a8020;
                transition: width .2s; border-radius: 2px;
            }
            #afPanel .legend {
                margin-top: 5px; font-size: 10px; color: #784B25;
                border-top: 1px solid #c8a96e; padding-top: 4px;
            }
            #afPanel .legend span { display: inline-block; width: 8px; height: 8px;
                border-radius: 50%; margin-right: 3px; vertical-align: middle; }
            #afPanel .full-dot { background: #4a8020; }
            #afPanel .notfull-dot { background: #c8a020; }
        `}));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  UI
    // ═══════════════════════════════════════════════════════════════════════════

    function createPanel() {
        const state = loadState();
        const cfg   = state.config || {};

        const templateOnFull    = cfg.templateOnFull    ?? CONFIG.templateOnFull;
        const templateOnNotFull = cfg.templateOnNotFull ?? CONFIG.templateOnNotFull;
        const minInterval       = cfg.minInterval       ?? CONFIG.minInterval;
        const randomExtra       = cfg.randomExtra       ?? CONFIG.randomExtra;
        const autoOn            = !!state.autoEnabled;

        const p = document.createElement('div');
        p.id = 'afPanel';
        p.innerHTML = '<h3>Auto Farm</h3>';

        // Reguły szablonów
        addSec(p, 'Reguły wysyłania:');

        const rowFull = document.createElement('div');
        rowFull.className = 'row';
        rowFull.innerHTML = `
            <span title="Atak wrócił pełny (pojemność wojsk była limitem)">
                <span class="legend"><span class="full-dot"></span></span>Pełny łup
            </span>
            <select id="af_tpl_full">
                <option value="A"  ${templateOnFull === 'A'    ? 'selected' : ''}>Szablon A</option>
                <option value="B"  ${templateOnFull === 'B'    ? 'selected' : ''}>Szablon B</option>
                <option value=""   ${templateOnFull === null || templateOnFull === '' ? 'selected' : ''}>Pomiń</option>
            </select>`;
        p.appendChild(rowFull);

        const rowNotFull = document.createElement('div');
        rowNotFull.className = 'row';
        rowNotFull.innerHTML = `
            <span title="Atak wrócił niepełny (wioska była pusta)">
                <span class="legend"><span class="notfull-dot"></span></span>Niepełny
            </span>
            <select id="af_tpl_notfull">
                <option value="A"  ${templateOnNotFull === 'A'    ? 'selected' : ''}>Szablon A</option>
                <option value="B"  ${templateOnNotFull === 'B'    ? 'selected' : ''}>Szablon B</option>
                <option value=""   ${templateOnNotFull === null || templateOnNotFull === '' ? 'selected' : ''}>Pomiń</option>
            </select>`;
        p.appendChild(rowNotFull);

        // Interwał
        addSec(p, 'Interwał (ms):');
        const rowInterval = document.createElement('div');
        rowInterval.className = 'row';
        rowInterval.innerHTML = `
            <span>Min</span>
            <input type="number" id="af_min_interval" min="200" max="9999" value="${minInterval}">`;
        p.appendChild(rowInterval);

        const rowRandom = document.createElement('div');
        rowRandom.className = 'row';
        rowRandom.innerHTML = `
            <span>+Losowy max</span>
            <input type="number" id="af_random_extra" min="0" max="9999" value="${randomExtra}">`;
        p.appendChild(rowRandom);

        // Przyciski
        const btnRow = document.createElement('div');
        btnRow.className = 'btn-row';

        const btnOnce = document.createElement('button');
        btnOnce.id = 'afBtnOnce';
        btnOnce.textContent = 'Wyślij raz';
        btnOnce.onclick = () => runOnce();

        const btnAuto = document.createElement('button');
        btnAuto.id = 'afBtnAuto';
        btnAuto.textContent = autoOn ? 'Auto: ON' : 'Auto: OFF';
        if (autoOn) btnAuto.classList.add('btn-on');
        btnAuto.onclick = toggleAuto;

        btnRow.append(btnOnce, btnAuto);
        p.appendChild(btnRow);

        p.appendChild(Object.assign(document.createElement('div'), { id: 'afStatus', textContent: 'Gotowy' }));

        const progressWrap = document.createElement('div');
        progressWrap.id = 'afProgress';
        progressWrap.innerHTML = '<div id="afProgressBar"></div>';
        p.appendChild(progressWrap);

        document.body.appendChild(p);
    }

    function addSec(parent, text) {
        parent.appendChild(Object.assign(document.createElement('div'), { className: 'sec', textContent: text }));
    }

    function setStatus(msg) {
        const el = document.getElementById('afStatus');
        if (el) el.textContent = msg;
    }

    function updateProgress(done, total) {
        const bar = document.getElementById('afProgressBar');
        if (bar) bar.style.width = total > 0 ? `${Math.round(done / total * 100)}%` : '0%';
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  ODCZYT KONFIGURACJI Z UI
    // ═══════════════════════════════════════════════════════════════════════════

    function readConfig() {
        const tplFull    = document.getElementById('af_tpl_full')?.value || null;
        const tplNotFull = document.getElementById('af_tpl_notfull')?.value || null;
        const minInt     = Math.max(200, parseInt(document.getElementById('af_min_interval')?.value) || 200);
        const randExtra  = Math.max(0,   parseInt(document.getElementById('af_random_extra')?.value)  || 200);

        const cfg = {
            templateOnFull:    tplFull    || null,
            templateOnNotFull: tplNotFull || null,
            minInterval:  minInt,
            randomExtra:  randExtra,
        };

        const state = loadState();
        state.config = cfg;
        saveState(state);
        return cfg;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  AKCJE
    // ═══════════════════════════════════════════════════════════════════════════

    let running = false;
    let autoTimer = null;

    async function runOnce() {
        if (running) return;
        running = true;

        const btnOnce = document.getElementById('afBtnOnce');
        const btnAuto = document.getElementById('afBtnAuto');
        if (btnOnce) btnOnce.disabled = true;
        if (btnAuto) btnAuto.disabled = true;

        updateProgress(0, 1);

        const cfg = readConfig();
        const result = await runFarm(cfg);

        updateProgress(1, 1);
        running = false;

        // Paginacja: jeśli wysłano ataki i jest następna strona — przejdź dalej
        const nextUrl = findNextPageUrl();
        if (result.sent > 0 && nextUrl) {
            const st = loadState();
            st.continuingRun = true;
            saveState(st);
            setStatus(`Wysłano: ${result.sent} | przechodzę na następną stronę...`);
            setTimeout(() => { window.location.href = nextUrl; }, 1000);
            return;
        }

        // Ostatnia strona lub brak wojska — zakończ
        const st = loadState();
        st.continuingRun = false;
        saveState(st);

        setStatus(`Wysłano: ${result.sent} | Pominięto: ${result.skipped} | W drodze: ${result.disabled}`);
        if (btnOnce) btnOnce.disabled = false;
        if (btnAuto) btnAuto.disabled = false;
    }

    function toggleAuto() {
        const state = loadState();
        state.autoEnabled = !state.autoEnabled;
        saveState(state);

        const btn = document.getElementById('afBtnAuto');
        if (state.autoEnabled) {
            btn.textContent = 'Auto: ON';
            btn.classList.add('btn-on');
            scheduleNextRun();
        } else {
            btn.textContent = 'Auto: OFF';
            btn.classList.remove('btn-on');
            if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
            setStatus('Auto wyłączone');
        }
    }

    // Auto: po wysłaniu wszystkich ataków czeka losowy czas 8–30 minut i przeładowuje
    async function scheduleNextRun() {
        const state = loadState();
        if (!state.autoEnabled) return;

        if (running) return;
        running = true;

        const btnOnce = document.getElementById('afBtnOnce');
        if (btnOnce) btnOnce.disabled = true;

        updateProgress(0, 1);

        const cfg = readConfig();
        const result = await runFarm(cfg);

        updateProgress(1, 1);

        running = false;
        if (btnOnce) btnOnce.disabled = false;

        // Paginacja: jeśli wysłano ataki i jest następna strona — przejdź od razu
        const nextUrl = findNextPageUrl();
        if (result.sent > 0 && nextUrl) {
            setStatus(`Wysłano: ${result.sent} | przechodzę na następną stronę...`);
            autoTimer = setTimeout(() => { window.location.href = nextUrl; }, 1000);
            return;
        }

        // Wszystkie strony przetworzone — wróć na stronę 1 po losowym czasie
        const minMs  = 15 * 60 * 1000;
        const maxMs  = 50 * 60 * 1000;
        const waitMs = minMs + Math.floor(Math.random() * (maxMs - minMs));

        const page1Url = new URL(window.location.href);
        page1Url.searchParams.delete('page');

        const reloadAt = msToTime(Date.now() + waitMs);
        setStatus(`Wysłano: ${result.sent} | reload o ${reloadAt}`);

        autoTimer = setTimeout(() => { window.location.href = page1Url.toString(); }, waitMs);
    }

    function msToTime(ts) {
        const d = new Date(ts);
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    }

    function findNextPageUrl() {
        // Aktualna strona: <strong class="paged-nav-item">
        // Następne strony:  <a class="paged-nav-item" href="...&Farm_page=N">
        const items = Array.from(document.querySelectorAll('.paged-nav-item'));
        const currentIdx = items.findIndex(el => el.tagName === 'STRONG');
        if (currentIdx === -1) return null;
        const next = items[currentIdx + 1];
        return (next && next.tagName === 'A') ? next.href : null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ═══════════════════════════════════════════════════════════════════════════
    //  START
    // ═══════════════════════════════════════════════════════════════════════════

    async function init() {
        injectStyles();
        createPanel();

        await delay(CONFIG.pageLoadDelay);

        // Policz wioski na liście i pokaż w statusie
        const rows = document.querySelectorAll('tr[id^="village_"]');
        setStatus(`Wiosek na liście: ${rows.length}`);

        // Wznów po przeładowaniu strony
        const state = loadState();
        if (state.autoEnabled) {
            scheduleNextRun();
        } else if (state.continuingRun) {
            // "Wyślij raz" kontynuuje przez kolejne strony
            state.continuingRun = false;
            saveState(state);
            runOnce();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, CONFIG.pageLoadDelay));
    } else {
        setTimeout(init, CONFIG.pageLoadDelay);
    }

})();
