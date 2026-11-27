// ────────────────────────────────────────────────────────────────────────
// cloud.js — Comptes (connexion Google) + recettes partagées (Firestore)
//
// Ce fichier est un "module" (chargé avec type="module" dans index.html),
// il tourne un peu après app.js. Il communique avec app.js par deux canaux
// simples pour ne rien casser du code existant :
//
//   1. app.js définit deux fonctions globales AVANT que ce fichier ne les
//      appelle :
//        - window.onAuthStateChanged(user)     → appelée à chaque connexion/déconnexion
//        - window.onLiveRecipesUpdate(recipes) → appelée à chaque changement des
//                                                  recettes ajoutées par les utilisateurs
//
//   2. Ce fichier expose window.CloudRecipes = { signInWithGoogle, signOutUser,
//      getCurrentUser, addRecipe, updateRecipe, deleteRecipe } que app.js
//      appelle depuis les boutons (connexion, ajout, modification, suppression).
// ────────────────────────────────────────────────────────────────────────

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  where,
  deleteField,
  arrayRemove,
  FieldPath
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const RECIPES_COLLECTION = 'recipes';
const HIDDEN_STATIC_COLLECTION = 'hidden_static_recipes';
const PLANNING_COLLECTION = 'planning';
const SHARED_COLLECTION = 'shared_plannings'; // plannings partagés, séparés du planning perso

function configLooksEmpty(cfg) {
  return !cfg || !cfg.apiKey || cfg.apiKey.includes('COLLE_ICI');
}

