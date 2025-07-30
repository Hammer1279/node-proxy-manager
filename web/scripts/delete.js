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
    let storageType = req.params.type;
    let redirectType = req.params.type;
    if (storageType === "redirects") {
        storageType = "proxy";
        redirectType = "redirects";
    }
    const index = req.params.id;

    const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));

    if (storageType != "acme" && (runtimeConfig[storageType] === undefined || runtimeConfig[storageType][index] === undefined || runtimeConfig[storageType][index].special || runtimeConfig[storageType][index].write_protected)) {
        res.sendStatus(400);
        return { done: true };
    }

    if (storageType == "acme") {
        if (index >= 0 && index < runtimeConfig.acme.domains.length) {
            console.log(`Deleting domain configuration at index ${index}`);
            runtimeConfig.acme.domains.splice(index, 1); // Remove the domain at the specified index
        } else {
            res.sendStatus(400); // Invalid id
            return { done: true };
        }
    } else {
        console.log("Deleting", storageType, index);
        // delete runtimeConfig[type][index];
        runtimeConfig[storageType].splice(index, 1);
    }

    await writeFile(join(".", 'config.json'), JSON.stringify(runtimeConfig, null, 4));
    
    res.status(200).redirect(`/${redirectType}`);
    return { done: true };
}