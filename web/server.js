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
import { Server } from 'ht-web-framework';

import config from '../config.json' with {
    type: "json"
};

import { ipcClient } from '../ipc.js';
export const ipc = ipcClient(config, "management");

const cache = new NodeCache({
    stdTTL: 3600,
    useClones: false
});

const pages = fs.readFileSync(join(process.cwd(), "web", "pages.jsonc"), 'utf-8');

const server = new Server(config.management, pages, config);
const app = server.app;

// Serve favicon.ico at root without auth
app.use("/favicon.ico", express.static(join(process.cwd(), "web", "public", "img", "logo.ico")));

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
        // lockdown mode if too many concurrent attacks are happening
        if (cache.keys().filter(key => key.startsWith("ratelimit-")).length >= (rateSettings.maxConcurrentFails || 10)) {
            const retryAfterDate = new Date(Date.now() + 5 * 60 * 1000).toUTCString();
            return res.setHeader("Retry-After", retryAfterDate).sendStatus(503);
        }
    }
    next();
});

app.use(basicAuth({
    users: config.management.accounts,
    challenge: true,
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

server.generateRoutes().start();