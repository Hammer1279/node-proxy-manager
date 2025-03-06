import { readdirSync, readFileSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import pkg from 'http-proxy';
const { createProxyServer } = pkg;
import { createServer as createServerHttp, IncomingMessage, ServerResponse } from 'http';
import { createServer as createServerHttps } from 'https';
import tls from 'tls';

import config from './config.json' with {
    type: "json"
};
import { handleChallenge } from './acme.js';
import forge from 'node-forge';

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
        // Generate a self-signed certificate
        const pki = forge.pki;
        const keys = pki.rsa.generateKeyPair(2048);
        const cert = pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = '00';
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setHours(cert.validity.notBefore.getHours() + 1);
        const attrs = [{
            name: 'commonName',
            value: domain
        }];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.sign(keys.privateKey);

        return tls.createSecureContext({
            key: pki.privateKeyToPem(keys.privateKey),
            cert: pki.certificateToPem(cert)
        });
    }
}

const proxy = createProxyServer({
    secure: false // Allow self-signed certificates
});

proxy.on('error', (err, req, res) => {
    console.error(err);
    if (['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET'].includes(err.code)) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway');
    } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
    }
});

/**
 * 
 * @param {IncomingMessage} req 
 * @param {ServerResponse} res 
 * @returns 
 */
const webRequest = (req, res) => {
    if (config.maintenance) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
        return;
    } else if (config.teapot) {
        res.writeHead(418, { 'Content-Type': 'text/plain' });
        res.end('It’s not possible to control this teapot via HTCPCP/1.0, Teapots are not for brewing coffee!');
        return;
    } else if (req.url.includes('/.well-known/status')) {
        // console.debug(req.headers['user-agent']);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ok: true,
            status: 'up'
        }));
        return;
    } else if (req.url.includes('/.well-known/acme-challenge')) {
        if (config.acme.enabled) {
            handleChallenge(req, res);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
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
    } else if ((domConfProxy?.secure || domConfStub.secure) && req.socket.localPort === 80) {
        res.writeHead(301, { 'Location': `https://${domain}${req.url}` });
        res.end();
        return;
    } else if ((!(domConfProxy?.secure || domConfStub.secure)) && req.socket.localPort === 443) {
        res.writeHead(301, { 'Location': `http://${domain}${req.url}` });
        res.end();
        return
    } else if (domConfProxy?.redirect) {
        res.writeHead(domConfProxy.redirectTemp ? 302 : 301, { 'Location': domConfProxy.target });
        res.end();
        return;
    } else {
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

const httpServer = createServerHttp(webRequest);

const httpsServer = createServerHttps({
    SNICallback: (hostname, cb) => {
        console.log('SNICallback', hostname);
        const secureContext = getSecureContext(hostname);
        cb(null, secureContext);
    }
}, webRequest);

httpServer.listen(httpPort, () => {
    console.log(`HTTP server listening on port ${httpPort}`);
});

httpsServer.listen(httpsPort, () => {
    console.log(`HTTPS server listening on port ${httpsPort}`);
});