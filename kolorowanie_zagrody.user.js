// ==UserScript==
// @name         kolorowanie zagrody
// @version      1.0
// @author       Jarzyn
// @match        https://*.plemiona.pl/game.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=plemiona.pl
// @grant        none
// ==/UserScript==
$(() =>
{
    const critical = 0.85;
    const { buildings, id: currentVillageId } = game_data.village;
    const { href } = location;
    const percentColors = [
        new PercentageColor(0.00, new RGB(0x00, 0xff, 0x00)),
        new PercentageColor(0.75, new RGB(0xff, 0xff, 0x00)),
        new PercentageColor(1.00, new RGB(0xff, 0x00, 0x00))
    ];
    const getCapacityFromNode = $targetNode => ({
        capacity: $targetNode.text().replace(/[\t\n]*/gm, ''),
        html: $targetNode.html().trim(),
    });
    definePluins();

    const currVillageInfo = currentVillage();

    if (href.includes('screen=overview_villages'))
    {
        const $prodTable = $('#production_table');
        const $combTable = $('#combined_table');

        if (href.includes('mode=prod') || $prodTable.length )
            prodView(currVillageInfo);

        if (href.includes('mode=combined') || $combTable.length)
            combinedView(currVillageInfo);
    }

    function currentVillage ()
    {
        if (parseInt(buildings.farm) === 30)
            return;

        const $headerFarm = $('#header_info td[data-title="Zagroda"]');
        const { capacity, html } = getCapacityFromNode($headerFarm);
        const { cssStyles, pctString, farmPercentage } = getStylesForCapacity(capacity);

        if (farmPercentage >= critical && !$('.buildorder_farm').length)
            $('#main_buildrow_farm')
                .find('td, td.build_options > span, a:contains("Zagroda")')
                .style(cssStyles)
                .filter('span')
                .style(cssStyles.resetBackgroundColor());

        $headerFarm.html(`${html}(${pctString})&nbsp;`)
            .closest('.menu_block_right').css({
                maxWidth: 450
            });

        $headerFarm.prev().style(cssStyles);
        $headerFarm.style(cssStyles)
            .find('span')
            .style(cssStyles.resetBackgroundColor());

        return {
            cssStyles,
            pctString,
            farmPercentage
        };
    }

    function combinedView (currVillageInfo)
    {
        const farmCapacityMatrix = [
            0, 240, 281, 329, 386, 452, 530, 622, 729, 854, 1002, 1174,
            1376, 1613, 1891, 2216, 2598, 3045, 3569, 4183, 4904, 5748,
            6737, 7896, 9255, 10848, 12715, 14904, 17469, 20476, 24000
        ];
        const $rows = $('#combined_table tbody > tr:not(:first)');
        colorTableRows(currVillageInfo, $rows, 7, $farmCell =>
        {
            const [, left, lvl] = $farmCell.html().match(/(\d+)\s\((\d{1,2})\)/);
            const max = farmCapacityMatrix[lvl];
            const curr = max - left;
            return `${curr}/${max}`;
        });
    }

    function prodView (currVillageInfo)
    {
        const $rows = $('#production_table tbody > tr');
        colorTableRows(currVillageInfo, $rows, 6, $farmCell =>
        {
            const { capacity } = getCapacityFromNode($farmCell);
            return capacity;
        });
    }

    function colorTableRows (currVillageInfo, $rows, eq, capacityCallback)
    {
        for (const row of $rows.toArray())
        {
            const $row = $(row);
            const $farmCell = $row.children(`td:eq(${eq})`);
            const villageId = parseInt($row.find('.quickedit-vn').attr('data-id'));
            const html = $farmCell.html();
            const updateRow = ({ cssStyles, pctString }) => {
                return $farmCell.html(`${html} (${pctString})`)
                    .style(cssStyles, true)
                    .find('a')
                    .style(cssStyles.resetBackgroundColor(), true);
            }

            if (villageId === currentVillageId)
            {
                if (currVillageInfo)
                    updateRow(currVillageInfo);
            }
            else
            {
                const capacity = capacityCallback($farmCell, html);
                const capacityData = getStylesForCapacity(capacity);
                updateRow(capacityData);
            }
        }
    }

    function getStylesForCapacity (capacity)
    {
        const farmPercentage = eval(capacity);
        const pctString = (farmPercentage * 100).toFixed(2) + "%";
        const bgColor = RGB.getColorForPercentage(farmPercentage, percentColors);
        return {
            farmPercentage,
            pctString,
            cssStyles: new CssStyles(bgColor, 0.8),
        };
    }
});

const definePluins = () =>
{
    /**
     * @param {CssStyles | string} styles
     * @returns {jQuery}
     */
    $.fn.style = function (styles, useImportant = false)
    {
        if (!styles instanceof CssStyles)
            throw new Error('styles has to be an instance of CssStyles');

        if (!useImportant)
            return this.css(styles.getAsObject());
        else
            return this.attr('style', styles.getAsString(true));
    };
};

