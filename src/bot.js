import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rankingForScore, scoreDictation } from "./scoring.js";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is required.");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const content = JSON.parse(
  readFileSync(join(rootDir, "content", "sentences.json"), "utf8").replace(/^\uFEFF/, "")
);
const apiBase = `https://api.telegram.org/bot${token}`;
const sessions = new Map();
const buyMeACoffeeUrl = process.env.BUY_ME_A_COFFEE_URL ?? "";
const defaultActiveChatIds = ["8718262327", "8758266972"];
const activeChatIds = parseChatIdList(defaultActiveChatIds, process.env.ACTIVE_CHAT_IDS, process.env.PAID_CHAT_IDS);
const freeDailyLimits = {
  dictation: 3,
  listening: 2
};

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      level: null,
      current: null,
      pendingAnswer: null,
      lastScore: null,
      completedIds: new Set(),
      completedListeningIds: new Set(),
      completedScores: [],
      currentListening: null,
      daily: {
        date: todayKey(),
        dictation: 0,
        listening: 0
      },
      upgradeContext: null
    });
  }
  return sessions.get(chatId);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function commandOf(text) {
  const [command] = text.trim().split(/\s+/);
  return command.toLowerCase().split("@")[0];
}

async function telegram(method, payload) {
  const response = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`${method} failed: ${data.description}`);
  }
  return data.result;
}

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra
  });
}

async function sendAudioForSentence(chatId, sentence) {
  const audioPath = join(rootDir, sentence.audio);
  const label = sentence.id.toUpperCase().replace("_", "-");

  if (!existsSync(audioPath)) {
    await sendMessage(
      chatId,
      [
        `Sentence ${escapeHtml(label)}`,
        "",
        "Audio file is not uploaded yet.",
        `Expected file: ${escapeHtml(sentence.audio)}`
      ].join("\n")
    );
    return;
  }

  const audioBytes = readFileSync(audioPath);
  const isMp3 = sentence.audio.toLowerCase().endsWith(".mp3");
  const extension = isMp3 ? "mp3" : "ogg";
  const contentType = isMp3 ? "audio/mpeg" : "audio/ogg";
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("title", `Sentence ${label}`);
  form.append("audio", new Blob([audioBytes], { type: contentType }), `${sentence.id}.${extension}`);

  const response = await fetch(`${apiBase}/sendAudio`, {
    method: "POST",
    body: form
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`sendAudio failed: ${data.description}`);
  }
}

async function sendAudioForContent(chatId, item, titlePrefix = "Sentence") {
  const audioPath = join(rootDir, item.audio);
  const label = item.id.toUpperCase().replace("_", "-");

  if (!existsSync(audioPath)) {
    await sendMessage(
      chatId,
      [
        `${titlePrefix} ${escapeHtml(label)}`,
        "",
        "Audio file is not uploaded yet.",
        `Expected file: ${escapeHtml(item.audio)}`
      ].join("\n")
    );
    return;
  }

  const audioBytes = readFileSync(audioPath);
  const isMp3 = item.audio.toLowerCase().endsWith(".mp3");
  const extension = isMp3 ? "mp3" : "ogg";
  const contentType = isMp3 ? "audio/mpeg" : "audio/ogg";
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("title", `${titlePrefix} ${label}`);
  form.append("audio", new Blob([audioBytes], { type: contentType }), `${item.id}.${extension}`);

  const response = await fetch(`${apiBase}/sendAudio`, {
    method: "POST",
    body: form
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`sendAudio failed: ${data.description}`);
  }
}

async function showStart(chatId) {
  await sendMessage(
    chatId,
    [
      "English Dictation Practice Bot",
      "",
      "What would you like to do first?",
      "",
      "1. Listening Practice",
      "If dictation feels too difficult, start here. You can read the expanded sentences while listening several times.",
      "",
      "2. Dictation Practice",
      "Listen to one sentence, type what you hear, and get an instant score.",
      "If Beginner feels too difficult, choose Zero Level first.",
      "",
      "Free plan: 2 listening practices and 3 dictation practices per day.",
      "Coffee plan: $5 for one month of practice.",
      "",
      "Press Listening Practice if you want an easier warm-up.",
      "Send /id if you need your Telegram ID for activation."
    ].join("\n"),
    mainKeyboard()
  );
}

