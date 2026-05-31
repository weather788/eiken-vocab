// ═══════════════════════════════════════════════════════════════
// app.js — 英検準1級 単語マスター
// Firebase v10+ Modular SDK  ／  匿名認証 + 効果音 + 拡張機能版
// build: 20260531-1417
// ═══════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously,
  linkWithPopup, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  EmailAuthProvider, linkWithCredential,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, collection, getDocs,
  serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─────────────────────────────────────────────────────────────
// 🔧 Firebase Config
// ─────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyCbM4jETPkt7fy_8Yc57umeP5AwZvcgRbI",
  authDomain:        "eiken-vocab-b222b.firebaseapp.com",
  projectId:         "eiken-vocab-b222b",
  storageBucket:     "eiken-vocab-b222b.firebasestorage.app",
  messagingSenderId: "577249273277",
  appId:             "1:577249273277:web:81e9eafa0f3fc57dd9ded4",
  measurementId:     "G-LC3H6DH09Y",
};

let app, auth, db;
let firebaseReady = false;
try {
  app  = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db   = getFirestore(app);
  firebaseReady = !firebaseConfig.apiKey.startsWith("YOUR_");
} catch (e) {
  console.warn("Firebase 初期化スキップ:", e.message);
}

// ═══════════════════════════════════════════════════════════════
// 🔊 効果音エンジン（Web Audio API）
// ═══════════════════════════════════════════════════════════════
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// ミュート状態（localStorageで永続化）
let soundEnabled = localStorage.getItem("soundEnabled") !== "false";

function playSound(type) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    switch (type) {
      case "flip":
        // カードめくり：短いクリック音
        osc.type = "sine";
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.08);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now); osc.stop(now + 0.08);
        break;

      case "correct":
        // 正解：明るい3音（各ノートをそれぞれ独立したオシレータで鳴らしクリーンに止める）
        [523, 659, 784].forEach((freq, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.type = "triangle";
          o.frequency.setValueAtTime(freq, now + i * 0.1);
          g.gain.setValueAtTime(0.22, now + i * 0.1);
          // フェードアウトせずノートの長さで止める（気持ち悪いフェードなし）
          g.gain.setValueAtTime(0.22, now + i * 0.1 + 0.08);
          g.gain.linearRampToValueAtTime(0, now + i * 0.1 + 0.1);
          o.start(now + i * 0.1);
          o.stop(now + i * 0.1 + 0.11);
        });
        return;

      case "wrong":
        // 不正解：低いブザー音
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.25);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now); osc.stop(now + 0.25);
        break;

      case "perfect":
        // 全問正解：ファンファーレ
        const notes = [523, 659, 784, 1047];
        notes.forEach((freq, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.type = "triangle";
          o.frequency.setValueAtTime(freq, now + i * 0.12);
          g.gain.setValueAtTime(0.18, now + i * 0.12);
          g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.25);
          o.start(now + i * 0.12);
          o.stop(now + i * 0.12 + 0.25);
        });
        return;

      case "mastered":
        // 習得達成：キラキラ音
        [1047, 1319, 1568, 2093].forEach((freq, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.type = "sine";
          o.frequency.setValueAtTime(freq, now + i * 0.08);
          g.gain.setValueAtTime(0.12, now + i * 0.08);
          g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.2);
          o.start(now + i * 0.08);
          o.stop(now + i * 0.08 + 0.2);
        });
        return;

      case "click":
        // 汎用クリック
        osc.type = "sine";
        osc.frequency.setValueAtTime(600, now);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now); osc.stop(now + 0.05);
        break;
    }
  } catch (e) {
    console.warn("Audio error:", e);
  }
}

// ─────────────────────────────────────────────────────────────
// 🔊 ミュートボタン UI 更新
// ─────────────────────────────────────────────────────────────
function updateSoundBtn() {
  const btn = document.getElementById("btn-sound");
  if (!btn) return;
  btn.textContent = soundEnabled ? "🔊" : "🔇";
  btn.title       = soundEnabled ? "効果音オフ" : "効果音オン";
}

// ═══════════════════════════════════════════════════════════════
// 📊 学習統計（連続学習日数・streak）
// ═══════════════════════════════════════════════════════════════
const LS_STREAK = "eiken_streak";

function getTodayStr() {
  return new Date().toISOString().slice(0, 10); // "2025-06-01"
}

function getStreak() {
  try { return JSON.parse(localStorage.getItem(LS_STREAK)) || { days: 0, lastDate: "" }; }
  catch { return { days: 0, lastDate: "" }; }
}

function touchStreak() {
  const today  = getTodayStr();
  const streak = getStreak();
  if (streak.lastDate === today) return streak.days;

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const days = streak.lastDate === yesterday ? streak.days + 1 : 1;
  localStorage.setItem(LS_STREAK, JSON.stringify({ days, lastDate: today }));
  return days;
}

// ═══════════════════════════════════════════════════════════════
// 状態
// ═══════════════════════════════════════════════════════════════
let allWords    = [];
let progress    = {};
let currentUser = null;

let currentUnit         = null;
let currentSession      = 0;
const SESSION_SIZE      = 20;
let sessionWords        = [];
let currentTab          = "card";
let currentFilterMode   = "all";   // "all" | "unlearned" | "notMastered"
let currentFilteredWords = [];

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

function getUnits() {
  return [...new Set(allWords.map(w => w.unit))].sort((a, b) => a - b);
}
function wordsOfUnit(unit) {
  return allWords.filter(w => w.unit === unit);
}

