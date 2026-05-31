// ═══════════════════════════════════════════════════════════════
// app.js — 英検準1級 単語マスター
// Firebase v10+ Modular SDK  ／  匿名認証対応版
// ═══════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously,
  linkWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  collection,
  getDocs,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─────────────────────────────────────────────────────────────
// 🔧 Firebase Config  ← ここを自分のプロジェクトの値に差し替え
// ─────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_AUTH_DOMAIN",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

// ─────────────────────────────────────────────────────────────
// Firebase 初期化
// ─────────────────────────────────────────────────────────────
let app, auth, db;
let firebaseReady = false;
try {
  app  = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db   = getFirestore(app);
  firebaseReady = !firebaseConfig.apiKey.startsWith("YOUR_");
} catch (e) {
  console.warn("Firebase 初期化スキップ（config未設定）:", e.message);
}

// ─────────────────────────────────────────────────────────────
// 状態
// ─────────────────────────────────────────────────────────────
let allWords    = [];   // words.json から読み込み全単語
let progress    = {};   // { wordId: { status, successCount, lastReviewed } }
let currentUser = null;

// 学習セッション用
let currentUnit    = null;
let currentSession = 0;
const SESSION_SIZE = 20;
let sessionWords   = [];
let currentTab     = "card";

// カードモード
let cardIdx     = 0;
let cardKnow    = [];
let cardDunno   = [];
let cardFlipped = false;

// 4択モード
let choiceIdx      = 0;
let choiceWords    = [];
let choiceCorrect  = 0;
let choiceWrong    = [];
let choiceAnswered = false;

// 記述モード
let spellIdx     = 0;
let spellWords   = [];
let spellCorrect = 0;
let spellWrong   = [];

// ─────────────────────────────────────────────────────────────
// ローカルストレージ
// ─────────────────────────────────────────────────────────────
const LS_KEY = "eiken_progress_local";

function loadLocalProgress() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
  catch { return {}; }
}
function saveLocalProgress() {
  localStorage.setItem(LS_KEY, JSON.stringify(progress));
}

// ─────────────────────────────────────────────────────────────
// words.json 読み込み
// ─────────────────────────────────────────────────────────────
async function loadWords() {
  try {
    const res  = await fetch("words.json");
    const data = await res.json();
    allWords = data.words.map(w => ({
      id:      String(w.id),
      unit:    w.unit ?? guessUnit(w.id),
      word:    w.word,
      meaning: w.meaning,
      pos:     w.part_of_speech ?? "",
    }));
    console.log(`✅ ${allWords.length} 語を読み込みました`);
  } catch (e) {
    console.error("words.json 読み込み失敗:", e);
    showToast("words.json が見つかりません", "error");
  }
}

function guessUnit(id) {
  const m = String(id).match(/u(\d+)_/);
  return m ? parseInt(m[1]) : 1;
}

// ─────────────────────────────────────────────────────────────
// ユニット一覧
// ─────────────────────────────────────────────────────────────
function getUnits() {
  return [...new Set(allWords.map(w => w.unit))].sort((a, b) => a - b);
}
function wordsOfUnit(unit) {
  return allWords.filter(w => w.unit === unit);
}

// ─────────────────────────────────────────────────────────────
// 進捗管理
// ─────────────────────────────────────────────────────────────
function getWordProgress(wordId) {
  return progress[wordId] ?? { status: "unlearned", successCount: 0, lastReviewed: null };
}

