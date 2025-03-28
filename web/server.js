import fs from 'fs';
import express from 'express';
import superagent from 'superagent';
import { containsCidr } from 'cidr-tools';
import basicAuth from 'express-basic-auth';
import { join, resolve, dirname } from 'path';
import { parse } from "jsonc-parser";
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { mustache } from "consolidate";
import { renderFile, render as ejsRender } from 'ejs';
import { engine as handlebars, create } from 'express-handlebars';
import NodeCache from 'node-cache';

import config from '../config.json' with {
    type: "json"
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// allow comments in pages file
const pages = parse(fs.readFileSync("./web/pages.jsonc").toString());

const cache = new NodeCache({
    stdTTL: 3600,
    useClones: false
});

const app = express();

app.use(morgan('dev')); // development and console logging
if (config.management.logging) {
    // Ensure log file directory exists
    const logDir = dirname(join(process.cwd(), config.management.logFile));
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(join(process.cwd(), config.management.logFile), `Management Server started at ${new Date().toUTCString()}\n`);
    app.use(morgan('combined', {
        stream: fs.createWriteStream(join(process.cwd(), config.management.logFile), { flags: 'a' })
    })); // production
    process.once('SIGINT', () => {
        fs.appendFileSync(join(process.cwd(), config.management.logFile), `Management Server stopped at ${new Date().toUTCString()}\n`);
        process.exit();
    });
}

app.use((req, res, next) => {
    res.setHeader('Server', "HT Web-Framework V2-lite");
    res.setHeader('X-Powered-By', "HT Web-Framework V2-lite");
    next();
});

app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // res.setHeader('Content-Security-Policy', 'default-src \'self\'');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Feature-Policy', 'geolocation \'none\'; microphone \'none\'; camera \'none\'; speaker \'none\'; vibrate \'none\'; payment \'none\'; usb \'none\';');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    next();
});

// real IP assignment
app.use(async (req, res, next) => {
    let ip = "0.0.0.0/0";
    if ("x-forwarded-for" in req.headers) {
        if (containsCidr(["127.0.0.1", "::1", ...config.management.trustedProxies], req.ip)) {
            ip = req.headers['x-forwarded-for'] || req.ip; 
        } else {
            console.warn("Proxy IP not in list:", req.ip);
            return res.sendStatus(403);
        }
    } else if ("cf-connecting-ip" in req.headers){
        if (!cache.has("cfcidrList")) {
            cache.set("cfcidrList", (await superagent.get("https://api.cloudflare.com/client/v4/ips")).body);
        }
        const cfcidrList = cache.get("cfcidrList");
        if (!cfcidrList.success) {
            return next(cfcidrList.errors.join(", "));
        }
        if (containsCidr([...cfcidrList.result.ipv4_cidrs, ...cfcidrList.result.ipv6_cidrs], req.ip)) {
            ip = req.headers['cf-connecting-ip'] || req.ip;
        } else {
            console.warn("CF IP not in list:", req.ip);
            return res.sendStatus(403);
        }
    } else {
        ip = req.ip; // Do nothing
    }
    req.realIp = ip;
    next();
});

// Rate limiter
app.use(async (req, res, next) => {
    const rateSettings = config.management.ratelimit;
    if (rateSettings.enabled) {
        if (rateSettings.whitelist.includes(req.realIp)) {
            return next();
        }
        if (cache.has("ratelimit-" + req.realIp)) {
            const entry = cache.get("ratelimit-" + req.realIp);
            if (entry.count >= rateSettings.maxAuthRequests) {
                return res.setHeader("Retry-After", Math.floor((cache.getTtl("ratelimit-" + req.realIp) - Date.now()) / 1000)).sendStatus(429);
            }
        }
    }
    next();
});

app.use(basicAuth({
    users: { [config.management.username]: config.management.password },
    challenge: true,
    unauthorizedResponse: '401 Unauthorized',
    realm: 'Management Interface',
    unauthorizedResponse: (req) => {
        if (cache.has("ratelimit-" + req.realIp)) {
            const entry = cache.get("ratelimit-" + req.realIp);
            entry.count++;
            if (entry.count >= config.management.ratelimit.maxAuthRequests) {
                return 'Too Many Requests';
            }
        } else {
            cache.set("ratelimit-" + req.realIp, { count: 1 }, config.management.ratelimit.timeWindow);
        }
        return '401 Unauthorized';
    }
}));

app.set('views', join(__dirname, 'views'));
app.engine('mustache', mustache);
app.set('view engine', 'mustache');
app.engine('ejs', renderFile);
app.engine('handlebars', handlebars());
const hbs = create({
    extname: '.handlebars',
    // defaultLayout: 'base.mustache',
    defaultLayout: false,
    layoutsDir: join(__dirname, 'templates'),
    partialsDir: join(__dirname, 'templates'),
});
app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use("/static", express.static(join(process.cwd(), 'web', 'public')));

