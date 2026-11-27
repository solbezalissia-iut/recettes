// ────────────────────────────────────────────────────────────────────────
// nav.js — confort de navigation (surtout sur téléphone)
// • bouton « Filtres » qui ouvre / ferme les filtres avancés, avec le nombre de filtres actifs
// • bouton ✕ pour effacer la recherche
// • barre des catégories : la catégorie choisie reste visible et la liste remonte en haut
// • barre de recherche qui se cache quand on descend et revient quand on remonte
// • bouton flottant « + » pour ajouter une recette
// Chargé après app.js et planning.js.
// ────────────────────────────────────────────────────────────────────────
(function () {
  const bar = document.querySelector('.filter-bar');
  const more = document.getElementById('filter-more');
  const toggle = document.getElementById('filters-toggle');
  const countEl = document.getElementById('filters-count');
  const search = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear');
  const tabs = document.getElementById('tabs');
  const mobile = window.matchMedia('(max-width: 780px)');

  // ── Filtres repliables ──
  function setOpen(open) {
    bar.classList.toggle('filters-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }
  toggle.addEventListener('click', () => setOpen(!bar.classList.contains('filters-open')));

  // Nombre de filtres actifs (ingrédients, temps, tri, régimes)
  function countFilters() {
    let n = document.querySelectorAll('#active-filters > *').length;
    if (document.getElementById('time-filter').value) n++;
    if (document.getElementById('sort-select').value !== 'default') n++;
    n += document.querySelectorAll('#diet-filters .active, #diet-filters [aria-pressed="true"]').length;
    countEl.textContent = n;
    countEl.hidden = n === 0;
    toggle.classList.toggle('has-filters', n > 0);
  }
  ['input', 'change', 'click'].forEach(ev => bar.addEventListener(ev, () => setTimeout(countFilters, 0)));
  new MutationObserver(countFilters).observe(document.getElementById('active-filters'), { childList: true });
  countFilters();

  // ── Effacer la recherche ──
  const syncClear = () => { clearBtn.hidden = !search.value; };
  search.addEventListener('input', syncClear);
  clearBtn.addEventListener('click', () => {
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    syncClear();
    search.focus();
  });
  // Touche « Rechercher » du clavier du téléphone : fermer le clavier pour voir les résultats
  search.addEventListener('keydown', e => { if (e.key === 'Enter') search.blur(); });

  // ── Catégories ──
  function showActiveTab(smooth) {
    const active = tabs.querySelector('.tab-btn.active');
    if (!active) return;
    const left = active.offsetLeft - (tabs.clientWidth - active.offsetWidth) / 2;
    tabs.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  }
  tabs.addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    // app.js change déjà la catégorie ; ici on recentre la pastille et on remonte en haut de la liste
    setTimeout(() => {
      showActiveTab(true);
      const top = document.querySelector('.container .section.visible');
      if (top) {
        const y = top.getBoundingClientRect().top + window.scrollY - bar.offsetHeight - 8;
        if (window.scrollY > y) window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }, 0);
  });
  // Ombres sur les côtés pour montrer qu'on peut faire défiler les catégories
  function edgeShadows() {
    tabs.classList.toggle('can-left', tabs.scrollLeft > 4);
    tabs.classList.toggle('can-right', tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 4);
  }
  tabs.addEventListener('scroll', edgeShadows, { passive: true });
  window.addEventListener('resize', edgeShadows);
  edgeShadows();

  // ── Barre qui se cache en descendant, revient en remontant (téléphone) ──
  let lastY = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (!mobile.matches || bar.classList.contains('filters-open') || document.activeElement === search) { lastY = y; return; }
    const startHide = bar.offsetTop + bar.offsetHeight + 200;
    if (y > lastY + 6 && y > startHide) bar.classList.add('bar-hidden');
    else if (y < lastY - 6 || y < startHide) bar.classList.remove('bar-hidden');
    lastY = y;
  }, { passive: true });

  // ── Bouton flottant « + » ──
  const fab = document.getElementById('add-fab');
  fab.addEventListener('click', () => document.getElementById('add-recipe-btn').click());
  // Le bouton n'apparaît que sur la vue Recettes
  function syncFab() {
    const onRecipes = !document.getElementById('view-recettes').hidden;
    fab.hidden = !onRecipes;
  }
  new MutationObserver(syncFab).observe(document.getElementById('view-recettes'), { attributes: true, attributeFilter: ['hidden'] });
  syncFab();

  // Fiche recette : revenir en haut de la fiche à chaque ouverture
  const overlay = document.getElementById('modal-overlay');
  new MutationObserver(() => { if (overlay.classList.contains('open')) overlay.scrollTop = 0; })
    .observe(overlay, { attributes: true, attributeFilter: ['class'] });
})();
