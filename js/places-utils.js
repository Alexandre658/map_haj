/**
 * Ranking / dedupe / fuzzy local — espelha PlacesSearchUtils do app MoveMe.
 */

import { hasValidCoords, placeKey } from './places-model.js';

export function normalizeString(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function hasToken(haystack, word) {
  if (!word) return false;
  const re = new RegExp(`(?:^|\\s)${escapeRegex(word)}`);
  return re.test(haystack);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesSearchQuery(place, query) {
  const q = normalizeString(query);
  if (!q) return false;
  if (q.length < 2) return true;

  const name = normalizeString(place.name);
  const addr = normalizeString(place.address);
  if (name.includes(q) || addr.includes(q)) return true;

  const words = q.split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return false;
  return words.every((w) => name.includes(w) || addr.includes(w));
}

export function textRelevanceScore(place, normalizedQuery) {
  if (!normalizedQuery) return 0;
  const name = normalizeString(place.name);
  const addr = normalizeString(place.address);
  const q = normalizeString(normalizedQuery);
  let score = 0;

  if (name === q) score += 200;
  else if (name.startsWith(q)) score += 150;
  else if (name.includes(q)) score += 120;

  if (addr.startsWith(q)) score += 80;
  else if (addr.includes(q)) score += 60;

  for (const word of q.split(/\s+/).filter(Boolean)) {
    if (hasToken(name, word)) score += 25;
    if (hasToken(addr, word)) score += 12;
  }
  return score;
}

/** Haversine em metros. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function deduplicatePlaces(places) {
  const seen = new Set();
  const out = [];
  for (const p of places) {
    const key = placeKey(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export function filterAndSortPlaces(places, query, currentLat, currentLng) {
  const trimmed = String(query || '').trim();
  const deduped = deduplicatePlaces(places);

  if (!trimmed) {
    return deduped.filter(hasValidCoords);
  }

  const relevant = deduped
    .filter(hasValidCoords)
    .filter((p) => matchesSearchQuery(p, trimmed));

  const qNorm = normalizeString(trimmed);
  const hasLoc =
    currentLat != null &&
    currentLng != null &&
    currentLat !== 0 &&
    currentLng !== 0;

  return relevant
    .map((place) => {
      const textScore = textRelevanceScore(place, qNorm);
      let dist = Number.POSITIVE_INFINITY;
      if (hasLoc && hasValidCoords(place)) {
        dist = distanceMeters(currentLat, currentLng, place.lat, place.lng);
      }
      return { place, textScore, dist };
    })
    .sort((a, b) => {
      const byText = b.textScore - a.textScore;
      if (byText !== 0) return byText;
      return a.dist - b.dist;
    })
    .map((x) => x.place);
}

export function mergePlaces(...lists) {
  return deduplicatePlaces(lists.flat().filter(Boolean));
}
