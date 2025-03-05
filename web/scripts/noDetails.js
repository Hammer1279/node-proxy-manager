import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { isNumber } from 'util';

export default async (page, { req, res, next }, config) => {
    const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
    const urlParts = req.url.split('/');
    if ((urlParts.length === 4 || urlParts.length === 3) &&
        !isNaN(parseInt(urlParts[urlParts.length - 1])) &&
        !urlParts[urlParts.length - 1].match(/^0\d+/) || urlParts[urlParts.length - 1] == '') {
        console.log("Invalid URL format:", urlParts);
        res.writeHead(301, { 'Location': `/${urlParts[1]}` });
        res.end();
        return { done: true };
    } else {
        console.log(urlParts);
        return {};
    }
}