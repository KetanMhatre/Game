import type { User } from 'firebase/auth';
import { firebaseConfigured, loadFirebase, type FirebaseServices } from './firebase';

// Optional player accounts (Firebase Auth) with a cloud save in Firestore at players/{uid}.
// Guests keep playing with device-only progress; signing in merges that progress into the
// account so nothing is lost, and from then on every save also goes to the cloud.

export interface Stats {
  wins: number;
  bestKills: number;
  matches: number;
  sinks: number;
}

/** Everything that's saved: captain name, lifetime stats and menu/graphics preferences. */
export interface Progress {
  name: string;
  stats: Stats;
  prefs: Record<string, unknown>;
}

export type AccountStatus = 'offline' | 'loading' | 'guest' | 'signedIn';
export type CloudStatus = 'idle' | 'syncing' | 'saved' | 'error';

export interface AccountState {
  status: AccountStatus;
  cloud: CloudStatus;
  uid?: string;
  name?: string;
  email?: string;
  photo?: string;
  provider?: 'google' | 'password' | 'other';
}

export const emptyStats = (): Stats => ({ wins: 0, bestKills: 0, matches: 0, sinks: 0 });

export function cleanStats(s: unknown): Stats {
  const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
  return { wins: n(o.wins), bestKills: n(o.bestKills), matches: n(o.matches), sinks: n(o.sinks) };
}

/** Guest progress meets cloud progress: keep the better of each number (no double counting on re-sync). */
function mergeStats(a: Stats, b: unknown): Stats {
  const c = cleanStats(b);
  return { wins: Math.max(a.wins, c.wins), bestKills: Math.max(a.bestKills, c.bestKills), matches: Math.max(a.matches, c.matches), sinks: Math.max(a.sinks, c.sinks) };
}

const cleanName = (s: unknown) => (typeof s === 'string' ? s.trim().slice(0, 14) : '');

class AccountService {
  state: AccountState = { status: firebaseConfigured ? 'loading' : 'offline', cloud: 'idle' };
  /** Supplies this device's progress; merged into the cloud on sign-in. */
  getLocal: () => Progress = () => ({ name: '', stats: emptyStats(), prefs: {} });
  /** Receives merged progress after sign-in so the game can apply and store it locally. */
  onProgress: (p: Progress) => void = () => {};

  private listeners = new Set<(s: AccountState) => void>();
  private fb: FirebaseServices | null = null;
  private pending: Partial<Progress> = {};
  private saveTimer = 0;

  get available(): boolean {
    return this.state.status !== 'offline';
  }

  subscribe(fn: (s: AccountState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<AccountState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Starts Firebase in the background and restores a previous session. */
  async start(): Promise<void> {
    if (!firebaseConfigured) return;
    try {
      this.fb = await loadFirebase();
      this.fb.authApi.onAuthStateChanged(this.fb.auth, (u) => void this.handleUser(u));
    } catch (e) {
      console.warn('[Account] Firebase failed to load; continuing as guest.', e);
      this.set({ status: 'offline' });
    }
  }

  private async handleUser(u: User | null): Promise<void> {
    if (!u) {
      this.set({ status: 'guest', cloud: 'idle', uid: undefined, name: undefined, email: undefined, photo: undefined, provider: undefined });
      return;
    }
    const pid = u.providerData[0]?.providerId;
    this.set({
      status: 'signedIn',
      cloud: 'syncing',
      uid: u.uid,
      name: cleanName(u.displayName) || undefined,
      email: u.email ?? undefined,
      photo: u.photoURL ?? undefined,
      provider: pid === 'google.com' ? 'google' : pid === 'password' ? 'password' : 'other',
    });
    try {
      const merged = await this.pull(u);
      this.onProgress(merged);
      this.set({ name: merged.name, cloud: 'saved' });
    } catch (e) {
      console.warn('[Account] Cloud sync failed (check Firestore is enabled and firestore.rules are deployed).', e);
      this.set({ cloud: 'error' });
    }
  }

  /** Reads players/{uid}, merges it with this device's progress and writes the result back. */
  private async pull(u: User): Promise<Progress> {
    const { db, dbApi } = this.fb!;
    const ref = dbApi.doc(db, 'players', u.uid);
    const snap = await dbApi.getDoc(ref);
    const local = this.getLocal();
    const cloud = snap.exists() ? (snap.data() as Partial<Progress>) : null;
    const merged: Progress = {
      name: cleanName(cloud?.name) || cleanName(u.displayName) || cleanName(local.name) || 'Captain',
      stats: mergeStats(cleanStats(local.stats), cloud?.stats),
      prefs: { ...local.prefs, ...(cloud?.prefs && typeof cloud.prefs === 'object' ? cloud.prefs : {}) },
    };
    await dbApi.setDoc(
      ref,
      { ...merged, updatedAt: dbApi.serverTimestamp(), ...(snap.exists() ? {} : { createdAt: dbApi.serverTimestamp() }) },
      { merge: true },
    );
    return merged;
  }

  /** Queues a cloud save (debounced). Does nothing for guests: their progress stays on the device. */
  save(patch: Partial<Progress>): void {
    if (this.state.status !== 'signedIn') return;
    Object.assign(this.pending, patch);
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), 800);
  }

