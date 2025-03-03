import { readFile } from 'fs/promises';
import { join } from 'path';

export default async (page, { req, res, next }, config) => {
    const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
    res.json(runtimeConfig);
    return { done: true };
}