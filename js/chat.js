/**
 * ============================================================================
 * PRIVATE CHAT — REAL-TIME FIRESTORE CHAT, PRESENCE & EMOJIS (js/chat.js)
 * ============================================================================
 */

import {
  collection,
  doc,
  query,
  orderBy,
  limitToLast,
  onSnapshot,
  setDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const MAX_MESSAGE_LENGTH = 500;
export const SPAM_COOLDOWN_MS = 1500;
const PRESENCE_HEARTBEAT_MS = 30000;
const PRESENCE_STALE_MS = 95000;

export const EMOJI_CATEGORIES = {
  smileys: [
    "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣",
    "😊", "😇", "🙂", "😉", "😌", "😍", "🥰", "😘",
    "😋", "😛", "😜", "🤪", "🤨", "🧐", "🤓", "😎"
  ],
  gestures: [
    "👋", "🤚", "🖐️", "✋", "👌", "🤌", "🤏", "✌️",
    "🤞", "🤟", "🤘", "🤙", "👍", "👎", "✊", "👊",
    "👏", "🙌", "👐", "🤲", "🤝", "🙏", "💪", "🫡"
  ],
  hearts: [
    "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍",
    "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖",
    "💘", "💝", "💟", "♥️", "🫶", "💌", "💐", "🌹"
  ],
  reactions: [
    "🔥", "✨", "🌟", "💫", "⚡", "💥", "💯", "✅",
    "❌", "⚠️", "🚀", "🎯", "🏆", "🥇", "💡", "🔔",
    "👀", "🎉", "🎊", "🥳", "🤩", "🤯", "🤔", "😴"
  ],
  objects: [
    "📱", "💻", "⌚", "📷", "🎧", "🎤", "🎬", "🎮",
    "☕", "🍕", "🍔", "🍟", "🌮", "🍜", "🍩", "🎂",
    "⚽", "🏀", "🏏", "🚗", "✈️", "🏠", "🌈", "☀️"
  ]
};

const SENDER_COLORS = [
  "#00a884",
  "#53bdeb",
  "#ff7f50",
  "#e879f9",
  "#facc15",
  "#fb7185",
  "#34d399",
  "#a78bfa"
];

/**
 * Deterministic color for each sender's name in group chat bubbles.
 */
function getSenderColor(senderId) {
  let hash = 0;
  const str = String(senderId || "");
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}

/**
 * Formats a Firestore Timestamp or Date into HH:MM AM/PM.
 */
function formatTime(timestamp) {
  const date = timestamp?.toDate ? timestamp.toDate() : new Date();
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Formats a date label for message day dividers (Today, Yesterday, or Date).
 */
function formatDateHeading(timestamp) {
  const date = timestamp?.toDate ? timestamp.toDate() : new Date();
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

/**
 * Manages real-time messages, online presence, and spam rate-limiting.
 */
export class ChatController {
  constructor({
    db,
    currentUser,
    messagesListEl,
    messagesContainerEl,
    onlineCountEl,
    onlineUsersListEl,
    onPermissionRevoked
  }) {
    this.db = db;
    this.currentUser = currentUser;
    this.messagesListEl = messagesListEl;
    this.messagesContainerEl = messagesContainerEl;
    this.onlineCountEl = onlineCountEl;
    this.onlineUsersListEl = onlineUsersListEl;
    this.onPermissionRevoked = onPermissionRevoked;

    this.unsubscribeMessages = null;
    this.unsubscribePresence = null;
    this.heartbeatTimer = null;

    this.lastSentAt = 0;
    this.lastSentText = "";
  }

  /**
   * Starts real-time Firestore listeners for messages and online presence.
   */
  start() {
    this.subscribeToMessages();
    this.startPresenceTracking();
  }

  /**
   * Subscribes to the shared room's messages collection in real time.
   */
  subscribeToMessages() {
    const messagesQuery = query(
      collection(this.db, "messages"),
      orderBy("createdAt", "asc"),
      limitToLast(150)
    );

    this.unsubscribeMessages = onSnapshot(
      messagesQuery,
      (snapshot) => {
        this.renderMessages(snapshot.docs);
      },
      (error) => {
        if (error?.code === "permission-denied" && this.onPermissionRevoked) {
          this.onPermissionRevoked(
            "Session expired or access code changed. Please sign in again."
          );
        }
      }
    );
  }

  /**
   * Renders all messages cleanly using safe DOM textContent (XSS-proof).
   */
  renderMessages(docs) {
    const container = this.messagesContainerEl;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 140;

    this.messagesListEl.innerHTML = "";
    let lastDateLabel = null;

    docs.forEach((docSnap) => {
      const data = docSnap.data();
      const dateLabel = formatDateHeading(data.createdAt);

      if (dateLabel !== lastDateLabel) {
        lastDateLabel = dateLabel;
        const divider = document.createElement("div");
        divider.className = "date-divider";
        divider.textContent = dateLabel;
        this.messagesListEl.appendChild(divider);
      }

      const isOutgoing = data.senderId === this.currentUser.uid;
      const row = document.createElement("div");
      row.className = `message-row ${isOutgoing ? "outgoing" : "incoming"}`;

      const bubble = document.createElement("div");
      bubble.className = "message-bubble";

      if (!isOutgoing) {
        const senderEl = document.createElement("span");
        senderEl.className = "sender-name";
        senderEl.style.color = getSenderColor(data.senderId);
        senderEl.textContent = data.senderName || "Member";
        bubble.appendChild(senderEl);
      }

      const textEl = document.createElement("span");
      textEl.className = "message-text";
      textEl.textContent = data.text || "";
      bubble.appendChild(textEl);

      const metaEl = document.createElement("span");
      metaEl.className = "message-meta";

      const timeEl = document.createElement("span");
      timeEl.textContent = formatTime(data.createdAt);
      metaEl.appendChild(timeEl);

      if (isOutgoing) {
        const checkEl = document.createElement("span");
        checkEl.className = "check-icon";
        checkEl.textContent = "✓✓";
        metaEl.appendChild(checkEl);
      }

      bubble.appendChild(metaEl);
      row.appendChild(bubble);
      this.messagesListEl.appendChild(row);
    });

    if (isNearBottom || docs.length <= 20) {
      container.scrollTop = container.scrollHeight;
    }
  }

  /**
   * Validates and sends a chat message with rate limiting and spam protection.
   */
  async sendMessage(rawText) {
    const cleaned = String(rawText || "")
      .replace(/\r\n/g, "\n")
      .trim();

    if (!cleaned) {
      throw new Error("Cannot send an empty message.");
    }

    if (cleaned.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message exceeds maximum limit of ${MAX_MESSAGE_LENGTH} characters.`);
    }

    const now = Date.now();
    const elapsed = now - this.lastSentAt;

    if (elapsed < SPAM_COOLDOWN_MS) {
      const waitSec = ((SPAM_COOLDOWN_MS - elapsed) / 1000).toFixed(1);
      throw new Error(`Slow down! Please wait ${waitSec}s before sending another message.`);
    }

    if (cleaned === this.lastSentText && elapsed < 10000) {
      throw new Error("Duplicate message blocked by spam protection.");
    }

    this.lastSentAt = now;
    this.lastSentText = cleaned;

    // Atomic batch write: create message + update user's `lastMessageAt` timestamp
    const batch = writeBatch(this.db);
    const newMsgRef = doc(collection(this.db, "messages"));
    const userAuthRef = doc(this.db, "authorizedUsers", this.currentUser.uid);

    batch.set(newMsgRef, {
      text: cleaned,
      senderId: this.currentUser.uid,
      senderName: this.currentUser.displayName,
      createdAt: serverTimestamp()
    });

    batch.update(userAuthRef, {
      lastMessageAt: serverTimestamp()
    });

    await batch.commit();

    // Scroll to bottom after sending
    this.messagesContainerEl.scrollTop = this.messagesContainerEl.scrollHeight;
  }

  /**
   * Publishes user presence and subscribes to active online members in real time.
   */
  startPresenceTracking() {
    const updateMyPresence = async (onlineStatus = true) => {
      try {
        await setDoc(doc(this.db, "presence", this.currentUser.uid), {
          uid: this.currentUser.uid,
          displayName: this.currentUser.displayName,
          online: onlineStatus,
          lastSeen: serverTimestamp()
        });
      } catch (_) {
        // Ignore transient offline errors
      }
    };

    updateMyPresence(true);
    this.heartbeatTimer = setInterval(() => updateMyPresence(true), PRESENCE_HEARTBEAT_MS);

    this.visibilityHandler = () => {
      if (document.visibilityState === "visible") {
        updateMyPresence(true);
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);

    const presenceQuery = query(collection(this.db, "presence"));
    this.unsubscribePresence = onSnapshot(
      presenceQuery,
      (snapshot) => {
        const now = Date.now();
        const activeUsers = [];

        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          if (!data?.online) return;
          const lastSeenMs = data.lastSeen?.toMillis ? data.lastSeen.toMillis() : now;
          if (now - lastSeenMs <= PRESENCE_STALE_MS) {
            activeUsers.push(data);
          }
        });

        this.renderOnlineUsers(activeUsers);
      },
      () => {}
    );
  }

  /**
   * Renders the online user counter and drawer chips.
   */
  renderOnlineUsers(users) {
    const count = Math.max(1, users.length);
    this.onlineCountEl.textContent = `${count} online`;
    this.onlineUsersListEl.innerHTML = "";

    const list =
      users.length > 0
        ? users
        : [{ uid: this.currentUser.uid, displayName: this.currentUser.displayName }];

    list.forEach((u) => {
      const li = document.createElement("li");
      li.className = "online-user-chip";

      const dot = document.createElement("span");
      dot.className = "online-dot";
      li.appendChild(dot);

      const nameSpan = document.createElement("span");
      const isMe = u.uid === this.currentUser.uid;
      nameSpan.textContent = isMe ? `${u.displayName} (You)` : u.displayName;
      li.appendChild(nameSpan);

      this.onlineUsersListEl.appendChild(li);
    });
  }

  /**
   * Stops all listeners and timers when logging out.
   */
  stop() {
    if (this.unsubscribeMessages) {
      this.unsubscribeMessages();
      this.unsubscribeMessages = null;
    }
    if (this.unsubscribePresence) {
      this.unsubscribePresence();
      this.unsubscribePresence = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }
}
