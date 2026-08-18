'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('liefert die neue Aufräumansicht und blockiert Löschungen im Testmodus', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexa-inventory-http-'));
  const port = 19_000 + (process.pid % 1_000);
  const child = spawn(process.execPath, ['app.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      MOCK_MODE: 'true',
      PORT: String(port),
      DATA_DIR: dataDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(child);
    const page = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
    assert.match(page, /Sichtbare Altlasten auswählen/);
    assert.match(page, /Aktivierte Skills/);
    assert.match(page, /Direkte Aktion/);
    assert.match(page, /skill-command-device/);
    assert.match(page, /details-enable-button/);
    assert.match(page, /Alexa Smarthome\/Skills-Manager/);
    assert.match(page, /Version 0\.6\.2/);
    assert.match(page, /Deaktivierte Geräte/);
    const clientScript = await fetch(`http://127.0.0.1:${port}/app.js`).then((response) => response.text());
    assert.match(clientScript, /Amazon meldet:/);

    const inventoryResponse = await fetch(`http://127.0.0.1:${port}/api/devices`);
    assert.equal(inventoryResponse.status, 200);
    const inventory = await inventoryResponse.json();
    assert.equal(inventory.deleteEnabled, false);
    assert.equal(inventory.changeEnabled, false);
    assert.equal(inventory.totals.cleanupCandidates, 1);
    assert.equal(inventory.activeSkills.length, 3);
    assert.equal(inventory.activeSkills.find((skill) => skill.name === 'Home Assistant').providesSmartHomeDevices, true);

    const device = inventory.devices.find((entry) => entry.canBulkDelete);
    const deleteResponse = await fetch(`http://127.0.0.1:${port}/api/devices/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`
      },
      body: JSON.stringify({
        confirmation: 'DELETE_SELECTED',
        devices: [{ applianceId: device.applianceId, expectedName: device.name }]
      })
    });
    assert.equal(deleteResponse.status, 409);
    assert.match((await deleteResponse.json()).error, /Testmodus/);

    const enablementResponse = await fetch(`http://127.0.0.1:${port}/api/devices/enablement`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`
      },
      body: JSON.stringify({
        confirmation: 'SET_DEVICE_ENABLEMENT',
        applianceId: device.applianceId,
        expectedName: device.name,
        enabled: false
      })
    });
    assert.equal(enablementResponse.status, 409);
    assert.match((await enablementResponse.json()).error, /Testmodus/);

    const skillResponse = await fetch(`http://127.0.0.1:${port}/api/skills/disable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${port}`
      },
      body: JSON.stringify({
        confirmation: 'DISABLE_SKILL',
        skillId: inventory.activeSkills[0].id,
        expectedName: inventory.activeSkills[0].name,
        deviceSerial: 'test-echo'
      })
    });
    assert.equal(skillResponse.status, 409);
    assert.match((await skillResponse.json()).error, /Testmodus/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Testserver wurde nicht rechtzeitig gestartet.')), 5_000);
    const onData = (chunk) => {
      if (String(chunk).includes('läuft auf Port')) {
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Testserver wurde vorzeitig beendet (${code}).`));
    });
    child.stderr.on('data', (chunk) => {
      if (String(chunk).trim()) {
        clearTimeout(timeout);
        reject(new Error(String(chunk)));
      }
    });
  });
}
