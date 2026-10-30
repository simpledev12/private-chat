/**
 * ============================================================================
 * PRIVATE CHAT — REAL-TIME FIRESTORE CHAT, PRESENCE & EMOJIS (js/chat.js)
 * ============================================================================
 * Features:
 * 1. Real-time message synchronization using Firestore `onSnapshot`.
 * 2. Sender display name + formatted timestamps + date dividers.
 * 3. Live online users tracking (`/presence/{uid}`) with heartbeat & cleanup.
 * 4. Categorized touch-friendly Emoji Picker.
 * 5. Message length limit (1–500 chars) + anti-spam cooldown & burst guard.
 * ============================================================================
 */

import {
  collection,
  doc,
  addDoc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  limitToLast,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const MAX_MESSAGE_LENGTH = 500;
const COOLDOWN_MS = 1500;
const BURST_WINDOW_MS = 10000;
const MAX_BURST_MESSAGES = 5;
const PRESENCE_HEARTBEAT_MS = 30000;
const PRESENCE_STALE_MS = 95000;

export const EMOJI_CATEGORIES = {
  smileys: [
    "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣",
    "😊", "😇", "🙂", "😉", "😌", "😍", "🥰", "😘",
    "😋", "😛", "😜", "🤪", "🤨", "🧐", "🤓", "😎",
    "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁",
    "😮", "😯", "😲", "😳", "🥺", "😢", "😭", "😤"
  ],
  gestures: [
    "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏",
    "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆",
    "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜",
    "👏", "🙌", "👐", "🤲", "🤝", "🙏", "💪", "🫡"
  ],
  hearts: [
    "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍",
    "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖",
    "💘", "💝", "💟", "♥️", "🫶", "💌", "💐", "🌹"
  ],
  reactions: [
    "🔥", "✨", "🌟", "💫", "💥", "💯", "✅", "❌",
    "⚡", "🚀", "🎯", "🏆", "🥇", "💎", "👑", "🎉",
    "🎊", "🎈", "🙌", "👀", "🤔", "🫡", "🤝", "💤"
  ],
  objects: [
    "📱", "💻", "⌚", "📷", "🎧", "🎤", "🎬", "🎮",
    "☕", "🍵", "🍕", "🍔", "🍟", "🌮", "🍰", "🍫",
    "⚽", "🏀", "🏏", "🏆", "🎸", "✈️", "🏠", "🔒"
  ]
};

const SENDER_COLORS = [
  "#00a884",
  "#53bdeb",
  "#ff7f50",
  "#e879f9",
  "#f59e0b",
  "#34d399",
  "#60a5fa",
  "#f472b6"
];

/**
 * Deterministic color picker for sender names in group chat bubbles.
 */
export function getSenderColor(senderId = "") {
  let hash = 0;
  for (let i = 0; i < senderId.length; i++) {
    hash = senderId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % SENDER_COLORS.length;
  return SENDER_COLORS[index];
}

/**
 * Formats a Firestore Timestamp into a short time string (e.g., "6:10 PM").
 */
export function formatMessageTime(timestamp) {
  const date = timestamp?.toDate ? timestamp.toDate() : new Date();
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Formats a Firestore Timestamp into a date divider label ("Today", "Yesterday", or "Oct 30, 2026").
 */
export function formatDateDivider(timestamp) {
  const date = timestamp?.toDate ? timestamp.toDate() : new Date();
  const now = new Date();

  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(date, now)) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

/**
 * Controller class managing real-time messages, online presence, and spam protection.
 */
export class ChatRoomController {
  constructor({ db, currentUser, onMessagesUpdate, onPresenceUpdate, onAuthRevoked }) {
    this.db = db;
    this.currentUser = currentUser;
    this.onMessagesUpdate = onMessagesUpdate;
    this.onPresenceUpdate = onPresenceUpdate;
    this.onAuthRevoked = onAuthRevoked;

    this.unsubscribeMessages = null;
    this.unsubscribePresence = null;
    this.heartbeatTimer = null;
    this.presenceRefreshTimer = null;
    this.latestPresenceDocs = [];

    this.lastSentAt = 0;
    this.lastSentText = "";
    this.recentSendTimestamps = [];

    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
  }

  /**
   * Starts real-time Firestore listeners for messages and online presence.
   */
  async start() {
    // 1. Subscribe to `/messages` ordered by creation time
    const messagesQuery = query(
      collection(this.db, "messages"),
      orderBy("createdAt", "asc"),
      limitToLast(150)
    );

    this.unsubscribeMessages = onSnapshot(
      messagesQuery,
      (snapshot) => {
        const messages = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data()
        }));
        this.onMessagesUpdate(messages);
      },
      (error) => {
        if (error?.code === "permission-denied" && this.onAuthRevoked) {
          this.onAuthRevoked("Session expired or Secret Access Code was rotated.");
        }
      }
    );

    // 2. Subscribe to `/presence` for online users indicator
    const presenceRef = collection(this.db, "presence");
    this.unsubscribePresence = onSnapshot(
      presenceRef,
      (snapshot) => {
        this.latestPresenceDocs = snapshot.docs.map((d) => d.data());
        this.emitFilteredPresence();
      },
      () => {}
    );

    // 3. Announce presence and start heartbeat
    await this.updatePresence(true);
    this.heartbeatTimer = setInterval(() => {
      if (document.visibilityState === "visible") {
        this.updatePresence(true);
      }
    }, PRESENCE_HEARTBEAT_MS);

    this.presenceRefreshTimer = setInterval(() => {
      this.emitFilteredPresence();
    }, 15000);

    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("pagehide", this.handleBeforeUnload);
  }

  /**
   * Filters presence list to active users seen within PRESENCE_STALE_MS.
   */
  emitFilteredPresence() {
    const now = Date.now();
    const activeUsers = this.latestPresenceDocs.filter((entry) => {
      if (!entry?.online) return false;
      if (entry.uid === this.currentUser.uid) return true;
      const lastSeenMs = entry.lastSeen?.toMillis ? entry.lastSeen.toMillis() : now;
      return now - lastSeenMs < PRESENCE_STALE_MS;
    });

    // Ensure current user appears in the active list
    if (!activeUsers.some((u) => u.uid === this.currentUser.uid)) {
      activeUsers.unshift({
        uid: this.currentUser.uid,
        displayName: this.currentUser.displayName,
        online: true
      });
    }

    this.onPresenceUpdate(activeUsers);
  }

  /**
   * Updates `/presence/{uid}` in Cloud Firestore.
   */
  async updatePresence(isOnline) {
    if (!this.currentUser?.uid) return;
    try {
      const ref = doc(this.db, "presence", this.currentUser.uid);
      if (isOnline) {
        await setDoc(ref, {
          uid: this.currentUser.uid,
          displayName: this.currentUser.displayName,
          online: true,
          lastSeen: serverTimestamp()
        });
      } else {
        await deleteDoc(ref);
      }
    } catch (_) {
      // Ignore transient network errors during background heartbeat
    }
  }

  handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      this.updatePresence(true);
    }
  }

  handleBeforeUnload() {
    this.updatePresence(false);
  }

  /**
   * Validates and sends a chat message with length limits and anti-spam protection.
   */
  async sendMessage(rawText) {
    const cleanText = String(rawText || "").trim();

    if (!cleanText) {
      throw new Error("Cannot send an empty message.");
    }

    if (cleanText.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message exceeds maximum limit of ${MAX_MESSAGE_LENGTH} characters.`);
    }

    const now = Date.now();

    // 1. Cooldown check (1.5s between messages)
    if (now - this.lastSentAt < COOLDOWN_MS) {
      const waitSec = ((COOLDOWN_MS - (now - this.lastSentAt)) / 1000).toFixed(1);
      throw new Error(`Slow down! Wait ${waitSec}s before sending another message.`);
    }

    // 2. Burst rate-limit check (max 5 messages per 10 seconds)
    this.recentSendTimestamps = this.recentSendTimestamps.filter(
      (ts) => now - ts < BURST_WINDOW_MS
    );
    if (this.recentSendTimestamps.length >= MAX_BURST_MESSAGES) {
      throw new Error("Rate limit reached: Please wait a few seconds before sending more messages.");
    }

    // 3. Consecutive identical spam check
    if (cleanText === this.lastSentText && now - this.lastSentAt < 8000) {
      throw new Error("Duplicate message blocked to prevent spam.");
    }

    this.lastSentAt = now;
    this.lastSentText = cleanText;
    this.recentSendTimestamps.push(now);

    await addDoc(collection(this.db, "messages"), {
      text: cleanText,
      senderId: this.currentUser.uid,
      senderName: this.currentUser.displayName,
      createdAt: serverTimestamp()
    });
  }

  /**
   * Unsubscribes all listeners and cleans up presence timers.
   */
  async stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.presenceRefreshTimer) clearInterval(this.presenceRefreshTimer);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("pagehide", this.handleBeforeUnload);

    if (this.unsubscribeMessages) this.unsubscribeMessages();
    if (this.unsubscribePresence) this.unsubscribePresence();
  }
}
