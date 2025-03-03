import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { createServer as createServerHttp, IncomingMessage, ServerResponse } from 'http';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import config from './config.json' with {
    type: "json"
};

import packageJson from './package.json' with {
    type: "json"
};

import Greenlock from "greenlock";
import http01Lib from "acme-http-01-standalone";
const http01 = http01Lib.create({});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function runCertbot() {
    const greenlock = Greenlock.create({
        staging: config.acme.staging,
        packageAgent: packageJson.name + '/' + packageJson.version,
        packageRoot: __dirname,
        configDir: config.acme.configDir,
        maintainerEmail: config.acme.email,
        notify: function (event, details) {
            if ('error' === event) {
                console.error(details);
            } else if ('success' === event) {
                console.log('Certificate issued successfully for', details.subject);
                console.log('Certificate details:', details);
            }
        },
        challenges: {
            // 'http-01': getChallenges()
            'http-01': {
                module: join(__dirname, 'acme.js')
            }
        }
    });

    greenlock.manager.defaults({
        agreeToTerms: config.acme.agreeToTerms,
        subscriberEmail: config.acme.email
    });

    config.acme.domains.forEach(domains => {
        console.log(`Processing domain: ${domains[0]}`);
        greenlock.add({
            subject: domains[0],
            altnames: domains,
        })
    });

    // const subject = config.acme.domains[0][0];

    // greenlock
    //     .get({ servername: subject })
    //     .then(function (pems) {
    //         if (pems && pems.privkey && pems.cert && pems.chain) {
    //             console.info('Certificate issued successfully');
    //             console.log('Private Key:', pems.privkey);
    //             console.log('Certificate:', pems.cert);
    //             console.log('Chain:', pems.chain);

    //             // Store the certificates
    //             const certDir = join(config.acme.configDir, 'certs', subject);
    //             if (!existsSync(certDir)) {
    //                 mkdirSync(certDir, { recursive: true });
    //             }
    //             writeFileSync(join(certDir, 'privkey.pem'), pems.privkey);
    //             writeFileSync(join(certDir, 'cert.pem'), pems.cert);
    //             writeFileSync(join(certDir, 'chain.pem'), pems.chain);
    //         }
    //     })
    //     .catch(function (e) {
    //         console.error('Error during certificate issuance:', e.code);
    //         console.error(e);
    //     });

    return greenlock.renew({}).then(function(results) {
        results.forEach(function(site) {
            if (site.error) {
                console.error(site.subject, site.error);
                return;
            }
            console.log('Renewed certificate for', site.subject, site.altnames);
        });
    });
}

// if (config.acme.enabled) {
//     runCertbot();
// }

// Run when file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runCertbot();
}

const challengeFile = join(config.acme.configDir, 'challenges.json');

/**
 * Handle ACME challenge requests
 * @param {IncomingMessage} req 
 * @param {ServerResponse} res 
 * @return {boolean} True if the request was handled
 */
export function handleChallenge(req, res) {
    const method = req.method;
    const url = req.url;

    const challenges = JSON.parse(readFileSync(challengeFile, 'utf8'));

    console.log('Handle challenge', method, url);

    const host = req.headers.host;
    const challenge = host + url.replace("/.well-known/acme-challenge/", '#');

    console.log("User-Agent", req.headers['user-agent']);

    const isValidUserAgent = [`${packageJson.name}/${packageJson.version}`, "Let's Encrypt validation server"].some(ua => {
        return req.headers['user-agent'].includes(ua);
    });

    console.debug("Valid User-Agent", isValidUserAgent);

    if (!isValidUserAgent) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return false;
    }

    if (challenges[challenge]) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        console.log('Challenge', challenge, challenges[challenge]);
        res.end(challenges[challenge]);
        console.log('Challenge sent');
        // res.end(JSON.stringify({ keyAuthorization: challenges[challenge] }));
        return true;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return false;
}

export function create() {
    return {
        init: function (opts) {
            console.log('Init', opts);
            if (!existsSync(challengeFile)) {
                writeFileSync(challengeFile, '{}');
            }
            // request = opts.request;
            return Promise.resolve(null);
        },

        set: function (data) {
            return Promise.resolve().then(function () {
                console.log('Add Key Auth URL', data);
                const challenges = JSON.parse(readFileSync(challengeFile, 'utf8'));

                const ch = data.challenge;
                const key = ch.identifier.value + '#' + ch.token;
                challenges[key] = ch.keyAuthorization;

                writeFileSync(challengeFile, JSON.stringify(challenges, null, 3));
                return null;
            });
        },

        get: function (data) {
            return Promise.resolve().then(function () {
                console.log('List Key Auth URL', data);
                const challenges = JSON.parse(readFileSync(challengeFile, 'utf8'));

                const ch = data.challenge;
                const key = ch.identifier.value + '#' + ch.token;

                if (challenges[key]) {
                    return { keyAuthorization: challenges[key] };
                }

                return null;
            });
        },

        remove: function (data) {
            return Promise.resolve().then(function () {
                console.log('Remove Key Auth URL', data);
                const challenges = JSON.parse(readFileSync(challengeFile, 'utf8'));


                const ch = data.challenge;
                const key = ch.identifier.value + '#' + ch.token;

                delete challenges[key];
                writeFileSync(challengeFile, JSON.stringify(challenges, null, 3));
                return null;
            });
        }
    }
}