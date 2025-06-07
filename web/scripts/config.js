import { readFile } from 'fs/promises';
import { join } from 'path';

export default async (page, { req, res, next }, config) => {
    const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
    // Redact sensitive authentication information
    const redactSensitiveInfo = (obj) => {
        const sensitivePattern = /^(?:auth(?:entication)?|.*user.*|.*pass.*)$/i;
        
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
}