import { readdirSync, readFileSync, existsSync } from 'fs';
import { readdir, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import pkg from 'http-proxy';
const { createProxyServer } = pkg;
import { createServer as createServerHttp, IncomingMessage, ServerResponse } from 'http';
import { createServer as createServerHttps } from 'https';
import tls from 'tls';

import WebSocket, { WebSocketServer } from 'ws';

import { pathToFileURL } from 'url';

import Greenlock from "greenlock";
import http01Lib from "acme-http-01-standalone";
const http01 = http01Lib.create({});

// import config from './config.json' with {
//     type: "json"
// };

// run "npm run migrate" to update config.json references instead
// import updateConfigRefs from './migration.js';
// await updateConfigRefs(join(process.cwd(), 'config.json'));

const config = (await import('./config.json', {
    with: { type: "json" }
})).default;

import { fork } from 'child_process';
import handleCrash from './crashhandler.js';
import { getCertificate } from './CertManager.js';

if (existsSync(join(process.cwd(), 'auth.json')) && config.cleanAuthFile) {
    unlink(join(process.cwd(), 'auth.json')); // Remove old auth file
}

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

// Init proxy as clusters https://nodejs.org/api/cluster.html
let proxyFork = fork('./proxy.js');

proxyFork.on("exit", (code) => {
    console.log(`Proxy server exited with code ${code}`);
    handleCrash("proxy", code);
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

export const reloadProxy = () => {
    proxyFork.kill();
    proxyFork = fork('./proxy.js');
};

// experimental, use with caution
export let reloadWebServer = () => {
    throw new Error("Web server not initialized");
}

if (config.management.enabled) {
    let webServerFork = fork("./web/server.js");
    webServerFork.on("exit", (code) => {
        console.log(`Web server exited with code ${code}`);
        handleCrash("management", code);
    });
    webServerFork.on("message", (message) => {
        if (message === 'reload') {
            reloadProxy();
        } else {
            console.log("Unknown message from web server:", message);
        }
    });
    reloadWebServer = () => {
        webServerFork.kill();
        webServerFork = fork("./web/server.js");
    }
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

    if (config.testserver.websocket) {
        const wss = new WebSocketServer({
            server: testServer
        });

        wss.on("headers", (headers, req) => {
            console.log('Test server WebSocket headers:', headers, req.url);
        });

        wss.on('connection', (ws, req) => {
            console.log('Test server WebSocket connection');
            // console.debug('Test server WebSocket headers:', ws.protocol, ws._socket.server._connectionKey);
            ws.on('message', (message) => {
                console.log('Test server WebSocket message:', message.toString());
                ws.send(message.toString());
            });
            ws.send('Hello from the test server!');
            setTimeout(() => {
                ws.close(1000, 'Goodbye: timeout');
            }, 10000);
        });

        // Secure WebSocket test server
        if (false) {
            // try to replicate this error
            // Error during request to /agent.ashx: write EPROTO 80486B1C5E700000:error:0A00010B:SSL routines:ssl3_get_record:wrong version number:../deps/openssl/openssl/ssl/record/ssl3_record.c:354:

            // secure server
            const httpsserver = createServerHttps(getCertificate("localhost"), (req, res) => { });

            // Create secure WebSocket server
            const wsss = new WebSocketServer({
                server: httpsserver
            });

            wsss.on("headers", (headers, req) => {
                console.log('Test server secure WebSocket headers:', headers, req.url);
            });

            wsss.on('connection', (ws, req) => {
                console.log('Test server secure WebSocket connection');
                // console.debug('Test server WebSocket headers:', ws.protocol, ws._socket.server._connectionKey);
                ws.on('message', (message) => {
                    console.log('Test server secure WebSocket message:', message.toString());
                    ws.send(message.toString());
                });
                ws.send('Hello from the secure test server!');
                setTimeout(() => {
                    ws.close(1000, 'Goodbye: timeout');
                }, 10000);
            });

            wsss.on('error', (error) => {
                console.error('Secure WebSocket server error:', error);
            });

            httpsserver.listen(config.testserver.port + 1, () => {
                console.log(`Secure test server listening on port ${config.testserver.port + 1}`);
            });
        }
    }
}