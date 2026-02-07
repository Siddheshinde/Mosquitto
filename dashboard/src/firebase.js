import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyA87gNFHXvvNVmNoGKvAGdanJ-PBelh3rQ",
  authDomain: "mosquitto-d1aa7.firebaseapp.com",
  projectId: "mosquitto-d1aa7",
  storageBucket: "mosquitto-d1aa7.firebasestorage.app",
  messagingSenderId: "387480575060",
  appId: "1:387480575060:web:04857c830d53ce6de3e1c1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
