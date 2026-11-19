/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * *********************************************************************************************************************************
 *
 * ${RAFMO-103} : ${P2P—Develop Daily Metal Rate Update Customization in NetSuite}
 *
 * ********************************************************************************************************************************
 *
 *
 * Library : jj_lib_rate
 *
 * Description : Shared library for the Purchase Order and Vendor Bill customizations. getLatestRate(metalType, currencyId, asOfDate)
 *               returns the latest Daily Metal Rate on or before the given date, or throws JJ_RATE_MISSING when none exists.
 *
 * Usage :
 *   define(['./jj_lib_rate'], (rateLib) => {
 *       const rate = rateLib.getLatestRate(metalId, currencyId, new Date());
 *   });
 *
 * REVISION HISTORY :
 * @version 1.0 18-November-2026 : Initial build by JJ0494\
 */
define(['N/search', 'N/format', 'N/error'],
    (search, format, error) => {

        const REC_TYPE = 'customrecord_jj_metal_rate';

        /**
         * Throws JJ_RATE_BAD_PARAMS when an argument is missing.
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
         * @param {Date|string} asOfDate
         * @returns {string}
         */
        const formatAsOfDate = (asOfDate) => {
            return (asOfDate instanceof Date)
                ? format.format({ value: asOfDate, type: format.Type.DATE })
                : asOfDate;
        };

        /**
         * Searches the newest active rate record on or before the date.
         * @returns {Array} search results (empty when none found)
         */
        const searchLatestRate = (metalType, currencyId, asOfText) => {
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
        };

        /**
         * Logs and throws JJ_RATE_MISSING.
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
         *
         * @param {string|number} metalType  Internal ID of the Metal Type list value
         * @param {string|number} currencyId Internal ID of the currency
         * @param {Date|string}   asOfDate   Date object, or a string in the user's NetSuite date format
         * @returns {number} the applicable rate
         * @throws {Error} JJ_RATE_MISSING when no applicable rate exists
         */
        const getLatestRate = (metalType, currencyId, asOfDate) => {
            log.debug('getLatestRate called', 'Metal: ' + metalType + ', Currency: ' + currencyId + ', As of: ' + asOfDate);

            validateParams(metalType, currencyId, asOfDate);

            const asOfText = formatAsOfDate(asOfDate);
            const results = searchLatestRate(metalType, currencyId, asOfText);

            if (!results.length) {
                throwRateMissing(metalType, currencyId, asOfText);
            }

            const latestRate = Number(results[0].getValue({ name: 'custrecord_jj_mr_rate' }));
            log.debug('getLatestRate result', 'Record ID: ' + results[0].id + ', Rate: ' + latestRate);
            return latestRate;
        };

        return { getLatestRate };
    });