// client to add auth secrets from local network to restart proxy service

import { ipcClient } from "./ipc.js";
import { publishSubService } from "./bonjour.js";
import { createServer } from "net";
import { createSocket } from "dgram";

import config from './config.json' with {
    type: "json"
};

const ipc = new ipcClient(config, "auth client");

function generateSecret() {
    const secret = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    return secret;
}

function submitSecret(secret) {
    ipc.write(Buffer.from([0xC0, 0xCC, ...Buffer.from(secret, 'utf-8'), 0xC0, 0xCC]));
    return btoa(secret);
}

const server = createServer((socket) => {
    socket.on("data", (data) => {
        let secret = data.toString("utf-8");
        if (data.equals(Buffer.alloc(1, 0x00))) {
            secret = generateSecret();
        }
        socket.write(Buffer.from(submitSecret(secret)));
        socket.destroySoon();
    });
});

server.listen(8181, "127.0.0.1", () => {
    console.log("AUTH_CLIENT:", "Auth server listening for connections on 127.0.0.1:8181");
});

publishSubService("auth-client", 8181, {}, "tcp");