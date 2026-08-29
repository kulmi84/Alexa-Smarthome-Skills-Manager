'use strict';

(() => {
  const originalShowDetails = window.showDetails;
  if (typeof originalShowDetails !== 'function') return;

  window.showDetails = function showDetailsWithCapabilities(device) {
    originalShowDetails(device);
    appendCapabilityDetails(device);
  };

  function appendCapabilityDetails(device) {
    const container = document.getElementById('details-content');
    if (!container || !device) return;

    const capabilities = Array.isArray(device.capabilities) ? device.capabilities : [];
    const source = device.capabilitySource || 'none';
    const contactSensor = Boolean(device.isContactSensor);

    appendField(container, 'Alexa-Funktionen', capabilities.length ? capabilities.join(', ') : 'Keine Funktion separat erkennbar', true, true);
    appendField(container, 'Capability-Erkennung', capabilitySourceLabel(source), true, false);
    appendField(
      container,
      'Kontaktstatus',
      contactSensor
        ? 'Ja – Alexa erkennt diesen Eintrag als Kontakt-/Tür-/Fenstersensor.'
        : 'Nein – in den von Amazon gelieferten Daten ist kein Kontakt-Sensor erkennbar.',
      true,
      false
    );
  }

  function appendField(container, label, value, wide, code) {
    const item = document.createElement('dl');
    item.className = `detail-item${wide ? ' detail-item--wide' : ''}`;

    const term = document.createElement('dt');
    term.textContent = label;

    const description = document.createElement('dd');
    if (code) {
      const codeElement = document.createElement('code');
      codeElement.textContent = value;
      description.append(codeElement);
    } else {
      description.textContent = value;
    }

    item.append(term, description);
    container.append(item);
  }

  function capabilitySourceLabel(source) {
    if (source === 'amazon') return 'Direkt aus den von Amazon gelieferten Endpoint-Daten';
    if (source === 'type-inference') return 'Aus dem von Amazon gelieferten Gerätetyp abgeleitet';
    return 'Amazon liefert für diesen Eintrag keine auswertbare Capability-Angabe';
  }
})();
