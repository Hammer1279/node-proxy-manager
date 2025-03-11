import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export default async (page, { req, res, next }, config) => {
    const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
    const urlParts = req.url.split('/');
    // const prefix = urlParts[1];
    // const id = parseInt(urlParts[2]);
    const prefix = req.params.type;
    const id = parseInt(req.params.id);
    if (urlParts[3] !== 'toggle' || isNaN(id)) {
        res.writeHead(400);
        res.end('Invalid URL format');
        return;
    }
    if (!runtimeConfig[prefix]) {
        res.sendStatus(400);
        return { done: true };
    }
    const item = runtimeConfig[prefix][id];
    if (!item) {
        res.sendStatus(400);
        return { done: true };
    }
    if (item.special) {
        res.writeHead(403);
        res.end('Cannot toggle special items');
        return { done: true };
    } else if (item.write_protected) {
        res.writeHead(403);
        res.end('Item is write protected');
        return { done: true };
    }
    item.enabled = !item.enabled;
    await writeFile(join(".", 'config.json'), JSON.stringify(runtimeConfig, null, 4));
    // res.redirect(req.url.replace('toggle', ''));
    res.redirect('/' + prefix);
    return { done: true };
}