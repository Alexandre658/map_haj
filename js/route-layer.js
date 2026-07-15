/**
 * Camada de rota MapLibre — principal + alternativas (30%).
 * Hover estilo Google: ponto na polyline + tooltip com tempo/distância.
 * Manobras nas curvas: steps da API Moveme ou geometria + /api/places/coordinates.
 */

import { formatDistance, formatDuration } from './polyline.js';
import {
  maneuverIconSvg,
  resolveManeuvers
} from './route-maneuvers.js';
import {
  TRAFFIC_COLORS,
  extractTrafficSegments,
  trafficSegmentsToGeoJSON
} from './traffic-segments.js';

/**
 * Imagem seta/chevron branca para desenhar DENTRO da polyline (estilo Google).
 * Aponta para cima; MapLibre roda-a ao longo da linha.
 */
function createChevronImageData() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  // sombra suave
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.moveTo(32, 16);
  ctx.lineTo(48, 38);
  ctx.lineTo(40, 38);
  ctx.lineTo(32, 26);
  ctx.lineTo(24, 38);
  ctx.lineTo(16, 38);
  ctx.closePath();
  ctx.fill();
  // chevron branco
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(32, 14);
  ctx.lineTo(50, 38);
  ctx.lineTo(41, 38);
  ctx.lineTo(32, 24);
  ctx.lineTo(23, 38);
  ctx.lineTo(14, 38);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, s, s);
}

/**
 * Rasteriza SVG de manobra → ImageData para symbol layer (dentro da rota).
 * @param {string} type
 */
