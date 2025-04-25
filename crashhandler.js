import tls from 'tls';
import http from 'http';
import https from 'https';

import config from './config.json' with { type: 'json' };
import { getCertificate } from './CertManager.js';

import { reloadProxy, reloadWebServer } from './index.js';

/**
 * Performs basic authentication
 * @param {*} req 
 * @param {*} res 
 * @param {*} user
 * @param {*} pass
 * @returns boolean successful authentication
 */
function basicAuth(req, res, user, pass, realm="Debug Access") {
    // Check for basic auth header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        res.writeHead(401, {
            'Content-Type': 'text/plain',
            'WWW-Authenticate': `Basic realm="${realm}"`
        });
        res.end("Unauthorized");
        return false;
    }

    // Verify credentials
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');

    if (username !== user || password !== pass) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end("Forbidden");
        return false;
    }
    return true;
}

// Fallback server logic
const serverLogic = (req, res) => {
    if (req.url.includes('/.well-known/status')) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(JSON.stringify({
            ok: false,
            status: "down",
            reason: "error",
            revisionId: "unknown",
        }));
    } else if (req.url.includes("/.debug/reset")) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Resetting...');
        process.exit(0);
    } else if (req.url.includes("/.debug/reboot")) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Rebooting...');

        // Get all active connections and destroy them
        const server = req.socket.server;
        server._connections = 0;
        server._handle.close();
        server.emit('close');

        // Force destroy any remaining sockets
        server.getConnections((err, count) => {
            if (err) console.error('Error getting connections:', err);
            if (count > 0) {
                server.connections.forEach(socket => socket.destroy());
            }
        });

        // Close the server
        server.close();

        // Restart the server
        setTimeout(() => {
            reloadProxy();
            reloadWebServer();
        }, 5000);
    } else {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
    }
};

function startServer(httpPort, httpsPort) {
    let httpServer, httpsServer;

    if (httpPort) {
        httpServer = http.createServer(serverLogic);
        httpServer.listen(httpPort, () => {
            console.log(`HTTP fallback server listening on port ${httpPort}`);
        });
    }

    if (httpsPort) {
        httpsServer = https.createServer({
            SNICallback: (hostname, cb) => {
                const cert = getCertificate(hostname);
                cb(null, tls.createSecureContext(cert));
            },
        }, serverLogic);

        httpsServer.listen(httpsPort, () => {
            console.log(`HTTPS fallback server listening on port ${httpsPort}`);
        });
    }

    return { httpServer, httpsServer };
}

export default function handleCrash(application, code) {
    if (config.fallback.disable) {
        console.info(`${application} exited with code ${code}. Stopping main process.`);
        process.exit(code);
    }

    switch (application) {
        case "proxy": {
            console.log(`Proxy server crashed with code ${code}. Starting fallback...`);
            try {
                startServer(config.ports[0], config.ports[1]);
            } catch (error) {
                console.error("Error starting proxy fallback server:", error);
                process.exit(code);
            }
            break;
        }
        case "management": {
            console.log(`Management server crashed with code ${code}. Starting fallback...`);
            try {
                startServer(config.management.port, null);
            } catch (error) {
                console.error("Error starting management fallback server:", error);
                process.exit(code);
            }
            break;
        }

        default: {
            console.log(`Unknown application "${application}" crashed with code ${code}.`);
            setTimeout(() => {
                process.exit(code);
            }, 5000);
            break;
        }
    }
}