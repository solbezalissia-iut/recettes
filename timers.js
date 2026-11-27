// ────────────────────────────────────────────────────────────────────────
// timers.js — minuteurs lancés depuis les étapes d'une recette.
// Chaque durée trouvée dans une étape (« cuire 25 min », « 1 h 30 »,
// « 8 min / 40 °C ») devient un bouton ⏱. Les minuteurs restent affichés en
// bas de l'écran (même fiche fermée), sonnent et vibrent à la fin, et
// survivent à un rechargement de la page.
// ────────────────────────────────────────────────────────────────────────
(function () {
  const KEY = 'recettes-minuteurs';
  let timers = [];        // { id, label, recipe, total, end (ms) | null, left (ms si en pause), done }
  let tick = null, audioCtx = null, ringTimer = null;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  try { timers = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { timers = []; }
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(timers)); } catch (e) { /* rien */ } };

  // ── Trouver les durées dans le texte d'une étape ──
  function durations(text) {
    const t = ' ' + String(text).replace(/ /g, ' ') + ' ';
    const out = [];
    const re = /(\d+(?:[.,]\d+)?)\s*(?:(?:à|a|-|–|ou)\s*(\d+(?:[.,]\d+)?)\s*)?(heures?|h|minutes?|mins?|mn|secondes?|sec|s)(?![a-zà-ü])\s*(\d{1,2})?(?:\s*(?:min|mn))?/gi;
    let m;
    while ((m = re.exec(t))) {
      const u = m[3].toLowerCase();
      const n = parseFloat((m[2] || m[1]).replace(',', '.'));
      if (!n) continue;
      let sec = /^h/.test(u) ? n * 3600 + (m[4] ? +m[4] * 60 : 0) : /^m/.test(u) ? n * 60 : n;
      if (/^s/.test(u) && !/^sec/.test(u) && !/\d\s*s\b/.test(m[0])) continue;
      if (sec < 5 || sec > 72 * 3600) continue;
      const label = fmtShort(sec) + (m[2] ? '' : '');
      if (!out.some(o => o.sec === sec)) out.push({ sec, label, raw: m[0].trim() });
    }
    return out;
  }
  function fmtShort(sec) {
    const h = Math.floor(sec / 3600), mn = Math.round((sec % 3600) / 60), s = Math.round(sec % 60);
    if (sec < 60) return s + ' s';
    if (h) return h + ' h' + (mn ? ' ' + String(mn).padStart(2, '0') : '');
    return mn + ' min' + (sec % 60 && sec < 600 ? ' ' + s + ' s' : '');
  }
  function fmtClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  const leftOf = t => t.done ? 0 : (t.end ? t.end - Date.now() : t.left);

  // Boutons ⏱ sous chaque étape de la fiche ouverte
  function decorateSteps(listEl, recipeTitle) {
    if (!listEl) return;
    listEl.querySelectorAll('li').forEach((li, i) => {
      li.querySelectorAll('.step-timers').forEach(x => x.remove());
      const ds = durations(li.textContent);
      if (!ds.length) return;
      const box = document.createElement('div');
      box.className = 'step-timers';
      box.innerHTML = ds.map(d => `<button type="button" class="step-timer" data-sec="${d.sec}" data-step="${i + 1}">⏱ Minuteur ${esc(d.label)}</button>`).join('');
      li.appendChild(box);
    });
    listEl.onclick = e => {
      const b = e.target.closest('.step-timer'); if (!b) return;
      const li = b.closest('li');
      const txt = (li.firstElementChild || li).textContent.trim();
      start(+b.dataset.sec, recipeTitle(), `Étape ${b.dataset.step} · ${txt.length > 60 ? txt.slice(0, 58) + '…' : txt}`);
    };
  }

  // ── Minuteurs ──
  function start(sec, recipe, label) {
    unlockAudio();
    if ('Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch (e) { /* rien */ } }
    timers.push({ id: Date.now() + Math.random(), recipe: recipe || '', label: label || '', total: sec * 1000, end: Date.now() + sec * 1000, left: null, done: false });
    store(); render(true); run();
  }
  function run() {
    clearInterval(tick);
    if (!timers.length) return;
    tick = setInterval(() => {
      let rang = false;
      timers.forEach(t => { if (!t.done && t.end && t.end <= Date.now()) { t.done = true; t.end = null; rang = true; finished(t); } });
      if (rang) store();
      render();
    }, 250);
  }
  function finished(t) {
    ring();
    try { navigator.vibrate && navigator.vibrate([400, 200, 400, 200, 800]); } catch (e) { /* rien */ }
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('⏱ Minuteur terminé', { body: (t.recipe ? t.recipe + ' — ' : '') + fmtShort(t.total / 1000), tag: 'minuteur-' + t.id }); } catch (e) { /* rien */ }
    }
  }
  // Son : petites sonneries répétées tant qu'un minuteur terminé n'est pas arrêté
  function unlockAudio() {
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { /* rien */ }
  }
  function beep() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    [0, 0.25, 0.5].forEach(d => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, now + d); g.gain.exponentialRampToValueAtTime(0.4, now + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + d + 0.2);
      o.connect(g).connect(audioCtx.destination); o.start(now + d); o.stop(now + d + 0.22);
    });
  }
  function ring() {
    if (ringTimer) return;
    beep();
    ringTimer = setInterval(() => { if (timers.some(t => t.done)) beep(); else { clearInterval(ringTimer); ringTimer = null; } }, 1500);
  }

  // ── Affichage en bas de l'écran ──
  const dock = document.createElement('div');
  dock.className = 'timer-dock';
  dock.setAttribute('aria-live', 'polite');
  document.body.appendChild(dock);
  let lastHtml = '';
  function render(force) {
    if (!timers.length) { if (lastHtml) { dock.innerHTML = ''; lastHtml = ''; } dock.hidden = true; document.title = baseTitle; return; }
    dock.hidden = false;
    const html = timers.map(t => {
      const left = leftOf(t), pct = t.done ? 100 : Math.min(100, 100 - (left / t.total) * 100);
      return `<div class="timer${t.done ? ' timer--done' : ''}${!t.end && !t.done ? ' timer--paused' : ''}" data-id="${t.id}">
        <div class="timer-bar" style="width:${pct.toFixed(1)}%"></div>
        <div class="timer-main">
          <b class="timer-clock">${t.done ? 'Terminé !' : fmtClock(left)}</b>
          <span class="timer-label">${esc(t.recipe)}${t.label ? `<small>${esc(t.label)}</small>` : ''}</span>
        </div>
        <div class="timer-btns">
          ${t.done ? `<button data-t="again" aria-label="Relancer">↻</button><button class="timer-stop" data-t="stop">Arrêter</button>`
            : `<button data-t="minus" aria-label="1 minute de moins">−1</button><button data-t="plus" aria-label="1 minute de plus">+1</button>
               <button data-t="pause" aria-label="${t.end ? 'Pause' : 'Reprendre'}">${t.end ? '❚❚' : '▶'}</button>
               <button data-t="stop" aria-label="Supprimer le minuteur">✕</button>`}
        </div>
      </div>`;
    }).join('');
    if (force || html !== lastHtml) { dock.innerHTML = html; lastHtml = html; }
    const soonest = timers.filter(t => !t.done && t.end).sort((a, b) => a.end - b.end)[0];
    document.title = timers.some(t => t.done) ? '⏰ Terminé ! · ' + baseTitle : soonest ? '⏱ ' + fmtClock(soonest.end - Date.now()) + ' · ' + baseTitle : baseTitle;
  }
  const baseTitle = document.title;
  dock.addEventListener('click', e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    const el = b.closest('.timer'); const t = timers.find(x => String(x.id) === el.dataset.id); if (!t) return;
    unlockAudio();
    const a = b.dataset.t;
    if (a === 'stop') timers = timers.filter(x => x !== t);
    else if (a === 'again') { t.done = false; t.end = Date.now() + t.total; }
    else if (a === 'pause') { if (t.end) { t.left = t.end - Date.now(); t.end = null; } else { t.end = Date.now() + t.left; t.left = null; } }
    else if (a === 'plus' || a === 'minus') {
      const d = (a === 'plus' ? 1 : -1) * 60000;
      if (t.end) t.end = Math.max(Date.now() + 1000, t.end + d); else t.left = Math.max(1000, t.left + d);
      t.total = Math.max(t.total + d, 1000);
    }
    store(); render(true); run();
  });

  window.Timers = { decorateSteps, start, durations };
  render(true); run();
})();
