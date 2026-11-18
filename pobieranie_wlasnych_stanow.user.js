// ==UserScript==
// @name         Plemiona – eksport stanów wojsk (w wiosce)
// @namespace    mjrbordo/tamper
// @version      1.0.0
// @description  Przegląd wojsk -> "w wiosce" -> format XXX|YYY,jednostki...,0,0
// @match        https://*.plemiona.pl/game.php*screen=overview_villages*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ---------------- KONFIGURACJA ----------------
    const ROW_LABEL   = 'w wiosce'; // 'własne' | 'w wiosce' | 'poza wioską' | 'w drodze' | 'razem'
    const EXTRA_ZEROS = 2;          // zera doklejane na końcu (symulacja skryptu Zbiórka wojska)
    const SKIP_UNITS  = [];         // np. ['knight'] jeśli format ma pominąć rycerza
    // ----------------------------------------------

    const params = new URLSearchParams(location.search);
    if (params.get('mode') !== 'units') return;

    function buildUrl() {
        const p = new URLSearchParams(location.search);
        p.set('screen', 'overview_villages');
        p.set('mode', 'units');
        p.set('type', 'complete');
        p.set('page', '-1'); // wszystkie wioski na jednej stronie
        return location.pathname + '?' + p.toString();
    }

    function parse(doc) {
        const table = doc.querySelector('#units_table');
        if (!table) throw new Error('Brak #units_table – ustaw widok "Wszystkie" (type=complete).');

        // kolejność jednostek z nagłówka (unit_spear_..., unit_sword_..., ...)
        const units = [...table.querySelectorAll('thead img')]
            .map(img => (img.getAttribute('src') || '').match(/unit_([a-z]+)[_.]/))
            .filter(Boolean)
            .map(m => m[1]);

        const lines = [];
        table.querySelectorAll('tbody.row_marker').forEach(tbody => {
            const label = tbody.querySelector('.quickedit-label');
            if (!label) return;
            const coords = [...label.textContent.matchAll(/\((\d{1,3})\|(\d{1,3})\)/g)].pop();
            if (!coords) return;

            const row = [...tbody.querySelectorAll('tr')].find(tr => {
                const tds = [...tr.children].filter(td => !td.hasAttribute('rowspan'));
                return tds[0] && tds[0].textContent.trim() === ROW_LABEL;
            });
            if (!row) return;

            const counts = [...row.querySelectorAll('td.unit-item')]
                .map(td => parseInt(td.textContent.replace(/\D/g, ''), 10) || 0);

            const values = units
                .map((u, i) => ({ u, v: counts[i] ?? 0 }))
                .filter(x => !SKIP_UNITS.includes(x.u))
                .map(x => x.v);

            for (let i = 0; i < EXTRA_ZEROS; i++) values.push(0);
            lines.push(`${coords[1]}|${coords[2]},${values.join(',')}`);
        });
        return { units: units.filter(u => !SKIP_UNITS.includes(u)), lines };
    }

    function showResult(res) {
        let box = document.getElementById('bordo-troops-export');
        if (!box) {
            box = document.createElement('div');
            box.id = 'bordo-troops-export';
            box.style.cssText = 'position:fixed;top:60px;right:20px;z-index:99999;background:#f4e4bc;border:2px solid #7d510f;padding:8px;width:460px;box-shadow:0 2px 8px #0006;font:12px Verdana';
            document.body.appendChild(box);
        }
        box.innerHTML = '';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px';
        head.innerHTML = `<b>Stany „${ROW_LABEL}” – ${res.lines.length} wiosek</b>`;
        const close = document.createElement('a');
        close.href = '#'; close.textContent = '✖';
        close.onclick = e => { e.preventDefault(); box.remove(); };
        head.appendChild(close);

        const info = document.createElement('div');
        info.style.cssText = 'color:#555;margin-bottom:4px';
        info.textContent = 'Kolejność: XXX|YYY,' + res.units.join(',') + ',0'.repeat(EXTRA_ZEROS);

        const ta = document.createElement('textarea');
        ta.style.cssText = 'width:100%;height:320px;font:11px monospace';
        ta.value = res.lines.join('\n');

        const copy = document.createElement('button');
        copy.className = 'btn'; copy.textContent = 'Kopiuj';
        copy.onclick = () => {
            ta.select();
            (navigator.clipboard ? navigator.clipboard.writeText(ta.value) : Promise.reject())
                .catch(() => document.execCommand('copy'))
                .finally(() => { copy.textContent = 'Skopiowano ✔'; setTimeout(() => copy.textContent = 'Kopiuj', 1500); });
        };

        box.append(head, info, ta, copy);
    }

    async function run(btn) {
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = 'Pobieram…';
        try {
            const html = await fetch(buildUrl(), { credentials: 'include' }).then(r => r.text());
            const doc = new DOMParser().parseFromString(html, 'text/html');
            showResult(parse(doc));
        } catch (e) {
            alert('Eksport wojsk: ' + e.message);
        } finally {
            btn.disabled = false;
            btn.textContent = old;
        }
    }

    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = `Eksport wojsk (${ROW_LABEL})`;
    btn.style.margin = '4px 0';
    btn.onclick = () => run(btn);

    const anchor = document.querySelector('#units_table') || document.querySelector('#paged_view_content') || document.querySelector('#content_value');
    if (anchor) anchor.parentNode.insertBefore(btn, anchor);
})();
