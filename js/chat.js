/**
 * ============================================================================
 * PRIVATE CHAT — REAL-TIME CHAT, REPLIES, REACTIONS, VOICE NOTES, EDIT & DELETE
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
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const MAX_MESSAGE_LENGTH = 500;
export const MAX_MEDIA_DATA_LENGTH = 240000;
export const SPAM_COOLDOWN_MS = 1500;
const PRESENCE_HEARTBEAT_MS = 30000;
const PRESENCE_STALE_MS = 95000;
const TYPING_STALE_MS = 8000;

export const QUICK_REACTIONS = ["❤️", "😂", "👍", "🔥", "🙏"];

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

function getSenderColor(senderId) {
  let hash = 0;
  const str = String(senderId || "");
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}

function formatTime(timestamp) {
  const date = timestamp?.toDate ? timestamp.toDate() : new Date();
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

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
 * Plays a gentle WhatsApp-inspired incoming message pop sound using Web Audio API
 * and vibrates lightly on Android devices.
 */
export function playIncomingAlert(soundEnabled = true) {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(35);
    }
    if (!soundEnabled) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(580, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(860, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.11);
  } catch (_) {}
}

/**
 * Compresses a selected image file on the client using an HTML5 Canvas so it can
 * be stored directly inside Cloud Firestore on the 100% Free Spark Plan.
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
        if (dataUrl.length > MAX_MEDIA_DATA_LENGTH) {
          dataUrl = canvas.toDataURL("image/jpeg", 0.52);
        }

        if (dataUrl.length > MAX_MEDIA_DATA_LENGTH) {
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
 * Manages real-time messages, replies, reactions, voice notes, edits, deletes, & typing indicators.
 */
export class ChatController {
  constructor({
    db,
    currentUser,
    messagesListEl,
    messagesContainerEl,
    onlineCountEl,
    typingStatusEl,
    tapViewHintEl,
    onlineUsersListEl,
    scrollBottomBtnEl,
    onPermissionRevoked,
    onPhotoClick,
    onReplySelect,
    onEditSelect,
    onNotify,
    isSoundEnabled
  }) {
    this.db = db;
    this.currentUser = currentUser;
    this.messagesListEl = messagesListEl;
    this.messagesContainerEl = messagesContainerEl;
    this.onlineCountEl = onlineCountEl;
    this.typingStatusEl = typingStatusEl;
    this.tapViewHintEl = tapViewHintEl;
    this.onlineUsersListEl = onlineUsersListEl;
    this.scrollBottomBtnEl = scrollBottomBtnEl;
    this.onPermissionRevoked = onPermissionRevoked;
    this.onPhotoClick = onPhotoClick;
    this.onReplySelect = onReplySelect;
    this.onEditSelect = onEditSelect;
    this.onNotify = onNotify;
    this.isSoundEnabled = isSoundEnabled;

    this.unsubscribeMessages = null;
    this.unsubscribePresence = null;
    this.heartbeatTimer = null;
    this.typingTimeout = null;
    this.isTyping = false;

    this.initialLoadDone = false;
    this.knownMessageIds = new Set();

    this.lastSentAt = 0;
    this.lastSentText = "";
  }

  start() {
    this.subscribeToMessages();
    this.startPresenceTracking();
  }

  subscribeToMessages() {
    const messagesQuery = query(
      collection(this.db, "messages"),
      orderBy("createdAt", "asc"),
      limitToLast(150)
    );

    this.unsubscribeMessages = onSnapshot(
      messagesQuery,
      (snapshot) => {
        let hasNewIncoming = false;
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const msgId = change.doc.id;
            const data = change.doc.data();
            if (this.initialLoadDone && !this.knownMessageIds.has(msgId)) {
              if (data.senderId !== this.currentUser.uid) {
                hasNewIncoming = true;
              }
            }
            this.knownMessageIds.add(msgId);
          }
        });

        this.renderMessages(snapshot.docs, hasNewIncoming);
        this.initialLoadDone = true;

        if (hasNewIncoming) {
          playIncomingAlert(this.isSoundEnabled ? this.isSoundEnabled() : true);
        }
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