//#region Types
class CssStyles
{
    #_styles = {
        backgroundColor: '',
        color: '',
        fontWeight: '',
    };

    /**
     * @param {RGB | object} bgColor
     * @param {float} alpha
     */
    constructor(opts, alpha)
    {
        if (!opts instanceof RGB && typeof (opts) !== 'object')
            throw new Error('bgColor param has to be an instance of RGB class or an object');

        if (opts instanceof RGB)
            this.#_styles = {
                backgroundColor: opts.toCss(alpha),
                color: opts.getTextColor().toCss(),
                fontWeight: 'bold',
            };
        else
            this.#_styles = opts;
    }
    resetBackgroundColor = () => new CssStyles({ ...this.#_styles, backgroundColor: '' });
    getAsObject = () => this.#_styles;
    getAsString = (important = false) => Object.keys(this.#_styles)
        .reduce((prev, curr) =>
        {

            const prop = curr.replace(/[A-Z]/gm, match => '-' + match.toLowerCase());
            let val = this.#_styles[curr];

            if (important)
                val += " !important";
            val += ";";

            return `${prev} ${prop}: ${val}`.trim();
        }, "");
}

class Utils
{
    constructor()
    {
        if (this.constructor == Utils)
            throw new Error("Static classes can't be instantiated.");
    }

    static isInRange = (x, min, max) => ((x - min) * (x - max) <= 0);
}

class PercentageColor
{
    pct;
    color;

    /**
     * creates a new instance of PercentageColor class
     * @param {float} percentage
     * @param {RGB} color
     */
    constructor(percentage, color)
    {
        if (!Utils.isInRange(percentage, 0, 1))
            throw new Error('ArgumentOutOfRangeException');

        if (!color instanceof RGB)
            throw new Error('color param has to be an instance of RGB');

        this.pct = percentage;
        this.color = color;
    }
}

class RGB
{
    #min = 0;
    #max = 255;
    #r = 0;
    #g = 0;
    #b = 0;

    /**
     * creates a new instance of RGB class
     * @param {Number} red
     * @param {Number} green
     * @param {Number} blue
     */
    constructor(red, green, blue)
    {
        if (!this.#isAllowed(red)
            || !this.#isAllowed(green)
            || !this.#isAllowed(blue))
            throw new Error('ArgumentOutOfRangeException');

        this.#r = red;
        this.#g = green;
        this.#b = blue;
    }

    /**
     * @param {float} alpha if specified then result will be in rgba format, otherwise rgb
     * @returns {string} converted values to CSS notation
     */
    toCss = alpha =>
    {
        const val = [this.#r, this.#g, this.#b];
        let format = 'rgb';

        if (!!alpha)
        {
            if (typeof alpha !== "number")
                throw new Error('alpha should be a float type');

            if (!Utils.isInRange(alpha, 0, 1))
                throw new Error('alpha should be from range 0..1');

            val.push(alpha);
            format += 'a';
        }

        return `${format}(${val.join(', ')})`;
    };

    /**
     * @returns {RGB} a new instance of the RGB class after inverting individual color values
     */
    getTextColor = () =>
    {
        const luma = this.#getLuma();

        if (luma < 120)
            return new RGB(0xff, 0xff, 0xff);
        return new RGB(0x00, 0x00, 0x00);
    };

    /**
     * creates a new instance of RGB class based on color palette
     * @param {number} pct - range between 0 and 1
     * @param {Array<PercentageColor>} palette color palette
     * @returns {RGB}
     */
    static getColorForPercentage = (pct, palette) =>
    {
        if (!Utils.isInRange(pct, 0, 1))
            throw new Error('ArgumentOutOfRangeException');

        if (palette.length < 2)
            throw new Error('palette is too small');

        let i;
        for (i = 1; i < palette.length - 1; i++)
            if (pct < palette[i].pct)
                break;

        const lower = palette[i - 1];
        const upper = palette[i];
        const range = upper.pct - lower.pct;
        const rangePct = (pct - lower.pct) / range;
        const pctLower = 1 - rangePct;
        const pctUpper = rangePct;
        return new RGB(
            Math.floor(lower.color.#r * pctLower + upper.color.#r * pctUpper),
            Math.floor(lower.color.#g * pctLower + upper.color.#g * pctUpper),
            Math.floor(lower.color.#b * pctLower + upper.color.#b * pctUpper)
        );
    };

    #getLuma = () =>
    {
        const lumaCoefficientR = 0.2126;
        const lumaCoefficientG = 0.7152;
        const lumaCoefficientB = 0.0722;
        const lumaR = this.#r * lumaCoefficientR;
        const lumaG = this.#g * lumaCoefficientG;
        const lumaB = this.#b * lumaCoefficientB;

        return lumaR + lumaG + lumaB;
    };

    #isAllowed = x => Utils.isInRange(x, this.#min, this.#max);
}

//#endregion
