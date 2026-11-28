// ────────────────────────────────────────────────────────────────────────
// extras.js — options pratiques en plus :
//  • Favoris ♥ (sur la carte ou la fiche) + bouton pour n'afficher qu'eux ;
//  • 🎲 Une recette au hasard (parmi celles affichées) ;
//  • 👩‍🍳 Mode cuisine : une étape à la fois en grand, écran qui reste allumé,
//    glisser pour passer à l'étape suivante, minuteurs, ingrédients à cocher ;
//  • ↗ Partager une recette (lien direct qui ouvre la fiche) ;
//  • 🖨 Imprimer proprement la fiche.
// Utilise les variables d'app.js (allRecettes, currentRecetteIdx, gridLists…).
// ────────────────────────────────────────────────────────────────────────
(function () {
  const FKEY = 'recettes-favoris';
  let favs = new Set();
  try { favs = new Set(JSON.parse(localStorage.getItem(FKEY) || '[]')); } catch (e) { /* rien */ }
  const saveFavs = () => { try { localStorage.setItem(FKEY, JSON.stringify([...favs])); } catch (e) { /* rien */ } };
  let onlyFavs = false;

  // Clé stable d'une recette (une recette d'origine modifiée en ligne garde la même)
  const keyOf = r => r ? (r.replacesStaticId || r._staticId || (r._docId ? 'live:' + r._docId : r.titre)) : '';
  const isFav = r => favs.has(keyOf(r)) || (r && (r._mergedFrom || []).some(o => favs.has(keyOf(o))));
  function toggleFav(r) {
    const k = keyOf(r);
    if (isFav(r)) { favs.delete(k); (r._mergedFrom || []).forEach(o => favs.delete(keyOf(o))); toast('Retirée des favoris'); }
    else { favs.add(k); toast('Ajoutée aux favoris ♥', 'ok'); }
    saveFavs();
    updateModalFav();
    updateFavCount();
    if (onlyFavs) buildGrids();
  }
  const passes = r => !onlyFavs || isFav(r);

  // ── Bouton « Favoris » de la barre de recherche ──
  const favBtn = document.getElementById('fav-toggle');
  function updateFavCount() {
    if (!favBtn) return;
    favBtn.classList.toggle('on', onlyFavs);
    favBtn.setAttribute('aria-pressed', onlyFavs);
    favBtn.firstChild.textContent = onlyFavs ? '♥' : '♡';
  }
  if (favBtn) favBtn.addEventListener('click', () => {
    if (!onlyFavs && !favs.size) { toast('Pas encore de favoris : touche le ♡ sur une recette pour l\'ajouter.'); return; }
    onlyFavs = !onlyFavs;
    updateFavCount();
    buildGrids();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ── Recette au hasard parmi celles affichées (onglet, recherche et filtres compris) ──
  const rnd = document.getElementById('random-btn');
  if (rnd) rnd.addEventListener('click', () => {
    const list = (gridLists && gridLists[currentTab]) || [];
    if (!list.length) { toast('Aucune recette affichée : enlève un filtre et réessaie.'); return; }
    const idx = list[Math.floor(Math.random() * list.length)];
    const r = allRecettes[idx];
    openModal(idx, startVariantFor(r, currentTab));
  });

  // ── Boutons de la fiche ──
  const $ = id => document.getElementById(id);
  function cur() { return currentRecetteIdx !== null ? allRecettes[currentRecetteIdx] : null; }
  function updateModalFav() {
    const r = cur(), b = $('ma-fav'); if (!r || !b) return;
    const on = isFav(r);
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    b.textContent = on ? '♥ Favori' : '♡ Favori';
  }
  function onOpen(r) {
    updateModalFav();
    // Adresse de la page = lien direct vers la fiche (sans créer d'étape « retour » en plus)
    // (après l'étape ajoutée pour le bouton retour : en revenant, l'adresse redevient normale)
    setTimeout(() => { try { if (document.getElementById('modal-overlay').classList.contains('open')) history.replaceState(history.state, '', '#r=' + encodeURIComponent(keyOf(r))); } catch (e) { /* rien */ } }, 0);
  }
  $('ma-fav') && $('ma-fav').addEventListener('click', () => { const r = cur(); if (r) toggleFav(r); });
  $('ma-print') && $('ma-print').addEventListener('click', () => window.print());
  $('ma-share') && $('ma-share').addEventListener('click', async () => {
    const r = cur(); if (!r) return;
    const url = location.origin + location.pathname + '#r=' + encodeURIComponent(keyOf(r));
    try {
      if (navigator.share) { await navigator.share({ title: r.titre, text: r.titre + ' — la recette :', url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Lien copié : colle-le dans un message ✓', 'ok'); }
    catch (e) { prompt('Copie ce lien :', url); }
  });
  // La fiche fermée : l'adresse redevient celle du site
  const mo = $('modal-overlay');
  if (mo) new MutationObserver(() => {
    if (!mo.classList.contains('open') && /^#r=/.test(location.hash)) {
      try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* rien */ }
    }
  }).observe(mo, { attributes: true, attributeFilter: ['class'] });

  // ── Lien direct reçu (#r=…) : on ouvre la fiche dès que la recette est là ──
  const want = (/^#r=(.+)$/.exec(location.hash) || [])[1];
  if (want) {
    const key = decodeURIComponent(want), t0 = Date.now();
    (function look() {
      const i = allRecettes.findIndex(r => keyOf(r) === key || (r._mergedFrom || []).some(o => keyOf(o) === key));
      if (i >= 0) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} openModal(i, 0); return; }
      if (Date.now() - t0 < 6000) setTimeout(look, 200);
    })();
  }

  // ═════════════ MODE CUISINE ═════════════
  const ov = document.createElement('div');
  ov.id = 'cook-overlay';
  ov.className = 'cook-overlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', 'Mode cuisine');
  ov.innerHTML = `
    <div class="cook-top">
      <button type="button" class="cook-x" id="cook-close" aria-label="Quitter le mode cuisine">✕</button>
      <div class="cook-title" id="cook-title"></div>
      <button type="button" class="cook-ing-btn" id="cook-ing-btn" aria-expanded="false">🧺 Ingrédients</button>
    </div>
    <div class="cook-progress"><i id="cook-bar"></i></div>
    <div class="cook-ings" id="cook-ings" hidden></div>
    <div class="cook-main" id="cook-main">
      <div class="cook-num" id="cook-num"></div>
      <ol class="cook-step" id="cook-step"></ol>
    </div>
    <div class="cook-nav">
      <button type="button" id="cook-prev">‹ Précédente</button>
      <button type="button" id="cook-next" class="cook-next">Suivante ›</button>
    </div>
    <div class="cook-awake" id="cook-awake"></div>`;
  document.body.appendChild(ov);
  if (window.UI) UI.watch(ov);
  let steps = [], at = 0, lock = null, title = '';

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator) {
        lock = await navigator.wakeLock.request('screen');
        $('cook-awake').textContent = '☀️ L\'écran reste allumé pendant que tu cuisines';
      } else $('cook-awake').textContent = '';
    } catch (e) { $('cook-awake').textContent = ''; }
  }
  document.addEventListener('visibilitychange', () => { if (ov.classList.contains('open') && document.visibilityState === 'visible') keepAwake(); });

  function show(i) {
    at = Math.max(0, Math.min(steps.length - 1, i));
    $('cook-num').textContent = `Étape ${at + 1} sur ${steps.length}`;
    $('cook-step').innerHTML = `<li><div>${steps[at]}</div></li>`;
    if (window.Timers) Timers.decorateSteps($('cook-step'), () => title);
    // garder le bon numéro d'étape pour le minuteur
    $('cook-step').querySelectorAll('.step-timer').forEach(b => { b.dataset.step = at + 1; });
    $('cook-bar').style.width = ((at + 1) / steps.length * 100) + '%';
    $('cook-prev').disabled = at === 0;
    $('cook-next').textContent = at === steps.length - 1 ? 'Terminé ✓' : 'Suivante ›';
    $('cook-main').scrollTop = 0;
  }
  function openCook() {
    const r = cur(); if (!r) return;
    const v = typeof currentVariant === 'function' ? currentVariant() : null;
    title = r.titre + (v && v.nom ? ' (' + v.nom + ')' : '');
    // Les étapes et ingrédients tels qu'affichés dans la fiche (mode Monsieur Cuisine et nombre de personnes compris)
    steps = [...document.querySelectorAll('#modal-steps > li')].map(li => (li.firstElementChild || li).innerHTML);
    if (!steps.length) { toast('Cette recette n\'a pas encore d\'étapes.'); return; }
    $('cook-title').textContent = title;
    const ings = [...document.querySelectorAll('#modal-ings > li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    $('cook-ings').innerHTML = `<p class="cook-ings-head">Pour ${typeof currentServings !== 'undefined' ? currentServings : ''} ${v ? portionOf(v) : ''} — touche pour cocher ce qui est prêt</p>` +
      ings.map(t => `<label><input type="checkbox"><span>${escapeHtml(t.replace(/^—\s*/, ''))}</span></label>`).join('');
    $('cook-ings').hidden = true; $('cook-ing-btn').setAttribute('aria-expanded', 'false');
    ov.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('cooking');
    show(0);
    keepAwake();
  }
  function closeCook() {
    ov.classList.remove('open');
    document.body.classList.remove('cooking');
    if (!document.getElementById('modal-overlay').classList.contains('open')) document.body.style.overflow = '';
    try { lock && lock.release(); } catch (e) { /* rien */ }
    lock = null;
  }
  $('ma-cook') && $('ma-cook').addEventListener('click', openCook);
  $('cook-close').addEventListener('click', closeCook);
  $('cook-prev').addEventListener('click', () => show(at - 1));
  $('cook-next').addEventListener('click', () => { if (at === steps.length - 1) { closeCook(); toast('Bon appétit ! 😋', 'ok'); } else show(at + 1); });
  $('cook-ing-btn').addEventListener('click', () => {
    const box = $('cook-ings'); box.hidden = !box.hidden;
    $('cook-ing-btn').setAttribute('aria-expanded', String(!box.hidden));
  });
  document.addEventListener('keydown', e => {
    if (!ov.classList.contains('open')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); $('cook-next').click(); }
    if (e.key === 'ArrowLeft') show(at - 1);
    if (e.key === 'Escape') { e.stopImmediatePropagation(); closeCook(); }
  }, true);
  // Glisser vers la gauche / la droite pour changer d'étape
  let sx = null, sy = 0;
  $('cook-main').addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $('cook-main').addEventListener('touchend', e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) $('cook-next').click(); else show(at - 1); }
  });

  // Recherche : texte plus court sur petit écran pour qu'il reste lisible
  const si = document.getElementById('search-input');
  const ph = () => { if (si) si.placeholder = innerWidth < 700 ? 'Rechercher…' : 'Chercher une recette…'; };
  ph(); addEventListener('resize', ph);

  // ── Catégories : la fête de la saison passe en premier (et tout de suite après « Toutes » sur téléphone) ──
  (function seasonTabs() {
    const d = new Date(), m = d.getMonth();
    const season = (m >= 10 || (m === 0 && d.getDate() <= 6)) ? 'noel' : (m === 8 || m === 9) ? 'halloween' : (m >= 1 && m <= 3) ? 'paques' : null;
    const sep = document.querySelector('#tabs .tab-sep');
    const tab = season && document.querySelector(`#tabs .tab-btn[data-cat="${season}"]`);
    if (tab && sep) { sep.after(tab); tab.classList.add('tab-season'); tab.title = 'C\'est la saison !'; }
  })();

  window.Extras = { isFav, toggleFav, passes, onOpen, keyOf };
  updateFavCount();
  // Les cartes déjà dessinées reçoivent leur cœur
  if (typeof buildGrids === 'function') buildGrids();
})();
