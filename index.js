import { readdirSync, readFileSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import pkg from 'http-proxy';
const { createProxyServer } = pkg;
import { createServer as createServerHttp, IncomingMessage, ServerResponse } from 'http';
import { createServer as createServerHttps } from 'https';
import tls from 'tls';

import { pathToFileURL } from 'url';

import Greenlock from "greenlock";
import http01Lib from "acme-http-01-standalone";
const http01 = http01Lib.create({});



import config from './config.json' with {
    type: "json"
};
import { fork } from 'child_process';

if (config.acme.enabled) {
    let acmeFork = fork('./acme.js');

    const reloadAcme = () => {
        acmeFork.kill();
        acmeFork = fork('./acme.js');
    };

    let lastAcmeReload = Date.now();

    setInterval(() => {
        const now = Date.now();
        const daysSinceLastReload = (now - lastAcmeReload) / (24 * 60 * 60 * 1000);

        if (daysSinceLastReload >= config.acme.checkInterval) {
            reloadAcme();
            lastAcmeReload = now;
        }
    }, 60 * 60 * 1000); // Check every hour

    acmeFork.on("exit", (code) => {
        console.log(`ACME server exited with code ${code}`);
    });

    acmeFork.on("error", (err) => {
        console.error("ACME server error:", err);
    });
}

let proxyFork = fork('./proxy.js');

proxyFork.on("exit", (code) => {
    console.log(`Proxy server exited with code ${code}`);
});

proxyFork.on("error", (err) => {
    console.error("Proxy server error:", err);
});
proxyFork.on("message", (message) => {
    if (message === 'reload') {
        reloadProxy();
    } else {
        console.log("Unknown message from proxy server:", message);
    }
});

const reloadProxy = () => {
    proxyFork.kill();
    proxyFork = fork('./proxy.js');
};

if (config.management.enabled) {
    const webServerFork = fork("./web/server.js");
    webServerFork.on("exit", (code) => {
        console.log(`Web server exited with code ${code}`);
    });
    webServerFork.on("message", (message) => {
        if (message === 'reload') {
            reloadProxy();
        } else {
            console.log("Unknown message from web server:", message);
        }
    });
}

// Test server
if (config.testserver.enabled) {
    const testServer = createServerHttp((req, res) => {
        console.debug('Test server request', req.url);
        console.debug(req.headers);
        if (!config.testserver.fail) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end("OK");
        } else {
            // do nothing, cause a timeout
        }
    });

    testServer.listen(config.testserver.port, () => {
        console.log(`Test server listening on port ${config.testserver.port}`);
    });
}