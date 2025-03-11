import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import { request } from 'http';

async function generateSecret() {
    const secret = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    if (!existsSync(join(process.cwd(), 'auth.json'))) {
        await writeFile(join(process.cwd(), 'auth.json'), JSON.stringify([secret], null, 3));
        return secret;
    }
    const authFile = JSON.parse(await readFile(join(process.cwd(), 'auth.json'), 'utf-8'));
    authFile.push(secret);
    await writeFile(join(process.cwd(), 'auth.json'), JSON.stringify(authFile, null, 3));
    return secret;
}

/**
 * 
 * @param {*} page 
 * @param {{req: IncomingMessage, res: ServerResponse, next: Function}} param1 
 * @param {*} config 
 */
export const post = async (page, { req, res, next }, config) => {
    const checkValue = Math.random().toString(36).substring(2, 8);

    // Send reload request to proxy server
    request({
        hostname: "localhost",
        path: "/.well-known/reload",
        method: "POST",
        auth: await generateSecret(),
        port: config.ports[0],
        headers: {
            'Content-Type': 'text/plain',
            'Content-Length': checkValue.length
        }
    }, (response) => {
        // process.send("reload");
        console.log(`Reload response status: ${response.statusCode}`);
        if (response.statusCode !== 200) {
            console.error('Failed to reload proxy server:', response.statusMessage);
            res.writeHead(500);
            res.end('Failed to reload proxy server: ' + response.statusMessage);
            return { done: true };
        }
    }).end(checkValue, 'utf-8');


    await new Promise(resolve => setTimeout(resolve, 500));
    await new Promise((resolve, reject) => {
        const req = request({
            hostname: 'localhost',
            path: '/.well-known/status',
            method: 'GET',
            port: config.ports[0],
            headers: {
                'User-Agent': 'Node-Proxy-Manager'
            }
        }, (response) => {
            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });
            response.on('end', () => {
                const status = JSON.parse(data);
                if (status.revisionId === checkValue) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(data);
                    resolve();
                } else {
                    reject('Revision ID mismatch');
                }
            });
        });

        req.on('error', reject);
        req.end();
    }).catch((error) => {
        console.error('Connection failed:', error);
        res.writeHead(500);
        res.end('Connection failed!');
    });

    return { done: true };
}