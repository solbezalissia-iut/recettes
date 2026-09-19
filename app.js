const catLabels = {
  apero: "Apéro", entree: "Entrée", plat: "Plat",
  dessert: "Dessert", boisson: "Boisson", sauce: "Sauce", "base-culinaire": "Base culinaire"
};

// Photo de secours utilisée quand une recette n'a pas encore sa propre photo.
const SITE_PHOTO = 'photos/enattente.png';

// Alternatives pour les ingrédients qu'Alissia n'aime pas — affichées automatiquement
// à côté de l'ingrédient concerné dans la fiche recette, sans avoir à modifier chaque recette.
const SUBSTITUTIONS = [
  { match: /\bsaumon\b/i, suggestion: "truite fumée ou thon" },
  { match: /\boignons?\b/i, suggestion: "échalote ou blanc de poireau" },
  { match: /\bcamembert\b/i, suggestion: "brie" },
];

function findSubstitution(ingredientName) {
  const found = SUBSTITUTIONS.find(s => s.match.test(ingredientName));
  return found ? found.suggestion : null;
}

// ── Recettes d'origine (fichier statique) + recettes ajoutées en ligne (Firestore) ──
// Les recettes d'origine (recettes-data.js) ne sont JAMAIS modifiables depuis le site :
// c'est ce qui garantit que personne ne peut toucher aux recettes d'Alissia.
// Les recettes ajoutées par les utilisateurs vivent dans Firestore et ne sont
// modifiables/supprimables que par la personne qui les a créées.
const STATIC_RECETTES = (typeof recettes !== 'undefined' ? recettes : []).map(r => ({
  ...r,
  _isStatic: true,
  _ownerId: null,
  _ownerName: null,
}));

let liveRecettes = [];
let allRecettes = STATIC_RECETTES.slice();
let currentUser = null;

function refreshRecettes() {
  allRecettes = STATIC_RECETTES.concat(liveRecettes);
  allIngredients = getAllIngredients();
  renderFilters();
  buildGrids();
  if (currentRecetteIdx !== null) updateModalPermissions();
}

// Appelée par cloud.js à chaque changement des recettes ajoutées en ligne.
window.onLiveRecipesUpdate = function (live) {
  liveRecettes = live;
  refreshRecettes();
};

// ── Authentification (appelée par cloud.js) ──
window.onAuthStateChanged = function (user) {
  currentUser = user;
  renderAuthZone();
  if (currentRecetteIdx !== null) updateModalPermissions();
};

function renderAuthZone() {
  const zone = document.getElementById('auth-zone');
  if (!zone) return;
  if (currentUser) {
    zone.innerHTML = `
      <div class="auth-user">
        ${currentUser.photoURL ? `<img class="auth-avatar" src="${currentUser.photoURL}" alt="">` : `<span class="auth-avatar auth-avatar--fallback">${(currentUser.displayName || '?')[0]}</span>`}
        <span class="auth-name">${currentUser.displayName || 'Vous'}</span>
        <button class="auth-btn auth-btn--ghost" id="auth-signout-btn">Se déconnecter</button>
      </div>`;
    document.getElementById('auth-signout-btn').addEventListener('click', async () => {
      try { await window.CloudRecipes.signOutUser(); }
      catch (e) { console.error(e); }
    });
  } else {
    zone.innerHTML = `<button class="auth-btn" id="auth-signin-btn">Se connecter avec Google</button>`;
    document.getElementById('auth-signin-btn').addEventListener('click', async () => {
      try { await window.CloudRecipes.signInWithGoogle(); }
      catch (e) {
        console.error(e);
        alert("La connexion a échoué : " + (e.message || e));
      }
    });
  }
}

async function ensureSignedIn() {
  if (currentUser) return true;
  if (!window.CloudRecipes) {
    alert("Le service de comptes est en cours de chargement, réessayez dans un instant.");
    return false;
  }
  try {
    await window.CloudRecipes.signInWithGoogle();
    return true;
  } catch (e) {
    console.error(e);
    alert("La connexion a échoué : " + (e.message || e));
    return false;
  }
}

let activeFilters = [];
let searchQuery = '';
let currentTab = 'all';
let timeFilter = '';
let sortMode = 'default';

// ── Serving adjuster state ──
let currentServings = 1;
let baseServings = 1;
let currentRecetteIdx = null;
let currentVariantIdx = 0;

function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
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