// 未習得（unlearned）のみ返す
function unlearnedOfUnit(unit) {
  return wordsOfUnit(unit).filter(w => getWordProgress(w.id).status === "unlearned");
}
// 未習得 + 学習中（mastered以外）を返す
function notMasteredOfUnit(unit) {
  return wordsOfUnit(unit).filter(w => getWordProgress(w.id).status !== "mastered");
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
  const wasMastered = status === "mastered";

  if (isCorrect) {
    successCount = Math.min(successCount + 1, 10);
    status = successCount >= 3 ? "mastered" : "learning";
  } else {
    successCount = 0;
    status = "learning";
  }

  // 習得達成した瞬間に特別音
  if (!wasMastered && status === "mastered") {
    setTimeout(() => playSound("mastered"), 300);
    showToast("🎉 習得済みになりました！", "success");
  }

  progress[wordId] = { status, successCount, lastReviewed: new Date().toISOString() };
  saveLocalProgress();
  touchStreak();

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
// Firestore 進捗取得 (ローカルとマージ：successCount が大きい方を採用)
// ─────────────────────────────────────────────────────────────
async function fetchFirestoreProgress(uid) {
  if (!firebaseReady) return;
  try {
    const snap = await getDocs(collection(db, "users", uid, "progress"));
    snap.forEach(d => {
      const data = d.data();
      const remote = {
        status:       data.status       ?? "unlearned",
        successCount: data.successCount ?? 0,
        lastReviewed: data.lastReviewed instanceof Timestamp
          ? data.lastReviewed.toDate().toISOString()
          : data.lastReviewed ?? null,
      };
      const local = progress[d.id];
      // ローカルの方が進んでいれば保持、そうでなければリモートを採用
      if (!local || remote.successCount > local.successCount) {
        progress[d.id] = remote;
      }
    });
    saveLocalProgress();
    console.log("✅ Firestoreから進捗を同期しました");
  } catch (e) {
    console.warn("Firestore 進捗取得失敗:", e);
  }
}

// ローカルの全進捗を Firestore にアップロード
// ─────────────────────────────────────────────────────────────
async function uploadProgressToFirestore() {
  if (!firebaseReady || !currentUser || currentUser.isAnonymous) return 0;
  const entries = Object.entries(progress);
  if (entries.length === 0) return 0;
  let count = 0;
  try {
    await Promise.all(entries.map(([wordId, p]) =>
      setDoc(
        doc(db, "users", currentUser.uid, "progress", wordId),
        { status: p.status, successCount: p.successCount, lastReviewed: p.lastReviewed ?? null },
        { merge: true }
      ).then(() => count++)
    ));
  } catch (e) {
    console.warn("Firestore 一括アップロード失敗:", e);
  }
  return count;
}

// ═══════════════════════════════════════════════════════════════
// UI ヘルパー
// ═══════════════════════════════════════════════════════════════
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
  t._timer = setTimeout(() => t.classList.remove("show"), 2400);
}

function showScreen(id) {
  ["screen-home", "screen-study", "screen-wordlist"].forEach(s =>
    document.getElementById(s).classList.toggle("hidden", s !== id)
  );
  document.getElementById("btn-back-home").classList.toggle("hidden", id === "screen-home");
}

// ═══════════════════════════════════════════════════════════════
// 🎯 学習フィルター
// ═══════════════════════════════════════════════════════════════
const FILTER_DESC = {
  all:         "全単語を表示しています。ユニットをタップして学習開始。",
  notMastered: "未習得・学習中の単語のみ表示。ユニットをタップして弱点集中学習。",
  unlearned:   "まだ一度も学習していない単語のみ。ユニットをタップして新規学習。",
};

window.setFilter = function(mode) {
  currentFilterMode = mode;
  // ボタンのスタイル切り替え
  document.querySelectorAll(".filter-btn").forEach(btn => {
    const isActive = btn.id === `filter-${mode}`;
    btn.classList.toggle("bg-ink-700/60",  isActive);
    btn.classList.toggle("text-jade-400",  isActive);
    btn.classList.toggle("text-ink-400",   !isActive);
  });
  const descEl = document.getElementById("filter-desc");
  if (descEl) descEl.textContent = FILTER_DESC[mode] ?? "";
  renderHome();
};