async function showLevelSamples(chatId) {
  const zeroSample = content.sentences.find((sentence) => sentence.level === "zero_level");
  const samples = zeroSample ? [zeroSample, ...content.samples] : content.samples;

  await sendMessage(
    chatId,
    [
      "Choose your dictation level.",
      "",
      "0. Zero Level - easiest and slowest",
      "1. Beginner",
      "2. Intermediate",
      "3. Advanced",
      "",
      "Listen to the samples below, then choose 0, 1, 2, or 3."
    ].join("\n"),
    levelKeyboard()
  );

  for (const sample of samples) {
    await sendMessage(chatId, `${levelNumber(sample.level)}. ${levelLabel(sample.level)} sample`);
    await sendAudioForSentence(chatId, sample);
  }
  await sendMessage(chatId, "Choose your level. Send 0, 1, 2, or 3.", levelKeyboard());
}

async function chooseLevel(chatId, level) {
  const session = getSession(chatId);
  session.level = level;
  await sendMessage(
    chatId,
    [
      `Great. Your level is set to ${levelLabel(level)}.`,
      `We are going to practice ${levelLabel(level)} sentences.`
    ].join("\n"),
    mainKeyboard()
  );
  await sendNextSentence(chatId);
}

async function sendNextSentence(chatId) {
  const session = getSession(chatId);
  if (!canStartPractice(chatId, session, "dictation")) {
    await sendUpgradePrompt(chatId, "dictation");
    return;
  }

  const level = session.level ?? "zero_level";
  const pool = content.sentences.filter((item) => item.level === level && !session.completedIds.has(item.id));
  const candidates = pool.length > 0 ? pool : content.sentences.filter((item) => !session.completedIds.has(item.id));

  if (candidates.length === 0) {
    await sendMessage(chatId, "No more sentences are available yet.", mainKeyboard());
    return;
  }

  const sentence = candidates[Math.floor(Math.random() * candidates.length)];
  session.current = sentence;
  session.currentListening = null;
  session.pendingAnswer = null;
  session.lastScore = null;
  markDailyUsed(session, "dictation");

  await sendMessage(chatId, `Sentence ${sentence.id.toUpperCase().replace("_", "-")}`, answerKeyboard());
  await sendAudioForSentence(chatId, sentence);
}

async function sendNextListening(chatId) {
  const session = getSession(chatId);
  const listening = Array.isArray(content.listening) ? content.listening : [];

  if (!canStartPractice(chatId, session, "listening")) {
    await sendUpgradePrompt(chatId, "listening");
    return;
  }

  const pool = listening.filter((item) => !session.completedListeningIds.has(item.id));
  const candidates = pool.length > 0 ? pool : listening;

  if (candidates.length === 0) {
    await sendMessage(chatId, "No listening practice is available yet.", mainKeyboard());
    return;
  }

  const item = candidates[Math.floor(Math.random() * candidates.length)];
  session.current = null;
  session.currentListening = item;
  session.completedListeningIds.add(item.id);
  markDailyUsed(session, "listening");

  await sendMessage(
    chatId,
    [
      `Listening Practice ${item.id.toUpperCase().replace("_", "-")}`,
      "",
      "Read the sentences below while listening to the audio.",
      "Listen several times and notice how the sentence grows step by step.",
      "",
      escapeHtml(formatListeningText(item))
    ].join("\n"),
    listeningKeyboard()
  );
  await sendAudioForContent(chatId, item, "Listening Practice");
}

async function replay(chatId) {
  const session = getSession(chatId);
  if (!session.current) {
    if (session.currentListening) {
      await sendAudioForContent(chatId, session.currentListening, "Listening Practice");
      return;
    }
    await sendMessage(chatId, "No active audio. Press Listening Practice or Dictation Practice to start.", mainKeyboard());
    return;
  }
  await sendAudioForSentence(chatId, session.current);
}

async function handleSubmission(chatId, text) {
  const session = getSession(chatId);
  if (!session.current) {
    if (session.currentListening) {
      await sendMessage(chatId, "This is listening practice. Press Repeat Audio to replay, or Next Listening Practice to continue.", listeningKeyboard());
      return;
    }
    await sendMessage(chatId, "No active sentence. Use /dictation to start.", mainKeyboard());
    return;
  }

  const result = scoreDictation(session.current.answer, text);
  session.pendingAnswer = text;
  session.lastScore = result.score;

  if (result.score >= 100) {
    session.completedIds.add(session.current.id);
    session.completedScores.push(100);
    session.current = null;
    await sendMessage(chatId, "Perfect. You ranked #1 for this sentence today.", mainKeyboard());
    await sendNextSentence(chatId);
    return;
  }

  await sendMessage(
    chatId,
    [
      `Score: ${result.score}%`,
      "",
      "Listen and try again, or see the answer and continue to the next sentence."
    ].join("\n"),
    answerKeyboard()
  );
}

