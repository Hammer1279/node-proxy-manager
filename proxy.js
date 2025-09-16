import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pkg from 'http-proxy';
const { createProxyServer } = pkg;
import { createServer as createServerHttp, IncomingMessage, ServerResponse, request as httpRequest, STATUS_CODES } from 'node:http';
import { createServer as createServerHttps, request as httpsRequest } from 'node:https';
import { createSecureServer as createServerHttp2 } from 'node:http2';
import { containsCidr } from "cidr-tools";
import superagent from 'superagent';
import tls from 'node:tls';

import initialConfig from './config.json' with {
    type: "json"
};
import { handleChallenge } from './acme.js';
import forge from 'node-forge';
import { Socket } from 'net';
import { getCertificate } from './CertManager.js';

import NodeCache from 'node-cache';
import { ipcClient } from './ipc.js';

const cache = new NodeCache({
    stdTTL: 43200, // 12 hours
    useClones: false
});

async function updateCFCIDRList() {
    if (!cache.has("cfcidrList")) {
        try {
            cache.set("cfcidrList", (await superagent.get("https://api.cloudflare.com/client/v4/ips")).body);
        } catch (error) {
            console.error("Error fetching Cloudflare CIDR list:", error);
            setTimeout(updateCFCIDRList, 60 * 60 * 1000); // Retry after 1 hour
            return;
        }
    }
}
await updateCFCIDRList();
setInterval(updateCFCIDRList, 6 * 60 * 60 * 1000); // refresh cache every 6 hours

// always use in memory config for best performance (no disk IO)
let config = initialConfig;

const ipc = ipcClient(config, "proxy");
let validAuths = [];

ipc.on('data', async (data) => {
    if (data.at(0) == 0xC0 && data.at(1) == 0xCC) { // 0xC0CC
        const end = data.subarray(2).findIndex((byte) => byte === 0xC0 && byte === 0xCC);
        const secret = data.subarray(2, end - 1).toString('utf-8');
        console.debug("Received new auth secret:", secret);
        validAuths.push(secret);
    }
});

async function reloadConfig(reqBody) {
    try {
        const newConfig = await readFile(join(process.cwd(), 'config.json'), 'utf-8');
        config = JSON.parse(newConfig);
        config.revisionId = reqBody;
        console.debug('Configuration reloaded successfully.');
    } catch (error) {
        console.error('Error reloading config:', error);
    }
}

const [httpPort, httpsPort] = config.ports;

// function to pick out the key + certs dynamically based on the domain name
export function getSecureContext(domain) {
    const files = readdirSync('./certs');
    const domConf = [
        ...config.stub.filter(({ host: hosts }) => hosts.includes(domain)),
        ...config.proxy.filter(({ host: hosts }) => hosts.includes(domain)),
    ].find(conf => conf?.secure === true);

    try {
        if (!domConf) {
            console.debug(`No configuration found for domain ${domain}`);
            return tls.createSecureContext({
                key: readFileSync(config.ssl.key),
                cert: readFileSync(config.ssl.cert),
                ca: config.ssl.ca.map(caPath => readFileSync(caPath))
            });
        }

        const secureContextOptions = {
            key: readFileSync(domConf.ssl.key),
            cert: readFileSync(domConf.ssl.cert)
        };

        if (domConf.ssl.ca && domConf.ssl.ca[0] != "") {
            secureContextOptions.ca = domConf.ssl.ca.map(caPath => readFileSync(caPath));
        }

        return tls.createSecureContext(secureContextOptions).context;
    } catch (error) {
        console.error(`Error loading certificates for ${domain}:`, error);
        return tls.createSecureContext(getCertificate(domain));
    }
}

export const proxy = createProxyServer({
    secure: false, // Allow self-signed certificates,
    ws: true, // Enable WebSocket support
    xfwd: true, // Enable X-Forwarded-For header
    timeout: config.timeout || 10000, // 10 seconds timeout
    headers: {
        "X-Forwarded-By": "Node-Proxy-Manager",
    },
});

