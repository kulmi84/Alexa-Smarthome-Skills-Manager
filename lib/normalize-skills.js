'use strict';

function normalizeSkills(rawSkills, devices, amazonPage = 'amazon.de') {
  const skills = Array.isArray(rawSkills) ? rawSkills : [];
  const deviceCounts = new Map();

  for (const device of Array.isArray(devices) ? devices : []) {
    if (!device.skillId) continue;
    deviceCounts.set(device.skillId, (deviceCounts.get(device.skillId) || 0) + 1);
  }

  return skills
    .map((skill, index) => {
      const id = text(skill && (skill.id || skill.skillId));
      const asin = normalizeAsin(skill && (skill.asin || skill.productId));
      const name = text(skill && (skill.name || skill.title)) || `Unbenannter Skill ${index + 1}`;
      const type = text(skill && (skill.type || skill.skillType)) || 'UNBEKANNT';
      const smartHomeDeviceCount = id ? deviceCounts.get(id) || 0 : 0;
      return {
        id,
        asin,
        name,
        type,
        smartHomeDeviceCount,
        providesSmartHomeDevices: smartHomeDeviceCount > 0,
        alexaSkillUrl: asin ? `https://skills-store.${safeAmazonPage(amazonPage)}/deeplink/dp/${asin}` : ''
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'de', { sensitivity: 'base' }));
}

function normalizeAsin(value) {
  const asin = text(value).toUpperCase();
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : '';
}

function safeAmazonPage(value) {
  const page = String(value || '').trim().toLowerCase();
  return /^(amazon\.(de|com|co\.uk|fr|it|es|ca|com\.au|co\.jp|in))$/.test(page) ? page : 'amazon.de';
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

module.exports = { normalizeSkills };