async function updateWordProgress(wordId, isCorrect) {
  const prev = getWordProgress(wordId);
  let { successCount, status } = prev;

  if (isCorrect) {
    successCount = Math.min(successCount + 1, 10);
    status = successCount >= 3 ? "mastered" : "learning";
  } else {
    successCount = 0;
    status = "learning";
  }

  progress[wordId] = { status, successCount, lastReviewed: new Date().toISOString() };
  saveLocalProgress();

  if (currentUser && firebaseReady) {
    try {
      await setDoc(
        doc(db, "users", currentUser.uid, "progress", wordId),
        { status, successCount, lastReviewed: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.warn("Firestore 更新失敗:", e);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 復習対象抽出（忘却曲線）
// ─────────────────────────────────────────────────────────────
function getReviewWords() {
  const now = Date.now();
  const DAY = 86_400_000;
  return allWords.filter(w => {
    const p = getWordProgress(w.id);
    if (!p.lastReviewed) return false;
    const elapsed = now - new Date(p.lastReviewed).getTime();
    if (p.status === "learning" && p.successCount === 0) return true;
    if (p.successCount === 1 && elapsed >= DAY)          return true;
    if (p.successCount === 2 && elapsed >= 3 * DAY)      return true;
    if (p.successCount === 3 && elapsed >= 7 * DAY)      return true;
    return false;
  });
}

// ─────────────────────────────────────────────────────────────
// Firestore 進捗取得
// ─────────────────────────────────────────────────────────────
async function fetchFirestoreProgress(uid) {
  if (!firebaseReady) return;
  try {
    const snap = await getDocs(collection(db, "users", uid, "progress"));
    snap.forEach(d => {
      const data = d.data();
      progress[d.id] = {
        status:       data.status       ?? "unlearned",
        successCount: data.successCount ?? 0,
        lastReviewed: data.lastReviewed instanceof Timestamp
          ? data.lastReviewed.toDate().toISOString()
          : data.lastReviewed ?? null,
      };
    });
    saveLocalProgress();
    console.log("✅ Firestoreから進捗を同期しました");
  } catch (e) {
    console.warn("Firestore 進捗取得失敗:", e);
  }
}

// ─────────────────────────────────────────────────────────────
// UI ヘルパー
// ─────────────────────────────────────────────────────────────
function showToast(msg, type = "info") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl text-sm font-medium border shadow-2xl pointer-events-none show";
  const styles = {
    success: ["rgba(22,163,74,0.15)",  "rgba(74,222,128,0.4)",  "#4ade80"],
    error:   ["rgba(244,63,94,0.15)",  "rgba(251,113,133,0.4)", "#fb7185"],
    info:    ["rgba(29,30,46,0.95)",   "rgba(74,77,113,0.6)",   "#dcdde3"],
  };
  const [bg, border, color] = styles[type] ?? styles.info;
  t.style.background  = bg;
  t.style.borderColor = border;
  t.style.color       = color;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

function showScreen(id) {
  ["screen-home", "screen-study"].forEach(s =>
    document.getElementById(s).classList.toggle("hidden", s !== id)
  );
  document.getElementById("btn-back-home").classList.toggle("hidden", id === "screen-home");
}

// ─────────────────────────────────────────────────────────────
// ホーム画面
// ─────────────────────────────────────────────────────────────
function renderHome() {
  const mastered = allWords.filter(w => getWordProgress(w.id).status === "mastered").length;
  const learning = allWords.filter(w => getWordProgress(w.id).status === "learning").length;
  document.getElementById("stat-total").textContent    = allWords.length;
  document.getElementById("stat-mastered").textContent = mastered;
  document.getElementById("stat-learning").textContent = learning;

  const reviewWords = getReviewWords();
  const alertEl     = document.getElementById("review-alert");
  alertEl.classList.toggle("hidden", reviewWords.length === 0);
  document.getElementById("review-count").textContent = reviewWords.length;

  const units = getUnits();
  document.getElementById("unit-grid").innerHTML = units.map(u => {
    const words = wordsOfUnit(u);
    const tot   = words.length;
    const mast  = words.filter(w => getWordProgress(w.id).status === "mastered").length;
    const pct   = tot ? Math.round((mast / tot) * 100) : 0;
    const sessions = Math.ceil(tot / SESSION_SIZE);
    return `
      <button class="unit-card rounded-2xl border border-ink-700/60 bg-ink-800/60 p-4 text-left"
              onclick="startUnit(${u})">
        <div class="flex items-center justify-between mb-3">
          <span class="font-display text-lg text-ink-100">Unit ${u}</span>
          <span class="text-xs font-mono text-ink-500">${tot}語</span>
        </div>
        <div class="w-full h-1.5 rounded-full bg-ink-700 mb-2">
          <div class="progress-fill h-full rounded-full ${pct === 100 ? 'bg-gold-400' : 'bg-gradient-to-r from-jade-600 to-jade-400'}"
               style="width:${pct}%"></div>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs text-ink-500">${mast}/${tot} 習得</span>
          <span class="text-xs ${pct === 100 ? 'text-gold-400' : 'text-jade-500'} font-mono">${pct}%</span>
        </div>
      </button>`;
  }).join("");
}

// ─────────────────────────────────────────────────────────────
// ユニット開始
// ─────────────────────────────────────────────────────────────
window.startUnit = function(unit) {
  currentUnit = unit;
  const words    = wordsOfUnit(unit);
  const sessions = Math.ceil(words.length / SESSION_SIZE);

  document.getElementById("study-title").textContent = `Unit ${unit}`;

  const sel = document.getElementById("session-select");
  sel.innerHTML = Array.from({ length: sessions }, (_, i) => {
    const from = i * SESSION_SIZE + 1;
    const to   = Math.min((i + 1) * SESSION_SIZE, words.length);
    return `<option value="${i}">${i + 1}/${sessions} (${from}-${to}語)</option>`;
  }).join("");
  sel.value = "0";

  loadSession(unit, 0);
  showScreen("screen-study");
};

function loadSession(unit, sessionIdx) {
  currentSession = sessionIdx;
  const words    = wordsOfUnit(unit);
  const sessions = Math.ceil(words.length / SESSION_SIZE);
  sessionWords   = words.slice(sessionIdx * SESSION_SIZE, (sessionIdx + 1) * SESSION_SIZE);
  document.getElementById("study-subtitle").textContent = `セッション ${sessionIdx + 1}/${sessions}`;
  switchTab(currentTab);
}

// ─────────────────────────────────────────────────────────────
// タブ切り替え
// ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab-btn").forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("active",        active);
    btn.classList.toggle("text-jade-400", active);
    btn.classList.toggle("bg-ink-700/60", active);
    btn.classList.toggle("text-ink-400",  !active);
  });
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
  document.getElementById(`tab-${tab}`).classList.remove("hidden");
  document.getElementById("test-progress-wrap").classList.toggle("hidden", tab === "card");

  if (tab === "card")   initCardMode();
  if (tab === "choice") initChoiceMode();
  if (tab === "spell")  initSpellMode();
}

// ─────────────────────────────────────────────────────────────
// ── カードモード ──────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
function initCardMode(words) {
  cardKnow    = [];
  cardDunno   = [];
  cardIdx     = 0;
  cardFlipped = false;
  initCardMode._words = words ?? [...sessionWords];
  document.getElementById("card-session-end").classList.add("hidden");
  document.getElementById("card-scene").style.visibility = "";
  renderCard();
}

function renderCard() {
  const words = initCardMode._words ?? [];
  if (cardIdx >= words.length) { endCardSession(); return; }
  const w = words[cardIdx];
  document.getElementById("card-word-front").textContent   = w.word;
  document.getElementById("card-meaning-back").textContent = w.meaning;
  document.getElementById("card-word-back-sub").textContent = w.word;
  document.getElementById("card-pos").textContent           = w.pos ?? "";
  document.getElementById("card-index-front").textContent   = `${cardIdx + 1} / ${words.length}`;
  cardFlipped = false;
  document.getElementById("card-inner").classList.remove("is-flipped");
  document.getElementById("card-actions-pre").classList.remove("hidden");
  document.getElementById("card-actions-post").classList.add("hidden");
}

function flipCard() {
  if (cardFlipped) return;
  cardFlipped = true;
  document.getElementById("card-inner").classList.add("is-flipped");
  document.getElementById("card-actions-pre").classList.add("hidden");
  document.getElementById("card-actions-post").classList.remove("hidden");
}

function cardJudge(know) {
  const words = initCardMode._words ?? [];
  const w = words[cardIdx];
  if (know) { cardKnow.push(w);  showToast("✓ 覚えた！", "success"); }
  else      { cardDunno.push(w); showToast("→ あとで復習", "info"); }
  cardIdx++;
  setTimeout(renderCard, 250);
}

function endCardSession() {
  document.getElementById("card-session-end").classList.remove("hidden");
  document.getElementById("card-actions-pre").classList.add("hidden");
  document.getElementById("card-actions-post").classList.add("hidden");
  document.getElementById("card-result-know").textContent  = cardKnow.length;
  document.getElementById("card-result-dunno").textContent = cardDunno.length;
  document.getElementById("btn-card-retry-dunno").classList.toggle("hidden", cardDunno.length === 0);
  document.getElementById("card-scene").style.visibility = "hidden";
}

// ─────────────────────────────────────────────────────────────
// ── 4択モード ────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
function initChoiceMode(words) {
  choiceCorrect  = 0;
  choiceWrong    = [];
  choiceIdx      = 0;
  choiceAnswered = false;
  choiceWords    = shuffle(words ?? [...sessionWords]);
  document.getElementById("choice-session-end").classList.add("hidden");
  document.getElementById("choice-result").classList.add("hidden");
  updateTestProgress("choice");
  renderChoice();
}

function renderChoice() {
  if (choiceIdx >= choiceWords.length) { endChoiceSession(); return; }
  const w = choiceWords[choiceIdx];
  document.getElementById("choice-word").textContent = w.word;
  choiceAnswered = false;
  document.getElementById("choice-result").classList.add("hidden");

  const unitWords = wordsOfUnit(w.unit).filter(x => x.id !== w.id);
  const dummies   = shuffle(unitWords).slice(0, 3).map(x => x.meaning);
  const options   = shuffle([w.meaning, ...dummies]);

  document.getElementById("choice-options").innerHTML = options.map((opt, i) => `
    <button class="choice-btn w-full text-left px-5 py-3.5 rounded-2xl bg-ink-800/80 border border-ink-700/60 text-ink-200 text-sm font-medium"
            data-correct="${opt === w.meaning}"
            onclick="handleChoice(this, '${w.id}', ${opt === w.meaning})">
      <span class="text-ink-500 font-mono mr-2">${String.fromCharCode(65 + i)}.</span>${opt}
    </button>`).join("");

  updateTestProgress("choice");
}

window.handleChoice = async function(btn, wordId, isCorrect) {
  if (choiceAnswered) return;
  choiceAnswered = true;

  document.querySelectorAll("#choice-options .choice-btn").forEach(b => {
    b.disabled = true;
    if (b.dataset.correct === "true") b.classList.add("correct");
  });

  if (isCorrect) {
    btn.classList.add("correct");
    choiceCorrect++;
    showFeedback("✓", "jade");
    showToast("正解！", "success");
  } else {
    btn.classList.add("incorrect");
    choiceWrong.push(wordId);
    showFeedback("✕", "rose");
    showToast("不正解…", "error");
  }

  await updateWordProgress(wordId, isCorrect);
  setTimeout(() => { hideFeedback(); choiceIdx++; renderChoice(); }, 900);
};

function showFeedback(icon, color) {
  const el = document.getElementById("choice-feedback");
  const ic = document.getElementById("choice-feedback-icon");
  ic.textContent = icon;
  ic.className   = `text-8xl animate-pop-in ${color === "jade" ? "text-jade-400" : "text-rose-400"}`;
  el.classList.remove("hidden");
}
function hideFeedback() {
  document.getElementById("choice-feedback").classList.add("hidden");
}

function endChoiceSession() {
  document.getElementById("choice-session-end").classList.remove("hidden");
  document.getElementById("choice-result-correct").textContent = choiceCorrect;
  document.getElementById("choice-result-wrong").textContent   = choiceWrong.length;
  document.getElementById("btn-choice-retry-wrong").classList.toggle("hidden", choiceWrong.length === 0);
}

// ─────────────────────────────────────────────────────────────
// ── 記述モード ───────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
function initSpellMode(words) {
  spellCorrect = 0;
  spellWrong   = [];
  spellIdx     = 0;
  spellWords   = shuffle(words ?? [...sessionWords]);
  document.getElementById("spell-session-end").classList.add("hidden");
  document.getElementById("spell-feedback").classList.add("hidden");
  document.getElementById("btn-spell-next").classList.add("hidden");
  document.getElementById("btn-spell-submit").classList.remove("hidden");
  updateTestProgress("spell");
  renderSpell();
}

function renderSpell() {
  if (spellIdx >= spellWords.length) { endSpellSession(); return; }
  const w     = spellWords[spellIdx];
  const input = document.getElementById("spell-input");
  document.getElementById("spell-meaning").textContent = w.meaning;
  input.value    = "";
  input.disabled = false;
  document.getElementById("spell-feedback").classList.add("hidden");
  document.getElementById("btn-spell-next").classList.add("hidden");
  document.getElementById("btn-spell-submit").classList.remove("hidden");
  updateTestProgress("spell");
  setTimeout(() => input.focus(), 50);
}

async function submitSpell() {
  const w      = spellWords[spellIdx];
  const input  = document.getElementById("spell-input");
  const answer = input.value.trim().toLowerCase();
  if (!answer) return;
  const isCorrect = answer === w.word.toLowerCase();
  input.disabled  = true;

  const feedback = document.getElementById("spell-feedback");
  const msg      = document.getElementById("spell-feedback-msg");
  const answerEl = document.getElementById("spell-correct-answer");

  feedback.classList.remove("hidden");
  document.getElementById("btn-spell-submit").classList.add("hidden");
  document.getElementById("btn-spell-next").classList.remove("hidden");

  if (isCorrect) {
    spellCorrect++;
    feedback.className   = "mb-4 rounded-2xl p-5 text-center animate-pop-in bg-jade-500/10 border border-jade-500/30";
    msg.textContent      = "✓ 正解！";
    msg.className        = "text-sm font-medium mb-2 text-jade-400";
    answerEl.textContent = w.word;
    answerEl.className   = "font-mono text-3xl font-bold text-jade-300";
    showToast("正解！", "success");
  } else {
    spellWrong.push(w.id);
    feedback.className   = "mb-4 rounded-2xl p-5 text-center animate-pop-in bg-rose-500/10 border border-rose-500/30";
    msg.textContent      = "✕ 不正解 — 正しいスペルは：";
    msg.className        = "text-sm font-medium mb-2 text-rose-400";
    answerEl.textContent = w.word;
    answerEl.className   = "font-mono text-3xl font-bold text-rose-300";
    showToast("不正解…正しいスペルを確認してください", "error");
  }

  await updateWordProgress(w.id, isCorrect);
}

function endSpellSession() {
  document.getElementById("spell-session-end").classList.remove("hidden");
  document.getElementById("spell-result-correct").textContent = spellCorrect;
  document.getElementById("spell-result-wrong").textContent   = spellWrong.length;
  document.getElementById("btn-spell-retry-wrong").classList.toggle("hidden", spellWrong.length === 0);
}

// ─────────────────────────────────────────────────────────────
// テスト進捗バー
// ─────────────────────────────────────────────────────────────
function updateTestProgress(mode) {
  const [current, total, correct] = mode === "choice"
    ? [choiceIdx, choiceWords.length, choiceCorrect]
    : [spellIdx,  spellWords.length,  spellCorrect];
  const pct = total ? (current / total) * 100 : 0;
  document.getElementById("progress-fill").style.width  = `${pct}%`;
  document.getElementById("progress-label").textContent = `${current} / ${total}`;
  document.getElementById("progress-score").textContent = `正解: ${correct}`;
}

// ─────────────────────────────────────────────────────────────
// Shuffle
// ─────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─────────────────────────────────────────────────────────────
// タッチ / スワイプ（カードモード）
// ─────────────────────────────────────────────────────────────
let touchStartX = 0;
document.getElementById("card-scene").addEventListener("touchstart", e => {
  touchStartX = e.touches[0].clientX;
}, { passive: true });
document.getElementById("card-scene").addEventListener("touchend", e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (!cardFlipped) { flipCard(); return; }
  if (Math.abs(dx) < 40) return;
  cardJudge(dx > 0);
});
document.getElementById("card-scene").addEventListener("click", () => {
  if (!cardFlipped) flipCard();
});

// ─────────────────────────────────────────────────────────────
// キーボードショートカット
// ─────────────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  if (currentTab !== "card") return;
  if ((e.key === " " || e.key === "Enter") && !cardFlipped) flipCard();
  if (!cardFlipped) return;
  if (e.key === "ArrowRight") cardJudge(true);
  if (e.key === "ArrowLeft")  cardJudge(false);
});

