'use strict';

const state = {
  status: null,
  inventory: null,
  filteredDevices: [],
  filteredSkills: [],
  authTimer: null,
  authWindow: null,
  loading: false,
  deleting: false,
  disablingSkillId: '',
  changingDeviceId: '',
  selectedDevice: null,
  currentView: 'devices',
  deleteSelection: [],
  selectedApplianceIds: new Set()
};

const elements = {};

document.addEventListener('DOMContentLoaded', () => {
  collectElements();
  bindEvents();
  refreshStatus();
});

function collectElements() {
  const ids = [
    'status-dot', 'connection-title', 'status-message', 'auth-button', 'load-button',
    'export-button', 'settings-button', 'auth-notice', 'auth-link', 'error-notice',
    'error-message', 'dismiss-error', 'success-notice', 'success-message', 'dismiss-success',
    'welcome', 'summary-section', 'devices-view-card', 'disabled-devices-view-card', 'skills-view-card',
    'metric-active-devices', 'metric-disabled-devices', 'metric-active-skills', 'metric-unreachable',
    'metric-duplicates', 'source-section',
    'source-list', 'toggle-sources', 'skills-section', 'skills-result-count', 'skills-filters',
    'skills-search-input', 'skills-type-filter', 'skills-smarthome-filter',
    'reset-skills-filters', 'skill-command-device', 'skill-command-note', 'skills-warning',
    'skills-table', 'skills-table-body',
    'skills-no-results', 'inventory-section', 'loaded-at', 'result-count', 'filters',
    'search-input', 'source-filter', 'type-filter', 'status-filter', 'cleanup-filter',
    'duplicate-filter', 'reset-filters', 'selection-bar', 'selection-count',
    'select-visible', 'clear-selection', 'delete-selected', 'device-table-body',
    'no-results', 'details-dialog', 'details-title', 'details-content',
    'details-protect-button', 'details-enable-button', 'details-delete-button', 'delete-dialog', 'delete-title', 'delete-summary',
    'delete-list', 'delete-confirm-checkbox', 'delete-confirm-button', 'settings-dialog',
    'saved-session-dot', 'saved-session-text', 'forget-button'
  ];
  for (const id of ids) {
    elements[toCamelCase(id)] = document.getElementById(id);
  }
}

function bindEvents() {
  elements.authButton.addEventListener('click', startAuthentication);
  elements.loadButton.addEventListener('click', loadInventory);
  elements.exportButton.addEventListener('click', exportCsv);
  elements.settingsButton.addEventListener('click', () => elements.settingsDialog.showModal());
  elements.forgetButton.addEventListener('click', forgetAuthentication);
  elements.dismissError.addEventListener('click', hideError);
  elements.dismissSuccess.addEventListener('click', hideSuccess);
  elements.devicesViewCard.addEventListener('click', () => showDeviceView('ACTIVE'));
  elements.disabledDevicesViewCard.addEventListener('click', () => showDeviceView('DISABLED'));
  elements.skillsViewCard.addEventListener('click', () => showView('skills'));
  elements.toggleSources.addEventListener('click', () => {
    const willOpen = elements.sourceList.hidden;
    elements.sourceList.hidden = !willOpen;
    elements.toggleSources.textContent = willOpen ? 'Quellen ausblenden' : 'Quellen anzeigen';
    elements.toggleSources.setAttribute('aria-expanded', String(willOpen));
  });
  elements.filters.addEventListener('input', renderFilteredDevices);
  elements.filters.addEventListener('change', renderFilteredDevices);
  elements.statusFilter.addEventListener('change', () => showView('devices'));
  elements.resetFilters.addEventListener('click', resetFilters);
  elements.skillsFilters.addEventListener('input', renderFilteredSkills);
  elements.skillsFilters.addEventListener('change', renderFilteredSkills);
  elements.resetSkillsFilters.addEventListener('click', resetSkillsFilters);
  elements.skillCommandDevice.addEventListener('change', () => {
    updateSkillCommandNote();
    renderFilteredSkills();
  });
  elements.skillsTableBody.addEventListener('click', handleSkillTableClick);
  elements.deviceTableBody.addEventListener('click', handleTableClick);
  elements.selectVisible.addEventListener('click', toggleVisibleSelection);
  elements.clearSelection.addEventListener('click', clearSelection);
  elements.deleteSelected.addEventListener('click', openSelectedDeleteDialog);
  elements.detailsDeleteButton.addEventListener('click', openDetailsDeleteDialog);
  elements.detailsEnableButton.addEventListener('click', () => {
    if (state.selectedDevice) toggleDeviceEnablement(state.selectedDevice);
  });
  elements.detailsProtectButton.addEventListener('click', () => {
    if (state.selectedDevice) toggleDeviceProtection(state.selectedDevice);
  });
  elements.deleteConfirmCheckbox.addEventListener('change', () => {
    elements.deleteConfirmButton.disabled = !elements.deleteConfirmCheckbox.checked || state.deleting;
  });
  elements.deleteConfirmButton.addEventListener('click', deleteConfirmedEntries);

  for (const closeButton of document.querySelectorAll('[data-close-dialog]')) {
    closeButton.addEventListener('click', () => {
      const dialog = document.getElementById(closeButton.dataset.closeDialog);
      if (dialog && dialog.open) {
        dialog.close();
      }
    });
  }

  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
  }
}

async function refreshStatus(options = {}) {
  try {
    const status = await requestJson('/api/status');
    state.status = status;
    renderStatus(status);
    if (status.authenticating && options.poll !== false) {
      scheduleAuthPoll();
    } else {
      stopAuthPoll();
    }
    return status;
  } catch (error) {
    renderStatus({ state: 'error', message: 'Der lokale Container antwortet nicht.', ready: false });
    if (!options.silent) {
      showError(error.message);
    }
    return null;
  }
}

