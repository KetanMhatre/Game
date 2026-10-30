import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore/lite';

// Values come from .env (see .env.example). Firebase web config isn't secret: it ships in the
// client bundle by design. Data is protected by firestore.rules and Auth's authorized domains.
// Firestore "lite" (plain reads/writes, no live listeners) keeps the download small.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

/** False when .env is missing the keys: the game then runs guest-only and hides the account UI. */
export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId,
);

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  authApi: typeof import('firebase/auth');
  dbApi: typeof import('firebase/firestore/lite');
}

let loading: Promise<FirebaseServices> | null = null;

/**
 * Loads Firebase on demand. The SDK is pulled in with dynamic imports, so Vite splits it into
 * separate chunks that download after the game is already playable (load time matters on CrazyGames).
 */
export function loadFirebase(): Promise<FirebaseServices> {
  if (!firebaseConfigured) return Promise.reject(new Error('Firebase is not configured (.env)'));
  loading ??= (async () => {
    const [appApi, authApi, dbApi] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore/lite')]);
    const app = appApi.initializeApp(firebaseConfig);
    return { app, auth: authApi.getAuth(app), db: dbApi.getFirestore(app), authApi, dbApi };
  })();
  // Let a failed load (e.g. offline) be retried later.
  loading.catch(() => (loading = null));
  return loading;
}
