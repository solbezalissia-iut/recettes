// ────────────────────────────────────────────────────────────────────────
// visuals.js — un visuel pour chaque recette.
// Si la recette a une vraie photo, on l'utilise ; sinon on dessine une
// illustration : un emoji choisi d'après le titre (🍕, 🍰, 🥗…) sur un fond
// de la couleur de la catégorie. Le tout est présenté dans une assiette.
// Chargé avant app.js.
// ────────────────────────────────────────────────────────────────────────
(function () {
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe');

  // Mots du titre → emoji (le premier qui correspond gagne : du plus précis au plus général)
  const RULES = [
    ['riz au lait|semoule au lait|panna cotta|flan|creme brulee|creme caramel|creme dessert|ile flottante|iles flottantes|tiramisu|mousse|pudding|creme anglaise|creme patissiere|verrine', '🍮'],
    ['pomme de terre|pommes de terre|puree|potatoes|hasselback|gratin dauphinois|hash brown|ecrabouillee', '🥔'],
    ['alloco|plantain', '🍌'],
    ['frite', '🍟'],
    ['affogato', '☕'],
    ['banana|banane', '🍌'],
    ['carrot cake', '🥕'],
    ['cinnamon|roule a la cannelle|roules a la cannelle|kanelbulle', '🥐'],
    ['cantucci|biscotti', '🍪'],
    ['chili|piment', '🌶️'],
    ['cassoulet|haricot|lentille|pois chiche|feijoada', '🫘'],
    ['muesli|granola|porridge|bircher|overnight', '🥣'],
    ['bibimbap|donburi', '🍚'],
    ['chicken|butter chicken', '🍗'],
    ['celeri|endive|poireau', '🥬'],
    ['pizza|calzone', '🍕'],
    ['burger|hamburger|buns', '🍔'],
    ['hot dog|hot-dog', '🌭'],
    ['taco|fajita|quesadilla|burrito|wrap|tortilla|nachos|empanada', '🌮'],
    ['sushi|maki|california|onigiri|poke', '🍣'],
    ['ramen|nouille|pad thai|pho|bo bun|bobun|yakisoba|wok', '🍜'],
    ['nem|rouleau de printemps|samoussa|gyoza|dim sum', '🥟'],
    ['curry|dal |dahl|tikka|massala|colombo', '🍛'],
    ['risotto|paella|riz|biryani', '🍚'],
    ['pate|spaghetti|lasagne|tagliatelle|penne|gnocchi|mac and cheese|carbonara|macaroni|ravioli|tortellini|fusilli|linguine|orzo', '🍝'],
    ['soupe|veloute|potage|gaspacho|bouillon|minestrone|creme de ', '🥣'],
    ['salade|taboule|coleslaw|cesar|caesar|buddha bowl', '🥗'],
    ['oeuf|omelette|frittata|shakshuka|tortilla espagnole|oeufs', '🍳'],
    ['poulet|nugget|tender|volaille|dinde|aile', '🍗'],
    ['boeuf|steak|bourguignon|daube|pot-au-feu|pot au feu|hachis|carpaccio|tartare de boeuf|rosbif|kefta|boulette|viande|agneau|navarin|veau|blanquette|gigot', '🥩'],
    ['porc|jambon|lardon|saucisse|bacon|chorizo|rillette|charcuterie|croque', '🥓'],
    ['saumon|cabillaud|thon|poisson|gravlax|truite|sardine|maquereau|colin|dorade|bar ', '🐟'],
    ['crevette|moule|saint-jacques|saint jacques|calamar|homard|gambas|fruits de mer', '🦐'],
    ['raclette|fondue|tartiflette|croziflette|gnocchiflette|fromage|mozzarella|burrata|camembert|brie|gougere|cheese|feta|chevre|mont-d|stracciatella', '🧀'],
    ['croissant|cruffin|pain au chocolat|pain suisse|chausson|feuillete', '🥐'],
    ['pain|baguette|focaccia|brioche|naan|bagel|pita|msemmen|kesra|toast|tartine|sandwich|bruschetta', '🥖'],
    ['crepe|galette|pancake|blini', '🥞'],
    ['gaufre', '🧇'],
    ['donut|beignet', '🍩'],
    ['cupcake|muffin|madeleine|financier|cannele', '🧁'],
    ['cookie|biscuit|sable|palet|shortbread|brownie|blondie|langue de chat|macaron|meringue|tuile|spitzbuebe|mailanderli|brunsli|zimtsterne|oreo|kangoo|twix|whoopie|crinkle', '🍪'],
    ['tarte|tatin|quiche|tourte|clafoutis|crumble|pie', '🥧'],
    ['gateau|cake|layer|fraisier|entremets|genoise|marbre|quatre-quarts|quatre quarts|moelleux|fondant|buche|roule|charlotte|cheesecake|savarin|baba|bras de venus|millionnaire|napolitain|far ', '🍰'],
    ['glace|sorbet|granita|magnum|mcflurry|nice cream|esquimau|sundae|dame blanche|frozen|yaourt glace|sucette', '🍨'],
    ['chocolat|truffe|ganache|mendiant|rocher|praline|nutella|kinder|bounty|snickers|reese|pingui', '🍫'],
    ['bonbon|guimauve|chamallow|caramel|nougat|pate de fruit|orangette|candy', '🍬'],
    ['popcorn|pop-corn', '🍿'],
    ['mojito|spritz|martini|margarita|daiquiri|punch|sangria|vin chaud|kir|negroni|sour|colada|mai tai|hurricane|mule|russian|tonic|woo woo|paloma|shirley|mimosa|cuba|cocktail|aperol|sex on the beach|tequila|planteur|blue lagoon|cosmopolitan|bellini|hugo|limoncello|malibu|passoa|caipirinha|long island|bloody', '🍹'],
    ['smoothie|milkshake|lassi|jus |frappe|bubble tea|ice tea|the glace|limonade|citronnade|mocktail|sirop', '🥤'],
    ['cafe|latte|expresso|espresso|cappuccino|chocolat chaud', '☕'],
    ['avocat|guacamole', '🥑'],
    ['houmous|hummus|falafel|tapenade|tzatziki|dip|caviar d', '🫓'],
    ['champignon', '🍄'],
    ['tomate', '🍅'],
    ['aubergine|moussaka', '🍆'],
    ['courgette|ratatouille|legume|poelee|tian', '🥒'],
    ['carotte', '🥕'],
    ['mais|polenta', '🌽'],
    ['brocoli|chou', '🥦'],
    ['potiron|potimarron|butternut|citrouille|courge', '🎃'],
    ['fraise|framboise|fruits rouges|myrtille', '🍓'],
    ['banane|plantain|alloco', '🍌'],
    ['citron', '🍋'],
    ['mangue', '🥭'],
    ['ananas', '🍍'],
    ['coco', '🥥'],
    ['peche|abricot|nectarine', '🍑'],
    ['cerise', '🍒'],
    ['melon|pasteque', '🍉'],
    ['poire', '🍐'],
    ['pomme|compote', '🍎'],
    ['orange|agrume|clementine', '🍊'],
    ['raisin|datte|figue', '🍇'],
    ['olive', '🫒'],
    ['mayonnaise|vinaigrette|ketchup|pesto|sauce|aioli|coulis|confiture|curd|marmelade|nappage|sirop', '🫙'],
    ['yaourt|lait', '🥛'],
    ['lessive|savon|nettoy', '🧺']
  ].map(([words, emo]) => [words.split('|').map(w => ' ' + norm(w)), emo]);

  const BY_CAT = { apero: '🫒', entree: '🥗', plat: '🍲', accompagnement: '🥔', dessert: '🍰', boisson: '🍹', sauce: '🫙', 'base-culinaire': '🥣', maison: '🧺' };
  const TINT = { apero: '#F3DDB0', entree: '#DCE7C6', plat: '#F1CDB6', accompagnement: '#EADFC2', dessert: '#F5D4D8', boisson: '#CFE2EC', sauce: '#EFDDB4', 'base-culinaire': '#E8DED2', maison: '#DCE3E8' };

  function emojiFor(r) {
    const t = ' ' + norm(r.titre).replace(/[^a-z0-9 -]/g, ' ') + ' ';
    for (const [words, emo] of RULES) if (words.some(w => t.includes(w))) return emo;
    return BY_CAT[r.cat] || '🍽️';
  }
  const hasPhoto = r => !!(r && r.photo && !/enattente/i.test(r.photo));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Photos détourées (sans arrière-plan) dans photos/detoure/ — seulement celles où le détourage est réussi
  const DETOURE = ['aperolcerises', 'avocadotoast', 'avocatsthoncaprice', 'bagel', 'bagelthoncaprice', 'baguette', 'bobun',
    'bouleschocookie', 'courgettefarcis', 'gateauriz', 'gaufresliege', 'gaufrespdtbrunch', 'gnoccipesto', 'kangoo', 'languesdechat',
    'lasagne', 'mailanderli', 'millionnaire', 'patesbetteravefeta', 'pdtfourreesgruyere', 'saladepomme', 'spitzbuebe', 'tartepecan',
    'tomatesfarcis', 'wrapraclette'];
  const baseName = p => String(p).split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  const cutout = r => hasPhoto(r) && /^photos\//.test(r.photo) && DETOURE.includes(baseName(r.photo)) ? 'photos/detoure/' + baseName(r.photo) + '.webp' : null;

  // Contenu d'un visuel : photo détourée, sinon photo entière, sinon illustration
  function visualInner(r) {
    const emo = `<span class="vis-emo" aria-hidden="true">${emojiFor(r)}</span>`;
    const c = cutout(r);
    if (c) return `<img class="vis-cut" src="${esc(c)}" alt="" loading="lazy" onerror="this.outerHTML='${emo.replace(/"/g, '&quot;')}'">`;
    if (hasPhoto(r)) return `<img class="vis-photo" src="${esc(r.photo)}" alt="" loading="lazy" onerror="this.outerHTML='${emo.replace(/"/g, '&quot;')}'">`;
    return emo;
  }
  // Présentation selon la catégorie :
  //  • assiette pour les plats, entrées et desserts
  //  • bol à sauce pour les sauces
  //  • l'aliment seul, sans fond, pour tout le reste (verre de cocktail, apéro…)
  const PLATE_CATS = ['plat', 'entree', 'dessert'];
  const styleOf = r => PLATE_CATS.includes(r.cat) ? 'plate' : (r.cat === 'sauce' ? 'bowl' : 'free');
  function plateHtml(r, cls) {
    const st = styleOf(r);
    if (st === 'free') return `<div class="free ${cls || ''}" aria-hidden="true">${visualInner(r)}</div>`;
    // Assiette ou bol dessinés d'après le croquis (deco/assiette.svg, deco/bol-sauce.svg), sans fond coloré
    return `<div class="${st} ${cls || ''}" aria-hidden="true"><div class="plate-in">${visualInner(r)}</div></div>`;
  }
  // Petite vignette carrée arrondie (planning, listes…)
  function thumbHtml(r, cls) {
    return `<div class="vis-thumb ${cls || ''}" style="background:${TINT[r.cat] || '#EFE4D4'}" aria-hidden="true">${visualInner(r)}</div>`;
  }

  window.RecipeVisual = { emojiFor, hasPhoto, plateHtml, thumbHtml, styleOf, tint: r => TINT[r.cat] || '#EFE4D4' };
})();