  renderMessages(docs, hasNewIncoming = false) {
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
      row.id = `msg-${msgId}`;

      const bubble = document.createElement("div");
      bubble.className = "message-bubble";

      if (!isOutgoing) {
        const senderEl = document.createElement("span");
        senderEl.className = "sender-name";
        senderEl.style.color = getSenderColor(data.senderId);
        senderEl.textContent = data.senderName || "Member";
        bubble.appendChild(senderEl);
      }

      // 1. Render Quoted Reply Box if `data.replyTo` exists
      if (data.replyTo && typeof data.replyTo === "object") {
        const quoteBox = document.createElement("div");
        quoteBox.className = "reply-quote-box";

        const qSender = document.createElement("span");
        qSender.className = "reply-quote-sender";
        qSender.textContent = data.replyTo.senderName || "Member";
        quoteBox.appendChild(qSender);

        const qText = document.createElement("span");
        qText.className = "reply-quote-text";
        qText.textContent = data.replyTo.text || "Attachment";
        quoteBox.appendChild(qText);

        quoteBox.addEventListener("click", () => {
          const targetEl = document.getElementById(`msg-${data.replyTo.id}`);
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
            const targetBubble = targetEl.querySelector(".message-bubble");
            if (targetBubble) {
              targetBubble.classList.add("highlight-flash");
              setTimeout(() => targetBubble.classList.remove("highlight-flash"), 1400);
            }
          }
        });

        bubble.appendChild(quoteBox);
      }

      // 2. Render Photo if attached
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

      // 3. Render Audio / Voice Note if attached
      if (
        typeof data.audioData === "string" &&
        data.audioData.startsWith("data:audio/")
      ) {
        const audioWrap = document.createElement("div");
        audioWrap.className = "message-audio-wrap";

        const audioEl = document.createElement("audio");
        audioEl.className = "message-audio";
        audioEl.controls = true;
        audioEl.preload = "metadata";
        audioEl.src = data.audioData;

        audioWrap.appendChild(audioEl);
        bubble.appendChild(audioWrap);
      }

      // 4. Render Text
      if (data.text) {
        const textEl = document.createElement("span");
        textEl.className = "message-text";
        textEl.textContent = data.text;
        bubble.appendChild(textEl);
      }

      // 5. Render Emoji Reactions Badges
      const reactionsMap =
        data.reactions && typeof data.reactions === "object" ? data.reactions : {};
      const countsByEmoji = {};
      Object.entries(reactionsMap).forEach(([uid, emoji]) => {
        if (!QUICK_REACTIONS.includes(emoji)) return;
        if (!countsByEmoji[emoji]) countsByEmoji[emoji] = { count: 0, mine: false };
        countsByEmoji[emoji].count += 1;
        if (uid === this.currentUser.uid) countsByEmoji[emoji].mine = true;
      });

      const reactionEntries = Object.entries(countsByEmoji);
      if (reactionEntries.length > 0) {
        const badgesRow = document.createElement("div");
        badgesRow.className = "reaction-badges-row";
        reactionEntries.forEach(([emoji, info]) => {
          const pill = document.createElement("button");
          pill.type = "button";
          pill.className = `reaction-pill ${info.mine ? "mine" : ""}`;
          pill.textContent = `${emoji} ${info.count}`;
          pill.addEventListener("click", () => {
            this.toggleReaction(msgId, reactionsMap, emoji);
          });
          badgesRow.appendChild(pill);
        });
        bubble.appendChild(badgesRow);
      }

      // Quick Reaction Picker Bar (Hidden until user taps 😊+)
      const reactMenu = document.createElement("div");
      reactMenu.className = "quick-react-menu hidden";
      QUICK_REACTIONS.forEach((emoji) => {
        const rBtn = document.createElement("button");
        rBtn.type = "button";
        rBtn.className = "quick-react-btn";
        rBtn.textContent = emoji;
        rBtn.addEventListener("click", () => {
          reactMenu.classList.add("hidden");
          this.toggleReaction(msgId, reactionsMap, emoji);
        });
        reactMenu.appendChild(rBtn);
      });
      bubble.appendChild(reactMenu);

      // 6. Metadata & Action Buttons Row (Reply, React, Edit, Delete)
      const metaEl = document.createElement("span");
      metaEl.className = "message-meta";

