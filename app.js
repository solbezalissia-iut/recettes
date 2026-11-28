const catLabels = {
  apero: "Apéro", entree: "Entrée", plat: "Plat", accompagnement: "Accompagnement",
  dessert: "Dessert", boisson: "Boisson", sauce: "Sauce", "base-culinaire": "Base culinaire",
  maison: "Maison"
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
// Les recettes d'origine (recettes-data.js) ne sont modifiables/supprimables par PERSONNE
// depuis le site, sauf le compte d'Alissia (ADMIN_EMAIL). Les recettes ajoutées par les
// utilisateurs vivent dans Firestore et ne sont modifiables/supprimables que par leur
// auteur — ou par Alissia, qui peut tout gérer.
const ADMIN_EMAIL = 'solbezrigaudalissia@gmail.com';

function isAdmin() {
  return !!(currentUser && currentUser.email === ADMIN_EMAIL);
}

const STATIC_RECETTES = (typeof recettes !== 'undefined' ? recettes : []).map((r, idx) => ({
  ...r,
  _isStatic: true,
  _staticId: r.id || ('static-' + idx), // id stable : ne change pas si on supprime ou fusionne des recettes
  _ownerId: null,
  _ownerName: null,
}));

let liveRecettes = [];
let hiddenStaticIds = new Set();
let allRecettes = STATIC_RECETTES.slice();
let currentUser = null;

function refreshRecettes() {
  // Une recette d'origine modifiée par Alissia devient une recette "live" qui la remplace
  // (elle porte replacesStaticId) ; une recette d'origine supprimée par Alissia est masquée.
  const replacedStaticIds = new Set(liveRecettes.filter(r => r.replacesStaticId).map(r => r.replacesStaticId));
  const visibleStatic = STATIC_RECETTES.filter(r =>
    !hiddenStaticIds.has(r._staticId) && !replacedStaticIds.has(r._staticId)
  );
  // Ordre alphabétique pour TOUTES les recettes : une recette modifiée ou ajoutée
  // reste à sa place dans la liste (avant, elle partait tout à la fin).
  const keyOf = r => r ? (r._docId ? 'live:' + r._docId : r._staticId) : null;
  const openKey = currentRecetteIdx !== null ? keyOf(allRecettes[currentRecetteIdx]) : null;
  allRecettes = removeDuplicates(mergeVersionDuplicates(mergeAliasedLive(visibleStatic.concat(dedupeLive(liveRecettes)))))
    .sort((a, b) => String(a.titre || '').localeCompare(String(b.titre || ''), 'fr', { sensitivity: 'base' }));
  if (openKey) {
    // La fiche ouverte garde la bonne recette même si sa position a changé
    const i = allRecettes.findIndex(r => keyOf(r) === openKey || (r.replacesStaticId && r.replacesStaticId === openKey));
    if (i >= 0) currentRecetteIdx = i;
  }
  allIngredients = getAllIngredients();
  renderFilters();
  buildGrids();
  if (currentRecetteIdx !== null) {
    updateModalPermissions();
    // La fiche ouverte se met à jour toute seule (modification enregistrée, ou faite par quelqu'un d'autre)
    const r = allRecettes[currentRecetteIdx];
    if (r && document.getElementById('modal-overlay').classList.contains('open')) {
      const keep = currentServings, vi = Math.min(currentVariantIdx, getVariants(r).length - 1);
      document.getElementById('modal-cat').textContent = catLabels[r.cat];
      document.getElementById('modal-title').textContent = r.titre;
      selectVariant(vi);
      if (keep !== currentServings && typeof updateServingDisplay === 'function') { currentServings = keep; updateServingDisplay(); }
    }
  }
}

// Une recette en ligne qui modifiait une recette d'origine fusionnée depuis dans une autre
// (ex. « Banane plantain caramélisée ») : son contenu va dans la bonne version de la recette fusionnée.
function mergeAliasedLive(list) {
  const AL = typeof recettesFusionnees !== 'undefined' ? recettesFusionnees : {};
  const drop = new Set(), copies = new Map();
  list.forEach(o => {
    const al = o.replacesStaticId && AL[o.replacesStaticId]; if (!al) return;
    const t = list.find(r => r !== o && (r._staticId === al[0] || r.replacesStaticId === al[0]) && r.variantes);
    if (!t) return;
    const copy = copies.get(t) || { ...t, variantes: t.variantes.map(v => ({ ...v })), _mergedFrom: [...(t._mergedFrom || [])] };
    getVariants(o).forEach((ov, i) => {
      const vi = al[1] + i; if (!copy.variantes[vi]) return;
      const nv = { ...copy.variantes[vi], temps: ov.temps, personnes: ov.personnes, ingredients: ov.ingredients, etapes: ov.etapes };
      if (ov.mc && ov.mc.length) nv.mc = ov.mc;
      const ph = ov.photo || (getVariants(o).length === 1 ? o.photo : null);
      const phCut = !!(ov.photo ? ov.photoDetouree : o.photoDetouree);
      const keepCut = copy.variantes[vi].photoDetouree && !phCut; // la version détourée des fichiers est plus légère
      if (ph && !/enattente/i.test(ph) && !keepCut) { nv.photo = ph; nv.photoDetouree = phCut; }
      copy.variantes[vi] = nv;
    });
    copy._mergedFrom.push(o); copies.set(t, copy); drop.add(o);
  });
  return list.filter(r => !drop.has(r)).map(r => copies.get(r) || r);
}

// ── Aucun doublon ──
const timeOf = r => { const t = r.updatedAt || r.createdAt; return t && t.toMillis ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : 0); };
const titleKey = r => normalize(String(r.titre || '')).replace(/[^a-z0-9]+/g, ' ').trim();
// Deux versions en ligne qui remplacent la même recette d'origine : on garde la plus récente
// (et si Alissia est connectée, l'ancienne est supprimée pour de bon)
function dedupeLive(live) {
  const best = new Map(), extra = [];
  live.forEach(r => {
    if (!r.replacesStaticId) return;
    const cur = best.get(r.replacesStaticId);
    if (!cur) best.set(r.replacesStaticId, r);
    else if (timeOf(r) > timeOf(cur)) { extra.push(cur); best.set(r.replacesStaticId, r); }
    else extra.push(r);
  });
  if (extra.length && isAdmin() && window.CloudRecipes) {
    extra.forEach(r => { if (!cleanedIds.has(r._docId)) { cleanedIds.add(r._docId); window.CloudRecipes.deleteRecipe(r._docId).catch(e => console.warn('[doublon]', e)); } });
  }
  return live.filter(r => !extra.includes(r));
}
const cleanedIds = new Set();
// Même titre : on n'affiche qu'une recette (celle en ligne la plus récente, sinon celle d'origine)
function removeDuplicates(list) {
  const keep = new Map();
  list.forEach(r => {
    const k = titleKey(r); const cur = keep.get(k);
    if (!cur) return keep.set(k, r);
    const score = x => (x._isStatic ? 0 : 1e13) + timeOf(x) + (x.variantes ? 1 : 0);
    if (score(r) > score(cur)) keep.set(k, r);
  });
  const kept = new Set(keep.values());
  return list.filter(r => kept.has(r));
}

// Une recette seule qui est en fait une version d'une recette à plusieurs versions
// (ex. « Aperol Spritz glacé aux cerises » = version « Glacé aux cerises » de « Aperol Spritz ») :
// on n'en garde qu'une, la recette à versions, avec le contenu et la photo de la recette seule pour cette version.
function mergeVersionDuplicates(list) {
  const k = s => normalize(String(s || '')).replace(/[^a-z0-9]+/g, ' ').trim();
  const drop = new Set();
  const out = list.map(r => {
    if (!r.variantes) return r;
    let copy = null;
    r.variantes.forEach((v, vi) => {
      if (!v.nom) return;
      const target = k(r.titre + ' ' + v.nom);
      const o = list.find(x => x !== r && !x.variantes && !drop.has(x) && k(x.titre) === target);
      if (!o) return;
      copy = copy || { ...r, variantes: r.variantes.map(x => ({ ...x })), _mergedFrom: [] };
      const nv = { ...copy.variantes[vi], temps: o.temps, personnes: o.personnes, ingredients: o.ingredients, etapes: o.etapes };
      if (o.mc && o.mc.length) nv.mc = o.mc;
      if (o.photo && !/enattente/i.test(o.photo)) { nv.photo = o.photo; nv.photoDetouree = !!o.photoDetouree; }
      copy.variantes[vi] = nv;
      copy._mergedFrom.push(o); drop.add(o);
    });
    return copy || r;
  });
  return out.filter(x => !drop.has(x));
}

