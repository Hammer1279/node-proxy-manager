import net, { createServer, connect } from 'node:net';
import { unlinkSync } from 'node:fs';

// ipc communication to stop the zombie process issue

/**
 * Create an IPC server for inter-process communication
 * @param {Object} config 
 * @param {Function?} watchdog function with access to local params (WIP)
 * @returns {import('net').Socket}
 */
export const ipcServer = function (config, watchdog) {
    try {
        unlinkSync(config.sock); // Remove old socket file if it exists
    } catch (error) {
        // ignore if the file does not exist
    }

    /**
     * @type {boolean}
     */
    let shutdown = false;

    /**
     * @type {Set<import('net').Socket>}
     */
    const processes = new Set();

    if (watchdog) {
        watchdog.call(this, processes);
    }

    /**
     * IPC server instance
     * @type {import('net').Server}
     */
    const ipc = createServer((socket) => {
        processes.add(socket);
        socket.procName = "UNKNOWN";
        socket.procPid = null;

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
                const msg = data.toString();
                console.log(`MAIN: IPC data received:`, msg);

                if (msg.startsWith('REG:')) {
                    const [_, name, pid] = msg.split(':');
                    socket.procName = name.toUpperCase();
                    socket.procPid = parseInt(pid, 10);

                    console.log(`WATCHDOG: Successfully registered client [${socket.procName}] with OS PID [${socket.procPid}]`);
                    return; // Exit early so registration string isn't broadcasted
                }
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
            if (shutdown) {
                return; // ignore any errors on shutdown
            }
            console.error('MAIN: IPC socket error:', err);
            processes.delete(socket);
        });
    });
    ipc.on("broadcast", (data) => {
        processes.forEach(proc => {
            // Send only the first 2 bytes of the data (should not be longer for control codes)
            const buf = data.subarray(0, 2);
            proc.write(buf);
        });
    });
    ipc.on("broadcastData", (data) => {
        processes.forEach(proc => {
            proc.write(data);
        });
    });
    ipc.on("stop", () => {
        shutdown = true;
        let exitCode = 0;
        // Send a recognizable shutdown message as a buffer (0xDEAD)
        const buf = Buffer.alloc(2);
        buf.writeUInt16BE(57005, 0); // 57005 == 0xDEAD
        processes.forEach(proc => {
            proc.write(buf);
        });
        ipc.close();

        let attempts = 0;
        const shutdownTimer = setInterval(() => {
            attempts++;
            if (processes.size === 0 || attempts >= 5) {
                if (processes.size > 0) {
                    exitCode = 1;
                    console.warn(`MAIN: Forced exit. ${processes.size} clients refused to disconnect.`);
                }
                clearInterval(shutdownTimer);
                console.log("Process Exiting...");
                process.exit(exitCode);
            }
        }, 1000);
    });
    ipc.on("close", () => {
        console.log('MAIN: IPC disconnected')
        // processes.clear();
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
    const procName = name.toUpperCase().replaceAll(" ", "_");
    const ipc = connect(config.sock);
    const _nativeWrite = ipc.write;
    ipc.write = (data, ...args) => {
        console.log(`${procName}: IPC write:`, data.toString());
        _nativeWrite.call(ipc, data, ...args);
    }
    ipc.on("connect", () => {
        ipc.write(Buffer.from(`REG:${name}:${process.pid}`));
        ipc.write(Buffer.from(name + " started and listening"));
    });
    ipc.on("data", (data) => {
        if (data.length == 2) { // control code
            if (data[0] === 0xDE && data[1] === 0xAD) { // 0xDEAD
                console.log(`${procName}: Received stop command from IPC`);
                ipc.end();
                process.exit(0);
            } else if (data[0] === 0x88 && data[1] === 0x88) {
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