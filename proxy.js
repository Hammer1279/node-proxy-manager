import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import pkg from 'http-proxy';
const { createProxyServer } = pkg;
import { createServer as createServerHttp, IncomingMessage, ServerResponse } from 'http';
import { createServer as createServerHttps } from 'https';
import tls from 'tls';

import initialConfig from './config.json' with {
    type: "json"
};
import { handleChallenge } from './acme.js';
import forge from 'node-forge';
import { Socket } from 'net';
import { getCertificate } from './CertManager.js';

// always use in memory config for best performance (no disk IO)
let config = initialConfig;

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
function getSecureContext(domain) {
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

        return tls.createSecureContext({
            key: readFileSync(domConf.ssl.key),
            cert: readFileSync(domConf.ssl.cert),
            ca: domConf.ssl.ca.map(caPath => readFileSync(caPath))
        }).context;
    } catch (error) {
        console.error(`Error loading certificates for ${domain}:`, error);
        return tls.createSecureContext(getCertificate(domain));
    }
}

const proxy = createProxyServer({
    secure: false, // Allow self-signed certificates,
    ws: true
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
                status: 'down',
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
                status: 'down',
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
                status: 'down',
                reason: 'tea time',
                revisionId: config.revisionId || "initial",
            }));
            return;
        }
        res.writeHead(418, { 'Content-Type': 'text/plain' });
        res.end("It's not possible to control this teapot via HTCPCP/1.0, Teapots are not for brewing coffee!");
        return;
    } else if (req.url.includes('/.well-known/acme-challenge')) {
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
                status: 'up',
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
                const authFile = readFileSync(join(process.cwd(), 'auth.json'), 'utf-8');
                const validAuths = JSON.parse(authFile);
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
                        writeFileSync(join(process.cwd(), 'auth.json'), JSON.stringify(validAuths));
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

    // TODO: this needs to be reworked to be less resource intensive for faster proxying
    const domConfProxy = config.proxy.find(({ host: hosts, enabled = true }) => enabled && hosts.includes(invalidDomain ? invalidDomain : domain));
    const domConfStub = config.stub.find(({ host: hosts, enabled = true }) => enabled && hosts.includes(invalidDomain ? invalidDomain : domain));
    if (!domConfProxy && !domConfStub) { // No configuration found
        if (config.unconfiguredCloseNoResponse) {
            res.destroy();
        } else {
            res.writeHead(421, { 'Content-Type': 'text/plain' });
            res.end('Misdirected Request');
        }
        return;
    } else if (domConfStub) {
        res.writeHead(domConfStub.status || 200, domConfStub.headers || { 'Content-Type': 'text/plain' });
        res.end(domConfStub.message || 'OK');
        return;
    } else if (domConfProxy?.maintenance) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
        return;
    } else if ((domConfProxy?.secure || domConfStub?.secure) && req.socket.localPort === 80) {
        res.writeHead(301, { 'Location': `https://${domain}${req.url}` });
        res.end();
        return;
    } else if ((!(domConfProxy?.secure || domConfStub?.secure)) && req.socket.localPort === 443) {
        res.writeHead(301, { 'Location': `http://${domain}${req.url}` });
        res.end();
        return
    } else if (domConfProxy?.redirect) {
        res.writeHead(domConfProxy.redirectTemp ? 302 : 301, { 'Location': domConfProxy.target });
        res.end();
        return;
    } else {
        // calculate x-forwarded-for header
        let ip = "0.0.0.0/0";
        if ("x-forwarded-for" in req.headers) {
            if (containsCidr(["127.0.0.1", "::1", ...config.management.trustedProxies], req.ip)) {
                ip = req.headers['x-forwarded-for'] || req.ip; 
            } else {
                console.warn("Proxy IP not in list:", req.ip);
                return res.sendStatus(403);
            }
        } else if ("cf-connecting-ip" in req.headers){
            throw new Error("cf-connecting-ip header is not supported yet");
            // if (!cache.has("cfcidrList")) {
            //     cache.set("cfcidrList", (await superagent.get("https://api.cloudflare.com/client/v4/ips")).body);
            // }
            // const cfcidrList = cache.get("cfcidrList");
            // if (!cfcidrList.success) {
            //     return next(cfcidrList.errors.join(", "));
            // }
            // if (containsCidr([...cfcidrList.result.ipv4_cidrs, ...cfcidrList.result.ipv6_cidrs], req.ip)) {
            //     ip = req.headers['cf-connecting-ip'] || req.ip;
            // } else {
            //     console.warn("CF IP not in list:", req.ip);
            //     return res.sendStatus(403);
            // }
        } else {
            ip = req.ip; // Do nothing
        }
        console.debug('X-Forwarded-For:', ip);

        return proxy.web(req, res, {
            target: domConfProxy.target,
            xfwd: true,
            ws: domConfProxy.websocket,
            websocket: domConfProxy.websocket,
            proxyTimeout: domConfProxy.timeout || config.timeout,
            headers: domConfProxy.headers || {}
        });
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

httpServer.on('upgrade', wsRequest);
httpsServer.on('upgrade', wsRequest);

httpServer.listen(httpPort, () => {
    console.log(`HTTP server listening on port ${httpPort}`);
});

// on cert init, we must assume that certificates have not been created yet
if (!config.initialSync) {
    httpsServer.listen(httpsPort, () => {
        console.log(`HTTPS server listening on port ${httpsPort}`);
    });
}