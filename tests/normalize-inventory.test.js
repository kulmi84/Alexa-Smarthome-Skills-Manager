'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeInventory, decodeSkillIdentifier } = require('../lib/normalize-inventory');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-devices.json'), 'utf8')
);

test('dekodiert eine Alexa-Skill-ID', () => {
  const decoded = decodeSkillIdentifier(
    'eyJza2lsbElkIjoiYW16bjEuYXNrLnNraWxsLjExMTExMTExLTIyMjItMzMzMy00NDQ0LTU1NTU1NTU1NTU1NSIsInN0YWdlIjoibGl2ZSJ9'
  );
  assert.equal(decoded.skillId, 'amzn1.ask.skill.11111111-2222-3333-4444-555555555555');
  assert.equal(decoded.stage, 'live');
});

test('erstellt eine sortierte Übersicht und trennt Dubletten nach Aktivierungsstatus', () => {
  const inventory = normalizeInventory(fixture.endpoints, fixture.skillCatalog);
  assert.equal(inventory.devices.length, 4);
  assert.equal(inventory.totals.sources, 4);
  assert.equal(inventory.totals.unreachable, 1);
  assert.equal(inventory.totals.activeDevices + inventory.totals.disabledDevices, inventory.totals.devices);
  assert.equal(inventory.totals.duplicates, 0);

  const homeAssistant = inventory.devices.find((device) => device.name === 'Lampe Wohnzimmer');
  assert.equal(homeAssistant.sourceName, 'Home Assistant');
  assert.equal(homeAssistant.skillNameResolved, true);

  const nine = inventory.devices.filter((device) => device.name === 'Nine');
  assert.equal(nine.length, 2);
  assert.ok(nine.every((device) => !device.duplicateName));
  assert.ok(nine.every((device) => device.duplicateCount === 1));

  const possibleOrphan = nine.find((device) => !device.skillNameResolved);
  assert.equal(possibleOrphan.cleanupStatus, 'POSSIBLE_ORPHAN');
  assert.equal(possibleOrphan.canBulkDelete, true);
  assert.equal(inventory.totals.cleanupCandidates, 1);
});

test('schützt virtuelle Mediendienste vor der Sammellöschung', () => {
  const identifier = Buffer.from(JSON.stringify({
    skillId: 'amzn1.ask.skill.video-provider',
    stage: 'live'
  })).toString('base64url');
  const inventory = normalizeInventory([{
    endpointId: 'video-provider',
    friendlyName: 'Mediathek',
    legacyAppliance: {
      applianceId: `SKILL_${identifier}_ALEXA_VOICE_SERVICE_EXTERNAL_MEDIA_PLAYER_VIDEO_PROVIDER`,
      manufacturerName: 'Sender',
      driverIdentity: { namespace: 'SKILL', identifier }
    }
  }], null);

  assert.equal(inventory.devices[0].cleanupStatus, 'VIRTUAL_PROVIDER');
  assert.equal(inventory.devices[0].canDelete, true);
  assert.equal(inventory.devices[0].canBulkDelete, false);
});

test('führt den allgemeinen und funktionalen Endpunkt eines Matter-Geräts zusammen', () => {
  const inventory = normalizeInventory([
    matterEndpoint('matter-root', 'matter-root-appliance', 'NUC', ['OTHER'], 'Echo Wohnzimmer'),
    matterEndpoint('matter-plug', 'matter-plug-appliance', 'NUC', ['SMARTPLUG'], 'Mia')
  ], null);

  assert.equal(inventory.devices.length, 1);
  assert.equal(inventory.totals.technicalEndpoints, 2);
  assert.equal(inventory.totals.matterGroups, 1);
  const device = inventory.devices[0];
  assert.equal(device.name, 'NUC');
  assert.equal(device.sourceKind, 'matter');
  assert.equal(device.matterGrouped, true);
  assert.equal(device.matterEndpointCount, 2);
  assert.deepEqual(device.types, ['SMARTPLUG']);
  assert.deepEqual(device.applianceIds, ['matter-plug-appliance', 'matter-root-appliance']);
  assert.equal(device.connectedVia, 'Echo Wohnzimmer, Mia');
  assert.equal(device.duplicateName, false);
  assert.equal(inventory.totals.duplicates, 0);
});

