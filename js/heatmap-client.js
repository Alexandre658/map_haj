/**
 * Cliente do mapa de calor (procura / surge).
 * Tenta GET /api/pricing-zones; fallback para pontos demo em Luanda.
 */

/**
 * @typedef {{ lat: number, lng: number, weight: number, intensity?: number, multiplier?: number, zoneId?: string, name?: string }} HeatPoint
 */

export class HeatmapClient {
  /**
   * @param {{ baseUrl: string, apiKey?: string }} config
   */
  constructor(config) {
    this.config = config;
    /** @type {Map<string, { points: HeatPoint[], expiresAt: number }>} */
    this._cache = new Map();
    this._ttlMs = 60_000;
  }

  get baseUrl() {
    return String(this.config.baseUrl || '').replace(/\/$/, '');
  }

  _headers() {
    const h = { Accept: 'application/json' };
    if (this.config.apiKey) h['x-api-key'] = this.config.apiKey;
    return h;
  }

  _cacheKey(lat, lng, radiusKm) {
    return `${lat.toFixed(2)},${lng.toFixed(2)},${radiusKm}`;
  }

  /**
   * @param {{ lat: number, lng: number, radiusKm?: number, signal?: AbortSignal, allowDemo?: boolean, forceMock?: boolean }} opts
   * @returns {Promise<{ points: HeatPoint[], source: 'api'|'demo'|'cache'|'mock', key: string }|null>}
   *   `null` se não houver dados novos (mantém os actuais no mapa).
   */
  async getHeatPoints(opts) {
    const lat = opts.lat;
    const lng = opts.lng;
    const radiusKm = opts.radiusKm ?? 10;
    const allowDemo = opts.allowDemo !== false;
    const forceMock = Boolean(opts.forceMock);
    const key = this._cacheKey(lat, lng, radiusKm) + (forceMock ? '|mock' : '');

    if (forceMock) {
      const demo = generateDemoHeatPoints(lat, lng, radiusKm);
      return { points: demo, source: 'mock', key };
    }

    const hit = this._cache.get(key);
    if (hit && Date.now() < hit.expiresAt) {
      return { points: hit.points, source: 'cache', key };
    }

    try {
      const points = await this._fetchPricingZones(lat, lng, radiusKm, opts.signal);
      if (points.length) {
        this._cache.set(key, {
          points,
          expiresAt: Date.now() + this._ttlMs
        });
        return { points, source: 'api', key };
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      console.warn('[heatmap] API:', err?.message || err);
    }

    // Sem dados novos da API: não inventar demo a cada pan do mapa
    if (!allowDemo) return null;

    const demo = generateDemoHeatPoints(lat, lng, radiusKm);
    return { points: demo, source: 'demo', key };
  }

  /**
   * @param {number} lat
   * @param {number} lng
   * @param {number} radiusKm
   * @param {AbortSignal} [signal]
   */
  async _fetchPricingZones(lat, lng, radiusKm, signal) {
    const paths = [
      `/api/pricing-zones?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`,
      `/pricing-zones?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`
    ];

    let lastErr = null;
    for (const path of paths) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          headers: this._headers(),
          signal
        });
        if (res.status === 404) continue;
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success === false) {
          lastErr = new Error(
            json?.error?.message || json?.message || `HTTP ${res.status}`
          );
          continue;
        }
        const data = json.data || json;
        return parsePricingZonesToHeatPoints(data);
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
    return [];
  }
}

/**
 * @param {object} data
 * @returns {HeatPoint[]}
 */
