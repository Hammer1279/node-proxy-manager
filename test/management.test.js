import fs from "fs";
import path from "path";
import assert from "assert";
import supertest from "supertest";
import { fileURLToPath } from "url";
import { spawn, fork } from "child_process";
import { ipcServer } from "../ipc.js";
import { it, beforeEach } from "mocha";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, "data", "config.json"), "utf-8")
);

const SERVER_PATH = path.join(__dirname, "../web/server.js");
const PORT = testConfig.management.port || 81;
const BASE_URL = `http://localhost:${PORT}`;
const ADMIN_USER = testConfig.management.username || "admin";
const ADMIN_PASS = testConfig.management.password || "admin";

let serverProcess;
/**
 * @type {import('net').Socket}
 */
let processIPC;

function waitForServerReady(port, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        (function check() {
            supertest(BASE_URL)
                .get("/")
                .auth(ADMIN_USER, ADMIN_PASS)
                .end((err, res) => {
                    if (!err && res && res.status < 400) return resolve();
                    if (res.status > 400) {
                        return reject(new Error(`Server responded with status ${res.status}, possible configuration error?`));
                    }
                    if (Date.now() - start > timeout) return reject(new Error("Server did not start in time"));
                    setTimeout(check, 200);
                });
        })();
    });
}

describe("Test update.js for correct parsing and updating", function () {
    this.timeout(10000);

    before(async function () {
        fs.renameSync(
            path.join(__dirname, "..", "config.json"),
            path.join(__dirname, "..", "config.json.orig")
        );
        fs.copyFileSync(
            path.join(__dirname, "data", "config.json"),
            path.join(__dirname, "..", "config.json")
        );
        processIPC = ipcServer(testConfig);
        serverProcess = spawn("node", [SERVER_PATH, path.join(__dirname, "data", "config.json")], {
            env: { ...process.env },
            stdio: "inherit"
        });
        await waitForServerReady(PORT);
    });

    beforeEach(function () {
        // make sure ipc has not been closed
        assert.ok(processIPC);
        assert.ok(!processIPC.closed);
        // assert.ok(processIPC.writable);
    });

    after(function (done) {
        processIPC.emit("stop");
        Promise.all([
            new Promise((resolve) => {
                if (serverProcess) {
                    serverProcess.on("exit", resolve);
                } else {
                    resolve();
                }
            }),
            new Promise((resolve) => {
                if (processIPC) {
                    processIPC.on("close", resolve);
                } else {
                    resolve();
                }
            }),
            new Promise((resolve) => {
                fs.unlinkSync(path.join(__dirname, "..", "config.json"));
                fs.renameSync(
                    path.join(__dirname, "..", "config.json.orig"),
                    path.join(__dirname, "..", "config.json")
                );
                resolve();
            }),
        ]).then(() => done());
    });

    it("should 404 for non-existent proxy id", async function () {
        console.log(BASE_URL)
        const res = await supertest(BASE_URL)
            .post("/proxy/9999")
            .auth(ADMIN_USER, ADMIN_PASS)
            .send({ host: "localhost" });
        assert.strictEqual(res.status, 404);
    });

    it("should update an existing proxy entry", async function () {
        // Use id 0 from test config
        const res = await supertest(BASE_URL)
            .post("/proxy/0")
            .auth(ADMIN_USER, ADMIN_PASS)
            .send({ host: "localhorst", enabled: "on" });
        // Should redirect after update
        console.log(res.status);
        assert.strictEqual(res.status, 302);
        assert.ok(res.headers.location && res.headers.location.includes("/proxy"));
        // Verify the update
        const newConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8"));
        assert.ok(newConfig.proxy);
        assert.strictEqual(newConfig.proxy[0].host[0], "localhorst");
        assert.strictEqual(newConfig.proxy[0].enabled, true);
    });

    it("should create an new proxy entry (basic)", async function () {
        const origLength = JSON.parse(await fs.promises.readFile(path.join(__dirname, "..", "config.json"), "utf-8")).proxy.length;
        const res = await supertest(BASE_URL)
            .post("/proxy/new")
            .auth(ADMIN_USER, ADMIN_PASS)
            .send({ host: "localhost", enabled: "on" });
        assert.strictEqual(res.status, 302);
        const newConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8"));
        assert.ok(newConfig.proxy);
        assert.strictEqual(newConfig.proxy.length, origLength + 1);
        assert.strictEqual(newConfig.proxy[origLength].host[0], "localhost");
        assert.strictEqual(newConfig.proxy[origLength].enabled, true);
    });

    it("should create a new proxy entry from url-encoded form string", async function () {
        const res = await supertest(BASE_URL)
            .post("/proxy/new")
            .auth(ADMIN_USER, ADMIN_PASS)
            .send("description=testtest&enabled=on&maintenance=off&host=testtest&target=http://test&timeout=3000&secure=on&ssl[key]=test/test&ssl[cert]=test/test&ssl[ca]=test/test,test/test&auth[enabled]=on&auth[username]=user&auth[password]=pass&auth[realm]=");
        assert.strictEqual(res.status, 302);
        const newConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8"));
        assert.ok(newConfig.proxy);
        const lastEntry = newConfig.proxy[newConfig.proxy.length - 1];
        assert.strictEqual(lastEntry.description, "testtest");
        assert.strictEqual(lastEntry.enabled, true);
        assert.strictEqual(lastEntry.maintenance, false);
        assert.deepStrictEqual(lastEntry.host, ["testtest"]);
        assert.strictEqual(lastEntry.target, "http://test");
        assert.strictEqual(lastEntry.timeout, 3000);
        assert.strictEqual(lastEntry.secure, true);
        assert.strictEqual(lastEntry.ssl.key, "test/test");
        assert.strictEqual(lastEntry.ssl.cert, "test/test");
        assert.deepStrictEqual(lastEntry.ssl.ca, ["test/test", "test/test"]);
        assert.strictEqual(lastEntry.auth.enabled, true);
        assert.strictEqual(lastEntry.auth.username, "user");
        assert.strictEqual(lastEntry.auth.password, "pass");
    });

    it("should create a new proxy entry from json", async function () {
        const res = await supertest(BASE_URL)
            .post("/proxy/new")
            .auth(ADMIN_USER, ADMIN_PASS)
            .send({
                "description": "testtest",
                "enabled": "on",
                "maintenance": "off",
                "host": "testtest",
                "target": "http://test",
                "timeout": "3000",
                "secure": "on",
                "ssl": {
                    "key": "test/test",
                    "cert": "test/test",
                    "ca": "test/test,test/test"
                },
                "auth": {
                    "enabled": "on",
                    "username": "user",
                    "password": "pass",
                    "realm": ""
                }
            });
        assert.strictEqual(res.status, 302);
        const newConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8"));
        assert.ok(newConfig.proxy);
        const lastEntry = newConfig.proxy[newConfig.proxy.length - 1];
        assert.strictEqual(lastEntry.description, "testtest");
        assert.strictEqual(lastEntry.enabled, true);
        assert.strictEqual(lastEntry.maintenance, false);
        assert.deepStrictEqual(lastEntry.host, ["testtest"]);
        assert.strictEqual(lastEntry.target, "http://test");
        assert.strictEqual(lastEntry.timeout, 3000);
        assert.strictEqual(lastEntry.secure, true);
        assert.strictEqual(lastEntry.ssl.key, "test/test");
        assert.strictEqual(lastEntry.ssl.cert, "test/test");
        assert.deepStrictEqual(lastEntry.ssl.ca, ["test/test", "test/test"]);
        assert.strictEqual(lastEntry.auth.enabled, true);
        assert.strictEqual(lastEntry.auth.username, "user");
        assert.strictEqual(lastEntry.auth.password, "pass");
    });

    it("should reject invalid booleans on create", async function () {
        const res = await supertest(BASE_URL)
            .post("/proxy/new")
            .auth(ADMIN_USER, ADMIN_PASS)
            .send({
                "description": "testtest",
                "enabled": ["off", "on"],
                "maintenance": ["on", "off"],
                "host": "testtest",
                "target": "http://test",
                "timeout": "3000",
                "secure": ["off", "on"],
                "ssl": {
                    "key": "test/test",
                    "cert": "test/test",
                    "ca": "test/test,test/test"
                },
                "auth": {
                    "enabled": "on",
                    "username": "user",
                    "password": "",
                    "realm": ""
                }
            });
        assert.strictEqual(res.status, 400);
    });

    it("should reject invalid booleans on update", async function () {
        const runningConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8"));
        assert.ok(runningConfig.proxy);
        const res = await supertest(BASE_URL)
            .post("/proxy/" + (runningConfig.proxy.length - 1))
            .auth(ADMIN_USER, ADMIN_PASS)
            .send({
                "description": "testtest",
                "enabled": ["off", "on"],
                "maintenance": ["on", "off"],
                "host": "testtest",
                "target": "http://test",
                "timeout": "3000",
                "secure": ["off", "on"],
                "ssl": {
                    "key": "test/test",
                    "cert": "test/test",
                    "ca": "test/test,test/test"
                },
                "auth": {
                    "enabled": "on",
                    "username": "user",
                    "password": "",
                    "realm": ""
                }
            });
        assert.strictEqual(res.status, 400);
    });
});
