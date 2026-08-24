// Firebase Web SDK config for the shared global leaderboard (see
// leaderboard.js). This key identifies the project only - it isn't secret;
// access control is enforced by Firestore's own security rules, not by
// hiding this value, so it's normal for it to sit in plain client code.
//
// Left null until a real project exists: leaderboard.js checks for that and
// disables the global board (personal best still works either way) rather
// than throwing.
const FIREBASE_CONFIG = null;