proxy.on('error', (err, req, res) => {
    // Check if `res` is an HTTP response object
    if (res && typeof res.writeHead === 'function') {
        console.error(err);
        if (['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET'].includes(err.code)) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('Bad Gateway');
        } else {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
        }
    } else {
        // Handle WebSocket or other non-HTTP errors
        if (req && req.url) {
            console.error(`Error during request to ${req.url}:`, err.message);
        }
    }
});

/**
 * Handle .well-known requests (might interfere with targets .well-known, so this should forward anything unknown to us)
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {(req: IncomingMessage, res: ServerResponse) => void} next - Next handler in the chain.
 * @returns {void}
 */
function wellKnown(req, res, next) {

}

/**
 * Handle HTTP/S requests
 * @param {IncomingMessage} req 
 * @param {ServerResponse} res 
 * @returns {void}
 */
const webRequest = (req, res) => {
    // console.debug('HTTP request', req.url);
    if (config.maintenance) {
        if (req.url.includes('/.well-known/status')) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            // TODO: remove either ok or status, this seems redundant
            res.end(JSON.stringify({
                ok: false,
                reason: 'maintenance',
                revisionId: config.revisionId || "initial",
            }));
            return;
        }
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
        return;
    } else if (config.initialSync) {
        if (req.url.includes('/.well-known/acme-challenge')) {
            if (config.acme.enabled) {
                handleChallenge(req, res);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
        } else if (req.url.includes('/.well-known/status')) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: false,
                reason: 'cert-init',
                revisionId: config.revisionId || "initial",
            }));
            return;
        } else {
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            res.end('Service Unavailable');
        }
        return;
    } else if (config.teapot) {
        if (req.url.includes('/.well-known/status')) {
            res.writeHead(418, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: false,
                reason: 'tea time',
                revisionId: config.revisionId || "initial",
            }));
            return;
        }
        // res.writeHead(418, { 'Content-Type': 'text/plain' });
        // res.end("It's not possible to control this teapot via HTCPCP/1.0, Teapots are not for brewing coffee!");
        res.writeHead(505, { 'Content-Type': 'text/plain' });
        res.end("This server is set up to only handle HTCPCP/1.0 requests, but can only handle HTTP requests.\r\nPlease contact the server administrator if you think this is a mistake.");
        return;
    }

    const domain = req?.headers?.host?.split(':')[0];
    let invalidDomain = false;
    if (!domain) {
        invalidDomain = "invalid.host";
    }
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    if (ipv4Regex.test(domain) || ipv6Regex.test(domain)) {
        invalidDomain = "external-direct-ip";
    }

    let domConfProxy = config.proxy.find(({ host: hosts, enabled = true }) => enabled && hosts.includes("default"));
    let domConfStub = config.stub.find(({ host: hosts, enabled = true }) => enabled && hosts.includes("default"));
    domConfProxy = config.proxy.find(({ host: hosts, enabled = true }) => enabled && hosts.includes(invalidDomain ? invalidDomain : domain)) ?? domConfProxy;
    domConfStub = config.stub.find(({ host: hosts, enabled = true }) => enabled && hosts.includes(invalidDomain ? invalidDomain : domain)) ?? domConfStub;

    if (req.url.includes('/.well-known/acme-challenge') && !domConfProxy?.ssl?.bypass) {
        if (config.acme.enabled) {
            handleChallenge(req, res);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
        return;
    } else if (req.url.includes('/.well-known/status')) {
        // console.debug(req.headers['user-agent']);
        if (req.method == "GET") {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                // status: 'up', // deprecated, use ok + reason instead
                reason: 'none',
                revisionId: config.revisionId || "initial",
            }));
        } else {
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('Method Not Allowed');
        }
        return;
    } else if (req.url.includes('/.well-known/reload')) {
        if (req.method == "POST") {
            // console.debug("POST request to /.well-known/reload");
            // console.debug(req.headers["authorization"]);
            let success = false;
            let auth = Buffer.from(req.headers["authorization"]?.split(" ")[1] || "", "base64").toString();
            if (auth) {
                // TODO: replace this file based auth with a ipc based auth to prevent issues with the auth file
                // const authFile = readFileSync(join(process.cwd(), 'auth.json'), 'utf-8');
                // const validAuths = JSON.parse(authFile);
                if (validAuths.includes(auth)) {

                    let body = '';
                    // console.debug('Content-length:', req.headers['content-length']);
                    req.on('data', chunk => {
                        // console.debug('Received chunk:', chunk.toString());
                        // console.debug('Received chunk length:', chunk.length);
                        body += chunk.toString();
                    });
                    req.on('end', async () => {
                        // console.debug('POST body:', body);
                        if (body) {
                            try {
                                await reloadConfig(body);
                                res.writeHead(200, { 'Content-Type': 'text/plain' });
                                res.end('OK');
                            } catch (error) {
                                console.error('Error reloading config:', error);
                                res.writeHead(500, { 'Content-Type': 'text/plain' });
                                res.end('Internal Server Error');
                            }
                        } else {
                            res.writeHead(400, { 'Content-Type': 'text/plain' });
                            res.end('Bad Request');
                        }
                    });

                    // delete the single use auth key
                    const index = validAuths.indexOf(auth);
                    if (index > -1) {
                        validAuths.splice(index, 1);
                        // writeFileSync(join(process.cwd(), 'auth.json'), JSON.stringify(validAuths));
                        return;
                    }
                }
            }
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('Unauthorized');
            return;
        } else {
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('Method Not Allowed');
        }
        return;
    }

    // TODO: this needs to be reworked to be less resource intensive for faster proxying
    // if (!domConfProxy && !domConfStub) { // No configuration found
    //     if (config.unconfiguredCloseNoResponse) {
    //         res.destroy();
    //     } else {
    //         const defaultProxy = config.proxy.find(({ host: hosts, enabled = true }) => enabled && hosts.includes("default"));
    //         const defaultStub = config.stub.find(({ host: hosts, enabled = true }) => enabled && hosts.includes("default"));
    //         if (defaultStub) {
    //             res.writeHead(defaultStub.status || 200, defaultStub.headers || { "Content-Type": defaultStub?.contentType ?? "text/plain" });
    //             res.end(defaultStub.message || 'OK');
    //         } else if (defaultProxy) {
    //             if (defaultProxy.maintenance) {
    //                 res.writeHead(503, { 'Content-Type': 'text/plain' });
    //                 res.end('Service Unavailable');
    //             } else if (defaultProxy.redirect) {
    //                 res.writeHead(defaultProxy.redirectTemp ? 302 : 301, { 'Location': defaultProxy.target });
    //                 res.end();
    //             } else {
    //                 proxy.web(req, res, {
    //                     target: defaultProxy.target,
    //                     xfwd: true,
    //                     ws: defaultProxy.websocket,
    //                     websocket: defaultProxy.websocket,
    //                     proxyTimeout: defaultProxy.timeout || config.timeout,
    //                     headers: defaultProxy.headers || {}
    //                 });
    //             }
    //         } else {
    //             res.writeHead(421, { 'Content-Type': 'text/plain' });
    //             res.end('Misdirected Request');
    //         }
    //     }

    //     return;
    // } else 

    if (domConfStub) {
        res.writeHead(domConfStub.status || 200, domConfStub.headers || { "Content-Type": domConfStub?.contentType ?? "text/plain", ...(domConfStub?.headers ?? {}) });
        res.end(domConfStub.message ?? STATUS_CODES[domConfStub.status ?? 200] ?? 'OK');
        return;
    } else if (domConfProxy?.maintenance) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
        return;
    } else if ((domConfProxy?.secure || domConfStub?.secure) && req.socket.localPort === 80) {
        res.writeHead(301, { 'Location': `https://${domain}${req.url}` });
        res.end();
        return;
    } else if ((!(domConfProxy?.secure || domConfStub?.secure)) && req.socket.localPort === 443 && !domConfProxy?.ssl?.bypass) {
        res.writeHead(301, { 'Location': `http://${domain}${req.url}` });
        res.end();
        return
    } else if (domConfProxy?.redirect) {
        res.writeHead(domConfProxy.redirectTemp ? 302 : 301, { 'Location': domConfProxy.target, ...(domConfProxy?.headers ?? {}) });
        res.end();
        return;
    } else {
        // Web Proxy request

        // Check for basic auth (others coming Soon™)
        if (domConfProxy?.auth?.enabled) {
            const authHeader = req.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Basic ')) {
                res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Secure Area"' });
                res.end('Unauthorized');
                return;
            }
            const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
            const username = credentials[0];
            const password = credentials[1];

            console.debug(`Basic Auth for ${domain}:`, username, password);

            if (username !== domConfProxy.auth.username || password !== domConfProxy.auth.password) {
                res.writeHead(403, { 'Content-Type': 'text/plain' });
                res.end('Forbidden');
                return;
            }
        }

        // calculate x-forwarded-for header
        let ip = "0.0.0.0/0";
        const formattedIp = req.socket.remoteAddress.replace("::ffff:", ""); // remove IPv6 prefix if present
        // console.log("Request Headers:", req.headers);
        if ("cf-connecting-ip" in req.headers) {
            const cfcidrList = cache.get("cfcidrList");
            console.log(cfcidrList);
            if (!cfcidrList.success) {
                return next(cfcidrList.errors.join(", "));
            }
            if (containsCidr([...cfcidrList.result.ipv4_cidrs, ...cfcidrList.result.ipv6_cidrs], formattedIp)) {
                ip = req.headers['cf-connecting-ip'] || formattedIp;
            } else {
                console.warn("CF IP not in list:", formattedIp);
                return res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
            }
        } else if ("x-forwarded-for" in req.headers) {
            console.log(formattedIp, req.headers['x-forwarded-for']);
            console.log("Trusted Proxies:", config.trustedProxies);
            if (containsCidr(["127.0.0.1", "::1", ...config.trustedProxies], formattedIp)) {
                ip = req.headers['x-forwarded-for'] || formattedIp;
            } else {
                console.warn("Proxy IP not in list:", formattedIp);
                return res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
            }
        } else {
            ip = formattedIp; // Do nothing
        }
        // console.debug('X-Forwarded-For:', ip);

        if (domConfProxy?.http2) {
            // no http2 support yet
            return res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Proxy Misconfigured');
        }

        if (!domConfProxy?.target) {
            return res.writeHead(502, { 'Content-Type': 'text/plain' }).end('Bad Gateway');
        }

        /**
         * Proxy options for http-proxy
         * @type {pkg.ServerOptions}
         */
        const proxyOptions = {
            target: domConfProxy.target,
            xfwd: true,
            ws: domConfProxy.websocket,
            websocket: domConfProxy.websocket,
            proxyTimeout: domConfProxy.timeout || config.timeout,
            headers: {
                "Host": domain,
                "X-Forwarded-For": ip,
                "X-Forwarded-Proto": req.socket.localPort === 443 ? 'https' : 'http',
                "X-Real-Ip": ip,
                ...domConfProxy.headers,
            }
        }

        if (config.anubis?.enabled && (config.anubis?.alwaysOn || domConfProxy?.anubis)) {
            import('./anubis.js').then(({ anubisHandoff }) => {
                return anubisHandoff(req, res, ip, domConfProxy, proxyOptions);
            });
        } else {
            return proxy.web(req, res, proxyOptions);
        }
    }
}

