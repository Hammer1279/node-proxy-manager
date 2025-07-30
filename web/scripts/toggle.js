import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export default async (page, { req, res, next }, config) => {
    const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
    const urlParts = req.url.split('/');
    // const prefix = urlParts[1];
    // const id = parseInt(urlParts[2]);
    let storageType = req.params.type;
    let redirectType = req.params.type;
    if (storageType === "redirects") {
        storageType = "proxy";
        redirectType = "redirects";
    }
    const id = parseInt(req.params.id);
    // if (urlParts[3] !== 'toggle' || isNaN(id)) {
    //     res.writeHead(400);
    //     res.end('Invalid URL format');
    //     return;
    // }
    if (!runtimeConfig[storageType]) {
        res.sendStatus(400);
        return { done: true };
    }
    const item = runtimeConfig[storageType][id];
    if (!item) {
        res.sendStatus(400);
        return { done: true };
    }
    if (item.special && false) { // special items can now be toggled
        res.writeHead(403);
        res.end('Cannot toggle special items');
        return { done: true };
    }
    if (req.params?.toggletype == "protection") {
        item.write_protected = !item.write_protected;
    } else if (req.params?.toggletype == "maintenance") {
        item.maintenance = !item.maintenance;
    } else {
        if (item.write_protected) {
            res.writeHead(403);
            res.end('Item is write protected');
            return { done: true };
        }
        item.enabled = !item.enabled;
    }
    await writeFile(join(".", 'config.json'), JSON.stringify(runtimeConfig, null, 4));
    res.redirect('/' + redirectType);
    return { done: true };
}