function renderStatus(status) {
  const labels = {
    ready: status.mockMode ? 'Testmodus bereit' : 'Mit Amazon verbunden',
    authenticating: 'Amazon-Anmeldung läuft',
    connecting: 'Verbindung wird geprüft',
    disconnected: 'Noch nicht verbunden',
    error: 'Verbindung fehlgeschlagen'
  };
  const dotClasses = {
    ready: 'status-dot--ready',
    authenticating: 'status-dot--busy',
    connecting: 'status-dot--busy',
    disconnected: 'status-dot--idle',
    error: 'status-dot--error'
  };
  const currentState = status.state || 'disconnected';

  elements.connectionTitle.textContent = labels[currentState] || 'Status unbekannt';
  elements.statusMessage.textContent = status.message || '';
  elements.statusDot.className = `status-dot ${dotClasses[currentState] || 'status-dot--idle'}`;
  elements.loadButton.disabled = !status.ready || state.loading;
  elements.authButton.disabled = Boolean(status.authenticating || state.loading || status.mockMode);
  elements.authButton.hidden = Boolean(status.ready || status.mockMode);
  elements.authButton.textContent = currentState === 'error' ? 'Erneut verbinden' : 'Mit Amazon verbinden';
  elements.forgetButton.disabled = !status.hasSavedSession || status.mockMode || status.authenticating;
  elements.savedSessionDot.className = `status-dot ${status.hasSavedSession ? 'status-dot--ready' : 'status-dot--idle'}`;
  elements.savedSessionText.textContent = status.mockMode
    ? 'Testmodus – keine Anmeldung gespeichert'
    : status.hasSavedSession
      ? 'Lokale Amazon-Sitzung ist gespeichert'
      : 'Keine lokale Amazon-Sitzung gespeichert';

  if (!status.authenticating && state.authWindow && !state.authWindow.closed) {
    state.authWindow.close();
    state.authWindow = null;
  }

  if (status.loginUrl && status.authenticating) {
    elements.authNotice.hidden = false;
    elements.authLink.href = status.loginUrl;
  } else {
    elements.authNotice.hidden = true;
    elements.authLink.removeAttribute('href');
  }
}

async function startAuthentication() {
  hideError();
  const popup = window.open('about:blank', 'alexa-anmeldung', 'popup,width=620,height=780');
  state.authWindow = popup;
  if (popup) {
    popup.document.title = 'Alexa-Anmeldung wird vorbereitet';
    popup.document.body.textContent = 'Die lokale Amazon-Anmeldung wird vorbereitet …';
  }

  setActionBusy(elements.authButton, true, 'Wird vorbereitet …');
  try {
    const result = await requestJson('/api/auth/start', {
      method: 'POST',
      body: JSON.stringify({ proxyIp: window.location.hostname })
    });
    state.status = result;
    renderStatus(result);
    if (result.loginUrl) {
      if (popup) {
        popup.location.href = result.loginUrl;
      } else {
        elements.authNotice.hidden = false;
        elements.authLink.href = result.loginUrl;
      }
    } else if (popup) {
      popup.close();
    }
    scheduleAuthPoll();
  } catch (error) {
    if (popup) {
      popup.close();
      state.authWindow = null;
    }
    showError(error.message);
  } finally {
    setActionBusy(elements.authButton, false, 'Mit Amazon verbinden');
    if (state.status) renderStatus(state.status);
  }
}

function scheduleAuthPoll() {
  stopAuthPoll();
  state.authTimer = window.setTimeout(async () => {
    const status = await refreshStatus({ silent: true, poll: false });
    if (status && status.authenticating) {
      scheduleAuthPoll();
    }
  }, 2000);
}

function stopAuthPoll() {
  if (state.authTimer) {
    window.clearTimeout(state.authTimer);
    state.authTimer = null;
  }
}

async function loadInventory(options = {}) {
  if (!options.preserveNotices) {
    hideError();
    hideSuccess();
  }
  state.loading = true;
  elements.loadButton.disabled = true;
  elements.loadButton.textContent = 'Wird geladen …';
  try {
    const inventory = await requestJson('/api/devices');
    state.inventory = inventory;
    state.selectedDevice = null;
    state.selectedApplianceIds.clear();
    populateFilterOptions(inventory);
    renderInventory(inventory);
    await refreshStatus({ silent: true, poll: false });
    return inventory;
  } catch (error) {
    showError(error.message);
    await refreshStatus({ silent: true, poll: false });
    return null;
  } finally {
    state.loading = false;
    elements.loadButton.textContent = 'Geräte & Skills neu laden';
    elements.loadButton.disabled = !state.status || !state.status.ready;
  }
}

function renderInventory(inventory) {
  elements.welcome.hidden = true;
  elements.summarySection.hidden = false;
  elements.exportButton.disabled = inventory.devices.length === 0;

  elements.metricActiveDevices.textContent = formatNumber(inventory.totals.activeDevices);
  elements.metricDisabledDevices.textContent = formatNumber(inventory.totals.disabledDevices);
  elements.metricActiveSkills.textContent = formatNumber((inventory.activeSkills || []).length);
  elements.metricUnreachable.textContent = formatNumber(inventory.totals.unreachable);
  elements.metricDuplicates.textContent = formatNumber(inventory.totals.duplicates);
  elements.loadedAt.textContent = inventory.deleteEnabled
    ? `Geladen ${formatDate(inventory.loadedAt, true)} · Löschen nur nach Auswahl und Bestätigung`
    : `Geladen ${formatDate(inventory.loadedAt, true)} · Testmodus ohne Löschfunktion`;
  elements.selectionBar.hidden = !inventory.deleteEnabled || inventory.totals.cleanupCandidates === 0;

  renderSources(inventory.sources);
  renderSkills(inventory);
  renderFilteredDevices();
  showView(state.currentView);
}

function showView(view) {
  state.currentView = view === 'skills' ? 'skills' : 'devices';
  const skillsActive = state.currentView === 'skills';
  elements.summarySection.hidden = false;
  elements.sourceSection.hidden = skillsActive;
  elements.inventorySection.hidden = skillsActive;
  elements.skillsSection.hidden = !skillsActive;
  const disabledActive = !skillsActive && elements.statusFilter.value === 'DISABLED';
  elements.devicesViewCard.classList.toggle('metric-card--active', !skillsActive && !disabledActive);
  elements.disabledDevicesViewCard.classList.toggle('metric-card--active', disabledActive);
  elements.skillsViewCard.classList.toggle('metric-card--active', skillsActive);
  elements.devicesViewCard.setAttribute('aria-pressed', String(!skillsActive && !disabledActive));
  elements.disabledDevicesViewCard.setAttribute('aria-pressed', String(disabledActive));
  elements.skillsViewCard.setAttribute('aria-pressed', String(skillsActive));
}

