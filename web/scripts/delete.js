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
    const id = req.params.id;
    const type = req.params.type;

    const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));

    if (runtimeConfig[type] === undefined || runtimeConfig[type][id] === undefined || runtimeConfig[type][id].special || runtimeConfig[type][id].write_protected) {
        res.sendStatus(400);
        return { done: true };
    }

    console.log("Deleting", type, id);
    // delete runtimeConfig[type][id];
    runtimeConfig[type].splice(id, 1);

    await writeFile(join(".", 'config.json'), JSON.stringify(runtimeConfig, null, 4));
    
    res.status(200).redirect(`/${type}`);
    return { done: true };
}