async function revealAnswer(chatId) {
  const session = getSession(chatId);
  if (!session.current) {
    await sendMessage(chatId, "No active sentence.", mainKeyboard());
    return;
  }

  const score = session.lastScore ?? 0;
  const ranking = rankingForScore(score);
  session.completedIds.add(session.current.id);
  session.completedScores.push(score);

  await sendMessage(
    chatId,
    [
      "Answer:",
      escapeHtml(session.current.answer),
      "",
      ranking.perfect
        ? ranking.message
        : `Your score is in the bottom ${ranking.rank.toLocaleString("en-US")} out of ${ranking.total.toLocaleString("en-US")} learners today for this sentence.`
    ].join("\n"),
    mainKeyboard()
  );

  session.current = null;
  await sendNextSentence(chatId);
}

async function sendStatus(chatId) {
  const session = getSession(chatId);
  await sendMessage(
    chatId,
    [
      "Status",
      `Level: ${session.level ? levelLabel(session.level) : "Not selected"}`,
      `Completed: ${session.completedIds.size}`,
      `Average score: ${averageScoreText(session)}`,
      `Today: ${todayUsageText(chatId, session)}`,
      `Telegram ID: ${chatId}`
    ].join("\n"),
    mainKeyboard()
  );
}

async function sendTelegramId(chatId) {
  await sendMessage(
    chatId,
    [
      "Your Telegram ID",
      String(chatId),
      "",
      "If this ID is added to ACTIVE_CHAT_IDS, daily limits will be removed for this account."
    ].join("\n"),
    mainKeyboard()
  );
}

async function sendUpgradePrompt(chatId, type) {
  const session = getSession(chatId);
  session.upgradeContext = type;
  const label = type === "dictation" ? "dictation" : "listening practice";
  const tomorrowText = "No problem. If you choose No, you can practice again tomorrow: 2 listening practices and 3 dictation practices.";
  const lines = [
    `You have used today's free ${label} practices.`,
    "",
    "Buy me a Coffee for $5 to practice for one month.",
    tomorrowText
  ];

  const extra = buyMeACoffeeUrl
    ? {
        reply_markup: {
          inline_keyboard: [[{ text: "Buy me a Coffee ($5)", url: buyMeACoffeeUrl }]]
        }
      }
    : mainKeyboard();

  await sendMessage(chatId, lines.join("\n"), extra);
  await sendMessage(chatId, "After buying, send your Telegram chat ID to the teacher. Choose No if you want to continue tomorrow.", upgradeKeyboard());
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = message.text?.trim();

  if (!text) return;

  const command = text.startsWith("/") ? commandOf(text) : null;

  if (command === "/start" || command === "/help") {
    await showStart(chatId);
    return;
  }

  if (command === "/level" || text === "Choose Level" || text === "Change Level") {
    await showLevelSamples(chatId);
    return;
  }

  if (text === "0" || text === "0. Zero Level" || text === "Zero Level" || text === "Zero_Level") return chooseLevel(chatId, "zero_level");
  if (text === "1" || text === "1. Beginner" || text === "Beginner") return chooseLevel(chatId, "beginner");
  if (text === "2" || text === "2. Intermediate" || text === "Intermediate") return chooseLevel(chatId, "intermediate");
  if (text === "3" || text === "3. Advanced" || text === "Advanced") return chooseLevel(chatId, "advanced");

  if (command === "/dictation" || command === "/today" || text === "Dictation Practice" || text === "Next Dictation") {
    await sendNextSentence(chatId);
    return;
  }

  if (command === "/listening" || text === "Listening" || text === "Listening Practice" || text === "Next Listening" || text === "Next Listening Practice") {
    await sendNextListening(chatId);
    return;
  }

  if (command === "/replay" || text === "Try Again" || text === "Repeat Audio") {
    await replay(chatId);
    return;
  }

  if (command === "/answer" || text === "Answer") {
    await revealAnswer(chatId);
    return;
  }

  if (command === "/status" || text === "Status") {
    await sendStatus(chatId);
    return;
  }

  if (command === "/id" || command === "/myid") {
    await sendTelegramId(chatId);
    return;
  }

  if (command === "/coffee" || text === "Buy Coffee" || text === "Buy me a Coffee") {
    await sendUpgradePrompt(chatId, "dictation");
    return;
  }

  if (text === "No") {
    getSession(chatId).upgradeContext = null;
    await sendMessage(chatId, "Okay. You can practice again tomorrow: 2 listening practices and 3 dictation practices.", mainKeyboard());
    return;
  }

  if (command === "/reset") {
    sessions.delete(chatId);
    await sendMessage(chatId, "Your session has been reset.", mainKeyboard());
    return;
  }

  await handleSubmission(chatId, text);
}

