import net, { createServer, connect } from 'node:net';
import { unlinkSync } from 'node:fs';

// ipc communication to stop the zombie process issue

/**
 * Create an IPC server for inter-process communication
 * @param {Object} config 
 * @returns {import('net').Socket}
 */
export const ipcServer = function (config) {
    try {
        unlinkSync(config.sock); // Remove old socket file if it exists
    } catch (error) {
        // ignore if the file does not exist
    }

    /**
     * @type {Set<import('net').Socket>}
     */
    const processes = new Set();
    /**
     * IPC server instance
     * @type {import('net').Server}
     */
    const ipc = createServer((socket) => {
        processes.add(socket);
        socket.on('data', (data) => {
            // console.debug('MAIN: IPC data received:', data.toString());
            if (data.length == 2) { // control code
                if (data[0] === 0xDE && data[1] === 0xAD) { // 0xDEAD
                    console.log('MAIN: Received stop command from IPC');
                    ipc.emit("stop");
                } else {
                    console.log("MAIN: Received code:", data.toString('hex'));
                    ipc.emit("broadcast", data);
                }
            } else {
                console.log(`MAIN: IPC data received:`, data.toString());
                ipc.emit("broadcastData", data);
            }
            // // Broadcast the data to all other processes
            // processes.forEach(proc => {
            //     if (proc !== socket) {
            //         proc.write(data);
            //     }
            // });
        });
        socket.on('close', () => {
            processes.delete(socket);
        });
        socket.on('error', (err) => {
            console.error('MAIN: IPC socket error:', err);
            processes.delete(socket);
        });
    });
    ipc.on("broadcast", (data) => {
        processes.forEach(proc => {
            // Send only the first 2 bytes of the data (should not be longer for control codes)
            const buf = Buffer.from(data).subarray(0, 2);
            proc.write(buf);
        });
    });
    ipc.on("broadcastData", (data) => {
        processes.forEach(proc => {
            proc.write(data);
        });
    });
    ipc.on("stop", () => {
        processes.forEach(proc => {
            // Send a recognizable shutdown message as a buffer (0xDEAD)
            const buf = Buffer.alloc(2);
            buf.writeUInt16BE(57005, 0); // 57005 == 0xDEAD
            proc.write(buf);
        });
        ipc.close();
        setInterval(() => {
            if (processes.size == 0) {
                process.exit(0);
            }
        }, 1000);
    });
    ipc.on("close", () => {
        processes.clear();
        // unlinkSync(config.sock);
    });
    ipc.on("error", (err) => {
        console.error('MAIN: IPC server error:', err);
        // hopefully this wont kill the ipc since that can cause orphaned processes
        ipc.emit("stop");
    });
    ipc.listen(config.sock, () => {
        console.log(`IPC server listening on ${config.sock}`);
    });
    return ipc;
}

/**
 * IPC client for subprocesses
 * @param {Object} config 
 * @param {string} name 
 * @returns {import('net').Socket}
 */
export const ipcClient = function (config, name = "FIXME") {
    const procName = name.toUpperCase();
    const ipc = connect(config.sock);
    const _nativeWrite = ipc.write;
    ipc.write = (data) => {
        console.log(`${procName}: IPC write:`, data.toString());
        _nativeWrite.call(ipc, data);
    }
    ipc.write(Buffer.from(name + " started and listening"));
    ipc.on("data", (data) => {
        if (data.length == 2) { // control code
            if (data[0] === 0xDE && data[1] === 0xAD) { // 0xDEAD
                console.log(`${procName}: Received stop command from IPC`);
                ipc.end();
                process.exit(0);
            } else {
                console.log(`${procName}: Received code:`, data.toString('hex'));
            }
        } else {
            console.log(`${procName}: IPC data received:`, data.toString());
        }
    });
    // if IPC is closed, then the subprocess is orphaned as the main process died
    ipc.on("close", () => {
        console.log(`${procName}: IPC connection closed`);
        process.exit(0);
    });
    ipc.on("error", (err) => {
        console.error(`${procName}: IPC error:`, err);
        process.exit(1);
    });
    return ipc;
};