// ═══════════════════════════════════════════════════════════════
// ホーム画面
// ═══════════════════════════════════════════════════════════════
function renderHome() {
  const mastered = allWords.filter(w => getWordProgress(w.id).status === "mastered").length;
  const learning = allWords.filter(w => getWordProgress(w.id).status === "learning").length;
  const streak   = getStreak().days;

  document.getElementById("stat-total").textContent    = allWords.length;
  document.getElementById("stat-mastered").textContent = mastered;
  document.getElementById("stat-learning").textContent = learning;

  // streak バッジ
  const streakEl = document.getElementById("stat-streak");
  if (streakEl) streakEl.textContent = `🔥 ${streak}日連続`;

  // 全体進捗バー
  const overallPct = allWords.length ? Math.round((mastered / allWords.length) * 100) : 0;
  const overallBar = document.getElementById("overall-progress-bar");
  const overallLbl = document.getElementById("overall-progress-label");
  if (overallBar) overallBar.style.width = `${overallPct}%`;
  if (overallLbl) overallLbl.textContent = `全体進捗 ${overallPct}%（${mastered} / ${allWords.length}語習得）`;

  const reviewWords = getReviewWords();
  document.getElementById("review-alert").classList.toggle("hidden", reviewWords.length === 0);
  document.getElementById("review-count").textContent = reviewWords.length;

  // ユニットグリッド（フィルター対応）
  document.getElementById("unit-grid").innerHTML = getUnits().map(u => {
    const words      = wordsOfUnit(u);
    const tot        = words.length;
    const mast       = words.filter(w => getWordProgress(w.id).status === "mastered").length;
    const pct        = tot ? Math.round((mast / tot) * 100) : 0;
    const done       = pct === 100;

    // フィルター別の対象語数
    const unlCnt  = unlearnedOfUnit(u).length;
    const notMCnt = notMasteredOfUnit(u).length;
    const filterCount = currentFilterMode === "unlearned"    ? unlCnt
                      : currentFilterMode === "notMastered"  ? notMCnt
                      : tot;
    const filterLabel = currentFilterMode === "unlearned"    ? `未学習 ${unlCnt}語`
                      : currentFilterMode === "notMastered"  ? `対象 ${notMCnt}語`
                      : `${tot}語`;
    const isEmpty = filterCount === 0;

    return `
      <div class="rounded-2xl border ${done ? 'border-gold-400/40 bg-gold-400/5' : isEmpty ? 'border-ink-700/30 bg-ink-800/30' : 'border-ink-700/60 bg-ink-800/60'} overflow-hidden">
        <button class="unit-card w-full p-4 text-left ${isEmpty ? 'opacity-50' : ''}"
                onclick="startUnit(${u})">
          <div class="flex items-center justify-between mb-3">
            <span class="font-display text-lg ${done ? 'text-gold-300' : 'text-ink-100'}">
              ${done ? '✓ ' : ''}Unit ${u}
            </span>
            <span class="text-xs font-mono ${isEmpty ? 'text-ink-600' : currentFilterMode !== 'all' ? 'text-ember-400' : 'text-ink-500'}">${filterLabel}</span>
          </div>
          <div class="w-full h-1.5 rounded-full bg-ink-700 mb-2">
            <div class="progress-fill h-full rounded-full ${done ? 'bg-gold-400' : 'bg-gradient-to-r from-jade-600 to-jade-400'}"
                 style="width:${pct}%"></div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs text-ink-500">${mast}/${tot} 習得</span>
            <span class="text-xs ${done ? 'text-gold-400' : 'text-jade-500'} font-mono">${pct}%</span>
          </div>
        </button>
        <button class="w-full py-2 border-t border-ink-700/40 text-xs text-ink-400 hover:text-ink-200 hover:bg-ink-700/30 transition-colors"
                onclick="openWordList(${u})">
          単語一覧 →
        </button>
      </div>`;
  }).join("");
}


// ═══════════════════════════════════════════════════════════════
// 単語一覧画面
// ═══════════════════════════════════════════════════════════════
let wordlistUnit = null;
let wordlistFilter = "all";

window.openWordList = function(unit) {
  wordlistUnit = unit;
  wordlistFilter = "all";
  renderWordList();
  showScreen("screen-wordlist");
};

function renderWordList() {
  const words = wordsOfUnit(wordlistUnit);
  const filtered = wordlistFilter === "all" ? words
    : words.filter(w => getWordProgress(w.id).status === wordlistFilter);

  const mastered  = words.filter(w => getWordProgress(w.id).status === "mastered").length;
  const learning  = words.filter(w => getWordProgress(w.id).status === "learning").length;
  const unlearned = words.length - mastered - learning;

  document.getElementById("wordlist-title").textContent = `Unit ${wordlistUnit}`;
  document.getElementById("wordlist-subtitle").textContent =
    `習得済 ${mastered}  /  学習中 ${learning}  /  未習得 ${unlearned}`;

  document.querySelectorAll(".wl-filter-btn").forEach(btn => {
    const active = btn.dataset.filter === wordlistFilter;
    btn.className = "wl-filter-btn px-2.5 py-1 rounded-lg text-xs font-medium transition-all " +
      (active ? "bg-ink-600 text-ink-100" : "text-ink-400 hover:text-ink-200");
  });

  const STATUS = {
    mastered: { label: "習得済",  cls: "bg-jade-500/20 text-jade-400 border-jade-500/30" },
    learning: { label: "学習中",  cls: "bg-ember-500/20 text-ember-400 border-ember-500/30" },
    unlearned:{ label: "未習得",  cls: "bg-ink-700/60 text-ink-500 border-ink-600/30" },
  };

  document.getElementById("wordlist-body").innerHTML = filtered.length === 0
    ? `<p class="text-center text-ink-500 py-12 text-sm">該当する単語がありません</p>`
    : filtered.map(w => {
        const p  = getWordProgress(w.id);
        const s  = STATUS[p.status] ?? STATUS.unlearned;
        const sc = p.successCount ?? 0;
        return `
          <div class="flex items-center gap-3 px-4 py-3 rounded-2xl border border-ink-700/40 bg-ink-800/50">
            <div class="flex-1 min-w-0">
              <p class="text-ink-100 font-medium text-sm">${w.word}</p>
              <p class="text-ink-400 text-xs mt-0.5">${w.meaning}</p>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <span class="text-xs text-ink-600 font-mono">${sc}/3</span>
              <span class="px-2 py-0.5 rounded-full border text-xs font-medium ${s.cls}">${s.label}</span>
            </div>
          </div>`;
      }).join("");
}

