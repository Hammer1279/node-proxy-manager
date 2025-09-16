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
    // const itemId = urlParts[urlParts.length - 1];
    // const type = urlParts[urlParts.length - 2];
    const itemId = req.params.id;
    let storageType = req.params.type;
    let redirectType = req.params.type;
    if (storageType === "redirects") {
        storageType = "proxy";
        redirectType = "redirects";
    }
    console.debug("Updating", storageType, itemId);
    if (itemId != "new") {
        const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
        const id = parseInt(itemId);
        if (isNaN(id)) {
            res.sendStatus(400);
            res.end();
            return { done: true };
        }
        const item = runtimeConfig[storageType][id];
        if (!item) {
            res.sendStatus(404);
            res.end();
            return { done: true };
        }
        if (item?.write_protected) {
            res.writeHead(403, { "Content-Type": "text/plain" });
            res.end("This item is write protected");
            return { done: true };
        }
        if (item?.special && item?.host != req?.body?.host) {
            res.writeHead(403, { "Content-Type": "text/plain" });
            res.end("Cannot change host of system rules!");
            return { done: true };
        }
        for (const param in req.body) {
            if (Object.prototype.hasOwnProperty.call(req.body, param)) {
                let element = req.body[param];
                console.debug(`Processing ${param}:`, element);
                if (typeof item[param] === "number") {
                    if (isNaN(parseInt(element))) {
                        res.sendStatus(400);
                        res.end();
                        return { done: true };
                    }
                    item[param] = parseInt(element);
                } else if (typeof item[param] === "string") {
                    item[param] = element;
                } else if (typeof item[param] === "boolean") {
                    if (typeof element == "object") {
                        element = element[element.length - 1];
                        // return res.status(400).send("Invalid boolean value, please report this issue to the Github repository.");
                    }
                    item[param] = element === "true" || element == "on";
                } else if (Array.isArray(item[param])) { // handle case for arrays
                    item[param] = Array.isArray(element) ? element : element.split(',');
                } else if (typeof item[param] === "object") {
                    if (param == "ssl") {
                        const { key, cert, ca: caRaw } = element;
                        const ca = caRaw.split(',');
                        item[param] = { key, cert, ca };
                        continue;
                    } else if (param == "auth") {
                        const { enabled, type, username, password, realm } = element;
                        item[param].enabled = enabled && (enabled === "true" || enabled === "on");
                        item[param].username = username || "";
                        item[param].password = password || "";
                        // item[param].realm = realm || ""; // for future use, currently not used
                        // item[param].type = type || "basic"; // default to basic auth
                        continue;
                    } else if (element.split(',')[0] === '') {
                        item[param] = [];
                        continue;
                    }
                    item[param] = element.split(',');
                } else { // assume string
                    console.warn(`Unknown type for "${param}": ${typeof item[param]}`);
                    if (item[param]) {
                        item[param] = element;
                    }
                }
            }
        }
        await writeFile(join(".", 'config.json'), JSON.stringify(runtimeConfig, null, 4), 'utf-8');
    } else {
        if (storageType == "proxy") {
            const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));

            // default proxy item
            let defaultItem = {
                "description": "",
                "host": [],
                "enabled": false,
                "maintenance": false,
                "websocket": false,
                "redirect": false,
                "redirectTemp": false,
                "target": "",
                "timeout": 0,
                "secure": false,
                "ssl": {
                    "key": "",
                    "cert": "",
                    "ca": []
                },
                "headers": {},
                "auth": {
                    "enabled": false,
                    "username": "",
                    "password": ""
                },
                "write_protected": false,
            };

            // Deep clone defaultItem for the new item
            let item = JSON.parse(JSON.stringify(defaultItem));

            // parse request body into item, using types from defaultItem
            for (const [key, value] of Object.entries(req.body)) {
                if (key in defaultItem) {
                    const defVal = defaultItem[key];
                    if (typeof defVal === "boolean") {
                        // Convert "on"/"true" to true, else false
                        if (typeof value === "object") {
                            item[key] = value[value.length - 1] === "true" || value[value.length - 1] === "on";
                            // return res.status(400).send("Invalid boolean value, please report this issue to the Github repository.");
                        } else {
                            item[key] = value === "true" || value === "on";
                        }
                    } else if (typeof defVal === "number") {
                        item[key] = parseInt(value);
                    } else if (Array.isArray(defVal)) {
                        item[key] = Array.isArray(value) ? value : value.split(',');
                    } else if (typeof defVal === "object" && key === "ssl") {
                        item.ssl.key = value.key || "";
                        item.ssl.cert = value.cert || "";
                        item.ssl.ca = value?.ca?.split(',') ?? [];
                    } else if (typeof defVal === "object" && key === "auth") {
                        item.auth.enabled = value.enabled && (value.enabled === "true" || value.enabled === "on") || item.enabled;
                        item.auth.username = value.username || "";
                        item.auth.password = value.password || "";
                    } else {
                        item[key] = value;
                    }
                }
            }

            runtimeConfig[storageType].push(item);
            await writeFile(join(".", 'config.json'), JSON.stringify(runtimeConfig, null, 4), 'utf-8');
            res.redirect(`/${redirectType}`);
            return { done: true };
        } else if (storageType == "stub") {
            const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));

            // TODO: rework stub like proxy if it works
            const item = req.body;
            runtimeConfig[storageType].push({
                "description": item.description,
                "host": item.host.split(','),
                "enabled": item.enabled[item.enabled.length - 1] === "true" || item.enabled[item.enabled.length - 1] == "on",
                "status": parseInt(item.status),
                "message": item.message,
                "secure": item.secure[item.secure.length - 1] === "true" || item.secure[item.secure.length - 1] == "on",
                "ssl": {
                    "key": item.ssl.key || "",
                    "cert": item.ssl.cert || "",
                    "ca": item.ssl.ca ? item.ssl.ca.split(',') : []
                },
            });
            await writeFile(join(".", 'config.json'), JSON.stringify(runtimeConfig, null, 4), 'utf-8');
        } else {
            console.error(`Type "${storageType}" not implemented`);
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            res.end('Not implemented yet');
            return { done: true };
        }
        res.redirect(`/${redirectType}`);
        return { done: true };
    }
    res.status(200).redirect(`/${redirectType}`);
    return { done: true };
}