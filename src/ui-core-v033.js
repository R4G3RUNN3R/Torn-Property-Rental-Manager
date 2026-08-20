(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3UiCoreV033 = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SETTINGS_KEY = 'r4g3_property_rental_manager.v033';
  const PRICING_BASES = Object.freeze(['lowest', 'median', 'average', 'highest']);
  const SORT_MODES = Object.freeze([
    'recommended', 'name-asc', 'name-desc', 'rent-desc', 'rent-asc',
    'happy-desc', 'happy-asc', 'id-asc'
  ]);
  const DEFAULT_SETTINGS = Object.freeze({
    pricingBasis: 'average',
    undercutPercent: 0.5,
    sortMode: 'recommended',
    theme: 'dark',
    density: 'comfortable',
    showImages: true,
    marketDetail: 'full',
    settingsGeometry: Object.freeze({ left: 78, top: 110, width: 520, height: 620 })
  });

  function finite(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.min(max, Math.max(min, finite(value, fallback)));
  }

  function normalizeGeometry(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      left: Math.round(clamp(source.left, 0, 10000, DEFAULT_SETTINGS.settingsGeometry.left)),
      top: Math.round(clamp(source.top, 0, 10000, DEFAULT_SETTINGS.settingsGeometry.top)),
      width: Math.round(clamp(source.width, 360, 1200, DEFAULT_SETTINGS.settingsGeometry.width)),
      height: Math.round(clamp(source.height, 360, 1600, DEFAULT_SETTINGS.settingsGeometry.height))
    };
  }

  function normalizeSettings(value, legacyUndercut, legacyTheme) {
    const source = value && typeof value === 'object' ? value : {};
    const fallbackUndercut = clamp(legacyUndercut, 0, 25, DEFAULT_SETTINGS.undercutPercent);
    const fallbackTheme = legacyTheme === 'light' ? 'light' : DEFAULT_SETTINGS.theme;
    return {
      pricingBasis: PRICING_BASES.includes(source.pricingBasis) ? source.pricingBasis : DEFAULT_SETTINGS.pricingBasis,
      undercutPercent: clamp(source.undercutPercent, 0, 25, fallbackUndercut),
      sortMode: SORT_MODES.includes(source.sortMode) ? source.sortMode : DEFAULT_SETTINGS.sortMode,
      theme: source.theme === 'light' || source.theme === 'dark' ? source.theme : fallbackTheme,
      density: source.density === 'compact' ? 'compact' : DEFAULT_SETTINGS.density,
      showImages: source.showImages !== false,
      marketDetail: source.marketDetail === 'compact' ? 'compact' : DEFAULT_SETTINGS.marketDetail,
      settingsGeometry: normalizeGeometry(source.settingsGeometry)
    };
  }

  function loadSettings(storage, legacyUndercut, legacyTheme) {
    if (!storage || typeof storage.getItem !== 'function') {
      return normalizeSettings({}, legacyUndercut, legacyTheme);
    }
    try {
      const raw = storage.getItem(SETTINGS_KEY);
      return normalizeSettings(raw ? JSON.parse(raw) : {}, legacyUndercut, legacyTheme);
    } catch (error) {
      return normalizeSettings({}, legacyUndercut, legacyTheme);
    }
  }

  function saveSettings(storage, next, legacyUndercut, legacyTheme) {
    const current = loadSettings(storage, legacyUndercut, legacyTheme);
    const source = next && typeof next === 'object' ? next : {};
    const merged = Object.assign({}, current, source, {
      settingsGeometry: source.settingsGeometry || current.settingsGeometry
    });
    const normalized = normalizeSettings(merged, legacyUndercut, legacyTheme);
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    }
    return normalized;
  }

  function pricingBasisLabel(value) {
    const labels = {
      lowest: 'Lowest market price',
      median: 'Median market price',
      average: 'Average market price',
      highest: 'Highest market price'
    };
    return labels[PRICING_BASES.includes(value) ? value : 'average'];
  }

  function statusGroup(entry, justListed) {
    const property = entry && entry.property || {};
    const id = Number(property.id);
    if (justListed && typeof justListed.has === 'function' && justListed.has(id)) return 3;
    const status = String(property.status || '').toLowerCase();
    if (status === 'for_rent') return 2;
    if (status === 'none') return 0;
    return 1;
  }

  function nullableNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function rowComparator(mode) {
    return function compare(a, b) {
      const ap = a && a.property || {};
      const bp = b && b.property || {};
      if (mode === 'name-desc') {
        return String(bp.name || '').localeCompare(String(ap.name || '')) || Number(ap.id) - Number(bp.id);
      }
      if (mode === 'rent-desc') {
        return nullableNumber(b && b.quote && b.quote.proposedTotal, -Infinity)
          - nullableNumber(a && a.quote && a.quote.proposedTotal, -Infinity)
          || String(ap.name || '').localeCompare(String(bp.name || ''))
          || Number(ap.id) - Number(bp.id);
      }
      if (mode === 'rent-asc') {
        return nullableNumber(a && a.quote && a.quote.proposedTotal, Infinity)
          - nullableNumber(b && b.quote && b.quote.proposedTotal, Infinity)
          || String(ap.name || '').localeCompare(String(bp.name || ''))
          || Number(ap.id) - Number(bp.id);
      }
      if (mode === 'happy-desc') {
        return nullableNumber(bp.happy, -Infinity) - nullableNumber(ap.happy, -Infinity)
          || String(ap.name || '').localeCompare(String(bp.name || ''))
          || Number(ap.id) - Number(bp.id);
      }
      if (mode === 'happy-asc') {
        return nullableNumber(ap.happy, Infinity) - nullableNumber(bp.happy, Infinity)
          || String(ap.name || '').localeCompare(String(bp.name || ''))
          || Number(ap.id) - Number(bp.id);
      }
      if (mode === 'id-asc') return Number(ap.id) - Number(bp.id);
      return String(ap.name || '').localeCompare(String(bp.name || '')) || Number(ap.id) - Number(bp.id);
    };
  }

  function sortRows(rows, settings, justListed) {
    const options = normalizeSettings(settings || {}, settings && settings.undercutPercent, settings && settings.theme);
    const compareRows = rowComparator(options.sortMode);
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
      const groupDifference = statusGroup(a, justListed) - statusGroup(b, justListed);
      return groupDifference || compareRows(a, b);
    });
  }

  function clampPanelPosition(geometry, viewport) {
    const source = geometry && typeof geometry === 'object' ? geometry : {};
    const view = viewport && typeof viewport === 'object' ? viewport : {};
    const width = Math.max(1, finite(source.width, 360));
    const height = Math.max(1, finite(source.height, 260));
    const viewportWidth = Math.max(16, finite(view.width, width + 16));
    const viewportHeight = Math.max(16, finite(view.height, height + 16));
    const maxLeft = Math.max(8, viewportWidth - width - 8);
    const maxTop = Math.max(8, viewportHeight - height - 8);
    return {
      left: Math.round(clamp(source.left, 8, maxLeft, 8)),
      top: Math.round(clamp(source.top, 8, maxTop, 8))
    };
  }

  return Object.freeze({
    SETTINGS_KEY,
    PRICING_BASES,
    SORT_MODES,
    DEFAULT_SETTINGS,
    normalizeSettings,
    loadSettings,
    saveSettings,
    pricingBasisLabel,
    sortRows,
    clampPanelPosition
  });
}));
