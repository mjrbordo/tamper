// ==UserScript==
// @name         Organizer ataków z kolorami
// @namespace    fmthemaster.organizer-atakow
// @version      4.1
// @description  Koloruje nadchodzące ataki/wsparcia i dodaje szybkie tagi z konfigurowalnym panelem ustawień (nazwa, skrót, kolory). Ustawienia tagów są trwale zapamiętywane przez Tampermonkey (GM_setValue) - działają na wszystkich światach/subdomenach.
// @author       fmthemaster, Mau Maria (V3.0), PhilipsNostrum, Kirgonix (V2.0), Diogo Rocha, Bernas (V1.0)
// @match        *://*.plemiona.pl/game.php*
// @icon         https://www.plemiona.pl/favicon.ico
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

// translation by tjbh
// zmiany w V4.0: panel konfiguracyjny tagów (nazwa/skrót/kolory) + tagi
//                domyślnie dopisywane NA POCZĄTKU etykiety, bez kasowania
//                tego, co już w niej jest
// zmiany w V4.1: przeróbka na skrypt Tampermonkey (@match/@grant) + zapis
//                ustawień przez GM_setValue/GM_getValue zamiast localStorage,
//                dzięki czemu konfiguracja tagów jest wspólna dla wszystkich
//                światów (subdomen), a nie tylko dla tego jednego, na którym
//                akurat została zapisana