function showDeviceView(status) {
  elements.statusFilter.value = status;
  showView('devices');
  renderFilteredDevices();
  elements.inventorySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSkills(inventory) {
  const skills = Array.isArray(inventory.activeSkills) ? inventory.activeSkills : [];
  const types = [...new Set(skills.map((skill) => skill.type).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'de'));
  replaceSelectOptions(elements.skillsTypeFilter, 'Alle Skilltypen', types);
  populateEchoOptions(inventory.echoDevices);
  elements.skillsWarning.hidden = !inventory.skillsError;
  elements.skillsWarning.textContent = inventory.skillsError || '';
  renderFilteredSkills();
}

function renderFilteredSkills() {
  if (!state.inventory) return;
  const skills = Array.isArray(state.inventory.activeSkills) ? state.inventory.activeSkills : [];
  const query = normalizeSearch(elements.skillsSearchInput.value);
  const type = elements.skillsTypeFilter.value;
  const smartHomeOnly = elements.skillsSmarthomeFilter.checked;

  state.filteredSkills = skills.filter((skill) => {
    const searchable = normalizeSearch([skill.name, skill.id, skill.type].join(' '));
    return (!query || searchable.includes(query))
      && (!type || skill.type === type)
      && (!smartHomeOnly || skill.providesSmartHomeDevices);
  });

  elements.skillsTableBody.replaceChildren();
  for (const skill of state.filteredSkills) {
    elements.skillsTableBody.append(createSkillRow(skill));
  }

  const noResults = state.filteredSkills.length === 0;
  elements.skillsNoResults.hidden = !noResults;
  elements.skillsTable.hidden = noResults;
  elements.skillsResultCount.textContent = state.filteredSkills.length === skills.length
    ? `${formatNumber(skills.length)} ${skills.length === 1 ? 'Skill' : 'Skills'}`
    : `${formatNumber(state.filteredSkills.length)} von ${formatNumber(skills.length)}`;
}

function createSkillRow(skill) {
  const row = createElement('tr', 'skill-card-row');
  const nameCell = createElement('td', 'device-name skill-card__name');
  nameCell.append(createElement('strong', '', skill.name));
  if (skill.id) nameCell.append(createElement('code', 'cell-secondary skill-id', skill.id));

  const typeCell = createElement('td', 'skill-card__type');
  typeCell.append(createElement('span', 'tag', humanizeType(skill.type)));

  const smartHomeCell = createElement('td', 'skill-card__smarthome');
  if (skill.providesSmartHomeDevices) {
    const label = skill.smartHomeDeviceCount === 1
      ? '1 zugeordneter Eintrag'
      : `${skill.smartHomeDeviceCount} zugeordnete Einträge`;
    smartHomeCell.append(createElement('span', 'tag tag--matter', label));
  } else {
    smartHomeCell.append(createElement('span', 'cell-secondary', 'Keine Zuordnung erkannt'));
  }

  const actionCell = createElement('td', 'skill-card__action');
  if (skill.id) {
    const busy = state.disablingSkillId === skill.id;
    const button = createElement('button', 'row-button row-button--warning', busy ? 'Wird gesendet …' : 'Deaktivieren');
    button.type = 'button';
    button.dataset.disableSkillId = skill.id;
    button.disabled = Boolean(
      state.disablingSkillId
      || !elements.skillCommandDevice.value
      || !state.inventory?.changeEnabled
    );
    button.setAttribute('aria-label', `${skill.name} über Alexa deaktivieren`);
    if (!elements.skillCommandDevice.value) {
      button.title = 'Bitte zuerst oben ein Echo auswählen.';
    }
    actionCell.append(button);
  } else {
    const unavailable = createElement('span', 'cell-secondary', 'Keine Skill-ID geliefert');
    unavailable.title = 'Ohne eindeutige Skill-ID wird kein Alexa-Befehl gesendet.';
    actionCell.append(unavailable);
  }
  row.append(nameCell, typeCell, smartHomeCell, actionCell);
  return row;
}

function populateEchoOptions(echoDevices) {
  const devices = Array.isArray(echoDevices) ? echoDevices : [];
  const prior = elements.skillCommandDevice.value;
  elements.skillCommandDevice.replaceChildren();
  if (devices.length === 0) {
    elements.skillCommandDevice.append(new Option('Kein geeignetes Echo gefunden', ''));
    elements.skillCommandDevice.disabled = true;
    updateSkillCommandNote();
    return;
  }

  elements.skillCommandDevice.append(new Option('Echo auswählen …', ''));
  for (const device of devices) {
    const label = device.type ? `${device.name} · ${device.type}` : device.name;
    elements.skillCommandDevice.append(new Option(label, device.serialNumber));
  }
  if ([...elements.skillCommandDevice.options].some((option) => option.value === prior)) {
    elements.skillCommandDevice.value = prior;
  }
  elements.skillCommandDevice.disabled = Boolean(state.disablingSkillId);
  updateSkillCommandNote();
}

function updateSkillCommandNote(message) {
  if (message) {
    elements.skillCommandNote.textContent = message;
    return;
  }
  const devices = Array.isArray(state.inventory?.echoDevices) ? state.inventory.echoDevices : [];
  if (devices.length === 0) {
    elements.skillCommandNote.textContent = 'Amazon hat kein geeignetes Echo für Alexa-Textbefehle geliefert. Die Deaktivierung bleibt gesperrt.';
  } else if (!elements.skillCommandDevice.value) {
    elements.skillCommandNote.textContent = 'Wähle ein Echo.';
  } else {
    const selected = elements.skillCommandDevice.selectedOptions[0];
    elements.skillCommandNote.textContent = `Deaktivierungsbefehle werden einzeln über „${selected.textContent}“ gesendet.`;
  }
}

async function handleSkillTableClick(event) {
  const button = event.target.closest('[data-disable-skill-id]');
  if (!button || !state.inventory || state.disablingSkillId) return;
  const skill = state.inventory.activeSkills.find((entry) => entry.id === button.dataset.disableSkillId);
  if (skill) await disableSkill(skill);
}

async function disableSkill(skill) {
  const deviceSerial = elements.skillCommandDevice.value;
  const echoLabel = elements.skillCommandDevice.selectedOptions[0]?.textContent || 'dem ausgewählten Echo';
  if (!deviceSerial) {
    showError('Bitte zuerst ein Echo für den Deaktivierungsbefehl auswählen.');
    return;
  }

  const confirmed = window.confirm(
    `Soll Alexa über „${echoLabel}“ wirklich den Befehl „deaktiviere den Skill ${skill.name}“ ausführen?\n\n`
    + 'Der Skill kann sofort deaktiviert werden. Bei einem Smart-Home-Skill können dessen Alexa-Geräte verschwinden. Das Echo kann hörbar antworten oder nach einer Bestätigung fragen.'
  );
  if (!confirmed) return;

  hideError();
  hideSuccess();
  state.disablingSkillId = skill.id;
  elements.skillCommandDevice.disabled = true;
  updateSkillCommandNote(`Der Deaktivierungsbefehl für „${skill.name}“ wird gesendet …`);
  renderFilteredSkills();

  try {
    const result = await requestJson('/api/skills/disable', {
      method: 'POST',
      body: JSON.stringify({
        skillId: skill.id,
        expectedName: skill.name,
        deviceSerial,
        confirmation: 'DISABLE_SKILL'
      })
    });
    updateSkillCommandNote(`Befehl über „${result.echoName}“ gesendet. Die aktive Skillliste wird gleich kontrolliert …`);
    await delay(5_000);
    const inventory = await loadInventory({ preserveNotices: true });
    if (!inventory) return;

    const stillActive = (inventory.activeSkills || []).some((entry) => entry.id === skill.id);
    if (stillActive) {
      showError(`Der Befehl wurde gesendet, aber „${skill.name}“ wird weiterhin als aktiv gemeldet. Prüfe, ob das Echo hörbar um Bestätigung gebeten hat, und lade danach erneut.`);
      updateSkillCommandNote(`„${skill.name}“ ist in der zuletzt geladenen Skillliste noch aktiv.`);
    } else {
      showSuccess(`„${skill.name}“ wird nicht mehr in der aktiven Skillliste gefunden.`);
      updateSkillCommandNote(`Kontrolle erfolgreich: „${skill.name}“ ist nicht mehr als aktiver Skill aufgeführt.`);
    }
  } catch (error) {
    showError(error.message);
    updateSkillCommandNote(`Der Deaktivierungsbefehl für „${skill.name}“ konnte nicht abgeschlossen werden.`);
  } finally {
    state.disablingSkillId = '';
    const hasEchoes = Array.isArray(state.inventory?.echoDevices) && state.inventory.echoDevices.length > 0;
    elements.skillCommandDevice.disabled = !hasEchoes;
    renderFilteredSkills();
  }
}

function resetSkillsFilters() {
  elements.skillsSearchInput.value = '';
  elements.skillsTypeFilter.value = '';
  elements.skillsSmarthomeFilter.checked = false;
  renderFilteredSkills();
}

function renderSources(sources) {
  elements.sourceList.replaceChildren();
  for (const source of sources) {
    const card = createElement('article', 'source-card');
    if (source.kind === 'skill' && !source.skillNameResolved) {
      card.classList.add('source-card--warning');
      card.title = 'Skill erkannt, aber Amazon hat in keiner der Skilllisten einen passenden lesbaren Namen geliefert.';
    }

    const mark = createElement('span', 'source-card__mark', sourceMark(source.kind, source.skillNameResolved));
    mark.setAttribute('aria-hidden', 'true');
    const text = createElement('div', 'source-card__text');
    text.append(
      createElement('strong', '', source.name),
      createElement('small', '', sourceSubline(source))
    );
    const count = createElement('span', 'source-card__count', formatNumber(source.count));
    count.title = `${source.count} bekannte Einträge`;
    card.append(mark, text, count);
    elements.sourceList.append(card);
  }
}

function sourceMark(kind, resolved) {
  if (kind === 'skill' && !resolved) return '!';
  if (kind === 'skill') return 'S';
  if (kind === 'matter') return 'M';
  if (kind === 'direct') return 'D';
  if (kind === 'bridge') return 'B';
  return 'Q';
}

function sourceSubline(source) {
  const kind = kindLabel(source.kind);
  if (source.cleanupCandidates > 0) {
    const noun = source.cleanupCandidates === 1 ? 'mögliche Altlast' : 'mögliche Altlasten';
    return `${kind} · ${source.cleanupCandidates} ${noun}`;
  }
  if (source.unreachable > 0) {
    return `${kind} · ${source.unreachable} nicht erreichbar`;
  }
  if (source.kind === 'skill' && !source.skillNameResolved) {
    return 'Skill · Name von Amazon nicht geliefert';
  }
  return kind;
}

function populateFilterOptions(inventory) {
  replaceSelectOptions(elements.sourceFilter, 'Alle Skills / Quellen', inventory.sources.map((source) => source.name));
  replaceSelectOptions(elements.typeFilter, 'Alle Gerätetypen', inventory.types);
}

function replaceSelectOptions(select, defaultLabel, values) {
  const prior = select.value;
  select.replaceChildren(new Option(defaultLabel, ''));
  for (const value of values) {
    select.append(new Option(value, value));
  }
  if ([...select.options].some((option) => option.value === prior)) {
    select.value = prior;
  }
}

function renderFilteredDevices() {
  if (!state.inventory) return;

  const query = normalizeSearch(elements.searchInput.value);
  const source = elements.sourceFilter.value;
  const type = elements.typeFilter.value;
  const status = elements.statusFilter.value;
  const cleanupOnly = elements.cleanupFilter.checked;
  const duplicatesOnly = elements.duplicateFilter.checked;

  state.filteredDevices = state.inventory.devices.filter((device) => {
    const searchable = normalizeSearch([
      device.name, device.description, device.manufacturer, device.model, device.sourceName,
      device.endpointId, device.applianceId, device.entityId, device.skillId,
      ...(device.endpointIds || []), ...(device.applianceIds || []), ...(device.entityIds || []),
      ...device.types, ...device.aliases
    ].join(' '));
    return (!query || searchable.includes(query))
      && (!source || device.sourceName === source)
      && (!type || device.types.includes(type))
      && (!status || (status === 'ACTIVE' ? device.enabled : device.reachability === status))
      && (!cleanupOnly || device.canBulkDelete)
      && (!duplicatesOnly || device.duplicateName);
  });

  elements.deviceTableBody.replaceChildren();
  for (const device of state.filteredDevices) {
    elements.deviceTableBody.append(createDeviceRow(device));
  }

  const noResults = state.filteredDevices.length === 0;
  elements.noResults.hidden = !noResults;
  elements.deviceTableBody.closest('table').hidden = noResults;
  elements.resultCount.textContent = resultCountLabel(state.filteredDevices.length, state.inventory.devices.length);
  elements.exportButton.disabled = noResults;
  updateSelectionControls();
}

function createDeviceRow(device) {
  const row = document.createElement('tr');

  const selectionCell = createElement('td', 'selection-cell');
  if (state.inventory.deleteEnabled && device.canBulkDelete) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selectedApplianceIds.has(device.applianceId);
    checkbox.dataset.selectId = device.applianceId;
    checkbox.setAttribute('aria-label', `${device.name} für Sammellöschung auswählen`);
    selectionCell.append(checkbox);
  } else {
    const placeholder = createElement('span', 'selection-placeholder', '–');
    placeholder.title = device.cleanupStatus === 'VIRTUAL_PROVIDER'
      ? 'Virtueller Mediendienst – nur einzeln löschbar'
      : device.cleanupStatus === 'MATTER_GROUP'
        ? `Matter-Gerät mit ${device.matterEndpointCount} technischen Endpunkten – nur gemeinsam über Details löschbar`
      : 'Nur einzeln über Details löschbar';
    selectionCell.append(placeholder);
  }

  const nameCell = createElement('td', 'device-name');
  nameCell.append(createElement('strong', '', device.name));
  if (device.description) {
    nameCell.append(createElement('span', 'cell-secondary', device.description));
  }
  if (device.duplicateName || device.aliases.length) {
    const tags = createElement('div', 'tag-row');
    if (device.duplicateName) {
      tags.append(createElement('span', 'tag tag--duplicate', `${device.duplicateCount} Einträge mit gleichem Namen`));
    }
    if (device.aliases.length) {
      tags.append(createElement('span', 'tag', `${device.aliases.length} Alias${device.aliases.length === 1 ? '' : 'e'}`));
    }
    nameCell.append(tags);
  }
  if (device.cleanupStatus !== 'REVIEW') {
    let tags = nameCell.querySelector('.tag-row');
    if (!tags) {
      tags = createElement('div', 'tag-row');
      nameCell.append(tags);
    }
    if (device.cleanupStatus === 'POSSIBLE_ORPHAN') {
      tags.append(createElement('span', 'tag tag--cleanup', 'Mögliche Altlast'));
    } else if (device.cleanupStatus === 'VIRTUAL_PROVIDER') {
      tags.append(createElement('span', 'tag tag--virtual', 'Virtueller Mediendienst'));
    } else if (device.cleanupStatus === 'MATTER_GROUP') {
      tags.append(createElement('span', 'tag tag--matter', `1 Matter-Gerät · ${device.matterEndpointCount} Endpunkte`));
    } else if (device.cleanupStatus === 'USER_PROTECTED') {
      tags.append(createElement('span', 'tag tag--protected', 'Aktiv / behalten'));
    }
  }

  const typeCell = document.createElement('td');
  const typeTags = createElement('div', 'tag-row');
  for (const type of device.types) {
    typeTags.append(createElement('span', 'tag', humanizeType(type)));
  }
  typeCell.append(typeTags);

  const sourceCell = document.createElement('td');
  sourceCell.append(createElement('span', 'cell-primary', device.sourceName));
  const sourceBadge = createElement('span', `kind-badge kind-badge--${device.sourceKind}`, kindLabel(device.sourceKind));
  if (device.sourceKind === 'skill' && !device.skillNameResolved) {
    sourceBadge.className = 'kind-badge kind-badge--unresolved';
    sourceBadge.textContent = 'Skillname von Amazon nicht geliefert';
  }
  sourceCell.append(sourceBadge);

  const manufacturerCell = document.createElement('td');
  manufacturerCell.append(createElement('span', 'cell-primary', device.manufacturer || '–'));
  if (device.model) manufacturerCell.append(createElement('span', 'cell-secondary', device.model));

  const viaCell = document.createElement('td');
  viaCell.textContent = device.connectedVia || '–';

  const statusCell = document.createElement('td');
  statusCell.append(createStatusBadge(device.reachability));

  const lastSeenCell = document.createElement('td');
  lastSeenCell.textContent = formatDate(device.lastSeenAt, false);
  lastSeenCell.title = device.lastSeenAt ? formatDate(device.lastSeenAt, true) : 'Kein Zeitstempel vorhanden';

  const actionCell = document.createElement('td');
  const actions = createElement('div', 'row-actions');
  if (device.cleanupStatus === 'POSSIBLE_ORPHAN' || device.cleanupStatus === 'USER_PROTECTED') {
    const protectButton = createElement('button', 'row-button', device.userProtected ? 'Freigeben' : 'Behalten');
    protectButton.type = 'button';
    protectButton.dataset.protectId = device.applianceId;
    protectButton.setAttribute('aria-label', device.userProtected
      ? `Kennzeichnung Aktiv / behalten für ${device.name} entfernen`
      : `${device.name} als aktiv kennzeichnen und behalten`);
    actions.append(protectButton);
  }
  if (device.applianceId) {
    const changing = state.changingDeviceId === device.applianceId;
    const enableButton = createElement(
      'button',
      `row-button${device.enabled ? ' row-button--warning' : ''}`,
      changing ? 'Wird geändert …' : device.enabled ? 'Deaktivieren' : 'Aktivieren'
    );
    enableButton.type = 'button';
    enableButton.dataset.enableId = device.applianceId;
    enableButton.disabled = Boolean(state.changingDeviceId || !state.inventory.changeEnabled);
    enableButton.setAttribute('aria-label', `${device.name} in Alexa ${device.enabled ? 'deaktivieren' : 'aktivieren'}`);
    actions.append(enableButton);
  }
  const detailsButton = createElement('button', 'row-button', 'Details');
  detailsButton.type = 'button';
  detailsButton.dataset.rowId = device.rowId;
  detailsButton.setAttribute('aria-label', `Details zu ${device.name}`);
  actions.append(detailsButton);
  actionCell.append(actions);

  row.append(selectionCell, nameCell, typeCell, sourceCell, manufacturerCell, viaCell, statusCell, lastSeenCell, actionCell);
  return row;
}

