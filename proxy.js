import { readdirSync, readFileSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import pkg from 'http-proxy';
const { createProxyServer } = pkg;
import { createServer as createServerHttp, IncomingMessage, ServerResponse } from 'http';
import { createServer as createServerHttps } from 'https';
import tls from 'tls';

import Greenlock from "greenlock";
import http01Lib from "acme-http-01-standalone";
const http01 = http01Lib.create({});

import config from './config.json' with {
    type: "json"
};

const [httpPort, httpsPort] = config.ports;

// function to pick out the key + certs dynamically based on the domain name
function getSecureContext(domain) {
    const files = readdirSync('./certs');
    const domConf = config.proxy.find(({ host: hosts }) => hosts.includes(domain));
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
}

const proxy = createProxyServer();

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
    } else if (req.url === '/.well-known/acme-challenge') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
    }
    const domain = req.headers.host.split(':')[0];
    const domConfProxy = config.proxy.find(({ host: hosts }) => hosts.includes(domain));
    const domConfStub = config.stub.find(({ host: hosts }) => hosts.includes(domain));
    if (!domConfProxy) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway');
        return;
    } else if (domConfProxy.maintenance) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
        return;
    } else if (domConfProxy.secure && req.socket.localPort === 80) {
        res.writeHead(301, { 'Location': `https://${domain}${req.url}` });
        res.end();
        return;
    } else if (domConfProxy.redirect) {
        res.writeHead(301, { 'Location': domConfProxy.target });
        res.end();
        return;
    } else if (domConfStub) {
        res.writeHead(domConfStub.status || 200, domConfStub.headers || { 'Content-Type': 'text/plain' });
        res.end(domConfStub.message || 'OK');
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