// Appelée par cloud.js à chaque changement des recettes ajoutées en ligne.
// Copie locale (dans le téléphone) des recettes en ligne : au chargement, on affiche tout de suite
// la dernière version connue (photo sans fond, présentation…) au lieu d'attendre la connexion.
const LiveCache = (() => {
  let dbP = null;
  const db = () => dbP || (dbP = new Promise((ok, ko) => {
    const rq = indexedDB.open('recettes-cache', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => ok(rq.result); rq.onerror = () => ko(rq.error);
  }));
  return {
    get: k => db().then(d => new Promise(ok => { const r = d.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); })).catch(() => null),
    set: (k, v) => db().then(d => { d.transaction('kv', 'readwrite').objectStore('kv').put(v, k); }).catch(() => {}),
  };
})();
let liveArrived = false, hiddenArrived = false;
window.onLiveRecipesUpdate = function (live, fromCache) {
  const fix = ings => Array.isArray(ings) ? ings.map(i => (i && typeof i === 'object' && i.texte) ? { ...i, ...parseIngredientLine(i.texte) } : i) : ings;
  // Photo « sans fond » déjà détourée dans les fichiers du site : on l'utilise plutôt que de
  // retirer le fond dans le téléphone à chaque visite (c'est lent).
  const staticById = new Map(STATIC_RECETTES.map(x => [x._staticId, x]));
  const useStaticCut = (o, so, r) => {
    if (!so || o.photoDetouree || !so.photoDetouree || !/^photos\//.test(so.photo || '')) return;
    if (window.RecipeVisual && RecipeVisual.styleOf({ cat: r.cat, presentation: o.presentation || r.presentation }) !== 'free') return;
    o.photo = so.photo; o.photoDetouree = true;
  };
  if (fromCache) { if (liveArrived) return; } else { liveArrived = true; try { LiveCache.set('recipes', live); } catch (e) {} }
  liveRecettes = live.map(r => {
    const o = { ...r };
    const so = r.replacesStaticId && staticById.get(r.replacesStaticId);
    if (so) {
      useStaticCut(o, so, r);
      if (o.variantes && so.variantes) o.variantes = o.variantes.map((v, i) => { const nv = { ...v }; if (nv.photo) useStaticCut(nv, so.variantes.find(x => x.nom === v.nom) || so.variantes[i], r); return nv; });
    }
    if (o.ingredients) o.ingredients = fix(o.ingredients);
    if (o.variantes) o.variantes = o.variantes.map(v => ({ ...v, ingredients: fix(v.ingredients) }));
    return o;
  });
  refreshRecettes();
};

// Appelée par cloud.js à chaque changement des recettes d'origine masquées par Alissia.
window.onHiddenStaticUpdate = function (ids, fromCache) {
  if (fromCache) { if (hiddenArrived) return; } else { hiddenArrived = true; LiveCache.set('hidden', ids); }
  hiddenStaticIds = new Set(ids);
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
        ${isAdmin() ? '<button class="auth-btn auth-btn--ghost" id="auth-github-btn" title="Sauvegarde instantanée sur GitHub" hidden>☁︎<span class="auth-long"> GitHub</span></button>' : ''}
        <button class="auth-btn auth-btn--ghost" id="auth-signout-btn">Se déconnecter</button>
      </div>`;
    const gh = document.getElementById('auth-github-btn');
    // Le bouton n'apparaît que s'il faut (re)mettre la clé : pas encore de clé, ou clé refusée par GitHub
    if (gh) window.CloudRecipes.hasGithubToken().then(on => {
      let bad = false; try { bad = localStorage.getItem('github-cle-refusee') === '1'; } catch (e) {}
      gh.hidden = on && !bad;
    });
    if (gh) gh.addEventListener('click', async () => {
      const on = await window.CloudRecipes.hasGithubToken();
      const t = prompt((on ? "La sauvegarde instantanée sur GitHub est ACTIVÉE.\nPour changer de clé, colle la nouvelle ci-dessous (sinon Annuler).\n\n" : "Colle ici ta clé GitHub (elle commence par github_pat_) : tes modifications seront enregistrées sur GitHub quelques secondes après.\n\n") + "Clé GitHub :");
      if (!t || !t.trim()) return;
      if (!/^(github_pat_|ghp_)/.test(t.trim())) { alert("Ce n'est pas une clé GitHub : elle doit commencer par github_pat_."); return; }
      try { await window.CloudRecipes.setGithubToken(t.trim()); try { localStorage.removeItem('github-cle-refusee'); } catch (e) {} gh.hidden = true; alert("C'est enregistré : tes modifications seront sauvegardées sur GitHub quelques secondes après."); }
      catch (e) { alert("Impossible d'enregistrer la clé : " + (e.message || e) + "\n(As-tu bien mis à jour les règles Firestore ?)"); }
    });
    document.getElementById('auth-signout-btn').addEventListener('click', async () => {
      try { await window.CloudRecipes.signOutUser(); }
      catch (e) { console.error(e); }
    });
  } else {
    zone.innerHTML = `<button class="auth-btn" id="auth-signin-btn">Se connecter<span class="auth-long"> avec Google</span></button>`;
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

// ── Végétarien ──
// Une recette (ou une variante) est végétarienne si aucun de ses ingrédients ne contient
// de viande, de poisson, de fruits de mer ou de gélatine. Calculé automatiquement, donc
// valable aussi pour les recettes ajoutées depuis le site.
const NON_VEGE = /\b(poulet|boeuf|bœuf|hachee?s?|veau|porc|agneau|mouton|jambon|jambons|lardons?|lard|bacon|chorizo|saucisses?|saucisson|merguez|steaks?|viandes?|hache|dinde|canard|magret|foie gras|chapon|volailles?|pancetta|guanciale|pepperoni|serrano|bayonne|parme|chair a saucisse|escalopes?|cuisses?|blancs? de poulet|carcasse|os a moelle|fond de veau|thon|saumon|cabillaud|poissons?|crevettes?|moules|anchois|saint-jacques|nuoc-?mam|fish sauce|sauce poisson|gelatine|guimauves?|chamallow|graisse de canard|rillettes)\b/;
function isVegeVariant(v) {
  return v.ingredients.every(ing => !NON_VEGE.test(normalize(ingLabel(ing))));
}
function isVege(r) {
  return getVariants(r).some(isVegeVariant);
}

// ── Autres filtres rapides (détectés automatiquement à partir des ingrédients ou des étapes) ──
const ingText = v => v.ingredients.map(i => normalize(ingLabel(i))).join(' ; ');
const stepText = v => normalize((v.etapes || []).join(' '));
// gluten : on retire d'abord les farines et produits sans gluten
const GLUTEN_OK = /farine (de )?(riz|mais|sarrasin|tapioca|coco|pois chiches?|chataigne|riz gluant)|farine mochiko|nouilles de riz|pate a tartiner|pate de (noisette|praline|pistache|vanille|cacahuete|curry)/g;
const GLUTEN = /\b(farine|pates?|pain|pains|chapelure|panko|biscuits?|semoule|floraline|boulgour|couscous|tortillas?|brioche|baguette|croissants?|bieres?|sauce soja|spaghetti|tagliatelles|fusilli|lasagnes?|cannellonis|gnocchis?|nouilles|ble|orge|seigle|epeautre|avoine|speculoos|lotus|biscoff|oreo|boudoirs|genoise|corn ?flakes|petales de mais|cereales|petits? beurre|naans?|pitas?|crackers|tuc|cookies?|kinder|bueno|feuilles? de brick|feuilles a (gyozas|samoussas)|feuilles pour samoussas|bagels?|macaronis?|crepes? dentelles|croutons|shokobons|mikado|twix|doritos|tulipes)\b/;
const LACTOSE_OK = /sucre glace|glace pilee|lait de coco|lait vegetal|boisson vegetale|lait d'amande|lait de soja|creme vegetale|creme de coco|beurre de cacahuete|beurre de cacao|beurre d'amande|creme de marron|creme de balsamique|creme de thon|yaourt de soja|noix de coco|pate de cacahuete/g;
const LACTOSE = /\b(lait|beurre|creme|fromages?|yaourts?|mascarpone|mozzarella|parmesan|emmental|gruyere|comte|cheddar|feta|chevre|brie|camembert|reblochon|raclette|ricotta|burrata|stracciatella|gorgonzola|skyr|saint mo[r]et|caprice des dieux|boursin|philadelphia|pecorino|gouda|ficello|kinder|bueno|nutella|chantilly|glace|ganache|babeurre|petits? suisses?|toblerone|nocciolata|m&m's|twix|magnum)\b/;
const OEUFS = /(œufs?|oeufs?|\bjaunes?\b|mayonnaise|meringues?|genoise|boudoirs|biscuits? (a la )?cuilleres?)/;
const FOUR = /\b(four|enfourn\w*)\b/;
// une étape « au four » même sans le mot : température ≥ 100 °C qui ne concerne pas l'huile, un sirop ou l'air fryer
const TEMP_FOUR = /\b(1\d\d|2\d\d) ?°c/;
const PAS_FOUR = /huile|friture|frire|friteuse|sirop|caramel|air ?fryer|thermometre|°c au thermometre/;
const OVEN_INGR = /genoise|pate a choux|biscuit genoise/;
const usesOven = v => OVEN_INGR.test(ingText(v)) || (v.etapes || []).some(e => { const t = normalize(e); return FOUR.test(t) || (TEMP_FOUR.test(t) && !PAS_FOUR.test(t)); });
const CUISSON = /\b(four|enfourn\w*|cuire|cuisson|cuit|cuits|poele|casserole|frire|friture|frit|bouillir|ebullition|fremissement|fremissante|micro-?ondes|bain-marie|chauffer|chauffe|fondre|griller|grill|saisir|mijoter|dorer|revenir|wok|gaufrier|friteuse|air fryer|toaster|caramel)\b/;

const DIETS = {
  vege:     { label: '🌱 Végétarien',   test: isVegeVariant },
  gluten:   { label: '🌾 Sans gluten',  test: v => !GLUTEN.test(ingText(v).replace(GLUTEN_OK, '')) },
  lactose:  { label: '🥛 Sans lactose', test: v => !LACTOSE.test(ingText(v).replace(LACTOSE_OK, '')) },
  oeufs:    { label: '🥚 Sans œufs',    test: v => !OEUFS.test(ingText(v)) },
  sansfour: { label: '🍳 Sans four',    test: v => !usesOven(v) },
  cru:      { label: '❄️ Sans cuisson', test: v => !usesOven(v) && !CUISSON.test(stepText(v)) },
};
let activeDiets = new Set();
const variantMatchesDiets = v => [...activeDiets].every(d => DIETS[d].test(v));

function ingLabel(ing) {
  return typeof ing === 'string' ? ing : ing.texte;
}

// Returns a normalized list of variants for any recipe, whether it's a
// simple recipe or a grouped one with a `variantes` array.
function getVariants(r) {
  if (r.variantes) return r.variantes;
  return [{ nom: null, temps: r.temps, personnes: r.personnes, portion: r.portion, ingredients: r.ingredients, etapes: r.etapes, mc: r.mc }];
}
// Ce que compte le nombre : « pers. » ou ce que la recette donne (« muffins », « pots »…)
function portionOf(v) { return (v && v.portion) || 'pers.'; }

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
  if (window.Extras && !Extras.passes(r)) return false;
  if (searchQuery) {
    // Le titre, le nom d'une version ou un ingrédient ; chaque mot cherché doit s'y trouver
    const hay = normalize([r.titre, catLabels[r.cat] || ''].concat(getVariants(r).flatMap(v => [v.nom || ''].concat((v.ingredients || []).map(ingLabel)))).join(' '));
    if (!normalize(searchQuery).split(/\s+/).filter(Boolean).every(w => hay.includes(w))) return false;
  }
  if (activeDiets.size && !getVariants(r).some(variantMatchesDiets)) return false;
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
  if (sortMode !== 'default') indices.sort((a, b) => {
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
  if (searchQuery) {
    // Recherche : les recettes dont le TITRE correspond passent avant celles où le mot n'est que dans les ingrédients
    const words = normalize(searchQuery).split(/\s+/).filter(Boolean);
    const score = r => { const t = normalize(r.titre || ''); return words.every(w => t.includes(w)) ? 0 : words.some(w => t.includes(w)) ? 1 : 2; };
    const sc = new Map(indices.map(i => [i, score(allRecettes[i])]));
    indices.sort((a, b) => sc.get(a) - sc.get(b)); // tri stable : l'ordre choisi est gardé dans chaque groupe
  }
  return indices;
}

// Contenu d'une carte pour la version vi (les flèches font défiler les versions sans ouvrir la recette)
function renderCard(card, r, idx, vi) {
  const variants = getVariants(r);
  vi = ((vi % variants.length) + variants.length) % variants.length;
  card.dataset.vi = vi;
  const v = variants[vi];
  const ingName = ing => {
    const t = typeof ing === 'object' && ing.reste ? ing.reste : ingLabel(ing);
    const n = String(t).replace(/\(.*?\)/g, '').replace(/^\s*(de |d'|d’|du |des )/i, '').trim();
    return n.charAt(0).toUpperCase() + n.slice(1);
  };
  const pills = (v.ingredients || []).map(ing => {
    const label = ingLabel(ing);
    const isMatched = activeFilters.some(f => normalize(label).includes(normalize(f)));
    return isMatched ? `<b class="ing-match">${ingName(ing)}</b>` : ingName(ing);
  }).join(' · ');
  const plate = window.RecipeVisual ? RecipeVisual.plateHtml(r, 'card-plate', vi) : '';
  const mc = v.mc && v.mc.length;
  const variantBadge = variants.length > 1 ? `<span class="variant-badge">${variants.length} versions</span>` : '';
  const ownerBadge = !r._isStatic ? `<span class="owner-badge">👤 ${r._ownerName || 'Quelqu\'un'}</span>` : '';
  const nav = variants.length > 1 ? `
      <div class="card-vnav">
        <button type="button" data-vstep="-1" aria-label="Version précédente">‹</button>
        <span><b>${v.nom || 'Version ' + (vi + 1)}</b><small>${vi + 1}/${variants.length}</small></span>
        <button type="button" data-vstep="1" aria-label="Version suivante">›</button>
      </div>` : '';
  const fav = window.Extras ? Extras.isFav(r) : false;
  card.innerHTML = `
      ${plate}
      <button type="button" class="card-fav${fav ? ' on' : ''}" data-fav aria-pressed="${fav}" aria-label="${fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${fav ? '♥' : '♡'}</button>
      <div class="card-body">
        <div class="card-top">
          <div class="card-cat"><span class="cat-txt">${catLabels[r.cat]}</span>${variantBadge}${isVege(r) ? '<span class="vege-badge" title="Végétarien">🌱 Végé</span>' : ''}</div>
          <div class="card-title">${r.titre}</div>
          <p class="card-ings">${pills}</p>
        </div>
        <div class="card-foot">
          <span>⏱ ${formatTemps(v.temps)}</span>
          <span>👥 ${v.personnes} ${portionOf(v)}</span>
          ${mc ? '<span class="foot-mc">Monsieur Cuisine</span>' : ''}
          ${ownerBadge}
        </div>
        ${nav}
      </div>`;
}

// Fêtes : choisies sur la recette (champ fetes) ou reconnues dans le titre
const FETES = ['noel', 'halloween', 'paques'];
const FETE_RE = {
  noel: /noel|buche|foie gras|pain d.epices|sapin|pere noel|vin chaud|marrons glaces|galette des rois|chapon|dinde|huitre|bredele|bonhomme en pain/,
  halloween: /halloween|momie|cimetiere|fantome|sorciere|araignee|monstre|zombie|sanglant|vampire|squelette/,
  paques: /paques|lapin en chocolat|oeufs? en chocolat|nid de paques|poussin|gigot/,
};
// Fêtes de la recette entière (sans compter celles d'une seule version)
function recipeFetes(r) {
  if (Array.isArray(r.fetes) && r.fetes.length) return r.fetes.filter(f => FETES.includes(f));
  // Fêtes choisies version par version : le titre ne compte plus
  if (r.variantes && r.variantes.some(v => Array.isArray(v.fetes))) return [];
  const t = normalize(r.titre || '');
  return FETES.filter(f => FETE_RE[f].test(t));
}
// Fêtes d'une seule version : choisies sur la version, sinon reconnues dans son nom (« Cimetière d'Halloween »)
function variantFetes(v) {
  if (Array.isArray(v.fetes)) return v.fetes.filter(f => FETES.includes(f));
  const t = normalize(v.nom || '');
  return t ? FETES.filter(f => FETE_RE[f].test(t)) : [];
}
// Toutes les fêtes où la recette apparaît (la recette entière ou au moins une version)
function fetesOf(r) {
  const set = new Set(recipeFetes(r));
  (r.variantes || []).forEach(v => variantFetes(v).forEach(f => set.add(f)));
  return FETES.filter(f => set.has(f));
}
// Dans un onglet de fête, la carte s'ouvre sur la version de cette fête
function startVariantFor(r, cat) {
  if (!FETES.includes(cat) || !r.variantes || recipeFetes(r).includes(cat)) return 0;
  const i = r.variantes.findIndex(v => variantFetes(v).includes(cat));
  return i < 0 ? 0 : i;
}

// Les grilles ne contiennent que les recettes trouvées, et seule la catégorie affichée est dessinée
// (les autres le sont quand on ouvre leur onglet) : le site reste fluide même avec 600 recettes.
let gridLists = {};
const renderedGrids = new Set();
let renderToken = 0;
function makeCard(idx, cat) {
  const r = allRecettes[idx];
  const card = document.createElement('div');
  card.className = 'recipe-card';
  card.dataset.idx = idx;
  renderCard(card, r, idx, startVariantFor(r, cat));
  card.addEventListener('click', e => {
    if (e.target.closest('[data-fav]')) {
      e.stopPropagation();
      if (window.Extras) { Extras.toggleFav(r); renderCard(card, r, idx, +card.dataset.vi || 0); }
      return;
    }
    const step = e.target.closest('[data-vstep]');
    if (step) {
      e.stopPropagation();
      renderCard(card, r, idx, +card.dataset.vi + +step.dataset.vstep);
      card.classList.add('vflip'); setTimeout(() => card.classList.remove('vflip'), 250);
      return;
    }
    openModal(idx, +card.dataset.vi || 0);
  });
  return card;
}
function renderGrid(cat) {
  if (renderedGrids.has(cat)) return;
  renderedGrids.add(cat);
  const g = document.getElementById('grid-' + cat); if (!g) return;
  g.innerHTML = '';
  const list = gridLists[cat] || [];
  const token = renderToken;
  let i = 0;
  // Les cartes sont ajoutées par paquets de 24, au fur et à mesure qu'on descend dans la page
  const sentinel = document.createElement('div');
  sentinel.className = 'grid-sentinel';
  const more = () => {
    if (token !== renderToken) return;
    const frag = document.createDocumentFragment();
    const end = Math.min(list.length, i + 24);
    for (; i < end; i++) frag.appendChild(makeCard(list[i], cat));
    g.insertBefore(frag, sentinel.parentNode === g ? sentinel : null);
    if (i >= list.length) { io && io.disconnect(); sentinel.remove(); }
  };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) more(); }, { rootMargin: '1200px 0px' }) : null;
  g.appendChild(sentinel);
  more();
  if (io && i < list.length) io.observe(sentinel);
  else while (i < list.length) more();
}

function buildGrids() {
  const cats = ['apero', 'entree', 'plat', 'accompagnement', 'dessert', 'boisson', 'sauce', 'base-culinaire', 'maison', ...FETES];
  const counts = { all: 0, apero: 0, entree: 0, plat: 0, accompagnement: 0, dessert: 0, boisson: 0, sauce: 0, "base-culinaire": 0, maison: 0, noel: 0, halloween: 0, paques: 0 };
  const lists = { all: [] };
  getSortedIndices().forEach(idx => {
    const r = allRecettes[idx];
    if (!cardMatchesFilters(r)) return;
    ['all', r.cat, ...fetesOf(r)].forEach(gridCat => {
      (lists[gridCat] = lists[gridCat] || []).push(idx);
      counts[gridCat] = (counts[gridCat] || 0) + 1;
    });
  });
  gridLists = lists;
  renderToken++;
  renderedGrids.clear();
  ['all', ...cats].forEach(c => { if (c !== currentTab) { const g = document.getElementById('grid-' + c); if (g) g.innerHTML = ''; } });
  renderGrid(currentTab);

  cats.forEach(cat => {
    const count = counts[cat] || 0;
    const total = allRecettes.filter(r => FETES.includes(cat) ? fetesOf(r).includes(cat) : r.cat === cat).length;
    const countEl = document.getElementById('count-' + cat);
    if (countEl) { countEl.textContent = count; const tb = countEl.closest('.tab-btn'); if (tb) tb.classList.toggle('tab-empty', count === 0 && cat !== currentTab); }
    const emptyEl = document.getElementById('empty-' + cat);
    if (emptyEl) emptyEl.classList.toggle('visible', count === 0);
    const infoEl = document.getElementById('info-' + cat);
    if (infoEl) infoEl.innerHTML = activeFilters.length || searchQuery || timeFilter || activeDiets.size
      ? `<strong>${count}</strong> recette${count !== 1 ? 's' : ''} sur ${total} correspondent à votre recherche`
      : `${total} recette${total !== 1 ? 's' : ''}`;
  });

  document.getElementById('count-all').textContent = counts.all;
  const totalAll = allRecettes.length;
  document.getElementById('empty-all').classList.toggle('visible', counts.all === 0);
  document.getElementById('info-all').innerHTML = activeFilters.length || searchQuery || timeFilter || activeDiets.size
    ? `<strong>${counts.all}</strong> recette${counts.all !== 1 ? 's' : ''} sur ${totalAll} correspondent à votre recherche`
    : `${totalAll} recettes au total`;

  const headerCountEl = document.getElementById('header-count');
  if (headerCountEl) headerCountEl.textContent = `${totalAll} recette${totalAll !== 1 ? 's' : ''}`;
  const footerCountEl = document.getElementById('footer-count');
  if (footerCountEl) footerCountEl.textContent = totalAll;
}

// ── Affichage des temps en heures ──
// « 135 min » → « 2 h 15 », « 1h30 » → « 1 h 30 », « 45 min » reste « 45 min ».
// Le reste du texte (« + 1 nuit au frais »…) est conservé tel quel.
function formatTemps(temps) {
  if (temps == null) return '';
  return String(temps)
    .replace(/(\d+)\s*h(?:\s*(\d{1,2})(?!\d))?/gi, (m, h, mm) => `${h} h${mm ? ' ' + mm.padStart(2, '0') : ''}`)
    .replace(/(\d+)\s*min(?:utes?)?\b/gi, (m, n) => {
      n = parseInt(n, 10);
      if (n < 60) return `${n} min`;
      const h = Math.floor(n / 60), mm = n % 60;
      return `${h} h${mm ? ' ' + String(mm).padStart(2, '0') : ''}`;
    });
}

// ── Unités : masses en grammes, liquides en litres ──
function normalizeUnit(valeur, unite) {
  const u = (unite || '').trim();
  const lu = u.toLowerCase();
  if (lu === 'kg') return [valeur * 1000, 'g'];
  if (lu === 'mg') return [valeur / 1000, 'g'];
  if (lu === 'ml') return [valeur / 1000, 'L'];
  if (lu === 'cl') return [valeur / 100, 'L'];
  if (lu === 'dl') return [valeur / 10, 'L'];
  if (lu === 'l' || lu === 'litre' || lu === 'litres') return [valeur, 'L'];
  return [valeur, unite];
}

// ── Ingredient scaling ──
function formatQty(valeur, unite, ratio) {
  [valeur, unite] = normalizeUnit(valeur, unite);
  const qty = valeur * ratio;
  if (unite === 'L') {
    // jusqu'à 3 décimales : 0,015 L, 0,25 L, 1,5 L
    return `${(Math.round(qty * 1000) / 1000).toString().replace('.', ',')} L`;
  }
  let str;
  if (Math.abs(qty - Math.round(qty)) < 0.05) {
    str = Math.round(qty).toString();
  } else if (Math.abs(qty * 2 - Math.round(qty * 2)) < 0.05) {
    str = (Math.round(qty * 2) / 2).toString().replace('.', ',');
  } else if (Math.abs(qty * 4 - Math.round(qty * 4)) < 0.05) {
    // quarts (0,25 / 0,75) : évite d'afficher « 0,3 c. à café »
    str = (Math.round(qty * 4) / 4).toString().replace('.', ',');
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

// Mode de préparation : « classique » (à la main / au four) ou « mc » (Monsieur Cuisine de Lidl).
// Le choix est mémorisé sur l'appareil.
let stepsMode = 'classique';
try { stepsMode = localStorage.getItem('recettes-mode') === 'mc' ? 'mc' : 'classique'; } catch (e) { /* stockage indisponible */ }

function renderSteps() {
  const v = currentVariant();
  const note = document.getElementById('mc-note');
  document.querySelectorAll('.mode-switch button').forEach(b => b.classList.toggle('active', b.dataset.mode === stepsMode));
  let steps = v.etapes;
  note.hidden = true;
  if (stepsMode === 'mc') {
    if (v.mc && v.mc.length) {
      steps = v.mc;
      note.textContent = 'Réglages indiqués : temps / température / vitesse. Ils fonctionnent sur tous les Monsieur Cuisine (Smart, Connect, Trend).';
    } else {
      note.textContent = 'Pas encore de version Monsieur Cuisine pour cette recette : voici la version classique.';
    }
    note.hidden = false;
  }
  document.getElementById('modal-steps').innerHTML = steps.map(e => `<li><div>${e}</div></li>`).join('');
  // Boutons minuteur sur les étapes qui donnent une durée (voir timers.js)
  if (window.Timers) Timers.decorateSteps(document.getElementById('modal-steps'), () => {
    const r = allRecettes[currentRecetteIdx], vv = currentVariant();
    return r ? r.titre + (vv && vv.nom ? ' (' + vv.nom + ')' : '') : '';
  });
}

document.querySelectorAll('.mode-switch button').forEach(b => b.addEventListener('click', () => {
  stepsMode = b.dataset.mode;
  try { localStorage.setItem('recettes-mode', stepsMode); } catch (e) { /* rien */ }
  renderSteps();
}));

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
  // Beaucoup de versions (ex. 15 goûts de macarons) : une liste déroulante, plus lisible sur téléphone
  if (variants.length > 5) {
    wrap.innerHTML = `<label class="variant-select"><span>Version</span><select aria-label="Choisir la version">${variants.map((v, i) =>
      `<option value="${i}"${i === currentVariantIdx ? ' selected' : ''}>${escapeHtml(v.nom || ('Version ' + (i + 1)))}</option>`).join('')}</select><b aria-hidden="true">▾</b></label>`;
    wrap.querySelector('select').addEventListener('change', e => selectVariant(+e.target.value));
    return;
  }
  wrap.innerHTML = variants.map((v, i) => `
    <button class="variant-tab${i === currentVariantIdx ? ' active' : ''}" data-vidx="${i}">${v.nom || ('Version ' + (i + 1))}</button>
  `).join('');
  wrap.querySelectorAll('.variant-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      selectVariant(parseInt(btn.dataset.vidx, 10));
    });
  });
  const act = wrap.querySelector('.variant-tab.active');
  if (act) wrap.scrollLeft = act.offsetLeft - (wrap.clientWidth - act.offsetWidth) / 2; // version affichée bien visible
}

function selectVariant(vIdx) {
  currentVariantIdx = vIdx;
  const v = currentVariant();
  baseServings = typeof v.personnes === 'number' ? v.personnes : parseInt(v.personnes, 10) || 1;
  currentServings = baseServings;
  document.getElementById('modal-meta').innerHTML = `<span>⏱ ${formatTemps(v.temps)}</span>`;
  document.getElementById('serving-count').textContent = currentServings;
  const su = document.querySelector('.serving-unit'); if (su) su.textContent = portionOf(v);
  renderVariantTabs();
  renderIngredients();
  renderSteps();
  updateModalHero();
}

// ── Permissions : qui a le droit de modifier/supprimer la recette ouverte ──
// Chacun gère ses propres recettes ajoutées ; Alissia (ADMIN_EMAIL) peut tout gérer,
// y compris les recettes d'origine du site.
function canDeleteRecipe(r) {
  if (!currentUser) return false;
  if (isAdmin()) return true;
  return !r._isStatic && r._ownerId === currentUser.uid;
}
function canEditRecipe(r) {
  return canDeleteRecipe(r);
}

function updateModalPermissions() {
  if (currentRecetteIdx === null) return;
  const r = allRecettes[currentRecetteIdx];
  const editBtn = document.getElementById('modal-edit');
  const deleteBtn = document.getElementById('modal-delete');
  const ownerNote = document.getElementById('modal-owner-note');

  editBtn.style.display = canEditRecipe(r) ? 'flex' : 'none';
  deleteBtn.style.display = canDeleteRecipe(r) ? 'flex' : 'none';

  if (ownerNote) {
    ownerNote.textContent = r._isStatic ? '' : `Ajoutée par ${r._ownerName || 'quelqu\'un'}`;
  }
}

// ── Modal ──
// Grand visuel en haut de la fiche, pour la version affichée
function updateModalHero() {
  const r = allRecettes[currentRecetteIdx];
  const photoWrap = document.getElementById('modal-photo-wrap');
  const photoImg = document.getElementById('modal-photo');
  const photoPlaceholder = document.getElementById('modal-photo-placeholder');
  if (!window.RecipeVisual) {
    photoImg.src = r.photo || SITE_PHOTO; photoImg.alt = r.titre;
    photoImg.style.display = 'block'; photoPlaceholder.style.display = 'none';
    return;
  }
  // Même présentation que sur la carte (assiette, bol ou aliment seul), en grand sur un fond clair
  photoImg.style.display = 'none';
  photoPlaceholder.style.display = 'flex';
  photoPlaceholder.innerHTML = RecipeVisual.plateHtml(r, 'modal-plate', currentVariantIdx);
  photoWrap.classList.remove('modal-photo-wrap--placeholder');
  photoWrap.classList.add('modal-photo-wrap--illu');
  photoWrap.dataset.style = RecipeVisual.styleOf(RecipeVisual.forVariant(r, currentVariantIdx));
  photoWrap.style.background = '';
}

function openModal(idx, vi) {
  const r = allRecettes[idx];
  currentRecetteIdx = idx;
  currentVariantIdx = 0;

  document.getElementById('modal-cat').textContent = catLabels[r.cat];
  document.getElementById('modal-title').textContent = r.titre;

  const firstMatch = activeDiets.size ? getVariants(r).findIndex(variantMatchesDiets) : 0;
  selectVariant(vi > 0 && vi < getVariants(r).length ? vi : (firstMatch > 0 ? firstMatch : 0));
  updateModalPermissions();

  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  if (window.Extras) Extras.onOpen(r);
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
// (son auteur, ou Alissia qui peut tout supprimer, y compris les recettes d'origine)
document.getElementById('modal-delete').addEventListener('click', async () => {
  if (currentRecetteIdx === null) return;
  const recipe = allRecettes[currentRecetteIdx];

  if (!canDeleteRecipe(recipe)) {
    alert(recipe._isStatic
      ? "Cette recette fait partie des recettes d'origine du site : elle ne peut pas être supprimée depuis ici."
      : "Seule la personne qui a ajouté cette recette peut la supprimer.");
    return;
  }

  const confirmed = confirm(`Supprimer définitivement "${recipe.titre}" ?\n\nCette action ne peut pas être annulée.`);
  if (!confirmed) return;

  const deleteBtn = document.getElementById('modal-delete');
  deleteBtn.disabled = true;
  try {
    if (recipe._isStatic) {
      await window.CloudRecipes.hideStaticRecipe(recipe._staticId);
    } else {
      await window.CloudRecipes.deleteRecipe(recipe._docId);
    }
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

let searchTimer = null;
document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(buildGrids, 160); // attend la fin de la frappe
});

document.getElementById('time-filter').addEventListener('change', e => {
  timeFilter = e.target.value;
  buildGrids();
});

// Boutons des filtres rapides (cumulables)
const dietWrap = document.getElementById('diet-filters');
function renderDiets() {
  dietWrap.innerHTML = Object.entries(DIETS).map(([k, d]) =>
    `<button type="button" class="diet-chip${activeDiets.has(k) ? ' active' : ''}" data-diet="${k}" aria-pressed="${activeDiets.has(k)}">${d.label}</button>`).join('');
}
dietWrap.addEventListener('click', e => {
  const btn = e.target.closest('.diet-chip');
  if (!btn) return;
  const k = btn.dataset.diet;
  activeDiets.has(k) ? activeDiets.delete(k) : activeDiets.add(k);
  renderDiets();
  buildGrids();
});
renderDiets();

document.getElementById('sort-select').addEventListener('change', e => {
  sortMode = e.target.value;
  buildGrids();
});

document.getElementById('reset-btn').addEventListener('click', () => {
  activeFilters = [];
  searchQuery = '';
  timeFilter = '';
  activeDiets = new Set();
  renderDiets();
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
    renderGrid(currentTab);
  });
});

// ── Ajout / modification de recette (Google + Firestore) ──
const addModalOverlay = document.getElementById('add-modal-overlay');
const addForm = document.getElementById('add-recipe-form');
const newPhotoInput = document.getElementById('new-photo');
const newPhotoPreview = document.getElementById('new-photo-preview');
let newPhotoDataUrl = '';
let editingDocId = null;
let editingStaticId = null; // rempli quand Alissia modifie une recette d'origine
let editingOriginalPhoto = ''; // photo actuelle de la recette en cours de modification, gardée si on ne la change pas
let editingOriginalDetouree = false;
let photoBeforeCut = ''; // la photo juste avant le retrait du fond (pour « Restaurer » dans la gomme)
let newPhotoCut = false; // la nouvelle photo a déjà son arrière-plan enlevé

// Réduit une image (depuis un fichier ou une image déjà rognée) avant envoi
// (Firestore limite un document à 1 Mo).
function resizeDataUrl(src, maxDim = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
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
    img.src = src;
  });
}
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Rognage de la photo (avant enregistrement) ──
const cropModalOverlay = document.getElementById('crop-modal-overlay');
const cropImage = document.getElementById('crop-image');
const newPhotoRecropBtn = document.getElementById('new-photo-recrop');
let cropper = null;
let cropSourceDataUrl = ''; // image (non rognée) sur laquelle on rouvre le cadrage avec "Rogner la photo"

function updateRecropButton() {
  const has = (newPhotoDataUrl || editingOriginalPhoto) ? 'inline-block' : 'none';
  newPhotoRecropBtn.style.display = has;
  const eb = document.getElementById('new-photo-erase'); if (eb) eb.style.display = has;
}

// Forme du cadrage selon la catégorie : assiette (plats, entrées, desserts), bol (sauces),
// ou libre pour le reste (l'arrière-plan sera enlevé à l'enregistrement).
// Présentation choisie dans le formulaire (proposée selon la catégorie tant qu'on n'y touche pas)
let presManual = false;
function setPresentation(v) {
  const el = document.querySelector(`#pres-choice input[value="${v}"]`); if (el) el.checked = true;
}
function cropStyle() {
  const el = document.querySelector('#pres-choice input:checked');
  if (el) return el.value;
  const cat = document.getElementById('new-cat').value;
  return window.RecipeVisual ? RecipeVisual.catStyle(cat) : 'plate';
}
document.getElementById('new-cat').addEventListener('change', e => {
  if (!presManual && window.RecipeVisual) setPresentation(RecipeVisual.catStyle(e.target.value));
});
document.getElementById('pres-choice').addEventListener('change', async () => {
  presManual = true;
  const st = cropStyle();
  if (newPhotoDataUrl || editingOriginalPhoto) newPhotoPreview.className = 'form-photo-preview photo-preview--' + st;
  if (st === 'free' && newPhotoDataUrl) await cutNewPhoto();
});
function openCropper(src) {
  cropSourceDataUrl = src;
  cropImage.src = src;
  const st = cropStyle();
  cropModalOverlay.classList.remove('crop--plate', 'crop--bowl', 'crop--free');
  cropModalOverlay.classList.add('crop--' + st);
  document.getElementById('crop-help').textContent = st === 'free'
    ? "Cadre l'objet (le verre, la bouchée…) : l'arrière-plan sera enlevé automatiquement."
    : (st === 'bowl' ? 'Place la sauce dans le bol : seul le rond sera gardé.' : "Place le plat dans l'assiette : seul le rond sera gardé.");
  cropModalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  if (cropper) { cropper.destroy(); cropper = null; }
  // Cropper a besoin que l'image soit chargée dans le DOM avant de s'initialiser.
  const init = () => {
    cropper = new Cropper(cropImage, {
      aspectRatio: cropStyle() === 'free' ? NaN : 1,
      viewMode: 1,
      autoCropArea: 1,
      background: false
    });
  };
  if (cropImage.complete) init(); else cropImage.onload = init;
}

function closeCropper() {
  cropModalOverlay.classList.remove('open');
  document.body.style.overflow = '';
  if (cropper) { cropper.destroy(); cropper = null; }
}

document.getElementById('crop-cancel').addEventListener('click', closeCropper);
cropModalOverlay.addEventListener('click', e => { if (e.target === cropModalOverlay) closeCropper(); });

document.getElementById('crop-confirm').addEventListener('click', async () => {
  if (!cropper) return;
  const canvas = cropper.getCroppedCanvas({ maxWidth: 1400, maxHeight: 1400 });
  const rawDataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const st = cropStyle();
  closeCropper();
  photoBeforeCut = '';
  newPhotoDataUrl = await resizeDataUrl(rawDataUrl, editingVariants ? 700 : 900, 0.72);
  newPhotoCut = false;
  newPhotoPreview.className = 'form-photo-preview photo-preview--' + st;
  newPhotoPreview.innerHTML = `<img src="${newPhotoDataUrl}" alt="Aperçu">`;
  updateRecropButton();
  if (st === 'free') await cutNewPhoto();
});
function resetPresentation() {
  presManual = false;
  setPresentation(window.RecipeVisual ? RecipeVisual.catStyle(document.getElementById('new-cat').value) : 'plate');
}

// Détourage de la photo choisie (catégories « sans fond »)
async function cutNewPhoto() {
  if (!newPhotoDataUrl || newPhotoCut || !window.Detour) return;
  const keep = newPhotoDataUrl;
  photoBeforeCut = keep;
  newPhotoPreview.insertAdjacentHTML('beforeend', '<div class="detour-wait">Je retire l\'arrière-plan…</div>');
  try {
    const multi = !!editingVariants; // plusieurs photos dans la même recette : plus légères
    let url = await window.Detour.cut(keep, multi ? 480 : 640);
    if (url.length > (multi ? 300000 : 800000)) url = await window.Detour.cut(keep, multi ? 340 : 420); // limite Firestore (1 Mo)
    if (newPhotoDataUrl !== keep) return; // une autre photo a été choisie entre-temps
    newPhotoDataUrl = url; newPhotoCut = true;
    newPhotoPreview.innerHTML = `<img src="${url}" alt="Aperçu sans arrière-plan">`;
  } catch (e) {
    console.warn('[détourage]', e);
    const w = newPhotoPreview.querySelector('.detour-wait');
    if (w) w.textContent = "Arrière-plan pas enlevé (la photo sera gardée telle quelle).";
  }
}

newPhotoRecropBtn.addEventListener('click', () => {
  const source = newPhotoDataUrl || editingOriginalPhoto;
  if (!source) return;
  openCropper(source);
});

function openAddModal() {
  if (!editingDocId && !editingStaticId) { resetPresentation(); ingRowsFromText(''); }
  addModalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeAddModal() {
  addModalOverlay.classList.remove('open');
  document.body.style.overflow = '';
  addForm.reset();
  newPhotoDataUrl = ''; photoBeforeCut = '';
  newPhotoPreview.innerHTML = 'Aperçu';
  document.getElementById('add-form-success').classList.remove('visible');
  const statusEl = document.getElementById('publish-status');
  statusEl.classList.remove('visible', 'info', 'error');
  statusEl.textContent = '';
  editingDocId = null;
  editingStaticId = null;
  editingOriginalPhoto = ''; editingOriginalDetouree = false; newPhotoCut = false;
  document.getElementById('add-modal-title').textContent = 'Ajouter une recette';
  document.getElementById('add-form-submit').textContent = 'Enregistrer la recette';
  document.getElementById('new-photo-label').textContent = 'Photo (optionnelle)';
  editingVariants = null; editingSource = null;
  document.getElementById('variant-pick-field').style.display = 'none'; document.getElementById('fete-label').textContent = 'Spécial fêtes (facultatif)'; document.getElementById('variant-photo-field').style.display = 'none';
  updateRecropButton();
}

document.getElementById('add-recipe-btn').addEventListener('click', async () => {
  const ok = await ensureSignedIn();
  if (!ok) return;
  editingDocId = null;
  editingStaticId = null;
  editingOriginalPhoto = ''; editingOriginalDetouree = false; newPhotoCut = false;
  document.getElementById('add-modal-title').textContent = 'Ajouter une recette';
  document.getElementById('add-form-submit').textContent = 'Enregistrer la recette';
  openAddModal();
});
document.getElementById('add-modal-close').addEventListener('click', closeAddModal);
document.getElementById('add-form-cancel').addEventListener('click', closeAddModal);
addModalOverlay.addEventListener('click', e => { if (e.target === addModalOverlay) closeAddModal(); });

newPhotoInput.addEventListener('change', async () => {
  const file = newPhotoInput.files[0];
  if (!file) return;
  // On ouvre directement le cadrage sur la photo choisie : c'est la version rognée
  // qui sera utilisée comme photo de la recette (et à la bonne taille pour Firestore).
  const dataUrl = await readFileAsDataUrl(file);
  openCropper(dataUrl);
});

// ── Gomme manuelle (après le retrait du fond, ou sur n'importe quelle photo) ──
(function () {
  const ov = document.getElementById('erase-overlay');
  const cv = document.getElementById('erase-canvas');
  const stage = document.getElementById('erase-stage');
  const cursor = document.getElementById('erase-cursor');
  const sizeIn = document.getElementById('erase-size');
  const ctx = cv.getContext('2d');
  let orig = null, mode = 'erase', history = [], drawing = false, last = null;
  const loadImg = src => new Promise((ok, ko) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = ko; i.src = src; });

  async function open() {
    let src = newPhotoDataUrl || editingOriginalPhoto;
    if (!src) return;
    // Style « sans fond » pas encore détouré : on retire d'abord le fond automatiquement
    if (cropStyle() === 'free' && !(newPhotoDataUrl ? newPhotoCut : editingOriginalDetouree) && window.Detour) {
      if (!newPhotoDataUrl) { newPhotoDataUrl = src; newPhotoCut = false; }
      await cutNewPhoto();
      src = newPhotoDataUrl;
    }
    const img = await loadImg(src);
    const max = 1000, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height);
    // Image d'origine pour « Restaurer » : la photo d'avant le retrait du fond si on l'a, sinon l'image actuelle
    orig = document.createElement('canvas'); orig.width = cv.width; orig.height = cv.height;
    let base = img;
    if (photoBeforeCut && newPhotoDataUrl) { try { base = await loadImg(photoBeforeCut); } catch (e) { base = img; } }
    orig.getContext('2d').drawImage(base, 0, 0, cv.width, cv.height);
    history = [ctx.getImageData(0, 0, cv.width, cv.height)];
    setMode('erase');
    ov.classList.add('open'); document.body.style.overflow = 'hidden';
  }
  function setMode(m) {
    mode = m;
    ov.querySelectorAll('[data-emode]').forEach(b => b.classList.toggle('on', b.dataset.emode === m));
  }
  const scale = () => cv.width / cv.getBoundingClientRect().width;
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * scale(), y: (e.clientY - r.top) * scale() }; };
  function stroke(a, b) {
    const w = (+sizeIn.value) * scale();
    const line = c => { c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = w; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x + 0.01, b.y); c.stroke(); };
    ctx.save();
    if (mode === 'erase') { ctx.globalCompositeOperation = 'destination-out'; line(ctx); }
    else {
      // Restaurer : on recopie l'image d'origine (avec son fond) sous le trait
      const tmp = document.createElement('canvas'); tmp.width = cv.width; tmp.height = cv.height;
      const t = tmp.getContext('2d'); line(t);
      t.globalCompositeOperation = 'source-in'; t.drawImage(orig, 0, 0, cv.width, cv.height);
      ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(tmp, 0, 0);
    }
    ctx.restore();
  }
  function moveCursor(e) {
    const r = stage.getBoundingClientRect(), d = +sizeIn.value;
    cursor.style.width = cursor.style.height = d + 'px';
    cursor.style.left = (e.clientX - r.left - d / 2) + 'px'; cursor.style.top = (e.clientY - r.top - d / 2) + 'px';
    cursor.style.display = 'block';
  }
  cv.addEventListener('pointerdown', e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); drawing = true; last = pos(e); stroke(last, last); moveCursor(e); });
  cv.addEventListener('pointermove', e => { moveCursor(e); if (!drawing) return; const p = pos(e); stroke(last, p); last = p; });
  const end = () => { if (!drawing) return; drawing = false; history.push(ctx.getImageData(0, 0, cv.width, cv.height)); if (history.length > 30) history.splice(1, 1); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { cursor.style.display = 'none'; });
  ov.querySelectorAll('[data-emode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.emode)));
  document.getElementById('erase-undo').addEventListener('click', () => { if (history.length > 1) { history.pop(); ctx.putImageData(history[history.length - 1], 0, 0); } });
  const close = () => { ov.classList.remove('open'); document.body.style.overflow = addModalOverlay.classList.contains('open') ? 'hidden' : ''; };
  document.getElementById('erase-cancel').addEventListener('click', close);
  document.getElementById('erase-confirm').addEventListener('click', () => {
    // Image avec transparence (PNG) ; on réduit si elle est trop lourde pour l'enregistrement en ligne
    let url = cv.toDataURL('image/png');
    const limit = editingVariants ? 300000 : 800000;
    if (url.length > limit) {
      const k = Math.sqrt(limit / url.length) * 0.95, c2 = document.createElement('canvas');
      c2.width = Math.round(cv.width * k); c2.height = Math.round(cv.height * k);
      c2.getContext('2d').drawImage(cv, 0, 0, c2.width, c2.height); url = c2.toDataURL('image/png');
    }
    newPhotoDataUrl = url; newPhotoCut = true;
    newPhotoPreview.className = 'form-photo-preview photo-preview--' + cropStyle();
    newPhotoPreview.innerHTML = `<img src="${url}" alt="Aperçu">`;
    updateRecropButton();
    close();
  });
  document.getElementById('new-photo-erase').addEventListener('click', () => open().catch(e => { console.error(e); alert("Impossible d'ouvrir la gomme sur cette photo."); }));
})();

