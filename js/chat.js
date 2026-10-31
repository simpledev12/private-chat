/**
 * ============================================================================
 * PRIVATE CHAT — REAL-TIME FIRESTORE CHAT, PHOTOS, DELETE & PRESENCE (js/chat.js)
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
  deleteDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const MAX_MESSAGE_LENGTH = 500;
export const MAX_IMAGE_DATA_LENGTH = 240000;
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
 * Compresses a selected image file on the client using an HTML5 Canvas so it can
 * be stored directly inside Cloud Firestore on the 100% Free Spark Plan
 * (no paid Firebase Storage / Blaze plan required).
 */
export function compressImageFile(file, maxDimension = 720, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Please select a valid image file."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid or corrupted image file."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        let dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.length > MAX_IMAGE_DATA_LENGTH) {
          // Compress slightly further if the photo is very detailed
          dataUrl = canvas.toDataURL("image/jpeg", 0.52);
        }

        if (dataUrl.length > MAX_IMAGE_DATA_LENGTH) {
          reject(new Error("Photo is too large even after compression. Please pick a smaller photo."));
          return;
        }

        const approxKb = Math.round((dataUrl.length * 3) / 4 / 1024);
        resolve({ dataUrl, approxKb, width, height });
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Manages real-time messages, photos, message deletion, online presence, and spam rate-limiting.
 */
export class ChatController {
  constructor({
    db,
    currentUser,
    messagesListEl,
    messagesContainerEl,
    onlineCountEl,
    onlineUsersListEl,
    onPermissionRevoked,
    onPhotoClick,
    onNotify
  }) {
    this.db = db;
    this.currentUser = currentUser;
    this.messagesListEl = messagesListEl;
    this.messagesContainerEl = messagesContainerEl;
    this.onlineCountEl = onlineCountEl;
    this.onlineUsersListEl = onlineUsersListEl;
    this.onPermissionRevoked = onPermissionRevoked;
    this.onPhotoClick = onPhotoClick;
    this.onNotify = onNotify;

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
   * Renders all messages, photos, and sender-only delete buttons safely.
   */
  renderMessages(docs) {
    const container = this.messagesContainerEl;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 140;

    this.messagesListEl.innerHTML = "";
    let lastDateLabel = null;

    docs.forEach((docSnap) => {
      const msgId = docSnap.id;
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

      // Render Photo if attached (strictly validate data:image/ prefix)
      if (
        typeof data.imageData === "string" &&
        data.imageData.startsWith("data:image/")
      ) {
        const photoWrap = document.createElement("div");
        photoWrap.className = "message-photo-wrap";

        const imgEl = document.createElement("img");
        imgEl.className = "message-photo";
        imgEl.src = data.imageData;
        imgEl.alt = `Photo from ${data.senderName || "Member"}`;
        imgEl.loading = "lazy";
        imgEl.addEventListener("click", () => {
          if (this.onPhotoClick) this.onPhotoClick(data.imageData);
        });

        photoWrap.appendChild(imgEl);
        bubble.appendChild(photoWrap);
      }

      if (data.text) {
        const textEl = document.createElement("span");
        textEl.className = "message-text";
        textEl.textContent = data.text;
        bubble.appendChild(textEl);
      }

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

        // Delete button (only shown on user's own messages)
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "delete-msg-btn";
        delBtn.title = "Delete message for everyone";
        delBtn.setAttribute("aria-label", "Delete message");
        delBtn.textContent = "🗑️";
        delBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await this.deleteMessage(msgId);
        });
        metaEl.appendChild(delBtn);
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
   * Deletes a message sent by the current user for everyone in the room.
   */
  async deleteMessage(messageId) {
    if (!messageId) return;
    const confirmed = window.confirm("Delete this message for everyone?");
    if (!confirmed) return;

    try {
      await deleteDoc(doc(this.db, "messages", messageId));
      if (this.onNotify) {
        this.onNotify("Message deleted for everyone.");
      }
    } catch (err) {
      if (this.onNotify) {
        this.onNotify(err?.message || "Could not delete message.");
      }
    }
  }

  /**
   * Validates and sends a chat message (text, photo, or photo + caption) with spam protection.
   */
  async sendMessage(rawText, imageData = null) {
    const cleaned = String(rawText || "")
      .replace(/\r\n/g, "\n")
      .trim();

    if (!cleaned && !imageData) {
      throw new Error("Please enter a message or attach a photo.");
    }

    if (cleaned.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message exceeds maximum limit of ${MAX_MESSAGE_LENGTH} characters.`);
    }

    if (imageData && (!imageData.startsWith("data:image/") || imageData.length > MAX_IMAGE_DATA_LENGTH)) {
      throw new Error("Attached photo is invalid or exceeds size limit.");
    }

    const now = Date.now();
    const elapsed = now - this.lastSentAt;

    if (elapsed < SPAM_COOLDOWN_MS) {
      const waitSec = ((SPAM_COOLDOWN_MS - elapsed) / 1000).toFixed(1);
      throw new Error(`Slow down! Please wait ${waitSec}s before sending another message.`);
    }

    if (!imageData && cleaned === this.lastSentText && elapsed < 10000) {
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
      imageData: imageData || null,
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