// ═══════════════════════════════════════════════════════════════
// ユニット開始
// ═══════════════════════════════════════════════════════════════
window.startUnit = function(unit, filterMode) {
  playSound("click");
  currentUnit       = unit;
  currentFilterMode = filterMode ?? currentFilterMode;

  const allU       = wordsOfUnit(unit);
  const unlearned  = unlearnedOfUnit(unit);
  const notMastered = notMasteredOfUnit(unit);

  // フィルターに応じた単語リスト
  let filteredWords;
  if (currentFilterMode === "unlearned")    filteredWords = unlearned;
  else if (currentFilterMode === "notMastered") filteredWords = notMastered;
  else                                           filteredWords = allU;

  currentFilteredWords = filteredWords;

  if (filteredWords.length === 0) {
    showToast(
      currentFilterMode === "unlearned" ? "このユニットに未習得語はありません 🎉" : "このユニットに未習得・学習中語はありません 🎉",
      "success"
    );
    return;
  }

  const sessions = Math.ceil(filteredWords.length / SESSION_SIZE);
  document.getElementById("study-title").textContent = `Unit ${unit}`;

  const filterLabel = {
    all:         `全${allU.length}語`,
    unlearned:   `未習得 ${unlearned.length}語`,
    notMastered: `未習得+学習中 ${notMastered.length}語`,
  }[currentFilterMode];
  document.getElementById("study-subtitle").textContent = filterLabel;

  const sel = document.getElementById("session-select");
  sel.innerHTML = Array.from({ length: sessions }, (_, i) => {
    const from = i * SESSION_SIZE + 1;
    const to   = Math.min((i + 1) * SESSION_SIZE, filteredWords.length);
    return `<option value="${i}">${i + 1}/${sessions} (${from}-${to}語)</option>`;
  }).join("");
  sel.value = "0";

  loadSessionFromWords(filteredWords, 0);
  showScreen("screen-study");
};

function loadSession(unit, sessionIdx) {
  loadSessionFromWords(currentFilteredWords.length > 0 ? currentFilteredWords : wordsOfUnit(unit), sessionIdx);
}

function loadSessionFromWords(words, sessionIdx) {
  currentSession = sessionIdx;
  const sessions = Math.ceil(words.length / SESSION_SIZE);
  sessionWords   = words.slice(sessionIdx * SESSION_SIZE, (sessionIdx + 1) * SESSION_SIZE);
  document.getElementById("study-subtitle").textContent = `セッション ${sessionIdx + 1}/${sessions}`;
  switchTab(currentTab);
}

// ═══════════════════════════════════════════════════════════════
// タブ切り替え
// ═══════════════════════════════════════════════════════════════
function switchTab(tab) {
  playSound("click");
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
  if (tab === "ja2en")  initJa2EnMode();
  if (tab === "listen") initListenMode();
  if (tab === "timed")  initTimedMode();
  if (tab !== "timed")  stopTimedTimer();
}

// ═══════════════════════════════════════════════════════════════
// ── カードモード ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
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
  document.getElementById("card-word-front").textContent    = w.word;
  document.getElementById("card-meaning-back").textContent  = w.meaning;
  document.getElementById("card-word-back-sub").textContent = w.word;
  document.getElementById("card-pos").textContent           = w.pos ?? "";
  document.getElementById("card-index-front").textContent   = `${cardIdx + 1} / ${words.length}`;
  const p = getWordProgress(w.id);
  // 習得バッジ
  const badge = document.getElementById("card-status-badge");
  if (badge) {
    if (p.status === "mastered")      { badge.textContent = "✓ 習得済"; badge.className = "text-xs font-mono text-jade-400 bg-jade-500/10 px-2 py-0.5 rounded-full"; }
    else if (p.status === "learning") { badge.textContent = `${p.successCount}/3回`; badge.className = "text-xs font-mono text-gold-400 bg-gold-400/10 px-2 py-0.5 rounded-full"; }
    else                              { badge.textContent = "未学習"; badge.className = "text-xs font-mono text-ink-500 bg-ink-700 px-2 py-0.5 rounded-full"; }
  }
  cardFlipped = false;
  document.getElementById("card-inner").classList.remove("is-flipped");
  document.getElementById("card-actions-pre").classList.remove("hidden");
  document.getElementById("card-actions-post").classList.add("hidden");
}

function flipCard() {
  if (cardFlipped) return;
  playSound("flip");
  cardFlipped = true;
  document.getElementById("card-inner").classList.add("is-flipped");
  document.getElementById("card-actions-pre").classList.add("hidden");
  document.getElementById("card-actions-post").classList.remove("hidden");
}

function cardJudge(know) {
  const words = initCardMode._words ?? [];
  const w = words[cardIdx];
  if (know) {
    playSound("correct");
    cardKnow.push(w);
    showToast("✓ 覚えた！", "success");
  } else {
    playSound("wrong");
    cardDunno.push(w);
    showToast("→ あとで復習", "info");
  }
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
  if (cardDunno.length === 0) playSound("perfect");
}

// ═══════════════════════════════════════════════════════════════
// ── 4択モード ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
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
  const pool      = unitWords.length >= 3 ? unitWords : allWords.filter(x => x.id !== w.id);
  const dummies   = shuffle(pool).slice(0, 3).map(x => x.meaning);
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
    playSound("correct");
    showFeedback("✓", "jade");
    showToast("正解！", "success");
  } else {
    btn.classList.add("incorrect");
    choiceWrong.push(wordId);
    playSound("wrong");
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
  if (choiceWrong.length === 0) playSound("perfect");
  else if (choiceCorrect / choiceWords.length >= 0.8) playSound("correct");
}

