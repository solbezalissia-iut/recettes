const catLabels = {
  apero: "Apéro", entree: "Entrée", plat: "Plat",
  dessert: "Dessert", boisson: "Boisson", sauce: "Sauce", "base-culinaire": "Base culinaire"
};

// Photo de secours utilisée quand une recette n'a pas encore sa propre photo.
// Chaque recette a son propre champ "photo" dans recettes-data.js — il suffit
// de changer cette ligne (ex: "photos/tarte-citron.jpg") pour lui donner sa
// vraie photo plus tard, sans toucher au reste du code.
const SITE_PHOTO = 'photos/enattente.png';

// Alternatives pour les ingrédients qu'Alissia n'aime pas — affichées automatiquement
// à côté de l'ingrédient concerné dans la fiche recette, sans avoir à modifier chaque recette.
// Pour ajouter/retirer un ingrédient : éditer cette liste (clé = mot à repérer, valeur = suggestion affichée).
const SUBSTITUTIONS = [
  { match: /\bsaumon\b/i, suggestion: "truite fumée ou thon" },
  { match: /\boignons?\b/i, suggestion: "échalote ou blanc de poireau" },
  { match: /\bcamembert\b/i, suggestion: "brie" },
];

function findSubstitution(ingredientName) {
  const found = SUBSTITUTIONS.find(s => s.match.test(ingredientName));
  return found ? found.suggestion : null;
}

let activeFilters = [];
let searchQuery = '';
let currentTab = 'all';

// ── Serving adjuster state ──
let currentServings = 1;
let baseServings = 1;
let currentRecetteIdx = null;
let currentVariantIdx = 0;

function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function ingLabel(ing) {
  return typeof ing === 'string' ? ing : ing.texte;
}

// Returns a normalized list of variants for any recipe, whether it's a
// simple recipe or a grouped one with a `variantes` array.
function getVariants(r) {
  if (r.variantes) return r.variantes;
  return [{ nom: null, temps: r.temps, personnes: r.personnes, ingredients: r.ingredients, etapes: r.etapes }];
}

function previewVariant(r) {
  return getVariants(r)[0];
}

function cardMatchesFilters(r) {
  if (searchQuery && !normalize(r.titre).includes(normalize(searchQuery))) return false;
  if (activeFilters.length === 0) return true;
  // match if ANY variant satisfies all active ingredient filters
  return getVariants(r).some(v => {
    const ings = v.ingredients.map(i => normalize(ingLabel(i)));
    return activeFilters.every(f => ings.some(i => i.includes(normalize(f))));
  });
}

