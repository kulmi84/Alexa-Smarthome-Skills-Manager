'use strict';

function normalizeInventory(rawEndpoints, rawCatalog) {
  const endpoints = Array.isArray(rawEndpoints) ? rawEndpoints : [];
  const skillMap = buildSkillMap(rawCatalog);
  const technicalEndpoints = endpoints.map((endpoint, index) => normalizeEndpoint(endpoint, index, skillMap));
  const devices = groupMatterEndpoints(technicalEndpoints);

  const nameCounts = new Map();
  for (const device of devices) {
    const key = duplicateKey(device);
    if (key) {
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
  }

  for (const device of devices) {
    const count = nameCounts.get(duplicateKey(device)) || 1;
    device.duplicateName = count > 1;
    device.duplicateCount = count;
  }

  devices.sort((left, right) => {
    return compareText(left.sourceName, right.sourceName) || compareText(left.name, right.name);
  });

  const sources = summarizeSources(devices);
  const types = uniqueSorted(devices.flatMap((device) => device.types));

  return {
    devices,
    sources,
    types,
    totals: {
      devices: devices.length,
      activeDevices: devices.filter((device) => device.enabled).length,
      disabledDevices: devices.filter((device) => !device.enabled).length,
      technicalEndpoints: technicalEndpoints.length,
      matterGroups: devices.filter((device) => device.matterGrouped).length,
      sources: sources.length,
      unreachable: devices.filter((device) => device.reachability === 'UNREACHABLE').length,
      duplicates: devices.filter((device) => device.duplicateName).length,
      unresolvedSkills: devices.filter((device) => device.sourceKind === 'skill' && !device.skillNameResolved).length,
      cleanupCandidates: devices.filter((device) => device.canBulkDelete).length
    }
  };
}

function duplicateKey(device) {
  const name = normalizeKey(device.name);
  return name ? `${device.enabled ? 'active' : 'disabled'}:${name}` : '';
}

function normalizeEndpoint(endpoint, index, skillMap) {
  const appliance = endpoint && endpoint.legacyAppliance ? endpoint.legacyAppliance : {};
  const driver = appliance.driverIdentity || appliance.applianceDriverIdentity || {};
  const decodedSkill = driver.namespace === 'SKILL' ? decodeSkillIdentifier(driver.identifier) : null;
  const skillId = decodedSkill && decodedSkill.skillId ? decodedSkill.skillId : '';
  const exactSkillName = skillId ? skillMap.get(skillId) : '';
  const manufacturer = firstText(
    appliance.manufacturerName,
    nestedText(endpoint, ['manufacturer', 'value', 'text']),
    'Unbekannt'
  );
  const connectedVia = firstText(appliance.connectedVia, '');
  const source = determineSource({ driver, exactSkillName, manufacturer, connectedVia, skillId });
  const networkState = appliance.applianceNetworkState || {};
  const primaryCategory = nestedText(endpoint, ['displayCategories', 'primary', 'value']);
  const applianceTypes = Array.isArray(appliance.applianceTypes) ? appliance.applianceTypes : [];
  const types = uniqueSorted([...applianceTypes, primaryCategory].filter(Boolean));
  const applianceId = firstText(appliance.applianceId, '');
  const virtualMediaProvider = isVirtualMediaProvider(applianceId, driver.identifier, types);
  const cleanupStatus = virtualMediaProvider
    ? 'VIRTUAL_PROVIDER'
    : source.kind === 'skill' && !exactSkillName
      ? 'POSSIBLE_ORPHAN'
      : 'REVIEW';
  const canDelete = Boolean(applianceId);
  const endpointEnabled = typeof endpoint.enablement === 'boolean' ? endpoint.enablement : undefined;
  const applianceEnabled = typeof appliance.isEnabled === 'boolean' ? appliance.isEnabled : undefined;
  const enabled = endpointEnabled !== undefined ? endpointEnabled : applianceEnabled;
  const reachability = normalizeReachability(networkState.reachability, enabled);
  const aliases = Array.isArray(appliance.aliases)
    ? appliance.aliases.map((alias) => typeof alias === 'string' ? alias : alias && (alias.friendlyName || alias.name)).filter(Boolean)
    : [];

  return {
    rowId: firstText(endpoint.endpointId, endpoint.id, appliance.entityId, appliance.applianceId, `row-${index}`),
    endpointId: firstText(endpoint.endpointId, endpoint.id, ''),
    endpointIds: firstText(endpoint.endpointId, endpoint.id, '') ? [firstText(endpoint.endpointId, endpoint.id, '')] : [],
    applianceId,
    applianceIds: applianceId ? [applianceId] : [],
    entityId: firstText(appliance.entityId, ''),
    entityIds: firstText(appliance.entityId, '') ? [firstText(appliance.entityId, '')] : [],
    name: firstText(endpoint.friendlyName, appliance.friendlyName, `Unbenanntes Gerät ${index + 1}`),
    description: firstText(appliance.friendlyDescription, ''),
    manufacturer,
    model: firstText(appliance.modelName, nestedText(endpoint, ['model', 'value', 'text']), ''),
    types: types.length ? types : ['UNBEKANNT'],
    sourceKind: source.kind,
    sourceName: source.name,
    sourceDetail: source.detail,
    skillId,
    skillStage: decodedSkill && decodedSkill.stage ? decodedSkill.stage : '',
    skillNameResolved: Boolean(exactSkillName),
    driverNamespace: firstText(driver.namespace, ''),
    driverIdentifier: firstText(driver.identifier, ''),
    connectedVia,
    reachability,
    enabled: enabled !== false,
    lastSeenAt: isoDate(networkState.lastSeenAt),
    createdAt: isoDate(networkState.createdAt),
    aliases,
    matterGrouped: false,
    matterEndpointCount: 1,
    cleanupStatus,
    canDelete,
    canBulkDelete: canDelete && cleanupStatus === 'POSSIBLE_ORPHAN',
    deleteBlockedReason: canDelete ? '' : 'Amazon liefert für diesen Eintrag keine löschbare Appliance-ID.',
    duplicateName: false,
    duplicateCount: 1
  };
}

function groupMatterEndpoints(devices) {
  const buckets = new Map();
  const groupedMembers = new Set();

  for (const device of devices) {
    if (!isMatterPlaceholderEndpoint(device)) continue;
    const key = [device.name, device.manufacturer, device.model].map(normalizeKey).join('\u0000');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(device);
  }

  const matterGroups = [];
  for (const members of buckets.values()) {
    const hasGenericEndpoint = members.some((device) => device.types.every(isGenericType));
    const hasFunctionalEndpoint = members.some((device) => device.types.some((type) => !isGenericType(type)));
    if (members.length < 2 || !hasGenericEndpoint || !hasFunctionalEndpoint) continue;

    for (const member of members) groupedMembers.add(member);
    matterGroups.push(createMatterGroup(members));
  }

  return [...devices.filter((device) => !groupedMembers.has(device)), ...matterGroups];
}

function isMatterPlaceholderEndpoint(device) {
  if (device.sourceKind !== 'direct') return false;
  const manufacturer = normalizeKey(device.manufacturer);
  const model = normalizeKey(device.model);
  const description = normalizeKey(device.description);
  return manufacturer === 'testvendor'
    || model === 'testproduct'
    || description.includes('testvendor intelligentes gerät');
}

function isGenericType(type) {
  return ['OTHER', 'UNBEKANNT', 'UNKNOWN'].includes(String(type || '').toUpperCase());
}

function createMatterGroup(members) {
  const sortedMembers = [...members].sort((left, right) => {
    const leftGeneric = left.types.every(isGenericType) ? 1 : 0;
    const rightGeneric = right.types.every(isGenericType) ? 1 : 0;
    return leftGeneric - rightGeneric || compareText(left.rowId, right.rowId);
  });
  const primary = sortedMembers[0];
  const functionalTypes = uniqueSorted(members.flatMap((device) => device.types).filter((type) => !isGenericType(type)));
  const allTypes = uniqueSorted(members.flatMap((device) => device.types));
  const applianceIds = uniqueSorted(members.map((device) => device.applianceId));
  const endpointIds = uniqueSorted(members.map((device) => device.endpointId));
  const entityIds = uniqueSorted(members.map((device) => device.entityId));
  const connectedViaValues = uniqueSorted(members.map((device) => device.connectedVia));
  const aliases = uniqueSorted(members.flatMap((device) => device.aliases));
  const canDelete = applianceIds.length === members.length;

  return {
    ...primary,
    rowId: `matter:${endpointIds.length ? endpointIds.join('|') : applianceIds.join('|')}`,
    endpointId: endpointIds[0] || primary.endpointId,
    endpointIds,
    applianceId: applianceIds[0] || primary.applianceId,
    applianceIds,
    entityId: entityIds[0] || primary.entityId,
    entityIds,
    description: firstText(...members.map((device) => device.description)),
    types: functionalTypes.length ? functionalTypes : allTypes,
    sourceKind: 'matter',
    sourceName: 'Matter',
    sourceDetail: 'Mehrere Alexa-Endpunkte eines Matter-Geräts wurden zusammengeführt.',
    skillId: '',
    skillStage: '',
    skillNameResolved: false,
    driverNamespace: uniqueSorted(members.map((device) => device.driverNamespace)).join(', '),
    driverIdentifier: uniqueSorted(members.map((device) => device.driverIdentifier)).join(', '),
    connectedVia: connectedViaValues.join(', '),
    reachability: combineReachability(members),
    enabled: members.some((device) => device.enabled),
    lastSeenAt: latestDate(members.map((device) => device.lastSeenAt)),
    createdAt: earliestDate(members.map((device) => device.createdAt)),
    aliases,
    matterGrouped: true,
    matterEndpointCount: members.length,
    cleanupStatus: 'MATTER_GROUP',
    canDelete,
    canBulkDelete: false,
    deleteBlockedReason: canDelete ? '' : 'Mindestens ein Matter-Endpunkt besitzt keine löschbare Appliance-ID.',
    duplicateName: false,
    duplicateCount: 1
  };
}

function combineReachability(devices) {
  if (devices.some((device) => device.reachability === 'REACHABLE')) return 'REACHABLE';
  if (devices.every((device) => device.reachability === 'DISABLED')) return 'DISABLED';
  if (devices.every((device) => device.reachability === 'UNREACHABLE')) return 'UNREACHABLE';
  return 'UNKNOWN';
}

function latestDate(values) {
  return extremeDate(values, Math.max);
}

function earliestDate(values) {
  return extremeDate(values, Math.min);
}

function extremeDate(values, operation) {
  const timestamps = values.filter(Boolean).map((value) => new Date(value).getTime()).filter(Number.isFinite);
  return timestamps.length ? new Date(operation(...timestamps)).toISOString() : null;
}

function determineSource({ driver, exactSkillName, manufacturer, connectedVia, skillId }) {
  const namespace = firstText(driver.namespace, '').toUpperCase();

  if (namespace === 'SKILL') {
    const fallbackName = manufacturer && manufacturer !== 'Unbekannt' ? manufacturer : 'Unbekannter Skill';
    return {
      kind: 'skill',
      name: exactSkillName || fallbackName,
      detail: exactSkillName
        ? 'Skillname aus dem Alexa-Katalog'
        : skillId
          ? 'Skill erkannt; Amazon liefert keinen lesbaren Namen. Hersteller wird als Ersatz angezeigt.'
          : 'Skillquelle erkannt; Skill-ID konnte nicht dekodiert werden.'
    };
  }

  if (namespace === 'AAA') {
    return {
      kind: 'direct',
      name: connectedVia ? `Direkt über ${connectedVia}` : 'Amazon / direkt verbunden',
      detail: firstText(driver.identifier, 'Direkte Alexa-Verbindung')
    };
  }

  if (namespace === 'ALEXABRIDGE') {
    return {
      kind: 'bridge',
      name: manufacturer !== 'Unbekannt' ? manufacturer : 'Alexa Bridge',
      detail: firstText(driver.identifier, 'Bridge-Verbindung')
    };
  }

  return {
    kind: 'other',
    name: connectedVia || (manufacturer !== 'Unbekannt' ? manufacturer : namespace || 'Unbekannte Quelle'),
    detail: [namespace, driver.identifier].filter(Boolean).join(' / ')
  };
}

function buildSkillMap(rawCatalog) {
  const result = new Map();
  const visited = new Set();
  const pending = [rawCatalog];
  let inspected = 0;

  // Amazon hat die Form des Routine-Katalogs mehrfach geändert. Deshalb werden
  // passende Skill-ID-/Titel-Paare defensiv in der gesamten JSON-Antwort gesucht.
  while (pending.length && inspected < 20_000) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || visited.has(value)) {
      continue;
    }
    visited.add(value);
    inspected += 1;

    const skillId = firstText(value.skillId, value.skillID, value.skillIdentifier);
    const title = firstText(value.title, value.displayName, value.skillName, value.friendlyName, value.name);
    if (skillId.startsWith('amzn1.ask.skill.') && title) {
      result.set(skillId, title);
    }

    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      if (child && typeof child === 'object') {
        pending.push(child);
      }
    }
  }
  return result;
}

function decodeSkillIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'string') {
    return null;
  }
  try {
    const decoded = Buffer.from(identifier, 'base64url').toString('utf8');
    const value = JSON.parse(decoded);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function summarizeSources(devices) {
  const map = new Map();
  for (const device of devices) {
    const key = `${device.sourceKind}\u0000${device.sourceName}\u0000${device.skillId}`;
    if (!map.has(key)) {
      map.set(key, {
        name: device.sourceName,
        kind: device.sourceKind,
        skillId: device.skillId,
        skillNameResolved: device.skillNameResolved,
        count: 0,
        unreachable: 0,
        cleanupCandidates: 0
      });
    }
    const entry = map.get(key);
    entry.count += 1;
    if (device.reachability === 'UNREACHABLE') {
      entry.unreachable += 1;
    }
    if (device.canBulkDelete) {
      entry.cleanupCandidates += 1;
    }
  }
  return [...map.values()].sort((left, right) => compareText(left.name, right.name));
}

function isVirtualMediaProvider(applianceId, driverIdentifier, types) {
  const identity = [applianceId, driverIdentifier, ...types].join(' ').toUpperCase();
  return identity.includes('EXTERNAL_MEDIA_PLAYER')
    || identity.includes('VIDEO_PROVIDER')
    || identity.includes('MEDIA_PROVIDER');
}

function normalizeReachability(value, enabled) {
  if (enabled === false) {
    return 'DISABLED';
  }
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'REACHABLE' || normalized === 'UNREACHABLE') {
    return normalized;
  }
  return 'UNKNOWN';
}

function isoDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(typeof value === 'number' ? value : String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nestedText(object, keys) {
  const value = nestedValue(object, keys);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function nestedValue(object, keys) {
  let current = object;
  for (const key of keys) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return '';
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort(compareText);
}

function normalizeKey(value) {
  return String(value || '').trim().toLocaleLowerCase('de-DE');
}

function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''), 'de-DE', { sensitivity: 'base', numeric: true });
}

module.exports = {
  normalizeInventory,
  decodeSkillIdentifier,
  buildSkillMap
};
