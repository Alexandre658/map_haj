/**
 * Liga um campo de pesquisa a PlacesSearchController.
 */

import { PlacesSearchController } from './places-controller.js';

const PIN_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>';

const CLOCK_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>';

export function bindPlaceSearchField({
  root,
  client,
  config,
  getBias,
  onSelected,
  onCleared,
  onFocus,
  onBlur,
  onResultsChange
}) {
  const input = root.querySelector('.place-input');
  const resultsEl = root.querySelector('.search-results');
  const clearBtn = root.querySelector('.search-clear');
  const spinner = root.querySelector('.search-spinner');

  let activeIndex = -1;
  let currentResults = [];
  let selected = null;
  let lastMeta = {};
  /** Depois de escolher um sítio, não reabrir a lista até o user voltar a editar. */
  let suppressResults = false;

  function setLoading(on) {
    spinner?.classList.toggle('visible', !!on);
  }

  function setClearVisible() {
    clearBtn?.classList.toggle('visible', input.value.length > 0);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function closeResults() {
    resultsEl.classList.remove('open');
    resultsEl.innerHTML = '';
    currentResults = [];
    activeIndex = -1;
    lastMeta = {};
    onResultsChange?.({ open: false, source: null, count: 0 });
  }

  function lockAfterSelect() {
    suppressResults = true;
    closeResults();
    try {
      input.blur();
    } catch {
      /* ignore */
    }
  }

  function shortMeta(place) {
    const raw = String(place.subtitle || place.address || '').trim();
    if (!raw) return '';
    // Evita duplicar o nome no subtítulo
    const name = String(place.name || '').trim();
    if (name && raw.toLowerCase().startsWith(name.toLowerCase())) {
      const rest = raw.slice(name.length).replace(/^[\s,·\-–—]+/, '');
      return rest || raw;
    }
    return raw;
  }

  function renderResults(items, meta = {}) {
    if (suppressResults) return;
    currentResults = items;
    activeIndex = -1;
    lastMeta = meta || {};
    const isHistory = meta.source === 'history';

    if (!items.length) {
      const hint =
        meta.emptyHint ||
        (isHistory ? 'Escreve para pesquisar' : 'Sem resultados');
      resultsEl.innerHTML = `<div class="hint">${escapeHtml(hint)}</div>`;
      resultsEl.classList.add('open');
      onResultsChange?.({ open: true, source: meta.source, count: 0 });
      return;
    }

    const heading = isHistory
      ? `<div class="search-section-title">Recentes</div>`
      : '';

    resultsEl.innerHTML =
      heading +
      items
        .map((p, i) => {
          const metaText = shortMeta(p);
          const dist =
            p.distanceText ||
            (p.distanceMeters != null
              ? `${(p.distanceMeters / 1000).toFixed(1).replace('.', ',')} km`
              : p.distanceKm != null
                ? `${Number(p.distanceKm).toFixed(1).replace('.', ',')} km`
                : '');
          return `
      <button type="button" role="option" data-index="${i}">
        <span class="pin-ico ${isHistory ? 'history' : ''}" aria-hidden="true">${
          isHistory ? CLOCK_SVG : PIN_SVG
        }</span>
        <span class="place-text">
          <span class="place-name">${escapeHtml(p.name || '')}</span>
          ${
            metaText
              ? `<span class="place-meta">${escapeHtml(metaText)}</span>`
              : ''
          }
        </span>
        ${
          dist
            ? `<span class="place-dist">${escapeHtml(dist)}</span>`
            : ''
        }
      </button>`;
        })
        .join('');

    resultsEl.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        void controller
          .selectPlace(items[Number(btn.dataset.index)])
          .catch((err) => {
            console.error(err);
            renderResults([], {
              emptyHint: 'Não foi possível obter a localização.'
            });
          });
      });
    });
    resultsEl.classList.add('open');
    onResultsChange?.({
      open: true,
      source: meta.source,
      count: items.length
    });
  }

  const controller = new PlacesSearchController({
    client,
    config,
    getBias,
    onLoading: setLoading,
    onResults: (items, meta) => {
      if (suppressResults) return;
      if (
        !input.value.trim() &&
        meta?.source !== 'history' &&
        meta?.source !== 'clear'
      ) {
        return;
      }
      if (meta?.source === 'clear') {
        closeResults();
        return;
      }
      renderResults(items, meta);
    },
    onPlaceSelected: (place) => {
      selected = place;
      input.value = place.address || place.name;
      setClearVisible();
      lockAfterSelect();
      onSelected?.(place);
    }
  });

  input.addEventListener('input', () => {
    suppressResults = false;
    setClearVisible();
    selected = null;
    controller.onQueryInput(input.value);
  });

  input.addEventListener('focus', () => {
    suppressResults = false;
    onFocus?.();
    if (!input.value.trim()) controller.showHistoryOnly();
  });

  input.addEventListener('blur', () => {
    onBlur?.();
  });

  input.addEventListener('keydown', (e) => {
    const buttons = [...resultsEl.querySelectorAll('button')];
    if (e.key === 'ArrowDown' && buttons.length) {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, buttons.length - 1);
      buttons.forEach((b, i) => b.classList.toggle('active', i === activeIndex));
    } else if (e.key === 'ArrowUp' && buttons.length) {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      buttons.forEach((b, i) => b.classList.toggle('active', i === activeIndex));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && currentResults[activeIndex]) {
        void controller.selectPlace(currentResults[activeIndex]).catch(console.error);
      } else {
        controller.onQueryInput(input.value);
      }
    } else if (e.key === 'Escape') {
      closeResults();
      input.blur();
    }
  });

  clearBtn?.addEventListener('click', () => {
    input.value = '';
    selected = null;
    suppressResults = false;
    setClearVisible();
    controller.clear();
    onCleared?.();
    input.focus();
  });

  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) closeResults();
  });

  return {
    getSelected: () => selected,
    setPlace(place) {
      selected = place;
      input.value = place?.address || place?.name || '';
      setClearVisible();
      suppressResults = true;
      closeResults();
    },
    clear() {
      input.value = '';
      selected = null;
      suppressResults = false;
      setClearVisible();
      controller.clear();
    },
    closeResults,
    bootstrap: () => controller.bootstrap(),
    input
  };
}
