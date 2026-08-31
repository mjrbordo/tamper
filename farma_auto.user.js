// ==UserScript==
// @name         Auto Farm V3
// @namespace    http://tampermonkey.net/
// @version      3.1.2
// @description  Automatyczne farmienie w Plemionach — szablon wg wyniku ostatniego ataku, rotacja po zapamiętanych wioskach grupy BEZ zmiany aktywnej grupy w grze, stop przy braku wojska
// @updateURL    https://raw.githubusercontent.com/mjrbordo/tamper/main/farma_auto.user.js
// @downloadURL  https://raw.githubusercontent.com/mjrbordo/tamper/main/farma_auto.user.js
// @author       Bordo
// @match        https://*.plemiona.pl/*screen=am_farm*
// @match        https://*.tribalwars.net/*screen=am_farm*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    //  KONFIGURACJA (domyślne — nadpisywane z UI/localStorage)
    // ═══════════════════════════════════════════════════════════════════════════

    const CONFIG = {
        templateOnFull: 'A',
        templateOnNotFull: 'B',
        groupId: '0',
        minInterval: 200,
        randomExtra: 200,
        pageLoadDelay: 2000,
        villageSwitchDelay: 1500,
        minReloadMin: 15,
        maxReloadMin: 50,
    };

    const STORAGE_KEY = 'autoFarmTW';

    // ═══════════════════════════════════════════════════════════════════════════
    //  STAN
    // ═══════════════════════════════════════════════════════════════════════════

    function loadState() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
        catch { return {}; }
    }
    function saveState(s) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
    function patchState(patch) { const s = loadState(); Object.assign(s, patch); saveState(s); return s; }

    // ═══════════════════════════════════════════════════════════════════════════
    //  GRUPY / WIOSKI — z jawnym pilnowaniem aktywnej grupy
    //
    //  KLUCZOWE: każdy request z &group=ID PRZESTAWIA aktywną grupę w grze
    //  (potwierdzone na plc1). Dlatego:
    //   - listę wiosek grupy pobieramy RAZ i cache'ujemy w localStorage,
    //   - po każdym takim pobraniu PRZYWRACAMY group=0,
    //   - rotacja NIE odpytuje już group=ID — czyta wyłącznie cache.
    // ═══════════════════════════════════════════════════════════════════════════

    function activeGroupId() {
        return String((window.game_data && window.game_data.group_id) || '0');
    }

    // Przestawia aktywną grupę w grze z powrotem na 0 (Wszystkie).
    // Wywoływane po każdym pobraniu wiosek grupy, żeby nic nie zostało zaznaczone.
    async function resetActiveGroup() {
        try {
            await fetch('/game.php?screen=overview_villages&mode=combined&group=0', { credentials: 'same-origin' });
        } catch (e) { console.error('[AutoFarm] resetActiveGroup error:', e); }
    }

    // Lista grup: [{id, name}].
    // Podstawowe źródło: endpoint AJAX gry (load_group_menu) — zwraca JSON.
    // Fallback: stary HTML <select id="group_id"> na starszych światach.
    // Żadne z tych źródeł nie przestawia aktywnej grupy w grze.
    async function fetchGroups() {
        const seen = new Set();
        const dedupe = (arr) => arr.filter(g => (seen.has(g.id) ? false : (seen.add(g.id), true)));

        // 1) Endpoint AJAX (nowe światy)
        try {
            const h = window.game_data && window.game_data.csrf;
            const url = `/game.php?screen=groups&ajax=load_group_menu${h ? `&h=${h}` : ''}`;
            const res = await fetch(url, {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest', 'TribalWars-Ajax': '1' }
            });
            const data = await res.json();
            const raw = (data && ((data.response && data.response.result) || data.result)) || [];
            const groups = raw
                .map(g => ({ id: String(g.group_id ?? (g.group && g.group.id) ?? ''), name: String(g.name || '').trim() }))
                .filter(g => g.id && g.id !== '0' && g.name);
            if (groups.length) return dedupe(groups);
        } catch (e) {
            console.warn('[AutoFarm] fetchGroups (ajax) nie zadziałał, próbuję HTML:', e);
        }

        // 2) Fallback: HTML <select id="group_id"> ze strony mode=groups
        try {
            const html = await (await fetch('/game.php?screen=overview_villages&mode=groups', { credentials: 'same-origin' })).text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const sel = doc.querySelector('select#group_id, select[name="group_id"]');
            if (sel) {
                const groups = [...sel.querySelectorAll('option')]
                    .map(o => ({ id: String(o.value).trim(), name: (o.textContent || '').trim() }))
                    .filter(g => g.id && g.id !== '0' && g.name && /^\d+$/.test(g.id));
                if (groups.length) return dedupe(groups);
            }
        } catch (e) {
            console.error('[AutoFarm] fetchGroups (html) error:', e);
        }

        return [];
    }

    // Pobiera wioski grupy JEDEN RAZ i od razu przywraca group=0.
    // group '0' → wszystkie wioski (i tak nie zmienia stanu na nic wybranego).
    async function fetchGroupVillagesOnce(groupId) {
        const gid = String(groupId || '0');
        const url = `/game.php?screen=overview_villages&mode=combined&group=${gid}`;
        let ids = [];
        try {
            const html = await (await fetch(url, { credentials: 'same-origin' })).text();
            const seen = new Set();
            for (const m of html.matchAll(/village=(\d+)/g)) {
                if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
            }
        } catch (e) {
            console.error('[AutoFarm] fetchGroupVillagesOnce error:', e);
        }
        // Zawsze wracamy do grupy 0, żeby w grze nic nie było zaznaczone.
        if (gid !== '0') await resetActiveGroup();
        return ids;
    }

    // Zwraca listę wiosek dla wybranej grupy z CACHE.
    // Jeśli cache pusty lub dla innej grupy — pobiera raz i zapisuje.
    async function getGroupVillages(groupId, forceRefresh = false) {
        const gid = String(groupId || '0');
        const st = loadState();
        if (!forceRefresh && st.groupVillagesFor === gid && Array.isArray(st.groupVillages) && st.groupVillages.length) {
            return st.groupVillages;
        }
        const ids = await fetchGroupVillagesOnce(gid);
        patchState({ groupVillages: ids, groupVillagesFor: gid });
        return ids;
    }

    function currentVillageId() {
        return String((window.game_data && window.game_data.village && window.game_data.village.id) || '');
    }

    // Skok do farmy danej wioski. NIE ustawiamy group w URL.
    function goToVillageFarm(villageId) {
        const u = new URL(window.location.href);
        u.searchParams.set('village', villageId);
        u.searchParams.set('screen', 'am_farm');
        u.searchParams.delete('group');
        u.searchParams.delete('Farm_page');
        window.location.href = u.toString();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  ANALIZA WIERSZA
    // ═══════════════════════════════════════════════════════════════════════════

    function analyzeRow(row) {
        const anyDisabled = row.querySelector('a.farm_icon_disabled');
        const lootIcon  = row.querySelector('td:nth-child(3) img');
        const lootTitle = lootIcon ? (lootIcon.getAttribute('data-title') || '') : '';
        const isFullHaul = !lootTitle.includes('Częściowy') && !lootTitle.includes('zrabowali wszystko');
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

    function chooseButton(analysis, cfg) {
        if (analysis.inProgress) return null;
        const template = analysis.isFullHaul ? cfg.templateOnFull : cfg.templateOnNotFull;
        if (!template) return null;
        if (template === 'A') return analysis.btnA;
        if (template === 'B') return analysis.btnB;
        return null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  DETEKCJA BRAKU WOJSKA
    // ═══════════════════════════════════════════════════════════════════════════

    function outOfTroops() {
        const err = document.querySelector('.error_box, #error_box, .autoHideBox.error, .notification.error');
        if (err && /jednost|wojsk|surowc|not enough|troops|resources/i.test(err.textContent)) return true;
        const anyRow    = document.querySelector('tr[id^="village_"]');
        const anyActive = document.querySelector(
            'a.farm_icon_a:not(.farm_icon_disabled), a.farm_icon_b:not(.farm_icon_disabled)'
        );
        return !!anyRow && !anyActive;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  GŁÓWNA PĘTLA FARMIENIA
    // ═══════════════════════════════════════════════════════════════════════════

    async function runFarm(cfg) {
        const rows = Array.from(document.querySelectorAll('tr[id^="village_"]'));
        if (rows.length === 0) {
            setStatus('Brak celów na liście');
            return { sent: 0, skipped: 0, disabled: 0, outOfTroops: false };
        }
        if (outOfTroops()) {
            return { sent: 0, skipped: 0, disabled: 0, outOfTroops: true };
        }

        let sent = 0, skipped = 0, disabled = 0;
        const queue = [];
        for (const row of rows) {
            const info = analyzeRow(row);
            if (info.inProgress) { disabled++; continue; }
            const btn = chooseButton(info, cfg);
            if (!btn) { skipped++; continue; }
            if (btn.classList.contains('farm_icon_disabled')) { disabled++; continue; }
            queue.push({ btn });
        }

        setStatus(`Wysyłam ${queue.length} ataków...`);

        for (const { btn } of queue) {
            if (btn.classList.contains('farm_icon_disabled') || btn.classList.contains('start_locked')) {
                disabled++;
                continue;
            }
            btn.click();
            sent++;
            updateProgress(sent, queue.length);

            const waitMs = cfg.minInterval + Math.floor(Math.random() * cfg.randomExtra);
            await delay(waitMs);

            if (outOfTroops()) {
                setStatus('Brak wojska — zatrzymuję wysyłkę w tej wiosce');
                return { sent, skipped, disabled, outOfTroops: true };
            }
        }
        return { sent, skipped, disabled, outOfTroops: false };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  STYLE
    // ═══════════════════════════════════════════════════════════════════════════

    function injectStyles() {
        document.head.appendChild(Object.assign(document.createElement('style'), {
            textContent: `
            #afPanel {
                position: fixed; top: 60px; right: 12px; width: 214px;
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
                font-size: 11px; background: #fff; color: #333; width: 88px;
            }
            #afPanel select#af_group { width: 120px; }
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
            #afPanel .legend span { display: inline-block; width: 8px; height: 8px;
                border-radius: 50%; margin-right: 3px; vertical-align: middle; }
            #afPanel .full-dot { background: #4a8020; }
            #afPanel .notfull-dot { background: #c8a020; }
            #afPanel .hint { font-size: 9px; color: #8a6a3a; margin: 2px 0 0; line-height: 1.2; }
        `}));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  UI
    // ═══════════════════════════════════════════════════════════════════════════

    let GROUPS = [];

    async function createPanel() {
        const state = loadState();
        const cfg   = state.config || {};

        const templateOnFull    = cfg.templateOnFull    ?? CONFIG.templateOnFull;
        const templateOnNotFull = cfg.templateOnNotFull ?? CONFIG.templateOnNotFull;
        const savedGroupId      = String(cfg.groupId ?? CONFIG.groupId);
        const minInterval       = cfg.minInterval       ?? CONFIG.minInterval;
        const randomExtra       = cfg.randomExtra       ?? CONFIG.randomExtra;
        const minReloadMin      = cfg.minReloadMin      ?? CONFIG.minReloadMin;
        const maxReloadMin      = cfg.maxReloadMin      ?? CONFIG.maxReloadMin;
        const autoOn            = !!state.autoEnabled;

        const p = document.createElement('div');
        p.id = 'afPanel';
        p.innerHTML = '<h3>Auto Farm</h3>';

        addSec(p, 'Grupa wiosek:');
        const rowGroup = document.createElement('div');
        rowGroup.className = 'row';
        rowGroup.innerHTML = `
            <span title="Skrypt zapamięta wioski tej grupy i rotuje tylko po nich. Nie zaznacza grupy w grze.">Grupa</span>
            <select id="af_group"><option value="0">— ładowanie… —</option></select>`;
        p.appendChild(rowGroup);
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.id = 'af_group_hint';
        hint.textContent = '';
        p.appendChild(hint);

        addSec(p, 'Reguły wysyłania:');
        const rowFull = document.createElement('div');
        rowFull.className = 'row';
        rowFull.innerHTML = `
            <span title="Atak wrócił pełny (pojemność wojsk była limitem)">
                <span class="legend"><span class="full-dot"></span></span>Pełny łup
            </span>
            <select id="af_tpl_full">
                <option value="A" ${templateOnFull === 'A' ? 'selected' : ''}>Szablon A</option>
                <option value="B" ${templateOnFull === 'B' ? 'selected' : ''}>Szablon B</option>
                <option value=""  ${!templateOnFull ? 'selected' : ''}>Pomiń</option>
            </select>`;
        p.appendChild(rowFull);

        const rowNotFull = document.createElement('div');
        rowNotFull.className = 'row';
        rowNotFull.innerHTML = `
            <span title="Atak wrócił niepełny (wioska była pusta)">
                <span class="legend"><span class="notfull-dot"></span></span>Niepełny
            </span>
            <select id="af_tpl_notfull">
                <option value="A" ${templateOnNotFull === 'A' ? 'selected' : ''}>Szablon A</option>
                <option value="B" ${templateOnNotFull === 'B' ? 'selected' : ''}>Szablon B</option>
                <option value=""  ${!templateOnNotFull ? 'selected' : ''}>Pomiń</option>
            </select>`;
        p.appendChild(rowNotFull);

        addSec(p, 'Interwał (ms):');
        const rowInterval = document.createElement('div');
        rowInterval.className = 'row';
        rowInterval.innerHTML = `<span>Min</span>
            <input type="number" id="af_min_interval" min="200" max="9999" value="${minInterval}">`;
        p.appendChild(rowInterval);

        const rowRandom = document.createElement('div');
        rowRandom.className = 'row';
        rowRandom.innerHTML = `<span>+Losowy max</span>
            <input type="number" id="af_random_extra" min="0" max="9999" value="${randomExtra}">`;
        p.appendChild(rowRandom);

        addSec(p, 'Auto-restart cyklu (min):');
        const rowReloadMin = document.createElement('div');
        rowReloadMin.className = 'row';
        rowReloadMin.innerHTML = `<span>Od</span>
            <input type="number" id="af_reload_min" min="1" max="999" value="${minReloadMin}">`;
        p.appendChild(rowReloadMin);

        const rowReloadMax = document.createElement('div');
        rowReloadMax.className = 'row';
        rowReloadMax.innerHTML = `<span>Do</span>
            <input type="number" id="af_reload_max" min="1" max="999" value="${maxReloadMin}">`;
        p.appendChild(rowReloadMax);

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

        // Zaczytaj grupy do dropdownu
        GROUPS = await fetchGroups();
        const sel = document.getElementById('af_group');
        if (sel) {
            const opts = ['<option value="0">Wszystkie wioski</option>']
                .concat(GROUPS.map(g => `<option value="${g.id}" ${g.id === savedGroupId ? 'selected' : ''}>${g.name}</option>`));
            sel.innerHTML = opts.join('');
            sel.value = savedGroupId;

            // Zmiana grupy → pobierz i zapamiętaj listę wiosek RAZ, przywróć group=0
            sel.addEventListener('change', async () => {
                const gid = sel.value || '0';
                setGroupHint('pobieram wioski grupy...');
                patchState({ config: { ...(loadState().config || {}), groupId: gid } });
                const ids = await getGroupVillages(gid, true); // force refresh przy ręcznej zmianie
                setGroupHint(`zapamiętano ${ids.length} wiosek`);
            });

            // Pokaż stan cache dla zapisanej grupy
            const st = loadState();
            if (st.groupVillagesFor === savedGroupId && Array.isArray(st.groupVillages)) {
                setGroupHint(`zapamiętano ${st.groupVillages.length} wiosek`);
            }
        }
    }

    function setGroupHint(txt) {
        const el = document.getElementById('af_group_hint');
        if (el) el.textContent = txt;
    }

    function addSec(parent, text) {
        parent.appendChild(Object.assign(document.createElement('div'), { className: 'sec', textContent: text }));
    }
    function setStatus(msg) { const el = document.getElementById('afStatus'); if (el) el.textContent = msg; }
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
        const groupId    = document.getElementById('af_group')?.value || '0';
        const minInt     = Math.max(200, parseInt(document.getElementById('af_min_interval')?.value) || 200);
        const randExtra  = Math.max(0,   parseInt(document.getElementById('af_random_extra')?.value)  || 200);
        const reloadMin  = Math.max(1, parseInt(document.getElementById('af_reload_min')?.value) || CONFIG.minReloadMin);
        const reloadMax  = Math.max(reloadMin, parseInt(document.getElementById('af_reload_max')?.value) || CONFIG.maxReloadMin);

        const cfg = {
            templateOnFull:    tplFull    || null,
            templateOnNotFull: tplNotFull || null,
            groupId,
            minInterval:  minInt,
            randomExtra:  randExtra,
            minReloadMin: reloadMin,
            maxReloadMin: reloadMax,
            villageSwitchDelay: CONFIG.villageSwitchDelay,
        };
        patchState({ config: cfg });
        return cfg;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  AKCJE / ROTACJA — czyta wyłącznie cache listy wiosek
    // ═══════════════════════════════════════════════════════════════════════════

    let running = false;
    let autoTimer = null;

    async function advanceAfterFarm(cfg, result, isAuto) {
        // 1) Jest wojsko i kolejna strona farmy → przejdź na nią
        const nextUrl = findNextPageUrl();
        if (!result.outOfTroops && result.sent > 0 && nextUrl) {
            patchState({ continuingRun: true });
            setStatus(`Wysłano ${result.sent} | następna strona...`);
            autoTimer = setTimeout(() => { window.location.href = nextUrl; }, 1000);
            return;
        }

        // 2) Brak wojska LUB koniec stron → następna wioska z ZAPAMIĘTANEJ listy grupy
        const villages = await getGroupVillages(cfg.groupId); // z cache, bez przestawiania grupy
        const curId    = currentVillageId();

        if (villages.length === 0) {
            patchState({ continuingRun: false });
            setStatus('Brak zapamiętanych wiosek grupy. Wybierz grupę w panelu.');
            enableButtons();
            return;
        }

        let idx = villages.indexOf(curId);
        const next = (idx === -1) ? villages[0] : (villages[idx + 1] || null);

        if (next && next !== curId) {
            patchState({ continuingRun: true });
            const reason = result.outOfTroops ? 'brak wojska' : 'koniec celów';
            const pos = (idx === -1 ? 1 : idx + 2);
            setStatus(`${reason} — wioska ${pos}/${villages.length}...`);
            autoTimer = setTimeout(() => goToVillageFarm(next), cfg.villageSwitchDelay);
            return;
        }

        // 3) Ostatnia wioska w grupie (idx to ostatni indeks, next === null)
        if (!isAuto) {
            patchState({ continuingRun: false });
            setStatus(`Cykl grupy zakończony (${villages.length} wiosek).`);
            enableButtons();
            return;
        }

        // Auto — odczekaj losowy czas i wróć do pierwszej wioski grupy.
        const first  = villages[0];
        const minMs  = cfg.minReloadMin * 60 * 1000;
        const maxMs  = cfg.maxReloadMin * 60 * 1000;
        const waitMs = minMs + Math.floor(Math.random() * Math.max(0, maxMs - minMs));
        const reloadAt = Date.now() + waitMs;

        patchState({ reloadAt, restartVillage: first, continuingRun: false });
        setStatus(`Grupa przejrzana | restart o ${msToTime(reloadAt)}`);
        autoTimer = setTimeout(() => {
            patchState({ reloadAt: 0 });
            if (first && first !== currentVillageId()) goToVillageFarm(first);
            else scheduleNextRun();
        }, waitMs);
    }

    function enableButtons() {
        const a = document.getElementById('afBtnOnce'); if (a) a.disabled = false;
        const b = document.getElementById('afBtnAuto'); if (b) b.disabled = false;
    }

    async function runOnce() {
        if (running) return;
        running = true;
        const btnOnce = document.getElementById('afBtnOnce');
        const btnAuto = document.getElementById('afBtnAuto');
        if (btnOnce) btnOnce.disabled = true;
        if (btnAuto) btnAuto.disabled = true;

        updateProgress(0, 1);
        const cfg = readConfig();
        // Upewnij się, że mamy zapamiętaną listę wiosek grupy (pobierze raz jeśli trzeba)
        await getGroupVillages(cfg.groupId);
        const result = await runFarm(cfg);
        updateProgress(1, 1);
        running = false;

        await advanceAfterFarm(cfg, result, false);
    }

    function toggleAuto() {
        const state = loadState();
        const enabling = !state.autoEnabled;
        patchState({ autoEnabled: enabling });

        const btn = document.getElementById('afBtnAuto');
        if (enabling) {
            btn.textContent = 'Auto: ON';
            btn.classList.add('btn-on');
            scheduleNextRun();
        } else {
            btn.textContent = 'Auto: OFF';
            btn.classList.remove('btn-on');
            if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
            patchState({ reloadAt: 0, continuingRun: false });
            setStatus('Auto wyłączone');
        }
    }

    async function scheduleNextRun() {
        const state = loadState();
        if (!state.autoEnabled || running) return;
        running = true;
        const btnOnce = document.getElementById('afBtnOnce');
        if (btnOnce) btnOnce.disabled = true;

        updateProgress(0, 1);
        const cfg = readConfig();
        await getGroupVillages(cfg.groupId);
        const result = await runFarm(cfg);
        updateProgress(1, 1);
        running = false;
        if (btnOnce) btnOnce.disabled = false;

        await advanceAfterFarm(cfg, result, true);
    }

    function msToTime(ts) {
        const d = new Date(ts);
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    }

    function findNextPageUrl() {
        const items = Array.from(document.querySelectorAll('.paged-nav-item'));
        const currentIdx = items.findIndex(el => el.tagName === 'STRONG');
        if (currentIdx === -1) return null;
        const next = items[currentIdx + 1];
        return (next && next.tagName === 'A') ? next.href : null;
    }

    function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ═══════════════════════════════════════════════════════════════════════════
    //  START
    // ═══════════════════════════════════════════════════════════════════════════

    async function init() {
        injectStyles();
        await createPanel();

        // Sprzątanie po starszych wersjach: jeśli w grze jest zaznaczona jakaś grupa,
        // przywróć 0 (Wszystkie), żeby interfejs nie został z wymuszoną grupą.
        if (activeGroupId() !== '0') {
            await resetActiveGroup();
        }

        await delay(CONFIG.pageLoadDelay);

        const rows = document.querySelectorAll('tr[id^="village_"]');
        setStatus(`Celów na liście: ${rows.length}`);

        const state = loadState();

        if (state.autoEnabled) {
            if (state.reloadAt && Date.now() < state.reloadAt) {
                const wait = state.reloadAt - Date.now();
                setStatus(`Auto: czekam do ${msToTime(state.reloadAt)}`);
                autoTimer = setTimeout(() => { patchState({ reloadAt: 0 }); scheduleNextRun(); }, wait);
            } else {
                patchState({ reloadAt: 0 });
                scheduleNextRun();
            }
        } else if (state.continuingRun) {
            patchState({ continuingRun: false });
            runOnce();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, CONFIG.pageLoadDelay));
    } else {
        setTimeout(init, CONFIG.pageLoadDelay);
    }

})();
