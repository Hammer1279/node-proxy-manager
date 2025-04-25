import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { fork } from 'child_process';

/**
 * HT Framework middleware
 * @since V2
 * @param {Object} page page settings
 * @param {{req: import("express").Request, res: import("express").Response, next: import("express").NextFunction}} middleware request, response and next function
 * @param {Object} config global configuration
 * @returns {Promise<{done: boolean, any}>} whether the request was handled, otherwise return the request context addition of this module
 */
export default async (page, { req, res, next }, config) => {
    const urlParts = req.url.split('/');
    // const itemId = urlParts[urlParts.length - 1];
    // const type = urlParts[urlParts.length - 2];
    const itemId = req.params.id;
    const type = req.params.type;

    if (type) {
        res.status(400).json({ error: "Invalid type" });
        return;
    }

    console.debug("Updating", type, itemId);
    if (itemId == "new") {
        const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
        const item = req.body;
        const domains = item.domains.split(/[,\n\r]+/).map(d => d.trim()).filter(d => d);
        runtimeConfig.acme.domains.push(domains);
        await writeFile(join(".", 'config.json'), JSON.stringify(runtimeConfig, null, 4), 'utf-8');
    } else {
        const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
        const item = req.body;
        const domains = item.domains.split(/[,\n\r]+/).map(d => d.trim()).filter(d => d);
        runtimeConfig.acme.domains[itemId] = domains;
        await writeFile(join(".", 'config.json'), JSON.stringify(runtimeConfig, null, 4), 'utf-8');
    }

    if (config.acme.enabled) {
        fork('./acme.js');
    }

    res.status(200).redirect(`/acme`);
    return { done: true };
}