// ─────────────────────────────────────────────────────────────
// イベントバインド
// ─────────────────────────────────────────────────────────────
function bindEvents() {
  // ── ナビ ──
  document.getElementById("btn-back-home").addEventListener("click", () => {
    renderHome();
    showScreen("screen-home");
    document.getElementById("card-scene").style.visibility = "";
  });

  // ── タブ ──
  document.querySelectorAll(".tab-btn").forEach(btn =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab))
  );

  // ── セッション ──
  document.getElementById("session-select").addEventListener("change", e =>
    loadSession(currentUnit, parseInt(e.target.value))
  );

  // ── カード ──
  document.getElementById("btn-flip-card").addEventListener("click", flipCard);
  document.getElementById("btn-know").addEventListener("click", () => cardJudge(true));
  document.getElementById("btn-dont-know").addEventListener("click", () => cardJudge(false));
  document.getElementById("btn-card-retry-dunno").addEventListener("click", () => {
    document.getElementById("card-session-end").classList.add("hidden");
    document.getElementById("card-scene").style.visibility = "";
    initCardMode(cardDunno);
  });
  document.getElementById("btn-card-finish").addEventListener("click", () => {
    renderHome(); showScreen("screen-home");
    document.getElementById("card-scene").style.visibility = "";
  });

  // ── 4択 ──
  document.getElementById("btn-choice-retry-wrong").addEventListener("click", () => {
    document.getElementById("choice-session-end").classList.add("hidden");
    initChoiceMode(allWords.filter(w => choiceWrong.includes(w.id)));
  });
  document.getElementById("btn-choice-finish").addEventListener("click", () => {
    renderHome(); showScreen("screen-home");
  });

  // ── 記述 ──
  document.getElementById("btn-spell-submit").addEventListener("click", submitSpell);
  document.getElementById("spell-input").addEventListener("keydown", e => {
    if (e.key === "Enter") submitSpell();
  });
  document.getElementById("btn-spell-next").addEventListener("click", () => {
    spellIdx++; renderSpell();
  });
  document.getElementById("btn-spell-retry-wrong").addEventListener("click", () => {
    document.getElementById("spell-session-end").classList.add("hidden");
    initSpellMode(allWords.filter(w => spellWrong.includes(w.id)));
  });
  document.getElementById("btn-spell-finish").addEventListener("click", () => {
    renderHome(); showScreen("screen-home");
  });

  // ── 復習 ──
  document.getElementById("btn-start-review").addEventListener("click", () => {
    const reviewWords = getReviewWords();
    if (reviewWords.length === 0) return;
    currentUnit = reviewWords[0].unit;
    showScreen("screen-study");
    document.getElementById("study-title").textContent    = "復習モード";
    document.getElementById("study-subtitle").textContent = `${reviewWords.length} 語`;
    document.getElementById("session-select").innerHTML   = `<option value="0">復習 ${reviewWords.length}語</option>`;
    sessionWords = reviewWords;
    switchTab(currentTab);
  });

  // ── Auth ──
  document.getElementById("btn-auth").addEventListener("click", () => {
    document.getElementById("modal-login").classList.remove("hidden");
  });
  document.getElementById("btn-close-modal").addEventListener("click", () => {
    document.getElementById("modal-login").classList.add("hidden");
  });
  document.getElementById("btn-google-signin").addEventListener("click", async () => {
    if (!firebaseReady) { showToast("Firebase未設定です", "error"); return; }
    try {
      const provider = new GoogleAuthProvider();
      if (currentUser?.isAnonymous) {
        // 匿名 → Googleアカウントに昇格（進捗データ引き継ぎ）
        await linkWithPopup(currentUser, provider);
        showToast("Googleアカウントに連携しました！", "success");
      } else {
        await signInWithPopup(auth, provider);
      }
      document.getElementById("modal-login").classList.add("hidden");
    } catch (e) {
      console.error(e);
      showToast("サインイン失敗: " + e.message, "error");
    }
  });
  document.getElementById("btn-logout").addEventListener("click", async () => {
    if (!firebaseReady) return;
    await signOut(auth);
    // ログアウト後は再度匿名サインイン
    await signInAnonymously(auth);
    showToast("ログアウトしました（匿名モードに戻りました）");
  });
}