function createStatusBadge(status) {
  const labels = {
    REACHABLE: 'Erreichbar',
    UNREACHABLE: 'Nicht erreichbar',
    DISABLED: 'Deaktiviert',
    UNKNOWN: 'Unbekannt'
  };
  const css = String(status || 'UNKNOWN').toLowerCase();
  return createElement('span', `state-badge state-badge--${css}`, labels[status] || labels.UNKNOWN);
}

function handleTableClick(event) {
  const selection = event.target.closest('[data-select-id]');
  if (selection) {
    if (selection.checked) {
      state.selectedApplianceIds.add(selection.dataset.selectId);
    } else {
      state.selectedApplianceIds.delete(selection.dataset.selectId);
    }
    updateSelectionControls();
    return;
  }
  const protectButton = event.target.closest('[data-protect-id]');
  if (protectButton && state.inventory) {
    const device = state.inventory.devices.find((entry) => entry.applianceId === protectButton.dataset.protectId);
    if (device) toggleDeviceProtection(device);
    return;
  }
  const enableButton = event.target.closest('[data-enable-id]');
  if (enableButton && state.inventory) {
    const device = state.inventory.devices.find((entry) => entry.applianceId === enableButton.dataset.enableId);
    if (device) toggleDeviceEnablement(device);
    return;
  }
  const button = event.target.closest('[data-row-id]');
  if (!button || !state.inventory) return;
  const device = state.inventory.devices.find((entry) => entry.rowId === button.dataset.rowId);
  if (device) showDetails(device);
}

