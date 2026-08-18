'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeInventory } = require('./normalize-inventory');
const { normalizeSkills } = require('./normalize-skills');

class AlexaInventoryService {
  constructor(options) {
    this.options = options;
    this.authFile = path.join(options.dataDir, 'amazon-session.json');
    this.formerDataFile = path.join(options.dataDir, 'former-registration-data.json');
    this.protectedDevicesFile = path.join(options.dataDir, 'protected-devices.json');
    this.state = options.mockMode ? 'ready' : 'disconnected';
    this.message = options.mockMode ? 'Testdaten sind aktiv.' : 'Noch nicht mit Amazon verbunden.';
    this.loginUrl = null;
    this.alexa = null;
    this.lastLoadedAt = null;
    this.deviceCount = 0;
    this.busy = false;
    this.loadedDevices = new Map();
    this.loadedSkills = new Map();
  }

  async initialize() {
    fs.mkdirSync(this.options.dataDir, { recursive: true, mode: 0o700 });

    if (this.options.mockMode) {
      return;
    }

    const savedSession = this.readSavedSession();
    if (!savedSession) {
      return;
    }

    this.state = 'connecting';
    this.message = 'Gespeicherte Amazon-Anmeldung wird geprüft …';
    try {
      await this.connect(savedSession, this.options.configuredProxyIp || '127.0.0.1');
    } catch (error) {
      await this.stopAlexaInstance();
      this.state = 'disconnected';
      this.message = 'Die gespeicherte Anmeldung ist nicht mehr gültig. Bitte neu anmelden.';
      console.warn('[Alexa] Gespeicherte Anmeldung konnte nicht verwendet werden:', safeError(error));
    }
  }

  getStatus() {
    return {
      state: this.state,
      message: this.message,
      loginUrl: this.loginUrl,
      ready: this.state === 'ready',
      authenticating: this.state === 'authenticating' || this.state === 'connecting',
      hasSavedSession: fs.existsSync(this.authFile),
      lastLoadedAt: this.lastLoadedAt,
      deviceCount: this.deviceCount,
      readOnly: false,
      deleteEnabled: !this.options.mockMode,
      busy: this.busy,
      mockMode: this.options.mockMode
    };
  }

  async startAuthentication(requestProxyIp) {
    if (this.options.mockMode) {
      return;
    }
    if (this.busy) {
      throw new Error('Eine Anmeldung oder Abfrage läuft bereits.');
    }

    const proxyIp = this.options.configuredProxyIp || requestProxyIp;
    if (!proxyIp) {
      throw new Error('Die IP-Adresse der QNAP fehlt.');
    }

    await this.stopAlexaInstance();
    this.state = 'authenticating';
    this.message = 'Amazon-Anmeldung geöffnet. Nach erfolgreicher Anmeldung wird die Verbindung automatisch übernommen.';
    this.loginUrl = `http://${formatHostForUrl(proxyIp)}:${this.options.proxyPort}`;

    this.connect(null, proxyIp).catch((error) => {
      this.state = 'error';
      this.message = `Anmeldung fehlgeschlagen: ${safeError(error)}`;
      this.busy = false;
    });
  }