// ─────────────────────────────────────────────────────────────
// Auth 状態管理（匿名認証対応）
// ─────────────────────────────────────────────────────────────
function setupAuth() {
  if (!firebaseReady) {
    // Firebase未設定 → ローカルのみで動作
    progress = loadLocalProgress();
    setAuthUI(null);
    renderHome();
    return;
  }

  onAuthStateChanged(auth, async user => {
    if (user) {
      currentUser = user;
      setAuthUI(user);
      progress = loadLocalProgress();
      await fetchFirestoreProgress(user.uid);
      renderHome();
    } else {
      // 未ログイン → 自動で匿名サインイン
      try {
        await signInAnonymously(auth);
        // onAuthStateChanged が再発火して上のブランチへ
      } catch (e) {
        console.warn("匿名サインイン失敗:", e);
        progress = loadLocalProgress();
        setAuthUI(null);
        renderHome();
      }
    }
  });
}

function setAuthUI(user) {
  const loading   = document.getElementById("auth-loading");
  const label     = document.getElementById("auth-label");
  const btnAuth   = document.getElementById("btn-auth");
  const btnLogout = document.getElementById("btn-logout");

  loading.classList.add("hidden");

  if (!user) {
    label.textContent   = "オフライン";
    label.className     = "text-xs text-ink-500 font-mono";
    btnAuth.textContent = "ログイン";
    btnAuth.classList.remove("hidden");
    btnLogout.classList.add("hidden");
    return;
  }

  if (user.isAnonymous) {
    label.textContent   = "匿名ユーザー";
    label.className     = "text-xs text-gold-400 font-mono";
    btnAuth.textContent = "Googleで同期";
    btnAuth.classList.remove("hidden");
    btnLogout.classList.add("hidden");
  } else {
    label.textContent = user.displayName ?? user.email;
    label.className   = "text-xs text-jade-400 font-mono";
    btnAuth.classList.add("hidden");
    btnLogout.classList.remove("hidden");
  }
}

// ─────────────────────────────────────────────────────────────
// エントリーポイント
// ─────────────────────────────────────────────────────────────
async function main() {
  progress = loadLocalProgress();
  await loadWords();
  bindEvents();
  setupAuth();
  renderHome();
  showScreen("screen-home");
}

main();
