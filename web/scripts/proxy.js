import { readFile } from 'fs/promises';
import { join } from 'path';

export default async (page, { req, res, next }, config) => {
    const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
    return {
        proxies: runtimeConfig.proxy.map(values => {
            return {
                ...values,
                enabled: values.enabled ?? true,
                timeout: values.timeout ?? runtimeConfig.timeout,
                redirect: values.redirect ?? false,
                redirectTemp: values.redirectTemp ?? false,
                description: values.description ?? "No description available",
                maintenance: values.maintenance ?? false
            };
        }),
    }
}