function showDetails(device) {
  state.selectedDevice = device;
  elements.detailsTitle.textContent = device.name;
  elements.detailsContent.replaceChildren();

  const fields = [
    ['Status', statusLabel(device.reachability)],
    ['Einordnung', cleanupStatusLabel(device.cleanupStatus)],
    ['Technische Endpunkte', device.matterGrouped ? String(device.matterEndpointCount) : '1'],
    ['Typ', device.types.map(humanizeType).join(', ')],
    ['Skill / Quelle', device.sourceName],
    ['Quellenart', kindLabel(device.sourceKind)],
    ['Hersteller', device.manufacturer],
    ['Modell', device.model || '–'],
    ['Verbunden über', device.connectedVia || '–'],
    ['Zuletzt gesehen', formatDate(device.lastSeenAt, true)],
    ['Angelegt', formatDate(device.createdAt, true)],
    ['Aliase', device.aliases.length ? device.aliases.join(', ') : '–'],
    ['Beschreibung', device.description || '–', true],
    ['Skill-ID', device.skillId || '–', true, true],
    ['Endpoint-ID', formatTechnicalIds(device.endpointIds, device.endpointId), true, true],
    ['Appliance-ID', formatTechnicalIds(device.applianceIds, device.applianceId), true, true],
    ['Entity-ID', formatTechnicalIds(device.entityIds, device.entityId), true, true],
    ['Treiber', [device.driverNamespace, device.driverIdentifier].filter(Boolean).join(' / ') || '–', true, true]
  ];

  for (const [label, value, wide, code] of fields) {
    const item = document.createElement('dl');
    item.className = `detail-item${wide ? ' detail-item--wide' : ''}`;
    const term = createElement('dt', '', label);
    const description = document.createElement('dd');
    const content = code ? createElement('code', '', value) : document.createTextNode(value);
    description.append(content);
    item.append(term, description);
    elements.detailsContent.append(item);
  }
  elements.detailsDeleteButton.hidden = !state.inventory.deleteEnabled || !device.canDelete;
  elements.detailsDeleteButton.disabled = false;
  elements.detailsEnableButton.hidden = !device.applianceId;
  elements.detailsEnableButton.disabled = Boolean(state.changingDeviceId || !state.inventory.changeEnabled);
  elements.detailsEnableButton.textContent = device.enabled ? 'Deaktivieren' : 'Aktivieren';
  elements.detailsEnableButton.className = `button ${device.enabled ? 'button--secondary button--warning' : 'button--primary'}`;
  const canProtect = device.cleanupStatus === 'POSSIBLE_ORPHAN' || device.cleanupStatus === 'USER_PROTECTED';
  elements.detailsProtectButton.hidden = !canProtect;
  elements.detailsProtectButton.disabled = false;
  elements.detailsProtectButton.textContent = device.userProtected ? 'Kennzeichnung entfernen' : 'Aktiv / behalten';
  elements.detailsDialog.showModal();
}

