/**
 * PlacesSearchController — pipeline UI debounce → cache local → API debounce → merge.
 */

import { PlacesLocalCache } from './places-cache.js';
import { hasValidCoords, toUiResult } from './places-model.js';
import {
  filterAndSortPlaces,
  mergePlaces
} from './places-utils.js';

export class PlacesSearchController {
  /**
   * @param {object} opts
   * @param {import('./places-client.js').PlacesSearchClient} opts.client
   * @param {object} opts.config
   * @param {(items: object[], meta?: object) => void} opts.onResults
   * @param {(loading: boolean) => void} [opts.onLoading]
   * @param {() => { lat?: number, lng?: number }} [opts.getBias]
   * @param {(place: object) => void} [opts.onPlaceSelected]
   */
  constructor({
    client,
    config,
    onResults,
    onLoading,
    getBias,
    onPlaceSelected
  }) {
    this.client = client;
    this.config = config;
    this.onResults = onResults;
    this.onLoading = onLoading || (() => {});
    this.getBias = getBias || (() => ({}));
    this.onPlaceSelected = onPlaceSelected || (() => {});

    this.cache = new PlacesLocalCache({
      historyLimit: config.historyLimit || 20
    });

    this._uiTimer = null;
    this._apiTimer = null;
    this._generation = 0;
    this._abort = null;
    this._exportBusy = false;
  }

  /** Boot: sync export se online e fora do intervalo. */
  async bootstrap() {
    if (!this.config.apiKey) return;
    if (!this.cache.needsSync(this.config.syncIntervalHours || 24)) return;
    if (this._exportBusy) return;
    this._exportBusy = true;
    try {
      const places = await this.client.syncExportCache({
        country: this.config.country || 'ao',
        onProgress: (p) => {
          if (p.page === 1 || p.page % 5 === 0) {
            console.info(
              `[Places] export page ${p.page} — ${p.total} lugares`
            );
          }
        }
      });
      this.cache.saveExport(places);
      console.info(`[Places] cache export: ${places.length} lugares`);
    } catch (err) {
      console.warn('[Places] sync export ignorado:', err.message || err);
    } finally {
      this._exportBusy = false;
    }
  }

  /** Debounce UI 200ms. */
  onQueryInput(rawQuery) {
    clearTimeout(this._uiTimer);
    this._uiTimer = setTimeout(() => {
      this._runLocalThenScheduleApi(String(rawQuery || ''));
    }, this.config.uiDebounceMs ?? 200);
  }

  showHistoryOnly() {
    const history = this.cache.loadHistory();
    this.onResults(history.map(toUiResult), { source: 'history', empty: !history.length });
  }

  clear() {
    this._generation += 1;
    clearTimeout(this._uiTimer);
    clearTimeout(this._apiTimer);
    if (this._abort) this._abort.abort();
    this.onLoading(false);
    this.onResults([], { source: 'clear' });
  }

  async selectPlace(place) {
    let resolved = place;
    if (!hasValidCoords(resolved)) {
      this.onLoading(true);
      try {
        resolved = await this.client.ensureCoords(resolved);
      } finally {
        this.onLoading(false);
      }
    }
    if (!hasValidCoords(resolved)) {
      throw new Error('Lugar sem coordenadas válidas');
    }
    this.cache.pushHistory(resolved);
    this.onPlaceSelected(toUiResult(resolved));
    return resolved;
  }

  _runLocalThenScheduleApi(query) {
    const q = query.trim();
    const bias = this.getBias() || {};
    const gen = ++this._generation;

    if (!q) {
      clearTimeout(this._apiTimer);
      if (this._abort) this._abort.abort();
      this.onLoading(false);
      this.showHistoryOnly();
      return;
    }

    const localExport = this.cache.searchExport(q);
    const history = this.cache.searchHistory(q);
    const localMerged = filterAndSortPlaces(
      mergePlaces(localExport, history),
      q,
      bias.lat,
      bias.lng
    );

    if (localMerged.length) {
      this.onResults(localMerged.map(toUiResult), {
        source: 'local',
        pending: true
      });
    }

    // 1 char + histórico: não chama API
    if (q.length === 1 && history.length) {
      this.onLoading(false);
      if (!localMerged.length) {
        this.onResults(history.map(toUiResult), { source: 'history' });
      }
      return;
    }

    const cacheKey = this._cacheKey(q, bias);
    const cached = this.cache.getApiCache(cacheKey);
    if (cached) {
      const merged = filterAndSortPlaces(
        mergePlaces(localMerged, cached),
        q,
        bias.lat,
        bias.lng
      );
      this.onResults(merged.map(toUiResult), { source: 'api-cache' });
      this.onLoading(false);
      return;
    }

    clearTimeout(this._apiTimer);
    this._apiTimer = setTimeout(() => {
      if (gen !== this._generation) return;
      void this._executeRemote(q, bias, gen, localMerged);
    }, this.config.apiDebounceMs ?? 300);
  }

  async _executeRemote(query, bias, gen, localMerged) {
    if (gen !== this._generation) return;
    if (!this.config.apiKey) {
      if (!localMerged.length) {
        this.onResults([], {
          source: 'error',
          emptyHint:
            'Configura a API key: ?apiKey=… ou localStorage maphaj_api_key'
        });
      }
      return;
    }

    if (this._abort) this._abort.abort();
    this._abort = new AbortController();
    this.onLoading(true);

    try {
      const remote = await this.client.search({
        query,
        lat: bias.lat,
        lng: bias.lng,
        country: this.config.country || 'ao',
        language: this.config.language,
        radius: this.config.radius,
        maxResults: this.config.maxResults,
        signal: this._abort.signal
      });

      if (gen !== this._generation) return;

      this.cache.setApiCache(this._cacheKey(query, bias), remote);

      const merged = filterAndSortPlaces(
        mergePlaces(localMerged, remote),
        query,
        bias.lat,
        bias.lng
      );

      this.onResults(merged.map(toUiResult), {
        source: 'api',
        emptyHint: merged.length ? undefined : 'Nenhum local encontrado'
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[Places] search error:', err);
      if (gen !== this._generation) return;
      if (!localMerged.length) {
        this.onResults([], {
          source: 'error',
          emptyHint: 'Erro na pesquisa. Tenta de novo.'
        });
      }
    } finally {
      if (gen === this._generation) this.onLoading(false);
    }
  }

  _cacheKey(query, bias) {
    const lat = bias.lat != null ? Number(bias.lat).toFixed(3) : '';
    const lng = bias.lng != null ? Number(bias.lng).toFixed(3) : '';
    return `${query.trim().toLowerCase()}|${lat}|${lng}|${this.config.country}`;
  }
}
