import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';

// Firebase project config from Firebase Console
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDemoKey123456789',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'internshield-demo.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID || 'internshield-demo',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'internshield-demo.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '123456789',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID || '1:123456789:web:abcdef123456',
};

let app, db, auth, googleProvider;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
} catch (e) {
  console.warn('Firebase initialization warning:', e.message);
}

export { db, auth, googleProvider, signInWithPopup, signOut };
