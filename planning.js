// ────────────────────────────────────────────────────────────────────────
// planning.js — « Ma semaine » (planning des repas) + « Courses » (liste de courses)
//
// Chaque compte Google a son propre planning et sa propre liste, enregistrés
// dans Firestore (document planning/{uid}, voir cloud.js et firestore.rules).
// Le planning peut être partagé avec d'autres comptes Google : ils voient et
// modifient les mêmes repas et la même liste de courses, en direct.
// Ce fichier est chargé après app.js et réutilise ses fonctions :
// allRecettes, getVariants, ingLabel, normalize, catLabels, openModal…
// ────────────────────────────────────────────────────────────────────────
(function () {
  // Ordre des services dans un repas et intitulés affichés
  const COURSE_ORDER = ['boisson', 'apero', 'entree', 'plat', 'accompagnement', 'sauce', 'base-culinaire', 'dessert', 'maison'];
  const COURSE_LABEL = { boisson: 'Boissons', apero: 'Apéro', entree: 'Entrée', plat: 'Plat', accompagnement: 'Accompagnement', sauce: 'Sauce', 'base-culinaire': 'Base', dessert: 'Dessert', maison: 'Maison' };
  const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const MEALS = [['midi', 'Midi'], ['soir', 'Soir']];

  // Rayons du magasin, dans l'ordre où on les parcourt
  const RAYONS = [
    ['fl', '🥕', 'Fruits & légumes'], ['cr', '🧀', 'Crèmerie & œufs'], ['vi', '🍗', 'Viande & poisson'],
    ['bo', '🥖', 'Boulangerie & pâtes à tarte'], ['su', '🍫', 'Épicerie sucrée'], ['sa', '🫙', 'Épicerie salée'],
    ['bs', '🥤', 'Boissons'], ['sg', '🧊', 'Surgelés'], ['au', '🧺', 'Autres']
  ];
  // Mots-clés pour ranger automatiquement chaque article (le premier rayon qui correspond gagne)
  const KW = [
    ['sg', ['congel', 'glace pilee', 'glacons', 'surgel']],
    ['bs', ['jus de cranberry', 'jus d\'orange', 'jus de pomme', 'jus d\'ananas', 'eau gazeuse', 'eau petillante', 'limonade', 'soda', 'tonic', 'ginger', 'aperol', 'prosecco', 'champagne', 'vin ', 'vin blanc', 'vin rouge', 'biere', 'rhum', 'vodka', 'gin', 'tequila', 'liqueur', 'amaretto', 'cointreau', 'whisky', 'sirop', 'cafe', 'expresso', 'the ', 'coca']],
    ['su', ['beurre de cacahu', 'lait concentre', 'pate a tartiner', 'pate de lotus', 'pate a biscuits', 'pate de pistache', 'praline', 'poudre de lait', 'sucre', 'farine', 'levure', 'chocolat', 'nutella', 'lotus', 'speculoos', 'kinder', 'biscuit', 'cereales', 'cornflakes', 'vanille', 'gelatine', 'agar', 'miel', 'confiture', 'caramel', 'amande', 'noisette', 'noix de coco', 'cacahu', 'pistache', 'shokobons', 'popcorn', 'mais a eclater', 'flocons', 'fecule', 'maizena', 'colorant', 'mochiko', 'cacao', 'pepites', 'cassonade', 'fleur d\'oranger', 'genoise', 'creme patissiere', 'topping', 'levain', 'oreo', 'guimauve', 'chamallow', 'bonbon', 'm&m', 'twix', 'bueno', 'noix', 'raisins secs', 'dattes', 'sirop d\'erable', 'glace vanille', 'glace']],
    ['sa', ['creme de balsamique', 'huile', 'vinaigre', 'balsamique', 'sel', 'poivre', 'epice', 'paprika', 'cumin', 'curry', 'curcuma', 'herbes', 'origan', 'cannelle', 'muscade', 'pesto', 'passata', 'coulis de tomate', 'concentre de tomate', 'sauce', 'ketchup', 'moutarde', 'riz', 'pates', 'spaghetti', 'tagliatelle', 'penne', 'nouilles', 'lasagne', 'gnocchi', 'semoule', 'couscous', 'boulgour', 'quinoa', 'lentilles', 'thon', 'sardine', 'pois chiche', 'haricots rouges', 'mais', 'miso', 'tapioca', 'mayonnaise', 'piment', 'noix de cajou', 'pignons', 'xanthane', 'chapelure', 'panko', 'sesame', 'graines', 'bouillon', 'cube', 'olives', 'capres', 'cornichons', 'lait de coco', 'soja', 'tortilla', 'wrap', 'chips', 'cardamome', 'gingembre moulu', 'ail en poudre']],
    ['vi', ['saumon', 'poulet', 'boeuf', 'bœuf', 'veau', 'porc', 'agneau', 'jambon', 'prosciutto', 'bacon', 'lardons', 'guanciale', 'pancetta', 'chorizo', 'saucisse', 'merguez', 'steak', 'viande', 'hache', 'dinde', 'canard', 'magret', 'poisson', 'cabillaud', 'crevette', 'moules', 'anchois', 'saint-jacques', 'escalope', 'cuisse', 'filet de', 'rillettes']],
    ['cr', ['jaune d\'oeuf', 'jaunes d\'oeufs', 'blanc d\'oeuf', 'blancs d\'oeufs', 'oeuf', 'lait', 'beurre', 'creme', 'yaourt', 'fromage', 'mozzarella', 'burrata', 'stracciatella', 'feta', 'mascarpone', 'cream cheese', 'philadelphia', 'ricotta', 'emmental', 'gruyere', 'comte', 'parmesan', 'cheddar', 'gouda', 'pecorino', 'chevre', 'brie', 'camembert', 'reblochon', 'raclette', 'chantilly', 'skyr', 'petit suisse', 'boursin']],
    ['bo', ['pain', 'ciabatta', 'baguette', 'brioche', 'pate feuilletee', 'pate brisee', 'pate sablee', 'pate sucree', 'pate a croissant', 'pate a pizza', 'brick', 'bagel', 'buns', 'muffin anglais']],
    ['fl', ['fraise', 'pomme', 'poire', 'banane', 'plantain', 'orange', 'citron', 'kiwi', 'peche', 'abricot', 'melon', 'pasteque', 'mangue', 'ananas', 'framboise', 'myrtille', 'cerise', 'raisin', 'carotte', 'courgette', 'tomate', 'poivron', 'oignon', 'echalote', 'ail', 'aubergine', 'avocat', 'concombre', 'salade', 'roquette', 'epinard', 'brocoli', 'chou', 'poireau', 'champignon', 'butternut', 'potiron', 'courge', 'patate douce', 'betterave', 'radis', 'celeri', 'fenouil', 'haricots verts', 'petits pois', 'basilic', 'ciboulette', 'persil', 'coriandre', 'menthe', 'thym', 'romarin', 'aneth', 'laurier', 'sauge', 'estragon', 'ciboule', 'gingembre', 'legume', 'fruit', 'citron vert']],
    ['au', ['lessive', 'papier', 'eponge', 'savon', 'shampo', 'sac', 'liquide vaisselle', 'dentifrice', 'mouchoirs', 'essuie']]
  ];
  // On compare des débuts de mots (sinon « aubergine » contiendrait « gin »…)
  const words = s => ' ' + normalize(String(s)).replace(/œ/g, 'oe').replace(/[^a-z0-9&]+/g, ' ').trim() + ' ';
  const KWN = KW.map(([r, list]) => [r, list.map(k => words(k).trimEnd())]);
  function rayonOf(txt) {
    const t = words(txt);
    for (const [r, list] of KWN) if (list.some(k => t.includes(k))) return r;
    return 'au';
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  // ── Semaine affichée ──
  function monday(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fmtD = (d, o) => d.toLocaleDateString('fr-FR', o);
  let wk = monday(new Date());
  const isCurrentWeek = () => iso(monday(new Date())) === iso(wk);

  // ── État (par compte) ──
  let user = null;
  let state = { weeks: {} };
  let loaded = false;
  let unsub = null;
  let saveTimer = null;
  // Partage
  let activeUid = null;          // planning affiché : le sien (user.uid) ou celui de quelqu'un d'autre
  let sharing = { sharedWith: [], ownerName: '' }; // infos de partage du planning affiché
  let sharedList = [];           // plannings que d'autres ont partagés avec moi
  let unsubShared = null;
  const dirty = new Set();       // semaines modifiées pas encore envoyées
  const isMine = () => !!user && activeUid === user.uid;
  const myEmail = () => (user && user.email || '').toLowerCase();
  const firstName = n => String(n || '').trim().split(/\s+/)[0] || '';
  function activeOwnerName() {
    if (isMine()) return '';
    const o = sharedList.find(x => x.uid === activeUid);
    return o ? (firstName(o.ownerName) || o.ownerEmail) : (firstName(sharing.ownerName) || 'quelqu\'un');
  }

  function W() {
    const k = iso(wk);
    if (!state.weeks[k]) state.weeks[k] = { plan: {}, checked: {}, extras: [] };
    const w = state.weeks[k];
    w.plan = w.plan || {}; w.checked = w.checked || {}; w.extras = w.extras || [];
    return w;
  }

  function setSync(txt, cls) {
    document.querySelectorAll('.plan-sync').forEach(el => { el.textContent = txt; el.className = 'plan-sync' + (cls ? ' ' + cls : ''); });
  }

  // Enregistre la semaine affichée (seules les semaines modifiées sont envoyées)
  function save() {
    if (!user || !activeUid || !window.CloudPlanning) return;
    dirty.add(iso(wk));
    clearTimeout(saveTimer);
    setSync('Enregistrement…');
    saveTimer = setTimeout(flush, 400);
  }
  async function flush() {
    const uid = activeUid;
    const keys = [...dirty]; dirty.clear();
    try {
      for (const k of keys) {
        const w = state.weeks[k];
        const empty = !w || !(Object.keys(w.plan || {}).length || (w.extras || []).length || Object.keys(w.checked || {}).length);
        await window.CloudPlanning.saveWeek(uid, k, empty ? null : w);
      }
      setSync(isMine() ? (sharing.sharedWith.length ? '✓ Enregistré · partagé' : '✓ Enregistré sur ton compte') : '✓ Enregistré · planning de ' + activeOwnerName(), 'ok');
    } catch (e) {
      console.error('[planning] enregistrement', e);
      keys.forEach(k => dirty.add(k));
      setSync('⚠️ Pas enregistré : ' + (e.code === 'permission-denied' ? 'règles Firestore à mettre à jour (ou partage retiré)' : (e.message || e)), 'err');
    }
  }

  // ── Retrouver une recette à partir de son identifiant enregistré ──
  function ridOf(r) { return r._isStatic ? r._staticId : 'live:' + r._docId; }
  function findRecipe(rid) {
    return allRecettes.find(r => ridOf(r) === rid)
      || allRecettes.find(r => r.replacesStaticId === rid) // recette d'origine modifiée par Alissia
      || null;
  }
  function variantOf(r, v) { const vs = getVariants(r); return vs[v] || vs[0]; }
  const basePers = v => (typeof v.personnes === 'number' ? v.personnes : parseInt(v.personnes, 10)) || 1;

  // ── Navigation entre les 3 vues ──
  const VIEWS = ['recettes', 'semaine', 'courses'];
  function show(view) {
    VIEWS.forEach(v => {
      const el = document.getElementById('view-' + v);
      if (el) el.hidden = v !== view;
    });
    document.querySelectorAll('.view-nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (view !== 'recettes') renderAll();
    window.scrollTo({ top: 0 });
    try { localStorage.setItem('recettes-vue', view); } catch (e) { /* stockage indisponible */ }
  }
  document.querySelectorAll('.view-nav button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

  // ── Écran « connecte-toi » ──
  function loginCard(target) {
    return `<div class="plan-login">
      <div class="plan-login-ic">${target === 'courses' ? '🛒' : '🗓️'}</div>
      <h3>Connecte-toi pour ${target === 'courses' ? 'ta liste de courses' : 'planifier ta semaine'}</h3>
      <p>Chaque compte Google a son propre planning et sa propre liste, enregistrés en ligne et retrouvables sur tous tes appareils.</p>
      <button class="auth-btn plan-login-btn" data-login>Se connecter avec Google</button>
    </div>`;
  }
  document.addEventListener('click', e => {
    if (e.target.closest('[data-login]')) ensureSignedIn();
  });

  function weekLabel() {
    return isCurrentWeek() ? 'Cette semaine' : `Semaine du ${fmtD(wk, { day: 'numeric', month: 'long' })}`;
  }

  // ═════════════ VUE « MA SEMAINE » ═════════════
  function renderWeek() {
    const box = document.getElementById('plan-week');
    const bar = document.getElementById('plan-weekbar-semaine');
    if (!box) return;
    if (!user) { box.innerHTML = loginCard('semaine'); bar.hidden = true; return; }
    bar.hidden = false;
    if (!loaded) { box.innerHTML = '<div class="plan-empty">Chargement de ton planning…</div>'; return; }

    const w = W();
    const end = new Date(wk); end.setDate(end.getDate() + 6);
    document.querySelectorAll('.plan-wlbl').forEach(el => el.textContent = weekLabel());
    document.querySelectorAll('.plan-wsub').forEach(el => el.textContent = `${fmtD(wk, { day: 'numeric', month: 'long' })} – ${fmtD(end, { day: 'numeric', month: 'long' })}`);
    const today = (new Date().getDay() + 6) % 7;
    const cur = isCurrentWeek();

    box.innerHTML = DAYS.map((d, i) => {
      const dt = new Date(wk); dt.setDate(dt.getDate() + i);
      const meals = MEALS.map(([m, l]) => {
        const k = `${i}-${m}`;
        const arr = w.plan[k] || [];
        // Plusieurs recettes par repas : on les range dans l'ordre du repas (apéro → entrée → plat → dessert…)
        const order = x => { const r = findRecipe(x.rid); const o = COURSE_ORDER.indexOf(r ? r.cat : ''); return o < 0 ? 99 : o; };
        const sorted = arr.map((x, j) => [x, j]).sort((a, b) => order(a[0]) - order(b[0]) || a[1] - b[1]);
        const showGroups = arr.length > 1;
        let lastCat = null;
        const items = sorted.map(([x, j]) => {
          const rr = findRecipe(x.rid);
          const c = rr ? rr.cat : '';
          const head = showGroups && c !== lastCat ? `<div class="plan-course">${esc(COURSE_LABEL[c] || catLabels[c] || 'Autre')}</div>` : '';
          lastCat = c;
          return head + itemHtml(x, j);
        }).join('');
        function itemHtml(x, j) {
          const r = findRecipe(x.rid);
          if (!r) return `<div class="plan-recipe plan-recipe--gone"><div class="plan-recipe-name">Recette supprimée</div><button class="plan-rm" data-rm="${k}" data-j="${j}" aria-label="Retirer">✕</button></div>`;
          const v = variantOf(r, x.v);
          return `<div class="plan-recipe">
            <img class="plan-thumb" src="${esc(r.photo || SITE_PHOTO)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${SITE_PHOTO}';">
            <div class="plan-recipe-name" data-open="${esc(x.rid)}" data-v="${x.v || 0}" data-p="${x.p}">${esc(r.titre)}${v.nom ? ` <em>(${esc(v.nom)})</em>` : ''}<small>${esc(catLabels[r.cat] || '')} · ⏱ ${esc(formatTemps(v.temps))}</small></div>
            <div class="plan-stepper"><button data-pp="${k}" data-j="${j}" data-d="-1" aria-label="Moins de personnes">−</button><b>${x.p}<span> pers.</span></b><button data-pp="${k}" data-j="${j}" data-d="1" aria-label="Plus de personnes">+</button></div>
            <button class="plan-rm" data-rm="${k}" data-j="${j}" aria-label="Retirer">✕</button>
          </div>`;
        }
        return `<div class="plan-meal"><div class="plan-meal-label">${l}${arr.length > 1 ? ` <span class="plan-meal-n">${arr.length} recettes</span>` : ''}</div>${items}
          <button class="plan-add-slot" data-slot="${k}">+ ${arr.length ? 'Ajouter un plat' : 'Ajouter des recettes'}</button></div>`;
      }).join('');
      return `<div class="plan-day${cur && i === today ? ' plan-day--today' : ''}">
        <div class="plan-day-head"><span>${d}</span><small>${fmtD(dt, { day: 'numeric', month: 'short' })}${cur && i === today ? ' · aujourd\'hui' : ''}</small></div>
        ${meals}</div>`;
    }).join('');
  }

  document.getElementById('plan-week').addEventListener('click', e => {
    const t = e.target.closest('button, [data-open]');
    if (!t || !user) return;
    const w = W();
    if (t.dataset.slot) return openSlotPicker(t.dataset.slot);
    if (t.dataset.open) {
      const r = findRecipe(t.dataset.open);
      if (!r) return;
      openModal(allRecettes.indexOf(r));
      if (+t.dataset.v) selectVariant(+t.dataset.v);
      currentServings = +t.dataset.p || currentServings;
      updateServingDisplay();
      return;
    }
    if (t.dataset.rm) {
      w.plan[t.dataset.rm].splice(+t.dataset.j, 1);
      if (!w.plan[t.dataset.rm].length) delete w.plan[t.dataset.rm];
      save(); renderAll(); return;
    }
    if (t.dataset.pp) {
      const x = w.plan[t.dataset.pp][+t.dataset.j];
      x.p = Math.max(1, Math.min(50, x.p + (+t.dataset.d)));
      save(); renderAll();
    }
  });

  function shiftWeek(n) { wk.setDate(wk.getDate() + 7 * n); renderAll(); }
  document.querySelectorAll('[data-wk]').forEach(b => b.addEventListener('click', () => shiftWeek(+b.dataset.wk)));
  document.getElementById('plan-clear').addEventListener('click', () => {
    if (!user) return;
    if (confirm('Retirer tous les repas de cette semaine ?')) { W().plan = {}; save(); renderAll(); }
  });
  document.getElementById('plan-to-courses').addEventListener('click', () => show('courses'));

  // ═════════════ LISTE DE COURSES ═════════════
  // Unités ramenées à une base commune pour pouvoir additionner
  function normUnit(valeur, unite) {
    const u = (unite || '').toLowerCase().trim();
    if (u === 'g') return [valeur, 'g'];
    if (u === 'kg') return [valeur * 1000, 'g'];
    if (u === 'mg') return [valeur / 1000, 'g'];
    if (u === 'ml') return [valeur / 1000, 'L'];
    if (u === 'cl') return [valeur / 100, 'L'];
    if (u === 'dl') return [valeur / 10, 'L'];
    if (u === 'l') return [valeur, 'L'];
    return [valeur, u];
  }
  function fmtTotal(q, u) {
    const num = n => {
      const r = Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : Math.round(n * 2) / 2;
      return String(r).replace('.', ',');
    };
    if (u === 'g') return q >= 1000 ? String(Math.round(q / 10) / 100).replace('.', ',') + ' kg' : Math.round(q) + ' g';
    if (u === 'L') return String(Math.round(q * 1000) / 1000).replace('.', ',') + ' L';
    if (!u) return num(q);
    // pluriel simple pour les petites unités (2 gousses, 3 pincées…)
    const plural = q > 1 && /^(gousse|pincée|sachet|feuille|tranche|dose|filet|verre)$/.test(u) ? u + 's' : u;
    return num(q) + ' ' + plural;
  }
  function cleanName(s) {
    return String(s).replace(/\(.*?\)/g, '').replace(/^\s*(de |d'|d’|des )/i, '').replace(/\s+/g, ' ').trim();
  }
  function keyOf(name) {
    return normalize(name).replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean)
      .map(w => (w.length > 3 && /[sx]$/.test(w) && !/(is|us|ss)$/.test(w)) ? w.slice(0, -1) : w).join(' ');
  }
  const SKIP = n => /^(eau|de l'eau)( |$)/i.test(normalize(n)) && !/gazeuse|petillante|de coco|de rose|de fleur/.test(normalize(n));

  function buildList() {
    const w = W();
    const map = new Map();
    Object.values(w.plan).flat().forEach(x => {
      const r = findRecipe(x.rid);
      if (!r) return;
      const v = variantOf(r, x.v);
      const f = x.p / basePers(v);
      v.ingredients.forEach(ing => {
        let name, q = null, u = '';
        if (typeof ing === 'string') name = cleanName(ing);
        else {
          name = cleanName(ing.reste || ing.texte);
          if (typeof ing.valeur === 'number' && !isNaN(ing.valeur)) [q, u] = normUnit(ing.valeur * f, ing.unite);
        }
        if (!name || SKIP(name)) return;
        const k = 'r:' + keyOf(name);
        if (!map.has(k)) map.set(k, { k, n: name, qs: {}, src: new Set(), ray: rayonOf(name) });
        const it = map.get(k);
        it.src.add(r.titre);
        if (q != null) it.qs[u] = (it.qs[u] || 0) + q;
      });
    });
    const items = [...map.values()].map(it => ({
      k: it.k, n: it.n, ray: it.ray, perso: false,
      qt: Object.entries(it.qs).map(([u, q]) => fmtTotal(q, u)).join(' + '),
      src: [...it.src].join(', ')
    }));
    w.extras.forEach(e => items.push({ k: 'x:' + e.id, n: e.t, ray: e.r, perso: true, qt: '', src: '' }));
    return items;
  }

  function renderCourses() {
    const box = document.getElementById('plan-courses');
    const bar = document.getElementById('plan-weekbar-courses');
    const tools = document.getElementById('courses-tools');
    if (!box) return;
    if (!user) { box.innerHTML = loginCard('courses'); bar.hidden = true; tools.hidden = true; updateBadges(0, 0); return; }
    bar.hidden = false; tools.hidden = false;
    if (!loaded) { box.innerHTML = '<div class="plan-empty">Chargement de ta liste…</div>'; return; }

    const w = W();
    const items = buildList();
    const done = items.filter(i => w.checked[i.k]).length;
    document.getElementById('courses-count').textContent = items.length ? `${done} / ${items.length} dans le panier` : '';
    document.getElementById('courses-bar').style.width = items.length ? (done / items.length * 100) + '%' : '0';

    if (!items.length) {
      box.innerHTML = `<div class="plan-empty"><strong>Ta liste est vide</strong>Ajoute des recettes à ta semaine, ou tes propres articles juste au-dessus.</div>`;
      updateBadges(); return;
    }
    box.innerHTML = RAYONS.map(([rk, em, lbl]) => {
      const its = items.filter(i => i.ray === rk)
        .sort((a, b) => (!!w.checked[a.k] - !!w.checked[b.k]) || a.n.localeCompare(b.n, 'fr'));
      if (!its.length) return '';
      const d = its.filter(i => w.checked[i.k]).length;
      return `<div class="shop-rayon"><div class="shop-rayon-head"><span class="shop-em">${em}</span><b>${lbl}</b><small>${d}/${its.length}</small></div>
        ${its.map(i => `<div class="shop-item${w.checked[i.k] ? ' done' : ''}" data-k="${esc(i.k)}" role="checkbox" aria-checked="${!!w.checked[i.k]}" tabindex="0">
          <span class="shop-box"></span>
          <div class="shop-txt"><div class="shop-name">${esc(cap(i.n))}${i.perso ? '<span class="shop-perso">perso</span>' : ''}</div>${i.src ? `<div class="shop-src">${esc(i.src)}</div>` : ''}</div>
          <span class="shop-qty">${esc(i.qt)}</span>
          ${i.perso ? `<button class="plan-rm" data-del="${esc(i.k)}" aria-label="Supprimer">✕</button>` : ''}
        </div>`).join('')}</div>`;
    }).join('');
    updateBadges();
  }

  function toggleItem(k) {
    const w = W();
    if (w.checked[k]) delete w.checked[k]; else w.checked[k] = true;
    if (navigator.vibrate) navigator.vibrate(8);
    save(); renderCourses();
  }
  const coursesBox = document.getElementById('plan-courses');
  coursesBox.addEventListener('click', e => {
    if (!user) return;
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const w = W(), id = del.dataset.del.slice(2);
      w.extras = w.extras.filter(x => x.id !== id);
      delete w.checked[del.dataset.del];
      save(); renderCourses(); return;
    }
    const it = e.target.closest('[data-k]');
    if (it) toggleItem(it.dataset.k);
  });
  coursesBox.addEventListener('keydown', e => {
    const it = e.target.closest('[data-k]');
    if (it && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); toggleItem(it.dataset.k); }
  });

  const addSel = document.getElementById('courses-add-rayon');
  const addInp = document.getElementById('courses-add-input');
  addSel.innerHTML = '<option value="auto">Rayon auto</option>' + RAYONS.map(([k, em, l]) => `<option value="${k}">${em} ${l}</option>`).join('');
  document.getElementById('courses-add-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!user) return;
    const t = addInp.value.trim();
    if (!t) return;
    W().extras.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t, r: addSel.value === 'auto' ? rayonOf(t) : addSel.value });
    addInp.value = ''; addSel.value = 'auto';
    save(); renderCourses(); addInp.focus();
  });
  document.getElementById('courses-uncheck').addEventListener('click', () => { if (!user) return; W().checked = {}; save(); renderCourses(); });
  document.getElementById('courses-clear-perso').addEventListener('click', () => {
    if (!user) return;
    const w = W();
    const n = w.extras.filter(x => w.checked['x:' + x.id]).length;
    if (!n) { toast('Aucun article perso coché'); return; }
    w.extras = w.extras.filter(x => { if (w.checked['x:' + x.id]) { delete w.checked['x:' + x.id]; return false; } return true; });
    save(); renderCourses(); toast(`${n} article${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''}`);
  });

  // Pastilles sur les onglets (repas prévus / articles restants)
  function updateBadges() {
    const bs = document.getElementById('badge-semaine'), bc = document.getElementById('badge-courses');
    if (!user || !loaded) { bs.hidden = true; bc.hidden = true; return; }
    const w = W();
    const n = Object.values(w.plan).reduce((s, a) => s + a.length, 0);
    bs.hidden = !n; bs.textContent = n;
    const items = buildList();
    const left = items.filter(i => !w.checked[i.k]).length;
    bc.hidden = !left; bc.textContent = left;
  }

  // ═════════════ FENÊTRES DE CHOIX ═════════════
  const ov = document.getElementById('plan-overlay');
  const sheet = document.getElementById('plan-sheet');
  function openSheet(html) { sheet.innerHTML = html; ov.classList.add('open'); document.body.style.overflow = 'hidden'; sheet.scrollTop = 0; }
  function closeSheet() {
    ov.classList.remove('open');
    // ne pas débloquer le défilement si la fiche recette est encore ouverte dessous
    if (!document.getElementById('modal-overlay').classList.contains('open')) document.body.style.overflow = '';
  }
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-close]')) closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open')) { e.stopImmediatePropagation(); closeSheet(); } }, true);

  // Depuis la fiche recette : choisir le(s) jour(s) et le nombre de personnes
  function openDayPicker(r, vIdx, pers) {
    const v = variantOf(r, vIdx);
    let p = pers || basePers(v);
    const sel = new Set();
    sel.add(`${isCurrentWeek() ? (new Date().getDay() + 6) % 7 : 0}-soir`);
    const draw = () => {
      openSheet(`
        <div class="plan-sheet-head"><div class="modal-cat">Ajouter à ma semaine</div>
          <div class="modal-title">${esc(r.titre)}${v.nom ? ` <em>(${esc(v.nom)})</em>` : ''}</div>
          <div class="plan-sheet-week"><button data-shift="-1" aria-label="Semaine précédente">‹</button><span>${weekLabel()}</span><button data-shift="1" aria-label="Semaine suivante">›</button></div>
          <button class="modal-close" data-close aria-label="Fermer">✕</button></div>
        <div class="plan-sheet-body">
          <div class="modal-section-title">Quand ? <span class="plan-hint">(plusieurs choix possibles)</span></div>
          <div class="slot-grid">
            <span></span>${DAYS.map(d => `<span class="slot-day">${d.slice(0, 3)}</span>`).join('')}
            ${MEALS.map(([m, l]) => `<span class="slot-meal">${l}</span>` + DAYS.map((d, i) => `<button class="slot-btn${sel.has(i + '-' + m) ? ' on' : ''}" data-s="${i}-${m}" aria-label="${d} ${l}">${sel.has(i + '-' + m) ? '✓' : ''}</button>`).join('')).join('')}
          </div>
          <div class="modal-section-title">Pour combien ?</div>
          <div class="plan-pers"><span><b>${p}</b> personne${p > 1 ? 's' : ''} <small>(recette prévue pour ${basePers(v)})</small></span>
            <div class="plan-stepper plan-stepper--lg"><button data-pm="-1" aria-label="Moins">−</button><b>${p}</b><button data-pm="1" aria-label="Plus">+</button></div></div>
          <button class="btn-primary plan-ok" data-ok ${sel.size ? '' : 'disabled'}>Ajouter${sel.size > 1 ? ` (${sel.size} repas)` : ''}</button>
        </div>`);
      sheet.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.s; sel.has(k) ? sel.delete(k) : sel.add(k); draw(); }));
      sheet.querySelectorAll('[data-pm]').forEach(b => b.addEventListener('click', () => { p = Math.max(1, Math.min(50, p + (+b.dataset.pm))); draw(); }));
      sheet.querySelectorAll('[data-shift]').forEach(b => b.addEventListener('click', () => { wk.setDate(wk.getDate() + 7 * (+b.dataset.shift)); draw(); }));
      sheet.querySelector('[data-ok]').addEventListener('click', () => {
        const w = W();
        sel.forEach(k => { (w.plan[k] = w.plan[k] || []).push({ rid: ridOf(r), v: vIdx || 0, p }); });
        save(); closeSheet(); renderAll();
        toast(isMine() ? 'Ajouté à ta semaine ✓' : `Ajouté au planning de ${activeOwnerName()} ✓`);
      });
    };
    draw();
  }

  document.getElementById('plan-add-btn').addEventListener('click', async () => {
    if (currentRecetteIdx === null) return;
    if (!user) { const ok = await ensureSignedIn(); if (!ok) return; }
    openDayPicker(allRecettes[currentRecetteIdx], currentVariantIdx, currentServings);
  });

  // Depuis « Ma semaine » : choisir une recette pour un repas
  function openSlotPicker(slot) {
    const [d, m] = slot.split('-');
    let q = '', cat = 'all';
    const picked = []; // recettes cochées, dans l'ordre
    openSheet(`
      <div class="plan-sheet-head"><div class="modal-cat">${DAYS[d]} · ${MEALS.find(x => x[0] === m)[1]}</div>
        <div class="modal-title">Choisir des recettes</div>
        <button class="modal-close" data-close aria-label="Fermer">✕</button></div>
      <div class="plan-sheet-body">
        <p class="plan-hint plan-hint--block">Coche autant de recettes que tu veux : entrée, plat, dessert, ou plein de petites bouchées pour un apéro dînatoire.</p>
        <div class="search-wrap plan-search"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input type="search" id="plan-pick-q" placeholder="Nom de la recette…" autocomplete="off"></div>
        <div class="plan-chips">${[['all', 'Toutes'], ...Object.entries(catLabels)].map(([k, l]) => `<button class="plan-chip${k === 'all' ? ' on' : ''}" data-c="${k}">${l}</button>`).join('')}</div>
        <div class="plan-pick-list" id="plan-pick-list"></div>
      </div>
      <div class="plan-pick-foot" id="plan-pick-foot" hidden>
        <div class="plan-pick-sel" id="plan-pick-sel"></div>
        <button class="btn-primary" id="plan-pick-ok">Ajouter</button>
      </div>`);
    const list = sheet.querySelector('#plan-pick-list');
    const foot = sheet.querySelector('#plan-pick-foot');
    const drawFoot = () => {
      foot.hidden = !picked.length;
      sheet.querySelector('#plan-pick-sel').innerHTML = picked.map(rid => {
        const r = findRecipe(rid);
        return `<button type="button" data-unpick="${esc(rid)}">${esc(r ? r.titre : '?')} <b>✕</b></button>`;
      }).join('');
      sheet.querySelector('#plan-pick-ok').textContent = picked.length > 1 ? `Ajouter les ${picked.length} recettes` : 'Ajouter la recette';
    };
    const draw = () => {
      const res = allRecettes.filter(r => (cat === 'all' || r.cat === cat) && (!q || normalize(r.titre).includes(normalize(q))))
        .sort((a, b) => a.titre.localeCompare(b.titre, 'fr'));
      const shown = res.slice(0, 80);
      list.innerHTML = shown.map(r => {
        const on = picked.includes(ridOf(r));
        return `<button class="plan-pick${on ? ' on' : ''}" data-rid="${esc(ridOf(r))}" aria-pressed="${on}">
          <img src="${esc(r.photo || SITE_PHOTO)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${SITE_PHOTO}';">
          <span>${esc(r.titre)}<small>${esc(catLabels[r.cat] || '')} · ⏱ ${esc(formatTemps(previewVariant(r).temps))} · ${esc(previewVariant(r).personnes)} pers.</small></span><b>${on ? '✓' : '+'}</b></button>`;
      }).join('')
        + (res.length > shown.length ? `<div class="plan-empty plan-empty--sm">${res.length - shown.length} autres recettes : affine ta recherche.</div>` : '')
        || '<div class="plan-empty">Aucune recette</div>';
    };
    sheet.querySelector('#plan-pick-q').addEventListener('input', e => { q = e.target.value.trim(); draw(); });
    sheet.querySelectorAll('.plan-chip').forEach(c => c.addEventListener('click', () => {
      cat = c.dataset.c; sheet.querySelectorAll('.plan-chip').forEach(x => x.classList.toggle('on', x === c)); draw();
    }));
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-rid]');
      if (!b) return;
      const rid = b.dataset.rid, i = picked.indexOf(rid);
      i < 0 ? picked.push(rid) : picked.splice(i, 1);
      draw(); drawFoot();
    });
    foot.addEventListener('click', e => {
      const u = e.target.closest('[data-unpick]');
      if (u) { picked.splice(picked.indexOf(u.dataset.unpick), 1); draw(); drawFoot(); return; }
      if (!e.target.closest('#plan-pick-ok') || !picked.length) return;
      const arr = (W().plan[slot] = W().plan[slot] || []);
      picked.forEach(rid => { const r = findRecipe(rid); if (r) arr.push({ rid, v: 0, p: basePers(previewVariant(r)) }); });
      save(); closeSheet(); renderAll();
      toast(picked.length > 1 ? `${picked.length} recettes ajoutées ✓` : 'Ajouté ✓');
    });
    draw();
  }

  // ── Petit message temporaire ──
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('plan-toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
  }

  function renderAll() { renderShareBars(); renderWeek(); renderCourses(); updateBadges(); }

  // ── Planning affiché (le mien ou un planning partagé) ──
  function openPlanning(uid) {
    if (unsub) { unsub(); unsub = null; }
    if (dirty.size) { clearTimeout(saveTimer); flush(); }
    activeUid = uid; loaded = false; state = { weeks: {} }; sharing = { sharedWith: [], ownerName: '' };
    try { localStorage.setItem('planning-actif', uid === user.uid ? '' : uid); } catch (e) { /* rien */ }
    setSync('Chargement…');
    unsub = window.CloudPlanning.subscribe(uid, data => {
      const remote = (data && data.weeks) || {};
      // Si on a des modifications pas encore envoyées, on garde notre version de ces semaines
      dirty.forEach(k => { if (state.weeks[k]) remote[k] = state.weeks[k]; });
      state = { weeks: remote };
      sharing = { sharedWith: (data && data.sharedWith) || [], ownerName: (data && data.ownerName) || '' };
      loaded = true;
      setSync(isMine() ? (sharing.sharedWith.length ? '✓ Synchronisé · partagé' : '✓ Synchronisé avec ton compte') : '✓ Synchronisé · planning de ' + activeOwnerName(), 'ok');
      renderAll();
    }, err => {
      console.error('[planning] lecture', err);
      if (!isMine() && err.code === 'permission-denied') { toast('Ce planning n\'est plus partagé avec toi'); openPlanning(user.uid); return; }
      loaded = true;
      setSync('⚠️ Lecture impossible : ' + (err.code === 'permission-denied' ? 'règles Firestore à mettre à jour' : (err.message || err)), 'err');
      renderAll();
    });
    renderAll();
  }

  // ── Barre de partage (au-dessus de la semaine et des courses) ──
  function renderShareBars() {
    document.querySelectorAll('.plan-sharebar').forEach(bar => {
      if (!user || !activeUid) { bar.hidden = true; return; }
      bar.hidden = false;
      const chips = sharedList.length
        ? `<div class="share-switch" role="tablist" aria-label="Planning affiché">
            <button type="button" data-plan="${esc(user.uid)}" class="${isMine() ? 'on' : ''}">Mon planning</button>
            ${sharedList.map(o => `<button type="button" data-plan="${esc(o.uid)}" class="${activeUid === o.uid ? 'on' : ''}">${esc(firstName(o.ownerName) || o.ownerEmail)}</button>`).join('')}
          </div>`
        : `<div class="share-info">${isMine() && sharing.sharedWith.length ? `👥 Partagé avec ${sharing.sharedWith.length === 1 ? esc(sharing.sharedWith[0]) : sharing.sharedWith.length + ' personnes'}` : 'Planning personnel'}</div>`;
      bar.innerHTML = chips + `<button type="button" class="share-btn" data-share>👥 ${isMine() ? 'Partager' : 'Partage'}</button>`;
    });
  }
  document.addEventListener('click', e => {
    const p = e.target.closest('.plan-sharebar [data-plan]');
    if (p && p.dataset.plan !== activeUid) { openPlanning(p.dataset.plan); return; }
    if (e.target.closest('.plan-sharebar [data-share]')) openShareSheet();
  });

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function openShareSheet() {
    if (!user) return;
    if (!isMine()) {
      const name = activeOwnerName();
      openSheet(`
        <div class="plan-sheet-head"><div class="modal-cat">Planning partagé</div>
          <div class="modal-title">Planning de ${esc(name)}</div>
          <button class="modal-close" data-close aria-label="Fermer">✕</button></div>
        <div class="plan-sheet-body">
          <p class="share-p">${esc(name)} a partagé sa semaine et sa liste de courses avec toi. Tout ce que vous ajoutez, retirez ou cochez s'affiche chez l'autre en direct.</p>
          <button class="btn-secondary share-leave" data-leave>Ne plus voir ce planning</button>
        </div>`);
      sheet.querySelector('[data-leave]').addEventListener('click', async () => {
        if (!confirm(`Ne plus voir le planning de ${name} ? Il faudra qu'il ou elle te réinvite pour le retrouver.`)) return;
        const uid = activeUid;
        try { await window.CloudPlanning.leave(uid, myEmail()); closeSheet(); openPlanning(user.uid); toast('Planning retiré'); }
        catch (e) { console.error(e); toast('Impossible pour le moment'); }
      });
      return;
    }
    const draw = (msg) => {
      const list = sharing.sharedWith;
      openSheet(`
        <div class="plan-sheet-head"><div class="modal-cat">Partager</div>
          <div class="modal-title">Ma semaine et mes courses</div>
          <button class="modal-close" data-close aria-label="Fermer">✕</button></div>
        <div class="plan-sheet-body">
          <p class="share-p">Ajoute l'adresse Gmail de la personne. Quand elle se connecte au site avec ce compte, elle voit ton planning et ta liste de courses et peut les modifier avec toi, en direct.</p>
          <form class="share-add" data-form>
            <input type="email" inputmode="email" autocomplete="email" placeholder="prenom@gmail.com" aria-label="Adresse Gmail" required>
            <button class="btn-primary" type="submit">Inviter</button>
          </form>
          ${msg ? `<div class="share-msg">${msg}</div>` : ''}
          <div class="modal-section-title">Partagé avec</div>
          ${list.length ? `<ul class="share-list">${list.map(m => `<li><span>${esc(m)}</span><button type="button" data-rm-mail="${esc(m)}" aria-label="Retirer ${esc(m)}">Retirer</button></li>`).join('')}</ul>`
            : '<div class="plan-empty plan-empty--sm">Personne pour l\'instant.</div>'}
          ${list.length ? `<button class="btn-secondary share-send" data-send>Envoyer le lien du site</button>` : ''}
        </div>`);
      const form = sheet.querySelector('[data-form]');
      const inp = form.querySelector('input');
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        const m = inp.value.trim().toLowerCase();
        if (!EMAIL_RE.test(m)) { draw('Adresse e-mail invalide.'); return; }
        if (m === myEmail()) { draw('C\'est ton adresse 🙂'); return; }
        if (list.includes(m)) { draw('Déjà invité·e.'); return; }
        await updateSharing([...list, m], draw, `✓ ${esc(m)} peut maintenant voir et modifier ton planning.`);
      });
      sheet.querySelectorAll('[data-rm-mail]').forEach(b => b.addEventListener('click', async () => {
        const m = b.dataset.rmMail;
        if (!confirm(`Arrêter le partage avec ${m} ?`)) return;
        await updateSharing(list.filter(x => x !== m), draw, `Partage arrêté avec ${esc(m)}.`);
      }));
      const send = sheet.querySelector('[data-send]');
      if (send) send.addEventListener('click', async () => {
        const url = location.origin + location.pathname;
        const text = `Je t'ai partagé mon planning des repas et ma liste de courses. Connecte-toi avec ton compte Google ici : ${url}`;
        try {
          if (navigator.share) await navigator.share({ title: 'Mon planning repas', text, url });
          else { await navigator.clipboard.writeText(text); toast('Message copié ✓'); }
        } catch (e) { /* partage annulé */ }
      });
      if (!msg) setTimeout(() => inp.focus(), 50);
    };
    draw();
  }
  async function updateSharing(emails, draw, okMsg) {
    try {
      await window.CloudPlanning.setSharing(user.uid, emails, user.displayName || '', myEmail());
      sharing.sharedWith = emails;
      renderShareBars();
      draw(okMsg);
    } catch (e) {
      console.error('[planning] partage', e);
      draw('⚠️ ' + (e.code === 'permission-denied' ? 'Règles Firestore à mettre à jour.' : esc(e.message || e)));
    }
  }

  // ── Branchement sur la connexion (cloud.js → app.js → ici) ──
  const prevAuth = window.onAuthStateChanged;
  window.onAuthStateChanged = function (u) {
    if (typeof prevAuth === 'function') prevAuth(u);
    if (unsub) { unsub(); unsub = null; }
    if (unsubShared) { unsubShared(); unsubShared = null; }
    user = u; loaded = false; state = { weeks: {} }; activeUid = null; sharedList = []; dirty.clear();
    if (u && window.CloudPlanning) {
      let saved = '';
      try { saved = localStorage.getItem('planning-actif') || ''; } catch (e) { /* rien */ }
      openPlanning(u.uid);
      if (u.email && window.CloudPlanning.subscribeShared) {
        let first = true;
        unsubShared = window.CloudPlanning.subscribeShared(u.email.toLowerCase(), list => {
          sharedList = list;
          // On revient sur le planning partagé qu'on regardait la dernière fois
          if (first && saved && list.some(x => x.uid === saved)) openPlanning(saved);
          else if (!isMine() && !list.some(x => x.uid === activeUid)) openPlanning(u.uid);
          first = false;
          renderAll();
        }, err => console.warn('[planning] plannings partagés', err.code || err));
      }
    }
    renderAll();
  };
  const prevLive = window.onLiveRecipesUpdate;
  window.onLiveRecipesUpdate = function (live) {
    if (typeof prevLive === 'function') prevLive(live);
    renderAll();
  };

  // Vue mémorisée
  let startView = 'recettes';
  try { startView = localStorage.getItem('recettes-vue') || 'recettes'; } catch (e) { /* rien */ }
  show(VIEWS.includes(startView) ? startView : 'recettes');
})();
