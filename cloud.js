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
  onSnapshot,
  serverTimestamp,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const RECIPES_COLLECTION = 'recipes';

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
} else {
  const app = initializeApp(window.FIREBASE_CONFIG);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const provider = new GoogleAuthProvider();

  let currentUser = null;

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
    }
  };
}
