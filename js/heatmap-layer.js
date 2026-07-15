/**
 * Camada de calor estilo Uber: grelha hexagonal (H3-like) com cores de procura.
 * Baixa = azul · média = amarelo · alta = vermelho.
 */

import { heatPointsToHexGeoJSON } from './heatmap-hex.js';

const SOURCE_ID = 'maphaj-heatmap';
const LAYER_FILL = 'maphaj-heatmap-fill';
const LAYER_LINE = 'maphaj-heatmap-line';

export class HeatmapLayer {
  /**
   * @param {import('maplibre-gl').Map} map
   */
  constructor(map) {
    this.map = map;
    this._enabled = false;
    /** @type {import('./heatmap-client.js').HeatPoint[]} */
    this._points = [];
    this._boundStyle = () => this._restoreAfterStyleChange();
    this.map.on('style.load', this._boundStyle);
  }

  get enabled() {
    return this._enabled;
  }

  /**
   * @param {import('./heatmap-client.js').HeatPoint[]} points
   */
  setPoints(points) {
    this._points = Array.isArray(points) ? points : [];
    if (!this._enabled) return;
    this._paint();
  }

  /**
   * @param {boolean} on
   */
  setEnabled(on) {
    this._enabled = Boolean(on);
    if (!this.map.getStyle()) return;
    if (this._enabled) {
      this._paint();
      for (const id of [LAYER_FILL, LAYER_LINE]) {
        if (this.map.getLayer(id)) {
          this.map.setLayoutProperty(id, 'visibility', 'visible');
        }
      }
    } else {
      for (const id of [LAYER_FILL, LAYER_LINE]) {
        if (this.map.getLayer(id)) {
          this.map.setLayoutProperty(id, 'visibility', 'none');
        }
      }
    }
  }

  clear() {
    this._points = [];
    this._enabled = false;
    if (!this.map.getStyle()) return;
    for (const id of [LAYER_LINE, LAYER_FILL]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    if (this.map.getSource(SOURCE_ID)) this.map.removeSource(SOURCE_ID);
  }

  _geojson() {
    return heatPointsToHexGeoJSON(this._points, {
      zoom: this.map.getZoom?.() ?? 12,
      center: this.map.getCenter
        ? {
            lat: this.map.getCenter().lat,
            lng: this.map.getCenter().lng
          }
        : null
    });
  }

  _paint() {
    this._ensure();
    const src = this.map.getSource(SOURCE_ID);
    if (src) src.setData(this._geojson());
  }

  _ensure() {
    if (!this.map.getStyle()) return;
    if (!this.map.getSource(SOURCE_ID)) {
      this.map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: this._geojson()
      });
    }

    const beforeId = this.map.getLayer('maphaj-route-casing')
      ? 'maphaj-route-casing'
      : undefined;

    if (!this.map.getLayer(LAYER_FILL)) {
      const fill = {
        id: LAYER_FILL,
        type: 'fill',
        source: SOURCE_ID,
        layout: { visibility: this._enabled ? 'visible' : 'none' },
        paint: {
          // Gradiente Uber: azul → amarelo → laranja → vermelho
          'fill-color': [
            'interpolate',
            ['linear'],
            ['get', 'intensity'],
            0.12,
            '#276EF1',
            0.35,
            '#48C0F0',
            0.5,
            '#FFC043',
            0.7,
            '#FF7A00',
            0.9,
            '#E11900'
          ],
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['get', 'intensity'],
            0.12,
            0.22,
            0.4,
            0.38,
            0.7,
            0.5,
            1,
            0.62
          ]
        },
        filter: ['>', ['get', 'intensity'], 0.1]
      };
      if (beforeId) this.map.addLayer(fill, beforeId);
      else this.map.addLayer(fill);
    }

    if (!this.map.getLayer(LAYER_LINE)) {
      const line = {
        id: LAYER_LINE,
        type: 'line',
        source: SOURCE_ID,
        layout: {
          visibility: this._enabled ? 'visible' : 'none',
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': [
            'interpolate',
            ['linear'],
            ['get', 'intensity'],
            0.12,
            '#1A54C4',
            0.5,
            '#E6A300',
            0.9,
            '#B80000'
          ],
          'line-width': 0.8,
          'line-opacity': 0.55
        },
        filter: ['>', ['get', 'intensity'], 0.1]
      };
      if (beforeId) this.map.addLayer(line, beforeId);
      else this.map.addLayer(line);
    }
  }

  _restoreAfterStyleChange() {
    if (!this._enabled) return;
    this._ensure();
    this._paint();
  }
}