function createTurnImageData(type) {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, s, s);

  // fundo transparente — só a seta branca com contorno, assenta na linha azul
  const svg = maneuverIconSvg(type)
    .replace(/width="20"/, 'width="56"')
    .replace(/height="20"/, 'height="56"')
    .replace(/stroke="currentColor"/g, 'stroke="#ffffff"')
    .replace(/stroke-width="2.4"/g, 'stroke-width="3.2"');

  const img = new Image();
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    svg.replace(
      '<svg ',
      '<svg xmlns="http://www.w3.org/2000/svg" '
    )
  )}`;

  // Sync fall-through: desenhar via path aproximado se async falhar
  // Usamos Image + drawImage de forma síncrona não funciona; paint após load.
  // Por isso retornamos Promise.
  return new Promise((resolve) => {
    img.onload = () => {
      // sombra
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 1;
      ctx.drawImage(img, 4, 4, 56, 56);
      resolve(ctx.getImageData(0, 0, s, s));
    };
    img.onerror = () => {
      // fallback chevron
      resolve(createChevronImageData());
    };
    img.src = url;
  });
}

const SOURCE_ALT = 'maphaj-route-alt';
const LAYER_ALT_HIT = 'maphaj-route-alt-hit';
const LAYER_ALT = 'maphaj-route-alt-line';
const SOURCE_MAIN = 'maphaj-route';
const LAYER_MAIN_HIT = 'maphaj-route-main-hit';
const LAYER_CASING = 'maphaj-route-casing';
const LAYER_LINE = 'maphaj-route-line';
const LAYER_FLOW = 'maphaj-route-flow';
const LAYER_ARROWS = 'maphaj-route-arrows';
const SOURCE_TRAVELED = 'maphaj-route-traveled';
const LAYER_TRAVELED = 'maphaj-route-traveled-line';
const SOURCE_MANEUVERS = 'maphaj-route-maneuvers';
const LAYER_MANEUVERS = 'maphaj-route-maneuvers';
const LAYER_MANEUVERS_HIT = 'maphaj-route-maneuvers-hit';
const IMG_ROUTE_CHEVRON = 'maphaj-route-chevron';
const IMG_TURN_PREFIX = 'maphaj-turn-';

const ROUTE_COLOR = TRAFFIC_COLORS.none;
const ROUTE_FLOW_COLOR = '#ffffff';
const TRAVELED_COLOR = '#9aa0a6';
const ALT_OPACITY = 0.3;
const LINE_WIDTH = 10;
const FLOW_WIDTH = 6;
const CASING_WIDTH = 16;
const HIT_WIDTH = 28;
const HIT_LAYERS = [LAYER_MAIN_HIT, LAYER_ALT_HIT];

/** Cor da linha por propriedade congestion (engarrafamento). */
const LINE_COLOR_EXPR = [
  'match',
  ['get', 'congestion'],
  'heavy',
  TRAFFIC_COLORS.heavy,
  'medium',
  TRAFFIC_COLORS.medium,
  TRAFFIC_COLORS.none
];

/** Sequência dash estilo Uber / ant-path (fluxo ao longo da rota). */
const FLOW_DASH_SEQUENCE = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5]
];

const TURN_TYPES = [
  'slight-right',
  'right',
  'sharp-right',
  'slight-left',
  'left',
  'sharp-left',
  'uturn'
];

function haversineMeters(lng1, lat1, lng2, lat2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Projecção do ponto no segmento [a→b] em coords lng/lat aproximadas. */
function projectOnSegment(p, a, b) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) {
    return { point: a, t: 0, dist: haversineMeters(px, py, ax, ay) };
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return {
    point: [qx, qy],
    t,
    dist: haversineMeters(px, py, qx, qy)
  };
}

/**
 * Ponto mais próximo numa polyline + distância acumulada desde o início.
 * @param {number[][]} line
 * @param {number[]} lngLat
 */
export function nearestPointOnLine(line, lngLat) {
  if (!line || line.length < 2) return null;
  let best = null;
  let traveled = 0;

  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const segLen = haversineMeters(a[0], a[1], b[0], b[1]);
    const proj = projectOnSegment(lngLat, a, b);
    if (!best || proj.dist < best.pixelDist) {
      best = {
        point: proj.point,
        pixelDist: proj.dist,
        alongMeters: traveled + segLen * proj.t,
        segmentIndex: i
      };
    }
    traveled += segLen;
  }
  return best
    ? {
        lngLat: best.point,
        alongMeters: best.alongMeters,
        totalMeters: traveled,
        distanceToLineMeters: best.pixelDist
      }
    : null;
}

export class RouteLayer {
  /**
   * @param {import('maplibre-gl').Map} map
   * @param {{ reverseGeocode?: (p: {lat:number,lng:number}) => Promise<string|null> }} [opts]
   */
  constructor(map, opts = {}) {
    this.map = map;
    this.reverseGeocode = opts.reverseGeocode || null;
    /** @type {Array<{ coordinates: number[][], primary?: boolean, index?: number, distanceMeters?: number|null, durationSeconds?: number|null, summary?: string|null }>|null} */
    this._routes = null;
    /** @type {number} */
    this._selectedIndex = 0;
    /** @type {((index: number) => void)|null} */
    this.onSelect = null;

    this._hoverMarker = null;
    this._tooltipEl = null;
    this._hovering = false;
    this._hoverStreet = '';
    this._hoverStreetKey = '';
    this._streetTimer = null;
    this._streetAbort = null;
    this._streetCache = new Map();
    this._lastHoverCtx = null;

    /** @type {import('maplibre-gl').Marker[]} */
    this._maneuverMarkers = [];
    /** @type {Array<object>} */
    this._maneuvers = [];
    this._maneuverGen = 0;
    this._maneuverTooltipEl = null;
    this._iconsReady = null;
    /** @type {boolean} */
    this._navMode = false;
    /** @type {number|null} */
    this._flowRaf = null;
    /** @type {number} */
    this._flowStep = -1;

    this._ensureTooltip();
    this._ensureManeuverTooltip();
    this._bindHover();

    this.map.on('click', LAYER_ALT_HIT, (e) => {
      const routeIdx = e.features?.[0]?.properties?.routeIdx;
      if (routeIdx == null) return;
      this.selectRoute(Number(routeIdx));
    });

    this.map.on('style.load', () => {
      this._iconsReady = null;
      this._restoreAfterStyleChange();
    });
  }

  /**
   * Após map.setStyle as sources/layers desaparecem — redesenhar a rota.
   */
  _restoreAfterStyleChange() {
    if (!this._routes?.length) return;
    const routes = this._routes;
    const selectedIndex = this._selectedIndex;
    const run = () => {
      if (!this._routes?.length || this._routes !== routes) return;
      try {
        // setRoutes recria sources/layers do zero no estilo novo
        this.setRoutes(routes, { fit: false, selectedIndex });
      } catch (err) {
        console.warn('[RouteLayer] restore após estilo:', err);
        requestAnimationFrame(() => {
          try {
            this._paint({ fit: false });
          } catch (e2) {
            console.warn('[RouteLayer] restore retry:', e2);
          }
        });
      }
    };
    // Esperar o estilo estar pronto para addSource/addLayer
    if (this.map.isStyleLoaded()) {
      queueMicrotask(run);
    } else {
      this.map.once('idle', run);
    }
  }

  async _ensureRouteIcons() {
    if (this._iconsReady) return this._iconsReady;
    this._iconsReady = (async () => {
      if (!this.map.hasImage(IMG_ROUTE_CHEVRON)) {
        this.map.addImage(IMG_ROUTE_CHEVRON, createChevronImageData(), {
          pixelRatio: 2
        });
      }
      for (const type of TURN_TYPES) {
        const id = IMG_TURN_PREFIX + type;
        if (this.map.hasImage(id)) continue;
        const data = await createTurnImageData(type);
        if (!this.map.hasImage(id)) {
          this.map.addImage(id, data, { pixelRatio: 2 });
        }
      }
    })();
    return this._iconsReady;
  }

  _ensureTooltip() {
    if (this._tooltipEl) return;
    const el = document.createElement('div');
    el.className = 'route-hover-tooltip';
    el.style.display = 'none';
    this.map.getContainer().appendChild(el);
    this._tooltipEl = el;

    const pin = document.createElement('div');
    pin.className = 'route-hover-dot';
    this._hoverMarker = new maplibregl.Marker({
      element: pin,
      anchor: 'center'
    });
  }

  _bindHover() {
    this.map.on('mousemove', (e) => {
      if (!this._routes?.length || this._navMode) return;

      // Prioridade: manobra (curva) > tooltip de tempo/distância da rota
      const manLayers = [LAYER_MANEUVERS_HIT, LAYER_MANEUVERS].filter((id) =>
        this.map.getLayer(id)
      );
      if (manLayers.length) {
        const manFeats = this.map.queryRenderedFeatures(e.point, {
          layers: manLayers
        });
        if (manFeats.length) {
          const props = manFeats[0].properties || {};
          this._hideHover();
          this.map.getCanvas().style.cursor = 'pointer';
          this._showManeuverTip(
            props.type || 'right',
            props.instruction || '',
            e.point
          );
          return;
        }
      }

      // Fallback: curva próxima ao ponto na polyline selected
      const nearMan = this._nearestManeuver(e.lngLat, 36);
      if (nearMan) {
        this._hideHover();
        this.map.getCanvas().style.cursor = 'pointer';
        this._showManeuverTip(nearMan.type, nearMan.instruction || '', e.point);
        return;
      }

      this._hideManeuverTip();

      const feats = this.map.queryRenderedFeatures(e.point, {
        layers: HIT_LAYERS.filter((id) => this.map.getLayer(id))
      });
      if (!feats.length) {
        this._hideHover();
        return;
      }

      const routeIdx = Number(feats[0].properties?.routeIdx);
      const route = this._routes[routeIdx];
      if (!route) {
        this._hideHover();
        return;
      }

      const nearest = nearestPointOnLine(route.coordinates, [
        e.lngLat.lng,
        e.lngLat.lat
      ]);
      if (!nearest || nearest.distanceToLineMeters > 80) {
        this._hideHover();
        return;
      }

      this._showHover(route, routeIdx, nearest, e.point);
    });

    this.map.on('mouseout', () => {
      this._hideHover();
      this._hideManeuverTip();
    });
  }

  /**
   * Manobra mais próxima do cursor (só na rota seleccionada).
   * @param {{ lng: number, lat: number }} lngLat
   * @param {number} maxMeters
   */
  _nearestManeuver(lngLat, maxMeters = 36) {
    if (!this._maneuvers?.length) return null;
    let best = null;
    let bestD = maxMeters;
    for (const m of this._maneuvers) {
      if (!m?.lngLat) continue;
      const d = haversineMeters(
        lngLat.lng,
        lngLat.lat,
        m.lngLat[0],
        m.lngLat[1]
      );
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  _showHover(route, routeIdx, nearest, point) {
    this._hideManeuverTip();
    this._hovering = true;
    this.map.getCanvas().style.cursor = 'pointer';

    this._hoverMarker
      .setLngLat(nearest.lngLat)
      .addTo(this.map);

    // distância / tempo restantes até ao destino (diminuem ao longo da rota)
    const fractionLeft = Math.max(
      0,
      1 - nearest.alongMeters / Math.max(nearest.totalMeters, 1)
    );
    const remainingFromGeom = Math.max(0, nearest.totalMeters - nearest.alongMeters);
    const remainingDist = formatDistance(
      route.distanceMeters != null
        ? Math.max(0, route.distanceMeters * fractionLeft)
        : remainingFromGeom
    );
    const remainingTime = formatDuration(
      route.durationSeconds != null
        ? Math.max(0, route.durationSeconds * fractionLeft)
        : null
    );

    this._lastHoverCtx = { route, routeIdx, nearest, point, remainingDist, remainingTime };
    this._renderHoverTooltip();
    this._scheduleStreetLookup(nearest.lngLat);
  }

  _renderHoverTooltip() {
    const ctx = this._lastHoverCtx;
    if (!ctx || !this._tooltipEl) return;
    const { route, routeIdx, point, remainingDist, remainingTime } = ctx;
    const street = this._hoverStreet;
    const fallback =
      route.summary ||
      (routeIdx === this._selectedIndex ? 'Rota seleccionada' : 'Rota alternativa');
    const streetLine = street
      ? escapeHtml(street)
      : this.reverseGeocode
        ? 'A obter rua…'
        : escapeHtml(fallback);

    this._tooltipEl.innerHTML = `
      <div class="route-hover-tooltip-inner">
        <div class="rht-time">${escapeHtml(remainingTime)}</div>
        <div class="rht-dist">${escapeHtml(remainingDist)}</div>
        <div class="rht-along">até ao destino</div>
        <div class="rht-sum">${streetLine}</div>
      </div>`;
    this._tooltipEl.style.display = 'block';

    const tipW = this._tooltipEl.offsetWidth || 140;
    const tipH = this._tooltipEl.offsetHeight || 72;
    const mapW = this.map.getContainer().clientWidth;
    let left = point.x + 14;
    let top = point.y - tipH - 12;
    if (left + tipW > mapW - 8) left = point.x - tipW - 14;
    if (top < 8) top = point.y + 18;
    this._tooltipEl.style.transform = `translate(${left}px, ${top}px)`;
  }

  _scheduleStreetLookup(lngLat) {
    if (!this.reverseGeocode) return;
    const [lng, lat] = lngLat;
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (key === this._hoverStreetKey && this._hoverStreet) {
      this._renderHoverTooltip();
      return;
    }

    if (this._streetCache.has(key)) {
      this._hoverStreetKey = key;
      this._hoverStreet = this._streetCache.get(key);
      this._renderHoverTooltip();
      return;
    }

    // Nova posição: limpa rua até chegar o reverse geocode
    if (this._hoverStreetKey !== key) {
      this._hoverStreetKey = key;
      this._hoverStreet = '';
      this._renderHoverTooltip();
    }

    clearTimeout(this._streetTimer);
    this._streetTimer = setTimeout(() => {
      void this._lookupStreet(key, lat, lng);
    }, 220);
  }

  async _lookupStreet(key, lat, lng) {
    if (!this.reverseGeocode || !this._hovering) return;
    if (this._streetAbort) this._streetAbort.abort();
    this._streetAbort = new AbortController();
    const signal = this._streetAbort.signal;
    try {
      const name = await this.reverseGeocode({ lat, lng, signal });
      if (!this._hovering || signal.aborted) return;
      // Só aplica se o rato ainda estiver nesta célula
      const ctx = this._lastHoverCtx;
      if (!ctx) return;
      const [clng, clat] = ctx.nearest.lngLat;
      const currentKey = `${clat.toFixed(4)},${clng.toFixed(4)}`;
      if (currentKey !== key) return;

      const label = (name || '').trim();
      if (label) {
        this._streetCache.set(key, label);
        if (this._streetCache.size > 80) {
          const first = this._streetCache.keys().next().value;
          this._streetCache.delete(first);
        }
        this._hoverStreetKey = key;
        this._hoverStreet = label;
        this._renderHoverTooltip();
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }

  _hideHover() {
    if (!this._hovering && this._tooltipEl?.style.display === 'none') return;
    this._hovering = false;
    this.map.getCanvas().style.cursor = '';
    clearTimeout(this._streetTimer);
    if (this._streetAbort) this._streetAbort.abort();
    this._hoverStreet = '';
    this._hoverStreetKey = '';
    this._lastHoverCtx = null;
    if (this._tooltipEl) this._tooltipEl.style.display = 'none';
    if (this._hoverMarker) this._hoverMarker.remove();
  }

  clear() {
    this._hideHover();
    this._clearManeuvers({ cancel: true });
    this._stopFlowAnimation();
    this._navMode = false;
    this._routes = null;
    this._selectedIndex = 0;
    if (!this.map.getStyle()) return;
    for (const id of [
      LAYER_MANEUVERS,
      LAYER_MANEUVERS_HIT,
      LAYER_ARROWS,
      LAYER_FLOW,
      LAYER_LINE,
      LAYER_CASING,
      LAYER_MAIN_HIT,
      LAYER_TRAVELED,
      LAYER_ALT,
      LAYER_ALT_HIT
    ]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    for (const id of [
      SOURCE_MANEUVERS,
      SOURCE_MAIN,
      SOURCE_TRAVELED,
      SOURCE_ALT
    ]) {
      if (this.map.getSource(id)) this.map.removeSource(id);
    }
  }

  /**
   * Modo navegação: polyline contínua + fluxo; mantém alternativas visíveis
   * (toque = trocar de via). Esconde só overlays de manobra.
   * @param {boolean} on
   */
  setNavigationMode(on) {
    this._navMode = Boolean(on);
    if (!this.map.getStyle()) return;
    if (this._navMode) {
      this._hideHover();
      this._clearManeuvers({ cancel: true });
      this._removeTraveledLayer();
      for (const id of [LAYER_MANEUVERS, LAYER_MANEUVERS_HIT]) {
        if (this.map.getLayer(id)) {
          this.map.setLayoutProperty(id, 'visibility', 'none');
        }
      }
      for (const id of [LAYER_ALT, LAYER_ALT_HIT]) {
        if (this.map.getLayer(id)) {
          this.map.setLayoutProperty(id, 'visibility', 'visible');
        }
      }
      if (this.map.getLayer(LAYER_ALT)) {
        this.map.setPaintProperty(LAYER_ALT, 'line-opacity', 0.42);
      }
      // Rota contínua sólida + fluxo animado Uber
      if (this.map.getLayer(LAYER_FLOW)) {
        this.map.setLayoutProperty(LAYER_FLOW, 'visibility', 'visible');
      }
      if (this.map.getLayer(LAYER_ARROWS)) {
        this.map.setLayoutProperty(LAYER_ARROWS, 'visibility', 'none');
      }
      if (this.map.getLayer(LAYER_LINE)) {
        this.map.setPaintProperty(LAYER_LINE, 'line-dasharray', null);
        this.map.setPaintProperty(LAYER_LINE, 'line-width', LINE_WIDTH);
        this.map.setLayoutProperty(LAYER_LINE, 'line-cap', 'round');
      }
      if (this.map.getLayer(LAYER_CASING)) {
        this.map.setPaintProperty(LAYER_CASING, 'line-dasharray', null);
        this.map.setPaintProperty(LAYER_CASING, 'line-width', CASING_WIDTH);
        this.map.setLayoutProperty(LAYER_CASING, 'line-cap', 'round');
      }
      this._restoreFullSelectedGeometry();
      this._ensureFlowLayer();
      this._startFlowAnimation();
    } else {
      this._removeTraveledLayer();
      for (const id of [
        LAYER_ALT,
        LAYER_ALT_HIT,
        LAYER_MANEUVERS,
        LAYER_MANEUVERS_HIT
      ]) {
        if (this.map.getLayer(id)) {
          this.map.setLayoutProperty(id, 'visibility', 'visible');
        }
      }
      if (this.map.getLayer(LAYER_ALT)) {
        this.map.setPaintProperty(LAYER_ALT, 'line-opacity', ALT_OPACITY);
      }
      if (this.map.getLayer(LAYER_ARROWS)) {
        this.map.setLayoutProperty(LAYER_ARROWS, 'visibility', 'none');
      }
      if (this.map.getLayer(LAYER_FLOW)) {
        this.map.setLayoutProperty(LAYER_FLOW, 'visibility', 'visible');
      }
      if (this.map.getLayer(LAYER_LINE)) {
        this.map.setPaintProperty(LAYER_LINE, 'line-dasharray', null);
        this.map.setPaintProperty(LAYER_LINE, 'line-width', LINE_WIDTH);
      }
      if (this.map.getLayer(LAYER_CASING)) {
        this.map.setPaintProperty(LAYER_CASING, 'line-dasharray', null);
        this.map.setPaintProperty(LAYER_CASING, 'line-width', CASING_WIDTH);
      }
      if (this._routes?.length) {
        this._paint({ fit: false });
      }
    }
  }

  /**
   * Polyline contínua: não corta nem altera a geometria durante a navegação.
   * @param {{ remaining?: number[][], traveled?: number[][], alongMeters?: number }} _progress
   */
  setNavigationProgress(_progress) {
    // intencionalmente vazio — a rota completa permanece visível
  }

  _restoreFullSelectedGeometry() {
    const selected = this._routes?.[this._selectedIndex];
    if (!selected?.coordinates || selected.coordinates.length < 2) return;
    const srcMain = this.map.getSource(SOURCE_MAIN);
    if (!srcMain) return;
    srcMain.setData(this._mainRouteGeoJSON(selected));
  }

  /**
   * GeoJSON da rota seleccionada com segmentos de trânsito.
   * @param {object} selected
   */
  _mainRouteGeoJSON(selected) {
    let segments = selected.trafficSegments;
    if (!segments?.length) {
      segments = extractTrafficSegments({
        coordinates: selected.coordinates,
        raw: selected.raw
      });
      selected.trafficSegments = segments;
    }
    if (!segments?.length) {
      segments = [
        { coordinates: selected.coordinates, congestion: 'none' }
      ];
    }
    return trafficSegmentsToGeoJSON(segments, {
      primary: true,
      index: selected.index ?? this._selectedIndex,
      routeIdx: this._selectedIndex
    });
  }

  _removeTraveledLayer() {
    if (!this.map.getStyle()) return;
    if (this.map.getLayer(LAYER_TRAVELED)) this.map.removeLayer(LAYER_TRAVELED);
    if (this.map.getSource(SOURCE_TRAVELED)) {
      this.map.removeSource(SOURCE_TRAVELED);
    }
  }

  /**
   * @param {Array<{ coordinates: number[][], index?: number, distanceMeters?: number|null, durationSeconds?: number|null, summary?: string|null, primary?: boolean }>} routes
   * @param {{ fit?: boolean, padding?: number, selectedIndex?: number }} [opts]
   */
  setRoutes(routes, opts = {}) {
    const list = (routes || []).filter(
      (r) => Array.isArray(r?.coordinates) && r.coordinates.length >= 2
    );
    if (!list.length) {
      this.clear();
      return;
    }

    let selected =
      opts.selectedIndex != null
        ? opts.selectedIndex
        : list.findIndex((r) => r.primary);
    if (selected < 0 || selected >= list.length) selected = 0;

    this._routes = list.map((r, i) => ({ ...r, index: r.index ?? i }));
    this._selectedIndex = selected;
    this._paint();

    if (opts.fit !== false) {
      let bounds = null;
      for (const route of list) {
        for (const c of route.coordinates) {
          if (!bounds) bounds = new maplibregl.LngLatBounds(c, c);
          else bounds = bounds.extend(c);
        }
      }
      if (bounds) {
        this.map.fitBounds(bounds, {
          padding: opts.padding ?? 72,
          maxZoom: 15,
          duration: 900
        });
      }
    }
  }

  setRoute(coordinates, opts = {}) {
    const alts = opts.alternatives || [];
    const routes = [
      { coordinates, primary: true, index: 0 },
      ...alts.map((coordinates, i) => ({
        coordinates,
        primary: false,
        index: i + 1
      }))
    ];
    this.setRoutes(routes, opts);
  }

  selectRoute(index, { quiet = false } = {}) {
    if (!this._routes?.length) return;
    // Aceita índice do array ou route.index
    let arrayIdx = this._routes.findIndex(
      (r, i) => i === index || r.index === index
    );
    if (arrayIdx < 0) arrayIdx = index;
    if (arrayIdx < 0 || arrayIdx >= this._routes.length) return;
    if (arrayIdx === this._selectedIndex && !quiet) {
      this.onSelect?.(arrayIdx);
      return;
    }
    this._selectedIndex = arrayIdx;
    this._paint({ fit: false });
    if (!quiet) this.onSelect?.(arrayIdx);
  }

  getSelectedRoute() {
    return this._routes?.[this._selectedIndex] || null;
  }

  getRoutes() {
    return this._routes ? [...this._routes] : [];
  }

  getSelectedIndex() {
    return this._selectedIndex;
  }

  _ensureManeuverTooltip() {
    if (this._maneuverTooltipEl) return;
    const el = document.createElement('div');
    el.className = 'route-maneuver-tooltip';
    el.style.display = 'none';
    this.map.getContainer().appendChild(el);
    this._maneuverTooltipEl = el;
  }

  _clearManeuvers({ cancel = false } = {}) {
    if (cancel) this._maneuverGen += 1;
    this._maneuvers = [];
    for (const m of this._maneuverMarkers) {
      try {
        m.remove();
      } catch {
        /* ignore */
      }
    }
    this._maneuverMarkers = [];
    if (this._maneuverTooltipEl) {
      this._maneuverTooltipEl.style.display = 'none';
      this._maneuverTooltipEl.innerHTML = '';
    }
    if (this.map.getSource(SOURCE_MANEUVERS)) {
      this.map.getSource(SOURCE_MANEUVERS).setData({
        type: 'FeatureCollection',
        features: []
      });
    }
  }

  _showManeuverTip(type, instruction, point) {
    this._ensureManeuverTooltip();
    const tip = this._maneuverTooltipEl;
    tip.innerHTML = `<div class="route-maneuver-tooltip-inner">
        <span class="route-maneuver-tip-ico">${maneuverIconSvg(type)}</span>
        <span class="route-maneuver-tip-txt">${escapeHtml(instruction)}</span>
      </div>`;
    tip.style.display = 'block';
    const tipW = tip.offsetWidth || 200;
    const tipH = tip.offsetHeight || 48;
    const mapW = this.map.getContainer().clientWidth;
    let left = point.x + 12;
    let top = point.y - tipH - 10;
    if (left + tipW > mapW - 8) left = point.x - tipW - 12;
    if (top < 8) top = point.y + 16;
    tip.style.transform = `translate(${left}px, ${top}px)`;
  }

  _hideManeuverTip() {
    if (this._maneuverTooltipEl) this._maneuverTooltipEl.style.display = 'none';
  }

  async _refreshManeuvers() {
    const gen = ++this._maneuverGen;
    this._clearManeuvers();
    if (this._navMode) return;

    const selected = this._routes?.[this._selectedIndex];
    if (!selected?.coordinates?.length) return;

    try {
      await this._ensureRouteIcons();
      if (gen !== this._maneuverGen) return;

      const maneuvers = await resolveManeuvers(selected.coordinates, {
        routeRaw: selected.raw || null,
        reverseGeocode: this.reverseGeocode
      });
      if (gen !== this._maneuverGen) return;

      this._maneuvers = maneuvers.filter(
        (m) =>
          m?.lngLat &&
          Number.isFinite(m.lngLat[0]) &&
          m.type &&
          m.type !== 'continue'
      );

      const features = this._maneuvers.map((m, i) => ({
        type: 'Feature',
        properties: {
          id: i,
          type: m.type,
          instruction: m.instruction || '',
          bearing: Number.isFinite(m.inboundBearing) ? m.inboundBearing : 0,
          icon: IMG_TURN_PREFIX + m.type
        },
        geometry: {
          type: 'Point',
          coordinates: m.lngLat
        }
      }));

      const geo = { type: 'FeatureCollection', features };

      if (!this.map.getSource(SOURCE_MANEUVERS)) {
        this.map.addSource(SOURCE_MANEUVERS, { type: 'geojson', data: geo });
        this.map.addLayer({
          id: LAYER_MANEUVERS_HIT,
          type: 'circle',
          source: SOURCE_MANEUVERS,
          paint: {
            'circle-radius': 14,
            'circle-opacity': 0,
            'circle-color': '#000'
          }
        });
        this.map.addLayer({
          id: LAYER_MANEUVERS,
          type: 'symbol',
          source: SOURCE_MANEUVERS,
          layout: {
            'icon-image': ['get', 'icon'],
            'icon-size': 0.45,
            'icon-rotate': ['get', 'bearing'],
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
          }
        });
      } else {
        this.map.getSource(SOURCE_MANEUVERS).setData(geo);
      }

      // setas por cima da linha azul
      for (const id of [LAYER_ARROWS, LAYER_MANEUVERS_HIT, LAYER_MANEUVERS]) {
        if (this.map.getLayer(id)) this.map.moveLayer(id);
      }
    } catch (err) {
      console.warn('[RouteLayer] manobras:', err);
    }
  }

  _ensureFlowLayer() {
    if (this.map.getLayer(LAYER_FLOW)) return;
    if (!this.map.getSource(SOURCE_MAIN)) return;
    this.map.addLayer({
      id: LAYER_FLOW,
      type: 'line',
      source: SOURCE_MAIN,
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': ROUTE_FLOW_COLOR,
        'line-width': FLOW_WIDTH,
        'line-opacity': 0.9,
        'line-dasharray': FLOW_DASH_SEQUENCE[0]
      }
    });
  }

  _startFlowAnimation() {
    if (this._flowRaf != null) return;
    const tick = (timestamp) => {
      if (!this._routes?.length || !this.map.getStyle()) {
        this._flowRaf = null;
        return;
      }
      if (!this.map.getLayer(LAYER_FLOW)) {
        this._flowRaf = null;
        return;
      }
      const step = Math.floor(timestamp / 45) % FLOW_DASH_SEQUENCE.length;
      if (step !== this._flowStep) {
        this._flowStep = step;
        try {
          this.map.setPaintProperty(
            LAYER_FLOW,
            'line-dasharray',
            FLOW_DASH_SEQUENCE[step]
          );
          // Pulso suave na opacidade (sensação Uber)
          const pulse = 0.72 + 0.22 * Math.sin(timestamp / 420);
          this.map.setPaintProperty(LAYER_FLOW, 'line-opacity', pulse);
        } catch {
          this._flowRaf = null;
          return;
        }
      }
      this._flowRaf = requestAnimationFrame(tick);
    };
    this._flowRaf = requestAnimationFrame(tick);
  }

  _stopFlowAnimation() {
    if (this._flowRaf != null) {
      cancelAnimationFrame(this._flowRaf);
      this._flowRaf = null;
    }
    this._flowStep = -1;
  }

  _ensureArrowLayer() {
    if (this.map.getLayer(LAYER_ARROWS)) return;
    if (!this.map.getSource(SOURCE_MAIN)) return;
    this.map.addLayer({
      id: LAYER_ARROWS,
      type: 'symbol',
      source: SOURCE_MAIN,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 42,
        'icon-image': IMG_ROUTE_CHEVRON,
        'icon-size': 0.38,
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        visibility: 'none'
      }
    });
  }

  _paint({ fit = false } = {}) {
    this._hideHover();
    this._hideManeuverTip();
    const routes = this._routes || [];
    const selected = routes[this._selectedIndex];
    if (!selected) return;

    const alternatives = routes
      .map((route, routeIdx) => ({ route, routeIdx }))
      .filter(({ routeIdx }) => routeIdx !== this._selectedIndex);

    const altGeo = {
      type: 'FeatureCollection',
      features: alternatives.map(({ route, routeIdx }) => ({
        type: 'Feature',
        properties: {
          index: route.index ?? routeIdx,
          routeIdx
        },
        geometry: { type: 'LineString', coordinates: route.coordinates }
      }))
    };

    if (!this.map.getSource(SOURCE_ALT)) {
      this.map.addSource(SOURCE_ALT, { type: 'geojson', data: altGeo });
      this.map.addLayer({
        id: LAYER_ALT_HIT,
        type: 'line',
        source: SOURCE_ALT,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-width': HIT_WIDTH,
          'line-opacity': 0.01
        }
      });
      this.map.addLayer({
        id: LAYER_ALT,
        type: 'line',
        source: SOURCE_ALT,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-width': LINE_WIDTH,
          'line-opacity': ALT_OPACITY
        }
      });
    } else {
      this.map.getSource(SOURCE_ALT).setData(altGeo);
      if (this.map.getLayer(LAYER_ALT)) {
        this.map.setPaintProperty(LAYER_ALT, 'line-width', LINE_WIDTH);
        this.map.setPaintProperty(
          LAYER_ALT,
          'line-opacity',
          this._navMode ? 0.42 : ALT_OPACITY
        );
        this.map.setLayoutProperty(LAYER_ALT, 'visibility', 'visible');
      }
      if (this.map.getLayer(LAYER_ALT_HIT)) {
        this.map.setPaintProperty(LAYER_ALT_HIT, 'line-width', HIT_WIDTH);
        this.map.setLayoutProperty(LAYER_ALT_HIT, 'visibility', 'visible');
      }
    }

    const mainGeo = this._mainRouteGeoJSON(selected);

    if (!this.map.getSource(SOURCE_MAIN)) {
      this.map.addSource(SOURCE_MAIN, { type: 'geojson', data: mainGeo });
      this.map.addLayer({
        id: LAYER_MAIN_HIT,
        type: 'line',
        source: SOURCE_MAIN,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ROUTE_COLOR,
          'line-width': HIT_WIDTH,
          'line-opacity': 0.01
        }
      });
      this.map.addLayer({
        id: LAYER_CASING,
        type: 'line',
        source: SOURCE_MAIN,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': CASING_WIDTH,
          'line-opacity': 0.95
        }
      });
      this.map.addLayer({
        id: LAYER_LINE,
        type: 'line',
        source: SOURCE_MAIN,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': LINE_COLOR_EXPR,
          'line-width': LINE_WIDTH,
          'line-opacity': 1
        }
      });
      this.map.addLayer({
        id: LAYER_FLOW,
        type: 'line',
        source: SOURCE_MAIN,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ROUTE_FLOW_COLOR,
          'line-width': FLOW_WIDTH,
          'line-opacity': 0.85,
          'line-dasharray': FLOW_DASH_SEQUENCE[0]
        }
      });
    } else {
      this.map.getSource(SOURCE_MAIN).setData(mainGeo);
      if (this.map.getLayer(LAYER_LINE)) {
        this.map.setPaintProperty(LAYER_LINE, 'line-width', LINE_WIDTH);
        this.map.setPaintProperty(LAYER_LINE, 'line-color', LINE_COLOR_EXPR);
      }
      if (this.map.getLayer(LAYER_CASING)) {
        this.map.setPaintProperty(LAYER_CASING, 'line-width', CASING_WIDTH);
      }
      if (this.map.getLayer(LAYER_MAIN_HIT)) {
        this.map.setPaintProperty(LAYER_MAIN_HIT, 'line-width', HIT_WIDTH);
      }
      this._ensureFlowLayer();
    }

    void this._ensureRouteIcons().then(() => {
      if (!this.map.getStyle()) return;
      this._ensureFlowLayer();
      this._ensureArrowLayer();
      for (const id of [
        LAYER_ALT_HIT,
        LAYER_ALT,
        LAYER_MAIN_HIT,
        LAYER_CASING,
        LAYER_LINE,
        LAYER_FLOW,
        LAYER_ARROWS,
        LAYER_MANEUVERS_HIT,
        LAYER_MANEUVERS
      ]) {
        if (this.map.getLayer(id)) this.map.moveLayer(id);
      }
      if (this.map.getLayer('maphaj-od-pins')) {
        try {
          this.map.moveLayer('maphaj-od-pins');
        } catch {
          /* ignore */
        }
      }
      this._startFlowAnimation();
    });

    for (const id of [
      LAYER_ALT_HIT,
      LAYER_ALT,
      LAYER_MAIN_HIT,
      LAYER_CASING,
      LAYER_LINE,
      LAYER_FLOW
    ]) {
      if (this.map.getLayer(id)) this.map.moveLayer(id);
    }

    // Pins OD por cima da polyline
    if (this.map.getLayer('maphaj-od-pins')) {
      try {
        this.map.moveLayer('maphaj-od-pins');
      } catch {
        /* ignore */
      }
    }

    this._startFlowAnimation();

    if (fit) {
      let bounds = null;
      for (const route of routes) {
        for (const c of route.coordinates) {
          if (!bounds) bounds = new maplibregl.LngLatBounds(c, c);
          else bounds = bounds.extend(c);
        }
      }
      if (bounds) {
        this.map.fitBounds(bounds, { padding: 72, maxZoom: 15, duration: 600 });
      }
    }

    void this._refreshManeuvers();

    if (this._navMode) {
      this.setNavigationMode(true);
    }
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
