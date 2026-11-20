/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
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
 * Description : This Suitelet receives the rate details from the Rate Update portlet, checks the user's role, validates the input and
 *               creates a Daily Metal Rate custom record. It shows a message for success, a duplicate rate or an error.
 *
 * REVISION HISTORY :
 *
 * @version 1.0 RAFMO-103 : 18-November-2026 : Created the initial build by JJ0494
 *
 * *********************************************************************************************************************************
 */
define(['N/log', 'N/record', 'N/runtime', 'N/search', 'N/format'],
    /**
     * @param {log} log
     * @param {record} record
     * @param {runtime} runtime
     * @param {search} search
     * @param {format} format
     */
    (log, record, runtime, search, format) => {
        'use strict';

        const REC_TYPE = 'customrecord_jj_metal_rate';
        const ADMIN_ROLE_ID = '3'; // built-in Administrator is always allowed
        const HOME_URL = '/app/center/card.nl?sc=-29'; // NetSuite home dashboard
        const RATE_TOLERANCE = 0.000001; // rates closer than this are treated as the same rate
        const FIELDS = {
            METAL: 'custrecord_jj_mr_metal',
            CURRENCY: 'custrecord_jj_mr_currency',
            RATE: 'custrecord_jj_mr_rate',
            EFFDATE: 'custrecord_jj_mr_effdate'
        };

        /**
         * Converts a value to JSON that is safe to place inside an inline script tag ("<" is escaped).
         * @param {*} value - Any JSON-serialisable value
         * @returns {string} The JSON text
         */
        const toJs = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

        /**
         * Shows an alert. After a successful save (goHome = true) the browser is sent straight to the NetSuite home page,
         * so the portlet shows the new rate. Otherwise it goes back to the previous page.
         * @param {ServerResponse} response - Suitelet response
         * @param {string} message - Text shown in the alert
         * @param {boolean} [goHome=false] - True to open the NetSuite home page after the alert
         * @returns {void}
         */
        const showMessage = (response, message, goHome) => {
            try {
                const next = goHome
                    ? `try { window.top.location.href = ${toJs(HOME_URL)}; } catch (e) { window.history.back(); }`
                    : 'window.history.back();';
                response.write(`<script>alert(${toJs(message)}); ${next}</script>`);
            } catch (e) {
                log.error('error@showMessage', e);
            }
        };

        /**
         * Checks that the current user has a Rate Administrator role (script parameter) or is an Administrator.
         * @returns {boolean} True when the user is allowed; false when not allowed or when the check fails
         */
        const isAuthorized = () => {
            try {
                const allowedRoles = (runtime.getCurrentScript().getParameter({ name: 'custscript_jj_rate_admin_roles' }) || '')
                    .split(',').map(roleId => roleId.trim()).concat(ADMIN_ROLE_ID);
                const currentRole = String(runtime.getCurrentUser().role);
                if (!allowedRoles.includes(currentRole)) {
                    log.error('Not authorized', 'Role ' + currentRole + ' is not in the allowed roles: ' + allowedRoles.join(','));
                    return false;
                }
                return true;
            } catch (e) {
                log.error('error@isAuthorized', e);
                return false;
            }
        };

        /**
         * Converts 'YYYY-MM-DD' text to a Date (noon avoids the date shifting across time zones).
         * @param {string} dateText - Date in YYYY-MM-DD format
         * @returns {Date|null} The date, or null when the text is not a valid date
         */
        const parseDate = (dateText) => {
            try {
                const [year, month, day] = dateText.split('-');
                const parsedDate = new Date(year, month - 1, day, 12, 0, 0);
                return isNaN(parsedDate.getTime()) ? null : parsedDate;
            } catch (e) {
                log.error('error@parseDate', e);
                return null;
            }
        };

        /**
         * Compares two rates, ignoring differences smaller than RATE_TOLERANCE.
         * @param {number|string} existingRate - The rate already saved
         * @param {number|string} newRate - The rate entered by the user
         * @returns {boolean} True when both rates are treated as the same
         */
        const isSameRate = (existingRate, newRate) => Math.abs(Number(existingRate) - Number(newRate)) < RATE_TOLERANCE;

        /**
         * Finds the active rate record for the same Metal Type, Currency and Effective Date.
         * The error is logged and thrown again, because "no rate found" and "search failed" must not look the same.
         * @param {string} metal - Internal ID of the Metal Type
         * @param {string} currency - Internal ID of the currency
         * @param {Date} effDate - Effective Date
         * @returns {{id: string, rate: number}|null} The existing record's ID and rate, or null when none exists
         * @throws {Error} Any error raised by the search
         */
        const findExistingRate = (metal, currency, effDate) => {
            try {
                const rateResult = search.create({
                    type: REC_TYPE,
                    filters: [
                        ['isinactive', 'is', 'F'], 'AND',
                        [FIELDS.METAL, 'anyof', metal], 'AND',
                        [FIELDS.CURRENCY, 'anyof', currency], 'AND',
                        [FIELDS.EFFDATE, 'on', format.format({ value: effDate, type: format.Type.DATE })]
                    ],
                    columns: [
                        search.createColumn({ name: 'internalid', sort: search.Sort.DESC }),
                        search.createColumn({ name: FIELDS.RATE })
                    ]
                }).run().getRange({ start: 0, end: 1 })[0];

                return rateResult ? { id: rateResult.id, rate: Number(rateResult.getValue({ name: FIELDS.RATE })) } : null;
            } catch (e) {
                log.error('error@findExistingRate', e);
                throw e;
            }
        };

        /**
         * Creates the Daily Metal Rate record. The error is logged and thrown again, so onRequest can tell the user
         * about a duplicate (JJ_RATE_DUP from the User Event script) instead of reporting a false success.
         * @param {Object} params - Request parameters from the portlet
         * @param {string} params.metal - Internal ID of the Metal Type
         * @param {string} params.currency - Internal ID of the currency
         * @param {string} params.effdate - Effective Date as YYYY-MM-DD (used in the record name)
         * @param {number} rate - The rate to save
         * @param {Date} effDate - Effective Date
         * @returns {number} Internal ID of the new record
         * @throws {Error} JJ_RATE_REQUIRED, JJ_RATE_INVALID or JJ_RATE_DUP from the User Event script, or any save error
         */
        const createRate = (params, rate, effDate) => {
            try {
                const rateRecord = record.create({ type: REC_TYPE, isDynamic: true });
                rateRecord.setValue({ fieldId: FIELDS.METAL, value: params.metal });
                rateRecord.setValue({ fieldId: FIELDS.CURRENCY, value: params.currency });
                rateRecord.setValue({ fieldId: FIELDS.RATE, value: rate });
                rateRecord.setValue({ fieldId: FIELDS.EFFDATE, value: effDate });
                rateRecord.setValue({
                    fieldId: 'name',
                    value: 'Metal Rate ' + rateRecord.getText({ fieldId: FIELDS.METAL }) + ',' + rateRecord.getText({ fieldId: FIELDS.CURRENCY }) + ',' + params.effdate
                });
                const recordId = rateRecord.save();
                log.audit('Metal rate created', JSON.stringify({
                    recordId: recordId, metal: params.metal, currency: params.currency, rate: rate,
                    effectiveDate: params.effdate, userId: runtime.getCurrentUser().id
                }));
                return recordId;
            } catch (e) {
                log.error('error@createRate', e);
                throw e;
            }
        };

        /**
         * Updates the Rate on the existing record (the User Event script validates it as an inline edit) and reads it back,
         * so a save that did not take effect is never reported as a success. The error is logged and thrown again.
         * @param {{id: string, rate: number}} existing - The record found by findExistingRate
         * @param {number} newRate - The rate to save
         * @returns {number} The rate as saved on the record
         * @throws {Error} JJ_RATE_REQUIRED, JJ_RATE_INVALID or JJ_RATE_DUP from the User Event script, or any save error
         */
        const updateRate = (existing, newRate) => {
            try {
                record.submitFields({
                    type: REC_TYPE,
                    id: existing.id,
                    values: { [FIELDS.RATE]: newRate },
                    options: { enableSourcing: false, ignoreMandatoryFields: true }
                });
                const savedRate = Number(search.lookupFields({ type: REC_TYPE, id: existing.id, columns: [FIELDS.RATE] })[FIELDS.RATE]);
                log.audit('Metal rate updated', JSON.stringify({
                    recordId: existing.id, oldRate: existing.rate, newRate: newRate, savedRate: savedRate, userId: runtime.getCurrentUser().id
                }));
                return savedRate;
            } catch (e) {
                log.error('error@updateRate', e);
                throw e;
            }
        };

        /**
         * Used when a different rate arrives without the confirmation flag (the portlet's own popup did not run).
         * Asks from this page and, on OK, posts the same values again with confirmupdate = T.
         * @param {ServerResponse} response - Suitelet response
         * @param {Object} params - Request parameters from the portlet
         * @param {string} params.metal - Internal ID of the Metal Type
         * @param {string} params.currency - Internal ID of the currency
         * @param {string} params.rate - The rate entered by the user
         * @param {string} params.effdate - Effective Date as YYYY-MM-DD
         * @param {number} oldRate - The rate already saved
         * @param {number} newRate - The rate entered by the user
         * @returns {void}
         */
        const askToConfirmUpdate = (response, params, oldRate, newRate) => {
            try {
                const question = 'A rate of ' + oldRate + ' is already saved for this Metal Type, Currency and Effective Date. ' +
                    'Do you want to update it to ' + newRate + '?';
                const formFields = { metal: params.metal, currency: params.currency, rate: params.rate, effdate: params.effdate, confirmupdate: 'T' };
                response.write(`
                    <script>
                        var fields = ${toJs(formFields)};
                        if (confirm(${toJs(question)})) {
                            var form = document.createElement('form');
                            form.method = 'POST';
                            form.action = window.location.href;
                            Object.keys(fields).forEach(function (name) {
                                var input = document.createElement('input');
                                input.type = 'hidden';
                                input.name = name;
                                input.value = fields[name];
                                form.appendChild(input);
                            });
                            document.documentElement.appendChild(form);
                            form.submit();
                        } else {
                            window.history.back();
                        }
                    </script>
                `);
            } catch (e) {
                log.error('error@askToConfirmUpdate', e);
                showMessage(response, 'Could not ask for the update confirmation. Please try again.');
            }
        };

        /**
         * Suitelet entry point. Handles the portlet's confirmation check (GET, action = checkrate) and the rate
         * save (POST): create a new rate, or update the existing one after confirmation.
         * @param {Object} scriptContext
         * @param {ServerRequest} scriptContext.request - Incoming request
         * @param {ServerResponse} scriptContext.response - Suitelet response
         * @returns {void}
         */
        const onRequest = (scriptContext) => {
            const { request, response } = scriptContext;
            const params = request.parameters;

            // GET from the portlet's confirmation check: returns the existing rate (if any) as JSON
            if (request.method === 'GET' && params.action === 'checkrate') {
                response.setHeader({ name: 'Content-Type', value: 'application/json' });
                try {
                    if (!isAuthorized()) {
                        response.write(JSON.stringify({ error: 'You are not authorized to update metal rates.' }));
                        return;
                    }
                    if (!params.metal || !params.currency || !params.effdate) {
                        response.write(JSON.stringify({ error: 'Please enter Metal Type, Currency and Effective Date.' }));
                        return;
                    }
                    const effDate = parseDate(params.effdate);
                    if (!effDate) {
                        response.write(JSON.stringify({ error: 'Please enter a valid Effective Date.' }));
                        return;
                    }
                    const found = findExistingRate(params.metal, params.currency, effDate);
                    response.write(JSON.stringify(found ? { exists: true, recordId: found.id, rate: found.rate } : { exists: false }));
                } catch (e) {
                    log.error('error@onRequest (checkrate)', e);
                    response.write(JSON.stringify({ error: 'Could not check the existing rate. Please try again.' }));
                }
                return;
            }

            // POST from the portlet: create a new rate, or update the existing one after confirmation
            if (request.method === 'POST') {
                try {
                    if (!isAuthorized()) {
                        showMessage(response, 'You are not authorized to update metal rates.');
                        return;
                    }

                    const rate = Number(params.rate);
                    if (!params.metal || !params.currency || !params.effdate) {
                        showMessage(response, 'Please enter Metal Type, Currency, Rate and Effective Date.');
                        return;
                    }
                    if (!rate || rate <= 0) {
                        showMessage(response, 'Rate must be greater than zero.');
                        return;
                    }

                    const effDate = parseDate(params.effdate);
                    if (!effDate) {
                        showMessage(response, 'Please enter a valid Effective Date.');
                        return;
                    }
                    const existing = findExistingRate(params.metal, params.currency, effDate);

                    // No rate yet for this Metal Type + Currency + Effective Date: create it
                    if (!existing) {
                        createRate(params, rate, effDate);
                        showMessage(response, 'Metal rate has been updated successfully.', true);
                        return;
                    }

                    // Same rate already saved: nothing to do
                    if (isSameRate(existing.rate, rate)) {
                        showMessage(response, 'A rate of ' + existing.rate + ' already exists for this Metal Type, Currency and Effective Date. No update needed.');
                        return;
                    }

                    // Different rate: update only after the user confirmed it
                    if (params.confirmupdate !== 'T') {
                        log.audit('Update not confirmed', 'Record ID: ' + existing.id + ', Existing rate: ' + existing.rate + ', Entered rate: ' + rate);
                        askToConfirmUpdate(response, params, existing.rate, rate);
                        return;
                    }

                    const savedRate = updateRate(existing, rate);
                    if (isSameRate(savedRate, existing.rate)) {
                        log.error('Rate update did not take effect', 'Record ID: ' + existing.id + ', Saved rate: ' + savedRate + ', Entered rate: ' + rate);
                        showMessage(response, 'The metal rate could not be updated (it is still ' + savedRate + '). Please check the Execution Log of this Suitelet.');
                        return;
                    }
                    showMessage(response, 'Metal rate has been updated from ' + existing.rate + ' to ' + savedRate + '.', true);

                } catch (e) {
                    log.error('error@onRequest', e);
                    // JJ_RATE_DUP is thrown by the User Event script (customscript_jj_ue_metal_rate)
                    const isDuplicateError = e.name === 'JJ_RATE_DUP' || String(e.message || '').indexOf('JJ_RATE_DUP') !== -1;
                    showMessage(response, isDuplicateError
                        ? 'A rate already exists for this Metal Type, Currency and Effective Date.'
                        : 'Error updating the metal rate. Please try again.');
                }
            }
        };

        return { onRequest };

    });