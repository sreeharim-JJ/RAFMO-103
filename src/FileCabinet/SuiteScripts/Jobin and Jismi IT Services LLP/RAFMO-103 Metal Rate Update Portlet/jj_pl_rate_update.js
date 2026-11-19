/**
 * @NApiVersion 2.1
 * @NScriptType Portlet
 * *********************************************************************************************************************************
 *
 * ${RAFMO-103} : ${P2P—Develop Daily Metal Rate Update Customization in NetSuite}
 *
 * ********************************************************************************************************************************
 *
 * Author : Jobin and Jismi
 *
 * Date Created : 18-November-2026
 *
 * Description : This Portlet script shows the Rate Update form on the Rate Administrator's dashboard (Metal Type, Currency, Rate,
 *               Effective Date) and posts the entered details to the Rate Update Suitelet. It also lists today's saved rate for
 *               each currency from the Daily Metal Rate custom record.
 *
 * REVISION HISTORY :
 *
 * @version 1.0 18-November-2026 : Created the initial build by JJ0494
 * 
 * 
 * COPYRIGHT © 2024 Jobin & Jismi.
 * All rights reserved. This script is a proprietary product of Jobin & Jismi IT Services LLP and is protected by copyright
 * law and international treaties. Unauthorized reproduction or distribution of this script, or any portion of it,
 * may result in severe civil and criminal penalties and will be prosecuted to the maximum extent possible under law.
 * ********************************************************************************************************************************
 */
