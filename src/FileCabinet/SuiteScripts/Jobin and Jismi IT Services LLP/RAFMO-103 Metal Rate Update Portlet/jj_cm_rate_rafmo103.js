/**
 * @NApiVersion 2.1
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
 * Description : Shared custom module for the Purchase Order and Vendor Bill customizations. getLatestRate(metalType, currencyId,
 *               asOfDate) returns the latest Daily Metal Rate on or before the given date, or throws JJ_RATE_MISSING when
 *               none exists.
 *
 * Usage :
 *   define(['./jj_cm_rate_rafmo103'], (rateLib) => {
 *       const rate = rateLib.getLatestRate(metalId, currencyId, new Date());
 *   });
 *
 * REVISION HISTORY :
 *
 * @version 1.0 RAFMO-103 : 18-November-2026 : Created the initial build by JJ0494
 *
 * *********************************************************************************************************************************
 */
define(['N/search', 'N/format', 'N/error'],
    /**
     * @param {search} search
     * @param {format} format
     * @param {error} error
     */
    (search, format, error) => {
        'use strict';

        const REC_TYPE = 'customrecord_jj_metal_rate';

        /**
         * Checks that all arguments of getLatestRate are present. It throws on purpose, to stop the caller.
         * @param {string|number} metalType - Internal ID of the Metal Type list value
         * @param {string|number} currencyId - Internal ID of the currency
         * @param {Date|string} asOfDate - Date, or a string in the user's NetSuite date format
         * @returns {void}
         * @throws {Error} JJ_RATE_BAD_PARAMS when an argument is missing
         */
        const validateParams = (metalType, currencyId, asOfDate) => {
            if (!metalType || !currencyId || !asOfDate) {
                log.error('getLatestRate - bad parameters', 'Metal: ' + metalType + ', Currency: ' + currencyId + ', As of: ' + asOfDate);
                throw error.create({
                    name: 'JJ_RATE_BAD_PARAMS',
                    message: 'JJ_RATE_BAD_PARAMS: metalType, currencyId and asOfDate are all required.',
                    notifyOff: true
                });
            }
        };

        /**
         * Returns the date as text in the user's NetSuite date format.
         * The error is logged and thrown again, because an empty date would make the rate search meaningless.
         * @param {Date|string} asOfDate - Date, or a string already in the user's NetSuite date format
         * @returns {string} The date as text
         * @throws {Error} Any error raised while formatting the date
         */
        const formatAsOfDate = (asOfDate) => {
            try {
                return (asOfDate instanceof Date)
                    ? format.format({ value: asOfDate, type: format.Type.DATE })
                    : asOfDate;
            } catch (e) {
                log.error('error@formatAsOfDate', e);
                throw e;
            }
        };

        /**
         * Searches the newest active rate record on or before the date.
         * The error is logged and thrown again, because a failed search must not be reported as JJ_RATE_MISSING.
         * @param {string|number} metalType - Internal ID of the Metal Type list value
         * @param {string|number} currencyId - Internal ID of the currency
         * @param {string} asOfText - Date as text in the user's NetSuite date format
         * @returns {Array<search.Result>} Search results (empty when none found)
         * @throws {Error} Any error raised by the search
         */
        const searchLatestRate = (metalType, currencyId, asOfText) => {
            try {
                return search.create({
                    type: REC_TYPE,
                    filters: [
                        ['isinactive', 'is', 'F'], 'AND',
                        ['custrecord_jj_mr_metal', 'anyof', metalType], 'AND',
                        ['custrecord_jj_mr_currency', 'anyof', currencyId], 'AND',
                        ['custrecord_jj_mr_effdate', 'onorbefore', asOfText]
                    ],
                    columns: [
                        search.createColumn({ name: 'custrecord_jj_mr_effdate', sort: search.Sort.DESC }),
                        search.createColumn({ name: 'internalid', sort: search.Sort.DESC }), // tie-breaker
                        search.createColumn({ name: 'custrecord_jj_mr_rate' })
                    ]
                }).run().getRange({ start: 0, end: 1 });
            } catch (e) {
                log.error('error@searchLatestRate', e);
                throw e;
            }
        };

        /**
         * Logs and throws JJ_RATE_MISSING. It throws on purpose, so the Purchase Order / Vendor Bill save is stopped.
         * @param {string|number} metalType - Internal ID of the Metal Type list value
         * @param {string|number} currencyId - Internal ID of the currency
         * @param {string} asOfText - Date as text in the user's NetSuite date format
         * @returns {void}
         * @throws {Error} JJ_RATE_MISSING always
         */
        const throwRateMissing = (metalType, currencyId, asOfText) => {
            log.error('JJ_RATE_MISSING', 'No rate found - Metal: ' + metalType + ', Currency: ' + currencyId + ', On or before: ' + asOfText);
            throw error.create({
                name: 'JJ_RATE_MISSING',
                message: 'JJ_RATE_MISSING: No metal rate found for Metal Type ' + metalType +
                    ', Currency ' + currencyId + ' on or before ' + asOfText + '.',
                notifyOff: true
            });
        };

        /**
         * Returns the latest rate whose Effective Date is on or before asOfDate.
         * JJ_RATE_BAD_PARAMS and JJ_RATE_MISSING are thrown on purpose and are already logged where they are raised;
         * any other error is logged here. Every error is thrown again to the caller.
         *
         * @param {string|number} metalType - Internal ID of the Metal Type list value
         * @param {string|number} currencyId - Internal ID of the currency
         * @param {Date|string} asOfDate - Date object, or a string in the user's NetSuite date format
         * @returns {number} The applicable rate
         * @throws {Error} JJ_RATE_BAD_PARAMS when an argument is missing
         * @throws {Error} JJ_RATE_MISSING when no applicable rate exists
         */
        const getLatestRate = (metalType, currencyId, asOfDate) => {
            try {
                validateParams(metalType, currencyId, asOfDate);

                const asOfText = formatAsOfDate(asOfDate);
                const rateResults = searchLatestRate(metalType, currencyId, asOfText);

                if (!rateResults.length) {
                    throwRateMissing(metalType, currencyId, asOfText);
                }

                return Number(rateResults[0].getValue({ name: 'custrecord_jj_mr_rate' }));
            } catch (e) {
                if (e.name !== 'JJ_RATE_BAD_PARAMS' && e.name !== 'JJ_RATE_MISSING') {
                    log.error('error@getLatestRate', e);
                }
                throw e;
            }
        };

        return { getLatestRate };
    });