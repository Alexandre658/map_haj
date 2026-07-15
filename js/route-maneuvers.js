/**
 * Extrai manobras (curvas) a partir da geometria da polyline
 * e gera textos estilo Google Maps (pt).
 */

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

function deltaBearing(a, b) {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

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

/**
 * @typedef {'slight-right'|'right'|'sharp-right'|'slight-left'|'left'|'sharp-left'|'uturn'|'continue'} ManeuverType
 */

/**
 * @param {number} turnAngle graus (-180..180), positivo = direita
 * @returns {ManeuverType|null}
 */
export function classifyTurn(turnAngle) {
  const a = Math.abs(turnAngle);
  const right = turnAngle > 0;
  if (a < 18) return null;
  if (a < 35) return right ? 'slight-right' : 'slight-left';
  if (a < 100) return right ? 'right' : 'left';
  if (a < 155) return right ? 'sharp-right' : 'sharp-left';
  return 'uturn';
}

/**
 * @param {ManeuverType} type
 * @param {string|null|undefined} street
 */
export function formatManeuverText(type, street) {
  const s = (street || '').trim();
  const toward = s ? ` em direção a ${s}` : '';
  const to = s ? ` para ${s}` : '';
  const follow = s ? ` ${s}` : '';

  switch (type) {
    case 'slight-right':
      return `Curvar ligeiramente à direita${toward}`;
    case 'slight-left':
      return `Curvar ligeiramente à esquerda${toward}`;
    case 'right':
      return `Vire à direita${to}`;
    case 'left':
      return `Vire à esquerda${to}`;
    case 'sharp-right':
      return `Vire acentuadamente à direita${to}`;
    case 'sharp-left':
      return `Vire acentuadamente à esquerda${to}`;
    case 'uturn':
      return s ? `Faça inversão de marcha em ${s}` : 'Faça inversão de marcha';
    case 'continue':
      return s ? `Continue a seguir${follow}` : 'Continue em frente';
    default:
      return s || 'Continue';
  }
}

/**
 * Ícone textual simples (legado).
 * @param {ManeuverType} type
 */
export function maneuverSymbol(type) {
  switch (type) {
    case 'slight-right':
    case 'right':
    case 'sharp-right':
      return '↗';
    case 'slight-left':
    case 'left':
    case 'sharp-left':
      return '↖';
    case 'uturn':
      return '↩';
    default:
      return '↑';
  }
}

/**
 * SVG vectorial estilo Google Maps (setas de navegação).
 * Chegada sempre pelo fundo do SVG (= sentido de marcha); depois roda-se pelo bearing.
 * @param {ManeuverType} type
 * @returns {string} markup SVG
 */
export function maneuverIconSvg(type) {
  const icons = {
    'slight-right':
      '<path d="M11 21V11c0-1.4.5-2.4 1.5-3.3L18 3.5"/>' +
      '<path d="M14.2 3.4h4.3v4.3"/>',
    right:
      '<path d="M11 21v-9c0-1.1.9-2 2-2h8"/>' +
      '<path d="M17.5 6.5 21 10l-3.5 3.5"/>',
    'sharp-right':
      '<path d="M11 21v-8h9"/>' +
      '<path d="M16.5 9.5 20 13l-3.5 3.5"/>',
    'slight-left':
      '<path d="M13 21V11c0-1.4-.5-2.4-1.5-3.3L6 3.5"/>' +
      '<path d="M9.8 3.4H5.5v4.3"/>',
    left:
      '<path d="M13 21v-9c0-1.1-.9-2-2-2H3"/>' +
      '<path d="M6.5 6.5 3 10l3.5 3.5"/>',
    'sharp-left':
      '<path d="M13 21v-8H4"/>' +
      '<path d="M7.5 9.5 4 13l3.5 3.5"/>',
    uturn:
      '<path d="M9 21v-9a4.5 4.5 0 0 1 9 0v9"/>' +
      '<path d="M14.5 17.5 18 21l3.5-3.5"/>',
    continue:
      '<path d="M12 21V4"/><path d="M8 8l4-4 4 4"/>'
  };

  const body = icons[type] || icons.right;
  return (
    `<svg class="route-maneuver-svg" viewBox="0 0 24 24" width="20" height="20" ` +
    `fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/**
 * Markup do marker (seta alinhada ao bearing de chegada).
 * @param {ManeuverType} type
 * @param {{ bearingDeg?: number|null }} [opts]
 */
export function maneuverMarkerHtml(type, opts = {}) {
  const rot =
    opts.bearingDeg != null && Number.isFinite(opts.bearingDeg)
      ? Number(opts.bearingDeg)
      : 0;
  return (
    `<div class="route-maneuver-rot" style="transform:rotate(${rot}deg)">` +
    `${maneuverIconSvg(type)}</div>`
  );
}

/**
 * Detecta curvas significativas na polyline.
 * @param {number[][]} coordinates [[lng,lat], ...]
 * @param {{ minTurnDeg?: number, minSpacingMeters?: number, lookAheadMeters?: number }} [opts]
 * @returns {Array<{
 *   index: number,
 *   lngLat: [number, number],
 *   type: ManeuverType,
 *   turnAngle: number,
 *   alongMeters: number,
 *   lookAheadLngLat: [number, number],
 *   inboundBearing: number,
 *   instruction: string,
 *   street: string|null
 * }>}
 */
export function extractManeuversFromPolyline(coordinates, opts = {}) {
  const minTurnDeg = opts.minTurnDeg ?? 22;
  const minSpacingMeters = opts.minSpacingMeters ?? 90;
  const lookAheadMeters = opts.lookAheadMeters ?? 55;

  if (!coordinates || coordinates.length < 3) return [];

  // Suavizar: usar segmentos com comprimento mínimo ~12m
  const pts = [];
  pts.push(coordinates[0]);
  for (let i = 1; i < coordinates.length; i++) {
    const prev = pts[pts.length - 1];
    const cur = coordinates[i];
    if (haversineMeters(prev[0], prev[1], cur[0], cur[1]) >= 12) {
      pts.push(cur);
    }
  }
  if (pts.length < 3) return [];

  /** @type {Array<object>} */
  const raw = [];
  let along = 0;

  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const seg = haversineMeters(a[0], a[1], b[0], b[1]);
    along += seg;

    const b1 = bearingDeg(a[0], a[1], b[0], b[1]);
    const b2 = bearingDeg(b[0], b[1], c[0], c[1]);
    const turn = deltaBearing(b1, b2);
    if (Math.abs(turn) < minTurnDeg) continue;

    const type = classifyTurn(turn);
    if (!type) continue;

    const lookAhead = pointAlong(pts, i, lookAheadMeters);

    raw.push({
      index: i,
      lngLat: /** @type {[number, number]} */ ([b[0], b[1]]),
      type,
      turnAngle: turn,
      alongMeters: along,
      inboundBearing: b1,
      lookAheadLngLat: lookAhead,
      street: null,
      instruction: formatManeuverText(type, null)
    });
  }

  // Espaçar manobras
  const filtered = [];
  for (const m of raw) {
    const prev = filtered[filtered.length - 1];
    if (prev && m.alongMeters - prev.alongMeters < minSpacingMeters) {
      // fica a de maior ângulo
      if (Math.abs(m.turnAngle) > Math.abs(prev.turnAngle)) {
        filtered[filtered.length - 1] = m;
      }
      continue;
    }
    filtered.push(m);
  }

  return filtered;
}

function pointAlong(pts, fromIndex, meters) {
  let left = meters;
  for (let i = fromIndex; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = haversineMeters(a[0], a[1], b[0], b[1]);
    if (len >= left && len > 0) {
      const t = left / len;
      return /** @type {[number, number]} */ ([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t
      ]);
    }
    left -= len;
  }
  const last = pts[pts.length - 1];
  return /** @type {[number, number]} */ ([last[0], last[1]]);
}

/**
 * Aplica nomes de rua via API Moveme `/api/places/coordinates` (mutável).
 * @param {Array<{ lookAheadLngLat: [number,number], type: string, street: string|null, instruction: string, fromApi?: boolean }>} maneuvers
 * @param {(p: {lat:number, lng:number}) => Promise<string|null>} reverseGeocode
 */
export async function enrichManeuversWithStreets(maneuvers, reverseGeocode) {
  if (!reverseGeocode || !maneuvers?.length) return maneuvers;
  const cache = new Map();

  await Promise.all(
    maneuvers.map(async (m) => {
      // Se já veio texto completo dos steps da directions API, não sobrescrever
      if (m.fromApi && m.instruction && m.street) return;

      const [lng, lat] = m.lookAheadLngLat || m.lngLat;
      const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
      let street = cache.get(key);
      if (street === undefined) {
        try {
          street = (await reverseGeocode({ lat, lng })) || null;
        } catch {
          street = null;
        }
        cache.set(key, street);
      }
      m.street = street || m.street || null;
      if (!m.fromApi || !m.instruction) {
        m.instruction = formatManeuverText(m.type, m.street);
      } else if (m.street && !/[À-úA-Za-z].{3,}/.test(m.instruction)) {
        m.instruction = formatManeuverText(m.type, m.street);
      }
    })
  );

  return maneuvers;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mapeia `maneuver` Google → tipo interno.
 * @param {string|null|undefined} maneuver
 * @returns {ManeuverType}
 */
export function mapGoogleManeuver(maneuver) {
  const m = String(maneuver || '').toLowerCase();
  if (!m || m === 'straight' || m.includes('continue')) return 'continue';
  if (m.includes('uturn') || m.includes('u-turn')) return 'uturn';
  if (m.includes('sharp-right') || m.includes('sharp_right')) return 'sharp-right';
  if (m.includes('sharp-left') || m.includes('sharp_left')) return 'sharp-left';
  if (m.includes('slight-right') || m.includes('slight_right') || m.includes('bear-right'))
    return 'slight-right';
  if (m.includes('slight-left') || m.includes('slight_left') || m.includes('bear-left'))
    return 'slight-left';
  if (m.includes('right')) return 'right';
  if (m.includes('left')) return 'left';
  return 'continue';
}

function readLatLng(loc) {
  if (!loc || typeof loc !== 'object') return null;
  const lat = Number(loc.lat ?? loc.latitude);
  const lng = Number(loc.lng ?? loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return /** @type {[number, number]} */ ([lng, lat]);
}

/**
 * Extrai manobras de `legs[].steps` (quando o backend devolve Google/steps).
 * @param {object|null|undefined} routeObj rota bruta Moveme / Google
 * @returns {Array<object>}
 */
export function extractManeuversFromApiRoute(routeObj) {
  if (!routeObj || typeof routeObj !== 'object') return [];

  /** @type {object[]} */
  const stepSources = [];
  const candidates = [
    routeObj,
    routeObj.route,
    routeObj.primaryRoute
  ].filter(Boolean);

  for (const src of candidates) {
    const legs = src.legs;
    if (!Array.isArray(legs)) continue;
    for (const leg of legs) {
      if (Array.isArray(leg?.steps) && leg.steps.length) {
        stepSources.push(...leg.steps);
      }
    }
    if (Array.isArray(src.instructions) && src.instructions.length) {
      // Formato GraphHopper (se o backend passar)
      return src.instructions
        .map((ins, index) => {
          const text = String(ins.text || ins.instruction || '').trim();
          const street = (ins.street_name || ins.streetName || null)?.trim?.() || null;
          const sign = Number(ins.sign);
          const type = graphHopperSignToType(sign);
          const lngLat = readLatLng(ins) || null;
          if (!lngLat && !text) return null;
          return {
            index,
            lngLat: lngLat || [0, 0],
            type,
            turnAngle: 0,
            alongMeters: 0,
            lookAheadLngLat: lngLat || [0, 0],
            street,
            instruction: text || formatManeuverText(type, street),
            fromApi: true
          };
        })
        .filter((m) => m && m.lngLat[0] !== 0);
    }
  }

  if (!stepSources.length) return [];

  const out = [];
  let along = 0;
  stepSources.forEach((step, index) => {
    const start = readLatLng(step.start_location || step.startLocation);
    if (!start) return;
    const end = readLatLng(step.end_location || step.endLocation) || start;
    const type = mapGoogleManeuver(step.maneuver);
    const html = step.html_instructions || step.htmlInstructions || step.instructions;
    const text = stripHtml(html);
    const street =
      step.street_name ||
      step.streetName ||
      pickStreetFromInstruction(text) ||
      null;
    const dist = Number(step.distance?.value ?? step.distance) || 0;

    // Ignorar rectos / "continue" — só curvas
    if (type === 'continue') {
      along += dist;
      return;
    }

    out.push({
      index,
      lngLat: start,
      type,
      turnAngle: 0,
      alongMeters: along,
      lookAheadLngLat: end,
      street,
      instruction: text || formatManeuverText(type, street),
      fromApi: true
    });
    along += dist;
  });

  return out;
}

function graphHopperSignToType(sign) {
  // https://docs.graphhopper.com/#tag/Routing-API/paths/~1route/get
  switch (sign) {
    case -3:
      return 'sharp-left';
    case -2:
      return 'left';
    case -1:
      return 'slight-left';
    case 1:
      return 'slight-right';
    case 2:
      return 'right';
    case 3:
      return 'sharp-right';
    case 4:
    case 5:
    case 6:
      return 'continue';
    case -98:
    case 7:
      return 'uturn';
    default:
      return 'continue';
  }
}

function pickStreetFromInstruction(text) {
  if (!text) return null;
  const m =
    text.match(/(?:em direção a|para|seguir|onto|on|onto)\s+(.+)$/i) ||
    text.match(/\b(?:Av\.|Avenida|R\.|Rua|Estrada)\s+[^,]+/i);
  return m ? m[1]?.trim() || m[0].trim() : null;
}

/**
 * Resolve manobras: prefere steps da API Moveme; senão geometria + reverse geocode.
 * @param {number[][]} coordinates
 * @param {{ routeRaw?: object|null, reverseGeocode?: Function|null }} [opts]
 */
export async function resolveManeuvers(coordinates, opts = {}) {
  const fromApi = extractManeuversFromApiRoute(opts.routeRaw);
  let maneuvers =
    fromApi.length > 0
      ? fromApi
      : extractManeuversFromPolyline(coordinates);

  // Só curvas (sem "continue a seguir")
  maneuvers = maneuvers.filter((m) => m && m.type && m.type !== 'continue');

  // Limitar densidade no mapa
  if (maneuvers.length > 24) {
    maneuvers = maneuvers.filter((_, i) => i % 2 === 0).slice(0, 24);
  }

  if (opts.reverseGeocode) {
    await enrichManeuversWithStreets(maneuvers, opts.reverseGeocode);
  }
  return maneuvers;
}