  private async flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    const uid = this.state.uid;
    if (!this.fb || !uid || !Object.keys(this.pending).length) return;
    const data: Record<string, unknown> = { ...this.pending };
    if (data.name !== undefined) data.name = cleanName(data.name) || 'Captain';
    this.pending = {};
    const { db, dbApi } = this.fb;
    this.set({ cloud: 'syncing' });
    try {
      await dbApi.setDoc(dbApi.doc(db, 'players', uid), { ...data, updatedAt: dbApi.serverTimestamp() }, { merge: true });
      this.set({ cloud: 'saved', ...(typeof data.name === 'string' ? { name: data.name } : {}) });
    } catch (e) {
      console.warn('[Account] Cloud save failed.', e);
      this.set({ cloud: 'error' });
    }
  }

  // ---------------------------------------------------------------- sign-in methods (throw on failure)

  async signInWithGoogle(): Promise<void> {
    const { auth, authApi } = await loadFirebase();
    await authApi.signInWithPopup(auth, new authApi.GoogleAuthProvider());
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    const { auth, authApi } = await loadFirebase();
    await authApi.signInWithEmailAndPassword(auth, email.trim(), password);
  }

  async createAccount(email: string, password: string, captainName: string): Promise<void> {
    const { auth, authApi } = await loadFirebase();
    const cred = await authApi.createUserWithEmailAndPassword(auth, email.trim(), password);
    const name = cleanName(captainName);
    if (name) await authApi.updateProfile(cred.user, { displayName: name });
  }

  async resetPassword(email: string): Promise<void> {
    const { auth, authApi } = await loadFirebase();
    await authApi.sendPasswordResetEmail(auth, email.trim());
  }

  async signOut(): Promise<void> {
    await this.flush();
    const { auth, authApi } = await loadFirebase();
    await authApi.signOut(auth);
  }
}

/** Friendly message for a Firebase Auth error, or null when there's nothing to show (user closed the popup). */
export function authErrorMessage(e: unknown): string | null {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null;
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.';
    case 'auth/invalid-email':
      return 'That email address doesn’t look right.';
    case 'auth/missing-password':
      return 'Please enter your password.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Wrong email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a minute and try again.';
    case 'auth/network-request-failed':
      return 'No connection. Check your internet and try again.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method isn’t enabled yet (Firebase console → Authentication → Sign-in method).';
    case 'auth/unauthorized-domain':
      return 'This website isn’t authorised for sign-in yet (Firebase console → Authentication → Settings → Authorized domains).';
    case 'auth/account-exists-with-different-credential':
      return 'This email is already registered with a different sign-in method.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export const Account = new AccountService();