async function toggleDeviceEnablement(device) {
  if (state.changingDeviceId || !state.inventory?.changeEnabled || !device.applianceId) return;
  const enabled = !device.enabled;
  const action = enabled ? 'aktivieren' : 'deaktivieren';
  const endpointHint = device.matterGrouped
    ? ` Dabei werden alle ${device.matterEndpointCount} Matter-Endpunkte gemeinsam umgeschaltet.`
    : '';
  const confirmed = window.confirm(
    `Soll „${device.name}“ in Alexa wirklich ${action} werden?\n\n`
    + (enabled
      ? 'Das Gerät ist danach wieder per Alexa steuerbar.'
      : 'Das Gerät bleibt in Alexa gespeichert, ist dort aber nicht mehr steuerbar.')
    + endpointHint
  );
  if (!confirmed) return;

  hideError();
  hideSuccess();
  state.changingDeviceId = device.applianceId;
  renderFilteredDevices();
  if (elements.detailsDialog.open) {
    elements.detailsEnableButton.disabled = true;
    elements.detailsEnableButton.textContent = 'Wird geändert …';
  }

  try {
    const result = await requestJson('/api/devices/enablement', {
      method: 'POST',
      body: JSON.stringify({
        applianceId: device.applianceId,
        expectedName: device.name,
        enabled,
        confirmation: 'SET_DEVICE_ENABLEMENT'
      })
    });
    if (elements.detailsDialog.open) elements.detailsDialog.close();
    const inventory = await loadInventory({ preserveNotices: true });
    if (!inventory) return;

    const updated = inventory.devices.find((entry) => entry.applianceId === device.applianceId);
    const reachedState = updated && updated.enabled === enabled;
    if (result.failed.length > 0 || !reachedState) {
      const amazonReasons = [...new Set(
        (result.failed || []).map((entry) => entry.error).filter(Boolean)
      )].slice(0, 2);
      const reasonText = amazonReasons.length
        ? ` Amazon meldet: ${amazonReasons.join(' · ')}`
        : !reachedState && result.changed.length > 0
          ? ' Amazon meldet den Eintrag nach dem Neuladen weiterhin im bisherigen Zustand.'
          : '';
      showError(`„${device.name}“ wurde nicht vollständig ${enabled ? 'aktiviert' : 'deaktiviert'}. ${result.changed.length} von ${result.requestedEndpoints} Endpunkten wurden geändert.${reasonText}`);
    } else {
      showSuccess(`„${device.name}“ wurde in Alexa ${enabled ? 'aktiviert' : 'deaktiviert'}.`);
    }
  } catch (error) {
    showError(error.message);
  } finally {
    state.changingDeviceId = '';
    renderFilteredDevices();
  }
}