// ═══════════════════════════════════════════════════════════════
// ── 記述モード ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
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
    playSound("correct");
    feedback.className   = "mb-4 rounded-2xl p-5 text-center animate-pop-in bg-jade-500/10 border border-jade-500/30";
    msg.textContent      = "✓ 正解！";
    msg.className        = "text-sm font-medium mb-2 text-jade-400";
    answerEl.textContent = w.word;
    answerEl.className   = "font-mono text-3xl font-bold text-jade-300";
    showToast("正解！", "success");
  } else {
    spellWrong.push(w.id);
    playSound("wrong");
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
  if (spellWrong.length === 0) playSound("perfect");
  else if (spellCorrect / spellWords.length >= 0.8) playSound("correct");
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
// タッチ / スワイプ
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

// ═══════════════════════════════════════════════════════════════
// ── 日本語→英語 4択モード (ja2en) ────────────────────────────
// ═══════════════════════════════════════════════════════════════
let ja2enIdx = 0, ja2enWords = [], ja2enCorrect = 0, ja2enWrong = [], ja2enAnswered = false;

function initJa2EnMode(words) {
  ja2enCorrect  = 0;
  ja2enWrong    = [];
  ja2enIdx      = 0;
  ja2enAnswered = false;
  ja2enWords    = shuffle(words ?? [...sessionWords]);
  document.getElementById("ja2en-session-end").classList.add("hidden");
  document.getElementById("ja2en-result").classList.add("hidden");
  updateTestProgress2("ja2en");
  renderJa2En();
}

function renderJa2En() {
  if (ja2enIdx >= ja2enWords.length) { endJa2EnSession(); return; }
  const w = ja2enWords[ja2enIdx];
  document.getElementById("ja2en-meaning").textContent = w.meaning;
  ja2enAnswered = false;
  document.getElementById("ja2en-result").classList.add("hidden");

  const pool    = allWords.filter(x => x.id !== w.id);
  const dummies = shuffle(pool).slice(0, 3).map(x => x.word);
  const options = shuffle([w.word, ...dummies]);

  document.getElementById("ja2en-options").innerHTML = options.map((opt, i) => `
    <button class="choice-btn w-full text-left px-5 py-3.5 rounded-2xl bg-ink-800/80 border border-ink-700/60 text-ink-200 text-sm font-mono font-medium"
            data-correct="${opt === w.word}"
            onclick="handleJa2En(this,'${w.id}',${opt === w.word})">
      <span class="text-ink-500 mr-2">${String.fromCharCode(65+i)}.</span>${opt}
    </button>`).join("");

  updateTestProgress2("ja2en");
}

window.handleJa2En = async function(btn, wordId, isCorrect) {
  if (ja2enAnswered) return;
  ja2enAnswered = true;
  document.querySelectorAll("#ja2en-options .choice-btn").forEach(b => {
    b.disabled = true;
    if (b.dataset.correct === "true") b.classList.add("correct");
  });
  if (isCorrect) {
    btn.classList.add("correct"); ja2enCorrect++;
    playSound("correct"); showFeedback2("ja2en","✓","jade"); showToast("正解！","success");
  } else {
    btn.classList.add("incorrect"); ja2enWrong.push(wordId);
    playSound("wrong"); showFeedback2("ja2en","✕","rose"); showToast("不正解…","error");
  }
  await updateWordProgress(wordId, isCorrect);
  setTimeout(() => { hideFeedback2("ja2en"); ja2enIdx++; renderJa2En(); }, 900);
};

function endJa2EnSession() {
  document.getElementById("ja2en-session-end").classList.remove("hidden");
  document.getElementById("ja2en-result-correct").textContent = ja2enCorrect;
  document.getElementById("ja2en-result-wrong").textContent   = ja2enWrong.length;
  document.getElementById("btn-ja2en-retry-wrong").classList.toggle("hidden", ja2enWrong.length === 0);
  if (ja2enWrong.length === 0) playSound("perfect");
  else if (ja2enCorrect / ja2enWords.length >= 0.8) playSound("correct");
}

// ═══════════════════════════════════════════════════════════════
// ── リスニングモード (listen) ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════
let listenIdx = 0, listenWords = [], listenCorrect = 0, listenWrong = [], listenAnswered = false;

function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "en-US"; utt.rate = 0.9; utt.pitch = 1.0;
  const btn = document.getElementById("btn-listen-speak");
  if (btn) { btn.classList.add("speaking"); utt.onend = () => btn.classList.remove("speaking"); }
  window.speechSynthesis.speak(utt);
}

function initListenMode(words) {
  listenCorrect  = 0;
  listenWrong    = [];
  listenIdx      = 0;
  listenAnswered = false;
  listenWords    = shuffle(words ?? [...sessionWords]);
  document.getElementById("listen-session-end").classList.add("hidden");
  document.getElementById("listen-result").classList.add("hidden");
  updateTestProgress2("listen");
  renderListen();
}

function renderListen() {
  if (listenIdx >= listenWords.length) { endListenSession(); return; }
  const w = listenWords[listenIdx];
  listenAnswered = false;
  document.getElementById("listen-result").classList.add("hidden");
  document.getElementById("listen-hint").textContent = "ボタンをタップして再生";

  const pool    = allWords.filter(x => x.id !== w.id);
  const dummies = shuffle(pool).slice(0, 3).map(x => x.meaning);
  const options = shuffle([w.meaning, ...dummies]);

  document.getElementById("listen-options").innerHTML = options.map((opt, i) => `
    <button class="choice-btn w-full text-left px-5 py-3.5 rounded-2xl bg-ink-800/80 border border-ink-700/60 text-ink-200 text-sm font-medium"
            data-correct="${opt === w.meaning}"
            onclick="handleListen(this,'${w.id}',${opt === w.meaning})">
      <span class="text-ink-500 font-mono mr-2">${String.fromCharCode(65+i)}.</span>${opt}
    </button>`).join("");

  // auto-play after a short delay
  setTimeout(() => speak(w.word), 300);
  updateTestProgress2("listen");
}

window.handleListen = async function(btn, wordId, isCorrect) {
  if (listenAnswered) return;
  listenAnswered = true;
  document.querySelectorAll("#listen-options .choice-btn").forEach(b => {
    b.disabled = true;
    if (b.dataset.correct === "true") b.classList.add("correct");
  });
  const w = listenWords[listenIdx];
  if (isCorrect) {
    btn.classList.add("correct"); listenCorrect++;
    playSound("correct"); showFeedback2("listen","✓","jade"); showToast("正解！","success");
  } else {
    btn.classList.add("incorrect"); listenWrong.push(wordId);
    playSound("wrong"); showFeedback2("listen","✕","rose"); showToast("不正解…","error");
  }
  document.getElementById("listen-result").classList.remove("hidden");
  document.getElementById("listen-result-msg").textContent  = isCorrect ? "正解！" : "不正解";
  document.getElementById("listen-correct-word").textContent = w.word;
  await updateWordProgress(wordId, isCorrect);
  hideFeedback2("listen");
};

