/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * 
 * ********************************************************************************************************************************
 *
 * ${RAFMO-103} : ${P2P—Develop Daily Metal Rate Update Customization in NetSuite}
 *
 * ********************************************************************************************************************************
 *
 * Author : Jobin and Jismi
 *
 * Date Created : 18-November-2026
 *
 * Description : This Suitelet receives the rate details from the Rate Update portlet, checks the user's role, validates the input and
 *               creates a Daily Metal Rate custom record. It shows a message for success, a duplicate rate or an error.
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
define(['N/log', 'N/record', 'N/runtime', 'N/search', 'N/format'],
    /**
 * @param{log} log
 * @param{record} record
 * @param{runtime} runtime
 * @param{search} search
 * @param{format} format
 */
    (log, record, runtime, search, format) => {

        const REC_TYPE = 'customrecord_jj_metal_rate';
        const ADMIN_ROLE_ID = '3'; // built-in Administrator is always allowed
        const HOME_URL = '/app/center/card.nl?sc=-29'; // NetSuite home dashboard
        const RATE_TOLERANCE = 0.000001; // rates closer than this are treated as the same rate
        const F = {
            METAL: 'custrecord_jj_mr_metal',
            CURRENCY: 'custrecord_jj_mr_currency',
            RATE: 'custrecord_jj_mr_rate',
            EFFDATE: 'custrecord_jj_mr_effdate'
        };

        /** JSON that is safe to place inside an inline <script> tag. */
        const toJs = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

        /**
         * Shows an alert. After a successful save (goHome = true) the browser is sent straight to the NetSuite home page,
         * so the portlet shows the new rate. Otherwise it goes back to the previous page.
         */
        const showMessage = (response, message, goHome) => {
            const next = goHome
                ? `try { window.top.location.href = ${toJs(HOME_URL)}; } catch (e) { window.history.back(); }`
                : 'window.history.back();';
            response.write(`<script>alert(${toJs(message)}); ${next}</script>`);
        };

        /** The current user must have a Rate Administrator role (script parameter) or be an Administrator. */
        const isAuthorized = () => {
            const roles = (runtime.getCurrentScript().getParameter({ name: 'custscript_jj_rate_admin_roles' }) || '')
                .split(',').map(r => r.trim()).concat(ADMIN_ROLE_ID);
            const currentRole = String(runtime.getCurrentUser().role);
            if (!roles.includes(currentRole)) {
                log.error('Not authorized', 'Role ' + currentRole + ' is not in the allowed roles: ' + roles.join(','));
                return false;
            }
            return true;
        };

        /** 'YYYY-MM-DD' to Date (noon avoids the date shifting across time zones). */
        const parseDate = (text) => {
            const [year, month, day] = text.split('-');
            return new Date(year, month - 1, day, 12, 0, 0);
        };

        const isSameRate = (a, b) => Math.abs(Number(a) - Number(b)) < RATE_TOLERANCE;

        /** Finds the active rate record for the same Metal Type, Currency and Effective Date, or returns null. */
        const findExistingRate = (metal, currency, effDate) => {
            const hit = search.create({
                type: REC_TYPE,
                filters: [
                    ['isinactive', 'is', 'F'], 'AND',
                    [F.METAL, 'anyof', metal], 'AND',
                    [F.CURRENCY, 'anyof', currency], 'AND',
                    [F.EFFDATE, 'on', format.format({ value: effDate, type: format.Type.DATE })]
                ],
                columns: [
                    search.createColumn({ name: 'internalid', sort: search.Sort.DESC }),
                    search.createColumn({ name: F.RATE })
                ]
            }).run().getRange({ start: 0, end: 1 })[0];

            return hit ? { id: hit.id, rate: Number(hit.getValue({ name: F.RATE })) } : null;
        };

        /** Creates the Daily Metal Rate record. */
        const createRate = (p, rate, effDate) => {
            const rec = record.create({ type: REC_TYPE, isDynamic: true });
            rec.setValue({ fieldId: F.METAL, value: p.metal });
            rec.setValue({ fieldId: F.CURRENCY, value: p.currency });
            rec.setValue({ fieldId: F.RATE, value: rate });
            rec.setValue({ fieldId: F.EFFDATE, value: effDate });
            rec.setValue({
                fieldId: 'name',
                value: 'Metal Rate ' + rec.getText({ fieldId: F.METAL }) + ',' + rec.getText({ fieldId: F.CURRENCY }) + ',' + p.effdate
            });
            const id = rec.save();
            log.debug('Daily Metal Rate created', 'Record ID: ' + id);
            return id;
        };

        /** Updates the Rate on the existing record (the User Event script validates it as an inline edit). Returns the saved rate. */
        const updateRate = (existing, newRate) => {
            record.submitFields({
                type: REC_TYPE,
                id: existing.id,
                values: { [F.RATE]: newRate },
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });
            // Read the rate back so a save that did not take effect is never reported as a success
            const savedRate = Number(search.lookupFields({ type: REC_TYPE, id: existing.id, columns: [F.RATE] })[F.RATE]);
            log.audit('Metal rate updated', JSON.stringify({
                recordId: existing.id, oldRate: existing.rate, newRate: newRate, savedRate: savedRate, userId: runtime.getCurrentUser().id
            }));
            return savedRate;
        };

        /**
         * Used when a different rate arrives without the confirmation flag (the portlet's own popup did not run).
         * Asks from this page and, on OK, posts the same values again with confirmupdate = T.
         */
        const askToConfirmUpdate = (response, p, oldRate, newRate) => {
            const question = 'A rate of ' + oldRate + ' is already saved for this Metal Type, Currency and Effective Date. ' +
                'Do you want to update it to ' + newRate + '?';
            const fields = { metal: p.metal, currency: p.currency, rate: p.rate, effdate: p.effdate, confirmupdate: 'T' };
            response.write(`
                <script>
                    var fields = ${toJs(fields)};
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
        };

        /**
         * Defines the Suitelet script trigger point.
         * @param {Object} scriptContext
         * @param {ServerRequest} scriptContext.request - Incoming request
         * @param {ServerResponse} scriptContext.response - Suitelet response
         * @since 2015.2
         */
        const onRequest = (scriptContext) => {
            const { request, response } = scriptContext;
            const p = request.parameters;
            log.debug('Suitelet request received', 'Method: ' + request.method + ', Parameters: ' + JSON.stringify(p));

            // GET from the portlet's confirmation check: returns the existing rate (if any) as JSON
            if (request.method === 'GET' && p.action === 'checkrate') {
                response.setHeader({ name: 'Content-Type', value: 'application/json' });
                try {
                    if (!isAuthorized()) {
                        response.write(JSON.stringify({ error: 'You are not authorized to update metal rates.' }));
                        return;
                    }
                    if (!p.metal || !p.currency || !p.effdate) {
                        response.write(JSON.stringify({ error: 'Please enter Metal Type, Currency and Effective Date.' }));
                        return;
                    }
                    const found = findExistingRate(p.metal, p.currency, parseDate(p.effdate));
                    response.write(JSON.stringify(found ? { exists: true, recordId: found.id, rate: found.rate } : { exists: false }));
                } catch (error) {
                    log.error('Error checking existing rate', 'Name: ' + error.name + ' | Message: ' + error.message + ' | Stack: ' + error.stack);
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

                    const rate = Number(p.rate);
                    if (!p.metal || !p.currency || !p.effdate) {
                        showMessage(response, 'Please enter Metal Type, Currency, Rate and Effective Date.');
                        return;
                    }
                    if (!rate || rate <= 0) {
                        showMessage(response, 'Rate must be greater than zero.');
                        return;
                    }

                    const effDate = parseDate(p.effdate);
                    const existing = findExistingRate(p.metal, p.currency, effDate);

                    // No rate yet for this Metal Type + Currency + Effective Date: create it
                    if (!existing) {
                        createRate(p, rate, effDate);
                        showMessage(response, 'Metal rate has been updated successfully.', true);
                        return;
                    }

                    // Same rate already saved: nothing to do
                    if (isSameRate(existing.rate, rate)) {
                        showMessage(response, 'A rate of ' + existing.rate + ' already exists for this Metal Type, Currency and Effective Date. No update needed.');
                        return;
                    }

                    // Different rate: update only after the user confirmed it
                    if (p.confirmupdate !== 'T') {
                        log.audit('Update not confirmed', 'Record ID: ' + existing.id + ', Existing rate: ' + existing.rate + ', Entered rate: ' + rate);
                        askToConfirmUpdate(response, p, existing.rate, rate);
                        return;
                    }

                    const savedRate = updateRate(existing, rate);
                    if (isSameRate(savedRate, existing.rate)) {
                        log.error('Rate update did not take effect', 'Record ID: ' + existing.id + ', Saved rate: ' + savedRate + ', Entered rate: ' + rate);
                        showMessage(response, 'The metal rate could not be updated (it is still ' + savedRate + '). Please check the Execution Log of this Suitelet.');
                        return;
                    }
                    showMessage(response, 'Metal rate has been updated from ' + existing.rate + ' to ' + savedRate + '.', true);

                } catch (error) {
                    log.error('Error updating metal rate', 'Name: ' + error.name + ' | Message: ' + error.message + ' | Stack: ' + error.stack);
                    // JJ_RATE_DUP is thrown by the User Event script (customscript_jj_ue_metal_rate)
                    const isDuplicate = error.name === 'JJ_RATE_DUP' || String(error.message || '').indexOf('JJ_RATE_DUP') !== -1;
                    showMessage(response, isDuplicate
                        ? 'A rate already exists for this Metal Type, Currency and Effective Date.'
                        : 'Error updating the metal rate. Please try again.');
                }
            }
        };

        return { onRequest };

    });