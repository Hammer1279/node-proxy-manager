import { readFile, writeFile } from 'fs/promises';
import { url } from 'inspector';
import { join } from 'path';

export default async (page, { req, res, next }, config) => {
    const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
    const urlParts = req.url.split('/');
    const prefix = urlParts[1];
    const postfix = urlParts[3];
    const id = parseInt(urlParts[2]);
    const rv = {
        ...req.params,
        id: id,
        prefix: prefix,
        postfix: postfix,
    };
    if (isNaN(id) && urlParts[2] !== "new") {
        res.writeHead(400);
        res.end('Invalid URL format');
        return;
    } else if (urlParts[2] !== "new") {
        const item = runtimeConfig[prefix][id];
        rv.item = item;
    } else {
        rv.item = {};
        rv.id = urlParts[2];
    }
    return rv;
}