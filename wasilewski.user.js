// ==UserScript==
// @name        WASILEWSKI
// @namespace   http://tampermonkey.net/
// @version     1.7.3
// @description Auto Builder + Szablon Eko + Import MK + Nagrody + Smart Wait
// @author      ricardofauch
// @match       https://*.plemiona.pl/game.php*screen=main*
// @match       https://*.tribalwars.co.uk/game.php*screen=main*
// @updateURL    https://cdn.jsdelivr.net/gh/mjrbordo/tamper@main/wasilewski.js
// @downloadURL  https://cdn.jsdelivr.net/gh/mjrbordo/tamper@main/wasilewski.js
// @license     MIT
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = true;
    function getStorageKey() {
    const match = window.location.search.match(/[?&]village=(\d+)/);
    const villageId = match ? match[1] : 'unknown';
    return `tribalWarsBuilderConfig_v${villageId}`;
}
const STORAGE_KEY = getStorageKey();
    const FALLBACK_INTERVAL = 30 * 60 * 1000;

    // =====================================================================
    // MAPOWANIE ID BUDYNKÓW MK -> ID Plemion
    // =====================================================================
    const MK_BUILDING_MAP = {
        1:  'main',
        2:  'barracks',
        3:  'stable',
        4:  'garage',
        5:  'church',
        6:  'church_f',
        7:  'smith',
        8:  'place',
        9:  'statue',
        10: 'market',
        11: 'wood',
        12: 'stone',
        13: 'iron',
        14: 'farm',
        15: 'storage',
        16: 'hide',
        17: 'wall',
        18: 'snob',
        19: 'watchtower'
    };

    const BUILDING_NAMES_PL = {
        wood: 'Tartak', stone: 'Cegielnia', iron: 'Huta żelaza',
        main: 'Ratusz', storage: 'Spichlerz', farm: 'Zagroda',
        barracks: 'Koszary', market: 'Rynek', wall: 'Mur',
        smith: 'Kuźnia', place: 'Plac', statue: 'Posąg',
        garage: 'Garaż', snob: 'Szlachcic', church: 'Kościół',
        stable: 'Stajnia', hide: 'Schowek', watchtower: 'Wieża strażnicza'
    };

    // =====================================================================
    // DEKODOWANIE SZABLONU MK (base64 binary)
    // =====================================================================
    function decodeMKTemplate(base64String) {
        try {
            const binaryString = atob(base64String.trim());
            const steps = [];
            for (let i = 0; i + 1 < binaryString.length; i += 2) {
                const buildingId  = binaryString.charCodeAt(i);
                const targetLevel = binaryString.charCodeAt(i + 1);
                const buildingName = MK_BUILDING_MAP[buildingId];
                if (!buildingName) { debugLog(`Nieznane ID MK: ${buildingId}`); continue; }
                if (targetLevel < 1 || targetLevel > 30) { debugLog(`Nieprawidłowy poziom ${targetLevel}`); continue; }
                steps.push({ building: buildingName, targetLevel });
            }
            debugLog(`Zdekodowano MK: ${steps.length} kroków`);
            return steps;
        } catch (e) {
            debugLog('Błąd dekodowania MK:', e);
            return null;
        }
    }

    function expandMKSteps(steps, currentLevels) {
        const expanded = [];
        const planned = { ...currentLevels };
        steps.forEach(step => {
            const from = planned[step.building] || 0;
            if (step.targetLevel > from) {
                for (let lvl = from + 1; lvl <= step.targetLevel; lvl++) {
                    expanded.push({ building: step.building, targetLevel: lvl });
                }
                planned[step.building] = step.targetLevel;
            }
        });
        return expanded;
    }

    // =====================================================================
    // PEŁNY SZABLON EKO (154 kroków)
    // =====================================================================
    const FULL_ECO_TEMPLATE = [
        { building: "wood", targetLevel: 1 },
        { building: "stone", targetLevel: 1 },
        { building: "iron", targetLevel: 1 },
        { building: "stone", targetLevel: 2 },
        { building: "wood", targetLevel: 2 },
        { building: "main", targetLevel: 2 },
        { building: "storage", targetLevel: 2 },
        { building: "iron", targetLevel: 2 },
        { building: "main", targetLevel: 3 },
        { building: "wood", targetLevel: 3 },
        { building: "main", targetLevel: 4 },
        { building: "storage", targetLevel: 3 },
        { building: "iron", targetLevel: 3 },
        { building: "stone", targetLevel: 3 },
        { building: "iron", targetLevel: 4 },
        { building: "wood", targetLevel: 4 },
        { building: "stone", targetLevel: 4 },
        { building: "wood", targetLevel: 5 },
        { building: "wood", targetLevel: 6 },
        { building: "stone", targetLevel: 5 },
        { building: "iron", targetLevel: 5 },
        { building: "wood", targetLevel: 7 },
        { building: "stone", targetLevel: 6 },
        { building: "stone", targetLevel: 7 },
        { building: "wood", targetLevel: 8 },
        { building: "stone", targetLevel: 8 },
        { building: "wood", targetLevel: 9 },
        { building: "stone", targetLevel: 9 },
        { building: "stone", targetLevel: 10 },
        { building: "farm", targetLevel: 2 },
        { building: "barracks", targetLevel: 1 },
        { building: "market", targetLevel: 1 },
        { building: "wall", targetLevel: 1 },
        { building: "wall", targetLevel: 2 },
        { building: "stone", targetLevel: 11 },
        { building: "farm", targetLevel: 3 },
        { building: "wood", targetLevel: 10 },
        { building: "iron", targetLevel: 6 },
        { building: "wall", targetLevel: 3 },
        { building: "iron", targetLevel: 7 },
        { building: "storage", targetLevel: 4 },
        { building: "farm", targetLevel: 4 },
        { building: "farm", targetLevel: 5 },
        { building: "iron", targetLevel: 8 },
        { building: "storage", targetLevel: 5 },
        { building: "wood", targetLevel: 11 },
        { building: "wood", targetLevel: 12 },
        { building: "stone", targetLevel: 12 },
        { building: "iron", targetLevel: 9 },
        { building: "wood", targetLevel: 13 },
        { building: "stone", targetLevel: 13 },
        { building: "wall", targetLevel: 4 },
        { building: "iron", targetLevel: 10 },
        { building: "market", targetLevel: 2 },
        { building: "stone", targetLevel: 14 },
        { building: "wood", targetLevel: 14 },
        { building: "iron", targetLevel: 11 },
        { building: "stone", targetLevel: 15 },
        { building: "wood", targetLevel: 15 },
        { building: "storage", targetLevel: 6 },
        { building: "stone", targetLevel: 16 },
        { building: "iron", targetLevel: 12 },
        { building: "wood", targetLevel: 16 },
        { building: "iron", targetLevel: 13 },
        { building: "storage", targetLevel: 7 },
        { building: "wood", targetLevel: 17 },
        { building: "stone", targetLevel: 17 },
        { building: "main", targetLevel: 5 },
        { building: "storage", targetLevel: 8 },
        { building: "stone", targetLevel: 18 },
        { building: "iron", targetLevel: 14 },
        { building: "market", targetLevel: 3 },
        { building: "farm", targetLevel: 6 },
        { building: "market", targetLevel: 4 },
        { building: "main", targetLevel: 6 },
        { building: "farm", targetLevel: 7 },
        { building: "main", targetLevel: 7 },
        { building: "wall", targetLevel: 5 },
        { building: "market", targetLevel: 5 },
        { building: "wood", targetLevel: 18 },
        { building: "iron", targetLevel: 15 },
        { building: "storage", targetLevel: 9 },
        { building: "stone", targetLevel: 19 },
        { building: "wood", targetLevel: 19 },
        { building: "storage", targetLevel: 10 },
        { building: "stone", targetLevel: 20 },
        { building: "main", targetLevel: 8 },
        { building: "wood", targetLevel: 20 },
        { building: "iron", targetLevel: 16 },
        { building: "storage", targetLevel: 11 },
        { building: "iron", targetLevel: 17 },
        { building: "stone", targetLevel: 21 },
        { building: "main", targetLevel: 9 },
        { building: "main", targetLevel: 10 },
        { building: "wood", targetLevel: 21 },
        { building: "storage", targetLevel: 12 },
        { building: "farm", targetLevel: 8 },
        { building: "farm", targetLevel: 9 },
        { building: "storage", targetLevel: 13 },
        { building: "stone", targetLevel: 22 },
        { building: "wood", targetLevel: 22 },
        { building: "iron", targetLevel: 18 },
        { building: "storage", targetLevel: 14 },
        { building: "stone", targetLevel: 23 },
        { building: "wood", targetLevel: 23 },
        { building: "storage", targetLevel: 15 },
        { building: "stone", targetLevel: 24 },
        { building: "iron", targetLevel: 19 },
        { building: "wood", targetLevel: 24 },
        { building: "storage", targetLevel: 16 },
        { building: "stone", targetLevel: 25 },
        { building: "iron", targetLevel: 20 },
        { building: "wood", targetLevel: 25 },
        { building: "main", targetLevel: 11 },
        { building: "storage", targetLevel: 17 },
        { building: "stone", targetLevel: 26 },
        { building: "iron", targetLevel: 21 },
        { building: "main", targetLevel: 12 },
        { building: "wood", targetLevel: 26 },
        { building: "storage", targetLevel: 18 },
        { building: "stone", targetLevel: 27 },
        { building: "main", targetLevel: 13 },
        { building: "main", targetLevel: 14 },
        { building: "wood", targetLevel: 27 },
        { building: "storage", targetLevel: 19 },
        { building: "storage", targetLevel: 20 },
        { building: "stone", targetLevel: 28 },
        { building: "iron", targetLevel: 22 },
        { building: "main", targetLevel: 15 },
        { building: "farm", targetLevel: 10 },
        { building: "wood", targetLevel: 28 },
        { building: "farm", targetLevel: 11 },
        { building: "farm", targetLevel: 12 },
        { building: "storage", targetLevel: 21 },
        { building: "stone", targetLevel: 29 },
        { building: "main", targetLevel: 16 },
        { building: "iron", targetLevel: 23 },
        { building: "iron", targetLevel: 24 },
        { building: "main", targetLevel: 17 },
        { building: "main", targetLevel: 18 },
        { building: "farm", targetLevel: 13 },
        { building: "storage", targetLevel: 22 },
        { building: "storage", targetLevel: 23 },
        { building: "stone", targetLevel: 30 },
        { building: "main", targetLevel: 19 },
        { building: "iron", targetLevel: 25 },
        { building: "iron", targetLevel: 26 },
        { building: "iron", targetLevel: 27 },
        { building: "wood", targetLevel: 29 },
        { building: "iron", targetLevel: 28 },
        { building: "iron", targetLevel: 29 },
        { building: "storage", targetLevel: 24 },
        { building: "iron", targetLevel: 30 },
        { building: "wood", targetLevel: 30 }
    ];

    // =====================================================================
    // REWARD CLAIMING — tylko pomocnicze funkcje, bez własnej logiki decyzji
    // =====================================================================
    function getBuildQueueCount() {
        let count = 0;
        for (let i = 0; i <= 4; i++) {
            const el = document.querySelector(`#buildqueue #buildorder_${i}`);
            if (el && el.textContent.trim().length > 10) count++;
        }
        return count;
    }

    function claimRewardInDialog() {
        const btn = document.querySelector('a.reward-system-claim-button');
        if (btn) { debugLog('Klikam Odbierz...'); btn.click(); return true; }
        return false;
    }

    /**
     * Sprawdza czy jest dostępna nagroda do odebrania.
     * NIE podejmuje żadnych decyzji o tym, czy odbierać — tylko wykrywa.
     */
    function isRewardAvailable() {
        if (document.querySelector('a.reward-system-claim-button')) return true;
        if (document.querySelector('#new_quest')) return true;
        return false;
    }

    /**
     * Próbuje odebrać nagrodę. Wywołuj TYLKO gdy podjęto już decyzję,
     * że nagroda jest potrzebna (tj. kolejka pusta i brakuje surowców).
     * Zwraca true jeśli zainicjowano odbieranie, false jeśli brak nagrody.
     * Po odebraniu wywołuje callback (np. checkAndBuild lub reload).
     */
    function tryClaimReward(afterClaimCallback) {
        debugLog('Próba odebrania nagrody (brak surowców)...');

        // Przycisk Odbierz już widoczny w dialogu
        if (claimRewardInDialog()) {
            setTimeout(() => {
                if (afterClaimCallback) afterClaimCallback();
                else window.location.reload();
            }, 1500);
            return true;
        }

        // Ikona nowego questa — kliknij, poczekaj na dialog, odbierz
        const newQuestEl = document.querySelector('#new_quest');
        if (newQuestEl) {
            debugLog('Nowy quest, otwieram dialog...');
            newQuestEl.click();
            setTimeout(() => {
                if (claimRewardInDialog()) {
                    setTimeout(() => {
                        if (afterClaimCallback) afterClaimCallback();
                        else window.location.reload();
                    }, 1500);
                } else {
                    // Drugi strzał po kolejnym opóźnieniu
                    setTimeout(() => {
                        if (claimRewardInDialog()) {
                            setTimeout(() => {
                                if (afterClaimCallback) afterClaimCallback();
                                else window.location.reload();
                            }, 1500);
                        } else {
                            debugLog('Nie udało się odebrać nagrody z dialogu');
                            if (afterClaimCallback) afterClaimCallback();
                        }
                    }, 1000);
                }
            }, 800);
            return true;
        }

        return false;
    }

    // =====================================================================
    // BUILDING DETECTION
    // =====================================================================
    function getAvailableBuildings() {
        const buildings = [];
        document.querySelectorAll('#buildings tbody tr[id^="main_buildrow_"]').forEach(row => {
            const cell = row.querySelector('td:first-child');
            if (!cell) return;
            const id = row.id.replace('main_buildrow_', '');
            if (!id) return;
            const nameLink = cell.querySelectorAll('a')[1];
            if (!nameLink) return;
            const inactive = row.querySelector('td.inactive');
            if (inactive && inactive.textContent.includes('vollständig ausgebaut')) return;
            const lvlSpan = cell.querySelector('span[style="font-size: 0.9em"]');
            buildings.push({
                id,
                name: nameLink.textContent.trim(),
                currentLevel: lvlSpan ? lvlSpan.textContent.trim() : '0'
            });
        });
        return buildings;
    }

    function getCurrentLevels() {
        const levels = {};
        getAvailableBuildings().forEach(b => {
            levels[b.id] = parseInt(b.currentLevel.replace(/[^\d]/g, '')) || 0;
        });
        return levels;
    }

    // =====================================================================
    // SMART WAIT
    // =====================================================================
    function getWaitTimeForBuilding(buildingName) {
        try {
            const row = document.querySelector(`#main_buildrow_${buildingName}`);
            if (!row) return null;

            let text = '';

            row.querySelectorAll('.build_options .inactive, .build_options div.inactive').forEach(el => {
                const t = el.textContent.trim();
                if (t.toLowerCase().includes('available')) text = t;
            });

            if (!text) {
                const bcrBtn = row.querySelector('a.btn-bcr');
                if (bcrBtn) {
                    const title = bcrBtn.getAttribute('data-title') || '';
                    const match = title.match(/available\s+(today|tomorrow)\s+at\s+(\d{1,2}:\d{2})/i);
                    if (match) text = match[0];
                }
            }

            if (!text) return null;

            debugLog(`Wait text dla ${buildingName}: "${text}"`);

            const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
            if (!timeMatch) return null;

            const targetHour = parseInt(timeMatch[1]);
            const targetMin  = parseInt(timeMatch[2]);

            const now    = new Date();
            const target = new Date();
            target.setHours(targetHour, targetMin, 30, 0);

            if (text.toLowerCase().includes('tomorrow') || target <= now) {
                target.setDate(target.getDate() + 1);
            }

            const diffMs = target - now;
            debugLog(`Czekam ${Math.ceil(diffMs/60000)} min na surowce dla ${buildingName} (do ${targetHour}:${String(targetMin).padStart(2,'0')})`);
            return diffMs > 0 ? diffMs : null;
        } catch (e) {
            debugLog('Błąd getWaitTimeForBuilding:', e);
            return null;
        }
    }

    function setStatusMessage(msg, color) {
        const el = document.getElementById('builderStatus');
        if (el) { el.textContent = msg; el.style.color = color || '#333'; }
        debugLog('Status: ' + msg);
    }

    // =====================================================================
    // CONFIG
    // =====================================================================
    function loadConfig() {
        const def = {
            useCostReduction: false,
            useLongBuildReduction: false,
            longBuildThreshold: 2,
            buildSequence: []
        };
        try {
            const s = localStorage.getItem(STORAGE_KEY);
            return s ? { ...def, ...JSON.parse(s) } : def;
        } catch (e) { return def; }
    }

    function saveConfig(cfg) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (e) {}
    }

    function filterCompleted(steps) {
        const levels = getCurrentLevels();
        return steps.filter(s => {
            const l = levels[s.building];
            return l === undefined || l < s.targetLevel;
        });
    }

    // =====================================================================
    // BUILD LOGIC
    // =====================================================================
    function debugLog(msg, data = null) {
        if (!DEBUG) return;
        const ts = new Date().toLocaleTimeString();
        data ? console.log(`[${ts}] ${msg}`, data) : console.log(`[${ts}] ${msg}`);
    }

    function getBuildingLevel(name) {
        try {
            const row = document.querySelector(`#main_buildrow_${name}`);
            if (!row) return null;
            const btn = row.querySelector(`a.btn-build[id*="_${name}_"]`);
            if (!btn) return null;
            const next = parseInt(btn.getAttribute('data-level-next'));
            return isNaN(next) ? null : next - 1;
        } catch (e) { return null; }
    }

    function canBuildResource(name) {
        try {
            const row = document.querySelector(`#main_buildrow_${name}`);
            if (!row) return false;
            const btn = row.querySelector(`a.btn-build[id*="_${name}_"]`);
            if (!btn) return false;
            if (btn.style.display === 'none') return false;
            const href = btn.getAttribute('href');
            return href && href !== '#'
                && !btn.classList.contains('btn-disabled')
                && !btn.classList.contains('btn-bcr-disabled');
        } catch (e) { return false; }
    }

    function isConstructionInProgress() {
        return getBuildQueueCount() > 0;
    }

    function reduceLongBuilds() {
        try {
            const cfg = loadConfig();
            if (!cfg.useLongBuildReduction) return false;
            const thr = cfg.longBuildThreshold || 2;
            const rows = document.querySelectorAll('#buildqueue #buildorder_0, #buildqueue #buildorder_1');
            for (const row of rows) {
                const span = row.querySelector('.build_timer span[data-duration]');
                if (!span) continue;
                const secs = parseInt(span.getAttribute('data-duration'));
                if (!isNaN(secs) && secs / 3600 > thr) {
                    const btn = row.querySelector('a.order_feature.btn.btn-btr:not(.btn-instant)');
                    if (btn && !btn.classList.contains('btn-disabled')) { btn.click(); return true; }
                }
            }
        } catch (e) {}
        return false;
    }

    function buildResource(name) {
        try {
            const row = document.querySelector(`#main_buildrow_${name}`);
            if (!row) return false;
            const btn = row.querySelector(`a.btn-build[id*="_${name}_"]`);
            if (!btn || btn.classList.contains('btn-disabled') || btn.style.display === 'none') return false;
            const url = btn.getAttribute('href');
            if (!url || url === '#') return false;
            window.location.href = url;
            return true;
        } catch (e) { return false; }
    }

    function scheduleReload(ms, reason) {
        const min = Math.ceil(ms / 60000);
        setStatusMessage(`⏳ ${reason} — odświeżenie za ~${min} min`, '#a06000');
        debugLog(`Zaplanowano reload za ${min} min: ${reason}`);
        setTimeout(() => window.location.reload(), ms);
    }

    // =====================================================================
    // GŁÓWNA LOGIKA BUDOWANIA
    //
    // Kolejność decyzji:
    //   1. Redukcja długiej budowy (opcjonalna)
    //   2. Kolejka pełna → czekaj, NIE ruszaj nagród
    //   3. Można budować → buduj, NIE ruszaj nagród
    //   4. Nie można budować (brak surowców):
    //      4a. Jest nagroda → odbierz nagrodę → wróć do punktu 3
    //      4b. Brak nagrody → Smart Wait
    // =====================================================================
    function checkAndBuild() {
        debugLog('=== Cykl budowania ===');

        // Krok 1: redukcja długiej budowy
        if (reduceLongBuilds()) {
            debugLog('Redukcja długiej budowy zastosowana.');
            setTimeout(() => window.location.reload(), 3000);
            return;
        }

        try {
            // Krok 2: kolejka pełna → tylko czekaj, absolutnie nie odbieraj nagród
            if (isConstructionInProgress()) {
                debugLog('Budowa w toku — czekam na zakończenie (nagrody bez zmian)');
                setStatusMessage('🏗️ Budowa w toku, oczekiwanie...', '#555');
                const timerEl = document.querySelector('#buildqueue .build_timer span[data-duration]');
                if (timerEl) {
                    const secs = parseInt(timerEl.getAttribute('data-duration'));
                    if (!isNaN(secs) && secs > 0) {
                        scheduleReload((secs + 10) * 1000, 'Koniec budowy');
                        return;
                    }
                }
                scheduleReload(5 * 60 * 1000, 'Budowa w toku');
                return;
            }

            // Sprawdź czy mamy co budować
            const cfg = loadConfig();
            if (!cfg.buildSequence || cfg.buildSequence.length === 0) {
                debugLog('Brak kolejki budynków');
                setStatusMessage('✅ Kolejka pusta — brak zadań', '#5a9e5a');
                return;
            }

            const item = cfg.buildSequence[0];
            const lvl  = getBuildingLevel(item.building);
            const name = BUILDING_NAMES_PL[item.building] || item.building;

            debugLog(`Pierwszy w kolejce: ${item.building} → poz.${item.targetLevel} (obecny: ${lvl})`);

            // Budynek już na docelowym poziomie — usuń i sprawdź następny
            if (lvl !== null && lvl >= item.targetLevel) {
                cfg.buildSequence.shift();
                saveConfig(cfg);
                debugLog('Budynek już na docelowym poziomie, usuwam z kolejki');
                setTimeout(() => checkAndBuild(), 500);
                return;
            }

            if (lvl !== null && lvl < item.targetLevel) {

                // Krok 3: można budować → buduj od razu, nagrody ignorujemy
                if (canBuildResource(item.building)) {
                    setStatusMessage(`🔨 Buduję: ${name} → poz. ${item.targetLevel}`, '#2a6a2a');
                    buildResource(item.building);
                    return;
                }

                // Krok 4: nie można budować — brak surowców
                debugLog(`Brak surowców na ${name} poz.${item.targetLevel}`);

                // Krok 4a: jest nagroda → odbierz jako źródło surowców, potem wróć
                if (isRewardAvailable()) {
                    setStatusMessage(`🎁 Brak surowców na ${name} poz.${item.targetLevel} — próba odebrania nagrody`, '#5a6a9e');
                    const claimed = tryClaimReward(() => {
                        // Po odebraniu: wróć do głównej logiki (reload lub ponów)
                        window.location.reload();
                    });
                    if (claimed) return;
                }

                // Krok 4b: brak nagrody → Smart Wait
                const waitMs = getWaitTimeForBuilding(item.building);
                if (waitMs && waitMs > 0) {
                    const waitMin = Math.ceil(waitMs / 60000);
                    setStatusMessage(`💰 Brak surowców na ${name} poz.${item.targetLevel} — czekam ~${waitMin} min`, '#a06000');
                    scheduleReload(waitMs, `Brak surowców na ${name} poz.${item.targetLevel}`);
                } else {
                    setStatusMessage(`⚠️ Nie można odczytać czasu surowców dla ${name} — czekam 10 min`, '#c00');
                    scheduleReload(10 * 60 * 1000, `Nie można odczytać czasu dla ${name}`);
                }

            } else {
                // Nie można odczytać poziomu — pomiń ten krok
                debugLog(`Nie można odczytać poziomu ${item.building} — pomijam`);
                cfg.buildSequence.shift();
                saveConfig(cfg);
                setTimeout(() => checkAndBuild(), 500);
            }

        } catch (e) {
            debugLog('Błąd checkAndBuild:', e);
            scheduleReload(FALLBACK_INTERVAL, 'Błąd skryptu');
        }
    }

    // =====================================================================
    // UI
    // =====================================================================
    function createUI() {
        const config    = loadConfig();
        const buildings = getAvailableBuildings();

        const wrap = document.createElement('div');
        wrap.style.cssText = 'background:#f4e4bc;padding:15px;margin:10px 0;border:1px solid #603000;font-size:12px;';
        wrap.innerHTML = `
            <h3 style="margin:0 0 5px 0;font-size:14px;font-weight:bold;">Auto Builder Settings</h3>
            <div style="color:#666;font-style:italic;margin-bottom:10px;">Configure building sequence and automation settings</div>
            <div id="builderStatus" style="padding:6px 8px;background:#fff3d9;border:1px solid #c1a264;margin-bottom:12px;font-weight:bold;font-size:11px;">⏳ Inicjalizacja...</div>
        `;

        // --- USTAWIENIA ---
        const settings = document.createElement('div');
        settings.style.cssText = 'background:#fff3d9;padding:10px;border:1px solid #c1a264;margin-bottom:15px;';

        const costCb = mkCheckbox('cbCost', ' Use -20% cost reduction when available', config.useCostReduction);
        settings.appendChild(costCb.div);

        const longCb  = mkCheckbox('cbLong', ' Auto-reduce builds longer than', config.useLongBuildReduction);
        const longThr = document.createElement('input');
        longThr.type = 'number'; longThr.min = '0.5'; longThr.step = '0.5'; longThr.value = config.longBuildThreshold || 5;
        longThr.style.cssText = 'width:60px;padding:2px;margin:0 5px;background:#fff;border:1px solid #c1a264;';
        longCb.div.appendChild(longThr);
        longCb.div.appendChild(Object.assign(document.createElement('span'), { textContent: ' hours' }));
        settings.appendChild(longCb.div);

        // --- SZABLON EKO ---
        const ecoSec = makeSectionDiv('📋 Pełny Szablon Eko (154 kroki)',
            'Wczytuje kolejkę wg szablonu ekonomicznego. Ukończone kroki są automatycznie pomijane.');
        const ecoBtns = rowDiv();

        const btnLoadEco = makeBtn('▶ Wczytaj Szablon Eko', 'btn', 'background:#5a9e5a;color:white;font-weight:bold;');
        btnLoadEco.onclick = () => {
            if (!confirm('Zastąpić bieżącą kolejkę szablonem eko?')) return;
            const cfg = loadConfig();
            cfg.buildSequence = filterCompleted(FULL_ECO_TEMPLATE);
            saveConfig(cfg); refreshList();
            UI.SuccessMessage(`Szablon Eko wczytany! ${cfg.buildSequence.length} kroków.`);
        };

        const btnAppendEco = makeBtn('+ Dołącz Szablon Eko', 'btn btn-default');
        btnAppendEco.onclick = () => {
            if (!confirm('Dołączyć szablon eko do kolejki?')) return;
            const cfg = loadConfig();
            cfg.buildSequence = [...cfg.buildSequence, ...filterCompleted(FULL_ECO_TEMPLATE)];
            saveConfig(cfg); refreshList();
            UI.SuccessMessage('Dołączono kroki szablonu eko.');
        };

        ecoBtns.appendChild(btnLoadEco); ecoBtns.appendChild(btnAppendEco);
        ecoSec.appendChild(ecoBtns); settings.appendChild(ecoSec);

        // --- IMPORT MK ---
        const mkSec = makeSectionDiv('📥 Import Szablonu MK (base64)',
            'Wklej string base64 z MasterBuilder/MK. Skrypt automatycznie zdekoduje kroki.');

        const mkTA = document.createElement('textarea');
        mkTA.placeholder = 'Wklej tutaj string base64 z szablonu MK...';
        mkTA.style.cssText = 'width:100%;height:60px;padding:4px;border:1px solid #c1a264;background:#fff;font-size:11px;box-sizing:border-box;resize:vertical;margin-bottom:6px;';
        mkSec.appendChild(mkTA);

        const mkExpandCb = mkCheckbox('cbMkExpand', ' Rozwiń kroki (jeden krok = jeden poziom)', true);
        mkSec.appendChild(mkExpandCb.div);

        const mkPreview = document.createElement('div');
        mkPreview.style.cssText = 'font-size:11px;margin:4px 0 6px;min-height:16px;';
        mkSec.appendChild(mkPreview);

        mkTA.addEventListener('input', () => {
            const raw = mkTA.value.trim();
            if (!raw) { mkPreview.textContent = ''; return; }
            try {
                const d = decodeMKTemplate(raw);
                if (d && d.length > 0) {
                    mkPreview.style.color = '#5a9e5a';
                    mkPreview.textContent = `✓ Wykryto ${d.length} kroków w szablonie MK`;
                } else {
                    mkPreview.style.color = '#cc0000';
                    mkPreview.textContent = '✗ Nie można zdekodować – sprawdź string base64';
                }
            } catch { mkPreview.style.color = '#cc0000'; mkPreview.textContent = '✗ Błąd dekodowania'; }
        });

        function processMK(append) {
            const raw = mkTA.value.trim();
            if (!raw) { UI.ErrorMessage('Wklej string base64!'); return; }
            const decoded = decodeMKTemplate(raw);
            if (!decoded || decoded.length === 0) { UI.ErrorMessage('Błąd dekodowania MK.'); return; }
            let steps = mkExpandCb.cb.checked ? expandMKSteps(decoded, getCurrentLevels()) : decoded;
            steps = filterCompleted(steps);
            const action = append ? 'dołączyć' : 'zastąpić kolejkę przez';
            if (!confirm(`Zdekodowano ${decoded.length} kroków MK (${steps.length} pozostałych).\nCzy ${action} te kroki?`)) return;
            const cfg = loadConfig();
            cfg.buildSequence = append ? [...cfg.buildSequence, ...steps] : steps;
            saveConfig(cfg); refreshList();
            mkTA.value = ''; mkPreview.textContent = '';
            UI.SuccessMessage(`${append ? 'Dołączono' : 'Wczytano'} ${steps.length} kroków z MK.`);
        }

        const mkBtns = rowDiv();
        const btnLoadMK   = makeBtn('▶ Wczytaj szablon MK', 'btn', 'background:#4a7fc1;color:white;font-weight:bold;');
        const btnAppendMK = makeBtn('+ Dołącz szablon MK', 'btn btn-default');
        btnLoadMK.onclick   = () => processMK(false);
        btnAppendMK.onclick = () => processMK(true);
        mkBtns.appendChild(btnLoadMK); mkBtns.appendChild(btnAppendMK);
        mkSec.appendChild(mkBtns); settings.appendChild(mkSec);
        wrap.appendChild(settings);

        // --- SEQUENCE LIST ---
        const seqSection = document.createElement('div');
        const seqHeader  = document.createElement('div');
        seqHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;';
        seqHeader.innerHTML = '<div style="font-weight:bold;">Building Sequence</div>';

        const btnClear = makeBtn('Clear All', 'btn btn-default');
        btnClear.onclick = () => {
            const cfg = loadConfig(); cfg.buildSequence = []; saveConfig(cfg);
            refreshList(); UI.SuccessMessage('Sequence cleared');
        };
        seqHeader.appendChild(btnClear);
        seqSection.appendChild(seqHeader);

        const seqCount = document.createElement('div');
        seqCount.id = 'seqCountInfo';
        seqCount.style.cssText = 'font-size:11px;color:#666;margin-bottom:5px;';
        seqSection.appendChild(seqCount);

        const seqList = document.createElement('div');
        seqList.id = 'buildSequenceList';
        seqList.style.cssText = 'border:1px solid #c1a264;padding:10px;margin-bottom:10px;min-height:50px;max-height:400px;overflow-y:auto;background:#fff3d9;';
        seqSection.appendChild(seqList);

        // Dodaj ręcznie
        const addRow = document.createElement('div');
        addRow.style.cssText = 'display:flex;gap:10px;align-items:center;background:#fff3d9;padding:10px;border:1px solid #c1a264;';
        const bSel = document.createElement('select');
        bSel.style.cssText = 'flex:1;padding:2px;background:#fff;border:1px solid #c1a264;';
        bSel.appendChild(Object.assign(document.createElement('option'), { value: '', textContent: '-- Select Building --', disabled: true, selected: true }));
        buildings.forEach(b => {
            const o = document.createElement('option'); o.value = b.id; o.textContent = `${b.name} (${b.currentLevel})`; bSel.appendChild(o);
        });
        const lvlIn = document.createElement('input');
        lvlIn.type = 'number'; lvlIn.min = '1'; lvlIn.placeholder = 'Target lvl';
        lvlIn.style.cssText = 'width:80px;padding:2px;background:#fff;border:1px solid #c1a264;';
        const btnAdd = makeBtn('Add to Sequence', 'btn');
        btnAdd.onclick = () => {
            if (!bSel.value) { UI.ErrorMessage('Wybierz budynek'); return; }
            const b   = buildings.find(x => x.id === bSel.value);
            const cur = parseInt(b.currentLevel.replace(/[^\d]/g, '')) || 0;
            const tgt = parseInt(lvlIn.value);
            if (!tgt) { UI.ErrorMessage('Podaj poziom docelowy'); return; }
            if (tgt <= cur) { UI.ErrorMessage('Poziom musi być wyższy niż obecny'); return; }
            const cfg = loadConfig();
            cfg.buildSequence.push({ building: bSel.value, targetLevel: tgt });
            saveConfig(cfg); refreshList();
            lvlIn.value = ''; bSel.value = '';
        };
        addRow.appendChild(bSel); addRow.appendChild(lvlIn); addRow.appendChild(btnAdd);
        seqSection.appendChild(addRow);
        wrap.appendChild(seqSection);

        const btnSave = makeBtn('Save Settings', 'btn');
        btnSave.style.marginTop = '10px';
        btnSave.onclick = () => {
            const cfg = loadConfig();
            saveConfig({ ...cfg, useCostReduction: costCb.cb.checked, useLongBuildReduction: longCb.cb.checked, longBuildThreshold: parseFloat(longThr.value) || 2 });
            UI.SuccessMessage('Settings saved!');
        };
        wrap.appendChild(btnSave);

        const table = document.getElementById('buildings');
        if (table && table.parentElement) table.parentElement.insertBefore(wrap, table);

        // ---- REFRESH LIST ----
        function refreshList() {
            seqList.innerHTML = '';
            const cfg = loadConfig();
            if (!cfg.buildSequence || cfg.buildSequence.length === 0) {
                seqList.innerHTML = '<div style="color:#666;font-style:italic;text-align:center;">No buildings in sequence</div>';
                seqCount.textContent = '';
                return;
            }
            cfg.buildSequence.forEach((item, index) => {
                const b    = buildings.find(x => x.id === item.building);
                const name = b ? b.name : (BUILDING_NAMES_PL[item.building] || item.building);
                const el   = document.createElement('div');
                el.style.cssText = 'display:flex;gap:10px;margin-bottom:5px;align-items:center;background:#fff;padding:5px;border:1px solid #c1a264;';

                const txt = document.createElement('span'); txt.style.flex = '1';
                txt.textContent = `${index === 0 ? '▶ ' : ''}${name} → poz. ${item.targetLevel}`;
                if (index === 0) txt.style.fontWeight = 'bold';

                const upB = makeBtn('▲', 'btn'); upB.style.padding = '0 5px';
                upB.onclick = () => {
                    const c = loadConfig();
                    if (index > 0) { [c.buildSequence[index-1], c.buildSequence[index]] = [c.buildSequence[index], c.buildSequence[index-1]]; saveConfig(c); refreshList(); }
                };
                const dnB = makeBtn('▼', 'btn'); dnB.style.padding = '0 5px';
                dnB.onclick = () => {
                    const c = loadConfig();
                    if (index < c.buildSequence.length - 1) { [c.buildSequence[index], c.buildSequence[index+1]] = [c.buildSequence[index+1], c.buildSequence[index]]; saveConfig(c); refreshList(); }
                };
                const delB = makeBtn('✕', 'btn'); delB.style.cssText = 'padding:0 5px;color:#ff0000;';
                delB.onclick = () => {
                    const c = loadConfig(); c.buildSequence.splice(index, 1); saveConfig(c); refreshList();
                };

                const btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:5px;';
                btns.appendChild(upB); btns.appendChild(dnB); btns.appendChild(delB);
                el.appendChild(txt); el.appendChild(btns);
                seqList.appendChild(el);
            });
            seqCount.textContent = `Kroków w kolejce: ${cfg.buildSequence.length}`;
        }

        refreshList();
    }

    // =====================================================================
    // HELPERS
    // =====================================================================
    function makeSectionDiv(titleText, descText) {
        const div = document.createElement('div');
        div.style.cssText = 'padding-top:10px;border-top:1px solid #c1a264;margin-bottom:10px;';
        div.innerHTML = `<div style="font-weight:bold;color:#603000;margin-bottom:4px;">${titleText}</div>
            <div style="color:#666;font-style:italic;font-size:11px;margin-bottom:6px;">${descText}</div>`;
        return div;
    }

    function makeBtn(text, cls, extraStyle) {
        const b = document.createElement('button');
        b.textContent = text; b.className = cls || 'btn';
        if (extraStyle) b.style.cssText = extraStyle;
        return b;
    }

    function mkCheckbox(id, labelText, checked) {
        const div = document.createElement('div'); div.style.marginBottom = '8px';
        const cb  = document.createElement('input'); cb.type = 'checkbox'; cb.id = id; cb.checked = checked;
        const lbl = document.createElement('label'); lbl.htmlFor = id; lbl.textContent = labelText; lbl.style.cursor = 'pointer';
        div.appendChild(cb); div.appendChild(lbl);
        return { div, cb };
    }

    function rowDiv() {
        const d = document.createElement('div'); d.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;'; return d;
    }

    // =====================================================================
    // INIT
    // =====================================================================
    if (typeof UI === 'undefined') {
        window.UI = {
            SuccessMessage: (msg) => console.log(`SUCCESS: ${msg}`),
            ErrorMessage:   (msg) => console.error(`ERROR: ${msg}`)
        };
    }

    createUI();
    debugLog('Skrypt WASILEWSKI v1.7.2 uruchomiony.');

    // Fallback reload po 30 min
    setTimeout(() => window.location.reload(), FALLBACK_INTERVAL);

    // Uruchom główną logikę — nagrody obsłuży sama checkAndBuild gdy zajdzie potrzeba
    checkAndBuild();

})();
