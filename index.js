import { readdirSync, readFileSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import pkg from 'http-proxy';
const { createProxyServer } = pkg;
import { createServer as createServerHttp } from 'http';
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

// const proxy = createProxyServer();

const httpServer = createServerHttp((req, res) => {
    const domain = req.headers.host.split(':')[0];
    const domConf = config.proxy.find(({ host: hosts }) => hosts.includes(domain));
    console.log('http');
    console.log(`Request method: ${req.method}, URL: ${req.url}`);
    res.writeHead(204, { 'Content-Type': 'text/plain' });
    res.end();
});

const httpsServer = createServerHttps({
    SNICallback: (hostname, cb) => {
        console.log('SNICallback', hostname);
        const secureContext = getSecureContext(hostname);
        cb(null, secureContext);
    }
}, (req, res) => {
    const domain = req.headers.host.split(':')[0];
    const domConf = config.proxy.find(({ host: hosts }) => hosts.includes(domain));
    console.log('https');
    console.log(`Request method: ${req.method}, URL: ${req.url}`);
    res.writeHead(204, { 'Content-Type': 'text/plain' });
    res.end();
});

httpServer.listen(httpPort, () => {
    console.log(`HTTP server listening on port ${httpPort}`);
});

httpsServer.listen(httpsPort, () => {
    console.log(`HTTPS server listening on port ${httpsPort}`);
});