/**
 * Handle WebSocket requests
 * @param {IncomingMessage} req 
 * @param {Socket} socket 
 * @param {Buffer} head 
 */
const wsRequest = (req, socket, head) => {
    // console.debug('WS request', req.url);
    const domain = req?.headers?.host?.split(':')[0];
    const domConfProxy = config.proxy.find(({ host: hosts, enabled = true }) => enabled && hosts.includes(domain));
    if (domConfProxy && domConfProxy.websocket) {
        if (domConfProxy.maintenance) {
            socket.write('HTTP/1.1 503 Service Unavailable\r\n' +
                'Connection: close\r\n' +
                '\r\n');
            socket.destroy();
            return;
        }
        proxy.ws(req, socket, head, {
            target: domConfProxy.target,
            xfwd: true,
            secure: false, // Allow self-signed certificates
            proxyTimeout: domConfProxy.timeout || config.timeout,
            headers: domConfProxy.headers || {}
        });
    } else {
        socket.write('HTTP/1.1 403 Forbidden\r\n' +
            'Connection: close\r\n' +
            '\r\n');
        socket.destroy();
    }
}

const httpServer = createServerHttp(webRequest);

const httpsServer = createServerHttps({
    SNICallback: (hostname, cb) => {
        console.log('SNICallback', hostname);
        const secureContext = getSecureContext(hostname);
        cb(null, secureContext);
    }
}, webRequest);

