/**
 * ============================================================================
 * PRIVATE CHAT — MAIN APPLICATION BOOTSTRAP & UI CONTROLLER (js/app.js)
 * ============================================================================
 */

import { initializeApp, getApps, deleteApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import {
  getFirebaseConfig,
  saveFirebaseConfigFromInput
} from "./config.js";

import {
  loginWithAccessCode,
  checkExistingSession,
  logoutAndRevoke,
  onAuthStateChanged,
  sha256Hex
} from "./auth.js";

import {
  ChatRoomController,
  EMOJI_CATEGORIES,
  MAX_MESSAGE_LENGTH,
  getSenderColor,
  formatMessageTime,
  formatDateDivider
} from "./chat.js";

// Application State
let firebaseApp = null;
let auth = null;
let db = null;
let chatController = null;
let currentUserProfile = null;
let isLoggingIn = false;

// DOM Elements
const loginView = document.getElementById("login-view");
const chatView = document.getElementById("chat-view");
const connectionPill = document.getElementById("connection-pill");
const connectionPillText = document.getElementById("connection-pill-text");
const loginAlert = document.getElementById("login-alert");
const loginForm = document.getElementById("login-form");
const displayNameInput = document.getElementById("display-name-input");
const accessCodeInput = document.getElementById("access-code-input");
const initRoomCheckbox = document.getElementById("init-room-checkbox");
const toggleCodeBtn = document.getElementById("toggle-code-visibility");
const joinBtn = document.getElementById("join-btn");
const joinBtnText = document.getElementById("join-btn-text");

// Chat DOM Elements
const onlineUsersToggle = document.getElementById("online-users-toggle");
const onlineCountText = document.getElementById("online-count-text");
const onlineDrawer = document.getElementById("online-drawer");
const closeOnlineDrawerBtn = document.getElementById("close-online-drawer");
const onlineUsersList = document.getElementById("online-users-list");
const messagesContainer = document.getElementById("messages-container");
const messagesList = document.getElementById("messages-list");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const charCounter = document.getElementById("char-counter");
const composerToast = document.getElementById("composer-toast");
const emojiToggleBtn = document.getElementById("emoji-toggle-btn");
const emojiPicker = document.getElementById("emoji-picker");
const emojiGrid = document.getElementById("emoji-grid");
const logoutBtn = document.getElementById("logout-btn");

// Modal & Theme Elements
const openConfigBtn = document.getElementById("open-config-btn");
const closeConfigModalBtn = document.getElementById("close-config-modal");
const configModal = document.getElementById("config-modal");
const configModalAlert = document.getElementById("config-modal-alert");
const configTextarea = document.getElementById("firebase-config-textarea");
const saveConfigBtn = document.getElementById("save-config-btn");
const shareConfigBtn = document.getElementById("share-config-btn");
const hashHelperInput = document.getElementById("hash-helper-input");
const hashHelperOutput = document.getElementById("hash-helper-output");
const copyHashBtn = document.getElementById("copy-hash-btn");
const themeToggleLogin = document.getElementById("theme-toggle-login");
const themeToggleChat = document.getElementById("theme-toggle-chat");

/**
 * ============================================================================
 * THEME MANAGEMENT (LIGHT / DARK MODE)
 * ============================================================================
 */
function initTheme() {
  const savedTheme = localStorage.getItem("private_chat_theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("private_chat_theme", next);
}

/**
 * ============================================================================
 * ALERT & TOAST HELPERS
 * ============================================================================
 */
function showLoginAlert(message, isSuccess = false) {
  loginAlert.textContent = message;
  loginAlert.classList.remove("hidden", "success");
  if (isSuccess) loginAlert.classList.add("success");
}

function hideLoginAlert() {
  loginAlert.classList.add("hidden");
}

let toastTimeout = null;
function showComposerToast(message) {
  composerToast.textContent = message;
  composerToast.classList.remove("hidden");
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    composerToast.classList.add("hidden");
  }, 3200);
}

/**
 * ============================================================================
 * FIREBASE INITIALIZATION
 * ============================================================================
 */
async function initFirebase() {
  const cfg = getFirebaseConfig();
  if (!cfg) {
    connectionPill.classList.remove("connected");
    connectionPillText.textContent = "Tap Gear Icon to Connect Firebase";
    configModal.classList.remove("hidden");
    return false;
  }

  try {
    const existingApps = getApps();
    for (const app of existingApps) {
      await deleteApp(app);
    }

    firebaseApp = initializeApp(cfg);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);

    connectionPill.classList.add("connected");
    connectionPillText.textContent = `Connected: ${cfg.projectId}`;

    // Listen for existing authorized session
    onAuthStateChanged(auth, async (user) => {
      if (isLoggingIn) return;
      if (user && !currentUserProfile) {
        const existingProfile = await checkExistingSession(db, user);
        if (existingProfile) {
          enterChatRoom(existingProfile);
        }
      }
    });

    return true;
  } catch (err) {
    connectionPill.classList.remove("connected");
    connectionPillText.textContent = "Firebase Config Error";
    showLoginAlert(`Firebase initialization error: ${err.message}`);
    return false;
  }
}

