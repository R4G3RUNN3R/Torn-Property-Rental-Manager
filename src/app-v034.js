(function (root, factory) {
  const baseApp = typeof module === 'object' && module.exports ? require('./app-v033') : root.R4G3PropertyRentalApp;
  const updateCore = typeof module === 'object' && module.exports ? require('./update-core-v034') : root.R4G3UpdateCoreV034;
  const api = factory(baseApp, updateCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (baseApp, updateCore) {
  'use strict';

  if (!baseApp || !updateCore) throw new Error('v0.3.4 app dependencies are unavailable');

  function createController(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const storage = config.storage || windowLike && windowLike.localStorage;
    const prepareCancelProperty = typeof config.prepareCancelProperty === 'function'
      ? config.prepareCancelProperty
      : () => ({ prepared: false, reason: 'Cancellation preparation unavailable' });
    const canCancelProperty = typeof config.canCancelProperty === 'function'
      ? config.canCancelProperty
      : () => false;
    const cancelProperty = typeof config.cancelProperty === 'function'
      ? config.cancelProperty
      : () => ({ submitted: false, reason: 'Cancellation unavailable' });

    if (!windowLike || !documentLike) throw new TypeError('window and document are required');

    const baseController = baseApp.createController(config);
    let updateSettings = updateCore.loadSettings(storage);
    const savedSnapshot = updateCore.loadSnapshot(storage);
    let updatedAt = savedSnapshot && Number(savedSnapshot.updatedAt) || 0;
    const propertyUpdatedAt = Object.assign({}, savedSnapshot && savedSnapshot.propertyUpdatedAt || {});
    const updatingProperties = new Set();
    const cancellationSent = new Set();
    let updatingAll = false;
    let pendingCancelId = null;
    let destroyed = false;

    if (savedSnapshot && typeof baseController.hydrate === 'function') {
      baseController.hydrate({
        properties: savedSnapshot.properties,
        markets: savedSnapshot.markets
      });
      baseController.render();
    }

    function now() {
      return Date.now();
    }

    function saveCurrentSnapshot() {
      const state = baseController.getState();
      return updateCore.saveSnapshot(storage, {
        properties: state.properties || [],
        markets: state.markets || {},
        updatedAt,
        propertyUpdatedAt
      });
    }

    function formattedUpdatedAt(propertyId) {
      const value = Number(propertyUpdatedAt[String(propertyId)] || propertyUpdatedAt[propertyId] || 0);
      if (!value) return 'Never';
      try {
        return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch (error) {
        return new Date(value).toLocaleTimeString();
      }
    }

    function makeButton(text, action) {
      const button = documentLike.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.dataset.action = action;
      button.dataset.noDrag = 'true';
      button.style.cursor = 'pointer';
      button.style.padding = '7px 10px';
      button.style.borderRadius = '7px';
      button.style.border = '1px solid currentColor';
      button.style.background = 'transparent';
      button.style.color = 'inherit';
      return button;
    }

    function renderController() {
      const result = baseController.render();
      enhanceMainPanel();
      enhanceSettingsWindow();
      return result;
    }

    async function updateProperty(propertyId) {
      const id = Number(propertyId);
      if (!Number.isInteger(id) || id <= 0 || updatingProperties.has(id)) return false;
      if (typeof baseController.updateProperty !== 'function') throw new Error('Per-property update support is unavailable');
      updatingProperties.add(id);
      enhanceMainPanel();
      try {
        const result = await baseController.updateProperty(id, { force: true });
        const stamp = now();
        propertyUpdatedAt[String(id)] = stamp;
        updatedAt = Math.max(updatedAt, stamp);
        cancellationSent.delete(id);
        if (pendingCancelId === id) pendingCancelId = null;
        saveCurrentSnapshot();
        return result;
      } finally {
        updatingProperties.delete(id);
        renderController();
      }
    }

    async function updateAll() {
      if (updatingAll) return baseController.getState();
      updatingAll = true;
      enhanceMainPanel();
      try {
        const state = await baseController.load({ force: true });
        if (!state.needsApiKey && !state.error) {
          const stamp = now();
          updatedAt = stamp;
          for (const property of state.properties || []) propertyUpdatedAt[String(property.id)] = stamp;
          cancellationSent.clear();
          if (pendingCancelId != null) {
            const pending = (state.properties || []).find(property => Number(property.id) === Number(pendingCancelId));
            if (!pending || String(pending.status || '').toLowerCase() !== 'for_rent') pendingCancelId = null;
          }
          saveCurrentSnapshot();
        }
        return state;
      } finally {
        updatingAll = false;
        renderController();
      }
    }

    function setAutoPageUpdate(value) {
      updateSettings = updateCore.saveSettings(storage, { autoPageUpdate: value === true });
      enhanceSettingsWindow();
      return updateSettings.autoPageUpdate;
    }

    function cancelClick(propertyId) {
      const id = Number(propertyId);
      if (!Number.isInteger(id) || id <= 0) return false;
      if (pendingCancelId !== id) {
        pendingCancelId = id;
        cancellationSent.delete(id);
        prepareCancelProperty(id);
        renderController();
        return true;
      }

      if (!canCancelProperty(id)) {
        enhanceMainPanel();
        return false;
      }

      const result = cancelProperty(id);
      if (result && result.submitted) {
        pendingCancelId = null;
        cancellationSent.add(id);
        renderController();
        return true;
      }
      enhanceMainPanel();
      return false;
    }

    function ensureCardControls(row, entry) {
      const property = entry && entry.property || {};
      const id = Number(property.id);
      if (!id) return;
      let controls = row.querySelector('[data-role="v034-card-controls"]');
      if (!controls) {
        controls = documentLike.createElement('div');
        controls.dataset.role = 'v034-card-controls';
        controls.style.gridColumn = '1 / -1';
        controls.style.display = 'flex';
        controls.style.flexWrap = 'wrap';
        controls.style.alignItems = 'center';
        controls.style.gap = '8px';
        controls.style.marginTop = '4px';
        row.appendChild(controls);
      }

      let updated = controls.querySelector('[data-role="v034-last-updated"]');
      if (!updated) {
        updated = documentLike.createElement('small');
        updated.dataset.role = 'v034-last-updated';
        updated.style.opacity = '0.72';
        updated.style.marginRight = 'auto';
        controls.appendChild(updated);
      }
      const updatedText = `Last updated: ${formattedUpdatedAt(id)}`;
      if (updated.textContent !== updatedText) updated.textContent = updatedText;

      let updateButton = controls.querySelector('[data-action="v034-update-property"]');
      if (!updateButton) {
        updateButton = makeButton('↻ UPDATE', 'v034-update-property');
        updateButton.dataset.propertyId = String(id);
        updateButton.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          updateProperty(id).catch(() => {});
        });
        controls.appendChild(updateButton);
      }
      const isUpdating = updatingProperties.has(id);
      const updateText = isUpdating ? 'UPDATING…' : '↻ UPDATE';
      if (updateButton.textContent !== updateText) updateButton.textContent = updateText;
      updateButton.disabled = isUpdating;

      const status = String(property.status || '').toLowerCase();
      let cancelButton = controls.querySelector('[data-action="v034-cancel-listing"]');
      let note = row.querySelector('[data-role="v034-cancel-note"]');

      if (status === 'for_rent' && !cancellationSent.has(id)) {
        if (!cancelButton) {
          cancelButton = makeButton('CANCEL LISTING', 'v034-cancel-listing');
          cancelButton.dataset.propertyId = String(id);
          cancelButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            cancelClick(id);
          });
          controls.appendChild(cancelButton);
        }
        const pending = pendingCancelId === id;
        const ready = pending && canCancelProperty(id);
        const label = pending ? (ready ? 'CONFIRM CANCEL LISTING' : 'WAITING FOR TORN…') : 'CANCEL LISTING';
        if (cancelButton.textContent !== label) cancelButton.textContent = label;
        cancelButton.disabled = pending && !ready;
        if (note && note.parentNode) note.remove();
      } else {
        if (cancelButton && cancelButton.parentNode) cancelButton.remove();
        if (cancellationSent.has(id)) {
          if (!note) {
            note = documentLike.createElement('div');
            note.dataset.role = 'v034-cancel-note';
            note.style.gridColumn = '1 / -1';
            note.style.fontWeight = '700';
            note.style.padding = '8px 10px';
            note.style.border = '1px solid currentColor';
            note.style.borderRadius = '8px';
            row.appendChild(note);
          }
          const text = 'CANCELLATION SENT • Press UPDATE PROPERTY to verify Torn removed the listing.';
          if (note.textContent !== text) note.textContent = text;
        } else if (status === 'rented') {
          if (!note) {
            note = documentLike.createElement('div');
            note.dataset.role = 'v034-cancel-note';
            note.style.gridColumn = '1 / -1';
            note.style.opacity = '0.78';
            note.style.paddingTop = '4px';
            row.appendChild(note);
          }
          const text = 'Active lease cannot be cancelled.';
          if (note.textContent !== text) note.textContent = text;
        } else if (note && note.parentNode) {
          note.remove();
        }
      }
    }

    function enhanceHeader(panel) {
      const header = panel && panel.querySelector('.r4g3-prm-header');
      if (!header) return;
      let updateAllButton = header.querySelector('[data-action="v034-update-all"]');
      if (!updateAllButton) {
        const legacy = header.querySelector('[data-action="refresh"]');
        if (legacy) {
          legacy.dataset.action = 'v034-update-all';
          legacy.dataset.noDrag = 'true';
          updateAllButton = legacy;
        }
      }
      if (!updateAllButton) return;
      const label = updatingAll ? 'UPDATING…' : 'UPDATE ALL';
      if (updateAllButton.textContent !== label) updateAllButton.textContent = label;
      updateAllButton.disabled = updatingAll;
      updateAllButton.title = 'Manually refresh all owned properties and their rental markets';
      if (updateAllButton.dataset.v034Bound !== '1') {
        updateAllButton.dataset.v034Bound = '1';
        updateAllButton.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          updateAll().catch(() => {});
        });
      }
    }

    function enhanceEmptyState(panel) {
      const state = baseController.getState();
      if ((state.rows || []).length || savedSnapshot) return;
      let note = panel.querySelector('[data-role="v034-empty-note"]');
      if (!note) {
        note = documentLike.createElement('div');
        note.dataset.role = 'v034-empty-note';
        note.style.padding = '18px';
        note.style.textAlign = 'center';
        note.style.opacity = '0.8';
        note.textContent = 'No saved property data. Press UPDATE ALL to load your properties.';
        const handle = panel.querySelector('[data-role="resize-handle"]');
        if (handle) panel.insertBefore(note, handle);
        else panel.appendChild(note);
      }
    }

    function enhanceMainPanel() {
      if (destroyed) return null;
      const panel = documentLike.getElementById('r4g3-prm-panel');
      if (!panel) return null;
      enhanceHeader(panel);
      const entries = new Map((baseController.getState().rows || []).map(entry => [Number(entry.property && entry.property.id), entry]));
      for (const row of panel.querySelectorAll('[data-property-id]')) {
        const entry = entries.get(Number(row.getAttribute('data-property-id')));
        if (entry) ensureCardControls(row, entry);
      }
      enhanceEmptyState(panel);
      return panel;
    }

    function settingsSection(title) {
      const section = documentLike.createElement('section');
      section.dataset.role = 'v034-update-settings';
      section.style.padding = '12px';
      section.style.margin = '0 10px 10px';
      section.style.border = '1px solid rgba(128,128,128,0.35)';
      section.style.borderRadius = '9px';
      section.style.display = 'grid';
      section.style.gap = '10px';
      const heading = documentLike.createElement('strong');
      heading.textContent = title;
      section.appendChild(heading);
      return section;
    }

    function enhanceSettingsWindow() {
      const node = documentLike.getElementById('r4g3-prm-settings-window');
      if (!node) return null;
      const apiSection = node.querySelector('[data-role="api-settings"]');
      let updates = node.querySelector('[data-role="v034-update-settings"]');
      if (!updates) {
        updates = settingsSection('UPDATES');
        const label = documentLike.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '8px';
        const checkbox = documentLike.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.role = 'auto-page-update-input';
        checkbox.checked = updateSettings.autoPageUpdate;
        checkbox.addEventListener('change', () => setAutoPageUpdate(checkbox.checked));
        const text = documentLike.createElement('span');
        text.textContent = 'Automatic page update';
        label.append(checkbox, text);
        const help = documentLike.createElement('small');
        help.style.opacity = '0.72';
        help.textContent = 'Off by default. When enabled, update all properties once when the Torn Properties page loads. No background polling.';
        updates.append(label, help);
        if (apiSection && apiSection.parentNode) apiSection.parentNode.insertBefore(updates, apiSection);
        else node.appendChild(updates);
      } else {
        const checkbox = updates.querySelector('[data-role="auto-page-update-input"]');
        if (checkbox) checkbox.checked = updateSettings.autoPageUpdate;
      }

      if (apiSection) {
        let safety = apiSection.querySelector('[data-role="v034-api-safety"]');
        if (!safety) {
          safety = documentLike.createElement('div');
          safety.dataset.role = 'v034-api-safety';
          safety.style.paddingTop = '8px';
          safety.style.borderTop = '1px solid rgba(128,128,128,0.25)';
          safety.innerHTML = '<strong>API Safety</strong><br><small>Request limit: 80 / minute • Minimum spacing: 750 ms • Rate-limit cooldown: 60 seconds</small>';
          apiSection.appendChild(safety);
        }
        const force = apiSection.querySelector('[data-action="v033-force-refresh"]');
        if (force) {
          force.dataset.action = 'v034-update-all-now';
          force.textContent = 'UPDATE ALL NOW';
          if (force.dataset.v034Bound !== '1') {
            force.dataset.v034Bound = '1';
            force.addEventListener('click', event => {
              event.preventDefault();
              event.stopPropagation();
              updateAll().catch(() => {});
            });
          }
        }
      }
      return node;
    }

    const controller = Object.assign({}, baseController, {
      load: updateAll,
      updateAll,
      updateProperty,
      render: renderController,
      open() {
        const result = baseController.open();
        enhanceMainPanel();
        return result;
      },
      openSettings() {
        const result = baseController.openSettings();
        enhanceSettingsWindow();
        return result;
      },
      getUpdateSettings: () => Object.assign({}, updateSettings),
      setAutoPageUpdate,
      destroy() {
        destroyed = true;
        return baseController.destroy();
      }
    });

    enhanceMainPanel();
    enhanceSettingsWindow();
    return Object.freeze(controller);
  }

  return Object.freeze(Object.assign({}, baseApp, {
    UPDATE_SETTINGS_KEY: updateCore.SETTINGS_KEY,
    SNAPSHOT_KEY: updateCore.SNAPSHOT_KEY,
    loadUpdateSettings: updateCore.loadSettings,
    saveUpdateSettings: updateCore.saveSettings,
    loadSnapshot: updateCore.loadSnapshot,
    saveSnapshot: updateCore.saveSnapshot,
    createController
  }));
}));
