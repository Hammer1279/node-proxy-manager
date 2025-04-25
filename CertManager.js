import forge from 'node-forge';
import NodeCache from 'node-cache';

// Create a cache with a TTL of 1 hour
const certCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); // TTL = 3600 seconds (1 hour)


// Function to generate a self-signed certificate
function generateCertificate(hostname) {
    console.log(`Generating a new certificate for hostname: ${hostname}`);
    const pki = forge.pki;
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '00';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1); // 1-year validity
    const attrs = [{ name: 'commonName', value: hostname || 'localhost' }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey);

    return {
        key: pki.privateKeyToPem(keys.privateKey),
        cert: pki.certificateToPem(cert),
    };
}

// Function to get a cached certificate or generate a new one
export function getCertificate(hostname) {
    let cachedCert = certCache.get(hostname);
    if (!cachedCert) {
        cachedCert = generateCertificate(hostname);
        certCache.set(hostname, cachedCert); // Cache the certificate
    } else {
        console.debug(`Using cached certificate for hostname: ${hostname}`);
    }
    return cachedCert;
}