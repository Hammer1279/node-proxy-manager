import fs from 'fs';
import express from 'express';
import basicAuth from 'express-basic-auth';
import { join, resolve, dirname } from 'path';
import { parse } from "jsonc-parser";
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { mustache } from "consolidate";

import config from '../config.json' with {
    type: "json"
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// allow comments in pages file
const pages = parse(fs.readFileSync("./web/pages.jsonc").toString());



const app = express();

// app.use(morgan('combined')); // production
app.use(morgan('dev')); // development

app.use((req, res, next) => {
    res.setHeader('X-Powered-By', "HT Web-Framework V2-lite");
    next();
});

app.use(basicAuth({
    users: { [config.management.username]: config.management.password },
    challenge: true,
    unauthorizedResponse: '401 Unauthorized',
    realm: 'Management Interface',
}));

app.set('views', join(__dirname, 'views'));
app.engine('mustache', mustache);
app.set('view engine', 'mustache');
app.use(express.json());

app.use("/static", express.static(join(process.cwd(), 'web', 'public')));

async function render(req, res, view, context, cb) {
    // Inject Servers
    context.pages = [...pages.navpages];

    // Active Detection
    context.pages.forEach(element => {
        element.active = req.url == element.url;
    });

    partials['view'] = join(viewsDir, view + ".mustache")
    res.render(partials['base'], { ...context, partials: partials }, cb);
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
                        render(req, res, element.file, context);
                    } catch (error) {
                        console.debug(error);
                    }
                }
            })
        } else {
            app.get(path, async (req, res, next) => {
                if (element.scripts) {
                    for await (const file of element.scripts) {
                        const module = await import("file://" + resolve(join('web', 'scripts', file + ".js")));
                        module.get ? await module.get(element, { req, res, next }, config) : await module.default(element, { req, res, next }, config);
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
                        render(req, res, element.file, context);
                    } catch (error) {
                        console.debug(error);
                    }
                }
            })
        } else {
            app.post(path, async (req, res, next) => {
                if (element.scripts) {
                    for await (const file of element.scripts) {
                        const module = await import("file://" + resolve(join('web', 'scripts', file + ".js")));
                        module.post ? await module.post(element, { req, res, next }, config) : await module.default(element, { req, res, next }, config);
                    }
                } else {
                    next();
                }
            })
        }
    }
}

let settings = {
    title: 'NPM Management Console',
    headerTitle: 'Management Console',
    base_stylesheets: ['bootstrap.css', 'custom.css'],
    base_scripts: [],
    loadbootstrap: true,
    widgets: [
        { title: 'Server Status', description: 'All servers are operational.' },
        { title: 'User Activity', description: '5 users are currently online.' },
    ],
    pages: [...pages.navpages],
    username: "Mr. Anonymous"
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

app.listen(config.management.port, () => {
    console.log(`Management server listening on port ${config.management.port}`);
});