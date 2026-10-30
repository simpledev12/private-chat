/**
 * ============================================================================
 * PRIVATE CHAT — RUNTIME CONFIGURATION LOADER (js/config.js)
 * ============================================================================
 * No credentials or secret codes are hardcoded in this file.
 *
 * You can configure your Firebase Web SDK project in two ways:
 * 1. In-Browser on Android (Zero-code): Open the website and paste your
 *    `firebaseConfig` into the Setup Modal (saved in browser localStorage).
 * 2. Repository Config: Paste your public Firebase Web App config strings into
 *    `DEFAULT_FIREBASE_CONFIG` below so all visitors automatically connect to
 *    your Firebase project without pasting config manually.
 * ============================================================================
 */

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
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
 * Loads the active Firebase configuration from:
 * 1. URL query parameter `?firebaseConfig=<base64>` (optional share link)
 * 2. Browser `localStorage` (set via the Android Setup Modal)
 * 3. `DEFAULT_FIREBASE_CONFIG` in `js/config.js`
 */
export function getFirebaseConfig() {
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

  if (isValidFirebaseConfig(DEFAULT_FIREBASE_CONFIG)) {
    return DEFAULT_FIREBASE_CONFIG;
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
