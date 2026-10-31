/**
 * ============================================================================
 * PRIVATE CHAT — LOCKED RUNTIME CONFIGURATION (js/config.js)
 * ============================================================================
 * Locked to `private-chat-920cb` so no user can modify or override the
 * Firebase configuration from the browser.
 * ============================================================================
 */

const DEFAULT_FIREBASE_CONFIG = Object.freeze({
  apiKey: "AIzaSyDD4ctSK2oTprUSHyl6QO1-Ue21w4RVsL8",
  authDomain: "private-chat-920cb.firebaseapp.com",
  projectId: "private-chat-920cb",
  storageBucket: "private-chat-920cb.firebasestorage.app",
  messagingSenderId: "491651105911",
  appId: "1:491651105911:web:e1dc7abbc0670357eef272"
});

export function getFirebaseConfig() {
  return DEFAULT_FIREBASE_CONFIG;
}
