/**
 * ============================================================================
 * PRIVATE CHAT — AUTHENTICATION & BACKEND ACCESS CODE VERIFICATION (js/auth.js)
 * ============================================================================
 * Security Model (100% Spark Plan Compatible — Zero Frontend Secrets):
 * 1. The Secret Access Code is NEVER stored in frontend JavaScript.
 * 2. When a user logs in, we sign them in via Firebase Anonymous Auth to issue
 *    a unique cryptographic `request.auth.uid`.
 * 3. We hash the user-entered Secret Access Code using Web Crypto SHA-256
 *    (`crypto.subtle.digest`) and write `/authorizedUsers/{uid}` with
 *    `{ uid, displayName, accessHash, authorizedAt, lastMessageAt }`.
 * 4. Cloud Firestore Security Rules (`firestore.rules`) validate on the
 *    Firebase backend that `accessHash` matches `/config/access.secretHash`
 *    (a locked backend document with `allow read: if false;`).
 * 5. If the code does not match, the Firebase backend rejects the transaction
 *    with `permission-denied` and the user is immediately signed out.
 * ============================================================================
 */

import {
  signInAnonymously,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/**
 * Computes a 64-character lowercase hexadecimal SHA-256 digest of a string.
 */
export async function sha256Hex(input) {
  const normalized = String(input || "").trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Sanitizes and validates the user's display name.
 */
export function validateDisplayName(rawName) {
  const cleaned = String(rawName || "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 30) {
    throw new Error("Display name must be between 2 and 30 characters.");
  }
  return cleaned;
}

/**
 * Authenticates the user with Firebase Auth and verifies their Secret Access
 * Code against the Cloud Firestore backend security rules.
 */
export async function loginWithAccessCode({
  auth,
  db,
  displayName,
  accessCode,
  initializeRoom = false
}) {
  const cleanName = validateDisplayName(displayName);
  const cleanCode = String(accessCode || "").trim();

  if (cleanCode.length < 4 || cleanCode.length > 64) {
    throw new Error("Secret Access Code must be between 4 and 64 characters.");
  }

  // 1. Compute SHA-256 hash of the entered access code
  const accessHash = await sha256Hex(cleanCode);

  // 2. Authenticate with Firebase Anonymous Authentication
  let userCredential;
  try {
    userCredential = await signInAnonymously(auth);
  } catch (err) {
    if (err?.code === "auth/operation-not-allowed") {
      throw new Error(
        "Anonymous Auth is not enabled yet. In Firebase Console -> Authentication -> Sign-in method, enable 'Anonymous'."
      );
    }
    throw new Error(`Firebase Auth error: ${err?.message || "Failed to sign in."}`);
  }

  const user = userCredential.user;

  // 3. Optional First-Time Room Initialization:
  // Creates `/config/access` ONLY if it does not exist yet (enforced by firestore.rules)
  if (initializeRoom) {
    try {
      await setDoc(doc(db, "config", "access"), {
        secretHash: accessHash,
        createdAt: serverTimestamp()
      });
    } catch (initErr) {
      await signOut(auth).catch(() => {});
      if (initErr?.code === "permission-denied") {
        throw new Error(
          "This room already has a Secret Access Code configured in Firestore (/config/access). Uncheck 'First-time setup' and enter the existing code."
        );
      }
      throw new Error(`Failed to initialize room secret: ${initErr?.message || initErr}`);
    }
  }

  // 4. Write authorization claim to `/authorizedUsers/{uid}`.
  // Firestore Security Rules verify `accessHash == get(/config/access).data.secretHash` on the backend.
  try {
    await setDoc(doc(db, "authorizedUsers", user.uid), {
      uid: user.uid,
      displayName: cleanName,
      accessHash: accessHash,
      authorizedAt: serverTimestamp(),
      lastMessageAt: null
    });
  } catch (verifyErr) {
    await signOut(auth).catch(() => {});
    if (verifyErr?.code === "permission-denied") {
      throw new Error(
        "Access Denied by Firebase Backend: Invalid Secret Access Code (or if this is a brand-new database, check 'First-time setup' once to set your room's Secret Access Code)."
      );
    }
    throw new Error(`Authorization failed: ${verifyErr?.message || verifyErr}`);
  }

  // Save non-sensitive display name locally for session restore
  sessionStorage.setItem("private_chat_display_name", cleanName);

  return {
    uid: user.uid,
    displayName: cleanName
  };
}

/**
 * Checks if an already-signed-in Firebase user still has a valid `/authorizedUsers/{uid}` record.
 */
export async function checkExistingSession(db, user) {
  if (!user) return null;
  try {
    const snap = await getDoc(doc(db, "authorizedUsers", user.uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!data?.displayName) return null;
    return {
      uid: user.uid,
      displayName: data.displayName
    };
  } catch (_) {
    return null;
  }
}

/**
 * Cleans up user presence and authorization records and signs out of Firebase Auth.
 */
export async function logoutAndRevoke({ auth, db, uid }) {
  if (uid && db) {
    await Promise.allSettled([
      deleteDoc(doc(db, "presence", uid)),
      deleteDoc(doc(db, "authorizedUsers", uid))
    ]);
  }
  sessionStorage.removeItem("private_chat_display_name");
  if (auth) {
    await signOut(auth);
  }
}

export { onAuthStateChanged };
