// ==UserScript==
// @name         KLIK MFKER
// @namespace    mjrbordo/tamper
// @version      1.1.0
// @description  Klika "Wyślij atak" na podany czas z precyzją do milisekundy. Tryb: czas przybycia lub godzina wysyłki. Obsluga opcjonalnej daty.
// @author       mjrbordo
// @match        *.plemiona.pl/*&screen=place&try=confirm
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const DEFAULT_PRE_FIRE_MS = 25;

    const $form = document.getElementById('command-data-form');
    const $submit = document.getElementById('troop_confirm_submit');
    if (!$form || !$submit) {
        console.warn('[PrecSend] Nie znaleziono formularza ataku.');
        return;
    }

    let serverOffset = 0;
    (function calcOffset() {
        try {
            if (window.Timing && typeof Timing.getCurrentServerTime === 'function') {
                serverOffset = Timing.getCurrentServerTime() - Date.now();
            }
        } catch (e) {}
    })();
    function serverNow() { return Date.now() + serverOffset; }

    function getDurationSeconds() {
        const cells = $form.querySelectorAll('table.vis td');
        for (const td of cells) {
            const m = td.textContent.trim().match(/^(\d+):([0-5]?\d):([0-5]\d)$/);
            if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
        }
        return null;
    }

    function parseTimeStr(str) {
        const s = str.trim().replace(',', '.');
        // z data: DD.MM[.YYYY] HH:MM:SS[:mmm]
        let m = s.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}):(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?$/);
        if (m) return {
            day: +m[1], mon: +m[2], year: m[3] ? +m[3] : null,
            h: +m[4], m: +m[5], s: +m[6], ms: m[7] ? +(m[7].padEnd(3, '0')) : 0
        };
        // tylko godzina: HH:MM:SS[:mmm]
        m = s.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:[:.](\d{1,3}))?$/);
        if (m) return {
            day: null, mon: null, year: null,
            h: +m[1], m: +m[2], s: +m[3], ms: m[4] ? +(m[4].padEnd(3, '0')) : 0
        };
        return null;
    }

    function buildTargetEpoch(parsed) {
        const now = serverNow();
        const d = new Date(now);
        if (parsed.day != null) {
            d.setDate(1);
            d.setMonth(parsed.mon - 1);
            if (parsed.year != null) d.setFullYear(parsed.year);
            d.setDate(parsed.day);
            d.setHours(parsed.h, parsed.m, parsed.s, parsed.ms);
            return d.getTime(); // z data nie przeskakujemy o +24h
        }
        d.setHours(parsed.h, parsed.m, parsed.s, parsed.ms);
        let target = d.getTime();
        if (target < now - 2000) target += 24 * 3600 * 1000;
        return target;
    }

    function fmt(ts) {
        const d = new Date(ts);
        const p = (n, l = 2) => String(n).padStart(l, '0');
        return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' +
            p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
    }

    const workerCode = [
        'let offset = 0;',
        'let fireAt = 0;',
        'let running = false;',
        'function srvNow() { return Date.now() + offset; }',
        'function loop() {',
        '    if (!running) return;',
        '    const t = srvNow();',
        '    const left = fireAt - t;',
        '    if (left <= 0) {',
        '        running = false;',
        '        postMessage({ type: "FIRE", at: t });',
        '        return;',
        '    }',
        '    if (left > 50) {',
        '        postMessage({ type: "TICK", left: left });',
        '        setTimeout(loop, Math.min(left - 50, 200));',
        '    } else {',
        '        let now;',
        '        do { now = srvNow(); } while (now < fireAt && running);',
        '        if (running) {',
        '            running = false;',
        '            postMessage({ type: "FIRE", at: now });',
        '        }',
        '    }',
        '}',
        'onmessage = function (e) {',
        '    const d = e.data;',
        '    if (d.type === "ARM") {',
        '        offset = d.offset;',
        '        fireAt = d.fireAt;',
        '        running = true;',
        '        loop();',
        '    } else if (d.type === "DISARM") {',
        '        running = false;',
        '    }',
        '};'
    ].join('\n');

    let worker = null;
    function makeWorker() {
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        return new Worker(URL.createObjectURL(blob));
    }

    const box = document.createElement('div');
    box.style.cssText =
        'border:2px solid #804000;background:#f4e4bc;padding:8px;margin:8px 0;' +
        'font-size:12px;border-radius:4px;max-width:380px;';
    box.innerHTML =
        '<b>&#9201; Precyzyjny wysylacz v2 (worker)</b><br>' +
        '<label><input type="radio" name="ps_mode" value="arrival" checked> Czas przybycia</label>' +
        '<label style="margin-left:8px;"><input type="radio" name="ps_mode" value="send"> Godzina wysylki</label>' +
        '<br>' +
        '<input id="ps_time" type="text" placeholder="[DD.MM] HH:MM:SS:mmm" style="width:170px;margin-top:5px;">' +
        '<span style="font-size:11px;color:#555;"> (data i mmm opcjonalne)</span><br>' +
        '<label style="display:inline-block;margin-top:5px;">Pre-fire (ms):' +
        '<input id="ps_prefire" type="text" value="' + DEFAULT_PRE_FIRE_MS + '" style="width:50px;"></label><br>' +
        '<button id="ps_arm" type="button" style="margin-top:6px;padding:4px 10px;cursor:pointer;">UZBROJ</button>' +
        '<button id="ps_cancel" type="button" style="margin-top:6px;padding:4px 10px;cursor:pointer;display:none;">ANULUJ</button>' +
        '<div id="ps_status" style="margin-top:6px;font-family:monospace;white-space:pre;"></div>';
    $form.parentNode.insertBefore(box, $form.nextSibling);

    const $time = box.querySelector('#ps_time');
    const $prefire = box.querySelector('#ps_prefire');
    const $arm = box.querySelector('#ps_arm');
    const $cancel = box.querySelector('#ps_cancel');
    const $status = box.querySelector('#ps_status');

    let armed = false;
    let statusBase = '';

    const duration = getDurationSeconds();
    if (duration != null) {
        $status.textContent = 'Marsz: ' + duration + 's (' + (duration / 60).toFixed(1) + ' min) | offset serw.: ' + serverOffset + 'ms';
    }

    function disarm() {
        if (worker) {
            try { worker.postMessage({ type: 'DISARM' }); worker.terminate(); } catch (e) {}
            worker = null;
        }
        armed = false;
        $arm.style.display = '';
        $cancel.style.display = 'none';
    }

    $cancel.addEventListener('click', function () {
        disarm();
        $status.textContent = statusBase + '\n>> ANULOWANO';
    });

    $arm.addEventListener('click', function () {
        if (armed) return;

        const mode = box.querySelector('input[name="ps_mode"]:checked').value;
        const parsed = parseTimeStr($time.value);
        if (!parsed) {
            $status.textContent = 'BLAD: zly format. Uzyj HH:MM:SS[:mmm] lub DD.MM[.YYYY] HH:MM:SS[:mmm]';
            return;
        }
        const prefire = parseInt($prefire.value, 10) || 0;

        let sendEpoch = buildTargetEpoch(parsed);
        if (mode === 'arrival') {
            if (duration == null) {
                $status.textContent = 'BLAD: nie odczytano czasu marszu.';
                return;
            }
            sendEpoch = sendEpoch - duration * 1000;
        }

        const fireAt = sendEpoch - prefire;
        const now = serverNow();
        if (fireAt - now < -500) {
            $status.textContent = 'BLAD: cel w przeszlosci.\nWysylka: ' + fmt(sendEpoch) + '\nTeraz:   ' + fmt(now);
            return;
        }

        armed = true;
        $arm.style.display = 'none';
        $cancel.style.display = '';

        const arrivalTxt = mode === 'arrival'
            ? 'Przybycie: ' + fmt(buildTargetEpoch(parsed)) + '\n'
            : (duration != null ? 'Przybycie: ' + fmt(sendEpoch + duration * 1000) + '\n' : '');

        statusBase =
            'UZBROJONO (worker)\n' +
            arrivalTxt +
            'Wysylka:   ' + fmt(sendEpoch) + '\n' +
            'Klik (pre-fire ' + prefire + 'ms): ' + fmt(fireAt);
        $status.textContent = statusBase;

        worker = makeWorker();
        worker.onmessage = function (e) {
            const d = e.data;
            if (d.type === 'TICK') {
                $status.textContent = statusBase + '\nPozostalo: ' + (d.left / 1000).toFixed(2) + 's';
            } else if (d.type === 'FIRE') {
                fire(d.at);
            }
        };
        worker.postMessage({ type: 'ARM', offset: serverOffset, fireAt: fireAt });
    });

    function fire(at) {
        const clickTime = serverNow();
        disarm();
        $status.textContent = statusBase + '\n>> KLIK @ ' + fmt(clickTime) + ' (worker: ' + fmt(at) + ')';
        try {
            $submit.disabled = false;
            $submit.click();
        } catch (e) {
            try { $form.submit(); } catch (e2) {}
        }
    }

    window.addEventListener('beforeunload', disarm);
    console.log('[PrecSend v2] Gotowy. offset =', serverOffset, 'ms');
})();
