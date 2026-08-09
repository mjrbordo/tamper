// ==UserScript==
// @name         Mass Scavenge Auto (per grupa)
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Automatyzuje masowe zbieractwo w Plemionach — osobne ustawienia i harmonogram per grupa wiosek
// @author       Bordo
// @match        https://*.plemiona.pl/*mode=scavenge_mass*
// @match        https://*.tribalwars.co.uk/*&mode=scavenge*
// @updateURL    https://cdn.jsdelivr.net/gh/mjrbordo/tamper@main/aut_mass_scav_groups.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/mjrbordo/tamper@main/aut_mass_scav_groups.user.js
// @grant        GM_getValue
// @grant        GM_setValue
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
    const NO_GROUP_ID     = '0';
    const NO_GROUP_NAME   = 'Bez grupy (wszystkie wioski)';

    const UNIT_LABELS = {
        spear: 'Pikinier', sword: 'Miecznik', axe: 'Topornik',
        archer: 'Łucznik', light: 'LK', marcher: 'ŁNK', heavy: 'CK', knight: 'Rycerz',
    };
    const LEVEL_LABELS = {
        1: 'Ambitni amatorzy', 2: 'Cierpliwi ciułacze',
        3: 'Zawodowi zbieracze', 4: 'Specjaliści surowcowi',
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  STORAGE (GM_* z fallbackiem do localStorage)
    // ═══════════════════════════════════════════════════════════════════════════

    // Klucz musi być per-świat — @match łapie całą domenę plemiona.pl, więc bez tego
    // grupy/ustawienia z różnych światów (pl180, pl231, itd.) mieszałyby się w jednym worku.
    function getWorldId() {
        try {
            return (window.game_data && game_data.world) || window.location.hostname;
        } catch (e) {
            return window.location.hostname;
        }
    }

    const STORAGE_KEY     = `massScavAutoV2_${getWorldId()}`;
    const OLD_STORAGE_KEY = 'massScavAuto'; // v1, do migracji jednorazowej (był globalny, bez podziału na światy)

    function gmAvailable() {
        return typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
    }

    function loadState() {
        try {
            const raw = gmAvailable() ? GM_getValue(STORAGE_KEY, null) : localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.warn('[MSA] loadState błąd:', e);
            return {};
        }
    }

    function saveState(state) {
        try {
            const raw = JSON.stringify(state);
            if (gmAvailable()) GM_setValue(STORAGE_KEY, raw);
            else localStorage.setItem(STORAGE_KEY, raw);
        } catch (e) {
            console.warn('[MSA] saveState błąd:', e);
        }
    }

    // Jednorazowa migracja starego globalnego configu (v1) do grupy "Bez grupy"
    function migrateOldConfig(state) {
        if (state.migratedV1) return;
        try {
            const oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
            if (oldRaw) {
                const old = JSON.parse(oldRaw);
                if (old && (old.units || old.levels)) {
                    state.groups = state.groups || {};
                    state.groups[NO_GROUP_ID] = state.groups[NO_GROUP_ID] || {
                        name: NO_GROUP_NAME, inRotation: false,
                    };
                    state.groups[NO_GROUP_ID].units  = old.units  || { ...DEFAULT_UNITS };
                    state.groups[NO_GROUP_ID].levels = old.levels || { ...DEFAULT_LEVELS };
                }
            }
        } catch (e) { /* brak starego configu, nic się nie dzieje */ }
        state.migratedV1 = true;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  GRUPY WIOSEK (z gry, przez TribalWars.get)
    // ═══════════════════════════════════════════════════════════════════════════

    function fetchGroupsList() {
        return new Promise((resolve) => {
            try {
                TribalWars.get('groups', { ajax: 'load_groups', village_id: game_data.village.id }, (e) => {
                    resolve((e && e.result) || []);
                });
            } catch (err) {
                console.warn('[MSA] fetchGroupsList błąd:', err);
                resolve([]);
            }
        });
    }

    function ensureGroupsInState(state, apiGroups) {
        state.groups   = state.groups   || {};
        state.schedule = state.schedule || {};

        if (!state.groups[NO_GROUP_ID]) {
            state.groups[NO_GROUP_ID] = {
                name: NO_GROUP_NAME,
                units: { ...DEFAULT_UNITS },
                levels: { ...DEFAULT_LEVELS },
                inRotation: false,
            };
        }

        for (const g of apiGroups) {
            const gid = String(g.group_id);
            if (!state.groups[gid]) {
                state.groups[gid] = {
                    name: g.name,
                    units: { ...DEFAULT_UNITS },
                    levels: { ...DEFAULT_LEVELS },
                    inRotation: false,
                };
            } else {
                state.groups[gid].name = g.name; // odśwież nazwę, gdyby zmieniona w grze
            }
        }
    }

    // WAŻNE: nie polegamy na game_data.group_id — to osobny, wewnętrzny stan gry,
    // który nie musi odzwierciedlać parametru &group= w URL. Czytamy bezpośrednio
    // z adresu strony, bo to jedyne źródło, które sami kontrolujemy i wiemy, że
    // faktycznie filtruje tabelę (potwierdzone ręcznym testem).
    function getCurrentGroupId() {
        const params = new URLSearchParams(window.location.search);
        return params.get('group') || NO_GROUP_ID;
    }

    function buildGroupUrl(groupId) {
        const url = new URL(window.location.href);
        if (groupId && groupId !== NO_GROUP_ID) url.searchParams.set('group', groupId);
        else url.searchParams.delete('group');
        return url.toString();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  ODCZYT DANYCH WIOSEK (bez zmian względem oryginału)
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
    //  STYLE
    // ═══════════════════════════════════════════════════════════════════════════

    function injectStyles() {
        document.head.appendChild(Object.assign(document.createElement('style'), {
            textContent: `
            #msaPanel {
                position: fixed; top: 60px; right: 12px; width: 258px;
                max-height: 88vh; overflow-y: auto;
                background: rgba(245,240,225,0.97); border: 1px solid #967444;
                border-radius: 4px; padding: 8px; z-index: 9999;
                font-family: Arial, sans-serif; font-size: 11px;
                box-shadow: 0 2px 6px rgba(0,0,0,.25); user-select: none;
            }
            #msaPanel h3 {
                margin: 0 0 6px; font-size: 12px; color: #784B25;
                text-align: center; border-bottom: 1px solid #c8a96e; padding-bottom: 4px;
            }
            #msaPanel .global-row { display: flex; gap: 5px; margin-bottom: 8px; }
            #msaPanel .global-row button {
                flex: 1; padding: 5px 2px; border: 1px solid #967444;
                border-radius: 2px; background: #c8a96e; color: #4A3011;
                cursor: pointer; font-size: 11px; font-weight: bold;
            }
            #msaPanel .btn-on { background: #4a8020 !important; color: #fff !important; border-color: #306010 !important; }
            #msaGlobalStatus {
                margin-bottom: 8px; padding: 3px 4px; background: rgba(255,255,255,.5);
                border-radius: 2px; color: #5C3C1D; font-size: 10px;
                min-height: 14px; text-align: center;
            }
            .msa-group {
                border: 1px solid #c8a96e; border-radius: 3px; margin-bottom: 6px;
                background: rgba(255,255,255,.35);
            }
            .msa-group > summary {
                cursor: pointer; padding: 4px 6px; font-weight: bold; color: #784B25;
                display: flex; justify-content: space-between; align-items: center;
                list-style: none;
            }
            .msa-group > summary::-webkit-details-marker { display: none; }
            .msa-group .body { padding: 4px 6px 6px; }
            .msa-group .sec { color: #784B25; font-weight: bold; margin: 5px 0 2px; }
            .msa-group .unit-row {
                display: flex; align-items: center; justify-content: space-between;
                color: #4A3011; margin-bottom: 2px;
            }
            .msa-group input[type="number"] {
                width: 58px; padding: 2px 4px; border: 1px solid #967444;
                border-radius: 2px; font-size: 11px; text-align: center;
                background: #fff; color: #333;
            }
            .msa-group .lvl-row { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; color: #4A3011; }
            .msa-group .rot-row { display: flex; align-items: center; gap: 5px; margin: 5px 0; color: #4A3011; font-weight: bold; }
            .msa-group .btn-send-group {
                width: 100%; margin-top: 4px; padding: 4px 2px; border: 1px solid #967444;
                border-radius: 2px; background: #c8a96e; color: #4A3011;
                cursor: pointer; font-size: 11px; font-weight: bold;
            }
            .msa-group .btn-send-group:hover { background: #b8946a; }
            .msa-group .next-run {
                margin-top: 3px; font-size: 10px; color: #006600; font-weight: bold;
            }
            .msa-group .active-badge { font-size: 9px; color: #fff; background: #4a8020; padding: 1px 4px; border-radius: 6px; }
        `}));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  PANEL / UI
    // ═══════════════════════════════════════════════════════════════════════════

    function renderPanel(state) {
        const existing = document.getElementById('msaPanel');
        if (existing) existing.remove();

        const p = document.createElement('div');
        p.id = 'msaPanel';
        p.innerHTML = '<h3>Mass Scavenge Auto — per grupa</h3>';

        const globalRow = document.createElement('div');
        globalRow.className = 'global-row';
        const btnAuto = document.createElement('button');
        btnAuto.id = 'msaBtnAuto';
        btnAuto.textContent = state.autoEnabled ? 'Auto-rotacja: ON' : 'Auto-rotacja: OFF';
        if (state.autoEnabled) btnAuto.classList.add('btn-on');
        btnAuto.onclick = toggleAuto;
        globalRow.appendChild(btnAuto);
        p.appendChild(globalRow);

        p.appendChild(Object.assign(document.createElement('div'), {
            id: 'msaGlobalStatus', textContent: 'Ładowanie...',
        }));

        const currentGid = getCurrentGroupId();
        const gids = Object.keys(state.groups).sort((a, b) => {
            if (a === NO_GROUP_ID) return 1;
            if (b === NO_GROUP_ID) return -1;
            return state.groups[a].name.localeCompare(state.groups[b].name);
        });

        for (const gid of gids) {
            p.appendChild(renderGroupCard(gid, state.groups[gid], state, currentGid));
        }

        document.body.appendChild(p);
    }

    function renderGroupCard(gid, cfg, state, currentGid) {
        const details = document.createElement('details');
        details.className = 'msa-group';
        details.open = (gid === currentGid);

        const summary = document.createElement('summary');
        summary.innerHTML = `<span>${escapeHtml(cfg.name)}${gid === currentGid ? ' (ten widok)' : ''}</span>` +
            (cfg.inRotation ? '<span class="active-badge">rotacja</span>' : '');
        details.appendChild(summary);

        const body = document.createElement('div');
        body.className = 'body';

        const sec1 = document.createElement('div');
        sec1.className = 'sec';
        sec1.textContent = 'Jednostki na zbieractwo:';
        body.appendChild(sec1);

        for (const [unit, label] of Object.entries(UNIT_LABELS)) {
            const row = document.createElement('div');
            row.className = 'unit-row';
            row.innerHTML = `<span>${label}</span>
                <input type="number" id="msa_g${gid}_u_${unit}" min="0" max="99999" value="${cfg.units?.[unit] ?? 0}">`;
            body.appendChild(row);
        }

        const sec2 = document.createElement('div');
        sec2.className = 'sec';
        sec2.textContent = 'Poziomy zbieractwa:';
        body.appendChild(sec2);

        for (const [lvl, label] of Object.entries(LEVEL_LABELS)) {
            const row = document.createElement('div');
            row.className = 'lvl-row';
            row.innerHTML = `<input type="checkbox" id="msa_g${gid}_l_${lvl}" ${cfg.levels?.[String(lvl)] ? 'checked' : ''}>
                <label for="msa_g${gid}_l_${lvl}">${lvl}. ${label}</label>`;
            body.appendChild(row);
        }

        const rotRow = document.createElement('div');
        rotRow.className = 'rot-row';
        rotRow.innerHTML = `<input type="checkbox" id="msa_g${gid}_rot" ${cfg.inRotation ? 'checked' : ''}>
            <label for="msa_g${gid}_rot">Aktywna w auto-rotacji</label>`;
        body.appendChild(rotRow);

        const sendBtn = document.createElement('button');
        sendBtn.className = 'btn-send-group';
        sendBtn.textContent = gid === currentGid ? 'Wyślij teraz' : 'Przełącz i wyślij';
        sendBtn.onclick = () => manualSendGroup(gid);
        body.appendChild(sendBtn);

        const nextRun = document.createElement('div');
        nextRun.className = 'next-run';
        nextRun.id = `msa_g${gid}_next`;
        const nextTs = (state.schedule || {})[gid];
        nextRun.textContent = nextTs ? formatNextRun(nextTs) : '';
        body.appendChild(nextRun);

        details.appendChild(body);
        return details;
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    function formatNextRun(ts) {
        const d = new Date(ts * 1000);
        return `Następna akcja: ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    }

    function setGlobalStatus(msg) {
        const el = document.getElementById('msaGlobalStatus');
        if (el) el.textContent = msg;
    }

    function setGroupNext(gid, ts) {
        const el = document.getElementById(`msa_g${gid}_next`);
        if (el) el.textContent = ts ? formatNextRun(ts) : '';
    }

    // Wczytuje wartości z panelu (dla danej grupy) i zapisuje do state
    function readGroupConfigFromPanel(gid, state) {
        const units = {};
        for (const unit of Object.keys(UNIT_LABELS)) {
            const el = document.getElementById(`msa_g${gid}_u_${unit}`);
            units[unit] = el ? (parseInt(el.value) || 0) : 0;
        }
        const levels = {};
        for (let l = 1; l <= 4; l++) {
            const el = document.getElementById(`msa_g${gid}_l_${l}`);
            levels[String(l)] = el ? el.checked : false;
        }
        const rotEl = document.getElementById(`msa_g${gid}_rot`);

        state.groups[gid] = state.groups[gid] || { name: gid };
        state.groups[gid].units      = units;
        state.groups[gid].levels     = levels;
        state.groups[gid].inRotation = rotEl ? rotEl.checked : false;
        saveState(state);
    }

    function saveAllPanelConfigs(state) {
        for (const gid of Object.keys(state.groups)) {
            if (document.getElementById(`msa_g${gid}_rot`)) {
                readGroupConfigFromPanel(gid, state);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  HELPERS WYSYŁKI
    // ═══════════════════════════════════════════════════════════════════════════

    function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

    function setInput(input, value) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, String(value));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Wysyła zbieractwo dla podanej grupy — ZAKŁADA że strona jest już przefiltrowana
    // do tej grupy (getCurrentGroupId() === gid), inaczej select-all-col zaznaczy
    // wszystkie wioski na koncie, nie tylko tej grupy.
    async function executeSendForGroup(gid, state) {
        const cfg = state.groups[gid] || { units: { ...DEFAULT_UNITS }, levels: { ...DEFAULT_LEVELS } };
        setGlobalStatus(`Wysyłam dla grupy: ${cfg.name || gid}`);

        for (const [unit, count] of Object.entries(cfg.units || {})) {
            if (!count || count <= 0) continue;
            const input = document.querySelector(`#scavenge_mass_screen input.unitsInput[name="${unit}"]`);
            if (input) setInput(input, count);
        }
        await delay(700);

        let clicked = 0;
        for (let lvl = 4; lvl >= 1; lvl--) {
            if (!cfg.levels || !cfg.levels[String(lvl)]) continue;
            const cb = document.querySelector(`input.select-all-col[data-option="${lvl}"]`);
            if (!cb || cb.disabled) continue;
            if (!cb.checked) { cb.click(); await delay(250); }
            clicked++;
        }

        if (clicked > 0) {
            await delay(400);
            const sendBtn = document.querySelector('#scavenge_mass_screen a.btn.btn-send:not([disabled])');
            if (sendBtn) {
                sendBtn.click();
                setGlobalStatus(`Wysłano! Grupa: ${cfg.name || gid} (${clicked} poziomy)`);
            } else {
                setGlobalStatus('Brak przycisku "Wyślij" — sprawdź jednostki');
            }
        } else {
            setGlobalStatus(`Grupa ${cfg.name || gid}: wszystkie poziomy w trakcie`);
        }

        // Policz kolejny return_time DLA TEJ GRUPY (strona wciąż przefiltrowana)
        await delay(1500);
        const villages = await getVillagesData();
        const bufSec  = BUFFER_MINUTES * 60;
        const nowSec  = Math.floor(Date.now() / 1000);
        let earliestAfter = null;

        for (const v of villages) {
            if (!v.options) continue;
            for (const [lvlId, optData] of Object.entries(v.options)) {
                if (!cfg.levels || !cfg.levels[String(lvlId)]) continue;
                const squad = optData.scavenging_squad;
                if (!squad || !squad.return_time) continue;
                if (squad.return_time > nowSec && (!earliestAfter || squad.return_time < earliestAfter)) {
                    earliestAfter = squad.return_time;
                }
            }
        }

        const nextTs = earliestAfter ? earliestAfter + bufSec : nowSec + 120;
        state.schedule = state.schedule || {};
        state.schedule[gid] = nextTs;
        saveState(state);
        setGroupNext(gid, nextTs);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  WYSYŁKA RĘCZNA (przycisk per grupa)
    // ═══════════════════════════════════════════════════════════════════════════

    async function manualSendGroup(gid) {
        const state = loadState();
        readGroupConfigFromPanel(gid, state);

        if (getCurrentGroupId() !== String(gid)) {
            state.manualPending = gid;
            saveState(state);
            setGlobalStatus('Przełączam widok na grupę...');
            window.location.href = buildGroupUrl(gid);
            return;
        }

        await executeSendForGroup(gid, state);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  AUTO-ROTACJA
    // ═══════════════════════════════════════════════════════════════════════════

    let autoRunning = false;

    function toggleAuto() {
        const state = loadState();
        saveAllPanelConfigs(state);
        state.autoEnabled = !state.autoEnabled;
        saveState(state);

        const btn = document.getElementById('msaBtnAuto');
        if (state.autoEnabled) {
            btn.textContent = 'Auto-rotacja: ON';
            btn.classList.add('btn-on');
            autoRunning = true;
            autoStep();
        } else {
            btn.textContent = 'Auto-rotacja: OFF';
            btn.classList.remove('btn-on');
            autoRunning = false;
            setGlobalStatus('Auto-rotacja wyłączona');
        }
    }

    async function autoStep() {
        const state = loadState();
        if (!state.autoEnabled) { autoRunning = false; return; }

        const active = Object.keys(state.groups).filter((gid) => state.groups[gid].inRotation);
        if (!active.length) {
            setGlobalStatus('Auto-rotacja: brak grup zaznaczonych jako aktywne');
            return;
        }

        const now = Math.floor(Date.now() / 1000);
        let due = null, dueTs = Infinity, nextFuture = Infinity;

        for (const gid of active) {
            const ts = (state.schedule || {})[gid] || 0;
            if (ts <= now) {
                if (ts < dueTs) { due = gid; dueTs = ts; }
            } else if (ts < nextFuture) {
                nextFuture = ts;
            }
        }

        if (due === null) {
            setGlobalStatus('Auto: czekam na najbliższą grupę w kolejce');
            const targetTs = nextFuture === Infinity ? (now + 120) : nextFuture;
            const sleepUntil = Date.now() + Math.max(targetTs * 1000 - Date.now(), 5000);

            while (autoRunning && Date.now() < sleepUntil) {
                await delay(Math.min(30000, sleepUntil - Date.now()));
                const s2 = loadState();
                if (!s2.autoEnabled) { autoRunning = false; return; }
            }
            if (!autoRunning) return;
            window.location.reload();
            return;
        }

        if (getCurrentGroupId() !== String(due)) {
            setGlobalStatus(`Przełączam widok na grupę: ${state.groups[due]?.name || due}`);
            window.location.href = buildGroupUrl(due);
            return;
        }

        await executeSendForGroup(due, state);
        await delay(500);
        window.location.reload();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  START
    // ═══════════════════════════════════════════════════════════════════════════

    async function init() {
        injectStyles();

        let state = loadState();
        migrateOldConfig(state);

        const apiGroups = await fetchGroupsList();
        ensureGroupsInState(state, apiGroups);
        saveState(state);

        renderPanel(state);

        await delay(PAGE_LOAD_DELAY);

        const villages = await getVillagesData();
        if (villages.length > 0) {
            setGlobalStatus(`OK — wiosek w tym widoku: ${villages.length}`);
        } else {
            setGlobalStatus('⚠ Nie można odczytać danych wiosek');
        }

        // Jednorazowa wysyłka ręczna, jeśli czekała na przełączenie grupy
        if (state.manualPending && String(state.manualPending) === getCurrentGroupId()) {
            const gid = state.manualPending;
            state.manualPending = null;
            saveState(state);
            await executeSendForGroup(gid, state);
        }

        if (state.autoEnabled) {
            autoRunning = true;
            autoStep();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init());
    } else {
        init();
    }

})();
