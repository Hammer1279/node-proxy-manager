// Autodiscovery Service based on bonjour-service
import { Bonjour, Service } from "bonjour-service";
import config from './config.json' with {
    type: "json"
};

/**
 * What version of the config are supported for autodiscovery?
 * 
 * @type {string[]}
 */
const supportedAutoConfigVersions = ["v1"];

const instance = new Bonjour({
    probe: true
}, (error) => {
    console.error(error);
});

// TODO: actually call these on the positions where they are actually created
if (config.autodiscover.publishOwnServices) {
    instance.publish({
        name: "npm-management",
        type: "http-mgmt",
        port: config.management.port
    });
    instance.publish({
        name: "npm-http-proxy",
        type: "http",
        subtypes: ["proxy"],
        port: config.httpPort
    });
    instance.publish({
        name: "npm-https-proxy",
        type: "https",
        subtypes: ["proxy"],
        port: config.httpsPort
    });
}

/**
 * Publish a npm subservice to the bonjour network
 * @param {string} name 
 * @param {number} port 
 * @param {Object} txt 
 * @param {string} type 
 * @param {Array<string>} subtypes 
 * @returns {Service} BonjourService (unless forbidden by config)
 */
export function publishSubService(name, port, txt = {}, type = "http", subtypes = []) {
    if (config.autodiscover.publishOwnServices) {
        return instance.publish({
            name: "npm-" + name,
            type: type,
            subtypes: ["npm-subservice", ...subtypes],
            port: port,
            txt: txt
        });
    } else {
        return false;
    }
};

// Autodiscovery

const discovery = instance.find({
    subtypes: ["npmautoconfig"]
});

if (!config.autodiscover.enabled) {
    discovery.stop();
} else {
    setInterval(() => {
        console.debug("Rebroadcasting query");
        discovery.update();
    }, config.autodiscover.rescanInterval);
}

discovery.on("up", (service) => {
    if (service.subtypes.includes("npmautoconfig")) {
        try {
            const meta = JSON.parse(service.txt.npmautoconfig);
            if (!supportedAutoConfigVersions.includes(meta.version)) {
                console.debug(`${service.name} uses unsupported autoconfig version`);
                return;
            }
            // console.debug(service);
            console.debug(`${service.name} available on port ${service.port}`);
            console.debug(`Host: ${service.addresses[0]} / ${service.host}`);
            console.debug(`Config: ${JSON.stringify(meta, null, 4)}`);

            console.warn("Event Ignored: not implemented");
        } catch (error) {
            console.debug(error);
        }
    }
});

discovery.on("txt-update", (service) => {
    if (service.subtypes.includes("npmautoconfig")) {
        console.debug(`${service.name} updated txt record`);
        console.warn("Update ignored: not implemented");
    };
});

discovery.on("srv-update", (service) => {
    if (service.subtypes.includes("npmautoconfig")) {
        console.debug(`${service.name} updated srv record`);
        console.warn("Update ignored: not implemented");
    };
});

discovery.on("down", (service) => {
    if (service.subtypes.includes("npmautoconfig")) {
        try {
            const meta = JSON.parse(service.txt.npmautoconfig);
            if (!supportedAutoConfigVersions.includes(meta.version)) {
                console.debug(`${service.name} uses unsupported autoconfig version`);
                return;
            }
            // console.debug(service);
            console.debug(`${service.name} no longer available on port ${service.port}`);
            console.debug(`Host: ${service.addresses[0]} / ${service.host}`);
            console.debug(`Config: ${JSON.stringify(meta, null, 4)}`);

            console.warn("Event Ignored: not implemented");
        } catch (error) {
            console.debug(error);
        }
    }
});

export default undefined;