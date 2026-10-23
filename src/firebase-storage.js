import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, GoogleAuthProvider, signInWithPopup, linkWithPopup, signOut, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getDatabase, ref, set, get, remove, query, orderByKey, startAt, endAt } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyDHUcq_kmKx6x8rHgeeU1Qpc_k_m9-1fCk",
  authDomain: "rise-to-c3af0.firebaseapp.com",
  databaseURL: "https://rise-to-c3af0-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "rise-to-c3af0",
  storageBucket: "rise-to-c3af0.firebasestorage.app",
  messagingSenderId: "567201117488",
  appId: "1:567201117488:web:1bd639a56d8e367b4144f5"
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app, firebaseConfig.databaseURL);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
let authPromise = auth.currentUser ? Promise.resolve(auth.currentUser) : signInAnonymously(auth).then(c => c.user);

try { await setPersistence(auth, browserLocalPersistence); } catch (error) { console.warn('[KitRace] Could not set persistent auth session.', error); }

async function ensureAuthenticated() {
  if (auth.currentUser) return auth.currentUser;
  if (!authPromise) authPromise = signInAnonymously(auth).then(c => c.user);
  try { return await authPromise; } catch (error) { authPromise = null; throw error; }
}
function validKey(key) {
  const value = String(key);
  if (!value || /[.#$\\[\\]\\/]/.test(value)) throw new Error('Invalid multiplayer storage key');
  return value;
}
function nestedPathForKey(key) {
  const value = validKey(key), m = /^([a-z0-9_-]{1,16}):([pb]):(.+)$/.exec(value);
  if (!m) return value;
  const [, room, kind, id] = m;
  if (!id || /[.#$\\[\\]\\/]/.test(id)) throw new Error('Invalid multiplayer record id');
  return `rooms/${room}/${kind === 'p' ? 'players' : 'board'}/${id}`;
}
function nestedListLocation(prefix) {
  const m = /^([a-z0-9_-]{1,16}):([pb]):$/.exec(validKey(prefix));
  if (!m) return null;
  const [, room, kind] = m;
  return { path: `rooms/${room}/${kind === 'p' ? 'players' : 'board'}` };
}
function publicUser(user) {
  return { uid: user.uid, displayName: user.displayName || 'KitRace Rider', email: user.email || '', photoURL: user.photoURL || '', isAnonymous: !!user.isAnonymous };
}
async function signInWithGoogle() {
  const current = await ensureAuthenticated();
  try {
    // Link the guest session so a first Google sign-in keeps the same Firebase UID.
    const result = current.isAnonymous ? await linkWithPopup(current, googleProvider) : await signInWithPopup(auth, googleProvider);
    authPromise = Promise.resolve(result.user);
    return publicUser(result.user);
  } catch (error) {
    // If this Google account already exists, sign in to that account instead.
    if (error.code === 'auth/credential-already-in-use' || error.code === 'auth/email-already-in-use') {
      const result = await signInWithPopup(auth, googleProvider);
      authPromise = Promise.resolve(result.user);
      return publicUser(result.user);
    }
    throw error;
  }
}
async function saveProfile(profile) {
  const user = await ensureAuthenticated();
  if (user.isAnonymous) return false;
  await set(ref(database, `users/${user.uid}/profile`), { ...profile, ...publicUser(user), updatedAt: Date.now() });
  return true;
}
async function saveProgress(mission, progress) {
  const user = await ensureAuthenticated();
  if (user.isAnonymous) return false;
  await set(ref(database, `users/${user.uid}/progress/${validKey(mission)}`), { ...progress, updatedAt: Date.now() });
  return true;
}
async function loadProgress(mission) {
  const user = await ensureAuthenticated();
  if (user.isAnonymous) return null;
  const snapshot = await get(ref(database, `users/${user.uid}/progress/${validKey(mission)}`));
  return snapshot.exists() ? snapshot.val() : null;
}
async function loadProfile() {
  const user = await ensureAuthenticated();
  if (user.isAnonymous) return publicUser(user);
  const snapshot = await get(ref(database, `users/${user.uid}/profile`));
  return snapshot.exists() ? { ...publicUser(user), ...snapshot.val() } : publicUser(user);
}
async function currentUser() {
  return publicUser(await ensureAuthenticated());
}

window.kitRaceAuth = { signInWithGoogle, saveProfile, saveProgress, loadProgress, loadProfile, currentUser, signOut: () => signOut(auth) };
window.storage = {
  __rideKitlabFirebase: true,
  async set(key, value) {
    await ensureAuthenticated();
    const k = validKey(key), text = String(value);
    await set(ref(database, k), text);
    const nested = nestedPathForKey(k);
    if (nested !== k) remove(ref(database, nested)).catch(() => {});
    return { value: text };
  },
  async get(key) {
    await ensureAuthenticated();
    const k = validKey(key), root = await get(ref(database, k));
    if (root.exists()) return { value: root.val() };
    const nested = nestedPathForKey(k);
    if (nested !== k) {
      const snapshot = await get(ref(database, nested));
      if (snapshot.exists()) return { value: snapshot.val() };
    }
    return null;
  },
  async list(prefixKey) {
    await ensureAuthenticated();
    const prefix = validKey(prefixKey), keys = new Set();
    const root = await get(query(ref(database), orderByKey(), startAt(prefix), endAt(prefix + '\\uf8ff')));
    root.forEach(child => { if (child.key && child.key.startsWith(prefix)) keys.add(child.key); });
    const loc = nestedListLocation(prefix);
    if (loc) {
      const nested = await get(query(ref(database, loc.path), orderByKey()));
      nested.forEach(child => { if (child.key) keys.add(prefix + child.key); });
    }
    return { keys: [...keys] };
  },
  async delete(key) {
    await ensureAuthenticated();
    const k = validKey(key);
    await remove(ref(database, k));
    const nested = nestedPathForKey(k);
    if (nested !== k) await remove(ref(database, nested)).catch(() => {});
    return true;
  }
};
