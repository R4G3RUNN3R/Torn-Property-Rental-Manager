(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function asPositiveInt(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  }

  function normalizeModifications(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
      .map(item => typeof item === 'string' ? item : item && item.name)
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean))];
  }

  function normalizeStatus(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function normalizeProperty(raw, currentUserId) {
    if (!raw || typeof raw !== 'object') return null;

    const ownerId = String(
      (raw.owner && raw.owner.id) != null ? raw.owner.id :
      raw.owner_id != null ? raw.owner_id : ''
    );

    if (currentUserId != null && ownerId && ownerId !== String(currentUserId)) {
      return null;
    }

    const property = raw.property && typeof raw.property === 'object' ? raw.property : {};

    return {
      id: asPositiveInt(raw.id != null ? raw.id : raw.property_id),
      propertyTypeId: asPositiveInt(
        property.id != null ? property.id :
        raw.property_type_id != null ? raw.property_type_id : raw.type_id
      ),
      name: String(property.name != null ? property.name : raw.name != null ? raw.name : 'Unknown property'),
      ownerId,
      happy: Number(raw.happy != null ? raw.happy : property.happy != null ? property.happy : 0) || 0,
      status: normalizeStatus(raw.status),
      modifications: normalizeModifications(raw.modifications),
      raw
    };
  }

  function normalizeProperties(rows, currentUserId) {
    if (!Array.isArray(rows)) return [];
    return rows
      .map(row => normalizeProperty(row, currentUserId))
      .filter(Boolean);
  }

  function isEligibleForLease(property) {
    return normalizeStatus(property && property.status) === 'none';
  }

  function leaseUrl(propertyId) {
    const id = asPositiveInt(propertyId);
    if (!id) throw new TypeError('A positive property ID is required');
    return `https://www.torn.com/properties.php#/p=options&ID=${id}&tab=lease`;
  }

  function uniquePropertyTypeIds(properties) {
    if (!Array.isArray(properties)) return [];
    return [...new Set(properties
      .map(property => asPositiveInt(property && property.propertyTypeId))
      .filter(Boolean))]
      .sort((a, b) => a - b);
  }

  return Object.freeze({
    normalizeProperty,
    normalizeProperties,
    isEligibleForLease,
    leaseUrl,
    uniquePropertyTypeIds
  });
}));