define(['N/record', 'N/search', 'N/ui/serverWidget', 'N/url', 'N/format', 'N/runtime'],
    /**
 * @param{record} record
 * @param{search} search
 * @param{serverWidget} serverWidget
 * @param{url} url
 * @param{format} format
 * @param{runtime} runtime
 */
    function (record, search, serverWidget, url, format, runtime) {

        const REC_TYPE = 'customrecord_jj_metal_rate';
        const METAL_LIST_ID = 'customlist_jj_mr_metal_type'; // change the list ID if different
        const SUITELET_SCRIPT_ID = 'customscript_jj_sl_rate_update';
        const SUITELET_DEPLOYMENT_ID = 'customdeploy_jj_sl_rate_update';

        /**
         * Today's date as YYYY-MM-DD for the Effective Date field.
         * @returns {string}
         */
        const getTodayValue = () => {
            const today = format.parse({ value: format.format({ value: new Date(), type: format.Type.DATE }), type: format.Type.DATE });
            const todayValue = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
            log.debug('Default effective date', todayValue);
            return todayValue;
        };

        /**
         * Fetches all active currencies.
         * @returns {Array<{currencyId, currencyName, currencySymbol}>}
         */
        const getCurrencies = () => {
            const currencies = [];
            search.create({
                type: 'currency',
                filters: ["isinactive","is","F"],
                columns: [
                    search.createColumn({ name: "internalid", sort: search.Sort.ASC, label: "Internal ID" }),
                    search.createColumn({ name: "name", label: "Currency Name" }),
                    search.createColumn({ name: "symbol", label: "Symbol" })
                ]
            }).run().each((result) => {
                currencies.push({
                    currencyId: result.getValue('internalid'),
                    currencyName: result.getValue('name'),
                    currencySymbol: result.getValue('symbol')
                });
                return true; // Continue iterating
            });
            log.debug('Currencies loaded', 'Count: ' + currencies.length);
            return currencies;
        };

        /**
         * Builds the Currency dropdown options.
         * @returns {string} HTML option tags
         */
        const buildCurrencyOptions = (currencies) => {
            return currencies.map(item => `<option value="${item.currencyId}">${item.currencyName}</option>`).join('');
        };

        /**
         * Builds the Metal Type dropdown options from the custom list.
         * @returns {string} HTML option tags
         */
        const buildMetalOptions = () => {
            let metalOptions = '';
            let metalCount = 0;
            search.create({
                type: METAL_LIST_ID,
                filters: ["isinactive","is","F"],
                columns: [
                    search.createColumn({ name: "name", sort: search.Sort.ASC, label: "Metal Type" })
                ]
            }).run().each((result) => {
                metalOptions += `<option value="${result.id}">${result.getValue('name')}</option>`;
                metalCount++;
                return true; // Continue iterating
            });
            log.debug('Metal types loaded', 'Count: ' + metalCount);
            return metalOptions;
        };

        /**
         * Formats a rate with commas and 2 decimals.
         * @returns {string}
         */
        const formatRate = (rate) => {
            return rate ? new Intl.NumberFormat('en-US', {
                style: 'decimal',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(rate) : 'Not Available';
        };

        /**
         * Adds today's rate (goldPrice) to each currency entry, using the first rate found per currency.
         */
        const addTodaysRates = (currencies) => {
            search.create({
                type: REC_TYPE,
                columns: [
                    search.createColumn({ name: "internalid", sort: search.Sort.DESC, label: "internalid" }),
                    search.createColumn({ name: "custrecord_jj_mr_currency", label: "Currency" }),
                    search.createColumn({ name: "custrecord_jj_mr_rate", label: "Metal Rate" })
                ],
                filters: [
                    ['isinactive', 'is', 'F'],
                    'AND',
                    ["custrecord_jj_mr_effdate", "within", "today"]
                ]
            }).run().each(result => {
                const currency = result.getValue({ name: 'custrecord_jj_mr_currency' });
                const rate = result.getValue({ name: 'custrecord_jj_mr_rate' });

                // Show the first rate found per currency in the table
                const currencyEntry = currencies.find(entry => entry.currencyId === currency);
                if (currencyEntry && !currencyEntry.hasOwnProperty('goldPrice')) {
                    currencyEntry.goldPrice = formatRate(rate);
                }
                return true; // Continue iteration
            });
            log.debug('Updated Todays Rate List', JSON.stringify(currencies));
        };

        /**
         * Builds the table rows showing today's rate per currency.
         * @returns {string} HTML table rows
         */
        const buildTableRows = (currencies) => {
            return currencies.map(item => `
                <tr>
                    <td>${item.currencyName} (${item.currencySymbol})</td>
                    <td class= "td-price">${item.goldPrice || 'Not Available'}</td>
                </tr>
            `).join('');
        };

        /**
         * Resolves the URL of the Rate Update Suitelet.
         * @returns {string}
         */
        const getSuiteletUrl = () => {
            const suiteletUrl = url.resolveScript({
                scriptId: SUITELET_SCRIPT_ID,
                deploymentId: SUITELET_DEPLOYMENT_ID,
                returnExternalUrl: false
            });
            log.debug('Suitelet URL resolved', suiteletUrl);
            return suiteletUrl;
        };

        /**
         * CSS for the portlet.
         * @returns {string}
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
                .td-price {
                    text-align: right;
                }
            </style>
        `;

        /**
         * Builds the browser script. On submit it asks the Suitelet whether a rate already exists for the same
         * Metal Type, Currency and Effective Date. If it exists with a different rate, a confirmation popup is shown and the
         * form is posted (with confirmupdate = T) only when the user clicks OK.
         * @returns {string} HTML script tag
         */
        const buildConfirmScript = (data) => `
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

        /**
         * Builds the complete portlet HTML (styles, confirmation script, rate table and update form).
         * @returns {string}
         */
        const buildPortletHtml = (data) => `
            ${getStyles()}
            ${buildConfirmScript(data)}
            <div class="price-display">
                Daily Metal Rate Update
                <table>
                    <thead>
                        <tr>
                            <th>Currency</th>
                            <th>Price</th>
                        </tr>
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

        /**
         * Shows the error text inside the portlet so it is not blank.
         */
        const showError = (portlet, error) => {
            log.error('Error in Portlet Script', 'Name: ' + error.name + ' | Message: ' + error.message + ' | Stack: ' + error.stack);
            portlet.html = '<div style="padding:10px;color:#c62828;font-weight:bold;">Portlet error: ' +
                error.name + ' - ' + error.message + '</div>';
        };

        /**
         * Defines the Portlet script trigger point.
         * @param {Object} params - The params parameter is a JavaScript object. It is automatically passed to the script entry
         *     point by NetSuite. The values for params are read-only.
         * @param {Portlet} params.portlet - The portlet object used for rendering
         * @param {string} params.column - Column index forthe portlet on the dashboard; left column (1), center column (2) or
         *     right column (3)
         * @param {string} params.entity - (For custom portlets only) references the customer ID for the selected customer
         * @since 2015.2
         */
        const render = (params) => {
            const portlet = params.portlet;
            try {
                portlet.title = ' ';
                log.debug('Portlet render started', 'User: ' + runtime.getCurrentUser().id + ', Role: ' + runtime.getCurrentUser().role);

                const currencies = getCurrencies();
                const currencyOptions = buildCurrencyOptions(currencies);
                const metalOptions = buildMetalOptions();
                const todayValue = getTodayValue();

                addTodaysRates(currencies);
                const tbodyContent = buildTableRows(currencies);
                const suiteletUrl = getSuiteletUrl();

                portlet.html = buildPortletHtml({
                    tbodyContent: tbodyContent,
                    suiteletUrl: suiteletUrl,
                    metalOptions: metalOptions,
                    currencyOptions: currencyOptions,
                    todayValue: todayValue
                });
                log.debug('Portlet render completed', 'HTML length: ' + portlet.html.length);
            } catch (error) {
                showError(portlet, error);
            }
        };

        return { render };

    });