function endListenSession() {
  document.getElementById("listen-session-end").classList.remove("hidden");
  document.getElementById("listen-result-correct").textContent = listenCorrect;
  document.getElementById("listen-result-wrong").textContent   = listenWrong.length;
  document.getElementById("btn-listen-retry-wrong").classList.toggle("hidden", listenWrong.length === 0);
  if (listenWrong.length === 0) playSound("perfect");
}

// ═══════════════════════════════════════════════════════════════
// ── 時間制限クイズ (timed) ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
const TIMED_SECONDS = 10;
let timedIdx = 0, timedWords = [], timedCorrect = 0, timedWrong = 0;
let timedStreak = 0, timedMaxStreak = 0;
let timedAnswered = false, timedTimerInterval = null, timedTimeLeft = TIMED_SECONDS;

function stopTimedTimer() {
  if (timedTimerInterval) { clearInterval(timedTimerInterval); timedTimerInterval = null; }
}

function startTimedTimer() {
  stopTimedTimer();
  timedTimeLeft = TIMED_SECONDS;
  updateTimerUI();
  timedTimerInterval = setInterval(() => {
    timedTimeLeft = Math.max(0, timedTimeLeft - 0.1);
    updateTimerUI();
    if (timedTimeLeft <= 0) {
      stopTimedTimer();
      if (!timedAnswered) timedTimeout();
    }
  }, 100);
}

function updateTimerUI() {
  const pct = (timedTimeLeft / TIMED_SECONDS) * 100;
  const bar = document.getElementById("timed-timer-bar");
  const lbl = document.getElementById("timed-timer-label");
  if (!bar || !lbl) return;
  bar.style.width = pct + "%";
  bar.classList.toggle("danger", timedTimeLeft <= 3);
  bar.style.background = timedTimeLeft <= 3 ? "#fb7185" : timedTimeLeft <= 5 ? "#fbbf24" : "#4ade80";
  lbl.textContent = timedTimeLeft.toFixed(1) + "s";
  lbl.style.color = timedTimeLeft <= 3 ? "#fb7185" : timedTimeLeft <= 5 ? "#fbbf24" : "#fbbf24";
}

function timedTimeout() {
  if (timedAnswered) return;
  timedAnswered = true;
  timedWrong++;
  timedStreak = 0;
  document.querySelectorAll("#timed-options .choice-btn").forEach(b => {
    b.disabled = true;
    if (b.dataset.correct === "true") b.classList.add("correct");
  });
  playSound("wrong");
  showFeedback2("timed","⏰","rose");
  showToast("時間切れ！","error");
  setTimeout(() => { hideFeedback2("timed"); timedIdx++; renderTimed(); }, 900);
}

function initTimedMode(words) {
  timedCorrect  = 0; timedWrong    = 0;
  timedStreak   = 0; timedMaxStreak= 0;
  timedIdx      = 0; timedAnswered = false;
  timedWords    = shuffle(words ?? [...sessionWords]);
  stopTimedTimer();
  document.getElementById("timed-session-end").classList.add("hidden");
  document.getElementById("timed-streak-label").textContent = "連続正解: 0";
  updateTestProgress2("timed");
  renderTimed();
}

function renderTimed() {
  if (timedIdx >= timedWords.length) { stopTimedTimer(); endTimedSession(); return; }
  const w = timedWords[timedIdx];
  document.getElementById("timed-word").textContent = w.word;
  timedAnswered = false;

  const pool    = allWords.filter(x => x.id !== w.id);
  const dummies = shuffle(pool).slice(0, 3).map(x => x.meaning);
  const options = shuffle([w.meaning, ...dummies]);

  document.getElementById("timed-options").innerHTML = options.map((opt, i) => `
    <button class="choice-btn w-full text-left px-5 py-3.5 rounded-2xl bg-ink-800/80 border border-ink-700/60 text-ink-200 text-sm font-medium"
            data-correct="${opt === w.meaning}"
            onclick="handleTimed(this,'${w.id}',${opt === w.meaning})">
      <span class="text-ink-500 font-mono mr-2">${String.fromCharCode(65+i)}.</span>${opt}
    </button>`).join("");

  updateTestProgress2("timed");
  startTimedTimer();
}

window.handleTimed = async function(btn, wordId, isCorrect) {
  if (timedAnswered) return;
  timedAnswered = true;
  stopTimedTimer();
  document.querySelectorAll("#timed-options .choice-btn").forEach(b => {
    b.disabled = true;
    if (b.dataset.correct === "true") b.classList.add("correct");
  });
  if (isCorrect) {
    btn.classList.add("correct"); timedCorrect++;
    timedStreak++; if (timedStreak > timedMaxStreak) timedMaxStreak = timedStreak;
    playSound("correct"); showFeedback2("timed","✓","jade"); showToast("正解！","success");
  } else {
    btn.classList.add("incorrect"); timedWrong++;
    timedStreak = 0;
    playSound("wrong"); showFeedback2("timed","✕","rose"); showToast("不正解…","error");
  }
  document.getElementById("timed-streak-label").textContent = `連続正解: ${timedStreak}`;
  await updateWordProgress(wordId, isCorrect);
  setTimeout(() => { hideFeedback2("timed"); timedIdx++; renderTimed(); }, 700);
};