// ── Coller ou glisser une image ──
// Ctrl+V / ⌘+V n'importe où dans le formulaire, bouton « Coller une image » (pratique sur téléphone), ou glisser-déposer.
async function useImageFile(file) {
  if (!file || !/^image\//.test(file.type)) return false;
  openCropper(await readFileAsDataUrl(file));
  return true;
}
document.addEventListener('paste', e => {
  if (!addModalOverlay.classList.contains('open') || cropModalOverlay.classList.contains('open')) return;
  const item = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => i.kind === 'file' && /^image\//.test(i.type));
  if (!item) return; // du texte : on le laisse se coller normalement
  e.preventDefault();
  useImageFile(item.getAsFile());
});
document.getElementById('new-photo-paste').addEventListener('click', async () => {
  try {
    if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('non pris en charge');
    for (const it of await navigator.clipboard.read()) {
      const type = it.types.find(t => /^image\//.test(t));
      if (type) { const blob = await it.getType(type); return useImageFile(new File([blob], 'image', { type })); }
    }
    alert("Il n'y a pas d'image copiée. Copie d'abord une image (appui long sur l'image → Copier), puis réessaie.");
  } catch (e) {
    alert("Ton navigateur ne me laisse pas lire le presse-papier ici. Utilise Ctrl+V (⌘+V sur Mac) dans le formulaire, ou choisis le fichier.");
  }
});
['dragover', 'drop'].forEach(ev => addModalOverlay.addEventListener(ev, e => {
  if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  if (ev === 'drop') useImageFile([...e.dataTransfer.files].find(f => /^image\//.test(f.type)));
}));

// ── Recettes à plusieurs versions : une version à la fois dans le formulaire ──
let editingVariants = null, editingVariantIdx = 0, editingSource = null;
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function loadVariantInForm(i) {
  const v = editingVariants[i]; editingVariantIdx = i;
  document.getElementById('variant-pick').value = String(i);
  document.getElementById('new-temps').value = v.temps || '';
  document.getElementById('new-personnes').value = v.personnes || '';
  document.getElementById('new-portion').value = v.portion || '';
  v._ingText = (v.ingredients || []).map(ingLabel).join('\n');
  v._etText = (v.etapes || []).join('\n');
  document.getElementById('new-ingredients').value = v._ingText;
  ingRowsFromText(v._ingText);
  document.getElementById('new-etapes').value = v._etText;
  // Photo propre à cette version (sinon celle de la recette)
  newPhotoDataUrl = ''; newPhotoCut = false;
  const src = editingSource || {};
  editingOriginalPhoto = v.photo || (src.photo && !/enattente/i.test(src.photo) ? src.photo : '');
  editingOriginalDetouree = v.photo ? !!v.photoDetouree : !!src.photoDetouree;
  newPhotoPreview.className = 'form-photo-preview photo-preview--' + cropStyle();
  newPhotoPreview.innerHTML = editingOriginalPhoto ? `<img src="${editingOriginalPhoto}" alt="Aperçu">` : 'Aperçu';
  document.getElementById('new-photo-label').textContent = `Photo de la version « ${v.nom || 'Version ' + (i + 1)} »`;
  // Fêtes de cette version (si la recette entière était classée, la version l'hérite)
  const src_ = editingSource || {};
  const vf = Array.isArray(v.fetes) ? v.fetes : [...new Set([...recipeFetes(src_), ...variantFetes(v)])];
  document.querySelectorAll('#fete-choice input').forEach(x => { x.checked = vf.includes(x.value); });
  document.getElementById('fete-label').textContent = `Spécial fêtes pour la version « ${v.nom || 'Version ' + (i + 1)} »`;
  const tg = document.getElementById('variant-photo-targets');
  tg.innerHTML = `<label><input type="checkbox" data-vall> Toutes</label>` + editingVariants.map((x, j) =>
    `<label><input type="checkbox" data-vphoto="${j}"${j === i ? ' checked' : ''}> ${escapeHtml(x.nom || 'Version ' + (j + 1))}</label>`).join('');
  tg.querySelector('[data-vall]').addEventListener('change', e => tg.querySelectorAll('[data-vphoto]').forEach(c => { c.checked = e.target.checked; }));
  document.getElementById('variant-photo-field').style.display = '';
  newPhotoInput.value = '';
  updateRecropButton();
}
function saveVariantFromForm() {
  if (!editingVariants) return;
  const v = editingVariants[editingVariantIdx];
  v.temps = document.getElementById('new-temps').value.trim();
  const p = document.getElementById('new-personnes').value.trim(); v.personnes = isNaN(+p) || p === '' ? p : +p;
  const po = document.getElementById('new-portion').value.trim(); if (po && po !== 'pers.') v.portion = po; else delete v.portion;
  const ing = document.getElementById('new-ingredients').value, et = document.getElementById('new-etapes').value;
  if (ing !== v._ingText) v.ingredients = ing.split('\n').map(l => l.trim()).filter(Boolean).map(parseIngredientLine);
  if (et !== v._etText) v.etapes = et.split('\n').map(l => l.trim()).filter(Boolean);
  v._ingText = ing; v._etText = et;
  v.fetes = [...document.querySelectorAll('#fete-choice input:checked')].map(x => x.value);
  if (newPhotoDataUrl) {
    // La même photo peut aller sur plusieurs versions cochées
    document.querySelectorAll('#variant-photo-targets [data-vphoto]:checked').forEach(c => {
      const w = editingVariants[+c.dataset.vphoto]; if (w && w !== v) { w.photo = newPhotoDataUrl; w.photoDetouree = !!newPhotoCut; }
    });
  }
  if (newPhotoDataUrl) { v.photo = newPhotoDataUrl; v.photoDetouree = !!newPhotoCut; editingOriginalPhoto = newPhotoDataUrl; editingOriginalDetouree = !!newPhotoCut; newPhotoDataUrl = ''; }
}
document.getElementById('variant-pick').addEventListener('change', e => {
  saveVariantFromForm();
  loadVariantInForm(+e.target.value);
});

// ── Modifier une recette existante ──
// (son auteur, ou Alissia qui peut tout modifier, y compris les recettes d'origine)
document.getElementById('modal-edit').addEventListener('click', () => {
  if (currentRecetteIdx === null) return;
  const r = allRecettes[currentRecetteIdx];

  if (!canEditRecipe(r)) {
    if (r._isStatic) {
      alert("Cette recette fait partie des recettes d'origine du site : elle ne peut pas être modifiée depuis ici.");
    } else {
      alert("Seule la personne qui a ajouté cette recette peut la modifier.");
    }
    return;
  }

  editingDocId = r._isStatic ? null : r._docId;
  editingStaticId = r._isStatic ? r._staticId : null;
  editingOriginalPhoto = r.photo || ''; editingOriginalDetouree = !!r.photoDetouree;

  document.getElementById('add-modal-title').textContent = 'Modifier la recette';
  document.getElementById('add-form-submit').textContent = 'Enregistrer les modifications';
  document.getElementById('new-photo-label').textContent = 'Changer la photo (optionnelle)';

  document.getElementById('new-titre').value = r.titre;
  document.getElementById('new-cat').value = r.cat;
  presManual = !!r.presentation;
  setPresentation(window.RecipeVisual ? RecipeVisual.styleOf(r) : 'plate');
  editingSource = r;
  const fs_ = fetesOf(r);
  document.querySelectorAll('#fete-choice input').forEach(x => { x.checked = fs_.includes(x.value); });
  if (r.variantes) {
    // Recette à plusieurs versions : on modifie une version à la fois
    editingVariants = JSON.parse(JSON.stringify(r.variantes));
    const pick = document.getElementById('variant-pick');
    pick.innerHTML = editingVariants.map((v, i) => `<option value="${i}">${escapeHtml(v.nom || 'Version ' + (i + 1))}</option>`).join('');
    document.getElementById('variant-pick-field').style.display = '';
    loadVariantInForm(0);
  } else {
    editingVariants = null;
    document.getElementById('variant-pick-field').style.display = 'none'; document.getElementById('fete-label').textContent = 'Spécial fêtes (facultatif)'; document.getElementById('variant-photo-field').style.display = 'none';
    document.getElementById('new-temps').value = r.temps || '';
    document.getElementById('new-personnes').value = r.personnes || '';
    document.getElementById('new-portion').value = r.portion || '';
    document.getElementById('new-ingredients').value = (r.ingredients || []).map(ingLabel).join('\n');
    ingRowsFromText(document.getElementById('new-ingredients').value);
    document.getElementById('new-etapes').value = (r.etapes || []).join('\n');
  }

  newPhotoDataUrl = '';
  newPhotoPreview.innerHTML = r.photo ? `<img src="${r.photo}" alt="Aperçu">` : 'Aperçu';
  updateRecropButton();

  closeModal();
  addModalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
});

// Essaie d'extraire quantité / unité / reste d'une ligne d'ingrédient libre,
// pour que l'adaptation des portions fonctionne aussi sur les recettes ajoutées.
function parseIngredientLine(line) {
  const trimmed = String(line).trim();
  const UNIT_RE = '(kg|mg|g|ml|cl|dl|l|litres?|c\\.\\s?à\\s?(?:soupe|café)|c\\.\\s?à\\s?s\\.?|c\\.\\s?à\\s?c\\.?|cuillères?\\s+à\\s+(?:soupe|café)|càs|càc|pincées?|pièces?|pièce\\(s\\)|sachets?|pots?|boîtes?|briques?|tranches?|bottes?|gousses?|feuilles?|verres?|poignées?|tasses?)';
  const m = trimmed.match(new RegExp('^(\\d+(?:[.,]\\d+)?)\\s*(?:' + UNIT_RE + '(?=\\s|$))?\\s*(?:de |d\'|d’)?(.*)$', 'i'));
  if (m && m[1]) {
    let unite = m[2] ? m[2].trim() : null;
    if (unite && /^pi[eè]ce/i.test(unite)) unite = null; // « 2 pièces d'œufs » = 2 œufs
    return {
      texte: trimmed,
      valeur: parseFloat(m[1].replace(',', '.')),
      unite,
      reste: (m[3] || trimmed).trim() || trimmed
    };
  }
  return { texte: trimmed, valeur: 1, unite: null, reste: trimmed };
}

// ── Saisie des ingrédients comme dans le frigo : nom (proposé), quantité, unité ──
const ING_UNITS = ['g', 'kg', 'ml', 'cl', 'L', 'pièce(s)', 'c. à soupe', 'c. à café', 'pincée', 'sachet', 'pot', 'boîte', 'brique', 'tranche', 'botte', 'gousse', 'feuille', 'verre'];
const ingRowsBox = document.getElementById('ing-rows');
const ingHidden = document.getElementById('new-ingredients');
function ingRowHtml(it) {
  const u = it.unite || '';
  const opts = ['<option value="">unité</option>'].concat(ING_UNITS.map(x => `<option${x === u ? ' selected' : ''}>${x}</option>`));
  if (u && !ING_UNITS.includes(u)) opts.push(`<option selected>${escapeHtml(u)}</option>`);
  return `<div class="ing-row">
    <input class="ing-nom" list="ing-known" placeholder="Ingrédient (ex : farine)" value="${escapeHtml(it.nom || '')}" autocomplete="off" aria-label="Ingrédient">
    <input class="ing-qte" type="number" inputmode="decimal" min="0" step="any" placeholder="Qté" value="${it.qte ?? ''}" aria-label="Quantité">
    <select class="ing-unite" aria-label="Unité">${opts.join('')}</select>
    <button type="button" class="ing-rm" aria-label="Retirer cet ingrédient">✕</button>
  </div>`;
}
// Une ligne de texte → { nom, qte, unite }
function ingFromLine(line) {
  const p = parseIngredientLine(line);
  const hasQty = /^\d/.test(String(line).trim());
  let unite = p.unite;
  if (unite) {
    const lu = unite.toLowerCase();
    unite = lu === 'l' || /^litre/.test(lu) ? 'L' : /soupe|^c\.\s?à\s?s|càs/.test(lu) ? 'c. à soupe' : /café|^c\.\s?à\s?c|càc/.test(lu) ? 'c. à café'
      : (ING_UNITS.find(x => lu.replace(/s$/, '') === x.toLowerCase()) || unite);
  }
  const nom = hasQty ? p.reste : String(line).trim();
  return { nom: nom.charAt(0).toUpperCase() + nom.slice(1), qte: hasQty ? p.valeur : null, unite: hasQty ? unite : null };
}
// { nom, qte, unite } → ligne de texte enregistrée (« 200 g de farine »)
function ingToLine(it) {
  const nom = String(it.nom || '').trim(); if (!nom) return '';
  if (it.qte == null || it.qte === '') return nom;
  const q = String(it.qte).replace('.', ',');
  if (!it.unite || /^pi[eè]ce/i.test(it.unite)) return `${q} ${nom.charAt(0).toLowerCase() + nom.slice(1)}`;
  const n = nom.charAt(0).toLowerCase() + nom.slice(1);
  return `${q} ${it.unite} ${/^[aeiouyhéèêâîôœ]/i.test(n) ? "d'" : 'de '}${n}`;
}
function syncIngHidden() {
  ingHidden.value = [...ingRowsBox.querySelectorAll('.ing-row')].map(row => ingToLine({
    nom: row.querySelector('.ing-nom').value, qte: row.querySelector('.ing-qte').value, unite: row.querySelector('.ing-unite').value
  })).filter(Boolean).join('\n');
}
// À appeler quand le texte des ingrédients est rempli par le code (modification d'une recette, changement de version…)
function ingRowsFromText(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  ingRowsBox.innerHTML = (lines.length ? lines.map(ingFromLine) : [{}]).map(ingRowHtml).join('');
  ingHidden.value = String(text || '');
  const dl = document.getElementById('ing-known');
  if (dl && !dl.childElementCount && window.FrigoAPI) dl.innerHTML = FrigoAPI.known().slice(0, 800).map(e => `<option value="${escapeHtml(e.nom)}">`).join('');
}
function addIngRow(it, focus) {
  ingRowsBox.insertAdjacentHTML('beforeend', ingRowHtml(it || {}));
  if (focus) ingRowsBox.lastElementChild.querySelector('.ing-nom').focus();
}
document.getElementById('ing-add').addEventListener('click', () => addIngRow({}, true));
ingRowsBox.addEventListener('click', e => {
  const b = e.target.closest('.ing-rm'); if (!b) return;
  b.closest('.ing-row').remove();
  if (!ingRowsBox.childElementCount) addIngRow({});
  syncIngHidden();
});
ingRowsBox.addEventListener('input', syncIngHidden);
ingRowsBox.addEventListener('change', e => {
  const row = e.target.closest('.ing-row'); if (!row) return;
  if (e.target.classList.contains('ing-nom')) {
    const nomIn = e.target, v = nomIn.value.trim();
    // « 200 g de farine » tapé d'un coup : on range quantité et unité
    if (/^\d/.test(v)) {
      const it = ingFromLine(v);
      row.outerHTML = ingRowHtml(it);
    } else if (window.FrigoAPI) {
      // même nom que l'ingrédient déjà enregistré + unité habituelle
      const kn = FrigoAPI.known().find(x => FrigoAPI.sameName(x.nom, v));
      if (kn) nomIn.value = kn.nom;
      const u = row.querySelector('.ing-unite');
      if (!u.value) { const d = FrigoAPI.defaultUnit(nomIn.value); if (d && ![...u.options].some(o => o.value === d)) u.insertAdjacentHTML('beforeend', `<option>${d}</option>`); if (d) u.value = d; }
    }
  }
  syncIngHidden();
});
// Coller une liste entière (une ligne par ingrédient) dans un champ « Ingrédient »
ingRowsBox.addEventListener('paste', e => {
  if (!e.target.classList.contains('ing-nom')) return;
  const txt = (e.clipboardData || window.clipboardData).getData('text');
  if (!txt || !/\n/.test(txt.trim())) return;
  e.preventDefault();
  const row = e.target.closest('.ing-row');
  const lines = txt.split('\n').map(l => l.replace(/^[\s•\-–*]+/, '').trim()).filter(Boolean);
  row.insertAdjacentHTML('afterend', lines.map(l => ingRowHtml(ingFromLine(l))).join(''));
  if (!row.querySelector('.ing-nom').value.trim()) row.remove();
  syncIngHidden();
});
// Entrée dans un champ : nouvel ingrédient au lieu d'envoyer le formulaire
ingRowsBox.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('input')) return;
  e.preventDefault();
  const row = e.target.closest('.ing-row');
  if (row === ingRowsBox.lastElementChild) addIngRow({}, true); else row.nextElementSibling.querySelector('.ing-nom').focus();
});

let submitting = false; // évite d'enregistrer deux fois sur un double clic
const pendingStaticDocs = {}; // recette d'origine → recette en ligne créée juste avant
// Rouvre la fiche de la recette enregistrée dès que la version en ligne est arrivée
function reopenSaved(docId, vi) {
  if (!docId) return;
  const t0 = Date.now();
  (function look() {
    const i = allRecettes.findIndex(r => r._docId === docId || (r._mergedFrom || []).some(o => o._docId === docId));
    if (i >= 0) { if (!addModalOverlay.classList.contains('open')) openModal(i, vi || 0); return; }
    if (Date.now() - t0 < 4000) setTimeout(look, 150);
  })();
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
  const submitBtn = document.getElementById('add-form-submit');
  const statusEl = document.getElementById('publish-status');

  if (!titre || !etapesLines.length) return;
  if (!ingredientsLines.length) { alert('Ajoute au moins un ingrédient.'); return; }
  if (submitting) return;
  // Pas de doublon : une autre recette porte déjà ce nom
  const editingKey = editingDocId ? 'live:' + editingDocId : editingStaticId;
  const same = allRecettes.find(o => titleKey(o) === titleKey({ titre }) && (o._docId ? 'live:' + o._docId : o._staticId) !== editingKey
    && !(editingStaticId && o.replacesStaticId === editingStaticId));
  if (same) { alert(`La recette « ${same.titre} » existe déjà. Ouvre-la et modifie-la avec le crayon ✏️ plutôt que d'en créer une deuxième.`); return; }
  submitting = true;

  submitBtn.disabled = true;
  statusEl.className = 'publish-status visible info';
  statusEl.textContent = 'Enregistrement en ligne…';

  try {
    // La photo a déjà été rognée et redimensionnée par le cadrage (newPhotoDataUrl).
    // Si on modifie une recette sans changer sa photo, on garde l'ancienne
    // (essentiel pour les recettes d'origine : sinon la version modifiée perdrait sa photo).
    // Catégorie « sans fond » : on enlève l'arrière-plan de la nouvelle photo si ce n'est pas déjà fait
    if (newPhotoDataUrl && !newPhotoCut && window.RecipeVisual && cropStyle() === 'free') {
      statusEl.textContent = "Je retire l'arrière-plan de la photo…";
      await cutNewPhoto();
      statusEl.textContent = 'Enregistrement en ligne…';
    }
    if (editingVariants) {
      // Les photos vont dans chaque version ; la photo générale de la recette ne change pas
      saveVariantFromForm();
      newPhotoDataUrl = '';
      editingOriginalPhoto = editingSource && editingSource.photo || '';
      editingOriginalDetouree = !!(editingSource && editingSource.photoDetouree);
    }
    const photo = newPhotoDataUrl || editingOriginalPhoto || '';

    const recipeData = {
      titre, cat, temps, personnes,
      ingredients: ingredientsLines.map(parseIngredientLine),
      etapes: etapesLines,
    };
    recipeData.presentation = cropStyle();
    recipeData.fetes = [...document.querySelectorAll('#fete-choice input:checked')].map(x => x.value);
    const portion = document.getElementById('new-portion').value.trim();
    if (!editingVariants) recipeData.portion = portion && portion !== 'pers.' ? portion : '';
    if (photo) recipeData.photo = photo;
    if (editingVariants) {
      saveVariantFromForm();
      // Les versions qu'on n'a pas ouvertes gardent les fêtes qu'elles avaient (celles de la recette entière ou de leur nom)
      editingVariants.forEach(v => { if (!Array.isArray(v.fetes)) v.fetes = [...new Set([...recipeFetes(editingSource || {}), ...variantFetes(v)])]; });
      recipeData.variantes = editingVariants.map(({ _ingText, _etText, ...v }) => v);
      recipeData.fetes = []; // les fêtes sont choisies version par version
      const v0 = recipeData.variantes[0];
      Object.assign(recipeData, { temps: v0.temps || '', personnes: v0.personnes || '', ingredients: v0.ingredients || [], etapes: v0.etapes || [] });
    }
    // Recette d'origine remplacée : on garde tout ce que le formulaire ne montre pas (version Monsieur Cuisine…)
    if (editingStaticId && editingSource) {
      Object.entries(editingSource).forEach(([k, val]) => {
        if (k[0] !== '_' && k !== 'id' && !(k in recipeData) && val !== undefined) recipeData[k] = JSON.parse(JSON.stringify(val));
      });
    }
    if (newPhotoDataUrl) recipeData.photoDetouree = newPhotoCut;
    else if (editingOriginalDetouree) recipeData.photoDetouree = true;

    if (JSON.stringify(recipeData).length > 1000000) {
      throw new Error("les photos de toutes les versions sont trop lourdes ensemble (limite 1 Mo). Recadre-les plus serré ou utilise des photos plus simples.");
    }
    const mergedFrom = (editingSource && editingSource._mergedFrom) || [];
    let savedDocId = editingDocId;
    const savedVariant = editingVariants ? editingVariantIdx : 0;
    if (editingDocId) {
      await window.CloudRecipes.updateRecipe(editingDocId, recipeData);
      statusEl.textContent = 'Modifications enregistrées !';
    } else if (editingStaticId) {
      // Alissia modifie une recette d'origine : on crée une version "live" qui la remplace
      // (ou on met à jour celle qui existe déjà, pour ne jamais en avoir deux)
      recipeData.replacesStaticId = editingStaticId;
      // (pendingStaticDocs : si on remodifie avant que la connexion ait renvoyé la recette, pas de doublon)
      const existing = liveRecettes.find(o => o.replacesStaticId === editingStaticId);
      const existingId = existing ? existing._docId : pendingStaticDocs[editingStaticId];
      if (existingId) { await window.CloudRecipes.updateRecipe(existingId, recipeData); savedDocId = existingId; }
      else { savedDocId = await window.CloudRecipes.addRecipe(recipeData); pendingStaticDocs[editingStaticId] = savedDocId; }
      statusEl.textContent = 'Modifications enregistrées !';
    } else {
      savedDocId = await window.CloudRecipes.addRecipe(recipeData);
      statusEl.textContent = 'Recette publiée ! Elle est visible par tout le monde immédiatement.';
    }
    // La recette seule qui doublait une version est maintenant dans cette recette : on la retire
    for (const o of mergedFrom) {
      try {
        if (o._docId) await window.CloudRecipes.deleteRecipe(o._docId);
        if (o.replacesStaticId) await window.CloudRecipes.hideStaticRecipe(o.replacesStaticId);
        if (o._isStatic) await window.CloudRecipes.hideStaticRecipe(o._staticId);
      } catch (err) { console.warn('[fusion]', err); }
    }
    // On ferme tout de suite (avant : 1,5 s d'attente qui pouvait fermer et vider le formulaire
    // suivant si on enchaînait une autre modification) et on rouvre la fiche à jour.
    const wasEdit = !!(editingDocId || editingStaticId);
    closeAddModal();
    if (window.toast) toast(wasEdit ? 'Modifications enregistrées ✓' : 'Recette publiée ✓', 'ok');
    reopenSaved(savedDocId, savedVariant);
  } catch (err) {
    console.error(err);
    statusEl.className = 'publish-status visible error';
    statusEl.textContent = `L'enregistrement a échoué : ${err.message}`;
  } finally {
    submitting = false;
    submitBtn.disabled = false;
  }
});

renderAuthZone();
LiveCache.get('hidden').then(ids => { if (Array.isArray(ids)) window.onHiddenStaticUpdate(ids, true); });
LiveCache.get('recipes').then(live => { if (Array.isArray(live)) window.onLiveRecipesUpdate(live, true); });
refreshRecettes(); // fusionne déjà les versions avant que les recettes en ligne arrivent
