# node-proxy-manager
An NodeJS version of Nginx Proxy Manager that is hopefully more reliable.

## Setup

### Prerequisites

- Node.js v17.5.0 or higher
- npm
- git
- pm2 (optional)

### Installation

1. Clone the repository: `git clone https://github.com/hammer1279/node-proxy-manager`
2. Change directory to the new directory: `cd node-proxy-manager`
3. Install NPM dependencies: `npm install`
4. Edit the `config.json` with the editor of your choice
5. Run the application: `node index.js`

### Updating from Git

During updates, often config changes are shipped to keep your config compatible, most features are non breaking.

To update it without many issues:
1. stash local changes: `git add * && git stash`
2. update local clone: `git pull`
3. pop stash: `git stash pop`
4. check the config with a editor of your choice for any merge conflicts and resolve them

### Autostart using PM2 (Linux/MacOS only I believe)

> This short guide assumes you have fully followed through the Installation steps.

> There is a known issue with the config reloading from the Dashboard when hosting through PM2.

1. Install PM2: `npm -g install pm2`
2. Start the Application: `pm2 start index.js`
3. Save the current Application list: `pm2 save`
4. Enable PM2 startup `pm2 startup`

You can check the status with `pm2 status` and restart the application with `pm2 restart all` (Or instead of `all` you can use the index number found in status).

## Can I rely on this project to not shut down and get abandoned soon?
Despite my repositories mostly beeing archived, I plan on keeping this updated as long as I can. My own Websites all depend on this software, so I always have a incentive to develop this further and keep it maintained to the best of my abilities.

Regarding the high archival rate on my profile, most of those were at one point closed-source projects that were shut down, usually after shutdown, I release full or part of the source code to help future developers figure things out just like others have helped me with open-sourcing their applications.

## Origins
As a previous user of Nginx Proxy Manager, I was actually quite happy with it.
The Issue was that the community seems to either be very elitist or have not really wanted to help at all.
I keep having the issue where all connections just end in this "black hole" of the Docker Container. If you bring this up, you will get told its simply a skill issue and a you problem, nothing to help at all.

Thats why I've decided to create a simmilar alternative that is a complete suite by itself without depending on solutions like Docker.