async function toggleDeviceProtection(device) {
  hideError();
  const nextState = !device.userProtected;
  try {
    const result = await requestJson('/api/devices/protection', {
      method: 'POST',
      body: JSON.stringify({
        applianceId: device.applianceId,
        expectedName: device.name,
        protected: nextState
      })
    });
    const replacement = result.device;
    const index = state.inventory.devices.findIndex((entry) => entry.applianceId === replacement.applianceId);
    if (index >= 0) state.inventory.devices[index] = replacement;
    state.selectedApplianceIds.delete(replacement.applianceId);
    state.inventory.totals.cleanupCandidates = state.inventory.devices.filter((entry) => entry.canBulkDelete).length;
    for (const source of state.inventory.sources) {
      source.cleanupCandidates = state.inventory.devices.filter((entry) => entry.sourceName === source.name && entry.canBulkDelete).length;
    }
    renderSources(state.inventory.sources);
    renderFilteredDevices();
    elements.selectionBar.hidden = !state.inventory.deleteEnabled || state.inventory.totals.cleanupCandidates === 0;
    if (elements.detailsDialog.open) elements.detailsDialog.close();
    showSuccess(nextState
      ? `„${replacement.name}“ ist als aktiv gekennzeichnet und von der Sammellöschung ausgeschlossen.`
      : `Die Kennzeichnung für „${replacement.name}“ wurde entfernt.`);
  } catch (error) {
    showError(error.message);
  }
}

function updateSelectionControls() {
  if (!state.inventory) return;

  for (const applianceId of [...state.selectedApplianceIds]) {
    const device = state.inventory.devices.find((entry) => entry.applianceId === applianceId);
    if (!device || !device.canBulkDelete) {
      state.selectedApplianceIds.delete(applianceId);
    }
  }

  const count = state.selectedApplianceIds.size;
  elements.selectionCount.textContent = `${formatNumber(count)} ${count === 1 ? 'Eintrag ausgewählt' : 'Einträge ausgewählt'}`;
  elements.clearSelection.disabled = count === 0 || state.deleting;
  elements.deleteSelected.disabled = count === 0 || state.deleting;

  const eligibleVisible = state.filteredDevices.filter((device) => device.canBulkDelete);
  const allVisibleSelected = eligibleVisible.length > 0
    && eligibleVisible.every((device) => state.selectedApplianceIds.has(device.applianceId));
  elements.selectVisible.disabled = eligibleVisible.length === 0 || state.deleting;
  elements.selectVisible.textContent = allVisibleSelected
    ? 'Sichtbare Auswahl entfernen'
    : `Sichtbare Altlasten auswählen${eligibleVisible.length ? ` (${eligibleVisible.length})` : ''}`;
}

function toggleVisibleSelection() {
  const eligibleVisible = state.filteredDevices.filter((device) => device.canBulkDelete);
  if (!eligibleVisible.length) return;
  const allVisibleSelected = eligibleVisible.every((device) => state.selectedApplianceIds.has(device.applianceId));
  for (const device of eligibleVisible) {
    if (allVisibleSelected) {
      state.selectedApplianceIds.delete(device.applianceId);
    } else {
      state.selectedApplianceIds.add(device.applianceId);
    }
  }
  renderFilteredDevices();
}

function clearSelection() {
  state.selectedApplianceIds.clear();
  renderFilteredDevices();
}

function openSelectedDeleteDialog() {
  if (!state.inventory || state.selectedApplianceIds.size === 0) return;
  const devices = state.inventory.devices.filter((device) => state.selectedApplianceIds.has(device.applianceId));
  openDeleteDialog(devices);
}

function openDetailsDeleteDialog() {
  if (!state.selectedDevice || !state.selectedDevice.canDelete || !state.inventory?.deleteEnabled) return;
  if (elements.detailsDialog.open) elements.detailsDialog.close();
  openDeleteDialog([state.selectedDevice]);
}

function openDeleteDialog(devices) {
  const validDevices = devices.filter((device) => device && device.canDelete);
  if (!validDevices.length) return;

  state.deleteSelection = validDevices;
  const count = validDevices.length;
  elements.deleteTitle.textContent = count === 1 ? 'Alexa-Eintrag löschen' : `${count} Alexa-Einträge löschen`;
  elements.deleteSummary.textContent = count === 1
    ? `Soll „${validDevices[0].name}“ wirklich aus Alexa entfernt werden?`
    : `Sollen diese ${count} ausgewählten Alexa-Einträge wirklich entfernt werden?`;
  elements.deleteList.replaceChildren();

  const displayed = validDevices.slice(0, 20);
  for (const device of displayed) {
    const item = createElement('div', 'delete-list__item');
    item.append(
      createElement('strong', '', device.name),
      createElement('span', '', `${device.sourceName} · ${device.types.map(humanizeType).join(', ')}`)
    );
    elements.deleteList.append(item);
  }
  if (validDevices.length > displayed.length) {
    elements.deleteList.append(createElement('div', 'delete-list__more', `+ ${validDevices.length - displayed.length} weitere Einträge`));
  }

  elements.deleteConfirmCheckbox.checked = false;
  elements.deleteConfirmButton.disabled = true;
  elements.deleteConfirmButton.textContent = count === 1 ? 'Eintrag löschen' : `${count} Einträge löschen`;
  elements.deleteDialog.showModal();
}

async function deleteConfirmedEntries() {
  if (state.deleting || !elements.deleteConfirmCheckbox.checked || !state.deleteSelection.length) return;

  hideError();
  hideSuccess();
  state.deleting = true;
  updateSelectionControls();
  setActionBusy(elements.deleteConfirmButton, true, 'Wird gelöscht …');
  const requested = state.deleteSelection.map((device) => ({
    applianceId: device.applianceId,
    expectedName: device.name
  }));

  try {
    const result = await requestJson('/api/devices/delete', {
      method: 'POST',
      body: JSON.stringify({
        confirmation: 'DELETE_SELECTED',
        devices: requested
      })
    });

    if (elements.deleteDialog.open) elements.deleteDialog.close();
    state.deleteSelection = [];
    for (const device of result.deleted) {
      state.selectedApplianceIds.delete(device.applianceId);
    }

    await loadInventory({ preserveNotices: true });
    const deletedCount = result.deleted.length;
    const failedCount = result.failed.length;
    if (deletedCount > 0) {
      showSuccess(`${deletedCount} ${deletedCount === 1 ? 'Eintrag wurde' : 'Einträge wurden'} aus Alexa entfernt.${failedCount ? ` ${failedCount} konnten nicht gelöscht werden.` : ''}`);
    }
    if (failedCount > 0) {
      const examples = result.failed.slice(0, 3).map((entry) => `„${entry.name}“`).join(', ');
      showError(`${failedCount} ${failedCount === 1 ? 'Eintrag konnte' : 'Einträge konnten'} nicht gelöscht werden${examples ? `: ${examples}` : ''}. Bitte Details prüfen und erneut versuchen.`);
    }
  } catch (error) {
    showError(error.message);
  } finally {
    state.deleting = false;
    setActionBusy(elements.deleteConfirmButton, false, 'Jetzt löschen');
    elements.deleteConfirmButton.disabled = !elements.deleteConfirmCheckbox.checked;
    updateSelectionControls();
  }
}

