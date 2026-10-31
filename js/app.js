/**
 * ============================================================================
 * PRIVATE CHAT — MAIN APPLICATION BOOTSTRAP (js/app.js)
 * ============================================================================
 */

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
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
  ChatController,
  EMOJI_CATEGORIES,
  MAX_MESSAGE_LENGTH,
  compressImageFile
} from "./chat.js";

// DOM Elements
const loginView = document.getElementById("login-view");
const chatView = document.getElementById("chat-view");

const connectionPill = document.getElementById("connection-pill");
const connectionPillText = document.getElementById("connection-pill-text");
const openConfigBtn = document.getElementById("open-config-btn");

const loginForm = document.getElementById("login-form");
const displayNameInput = document.getElementById("display-name-input");
const accessCodeInput = document.getElementById("access-code-input");
const toggleCodeBtn = document.getElementById("toggle-code-visibility");
const initRoomCheckbox = document.getElementById("init-room-checkbox");
const joinBtn = document.getElementById("join-btn");
const joinBtnText = document.getElementById("join-btn-text");
const loginAlert = document.getElementById("login-alert");

const onlineUsersToggle = document.getElementById("online-users-toggle");
const onlineDrawer = document.getElementById("online-drawer");
const closeOnlineDrawer = document.getElementById("close-online-drawer");
const onlineCountText = document.getElementById("online-count-text");
const onlineUsersList = document.getElementById("online-users-list");
const logoutBtn = document.getElementById("logout-btn");

const messagesContainer = document.getElementById("messages-container");
const messagesList = document.getElementById("messages-list");

const emojiToggleBtn = document.getElementById("emoji-toggle-btn");
const emojiPicker = document.getElementById("emoji-picker");
const emojiGrid = document.getElementById("emoji-grid");
const emojiTabs = document.querySelectorAll(".emoji-tab");

const photoBtn = document.getElementById("photo-btn");
const photoInput = document.getElementById("photo-input");
const photoPreviewBar = document.getElementById("photo-preview-bar");
const photoPreviewImg = document.getElementById("photo-preview-img");
const photoPreviewSize = document.getElementById("photo-preview-size");
const removePhotoBtn = document.getElementById("remove-photo-btn");

const lightboxModal = document.getElementById("lightbox-modal");
const lightboxImg = document.getElementById("lightbox-img");
const closeLightboxBtn = document.getElementById("close-lightbox-btn");

const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const charCounter = document.getElementById("char-counter");
const composerToast = document.getElementById("composer-toast");

const configModal = document.getElementById("config-modal");
const closeConfigModal = document.getElementById("close-config-modal");
const firebaseConfigTextarea = document.getElementById("firebase-config-textarea");
const saveConfigBtn = document.getElementById("save-config-btn");
const shareConfigBtn = document.getElementById("share-config-btn");
const configModalAlert = document.getElementById("config-modal-alert");

const hashHelperInput = document.getElementById("hash-helper-input");
const hashHelperOutput = document.getElementById("hash-helper-output");
const copyHashBtn = document.getElementById("copy-hash-btn");

const themeToggleLogin = document.getElementById("theme-toggle-login");
const themeToggleChat = document.getElementById("theme-toggle-chat");

// Runtime State
let firebaseApp = null;
let auth = null;
let db = null;
let chatController = null;
let activeUser = null;
let pendingImageData = null;
let toastTimeout = null;

/**
 * 1. Theme Management (Light & Dark Mode)
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

themeToggleLogin.addEventListener("click", toggleTheme);
themeToggleChat.addEventListener("click", toggleTheme);

/**
 * 2. Alert & Toast Helpers
 */
function showLoginAlert(message, isSuccess = false) {
  loginAlert.textContent = message;
  loginAlert.classList.toggle("success", isSuccess);
  loginAlert.classList.remove("hidden");
}

function hideLoginAlert() {
  loginAlert.classList.add("hidden");
}

function showComposerToast(message) {
  composerToast.textContent = message;
  composerToast.classList.remove("hidden");
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    composerToast.classList.add("hidden");
  }, 3200);
}

/**
 * 3. Initialize Firebase Web SDK from Configuration
 */
