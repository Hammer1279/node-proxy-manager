import { readFile, writeFile, rename, unlink } from "fs/promises";
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
    try {
        const uploadedConfigPath = join(".", 'uploaded-config.json');
        const currentConfigPath = join(".", 'config.json');
        const oldConfigPath = join(".", 'old-config.json');

        // Write uploaded config
        await writeFile(uploadedConfigPath, JSON.stringify(JSON.parse(req.body?.config), null, 4), 'utf-8');

        // Read both configs
        const [uploadedConfig, currentConfig] = await Promise.all([
            readFile(uploadedConfigPath, 'utf-8'),
            readFile(currentConfigPath, 'utf-8')
        ]);

        if (uploadedConfig === currentConfig) {
            // Configs are identical, just delete uploaded-config
            await unlink(uploadedConfigPath);
            res.sendStatus(204); // No Content
            return { done: true };
        }

        // Configs differ, rotate and replace
        await rename(currentConfigPath, oldConfigPath);
        await rename(uploadedConfigPath, currentConfigPath);
        res.sendStatus(200);
    } catch (error) {
        res.status(400).send("Invalid JSON format in request body");
        return { done: true };
    }

    setTimeout(() => {
        if (!res.headersSent) {
            res.sendStatus(500);
            return { done: true };
        }
    }, 10000);
}