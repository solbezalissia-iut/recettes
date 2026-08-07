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

// ── Publication / suppression directe sur GitHub (dépôt GitHub Pages du site) ──
const GITHUB_OWNER = 'solbezalissia-iut';
const GITHUB_REPO = 'recettes';
const GITHUB_BRANCH = 'main';
const GITHUB_DATA_PATH = 'recettes-data.js';
const GITHUB_API_ROOT = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;

let githubToken = localStorage.getItem('githubToken') || '';

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'recette';
}

// Encode une chaîne texte (UTF-8, accents compris) en base64, comme l'exige l'API GitHub.
function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function base64ToUtf8(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

async function githubGetFile(path) {
  const res = await fetch(`${GITHUB_API_ROOT}/${path}?ref=${GITHUB_BRANCH}`, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Lecture GitHub échouée (${res.status})`);
  }
  return res.json();
}

async function githubPutFile(path, base64Content, message, sha) {
  const body = {
    message,
    content: base64Content,
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;
  const res = await fetch(`${GITHUB_API_ROOT}/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.message || `Écriture GitHub échouée (${res.status})`);
  }
  return res.json();
}

// Formate un objet recette en JSON indenté à 2 espaces, aligné pour s'insérer
// proprement dans le tableau `recettes` du fichier recettes-data.js.
function formatRecipeForFile(recipe) {
  const { isUserAdded, publishedToGithub, ...clean } = recipe;
  const json = JSON.stringify(clean, null, 2);
  return json.split('\n').map(line => '  ' + line).join('\n');
}

function insertRecipeIntoSource(source, recipe) {
  const block = formatRecipeForFile(recipe);
  const trimmed = source.replace(/\s+$/, '');
  if (!trimmed.endsWith('];')) {
    throw new Error("Structure de recettes-data.js non reconnue, insertion impossible.");
  }
  // Retire le "];" final, puis tout espace/retour à la ligne restant après le "}" du dernier objet.
  const withoutClosing = trimmed.slice(0, -2).replace(/\s+$/, '');
  if (!withoutClosing.endsWith('}')) {
    throw new Error("Fin de fichier inattendue, insertion impossible.");
  }
  return `${withoutClosing},\n${block}\n];\n`;
}

// Exécute le fichier de données (comme le fait la page elle-même via la balise <script>)
// pour en extraire le vrai tableau `recettes`, utile pour retirer une recette avec certitude.
function parseRecettesSource(source) {
  const fn = new Function(source + '\nreturn recettes;');
  return fn();
}

function serializeRecettesSource(recipesArray) {
  const body = recipesArray.map(r => formatRecipeForFile(r)).join(',\n');
  return `const recettes = [\n${body}\n];\n`;
}

async function publishRecipeToGithub(recipe, photoFile) {
  const statusEl = document.getElementById('publish-status');
  statusEl.className = 'publish-status visible info';

  let photoPath = null;
  if (photoFile) {
    statusEl.textContent = 'Envoi de la photo vers GitHub…';
    const ext = (photoFile.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    photoPath = `photos/${slugify(recipe.titre)}-${Date.now()}.${ext}`;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(photoFile);
    });
    const base64 = dataUrl.split(',')[1];
    await githubPutFile(photoPath, base64, `Ajout photo : ${recipe.titre}`);
  }

  statusEl.textContent = 'Mise à jour de la liste des recettes sur GitHub…';
  const recipeForFile = { ...recipe };
  if (photoPath) recipeForFile.photo = photoPath;
  else delete recipeForFile.photo;

  const current = await githubGetFile(GITHUB_DATA_PATH);
  if (!current) throw new Error(`Fichier ${GITHUB_DATA_PATH} introuvable sur le dépôt.`);
  const currentSource = base64ToUtf8(current.content.replace(/\n/g, ''));
  const updatedSource = insertRecipeIntoSource(currentSource, recipeForFile);

  await githubPutFile(
    GITHUB_DATA_PATH,
    utf8ToBase64(updatedSource),
    `Ajout de la recette : ${recipe.titre}`,
    current.sha
  );

  return photoPath;
}

async function deleteRecipeFromGithub(recipe) {
  const current = await githubGetFile(GITHUB_DATA_PATH);
  if (!current) throw new Error(`Fichier ${GITHUB_DATA_PATH} introuvable sur le dépôt.`);
  const currentSource = base64ToUtf8(current.content.replace(/\n/g, ''));
  const parsed = parseRecettesSource(currentSource);
  const idx = parsed.findIndex(r => r.titre === recipe.titre);
  if (idx === -1) {
    throw new Error(`Recette introuvable dans le fichier en ligne (elle a peut-être déjà été supprimée, ou pas encore publiée).`);
  }
  parsed.splice(idx, 1);
  const updatedSource = serializeRecettesSource(parsed);
  await githubPutFile(
    GITHUB_DATA_PATH,
    utf8ToBase64(updatedSource),
    `Suppression de la recette : ${recipe.titre}`,
    current.sha
  );
}

// ── Recettes ajoutées par l'utilisateur (stockées dans le navigateur) ──
(function loadUserRecipes() {
  try {
    const saved = JSON.parse(localStorage.getItem('userRecipes') || '[]');
    saved.forEach(r => recettes.push(r));
  } catch (e) {
    console.error('Erreur au chargement des recettes ajoutées :', e);
  }
})();

