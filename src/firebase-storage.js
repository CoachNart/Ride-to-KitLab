import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth, signInAnonymously, GoogleAuthProvider, signInWithPopup,
  linkWithPopup, signOut, setPersistence, browserLocalPersistence, onAuthStateChanged
} from 'firebase/auth';
import {
  getDatabase, ref, set, get, remove, query, orderByKey, startAt, endAt
} from 'firebase/database';

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

// Explicitly persist the session in this browser and wait for Firebase to restore it
// before creating a guest session. Calling signInAnonymously before Firebase finishes
// restoring auth state can replace a returning Google session and cause repeat sign-ins.
const authReadyPromise = setPersistence(auth, browserLocalPersistence).then(() =>
  new Promise(resolve => {
    let unsubscribe;
    unsubscribe = onAuthStateChanged(auth, user => {
      if (unsubscribe) unsubscribe();
      resolve(user || null);
    });
  })
);

let authPromise = null;

async function ensureAuthenticated() {
  await authReadyPromise;
  if (auth.currentUser) return auth.currentUser;
  if (!authPromise) {
    authPromise = signInAnonymously(auth).then(result => result.user).catch(error => {
      authPromise = null;
      throw error;
    });
  }
  return authPromise;
}

function hasInvalidKeyChars(value) {
  return [46, 35, 36, 91, 93, 47].some(code => value.includes(String.fromCharCode(code)));
}

function validKey(key) {
  const value = String(key);
  if (!value || hasInvalidKeyChars(value)) throw new Error('Invalid multiplayer storage key');
  return value;
}

function nestedPathForKey(key) {
  const value = validKey(key);
  const match = /^([a-z0-9_-]{1,16}):([pb]):(.+)$/.exec(value);
  if (!match) return value;
  const room = match[1], kind = match[2], id = match[3];
  if (!id || hasInvalidKeyChars(id)) throw new Error('Invalid multiplayer record id');
  return 'rooms/' + room + '/' + (kind === 'p' ? 'players' : 'board') + '/' + id;
}

function nestedListLocation(prefix) {
  const match = /^([a-z0-9_-]{1,16}):([pb]):$/.exec(validKey(prefix));
  if (!match) return null;
  return { path: 'rooms/' + match[1] + '/' + (match[2] === 'p' ? 'players' : 'board') };
}

function publicUser(user) {
  return {
    uid: user.uid,
    displayName: user.displayName || 'KitRace Rider',
    email: user.email || '',
    photoURL: user.photoURL || '',
    isAnonymous: !!user.isAnonymous
  };
}

async function signInWithGoogle() {
  const current = await ensureAuthenticated();
  try {
    // Link the guest session so the first Google sign-in keeps the same Firebase UID.
    const result = current.isAnonymous
      ? await linkWithPopup(current, googleProvider)
      : await signInWithPopup(auth, googleProvider);
    authPromise = Promise.resolve(result.user);
    return publicUser(result.user);
  } catch (error) {
    // If the Google account already exists, sign in to that account instead.
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
  await set(ref(database, 'users/' + user.uid + '/profile'), {
    ...profile,
    ...publicUser(user),
    updatedAt: Date.now()
  });
  return true;
}

async function saveProgress(mission, progress) {
  const user = await ensureAuthenticated();
  if (user.isAnonymous) return false;
  await set(ref(database, 'users/' + user.uid + '/progress/' + validKey(mission)), {
    ...progress,
    updatedAt: Date.now()
  });
  return true;
}

async function loadProgress(mission) {
  const user = await ensureAuthenticated();
  if (user.isAnonymous) return null;
  const snapshot = await get(ref(database, 'users/' + user.uid + '/progress/' + validKey(mission)));
  return snapshot.exists() ? snapshot.val() : null;
}

async function loadProfile() {
  const user = await ensureAuthenticated();
  if (user.isAnonymous) return publicUser(user);
  const snapshot = await get(ref(database, 'users/' + user.uid + '/profile'));
  return snapshot.exists() ? { ...publicUser(user), ...snapshot.val() } : publicUser(user);
}

async function saveRecord(mission, record) {
  const user = await ensureAuthenticated();
  if (user.isAnonymous) return false;
  const recordRef = ref(database, 'users/' + user.uid + '/records/' + validKey(mission));
  const snapshot = await get(recordRef);
  const prior = snapshot.exists() ? snapshot.val() : {};
  const time = Math.max(0, Number(record.time) || 0);
  const score = Math.max(0, Number(record.score) || 0);
  await set(recordRef, {
    mission,
    name: String(record.name || user.displayName || 'KitRace Rider').slice(0, 40),
    bestTime: prior.bestTime ? Math.min(Number(prior.bestTime), time) : time,
    lastTime: time,
    bestScore: Math.max(Number(prior.bestScore) || 0, score),
    lastScore: score,
    completions: (Number(prior.completions) || 0) + 1,
    updatedAt: Date.now()
  });
  return true;
}

async function loadRecords() {
  const user = await ensureAuthenticated();
  if (user.isAnonymous) return [];
  const snapshot = await get(ref(database, 'users/' + user.uid + '/records'));
  return snapshot.exists() ? Object.values(snapshot.val() || {}) : [];
}

async function currentUser() {
  return publicUser(await ensureAuthenticated());
}

window.kitRaceAuth = {
  signInWithGoogle, saveProfile, saveProgress, loadProgress, loadProfile,
  saveRecord, loadRecords, currentUser, signOut: () => signOut(auth)
};

window.storage = {
  __rideKitlabFirebase: true,
  async set(key, value) {
    await ensureAuthenticated();
    const cleanKey = validKey(key), text = String(value);
    await set(ref(database, cleanKey), text);
    const nested = nestedPathForKey(cleanKey);
    if (nested !== cleanKey) remove(ref(database, nested)).catch(() => {});
    return { value: text };
  },
  async get(key) {
    await ensureAuthenticated();
    const cleanKey = validKey(key);
    const root = await get(ref(database, cleanKey));
    if (root.exists()) return { value: root.val() };
    const nested = nestedPathForKey(cleanKey);
    if (nested !== cleanKey) {
      const snapshot = await get(ref(database, nested));
      if (snapshot.exists()) return { value: snapshot.val() };
    }
    return null;
  },
  async list(prefixKey) {
    await ensureAuthenticated();
    const prefix = validKey(prefixKey), keys = new Set();
    const root = await get(query(ref(database), orderByKey(), startAt(prefix), endAt(prefix + '\uf8ff')));
    root.forEach(child => {
      if (child.key && child.key.startsWith(prefix)) keys.add(child.key);
    });
    const location = nestedListLocation(prefix);
    if (location) {
      const nested = await get(query(ref(database, location.path), orderByKey()));
      nested.forEach(child => {
        if (child.key) keys.add(prefix + child.key);
      });
    }
    return { keys: [...keys] };
  },
  async delete(key) {
    await ensureAuthenticated();
    const cleanKey = validKey(key);
    await remove(ref(database, cleanKey));
    const nested = nestedPathForKey(cleanKey);
    if (nested !== cleanKey) await remove(ref(database, nested)).catch(() => {});
    return true;
  }
};
