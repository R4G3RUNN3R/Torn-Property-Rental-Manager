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
    const controls = row.querySelector('[data-role="v034-card-controls"]') || row;
    const legacy = controls.querySelector('[data-role="v035-update-progress"]');
    if (legacy) {
      legacy.dataset.v039Hidden = '1';
      legacy.style.display = 'none';
    }

    let progress = controls.querySelector('[data-role="v039-market-page-progress"]');
    if (!progress) {
      progress = documentLike.createElement('div');
      progress.dataset.role = 'v039-market-page-progress';
      progress.style.flexBasis = '100%';
      progress.style.display = 'grid';
      progress.style.gap = '4px';

      const label = documentLike.createElement('small');
      label.dataset.role = 'v039-market-page-progress-label';

      const track = documentLike.createElement('div');
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-label', 'Rental market page progress');
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', '100');
      track.style.height = '7px';
      track.style.border = '1px solid currentColor';
      track.style.borderRadius = '999px';
      track.style.overflow = 'hidden';
      track.style.opacity = '0.85';

      const fill = documentLike.createElement('div');
      fill.dataset.role = 'v039-market-page-progress-fill';
      fill.style.height = '100%';
      fill.style.background = 'currentColor';
      fill.style.transition = 'width 120ms linear';
      track.appendChild(fill);
      progress.append(label, track);
      controls.appendChild(progress);
    }

    const percent = pagePercent(entry);
    const label = progress.querySelector('[data-role="v039-market-page-progress-label"]');
    const track = progress.querySelector('[role="progressbar"]');
    const fill = progress.querySelector('[data-role="v039-market-page-progress-fill"]');
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

  function clearPageProgress(documentLike, propertyId) {
    if (!documentLike || typeof documentLike.querySelector !== 'function') return;
    const id = Number(propertyId);
    if (!Number.isInteger(id) || id <= 0) return;
    const row = documentLike.querySelector(`[data-property-id="${id}"]`);
    if (!row) return;
    const progress = row.querySelector('[data-role="v039-market-page-progress"]');
    if (progress && progress.parentNode) progress.remove();
    const legacy = row.querySelector('[data-role="v035-update-progress"][data-v039-hidden="1"]');
    if (legacy) {
      legacy.style.display = '';
      delete legacy.dataset.v039Hidden;
    }
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
        const originalProgress = typeof scanOptions.onProgress === 'function'
          ? scanOptions.onProgress
          : null;

        scanOptions.onPageProgress = entry => {
          if (originalPageProgress) originalPageProgress(entry);
          if (propertyId > 0) renderPageProgress(documentLike, propertyId, entry);
        };
        if (originalProgress) {
          scanOptions.onProgress = entry => {
            originalProgress(entry);
            if (propertyId > 0) clearPageProgress(documentLike, propertyId);
          };
        }

        const result = client.scanMarkets(properties, scanOptions);
        if (!result || typeof result.finally !== 'function' || propertyId <= 0) return result;
        return result.finally(() => clearPageProgress(documentLike, propertyId));
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
    clearPageProgress,
    wrapApiClient,
    createController
  }));
}));
