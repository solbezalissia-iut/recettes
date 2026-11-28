// ────────────────────────────────────────────────────────────────────────
// ui.js — petits confort d'utilisation communs à tout le site
//  • messages discrets en bas de l'écran (toast) à la place des fenêtres
//    « OK » qui bloquent la page ;
//  • le bouton / geste « retour » du téléphone ferme la fenêtre ouverte
//    (fiche recette, formulaire, recadrage…) au lieu de quitter le site.
// ────────────────────────────────────────────────────────────────────────
(function () {
  // ── Toasts ──
  let box = null;
  function toast(msg, type) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' toast--' + type : '');
    const text = String(msg == null ? '' : msg);
    t.innerHTML = '<span></span><button type="button" aria-label="Fermer">✕</button>';
    t.firstChild.textContent = text;
    const close = () => { t.classList.remove('on'); setTimeout(() => t.remove(), 250); };
    t.lastChild.addEventListener('click', close);
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add('on'));
    // Le temps d'affichage dépend de la longueur du message
    setTimeout(close, Math.min(9000, 2600 + text.length * 45));
    while (box.children.length > 3) box.firstChild.remove();
  }
  window.toast = toast;
  // Les messages d'information du site passent en toast (les confirmations restent des questions)
  window.alert = msg => toast(msg, /échou|impossible|erreur|n'est pas|pas encore|il faut/i.test(String(msg)) ? 'err' : '');

  // ── Bouton retour du téléphone ──
  // Une seule étape « retour » est ajoutée tant qu'une fenêtre est ouverte : le retour ferme
  // la fenêtre du dessus (et en remet une si d'autres restent ouvertes). On ne recule jamais
  // l'historique plus loin que cette étape, donc on ne peut pas quitter le site par erreur.
  const CLOSE_BTN = { 'crop-modal-overlay': '#crop-cancel', 'erase-overlay': '#erase-cancel', 'cook-overlay': '#cook-close' };
  const stack = [];          // fenêtres ouvertes, la plus récente à la fin
  let guard = false, ignore = false, later = null;
  function closeEl(el) {
    const sel = CLOSE_BTN[el.id];
    const b = sel && document.querySelector(sel);
    if (b) b.click();
    else el.click(); // un clic sur le fond ferme la fenêtre
  }
  function addGuard() {
    if (guard) return;
    try { history.pushState({ fenetre: 1 }, ''); guard = true; } catch (e) { /* rien */ }
  }
  function changed() {
    clearTimeout(later);
    if (stack.length) { addGuard(); return; }
    // Tout est fermé avec les boutons du site : on retire l'étape ajoutée (petit délai au cas
    // où une autre fenêtre s'ouvre juste après, ex. la fiche qui se rouvre après une modification)
    later = setTimeout(() => {
      if (!stack.length && guard) { guard = false; ignore = true; history.back(); }
    }, 400);
  }
  function watch(el) {
    if (el.__watched) return; el.__watched = true;
    let wasOpen = el.classList.contains('open');
    if (wasOpen) stack.push(el);
    new MutationObserver(() => {
      const open = el.classList.contains('open');
      if (open === wasOpen) return;
      wasOpen = open;
      const i = stack.indexOf(el); if (i >= 0) stack.splice(i, 1);
      if (open) stack.push(el);
      changed();
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  window.addEventListener('popstate', () => {
    if (ignore) { ignore = false; return; }
    if (!guard) return;
    guard = false;
    clearTimeout(later);
    const top = stack[stack.length - 1];
    if (top) closeEl(top);
    // d'autres fenêtres restent ouvertes dessous : le prochain retour les fermera aussi
    setTimeout(() => { if (stack.length) addGuard(); }, 0);
  });
  function scan() { document.querySelectorAll('.modal-overlay, #plan-overlay, #cook-overlay').forEach(watch); }
  window.UI = { watch, scan };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
  setTimeout(scan, 1500);
})();