function initFirebaseClient() {
  const cfg = getFirebaseConfig();
  if (!cfg) {
    connectionPill.classList.remove("connected");
    connectionPill.classList.add("disconnected");
    connectionPillText.textContent = "Tap Gear Icon to Connect Firebase";
    return false;
  }

  try {
    firebaseApp = getApps().length ? getApp() : initializeApp(cfg);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);

    connectionPill.classList.remove("disconnected");
    connectionPill.classList.add("connected");
    connectionPillText.textContent = `Connected: ${cfg.projectId}`;

    // Restore active session if user refreshes page
    onAuthStateChanged(auth, async (user) => {
      if (user && !activeUser) {
        const restored = await checkExistingSession(db, user);
        if (restored) {
          enterChatRoom(restored);
        }
      }
    });

    return true;
  } catch (err) {
    showLoginAlert(`Firebase initialization error: ${err.message}`);
    return false;
  }
}

/**
 * 4. Switch Views & Start/Stop Chat Controller
 */
function enterChatRoom(userProfile) {
  activeUser = userProfile;
  hideLoginAlert();

  loginView.classList.remove("active");
  chatView.classList.add("active");

  if (chatController) {
    chatController.stop();
  }

  chatController = new ChatController({
    db,
    currentUser: activeUser,
    messagesListEl: messagesList,
    messagesContainerEl: messagesContainer,
    onlineCountEl: onlineCountText,
    onlineUsersListEl: onlineUsersList,
    onPermissionRevoked: async (reason) => {
      await handleLogout(reason);
    },
    onPhotoClick: (src) => {
      lightboxImg.src = src;
      lightboxModal.classList.remove("hidden");
    },
    onNotify: (msg) => {
      showComposerToast(msg);
    }
  });

  chatController.start();
  messageInput.focus();
}

async function handleLogout(alertReason = "") {
  const uid = activeUser?.uid;
  activeUser = null;

  if (chatController) {
    chatController.stop();
    chatController = null;
  }

  clearPendingPhoto();
  await logoutAndRevoke({ auth, db, uid });

  chatView.classList.remove("active");
  loginView.classList.add("active");
  accessCodeInput.value = "";

  if (alertReason) {
    showLoginAlert(alertReason, false);
  }
}

/**
 * 5. Login Form Submission
 */
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideLoginAlert();

  if (!auth || !db) {
    const initialized = initFirebaseClient();
    if (!initialized) {
      configModal.classList.remove("hidden");
      return;
    }
  }

  const displayName = displayNameInput.value;
  const accessCode = accessCodeInput.value;
  const initializeRoom = initRoomCheckbox.checked;

  joinBtn.disabled = true;
  joinBtnText.textContent = "Verifying with Firebase...";

  try {
    const userProfile = await loginWithAccessCode({
      auth,
      db,
      displayName,
      accessCode,
      initializeRoom
    });
    initRoomCheckbox.checked = false;
    enterChatRoom(userProfile);
  } catch (err) {
    showLoginAlert(err.message || "Failed to join room.");
  } finally {
    joinBtn.disabled = false;
    joinBtnText.textContent = "Join Private Room";
  }
});

toggleCodeBtn.addEventListener("click", () => {
  const isPassword = accessCodeInput.type === "password";
  accessCodeInput.type = isPassword ? "text" : "password";
  toggleCodeBtn.textContent = isPassword ? "Hide" : "Show";
});

logoutBtn.addEventListener("click", () => handleLogout());

/**
 * 6. Online Users Drawer Toggle
 */
onlineUsersToggle.addEventListener("click", () => {
  const isHidden = onlineDrawer.classList.toggle("hidden");
  onlineUsersToggle.setAttribute("aria-expanded", String(!isHidden));
});

closeOnlineDrawer.addEventListener("click", () => {
  onlineDrawer.classList.add("hidden");
  onlineUsersToggle.setAttribute("aria-expanded", "false");
});

/**
 * 7. Emoji Picker Logic
 */
function renderEmojiCategory(category) {
  emojiGrid.innerHTML = "";
  const emojis = EMOJI_CATEGORIES[category] || EMOJI_CATEGORIES.smileys;
  emojis.forEach((emoji) => {
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
  const nextValue = current.slice(0, start) + emoji + current.slice(end);

  if (nextValue.length <= MAX_MESSAGE_LENGTH) {
    messageInput.value = nextValue;
    const newPos = start + emoji.length;
    messageInput.setSelectionRange(newPos, newPos);
    updateCharCounter();
    messageInput.focus();
  }
}

emojiToggleBtn.addEventListener("click", () => {
  emojiPicker.classList.toggle("hidden");
});

emojiTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    emojiTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    renderEmojiCategory(tab.dataset.category);
  });
});

/**
 * 8. Photo Attachment, Compression & Lightbox Viewer
 */
