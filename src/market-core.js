(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3MarketCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function stringSet(values) {
    if (!Array.isArray(values)) return new Set();
    return new Set(values
      .map(value => typeof value === 'string' ? value : value && value.name)
      .map(value => typeof value === 'string' ? value.trim() : '')
      .filter(Boolean));
  }

  function normalizeRental(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      id: number(source.id != null ? source.id : source.rental_id, 0),
      happy: number(source.happy, 0),
      cost: number(source.cost, 0),
      cost_per_day: number(source.cost_per_day != null ? source.cost_per_day : source.costPerDay, 0),
      rental_period: number(source.rental_period != null ? source.rental_period : source.rentalPeriod, 0),
      market_price: number(source.market_price != null ? source.market_price : source.marketPrice, 0),
      upkeep: number(source.upkeep, 0),
      modifications: [...stringSet(source.modifications)],
      raw: source
    };
  }

  function happySimilarity(ownedHappy, listingHappy) {
    const owned = Math.max(0, number(ownedHappy, 0));
    const listing = Math.max(0, number(listingHappy, 0));
    if (owned === 0 && listing === 0) return 1;
    const denominator = Math.max(owned, 1);
    return Math.max(0, 1 - Math.abs(listing - owned) / denominator);
  }

  function modificationSimilarity(a, b) {
    const setA = stringSet(a);
    const setB = stringSet(b);
    if (setA.size === 0 && setB.size === 0) return 1;

    let intersection = 0;
    for (const value of setA) {
      if (setB.has(value)) intersection += 1;
    }
    const union = new Set([...setA, ...setB]).size;
    return union ? intersection / union : 1;
  }

  function exactModificationMatch(a, b) {
    const setA = stringSet(a);
    const setB = stringSet(b);
    if (setA.size !== setB.size) return false;
    for (const value of setA) {
      if (!setB.has(value)) return false;
    }
    return true;
  }

  function similarity(owned, listing) {
    const happyScore = happySimilarity(owned && owned.happy, listing && listing.happy);
    const modificationScore = modificationSimilarity(
      owned && owned.modifications,
      listing && listing.modifications
    );
    return happyScore * 0.7 + modificationScore * 0.3;
  }

  function withSimilarity(owned, listings) {
    return (Array.isArray(listings) ? listings : [])
      .map(normalizeRental)
      .map(row => Object.assign(row, { _similarity: similarity(owned || {}, row) }))
      .sort((a, b) => b._similarity - a._similarity || a.cost_per_day - b.cost_per_day || a.id - b.id);
  }

  function selectComparables(owned, listings) {
    const scored = withSimilarity(owned, listings);
    let selected = scored.filter(row => row._similarity >= 0.90);
    if (selected.length < 5) selected = scored.filter(row => row._similarity >= 0.75);
    if (selected.length < 5) selected = scored.slice(0, 10);
    return selected.slice(0, 30);
  }

  function percentile(sortedValues, p) {
    if (!sortedValues.length) return null;
    if (sortedValues.length === 1) return sortedValues[0];
    const index = (sortedValues.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sortedValues[lower];
    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  function integerMedian(sortedValues) {
    if (!sortedValues.length) return null;
    const middle = Math.floor(sortedValues.length / 2);
    if (sortedValues.length % 2) return Math.floor(sortedValues[middle]);
    return Math.floor((sortedValues[middle - 1] + sortedValues[middle]) / 2);
  }

  function rawMedian(sortedValues) {
    if (!sortedValues.length) return null;
    const middle = Math.floor(sortedValues.length / 2);
    if (sortedValues.length % 2) return sortedValues[middle];
    return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
  }

  function cleanPriceRows(rows) {
    const usable = rows
      .filter(row => number(row.cost_per_day, 0) > 0)
      .sort((a, b) => a.cost_per_day - b.cost_per_day);

    if (usable.length < 4) return usable;

    const prices = usable.map(row => row.cost_per_day);
    const q1 = percentile(prices, 0.25);
    const q3 = percentile(prices, 0.75);
    const iqr = q3 - q1;
    const min = q1 - 1.5 * iqr;
    const max = q3 + 1.5 * iqr;
    const trimmed = usable.filter(row => row.cost_per_day >= min && row.cost_per_day <= max);
    return trimmed.length >= 3 ? trimmed : usable;
  }

  function marketStats(owned, listings, settings) {
    const options = Object.assign({
      undercutPercent: 0.5,
      minimumMedianRatio: 0.70
    }, settings || {});

    const selected = selectComparables(owned || {}, listings || []);
    const cleaned = cleanPriceRows(selected);

    if (!cleaned.length) {
      return {
        marketFloor: null,
        q1: null,
        median: null,
        q3: null,
        sampleSize: 0,
        averageSimilarity: 0,
        suggestedDaily: null,
        confidence: 'Low',
        comparableIds: []
      };
    }

    const prices = cleaned.map(row => row.cost_per_day).sort((a, b) => a - b);
    const marketFloor = Math.floor(prices[0]);
    const q1 = percentile(prices, 0.25);
    const q3 = percentile(prices, 0.75);
    const median = integerMedian(prices);
    const averageSimilarity = cleaned.reduce((sum, row) => sum + row._similarity, 0) / cleaned.length;
    const undercutPercent = Math.max(0, number(options.undercutPercent, 0.5));
    const minimumMedianRatio = Math.max(0, number(options.minimumMedianRatio, 0.70));
    const undercutPrice = Math.floor(marketFloor * (1 - undercutPercent / 100));
    const safetyPrice = Math.floor(median * minimumMedianRatio);
    const suggestedDaily = Math.max(1, undercutPrice, safetyPrice);

    let confidence = 'Low';
    if (cleaned.length >= 8 && averageSimilarity >= 0.90) confidence = 'High';
    else if (cleaned.length >= 5 && averageSimilarity >= 0.75) confidence = 'Medium';

    return {
      marketFloor,
      q1,
      median,
      q3,
      sampleSize: cleaned.length,
      averageSimilarity,
      suggestedDaily,
      confidence,
      comparableIds: cleaned.map(row => row.id)
    };
  }

  function filterEquivalentPriceRows(rows) {
    const ordered = (Array.isArray(rows) ? rows : [])
      .slice()
      .sort((a, b) => a.equivalentTotal - b.equivalentTotal || a.id - b.id);

    if (!ordered.length) {
      return { rows: [], sampleStatus: 'no_exact_matches', outlierCount: 0 };
    }
    if (ordered.length === 1) {
      return { rows: [], sampleStatus: 'insufficient_market_sample', outlierCount: 0 };
    }
    if (ordered.length === 2) {
      const low = ordered[0].equivalentTotal;
      const high = ordered[1].equivalentTotal;
      if (high / low > 5) {
        return { rows: [], sampleStatus: 'price_data_too_inconsistent', outlierCount: 0 };
      }
      return { rows: ordered, sampleStatus: 'ok', outlierCount: 0 };
    }

    const totals = ordered.map(row => row.equivalentTotal);
    const median = rawMedian(totals);
    const medianMin = median / 5;
    const medianMax = median * 5;
    let trusted = ordered.filter(row => row.equivalentTotal >= medianMin && row.equivalentTotal <= medianMax);

    if (trusted.length >= 4) {
      const guardedTotals = trusted.map(row => row.equivalentTotal).sort((a, b) => a - b);
      const q1 = percentile(guardedTotals, 0.25);
      const q3 = percentile(guardedTotals, 0.75);
      const iqr = q3 - q1;
      const min = q1 - 1.5 * iqr;
      const max = q3 + 1.5 * iqr;
      trusted = trusted.filter(row => row.equivalentTotal >= min && row.equivalentTotal <= max);
    }

    const outlierCount = ordered.length - trusted.length;
    if (trusted.length < 2) {
      return { rows: trusted, sampleStatus: 'price_data_too_inconsistent', outlierCount };
    }
    return { rows: trusted, sampleStatus: 'ok', outlierCount };
  }

  function emptyRentalQuote(targetDays, pricingBasis, exactMatches, filtered) {
    const trusted = filtered && Array.isArray(filtered.rows) ? filtered.rows : [];
    return {
      targetDays,
      exactMatchCount: exactMatches.length,
      usedMatchCount: trusted.length,
      outlierCount: filtered ? filtered.outlierCount : 0,
      sampleStatus: filtered ? filtered.sampleStatus : 'no_exact_matches',
      lowestTotal: null,
      medianTotal: null,
      highestTotal: null,
      averageTotal: null,
      pricingBasis,
      pricingBaseTotal: null,
      proposedTotal: null,
      exactMatches,
      trustedMatches: trusted
    };
  }

  function rentalQuote(owned, listings, settings) {
    const options = Object.assign({
      targetDays: 100,
      undercutPercent: 0.5,
      pricingBasis: 'average'
    }, settings || {});
    const targetDays = Math.max(1, Math.floor(number(options.targetDays, 100)) || 100);
    const undercutPercent = Math.max(0, number(options.undercutPercent, 0.5));
    const pricingBasis = ['lowest', 'median', 'average', 'highest'].includes(options.pricingBasis)
      ? options.pricingBasis
      : 'average';
    const rows = (Array.isArray(listings) ? listings : [])
      .map(normalizeRental)
      .filter(row => exactModificationMatch(owned && owned.modifications, row.modifications))
      .filter(row => row.cost > 0 && row.rental_period > 0)
      .map(row => Object.assign({}, row, {
        equivalentTotal: row.cost / row.rental_period * targetDays
      }));

    const filtered = filterEquivalentPriceRows(rows);
    if (filtered.sampleStatus !== 'ok') {
      return emptyRentalQuote(targetDays, pricingBasis, rows, filtered);
    }

    const trustedRows = filtered.rows;
    const totals = trustedRows.map(row => row.equivalentTotal).sort((a, b) => a - b);
    const rawAverage = totals.reduce((sum, value) => sum + value, 0) / totals.length;
    const rawBases = {
      lowest: totals[0],
      median: rawMedian(totals),
      average: rawAverage,
      highest: totals[totals.length - 1]
    };
    const lowestTotal = Math.floor(rawBases.lowest);
    const medianTotal = Math.floor(rawBases.median);
    const averageTotal = Math.floor(rawBases.average);
    const highestTotal = Math.floor(rawBases.highest);
    const displayedBases = {
      lowest: lowestTotal,
      median: medianTotal,
      average: averageTotal,
      highest: highestTotal
    };
    const pricingBaseTotal = displayedBases[pricingBasis];
    const rawPricingBase = rawBases[pricingBasis];
    const multiplier = Math.max(0, 1 - undercutPercent / 100);

    return {
      targetDays,
      exactMatchCount: rows.length,
      usedMatchCount: trustedRows.length,
      outlierCount: filtered.outlierCount,
      sampleStatus: filtered.sampleStatus,
      lowestTotal,
      medianTotal,
      highestTotal,
      averageTotal,
      pricingBasis,
      pricingBaseTotal,
      proposedTotal: Math.floor(rawPricingBase * multiplier),
      exactMatches: rows,
      trustedMatches: trustedRows
    };
  }

  return Object.freeze({
    normalizeRental,
    happySimilarity,
    modificationSimilarity,
    exactModificationMatch,
    similarity,
    selectComparables,
    marketStats,
    filterEquivalentPriceRows,
    rentalQuote
  });
}));
