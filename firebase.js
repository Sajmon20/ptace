import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, update, remove } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyDv7mvdNmvfduIxE1_D0cp3G0Z7UcNlvoQ",
  authDomain: "ranni-ptace.firebaseapp.com",
  databaseURL: "https://ranni-ptace-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "ranni-ptace",
  storageBucket: "ranni-ptace.firebasestorage.app",
  messagingSenderId: "928134634404",
  appId: "1:928134634404:web:e9e1d52b5770b338c1bf31",
  measurementId: "G-S7ZC8PW8KK"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, get, set, update, remove };
