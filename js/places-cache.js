/**
 * Cache local: export `/api/places/export` + histórico de selecções + cache API em memória.
 */

import { normalizePlace, placeKey } from './places-model.js';
import { matchesSearchQuery } from './places-utils.js';

const EXPORT_KEY = 'places_local_cache';
const LAST_SYNC_KEY = 'places_last_sync';
const HISTORY_KEY = 'places_history';

const API_CACHE_TTL_MS = 5 * 60 * 1000;
const API_CACHE_MAX = 50;

export class PlacesLocalCache {
  constructor({ historyLimit = 20 } = {}) {
    this.historyLimit = historyLimit;
    /** @type {import('./places-model.js').MapPlace[]|null} */
    this._exportMemory = null;
    /** @type {Map<string, { results: import('./places-model.js').MapPlace[], ts: number }>} */
    this._apiCache = new Map();
  }

  // ── Export ──────────────────────────────────────────────────────

  loadExport() {
    if (this._exportMemory) return this._exportMemory;
    try {
      const raw = localStorage.getItem(EXPORT_KEY);
      if (!raw) {
        this._exportMemory = [];
        return this._exportMemory;
      }
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed?.places || [];
      this._exportMemory = list.map(normalizePlace).filter(Boolean);
    } catch {
      this._exportMemory = [];
    }
    return this._exportMemory;
  }

  saveExport(places) {
    const list = (places || []).map(normalizePlace).filter(Boolean);
    this._exportMemory = list;
    try {
      localStorage.setItem(EXPORT_KEY, JSON.stringify(list));
      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    } catch (err) {
      console.warn('[PlacesCache] Falha ao gravar export (quota?):', err);
    }
  }

  lastSyncMs() {
    const v = Number(localStorage.getItem(LAST_SYNC_KEY) || 0);
    return Number.isFinite(v) ? v : 0;
  }

  needsSync(hoursThreshold = 24) {
    const last = this.lastSyncMs();
    if (!last) return true;
    const ageH = (Date.now() - last) / (1000 * 60 * 60);
    return ageH >= hoursThreshold;
  }

  searchExport(query, limit = 30) {
    const q = String(query || '').trim();
    if (!q) return [];
    const all = this.loadExport();
    const hits = [];
    for (const p of all) {
      if (matchesSearchQuery(p, q)) {
        hits.push(p);
        if (hits.length >= limit) break;
      }
    }
    return hits;
  }

  // ── Histórico ───────────────────────────────────────────────────

  loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return (Array.isArray(list) ? list : []).map(normalizePlace).filter(Boolean);
    } catch {
      return [];
    }
  }

  saveHistory(places) {
    try {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(places.slice(0, this.historyLimit))
      );
    } catch (err) {
      console.warn('[PlacesCache] Falha ao gravar histórico:', err);
    }
  }

  searchHistory(query) {
    const all = this.loadHistory();
    const q = String(query || '').trim();
    if (!q) return all.slice(0, this.historyLimit);
    return all.filter((p) => matchesSearchQuery(p, q));
  }

  pushHistory(place) {
    const n = normalizePlace(place);
    if (!n) return;
    const key = placeKey(n);
    const next = [n, ...this.loadHistory().filter((p) => placeKey(p) !== key)];
    this.saveHistory(next);
  }

  // ── Cache API memória ───────────────────────────────────────────

  getApiCache(cacheKey) {
    const hit = this._apiCache.get(cacheKey);
    if (!hit) return null;
    if (Date.now() - hit.ts > API_CACHE_TTL_MS) {
      this._apiCache.delete(cacheKey);
      return null;
    }
    return hit.results;
  }

  setApiCache(cacheKey, results) {
    this._apiCache.set(cacheKey, { results, ts: Date.now() });
    if (this._apiCache.size > API_CACHE_MAX) {
      const oldest = [...this._apiCache.entries()].sort(
        (a, b) => a[1].ts - b[1].ts
      )[0];
      if (oldest) this._apiCache.delete(oldest[0]);
    }
  }
}