function endTimedSession() {
  document.getElementById("timed-session-end").classList.remove("hidden");
  document.getElementById("timed-result-correct").textContent = timedCorrect;
  document.getElementById("timed-result-wrong").textContent   = timedWrong;
  document.getElementById("timed-result-streak").textContent  = timedMaxStreak;
  document.getElementById("timed-end-icon").textContent =
    timedWrong === 0 ? "🏆" : timedCorrect / (timedCorrect + timedWrong) >= 0.8 ? "🎯" : "⏱";
  if (timedWrong === 0) playSound("perfect");
  else if (timedCorrect / timedWords.length >= 0.8) playSound("correct");
}

// ─────────────────────────────────────────────────────────────
// 新モード用共通ヘルパー
// ─────────────────────────────────────────────────────────────
function showFeedback2(mode, icon, color) {
  const el = document.getElementById(`${mode}-feedback`);
  const ic = document.getElementById(`${mode}-feedback-icon`);
  if (!el || !ic) return;
  ic.textContent = icon;
  ic.className   = `text-8xl animate-pop-in ${color === "jade" ? "text-jade-400" : "text-rose-400"}`;
  el.classList.remove("hidden");
}
function hideFeedback2(mode) {
  document.getElementById(`${mode}-feedback`)?.classList.add("hidden");
}

function updateTestProgress2(mode) {
  let current, total, correct;
  if (mode === "ja2en")  { current = ja2enIdx;  total = ja2enWords.length;  correct = ja2enCorrect; }
  else if (mode === "listen") { current = listenIdx; total = listenWords.length; correct = listenCorrect; }
  else if (mode === "timed")  { current = timedIdx;  total = timedWords.length;  correct = timedCorrect; }
  else return;
  const pct = total ? (current / total) * 100 : 0;
  document.getElementById("progress-fill").style.width  = `${pct}%`;
  document.getElementById("progress-label").textContent = `${current} / ${total}`;
  document.getElementById("progress-score").textContent = `正解: ${correct}`;
}

