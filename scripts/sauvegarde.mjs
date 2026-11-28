// Sauvegarde automatique sur GitHub de tout ce qui est modifié sur le site en ligne :
// recettes ajoutées ou modifiées (avec leurs photos) et recettes d'origine masquées.
// Lancé par .github/workflows/sauvegarde.yml ; lisible aussi à la main : node scripts/sauvegarde.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = 'https://firestore.googleapis.com/v1/projects/recette-eff3f/databases/(default)/documents/';
const OUT = 'sauvegarde', PHOTOS = 'photos/site/en-ligne';

async function readCollection(name) {
  const docs = []; let token = '';
  do {
    const res = await fetch(`${BASE}${name}?pageSize=300${token ? '&pageToken=' + encodeURIComponent(token) : ''}`);
    if (!res.ok) throw new Error(`${name} : erreur ${res.status} ${await res.text()}`);
    const j = await res.json();
    (j.documents || []).forEach(d => docs.push({ id: d.name.split('/').pop(), ...plain({ mapValue: { fields: d.fields || {} } }) }));
    token = j.nextPageToken || '';
  } while (token);
  return docs.sort((a, b) => a.id.localeCompare(b.id));
}
function plain(v) {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain);
  if ('mapValue' in v) {
    const o = {}; Object.keys(v.mapValue.fields || {}).sort().forEach(k => { o[k] = plain(v.mapValue.fields[k]); }); return o;
  }
  return v;
}
// Une photo collée sur le site est stockée en texte (data:image/...) : on l'enregistre comme vrai fichier image
const kept = new Set();
function savePhoto(url, name) {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/s.exec(url || '');
  if (!m) return url;
  const buf = Buffer.from(m[2], 'base64');
  const file = `${PHOTOS}/${name}-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8)}.${m[1].replace('jpeg', 'jpg')}`;
  fs.mkdirSync(PHOTOS, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  kept.add(file);
  return file;
}

const recettes = await readCollection('recipes');
recettes.forEach(r => {
  if (r.photo) r.photo = savePhoto(r.photo, r.id);
  (r.variantes || []).forEach((v, i) => { if (v.photo) v.photo = savePhoto(v.photo, `${r.id}-v${i}`); });
});
const masquees = await readCollection('hidden_static_recipes');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/recettes-en-ligne.json`, JSON.stringify(recettes, null, 1) + '\n');
fs.writeFileSync(`${OUT}/recettes-masquees.json`, JSON.stringify(masquees, null, 1) + '\n');
// Les anciennes photos qui ne servent plus à aucune recette sont retirées (l'historique GitHub les garde)
if (fs.existsSync(PHOTOS)) fs.readdirSync(PHOTOS).forEach(f => { const p = `${PHOTOS}/${f}`; if (!kept.has(p)) fs.unlinkSync(p); });
console.log(`${recettes.length} recettes en ligne, ${kept.size} photos, ${masquees.length} recettes masquées`);
