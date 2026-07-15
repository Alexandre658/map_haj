/**
 * Cliente Directions — POST /api/directions/route (Moveme backend).
 */

import {
  extractAllRoutes,
  extractRouteCoordinates,
  extractRouteMeta,
  formatDistance,
  formatDuration
} from './polyline.js';
import { extractTrafficSegments } from './traffic-segments.js';

export class DirectionsClient {
  /**
   * @param {{ baseUrl: string, apiKey?: string }} config
   */
  constructor(config) {
    this.config = config;
    /** @type {Map<string, { data: object, expiresAt: number }>} */
    this._cache = new Map();
    this._ttlMs = 120_000;
  }

  get baseUrl() {
    return String(this.config.baseUrl || '').replace(/\/$/, '');
  }

  _headers() {
    const h = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
    if (this.config.apiKey) h['x-api-key'] = this.config.apiKey;
    return h;
  }

  _quantize(lat, lng, decimals = 4) {
    const f = 10 ** decimals;
    return {
      latitude: Math.round(lat * f) / f,
      longitude: Math.round(lng * f) / f
    };
  }

  _cacheKey(origin, destination, waypoints, mode) {
    let k = `${mode || 'driving'}|${origin.latitude},${origin.longitude}|${destination.latitude},${destination.longitude}`;
    if (waypoints?.length) {
      for (const w of waypoints) {
        k += `|${w.latitude},${w.longitude}`;
      }
    }
    return k;
  }

  /**
   * @param {{ lat: number, lng: number }} origin
   * @param {{ lat: number, lng: number }} destination
   * @param {{ waypoints?: Array<{lat:number,lng:number}>, signal?: AbortSignal, alternatives?: boolean, mode?: string }} [opts]
   */
  async getRoute(origin, destination, opts = {}) {
    if (!origin || !destination) {
      throw new Error('Origem e destino são obrigatórios');
    }

    const mode = opts.mode || 'driving';
    const o = this._quantize(origin.lat, origin.lng);
    const d = this._quantize(destination.lat, destination.lng);
    const wps = (opts.waypoints || []).map((w) =>
      this._quantize(w.lat, w.lng)
    );

    const key = this._cacheKey(o, d, wps, mode);
    const hit = this._cache.get(key);
    if (hit && Date.now() < hit.expiresAt) {
      return this._normalize(hit.data);
    }

    const body = {
      origin: o,
      destination: d,
      options: {
        mode,
        alternatives: opts.alternatives !== false,
        overview: 'full',
        steps: true,
        language: 'pt',
        // Para duration_in_traffic (zonas engarrafadas)
        departure_time: 'now',
        departureTime: 'now',
        traffic: true
      }
    };
    if (wps.length) {
      body.waypoints = wps;
    }

    const res = await fetch(`${this.baseUrl}/api/directions/route`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
      signal: opts.signal
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const msg =
        json?.error?.message ||
        json?.message ||
        `Directions falhou (${res.status})`;
      throw new Error(msg);
    }

    const data = json.data || json;
    this._cache.set(key, {
      data,
      expiresAt: Date.now() + this._ttlMs
    });

    return this._normalize(data);
  }

  _normalize(data) {
    const routes = extractAllRoutes(data).map((r) => ({
      ...r,
      trafficSegments: extractTrafficSegments({
        coordinates: r.coordinates,
        raw: r.raw || data
      })
    }));
    const primary =
      routes.find((r) => r.primary) || routes[0] || null;
    const coordinates =
      primary?.coordinates || extractRouteCoordinates(data);
    if (!coordinates || coordinates.length < 2) {
      throw new Error('Rota sem geometria (polyline)');
    }

    const meta = primary
      ? {
          distanceMeters: primary.distanceMeters,
          durationSeconds: primary.durationSeconds,
          summary: primary.summary
        }
      : extractRouteMeta(data);

    const alternatives = routes
      .filter((r) => !r.primary)
      .map((r) => r.coordinates);

    return {
      coordinates,
      alternatives,
      routes,
      distanceMeters: meta.distanceMeters,
      durationSeconds: meta.durationSeconds,
      summary: meta.summary,
      distanceText: formatDistance(meta.distanceMeters),
      durationText: formatDuration(meta.durationSeconds),
      raw: data
    };
  }
}