async function render(req, res, view, context, cb) {
    // Inject Servers
    context.pages = [...pages.navpages];

    // Active Detection
    context.pages.forEach(element => {
        element.active = req.url == element.url;
    });

    if (context.type == "ejs") {
        console.debug("Rendering EJS");
        const ejsResult = await renderFile(join(viewsDir, view + ".ejs"), context);
        partials['view'] = join(partialsDir, 'ejs.mustache');
        res.render(partials['base'], { ...context, partials: partials, ejs: ejsResult }, cb);
        return;
    } else if (context.type == "handlebars") {
        console.debug("Rendering Handlebars");
        const handlebarsResult = await hbs.renderView(join(viewsDir, view + ".handlebars"), context);
        partials['view'] = join(partialsDir, 'handlebars.mustache');
        res.render(partials['base'], { ...context, partials: partials, handlebars: handlebarsResult }, cb);
        return;
    } else {
        if (context.type && context.type != "mustache") {
            throw new Error("Unknown template type: " + context.type);
        }
        // Add current view
        partials['view'] = join(viewsDir, view + ".mustache");
        res.render(partials['base'], { ...context, partials: partials }, cb);
    }
}

function isJSON(str) {
    try {
        return JSON.stringify(str) && !!str;
    } catch (e) {
        return false;
    }
}

// Read partial templates
const partialsDir = join(__dirname, 'templates');

const viewsDir = join(__dirname, 'views');

// Map Partials
const partials = {}
fs.readdirSync(partialsDir).map(part => partials[part.replace(".mustache", '')] = join(partialsDir, part));

// Generate Routes
for (const path in pages.paths.get) {
    if (Object.hasOwn(pages.paths.get, path)) {
        const element = pages.paths.get[path];
        if (element.file) {
            app.get(path, async (req, res, next) => {
                let patches = {}
                if (element.scripts) {
                    try {
                        for await (const file of element.scripts) {
                            const module = await import("file://" + resolve(join('web', 'scripts', file + ".js")));
                            let result = module.get ? await module.get(element, { req, res, next }, config) : await module.default(element, { req, res, next }, config);
                            if (isJSON(result) && !(result?.done ?? false)) {
                                patches = { ...patches, ...result }
                            } else {
                                console.debug("Request already handled, returning...")
                                return;
                            }
                        }
                    } catch (error) {
                        return next(error);
                    }
                }
                if (element.settings && element.settings.subtitle) {
                    patches.title = element.settings.subtitle + " | " + settings.title;
                }
                const context = { ...settings, ...element.settings, ...patches };
                if (element.restriction) {
                    throw new Error("Restriction not implemented in this version");
                } else {
                    // TODO: add way to handle the script already handling requests and then skip this
                    try {
                        await render(req, res, element.file, context);
                    } catch (error) {
                        // TODO: check why errors are just ignored
                        console.debug(error);
                        // return next(error);
                    }
                }
            })
        } else {
            app.get(path, async (req, res, next) => {
                if (element.scripts) {
                    try {
                        for await (const file of element.scripts) {
                            const module = await import("file://" + resolve(join('web', 'scripts', file + ".js")));
                            module.get ? await module.get(element, { req, res, next }, config) : await module.default(element, { req, res, next }, config);
                        }
                    } catch (error) {
                        return next(error);
                    }
                } else {
                    next();
                }
            })
        }
    }
}
for (const path in pages.paths.post) {
    if (Object.hasOwn(pages.paths.post, path)) {
        const element = pages.paths.post[path];
        if (element.file) {
            app.post(path, async (req, res, next) => {
                let patches = {}
                if (element.scripts) {
                    try {
                        for await (const file of element.scripts) {
                            const module = await import("file://" + resolve(join('web', 'scripts', file + ".js")));
                            let result = module.post ? await module.post(element, { req, res, next }, config) : await module.default(element, { req, res, next }, config);
                            if (isJSON(result) && !(result?.done ?? false)) {
                                patches = { ...patches, ...result }
                            } else {
                                console.debug("Request already handled, returning...")
                                return;
                            }
                        }
                    } catch (error) {
                        return next(error);
                    }
                }
                if (element.settings && element.settings.subtitle) {
                    patches.title = element.settings.subtitle + " | " + settings.title;
                }
                const context = { ...settings, ...element.settings, ...patches };
                if (element.restriction) {
                    throw new Error("Restriction not implemented in this version");
                } else {
                    // TODO: add way to handle the script already handling requests and then skip this
                    try {
                        await render(req, res, element.file, context);
                    } catch (error) {
                        // TODO: check why errors are just ignored
                        console.debug(error);
                        // return next(error);
                    }
                }
            })
        } else {
            app.post(path, async (req, res, next) => {
                if (element.scripts) {
                    try {
                        for await (const file of element.scripts) {
                            const module = await import("file://" + resolve(join('web', 'scripts', file + ".js")));
                            module.post ? await module.post(element, { req, res, next }, config) : await module.default(element, { req, res, next }, config);
                        }
                    } catch (error) {
                        return next(error);
                    }
                } else {
                    next();
                }
            })
        }
    }
}

let settings = {
    ...pages.settings,
    pages: [...pages.navpages],
};

app.get('/', async (req, res) => {
    try {
        const currentConfigFile = await readFile(join(process.cwd(), 'config.json'), 'utf-8');
        const currentConfig = JSON.parse(currentConfigFile);
        res.json(currentConfig);
    } catch (error) {
        console.error('Error reading config file:', error);
        res.status(500).json({ error: 'Failed to read configuration' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    // res.status(500).json({
    //     error: 'Internal Server Error',
    //     message: err.message,
    //     stack: err.stack
    // });
    res.status(500).send(`<title>ERR: ${err.message}</title><h1>500: Internal Server Error</h1><p>${err.stack.replaceAll('\n', "<br />")}</p>`);
});

app.listen(config.management.port, () => {
    console.log(`Management server listening on port ${config.management.port}`);
});

