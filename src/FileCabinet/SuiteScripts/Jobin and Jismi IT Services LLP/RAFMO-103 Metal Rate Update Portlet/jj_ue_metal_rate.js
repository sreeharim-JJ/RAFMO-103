/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
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
 * Description : This User Event script validates the Daily Metal Rate record before it is saved: mandatory fields, a rate greater than
 *               zero, and no duplicate for the same Metal Type, Currency and Effective Date (JJ_RATE_DUP). It also defaults the
 *               Effective Date to today on a new record.
 *
 * REVISION HISTORY :
 *
 * @version 1.0 18-November-2026 : Created the initial build by JJ0494 
 * 
 * COPYRIGHT © 2024 Jobin & Jismi.
 * All rights reserved. This script is a proprietary product of Jobin & Jismi IT Services LLP and is protected by copyright
 * law and international treaties. Unauthorized reproduction or distribution of this script, or any portion of it,
 * may result in severe civil and criminal penalties and will be prosecuted to the maximum extent possible under law.
 * ********************************************************************************************************************************
 */
define(['N/search', 'N/error', 'N/format', 'N/runtime'],
    (search, error, format, runtime) => {

        const REC_TYPE = 'customrecord_jj_metal_rate';
        const F = {
            METAL: 'custrecord_jj_mr_metal',
            CURRENCY: 'custrecord_jj_mr_currency',
            RATE: 'custrecord_jj_mr_rate',
            EFFDATE: 'custrecord_jj_mr_effdate'
        };

        const isEmpty = (v) => v === null || v === undefined || v === '';

        /**
         * Reads a field from newRecord. On inline edit (XEDIT) NetSuite only supplies the
         * changed fields, so fall back to the old record for the rest.
         */
        const getValue = (context, fieldId) => {
            let value = context.newRecord.getValue({ fieldId });
            if (isEmpty(value) && context.type === context.UserEventType.XEDIT && context.oldRecord) {
                value = context.oldRecord.getValue({ fieldId });
            }
            return value;
        };

        /**
         * Reads the four rate fields from the record.
         * @returns {{metal, currency, rateRaw, effDate}}
         */
        const getRecordValues = (context) => {
            return {
                metal: getValue(context, F.METAL),
                currency: getValue(context, F.CURRENCY),
                rateRaw: getValue(context, F.RATE),
                effDate: getValue(context, F.EFFDATE)
            };
        };

        /**
         * Throws JJ_RATE_REQUIRED when a mandatory field is empty.
         */
        const validateMandatory = (values) => {
            const missing = [];
            if (isEmpty(values.metal)) missing.push('Metal Type');
            if (isEmpty(values.currency)) missing.push('Currency');
            if (isEmpty(values.rateRaw)) missing.push('Rate');
            if (isEmpty(values.effDate)) missing.push('Effective Date');
            if (missing.length) {
                throw error.create({
                    name: 'JJ_RATE_REQUIRED',
                    message: 'JJ_RATE_REQUIRED: Please enter a value for: ' + missing.join(', ') + '.',
                    notifyOff: true
                });
            }
        };

        /**
         * Throws JJ_RATE_INVALID unless the rate is a number greater than zero.
         * @returns {number} the rate as a number
         */
        const validateRate = (rateRaw) => {
            const rate = Number(rateRaw);
            if (!isFinite(rate) || rate <= 0) {
                throw error.create({
                    name: 'JJ_RATE_INVALID',
                    message: 'JJ_RATE_INVALID: Rate must be greater than zero.',
                    notifyOff: true
                });
            }
            return rate;
        };

        /**
         * @returns {boolean} true if another active record has the same metal + currency + date
         */
        const isDuplicate = (currentId, metal, currency, effDate) => {
            const filters = [
                ['isinactive', 'is', 'F'], 'AND',
                [F.METAL, 'anyof', metal], 'AND',
                [F.CURRENCY, 'anyof', currency], 'AND',
                [F.EFFDATE, 'on', format.format({ value: effDate, type: format.Type.DATE })]
            ];
            // Exclude the record being edited
            if (currentId) {
                filters.push('AND', ['internalid', 'noneof', currentId]);
            }
            const hits = search.create({ type: REC_TYPE, filters, columns: ['internalid'] })
                .run().getRange({ start: 0, end: 1 });
            log.debug('Duplicate check', 'Metal: ' + metal + ', Currency: ' + currency + ', Date: ' + effDate + ', Matches found: ' + hits.length);
            return hits.length > 0;
        };

        /**
         * Throws JJ_RATE_DUP when a duplicate exists (current record excluded when editing).
         */
        const validateDuplicate = (context, values) => {
            if (isDuplicate(context.newRecord.id, values.metal, values.currency, values.effDate)) {
                throw error.create({
                    name: 'JJ_RATE_DUP',
                    message: 'JJ_RATE_DUP: A rate already exists for this Metal Type, Currency and Effective Date.',
                    notifyOff: true
                });
            }
        };

        /**
         * Writes the success entry to the audit log.
         */
        const logValidated = (context, values, rate) => {
            log.audit('Metal rate validated', JSON.stringify({
                recordId: context.newRecord.id || 'new',
                eventType: context.type,
                metal: values.metal,
                currency: values.currency,
                rate: rate,
                effectiveDate: format.format({ value: values.effDate, type: format.Type.DATE })
            }));
        };

        /**
         * Logs an error with its name, message and stack.
         */
        const logError = (title, e) => {
            log.error(title, 'Name: ' + e.name + ' | Message: ' + e.message + ' | Stack: ' + e.stack);
        };

        /**
         * Default the Effective Date to today when a new record form is opened.
         * @param {Object} context
         * @param {Record} context.newRecord - New record
         * @param {string} context.type - Trigger type; use values from the context.UserEventType enum
         * @since 2015.2
         */
        const beforeLoad = (context) => {
            try {
                if (context.type === context.UserEventType.CREATE &&
                    runtime.executionContext === runtime.ContextType.USER_INTERFACE) {
                    context.newRecord.setValue({ fieldId: F.EFFDATE, value: new Date() });
                }
                log.debug('beforeLoad', 'Type: ' + context.type + ', Context: ' + runtime.executionContext);
            } catch (e) {
                logError('beforeLoad - default date failed', e);
            }
        };

        /**
         * Validates the record before it is saved (create, edit, inline edit, copy).
         * @param {Object} context
         * @param {Record} context.newRecord - New record
         * @param {Record} context.oldRecord - Old record
         * @param {string} context.type - Trigger type; use values from the context.UserEventType enum
         * @since 2015.2
         */
        const beforeSubmit = (context) => {
            const T = context.UserEventType;
            if (![T.CREATE, T.EDIT, T.XEDIT, T.COPY].includes(context.type)) return;

            try {
                log.debug('beforeSubmit started', 'Type: ' + context.type + ', Record ID: ' + (context.newRecord.id || 'new'));

                const values = getRecordValues(context);
                validateMandatory(values);                       // 1. Mandatory fields
                const rate = validateRate(values.rateRaw);       // 2. Rate > 0
                validateDuplicate(context, values);              // 3. Duplicate check
                logValidated(context, values, rate);
            } catch (e) {
                // Log every validation / unexpected error, then re-throw so the save is still blocked
                logError('beforeSubmit error', e);
                throw e;
            }
        };

        return { beforeLoad, beforeSubmit };
    });