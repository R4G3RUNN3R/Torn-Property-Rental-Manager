(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SETTINGS_KEY = 'r4g3_property_rental_manager.settings';
  const TARGET_DAYS = 100;
  const MOBILE_BREAKPOINT = 700;
  const DEFAULT_SETTINGS = Object.freeze({
    apiKey: '',
    theme: 'dark',
    undercutPercent: 0.5,
    days: TARGET_DAYS,
    uiState: 'open',
    geometry: Object.freeze({ left: 32, top: 90, width: 920, height: 560 })
  });

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function integer(value, min, max, fallback) {
    return Math.round(clamp(value, min, max, fallback));
  }

  function normalizeGeometry(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      left: integer(source.left, 0, 10000, DEFAULT_SETTINGS.geometry.left),
      top: integer(source.top, 0, 10000, DEFAULT_SETTINGS.geometry.top),
      width: integer(source.width, 360, 3000, DEFAULT_SETTINGS.geometry.width),
      height: integer(source.height, 260, 2400, DEFAULT_SETTINGS.geometry.height)
    };
  }

  function normalizeUiState(value) {
    return value === 'closed' || value === 'minimized' ? value : 'open';
  }

  function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : DEFAULT_SETTINGS.apiKey,
      theme: source.theme === 'light' ? 'light' : 'dark',
      undercutPercent: clamp(source.undercutPercent, 0, 25, DEFAULT_SETTINGS.undercutPercent),
      days: TARGET_DAYS,
      uiState: normalizeUiState(source.uiState),
      geometry: normalizeGeometry(source.geometry)
    };
  }

  function loadSettings(storage) {
    if (!storage || typeof storage.getItem !== 'function') return normalizeSettings({});
    try {
      const raw = storage.getItem(SETTINGS_KEY);
      return normalizeSettings(raw ? JSON.parse(raw) : {});
    } catch (error) {
      return normalizeSettings({});
    }
  }

  function saveSettings(storage, next) {
    const current = loadSettings(storage);
    const source = next && typeof next === 'object' ? next : {};
    const normalized = normalizeSettings(Object.assign({}, current, source, {
      geometry: source.geometry ? source.geometry : current.geometry
    }));
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    }
    return normalized;
  }

  function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    return Math.floor(number).toLocaleString('en-US');
  }

  function labelStatus(status) {
    const text = String(status || 'unknown').replace(/_/g, ' ').trim();
    return text ? text.replace(/\b\w/g, char => char.toUpperCase()) : 'Unknown';
  }

  function el(documentLike, tag, options) {
    const node = documentLike.createElement(tag);
    const config = options || {};
    if (config.className) node.className = config.className;
    if (config.text != null) node.textContent = String(config.text);
    if (config.attrs) {
      for (const [name, value] of Object.entries(config.attrs)) {
        node.setAttribute(name, String(value));
      }
    }
    return node;
  }

  function createController(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const storage = config.storage || windowLike && windowLike.localStorage;
    const fixedApiClient = config.apiClient || null;
    const apiClientFactory = typeof config.apiClientFactory === 'function' ? config.apiClientFactory : null;
    const propertyCore = config.propertyCore;
    const marketCore = config.marketCore;
    const draftStore = config.draftStore;
    const navigate = typeof config.navigate === 'function'
      ? config.navigate
      : url => { if (windowLike && windowLike.location) windowLike.location.href = url; };
    const canListProperty = typeof config.canListProperty === 'function'
      ? config.canListProperty
      : () => false;
    const listProperty = typeof config.listProperty === 'function'
      ? config.listProperty
      : () => ({ submitted: false, reason: 'Listing action unavailable' });

    if (!windowLike || !documentLike) throw new TypeError('window and document are required');
    if (!fixedApiClient && !apiClientFactory) throw new TypeError('apiClient or apiClientFactory is required');
    if (fixedApiClient && (typeof fixedApiClient.fetchOwnedProperties !== 'function' || typeof fixedApiClient.scanMarkets !== 'function')) {
      throw new TypeError('apiClient is invalid');
    }
    if (!propertyCore || !marketCore || !draftStore) throw new TypeError('Core dependencies are required');

    let settings = loadSettings(storage);
    let state = {
      properties: [],
      markets: {},
      rows: [],
      loading: false,
      error: null,
      needsApiKey: false,
      actionMessage: '',
      scanProgress: null
    };
    let panel = null;
    let dragCleanup = null;
    let resizeCleanup = null;
    let resizeObserver = null;
    let settingsOpen = false;
    let cachedApiClient = null;
    let cachedApiKey = '';
    let activeLoadPromise = null;

    function isMobile() {
      return Number(windowLike.innerWidth) <= MOBILE_BREAKPOINT;
    }

    function persistSettings(patch) {
      settings = saveSettings(storage, Object.assign({}, settings, patch || {}));
      return settings;
    }

    function getApiClient() {
      if (apiClientFactory) {
        if (!settings.apiKey) return null;
        if (cachedApiClient && cachedApiKey === settings.apiKey) return cachedApiClient;
        const client = apiClientFactory(settings.apiKey);
        if (!client || typeof client.fetchOwnedProperties !== 'function' || typeof client.scanMarkets !== 'function') {
          throw new TypeError('apiClientFactory returned an invalid client');
        }
        cachedApiClient = client;
        cachedApiKey = settings.apiKey;
        return client;
      }
      return fixedApiClient;
    }

    function computeRows(properties, markets) {
      return properties.map(property => {
        const market = markets && markets[property.propertyTypeId];
        const quote = marketCore.rentalQuote(
          property,
          market && Array.isArray(market.rentals) ? market.rentals : [],
          {
            targetDays: TARGET_DAYS,
            undercutPercent: settings.undercutPercent
          }
        );
        return { property, market: market || null, quote };
      }).sort((a, b) => {
        const aEligible = propertyCore.isEligibleForLease(a.property) ? 1 : 0;
        const bEligible = propertyCore.isEligibleForLease(b.property) ? 1 : 0;
        if (aEligible !== bEligible) return bEligible - aEligible;
        return String(a.property.name || '').localeCompare(String(b.property.name || '')) || Number(a.property.id) - Number(b.property.id);
      });
    }

    function applyPanelGeometry(node) {
      node.style.position = 'fixed';
      node.style.overflow = settings.uiState === 'minimized' ? 'hidden' : 'auto';
      node.style.zIndex = '99999';
      node.style.maxWidth = 'calc(100vw - 16px)';
      node.style.maxHeight = 'calc(100vh - 16px)';

      if (isMobile()) {
        node.style.left = '8px';
        node.style.top = '8px';
        node.style.width = 'calc(100vw - 16px)';
        node.style.height = settings.uiState === 'minimized' ? 'auto' : 'calc(100vh - 16px)';
        node.style.resize = 'none';
        return;
      }

      const geometry = settings.geometry;
      node.style.left = `${geometry.left}px`;
      node.style.top = `${geometry.top}px`;
      node.style.width = `${geometry.width}px`;
      node.style.height = settings.uiState === 'minimized' ? 'auto' : `${geometry.height}px`;
      node.style.resize = settings.uiState === 'minimized' ? 'none' : 'both';
    }

    function addStyles(node) {
      node.style.boxSizing = 'border-box';
      node.style.border = '1px solid rgba(90, 255, 120, 0.35)';
      node.style.borderRadius = '10px';
      node.style.boxShadow = '0 12px 34px rgba(0, 0, 0, 0.35)';
      node.style.fontFamily = 'Arial, sans-serif';
      node.style.fontSize = '13px';
      node.style.padding = '0';
      node.style.background = settings.theme === 'light' ? '#f5f5f2' : '#111512';
      node.style.color = settings.theme === 'light' ? '#171917' : '#ecf4ed';
    }

    function createButton(text, action, title) {
      const button = el(documentLike, 'button', { text, attrs: { type: 'button', 'data-action': action } });
      button.style.cursor = 'pointer';
      button.style.padding = '7px 10px';
      button.style.borderRadius = '6px';
      button.style.border = '1px solid currentColor';
      button.style.background = 'transparent';
      button.style.color = 'inherit';
      if (title) button.title = title;
      return button;
    }

    function renderHeader(container) {
      const header = el(documentLike, 'div', { className: 'r4g3-prm-header' });
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.flexWrap = 'wrap';
      header.style.gap = '8px';
      header.style.padding = '9px 10px';
      header.style.borderBottom = settings.uiState === 'minimized' ? '0' : '1px solid rgba(128,128,128,0.35)';
      header.style.position = 'sticky';
      header.style.top = '0';
      header.style.background = settings.theme === 'light' ? '#f5f5f2' : '#111512';
      header.style.zIndex = '2';

      const dragHandle = el(documentLike, 'strong', {
        text: 'Property Rental Manager',
        attrs: { 'data-role': 'drag-handle' }
      });
      dragHandle.style.cursor = isMobile() ? 'default' : 'move';
      dragHandle.style.userSelect = 'none';
      dragHandle.style.marginRight = 'auto';
      dragHandle.style.color = settings.theme === 'light' ? '#102513' : '#74ff8b';
      header.appendChild(dragHandle);

      if (settings.uiState !== 'minimized') {
        const refreshButton = createButton(state.loading ? 'Scanning…' : 'Refresh', 'refresh', 'Refresh properties and use fresh cached market data when available');
        refreshButton.disabled = Boolean(state.loading);
        const settingsButton = createButton(settingsOpen ? 'Close Settings' : 'Settings', 'toggle-settings');
        const themeButton = createButton(settings.theme === 'dark' ? 'Light' : 'Dark', 'toggle-theme');
        header.append(refreshButton, settingsButton, themeButton);
      }

      header.appendChild(createButton(settings.uiState === 'minimized' ? '□' : '—', 'minimize', settings.uiState === 'minimized' ? 'Restore' : 'Minimize'));
      header.appendChild(createButton('×', 'close', 'Close'));
      container.appendChild(header);
    }

    function renderSettings(container) {
      if (!settingsOpen || settings.uiState === 'minimized') return;
      const box = el(documentLike, 'section', { className: 'r4g3-prm-settings' });
      box.style.padding = '10px';
      box.style.margin = '8px';
      box.style.border = '1px solid rgba(128,128,128,0.35)';
      box.style.borderRadius = '8px';
      box.style.display = 'grid';
      box.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
      box.style.gap = '10px';

      const keyWrap = el(documentLike, 'label', { text: settings.apiKey ? 'Torn API key (saved): ' : 'Torn API key: ' });
      const keyInput = el(documentLike, 'input', {
        attrs: {
          type: 'password',
          'data-role': 'api-key-input',
          autocomplete: 'off',
          placeholder: settings.apiKey ? 'Enter replacement key' : 'Limited-or-higher API key'
        }
      });
      keyInput.value = '';
      keyWrap.appendChild(keyInput);
      box.appendChild(keyWrap);

      const period = el(documentLike, 'div', { text: `Rental period: ${TARGET_DAYS} days` });
      box.appendChild(period);

      const undercutWrap = el(documentLike, 'label', { text: 'Average undercut %: ' });
      const undercutInput = el(documentLike, 'input', {
        attrs: { type: 'number', min: '0', max: '25', step: '0.1', 'data-role': 'undercut-input' }
      });
      undercutInput.value = String(settings.undercutPercent);
      undercutWrap.appendChild(undercutInput);
      box.appendChild(undercutWrap);

      const actions = el(documentLike, 'div');
      actions.style.gridColumn = '1 / -1';
      actions.style.display = 'flex';
      actions.style.flexWrap = 'wrap';
      actions.style.gap = '8px';
      actions.appendChild(createButton('Save Settings', 'save-settings'));
      actions.appendChild(createButton('Force Market Refresh', 'force-refresh', 'Bypass cached Torn rental-market data for all property types'));
      if (settings.apiKey) actions.appendChild(createButton('Clear API Key', 'clear-api-key'));
      box.appendChild(actions);

      const note = el(documentLike, 'small', {
        text: 'Market rentals are normalized to a 100-day total before averaging. Normal Refresh reuses fresh Torn market cache; Force Market Refresh bypasses it.'
      });
      note.style.gridColumn = '1 / -1';
      note.style.opacity = '0.72';
      box.appendChild(note);
      container.appendChild(box);
    }

    function addCell(row, label, value, emphasized) {
      const cell = el(documentLike, 'div');
      const heading = el(documentLike, 'span', { text: `${label}: ` });
      heading.style.opacity = '0.68';
      cell.appendChild(heading);
      const valueNode = el(documentLike, emphasized ? 'strong' : 'span', { text: value });
      if (emphasized) valueNode.style.color = settings.theme === 'light' ? '#0d5c19' : '#74ff8b';
      cell.appendChild(valueNode);
      row.appendChild(cell);
      return cell;
    }

    function renderRow(entry, container) {
      const { property, quote, market } = entry;
      const row = el(documentLike, 'section', {
        className: 'r4g3-prm-property',
        attrs: { 'data-property-id': property.id }
      });
      row.style.padding = '12px';
      row.style.margin = '8px';
      row.style.border = '1px solid rgba(128,128,128,0.28)';
      row.style.borderRadius = '8px';
      row.style.display = 'grid';
      row.style.gridTemplateColumns = 'repeat(auto-fit, minmax(175px, 1fr))';
      row.style.gap = '8px 14px';

      const identity = el(documentLike, 'div');
      identity.style.gridColumn = '1 / -1';
      identity.style.display = 'flex';
      identity.style.alignItems = 'center';
      identity.style.gap = '12px';
      identity.style.minWidth = '0';

      const imageUrl = typeof propertyCore.propertyImageUrl === 'function' ? propertyCore.propertyImageUrl(property.name) : '';
      if (imageUrl) {
        const image = el(documentLike, 'img', {
          attrs: {
            src: imageUrl,
            alt: `${property.name} property`,
            'data-role': 'property-image'
          }
        });
        image.style.width = '112px';
        image.style.height = '74px';
        image.style.objectFit = 'cover';
        image.style.borderRadius = '7px';
        image.style.border = '1px solid rgba(128,128,128,0.3)';
        image.style.flex = '0 0 auto';
        image.loading = 'lazy';
        image.addEventListener('error', () => { image.style.display = 'none'; }, { once: true });
        identity.appendChild(image);
      }

      const title = el(documentLike, 'strong', { text: `${property.name} #${property.id}` });
      title.style.fontSize = '14px';
      identity.appendChild(title);
      row.appendChild(identity);

      addCell(row, 'Status', labelStatus(property.status));
      addCell(row, 'Happy', money(property.happy));
      addCell(row, 'Upgrades', property.modifications && property.modifications.length ? property.modifications.join(', ') : 'None');

      if (market && market.error) {
        const failed = el(documentLike, 'div', { text: `Market scan failed for this property type: ${market.error}` });
        failed.style.gridColumn = '1 / -1';
        row.appendChild(failed);
        const retry = createButton('RETRY MARKET', 'retry-market');
        retry.dataset.propertyTypeId = String(property.propertyTypeId);
        row.appendChild(retry);
      } else if (!market && state.loading) {
        const pending = el(documentLike, 'div', { text: 'Market scan pending…' });
        pending.style.gridColumn = '1 / -1';
        pending.style.opacity = '0.72';
        row.appendChild(pending);
      } else if (quote.exactMatchCount > 0) {
        addCell(row, 'Exact matches', quote.exactMatchCount);
        addCell(row, 'Lowest 100-day', `$${money(quote.lowestTotal)}`);
        addCell(row, 'Highest 100-day', `$${money(quote.highestTotal)}`);
        addCell(row, 'Average 100-day', `$${money(quote.averageTotal)}`);
        addCell(row, 'Proposed 100-day rent', `$${money(quote.proposedTotal)}`, true);
        addCell(row, 'Market source', market && market.fromCache ? 'Cached' : 'Live');
      } else {
        const noMatches = el(documentLike, 'div', { text: 'No exact market matches for this upgrade configuration.' });
        noMatches.style.gridColumn = '1 / -1';
        noMatches.style.opacity = '0.78';
        row.appendChild(noMatches);
      }

      if (propertyCore.isEligibleForLease(property) && quote.proposedTotal != null) {
        const actions = el(documentLike, 'div');
        actions.style.gridColumn = '1 / -1';
        actions.style.display = 'flex';
        actions.style.flexWrap = 'wrap';
        actions.style.gap = '8px';

        const setPrice = createButton('SET PRICE', 'set-price');
        setPrice.dataset.propertyId = String(property.id);
        setPrice.style.color = settings.theme === 'light' ? '#0d5c19' : '#74ff8b';

        const list = createButton('LIST PROPERTY', 'list-property');
        list.dataset.propertyId = String(property.id);
        list.disabled = !canListProperty(property.id);
        list.style.opacity = list.disabled ? '0.45' : '1';
        list.title = list.disabled
          ? 'Press SET PRICE first, then list from the prepared Torn lease page.'
          : `List this property for $${money(quote.proposedTotal)} over ${TARGET_DAYS} days`;

        actions.append(setPrice, list);
        row.appendChild(actions);
      }

      container.appendChild(row);
    }

    function renderStatus(container) {
      if (state.actionMessage) {
        const message = el(documentLike, 'div', { text: state.actionMessage });
        message.style.padding = '8px 12px';
        message.style.borderBottom = '1px solid rgba(128,128,128,0.25)';
        container.appendChild(message);
      }
      if (state.needsApiKey) {
        const keyMessage = el(documentLike, 'div', {
          text: 'A Limited-or-higher Torn API key is required. Open Settings to configure it.'
        });
        keyMessage.style.padding = '14px';
        container.appendChild(keyMessage);
        return true;
      }
      if (state.loading) {
        const progress = state.scanProgress && state.scanProgress.total
          ? `Scanning rental markets… ${state.scanProgress.done}/${state.scanProgress.total}`
          : 'Scanning owned properties and rental markets…';
        const loading = el(documentLike, 'div', { text: progress });
        loading.style.padding = '10px 14px';
        loading.style.borderBottom = '1px solid rgba(128,128,128,0.2)';
        container.appendChild(loading);
        return !state.rows.length;
      }
      if (state.error) {
        const error = el(documentLike, 'div', { text: 'Unable to load property data. Check your Torn API key and try again.' });
        error.style.padding = '14px';
        container.appendChild(error);
        return true;
      }
      if (!state.rows.length) {
        const empty = el(documentLike, 'div', { text: 'No owned properties were returned.' });
        empty.style.padding = '14px';
        container.appendChild(empty);
        return true;
      }
      return false;
    }

    function readSettingsFields(node) {
      const keyInput = node.querySelector('[data-role="api-key-input"]');
      const undercutInput = node.querySelector('[data-role="undercut-input"]');
      return {
        apiKey: keyInput && keyInput.value ? keyInput.value.trim() : null,
        undercutPercent: undercutInput ? undercutInput.value : settings.undercutPercent
      };
    }

    function setPriceForProperty(propertyId) {
      const id = Number(propertyId);
      const entry = state.rows.find(row => row.property.id === id);
      if (!entry || !propertyCore.isEligibleForLease(entry.property) || entry.quote.proposedTotal == null) return false;

      draftStore.save({
        propertyId: id,
        days: TARGET_DAYS,
        totalCost: entry.quote.proposedTotal,
        dailyPrice: Math.max(1, Math.floor(entry.quote.proposedTotal / TARGET_DAYS))
      });
      navigate(propertyCore.leaseUrl(id));
      return true;
    }

    function listPreparedProperty(propertyId) {
      const id = Number(propertyId);
      const entry = state.rows.find(row => row.property.id === id);
      if (!entry || !propertyCore.isEligibleForLease(entry.property) || entry.quote.proposedTotal == null) return false;
      if (!canListProperty(id)) return false;

      const result = listProperty(id);
      if (result && result.submitted) {
        state = Object.assign({}, state, { actionMessage: `Listing submitted for ${entry.property.name} #${id}.` });
        render();
      }
      return result || false;
    }

    async function retryMarket(propertyTypeId) {
      const id = Number(propertyTypeId);
      const apiClient = getApiClient();
      if (!apiClient || typeof apiClient.fetchRentalMarket !== 'function' || !id) return false;
      state = Object.assign({}, state, { actionMessage: `Retrying market ${id}…` });
      render();
      try {
        const market = await apiClient.fetchRentalMarket(id, { force: true });
        const markets = Object.assign({}, state.markets, { [id]: market });
        state = Object.assign({}, state, {
          markets,
          rows: computeRows(state.properties, markets),
          actionMessage: `Market ${id} refreshed.`
        });
        render();
        return true;
      } catch (error) {
        const markets = Object.assign({}, state.markets, {
          [id]: { rentals: [], error: String(error && error.message || error) }
        });
        state = Object.assign({}, state, { markets, rows: computeRows(state.properties, markets), actionMessage: `Market ${id} retry failed.` });
        render();
        return false;
      }
    }

    function closePanel() {
      persistGeometryFromPanel();
      persistSettings({ uiState: 'closed' });
      render();
      return true;
    }

    function toggleMinimize() {
      if (settings.uiState === 'minimized') persistSettings({ uiState: 'open' });
      else {
        persistGeometryFromPanel();
        persistSettings({ uiState: 'minimized' });
      }
      render();
      return settings.uiState;
    }

    function open() {
      persistSettings({ uiState: 'open' });
      render();
      return true;
    }

    function attachPanelEvents(node) {
      node.addEventListener('click', event => {
        const button = event.target && event.target.closest && event.target.closest('[data-action]');
        if (!button || !node.contains(button)) return;
        const action = button.dataset.action;
        if (action === 'refresh') {
          load({ force: false }).catch(() => {});
          return;
        }
        if (action === 'force-refresh') {
          load({ force: true }).catch(() => {});
          return;
        }
        if (action === 'retry-market') {
          retryMarket(Number(button.dataset.propertyTypeId)).catch(() => {});
          return;
        }
        if (action === 'minimize') {
          toggleMinimize();
          return;
        }
        if (action === 'close') {
          closePanel();
          return;
        }
        if (action === 'toggle-theme') {
          setTheme(settings.theme === 'dark' ? 'light' : 'dark');
          return;
        }
        if (action === 'toggle-settings') {
          settingsOpen = !settingsOpen;
          render();
          return;
        }
        if (action === 'save-settings') {
          const fields = readSettingsFields(node);
          const patch = { undercutPercent: fields.undercutPercent };
          if (fields.apiKey) patch.apiKey = fields.apiKey;
          persistSettings(patch);
          state.rows = computeRows(state.properties, state.markets);
          render();
          return;
        }
        if (action === 'clear-api-key') {
          setApiKey('');
          return;
        }
        if (action === 'set-price') {
          setPriceForProperty(Number(button.dataset.propertyId));
          return;
        }
        if (action === 'list-property') {
          listPreparedProperty(Number(button.dataset.propertyId));
        }
      });
    }

    function attachDrag(node) {
      if (isMobile()) return;
      const handle = node.querySelector('[data-role="drag-handle"]');
      if (!handle) return;
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let originLeft = 0;
      let originTop = 0;

      const onMove = event => {
        if (!dragging) return;
        node.style.left = `${Math.max(0, originLeft + event.clientX - startX)}px`;
        node.style.top = `${Math.max(0, originTop + event.clientY - startY)}px`;
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        persistGeometryFromPanel();
      };
      const onDown = event => {
        if (event.button != null && event.button !== 0) return;
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        originLeft = parseInt(node.style.left, 10) || 0;
        originTop = parseInt(node.style.top, 10) || 0;
        if (typeof event.preventDefault === 'function') event.preventDefault();
      };

      handle.addEventListener('mousedown', onDown);
      windowLike.addEventListener('mousemove', onMove);
      windowLike.addEventListener('mouseup', onUp);
      dragCleanup = () => {
        handle.removeEventListener('mousedown', onDown);
        windowLike.removeEventListener('mousemove', onMove);
        windowLike.removeEventListener('mouseup', onUp);
      };
    }

    function persistGeometryFromPanel() {
      if (!panel || isMobile() || settings.uiState === 'minimized') return;
      const geometry = {
        left: parseInt(panel.style.left, 10) || 0,
        top: parseInt(panel.style.top, 10) || 0,
        width: panel.offsetWidth || parseInt(panel.style.width, 10) || settings.geometry.width,
        height: panel.offsetHeight || parseInt(panel.style.height, 10) || settings.geometry.height
      };
      persistSettings({ geometry });
    }

    function attachResize(node) {
      if (isMobile() || settings.uiState === 'minimized') return;
      if (windowLike.ResizeObserver) {
        resizeObserver = new windowLike.ResizeObserver(() => persistGeometryFromPanel());
        resizeObserver.observe(node);
      }
    }

    function renderResizeHandle(container) {
      if (isMobile() || settings.uiState === 'minimized') return;
      const handle = el(documentLike, 'div', {
        attrs: {
          'data-role': 'resize-handle',
          title: 'Drag to resize Property Rental Manager',
          'aria-label': 'Resize Property Rental Manager'
        }
      });
      handle.style.position = 'absolute';
      handle.style.right = '1px';
      handle.style.bottom = '1px';
      handle.style.width = '20px';
      handle.style.height = '20px';
      handle.style.cursor = 'nwse-resize';
      handle.style.zIndex = '4';
      handle.style.borderRight = settings.theme === 'light' ? '3px solid #0d5c19' : '3px solid #74ff8b';
      handle.style.borderBottom = settings.theme === 'light' ? '3px solid #0d5c19' : '3px solid #74ff8b';
      handle.style.borderRadius = '0 0 8px 0';
      handle.style.boxSizing = 'border-box';
      container.appendChild(handle);
    }

    function attachExplicitResize(node) {
      if (isMobile() || settings.uiState === 'minimized') return;
      const handle = node.querySelector('[data-role="resize-handle"]');
      if (!handle) return;
      let resizing = false;
      let startX = 0;
      let startY = 0;
      let originWidth = 0;
      let originHeight = 0;

      const onMove = event => {
        if (!resizing) return;
        const width = integer(originWidth + event.clientX - startX, 360, 3000, originWidth);
        const height = integer(originHeight + event.clientY - startY, 260, 2400, originHeight);
        node.style.width = `${width}px`;
        node.style.height = `${height}px`;
      };
      const onUp = () => {
        if (!resizing) return;
        resizing = false;
        persistGeometryFromPanel();
      };
      const onDown = event => {
        if (event.button != null && event.button !== 0) return;
        resizing = true;
        startX = event.clientX;
        startY = event.clientY;
        originWidth = node.offsetWidth || parseInt(node.style.width, 10) || settings.geometry.width;
        originHeight = node.offsetHeight || parseInt(node.style.height, 10) || settings.geometry.height;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
      };

      handle.addEventListener('mousedown', onDown);
      windowLike.addEventListener('mousemove', onMove);
      windowLike.addEventListener('mouseup', onUp);
      resizeCleanup = () => {
        handle.removeEventListener('mousedown', onDown);
        windowLike.removeEventListener('mousemove', onMove);
        windowLike.removeEventListener('mouseup', onUp);
      };
    }

    function render() {
      if (dragCleanup) {
        dragCleanup();
        dragCleanup = null;
      }
      if (resizeCleanup) {
        resizeCleanup();
        resizeCleanup = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (panel && panel.parentNode) panel.remove();
      panel = null;

      if (settings.uiState === 'closed') return null;

      panel = el(documentLike, 'aside', { attrs: { id: 'r4g3-prm-panel' } });
      panel.className = `r4g3-prm-theme-${settings.theme}`;
      applyPanelGeometry(panel);
      addStyles(panel);
      renderHeader(panel);

      if (settings.uiState !== 'minimized') {
        renderSettings(panel);
        if (!renderStatus(panel)) {
          for (const row of state.rows) renderRow(row, panel);
        }
        renderResizeHandle(panel);
      }

      documentLike.body.appendChild(panel);
      attachPanelEvents(panel);
      attachDrag(panel);
      attachResize(panel);
      attachExplicitResize(panel);
      return panel;
    }

    async function performLoad(options) {
      if (apiClientFactory && !settings.apiKey) {
        settingsOpen = true;
        state = {
          properties: [],
          markets: {},
          rows: [],
          loading: false,
          error: null,
          needsApiKey: true,
          actionMessage: '',
          scanProgress: null
        };
        render();
        return state;
      }

      const apiClient = getApiClient();
      state = Object.assign({}, state, { loading: true, error: null, needsApiKey: false, actionMessage: '', scanProgress: null });
      render();
      try {
        const currentUserId = typeof apiClient.fetchCurrentUserId === 'function'
          ? await apiClient.fetchCurrentUserId()
          : null;
        const rawProperties = await apiClient.fetchOwnedProperties();
        const properties = propertyCore.normalizeProperties(rawProperties, currentUserId);
        const typeIds = [...new Set(properties.map(property => Number(property.propertyTypeId)).filter(Boolean))];
        state = Object.assign({}, state, {
          properties,
          markets: {},
          rows: computeRows(properties, {}),
          scanProgress: { done: 0, total: typeIds.length }
        });
        render();

        const markets = await apiClient.scanMarkets(properties, {
          force: Boolean(options && options.force),
          onProgress(entry) {
            const nextMarkets = Object.assign({}, state.markets, { [entry.id]: entry.market });
            state = Object.assign({}, state, {
              markets: nextMarkets,
              rows: computeRows(properties, nextMarkets),
              scanProgress: { done: entry.done, total: entry.total }
            });
            render();
          }
        });
        const rows = computeRows(properties, markets);
        state = { properties, markets, rows, loading: false, error: null, needsApiKey: false, actionMessage: '', scanProgress: null };
        render();
        return state;
      } catch (error) {
        state = Object.assign({}, state, { loading: false, error: error || new Error('Unknown load failure'), needsApiKey: false, scanProgress: null });
        render();
        throw error;
      }
    }

    function load(options) {
      if (activeLoadPromise) return activeLoadPromise;
      activeLoadPromise = performLoad(options).finally(() => {
        activeLoadPromise = null;
      });
      return activeLoadPromise;
    }

    function hydrate(snapshot) {
      const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
      const properties = Array.isArray(source.properties) ? source.properties.slice() : [];
      const markets = source.markets && typeof source.markets === 'object' && !Array.isArray(source.markets)
        ? Object.assign({}, source.markets)
        : {};
      state = {
        properties,
        markets,
        rows: computeRows(properties, markets),
        loading: false,
        error: null,
        needsApiKey: false,
        actionMessage: '',
        scanProgress: null
      };
      render();
      return state;
    }

    async function updateProperty(propertyId, options) {
      const id = Number(propertyId);
      if (!Number.isInteger(id) || id <= 0) throw new TypeError('A positive property ID is required');
      if (apiClientFactory && !settings.apiKey) {
        settingsOpen = true;
        state = Object.assign({}, state, { needsApiKey: true, error: null });
        render();
        return state;
      }
      const apiClient = getApiClient();
      state = Object.assign({}, state, { error: null, needsApiKey: false, actionMessage: `Updating property ${id}…` });
      render();
      try {
        const currentUserId = typeof apiClient.fetchCurrentUserId === 'function'
          ? await apiClient.fetchCurrentUserId()
          : null;
        const rawProperties = await apiClient.fetchOwnedProperties();
        const freshProperties = propertyCore.normalizeProperties(rawProperties, currentUserId);
        const fresh = freshProperties.find(property => Number(property.id) === id);
        if (!fresh) throw new Error('Property is no longer present in the verified owned-property list');

        let replaced = false;
        const properties = (state.properties || []).map(property => {
          if (Number(property.id) !== id) return property;
          replaced = true;
          return fresh;
        });
        if (!replaced) properties.push(fresh);

        const scanned = await apiClient.scanMarkets([fresh], { force: Boolean(options && options.force) });
        const markets = Object.assign({}, state.markets || {}, scanned || {});
        state = Object.assign({}, state, {
          properties,
          markets,
          rows: computeRows(properties, markets),
          loading: false,
          error: null,
          needsApiKey: false,
          actionMessage: `Property ${id} updated.`,
          scanProgress: null
        });
        render();
        return state;
      } catch (error) {
        state = Object.assign({}, state, { error, actionMessage: `Property ${id} update failed.` });
        render();
        throw error;
      }
    }

    function setTheme(theme) {
      persistSettings({ theme });
      render();
      return settings.theme;
    }

    function setMode() {
      return 'simple';
    }

    function openSettings() {
      if (settings.uiState === 'closed' || settings.uiState === 'minimized') persistSettings({ uiState: 'open' });
      settingsOpen = true;
      render();
      return true;
    }

    function setApiKey(apiKey) {
      persistSettings({ apiKey: String(apiKey || '').trim() });
      if (cachedApiKey !== settings.apiKey) {
        cachedApiClient = null;
        cachedApiKey = '';
      }
      state = Object.assign({}, state, { needsApiKey: apiClientFactory ? !settings.apiKey : false, error: null });
      settingsOpen = true;
      render();
      return Boolean(settings.apiKey);
    }

    function destroy() {
      if (dragCleanup) dragCleanup();
      if (resizeCleanup) resizeCleanup();
      if (resizeObserver) resizeObserver.disconnect();
      if (panel && panel.parentNode) panel.remove();
      panel = null;
    }

    render();

    return Object.freeze({
      load,
      hydrate,
      updateProperty,
      render,
      open,
      close: closePanel,
      toggleMinimize,
      retryMarket,
      setPriceForProperty,
      listPreparedProperty,
      prepareLease: setPriceForProperty,
      setMode,
      setTheme,
      openSettings,
      setApiKey,
      destroy,
      getState: () => state,
      getSettings: () => Object.assign({}, settings, { geometry: Object.assign({}, settings.geometry) })
    });
  }

  return Object.freeze({
    SETTINGS_KEY,
    TARGET_DAYS,
    DEFAULT_SETTINGS,
    normalizeSettings,
    loadSettings,
    saveSettings,
    createController
  });
}));