// Experimental HTTP/2 support
const http2Server = createServerHttp2({
    allowHTTP1: true, // Allow HTTP/1.X fallback
    SNICallback: (hostname, cb) => {
        console.log('SNICallback', hostname);
        const secureContext = getSecureContext(hostname);
        cb(null, secureContext);
    }
});

http2Server.on("stream", (stream, headers) => {
    console.log('HTTP/2 stream', headers);

    // console.log(headers);

    const filteredHeaders = Object.fromEntries(
        Object.entries(headers).filter(([key]) => !key.startsWith(':'))
    );

    const req = {
        method: headers[':method'],
        url: headers[':path'],
        headers: {
            ...filteredHeaders,
            "host": headers[':authority'] || headers[':host'],
        },
        stream,
        socket: stream.session.socket,
        connection: stream.session.socket,
        httpVersion: '2.0',
        // for body parsing implement on data and end
        on: stream.on.bind(stream),
        pipe: stream.pipe.bind(stream),
        unpipe: stream.unpipe.bind(stream),
    };

    const customHeaders = {};

    // Minimal ServerResponse-like object
    const res = {
        writeHead: (status, headersObj) => {
            console.log('HTTP/2 response headers:', status, headersObj);
            stream.respond({ ':status': status, ...customHeaders, ...headersObj });
        },
        end: (data) => stream.end(data),
        write: (chunk) => stream.write(chunk),
        setHeader: (name, value) => {
            console.log('HTTP/2 set header:', name, value);
            customHeaders[name.toLowerCase()] = value;
        },
        // pipe: (dest) => stream.pipe(dest),
        // unpipe: (dest) => stream.unpipe(dest),
    };

    webRequest(req, res);

    // stream.respond({
    //     ':status': 200,
    //     'content-type': 'text/plain'
    // });
    // stream.end('OK');

});
// http2Server.on("request", (req, res) => {
//     if (!res.closed) {
//         webRequest(req, res);
//     }
// });
// http2Server.on("session", (session) => {});

httpServer.on('upgrade', wsRequest);
httpsServer.on('upgrade', wsRequest);
http2Server.on('upgrade', wsRequest);

httpServer.listen(httpPort, () => {
    console.log(`HTTP server listening on port ${httpPort}`);
});

// on cert init, we must assume that certificates have not been created yet
if (!config.initialSync) {
    // httpsServer.listen(httpsPort, () => {
    //     console.log(`HTTPS server listening on port ${httpsPort}`);
    // });
    if (!config.http2) {
        httpsServer.listen(httpsPort, () => {
            console.log(`HTTPS server listening on port ${httpsPort}`);
        });
    } else {
        http2Server.listen(httpsPort, () => {
            console.log(`HTTP/2 server listening on port ${httpsPort}`);
        });
    }
}