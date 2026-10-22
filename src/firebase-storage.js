import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  getDatabase, ref, set, get, remove, query, orderByKey
} from 'firebase/database';

// Ride to KitLab multiplayer backend. Public web config identifies the project;
// Firebase Authentication and Realtime Database rules protect the data.
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

let authPromise = auth.currentUser
  ? Promise.resolve(auth.currentUser)
  : signInAnonymously(auth).then((credential) => credential.user);

async function ensureAuthenticated() {
  if (auth.currentUser) return auth.currentUser;
  if (!authPromise) {
    authPromise = signInAnonymously(auth).then((credential) => credential.user);
  }
  try {
    return await authPromise;
  } catch (error) {
    authPromise = null;
    throw error;
  }
}

function validKey(key) {
  const value = String(key);
  if (!value || /[.#$\[\]\/]/.test(value)) {
    throw new Error('Invalid multiplayer storage key');
  }
  return value;
}

// The game still uses legacy keys such as "kitlab:p:<riderId>".
// Store them beneath each room so player discovery queries the room's own
// players node instead of querying the entire database root.
function pathForKey(key) {
  const value = validKey(key);
  const match = /^([a-z0-9_-]{1,16}):([pb]):(.+)$/.exec(value);
  if (!match) return value;
  const [, room, kind, id] = match;
  if (!id || /[.#$\[\]\/]/.test(id)) throw new Error('Invalid multiplayer record id');
  const bucket = kind === 'p' ? 'players' : 'board';
  return `rooms/${room}/${bucket}/${id}`;
}

function listLocation(prefixKey) {
  const prefix = validKey(prefixKey);
  const match = /^([a-z0-9_-]{1,16}):([pb]):$/.exec(prefix);
  if (!match) {
    return { path: '', prefix, legacy: true };
  }
  const [, room, kind] = match;
  return {
    path: `rooms/${room}/${kind === 'p' ? 'players' : 'board'}`,
    prefix,
    legacy: false
  };
}

// Keep the storage API expected by main.js. list() returns legacy-formatted
// keys, so the game code does not need to know about the Firebase layout.
window.storage = {
  __rideKitlabFirebase: true,
  async set(key, value) {
    await ensureAuthenticated();
    const text = String(value);
    await set(ref(database, pathForKey(key)), text);
    return { value: text };
  },
  async get(key) {
    await ensureAuthenticated();
    const snapshot = await get(ref(database, pathForKey(key)));
    return snapshot.exists() ? { value: snapshot.val() } : null;
  },
  async list(prefixKey) {
    await ensureAuthenticated();
    const loc = listLocation(prefixKey);
    const base = ref(database, loc.path || undefined);
    const result = loc.legacy
      ? await get(query(base, orderByKey()))
      : await get(query(base, orderByKey()));
    const keys = [];
    result.forEach((child) => {
      const key = loc.legacy ? child.key : loc.prefix + child.key;
      if (key && key.startsWith(loc.prefix)) keys.push(key);
    });
    return { keys };
  },
  async delete(key) {
    await ensureAuthenticated();
    await remove(ref(database, pathForKey(key)));
    return true;
  }
};