function mainKeyboard() {
  return {
    reply_markup: {
      keyboard: [["Listening Practice"], ["Dictation Practice"], ["Choose Level", "Status"]],
      resize_keyboard: true
    }
  };
}

function answerKeyboard() {
  return {
    reply_markup: {
      keyboard: [["Repeat Audio", "Answer"], ["Next Dictation", "Status"], ["Listening Practice", "Choose Level"]],
      resize_keyboard: true
    }
  };
}

function levelKeyboard() {
  return {
    reply_markup: {
      keyboard: [["0. Zero Level"], ["1. Beginner"], ["2. Intermediate"], ["3. Advanced"], ["Listening Practice", "Status"]],
      resize_keyboard: true
    }
  };
}

function listeningKeyboard() {
  return {
    reply_markup: {
      keyboard: [["Repeat Audio", "Next Listening Practice"], ["Dictation Practice", "Status"], ["Buy Coffee"]],
      resize_keyboard: true
    }
  };
}

function upgradeKeyboard() {
  return {
    reply_markup: {
      keyboard: [["Buy Coffee", "No"], ["Status"]],
      resize_keyboard: true
    }
  };
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function levelNumber(level) {
  return { zero_level: 0, beginner: 1, intermediate: 2, advanced: 3 }[level] ?? "";
}

function levelLabel(level) {
  return {
    zero_level: "Zero Level",
    beginner: "Beginner level",
    intermediate: "Intermediate level",
    advanced: "Advanced level"
  }[level] ?? capitalize(level);
}

function averageScoreText(session) {
  if (session.completedScores.length === 0) {
    return "No completed sentences yet";
  }

  const total = session.completedScores.reduce((sum, score) => sum + score, 0);
  return `${Math.round(total / session.completedScores.length)}%`;
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function resetDailyUsageIfNeeded(session) {
  const currentDate = todayKey();
  if (session.daily.date !== currentDate) {
    session.daily = {
      date: currentDate,
      dictation: 0,
      listening: 0
    };
  }
}

function isPaid(chatId) {
  return activeChatIds.has(String(chatId));
}

function canStartPractice(chatId, session, type) {
  resetDailyUsageIfNeeded(session);
  if (isPaid(chatId)) return true;
  return session.daily[type] < freeDailyLimits[type];
}

function markDailyUsed(session, type) {
  resetDailyUsageIfNeeded(session);
  session.daily[type] += 1;
}

function todayUsageText(chatId, session) {
  resetDailyUsageIfNeeded(session);
  if (isPaid(chatId)) {
    return "Active plan - unlimited practice";
  }
  return `Dictation ${session.daily.dictation}/${freeDailyLimits.dictation}, Listening ${session.daily.listening}/${freeDailyLimits.listening}`;
}

function parseChatIdList(...values) {
  return new Set(
    values
      .filter(Boolean)
      .flatMap((value) => String(value).split(/[\s,]+/))
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function formatListeningText(item) {
  if (Array.isArray(item.lines)) {
    return item.lines.map((line) => (typeof line === "string" ? line : line.value ?? "")).filter(Boolean).join("\n");
  }
  return item.text ?? "";
}

async function poll(offset) {
  const updates = await telegram("getUpdates", {
    offset,
    timeout: 30,
    allowed_updates: ["message"]
  });

  for (const update of updates) {
    offset = update.update_id + 1;
    try {
      if (update.message) {
        await handleMessage(update.message);
      }
    } catch (error) {
      console.error(error);
      if (update.message?.chat?.id) {
        await sendMessage(update.message.chat.id, "An error occurred. Please try again.");
      }
    }
  }

  return offset;
}

async function main() {
  const listeningCount = Array.isArray(content.listening) ? content.listening.length : 0;
  console.log(`English dictation bot started with ${content.sentences.length} practice sentences and ${listeningCount} listening practices.`);
  let offset = 0;

  while (true) {
    try {
      offset = await poll(offset);
    } catch (error) {
      console.error(error.message);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

main();
