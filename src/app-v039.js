(function (root, factory) {
  const baseApp = typeof module === 'object' && module.exports ? require('./app-v038') : root.R4G3PropertyRentalApp;
  const api = factory(baseApp);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (baseApp) {
  'use strict';

  if (!baseApp) throw new Error('v0.3.9 app dependency is unavailable');

  function pagePercent(entry) {
    const donePages = Math.max(0, Number(entry && entry.donePages) || 0);
    const totalPages = Math.max(0, Number(entry && entry.totalPages) || 0);
    if (totalPages > 0) {
      return Math.max(36, Math.min(90, Math.round(35 + (donePages / totalPages) * 55)));
    }
    return Math.max(36, Math.min(90, 35 + donePages * 5));
  }

  function pageLabel(entry, percent) {
    const donePages = Math.max(0, Number(entry && entry.donePages) || 0);
    const totalPages = Math.max(0, Number(entry && entry.totalPages) || 0);
    const rowsDone = Math.max(0, Number(entry && entry.rowsDone) || 0);
    const totalRows = Math.max(0, Number(entry && entry.totalRows) || 0);
    const pageText = totalPages > 0 ? `page ${donePages} / ${totalPages}` : `page ${donePages}`;
    const rowsText = totalRows > 0 ? ` • ${rowsDone} / ${totalRows} listings` : rowsDone > 0 ? ` • ${rowsDone} listings` : '';
    return `Searching rental market… ${pageText}${rowsText} ${Math.round(percent)}%`;
  }

  function renderPageProgress(documentLike, propertyId, entry) {
    if (!documentLike || typeof documentLike.querySelector !== 'function') return false;
    const id = Number(propertyId);
    if (!Number.isInteger(id) || id <= 0) return false;
    const row = documentLike.querySelector(`[data-property-id="${id}"]`);
    if (!row) return false;
    const progress = row.querySelector('[data-role="v035-update-progress"]');
    if (!progress) return false;
    const label = progress.querySelector('[data-role="v035-update-progress-label"]');
    const track = progress.querySelector('[role="progressbar"]');
    const fill = progress.querySelector('[data-role="v035-update-progress-fill"]');
    const percent = pagePercent(entry);
    if (label) label.textContent = pageLabel(entry, percent);
    if (track) {
      track.setAttribute('aria-valuenow', String(Math.round(percent)));
      const donePages = Math.max(0, Number(entry && entry.donePages) || 0);
      const totalPages = Math.max(0, Number(entry && entry.totalPages) || 0);
      track.setAttribute('aria-valuetext', totalPages > 0 ? `${donePages} of ${totalPages} rental-market pages` : `${donePages} rental-market pages`);
    }
    if (fill) fill.style.width = `${percent}%`;
    return true;
  }

  function wrapApiClient(client, documentLike) {
    if (!client || typeof client.scanMarkets !== 'function') return client;
    return Object.assign({}, client, {
      scanMarkets(properties, options) {
        const scanOptions = Object.assign({}, options || {});
        const source = Array.isArray(properties) ? properties : [];
        const propertyId = source.length === 1 ? Number(source[0] && source[0].id) : 0;
        const originalPageProgress = typeof scanOptions.onPageProgress === 'function'
          ? scanOptions.onPageProgress
          : null;
        scanOptions.onPageProgress = entry => {
          if (originalPageProgress) originalPageProgress(entry);
          if (propertyId > 0) renderPageProgress(documentLike, propertyId, entry);
        };
        return client.scanMarkets(properties, scanOptions);
      }
    });
  }

  function createController(options) {
    const config = Object.assign({}, options || {});
    const documentLike = config.document;
    if (!documentLike) throw new TypeError('document is required');

    if (config.apiClient) config.apiClient = wrapApiClient(config.apiClient, documentLike);
    if (typeof config.apiClientFactory === 'function') {
      const factory = config.apiClientFactory;
      config.apiClientFactory = apiKey => wrapApiClient(factory(apiKey), documentLike);
    }

    return baseApp.createController(config);
  }

  return Object.freeze(Object.assign({}, baseApp, {
    pagePercent,
    pageLabel,
    renderPageProgress,
    wrapApiClient,
    createController
  }));
}));
