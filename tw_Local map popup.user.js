// ==UserScript==
// @name         Local map popup — arrival times
// @namespace    mjrbordo/tamper
// @version      1.0.0
// @description  Dodaje czasy dotarcia wojsk do dymka na mapie. Liczy wszystko LOKALNIE (koordynaty + prędkości jednostek z gry), bez zależności od TWHelp API.
// @author       bordo (na bazie pomysłu Kichiyaki)
// @match        https://*.plemiona.pl/game.php?*screen=map*
// @match        https://*.die-staemme.de/game.php?*screen=map*
// @match        https://*.tribalwars.net/game.php?*screen=map*
// @icon         https://www.google.com/s2/favicons?domain=plemiona.pl
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    const GD = W.game_data;
    if (!GD || GD.screen !== 'map' || GD.mode !== null) return;

    // ---- i18n (proste) ----
    const T = (() => {
        const dict = {
            pl_PL: { arrival: 'Czas dotarcia' },
            _default: { arrival: 'Arrival time' }
        };
        const l = (dict[GD.locale]) ? GD.locale : '_default';
        return (k) => dict[l][k] || dict._default[k] || k;
    })();

    const CACHE_KEY = `local_popup_unitspeed_${GD.world}`;

    // ---- odczyt prędkości jednostek ----
    // Zwraca mapę { unitName: speedMinutesPerField }. Prędkość w Plemionach = minuty na 1 pole odległości.
    async function getUnitSpeeds() {
        // 1) najpewniejsze: globalny unit_data (obecny na wielu ekranach gry)
        if (W.unit_data && typeof W.unit_data === 'object') {
            const out = {};
            for (const [name, info] of Object.entries(W.unit_data)) {
                if (info && typeof info.speed === 'number') out[name] = info.speed;
            }
            if (Object.keys(out).length) return out;
        }

        // 2) game_data.units czasem zawiera speed
        if (GD.units && typeof GD.units === 'object') {
            const out = {};
            for (const [name, info] of Object.entries(GD.units)) {
                if (info && typeof info.speed === 'number') out[name] = info.speed;
            }
            if (Object.keys(out).length) return out;
        }

        // 3) cache z poprzedniego pobrania XML
        try {
            const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
            if (cached && cached.exp > Date.now() && cached.data) return cached.data;
        } catch (e) {}

        // 4) fallback: XML z własnego serwera gry (NIE z TWHelp)
        //    interface.php?func=get_unit_info zwraca <config><spear><speed>...</speed>...
        try {
            const resp = await fetch('/interface.php?func=get_unit_info', { credentials: 'same-origin' });
            const xml = await resp.text();
            const doc = new DOMParser().parseFromString(xml, 'text/xml');
            const out = {};
            doc.querySelectorAll('config > *').forEach(node => {
                const speedEl = node.querySelector('speed');
                if (speedEl) {
                    const s = parseFloat(speedEl.textContent);
                    if (!isNaN(s)) out[node.tagName] = s;
                }
            });
            if (Object.keys(out).length) {
                localStorage.setItem(CACHE_KEY, JSON.stringify({ data: out, exp: Date.now() + 7 * 24 * 3600 * 1000 }));
                return out;
            }
        } catch (e) {
            console.warn('[LocalPopup] nie udało się pobrać prędkości jednostek:', e);
        }

        return null;
    }

    // dystans euklidesowy między wioskami (jak w oryginale calcDistance)
    function calcDistance(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    // aktualny czas serwera (ms) — Timing jest dostępny w kliencie gry
    function serverNow() {
        if (W.Timing && typeof W.Timing.getCurrentServerTime === 'function') {
            return W.Timing.getCurrentServerTime();
        }
        return Date.now();
    }

    function addSeconds(ms, sec) {
        return new Date(ms + sec * 1000);
    }

    // ---- wpięcie w popup mapy ----
    class Popup {
        constructor(unitSpeeds, currentVillage) {
            this.unitSpeeds = unitSpeeds;
            this.currentVillage = currentVillage;
        }

        addHandlers() {
            const p = W.TWMap && W.TWMap.popup;
            if (!p || typeof p.displayForVillage !== 'function') {
                console.warn('[LocalPopup] TWMap.popup niedostępny — struktura gry mogła się zmienić.');
                return;
            }
            p._displayForVillage_local = p.displayForVillage;
            p.displayForVillage = (village, x, y) => {
                p._displayForVillage_local(village, x, y);
                try { this.displayArrivalTimes(x, y); } catch (e) { console.warn('[LocalPopup]', e); }
            };
        }

        displayArrivalTimes(x, y) {
            const dist = calcDistance({ x, y }, this.currentVillage);
            if (dist <= 0) return; // ta sama wioska

            const imgs = document.querySelectorAll('#map_popup #info_content tbody img[src*="unit/unit_"]');
            if (imgs.length === 0) return;

            const tbody = imgs[0].closest('tbody');
            if (!(tbody instanceof HTMLTableSectionElement)) return;

            // nie dubluj wiersza, jeśli już dodany
            const existing = tbody.querySelector('#local_popup_arrival_row');
            if (existing) existing.remove();

            const row = document.createElement('tr');
            row.id = 'local_popup_arrival_row';
            row.classList.add('center');

            const now = serverNow();

            imgs.forEach((img, idx) => {
                if (!(img instanceof HTMLImageElement)) return;
                // wyłuskaj nazwę jednostki z src: .../unit/unit_axe.png → axe
                const m = img.src.match(/unit\/unit_([a-z]+)\.?/i);
                const unit = m ? m[1] : null;
                const speed = unit ? this.unitSpeeds[unit] : null;

                const td = document.createElement('td');
                td.style.padding = '2px';
                td.style.backgroundColor = idx % 2 === 0 ? '#F8F4E8' : '#DED3B9';
                td.style.maxWidth = '70px';
                td.style.fontSize = '11px';

                if (speed) {
                    const travelSec = Math.round(dist * speed * 60); // speed = min/pole → ×60 = sekundy/pole
                    td.innerText = addSeconds(now, travelSec).toLocaleString();
                } else {
                    td.innerText = '—';
                }
                row.appendChild(td);
            });

            tbody.appendChild(row);
        }
    }

    // ---- start ----
    (async () => {
        const speeds = await getUnitSpeeds();
        if (!speeds) {
            console.warn('[LocalPopup] brak prędkości jednostek — czasy dotarcia nie będą liczone.');
            return;
        }
        new Popup(speeds, GD.village).addHandlers();
        console.log('[LocalPopup] aktywny, prędkości jednostek:', speeds);
    })();
})();
