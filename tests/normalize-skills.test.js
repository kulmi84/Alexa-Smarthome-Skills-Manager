'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSkills } = require('../lib/normalize-skills');

test('sortiert aktive Skills und ordnet Smart-Home-Einträge zu', () => {
  const skills = normalizeSkills([
    { id: 'skill-zdf', asin: 'B0ZDFHEUTE', name: 'ZDFheute', type: 'CUSTOM' },
    { id: 'skill-ha', asin: 'B012345678', name: 'Home Assistant', type: 'SMART_HOME' }
  ], [
    { skillId: 'skill-ha' },
    { skillId: 'skill-ha' }
  ], 'amazon.de');

  assert.deepEqual(skills.map((skill) => skill.name), ['Home Assistant', 'ZDFheute']);
  assert.equal(skills[0].providesSmartHomeDevices, true);
  assert.equal(skills[0].smartHomeDeviceCount, 2);
  assert.equal(skills[1].providesSmartHomeDevices, false);
  assert.equal(skills[1].alexaSkillUrl, 'https://skills-store.amazon.de/deeplink/dp/B0ZDFHEUTE');
});

test('verwendet bei ungültiger Amazon-Domain sicher amazon.de', () => {
  const [skill] = normalizeSkills([{ name: 'Test', asin: 'B012345678' }], [], 'example.org');
  assert.match(skill.alexaSkillUrl, /^https:\/\/skills-store\.amazon\.de\//);
});

test('erzeugt ohne gültige ASIN keinen irreführenden Suchlink', () => {
  const [skill] = normalizeSkills([{ name: 'Test', asin: 'ungültig' }], [], 'amazon.de');
  assert.equal(skill.alexaSkillUrl, '');
});