function resetFilters() {
  elements.filters.reset();
  elements.statusFilter.value = 'ACTIVE';
  showView('devices');
  renderFilteredDevices();
  elements.searchInput.focus();
}

function exportCsv() {
  if (!state.filteredDevices.length) return;
  const headers = [
    'Gerät', 'Typ', 'Skill / Quelle', 'Quellenart', 'Skill-ID', 'Hersteller', 'Modell',
    'Verbunden über', 'Status', 'Zuletzt gesehen', 'Beschreibung', 'Aliase',
    'Endpoint-ID', 'Appliance-ID', 'Entity-ID'
  ];
  const rows = state.filteredDevices.map((device) => [
    device.name,
    device.types.join(', '),
    device.sourceName,
    kindLabel(device.sourceKind),
    device.skillId,
    device.manufacturer,
    device.model,
    device.connectedVia,
    statusLabel(device.reachability),
    device.lastSeenAt || '',
    device.description,
    device.aliases.join(', '),
    formatTechnicalIds(device.endpointIds, device.endpointId, ' | '),
    formatTechnicalIds(device.applianceIds, device.applianceId, ' | '),
    formatTechnicalIds(device.entityIds, device.entityId, ' | ')
  ]);
  const csv = '\ufeff' + [headers, ...rows]
    .map((row) => row.map(csvCell).join(';'))
    .join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `alexa-geraete-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

async function forgetAuthentication() {
  const confirmed = window.confirm('Die lokal gespeicherte Amazon-Anmeldung wirklich entfernen? Alexa selbst wird nicht verändert.');
  if (!confirmed) return;
  hideError();
  setActionBusy(elements.forgetButton, true, 'Wird entfernt …');
  try {
    const status = await requestJson('/api/auth/forget', { method: 'POST', body: '{}' });
    state.status = status;
    state.inventory = null;
    state.filteredDevices = [];
    state.filteredSkills = [];
    state.selectedDevice = null;
    state.deleteSelection = [];
    state.selectedApplianceIds.clear();
    renderStatus(status);
    elements.settingsDialog.close();
    elements.summarySection.hidden = true;
    elements.sourceSection.hidden = true;
    elements.skillsSection.hidden = true;
    elements.inventorySection.hidden = true;
    elements.selectionBar.hidden = true;
    elements.welcome.hidden = false;
    elements.exportButton.disabled = true;
  } catch (error) {
    showError(error.message);
  } finally {
    setActionBusy(elements.forgetButton, false, 'Entfernen');
    if (state.status) renderStatus(state.status);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Eine nicht-JSON-Antwort wird unten als allgemeiner Fehler behandelt.
  }
  if (!response.ok) {
    throw new Error(payload && payload.error ? payload.error : `HTTP-Fehler ${response.status}`);
  }
  return payload;
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function showError(message) {
  elements.errorMessage.textContent = message || 'Unbekannter Fehler.';
  elements.errorNotice.hidden = false;
  elements.errorNotice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showSuccess(message) {
  elements.successMessage.textContent = message || 'Die ausgewählten Einträge wurden verarbeitet.';
  elements.successNotice.hidden = false;
  elements.successNotice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideError() {
  elements.errorNotice.hidden = true;
  elements.errorMessage.textContent = '';
}

function hideSuccess() {
  elements.successNotice.hidden = true;
  elements.successMessage.textContent = '';
}

function setActionBusy(button, busy, busyLabel) {
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
    delete button.dataset.originalLabel;
  }
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function normalizeSearch(value) {
  return String(value || '').trim().toLocaleLowerCase('de-DE');
}

function formatNumber(value) {
  return new Intl.NumberFormat('de-DE').format(Number(value) || 0);
}

function formatDate(value, includeTime) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('de-DE', includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }
  ).format(date);
}

function humanizeType(type) {
  const labels = {
    LIGHT: 'Licht',
    SMARTPLUG: 'Steckdose',
    SMART_PLUG: 'Steckdose',
    SWITCH: 'Schalter',
    MOTION_SENSOR: 'Bewegungsmelder',
    CONTACT_SENSOR: 'Kontaktsensor',
    TEMPERATURE_SENSOR: 'Temperatursensor',
    THERMOSTAT: 'Thermostat',
    CAMERA: 'Kamera',
    DOOR: 'Tür',
    LOCK: 'Schloss',
    SCENE_TRIGGER: 'Szene',
    SMART_HOME: 'Smart Home',
    CUSTOM: 'Benutzerdefiniert',
    OTHER: 'Sonstiges',
    UNBEKANNT: 'Unbekannt'
  };
  return labels[type] || String(type || 'Unbekannt').replaceAll('_', ' ').toLocaleLowerCase('de-DE').replace(/^./, (letter) => letter.toUpperCase());
}

function kindLabel(kind) {
  return ({ skill: 'Alexa-Skill', matter: 'Matter', direct: 'Direkt verbunden', bridge: 'Bridge', other: 'Andere Quelle' })[kind] || 'Andere Quelle';
}

function statusLabel(status) {
  return ({ REACHABLE: 'Erreichbar', UNREACHABLE: 'Nicht erreichbar', DISABLED: 'Deaktiviert', UNKNOWN: 'Unbekannt' })[status] || 'Unbekannt';
}

function cleanupStatusLabel(status) {
  return ({
    POSSIBLE_ORPHAN: 'Prüfen – Skillname von Amazon nicht geliefert',
    USER_PROTECTED: 'Manuell als aktiv / behalten gekennzeichnet',
    VIRTUAL_PROVIDER: 'Virtueller Mediendienst – nicht für Sammellöschung',
    MATTER_GROUP: 'Ein Matter-Gerät mit mehreren technischen Endpunkten',
    REVIEW: 'Normaler Alexa-Eintrag – vor dem Löschen prüfen'
  })[status] || 'Vor dem Löschen prüfen';
}

function formatTechnicalIds(values, fallback, separator = '\n') {
  const ids = Array.isArray(values) && values.length ? values : [fallback].filter(Boolean);
  return ids.length ? ids.join(separator) : '–';
}

function resultCountLabel(visible, total) {
  const noun = visible === 1 ? 'Eintrag' : 'Einträge';
  return visible === total ? `${formatNumber(visible)} ${noun}` : `${formatNumber(visible)} von ${formatNumber(total)}`;
}
