import { readFile } from 'fs/promises';
import { join } from 'path';

export default async (page, { req, res, next }, config) => {
    const packageFile = await readFile(join(process.cwd(), 'package.json'), 'utf-8');
    const packageJson = JSON.parse(packageFile);

    return {
        pkgName: packageJson.name,
        pkgFullName: packageJson.fullname,
        pkgVersion: packageJson.version,
        pkgAuthor: packageJson.author,
        proxyCount: config.proxy.length,
        stubCount: config.stub.length,
        ports: config.ports,
    };
}