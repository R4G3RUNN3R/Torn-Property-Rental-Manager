(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SETTINGS_KEY = 'r4g3_property_rental_manager.settings';
  const DEFAULT_SETTINGS = Object.freeze({
    apiKey: '',
    theme: 'dark',
    mode: 'simple',
    days: 30,
    undercutPercent: 0.5,
    minimumMedianRatio: 0.70,
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

  function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      apiKey: typeof source.apiKey === 'string' ? source.apiKey : DEFAULT_SETTINGS.apiKey,
      theme: source.theme === 'light' ? 'light' : 'dark',
      mode: source.mode === 'advanced' ? 'advanced' : 'simple',
      days: integer(source.days, 1, 365, DEFAULT_SETTINGS.days),
      undercutPercent: clamp(source.undercutPercent, 0, 25, DEFAULT_SETTINGS.undercutPercent),
      minimumMedianRatio: clamp(source.minimumMedianRatio, 0, 1, DEFAULT_SETTINGS.minimumMedianRatio),
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
    const normalized = normalizeSettings(Object.assign({}, current, next || {}, {
      geometry: next && next.geometry ? next.geometry : current.geometry
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

  function percent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : 'n/a';
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
    const apiClient = config.apiClient;
    const propertyCore = config.propertyCore;
    const marketCore = config.marketCore;
    const draftStore = config.draftStore;
    const navigate = typeof config.navigate === 'function'
      ? config.navigate
      : url => { if (windowLike && windowLike.location) windowLike.location.href = url; };

    if (!windowLike || !documentLike) throw new TypeError('window and document are required');
    if (!apiClient || typeof apiClient.fetchOwnedProperties !== 'function' || typeof apiClient.scanMarkets !== 'function') {
      throw new TypeError('apiClient is required');
    }
    if (!propertyCore || !marketCore || !draftStore) throw new TypeError('Core dependencies are required');

    let settings = loadSettings(storage);
    let state = {
      properties: [],
      markets: {},
      rows: [],
      loading: false,
      error: null
    };
    let panel = null;
    let dragCleanup = null;
    let resizeObserver = null;

    function persistSettings(patch) {
      settings = saveSettings(storage, Object.assign({}, settings, patch || {}));
      return settings;
    }

    function computeRows(properties, markets) {
      return properties.map(property => {
        const market = markets && markets[property.propertyTypeId];
        const stats = marketCore.marketStats(
          property,
          market && Array.isArray(market.rentals) ? market.rentals : [],
          {
            undercutPercent: settings.undercutPercent,
            minimumMedianRatio: settings.minimumMedianRatio
          }
        );
        return { property, market: market || null, stats };
      });
    }

    function applyPanelGeometry(node) {
      const geometry = settings.geometry;
      node.style.position = 'fixed';
      node.style.left = `${geometry.left}px`;
      node.style.top = `${geometry.top}px`;
      node.style.width = `${geometry.width}px`;
      node.style.height = `${geometry.height}px`;
      node.style.resize = 'both';
      node.style.overflow = 'auto';
      node.style.zIndex = '99999';
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

    function createButton(text, action) {
      const button = el(documentLike, 'button', { text, attrs: { type: 'button', 'data-action': action } });
      button.style.cursor = 'pointer';
      button.style.padding = '6px 9px';
      button.style.borderRadius = '6px';
      button.style.border = '1px solid currentColor';
      button.style.background = 'transparent';
      button.style.color = 'inherit';
      return button;
    }

    function renderHeader(container) {
      const header = el(documentLike, 'div', { className: 'r4g3-prm-header' });
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.gap = '8px';
      header.style.padding = '9px 10px';
      header.style.borderBottom = '1px solid rgba(128,128,128,0.35)';
      header.style.position = 'sticky';
      header.style.top = '0';
      header.style.background = settings.theme === 'light' ? '#f5f5f2' : '#111512';
      header.style.zIndex = '2';

      const dragHandle = el(documentLike, 'strong', {
        text: 'Property Rental Manager',
        attrs: { 'data-role': 'drag-handle' }
      });
      dragHandle.style.cursor = 'move';
      dragHandle.style.userSelect = 'none';
      dragHandle.style.marginRight = 'auto';
      dragHandle.style.color = settings.theme === 'light' ? '#102513' : '#74ff8b';
      header.appendChild(dragHandle);

      const modeButton = createButton(settings.mode === 'advanced' ? 'Simple' : 'Advanced', 'toggle-mode');
      const themeButton = createButton(settings.theme === 'dark' ? 'Light' : 'Dark', 'toggle-theme');
      header.append(modeButton, themeButton);
      container.appendChild(header);
    }

    function addCell(row, label, value, className) {
      const cell = el(documentLike, 'div', { className: className || '' });
      const heading = el(documentLike, 'span', { text: `${label}: ` });
      heading.style.opacity = '0.68';
      cell.appendChild(heading);
      cell.appendChild(documentLike.createTextNode(String(value)));
      row.appendChild(cell);
      return cell;
    }

    function renderRow(entry, container) {
      const { property, market, stats } = entry;
      const row = el(documentLike, 'section', {
        className: 'r4g3-prm-property',
        attrs: { 'data-property-id': property.id }
      });
      row.style.padding = '10px';
      row.style.margin = '8px';
      row.style.border = '1px solid rgba(128,128,128,0.28)';
      row.style.borderRadius = '8px';
      row.style.display = 'grid';
      row.style.gridTemplateColumns = 'repeat(auto-fit, minmax(145px, 1fr))';
      row.style.gap = '7px 12px';

      const title = el(documentLike, 'strong', { text: `${property.name} #${property.id}` });
      title.style.gridColumn = '1 / -1';
      row.appendChild(title);
      addCell(row, 'Status', labelStatus(property.status));
      addCell(row, 'Happy', money(property.happy));
      addCell(row, 'Market floor / day', stats.marketFloor == null ? 'No market data' : `$${money(stats.marketFloor)}`);
      addCell(row, 'Suggested / day', stats.suggestedDaily == null ? 'n/a' : `$${money(stats.suggestedDaily)}`);
      addCell(row, 'Lease period', `${settings.days} days`);
      addCell(row, 'Total lease value', stats.suggestedDaily == null ? 'n/a' : `$${money(stats.suggestedDaily * settings.days)}`);
      addCell(row, 'Confidence', stats.confidence);

      if (settings.mode === 'advanced') {
        addCell(row, 'Median', stats.median == null ? 'n/a' : `$${money(stats.median)}`, 'r4g3-prm-advanced');
        addCell(row, 'Q1', stats.q1 == null ? 'n/a' : `$${money(stats.q1)}`, 'r4g3-prm-advanced');
        addCell(row, 'Q3', stats.q3 == null ? 'n/a' : `$${money(stats.q3)}`, 'r4g3-prm-advanced');
        addCell(row, 'Comparables', stats.sampleSize, 'r4g3-prm-advanced');
        addCell(row, 'Average similarity', percent(stats.averageSimilarity), 'r4g3-prm-advanced');
        addCell(row, 'Modifications', property.modifications.length ? property.modifications.join(', ') : 'None', 'r4g3-prm-advanced');
        addCell(row, 'Market timestamp', market && market.rentals_timestamp != null ? market.rentals_timestamp : 'n/a', 'r4g3-prm-advanced');
        addCell(row, 'Market source', market && market.fromCache ? 'Cache' : 'API', 'r4g3-prm-advanced');
      }

      if (propertyCore.isEligibleForLease(property) && stats.suggestedDaily != null) {
        const action = createButton('Prepare Lease', 'prepare-lease');
        action.dataset.propertyId = String(property.id);
        action.style.color = settings.theme === 'light' ? '#0d5c19' : '#74ff8b';
        row.appendChild(action);
      }

      container.appendChild(row);
    }

    function renderStatus(container) {
      if (state.loading) {
        const loading = el(documentLike, 'div', { text: 'Scanning owned properties and rental markets…' });
        loading.style.padding = '14px';
        container.appendChild(loading);
        return true;
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

    function attachPanelEvents(node) {
      node.addEventListener('click', event => {
        const button = event.target && event.target.closest && event.target.closest('[data-action]');
        if (!button || !node.contains(button)) return;
        const action = button.dataset.action;
        if (action === 'toggle-mode') {
          setMode(settings.mode === 'advanced' ? 'simple' : 'advanced');
          return;
        }
        if (action === 'toggle-theme') {
          setTheme(settings.theme === 'dark' ? 'light' : 'dark');
          return;
        }
        if (action === 'prepare-lease') {
          prepareLease(Number(button.dataset.propertyId));
        }
      });
    }

    function attachDrag(node) {
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
      if (!panel) return;
      const geometry = {
        left: parseInt(panel.style.left, 10) || 0,
        top: parseInt(panel.style.top, 10) || 0,
        width: panel.offsetWidth || parseInt(panel.style.width, 10) || settings.geometry.width,
        height: panel.offsetHeight || parseInt(panel.style.height, 10) || settings.geometry.height
      };
      persistSettings({ geometry });
    }

    function attachResize(node) {
      if (windowLike.ResizeObserver) {
        resizeObserver = new windowLike.ResizeObserver(() => persistGeometryFromPanel());
        resizeObserver.observe(node);
      }
    }

    function render() {
      if (dragCleanup) { dragCleanup(); dragCleanup = null; }
      if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
      if (panel && panel.parentNode) panel.remove();

      panel = el(documentLike, 'aside', {
        className: `r4g3-prm-theme-${settings.theme}`,
        attrs: { id: 'r4g3-prm-panel', 'aria-label': 'Property Rental Manager' }
      });
      applyPanelGeometry(panel);
      addStyles(panel);
      renderHeader(panel);

      const body = el(documentLike, 'div', { className: 'r4g3-prm-body' });
      if (!renderStatus(body)) {
        for (const row of state.rows) renderRow(row, body);
      }
      panel.appendChild(body);
      documentLike.body.appendChild(panel);
      attachPanelEvents(panel);
      attachDrag(panel);
      attachResize(panel);
      return panel;
    }

    async function load(options) {
      state = Object.assign({}, state, { loading: true, error: null });
      render();
      try {
        const rawProperties = await apiClient.fetchOwnedProperties();
        const properties = propertyCore.normalizeProperties(rawProperties, null);
        const markets = await apiClient.scanMarkets(properties, { force: Boolean(options && options.force) });
        const rows = computeRows(properties, markets);
        state = { properties, markets, rows, loading: false, error: null };
        render();
        return state;
      } catch (error) {
        state = Object.assign({}, state, { loading: false, error: error || new Error('Unknown load failure') });
        render();
        throw error;
      }
    }

    function prepareLease(propertyId) {
      const id = Number(propertyId);
      const entry = state.rows.find(row => row.property.id === id);
      if (!entry || !propertyCore.isEligibleForLease(entry.property) || entry.stats.suggestedDaily == null) return false;

      draftStore.save({
        propertyId: id,
        days: settings.days,
        dailyPrice: entry.stats.suggestedDaily,
        marketFloor: entry.stats.marketFloor,
        median: entry.stats.median,
        confidence: entry.stats.confidence
      });
      navigate(propertyCore.leaseUrl(id));
      return true;
    }

    function setMode(mode) {
      persistSettings({ mode });
      state.rows = computeRows(state.properties, state.markets);
      render();
      return settings.mode;
    }

    function setTheme(theme) {
      persistSettings({ theme });
      render();
      return settings.theme;
    }

    function destroy() {
      if (dragCleanup) dragCleanup();
      if (resizeObserver) resizeObserver.disconnect();
      if (panel && panel.parentNode) panel.remove();
      panel = null;
    }

    render();

    return Object.freeze({
      load,
      render,
      prepareLease,
      setMode,
      setTheme,
      destroy,
      getState: () => state,
      getSettings: () => Object.assign({}, settings, { geometry: Object.assign({}, settings.geometry) })
    });
  }

  return Object.freeze({
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
    normalizeSettings,
    loadSettings,
    saveSettings,
    createController
  });
}));