function buildGrids() {
  const cats = ['apero', 'entree', 'plat', 'dessert', 'boisson', 'sauce', 'base-culinaire'];
  const allGrid = document.getElementById('grid-all');
  allGrid.innerHTML = '';
  cats.forEach(cat => { document.getElementById('grid-' + cat).innerHTML = ''; });

  const counts = { all: 0, apero: 0, entree: 0, plat: 0, dessert: 0, boisson: 0, sauce: 0, "base-culinaire": 0 };

  recettes.forEach((r, idx) => {
    const matched = cardMatchesFilters(r);
    const preview = previewVariant(r);
    const variants = getVariants(r);

    ['all', r.cat].forEach(gridCat => {
      const card = document.createElement('div');
      card.className = 'recipe-card' + (matched ? '' : ' hidden');
      card.dataset.idx = idx;

      const pills = preview.ingredients.slice(0, 5).map(ing => {
        const label = ingLabel(ing);
        const isMatched = activeFilters.some(f => normalize(label).includes(normalize(f)));
        return `<span class="ing-pill${isMatched ? ' matched' : ''}">${label}</span>`;
      }).join('') + (preview.ingredients.length > 5 ? `<span class="ing-pill">+${preview.ingredients.length - 5}</span>` : '');

      const photoSrc = r.photo || SITE_PHOTO;
      const photoHtml = `<div class="card-photo"><img src="${photoSrc}" alt="${r.titre}" loading="lazy" onerror="this.onerror=null;this.src='${SITE_PHOTO}';"></div>`;

      const variantBadge = variants.length > 1
        ? `<span class="variant-badge">${variants.length} versions</span>`
        : '';

      card.innerHTML = `
        ${photoHtml}
        <div class="card-body">
          <div class="card-cat">${catLabels[r.cat]}${variantBadge}</div>
          <div class="card-title">${r.titre}</div>
          <div class="card-meta">
            <span>⏱ ${preview.temps}</span>
            <span>👥 ${preview.personnes} pers.</span>
          </div>
          <div class="card-ingredients">${pills}</div>
        </div>
      `;

      card.addEventListener('click', () => openModal(idx));

      if (gridCat === 'all') {
        allGrid.appendChild(card);
        if (matched) counts.all++;
      } else {
        document.getElementById('grid-' + gridCat).appendChild(card);
        if (matched) counts[r.cat] = (counts[r.cat] || 0) + 1;
      }
    });
  });

  cats.forEach(cat => {
    const count = counts[cat] || 0;
    const total = recettes.filter(r => r.cat === cat).length;
    const countEl = document.getElementById('count-' + cat);
    if (countEl) countEl.textContent = count;
    const emptyEl = document.getElementById('empty-' + cat);
    if (emptyEl) emptyEl.classList.toggle('visible', count === 0);
    const infoEl = document.getElementById('info-' + cat);
    if (infoEl) infoEl.innerHTML = activeFilters.length || searchQuery
      ? `<strong>${count}</strong> recette${count !== 1 ? 's' : ''} sur ${total} correspondent à votre recherche`
      : `${total} recette${total !== 1 ? 's' : ''}`;
  });

  document.getElementById('count-all').textContent = counts.all;
  const totalAll = recettes.length;
  document.getElementById('empty-all').classList.toggle('visible', counts.all === 0);
  document.getElementById('info-all').innerHTML = activeFilters.length || searchQuery
    ? `<strong>${counts.all}</strong> recette${counts.all !== 1 ? 's' : ''} sur ${totalAll} correspondent à votre recherche`
    : `${totalAll} recettes au total`;

  const headerCountEl = document.getElementById('header-count');
  if (headerCountEl) headerCountEl.textContent = `${totalAll} recette${totalAll !== 1 ? 's' : ''}`;
  const footerCountEl = document.getElementById('footer-count');
  if (footerCountEl) footerCountEl.textContent = totalAll;
}

// ── Ingredient scaling ──
function formatQty(valeur, unite, ratio) {
  const qty = valeur * ratio;
  let str;
  if (Math.abs(qty - Math.round(qty)) < 0.05) {
    str = Math.round(qty).toString();
  } else if (Math.abs(qty * 2 - Math.round(qty * 2)) < 0.05) {
    str = (Math.round(qty * 2) / 2).toString().replace('.', ',');
  } else {
    str = qty.toFixed(1).replace('.', ',');
  }
  return unite ? `${str} ${unite}` : str;
}

function currentVariant() {
  const r = recettes[currentRecetteIdx];
  return getVariants(r)[currentVariantIdx];
}

function renderIngredients() {
  if (currentRecetteIdx === null) return;
  const v = currentVariant();
  const ratio = currentServings / baseServings;
  const list = document.getElementById('modal-ings');
  list.innerHTML = v.ingredients.map(ing => {
    if (typeof ing === 'string') return `<li>${ing}</li>`;
    const qty = formatQty(ing.valeur, ing.unite, ratio);
    const hasChanged = ratio !== 1;
    const sub = findSubstitution(ing.reste);
    const subHtml = sub ? `<span class="ing-sub" title="Alternative">→ ${sub}</span>` : '';
    return `<li><span class="ing-qty${hasChanged ? ' ing-qty--scaled' : ''}">${qty}</span> ${ing.reste}${subHtml}</li>`;
  }).join('');
}

function renderSteps() {
  const v = currentVariant();
  document.getElementById('modal-steps').innerHTML = v.etapes.map(e => `<li><div>${e}</div></li>`).join('');
}

function updateServingDisplay() {
  document.getElementById('serving-count').textContent = currentServings;
  renderIngredients();
}

function renderVariantTabs() {
  const r = recettes[currentRecetteIdx];
  const wrap = document.getElementById('variant-tabs');
  const variants = getVariants(r);
  if (variants.length <= 1) {
    wrap.innerHTML = '';
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';
  wrap.innerHTML = variants.map((v, i) => `
    <button class="variant-tab${i === currentVariantIdx ? ' active' : ''}" data-vidx="${i}">${v.nom || ('Version ' + (i + 1))}</button>
  `).join('');
  wrap.querySelectorAll('.variant-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      selectVariant(parseInt(btn.dataset.vidx, 10));
    });
  });
}

