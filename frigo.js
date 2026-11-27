// ────────────────────────────────────────────────────────────────────────
// frigo.js — onglet « Frigo » : je note les aliments que j'ai, le site me
// propose des recettes une par une (oui / non) jusqu'à tout utiliser, puis
// les range dans « Ma semaine ». S'il reste des aliments qu'aucune recette du
// site n'utilise, l'IA (Firebase AI Logic, voir cloud.js) en invente une.
// Chargé après app.js et planning.js (utilise window.PlanningAPI).
// ────────────────────────────────────────────────────────────────────────
(function () {
  const root = document.getElementById('frigo-root');
  if (!root) return;
  const P = () => window.PlanningAPI;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Ingrédients de placard : jamais comptés comme « à acheter »
  const PLACARD = ['sel', 'fleur de sel', 'gros sel', 'poivre', 'eau', 'huile', 'huile d olive', 'huile neutre', 'vinaigre', 'sucre', 'farine',
    'levure chimique', 'paprika', 'cumin', 'curry', 'curcuma', 'cannelle', 'muscade', 'herbes de provence', 'thym', 'laurier', 'origan', 'moutarde',
    'bicarbonate', 'vanille', 'extrait de vanille', 'sucre vanille', 'piment', 'glacons', 'sucre glace', 'maizena', 'fecule'];
  const SKIP_CATS = ['maison', 'base-culinaire', 'sauce'];

  // ── Comparaison de textes : minuscules, sans accents, mots au singulier ──
  const stem = w => w.length > 3 && /eaux$/.test(w) ? w.slice(0, -1) : (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w);
  const toWords = s => normalize(String(s)).replace(/œ/g, 'oe').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map(stem);
  const key = s => ' ' + toWords(s).join(' ') + ' ';
  const PLACARD_K = PLACARD.map(key);
  const ingText = i => typeof i === 'string' ? i : (i.reste || i.texte || '');
  const isPlacard = t => { const k = key(t); return PLACARD_K.some(p => k.startsWith(p) || k === p); };

  // ── État de la séance ──
  let remaining = [];   // aliments pas encore (assez) utilisés par les recettes retenues
  let left = {};        // stock restant pendant la séance : clé d'aliment → { n, d } (quantité comparable)
  let rejected = new Set();
  let accepted = [];    // { rid, v, p, cat, titre, uses: [] }
  let current = null;   // proposition affichée { kind: 'site'|'ia', … }
  let iaTried = [];     // titres déjà proposés par l'IA
  let busy = false;
  let editing = null;   // aliment en cours de modification
  let started = false;

  // Un aliment du frigo : { nom, qte, unite } (les anciens étaient de simples textes)
  const asItem = x => typeof x === 'string' ? { nom: x, qte: null, unite: null } : { nom: x.nom, qte: x.qte ?? null, unite: x.unite || null };
  const frigoItems = () => ((P() && P().frigo) || []).map(asItem);
  const frigo = () => frigoItems().map(i => i.nom); // noms seuls

  // ── Quantités comparables : grammes, millilitres, pièces ──
  const UNITS = ['g', 'kg', 'ml', 'cl', 'L', 'pièce(s)', 'c. à soupe', 'c. à café', 'sachet', 'pot', 'boîte', 'brique', 'tranche', 'botte', 'gousse'];
  function base(q, u) {
    if (q == null || isNaN(q)) return null;
    const lu = String(u || '').toLowerCase().trim();
    if (lu === 'g') return { n: q, d: 'g' };
    if (lu === 'kg') return { n: q * 1000, d: 'g' };
    if (lu === 'mg') return { n: q / 1000, d: 'g' };
    if (lu === 'ml') return { n: q, d: 'ml' };
    if (lu === 'cl') return { n: q * 10, d: 'ml' };
    if (lu === 'dl') return { n: q * 100, d: 'ml' };
    if (lu === 'l' || lu === 'litre' || lu === 'litres') return { n: q * 1000, d: 'ml' };
    if (!lu || /^pi[eè]ce/.test(lu)) return { n: q, d: 'pc' };
    return { n: q, d: lu.replace(/s$/, '') };
  }
  const fmtBase = b => b.d === 'g' ? (b.n >= 1000 ? `${+(b.n / 1000).toFixed(2)} kg` : `${Math.round(b.n)} g`)
    : b.d === 'ml' ? (b.n >= 1000 ? `${+(b.n / 1000).toFixed(2)} L` : `${Math.round(b.n)} ml`)
    : b.d === 'pc' ? `${+b.n.toFixed(1)}` : `${+b.n.toFixed(1)} ${b.d}`;
  const qtyLabel = i => i.qte != null ? (base(i.qte, i.unite) ? fmtBase(base(i.qte, i.unite)) : `${i.qte} ${i.unite || ''}`.trim()) : '';

  // ── Liste des ingrédients connus (tirée de toutes les recettes) pour l'autocomplétion ──
  let knownCache = null;
  function cleanName(t) {
    return String(t).replace(/\(.*?\)/g, '').replace(/^\s*(de |d'|d’|du |des )/i, '').split(/,| pour | ou | bien | coupé| râpé| en dés| émincé/i)[0].trim().replace(/\s+/g, ' ');
  }
  function known() {
    if (knownCache) return knownCache;
    const m = new Map();
    allRecettes.forEach(r => getVariants(r).forEach(v => (v.ingredients || []).forEach(i => {
      const t = cleanName(ingText(i)); if (!t || t.length < 2 || t.length > 40) return;
      const k = key(t); const b = typeof i === 'object' ? base(i.valeur, i.unite) : null;
      const e = m.get(k) || { nom: t.charAt(0).toUpperCase() + t.slice(1), n: 0, units: {} };
      e.n++; if (b) e.units[b.d] = (e.units[b.d] || 0) + 1; m.set(k, e);
    })));
    knownCache = [...m.values()].filter(e => e.n >= 2 || !isPlacard(e.nom)).sort((a, b) => b.n - a.n);
    return knownCache;
  }
  function defaultUnit(nom) {
    const e = known().find(x => key(x.nom) === key(nom)); if (!e) return '';
    const d = Object.entries(e.units).sort((a, b) => b[1] - a[1])[0];
    return !d ? '' : d[0] === 'g' ? 'g' : d[0] === 'ml' ? 'ml' : d[0] === 'pc' ? 'pièce(s)' : (UNITS.find(u => u.startsWith(d[0])) || '');
  }

  // Quels aliments du frigo une version de recette utilise, et ce qu'il faudrait acheter
  // Quels aliments du frigo une recette utilise (avec les quantités), et ce qu'il faudrait acheter
  function analyse(v, items) {
    const ingObjs = (v.ingredients || []).filter(i => ingText(i));
    const ings = ingObjs.map(ingText);
    const ingK = ings.map(key);
    const uses = [], detail = {};
    items.forEach(a => {
      const k = key(a); if (!k.trim()) return;
      const idx = ingK.findIndex(t => t.includes(k)); if (idx < 0) return;
      uses.push(a);
      const io = ingObjs[idx];
      const need = typeof io === 'object' && io.unite !== undefined ? base(io.valeur, io.unite) : null;
      const have = left[key(a)];
      detail[a] = { need, have, short: !!(need && have && need.d === have.d && need.n > have.n * 1.05) };
    });
    const all = frigo();
    const missing = ings.filter((t, i) => !isPlacard(t) && !all.some(a => { const k = key(a); return k.trim() && ingK[i].includes(k); }));
    return { uses, missing, detail };
  }

  function bestSiteRecipe() {
    const api = P();
    let best = null;
    allRecettes.forEach(r => {
      if (SKIP_CATS.includes(r.cat)) return;
      const rid = api.ridOf(r);
      if (rejected.has(rid) || accepted.some(a => a.rid === rid)) return;
      getVariants(r).forEach((v, vi) => {
        const { uses, missing, detail } = analyse(v, remaining);
        if (!uses.length) return;
        const shorts = uses.filter(a => detail[a].short).length;
        const score = uses.length * 10 - shorts * 4 - Math.min(missing.length, 10) * 1.6 + (r.cat === 'plat' ? 4 : 0);
        if (!best || score > best.score) best = { kind: 'site', r, rid, vi, v, uses, missing, detail, score };
      });
    });
    return best;
  }

  function next() { current = remaining.length ? bestSiteRecipe() : null; render(); }

  // ── Actions ──
  // Ajoute (ou met à jour) un aliment ; « 500 g de courgettes » est compris tel quel
  function addItem(nom, qte, unite) {
    nom = String(nom || '').trim(); if (!nom) return;
    if (qte == null || qte === '') {
      const p = parseIngredientLine(nom);
      if (/^\d/.test(nom) && p.reste) { nom = p.reste; qte = p.valeur; unite = p.unite || ''; }
    }
    nom = cleanName(nom) || nom;
    const kn = known().find(x => key(x.nom) === key(nom));
    if (kn) nom = kn.nom; // même nom que dans les recettes
    nom = nom.charAt(0).toUpperCase() + nom.slice(1);
    const q = qte === '' || qte == null ? null : parseFloat(String(qte).replace(',', '.'));
    const list = frigoItems().filter(i => key(i.nom) !== key(nom));
    list.push({ nom, qte: isNaN(q) ? null : q, unite: q != null && !isNaN(q) ? (unite || null) : null });
    P().saveFrigo(list);
    if (started) { const it = list[list.length - 1]; left[key(nom)] = base(it.qte, it.unite); if (!remaining.includes(nom)) remaining.push(nom); if (!current) next(); }
  }
  function removeItem(a) {
    P().saveFrigo(frigoItems().filter(x => x.nom !== a));
    remaining = remaining.filter(x => x !== a);
    render();
  }
  function start() {
    started = true; rejected = new Set(); accepted = []; iaTried = [];
    remaining = frigo().slice();
    left = {}; frigoItems().forEach(i => { left[key(i.nom)] = base(i.qte, i.unite); });
    next();
    root.querySelector('.frigo-prop') && root.querySelector('.frigo-prop').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function yes() {
    if (!current) return;
    const c = current;
    accepted.push({ rid: c.rid, v: c.vi || 0, p: P().basePers(c.v), cat: c.r.cat, titre: c.r.titre, uses: c.uses });
    consume(c);
    P().toast('Retenue ✓');
    next();
  }
  // Retire du stock ce que la recette utilise ; s'il reste plus d'un quart, l'aliment reste à utiliser
  function consume(c) {
    const orig = {}; frigoItems().forEach(i => { orig[key(i.nom)] = base(i.qte, i.unite); });
    c.uses.forEach(a => {
      const k = key(a), d = c.detail && c.detail[a], have = left[k];
      if (d && d.need && have && d.need.d === have.d) {
        have.n = Math.max(0, have.n - d.need.n);
        const o = orig[k];
        if (!(o && have.n > o.n * 0.25)) remaining = remaining.filter(x => x !== a);
      } else remaining = remaining.filter(x => x !== a);
    });
  }
  function no() {
    if (!current) return;
    if (current.kind === 'site') { rejected.add(current.rid); next(); }
    else { current = null; invent(); }
  }

  async function invent() {
    if (busy) return;
    const items = remaining.length ? remaining : frigo();
    const withQty = items.map(a => { const b = left[key(a)]; return b ? `${a} (${fmtBase(b)})` : a; });
    if (!window.CloudAI || !window.CloudAI.available) { askClaude(withQty); return; }
    busy = true; current = { kind: 'ia-wait' }; render();
    try {
      const d = await window.CloudAI.inventRecipe(withQty, iaTried);
      iaTried.push(d.titre);
      const v = {
        temps: d.temps, personnes: String(d.personnes || 4),
        ingredients: (d.ingredients || []).map(parseIngredientLine), etapes: d.etapes || [], mc: d.mc || []
      };
      const { uses, missing, detail } = analyse(v, items);
      current = { kind: 'ia', data: d, r: { titre: d.titre, cat: d.cat, photo: SITE_PHOTO }, v, vi: 0, uses, missing, detail };
    } catch (e) {
      console.error('[frigo] IA', e);
      current = { kind: 'ia-err', msg: e && (e.code || e.message) || String(e) };
    }
    busy = false; render();
  }
  // Gratuit : ouvre une conversation Claude avec les aliments restants déjà écrits
  function askClaude(items) {
    const prompt = `Invente-moi une recette avec ces aliments de mon frigo : ${items.join(', ')}. ` +
      `Tu peux ajouter d'autres ingrédients si besoin. Respecte mes consignes habituelles (étapes non numérotées, temps en heures, ` +
      `ingrédients en g ou en litres, rien d'oublié) et donne aussi la version Monsieur Cuisine. ` +
      `Si elle me plaît, je te demanderai de l'ajouter à mon site de recettes.`;
    const url = 'https://claude.ai/new?q=' + encodeURIComponent(prompt);
    const w = window.open(url, '_blank', 'noopener');
    if (!w) { try { navigator.clipboard.writeText(prompt); P().toast('Demande copiée : colle-la dans Claude'); } catch (e) { location.href = url; } }
  }

  async function yesIA() {
    const c = current; if (!c || busy) return;
    busy = true; render();
    try {
      const d = c.data;
      const id = await window.CloudRecipes.addRecipe({
        titre: d.titre, cat: d.cat, temps: c.v.temps, personnes: c.v.personnes, photo: SITE_PHOTO,
        ingredients: c.v.ingredients, etapes: c.v.etapes, mc: c.v.mc, inventeeParIA: true
      });
      accepted.push({ rid: 'live:' + id, v: 0, p: P().basePers(c.v), cat: d.cat, titre: d.titre, uses: c.uses });
      consume(c);
      P().toast('Recette ajoutée au site ✓');
      busy = false; next();
    } catch (e) {
      console.error('[frigo] enregistrement recette IA', e);
      busy = false; P().toast('Impossible d\'enregistrer la recette'); render();
    }
  }
  function plan() {
    const res = P().addMeals(accepted);
    if (!res.placed) { P().toast('Plus de repas libres cette semaine'); return; }
    P().toast(`${res.placed} recette${res.placed > 1 ? 's' : ''} ajoutée${res.placed > 1 ? 's' : ''} à ta semaine ✓`);
    accepted = []; started = false; current = null;
    P().show('semaine');
  }

  // ── Affichage ──
  function card(c) {
    const r = c.r, v = c.v;
    const ia = c.kind === 'ia';
    return `<div class="frigo-card${ia ? ' frigo-card--ia' : ''}">
      <div class="frigo-card-photo">${window.RecipeVisual ? RecipeVisual.plateHtml(r, 'frigo-plate') : ''}
        ${ia ? '<span class="frigo-ia-badge">✨ Recette inventée</span>' : ''}</div>
      <div class="frigo-card-body">
        <div class="card-cat">${esc(catLabels[r.cat] || '')}${v.nom ? ' · ' + esc(v.nom) : ''}</div>
        <h3 class="frigo-card-title">${esc(r.titre)}</h3>
        <div class="frigo-meta">⏱ ${esc(formatTemps(v.temps))} · 👥 ${esc(v.personnes)} pers.</div>
        <div class="frigo-lbl">Avec ce que tu as</div>
        <div class="frigo-chips">${c.uses.map(a => {
          const d = c.detail && c.detail[a];
          const q = d && d.need ? (d.have && d.have.d === d.need.d ? ` · ${fmtBase(d.need)} sur ${fmtBase(d.have)}` : ` · ${fmtBase(d.need)}`) : '';
          return d && d.short ? `<span class="fchip fchip--short">⚠ ${esc(a)} · il faut ${fmtBase(d.need)}, tu as ${fmtBase(d.have)}</span>`
            : `<span class="fchip fchip--ok">✓ ${esc(a)}${esc(q)}</span>`;
        }).join('')}</div>
        ${c.missing.length ? `<div class="frigo-lbl">À acheter en plus</div>
          <div class="frigo-chips">${c.missing.slice(0, 12).map(t => `<span class="fchip fchip--buy">${esc(t)}</span>`).join('')}${c.missing.length > 12 ? `<span class="fchip">+${c.missing.length - 12}</span>` : ''}</div>`
          : '<div class="frigo-lbl frigo-lbl--ok">Rien à acheter (hors placard) 🎉</div>'}
        ${ia ? `<details class="frigo-details"><summary>Voir la recette</summary>
            <ul>${v.ingredients.map(i => `<li>${esc(i.texte || i)}</li>`).join('')}</ul>
            <ul class="frigo-steps">${v.etapes.map(e => `<li>${esc(e)}</li>`).join('')}</ul></details>`
          : `<button class="frigo-link" data-see="${esc(c.rid)}" data-v="${c.vi || 0}">Voir la recette</button>`}
        <div class="frigo-actions">
          <button class="btn-secondary" data-no ${busy ? 'disabled' : ''}>👎 Non, une autre</button>
          <button class="btn-primary" data-${ia ? 'yesia' : 'yes'} ${busy ? 'disabled' : ''}>👍 Oui</button>
        </div>
      </div>
    </div>`;
  }

  function proposalHtml() {
    if (!started) return '';
    if (!current) {
      if (!remaining.length) return `<div class="frigo-done">🎉 Tous tes aliments sont utilisés !</div>`;
      return `<div class="frigo-empty">
        <p>Plus aucune recette du site n'utilise : <b>${remaining.map(esc).join(', ')}</b>.</p>
        <button class="btn-primary" data-invent>✨ ${window.CloudAI && window.CloudAI.available ? 'Inventer une recette' : 'Demander une recette à Claude'} avec ${remaining.length > 1 ? 'ces aliments' : 'cet aliment'}</button>
        ${window.CloudAI && window.CloudAI.available ? '' : '<p class="frigo-small" style="margin-top:.8rem">Ça ouvre Claude avec tes aliments déjà écrits. Si la recette te plaît, demande-lui de l\'ajouter au site.</p>'}</div>`;
    }
    if (current.kind === 'ia-wait') return `<div class="frigo-empty"><div class="frigo-spin"></div><p>Je cuisine une idée avec ${esc(remaining.join(', '))}…</p></div>`;
    if (current.kind === 'ia-off') return `<div class="frigo-empty"><p><b>L'invention de recettes n'est pas encore activée.</b></p>
      <p class="frigo-small">Il faut activer Firebase AI Logic et App Check dans la console Firebase, puis renseigner la clé dans <code>firebase-config.js</code>. En attendant, tu peux me demander une recette avec ces aliments dans la conversation.</p></div>`;
    if (current.kind === 'ia-err') return `<div class="frigo-empty"><p>Oups, l'IA n'a pas répondu (${esc(current.msg)}).</p><button class="btn-primary" data-invent>Réessayer</button></div>`;
    return card(current);
  }

  function render() {
    const api = P();
    if (!api) return;
    if (!api.user) {
      root.innerHTML = `<div class="plan-login"><div class="plan-login-ic">🧊</div><h3>Connecte-toi pour remplir ton frigo</h3>
        <p>Note les aliments que tu as, je te propose des recettes pour la semaine qui les utilisent.</p>
        <button class="auth-btn plan-login-btn" data-flogin>Se connecter avec Google</button></div>`;
      return;
    }
    // On garde ce qui est en cours de saisie quand la page se redessine
    const keep = {};
    ['frigo-input', 'frigo-qte', 'frigo-unite'].forEach(id => { const el = root.querySelector('#' + id); if (el) keep[id] = el.value; });
    const focusId = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : null;
    const fitems = frigoItems();
    const items = fitems.map(i => i.nom);
    const usedK = new Set(accepted.flatMap(a => a.uses.map(key)));
    root.innerHTML = `
      <div class="frigo-head">
        <img class="frigo-deco" src="deco/oeuf.webp" alt="" aria-hidden="true">
        <h2>Mon frigo</h2>
        <p>Note ce que tu as, je te propose des recettes une par une jusqu'à tout utiliser.${api.isMine() ? '' : ` <em>(frigo partagé de ${esc(api.ownerName())})</em>`}</p>
        <form class="frigo-add frigo-add--qty" data-form>
          <input id="frigo-input" list="frigo-known" placeholder="Aliment (ex : courgettes)" autocomplete="off" enterkeyhint="next" aria-label="Aliment">
          <input id="frigo-qte" type="number" inputmode="decimal" min="0" step="any" placeholder="Qté" aria-label="Quantité">
          <select id="frigo-unite" aria-label="Unité"><option value="">unité</option>${UNITS.map(u => `<option>${u}</option>`).join('')}</select>
          <button class="btn-primary" type="submit">${editing ? 'Modifier' : 'Ajouter'}</button>
          <datalist id="frigo-known">${known().slice(0, 600).map(e => `<option value="${esc(e.nom)}">`).join('')}</datalist>
        </form>
        <p class="frigo-small frigo-tip">Les noms proposés sont ceux des ingrédients de tes recettes. Touche un aliment pour changer sa quantité.</p>
        <div class="frigo-list">
          ${fitems.length ? fitems.map(i => `<div class="frigo-item${usedK.has(key(i.nom)) ? ' frigo-item--used' : ''}${editing === i.nom ? ' frigo-item--edit' : ''}">
              <button class="frigo-item-main" data-edit="${esc(i.nom)}"><span>${esc(i.nom)}</span><b>${esc(qtyLabel(i)) || '<i>quantité ?</i>'}</b></button>
              <button class="frigo-item-rm" data-rm="${esc(i.nom)}" aria-label="Retirer ${esc(i.nom)}">✕</button></div>`).join('')
            : '<span class="frigo-small">Ton frigo est vide pour l\'instant.</span>'}
        </div>
        ${items.length ? `<div class="frigo-headbtns">
          <button class="btn-primary frigo-go" data-start>${started ? '↻ Recommencer' : '✨ Me proposer des recettes'}</button>
          <button class="btn-secondary" data-clear>Vider le frigo</button></div>` : ''}
      </div>
      ${started && remaining.length && current && current.kind === 'site' ? `<div class="frigo-left">Encore à utiliser : ${remaining.map(a => `<b>${esc(a)}${left[key(a)] ? ' (' + esc(fmtBase(left[key(a)])) + ')' : ''}</b>`).join(', ')}</div>` : ''}
      <div class="frigo-prop">${proposalHtml()}</div>
      ${accepted.length ? `<div class="frigo-kept">
        <h3>Tes recettes retenues <span>${accepted.length}</span></h3>
        <ul>${accepted.map((a, i) => `<li><span>${esc(a.titre)}<small>${esc(catLabels[a.cat] || '')} · ${a.uses.map(esc).join(', ')}</small></span><button data-unkeep="${i}" aria-label="Retirer">✕</button></li>`).join('')}</ul>
        <button class="btn-primary frigo-plan" data-plan>🗓️ Ajouter à ma semaine</button>
        <p class="frigo-small">Chaque plat va sur un soir libre (puis un midi) à partir d'aujourd'hui ; entrées et desserts rejoignent un plat. Tu pourras tout déplacer ensuite.</p>
      </div>` : ''}`;
    Object.entries(keep).forEach(([id, v]) => { const el = root.querySelector('#' + id); if (el) el.value = v; });
    if (focusId) { const el = root.querySelector('#' + focusId); if (el) el.focus(); }
  }

  root.addEventListener('submit', e => {
    if (!e.target.matches('[data-form]')) return;
    e.preventDefault();
    const inp = root.querySelector('#frigo-input'), q = root.querySelector('#frigo-qte'), u = root.querySelector('#frigo-unite');
    const val = inp.value.trim(), qv = q.value, uv = u.value;
    inp.value = ''; q.value = ''; u.value = '';
    if (!val) return;
    if (editing && key(editing) !== key(val)) P().saveFrigo(frigoItems().filter(x => x.nom !== editing)); // renommé
    editing = null;
    // Plusieurs aliments séparés par des virgules (sans quantité)
    if (/[,;]/.test(val) && !qv) val.split(/[,;]+/).forEach(t => addItem(t)); else addItem(val, qv, uv);
    render();
    setTimeout(() => { const i = root.querySelector('#frigo-input'); i && i.focus(); }, 0);
  });
  // Quand on choisit un aliment connu, on propose son unité habituelle
  root.addEventListener('change', e => {
    if (e.target.id !== 'frigo-input') return;
    const u = root.querySelector('#frigo-unite');
    if (u && !u.value) { const d = defaultUnit(e.target.value); if (d) u.value = d; }
  });
  root.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-flogin')) return ensureSignedIn();
    if (t.dataset.rm) return removeItem(t.dataset.rm);
    if (t.dataset.edit) {
      const it = frigoItems().find(x => x.nom === t.dataset.edit); if (!it) return;
      editing = it.nom; render();
      root.querySelector('#frigo-input').value = it.nom;
      root.querySelector('#frigo-qte').value = it.qte ?? '';
      const u = root.querySelector('#frigo-unite'); u.value = it.unite && UNITS.includes(it.unite) ? it.unite : (it.unite ? '' : defaultUnit(it.nom));
      root.querySelector('#frigo-qte').focus();
      return;
    }
    if (t.hasAttribute('data-start')) return start();
    if (t.hasAttribute('data-clear')) { if (confirm('Vider tout le frigo ?')) { P().saveFrigo([]); started = false; current = null; accepted = []; render(); } return; }
    if (t.hasAttribute('data-yes')) return yes();
    if (t.hasAttribute('data-yesia')) return yesIA();
    if (t.hasAttribute('data-no')) return no();
    if (t.hasAttribute('data-invent')) return invent();
    if (t.hasAttribute('data-plan')) return plan();
    if (t.dataset.unkeep) {
      const a = accepted.splice(+t.dataset.unkeep, 1)[0];
      a.uses.forEach(u => { if (!remaining.includes(u)) remaining.push(u); });
      if (!current) next(); else render();
      return;
    }
    if (t.dataset.see) {
      const r = P().findRecipe(t.dataset.see);
      if (!r) return;
      openModal(allRecettes.indexOf(r));
      if (+t.dataset.v) selectVariant(+t.dataset.v);
    }
  });

  window.renderFrigo = render;

  // ── Repas mangé (onglet « Ma semaine ») : on retire du frigo ce que la recette a utilisé ──
  // v = version de la recette, factor = personnes prévues / personnes de la recette.
  // Renvoie ce qui a été retiré, pour pouvoir le remettre si on décoche « mangé ».
  function consumeMeal(v, factor) {
    const items = frigoItems(); if (!items.length) return [];
    const ings = (v.ingredients || []).filter(i => ingText(i));
    const record = [];
    const kept = [];
    items.forEach(it => {
      const k = key(it.nom);
      const ing = k.trim() ? ings.find(i => key(ingText(i)).includes(k)) : null;
      if (!ing) { kept.push(it); return; }
      const need = typeof ing === 'object' && ing.valeur != null ? base(ing.valeur * factor, ing.unite) : null;
      const have = base(it.qte, it.unite);
      if (need && have && need.d === have.d) {
        const unit = base(1, it.unite).n || 1;
        const usedQ = Math.min(it.qte, need.n / unit);
        const rest = +(it.qte - usedQ).toFixed(3);
        if (rest > it.qte * 0.03 && rest > 0) { kept.push({ ...it, qte: rest }); record.push({ nom: it.nom, unite: it.unite, used: usedQ, removed: false }); }
        else record.push({ nom: it.nom, unite: it.unite, used: it.qte, removed: true });
      } else if (it.qte == null && isPlacard(it.nom)) {
        kept.push(it); // sel, huile… sans quantité : on les garde
      } else {
        record.push({ nom: it.nom, unite: it.unite, used: it.qte, removed: true }); // pas comparable : l'aliment est utilisé
      }
    });
    if (record.length) { P().saveFrigo(kept); render(); }
    return record;
  }
  function restoreMeal(record) {
    if (!record || !record.length) return;
    const items = frigoItems();
    record.forEach(r => {
      const it = items.find(i => key(i.nom) === key(r.nom));
      if (it) { if (it.qte != null && r.used != null && (it.unite || '') === (r.unite || '')) it.qte = +(it.qte + r.used).toFixed(3); }
      else items.push({ nom: r.nom, qte: r.used ?? null, unite: r.used != null ? r.unite : null });
    });
    P().saveFrigo(items); render();
  }
  const labelOf = r => r.nom + (r.used != null ? ' (' + (base(r.used, r.unite) ? fmtBase(base(r.used, r.unite)) : r.used + ' ' + (r.unite || '')) + ')' : '');
  window.FrigoAPI = { consumeMeal, restoreMeal, labelOf };
})();