// ═══════════════════════════════════════════════════════════════
// イベントバインド
// ═══════════════════════════════════════════════════════════════
function bindEvents() {
  // ── ナビ ──
  document.getElementById("btn-back-home").addEventListener("click", () => {
    playSound("click");
    renderHome();
    showScreen("screen-home");
    document.getElementById("card-scene").style.visibility = "";
  });

  document.getElementById("btn-back-from-wordlist").addEventListener("click", () => {
    renderHome();
    showScreen("screen-home");
  });

  document.getElementById("screen-wordlist").addEventListener("click", e => {
    const btn = e.target.closest(".wl-filter-btn");
    if (!btn) return;
    wordlistFilter = btn.dataset.filter;
    renderWordList();
  });

  // ── 🔊 ミュートトグル ──
  const soundBtn = document.getElementById("btn-sound");
  if (soundBtn) {
    soundBtn.addEventListener("click", () => {
      soundEnabled = !soundEnabled;
      localStorage.setItem("soundEnabled", soundEnabled);
      updateSoundBtn();
      if (soundEnabled) playSound("click");
    });
  }

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
    playSound("click");
    document.getElementById("card-session-end").classList.add("hidden");
    document.getElementById("card-scene").style.visibility = "";
    initCardMode(cardDunno);
  });
  document.getElementById("btn-card-finish").addEventListener("click", () => {
    playSound("click");
    renderHome(); showScreen("screen-home");
    document.getElementById("card-scene").style.visibility = "";
  });

  // ── 4択 ──
  document.getElementById("btn-choice-retry-wrong").addEventListener("click", () => {
    playSound("click");
    document.getElementById("choice-session-end").classList.add("hidden");
    initChoiceMode(allWords.filter(w => choiceWrong.includes(w.id)));
  });
  document.getElementById("btn-choice-finish").addEventListener("click", () => {
    playSound("click");
    renderHome(); showScreen("screen-home");
  });

  // ── 記述 ──
  document.getElementById("btn-spell-submit").addEventListener("click", submitSpell);
  document.getElementById("spell-input").addEventListener("keydown", e => {
    if (e.key === "Enter") submitSpell();
  });
  document.getElementById("btn-spell-next").addEventListener("click", () => {
    playSound("click");
    spellIdx++; renderSpell();
  });
  document.getElementById("btn-spell-retry-wrong").addEventListener("click", () => {
    playSound("click");
    document.getElementById("spell-session-end").classList.add("hidden");
    initSpellMode(allWords.filter(w => spellWrong.includes(w.id)));
  });
  document.getElementById("btn-spell-finish").addEventListener("click", () => {
    playSound("click");
    renderHome(); showScreen("screen-home");
  });

  // ── 日本語→英語 ──
  document.getElementById("btn-ja2en-next").addEventListener("click", () => {
    playSound("click"); ja2enIdx++; renderJa2En();
  });
  document.getElementById("btn-ja2en-retry-wrong").addEventListener("click", () => {
    playSound("click");
    document.getElementById("ja2en-session-end").classList.add("hidden");
    initJa2EnMode(allWords.filter(w => ja2enWrong.includes(w.id)));
  });
  document.getElementById("btn-ja2en-finish").addEventListener("click", () => {
    playSound("click"); renderHome(); showScreen("screen-home");
  });

  // ── リスニング ──
  document.getElementById("btn-listen-speak").addEventListener("click", () => {
    if (listenIdx < listenWords.length) speak(listenWords[listenIdx].word);
  });
  document.getElementById("btn-listen-next").addEventListener("click", () => {
    playSound("click"); listenIdx++; renderListen();
  });
  document.getElementById("btn-listen-retry-wrong").addEventListener("click", () => {
    playSound("click");
    document.getElementById("listen-session-end").classList.add("hidden");
    initListenMode(allWords.filter(w => listenWrong.includes(w.id)));
  });
  document.getElementById("btn-listen-finish").addEventListener("click", () => {
    playSound("click"); renderHome(); showScreen("screen-home");
  });

  // ── タイムアタック ──
  document.getElementById("btn-timed-retry").addEventListener("click", () => {
    playSound("click");
    document.getElementById("timed-session-end").classList.add("hidden");
    initTimedMode();
  });
  document.getElementById("btn-timed-finish").addEventListener("click", () => {
    stopTimedTimer(); playSound("click"); renderHome(); showScreen("screen-home");
  });

  // ── 復習 ──
  document.getElementById("btn-start-review").addEventListener("click", () => {
    playSound("click");
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
    playSound("click");
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

  // メール/パスワード認証
  function getEmailFields() {
    return {
      email:    document.getElementById("input-email").value.trim(),
      password: document.getElementById("input-password").value,
      errEl:    document.getElementById("email-auth-error"),
    };
  }

  document.getElementById("btn-email-signin").addEventListener("click", async () => {
    if (!firebaseReady) { showToast("Firebase未設定です", "error"); return; }
    const { email, password, errEl } = getEmailFields();
    errEl.classList.add("hidden");
    if (!email || !password) { errEl.textContent = "メールとパスワードを入力してください"; errEl.classList.remove("hidden"); return; }
    try {
      await signInWithEmailAndPassword(auth, email, password);
      showToast("ログインしました！", "success");
      document.getElementById("modal-login").classList.add("hidden");
    } catch (err) {
      errEl.textContent =
        err.code === "auth/wrong-password"     ? "パスワードが違います" :
        err.code === "auth/user-not-found"     ? "このメールは登録されていません" :
        err.code === "auth/invalid-credential" ? "メールアドレスまたはパスワードが違います" :
        err.code === "auth/invalid-email"      ? "メールアドレスの形式が正しくありません" :
        err.message;
      errEl.classList.remove("hidden");
    }
  });

  document.getElementById("btn-email-signup").addEventListener("click", async () => {
    if (!firebaseReady) { showToast("Firebase未設定です", "error"); return; }
    const { email, password, errEl } = getEmailFields();
    errEl.classList.add("hidden");
    if (!email || !password) { errEl.textContent = "メールとパスワードを入力してください"; errEl.classList.remove("hidden"); return; }
    if (password.length < 6) { errEl.textContent = "パスワードは6文字以上にしてください"; errEl.classList.remove("hidden"); return; }
    try {
      if (currentUser?.isAnonymous) {
        try {
          await linkWithCredential(currentUser, EmailAuthProvider.credential(email, password));
          showToast("アカウントを作成しました！", "success");
        } catch (linkErr) {
          if (linkErr.code === "auth/email-already-in-use") {
            // すでに登録済み → 既存アカウントにサインイン
            await signInWithEmailAndPassword(auth, email, password);
            showToast("既存のアカウントでログインしました！", "success");
          } else {
            throw linkErr;
          }
        }
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
        showToast("アカウントを作成しました！", "success");
      }
      document.getElementById("modal-login").classList.add("hidden");
    } catch (err) {
      errEl.textContent =
        err.code === "auth/email-already-in-use" ? "このメールはすでに登録されています" :
        err.code === "auth/invalid-email"        ? "メールアドレスの形式が正しくありません" :
        err.code === "auth/weak-password"        ? "パスワードが弱すぎます" :
        err.code === "auth/invalid-credential"   ? "パスワードが違います" :
        err.message;
      errEl.classList.remove("hidden");
    }
  });
  document.getElementById("btn-logout").addEventListener("click", async () => {
    if (!firebaseReady) return;
    await signOut(auth);
    await signInAnonymously(auth);
    showToast("ログアウトしました（匿名モードに戻りました）");
  });

  document.getElementById("btn-upload-progress").addEventListener("click", async () => {
    if (!currentUser || currentUser.isAnonymous) return;
    const btn = document.getElementById("btn-upload-progress");
    btn.textContent = "保存中…";
    btn.disabled = true;
    const count = await uploadProgressToFirestore();
    btn.textContent = "↑ 保存";
    btn.disabled = false;
    showToast(`クラウドに保存しました（${count}語）`, "success");
  });
}

function showUploadBtn(visible) {
  const btn = document.getElementById("btn-upload-progress");
  if (btn) btn.classList.toggle("hidden", !visible);
}

// ═══════════════════════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════════════════════
function setupAuth() {
  if (!firebaseReady) {
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
      // ローカルの進捗をまずアップロードしてからクラウドとマージ
      if (!user.isAnonymous) await uploadProgressToFirestore();
      await fetchFirestoreProgress(user.uid);
      renderHome();
      if (!user.isAnonymous) showUploadBtn(true);
    } else {
      try {
        await signInAnonymously(auth);
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
    btnAuth.textContent = "アカウントで同期";
    btnAuth.classList.remove("hidden");
    btnLogout.classList.add("hidden");
    showUploadBtn(false);
  } else {
    label.textContent = user.displayName ?? user.email;
    label.className   = "text-xs text-jade-400 font-mono";
    btnAuth.classList.add("hidden");
    btnLogout.classList.remove("hidden");
    showUploadBtn(true);
  }
}

// ═══════════════════════════════════════════════════════════════
// エントリーポイント
// ═══════════════════════════════════════════════════════════════
async function main() {
  progress = loadLocalProgress();
  await loadWords();
  updateSoundBtn();
  bindEvents();
  setupAuth();
  renderHome();
  showScreen("screen-home");
  touchStreak(); // 今日の学習記録
}

main();
