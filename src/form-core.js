(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3FormCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  }

  function inputIntegerValue(input) {
    const raw = String(input && input.value != null ? input.value : '').trim();
    if (!raw) return 0;
    const digits = raw.replace(/[^0-9]/g, '');
    return positiveInteger(digits);
  }

  function parseLeasePropertyId(locationLike) {
    const hash = String(locationLike && locationLike.hash || '');
    if (!hash.includes('p=options') || !hash.includes('tab=lease')) return null;
    const match = hash.match(/[?&#]ID=(\d+)/i);
    const id = match ? positiveInteger(match[1]) : 0;
    return id || null;
  }

  function findLeaseForm(documentLike) {
    if (!documentLike || typeof documentLike.querySelector !== 'function') return null;
    const root = documentLike.querySelector('#market ul.lease-input');
    if (!root) return null;

    const daysInput = root.querySelector('li.amount input.input-money:not([type="hidden"])');
    const costInput = root.querySelector('li.cost input.lease.input-money:not([type="hidden"])') ||
      root.querySelector('li.cost input.lease.input-money');

    if (!daysInput || !costInput) return null;
    return { root, daysInput, costInput };
  }

  function findLeaseSubmitButton(documentLike, formRoot) {
    if (!documentLike || typeof documentLike.querySelector !== 'function') return null;
    const root = formRoot || documentLike.querySelector('#market ul.lease-input');
    if (!root) return null;

    const direct = root.querySelector('li.submit button, li.submit input[type="submit"]');
    if (direct) return direct;

    const scope = root.closest && (root.closest('form') || root.closest('section')) || root.parentElement;
    if (!scope || typeof scope.querySelectorAll !== 'function') return null;
    const candidates = [...scope.querySelectorAll('button, input[type="submit"]')];
    return candidates.find(candidate => {
      const text = String(candidate.textContent || candidate.value || '').trim();
      return /^(?:send|offer|submit|next|list property|list)$/i.test(text);
    }) || null;
  }

  function setNativeValue(input, value, windowLike) {
    if (!input) throw new TypeError('Input element is required');
    const win = windowLike || input.ownerDocument && input.ownerDocument.defaultView;
    const prototype = win && win.HTMLInputElement && win.HTMLInputElement.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(input, String(value));
    else input.value = String(value);

    if (win && typeof win.Event === 'function') {
      for (const eventName of ['input', 'change', 'keyup', 'blur']) {
        input.dispatchEvent(new win.Event(eventName, { bubbles: true }));
      }
    }
  }

  function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    return Math.floor(number).toLocaleString('en-US');
  }

  function upsertSummary(formRoot, draft, totalCost) {
    const documentLike = formRoot.ownerDocument;
    let summary = documentLike.querySelector('.r4g3-prm-inline-summary');
    if (!summary) {
      summary = documentLike.createElement('div');
      summary.className = 'r4g3-prm-inline-summary';
      summary.setAttribute('role', 'status');
      formRoot.insertAdjacentElement('afterend', summary);
    }

    const bits = [
      `${draft.days} days`,
      `Total $${money(totalCost)}`
    ];
    if (draft.dailyPrice) bits.unshift(`Approx. $${money(draft.dailyPrice)}/day`);
    if (draft.marketFloor != null) bits.push(`Floor $${money(draft.marketFloor)}/day`);
    if (draft.median != null) bits.push(`Median $${money(draft.median)}/day`);
    if (draft.confidence) bits.push(`Confidence ${draft.confidence}`);

    summary.textContent = bits.join(' • ');
    return summary;
  }

  function draftLeaseValues(draft) {
    if (!draft || typeof draft !== 'object') return null;
    const days = positiveInteger(draft.days);
    const suppliedTotal = positiveInteger(draft.totalCost);
    const suppliedDaily = positiveInteger(draft.dailyPrice);
    if (!days || days > 365 || (!suppliedTotal && !suppliedDaily)) return null;
    const totalCost = suppliedTotal || days * suppliedDaily;
    const dailyPrice = suppliedDaily || Math.max(1, Math.floor(totalCost / days));
    return { days, totalCost, dailyPrice };
  }

  function prepareLeaseForm(options) {
    const config = options || {};
    const documentLike = config.document;
    const windowLike = config.window;
    const locationLike = config.location || windowLike && windowLike.location;
    const draft = config.draft && typeof config.draft === 'object' ? config.draft : null;
    const propertyId = parseLeasePropertyId(locationLike);

    if (!propertyId) return { prepared: false, reason: 'Not a lease route' };
    if (!draft || positiveInteger(draft.propertyId) !== propertyId) {
      return { prepared: false, reason: 'Draft does not match this property' };
    }

    const values = draftLeaseValues(draft);
    if (!values) return { prepared: false, reason: 'Invalid lease draft' };

    const form = findLeaseForm(documentLike);
    if (!form) return { prepared: false, reason: 'Form not recognized' };

    setNativeValue(form.daysInput, values.days, windowLike);
    setNativeValue(form.costInput, values.totalCost, windowLike);
    const summary = upsertSummary(form.root, Object.assign({}, draft, {
      days: values.days,
      dailyPrice: values.dailyPrice
    }), values.totalCost);

    return {
      prepared: true,
      propertyId,
      days: values.days,
      dailyPrice: values.dailyPrice,
      totalCost: values.totalCost,
      form,
      summary
    };
  }

  function verifyPreparedLeaseForm(options) {
    const config = options || {};
    const documentLike = config.document;
    const windowLike = config.window;
    const locationLike = config.location || windowLike && windowLike.location;
    const draft = config.draft && typeof config.draft === 'object' ? config.draft : null;
    const propertyId = parseLeasePropertyId(locationLike);

    if (!propertyId) return { verified: false, reason: 'Not a lease route' };
    if (!draft || positiveInteger(draft.propertyId) !== propertyId) {
      return { verified: false, reason: 'Draft does not match this property' };
    }

    const values = draftLeaseValues(draft);
    if (!values) return { verified: false, reason: 'Invalid lease draft' };

    const form = findLeaseForm(documentLike);
    if (!form) return { verified: false, reason: 'Form not recognized' };

    const actualDays = inputIntegerValue(form.daysInput);
    const actualTotalCost = inputIntegerValue(form.costInput);
    if (actualDays !== values.days || actualTotalCost !== values.totalCost) {
      return {
        verified: false,
        reason: 'Prepared lease values changed; press PREPARE RENTAL again',
        propertyId,
        expectedDays: values.days,
        expectedTotalCost: values.totalCost,
        actualDays,
        actualTotalCost,
        form
      };
    }

    return {
      verified: true,
      propertyId,
      days: values.days,
      dailyPrice: values.dailyPrice,
      totalCost: values.totalCost,
      form
    };
  }

  function submitLeaseFromUserGesture(options) {
    const config = options || {};
    const documentLike = config.document;
    const windowLike = config.window;
    const locationLike = config.location || windowLike && windowLike.location;
    const draft = config.draft && typeof config.draft === 'object' ? config.draft : null;

    const verified = verifyPreparedLeaseForm({
      document: documentLike,
      window: windowLike,
      location: locationLike,
      draft
    });
    if (!verified.verified) return { submitted: false, reason: verified.reason };

    const submitButton = findLeaseSubmitButton(documentLike, verified.form.root);
    if (!submitButton) return { submitted: false, reason: 'Submit control not recognized' };
    if (submitButton.disabled || submitButton.getAttribute && submitButton.getAttribute('aria-disabled') === 'true') {
      return { submitted: false, reason: 'Submit control is disabled' };
    }

    submitButton.click();
    return {
      submitted: true,
      propertyId: verified.propertyId,
      days: verified.days,
      totalCost: verified.totalCost
    };
  }

  function compactText(node) {
    return String(
      node && (node.textContent || node.value) ||
      node && node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title')) || ''
    ).replace(/\s+/g, ' ').trim();
  }

  function isInsideManager(node) {
    return Boolean(node && node.closest && node.closest('#r4g3-prm-panel, #r4g3-prm-settings-window'));
  }

  function isDialogContainer(node) {
    return Boolean(node && node.closest && node.closest('dialog, [role="dialog"], [aria-modal="true"]'));
  }

  function findRentalCancelButton(documentLike) {
    if (!documentLike || typeof documentLike.querySelectorAll !== 'function') return null;
    const candidates = [...documentLike.querySelectorAll('button, a, input[type="button"], input[type="submit"]')];
    return candidates.find(candidate => {
      if (isInsideManager(candidate) || isDialogContainer(candidate)) return false;
      const text = compactText(candidate);
      return /remove\s+(?:this\s+)?(?:property\s+)?from\s+(?:the\s+)?market/i.test(text) ||
        /(?:remove|cancel|withdraw)\s+(?:rental\s+)?listing/i.test(text) ||
        /^delist$/i.test(text);
    }) || null;
  }

  function canCancelRentalListing(options) {
    const config = options || {};
    const propertyId = positiveInteger(config.propertyId);
    const routeId = parseLeasePropertyId(config.location);
    if (!propertyId || routeId !== propertyId) return false;
    const button = findRentalCancelButton(config.document);
    if (!button || button.disabled) return false;
    if (button.getAttribute && button.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }

  function cancelRentalListingFromUserGesture(options) {
    const config = options || {};
    const propertyId = positiveInteger(config.propertyId);
    const routeId = parseLeasePropertyId(config.location);
    if (!propertyId || routeId !== propertyId) {
      return { submitted: false, reason: 'Matching rental listing route is not ready' };
    }
    const button = findRentalCancelButton(config.document);
    if (!button) return { submitted: false, reason: 'Remove from market control not recognized' };
    if (button.disabled || button.getAttribute && button.getAttribute('aria-disabled') === 'true') {
      return { submitted: false, reason: 'Remove from market control is disabled' };
    }
    button.click();
    return { submitted: true, propertyId };
  }

  function cancellationDialogText(node) {
    return compactText(node).toLowerCase();
  }

  function isRentalCancellationDialog(node) {
    if (!node || isInsideManager(node)) return false;
    const text = cancellationDialogText(node);
    const removeMarket = /remove.{0,80}(?:property|rental|listing).{0,80}(?:market)/i.test(text) ||
      /(?:property|rental|listing).{0,80}remove.{0,80}(?:market)/i.test(text) ||
      /remove.{0,80}from.{0,30}market/i.test(text);
    const confirmation = /are you sure|confirm|confirmation|yes|remove/i.test(text);
    return removeMarket && confirmation;
  }

  function findRentalCancelConfirmationButton(documentLike) {
    if (!documentLike || typeof documentLike.querySelectorAll !== 'function') return null;
    const explicitDialogs = [...documentLike.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"]')];
    const dialogs = explicitDialogs.filter(isRentalCancellationDialog);
    for (const dialog of dialogs) {
      const candidates = [...dialog.querySelectorAll('button, a, input[type="button"], input[type="submit"]')];
      const button = candidates.find(candidate => {
        if (isInsideManager(candidate)) return false;
        const text = compactText(candidate);
        if (/^(?:no|cancel|back|close)$/i.test(text)) return false;
        return /^(?:yes|confirm|ok|okay)$/i.test(text) ||
          /(?:confirm|remove).{0,40}(?:property|listing|market)/i.test(text) ||
          /remove\s+(?:this\s+)?(?:property\s+)?from\s+(?:the\s+)?market/i.test(text);
      });
      if (button) return button;
    }
    return null;
  }

  function canConfirmRentalCancellation(options) {
    const config = options || {};
    const propertyId = positiveInteger(config.propertyId);
    const routeId = parseLeasePropertyId(config.location);
    if (!propertyId || routeId !== propertyId) return false;
    const button = findRentalCancelConfirmationButton(config.document);
    if (!button || button.disabled) return false;
    if (button.getAttribute && button.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }

  function confirmRentalCancellationFromUserGesture(options) {
    const config = options || {};
    const propertyId = positiveInteger(config.propertyId);
    const routeId = parseLeasePropertyId(config.location);
    if (!propertyId || routeId !== propertyId) {
      return { submitted: false, reason: 'Matching rental listing route is not ready' };
    }
    const button = findRentalCancelConfirmationButton(config.document);
    if (!button) return { submitted: false, reason: 'Rental cancellation confirmation not recognized' };
    if (button.disabled || button.getAttribute && button.getAttribute('aria-disabled') === 'true') {
      return { submitted: false, reason: 'Rental cancellation confirmation is disabled' };
    }
    button.click();
    return { submitted: true, propertyId };
  }

  return Object.freeze({
    parseLeasePropertyId,
    findLeaseForm,
    findLeaseSubmitButton,
    setNativeValue,
    verifyPreparedLeaseForm,
    prepareLeaseForm,
    submitLeaseFromUserGesture,
    findRentalCancelButton,
    canCancelRentalListing,
    cancelRentalListingFromUserGesture,
    findRentalCancelConfirmationButton,
    canConfirmRentalCancellation,
    confirmRentalCancellationFromUserGesture
  });
}));
