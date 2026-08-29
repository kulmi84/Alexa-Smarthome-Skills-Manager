'use strict';

const Module = require('node:module');
const originalLoad = Module._load;
let wrapped = false;

Module._load = function capabilityAwareLoad(request, parent, isMain) {
  const loaded = originalLoad.apply(this, arguments);
  if (wrapped || !parent || !parent.filename || !parent.filename.endsWith('alexa-inventory-service.js')) {
    return loaded;
  }
  if (request !== './normalize-inventory' || !loaded || typeof loaded.normalizeInventory !== 'function') {
    return loaded;
  }

  wrapped = true;
  const originalNormalizeInventory = loaded.normalizeInventory;
  return {
    ...loaded,
    normalizeInventory(rawEndpoints, rawCatalog) {
      const inventory = originalNormalizeInventory(rawEndpoints, rawCatalog);
      enrichInventoryWithCapabilities(inventory, rawEndpoints);
      return inventory;
    }
  };
};

function enrichInventoryWithCapabilities(inventory, rawEndpoints) {
  if (!inventory || !Array.isArray(inventory.devices)) return;
  const endpoints = Array.isArray(rawEndpoints) ? rawEndpoints : [];

  for (const device of inventory.devices) {
    const matchingEndpoints = endpoints.filter((endpoint) => endpointMatchesDevice(endpoint, device));
    const amazonCapabilities = uniqueSorted(matchingEndpoints.flatMap(extractCapabilities));
    const inferredCapabilities = inferCapabilities(device.types || []);

    device.capabilities = amazonCapabilities.length ? amazonCapabilities : inferredCapabilities;
    device.capabilitySource = amazonCapabilities.length
      ? 'amazon'
      : inferredCapabilities.length
        ? 'type-inference'
        : 'none';
    device.isContactSensor = device.capabilities.some((entry) => isContactCapability(entry))
      || (device.types || []).some((type) => isContactType(type));
  }
}

function endpointMatchesDevice(endpoint, device) {
  if (!endpoint || typeof endpoint !== 'object') return false;
  const appliance = endpoint.legacyAppliance || {};
  const endpointIds = new Set([device.endpointId, ...(device.endpointIds || [])].filter(Boolean).map(String));
  const applianceIds = new Set([device.applianceId, ...(device.applianceIds || [])].filter(Boolean).map(String));
  const rawEndpointId = firstText(endpoint.endpointId, endpoint.id);
  const rawApplianceId = firstText(appliance.applianceId);
  return (rawEndpointId && endpointIds.has(rawEndpointId)) || (rawApplianceId && applianceIds.has(rawApplianceId));
}

function extractCapabilities(endpoint) {
  const found = [];
  const visited = new Set();
  const queue = [{ value: endpoint, depth: 0, key: '' }];
  let inspected = 0;

  while (queue.length && inspected < 2500) {
    const { value, depth, key } = queue.shift();
    if (value == null || depth > 6) continue;

    if (typeof value === 'string') {
      if (isCapabilityLikeKey(key) || looksLikeAlexaInterface(value)) found.push(value);
      continue;
    }

    if (typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    inspected += 1;

    if (!Array.isArray(value)) {
      for (const candidate of [value.interface, value.interfaceName, value.capability, value.capabilityName]) {
        if (typeof candidate === 'string' && candidate.trim()) found.push(candidate.trim());
      }
    }

    for (const [childKey, child] of Object.entries(value)) {
      if (typeof child === 'string') {
        if (isCapabilityLikeKey(childKey) || looksLikeAlexaInterface(child)) found.push(child);
      } else if (child && typeof child === 'object') {
        queue.push({ value: child, depth: depth + 1, key: childKey });
      }
    }
  }

  return uniqueSorted(found.map(normalizeCapability).filter(Boolean));
}

function isCapabilityLikeKey(key) {
  const normalized = String(key || '').toLowerCase();
  return normalized.includes('capabil')
    || normalized.includes('interface')
    || normalized.includes('supportedoperation')
    || normalized === 'operations';
}

function looksLikeAlexaInterface(value) {
  const text = String(value || '').trim();
  return /^Alexa\.[A-Za-z0-9_.-]+$/.test(text)
    || /(?:ContactSensor|MotionSensor|TemperatureSensor|PowerController|BrightnessController|ColorController|LockController|ThermostatController|CameraStreamController|EndpointHealth)/i.test(text);
}

function normalizeCapability(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 180) return '';
  return text;
}

function inferCapabilities(types) {
  const result = [];
  for (const rawType of types) {
    const type = String(rawType || '').toUpperCase();
    if (isContactType(type)) result.push('Alexa.ContactSensor');
    if (type.includes('MOTION_SENSOR')) result.push('Alexa.MotionSensor');
    if (type.includes('TEMPERATURE_SENSOR')) result.push('Alexa.TemperatureSensor');
    if (type === 'LOCK' || type.includes('SMARTLOCK')) result.push('Alexa.LockController');
    if (type === 'THERMOSTAT') result.push('Alexa.ThermostatController');
    if (type.includes('CAMERA')) result.push('Alexa.CameraStreamController');
  }
  return uniqueSorted(result);
}

function isContactType(value) {
  const type = String(value || '').toUpperCase();
  return type.includes('CONTACT_SENSOR')
    || type === 'DOOR'
    || type === 'WINDOW'
    || type.includes('DOOR_SENSOR')
    || type.includes('WINDOW_SENSOR');
}

function isContactCapability(value) {
  return /(?:^|\.)ContactSensor$/i.test(String(value || '').trim())
    || /contact.?sensor/i.test(String(value || ''));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}
