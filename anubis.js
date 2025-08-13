// Anubis Middleware for Node Proxy Manager
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';


// this module wont support hot reloading
import config from './config.json' with {
    type: "json"
};
import { proxy } from './proxy.js';

const profileDefinition = await readFile(`${config.anubis.configPath}/${config.anubis.profile}.env`, { encoding: 'utf-8' });
export const anubisBindPort = profileDefinition.match(/BIND=:(\d+)/)?.[1] || '8923';
const anubisTargetPort = profileDefinition.match(/TARGET=([^ ]+)/)?.[1]?.match(/:(\d+)/)?.[1] || '3000';

if (!/^https?:\/\/localhost:\d+$/.test(profileDefinition.match(/TARGET=(.*)/)?.[1]?.trim())) {
    throw new Error("Anubis target must be a localhost address with a port, e.g. 'localhost:3000'");
}

console.log(anubisBindPort);
console.log(anubisTargetPort);

createServer((req, res) => {
    const proxyOptions = JSON.parse(Buffer.from(req?.headers['x-npm-request'] || '', 'base64').toString());
    delete req.headers["x-npm-request"]; // Remove the header to avoid sending it to the target
    // res.setHeader('Set-Cookie', 'techaro.lol-anubis-auth=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/;'); // always check if the browser is still not a bot (should usually not be enabled)
    proxy.web(req, res, proxyOptions);
}).listen(anubisTargetPort, () => {
    console.log(`Anubis middleware listening on port ${anubisTargetPort}`);
});

export function anubisHandoff(req, res, ip, domConfProxy, proxyOptions) {
    return proxy.web(req, res, {
        target: `http://localhost:${anubisBindPort}/`,
        headers: {
            "X-Real-Ip": ip,
            "X-NPM-Request": Buffer.from(JSON.stringify(proxyOptions)).toString('base64'),
        },
        ws: domConfProxy.websocket,
        websocket: domConfProxy.websocket,
        toProxy: true,
    });
}