function saveUserRecipes() {
  // Une fois publiée sur GitHub, une recette est présente dans recettes-data.js
  // du dépôt : on ne la garde plus en local pour éviter un doublon au prochain chargement.
  const userRecipes = recettes.filter(r => r.isUserAdded && !r.publishedToGithub);
  localStorage.setItem('userRecipes', JSON.stringify(userRecipes));
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
  const indices = recettes.map((_, idx) => idx);
  if (sortMode === 'default') return indices;
  indices.sort((a, b) => {
    const ra = recettes[a], rb = recettes[b];
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
    const r = recettes[idx];
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
    if (infoEl) infoEl.innerHTML = activeFilters.length || searchQuery || timeFilter
      ? `<strong>${count}</strong> recette${count !== 1 ? 's' : ''} sur ${total} correspondent à votre recherche`
      : `${total} recette${total !== 1 ? 's' : ''}`;
  });

  document.getElementById('count-all').textContent = counts.all;
  const totalAll = recettes.length;
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

// ── Suppression d'une recette depuis la fiche recette ──
document.getElementById('modal-delete').addEventListener('click', async () => {
  if (currentRecetteIdx === null) return;
  const idx = currentRecetteIdx;
  const recipe = recettes[idx];

  const confirmed = confirm(`Supprimer définitivement "${recipe.titre}" ?\n\nCette action ne peut pas être annulée facilement.`);
  if (!confirmed) return;

  const deleteBtn = document.getElementById('modal-delete');
  deleteBtn.disabled = true;

  // Cas simple : recette ajoutée localement et jamais publiée → suppression locale uniquement, immédiate.
  if (recipe.isUserAdded && !recipe.publishedToGithub) {
    recettes.splice(idx, 1);
    saveUserRecipes();
    allIngredients = getAllIngredients();
    renderFilters();
    buildGrids();
    closeModal();
    deleteBtn.disabled = false;
    return;
  }

  // Sinon la recette existe dans le fichier en ligne (recette d'origine ou déjà publiée) :
  // il faut un jeton GitHub pour la retirer réellement du dépôt.
  let token = githubToken;
  if (!token) {
    token = prompt('Collez votre jeton GitHub (avec accès en écriture au dépôt "recettes") pour confirmer la suppression en ligne :', '');
    if (!token) { deleteBtn.disabled = false; return; }
    localStorage.setItem('githubToken', token);
  }
  githubToken = token;

  try {
    await deleteRecipeFromGithub(recipe);
    recettes.splice(idx, 1);
    allIngredients = getAllIngredients();
    renderFilters();
    buildGrids();
    closeModal();
    alert('Recette supprimée du dépôt GitHub. Elle disparaîtra du site en ligne après la republication automatique de GitHub Pages (une à deux minutes).');
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
  recettes.forEach(r => getVariants(r).forEach(v => v.ingredients.forEach(i => {
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

// ── Ajout de recette ──
const addModalOverlay = document.getElementById('add-modal-overlay');
const addForm = document.getElementById('add-recipe-form');
const newPhotoInput = document.getElementById('new-photo');
const newPhotoPreview = document.getElementById('new-photo-preview');
let newPhotoDataUrl = '';

function openAddModal() {
  addModalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  if (githubToken) document.getElementById('github-token').value = githubToken;
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
}

document.getElementById('add-recipe-btn').addEventListener('click', openAddModal);
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

  const titre = document.getElementById('new-titre').value.trim();
  const cat = document.getElementById('new-cat').value;
  const temps = document.getElementById('new-temps').value.trim();
  const personnes = document.getElementById('new-personnes').value.trim();
  const ingredientsLines = document.getElementById('new-ingredients').value.split('\n').map(l => l.trim()).filter(Boolean);
  const etapesLines = document.getElementById('new-etapes').value.split('\n').map(l => l.trim()).filter(Boolean);
  const tokenInput = document.getElementById('github-token').value.trim();
  const photoFile = newPhotoInput.files[0] || null;
  const submitBtn = document.getElementById('add-form-submit');
  const statusEl = document.getElementById('publish-status');

  if (!titre || !ingredientsLines.length || !etapesLines.length) return;

  const newRecipe = {
    titre,
    photo: newPhotoDataUrl || undefined,
    temps,
    personnes,
    cat,
    ingredients: ingredientsLines.map(parseIngredientLine),
    etapes: etapesLines,
    isUserAdded: true
  };

  // Toujours garder une copie locale immédiate, pour que la recette soit
  // visible sans attendre la publication (et en secours si elle échoue).
  recettes.push(newRecipe);
  saveUserRecipes();
  allIngredients = getAllIngredients();
  renderFilters();
  buildGrids();

  if (tokenInput) {
    githubToken = tokenInput;
    localStorage.setItem('githubToken', tokenInput);
    submitBtn.disabled = true;
    try {
      const publishedPhotoPath = await publishRecipeToGithub(newRecipe, photoFile);
      if (publishedPhotoPath) newRecipe.photo = publishedPhotoPath;
      newRecipe.publishedToGithub = true;
      saveUserRecipes();
      statusEl.className = 'publish-status visible info';
      statusEl.textContent = 'Recette publiée sur GitHub ! Elle apparaîtra en ligne pour tout le monde dans une minute ou deux, le temps que GitHub Pages republie le site.';
      document.getElementById('add-form-success').classList.add('visible');
      setTimeout(() => { closeAddModal(); }, 2200);
    } catch (err) {
      console.error(err);
      statusEl.className = 'publish-status visible error';
      statusEl.textContent = `La recette est enregistrée dans ce navigateur, mais la publication sur GitHub a échoué : ${err.message}. Vérifiez que le jeton a bien les droits d'écriture sur le dépôt "${GITHUB_REPO}".`;
    } finally {
      submitBtn.disabled = false;
    }
  } else {
    document.getElementById('add-form-success').classList.add('visible');
    setTimeout(() => { closeAddModal(); }, 900);
  }
});

buildGrids();
