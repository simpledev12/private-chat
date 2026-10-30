/**
 * ============================================================================
 * PRIVATE CHAT — FIREBASE CONFIGURATION TEMPLATE (config.example.js)
 * ============================================================================
 * INSTRUCTIONS:
 * 1. Copy your Web App `firebaseConfig` from the Firebase Console:
 *    Project Settings (gear icon) -> General -> Your apps -> Web app
 * 2. Either paste these values into `js/config.js` OR paste the config snippet
 *    directly into the in-app "Firebase Setup" modal on your Android browser.
 *
 * SECURITY NOTE:
 * - Never put your Secret Access Code or Firebase Admin SDK keys here.
 * - The Secret Access Code is stored ONLY as a SHA-256 hash inside the locked
 *   Firestore document `/config/access` and verified server-side by
 *   `firestore.rules`.
 * ============================================================================
 */

window.FIREBASE_CONFIG_EXAMPLE = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
