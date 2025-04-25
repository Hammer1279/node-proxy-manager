import { readFile, writeFile } from "fs/promises";
import { join } from "path";

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
    const index = req.params.id;
    const type = req.params.type;

    const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));

    if (type != "acme" && (runtimeConfig[type] === undefined || runtimeConfig[type][index] === undefined || runtimeConfig[type][index].special || runtimeConfig[type][index].write_protected)) {
        res.sendStatus(400);
        return { done: true };
    }

    if (type == "acme") {
        if (index >= 0 && index < runtimeConfig.acme.domains.length) {
            console.log(`Deleting domain configuration at index ${index}`);
            runtimeConfig.acme.domains.splice(index, 1); // Remove the domain at the specified index
        } else {
            res.sendStatus(400); // Invalid id
            return { done: true };
        }
    } else {
        console.log("Deleting", type, index);
        // delete runtimeConfig[type][index];
        runtimeConfig[type].splice(index, 1);
    }

    await writeFile(join(".", 'config.json'), JSON.stringify(runtimeConfig, null, 4));
    
    res.status(200).redirect(`/${type}`);
    return { done: true };
}