test('gruppiert zwei gleich benannte funktionale Matter-Geräte nicht pauschal', () => {
  const inventory = normalizeInventory([
    matterEndpoint('matter-plug-1', 'matter-plug-appliance-1', 'Steckdose', ['SMARTPLUG'], 'Echo Wohnzimmer'),
    matterEndpoint('matter-plug-2', 'matter-plug-appliance-2', 'Steckdose', ['SMARTPLUG'], 'Mia')
  ], null);

  assert.equal(inventory.devices.length, 2);
  assert.equal(inventory.totals.matterGroups, 0);
  assert.ok(inventory.devices.every((device) => device.duplicateName));
});

test('wertet ein aktives und ein deaktiviertes gleichnamiges Gerät nicht als Dublette', () => {
  const endpoints = [true, false].map((enabled, index) => ({
    endpointId: `garage-${index}`,
    friendlyName: 'Garage',
    enablement: enabled,
    legacyAppliance: {
      applianceId: `garage-appliance-${index}`,
      manufacturerName: 'Test',
      applianceNetworkState: { reachability: 'REACHABLE' }
    }
  }));
  const inventory = normalizeInventory(endpoints, null);

  assert.equal(inventory.devices.length, 2);
  assert.equal(inventory.totals.activeDevices, 1);
  assert.equal(inventory.totals.disabledDevices, 1);
  assert.equal(inventory.totals.duplicates, 0);
  assert.ok(inventory.devices.every((device) => !device.duplicateName));
});

test('kennzeichnet direkt mit Echo verbundene Geräte als direkte Quelle', () => {
  const inventory = normalizeInventory(fixture.endpoints, fixture.skillCatalog);
  const motion = inventory.devices.find((device) => device.name === 'Bewegungsmelder Flur');
  assert.equal(motion.sourceKind, 'direct');
  assert.equal(motion.sourceName, 'Direkt über Echo Show Küche');
});

test('findet Skillnamen auch in einer verschachtelten Katalogantwort', () => {
  const catalog = {
    result: {
      groups: [{ entries: [{ skillId: 'amzn1.ask.skill.test', displayName: 'Test Skill' }] }]
    }
  };
  const inventory = normalizeInventory([
    {
      endpointId: 'nested-catalog',
      friendlyName: 'Testgerät',
      legacyAppliance: {
        manufacturerName: 'Hersteller',
        driverIdentity: {
          namespace: 'SKILL',
          identifier: Buffer.from(JSON.stringify({ skillId: 'amzn1.ask.skill.test', stage: 'live' })).toString('base64url')
        }
      }
    }
  ], catalog);
  assert.equal(inventory.devices[0].sourceName, 'Test Skill');
  assert.equal(inventory.devices[0].skillNameResolved, true);
});

function matterEndpoint(endpointId, applianceId, name, applianceTypes, connectedVia) {
  return {
    endpointId,
    friendlyName: name,
    legacyAppliance: {
      applianceId,
      entityId: `${endpointId}-entity`,
      friendlyName: name,
      friendlyDescription: 'TestVendor intelligentes Gerät',
      manufacturerName: 'TestVendor',
      modelName: 'TestProduct',
      connectedVia,
      applianceTypes,
      isEnabled: true,
      driverIdentity: { namespace: 'AAA', identifier: 'MatterCloudService' },
      applianceNetworkState: {
        reachability: 'REACHABLE',
        lastSeenAt: 1786982400000,
        createdAt: 1760000000000
      }
    }
  };
}
