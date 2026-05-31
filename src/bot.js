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
const content = JSON.parse(readFileSync(join(rootDir, "content", "sentences.json"), "utf8"));
const apiBase = `https://api.telegram.org/bot${token}`;
const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      level: null,
      current: null,
      pendingAnswer: null,
      lastScore: null,
      completedIds: new Set(),
      freeUsed: 0
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

async function showStart(chatId) {
  await sendMessage(
    chatId,
    [
      "English Dictation Practice Bot",
      "",
      "Listen to a short sentence. Type exactly what you hear.",
      "Capitalization and punctuation do not affect your score.",
      "",
      "Start with /level to hear sample sentences and choose your level."
    ].join("\n"),
    mainKeyboard()
  );
}

async function showLevelSamples(chatId) {
  await sendMessage(chatId, "Listen to the three samples, then choose your level.", levelKeyboard());
  for (const sample of content.samples) {
    await sendMessage(chatId, `${capitalize(sample.level)} sample`);
    await sendAudioForSentence(chatId, sample);
  }
  await sendMessage(chatId, "Choose your level.", levelKeyboard());
}

async function chooseLevel(chatId, level) {
  const session = getSession(chatId);
  session.level = level;
  await sendMessage(chatId, `Great. Your level is set to ${capitalize(level)}.`, mainKeyboard());
  await sendNextSentence(chatId);
}

async function sendNextSentence(chatId) {
  const session = getSession(chatId);
  const level = session.level ?? "beginner";
  const pool = content.sentences.filter((item) => item.level === level && !session.completedIds.has(item.id));
  const candidates = pool.length > 0 ? pool : content.sentences.filter((item) => !session.completedIds.has(item.id));

  if (candidates.length === 0) {
    await sendMessage(chatId, "No more sentences are available yet.", mainKeyboard());
    return;
  }

  const sentence = candidates[Math.floor(Math.random() * candidates.length)];
  session.current = sentence;
  session.pendingAnswer = null;
  session.lastScore = null;

  await sendMessage(chatId, `Sentence ${sentence.id.toUpperCase().replace("_", "-")}`, answerKeyboard());
  await sendAudioForSentence(chatId, sentence);
}

async function replay(chatId) {
  const session = getSession(chatId);
  if (!session.current) {
    await sendMessage(chatId, "No active sentence. Use /dictation to start.", mainKeyboard());
    return;
  }
  await sendAudioForSentence(chatId, session.current);
}

async function handleSubmission(chatId, text) {
  const session = getSession(chatId);
  if (!session.current) {
    await sendMessage(chatId, "No active sentence. Use /dictation to start.", mainKeyboard());
    return;
  }

  const result = scoreDictation(session.current.answer, text);
  session.pendingAnswer = text;
  session.lastScore = result.score;

  if (result.score >= 100) {
    session.completedIds.add(session.current.id);
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
      "Try again, or reveal the answer."
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

  await sendMessage(
    chatId,
    [
      "Answer:",
      escapeHtml(session.current.answer),
      "",
      ranking.perfect
        ? ranking.message
        : `You ranked ${ranking.rank.toLocaleString("en-US")} out of ${ranking.total.toLocaleString("en-US")} learners today for this sentence.`
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
      `Level: ${session.level ? capitalize(session.level) : "Not selected"}`,
      `Completed: ${session.completedIds.size}`,
      `Current score: ${session.lastScore ?? "-"}`
    ].join("\n"),
    mainKeyboard()
  );
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

  if (command === "/level" || text === "Change Level") {
    await showLevelSamples(chatId);
    return;
  }

  if (text === "Beginner") return chooseLevel(chatId, "beginner");
  if (text === "Intermediate") return chooseLevel(chatId, "intermediate");
  if (text === "Advanced") return chooseLevel(chatId, "advanced");

  if (command === "/dictation" || command === "/today" || text === "Next Sentence") {
    await sendNextSentence(chatId);
    return;
  }

  if (command === "/replay" || text === "Try Again") {
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
      keyboard: [["Next Sentence", "Try Again"], ["Answer", "Status"], ["Change Level"]],
      resize_keyboard: true
    }
  };
}

function answerKeyboard() {
  return {
    reply_markup: {
      keyboard: [["Try Again", "Answer"], ["Next Sentence", "Status"], ["Change Level"]],
      resize_keyboard: true
    }
  };
}

function levelKeyboard() {
  return {
    reply_markup: {
      keyboard: [["Beginner", "Intermediate", "Advanced"], ["Status"]],
      resize_keyboard: true
    }
  };
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
  console.log(`English dictation bot started with ${content.sentences.length} practice sentences.`);
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
