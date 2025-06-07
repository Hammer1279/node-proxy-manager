import { readFile } from 'fs/promises';
import { STATUS_CODES } from 'http';
import { join } from 'path';

export default async (page, { req, res, next }, config) => {
    const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));
    return {
        proxies: runtimeConfig.proxy.map((values, index) => {
            return {
                ...values,
                id: index, // assign the index as an ID
                enabled: values.enabled ?? true,
                maintenance: values.maintenance ?? false,
                special: values.special ?? false,
                timeout: values.timeout ?? runtimeConfig.timeout,
                redirect: values.redirect ?? false,
                redirectTemp: values.redirectTemp ?? false,
                description: values.description || "No description available",
            };
        }),
        stubs: runtimeConfig.stub.map((values, index) => {
            return {
                ...values,
                id: index, // assign the index as an ID
                enabled: values.enabled ?? true,
                status: values.status ?? 200,
                status_message: STATUS_CODES[values.status] ?? "UNKNOWN",
                message: values.message ?? "OK",
                description: values.description || "No description available"
            }
        }),
        acme: {
            ...runtimeConfig.acme,
            domains: runtimeConfig.acme.domains.map((value, index) => (
                {
                    certificate: value[0],
                    entries: value,
                }
            ))
        },
    }
}