import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * HT Framework middleware
 * @since V2
 * @param {Object} page page settings
 * @param {{req: import("express").Request, res: import("express").Response, next: import("express").NextFunction}} middleware request, response and next function
 * @param {Object} config global configuration
 * @returns {Promise<{done: boolean, any}>} whether the request was handled, otherwise return the request context addition of this module
 */
export default async (page, { req, res, next }, config) => {
    if (req?.headers?.accept?.includes('text/html')) {
        // If the request is for HTML, redirect to the config edit page
        res.redirect(301, '/config/edit');
        return { done: true };

    } else if (req?.headers?.accept?.includes('application/json')) {
        const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
        // Redact sensitive authentication information
        const redactSensitiveInfo = (obj) => {
            const sensitivePattern = /^(?:auth(?:entication)?|.*user.*|.*pass.*|.*account(?:s)?)$/i;

            for (const key in obj) {
                if (sensitivePattern.test(key)) {
                    // Replace entire auth object or sensitive string with REDACTED
                    obj[key] = "**********";
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    redactSensitiveInfo(obj[key]);
                }
            }
        };

        redactSensitiveInfo(runtimeConfig);
        res.json(runtimeConfig);
        return { done: true };
    } else {
        // If the request is for something else, return 406 Not Acceptable
        res.status(406).send("Not Acceptable");
        return { done: true };
    }
}