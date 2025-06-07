// Update configuration file to the newest version, ensuring backward compatibility

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
            return {
                ["admin"]: "admin" // Default admin account
            };
        }
    },
    {
        key: "management.password",
        to: null // Remove this property after migration
    },
    {
        key: "management.username",
        to: null // Remove this property after migration
    },
    // Version 0.3.4
    {
        key: "management.trustedProxies",
        to: "trustedProxies",
        transform: (value, data) => {
            if (data.management.trustedProxies) {
                return data.management.trustedProxies;
            }
            return [];
        }
    },
    {
        key: "management.trustedProxies",
        to: null // Remove this property after migration
    },
    {
        key: "management._thrustedProxies",
        to: null // Remove this property after migration
    }
    // Version X.X.X
    // activate this in the next version (so that git does not delete values before migration)
    // {
    //     key: "management.trustedProxies",
    //     to: null // Remove this property after migration
    // },
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

// Run the migration if this file is called directly with an argument
if (process.argv[1].split('/').pop() === import.meta.url.split('/').pop()) {
    const configFile = process.argv[2] || "./config.json"; // Default config file path

    if (!configFile) {
        console.error('Error: Please provide a config file path as an argument');
        process.exit(1);
    }
    
    updateConfigRefs(configFile)
        .then(() => {
            console.log(`Successfully migrated configuration file: ${configFile}`);
            process.exit(0);
        })
        .catch(error => {
            console.error(`Error migrating configuration: ${error.message}`);
            process.exit(1);
        });
}