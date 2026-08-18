'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { AlexaInventoryService } = require('./lib/alexa-inventory-service');

const rootDir = __dirname;
const publicDir = path.join(rootDir, 'public');
const port = numberFromEnv('PORT', 8080);
const proxyPort = numberFromEnv('PROXY_PORT', 3456);
const mockMode = String(process.env.MOCK_MODE || 'false').toLowerCase() === 'true';

const service = new AlexaInventoryService({
  dataDir: process.env.DATA_DIR || path.join(rootDir, 'data'),
  amazonPage: process.env.AMAZON_PAGE || 'amazon.de',
  acceptLanguage: process.env.ACCEPT_LANGUAGE || 'de-DE',
  proxyPort,
  configuredProxyIp: process.env.ALEXA_PROXY_IP || '',
  mockMode,
  fixturePath: path.join(rootDir, 'fixtures', 'sample-devices.json')
});

service.initialize().catch((error) => {
  console.error('[Start] Alexa-Initialisierung fehlgeschlagen:', safeError(error));
});

const server = http.createServer(async (request, response) => {
  try {
    applySecurityHeaders(response);
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    if (requestUrl.pathname.startsWith('/api/')) {
      await handleApi(request, response, requestUrl);
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'Methode nicht erlaubt.' });
      return;
    }

    serveStatic(response, requestUrl.pathname, request.method === 'HEAD');
  } catch (error) {
    console.error('[HTTP] Unerwarteter Fehler:', safeError(error));
    if (!response.headersSent) {
      sendJson(response, 500, { error: 'Interner Fehler.' });
    } else {
      response.end();
    }
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Alexa Smarthome/Skills-Manager läuft auf Port ${port}${mockMode ? ' (Testmodus)' : ''}.`);
});

async function handleApi(request, response, requestUrl) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && !hasAllowedOrigin(request)) {
    sendJson(response, 403, { error: 'Anfrage von einer fremden Webseite abgelehnt.' });
    return;
  }

  if (requestUrl.pathname === '/api/status' && request.method === 'GET') {
    sendJson(response, 200, service.getStatus());
    return;
  }

  if (requestUrl.pathname === '/api/auth/start' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      const proxyIp = normalizeProxyHost(body.proxyIp || requestUrl.hostname || '');
      await service.startAuthentication(proxyIp);
      sendJson(response, 202, service.getStatus());
    } catch (error) {
      sendOperationError(response, error, 409, 'Die Amazon-Anmeldung konnte nicht gestartet werden.');
    }
    return;
  }

  if (requestUrl.pathname === '/api/auth/forget' && request.method === 'POST') {
    try {
      await service.forgetAuthentication();
      sendJson(response, 200, service.getStatus());
    } catch (error) {
      sendOperationError(response, error, 500, 'Die lokale Anmeldung konnte nicht entfernt werden.');
    }
    return;
  }

  if (requestUrl.pathname === '/api/devices' && request.method === 'GET') {
    try {
      const inventory = await service.loadInventory();
      sendJson(response, 200, inventory);
    } catch (error) {
      const status = service.getStatus();
      sendOperationError(
        response,
        error,
        status.ready ? 502 : 409,
        status.ready ? 'Die Alexa-Geräte- und Skillliste konnte nicht geladen werden.' : 'Bitte zuerst mit Amazon verbinden.'
      );
    }
    return;
  }

  if (requestUrl.pathname === '/api/devices/delete' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      if (body.confirmation !== 'DELETE_SELECTED') {
        throw new Error('Die Löschung wurde nicht vollständig bestätigt.');
      }
      const result = await service.deleteDevices(body.devices);
      sendJson(response, 200, result);
    } catch (error) {
      sendOperationError(response, error, 409, 'Die ausgewählten Alexa-Einträge konnten nicht gelöscht werden.');
    }
    return;
  }

  if (requestUrl.pathname === '/api/devices/protection' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      const device = service.setDeviceProtection(body);
      sendJson(response, 200, { device });
    } catch (error) {
      sendOperationError(response, error, 409, 'Die manuelle Kennzeichnung konnte nicht gespeichert werden.');
    }
    return;
  }

  if (requestUrl.pathname === '/api/devices/enablement' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      const result = await service.setDeviceEnablement(body);
      sendJson(response, 200, result);
    } catch (error) {
      sendOperationError(response, error, 409, 'Der Alexa-Eintrag konnte nicht umgeschaltet werden.');
    }
    return;
  }

  if (requestUrl.pathname === '/api/skills/disable' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      const result = await service.disableSkill(body);
      sendJson(response, 202, result);
    } catch (error) {
      sendOperationError(response, error, 409, 'Der Alexa-Deaktivierungsbefehl konnte nicht gesendet werden.');
    }
    return;
  }

  sendJson(response, 404, { error: 'Nicht gefunden.' });
}

function serveStatic(response, pathname, headOnly) {
  const normalizedPath = pathname === '/' ? '/index.html' : pathname;
  const relativePath = path.posix.normalize(normalizedPath).replace(/^\/+/, '');
  const filePath = path.join(publicDir, relativePath);

  if (!filePath.startsWith(publicDir + path.sep) && filePath !== path.join(publicDir, 'index.html')) {
    sendJson(response, 403, { error: 'Nicht erlaubt.' });
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      const fallback = path.join(publicDir, 'index.html');
      streamFile(response, fallback, headOnly);
      return;
    }
    streamFile(response, filePath, headOnly);
  });
}

function streamFile(response, filePath, headOnly) {
  const type = mimeType(path.extname(filePath));
  response.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=3600'
  });
  if (headOnly) {
    response.end();
    return;
  }
  fs.createReadStream(filePath).pipe(response);
}

function mimeType(extension) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml'
  })[extension] || 'application/octet-stream';
}

function applySecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
}

function sendJson(response, status, data) {
  const payload = JSON.stringify(data);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload)
  });
  response.end(payload);
}

function sendOperationError(response, error, status, fallback) {
  const message = safeError(error);
  const containsSecretLabel = /cookie|csrf|token|authorization/i.test(message);
  sendJson(response, status, { error: containsSecretLabel ? fallback : message || fallback });
}

function hasAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 16_384) {
        reject(new Error('Anfrage zu groß.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Ungültiges JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function normalizeProxyHost(value) {
  const host = String(value || '').trim().replace(/^\[|\]$/g, '');
  if (!host || host.length > 253 || !/^[a-zA-Z0-9.:-]+$/.test(host) || host.includes('..')) {
    throw new Error('Ungültiger QNAP-Hostname oder ungültige IP-Adresse.');
  }
  return host;
}

function numberFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(value) && value > 0 && value < 65_536 ? value : fallback;
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function shutdown() {
  await service.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