(function () {

  var STORAGE_KEY = 'organizerAtakowTagi_v4';

  // Zapis/odczyt ustawień przez GM_setValue/GM_getValue (Tampermonkey) -
  // to trwała pamięć skryptu, wspólna dla wszystkich światów Plemion,
  // niezależna od tego, że każdy świat to inna subdomena (a więc inny
  // "origin" dla zwykłego localStorage). Jeśli z jakiegoś powodu GM_*
  // nie jest dostępne, spada do localStorage jako zapasowe rozwiązanie.
  function gmGet(key, def) {
    if (typeof GM_getValue === 'function') return GM_getValue(key, def);
    try { return localStorage.getItem(key); } catch (e) { return def; }
  }
  function gmSet(key, value) {
    if (typeof GM_setValue === 'function') { GM_setValue(key, value); return; }
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  // Domyślna konfiguracja tagów. Każdy wiersz to jeden przycisk:
  // name       - tekst dopisywany do etykiety
  // icon       - skrót widoczny na przycisku
  // color      - kolor tła przycisku / wiersza (hex)
  // textColor  - kolor tekstu na przycisku
  // append     - true = tag dopisywany na KOŃCU etykiety (jak stare " | UWAŻAĆ"),
  //              false = tag dopisywany na POCZĄTKU etykiety (domyślne zachowanie)
  //
  // Można to też nadpisać przed uruchomieniem skryptu, ustawiając w konsoli:
  //   window.tagsConfig = [ {name:'[OK]', icon:'OK', color:'#31c908', textColor:'#fff', append:false}, ... ]
  var defaultTags = [
    { name: '[OK]',            icon: 'OK',  color: '#31c908', textColor: '#ffffff', append: false },
    { name: '[Wsparcie]',      icon: 'W',   color: '#a6ff00', textColor: '#ffffff', append: false },
    { name: '[Unik zrobiony]', icon: 'U!',  color: '#ef8b10', textColor: '#ffffff', append: false },
    { name: '[Unik]',          icon: 'U',   color: '#ff0000', textColor: '#ffffff', append: false },
    { name: '[Odbita]',        icon: 'O!',  color: '#adb6c6', textColor: '#ffffff', append: false },
    { name: '[Odbić]',         icon: 'O',   color: '#ffffff', textColor: '#000000', append: false },
    { name: '[Klin wbity]',    icon: 'K!',  color: '#22e5db', textColor: '#000000', append: false },
    { name: '[Klin]',          icon: 'K',   color: '#0d83dd', textColor: '#ffffff', append: false },
    { name: '[toFUBAR]',       icon: 'F',   color: '#000000', textColor: '#ffffff', append: false },
    { name: '[FUBARdone]',     icon: 'F!',  color: '#ffffff', textColor: '#000000', append: false },
    { name: '[Fejk]',          icon: 'Fk',  color: '#ff69b4', textColor: '#000000', append: false },
    { name: ' | UWAŻAĆ',       icon: 'UW!', color: '#ffd91c', textColor: '#000000', append: true  }
  ];

  var font_size = window.font_size || 8;
  var attack_layout = window.attack_layout || 'column'; // 'column', 'line', 'nothing'

  // Stałe kolory dla wierszy bez dopasowanego tagu / wsparć
  var fixedColors = {
    red: '#b70707',
    yellow: '#e8c30d',
    white: '#dbdbdb'
  };

  function loadTags() {
    if (window.tagsConfig && Object.prototype.toString.call(window.tagsConfig) === '[object Array]' && window.tagsConfig.length) {
      return window.tagsConfig;
    }
    try {
      var raw = gmGet(STORAGE_KEY, null);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.length) return parsed;
      }
    } catch (e) {
      console.warn('[Organizer ataków] Nie udało się wczytać zapisanej konfiguracji, używam domyślnej.', e);
    }
    return defaultTags;
  }

  function saveTags(list) {
    gmSet(STORAGE_KEY, JSON.stringify(list));
  }

  var tags = loadTags();

  var buttonNames, buttonIcons, buttonColors, buttonTextColors, buttonAppend;
  function rebuildDerived() {
    buttonNames = tags.map(function (t) { return t.name; });
    buttonIcons = tags.map(function (t) { return t.icon; });
    buttonColors = tags.map(function (t) { return t.color; });
    buttonTextColors = tags.map(function (t) { return t.textColor; });
    buttonAppend = tags.map(function (t) { return !!t.append; });
  }
  rebuildDerived();

  // Przyciemnia/rozjaśnia kolor hex o dany procent (np. -18 = trochę ciemniej)
  function shadeColor(hex, percent) {
    hex = (hex || '#888888').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    var num = parseInt(hex, 16);
    var r = Math.min(255, Math.max(0, (num >> 16) + Math.round(255 * percent / 100)));
    var g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + Math.round(255 * percent / 100)));
    var b = Math.min(255, Math.max(0, (num & 0x0000FF) + Math.round(255 * percent / 100)));
    return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
  }

  function getTop(num) { return buttonColors[num] || '#b69471'; }
  function getBot(num) { return buttonColors[num] ? shadeColor(buttonColors[num], -18) : '#6c4d2d'; }
  function getFon(num) { return buttonTextColors[num] || '#ffffff'; }
  function getSize() { return font_size || 12; }

  function iT(nr, line) {
    var html = '<span style="float: right;">';
    buttonIcons.forEach(function (nome, num) {
      html += '<button type="button" id="opt' + nr + '_' + num + '" class="btn" title="' + buttonNames[num] + '" style="color: ' + getFon(num) + '; font-size: ' + getSize() + 'px !important; background: linear-gradient(to bottom, ' + getTop(num) + ' 30%, ' + getBot(num) + ' 10%)">' + nome + '</button>';
    });
    html += '</span>';
    $(line).find('.quickedit-content').append(html);
    buttonNames.forEach(function (nome, num) {
      $('#opt' + nr + '_' + num).click(function () {
        $(line).find('.rename-icon').click();
        var $input = $(line).find('input[type=text]');
        var current = $input.val() || '';
        var updated;
        if (buttonAppend[num]) {
          // tryb "dopisz na końcu" - nic nie usuwamy, tylko dopisujemy tag na końcu
          updated = current + buttonNames[num];
        } else {
          // tryb domyślny - tag trafia na POCZĄTEK, cała reszta etykiety zostaje
          updated = (buttonNames[num] + ' ' + current).trim();
        }
        $input.val(updated);
        $(line).find('input[type=button]').click();
        iT(nr, line);
      });
    });
  }

  function check(name, nr) {
    var i, j;
    for (i = 0; i < buttonNames.length; i++) {
      for (j = 0; j < buttonNames.length; j++) {
        if (name.indexOf(buttonNames[i] + buttonNames[j]) != -1) {
          if (nr == 1) return i;
          else if (nr == 2) return j;
          else return true;
        }
      }
    }
    return false;
  }

  function isSupport(line) {
    var scr = $(line).find('img:eq(0)').attr('src');
    if (scr.indexOf('support') >= 0) return true;
    return false;
  }

  function findLeadingTag(name) {
    // Ponieważ tagi są teraz dopisywane na początku etykiety, ten, który
    // steruje kolorem wiersza, to ten stojący najbliżej początku (czyli
    // ostatnio dodany).
    for (var i = 0; i < buttonNames.length; i++) {
      if (name.indexOf(buttonNames[i]) === 0) return i;
    }
    return -1;
  }

  function runColoring() {
    if (location.href.indexOf("screen=overview_villages") == -1 && location.href.indexOf("mode=incomings&subtype=attacks") == -1) {
      $('#commands_incomings .command-row').each(function (nr, line) {
        if (!isSupport(line)) iT(nr, line, true);
      });
    } else {
      $('#incomings_table tr.nowrap').each(function (nr, line) {
        if (!isSupport(line)) {
          var name = $.trim($(line).find('.quickedit-label').text());
          var code = findLeadingTag(name);
          var dual = check(name);
          var codes = [];
          codes[0] = check(name, 1);
          codes[1] = check(name, 2);
          if (code != -1) {
            var color = shadeColor(buttonColors[code] || '#6c4d2d', -18);
            if (attack_layout === 'line') {
              $(line).find('td').each(function (nr, td) {
                $(td).attr('style', 'background: ' + color + ' !important;');
              });
            } else if (attack_layout === 'column') {
              $(line).find('td:eq(0)').attr('style', 'background: ' + color + ' !important;');
              $(line).find('a:eq(0)').attr('style', 'color: white !important; text-shadow:-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;');
            }
          } else if (dual) {
            var color1 = buttonColors[codes[0]] || '#6c4d2d';
            var color2 = buttonColors[codes[1]] || '#6c4d2d';
            if (attack_layout === 'line') {
              $(line).find('td').each(function (nr, td) {
                $(td).attr('style', 'background: repeating-linear-gradient(45deg, ' + color1 + ', ' + color1 + ' 10px, ' + color2 + ' 10px, ' + color2 + ' 20px) !important;');
              });
            } else if (attack_layout === 'column') {
              $(line).find('td:eq(0)').attr('style', 'background: repeating-linear-gradient(45deg, ' + color1 + ', ' + color1 + ' 10px, ' + color2 + ' 10px, ' + color2 + ' 20px) !important;');
              $(line).find('a:eq(0)').attr('style', 'color: #ffffff !important; text-shadow:-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;');
            }
          } else {
            if (attack_layout === 'line') {
              $(line).find('td').each(function (nr, td) {
                $(td).attr('style', 'background: ' + fixedColors.red + ' !important;');
              });
              $(line).find('a').each(function (nr, td) {
                $(td).attr('style', 'color: ' + fixedColors.white + ' !important;');
              });
            } else if (attack_layout === 'column') {
              $(line).find('td:eq(0)').attr('style', 'background: ' + fixedColors.red + ' !important;');
              $(line).find('a:eq(0)').attr('style', 'color: white !important; text-shadow:-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;');
            }
          }
        } else {
          if (attack_layout === 'line') {
            $(line).find('td').each(function (nr, td) {
              $(td).attr('style', 'background: ' + fixedColors.yellow + ' !important;');
            });
            $(line).find('a').each(function (nr, td) {
              $(td).attr('style', 'color: ' + fixedColors.white + ' !important;');
            });
          } else if (attack_layout === 'column') {
            $(line).find('td:eq(0)').attr('style', 'background: ' + fixedColors.yellow + ' !important;');
            $(line).find('a:eq(0)').attr('style', 'color: white !important; text-shadow:-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;');
          }
        }
      });
    }
  }

  runColoring();

  // ---------------------------------------------------------------
  // Panel konfiguracyjny (opcjonalny). Otwiera się przyciskiem "⚙ Tagi"
  // w prawym dolnym rogu ekranu - pozwala zmienić nazwę, skrót na
  // przycisku, kolory oraz tryb (początek/koniec etykiety) każdego tagu.
  // Ustawienia zapisują się przez Tampermonkey (GM_setValue), więc zostają
  // zapamiętane na stałe i są wspólne dla wszystkich światów Plemion.
  // ---------------------------------------------------------------

  function openConfigPanel() {
    if ($('#tw-attack-tags-overlay').length) return; // panel już otwarty

    var overlayCss = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:Verdana,Arial,sans-serif;font-size:12px;';
    var boxCss = 'background:#f0e2c5;color:#3a2a12;border:2px solid #7d5b34;border-radius:4px;padding:12px;max-width:680px;max-height:80vh;overflow:auto;box-shadow:0 4px 18px rgba(0,0,0,0.4);';

    var $overlay = $('<div id="tw-attack-tags-overlay" style="' + overlayCss + '"></div>');
    var $box = $('<div style="' + boxCss + '"></div>');

    $box.append('<h3 style="margin:0 0 8px 0;">Ustawienia tagów ataków</h3>');
    $box.append('<p style="margin:0 0 8px 0;">Zmień nazwę, skrót na przycisku i kolory. Zaznaczenie „Dopisz na końcu” sprawia, że dany tag dopisuje się na KOŃCU etykiety (jak dawne „ | UWAŻAĆ”) zamiast na jej początku.</p>');

    var $table = $('<table style="border-collapse:collapse;width:100%;"></table>');
    $table.append('<tr><th style="text-align:left;">Nazwa tagu</th><th>Skrót</th><th>Kolor tła</th><th>Kolor tekstu</th><th>Dopisz&nbsp;na&nbsp;końcu</th><th></th></tr>');

    function addRow(tag) {
      tag = tag || { name: '', icon: '', color: '#31c908', textColor: '#ffffff', append: false };
      var $row = $('<tr></tr>');
      $row.append($('<td></td>').append($('<input type="text" class="cfg-name" style="width:150px;">').val(tag.name)));
      $row.append($('<td></td>').append($('<input type="text" class="cfg-icon" style="width:50px;">').val(tag.icon)));
      $row.append($('<td style="text-align:center;"></td>').append($('<input type="color" class="cfg-color">').val(tag.color || '#31c908')));
      $row.append($('<td style="text-align:center;"></td>').append($('<input type="color" class="cfg-textcolor">').val(tag.textColor || '#ffffff')));
      $row.append($('<td style="text-align:center;"></td>').append($('<input type="checkbox" class="cfg-append">').prop('checked', !!tag.append)));
      $row.append($('<td></td>').append($('<button type="button" class="cfg-remove">Usuń</button>')));
      $table.append($row);
    }

    tags.forEach(addRow);
    $box.append($table);

    var $addBtn = $('<button type="button" style="margin-top:8px;">+ Dodaj tag</button>').click(function () {
      addRow();
    });
    $box.append($addBtn);

    $table.on('click', '.cfg-remove', function () {
      $(this).closest('tr').remove();
    });

    var $footer = $('<div style="margin-top:12px;text-align:right;"></div>');
    var $resetBtn = $('<button type="button" style="margin-right:8px;">Przywróć domyślne</button>').click(function () {
      $table.find('tr:gt(0)').remove();
      defaultTags.forEach(addRow);
    });
    var $cancelBtn = $('<button type="button" style="margin-right:8px;">Anuluj</button>').click(function () {
      $overlay.remove();
    });
    var $saveBtn = $('<button type="button">Zapisz</button>').click(function () {
      var newTags = [];
      $table.find('tr:gt(0)').each(function () {
        var $row = $(this);
        var name = $.trim($row.find('.cfg-name').val());
        var icon = $.trim($row.find('.cfg-icon').val());
        if (!name || !icon) return; // pomijamy puste wiersze
        newTags.push({
          name: name,
          icon: icon,
          color: $row.find('.cfg-color').val(),
          textColor: $row.find('.cfg-textcolor').val(),
          append: $row.find('.cfg-append').is(':checked')
        });
      });
      if (!newTags.length) {
        alert('Musisz zostawić przynajmniej jeden tag.');
        return;
      }
      tags = newTags;
      saveTags(tags);
      rebuildDerived();
      $overlay.remove();
      alert('Zapisano ustawienia tagów. Odśwież stronę, aby przyciski szybkiego tagowania się odświeżyły.');
    });

    $footer.append($resetBtn).append($cancelBtn).append($saveBtn);
    $box.append($footer);
    $overlay.append($box);
    $('body').append($overlay);
  }

  if (!$('#tw-attack-tags-gear').length) {
    var $gear = $('<button type="button" id="tw-attack-tags-gear" title="Ustawienia tagów ataków" style="position:fixed;bottom:10px;right:10px;z-index:99998;padding:6px 10px;border-radius:4px;border:1px solid #7d5b34;background:#f0e2c5;color:#3a2a12;cursor:pointer;">⚙ Tagi</button>');
    $gear.click(openConfigPanel);
    $('body').append($gear);
  }

})();
