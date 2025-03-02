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
import { fork } from 'child_process';

let proxyFork = fork('./proxy.js');

const reloadProxy = () => {
    proxyFork.kill();
    proxyFork = fork('./proxy.js');
};

if (config.management.enabled) {
    const webServerFork = fork("./web/server.js");
    webServerFork.on("exit", (code) => {
        console.log(`Web server exited with code ${code}`);
    });
}

// Test server
if (config.testserver.enabled) {
    const testServer = createServerHttp((req, res) => {
        console.debug('Test server request', req.url);
        console.debug(req.headers);
        if (!config.testserver.fail) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end("Test server");
        }
    });
    
    testServer.listen(config.testserver.port, () => {
        console.log(`Test server listening on port ${config.testserver.port}`);
    });
}