// Extrait une durée approximative en minutes à partir d'un texte libre
// comme "30 min", "1h30", "180 min (+ nuit de congélation)".
function parseTempsMinutes(temps) {
  if (!temps) return null;
  const str = String(temps).toLowerCase();
  let minutes = 0;
  let found = false;
  const hMatch = str.match(/(\d+)\s*h/);
  if (hMatch) { minutes += parseInt(hMatch[1], 10) * 60; found = true; }
  const minMatch = str.match(/(\d+)\s*(?:min)/);
  if (minMatch) { minutes += parseInt(minMatch[1], 10); found = true; }
  if (!found) {
    const anyNum = str.match(/(\d+)/);
    if (anyNum) { minutes = parseInt(anyNum[1], 10); found = true; }
  }
  return found ? minutes : null;
}

function cardMatchesFilters(r) {
  if (searchQuery && !normalize(r.titre).includes(normalize(searchQuery))) return false;
  if (timeFilter) {
    const max = parseInt(timeFilter, 10);
    const mins = parseTempsMinutes(previewVariant(r).temps);
    if (mins === null) return false;
    if (max === 9999) { if (mins <= 60) return false; }
    else if (mins > max) return false;
  }
  if (activeFilters.length === 0) return true;
  // match if ANY variant satisfies all active ingredient filters
  return getVariants(r).some(v => {
    const ings = v.ingredients.map(i => normalize(ingLabel(i)));
    return activeFilters.every(f => ings.some(i => i.includes(normalize(f))));
  });
}

function getSortedIndices() {
  const indices = allRecettes.map((_, idx) => idx);
  if (sortMode === 'default') return indices;
  indices.sort((a, b) => {
    const ra = allRecettes[a], rb = allRecettes[b];
    if (sortMode === 'az') return ra.titre.localeCompare(rb.titre, 'fr');
    if (sortMode === 'za') return rb.titre.localeCompare(ra.titre, 'fr');
    if (sortMode === 'time-asc' || sortMode === 'time-desc') {
      const ta = parseTempsMinutes(previewVariant(ra).temps) ?? Infinity;
      const tb = parseTempsMinutes(previewVariant(rb).temps) ?? Infinity;
      return sortMode === 'time-asc' ? ta - tb : tb - ta;
    }
    return 0;
  });
  return indices;
}