      // Reply Button
      const replyBtn = document.createElement("button");
      replyBtn.type = "button";
      replyBtn.className = "msg-action-btn";
      replyBtn.title = "Reply to this message";
      replyBtn.textContent = "↩️";
      replyBtn.addEventListener("click", () => {
        if (this.onReplySelect) {
          const previewText =
            data.text ||
            (data.imageData ? "📷 Photo" : data.audioData ? "🎤 Voice Note" : "");
          this.onReplySelect({
            id: msgId,
            senderName: data.senderName || "Member",
            text: previewText.slice(0, 100)
          });
        }
      });
      metaEl.appendChild(replyBtn);

      // React Button
      const reactToggleBtn = document.createElement("button");
      reactToggleBtn.type = "button";
      reactToggleBtn.className = "msg-action-btn";
      reactToggleBtn.title = "React with emoji";
      reactToggleBtn.textContent = "😊";
      reactToggleBtn.addEventListener("click", () => {
        reactMenu.classList.toggle("hidden");
      });
      metaEl.appendChild(reactToggleBtn);

      // Edit & Delete Buttons (Only for outgoing messages)
      if (isOutgoing) {
        if (data.text) {
          const editBtn = document.createElement("button");
          editBtn.type = "button";
          editBtn.className = "msg-action-btn";
          editBtn.title = "Edit message";
          editBtn.textContent = "✏️";
          editBtn.addEventListener("click", () => {
            if (this.onEditSelect) {
              this.onEditSelect({ id: msgId, text: data.text });
            }
          });
          metaEl.appendChild(editBtn);
        }

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "msg-action-btn";
        delBtn.title = "Delete message for everyone";
        delBtn.textContent = "🗑️";
        delBtn.addEventListener("click", async () => {
          await this.deleteMessage(msgId);
        });
        metaEl.appendChild(delBtn);
      }

      if (data.edited) {
        const editedEl = document.createElement("span");
        editedEl.className = "edited-tag";
        editedEl.textContent = "edited";
        metaEl.appendChild(editedEl);
      }

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

