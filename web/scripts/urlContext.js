import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export default async (page, { req, res, next }, config) => {
    const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
    const urlParts = req.url.split('/');
    const prefix = urlParts[1];
    const id = parseInt(urlParts[2]);
    if (isNaN(id)) {
        res.writeHead(400);
        res.end('Invalid URL format');
        return;
    }
    const item = runtimeConfig[prefix][id];
    item.enabled = !item.enabled;
    await writeFile(join(".", 'config.json'), JSON.stringify(runtimeConfig, null, 4));
    return {
        item: item,
        prefix: prefix,
        id: id
    };
}