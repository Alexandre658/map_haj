/**
 * Pins origem/destino nativos (Symbol layer MapLibre).
 * Ícone PNG + texto "De … ›" / "Para … ›" com halo branco.
 */

const SOURCE = 'maphaj-od-pins';
const LAYER = 'maphaj-od-pins';
const IMG_ORIGIN = 'maphaj-od-origin';
const IMG_DEST = 'maphaj-od-dest';

/**
 * @param {object|null} place
 * @param {'De'|'Para'} prefix
 */
function pinLabel(place, prefix) {
  if (!place) return '';
  let n = String(place.name || '').trim();
  if (
    !n ||
    /^sua localiza/i.test(n) ||
    /^a sua localiza/i.test(n) ||
    /^my location/i.test(n)
  ) {
    n = String(place.address || '').split(',')[0].trim();
  }
  if (!n) n = String(place.address || '').split(',')[0].trim();
  if (n.length > 26) n = `${n.slice(0, 24).trim()}…`;
  return `${prefix} ${n || 'Local'} ›`;
}

function emptyFc() {
  return { type: 'FeatureCollection', features: [] };
}

export class RoutePinsLayer {
  /**
   * @param {import('maplibre-gl').Map} map
   */
  constructor(map) {
    this.map = map;
    /** @type {object|null} */
    this._origin = null;
    /** @type {object|null} */
    this._dest = null;
    this._imagesReady = false;
    this._bound = false;

    const boot = () => {
      void this.ensure();
    };
    if (map.isStyleLoaded()) boot();
    else map.once('load', boot);
    map.on('style.load', boot);
  }

  /**
   * Só clique exacto no mapa — o texto fica na coord escolhida.
   * @param {object|null} place
   */
  static isMapClickPrecise(place) {
    return (
      Boolean(place) &&
      (place.precise === true || String(place.source || '') === 'map-click')
    );
  }

  async ensure() {
    if (!this.map.getStyle()) return;
    try {
      await this._ensureImages();
      this._ensureSourceAndLayer();
      this._paint();
    } catch (err) {
      console.warn('[maphaj] route pins:', err);
    }
  }

  async _ensureImages() {
    if (this._imagesReady && this.map.hasImage(IMG_ORIGIN) && this.map.hasImage(IMG_DEST)) {
      return;
    }
    const load = async (id, url) => {
      if (this.map.hasImage(id)) return;
      const loaded = await this.map.loadImage(url);
      const data = loaded?.data ?? loaded;
      if (!this.map.hasImage(id) && data) {
        this.map.addImage(id, data, { pixelRatio: 2 });
      }
    };
    await load(IMG_ORIGIN, new URL('../assets/markers/start-pin.png', import.meta.url).href);
    await load(IMG_DEST, new URL('../assets/markers/dest-pin.png', import.meta.url).href);
    this._imagesReady = true;
  }

  _ensureSourceAndLayer() {
    if (!this.map.getSource(SOURCE)) {
      this.map.addSource(SOURCE, {
        type: 'geojson',
        data: emptyFc()
      });
    }
    if (!this.map.getLayer(LAYER)) {
      this.map.addLayer({
        id: LAYER,
        type: 'symbol',
        source: SOURCE,
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': [
            'match',
            ['get', 'role'],
            'origin',
            0.62,
            'dest',
            0.68,
            0.62
          ],
          'icon-anchor': [
            'match',
            ['get', 'role'],
            'origin',
            'bottom',
            'center'
          ],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['get', 'label'],
          'text-size': 13,
          'text-font': ['Noto Sans Bold', 'Noto Sans Regular'],
          'text-anchor': 'left',
          'text-offset': [
            'match',
            ['get', 'role'],
            'origin',
            ['literal', [1.35, -1.1]],
            ['literal', [1.2, 0]]
          ],
          'text-max-width': 14,
          'text-optional': true,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'symbol-sort-key': ['get', 'z'],
          'symbol-z-order': 'source'
        },
        paint: {
          'text-color': '#111111',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2.8,
          'text-halo-blur': 0.2,
          'icon-opacity': 1
        }
      });
    }
    this.bringToFront();
  }

  /** Garante que os pins ficam acima da polyline da rota. */
  bringToFront() {
    if (!this.map.getStyle() || !this.map.getLayer(LAYER)) return;
    try {
      this.map.moveLayer(LAYER);
    } catch {
      /* ignore */
    }
  }

  /**
   * @param {'origin'|'dest'} kind
   * @param {object|null} place
   */
  setPin(kind, place) {
    if (kind === 'origin') this._origin = place && place.lat != null ? place : null;
    else this._dest = place && place.lat != null ? place : null;
    void this.ensure();
  }

  clear() {
    this._origin = null;
    this._dest = null;
    void this.ensure();
  }

  /** @returns {object|null} */
  getOrigin() {
    return this._origin;
  }

  /** @returns {object|null} */
  getDest() {
    return this._dest;
  }

  _paint() {
    const src = this.map.getSource(SOURCE);
    if (!src || typeof src.setData !== 'function') {
      void this.ensure();
      return;
    }

    /** @type {object[]} */
    const features = [];
    if (this._origin && this._origin.lat != null && this._origin.lng != null) {
      features.push({
        type: 'Feature',
        properties: {
          role: 'origin',
          icon: IMG_ORIGIN,
          label: pinLabel(this._origin, 'De'),
          z: 1
        },
        geometry: {
          type: 'Point',
          coordinates: [Number(this._origin.lng), Number(this._origin.lat)]
        }
      });
    }
    if (this._dest && this._dest.lat != null && this._dest.lng != null) {
      features.push({
        type: 'Feature',
        properties: {
          role: 'dest',
          icon: IMG_DEST,
          label: pinLabel(this._dest, 'Para'),
          z: 2
        },
        geometry: {
          type: 'Point',
          coordinates: [Number(this._dest.lng), Number(this._dest.lat)]
        }
      });
    }

    src.setData({ type: 'FeatureCollection', features });
    this.bringToFront();
  }
}
