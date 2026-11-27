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
  let remaining = [];   // aliments pas encore utilisés par une recette retenue
  let rejected = new Set();
  let accepted = [];    // { rid, v, p, cat, titre, uses: [] }
  let current = null;   // proposition affichée { kind: 'site'|'ia', … }
  let iaTried = [];     // titres déjà proposés par l'IA
  let busy = false;
  let started = false;

  const frigo = () => (P() && P().frigo) || [];

  // Quels aliments du frigo une version de recette utilise, et ce qu'il faudrait acheter
  function analyse(v, items) {
    const ings = (v.ingredients || []).map(ingText).filter(Boolean);
    const ingK = ings.map(key);
    const uses = items.filter(a => { const k = key(a); return k.trim() && ingK.some(t => t.includes(k)); });
    const all = frigo();
    const missing = ings.filter((t, i) => !isPlacard(t) && !all.some(a => { const k = key(a); return k.trim() && ingK[i].includes(k); }));
    return { uses, missing };
  }

  function bestSiteRecipe() {
    const api = P();
    let best = null;
    allRecettes.forEach(r => {
      if (SKIP_CATS.includes(r.cat)) return;
      const rid = api.ridOf(r);
      if (rejected.has(rid) || accepted.some(a => a.rid === rid)) return;
      getVariants(r).forEach((v, vi) => {
        const { uses, missing } = analyse(v, remaining);
        if (!uses.length) return;
        const score = uses.length * 10 - Math.min(missing.length, 10) * 1.6 + (r.cat === 'plat' ? 1 : 0);
        if (!best || score > best.score) best = { kind: 'site', r, rid, vi, v, uses, missing, score };
      });
    });
    return best;
  }

  function next() { current = remaining.length ? bestSiteRecipe() : null; render(); }

  // ── Actions ──
  function addItems(txt) {
    const list = frigo().slice();
    txt.split(/[,;\n]+/).map(t => t.trim()).filter(Boolean).forEach(t => {
      if (!list.some(x => key(x) === key(t))) list.push(t.charAt(0).toUpperCase() + t.slice(1));
    });
    P().saveFrigo(list);
    if (started) { remaining = list.filter(a => !accepted.some(x => x.uses.some(u => key(u) === key(a)))); if (!current) next(); }
    render();
  }
  function removeItem(a) {
    P().saveFrigo(frigo().filter(x => x !== a));
    remaining = remaining.filter(x => x !== a);
    render();
  }
  function start() {
    started = true; rejected = new Set(); accepted = []; iaTried = [];
    remaining = frigo().slice();
    next();
    root.querySelector('.frigo-prop') && root.querySelector('.frigo-prop').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function yes() {
    if (!current) return;
    const c = current;
    accepted.push({ rid: c.rid, v: c.vi || 0, p: P().basePers(c.v), cat: c.r.cat, titre: c.r.titre, uses: c.uses });
    remaining = remaining.filter(a => !c.uses.includes(a));
    P().toast('Retenue ✓');
    next();
  }
  function no() {
    if (!current) return;
    if (current.kind === 'site') { rejected.add(current.rid); next(); }
    else { current = null; invent(); }
  }

  async function invent() {
    if (busy) return;
    const items = remaining.length ? remaining : frigo();
    if (!window.CloudAI || !window.CloudAI.available) { askClaude(items); return; }
    busy = true; current = { kind: 'ia-wait' }; render();
    try {
      const d = await window.CloudAI.inventRecipe(items, iaTried);
      iaTried.push(d.titre);
      const v = {
        temps: d.temps, personnes: String(d.personnes || 4),
        ingredients: (d.ingredients || []).map(parseIngredientLine), etapes: d.etapes || [], mc: d.mc || []
      };
      const { uses, missing } = analyse(v, items);
      current = { kind: 'ia', data: d, r: { titre: d.titre, cat: d.cat, photo: SITE_PHOTO }, v, vi: 0, uses, missing };
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
      remaining = remaining.filter(a => !c.uses.includes(a));
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
      <div class="frigo-card-photo"><img src="${esc(r.photo || SITE_PHOTO)}" alt="" onerror="this.onerror=null;this.src='${SITE_PHOTO}';">
        ${ia ? '<span class="frigo-ia-badge">✨ Recette inventée</span>' : ''}</div>
      <div class="frigo-card-body">
        <div class="card-cat">${esc(catLabels[r.cat] || '')}${v.nom ? ' · ' + esc(v.nom) : ''}</div>
        <h3 class="frigo-card-title">${esc(r.titre)}</h3>
        <div class="frigo-meta">⏱ ${esc(formatTemps(v.temps))} · 👥 ${esc(v.personnes)} pers.</div>
        <div class="frigo-lbl">Avec ce que tu as</div>
        <div class="frigo-chips">${c.uses.map(a => `<span class="fchip fchip--ok">✓ ${esc(a)}</span>`).join('')}</div>
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
    const prevIn = root.querySelector('#frigo-input');
    const keep = prevIn ? { v: prevIn.value, f: document.activeElement === prevIn } : null;
    const items = frigo();
    const usedK = new Set(accepted.flatMap(a => a.uses.map(key)));
    root.innerHTML = `
      <div class="frigo-head">
        <img class="frigo-deco" src="deco/oeuf.webp" alt="" aria-hidden="true">
        <h2>Mon frigo</h2>
        <p>Note ce que tu as, je te propose des recettes une par une jusqu'à tout utiliser.${api.isMine() ? '' : ` <em>(frigo partagé de ${esc(api.ownerName())})</em>`}</p>
        <form class="frigo-add" data-form>
          <input id="frigo-input" placeholder="Ex : courgettes, poulet, crème, riz…" autocomplete="off" enterkeyhint="done" aria-label="Ajouter un aliment">
          <button class="btn-primary" type="submit">Ajouter</button>
        </form>
        <div class="frigo-chips frigo-chips--list">
          ${items.length ? items.map(a => `<span class="fchip${usedK.has(key(a)) ? ' fchip--used' : ''}">${esc(a)}<button data-rm="${esc(a)}" aria-label="Retirer ${esc(a)}">✕</button></span>`).join('')
            : '<span class="frigo-small">Ton frigo est vide pour l\'instant.</span>'}
        </div>
        ${items.length ? `<div class="frigo-headbtns">
          <button class="btn-primary frigo-go" data-start>${started ? '↻ Recommencer' : '✨ Me proposer des recettes'}</button>
          <button class="btn-secondary" data-clear>Vider le frigo</button></div>` : ''}
      </div>
      ${started && remaining.length && current && current.kind === 'site' ? `<div class="frigo-left">Encore à utiliser : ${remaining.map(a => `<b>${esc(a)}</b>`).join(', ')}</div>` : ''}
      <div class="frigo-prop">${proposalHtml()}</div>
      ${accepted.length ? `<div class="frigo-kept">
        <h3>Tes recettes retenues <span>${accepted.length}</span></h3>
        <ul>${accepted.map((a, i) => `<li><span>${esc(a.titre)}<small>${esc(catLabels[a.cat] || '')} · ${a.uses.map(esc).join(', ')}</small></span><button data-unkeep="${i}" aria-label="Retirer">✕</button></li>`).join('')}</ul>
        <button class="btn-primary frigo-plan" data-plan>🗓️ Ajouter à ma semaine</button>
        <p class="frigo-small">Chaque plat va sur un soir libre (puis un midi) à partir d'aujourd'hui ; entrées et desserts rejoignent un plat. Tu pourras tout déplacer ensuite.</p>
      </div>` : ''}`;
    if (keep) { const i = root.querySelector('#frigo-input'); i.value = keep.v; if (keep.f) i.focus(); }
  }

  root.addEventListener('submit', e => {
    if (!e.target.matches('[data-form]')) return;
    e.preventDefault();
    const inp = root.querySelector('#frigo-input');
    const val = inp.value; inp.value = '';
    if (val.trim()) addItems(val);
    setTimeout(() => { const i = root.querySelector('#frigo-input'); i && i.focus(); }, 0);
  });
  root.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-flogin')) return ensureSignedIn();
    if (t.dataset.rm) return removeItem(t.dataset.rm);
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
})();
