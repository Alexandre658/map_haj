/**
 * Cliente HTTP Places — Moveme `/api/places/*`.
 * Auth: header `x-api-key` (não hardcodar Google key).
 */

import {
  hasValidCoords,
  normalizePlace,
  parseDetailsResponse,
  parseSearchResponse
} from './places-model.js';

export class PlacesSearchClient {
  /**
   * @param {{ baseUrl: string, apiKey?: string, country?: string, language?: string, radius?: number, maxResults?: number, exportPageSize?: number, exportMaxPages?: number }} config
   */
  constructor(config) {
    this.config = config;
  }

  get baseUrl() {
    return String(this.config.baseUrl || '').replace(/\/$/, '');
  }

  _headers() {
    const h = { Accept: 'application/json' };
    if (this.config.apiKey) h['x-api-key'] = this.config.apiKey;
    return h;
  }

  async _get(path, params = {}, { signal, timeoutMs = 25000 } = {}) {
    const url = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') continue;
      url.searchParams.set(k, String(v));
    }

    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: this._headers(),
        signal: ctrl.signal
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Places API ${res.status}: ${body.slice(0, 200)}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * GET /api/places/search
   * @returns {Promise<import('./places-model.js').MapPlace[]>}
   */
  async search({
    query,
    lat,
    lng,
    country = this.config.country || 'ao',
    radius = this.config.radius ?? 50,
    maxResults = this.config.maxResults ?? 20,
    language = this.config.language,
    type,
    location,
    forceGoogle,
    signal
  } = {}) {
    const q = String(query || '').trim();
    if (!q) return [];

    const params = {
      query: q,
      country: String(country).trim().toLowerCase(),
      radius: radius ?? 50
    };
    if (maxResults != null) params.maxResults = maxResults;
    if (language) params.language = language;
    if (type) params.type = type;
    if (location) params.location = location;
    if (lat != null) params.lat = lat;
    if (lng != null) params.lng = lng;
    if (forceGoogle === true) params.forceGoogle = 'true';

    const json = await this._get('/api/places/search', params, { signal });
    return parseSearchResponse(json);
  }

  /** GET /api/places/details/:placeId */
  async details(placeId, { signal } = {}) {
    if (!placeId) return null;
    const json = await this._get(
      `/api/places/details/${encodeURIComponent(placeId)}`,
      {},
      { signal }
    );
    return parseDetailsResponse(json);
  }

  /** GET /api/places/coordinates */
  async fromCoordinates({ lat, lng, maxResults = 1, signal } = {}) {
    const json = await this._get(
      '/api/places/coordinates',
      { lat, lng, maxResults },
      { signal }
    );
    const list = parseSearchResponse(json);
    if (list.length) return list[0];
    if (json?.place) return normalizePlace(json.place);
    return null;
  }

  /** GET /api/places/nearby */
  async nearby({ lat, lng, radius, maxResults, type, keyword, signal } = {}) {
    const json = await this._get(
      '/api/places/nearby',
      { lat, lng, radius, maxResults, type, keyword },
      { signal }
    );
    return parseSearchResponse(json);
  }

  /**
   * Sync paginado GET /api/places/export → lista de MapPlace.
   * pageSize fallback 500 → 250 → 100.
   */
  async syncExportCache({
    country = this.config.country || 'ao',
    pageSize = this.config.exportPageSize || 500,
    maxPages = this.config.exportMaxPages || 40,
    onProgress
  } = {}) {
    const sizes = [pageSize, 250, 100].filter(
      (v, i, a) => a.indexOf(v) === i && v > 0
    );
    let lastError = null;

    for (const size of sizes) {
      try {
        const places = await this._fetchAllExportPages({
          country,
          pageSize: size,
          maxPages,
          onProgress
        });
        return places;
      } catch (err) {
        lastError = err;
        console.warn(`[PlacesClient] export pageSize=${size} falhou:`, err);
      }
    }
    throw lastError || new Error('Export falhou');
  }

  async _fetchAllExportPages({ country, pageSize, maxPages, onProgress }) {
    const all = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const json = await this._get(
        '/api/places/export',
        { page, pageSize, country },
        { timeoutMs: 25000 }
      );

      const batch = Array.isArray(json.places)
        ? json.places.map(normalizePlace).filter(Boolean)
        : parseSearchResponse(json);

      all.push(...batch);
      hasMore = Boolean(json.hasMore);
      if (typeof onProgress === 'function') {
        onProgress({ page, total: all.length, hasMore });
      }
      if (!batch.length && !hasMore) break;
      page += 1;
    }
    return all;
  }

  /** Se faltar geometria, tenta details. */
  async ensureCoords(place, { signal } = {}) {
    if (hasValidCoords(place)) return place;
    if (!place?.placeId) return place;
    try {
      const detailed = await this.details(place.placeId, { signal });
      if (detailed && hasValidCoords(detailed)) {
        return { ...place, ...detailed, name: place.name || detailed.name };
      }
    } catch (err) {
      console.warn('[PlacesClient] details fallback:', err);
    }
    return place;
  }
}
