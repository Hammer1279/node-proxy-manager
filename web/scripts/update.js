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
    const type = req.params.type;
    console.debug("Updating", type, itemId);
    if (itemId != "new") {
        const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
        const id = parseInt(itemId);
        if (isNaN(id)) {
            res.sendStatus(400);
            res.end();
            return { done: true };
        }
        const item = runtimeConfig[type][id];
        if (!item) {
            res.sendStatus(404);
            res.end();
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
                    }
                    item[param] = element === "true" || element == "on";
                } else if (Array.isArray(item[param])) { // handle case for arrays
                    item[param] = Array.isArray(element) ? element : element.split(',');
                } else if (typeof item[param] === "object") {
                    if (param == "ssl") {
                        const {key, cert, ca: caRaw} = element;
                        const ca = caRaw.split(',');
                        item[param] = { key, cert, ca };
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
        if (type == "proxy") {
            const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
            
            // default proxy item
            let item = {
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
                }
            };

            // parse request body into item
            for (const [key, value] of Object.entries(req.body)) {
                if (key === 'host') {
                    item[key] = value.split(',');
                } else if (key === 'timeout') {
                    item[key] = parseInt(value);
                } else if (key === 'ssl') {
                    item.ssl.key = value.key || item.ssl.key;
                    item.ssl.cert = value.cert || item.ssl.cert;
                    item.ssl.ca = value.ca ? value.ca.split(',') : item.ssl.ca;
                } else if (key === 'auth') {
                    item.auth.enabled = value.enabled[value.enabled.length - 1] === "true" || value.enabled[value.enabled.length - 1] === "on";
                    item.auth.username = value.username || item.auth.username;
                    item.auth.password = value.password || item.auth.password;
                } else if (typeof value === 'object') {
                    // Handle boolean values that come as arrays
                    item[key] = value[value.length - 1] === "true" || value[value.length - 1] === "on";
                } else {
                    item[key] = value;
                }
            }

            runtimeConfig[type].push(item);
            await writeFile(join(".", 'config.json'), JSON.stringify(runtimeConfig, null, 4), 'utf-8');
        } else if (type == "stub") {
            const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
            
            // TODO: rework stub like proxy if it works
            const item = req.body;
            runtimeConfig[type].push({
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
            console.error(`Type "${type}" not implemented`);
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            res.end('Not implemented yet');
            return { done: true };
        }
        res.redirect(`/${type}`);
        return { done: true };
    }
    res.status(200).redirect(`/${type}`);
    return { done: true };
}