    if (isNearBottom || !this.initialLoadDone) {
      container.scrollTop = container.scrollHeight;
      if (this.scrollBottomBtnEl) this.scrollBottomBtnEl.classList.add("hidden");
    } else if (hasNewIncoming && this.scrollBottomBtnEl) {
      this.scrollBottomBtnEl.classList.remove("hidden");
    }
  }

  /**
   * Toggles an emoji reaction for the current user on a message.
   */
  async toggleReaction(messageId, currentReactions, emoji) {
    try {
      const updated = { ...(currentReactions || {}) };
      if (updated[this.currentUser.uid] === emoji) {
        delete updated[this.currentUser.uid];
      } else {
        updated[this.currentUser.uid] = emoji;
      }
      await updateDoc(doc(this.db, "messages", messageId), {
        reactions: updated
      });
    } catch (err) {
      if (this.onNotify) this.onNotify("Could not update reaction.");
    }
  }

  /**
   * Edits an existing text message sent by the current user.
   */
  async editMessage(messageId, newRawText) {
    const cleaned = String(newRawText || "").trim();
    if (!cleaned) throw new Error("Edited message cannot be empty.");
    if (cleaned.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message exceeds ${MAX_MESSAGE_LENGTH} characters.`);
    }

    await updateDoc(doc(this.db, "messages", messageId), {
      text: cleaned,
      edited: true
    });
    if (this.onNotify) this.onNotify("Message updated.");
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
      if (this.onNotify) this.onNotify("Message deleted for everyone.");
    } catch (err) {
      if (this.onNotify) this.onNotify(err?.message || "Could not delete message.");
    }
  }

  /**
   * Validates and sends a message (text, photo, voice note, and optional replyTo).
   */
  async sendMessage({ rawText = "", imageData = null, audioData = null, replyTo = null }) {
    const cleaned = String(rawText || "")
      .replace(/\r\n/g, "\n")
      .trim();

    if (!cleaned && !imageData && !audioData) {
      throw new Error("Please enter a message, photo, or voice note.");
    }

    if (cleaned.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message exceeds maximum limit of ${MAX_MESSAGE_LENGTH} characters.`);
    }

    if (imageData && (!imageData.startsWith("data:image/") || imageData.length > MAX_MEDIA_DATA_LENGTH)) {
      throw new Error("Attached photo is invalid or exceeds size limit.");
    }

    if (audioData && (!audioData.startsWith("data:audio/") || audioData.length > MAX_MEDIA_DATA_LENGTH)) {
      throw new Error("Voice note is too large. Keep recordings under 15 seconds.");
    }

    const now = Date.now();
    const elapsed = now - this.lastSentAt;

    if (elapsed < SPAM_COOLDOWN_MS) {
      const waitSec = ((SPAM_COOLDOWN_MS - elapsed) / 1000).toFixed(1);
      throw new Error(`Slow down! Please wait ${waitSec}s before sending another message.`);
    }

    if (!imageData && !audioData && cleaned === this.lastSentText && elapsed < 10000) {
      throw new Error("Duplicate message blocked by spam protection.");
    }

    this.lastSentAt = now;
    this.lastSentText = cleaned;
    this.setTypingStatus(false);

    const sanitizedReply =
      replyTo && replyTo.id
        ? {
            id: String(replyTo.id).slice(0, 64),
            senderName: String(replyTo.senderName || "Member").slice(0, 30),
            text: String(replyTo.text || "").slice(0, 120)
          }
        : null;

    const batch = writeBatch(this.db);
    const newMsgRef = doc(collection(this.db, "messages"));
    const userAuthRef = doc(this.db, "authorizedUsers", this.currentUser.uid);

    batch.set(newMsgRef, {
      text: cleaned,
      imageData: imageData || null,
      audioData: audioData || null,
      replyTo: sanitizedReply,
      reactions: {},
      edited: false,
      senderId: this.currentUser.uid,
      senderName: this.currentUser.displayName,
      createdAt: serverTimestamp()
    });

    batch.update(userAuthRef, {
      lastMessageAt: serverTimestamp()
    });

    await batch.commit();
    this.messagesContainerEl.scrollTop = this.messagesContainerEl.scrollHeight;
  }

  /**
   * Updates user's live typing indicator in `/presence/{uid}`.
   */
  setTypingStatus(typing) {
    if (typing) {
      if (this.typingTimeout) clearTimeout(this.typingTimeout);
      this.typingTimeout = setTimeout(() => {
        this.setTypingStatus(false);
      }, 2600);
    }

    if (this.isTyping === typing) return;
    this.isTyping = typing;

    setDoc(doc(this.db, "presence", this.currentUser.uid), {
      uid: this.currentUser.uid,
      displayName: this.currentUser.displayName,
      online: true,
      typing: Boolean(typing),
      lastSeen: serverTimestamp()
    }).catch(() => {});
  }

  /**
   * Publishes user presence and subscribes to active online members & typing status.
   */
  startPresenceTracking() {
    const updateMyPresence = async (onlineStatus = true) => {
      try {
        await setDoc(doc(this.db, "presence", this.currentUser.uid), {
          uid: this.currentUser.uid,
          displayName: this.currentUser.displayName,
          online: onlineStatus,
          typing: Boolean(this.isTyping),
          lastSeen: serverTimestamp()
        });
      } catch (_) {}
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
        const typingUsers = [];

        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          if (!data?.online) return;
          const lastSeenMs = data.lastSeen?.toMillis ? data.lastSeen.toMillis() : now;
          if (now - lastSeenMs <= PRESENCE_STALE_MS) {
            activeUsers.push(data);
            if (
              data.typing &&
              data.uid !== this.currentUser.uid &&
              now - lastSeenMs <= TYPING_STALE_MS
            ) {
              typingUsers.push(data.displayName);
            }
          }
        });

        this.renderOnlineUsers(activeUsers, typingUsers);
      },
      () => {}
    );
  }

  renderOnlineUsers(users, typingUsers = []) {
    const count = Math.max(1, users.length);
    this.onlineCountEl.textContent = `${count} online`;
    this.onlineUsersListEl.innerHTML = "";

    if (typingUsers.length > 0 && this.typingStatusEl) {
      const label =
        typingUsers.length === 1
          ? `• ${typingUsers[0]} is typing...`
          : `• ${typingUsers.slice(0, 2).join(", ")} typing...`;
      this.typingStatusEl.textContent = label;
      this.typingStatusEl.classList.remove("hidden");
      if (this.tapViewHintEl) this.tapViewHintEl.classList.add("hidden");
    } else if (this.typingStatusEl) {
      this.typingStatusEl.classList.add("hidden");
      if (this.tapViewHintEl) this.tapViewHintEl.classList.remove("hidden");
    }

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
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }
}