export function parsePricingZonesToHeatPoints(data) {
  const zones = Array.isArray(data?.zones) ? data.zones : [];
  const multipliers = Array.isArray(data?.zone_multipliers)
    ? data.zone_multipliers
    : [];
  const multById = new Map();
  for (const m of multipliers) {
    const id = String(m.zone_id ?? m.zoneId ?? '');
    if (!id) continue;
    multById.set(
      id,
      Number(m.current_multiplier ?? m.multiplier ?? 1) || 1
    );
  }

  /** @type {HeatPoint[]} */
  const points = [];
  for (const z of zones) {
    const id = String(z.id ?? z.zoneId ?? '');
    const multiplier =
      multById.get(id) ||
      Number(z.multiplier ?? z.current_multiplier ?? 1) ||
      1;
    const intensity = multiplierToIntensity(multiplier);
    const center = zoneCenter(z);
    if (!center) continue;

    points.push({
      lat: center.lat,
      lng: center.lng,
      weight: intensity,
      intensity,
      multiplier,
      zoneId: id || `z_${points.length}`,
      name: z.name || ''
    });

    // Mais pontos no polígono → blob de calor mais natural
    const poly = Array.isArray(z.polygon) ? z.polygon : [];
    for (let i = 0; i < poly.length; i += Math.max(1, Math.floor(poly.length / 8))) {
      const p = poly[i];
      const plat = Number(p?.lat ?? p?.latitude);
      const plng = Number(p?.lng ?? p?.longitude);
      if (!Number.isFinite(plat) || !Number.isFinite(plng)) continue;
      points.push({
        lat: plat,
        lng: plng,
        weight: intensity * 0.65,
        intensity: intensity * 0.65,
        multiplier,
        zoneId: id
      });
    }
  }
  return points;
}

function zoneCenter(z) {
  if (z.center) {
    const lat = Number(z.center.lat ?? z.center.latitude);
    const lng = Number(z.center.lng ?? z.center.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const poly = Array.isArray(z.polygon) ? z.polygon : [];
  if (!poly.length) return null;
  let slat = 0;
  let slng = 0;
  let n = 0;
  for (const p of poly) {
    const lat = Number(p?.lat ?? p?.latitude);
    const lng = Number(p?.lng ?? p?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    slat += lat;
    slng += lng;
    n += 1;
  }
  if (!n) return null;
  return { lat: slat / n, lng: slng / n };
}

/** Multiplier 1.0 → ~0.15; 2.5x → ~1.0 */
export function multiplierToIntensity(multiplier) {
  const m = Number(multiplier) || 1;
  return Math.max(0.08, Math.min(1, (m - 0.85) / 1.8));
}

/**
 * Pontos demo (Luanda / centro do mapa) para a UI funcionar sem API.
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusKm
 * @returns {HeatPoint[]}
 */
export function generateDemoHeatPoints(lat, lng, radiusKm = 10) {
  const deg = radiusKm / 111;
  /** @type {Array<[number, number, number, number]>} */
  const seeds = [
    [0.012, 0.008, 0.92, 2.8],
    [-0.018, 0.014, 0.75, 2.1],
    [0.006, -0.022, 0.55, 1.6],
    [-0.01, -0.01, 0.35, 1.3],
    [0.025, -0.005, 0.82, 2.4],
    [-0.028, -0.02, 0.28, 1.15],
    [0.002, 0.03, 0.65, 1.9],
    [0.035, 0.02, 0.45, 1.45],
    [-0.005, 0.005, 0.2, 1.05],
    [0.015, -0.035, 0.7, 2.0]
  ];

  /** @type {HeatPoint[]} */
  const points = [];
  let i = 0;
  for (const [dLat, dLng, intensity, multiplier] of seeds) {
    const scale = Math.min(1, deg / 0.09);
    const plat = lat + dLat * scale;
    const plng = lng + dLng * scale;
    // núcleo + satélites
    for (let k = 0; k < 5; k++) {
      const jitter = 0.004 * (k / 4);
      const angle = (k / 5) * Math.PI * 2;
      points.push({
        lat: plat + Math.cos(angle) * jitter,
        lng: plng + Math.sin(angle) * jitter,
        weight: intensity * (k === 0 ? 1 : 0.55),
        intensity: intensity * (k === 0 ? 1 : 0.55),
        multiplier,
        zoneId: `demo_${i}`,
        name: `Zona demo ${i + 1}`
      });
    }
    i += 1;
  }
  return points;
}

/**
 * @param {HeatPoint[]} points
 */
export function heatPointsToGeoJSON(points) {
  return {
    type: 'FeatureCollection',
    features: (points || []).map((p, index) => ({
      type: 'Feature',
      properties: {
        weight: p.weight ?? p.intensity ?? 0.5,
        intensity: p.intensity ?? p.weight ?? 0.5,
        multiplier: p.multiplier ?? 1,
        zoneId: p.zoneId || `p_${index}`,
        name: p.name || ''
      },
      geometry: {
        type: 'Point',
        coordinates: [p.lng, p.lat]
      }
    }))
  };
}
