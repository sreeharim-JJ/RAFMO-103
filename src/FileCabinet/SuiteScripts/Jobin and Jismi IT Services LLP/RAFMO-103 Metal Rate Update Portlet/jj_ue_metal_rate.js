/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
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
 * Description : This User Event script validates the Daily Metal Rate record before it is saved: mandatory fields, a rate greater than
 *               zero, and no duplicate for the same Metal Type, Currency and Effective Date (JJ_RATE_DUP). The Effective Date
 *               default (today) is set on the custom record field itself (Validation & Defaulting), not in this script.
 *
 * REVISION HISTORY :
 *
 * @version 1.0 RAFMO-103 : 18-November-2026 : Created the initial build by JJ0494
 *
 * *********************************************************************************************************************************
 */
define(['N/search', 'N/error', 'N/format'],
    /**
     * @param {search} search
     * @param {error} error
     * @param {format} format
     */
    (search, error, format) => {
        'use strict';

        const REC_TYPE = 'customrecord_jj_metal_rate';
        const FIELDS = {
            METAL: 'custrecord_jj_mr_metal',
            CURRENCY: 'custrecord_jj_mr_currency',
            RATE: 'custrecord_jj_mr_rate',
            EFFDATE: 'custrecord_jj_mr_effdate'
        };

        /**
         * Checks whether a value is empty.
         * @param {*} value - The value to check
         * @returns {boolean} True when the value is null, undefined or an empty string
         */
        const isEmpty = (value) => value === null || value === undefined || value === '';

        /**
         * Reads a field from newRecord. On inline edit (XEDIT) NetSuite only supplies the
         * changed fields, so fall back to the old record for the rest.
         * @param {Object} context - User Event context
         * @param {string} fieldId - Internal ID of the field
         * @returns {*} The field value, or null when it cannot be read (the mandatory check then blocks the save)
         */
        const getValue = (context, fieldId) => {
            try {
                let value = context.newRecord.getValue({ fieldId });
                if (isEmpty(value) && context.type === context.UserEventType.XEDIT && context.oldRecord) {
                    value = context.oldRecord.getValue({ fieldId });
                }
                return value;
            } catch (e) {
                log.error('error@getValue', e);
                return null;
            }
        };

        /**
         * Reads the four rate fields from the record.
         * @param {Object} context - User Event context
         * @returns {{metal: *, currency: *, rateRaw: *, effDate: *}} The field values (null when they cannot be read)
         */
        const getRecordValues = (context) => {
            try {
                return {
                    metal: getValue(context, FIELDS.METAL),
                    currency: getValue(context, FIELDS.CURRENCY),
                    rateRaw: getValue(context, FIELDS.RATE),
                    effDate: getValue(context, FIELDS.EFFDATE)
                };
            } catch (e) {
                log.error('error@getRecordValues', e);
                return { metal: null, currency: null, rateRaw: null, effDate: null };
            }
        };

        /**
         * Checks that all mandatory fields have a value. It throws on purpose, to block the save.
         * @param {{metal: *, currency: *, rateRaw: *, effDate: *}} values - Values from getRecordValues
         * @returns {void}
         * @throws {Error} JJ_RATE_REQUIRED when Metal Type, Currency, Rate or Effective Date is empty
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
         * Checks that the rate is a number greater than zero. It throws on purpose, to block the save.
         * @param {number|string} rateRaw - The rate as entered
         * @returns {number} The rate as a number
         * @throws {Error} JJ_RATE_INVALID when the rate is not a number greater than zero
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
         * Checks whether another active record has the same Metal Type, Currency and Effective Date.
         * The error is logged and thrown again, because a failed search must never be read as "no duplicate".
         * @param {string|number} currentId - Internal ID of the record being saved (empty on create)
         * @param {string|number} metal - Internal ID of the Metal Type
         * @param {string|number} currency - Internal ID of the currency
         * @param {Date} effDate - Effective Date
         * @returns {boolean} True when a duplicate exists
         * @throws {Error} Any error raised by the search
         */
        const isDuplicate = (currentId, metal, currency, effDate) => {
            try {
                const filters = [
                    ['isinactive', 'is', 'F'], 'AND',
                    [FIELDS.METAL, 'anyof', metal], 'AND',
                    [FIELDS.CURRENCY, 'anyof', currency], 'AND',
                    [FIELDS.EFFDATE, 'on', format.format({ value: effDate, type: format.Type.DATE })]
                ];
                // Exclude the record being edited
                if (currentId) {
                    filters.push('AND', ['internalid', 'noneof', currentId]);
                }
                const duplicateResults = search.create({ type: REC_TYPE, filters, columns: ['internalid'] })
                    .run().getRange({ start: 0, end: 1 });
                return duplicateResults.length > 0;
            } catch (e) {
                log.error('error@isDuplicate', e);
                throw e;
            }
        };

        /**
         * Checks that no duplicate exists (current record excluded when editing). It throws on purpose, to block the save.
         * @param {Object} context - User Event context
         * @param {{metal: *, currency: *, rateRaw: *, effDate: *}} values - Values from getRecordValues
         * @returns {void}
         * @throws {Error} JJ_RATE_DUP when a duplicate exists
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
         * Writes the success entry to the audit log. A logging problem never blocks the save.
         * @param {Object} context - User Event context
         * @param {{metal: *, currency: *, rateRaw: *, effDate: *}} values - Values from getRecordValues
         * @param {number} rate - The validated rate
         * @returns {void}
         */
        const logValidated = (context, values, rate) => {
            try {
                log.audit('Metal rate validated', JSON.stringify({
                    recordId: context.newRecord.id || 'new',
                    eventType: context.type,
                    metal: values.metal,
                    currency: values.currency,
                    rate: rate,
                    effectiveDate: format.format({ value: values.effDate, type: format.Type.DATE })
                }));
            } catch (e) {
                log.error('error@logValidated', e);
            }
        };

        /**
         * Logs an error with the standard title error@<functionName>.
         * @param {string} functionName - Name of the function where the error happened
         * @param {Error} e - The caught error
         * @returns {void}
         */
        const logError = (functionName, e) => {
            log.error('error@' + functionName, e);
        };

        /**
         * Validates the record before it is saved (create, edit, inline edit, copy).
         * Any validation error is logged and thrown again, so the save is blocked.
         * @param {Object} context
         * @param {Record} context.newRecord - New record
         * @param {Record} context.oldRecord - Old record
         * @param {string} context.type - Trigger type; use values from the context.UserEventType enum
         * @returns {void}
         * @throws {Error} JJ_RATE_REQUIRED, JJ_RATE_INVALID or JJ_RATE_DUP
         */
        const beforeSubmit = (context) => {
            const eventTypes = context.UserEventType;
            if (![eventTypes.CREATE, eventTypes.EDIT, eventTypes.XEDIT, eventTypes.COPY].includes(context.type)) return;

            try {
                const values = getRecordValues(context);
                validateMandatory(values);                       // 1. Mandatory fields
                const rate = validateRate(values.rateRaw);       // 2. Rate > 0
                validateDuplicate(context, values);              // 3. Duplicate check
                logValidated(context, values, rate);
            } catch (e) {
                // Log every validation / unexpected error, then re-throw so the save is still blocked
                logError('beforeSubmit', e);
                throw e;
            }
        };

        return { beforeSubmit };
    });