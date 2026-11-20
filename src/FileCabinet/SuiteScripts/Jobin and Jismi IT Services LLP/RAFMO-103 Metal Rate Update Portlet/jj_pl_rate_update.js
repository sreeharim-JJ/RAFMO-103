/**
 * @NApiVersion 2.1
 * @NScriptType Portlet
 * @NModuleScope SameAccount
 *
 * *********************************************************************************************************************************
 *
 * Rafmoh Bullion NS IN
 *
 * RAFMO-103 : P2P - Develop Daily Metal Rate Update Customization in NetSuite
 *
 * *********************************************************************************************************************************
 *
 * Author : Jobin and Jismi
 *
 * Date Created : 18-November-2026
 *
 * COPYRIGHT © 2026 Jobin & Jismi IT Services LLP.
 * All rights reserved. This script is a proprietary product of Jobin & Jismi IT Services LLP and is protected by copyright
 * law and international treaties. Unauthorized reproduction or distribution of this script, or any portion of it,
 * may result in severe civil and criminal penalties and will be prosecuted to the maximum extent possible under law.
 *
 * Description : This Portlet script shows the Rate Update form on the Rate Administrator's dashboard (Metal Type, Currency, Rate,
 *               Effective Date) and posts the entered details to the Rate Update Suitelet. It also lists today's saved rate for
 *               each currency and Metal Type (one column per metal) from the Daily Metal Rate custom record.
 *
 * REVISION HISTORY :
 *
 * @version 1.0 RAFMO-103 : 18-November-2026 : Created the initial build by JJ0494
 * @version 1.1 RAFMO-103 : 20-November-2026 : The rate table now has a column for each Metal Type, so the metal that was updated is visible
 *
 * *********************************************************************************************************************************
 */
