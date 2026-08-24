// Firebase Web SDK config for the shared global leaderboard (see
// leaderboard.js). This key identifies the project only - it isn't secret;
// access control is enforced by Firestore's own security rules, not by
// hiding this value, so it's normal for it to sit in plain client code.
//
// Left null until a real project exists: leaderboard.js checks for that and
// disables the global board (personal best still works either way) rather
// than throwing.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAzUodu0qWwhj5zIaOwJS7REyfO8au9uyQ",
  authDomain: "numbers-bee1b.firebaseapp.com",
  projectId: "numbers-bee1b",
  storageBucket: "numbers-bee1b.firebasestorage.app",
  messagingSenderId: "388844274416",
  appId: "1:388844274416:web:2b6dafea791bca37867835",
};
