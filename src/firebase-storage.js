import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  getDatabase, ref, set, get, remove, query, orderByKey, startAt, endAt
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

// Keep the storage interface already used by the game, but back it with
// Firebase so different devices can share the same room.
window.storage = {
  __rideKitlabFirebase: true,
  async set(key, value) {
    await ensureAuthenticated();
    const text = String(value);
    await set(ref(database, validKey(key)), text);
    return { value: text };
  },
  async get(key) {
    await ensureAuthenticated();
    const snapshot = await get(ref(database, validKey(key)));
    return snapshot.exists() ? { value: snapshot.val() } : null;
  },
  async list(prefixKey) {
    await ensureAuthenticated();
    const prefix = validKey(prefixKey);
    const result = await get(query(
      ref(database),
      orderByKey(),
      startAt(prefix),
      endAt(prefix + '\uf8ff')
    ));
    const keys = [];
    result.forEach((child) => keys.push(child.key));
    return { keys };
  },
  async delete(key) {
    await ensureAuthenticated();
    await remove(ref(database, validKey(key)));
    return true;
  }
};