/**
 * ============================================================================
 * VIEW NAVIGATION & CHAT ROOM LIFECYCLE
 * ============================================================================
 */
async function enterChatRoom(userProfile) {
  currentUserProfile = userProfile;
  hideLoginAlert();

  loginView.classList.remove("active");
  chatView.classList.add("active");

  if (chatController) {
    await chatController.stop();
  }

  chatController = new ChatRoomController({
    db,
    currentUser: userProfile,
    onMessagesUpdate: renderMessages,
    onPresenceUpdate: renderOnlineUsers,
    onAuthRevoked: async (reason) => {
      await handleLogout();
      showLoginAlert(reason);
    }
  });

  await chatController.start();
  messageInput.focus();
}

async function handleLogout() {
  const uid = currentUserProfile?.uid || auth?.currentUser?.uid;
  if (chatController) {
    await chatController.stop();
    chatController = null;
  }
  await logoutAndRevoke({ auth, db, uid });
  currentUserProfile = null;
  accessCodeInput.value = "";
  messagesList.innerHTML = "";
  chatView.classList.remove("active");
  loginView.classList.add("active");
}

/**
 * ============================================================================
 * RENDER MESSAGES & ONLINE USERS (XSS-SAFE DOM CREATION)
 * ============================================================================
 */
function renderMessages(messages) {
  const wasNearBottom =
    messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 120;

  messagesList.innerHTML = "";
  let lastDateLabel = "";

  messages.forEach((msg) => {
    const dateLabel = formatDateDivider(msg.createdAt);
    if (dateLabel !== lastDateLabel) {
      lastDateLabel = dateLabel;
      const divider = document.createElement("div");
      divider.className = "date-divider";
      divider.textContent = dateLabel;
      messagesList.appendChild(divider);
    }

    const isOutgoing = msg.senderId === currentUserProfile?.uid;
    const row = document.createElement("div");
    row.className = `message-row ${isOutgoing ? "outgoing" : "incoming"}`;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    if (!isOutgoing) {
      const senderEl = document.createElement("span");
      senderEl.className = "sender-name";
      senderEl.style.color = getSenderColor(msg.senderId);
      senderEl.textContent = msg.senderName || "Member";
      bubble.appendChild(senderEl);
    }

    const textEl = document.createElement("span");
    textEl.className = "message-text";
    textEl.textContent = msg.text || "";
    bubble.appendChild(textEl);

    const metaEl = document.createElement("span");
    metaEl.className = "message-meta";

    const timeEl = document.createElement("span");
    timeEl.textContent = formatMessageTime(msg.createdAt);
    metaEl.appendChild(timeEl);

    if (isOutgoing) {
      const checkEl = document.createElement("span");
      checkEl.className = "check-icon";
      checkEl.textContent = "✓✓";
      metaEl.appendChild(checkEl);
    }

    bubble.appendChild(metaEl);
    row.appendChild(bubble);
    messagesList.appendChild(row);
  });

  if (wasNearBottom || messages.length <= 20) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

function renderOnlineUsers(users) {
  const count = users.length;
  onlineCountText.textContent = `${count} online`;

  onlineUsersList.innerHTML = "";
  users.forEach((u) => {
    const li = document.createElement("li");
    li.className = "online-user-chip";

    const dot = document.createElement("span");
    dot.className = "online-dot";

    const nameSpan = document.createElement("span");
    const isMe = u.uid === currentUserProfile?.uid;
    nameSpan.textContent = isMe ? `${u.displayName} (You)` : u.displayName;

    li.appendChild(dot);
    li.appendChild(nameSpan);
    onlineUsersList.appendChild(li);
  });
}

/**
 * ============================================================================
 * EMOJI PICKER INITIALIZATION
 * ============================================================================
 */
function renderEmojiCategory(category = "smileys") {
  emojiGrid.innerHTML = "";
  const list = EMOJI_CATEGORIES[category] || EMOJI_CATEGORIES.smileys;
  list.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emoji-item";
    btn.textContent = emoji;
    btn.addEventListener("click", () => {
      insertEmojiAtCursor(emoji);
    });
    emojiGrid.appendChild(btn);
  });
}

function insertEmojiAtCursor(emoji) {
  const start = messageInput.selectionStart ?? messageInput.value.length;
  const end = messageInput.selectionEnd ?? messageInput.value.length;
  const current = messageInput.value;
  const updated = current.slice(0, start) + emoji + current.slice(end);

  if (updated.length <= MAX_MESSAGE_LENGTH) {
    messageInput.value = updated;
    const newPos = start + emoji.length;
    messageInput.focus();
    messageInput.setSelectionRange(newPos, newPos);
    updateCharCounter();
  }
}

function updateCharCounter() {
  const len = messageInput.value.length;
  charCounter.textContent = `${len}/${MAX_MESSAGE_LENGTH}`;
  charCounter.classList.toggle("warn", len >= MAX_MESSAGE_LENGTH - 50);
}

/**
 * ============================================================================
 * EVENT LISTENERS
 * ============================================================================
 */
