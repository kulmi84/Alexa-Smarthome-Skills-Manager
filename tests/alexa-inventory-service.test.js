'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EventEmitter = require('node:events');
const { AlexaInventoryService, isProxyReadyMessage } = require('../lib/alexa-inventory-service');

test('erkennt den erwarteten Hinweis des gestarteten Alexa-Anmeldeproxys', () => {
  assert.equal(
    isProxyReadyMessage(new Error('Please open http://192.168.9.20:3456/ with your browser and login to Amazon.')),
    true
  );
  assert.equal(isProxyReadyMessage(new Error('Proxy Server could not be initialized. Check Logs.')), false);
  assert.equal(isProxyReadyMessage(new Error('Authentication failed')), false);
});

test('wartet nach dem Proxy-Hinweis auf den erfolgreichen Login-Callback', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-inventory-login-'));

  class SuccessfulProxyLogin extends EventEmitter {
    constructor() {
      super();
      this.cookieData = { localCookie: 'session-id=test; csrf=test', tokenDate: Date.now() };
    }

    init(options, callback) {
      setImmediate(() => callback(new Error(`Please open http://${options.proxyOwnIp}:${options.proxyPort}/ with your browser.`)));
      setTimeout(() => callback(null), 10);
    }

    stop() {}
    stopProxyServer(callback) { callback(); }
  }

  const service = createTestService(dataDir, SuccessfulProxyLogin);
  try {
    await service.connect(null, '192.168.9.20');
    assert.equal(service.getStatus().ready, true);
    assert.equal(fs.existsSync(path.join(dataDir, 'amazon-session.json')), true);
  } finally {
    await service.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('akzeptiert bei einer gespeicherten Sitzung keinen versteckten Login-Proxy', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-inventory-saved-'));

  class InvalidSavedLogin extends EventEmitter {
    init(options, callback) {
      setImmediate(() => callback(new Error(`Please open http://${options.proxyOwnIp}:${options.proxyPort}/ with your browser.`)));
    }

    stop() {}
    stopProxyServer(callback) { callback(); }
  }

  const service = createTestService(dataDir, InvalidSavedLogin);
  try {
    await assert.rejects(
      service.connect({ localCookie: 'session-id=old; csrf=old' }, '127.0.0.1'),
      /Please open/
    );
  } finally {
    await service.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('löscht nur zuvor geladene und namentlich bestätigte Alexa-Einträge', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-inventory-delete-'));
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-devices.json'), 'utf8'));
  const deletedIds = [];
  const alexa = createInventoryAlexa(fixture, (applianceId, callback) => {
    deletedIds.push(applianceId);
    callback(null, { success: true });
  });
  const service = createTestService(dataDir, EventEmitter);
  service.state = 'ready';
  service.alexa = alexa;

  try {
    const inventory = await service.loadInventory();
    const device = inventory.devices.find((entry) => entry.name === 'Lampe Wohnzimmer');

    await assert.rejects(
      service.deleteDevices([{ applianceId: device.applianceId, expectedName: 'Falscher Name' }]),
      /Geräteliste hat sich geändert/
    );
    assert.deepEqual(deletedIds, []);

    const result = await service.deleteDevices([{
      applianceId: device.applianceId,
      expectedName: device.name
    }]);
    assert.equal(result.deleted.length, 1);
    assert.equal(result.failed.length, 0);
    assert.deepEqual(deletedIds, [device.applianceId]);
  } finally {
    await service.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('löscht ein gruppiertes Matter-Gerät über alle zugehörigen Endpunkte', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-inventory-matter-delete-'));
  const fixture = {
    skillCatalog: null,
    endpoints: [
      createMatterEndpoint('matter-root', 'matter-root-appliance', ['OTHER'], 'Echo Wohnzimmer'),
      createMatterEndpoint('matter-plug', 'matter-plug-appliance', ['SMARTPLUG'], 'Mia')
    ]
  };
  const deletedIds = [];
  const alexa = createInventoryAlexa(fixture, (applianceId, callback) => {
    deletedIds.push(applianceId);
    callback(null, { success: true });
  });
  const service = createTestService(dataDir, EventEmitter);
  service.state = 'ready';
  service.alexa = alexa;

  try {
    const inventory = await service.loadInventory();
    assert.equal(inventory.devices.length, 1);
    const device = inventory.devices[0];
    assert.equal(device.matterEndpointCount, 2);

    const result = await service.deleteDevices([{
      applianceId: device.applianceId,
      expectedName: device.name
    }]);
    assert.equal(result.deleted.length, 1);
    assert.equal(result.deleted[0].endpoints, 2);
    assert.deepEqual(deletedIds.sort(), ['matter-plug-appliance', 'matter-root-appliance']);
  } finally {
    await service.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('deaktiviert und aktiviert ein Alexa-Gerät ohne es zu löschen', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-inventory-enablement-'));
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-devices.json'), 'utf8'));
  const changes = [];
  const alexa = createInventoryAlexa(
    fixture,
    (_applianceId, callback) => callback(null, { success: true }),
    null,
    (applianceId, enabled, callback) => {
      changes.push({ applianceId, enabled });
      callback(null, { success: true });
    }
  );
  const service = createTestService(dataDir, EventEmitter);
  service.state = 'ready';
  service.alexa = alexa;

  try {
    const inventory = await service.loadInventory();
    const device = inventory.devices.find((entry) => entry.name === 'Lampe Wohnzimmer');
    assert.equal(device.enabled, true);

    await assert.rejects(
      service.setDeviceEnablement({
        applianceId: device.applianceId,
        expectedName: device.name,
        enabled: false,
        confirmation: 'FALSCH'
      }),
      /nicht vollständig bestätigt/
    );
    assert.deepEqual(changes, []);

    const disabled = await service.setDeviceEnablement({
      applianceId: device.applianceId,
      expectedName: device.name,
      enabled: false,
      confirmation: 'SET_DEVICE_ENABLEMENT'
    });
    const enabled = await service.setDeviceEnablement({
      applianceId: device.applianceId,
      expectedName: device.name,
      enabled: true,
      confirmation: 'SET_DEVICE_ENABLEMENT'
    });
    assert.equal(disabled.failed.length, 0);
    assert.equal(enabled.failed.length, 0);
    assert.deepEqual(changes, [
      { applianceId: device.applianceId, enabled: false },
      { applianceId: device.applianceId, enabled: true }
    ]);
  } finally {
    await service.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('deaktiviert alle Endpunkte eines gruppierten Matter-Geräts gemeinsam', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-inventory-matter-enablement-'));
  const fixture = {
    skillCatalog: null,
    activeSkills: [],
    endpoints: [
      createMatterEndpoint('matter-root', 'matter-root-appliance', ['OTHER'], 'Echo Wohnzimmer'),
      createMatterEndpoint('matter-plug', 'matter-plug-appliance', ['SMARTPLUG'], 'Mia')
    ]
  };
  const changes = [];
  const alexa = createInventoryAlexa(
    fixture,
    (_applianceId, callback) => callback(null, { success: true }),
    null,
    (applianceId, enabled, callback) => {
      changes.push({ applianceId, enabled });
      callback(null, { success: true });
    }
  );
  const service = createTestService(dataDir, EventEmitter);
  service.state = 'ready';
  service.alexa = alexa;

  try {
    const inventory = await service.loadInventory();
    const device = inventory.devices[0];
    const result = await service.setDeviceEnablement({
      applianceId: device.applianceId,
      expectedName: device.name,
      enabled: false,
      confirmation: 'SET_DEVICE_ENABLEMENT'
    });
    assert.equal(result.requestedEndpoints, 2);
    assert.equal(result.failed.length, 0);
    assert.deepEqual(changes, [
      { applianceId: 'matter-plug-appliance', enabled: false },
      { applianceId: 'matter-root-appliance', enabled: false }
    ]);
  } finally {
    await service.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('begrenzt die Sammellöschung auf mögliche Altlasten und meldet Teilfehler', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-inventory-bulk-delete-'));
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-devices.json'), 'utf8'));
  const secondOrphan = JSON.parse(JSON.stringify(fixture.endpoints[2]));
  secondOrphan.endpointId = 'endpoint-5';
  secondOrphan.friendlyName = 'Alte Szene';
  secondOrphan.legacyAppliance.applianceId = 'SKILL_unknown_old_scene';
  secondOrphan.legacyAppliance.friendlyName = 'Alte Szene';
  fixture.endpoints.push(secondOrphan);

  const attemptedIds = [];
  const alexa = createInventoryAlexa(fixture, (applianceId, callback) => {
    attemptedIds.push(applianceId);
    if (applianceId === secondOrphan.legacyAppliance.applianceId) {
      callback(new Error('Amazon test failure'));
      return;
    }
    callback(null, { success: true });
  });
  const service = createTestService(dataDir, EventEmitter);
  service.state = 'ready';
  service.alexa = alexa;

  try {
    const inventory = await service.loadInventory();
    const active = inventory.devices.find((entry) => entry.name === 'Lampe Wohnzimmer');
    const candidates = inventory.devices.filter((entry) => entry.canBulkDelete);
    assert.equal(candidates.length, 2);

    await assert.rejects(
      service.deleteDevices([
        { applianceId: candidates[0].applianceId, expectedName: candidates[0].name },
        { applianceId: active.applianceId, expectedName: active.name }
      ]),
      /nicht für die Sammellöschung freigegeben/
    );
    assert.deepEqual(attemptedIds, []);

    const result = await service.deleteDevices(candidates.map((device) => ({
      applianceId: device.applianceId,
      expectedName: device.name
    })));
    assert.equal(result.requested, 2);
    assert.equal(result.deleted.length, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(attemptedIds.length, 2);
  } finally {
    await service.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('speichert die manuelle Kennzeichnung aktiv und schließt das Gerät von der Sammellöschung aus', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-inventory-protected-'));
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-devices.json'), 'utf8'));
  const service = createTestService(dataDir, EventEmitter);
  service.state = 'ready';
  service.alexa = createInventoryAlexa(fixture, (_applianceId, callback) => callback(null, { success: true }));

  try {
    let inventory = await service.loadInventory();
    const orphan = inventory.devices.find((entry) => entry.canBulkDelete);
    assert.ok(orphan);
    service.setDeviceProtection({ applianceId: orphan.applianceId, expectedName: orphan.name, protected: true });

    inventory = await service.loadInventory();
    const protectedDevice = inventory.devices.find((entry) => entry.applianceId === orphan.applianceId);
    assert.equal(protectedDevice.userProtected, true);
    assert.equal(protectedDevice.cleanupStatus, 'USER_PROTECTED');
    assert.equal(protectedDevice.canBulkDelete, false);
    assert.equal(inventory.totals.cleanupCandidates, 0);
  } finally {
    await service.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('sendet die Skill-Deaktivierung nur für einen geladenen Skill an ein geladenes Echo', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-inventory-skill-command-'));
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-devices.json'), 'utf8'));
  const commands = [];
  const alexa = createInventoryAlexa(
    fixture,
    (_applianceId, callback) => callback(null, { success: true }),
    (serialNumber, command, value, callback) => {
      commands.push({ serialNumber, command, value });
      callback(null, { success: true });
    }
  );
  const service = createTestService(dataDir, EventEmitter);
  service.state = 'ready';
  service.alexa = alexa;

  try {
    const inventory = await service.loadInventory();
    assert.deepEqual(inventory.echoDevices, [{
      serialNumber: 'echo-kitchen-serial',
      name: 'Echo Küche',
      type: 'Echo Dot'
    }]);
    const skill = inventory.activeSkills.find((entry) => entry.name === 'ZDFheute');

    await assert.rejects(
      service.disableSkill({
        skillId: skill.id,
        expectedName: skill.name,
        deviceSerial: 'echo-kitchen-serial',
        confirmation: 'FALSCH'
      }),
      /nicht vollständig bestätigt/
    );
    await assert.rejects(
      service.disableSkill({
        skillId: skill.id,
        expectedName: skill.name,
        deviceSerial: 'unbekanntes-echo',
        confirmation: 'DISABLE_SKILL'
      }),
      /nicht mehr verfügbar/
    );
    assert.deepEqual(commands, []);

    const result = await service.disableSkill({
      skillId: skill.id,
      expectedName: skill.name,
      deviceSerial: 'echo-kitchen-serial',
      confirmation: 'DISABLE_SKILL'
    });
    assert.equal(result.accepted, true);
    assert.equal(result.skillName, 'ZDFheute');
    assert.deepEqual(commands, [{
      serialNumber: 'echo-kitchen-serial',
      command: 'textCommand',
      value: 'deaktiviere den skill ZDFheute'
    }]);
  } finally {
    await service.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function createInventoryAlexa(fixture, deleteHandler, sequenceHandler, enablementHandler) {
  return {
    serialNumbers: {
      'echo-kitchen-serial': {
        serialNumber: 'echo-kitchen-serial',
        accountName: 'Echo Küche',
        deviceTypeFriendlyName: 'Echo Dot',
        deviceType: 'TEST_ECHO',
        deviceOwnerCustomerId: 'customer-1',
        capabilities: ['AUDIO_PLAYER', 'AMAZON_MUSIC']
      },
      'multiroom-serial': {
        serialNumber: 'multiroom-serial',
        accountName: 'Alle Lautsprecher',
        deviceTypeFriendlyName: 'Multiroom-Gruppe',
        deviceType: 'TEST_GROUP',
        deviceOwnerCustomerId: 'customer-1',
        capabilities: ['AUDIO_PLAYER'],
        isMultiroomDevice: true
      }
    },
    getSmarthomeDevicesV2(callback) {
      callback(null, fixture.endpoints);
    },
    getRoutineSkillCatalog(category, limit, callback) {
      callback(null, fixture.skillCatalog);
    },
    httpsGet(_url, callback) {
      const products = (fixture.activeSkills || []).map((skill) => ({
        title: skill.name,
        productMetadata: { skillId: skill.id, asin: skill.asin },
        productDetails: { skillTypes: [skill.type] }
      }));
      callback(null, [{ block: 'data', contents: [{ id: 'skillsPageData', contents: { products } }] }]);
    },
    deleteSmarthomeDevice(applianceId, callback) {
      deleteHandler(applianceId, callback);
    },
    sendSequenceCommand(serialNumber, command, value, callback) {
      if (sequenceHandler) {
        sequenceHandler(serialNumber, command, value, callback);
        return;
      }
      callback(null, { success: true });
    },
    setEnablementForSmarthomeDevice(applianceId, enabled, callback) {
      if (enablementHandler) {
        enablementHandler(applianceId, enabled, callback);
        return;
      }
      callback(null, { success: true });
    },
    stop() {},
    stopProxyServer(callback) { callback(); }
  };
}

function createMatterEndpoint(endpointId, applianceId, applianceTypes, connectedVia) {
  return {
    endpointId,
    friendlyName: 'NUC',
    legacyAppliance: {
      applianceId,
      entityId: `${endpointId}-entity`,
      friendlyName: 'NUC',
      friendlyDescription: 'TestVendor intelligentes Gerät',
      manufacturerName: 'TestVendor',
      modelName: 'TestProduct',
      connectedVia,
      applianceTypes,
      isEnabled: true,
      driverIdentity: { namespace: 'AAA', identifier: 'MatterCloudService' },
      applianceNetworkState: { reachability: 'REACHABLE' }
    }
  };
}

function createTestService(dataDir, AlexaRemoteClass) {
  return new AlexaInventoryService({
    dataDir,
    amazonPage: 'amazon.de',
    acceptLanguage: 'de-DE',
    proxyPort: 3456,
    configuredProxyIp: '',
    mockMode: false,
    AlexaRemoteClass
  });
}