define(['N/record', 'N/search', 'N/ui/serverWidget', 'N/url', 'N/format'],
    /**
     * @param {record} record
     * @param {search} search
     * @param {serverWidget} serverWidget
     * @param {url} url
     * @param {format} format
     */
    function (record, search, serverWidget, url, format) {
        'use strict';

        const REC_TYPE = 'customrecord_jj_metal_rate';
        const METAL_LIST_ID = 'customlist_jj_mr_metal_type'; // change the list ID if different
        const SUITELET_SCRIPT_ID = 'customscript_jj_sl_rate_update';
        const SUITELET_DEPLOYMENT_ID = 'customdeploy_jj_sl_rate_update';

        /**
         * @typedef {Object} CurrencyEntry
         * @property {string} currencyId - Internal ID of the currency
         * @property {string} currencyName - Currency name
         * @property {string} currencySymbol - Currency symbol
         * @property {Object<string, string>} rates - Today's formatted rate per Metal Type: { metalId: formattedRate }
         */

        /**
         * @typedef {Object} MetalEntry
         * @property {string} metalId - Internal ID of the Metal Type list value
         * @property {string} metalName - Metal Type name
         */

        /**
         * Today's date as YYYY-MM-DD for the Effective Date field.
         * @returns {string} The date, or an empty string when it cannot be worked out
         */
        const getTodayValue = () => {
            try {
                const today = format.parse({ value: format.format({ value: new Date(), type: format.Type.DATE }), type: format.Type.DATE });
                return today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
            } catch (e) {
                log.error('error@getTodayValue', e);
                return '';
            }
        };

        /**
         * Fetches all active currencies.
         * @returns {Array<CurrencyEntry>} The currencies (empty when the search fails)
         */
        const getCurrencies = () => {
            try {
                const currencies = [];
                search.create({
                    type: 'currency',
                    filters: ["isinactive", "is", "F"],
                    columns: [
                        search.createColumn({ name: "internalid", sort: search.Sort.ASC, label: "Internal ID" }),
                        search.createColumn({ name: "name", label: "Currency Name" }),
                        search.createColumn({ name: "symbol", label: "Symbol" })
                    ]
                }).run().each((result) => {
                    currencies.push({
                        currencyId: result.getValue('internalid'),
                        currencyName: result.getValue('name'),
                        currencySymbol: result.getValue('symbol'),
                        rates: {} // today's rate per Metal Type: { metalId: formattedRate }
                    });
                    return true; // Continue iterating
                });
                return currencies;
            } catch (e) {
                log.error('error@getCurrencies', e);
                return [];
            }
        };

        /**
         * Builds the Currency dropdown options.
         * @param {Array<CurrencyEntry>} currencies - Currencies from getCurrencies
         * @returns {string} HTML option tags (empty when it fails)
         */
        const buildCurrencyOptions = (currencies) => {
            try {
                return currencies.map(item => `<option value="${item.currencyId}">${item.currencyName}</option>`).join('');
            } catch (e) {
                log.error('error@buildCurrencyOptions', e);
                return '';
            }
        };

        /**
         * Fetches all active Metal Types from the custom list.
         * @returns {Array<MetalEntry>} The metal types (empty when the search fails)
         */
        const getMetals = () => {
            try {
                const metals = [];
                search.create({
                    type: METAL_LIST_ID,
                    filters: ["isinactive", "is", "F"],
                    columns: [
                        search.createColumn({ name: "name", sort: search.Sort.ASC, label: "Metal Type" })
                    ]
                }).run().each((result) => {
                    metals.push({ metalId: String(result.id), metalName: result.getValue('name') });
                    return true; // Continue iterating
                });
                return metals;
            } catch (e) {
                log.error('error@getMetals', e);
                return [];
            }
        };

        /**
         * Builds the Metal Type dropdown options.
         * @param {Array<MetalEntry>} metals - Metal types from getMetals
         * @returns {string} HTML option tags (empty when it fails)
         */
        const buildMetalOptions = (metals) => {
            try {
                return metals.map(item => `<option value="${item.metalId}">${item.metalName}</option>`).join('');
            } catch (e) {
                log.error('error@buildMetalOptions', e);
                return '';
            }
        };

        /**
         * Formats a rate with commas and 2 decimals.
         * @param {number|string} rate - The rate to format
         * @returns {string} The formatted rate, or 'Not Available' when there is no rate
         */
        const formatRate = (rate) => {
            try {
                return rate ? new Intl.NumberFormat('en-US', {
                    style: 'decimal',
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }).format(rate) : 'Not Available';
            } catch (e) {
                log.error('error@formatRate', e);
                return 'Not Available';
            }
        };

        /**
         * Adds today's rate to each currency entry for every Metal Type (currency.rates[metalId]),
         * using the newest rate found per Metal Type + Currency. The entries are changed in place;
         * when the search fails they keep no rates and the table shows "Not Available".
         * @param {Array<CurrencyEntry>} currencies - Currencies from getCurrencies
         * @returns {void}
         */
        const addTodaysRates = (currencies) => {
            try {
                search.create({
                    type: REC_TYPE,
                    columns: [
                        search.createColumn({ name: "internalid", sort: search.Sort.DESC, label: "internalid" }),
                        search.createColumn({ name: "custrecord_jj_mr_metal", label: "Metal Type" }),
                        search.createColumn({ name: "custrecord_jj_mr_currency", label: "Currency" }),
                        search.createColumn({ name: "custrecord_jj_mr_rate", label: "Metal Rate" })
                    ],
                    filters: [
                        ['isinactive', 'is', 'F'],
                        'AND',
                        ["custrecord_jj_mr_effdate", "within", "today"]
                    ]
                }).run().each(result => {
                    const metal = result.getValue({ name: 'custrecord_jj_mr_metal' });
                    const currency = result.getValue({ name: 'custrecord_jj_mr_currency' });
                    const rate = result.getValue({ name: 'custrecord_jj_mr_rate' });

                    // Keep the first (newest) rate found for each Metal Type in each currency
                    const currencyEntry = currencies.find(entry => entry.currencyId === currency);
                    if (currencyEntry && !currencyEntry.rates.hasOwnProperty(metal)) {
                        currencyEntry.rates[metal] = formatRate(rate);
                    }
                    return true; // Continue iteration
                });
            } catch (e) {
                log.error('error@addTodaysRates', e);
            }
        };

        /**
         * Builds the table header: Currency plus one column for each Metal Type.
         * @param {Array<MetalEntry>} metals - Metal types from getMetals
         * @returns {string} HTML table header row (empty when it fails)
         */
        const buildTableHeader = (metals) => {
            try {
                return `
                <tr>
                    <th>Currency</th>
                    ${metals.map(metal => `<th class="th-price">${metal.metalName}</th>`).join('')}
                </tr>
            `;
            } catch (e) {
                log.error('error@buildTableHeader', e);
                return '';
            }
        };

        /**
         * Builds the table rows showing today's rate per currency, with one cell for each Metal Type.
         * A metal without a rate today shows "Not Available", so an updated metal stands out.
         * @param {Array<CurrencyEntry>} currencies - Currencies with today's rates (after addTodaysRates)
         * @param {Array<MetalEntry>} metals - Metal types from getMetals
         * @returns {string} HTML table rows (empty when it fails)
         */
        const buildTableRows = (currencies, metals) => {
            try {
                return currencies.map(item => `
                <tr>
                    <td>${item.currencyName} (${item.currencySymbol})</td>
                    ${metals.map(metal => {
                        const rate = item.rates[metal.metalId];
                        return rate
                            ? `<td class="td-price">${rate}</td>`
                            : `<td class="td-price td-na">Not Available</td>`;
                    }).join('')}
                </tr>
            `).join('');
            } catch (e) {
                log.error('error@buildTableRows', e);
                return '';
            }
        };

        /**
         * Resolves the URL of the Rate Update Suitelet. The error is logged and thrown again, because an empty
         * URL would post the form to the wrong page; render then shows the error inside the portlet.
         * @returns {string} The internal Suitelet URL
         * @throws {Error} Any error raised while resolving the URL
         */
        const getSuiteletUrl = () => {
            try {
                return url.resolveScript({
                    scriptId: SUITELET_SCRIPT_ID,
                    deploymentId: SUITELET_DEPLOYMENT_ID,
                    returnExternalUrl: false
                });
            } catch (e) {
                log.error('error@getSuiteletUrl', e);
                throw e;
            }
        };

        /**
         * CSS for the portlet.
         * @returns {string} HTML style tag
         */
        const getStyles = () => `
            <style>
                .form-container {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 15px;
                    justify-content: center;
                    padding: 20px;
                    border-radius: 8px;
                    background: linear-gradient(135deg, #fff5d1, #fff8e5);
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                    max-width: 600px;
                    margin: 20px auto;
                }
                .form-group {
                    flex: 1 1 calc(50% - 15px); /* Take 50% of space or adjust dynamically */
                    display: flex;
                    flex-direction: column;
                    margin-bottom: 10px;
                }
                .form-group-full {
                    flex: 1 1 100%; /* Full row */
                }
                .form-group label {
                    margin-bottom: 5px;
                    font-weight: bold;
                    color: #856404; /* Gold shade for labels */
                }
                .form-group input,
                .form-group select {
                    padding: 10px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    font-size: 14px;
                    background-color: #fff;
                    height: 40px; /* Set consistent height for all fields */
                }
                .submit-button {
                    padding: 12px 25px;
                    font-size: 16px;
                    font-weight: bold;
                    color: #fff;
                    background: linear-gradient(90deg, #f4d03f, #d4ac0d);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: background 0.3s ease;
                    width: 100%;
                }
                .submit-button:hover {
                    background: linear-gradient(90deg, #d4ac0d, #a67c00);
                }
                .price-display {
                    text-align: center;
                    font-size: 24px;
                    font-weight: bold;
                    margin-bottom: 15px;
                    color: #d4ac0d; /* Gold shade for the price display */
                }
                table {
                    max-width: 600px;
                    width: 100%;
                    border-collapse: collapse;
                    margin: 20px auto;
                    text-align: left;
                }
                th, td {
                    padding: 10px;
                    border: 1px solid #ddd;
                }
                th {
                    font-size: 16px;
                    font-weight: bold;
                    background-color: #f4f4f4;
                }
                td {
                    font-size: 14px;
                    font-weight: normal;
                    color: #000000;
                }
                .th-price {
                    text-align: right;
                }
                .td-price {
                    text-align: right;
                }
                .td-na {
                    color: #999999;
                    font-style: italic;
                }
            </style>
        `;

        /**
         * Builds the browser script. On submit it asks the Suitelet whether a rate already exists for the same
         * Metal Type, Currency and Effective Date. If it exists with a different rate, a confirmation popup is shown and the
         * form is posted (with confirmupdate = T) only when the user clicks OK.
         * @param {{suiteletUrl: string}} data - Portlet data
         * @param {string} data.suiteletUrl - URL of the Rate Update Suitelet
         * @returns {string} HTML script tag (empty when it fails)
         */
        const buildConfirmScript = (data) => {
            try {
                return `
            <script>
                var rateCheckUrl = ${JSON.stringify(data.suiteletUrl)};
                var RATE_TOLERANCE = 0.000001;

                function getSelectedText(selectEl) {
                    return selectEl.options[selectEl.selectedIndex].text;
                }

                // Asks the Suitelet for the saved rate of the selected metal, currency and date
                function checkExistingRate(form) {
                    var params = new URLSearchParams({
                        action: 'checkrate',
                        metal: form.metal.value,
                        currency: form.currency.value,
                        effdate: form.effdate.value
                    });
                    return fetch(rateCheckUrl + '&' + params.toString(), { credentials: 'same-origin' })
                        .then(function (res) {
                            if (!res.ok) {
                                throw new Error('HTTP ' + res.status);
                            }
                            return res.json();
                        });
                }

                function resetRateForm(form) {
                    form.confirmupdate.value = '';
                    form.querySelector('.submit-button').disabled = false;
                }

                // Runs on submit; the form is posted from here once the check (and the confirmation, if needed) is done
                function onRateFormSubmit(form) {
                    form.querySelector('.submit-button').disabled = true;
                    checkExistingRate(form).then(function (result) {
                        if (result.error) {
                            alert(result.error);
                            resetRateForm(form);
                            return;
                        }
                        if (!result.exists) {
                            form.submit(); // no rate yet for this metal, currency and date - save it normally
                            return;
                        }

                        var newRate = Number(form.rate.value);
                        var label = getSelectedText(form.metal) + ' / ' + getSelectedText(form.currency) +
                            ' on ' + form.effdate.value;

                        if (Math.abs(Number(result.rate) - newRate) < RATE_TOLERANCE) {
                            alert('A rate of ' + Number(result.rate) + ' is already saved for ' + label + '. No update is needed.');
                            resetRateForm(form);
                            return;
                        }
                        if (confirm('A rate of ' + Number(result.rate) + ' is already saved for ' + label +
                            '. Do you want to update it to ' + newRate + '?')) {
                            form.confirmupdate.value = 'T';
                            form.submit();
                        } else {
                            resetRateForm(form);
                        }
                    }).catch(function (err) {
                        console.error('Rate check failed', err);
                        alert('Could not check the existing rate. Please try again.');
                        resetRateForm(form);
                    });
                    return false; // the post continues from the check above
                }

                // Coming back with the browser Back button must not leave the form locked or pre-confirmed
                window.addEventListener('pageshow', function () {
                    var form = document.getElementById('jj_rate_form');
                    if (form) {
                        resetRateForm(form);
                    }
                });
            </script>
        `;
            } catch (e) {
                log.error('error@buildConfirmScript', e);
                return '';
            }
        };

        /**
         * Builds the complete portlet HTML (styles, confirmation script, rate table and update form).
         * @param {Object} data - Portlet data
         * @param {string} data.theadContent - HTML table header row
         * @param {string} data.tbodyContent - HTML table rows
         * @param {string} data.suiteletUrl - URL of the Rate Update Suitelet
         * @param {string} data.metalOptions - Metal Type dropdown options
         * @param {string} data.currencyOptions - Currency dropdown options
         * @param {string} data.todayValue - Today's date as YYYY-MM-DD
         * @returns {string} The portlet HTML (empty when it fails)
         */
        const buildPortletHtml = (data) => {
            try {
                return `
            ${getStyles()}
            ${buildConfirmScript(data)}
            <div class="price-display">
                Daily Metal Rate Update
                <table>
                    <thead>
                        ${data.theadContent}
                    </thead>
                    <tbody>
                    ${data.tbodyContent}
                    </tbody>
                </table>

            </div>
            <form id="jj_rate_form" action="${data.suiteletUrl}" method="POST" class="form-container" onsubmit="return onRateFormSubmit(this);">
                <input type="hidden" name="confirmupdate" value="" />
                <div class="form-group">
                    <label for="metal">Metal Type:</label>
                    <select id="metal" name="metal" required>
                        ${data.metalOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label for="currency">Currency:</label>
                    <select id="currency" name="currency" required>
                        ${data.currencyOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label for="rate">Rate:</label>
                    <input type="number" id="rate" name="rate" step="any" min="0.000001" required />
                </div>
                <div class="form-group">
                    <label for="effdate">Effective Date:</label>
                    <input type="date" id="effdate" name="effdate" value="${data.todayValue}" required />
                </div>
                <div class="form-group-full" style="text-align: center;">
                    <input type="submit" value="Update Rate" class="submit-button" />
                </div>
            </form>
        `;
            } catch (e) {
                log.error('error@buildPortletHtml', e);
                return '';
            }
        };

        /**
         * Logs the error and shows its text inside the portlet so it is not blank.
         * @param {Portlet} portlet - The portlet object used for rendering
         * @param {Error} e - The caught error
         * @returns {void}
         */
        const showError = (portlet, e) => {
            try {
                log.error('error@render', e);
                portlet.html = '<div style="padding:10px;color:#c62828;font-weight:bold;">Portlet error: ' +
                    e.name + ' - ' + e.message + '</div>';
            } catch (showErrorException) {
                log.error('error@showError', showErrorException);
            }
        };

        /**
         * Portlet entry point. Builds the rate table and the Rate Update form.
         * @param {Object} params - The params parameter is a JavaScript object. It is automatically passed to the script entry
         *     point by NetSuite. The values for params are read-only.
         * @param {Portlet} params.portlet - The portlet object used for rendering
         * @param {string} params.column - Column index for the portlet on the dashboard; left column (1), center column (2) or
         *     right column (3)
         * @param {string} params.entity - (For custom portlets only) references the customer ID for the selected customer
         * @returns {void}
         */
        const render = (params) => {
            const portlet = params.portlet;
            try {
                portlet.title = ' ';

                const currencies = getCurrencies();
                const metals = getMetals();
                const currencyOptions = buildCurrencyOptions(currencies);
                const metalOptions = buildMetalOptions(metals);
                const todayValue = getTodayValue();

                addTodaysRates(currencies);
                const theadContent = buildTableHeader(metals);
                const tbodyContent = buildTableRows(currencies, metals);
                const suiteletUrl = getSuiteletUrl();

                portlet.html = buildPortletHtml({
                    theadContent: theadContent,
                    tbodyContent: tbodyContent,
                    suiteletUrl: suiteletUrl,
                    metalOptions: metalOptions,
                    currencyOptions: currencyOptions,
                    todayValue: todayValue
                });
            } catch (e) {
                showError(portlet, e);
            }
        };

        return { render };

    });