if (configLooksEmpty(window.FIREBASE_CONFIG)) {
  console.warn(
    "[cloud.js] firebase-config.js n'a pas encore été rempli. " +
    "Les comptes et l'ajout de recettes en ligne sont désactivés jusqu'à ce que la configuration Firebase soit renseignée."
  );
  // On informe quand même app.js qu'il n'y a personne de connecté et aucune recette live,
  // pour que le site fonctionne normalement en lecture seule avec les recettes d'origine.
  if (typeof window.onAuthStateChanged === 'function') window.onAuthStateChanged(null);
  if (typeof window.onLiveRecipesUpdate === 'function') window.onLiveRecipesUpdate([]);
  if (typeof window.onHiddenStaticUpdate === 'function') window.onHiddenStaticUpdate([]);
} else {
  const app = initializeApp(window.FIREBASE_CONFIG);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const provider = new GoogleAuthProvider();

  let currentUser = null;

  // Planning de la semaine + liste de courses : un document par compte (planning/{uid}).
  // Le propriétaire peut le partager avec d'autres comptes Google (champ sharedWith,
  // liste d'adresses e-mail en minuscules) : ils le voient et le modifient en direct.
  // Utilisé par planning.js. Défini AVANT l'écoute de la connexion pour être prêt dès le login.
  // Clé d'un planning : l'uid pour le planning perso, « s:<id> » pour un planning partagé
  const planRef = key => String(key).startsWith('s:') ? doc(db, SHARED_COLLECTION, String(key).slice(2)) : doc(db, PLANNING_COLLECTION, key);
  window.CloudPlanning = {
    // Suit un planning (le sien ou un planning partagé)
    subscribe(uid, onData, onError) {
      return onSnapshot(planRef(uid), (snap) => {
        if (snap.metadata.hasPendingWrites) return; // nos propres enregistrements, déjà affichés
        onData(snap.exists() ? snap.data() : null);
      }, onError);
    },
    // Suit la liste des plannings que d'autres ont partagés avec cette adresse
    subscribeShared(email, onList, onError) {
      const q = query(collection(db, PLANNING_COLLECTION), where('sharedWith', 'array-contains', email));
      return onSnapshot(q, (snap) => {
        onList(snap.docs.map(d => ({ uid: d.id, ownerName: d.data().ownerName || '', ownerEmail: d.data().ownerEmail || '' })));
      }, onError);
    },
    // Enregistre UNE semaine (les autres semaines ne sont pas touchées : deux personnes
    // peuvent modifier des semaines différentes en même temps sans s'écraser).
    async saveWeek(uid, key, week) {
      try {
        await updateDoc(planRef(uid), new FieldPath('weeks', key), week ? week : deleteField(), 'updatedAt', serverTimestamp());
      } catch (e) {
        if (e.code !== 'not-found' || !week) throw e;
        // Premier enregistrement : le document n'existe pas encore (seul le propriétaire peut le créer)
        await setDoc(planRef(uid), { weeks: { [key]: week }, updatedAt: serverTimestamp() }, { merge: true });
      }
    },
    // Réservé au propriétaire : avec qui le planning est partagé
    async setSharing(uid, emails, ownerName, ownerEmail) {
      await setDoc(planRef(uid), { sharedWith: emails, ownerName: ownerName || '', ownerEmail: ownerEmail || '' }, { merge: true });
    },
    // Pour un invité : ne plus voir un planning partagé
    async leave(uid, email) {
      await updateDoc(planRef(uid), { sharedWith: arrayRemove(email) });
    },

    // ── Plannings partagés (semaine + courses + frigo à part, avec un nom) ──
    subscribeMyShared(email, onList, onError) {
      const q = query(collection(db, SHARED_COLLECTION), where('members', 'array-contains', email));
      return onSnapshot(q, (snap) => {
        onList(snap.docs.map(d => ({ key: 's:' + d.id, name: d.data().name || 'Planning partagé', ownerUid: d.data().ownerUid,
          ownerName: d.data().ownerName || '', members: d.data().members || [] })));
      }, onError);
    },
    async createShared(name, ownerName, email) {
      const ref = await addDoc(collection(db, SHARED_COLLECTION), {
        name, ownerUid: currentUser.uid, ownerName: ownerName || '', members: [email], weeks: {}, frigo: [], createdAt: serverTimestamp()
      });
      return 's:' + ref.id;
    },
    async rename(key, name) {
      await setDoc(planRef(key), { name }, { merge: true });
    },
    async setMembers(key, emails) {
      await updateDoc(planRef(key), { members: emails });
    },
    async leaveShared(key, email) {
      await updateDoc(planRef(key), { members: arrayRemove(email) });
    },
    async deleteShared(key) {
      await deleteDoc(planRef(key));
    }
  };

  // Frigo (liste d'aliments) : enregistré avec le planning affiché, donc partagé avec les invités
  window.CloudPlanning.saveFrigo = async (uid, list) => {
    try { await updateDoc(planRef(uid), { frigo: list, updatedAt: serverTimestamp() }); }
    catch (e) {
      if (e.code !== 'not-found') throw e;
      await setDoc(planRef(uid), { frigo: list, updatedAt: serverTimestamp() }, { merge: true });
    }
  };

  // ── Recettes inventées par l'IA (Firebase AI Logic + Gemini) ──
  // Activé seulement si une clé App Check (reCAPTCHA Enterprise) est renseignée
  // dans firebase-config.js : window.APP_CHECK_SITE_KEY = "…".
  const FB = 'https://www.gstatic.com/firebasejs/12.19.0/';
  let aiModel = null;
  async function getModel() {
    if (aiModel) return aiModel;
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import(FB + 'firebase-app-check.js');
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(window.APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
    const { getAI, getGenerativeModel, GoogleAIBackend, Schema } = await import(FB + 'firebase-ai.js');
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    const S = Schema;
    const schema = S.object({
      properties: {
        titre: S.string(),
        cat: S.enumString({ enum: ['apero', 'entree', 'plat', 'accompagnement', 'dessert', 'boisson', 'sauce'] }),
        temps: S.string(),
        personnes: S.integer(),
        ingredients: S.array({ items: S.string() }),
        etapes: S.array({ items: S.string() }),
        mc: S.array({ items: S.string() })
      }
    });
    aiModel = getGenerativeModel(ai, {
      model: window.AI_MODEL || 'gemini-3.8-flash',
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.9 }
    });
    return aiModel;
  }
  window.CloudAI = {
    available: !!window.APP_CHECK_SITE_KEY,
    async inventRecipe(aliments, avoidTitles) {
      const model = await getModel();
      const prompt = `Tu es la cheffe du carnet de recettes d'Alissia. Invente UNE recette familiale, savoureuse et réaliste, en français,
qui utilise le plus possible de ces aliments (pas forcément tous s'ils ne vont pas ensemble) : ${aliments.join(', ')}.
Tu peux ajouter d'autres ingrédients courants si nécessaire.
${avoidTitles.length ? 'Ne propose pas ces recettes déjà refusées ou proposées : ' + avoidTitles.join(' ; ') + '.' : ''}
Règles de rédaction (obligatoires) :
- ingredients : une ligne par ingrédient, quantité d'abord, en g, kg, ml ou L (ex. « 200 g de courgettes », « 0,25 L de lait », « 2 œufs », « 1 pincée de sel »). N'oublie aucun ingrédient.
- etapes : phrases complètes, sans numéro, sans oublier aucune étape ni temps de cuisson ou température.
- temps : durée totale, par ex. « 45 min » ou « 1 h 15 ».
- personnes : nombre de personnes.
- mc : les mêmes étapes adaptées au Monsieur Cuisine de Lidl (tous modèles). Écris les réglages entre balises <b>…</b> au format « temps / température / vitesse », par ex. <b>5 min / 100 °C / vitesse 1</b>, « sens inverse » pour mijoter sans écraser, « mode pétrin » pour les pâtes, température maximale 120 °C ; si le Monsieur Cuisine n'est pas utile, une seule étape qui le dit.
- cat : apero, entree, plat, accompagnement, dessert, boisson ou sauce.`;
      const res = await model.generateContent(prompt);
      return JSON.parse(res.response.text());
    }
  };

  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (typeof window.onAuthStateChanged === 'function') {
      window.onAuthStateChanged(user ? {
        uid: user.uid,
        displayName: user.displayName,
        photoURL: user.photoURL,
        email: user.email
      } : null);
    }
  });

  const recipesQuery = query(collection(db, RECIPES_COLLECTION), orderBy('createdAt', 'asc'));
  onSnapshot(recipesQuery, (snapshot) => {
    const live = snapshot.docs.map(d => {
      const data = d.data();
      return {
        ...data,
        _docId: d.id,
        _ownerId: data.ownerId,
        _ownerName: data.ownerName || 'Quelqu\'un',
        _isStatic: false
      };
    });
    if (typeof window.onLiveRecipesUpdate === 'function') {
      window.onLiveRecipesUpdate(live);
    }
  }, (err) => {
    console.error('[cloud.js] Erreur de synchronisation Firestore :', err);
  });

  // Recettes d'origine qu'Alissia a choisi de masquer (elle en a le droit, personne d'autre).
  onSnapshot(collection(db, HIDDEN_STATIC_COLLECTION), (snapshot) => {
    const ids = snapshot.docs.map(d => d.id);
    if (typeof window.onHiddenStaticUpdate === 'function') {
      window.onHiddenStaticUpdate(ids);
    }
  }, (err) => {
    console.error('[cloud.js] Erreur de synchronisation (recettes masquées) :', err);
  });

  window.CloudRecipes = {
    getCurrentUser() {
      return currentUser;
    },

    async signInWithGoogle() {
      const result = await signInWithPopup(auth, provider);
      return result.user;
    },

    async signOutUser() {
      await signOut(auth);
    },

    async addRecipe(recipeData) {
      if (!currentUser) throw new Error("Il faut être connecté pour ajouter une recette.");
      const payload = {
        ...recipeData,
        ownerId: currentUser.uid,
        ownerName: currentUser.displayName || 'Quelqu\'un',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      const ref = await addDoc(collection(db, RECIPES_COLLECTION), payload);
      return ref.id;
    },

    async updateRecipe(docId, recipeData) {
      if (!currentUser) throw new Error("Il faut être connecté pour modifier une recette.");
      const { ownerId, ownerName, createdAt, ...safeData } = recipeData;
      await updateDoc(doc(db, RECIPES_COLLECTION, docId), {
        ...safeData,
        updatedAt: serverTimestamp()
      });
    },

    async deleteRecipe(docId) {
      if (!currentUser) throw new Error("Il faut être connecté pour supprimer une recette.");
      await deleteDoc(doc(db, RECIPES_COLLECTION, docId));
    },

    // Réservé à Alissia (voir firestore.rules) : masque une recette d'origine du site.
    async hideStaticRecipe(staticId) {
      if (!currentUser) throw new Error("Il faut être connecté pour supprimer une recette.");
      await setDoc(doc(db, HIDDEN_STATIC_COLLECTION, staticId), {
        hiddenBy: currentUser.uid,
        hiddenAt: serverTimestamp()
      });
    }
  };
}
