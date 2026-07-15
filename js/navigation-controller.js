/**
 * Modo navegação turn-by-turn estilo Google Maps.
 * GPS ao vivo, câmara follow com look-ahead, recenter, progresso na rota.
 */

import { nearestPointOnLine } from './route-layer.js';
import {
  formatManeuverText,
  maneuverIconSvg,
  resolveManeuvers
} from './route-maneuvers.js';
import { formatDistance, formatDuration } from './polyline.js';

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

function bearingDeg(lng1, lat1, lng2, lat2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Avança um ponto a partir de lng/lat por `meters` no bearing. */
function offsetByBearing(lng, lat, bearing, meters) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const δ = meters / R;
  const θ = toRad(bearing);
  const φ1 = toRad(lat);
  const λ1 = toRad(lng);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );
  return [toDeg(λ2), toDeg(φ2)];
}

function bearingAlongRoute(coordinates, alongMeters) {
  if (!coordinates || coordinates.length < 2) return 0;
  let traveled = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const a = coordinates[i];
    const b = coordinates[i + 1];
    const seg = haversineMeters(a[0], a[1], b[0], b[1]);
    if (traveled + seg >= alongMeters || i === coordinates.length - 2) {
      return bearingDeg(a[0], a[1], b[0], b[1]);
    }
    traveled += seg;
  }
  const n = coordinates.length;
  return bearingDeg(
    coordinates[n - 2][0],
    coordinates[n - 2][1],
    coordinates[n - 1][0],
    coordinates[n - 1][1]
  );
}

/** Distância estilo Google Navigation (ex.: "250 m", "1,2 km"). */
export function formatNavDistance(meters) {
  if (meters == null || !Number.isFinite(meters)) return '—';
  if (meters < 1000) {
    const step = meters < 50 ? 5 : 10;
    return `${Math.max(0, Math.round(meters / step) * step)} m`;
  }
  const km = meters / 1000;
  return `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} km`;
}