function bindEvents() {
  // Theme toggles
  themeToggleLogin.addEventListener("click", toggleTheme);
  themeToggleChat.addEventListener("click", toggleTheme);

  // Show/Hide access code
  toggleCodeBtn.addEventListener("click", () => {
    const isPassword = accessCodeInput.type === "password";
    accessCodeInput.type = isPassword ? "text" : "password";
    toggleCodeBtn.textContent = isPassword ? "Hide" : "Show";
  });

  // Login Form Submit
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideLoginAlert();

    if (!auth || !db) {
      const initialized = await initFirebase();
      if (!initialized) {
        showLoginAlert("Please connect your Firebase project first (tap the gear icon at the top right).");
        return;
      }
    }

    isLoggingIn = true;
    joinBtn.disabled = true;
    joinBtnText.textContent = "Verifying with Firebase Backend...";

    try {
      const profile = await loginWithAccessCode({
        auth,
        db,
        displayName: displayNameInput.value,
        accessCode: accessCodeInput.value,
        initializeRoom: initRoomCheckbox.checked
      });
      initRoomCheckbox.checked = false;
      await enterChatRoom(profile);
    } catch (err) {
      showLoginAlert(err.message || "Authentication failed.");
    } finally {
      isLoggingIn = false;
      joinBtn.disabled = false;
      joinBtnText.textContent = "Join Private Room";
    }
  });

  // Send Message Form
  messageInput.addEventListener("input", updateCharCounter);

  messageForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!chatController) return;

    const rawText = messageInput.value;
    if (!rawText.trim()) return;

    try {
      messageInput.value = "";
      updateCharCounter();
      emojiPicker.classList.add("hidden");
      await chatController.sendMessage(rawText);
    } catch (err) {
      messageInput.value = rawText;
      updateCharCounter();
      showComposerToast(err.message || "Failed to send message.");
    }
  });

  // Emoji Picker Toggle & Category Tabs
  emojiToggleBtn.addEventListener("click", () => {
    emojiPicker.classList.toggle("hidden");
  });

  document.querySelectorAll(".emoji-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".emoji-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      renderEmojiCategory(tab.dataset.category);
    });
  });

  // Online Users Drawer Toggle
  onlineUsersToggle.addEventListener("click", () => {
    const isHidden = onlineDrawer.classList.toggle("hidden");
    onlineUsersToggle.setAttribute("aria-expanded", String(!isHidden));
  });

  closeOnlineDrawerBtn.addEventListener("click", () => {
    onlineDrawer.classList.add("hidden");
    onlineUsersToggle.setAttribute("aria-expanded", "false");
  });

  // Logout Button
  logoutBtn.addEventListener("click", handleLogout);

  // Firebase Configuration Modal
  openConfigBtn.addEventListener("click", () => {
    const currentCfg = getFirebaseConfig();
    if (currentCfg) {
      configTextarea.value = JSON.stringify(currentCfg, null, 2);
    }
    configModalAlert.classList.add("hidden");
    configModal.classList.remove("hidden");
  });

  closeConfigModalBtn.addEventListener("click", () => {
    configModal.classList.add("hidden");
  });

  saveConfigBtn.addEventListener("click", async () => {
    try {
      const saved = saveFirebaseConfigFromInput(configTextarea.value);
      configModalAlert.textContent = `Connected to project "${saved.projectId}"!`;
      configModalAlert.classList.remove("hidden");
      configModalAlert.classList.add("success");
      await initFirebase();
      setTimeout(() => {
        configModal.classList.add("hidden");
      }, 700);
    } catch (err) {
      configModalAlert.textContent = err.message;
      configModalAlert.classList.remove("hidden", "success");
    }
  });

  shareConfigBtn.addEventListener("click", async () => {
    try {
      const saved = saveFirebaseConfigFromInput(configTextarea.value);
      const encoded = btoa(JSON.stringify(saved));
      const shareUrl = `${window.location.origin}${window.location.pathname}?cfg=${encodeURIComponent(encoded)}`;
      await navigator.clipboard.writeText(shareUrl);
      configModalAlert.textContent = "Shareable Invite Link copied to clipboard!";
      configModalAlert.classList.remove("hidden");
      configModalAlert.classList.add("success");
    } catch (err) {
      configModalAlert.textContent = err.message || "Could not copy link.";
      configModalAlert.classList.remove("hidden", "success");
    }
  });

  // Admin SHA-256 Helper inside Modal
  hashHelperInput.addEventListener("input", async () => {
    const val = hashHelperInput.value.trim();
    if (!val) {
      hashHelperOutput.textContent = "Enter a code above to generate its 64-char SHA-256 hash";
      return;
    }
    const hash = await sha256Hex(val);
    hashHelperOutput.textContent = hash;
  });

  copyHashBtn.addEventListener("click", async () => {
    const val = hashHelperInput.value.trim();
    if (!val) return;
    const hash = await sha256Hex(val);
    await navigator.clipboard.writeText(hash);
    copyHashBtn.textContent = "Copied!";
    setTimeout(() => {
      copyHashBtn.textContent = "Copy Hash";
    }, 1500);
  });
}

// Bootstrap Application
initTheme();
renderEmojiCategory("smileys");
bindEvents();
initFirebase();
