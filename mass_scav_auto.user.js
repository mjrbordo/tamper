// ==UserScript==
// @name         Mass Scavenge Auto
// @namespace    http://tampermonkey.net/
// @version      1.4.0
// @description  Automatyzuje masowe zbieractwo w Plemionach
// @author       Bordo
// @match        https://*.plemiona.pl/*mode=scavenge_mass*
// @match        https://*.tribalwars.co.uk/*&mode=scavenge*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const DEFAULT_UNITS = {
        spear:   0,
        sword:   0,
        axe:     0,
        archer:  0,
        light:   0,
        marcher: 0,
        heavy:   0,
        knight:  0,
    };

    const DEFAULT_LEVELS = { 1: true, 2: true, 3: true, 4: true };

    const BUFFER_MINUTES  = 2;
    const PAGE_LOAD_DELAY = 3000;

    // ═══════════════════════════════════════════════════════════════════════════
    //  ODCZYT DANYCH WIOSEK
    // ═══════════════════════════════════════════════════════════════════════════

    function parseVillagesFromHTML(htmlText) {
        const start = htmlText.indexOf('new ScavengeMassScreen(');
        if (start === -1) return null;

        const argsStart = htmlText.indexOf('(', start) + 1;
        let depth = 0, commas = 0, arg4Start = -1, arg4End = -1;

        for (let i = argsStart; i < htmlText.length; i++) {
            const c = htmlText[i];
            if (c === '{' || c === '[' || c === '(') depth++;
            if (c === '}' || c === ']' || c === ')') {
                depth--;
                if (depth < 0) break;
            }
            if (depth === 0 && c === ',') {
                commas++;
                if (commas === 3) {
                    let j = i + 1;
                    while (j < htmlText.length && /\s/.test(htmlText[j])) j++;
                    arg4Start = j;
                }
                if (commas === 4) { arg4End = i; break; }
            }
        }

        if (arg4Start !== -1 && arg4End === -1) {
            let d = 0;
            for (let i = arg4Start; i < htmlText.length; i++) {
                const c = htmlText[i];
                if (c === '[' || c === '{') d++;
                if (c === ']' || c === '}') {
                    d--;
                    if (d === 0) { arg4End = i + 1; break; }
                }
            }
        }

        if (arg4Start === -1 || arg4End === -1) return null;

        const json = htmlText.slice(arg4Start, arg4End).trim();
        if (!json.startsWith('[')) return null;

        try {
            const data = JSON.parse(json);
            if (Array.isArray(data) && data.length > 0 && data[0].village_id) return data;
        } catch (e) {
            console.warn('[MSA] parseVillagesFromHTML błąd:', e);
        }
        return null;
    }

    async function fetchVillagesData() {
        try {
            const resp = await fetch(window.location.href, { credentials: 'same-origin' });
            if (!resp.ok) return null;
            const html = await resp.text();
            return parseVillagesFromHTML(html);
        } catch (e) {
            console.warn('[MSA] fetchVillagesData błąd:', e);
            return null;
        }
    }

    function parseVillagesFromDOM() {
        const scripts = document.querySelectorAll('script:not([src])');
        for (const s of scripts) {
            const result = parseVillagesFromHTML(s.textContent);
            if (result) return result;
        }
        return null;
    }

    async function getVillagesData() {
        const fromDOM = parseVillagesFromDOM();
        if (fromDOM) {
            console.log('[MSA] Dane wiosek z DOM, wiosek:', fromDOM.length);
            return fromDOM;
        }
        console.log('[MSA] DOM nie zawiera danych, próbuję fetch...');
        const fromFetch = await fetchVillagesData();
        if (fromFetch) {
            console.log('[MSA] Dane wiosek z fetch, wiosek:', fromFetch.length);
            return fromFetch;
        }
        console.warn('[MSA] Nie udało się pobrać danych wiosek żadną metodą');
        return [];
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  NAJWCZEŚNIEJSZY CZAS POWROTU
    // ═══════════════════════════════════════════════════════════════════════════

    function getEarliestReturnTime(villages) {
        const state  = loadState();
        const levels = state.levels || DEFAULT_LEVELS;
        let earliest = null;

        for (const village of villages) {
            if (!village.options) continue;
            for (const [lvlId, optData] of Object.entries(village.options)) {
                if (!levels[String(lvlId)]) continue;
                const squad = optData.scavenging_squad;
                if (!squad || !squad.return_time) continue;
                const rt = squad.return_time;
                if (!earliest || rt < earliest) earliest = rt;
            }
        }
        return earliest;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  LOCALSTORAGE
    // ═══════════════════════════════════════════════════════════════════════════

    const STORAGE_KEY = 'massScavAuto';

    function loadState() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
        catch { return {}; }
    }

    function saveState(s) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  STYLE
    // ═══════════════════════════════════════════════════════════════════════════

    function injectStyles() {
        document.head.appendChild(Object.assign(document.createElement('style'), {
            textContent: `
            #msaPanel {
                position: fixed; top: 60px; right: 12px; width: 228px;
                background: rgba(245,240,225,0.97); border: 1px solid #967444;
                border-radius: 4px; padding: 8px; z-index: 9999;
                font-family: Arial, sans-serif; font-size: 11px;
                box-shadow: 0 2px 6px rgba(0,0,0,.25); user-select: none;
            }
            #msaPanel h3 {
                margin: 0 0 6px; font-size: 12px; color: #784B25;
                text-align: center; border-bottom: 1px solid #c8a96e; padding-bottom: 4px;
            }
            #msaPanel .sec { color: #784B25; font-weight: bold; margin: 7px 0 3px; }
            #msaPanel .unit-row {
                display: flex; align-items: center; justify-content: space-between;
                color: #4A3011; margin-bottom: 2px;
            }
            #msaPanel input[type="number"] {
                width: 64px; padding: 2px 4px; border: 1px solid #967444;
                border-radius: 2px; font-size: 11px; text-align: center;
                background: #fff; color: #333;
            }
            #msaPanel .lvl-row { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; color: #4A3011; }
            #msaPanel .lvl-row label { cursor: pointer; }
            #msaPanel .btn-row { display: flex; gap: 5px; margin-top: 8px; }
            #msaPanel button {
                flex: 1; padding: 4px 2px; border: 1px solid #967444;
                border-radius: 2px; background: #c8a96e; color: #4A3011;
                cursor: pointer; font-size: 11px; font-weight: bold;
            }
            #msaPanel button:hover { background: #b8946a; }
            #msaPanel .btn-on { background: #4a8020 !important; color: #fff !important; border-color: #306010 !important; }
            #msaPanel .btn-on:hover { background: #3a6818 !important; }
            #msaPanel #msaStatus {
                margin-top: 6px; padding: 3px 4px; background: rgba(255,255,255,.5);
                border-radius: 2px; color: #5C3C1D; font-size: 10px;
                min-height: 14px; text-align: center;
            }
            #msaPanel #msaNext {
                margin-top: 3px; padding: 3px 4px; background: rgba(255,255,255,.5);
                border-radius: 2px; color: #006600; font-size: 10px;
                text-align: center; font-weight: bold; min-height: 14px;
            }
        `}));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  UI
    // ═══════════════════════════════════════════════════════════════════════════

    const UNIT_LABELS = {
        spear: 'Pikinier', sword: 'Miecznik', axe: 'Topornik',
        archer: 'Łucznik', light: 'LK', marcher: 'ŁNK', heavy: 'CK', knight: 'Rycerz',
    };
    const LEVEL_LABELS = {
        1: 'Ambitni amatorzy', 2: 'Cierpliwi ciułacze',
        3: 'Zawodowi zbieracze', 4: 'Specjaliści surowcowi',
    };

    function createPanel() {
        const state  = loadState();
        const units  = state.units  || { ...DEFAULT_UNITS };
        const levels = state.levels || { ...DEFAULT_LEVELS };
        const autoOn = !!state.autoEnabled;

        const p = document.createElement('div');
        p.id = 'msaPanel';
        p.innerHTML = '<h3>Mass Scavenge Auto</h3>';

        addSec(p, 'Jednostki na zbieractwo:');
        for (const [unit, label] of Object.entries(UNIT_LABELS)) {
            const row = document.createElement('div');
            row.className = 'unit-row';
            row.innerHTML = `<span>${label}</span>
                <input type="number" id="msa_u_${unit}" min="0" max="99999" value="${units[unit] ?? 0}">`;
            p.appendChild(row);
        }

        addSec(p, 'Poziomy zbieractwa:');
        for (const [lvl, label] of Object.entries(LEVEL_LABELS)) {
            const row = document.createElement('div');
            row.className = 'lvl-row';
            row.innerHTML = `<input type="checkbox" id="msa_l_${lvl}" ${levels[String(lvl)] ? 'checked' : ''}>
                <label for="msa_l_${lvl}">${lvl}. ${label}</label>`;
            p.appendChild(row);
        }

        const btnRow = document.createElement('div');
        btnRow.className = 'btn-row';

        const btnNow = document.createElement('button');
        btnNow.textContent = 'Wyślij teraz';
        btnNow.onclick = () => { saveConfig(); sendScavenge(); };

        const btnAuto = document.createElement('button');
        btnAuto.id = 'msaBtnAuto';
        btnAuto.textContent = autoOn ? 'Auto: ON' : 'Auto: OFF';
        if (autoOn) btnAuto.classList.add('btn-on');
        btnAuto.onclick = toggleAuto;

        btnRow.append(btnNow, btnAuto);
        p.appendChild(btnRow);

        p.appendChild(Object.assign(document.createElement('div'), { id: 'msaStatus', textContent: 'Ładowanie...' }));
        p.appendChild(Object.assign(document.createElement('div'), { id: 'msaNext' }));

        document.body.appendChild(p);
    }

    function addSec(parent, text) {
        parent.appendChild(Object.assign(document.createElement('div'), { className: 'sec', textContent: text }));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    function saveConfig() {
        const state = loadState();
        const units = {};
        for (const unit of Object.keys(UNIT_LABELS)) {
            const el = document.getElementById(`msa_u_${unit}`);
            units[unit] = el ? (parseInt(el.value) || 0) : 0;
        }
        const levels = {};
        for (let l = 1; l <= 4; l++) {
            const el = document.getElementById(`msa_l_${l}`);
            levels[String(l)] = el ? el.checked : false;
        }
        state.units  = units;
        state.levels = levels;
        saveState(state);
        return { units, levels };
    }

    function setStatus(msg) {
        const el = document.getElementById('msaStatus');
        if (el) el.textContent = msg;
    }

    function setNextLabel(ts) {
        const el = document.getElementById('msaNext');
        if (!el) return;
        if (!ts) { el.textContent = ''; return; }
        const d  = new Date(ts * 1000);
        el.textContent = `Następna akcja: ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    }

    function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    function setInput(input, value) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, String(value));
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  WYSYŁANIE
    // ═══════════════════════════════════════════════════════════════════════════

    async function sendScavenge() {
        setStatus('Wysyłam...');
        const state  = loadState();
        const units  = state.units  || DEFAULT_UNITS;
        const levels = state.levels || DEFAULT_LEVELS;

        // 1. Wpisz jednostki
        for (const [unit, count] of Object.entries(units)) {
            if (count <= 0) continue;
            const input = document.querySelector(`#scavenge_mass_screen input.unitsInput[name="${unit}"]`);
            if (!input) continue;
            setInput(input, count);
        }

        await delay(700);

        // 2. Kliknij select-all-col dla każdego wybranego poziomu (4→1)
        // Jeśli checkbox jest disabled = wszystkie wioski zbierają na tym poziomie → pomiń
        // Jeśli nie jest disabled = kliknij, gra zaznaczy wszystkie wioski które mogą
        let clicked = 0;
        for (let lvl = 4; lvl >= 1; lvl--) {
            if (!levels[String(lvl)]) continue;
            const cb = document.querySelector(`input.select-all-col[data-option="${lvl}"]`);
            if (!cb || cb.disabled) continue;
            if (!cb.checked) { cb.click(); await delay(250); }
            clicked++;
        }

        if (clicked === 0) {
            setStatus('Wszystkie poziomy w trakcie');
            return false;
        }

        await delay(400);

        // 3. Wyślij
        const sendBtn = document.querySelector('#scavenge_mass_screen a.btn.btn-send:not([disabled])');
        if (!sendBtn) {
            setStatus('Brak przycisku "Wyślij" — wpisz jednostki');
            return false;
        }

        sendBtn.click();
        setStatus(`Wysłano! (${clicked} poziomy)`);
        return true;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  AUTO-TRYB
    // ═══════════════════════════════════════════════════════════════════════════

    let autoTimer = null;
    let autoRunning = false;

    function toggleAuto() {
        const state = loadState();
        state.autoEnabled = !state.autoEnabled;
        saveState(state);

        const btn = document.getElementById('msaBtnAuto');
        if (state.autoEnabled) {
            btn.textContent = 'Auto: ON';
            btn.classList.add('btn-on');
            autoRunning = true;
            runAutoLoop();
        } else {
            btn.textContent = 'Auto: OFF';
            btn.classList.remove('btn-on');
            autoRunning = false;
            if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
            setNextLabel(null);
            setStatus('Auto wyłączone');
        }
    }
    async function getEarliestBusyReturn() {
        const villages = await getVillagesData();
        const state    = loadState();
        const levels   = state.levels || DEFAULT_LEVELS;
        const nowSec   = Math.floor(Date.now() / 1000);
        let earliest   = null;

        for (const village of villages) {
            if (!village.options) continue;
            for (const [lvlId, optData] of Object.entries(village.options)) {
                if (!levels[String(lvlId)]) continue;
                const squad = optData.scavenging_squad;
                if (!squad || !squad.return_time) continue;
                const rt = squad.return_time;
                if (rt > nowSec && (!earliest || rt < earliest)) earliest = rt;
            }
        }
        return earliest;
    }

    async function runAutoLoop() {
        while (autoRunning) {
            const state = loadState();
            if (!state.autoEnabled) { autoRunning = false; break; }

            saveConfig();

            // Najpierw wpisz jednostki — gra odblokowuje select-all-col dopiero
            // gdy w inputach są wartości > 0
            const units = state.units || DEFAULT_UNITS;
            for (const [unit, count] of Object.entries(units)) {
                if (count <= 0) continue;
                const input = document.querySelector(`#scavenge_mass_screen input.unitsInput[name="${unit}"]`);
                if (!input) continue;
                setInput(input, count);
            }

            // Poczekaj aż gra przetworzy inputy i odblokuje checkboxy
            await delay(800);

            // Sprawdź czy którykolwiek select-all-col jest teraz aktywny
            const levels = state.levels || DEFAULT_LEVELS;
            let anyEnabled = false;
            for (let lvl = 1; lvl <= 4; lvl++) {
                if (!levels[String(lvl)]) continue;
                const cb = document.querySelector(`input.select-all-col[data-option="${lvl}"]`);
                if (cb && !cb.disabled) { anyEnabled = true; break; }
            }

            if (anyEnabled) {
                // Są dostępne poziomy — wyślij
                await sendScavenge();

                // Po wysłaniu pobierz return_time przez fetch — DOM jeszcze nie wie o nowych misjach
                await delay(1500);
                setStatus('Pobieranie danych po wysyłce...');
                const earliestAfter = await getEarliestBusyReturn();
                const bufSec  = BUFFER_MINUTES * 60;
                const nextTs  = earliestAfter
                    ? earliestAfter + bufSec
                    : Math.floor(Date.now() / 1000) + 120;
                const waitMs  = (nextTs * 1000) - Date.now();

                setNextLabel(nextTs);
                setStatus('Auto: czekam na powrót oddziałów');

                const sleepUntil = Date.now() + Math.max(waitMs, 5000);
                while (autoRunning && Date.now() < sleepUntil) {
                    await delay(Math.min(30_000, sleepUntil - Date.now()));
                }
                window.location.reload();
                return;
            }

            // Wszystkie select-all-col disabled — pobierz return_time i czekaj
            setStatus('Pobieranie danych...');
            const earliest = await getEarliestBusyReturn();
            const bufSec   = BUFFER_MINUTES * 60;
            const nextTs   = earliest ? earliest + bufSec : Math.floor(Date.now() / 1000) + 120;
            const waitMs   = (nextTs * 1000) - Date.now();

            setNextLabel(nextTs);
            setStatus('Auto: czekam na powrót oddziałów');

            const sleepUntil = Date.now() + Math.max(waitMs, 5000);
            while (autoRunning && Date.now() < sleepUntil) {
                await delay(Math.min(30_000, sleepUntil - Date.now()));
            }
            window.location.reload();
            return;
        }
    }
    // ═══════════════════════════════════════════════════════════════════════════
    //  START
    // ═══════════════════════════════════════════════════════════════════════════

    async function init() {
        injectStyles();
        createPanel();

        await delay(PAGE_LOAD_DELAY);

        const villages = await getVillagesData();

        if (villages.length > 0) {
            const earliest = getEarliestReturnTime(villages);
            if (earliest) {
                const d = new Date(earliest * 1000);
                setStatus(`OK — najw. powrót: ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);
            } else {
                setStatus('OK — brak aktywnych misji');
            }
        } else {
            setStatus('⚠ Nie można odczytać danych wiosek');
        }

        const state = loadState();
        if (state.autoEnabled) {
            autoRunning = true;
            runAutoLoop();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init());
    } else {
        init();
    }

})();