function formatArrivalClock(remainingSeconds) {
  if (remainingSeconds == null || !Number.isFinite(remainingSeconds)) {
    return '—';
  }
  const eta = new Date(Date.now() + remainingSeconds * 1000);
  const hh = String(eta.getHours()).padStart(2, '0');
  const mm = String(eta.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function zoomForSpeed(speedMs) {
  // Google aproxima-se em baixo e afasta em velocidade
  if (speedMs == null || speedMs < 2) return 17.2;
  if (speedMs < 8) return 16.6;
  if (speedMs < 16) return 15.8;
  return 15.2;
}

/**
 * Corta a polyline a partir de `alongMeters` (resto = navegação).
 * @param {number[][]} coordinates
 * @param {number} alongMeters
 * @returns {{ traveled: number[][], remaining: number[][] }}
 */
export function splitPolylineAt(alongMeters, coordinates) {
  if (!coordinates || coordinates.length < 2) {
    return { traveled: [], remaining: coordinates || [] };
  }
  const target = Math.max(0, alongMeters);
  let traveledDist = 0;
  const traveled = [coordinates[0]];

  for (let i = 0; i < coordinates.length - 1; i++) {
    const a = coordinates[i];
    const b = coordinates[i + 1];
    const seg = haversineMeters(a[0], a[1], b[0], b[1]);
    if (traveledDist + seg >= target) {
      const t = seg > 0 ? (target - traveledDist) / seg : 0;
      const cut = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      traveled.push(cut);
      const remaining = [cut, ...coordinates.slice(i + 1)];
      return { traveled, remaining };
    }
    traveled.push(b);
    traveledDist += seg;
  }
  return {
    traveled: coordinates.slice(),
    remaining: [coordinates[coordinates.length - 1]]
  };
}

export class NavigationController {
  /**
   * @param {{
   *   map: import('maplibre-gl').Map,
   *   reverseGeocode?: (p: {lat:number,lng:number}) => Promise<string|null>,
   *   onUpdate?: (state: object) => void,
   *   onOffRoute?: (pos: {lat:number,lng:number}) => void,
   *   onArrived?: () => void,
   *   onProgress?: (p: { alongMeters: number, remaining: number[][], traveled: number[][] }) => void,
   *   onFollowChange?: (following: boolean) => void,
   *   offRouteMeters?: number,
   *   arriveMeters?: number,
   *   voiceEnabled?: boolean
   * }} opts
   */
  constructor(opts) {
    this.map = opts.map;
    this.reverseGeocode = opts.reverseGeocode || null;
    this.onUpdate = opts.onUpdate || null;
    this.onOffRoute = opts.onOffRoute || null;
    this.onArrived = opts.onArrived || null;
    this.onProgress = opts.onProgress || null;
    this.onFollowChange = opts.onFollowChange || null;
    this.offRouteMeters = opts.offRouteMeters ?? 35;
    this.arriveMeters = opts.arriveMeters ?? 35;
    this.voiceEnabled = opts.voiceEnabled !== false;
    /** Hits consecutivos GPS fora da polyline para disparar recalc */
    this.offRouteHitsNeeded = opts.offRouteHitsNeeded ?? 2;
    /** Segundos mínimos entre recalculos */
    this.rerouteCooldownSec = opts.rerouteCooldownSec ?? 8;

    /** @type {number[][]|null} */
    this._coordinates = null;
    this._distanceMeters = null;
    this._durationSeconds = null;
    /** @type {Array<object>} */
    this._maneuvers = [];
    this._active = false;
    this._watchId = null;
    this._offRouteHits = 0;
    this._rerouting = false;
    this._lastRerouteAt = 0;
    this._navMarker = null;
    this._lastPos = null;
    this._lastHeading = 0;
    this._maneuverGen = 0;
    this._following = true;
    this._userInteracting = false;
    this._programmaticCamera = false;
    this._cameraLockTimer = null;
    this._lastSpokenKey = '';
    this._dragStartHandler = null;
    this._dragEndHandler = null;
    this._arriveTimer = null;
  }

  get active() {
    return this._active;
  }

  get following() {
    return this._following;
  }

  /**
   * @param {{
   *   coordinates: number[][],
   *   distanceMeters?: number|null,
   *   durationSeconds?: number|null,
   *   raw?: object|null
   * }} route
   */
  async setRoute(route) {
    this._coordinates = route?.coordinates || null;
    this._distanceMeters = route?.distanceMeters ?? null;
    this._durationSeconds = route?.durationSeconds ?? null;
    this._maneuvers = [];
    this._offRouteHits = 0;
    if (!this._coordinates?.length) return;

    const gen = ++this._maneuverGen;
    const maneuvers = await resolveManeuvers(this._coordinates, {
      routeRaw: route.raw || null,
      reverseGeocode: this.reverseGeocode
    });
    if (gen !== this._maneuverGen) return;
    this._maneuvers = (maneuvers || []).filter(
      (m) => m && m.type !== 'continue'
    );
  }

  /** Chamado pelo host enquanto o pedido de directions corre. */
  beginReroute() {
    this._rerouting = true;
    this._offRouteHits = 0;
  }

  /** Chamado após sucesso/falha do recalculo. */
  endReroute({ ok = true } = {}) {
    this._rerouting = false;
    this._offRouteHits = 0;
    if (ok) this._lastRerouteAt = Date.now();
  }

  get rerouting() {
    return this._rerouting;
  }

  async start() {
    if (!this._coordinates || this._coordinates.length < 2) {
      throw new Error('Sem rota para navegar');
    }
    if (!navigator.geolocation) {
      throw new Error('Geolocalização não disponível');
    }
    if (this._active) return;
    this._active = true;
    this._offRouteHits = 0;
    this._rerouting = false;
    this._lastRerouteAt = 0;
    this._following = true;
    this._userInteracting = false;
    this._lastSpokenKey = '';
    this._programmaticCamera = false;
    this._ensureNavMarker();
    this._bindMapInteraction();
    this.onFollowChange?.(true);

    // Entra em 3D de imediato (não espera pelo 1º GPS)
    this._enter3D();

    this._watchId = navigator.geolocation.watchPosition(
      (pos) => this._onPosition(pos),
      (err) => {
        console.warn('[Navigation] GPS:', err?.message || err);
        this.onUpdate?.({
          active: true,
          error: err?.message || 'Erro de GPS',
          following: this._following
        });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 15000
      }
    );

    this.onUpdate?.({
      active: true,
      starting: true,
      instruction: 'A obter localização…',
      type: 'continue',
      following: true,
      distanceToManeuverText: '—',
      remainingDurationText: '—',
      remainingDistanceText: '—',
      arrivalTimeText: '—',
      iconHtml: maneuverIconSvg('continue')
    });
  }

  stop() {
    this._active = false;
    this._offRouteHits = 0;
    this._rerouting = false;
    this._following = true;
    this._userInteracting = false;
    this._programmaticCamera = false;
    if (this._cameraLockTimer) {
      clearTimeout(this._cameraLockTimer);
      this._cameraLockTimer = null;
    }
    if (this._arriveTimer) {
      clearTimeout(this._arriveTimer);
      this._arriveTimer = null;
    }
    if (this._watchId != null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
    this._unbindMapInteraction();
    if (this._navMarker) {
      this._navMarker.remove();
      this._navMarker = null;
    }
    try {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    try {
      this.map.easeTo({
        pitch: 0,
        bearing: 0,
        duration: 600
      });
    } catch {
      /* ignore */
    }
    this.onFollowChange?.(true);
    this.onUpdate?.({ active: false });
  }

  /** Volta a seguir o GPS (botão Recentrar estilo Google). */
  resumeFollow() {
    if (!this._active) return;
    this._following = true;
    this._userInteracting = false;
    this.onFollowChange?.(true);
    if (this._lastPos) {
      this._updateCamera(
        [this._lastPos.lng, this._lastPos.lat],
        this._lastHeading,
        0
      );
    } else {
      this._enter3D();
    }
  }

  setVoiceEnabled(enabled) {
    this.voiceEnabled = Boolean(enabled);
    if (!this.voiceEnabled) {
      try {
        if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Aplica vista 3D de navegação (pitch + zoom + bearing da rota).
   */
  _enter3D() {
    if (!this._coordinates || this._coordinates.length < 2) return;

    let lngLat = this._coordinates[0];
    let heading = bearingAlongRoute(this._coordinates, 0);

    if (this._lastPos) {
      lngLat = [this._lastPos.lng, this._lastPos.lat];
      heading = this._lastHeading || heading;
    } else {
      // Coloca o puck no início da rota enquanto o GPS chega
      this._ensureNavMarker();
      this._navMarker.setLngLat(lngLat).setRotation(heading).addTo(this.map);
    }

    this._lastHeading = heading;
    this._updateCamera(lngLat, heading, 0, { duration: 900, force: true });
  }

  _bindMapInteraction() {
    this._unbindMapInteraction();
    this._dragStartHandler = () => {
      if (!this._active || this._programmaticCamera) return;
      this._userInteracting = true;
      if (this._following) {
        this._following = false;
        this.onFollowChange?.(false);
        this.onUpdate?.({
          active: true,
          following: false,
          keepHud: true
        });
      }
    };
    this._dragEndHandler = () => {
      if (this._programmaticCamera) return;
      this._userInteracting = false;
    };
    this.map.on('dragstart', this._dragStartHandler);
    this.map.on('dragend', this._dragEndHandler);
    this.map.on('rotatestart', this._dragStartHandler);
    this.map.on('pitchstart', this._dragStartHandler);
  }

  _unbindMapInteraction() {
    if (this._dragStartHandler) {
      this.map.off('dragstart', this._dragStartHandler);
      this.map.off('rotatestart', this._dragStartHandler);
      this.map.off('pitchstart', this._dragStartHandler);
      this._dragStartHandler = null;
    }
    if (this._dragEndHandler) {
      this.map.off('dragend', this._dragEndHandler);
      this._dragEndHandler = null;
    }
  }

  _ensureNavMarker() {
    if (this._navMarker) return;
    const el = document.createElement('div');
    el.className = 'nav-puck';
    const img = document.createElement('img');
    img.src = new URL('../assets/icons/Me.png', import.meta.url).href;
    img.width = 56;
    img.height = 56;
    img.alt = 'A sua posição';
    img.draggable = false;
    el.appendChild(img);
    this._navMarker = new maplibregl.Marker({
      element: el,
      anchor: 'center',
      // Roda com o heading (como Google); mantém legível em pitch 3D
      rotationAlignment: 'map',
      pitchAlignment: 'viewport'
    });
  }

  /**
   * @param {number[]} lngLat
   * @param {number} heading
   * @param {number} speedMs
   * @param {{ duration?: number, force?: boolean }} [opts]
   */
  _updateCamera(lngLat, heading, speedMs, opts = {}) {
    if (!opts.force && (!this._following || this._userInteracting)) return;
    const lookAhead = speedMs > 8 ? 90 : speedMs > 3 ? 55 : 40;
    const center = offsetByBearing(lngLat[0], lngLat[1], heading, lookAhead);
    this._programmaticCamera = true;
    try {
      this.map.easeTo({
        center,
        bearing: heading,
        pitch: 65,
        zoom: Math.max(zoomForSpeed(speedMs), 16.5),
        duration: opts.duration ?? 850,
        essential: true,
        padding: { top: 160, bottom: 140, left: 0, right: 0 }
      });
    } catch {
      try {
        this.map.jumpTo({
          center,
          bearing: heading,
          pitch: 65,
          zoom: Math.max(zoomForSpeed(speedMs), 16.5)
        });
      } catch {
        /* ignore */
      }
    }
    // Liberta o lock após a animação (pitchstart/rotatestart programáticos)
    clearTimeout(this._cameraLockTimer);
    this._cameraLockTimer = setTimeout(() => {
      this._programmaticCamera = false;
    }, (opts.duration ?? 850) + 80);
  }

  /**
   * @param {GeolocationPosition} pos
   */
  _onPosition(pos) {
    if (!this._active || !this._coordinates) return;

    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const gpsHeading =
      pos.coords.heading != null && Number.isFinite(pos.coords.heading)
        ? pos.coords.heading
        : null;
    const speed = pos.coords.speed != null ? pos.coords.speed : 0;

    const nearest = nearestPointOnLine(this._coordinates, [lng, lat]);
    if (!nearest) return;

    const offRoute = nearest.distanceToLineMeters > this.offRouteMeters;
    if (this._rerouting) {
      this._offRouteHits = 0;
    } else if (offRoute) {
      this._offRouteHits += 1;
    } else {
      this._offRouteHits = 0;
    }

    const remainingGeom = Math.max(
      0,
      nearest.totalMeters - nearest.alongMeters
    );
    const fractionLeft =
      nearest.totalMeters > 0 ? remainingGeom / nearest.totalMeters : 0;
    const remainingDist =
      this._distanceMeters != null
        ? Math.max(0, this._distanceMeters * fractionLeft)
        : remainingGeom;
    const remainingTime =
      this._durationSeconds != null
        ? Math.max(0, this._durationSeconds * fractionLeft)
        : null;

    const routeBearing = bearingAlongRoute(
      this._coordinates,
      nearest.alongMeters
    );
    const heading =
      gpsHeading != null && speed > 1.2 ? gpsHeading : routeBearing;
    this._lastHeading = heading;
    this._lastPos = { lat, lng };

    const displayLngLat =
      nearest.distanceToLineMeters < this.offRouteMeters
        ? nearest.lngLat
        : [lng, lat];

    this._navMarker.setLngLat(displayLngLat).setRotation(heading).addTo(this.map);
    this._updateCamera(displayLngLat, heading, speed);

    const split = splitPolylineAt(nearest.alongMeters, this._coordinates);
    this.onProgress?.({
      alongMeters: nearest.alongMeters,
      traveled: split.traveled,
      remaining: split.remaining
    });

    const next = this._nextManeuver(nearest.alongMeters);
    const distToManeuver = next
      ? Math.max(0, next.alongMeters - nearest.alongMeters)
      : remainingDist;

    const arrived = remainingGeom <= this.arriveMeters;
    if (arrived) {
      this._emitArrived({ lat, lng, heading });
      return;
    }

    if (this._rerouting) {
      this.onUpdate?.({
        active: true,
        offRoute: true,
        following: this._following,
        instruction: 'A recalcular rota…',
        type: 'continue',
        distanceToManeuverText: '—',
        remainingDistanceText: formatNavDistance(remainingDist),
        remainingDurationText: formatDuration(remainingTime),
        arrivalTimeText: formatArrivalClock(remainingTime),
        remainingDistanceMeters: remainingDist,
        remainingDurationSeconds: remainingTime,
        heading,
        position: { lat, lng },
        speedMps: speed,
        iconHtml: maneuverIconSvg('continue')
      });
      return;
    }

    const cooldownMs = (this.rerouteCooldownSec || 8) * 1000;
    const cooledDown = Date.now() - this._lastRerouteAt >= cooldownMs;
    if (
      this._offRouteHits >= this.offRouteHitsNeeded &&
      cooledDown
    ) {
      this.beginReroute();
      this.onUpdate?.({
        active: true,
        offRoute: true,
        following: this._following,
        instruction: 'A recalcular rota…',
        type: 'continue',
        distanceToManeuverText: '—',
        remainingDistanceText: formatNavDistance(remainingDist),
        remainingDurationText: formatDuration(remainingTime),
        arrivalTimeText: formatArrivalClock(remainingTime),
        remainingDistanceMeters: remainingDist,
        remainingDurationSeconds: remainingTime,
        heading,
        position: { lat, lng },
        speedMps: speed,
        iconHtml: maneuverIconSvg('continue')
      });
      this.onOffRoute?.({ lat, lng });
      return;
    }

    // Fora da rota mas ainda a acumular hits / em cooldown
    if (offRoute) {
      this.onUpdate?.({
        active: true,
        offRoute: true,
        following: this._following,
        instruction: 'Fora da rota',
        secondary: 'A verificar…',
        type: 'continue',
        distanceToManeuverText: '—',
        remainingDistanceText: formatNavDistance(remainingDist),
        remainingDurationText: formatDuration(remainingTime),
        arrivalTimeText: formatArrivalClock(remainingTime),
        remainingDistanceMeters: remainingDist,
        remainingDurationSeconds: remainingTime,
        heading,
        position: { lat, lng },
        speedMps: speed,
        iconHtml: maneuverIconSvg('continue')
      });
      return;
    }

    // Google: distância grande + nome da rua (ou instrução curta)
    const street = next?.street || null;
    const instruction =
      street ||
      next?.instruction ||
      formatManeuverText(next?.type || 'continue', null) ||
      'Siga em frente';
    const secondary =
      street && next?.type
        ? formatManeuverText(next.type, null)
        : next?.instruction && street
          ? next.instruction
          : null;

    this._maybeSpeak(next, distToManeuver, instruction);

    this.onUpdate?.({
      active: true,
      arrived: false,
      offRoute: false,
      following: this._following,
      type: next?.type || 'continue',
      instruction,
      secondary,
      street,
      distanceToManeuverMeters: distToManeuver,
      distanceToManeuverText: formatNavDistance(distToManeuver),
      remainingDistanceMeters: remainingDist,
      remainingDurationSeconds: remainingTime,
      remainingDistanceText: formatNavDistance(remainingDist),
      remainingDurationText: formatDuration(remainingTime),
      arrivalTimeText: formatArrivalClock(remainingTime),
      alongMeters: nearest.alongMeters,
      heading,
      position: { lat, lng },
      speedMps: speed,
      speedKmh:
        speed != null && speed > 0.5 ? Math.round(speed * 3.6) : null,
      iconHtml: maneuverIconSvg(next?.type || 'continue')
    });
  }

  _emitArrived({ lat, lng, heading }) {
    this.onUpdate?.({
      active: true,
      arrived: true,
      following: this._following,
      instruction: 'Chegou ao destino',
      secondary: null,
      type: 'continue',
      distanceToManeuverText: '0 m',
      remainingDistanceText: '0 m',
      remainingDurationText: '0 min',
      arrivalTimeText: formatArrivalClock(0),
      remainingDistanceMeters: 0,
      remainingDurationSeconds: 0,
      heading,
      position: { lat, lng },
      offRoute: false,
      iconHtml: maneuverIconSvg('continue')
    });
    this.onArrived?.();
    if (this._watchId != null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
    this._active = false;
    this._unbindMapInteraction();
    this._arriveTimer = setTimeout(() => {
      this._arriveTimer = null;
      if (this._navMarker) {
        this._navMarker.remove();
        this._navMarker = null;
      }
      try {
        this.map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
      } catch {
        /* ignore */
      }
      this.onUpdate?.({ active: false, arrived: true });
    }, 2400);
  }

  _maybeSpeak(next, distToManeuver, instruction) {
    if (!this.voiceEnabled || !next) return;
    if (typeof speechSynthesis === 'undefined') return;
    let cue = null;
    if (distToManeuver <= 40) cue = 'now';
    else if (distToManeuver <= 120) cue = 'near';
    else if (distToManeuver <= 280) cue = 'soon';
    if (!cue) return;
    const key = `${cue}:${next.type}:${next.alongMeters?.toFixed?.(0) || 0}`;
    if (key === this._lastSpokenKey) return;
    this._lastSpokenKey = key;
    const distLabel =
      cue === 'now'
        ? instruction
        : `Em ${formatNavDistance(distToManeuver)}, ${instruction}`;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(distLabel);
      u.lang = 'pt-PT';
      u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  }

  _nextManeuver(alongMeters) {
    const ahead = this._maneuvers
      .filter((m) => (m.alongMeters ?? 0) > alongMeters + 12)
      .sort((a, b) => a.alongMeters - b.alongMeters);
    return ahead[0] || null;
  }
}

export { formatDistance, formatDuration };
