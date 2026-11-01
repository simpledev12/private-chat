/**
 * ============================================================================
 * PRIVATE CHAT — AUTHENTICATION & ROOM ID DERIVATION (js/auth.js)
 * ============================================================================
 */

import {
  signInAnonymously,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  doc,
  deleteDoc
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

/**
 * Authenticates user anonymously and derives a unique roomId from the Secret Access Code.
 */
export async function loginWithAccessCode({ auth, displayName, accessCode }) {
  const cleanName = validateDisplayName(displayName);
  const cleanCode = String(accessCode || "").trim();

  if (cleanCode.length < 4 || cleanCode.length > 64) {
    throw new Error("Secret Access Code must be between 4 and 64 characters.");
  }

  // Derive unique 32-character roomId from SHA-256 hash of the entered Secret Access Code
  const fullHash = await sha256Hex(cleanCode);
  const roomId = `room_${fullHash.slice(0, 32)}`;

  let userCredential;
  try {
    userCredential = await signInAnonymously(auth);
  } catch (err) {
    throw new Error(`Firebase Auth error: ${err?.message || "Failed to sign in."}`);
  }

  const user = userCredential.user;

  return {
    uid: user.uid,
    displayName: cleanName,
    roomId: roomId,
    roomCode: cleanCode
  };
}

export async function logoutAndRevoke({ auth, db, uid, roomId }) {
  if (uid && db && roomId) {
    await Promise.allSettled([
      deleteDoc(doc(db, "rooms", roomId, "presence", uid))
    ]);
  }
  if (auth) {
    await signOut(auth);
  }
}

export { onAuthStateChanged };
