/**
 * Liga um campo de pesquisa a PlacesSearchController.
 */

import { PlacesSearchController } from './places-controller.js';

export function bindPlaceSearchField({
  root,
  client,
  config,
  getBias,
  onSelected,
  onCleared
}) {
  const input = root.querySelector('.place-input');
  const resultsEl = root.querySelector('.search-results');
  const clearBtn = root.querySelector('.search-clear');
  const spinner = root.querySelector('.search-spinner');

  let activeIndex = -1;
  let currentResults = [];
  let selected = null;

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
  }

  function renderResults(items, meta = {}) {
    currentResults = items;
    activeIndex = -1;
    if (!items.length) {
      const hint =
        meta.emptyHint ||
        (meta.source === 'history'
          ? 'Escreve para pesquisar'
          : 'Sem resultados');
      resultsEl.innerHTML = `<div class="hint">${escapeHtml(hint)}</div>`;
      resultsEl.classList.add('open');
      return;
    }
    resultsEl.innerHTML = items
      .map(
        (p, i) => `
      <button type="button" role="option" data-index="${i}">
        <span class="place-name">${escapeHtml(p.name)}</span>
        ${
          p.subtitle || p.address
            ? `<span class="place-meta">${escapeHtml(p.subtitle || p.address)}</span>`
            : ''
        }
      </button>`
      )
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
  }

  const controller = new PlacesSearchController({
    client,
    config,
    getBias,
    onLoading: setLoading,
    onResults: (items, meta) => {
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
      closeResults();
      onSelected?.(place);
    }
  });

  input.addEventListener('input', () => {
    setClearVisible();
    selected = null;
    controller.onQueryInput(input.value);
  });

  input.addEventListener('focus', () => {
    if (!input.value.trim()) controller.showHistoryOnly();
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
    },
    clear() {
      input.value = '';
      selected = null;
      setClearVisible();
      controller.clear();
    },
    bootstrap: () => controller.bootstrap(),
    input
  };
}
