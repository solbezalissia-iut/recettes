// ────────────────────────────────────────────────────────────────────────
// Configuration Firebase — projet "Recette" (recette-eff3f)
//
// Ces valeurs ne sont PAS secrètes : elles sont faites pour être visibles
// dans le code d'un site web (la vraie sécurité est assurée par les règles
// Firestore, voir firestore.rules). Aucun souci à les avoir dans un dépôt
// GitHub public.
// ────────────────────────────────────────────────────────────────────────

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDU0Vg-U6LeMw-I4gpgtcoXKAw6GR0zvoM",
  authDomain: "recette-eff3f.firebaseapp.com",
  projectId: "recette-eff3f",
  storageBucket: "recette-eff3f.firebasestorage.app",
  messagingSenderId: "730150791284",
  appId: "1:730150791284:web:2da84dfa80600e432f8921"
};

// ────────────────────────────────────────────────────────────────────────
// Recettes inventées par l'IA directement dans le site (onglet « Frigo »).
// DÉSACTIVÉ (laisser vide) : ça demanderait le forfait payant Blaze de Firebase.
// Tant que c'est vide, le bouton du Frigo ouvre Claude (gratuit) avec les
// aliments restants déjà écrits.
// ────────────────────────────────────────────────────────────────────────
window.APP_CHECK_SITE_KEY = "";
window.AI_MODEL = "gemini-3.8-flash";
