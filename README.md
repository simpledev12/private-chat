# Private Chat — Secure Mobile-First Real-Time Chat

A 100% free, mobile-first real-time chat web application inspired by WhatsApp and built for Android browsers using **HTML, CSS, Vanilla ES Modules, Firebase Authentication, Cloud Firestore, and Firestore Security Rules**.

---

## Architecture & Security Highlights

1. **Zero Secret Codes in Frontend Code**:
   - Neither the Secret Access Code nor its hash is stored in any HTML/JS file.
   - When a user enters the Secret Access Code, the browser hashes it with Web Crypto `SHA-256` (`crypto.subtle.digest`) and submits an authorization claim to `/authorizedUsers/{uid}`.
   - Cloud Firestore Security Rules (`firestore.rules`) verify on Google's backend that `accessHash == get(/databases/$(database)/documents/config/access).data.secretHash`.
   - The `/config/access` document has `allow read: if false;` so no user or attacker can ever read the secret hash from the client.
2. **100% Free Spark Plan (No Credit Card / No Blaze Billing)**:
   - Uses only Firebase Anonymous Authentication + Cloud Firestore + Security Rules.
   - Hosted for free on **GitHub Pages** directly from the `main` branch.
3. **Spam & Abuse Protection**:
   - Enforces display name length (`2–30` characters) and message length (`1–500` characters) in both UI and `firestore.rules`.
   - Enforces a server-side cooldown between messages using atomic batch updates to `/authorizedUsers/{uid}.lastMessageAt`.
   - Uses `textContent` rendering everywhere to prevent XSS injection.

---

## Repository Structure

```text
private-chat/
├── css/
│   └── styles.css          # Mobile-first WhatsApp-inspired Light & Dark UI
├── js/
│   ├── app.js              # Main UI controller, theme toggle, setup modal
│   ├── auth.js             # Firebase Auth + SHA-256 Secret Code verification
│   ├── chat.js             # Real-time messages, online presence, emoji picker
│   ├── config.js           # Safe Firebase configuration loader (no hardcoded keys)
│   └── config.example.js   # Example Firebase configuration template
├── firestore.rules         # Production Cloud Firestore Security Rules
├── index.html              # Responsive single-page application shell
└── README.md               # Step-by-step setup & deployment guide
```

---

## Step-by-Step Setup Guide (Android Phone & Zero Budget)

### Step 1: Create Your Free Firebase Project (Spark Plan)
1. Open Chrome on your Android phone and go to **[console.firebase.google.com](https://console.firebase.google.com/)** (tap the `⋮` menu and enable **Desktop site** for easier navigation).
2. Tap **Create a project**, name it `private-chat`, disable Google Analytics, and tap **Create project** (stays on the free **Spark Plan**—never enable Blaze billing).
3. On the Project Overview page, tap the **Web (`</>`)** icon, enter nickname `private-chat-web`, leave Firebase Hosting unchecked, and tap **Register app**.
4. Copy the `firebaseConfig` block (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`).

### Step 2: Enable Firebase Anonymous Authentication
1. In the Firebase Console left sidebar, tap **Build → Authentication → Get started**.
2. Open the **Sign-in method** tab, tap **Anonymous**, toggle **Enable** ON, and tap **Save**.
3. Open **Authentication → Settings → Authorized domains** and tap **Add domain** to add your GitHub Pages domain:
   `simpledev12.github.io`

### Step 3: Create Cloud Firestore Database & Publish Security Rules
1. In the Firebase Console sidebar, tap **Build → Firestore Database → Create database**.
2. Choose a nearby location (for example, `asia-south1 (Mumbai)`), select **Start in production mode**, and tap **Create**.
3. Open the **Rules** tab in Firestore Database, replace the default rules with the entire contents of [`firestore.rules`](./firestore.rules) from this repository, and tap **Publish**.

### Step 4: Enable GitHub Pages Hosting (From `main` Branch)
1. Open your repository settings on GitHub: **Settings → Pages**.
2. Under **Build and deployment → Source**, keep **Deploy from a branch** selected.
3. Under **Branch**, select **`main`** and **`/ (root)`**, then tap **Save**.
4. Wait ~60 seconds for GitHub Pages to publish, then open:
   `https://simpledev12.github.io/private-chat/`

### Step 5: Connect Firebase & Initialize Your Room's Secret Access Code
1. Open your live site (`https://simpledev12.github.io/private-chat/`) on your Android phone.
2. Tap the **Gear Icon (⚙️)** in the top-right corner of the login card and paste your `firebaseConfig` block (or paste your values into `js/config.js` in GitHub so all visitors connect automatically).
3. Enter your **Display Name**, type your chosen **Secret Access Code**, check **"First-time setup: Initialize room with this Secret Access Code"**, and tap **Join Private Room**.
   - This creates `/config/access` with your code's SHA-256 hash and permanently locks `/config/access` so no client can ever read or overwrite it.
4. Share the website link and the **Secret Access Code** with your friends—anyone with the code can join the room in real time!
