import { readFile, writeFile } from 'fs/promises';
import { IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import { request } from 'http';

/**
 * 
 * @param {*} page 
 * @param {{req: IncomingMessage, res: ServerResponse, next: Function}} param1 
 * @param {*} config 
 */
export const post = async (page, { req, res, next }, config) => {
    process.send("reload");
    await new Promise(resolve => setTimeout(resolve, 500));
    await new Promise((resolve, reject) => {
        const req = request({
            hostname: 'localhost',
            port: config.ports[0],
            path: '/.well-known/status',
            headers: {
                'User-Agent': 'Node-Proxy-Manager'
            }
        }, (response) => {
            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });
            response.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(data);
                resolve();
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