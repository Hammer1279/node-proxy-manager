import { readFile } from 'fs/promises';
import { join } from 'path';

export default async (page, { req, res, next }, config) => {
    const packageFile = await readFile(join(process.cwd(), 'package.json'), 'utf-8');
    const packageJson = JSON.parse(packageFile);

    let totalDomains = 0;
    for (const domainGroup of config.acme.domains) {
        totalDomains += domainGroup.length;
    }

    return {
        pkgName: packageJson.name,
        pkgFullName: packageJson.fullname,
        pkgVersion: packageJson.version,
        pkgAuthor: packageJson.author,
        proxyCount: config.proxy.length,
        stubCount: config.stub.length,
        certCount: config.acme.domains.length,
        certCount2: totalDomains,
        ports: config.ports,
        username: req.auth.user
    };
}