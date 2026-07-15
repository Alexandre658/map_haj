/**
 * Configuração da API Moveme Places.
 * Prioridade: window.MAPHAJ_PLACES → ?apiKey= / ?baseUrl= → localStorage → defaults.
 */
const STORAGE_KEY = 'maphaj_api_key';
const STORAGE_BASE = 'maphaj_api_base';

const DEFAULTS = {
  baseUrl: 'https://app.appmoveme.com',
  apiKey: '',
  country: 'ao',
  language: 'pt',
  radius: 50,
  maxResults: 20,
  uiDebounceMs: 200,
  apiDebounceMs: 300,
  historyLimit: 20,
  exportPageSize: 500,
  exportMaxPages: 40,
  syncIntervalHours: 24
};

function readQuery() {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

export function loadPlacesConfig() {
  const q = readQuery();
  const fromWindow = (typeof window !== 'undefined' && window.MAPHAJ_PLACES) || {};

  let apiKey =
    fromWindow.apiKey ||
    q.get('apiKey') ||
    localStorage.getItem(STORAGE_KEY) ||
    DEFAULTS.apiKey;

  let baseUrl =
    fromWindow.baseUrl ||
    q.get('baseUrl') ||
    localStorage.getItem(STORAGE_BASE) ||
    DEFAULTS.baseUrl;

  // Persist if passed via URL (convenient for demos; strip before sharing screenshots)
  if (q.get('apiKey')) localStorage.setItem(STORAGE_KEY, q.get('apiKey'));
  if (q.get('baseUrl')) localStorage.setItem(STORAGE_BASE, q.get('baseUrl'));

  baseUrl = String(baseUrl).replace(/\/$/, '');

  return {
    ...DEFAULTS,
    ...fromWindow,
    baseUrl,
    apiKey: apiKey || '',
    country: fromWindow.country || q.get('country') || DEFAULTS.country,
    language: fromWindow.language || q.get('language') || DEFAULTS.language
  };
}

export function saveApiKey(apiKey) {
  if (apiKey) localStorage.setItem(STORAGE_KEY, apiKey);
  else localStorage.removeItem(STORAGE_KEY);
}

export function hasAuth(config) {
  return Boolean(config?.apiKey);
}
