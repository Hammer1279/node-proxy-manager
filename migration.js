import { readFile, writeFile } from "node:fs/promises";

const updates = [
    // Version 0.2.3
    {
        key: "management.username",
        to: "management.accounts",
        transform: (value, data) => {
            // Add the username and password as a key-value pair in accounts
            if (data.management.password) {
                return { [value]: data.management.password };
            }
            return {};
        }
    },
    {
        key: "management.password",
        to: null // Remove this property after migration
    },
    {
        key: "management.username",
        to: null // Remove this property after migration
    }
];

export default async function updateConfigRefs(file) {
    return new Promise(async (resolve, reject) => {
        try {
            let data = JSON.parse(await readFile(file, 'utf8'));

            // Apply updates in the defined order
            for (const { key, to, transform } of updates) {
                const keys = key.split('.');
                const lastKey = keys.pop();
                const source = keys.reduce((obj, k) => obj?.[k], data);

                if (source && lastKey in source) {
                    const value = source[lastKey];

                    // Apply transformation if specified
                    if (transform) {
                        const transformedValue = transform(value, data);

                        if (to) {
                            const toKeys = to.split('.');
                            const toLastKey = toKeys.pop();
                            const target = toKeys.reduce((obj, k) => obj[k] ??= {}, data);

                            // Merge transformed value into the target
                            if (typeof transformedValue === 'object' && !Array.isArray(transformedValue)) {
                                target[toLastKey] = { ...target[toLastKey], ...transformedValue };
                            } else {
                                target[toLastKey] = transformedValue;
                            }
                        }
                    }

                    // Remove the original property if `to` is null
                    if (to === null) {
                        delete source[lastKey];
                    }
                }
            }

            // Write the updated data back to the file
            await writeFile(file, JSON.stringify(data, null, 4), 'utf8');
            resolve();
        } catch (error) {
            reject(error);
        }
    });
}