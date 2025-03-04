import { createServer } from 'node:net';
import { inspect } from 'node:util';
import { HTTPParser } from 'http-parser-js';
import config from './config.json' with {
    type: "json"
};
import pkg from './package.json' with {
    type: "json"
};

const htcpcpServer = createServer((socket) => {
    console.log(inspect(socket));
    socket.on("data", (data) => {
        console.log(data.toString());
        const rawRequest = data.toString();
        const requestLines = rawRequest.split('\r\n');
        const [requestLine, ...headerLines] = requestLines;
        const [method, path, protocol] = requestLine.split(' ');

        const headers = {};
        let bodyStartIndex = headerLines.findIndex(line => line === '') + 1;
        headerLines.slice(0, bodyStartIndex - 1).forEach(line => {
            const [key, value] = line.split(': ');
            headers[key] = value;
        });

        const body = headerLines.slice(bodyStartIndex).join('\r\n');

        // console.log({ method, path, protocol, headers, body });
        if (headers["Content-Type"] !== "message/coffeepot") {
            const responseBody = 'Content-Type must be message/coffeepot';
            socket.write("HTTP/0.9 000 Unsupported Media Type\r\n");
            socket.write("Content-Type: text/plain\r\n");
            socket.write(`Content-Length: ${Buffer.byteLength(responseBody)}\r\n`);
            socket.write("\r\n");
            socket.write(responseBody);
            socket.end();
            return; 
        }
        if (method == "BREW" || method == "POST") {
            // Respond to the BREW request
            const responseBody = 'Brewing your coffee!';
            socket.write('HTTP/1.1 200 BREWING\r\n');
            socket.write('Content-Type: text/plain\r\n');
            socket.write(`Content-Length: ${Buffer.byteLength(responseBody)}\r\n`);
            socket.write('Accept-Additions: Cream, Whole-milk, Vanilla, Raspberry, Whisky, Aquavit\r\n');
            socket.write('\r\n');
            socket.write(responseBody);
            socket.end();
        } else if (method == "WHEN") {
            // Respond to the WHEN request
            const responseBody = 'Stopped pouring milk!';
            socket.write('HTTP/1.1 200 OK\r\n');
            socket.write('Content-Type: text/plain\r\n');
            socket.write(`Content-Length: ${Buffer.byteLength(responseBody)}\r\n`);
            socket.write('\r\n');
            socket.write(responseBody);
            socket.end();
        } else if (method == "GET") {
            // Respond to the GET request
            const responseBody = '☕';
            socket.write('HTTP/1.1 200 Sending Coffee\r\n');
            socket.write('Content-Type: physical/liquid\r\n');
            socket.write(`Content-Length: ${Buffer.byteLength(responseBody)}\r\n`);
            socket.write('\r\n');
            socket.write(responseBody);
            socket.end();
        } else if (method == "PROPFIND") {
            // Respond to the PROPFIND request
            const responseBody = 
`<?xml app="node-coffee-pot v${pkg.version}" version="1.0" encoding="UTF-8"?>
<propfind>
    <status>ready</status>
    <waterLevel>full</waterLevel>
    <coffeeType>espresso</coffeeType>
    <additions>
        <addition>cream</addition>
        <addition>sugar</addition>
    </additions>
</propfind>`;
            socket.write('HTTP/1.1 000 OK\r\n');
            socket.write('Content-Type: application/xml\r\n');
            socket.write(`Content-Length: ${Buffer.byteLength(responseBody)}\r\n`);
            socket.write('\r\n');
            socket.write(responseBody);
            socket.end();
        } else {
            socket.write("HTTP/1.1 501 Not Implemented\r\n");
            socket.write("Content-Type: text/plain\r\n");
            socket.write("Content-Length: 24\r\n");
            socket.write("\r\n");
            socket.write("Command not recognized.");
            socket.end();
        }
    });
    // socket.write("418 I'm a teapot\r\n");
    const parser = new HTTPParser();

    // socket.end();
});

htcpcpServer.listen(config.htcpcp.port, () => {
    console.log(`HTCPCP server is running on port ${config.htcpcp.port}`);
});