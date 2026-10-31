/**
 * ============================================================================
 * PRIVATE CHAT — RUNTIME CONFIGURATION LOADER (js/config.js)
 * ============================================================================
 * Pre-configured with the public Firebase Web SDK client identifiers for
 * `private-chat-920cb` so all visitors connect automatically without manual
 * setup.
 *
 * Security Note:
 * - Firebase Web SDK identifiers (apiKey, projectId, appId) are public client
 *   identifiers intended for browser apps and protected by Cloud Firestore
 *   Security Rules (`firestore.rules`) + Authorized Domains.
 * - The room's Secret Access Code is NEVER stored here; it is verified
 *   server-side as a SHA-256 hash against `/config/access` in Firestore.
 * ============================================================================
 */

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDD4ctSK2oTprUSHyl6QO1-Ue21w4RVsL8",
  authDomain: "private-chat-920cb.firebaseapp.com",
  projectId: "private-chat-920cb",
  storageBucket: "private-chat-920cb.firebasestorage.app",
  messagingSenderId: "491651105911",
  appId: "1:491651105911:web:e1dc7abbc0670357eef272"
};

const STORAGE_KEY_FIREBASE_CONFIG = "private_chat_firebase_config_v1";

/**
 * Checks whether a Firebase config object has all required fields populated.
 */
export function isValidFirebaseConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return false;
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  return required.every(
    (key) =>
      typeof cfg[key] === "string" &&
      cfg[key].trim().length > 0 &&
      !cfg[key].includes("YOUR_")
  );
}

/**
 * Loads the active Firebase configuration:
 * 1. Uses pre-configured `DEFAULT_FIREBASE_CONFIG` so friends connect automatically.
 * 2. Falls back to URL query parameter `?cfg=<base64>` or `localStorage` if customized.
 */
export function getFirebaseConfig() {
  if (isValidFirebaseConfig(DEFAULT_FIREBASE_CONFIG)) {
    return DEFAULT_FIREBASE_CONFIG;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("cfg");
    if (encoded) {
      const decoded = JSON.parse(atob(encoded));
      if (isValidFirebaseConfig(decoded)) {
        localStorage.setItem(STORAGE_KEY_FIREBASE_CONFIG, JSON.stringify(decoded));
        window.history.replaceState({}, document.title, window.location.pathname);
        return decoded;
      }
    }
  } catch (_) {
    // Ignore malformed URL parameter
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY_FIREBASE_CONFIG);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (isValidFirebaseConfig(parsed)) {
        return parsed;
      }
    }
  } catch (_) {
    // Ignore storage read errors
  }

  return null;
}

/**
 * Parses a raw `firebaseConfig` paste (supports JSON or JS `const firebaseConfig = { ... }` snippet)
 * and saves it to localStorage.
 */
export function saveFirebaseConfigFromInput(rawInput) {
  if (!rawInput || typeof rawInput !== "string") {
    throw new Error("Please paste your firebaseConfig snippet from Firebase Console.");
  }

  const extractField = (key) => {
    const regex = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`);
    const match = rawInput.match(regex);
    return match ? match[1].trim() : "";
  };

  const config = {
    apiKey: extractField("apiKey"),
    authDomain: extractField("authDomain"),
    projectId: extractField("projectId"),
    storageBucket: extractField("storageBucket"),
    messagingSenderId: extractField("messagingSenderId"),
    appId: extractField("appId")
  };

  if (!isValidFirebaseConfig(config)) {
    throw new Error(
      "Missing required fields (apiKey, authDomain, projectId, appId). Make sure you copied the full firebaseConfig block."
    );
  }

  localStorage.setItem(STORAGE_KEY_FIREBASE_CONFIG, JSON.stringify(config));
  return config;
}

/**
 * Clears locally stored Firebase config from the browser.
 */
export function clearSavedFirebaseConfig() {
  localStorage.removeItem(STORAGE_KEY_FIREBASE_CONFIG);
}
