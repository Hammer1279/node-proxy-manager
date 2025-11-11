import { readFile } from 'fs/promises';
import { STATUS_CODES } from 'http';
import { join } from 'path';

export default async (page, { req, res, next }, config) => {
    const runtimeConfig = JSON.parse(await readFile(join(".", 'config.json'), 'utf-8'));

    // Map first, then filter, so id always matches the index in the config
    const proxyWithIds = runtimeConfig.proxy.map((values, index) => ({
        ...values,
        id: index,
        enabled: values.enabled ?? true,
        maintenance: values.maintenance ?? false,
        special: values.special ?? false,
        timeout: values.timeout ?? runtimeConfig.timeout,
        redirect: values.redirect ?? false,
        redirectTemp: values.redirectTemp ?? false,
        description: values.description || "No description available",
    }));

    return {
        proxies: proxyWithIds.filter(values => !values.redirect).map(values => ({
            ...values,
            acmebypass: values.ssl?.bypass ?? false,
            globalAnubis: runtimeConfig.anubis.enabled && (runtimeConfig.anubis.alwaysOn),
        })),
        redirects: proxyWithIds.filter(values => values.redirect).map(values => ({
            ...values,
            status: values.redirectTemp ? 302 : 301,
        })),
        stubs: runtimeConfig.stub.map((values, index) => ({
            ...values,
            id: index,
            enabled: values.enabled ?? true,
            status: values.status ?? 200,
            status_message: STATUS_CODES[values.status] ?? "UNKNOWN",
            message: values.message ?? STATUS_CODES[values.status] ?? "OK",
            description: values.description || "No description available"
        })),
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