  async connect(savedSession, proxyIp) {
    this.busy = true;
    const AlexaRemote = this.options.AlexaRemoteClass || require('alexa-remote2');
    const alexa = new AlexaRemote();
    this.alexa = alexa;

    const initOptions = {
      cookie: savedSession || undefined,
      formerRegistrationData: savedSession || undefined,
      proxyOnly: true,
      proxyOwnIp: proxyIp,
      proxyPort: this.options.proxyPort,
      proxyLogLevel: 'warn',
      amazonPage: this.options.amazonPage,
      acceptLanguage: this.options.acceptLanguage,
      bluetooth: false,
      notifications: false,
      useWsMqtt: false,
      usePushConnection: false,
      cookieRefreshInterval: 0,
      formerDataStorePath: this.formerDataFile,
      logger: logAlexaMessage
    };

    alexa.on('cookie', () => {
      setImmediate(() => this.persistCurrentSession());
    });

    await new Promise((resolve, reject) => {
      alexa.init(initOptions, (error) => {
        if (error) {
          // Im interaktiven Modus meldet alexa-remote2 den erfolgreich gestarteten
          // Login-Proxy zunächst als Hinweis-"Fehler" und ruft denselben Callback
          // nach der Browser-Anmeldung erneut ohne Fehler auf.
          if (!savedSession && isProxyReadyMessage(error)) {
            return;
          }
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.persistCurrentSession();
    this.state = 'ready';
    this.message = 'Mit Amazon verbunden. Geräte und Skills werden nur auf Knopfdruck geladen.';
    this.loginUrl = null;
    this.busy = false;
  }

  async loadInventory() {
    if (this.busy) {
      throw new Error('Bitte warten – eine Anmeldung oder Abfrage läuft bereits.');
    }
    if (this.state !== 'ready') {
      throw new Error('Bitte zuerst mit Amazon verbinden.');
    }

    this.busy = true;
    this.message = 'Alexa-Geräte und aktive Skills werden einmalig geladen …';
    try {
      let endpoints;
      let catalog;
      let rawSkills;
      let skillsError = '';

      if (this.options.mockMode) {
        const fixture = JSON.parse(fs.readFileSync(this.options.fixturePath, 'utf8'));
        endpoints = fixture.endpoints;
        catalog = fixture.skillCatalog;
        rawSkills = fixture.activeSkills;
      } else {
        [endpoints, catalog, rawSkills] = await Promise.all([
          callAlexa(this.alexa, 'getSmarthomeDevicesV2'),
          callAlexa(this.alexa, 'getRoutineSkillCatalog', 'YourSkills', 1000).catch((error) => {
            console.warn('[Alexa] Skillnamen konnten nicht vollständig geladen werden:', safeError(error));
            return null;
          }),
          loadActiveSkills(this.alexa, this.options.amazonPage).catch((error) => {
            skillsError = 'Die Liste der aktiven Skills konnte von Amazon nicht geladen werden.';
            console.warn('[Alexa] Aktive Skills konnten nicht geladen werden:', safeError(error));
            return [];
          })
        ]);
      }

      const inventory = normalizeInventory(endpoints, {
        routineCatalog: catalog,
        activeSkills: (Array.isArray(rawSkills) ? rawSkills : []).map((skill) => ({
          skillId: skill.id || skill.skillId || '',
          title: skill.name || skill.title || ''
        }))
      });
      this.applyProtectedDevices(inventory.devices);
      inventory.totals.cleanupCandidates = inventory.devices.filter((device) => device.canBulkDelete).length;
      const activeSkills = normalizeSkills(rawSkills, inventory.devices, this.options.amazonPage);
      this.loadedSkills = new Map(activeSkills.filter((skill) => skill.id).map((skill) => [skill.id, skill]));
      const echoDevices = this.getEchoDevices();
      this.loadedDevices = new Map(
        inventory.devices
          .filter((device) => device.applianceId)
          .map((device) => [device.applianceId, device])
      );
      this.lastLoadedAt = new Date().toISOString();
      this.deviceCount = inventory.devices.length;
      this.message = `${this.deviceCount} Alexa-Geräte und Einträge geladen. Keine Daten wurden verändert.`;

      return {
        ...inventory,
        activeSkills,
        echoDevices,
        skillsError,
        loadedAt: this.lastLoadedAt,
        readOnly: false,
        deleteEnabled: !this.options.mockMode,
        changeEnabled: !this.options.mockMode
      };
    } catch (error) {
      this.message = 'Die Alexa-Liste konnte nicht geladen werden. Es wurden keine Daten verändert.';
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async deleteDevices(requestedDevices) {
    if (this.busy) {
      throw new Error('Bitte warten – eine Anmeldung, Abfrage oder Löschung läuft bereits.');
    }
    if (this.state !== 'ready') {
      throw new Error('Bitte zuerst mit Amazon verbinden.');
    }
    if (this.options.mockMode) {
      throw new Error('Im Testmodus ist das Löschen deaktiviert.');
    }

    const devices = validateDeleteSelection(requestedDevices, this.loadedDevices);
    this.busy = true;
    this.message = devices.length === 1
      ? `Alexa-Eintrag „${devices[0].name}“ wird entfernt …`
      : `${devices.length} ausgewählte Alexa-Einträge werden entfernt …`;

    const deleted = [];
    const failed = [];
    try {
      for (const device of devices) {
        const endpointIds = Array.isArray(device.applianceIds) && device.applianceIds.length
          ? device.applianceIds
          : [device.applianceId];
        const endpointFailures = [];
        for (const applianceId of endpointIds) {
          try {
            await callAlexa(this.alexa, 'deleteSmarthomeDevice', applianceId);
          } catch (error) {
            console.warn(`[Alexa] Endpunkt konnte nicht gelöscht werden (${device.name}):`, safeError(error));
            endpointFailures.push(publicDeleteError(error));
          }
        }

        if (endpointFailures.length === 0) {
          this.loadedDevices.delete(device.applianceId);
          this.deviceCount = Math.max(0, this.deviceCount - 1);
          deleted.push({
            applianceId: device.applianceId,
            name: device.name,
            endpoints: endpointIds.length
          });
        } else {
          failed.push({
            applianceId: device.applianceId,
            name: device.name,
            error: endpointIds.length > 1
              ? `${endpointFailures.length} von ${endpointIds.length} Matter-Endpunkten konnten nicht gelöscht werden.`
              : endpointFailures[0]
          });
        }
      }

      this.message = failed.length
        ? `${deleted.length} Einträge entfernt, ${failed.length} fehlgeschlagen. Bitte die Liste neu laden.`
        : deleted.length === 1
          ? `Alexa-Eintrag „${deleted[0].name}“ wurde entfernt.`
          : `${deleted.length} Alexa-Einträge wurden entfernt.`;

      return {
        requested: devices.length,
        deleted,
        failed
      };
    } finally {
      this.busy = false;
    }
  }

  async setDeviceEnablement(request) {
    if (this.busy) throw new Error('Bitte warten – eine andere Alexa-Aktion läuft bereits.');
    if (this.state !== 'ready') throw new Error('Bitte zuerst mit Amazon verbinden.');
    if (this.options.mockMode) throw new Error('Im Testmodus werden keine Alexa-Geräte verändert.');

    const applianceId = typeof request?.applianceId === 'string' ? request.applianceId.trim() : '';
    const expectedName = typeof request?.expectedName === 'string' ? request.expectedName.trim() : '';
    const enabled = request?.enabled === true;
    const device = this.loadedDevices.get(applianceId);
    if (request?.confirmation !== 'SET_DEVICE_ENABLEMENT') {
      throw new Error('Die Geräteänderung wurde nicht vollständig bestätigt.');
    }
    if (!applianceId || !expectedName || !device || device.name !== expectedName) {
      throw new Error('Die Geräteliste hat sich geändert. Bitte neu laden.');
    }

    const endpointIds = Array.isArray(device.applianceIds) && device.applianceIds.length
      ? device.applianceIds
      : [device.applianceId];
    if (!endpointIds.length || endpointIds.some((id) => typeof id !== 'string' || !id)) {
      throw new Error('Amazon liefert für diesen Eintrag keine umschaltbare Appliance-ID.');
    }

    this.busy = true;
    this.message = `Alexa-Eintrag „${device.name}“ wird ${enabled ? 'aktiviert' : 'deaktiviert'} …`;
    const changed = [];
    const failed = [];
    try {
      for (const endpointId of endpointIds) {
        try {
          await callAlexa(this.alexa, 'setEnablementForSmarthomeDevice', endpointId, enabled);
          changed.push(endpointId);
        } catch (error) {
          console.warn(`[Alexa] Endpunkt konnte nicht ${enabled ? 'aktiviert' : 'deaktiviert'} werden (${device.name}):`, safeError(error));
          failed.push({ applianceId: endpointId, error: publicActionError(error) });
        }
      }

      this.message = failed.length
        ? `${changed.length} von ${endpointIds.length} Endpunkten geändert. Bitte die Liste neu laden.`
        : `Alexa-Eintrag „${device.name}“ wurde ${enabled ? 'aktiviert' : 'deaktiviert'}.`;
      return {
        applianceId: device.applianceId,
        name: device.name,
        enabled,
        requestedEndpoints: endpointIds.length,
        changed,
        failed
      };
    } finally {
      this.busy = false;
    }
  }

  setDeviceProtection(request) {
    if (!request || typeof request !== 'object') {
      throw new Error('Ungültige Kennzeichnung.');
    }
    const applianceId = typeof request.applianceId === 'string' ? request.applianceId.trim() : '';
    const expectedName = typeof request.expectedName === 'string' ? request.expectedName.trim() : '';
    const protectedState = request.protected === true;
    const device = this.loadedDevices.get(applianceId);
    if (!applianceId || !expectedName || !device || device.name !== expectedName) {
      throw new Error('Die Geräteliste hat sich geändert. Bitte neu laden.');
    }

    const protectedIds = this.readProtectedDeviceIds();
    if (protectedState) protectedIds.add(applianceId);
    else protectedIds.delete(applianceId);
    this.writeProtectedDeviceIds(protectedIds);
    this.applyProtection(device, protectedState);
    return device;
  }

  async disableSkill(request) {
    if (this.busy) throw new Error('Bitte warten – eine andere Alexa-Aktion läuft bereits.');
    if (this.state !== 'ready') throw new Error('Bitte zuerst mit Amazon verbinden.');
    if (this.options.mockMode) throw new Error('Im Testmodus werden keine Alexa-Befehle gesendet.');

    const skillId = typeof request?.skillId === 'string' ? request.skillId.trim() : '';
    const expectedName = typeof request?.expectedName === 'string' ? request.expectedName.trim() : '';
    const deviceSerial = typeof request?.deviceSerial === 'string' ? request.deviceSerial.trim() : '';
    const skill = this.loadedSkills.get(skillId);
    const echoDevice = this.getEchoDevices().find((device) => device.serialNumber === deviceSerial);
    if (request?.confirmation !== 'DISABLE_SKILL') {
      throw new Error('Die Skill-Deaktivierung wurde nicht vollständig bestätigt.');
    }
    if (!skillId || !expectedName || !skill || skill.name !== expectedName) {
      throw new Error('Die Skillliste hat sich geändert. Bitte neu laden.');
    }
    if (!echoDevice) throw new Error('Das ausgewählte Echo ist nicht mehr verfügbar.');

    const command = `deaktiviere den skill ${skill.name}`;
    this.busy = true;
    this.message = `Alexa erhält über „${echoDevice.name}“ den Deaktivierungsbefehl für „${skill.name}“ …`;
    try {
      await callAlexa(this.alexa, 'sendSequenceCommand', echoDevice.serialNumber, 'textCommand', command);
      this.message = `Deaktivierungsbefehl für „${skill.name}“ gesendet. Die Skillliste muss zur Kontrolle neu geladen werden.`;
      return {
        accepted: true,
        skillId: skill.id,
        skillName: skill.name,
        echoName: echoDevice.name
      };
    } finally {
      this.busy = false;
    }
  }

  getEchoDevices() {
    const devices = this.alexa && this.alexa.serialNumbers && typeof this.alexa.serialNumbers === 'object'
      ? Object.values(this.alexa.serialNumbers)
      : [];
    return devices
      .filter((device) => {
        if (!device || !device.serialNumber || !device.accountName) return false;
        if (device.parentDeviceSerialNumber || device.isMultiroomDevice) return false;
        const capabilities = Array.isArray(device.capabilities) ? device.capabilities : [];
        return capabilities.includes('AUDIO_PLAYER') || capabilities.includes('AMAZON_MUSIC');
      })
      .map((device) => ({
        serialNumber: device.serialNumber,
        name: device.accountName,
        type: device.deviceTypeFriendlyName || device.deviceFamily || 'Echo'
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'de', { sensitivity: 'base' }));
  }

  applyProtectedDevices(devices) {
    const protectedIds = this.readProtectedDeviceIds();
    for (const device of devices) {
      this.applyProtection(device, protectedIds.has(device.applianceId));
    }
  }

  applyProtection(device, protectedState) {
    device.userProtected = protectedState;
    if (protectedState) {
      device.cleanupStatus = 'USER_PROTECTED';
      device.canBulkDelete = false;
    } else if (device.sourceKind === 'skill' && !device.skillNameResolved) {
      device.cleanupStatus = 'POSSIBLE_ORPHAN';
      device.canBulkDelete = device.canDelete;
    } else if (device.cleanupStatus === 'USER_PROTECTED') {
      device.cleanupStatus = 'REVIEW';
      device.canBulkDelete = false;
    }
  }

  readProtectedDeviceIds() {
    try {
      const stored = JSON.parse(fs.readFileSync(this.protectedDevicesFile, 'utf8'));
      return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string' && id) : []);
    } catch {
      return new Set();
    }
  }

  writeProtectedDeviceIds(ids) {
    const temporaryFile = `${this.protectedDevicesFile}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify([...ids].sort(), null, 2), { mode: 0o600 });
    fs.renameSync(temporaryFile, this.protectedDevicesFile);
    fs.chmodSync(this.protectedDevicesFile, 0o600);
  }

  async forgetAuthentication() {
    if (this.options.mockMode) {
      return;
    }
    await this.stopAlexaInstance();
    for (const file of [this.authFile, `${this.authFile}.tmp`, this.formerDataFile]) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
    this.state = 'disconnected';
    this.message = 'Lokale Amazon-Anmeldung entfernt.';
    this.loginUrl = null;
    this.deviceCount = 0;
    this.lastLoadedAt = null;
    this.loadedDevices.clear();
    this.loadedSkills.clear();
  }

  async stop() {
    await this.stopAlexaInstance();
  }

  async stopAlexaInstance() {
    const current = this.alexa;
    this.alexa = null;
    if (!current) {
      return;
    }
    try {
      current.stop();
    } catch {
      // Die Bibliothek kann bereits beendet sein.
    }
    await new Promise((resolve) => {
      try {
        current.stopProxyServer(() => resolve());
        setTimeout(resolve, 500).unref();
      } catch {
        resolve();
      }
    });
    this.busy = false;
  }

  readSavedSession() {
    if (!fs.existsSync(this.authFile)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(this.authFile, 'utf8'));
    } catch (error) {
      console.warn('[Alexa] Gespeicherte Anmeldung ist unlesbar:', safeError(error));
      return null;
    }
  }

  persistCurrentSession() {
    const session = this.alexa && this.alexa.cookieData;
    if (!session || typeof session !== 'object' || !session.localCookie) {
      return;
    }
    const temporaryFile = `${this.authFile}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(session, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryFile, this.authFile);
    fs.chmodSync(this.authFile, 0o600);
  }
}

function validateDeleteSelection(requestedDevices, loadedDevices) {
  if (!Array.isArray(requestedDevices) || requestedDevices.length === 0) {
    throw new Error('Es wurden keine Alexa-Einträge zum Löschen ausgewählt.');
  }
  if (requestedDevices.length > 200) {
    throw new Error('Pro Löschvorgang sind höchstens 200 Einträge erlaubt.');
  }
  if (!(loadedDevices instanceof Map) || loadedDevices.size === 0) {
    throw new Error('Bitte die Geräteliste unmittelbar vor dem Löschen neu laden.');
  }

  const selected = [];
  const seen = new Set();
  const bulk = requestedDevices.length > 1;
  for (const requested of requestedDevices) {
    const applianceId = typeof requested?.applianceId === 'string' ? requested.applianceId.trim() : '';
    const expectedName = typeof requested?.expectedName === 'string' ? requested.expectedName.trim() : '';
    if (!applianceId || !expectedName) {
      throw new Error('Ein ausgewählter Eintrag enthält keine gültige ID oder Bestätigung.');
    }
    if (seen.has(applianceId)) {
      throw new Error('Die Auswahl enthält denselben Alexa-Eintrag mehrfach.');
    }
    seen.add(applianceId);

    const device = loadedDevices.get(applianceId);
    if (!device || device.name !== expectedName) {
      throw new Error('Die Geräteliste hat sich geändert. Bitte neu laden und die Auswahl erneut prüfen.');
    }
    if (!device.canDelete) {
      throw new Error(device.deleteBlockedReason || `„${device.name}“ kann nicht über diese Oberfläche gelöscht werden.`);
    }
    if (bulk && !device.canBulkDelete) {
      throw new Error(`„${device.name}“ ist nicht für die Sammellöschung freigegeben und kann nur einzeln geprüft werden.`);
    }
    selected.push(device);
  }
  return selected;
}

function callAlexa(alexa, method, ...args) {
  return new Promise((resolve, reject) => {
    if (!alexa || typeof alexa[method] !== 'function') {
      reject(new Error(`Alexa-Funktion ${method} ist nicht verfügbar.`));
      return;
    }
    alexa[method](...args, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

function loadActiveSkills(alexa, amazonPage) {
  return new Promise((resolve, reject) => {
    if (!alexa || typeof alexa.httpsGet !== 'function') {
      reject(new Error('Die Alexa-Skillabfrage ist nicht verfügbar.'));
      return;
    }
    const request = {
      method: 'GET',
      headers: { Accept: 'application/vnd+amazon.uitoolkit+json;ns=1;fl=0' }
    };
    const url = `https://skills-store.${amazonPage}/app/secure/your-skills-page?deviceType=app&ref-suffix=ysa_gw&pfm=A1PA6795UKMFR9&cor=DE&lang=de-de&_=%t`;
    alexa.httpsGet(url, (error, response) => {
      if (error) {
        reject(error);
        return;
      }
      try {
        const dataBlock = Array.isArray(response)
          ? response.find((item) => item && item.block === 'data' && Array.isArray(item.contents))
          : null;
        const pageData = dataBlock && dataBlock.contents.find((item) => item && item.id === 'skillsPageData');
        const products = pageData && pageData.contents && Array.isArray(pageData.contents.products)
          ? pageData.contents.products
          : null;
        if (!products) throw new Error('Amazon hat ein unbekanntes Skilllisten-Format geliefert.');
        resolve(products.map((product) => ({
          id: product?.productMetadata?.skillId || '',
          asin: product?.productMetadata?.asin || product?.productMetadata?.productId || product?.asin || '',
          name: product?.title || '',
          type: product?.productDetails?.skillTypes?.[0] || 'UNBEKANNT'
        })));
      } catch (parseError) {
        reject(parseError);
      }
    }, request);
  });
}

function logAlexaMessage(message) {
  const text = String(message || '');
  if (/cookie|csrf|token|authorization/i.test(text)) {
    return;
  }
  if (/error|invalid|failed|proxy|authentication/i.test(text)) {
    console.log(`[Alexa] ${text}`);
  }
}

function formatHostForUrl(host) {
  return host.includes(':') ? `[${host}]` : host;
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function publicDeleteError(error) {
  const message = safeError(error);
  return /cookie|csrf|token|authorization/i.test(message)
    ? 'Amazon hat die Löschung abgelehnt.'
    : message || 'Unbekannter Amazon-Fehler.';
}

function publicActionError(error) {
  const message = safeError(error);
  return /cookie|csrf|token|authorization/i.test(message)
    ? 'Amazon hat die Änderung abgelehnt.'
    : message || 'Unbekannter Amazon-Fehler.';
}

function isProxyReadyMessage(error) {
  return /please open http:\/\//i.test(safeError(error));
}

module.exports = { AlexaInventoryService, isProxyReadyMessage };