function clearPendingPhoto() {
  pendingImageData = null;
  photoInput.value = "";
  photoPreviewImg.src = "";
  photoPreviewBar.classList.add("hidden");
}

photoBtn.addEventListener("click", () => {
  photoInput.click();
});

photoInput.addEventListener("change", async () => {
  const file = photoInput.files?.[0];
  if (!file) return;

  try {
    showComposerToast("Compressing photo...");
    const { dataUrl, approxKb, width, height } = await compressImageFile(file);
    pendingImageData = dataUrl;
    photoPreviewImg.src = dataUrl;
    photoPreviewSize.textContent = `Ready • ${width}×${height} (~${approxKb} KB)`;
    photoPreviewBar.classList.remove("hidden");
    messageInput.focus();
  } catch (err) {
    clearPendingPhoto();
    showComposerToast(err.message || "Failed to process photo.");
  }
});

removePhotoBtn.addEventListener("click", clearPendingPhoto);

closeLightboxBtn.addEventListener("click", () => {
  lightboxModal.classList.add("hidden");
  lightboxImg.src = "";
});

lightboxModal.addEventListener("click", (e) => {
  if (e.target === lightboxModal) {
    lightboxModal.classList.add("hidden");
    lightboxImg.src = "";
  }
});

/**
 * 9. Message Composer & Character Limit
 */
function updateCharCounter() {
  const len = messageInput.value.length;
  charCounter.textContent = `${len}/${MAX_MESSAGE_LENGTH}`;
  charCounter.classList.toggle("warn", len >= MAX_MESSAGE_LENGTH - 50);
}

messageInput.addEventListener("input", updateCharCounter);

messageForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!chatController) return;

  const rawText = messageInput.value;
  const attachedPhoto = pendingImageData;

  if (!rawText.trim() && !attachedPhoto) return;

  try {
    messageInput.value = "";
    updateCharCounter();
    clearPendingPhoto();
    emojiPicker.classList.add("hidden");
    await chatController.sendMessage(rawText, attachedPhoto);
  } catch (err) {
    // Restore text and photo if rate-limited so user doesn't lose their message
    if (!messageInput.value && rawText) {
      messageInput.value = rawText;
      updateCharCounter();
    }
    if (!pendingImageData && attachedPhoto) {
      pendingImageData = attachedPhoto;
      photoPreviewImg.src = attachedPhoto;
      photoPreviewBar.classList.remove("hidden");
    }
    showComposerToast(err.message || "Could not send message.");
  }
});

/**
 * 10. Firebase Configuration Modal & SHA-256 Helper
 */
openConfigBtn.addEventListener("click", () => {
  const existing = getFirebaseConfig();
  if (existing) {
    firebaseConfigTextarea.value = JSON.stringify(existing, null, 2);
  }
  configModalAlert.classList.add("hidden");
  configModal.classList.remove("hidden");
});

closeConfigModal.addEventListener("click", () => {
  configModal.classList.add("hidden");
});

saveConfigBtn.addEventListener("click", () => {
  try {
    saveFirebaseConfigFromInput(firebaseConfigTextarea.value);
    configModalAlert.textContent = "Firebase config saved! Reloading connection...";
    configModalAlert.classList.add("success");
    configModalAlert.classList.remove("hidden");
    setTimeout(() => {
      window.location.reload();
    }, 600);
  } catch (err) {
    configModalAlert.textContent = err.message;
    configModalAlert.classList.remove("success");
    configModalAlert.classList.remove("hidden");
  }
});

shareConfigBtn.addEventListener("click", async () => {
  try {
    const cfg = saveFirebaseConfigFromInput(firebaseConfigTextarea.value);
    const encoded = btoa(JSON.stringify(cfg));
    const shareUrl = `${window.location.origin}${window.location.pathname}?cfg=${encodeURIComponent(encoded)}`;
    await navigator.clipboard.writeText(shareUrl);
    configModalAlert.textContent = "Shareable setup link copied to clipboard!";
    configModalAlert.classList.add("success");
    configModalAlert.classList.remove("hidden");
  } catch (err) {
    configModalAlert.textContent = err.message;
    configModalAlert.classList.remove("success");
    configModalAlert.classList.remove("hidden");
  }
});

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

// Bootstrap App on Load
initTheme();
renderEmojiCategory("smileys");
const connected = initFirebaseClient();
if (!connected) {
  showLoginAlert(
    "Step 1: Tap the gear icon (top right) to paste your Firebase Web SDK config, or add it to js/config.js."
  );
}