function buildGrids() {
  const cats = ['apero', 'entree', 'plat', 'dessert', 'boisson', 'sauce', 'base-culinaire'];
  const allGrid = document.getElementById('grid-all');
  allGrid.innerHTML = '';
  cats.forEach(cat => { document.getElementById('grid-' + cat).innerHTML = ''; });

  const counts = { all: 0, apero: 0, entree: 0, plat: 0, dessert: 0, boisson: 0, sauce: 0, "base-culinaire": 0 };

  getSortedIndices().forEach(idx => {
    const r = allRecettes[idx];
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
      const ownerBadge = !r._isStatic
        ? `<span class="owner-badge">👤 ${r._ownerName || 'Quelqu\'un'}</span>`
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
          ${ownerBadge}
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
    const total = allRecettes.filter(r => r.cat === cat).length;
    const countEl = document.getElementById('count-' + cat);
    if (countEl) countEl.textContent = count;
    const emptyEl = document.getElementById('empty-' + cat);
    if (emptyEl) emptyEl.classList.toggle('visible', count === 0);
    const infoEl = document.getElementById('info-' + cat);
    if (infoEl) infoEl.innerHTML = activeFilters.length || searchQuery || timeFilter
      ? `<strong>${count}</strong> recette${count !== 1 ? 's' : ''} sur ${total} correspondent à votre recherche`
      : `${total} recette${total !== 1 ? 's' : ''}`;
  });

  document.getElementById('count-all').textContent = counts.all;
  const totalAll = allRecettes.length;
  document.getElementById('empty-all').classList.toggle('visible', counts.all === 0);
  document.getElementById('info-all').innerHTML = activeFilters.length || searchQuery || timeFilter
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
  const r = allRecettes[currentRecetteIdx];
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
  const r = allRecettes[currentRecetteIdx];
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

// ── Permissions : qui a le droit de modifier/supprimer la recette ouverte ──
function updateModalPermissions() {
  if (currentRecetteIdx === null) return;
  const r = allRecettes[currentRecetteIdx];
  const editBtn = document.getElementById('modal-edit');
  const deleteBtn = document.getElementById('modal-delete');
  const ownerNote = document.getElementById('modal-owner-note');

  const canEdit = !r._isStatic && !r.variantes && currentUser && r._ownerId === currentUser.uid;
  editBtn.style.display = canEdit ? 'flex' : 'none';
  deleteBtn.style.display = canEdit ? 'flex' : 'none';

  if (ownerNote) {
    ownerNote.textContent = r._isStatic ? '' : `Ajoutée par ${r._ownerName || 'quelqu\'un'}`;
  }
}

// ── Modal ──
function openModal(idx) {
  const r = allRecettes[idx];
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
  updateModalPermissions();

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

// ── Suppression d'une recette depuis la fiche recette (uniquement son auteur) ──
document.getElementById('modal-delete').addEventListener('click', async () => {
  if (currentRecetteIdx === null) return;
  const recipe = allRecettes[currentRecetteIdx];

  if (recipe._isStatic) {
    alert("Cette recette fait partie des recettes d'origine du site : elle ne peut pas être supprimée depuis ici.");
    return;
  }
  if (!currentUser || recipe._ownerId !== currentUser.uid) {
    alert("Seule la personne qui a ajouté cette recette peut la supprimer.");
    return;
  }

  const confirmed = confirm(`Supprimer définitivement "${recipe.titre}" ?\n\nCette action ne peut pas être annulée.`);
  if (!confirmed) return;

  const deleteBtn = document.getElementById('modal-delete');
  deleteBtn.disabled = true;
  try {
    await window.CloudRecipes.deleteRecipe(recipe._docId);
    closeModal();
  } catch (err) {
    console.error(err);
    alert(`La suppression a échoué : ${err.message}`);
  } finally {
    deleteBtn.disabled = false;
  }
});

// ── Filters & search ──
function getAllIngredients() {
  const set = new Set();
  allRecettes.forEach(r => getVariants(r).forEach(v => v.ingredients.forEach(i => {
    const label = ingLabel(i);
    const clean = label.replace(/^\d+[\d.,\s]*(g|ml|kg|l|c\..*?\.\s*[a-z]\.?|cl|dl|mm|cm)?\s*(de |d')?/i, '').trim();
    if (clean.length > 2) set.add(clean);
  })));
  return [...set].sort();
}
let allIngredients = getAllIngredients();

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

document.getElementById('time-filter').addEventListener('change', e => {
  timeFilter = e.target.value;
  buildGrids();
});

document.getElementById('sort-select').addEventListener('change', e => {
  sortMode = e.target.value;
  buildGrids();
});

document.getElementById('reset-btn').addEventListener('click', () => {
  activeFilters = [];
  searchQuery = '';
  timeFilter = '';
  sortMode = 'default';
  document.getElementById('search-input').value = '';
  document.getElementById('time-filter').value = '';
  document.getElementById('sort-select').value = 'default';
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

// ── Ajout / modification de recette (Google + Firestore) ──
const addModalOverlay = document.getElementById('add-modal-overlay');
const addForm = document.getElementById('add-recipe-form');
const newPhotoInput = document.getElementById('new-photo');
const newPhotoPreview = document.getElementById('new-photo-preview');
let newPhotoDataUrl = '';
let editingDocId = null;

// Réduit une image côté navigateur avant envoi (Firestore limite un document à 1 Mo).
function compressImage(file, maxDim = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
        else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openAddModal() {
  addModalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeAddModal() {
  addModalOverlay.classList.remove('open');
  document.body.style.overflow = '';
  addForm.reset();
  newPhotoDataUrl = '';
  newPhotoPreview.innerHTML = 'Aperçu';
  document.getElementById('add-form-success').classList.remove('visible');
  const statusEl = document.getElementById('publish-status');
  statusEl.classList.remove('visible', 'info', 'error');
  statusEl.textContent = '';
  editingDocId = null;
  document.getElementById('add-modal-title').textContent = 'Ajouter une recette';
  document.getElementById('add-form-submit').textContent = 'Enregistrer la recette';
}

document.getElementById('add-recipe-btn').addEventListener('click', async () => {
  const ok = await ensureSignedIn();
  if (!ok) return;
  editingDocId = null;
  document.getElementById('add-modal-title').textContent = 'Ajouter une recette';
  document.getElementById('add-form-submit').textContent = 'Enregistrer la recette';
  openAddModal();
});
document.getElementById('add-modal-close').addEventListener('click', closeAddModal);
document.getElementById('add-form-cancel').addEventListener('click', closeAddModal);
addModalOverlay.addEventListener('click', e => { if (e.target === addModalOverlay) closeAddModal(); });

newPhotoInput.addEventListener('change', () => {
  const file = newPhotoInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    newPhotoDataUrl = reader.result;
    newPhotoPreview.innerHTML = `<img src="${newPhotoDataUrl}" alt="Aperçu">`;
  };
  reader.readAsDataURL(file);
});

// ── Modifier une recette existante (uniquement si on en est l'auteur) ──
document.getElementById('modal-edit').addEventListener('click', () => {
  if (currentRecetteIdx === null) return;
  const r = allRecettes[currentRecetteIdx];

  if (r._isStatic) {
    alert("Cette recette fait partie des recettes d'origine du site : elle ne peut pas être modifiée depuis ici.");
    return;
  }
  if (!currentUser || r._ownerId !== currentUser.uid) {
    alert("Seule la personne qui a ajouté cette recette peut la modifier.");
    return;
  }

  editingDocId = r._docId;

  document.getElementById('add-modal-title').textContent = 'Modifier la recette';
  document.getElementById('add-form-submit').textContent = 'Enregistrer les modifications';

  document.getElementById('new-titre').value = r.titre;
  document.getElementById('new-cat').value = r.cat;
  document.getElementById('new-temps').value = r.temps;
  document.getElementById('new-personnes').value = r.personnes;
  document.getElementById('new-ingredients').value = r.ingredients.map(ingLabel).join('\n');
  document.getElementById('new-etapes').value = r.etapes.join('\n');

  newPhotoDataUrl = '';
  newPhotoPreview.innerHTML = r.photo ? `<img src="${r.photo}" alt="Aperçu">` : 'Aperçu';

  closeModal();
  addModalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
});

// Essaie d'extraire quantité / unité / reste d'une ligne d'ingrédient libre,
// pour que l'adaptation des portions fonctionne aussi sur les recettes ajoutées.
function parseIngredientLine(line) {
  const trimmed = line.trim();
  const m = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|mg|ml|cl|dl|l|c\.\s?à\s?s\.?|c\.\s?à\s?c\.?|cuillères?\s+à\s+soupe|cuillères?\s+à\s+café|pincées?|tranches?|gousses?|feuilles?)?\s*(?:de |d')?(.*)$/i);
  if (m && m[1]) {
    return {
      texte: trimmed,
      valeur: parseFloat(m[1].replace(',', '.')),
      unite: m[2] ? m[2].trim() : null,
      reste: (m[3] || trimmed).trim() || trimmed
    };
  }
  return { texte: trimmed, valeur: 1, unite: null, reste: trimmed };
}

addForm.addEventListener('submit', async e => {
  e.preventDefault();

  const ok = await ensureSignedIn();
  if (!ok) return;

  const titre = document.getElementById('new-titre').value.trim();
  const cat = document.getElementById('new-cat').value;
  const temps = document.getElementById('new-temps').value.trim();
  const personnes = document.getElementById('new-personnes').value.trim();
  const ingredientsLines = document.getElementById('new-ingredients').value.split('\n').map(l => l.trim()).filter(Boolean);
  const etapesLines = document.getElementById('new-etapes').value.split('\n').map(l => l.trim()).filter(Boolean);
  const photoFile = newPhotoInput.files[0] || null;
  const submitBtn = document.getElementById('add-form-submit');
  const statusEl = document.getElementById('publish-status');

  if (!titre || !ingredientsLines.length || !etapesLines.length) return;

  submitBtn.disabled = true;
  statusEl.className = 'publish-status visible info';
  statusEl.textContent = 'Enregistrement en ligne…';

  try {
    let photo = newPhotoDataUrl;
    if (photoFile) {
      statusEl.textContent = 'Compression et envoi de la photo…';
      photo = await compressImage(photoFile);
    }

    const recipeData = {
      titre, cat, temps, personnes,
      ingredients: ingredientsLines.map(parseIngredientLine),
      etapes: etapesLines,
    };
    if (photo) recipeData.photo = photo;

    if (editingDocId) {
      await window.CloudRecipes.updateRecipe(editingDocId, recipeData);
      statusEl.textContent = 'Modifications enregistrées !';
    } else {
      await window.CloudRecipes.addRecipe(recipeData);
      statusEl.textContent = 'Recette publiée ! Elle est visible par tout le monde immédiatement.';
    }
    document.getElementById('add-form-success').classList.add('visible');
    setTimeout(() => { closeAddModal(); }, 1500);
  } catch (err) {
    console.error(err);
    statusEl.className = 'publish-status visible error';
    statusEl.textContent = `L'enregistrement a échoué : ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
});

renderAuthZone();
buildGrids();