function selectVariant(vIdx) {
  currentVariantIdx = vIdx;
  const v = currentVariant();
  baseServings = typeof v.personnes === 'number' ? v.personnes : parseInt(v.personnes, 10) || 1;
  currentServings = baseServings;
  document.getElementById('modal-meta').innerHTML = `<span>⏱ ${v.temps}</span>`;
  document.getElementById('serving-count').textContent = currentServings;
  renderVariantTabs();
  renderIngredients();
  renderSteps();
}

// ── Modal ──
function openModal(idx) {
  const r = recettes[idx];
  currentRecetteIdx = idx;
  currentVariantIdx = 0;

  const photoWrap = document.getElementById('modal-photo-wrap');
  const photoImg = document.getElementById('modal-photo');
  const photoPlaceholder = document.getElementById('modal-photo-placeholder');
  photoImg.src = r.photo || SITE_PHOTO;
  photoImg.alt = r.titre;
  photoImg.onerror = function () { this.onerror = null; this.src = SITE_PHOTO; };
  photoImg.style.display = 'block';
  photoPlaceholder.style.display = 'none';
  photoWrap.classList.remove('modal-photo-wrap--placeholder');

  document.getElementById('modal-cat').textContent = catLabels[r.cat];
  document.getElementById('modal-title').textContent = r.titre;

  selectVariant(0);

  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

document.getElementById('serving-minus').addEventListener('click', () => {
  if (currentServings > 1) { currentServings--; updateServingDisplay(); }
});
document.getElementById('serving-plus').addEventListener('click', () => {
  if (currentServings < 50) { currentServings++; updateServingDisplay(); }
});

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-back').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
  currentRecetteIdx = null;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── Filters & search ──
function getAllIngredients() {
  const set = new Set();
  recettes.forEach(r => getVariants(r).forEach(v => v.ingredients.forEach(i => {
    const label = ingLabel(i);
    const clean = label.replace(/^\d+[\d.,\s]*(g|ml|kg|l|c\..*?\.\s*[a-z]\.?|cl|dl|mm|cm)?\s*(de |d')?/i, '').trim();
    if (clean.length > 2) set.add(clean);
  })));
  return [...set].sort();
}
const allIngredients = getAllIngredients();

const ingInput = document.getElementById('ing-input');
const sugBox = document.getElementById('ing-suggestions');

ingInput.addEventListener('input', () => {
  const q = ingInput.value.trim();
  if (!q) { sugBox.classList.remove('open'); return; }
  const matches = allIngredients.filter(i => normalize(i).includes(normalize(q)) && !activeFilters.includes(i)).slice(0, 8);
  if (!matches.length) { sugBox.classList.remove('open'); return; }
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  sugBox.innerHTML = matches.map(m => `<div class="sug-item" data-ing="${m}">${m.replace(re, '<mark>$1</mark>')}</div>`).join('');
  sugBox.classList.add('open');
  sugBox.querySelectorAll('.sug-item').forEach(el => {
    el.addEventListener('click', () => {
      if (!activeFilters.includes(el.dataset.ing)) {
        activeFilters.push(el.dataset.ing);
        renderFilters();
        buildGrids();
      }
      ingInput.value = '';
      sugBox.classList.remove('open');
    });
  });
});

ingInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const q = ingInput.value.trim();
    if (q && !activeFilters.includes(q)) {
      activeFilters.push(q);
      renderFilters();
      buildGrids();
    }
    ingInput.value = '';
    sugBox.classList.remove('open');
  }
});

document.addEventListener('click', e => {
  if (!e.target.closest('.ing-input-wrap')) sugBox.classList.remove('open');
});

document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  buildGrids();
});

document.getElementById('reset-btn').addEventListener('click', () => {
  activeFilters = [];
  searchQuery = '';
  document.getElementById('search-input').value = '';
  ingInput.value = '';
  renderFilters();
  buildGrids();
});

function renderFilters() {
  const wrap = document.getElementById('active-filters');
  wrap.innerHTML = activeFilters.map(f => `
    <span class="ing-tag">${f}
      <button onclick="removeFilter('${f}')" aria-label="Supprimer le filtre ${f}">✕</button>
    </span>`).join('');
}

function removeFilter(f) {
  activeFilters = activeFilters.filter(x => x !== f);
  renderFilters();
  buildGrids();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('visible'));
    btn.classList.add('active');
    currentTab = btn.dataset.cat;
    document.getElementById('section-' + currentTab).classList.add('visible');
  });
});

buildGrids();
