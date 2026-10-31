/**
 * ============================================================================
 * PRIVATE CHAT — AUTHENTICATION & ACCESS CODE VERIFICATION (js/auth.js)
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

export async function sha256Hex(input) {
  const normalized = String(input || "").trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function validateDisplayName(rawName) {
  const cleaned = String(rawName || "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 30) {
    throw new Error("Display name must be between 2 and 30 characters.");
  }
  return cleaned;
}

export async function loginWithAccessCode({ auth, db, displayName, accessCode }) {
  const cleanName = validateDisplayName(displayName);
  const cleanCode = String(accessCode || "").trim();

  if (cleanCode.length < 4 || cleanCode.length > 64) {
    throw new Error("Secret Access Code must be between 4 and 64 characters.");
  }

  const accessHash = await sha256Hex(cleanCode);

  let userCredential;
  try {
    userCredential = await signInAnonymously(auth);
  } catch (err) {
    throw new Error(`Firebase Auth error: ${err?.message || "Failed to sign in."}`);
  }

  const user = userCredential.user;

  // Auto-initialize /config/access if the database doesn't have a code set yet
  try {
    const configSnap = await getDoc(doc(db, "config", "access")).catch(() => null);
    if (!configSnap || !configSnap.exists()) {
      await setDoc(doc(db, "config", "access"), {
        secretHash: accessHash,
        createdAt: serverTimestamp()
      }).catch(() => {});
    }
  } catch (_) {}

  // Write authorization claim
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
    throw new Error("Galat Secret Access Code! Kripya sahi code daalein.");
  }

  sessionStorage.setItem("private_chat_display_name", cleanName);

  return {
    uid: user.uid,
    displayName: cleanName
  };
}

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
