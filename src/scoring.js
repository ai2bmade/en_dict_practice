export function normalizeWords(text) {
  return String(text)
    .toLowerCase()
    .replace(/[.,!?;:"'“”‘’()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

export function scoreDictation(answerText, submittedText) {
  const answer = normalizeWords(answerText);
  const submitted = normalizeWords(submittedText);

  if (submitted.length === 0 || answer.length === 0) {
    return {
      score: 0,
      sections: {
        wordCount: 0,
        position: 0,
        firstTwo: 0,
        lastTwo: 0,
        firstThree: 0,
        lastThree: 0,
        bagOfWords: 0
      }
    };
  }

  const wordCount = Math.max(0, 10 * (1 - Math.abs(answer.length - submitted.length) / answer.length));
  const position = 20 * exactPositionRatio(answer, submitted);
  const firstTwo = 10 * sequencePrefixRatio(answer, submitted, 2);
  const lastTwo = 10 * sequenceSuffixRatio(answer, submitted, 2);
  const firstThree = 15 * sequencePrefixRatio(answer, submitted, 3);
  const lastThree = 15 * sequenceSuffixRatio(answer, submitted, 3);
  const bagOfWords = 20 * bagOfWordsRatio(answer, submitted);

  const rawScore = wordCount + position + firstTwo + lastTwo + firstThree + lastThree + bagOfWords;

  return {
    score: Math.max(0, Math.min(100, Math.round(rawScore))),
    sections: {
      wordCount,
      position,
      firstTwo,
      lastTwo,
      firstThree,
      lastThree,
      bagOfWords
    }
  };
}

function exactPositionRatio(answer, submitted) {
  let matches = 0;
  for (let index = 0; index < answer.length; index += 1) {
    if (answer[index] === submitted[index]) matches += 1;
  }
  return matches / answer.length;
}

function sequencePrefixRatio(answer, submitted, count) {
  let matches = 0;
  for (let index = 0; index < count; index += 1) {
    if (answer[index] && answer[index] === submitted[index]) matches += 1;
  }
  return matches / count;
}

function sequenceSuffixRatio(answer, submitted, count) {
  let matches = 0;
  for (let index = 1; index <= count; index += 1) {
    if (answer.at(-index) && answer.at(-index) === submitted.at(-index)) matches += 1;
  }
  return matches / count;
}

function bagOfWordsRatio(answer, submitted) {
  const counts = new Map();
  for (const word of submitted) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  let matches = 0;
  for (const word of answer) {
    const count = counts.get(word) ?? 0;
    if (count > 0) {
      matches += 1;
      counts.set(word, count - 1);
    }
  }

  return matches / answer.length;
}

export function rankingForScore(score) {
  if (score >= 100) {
    return { perfect: true, message: "Perfect. You ranked #1 for this sentence today." };
  }

  const total = randomInteger(34275, 97211);
  const [minRatio, maxRatio] = ratioRange(score);
  const originalRank = randomInteger(
    Math.max(1, Math.floor(total * minRatio)),
    Math.max(1, Math.floor(total * maxRatio))
  );
  const rank = Math.max(1, Math.floor(originalRank / 2));

  return {
    perfect: false,
    rank: Math.min(rank, total),
    total
  };
}

function ratioRange(score) {
  if (score >= 90) return [0.81, 0.95];
  if (score >= 80) return [0.71, 0.8];
  if (score >= 70) return [0.61, 0.7];
  if (score >= 60) return [0.51, 0.6];
  if (score >= 50) return [0.31, 0.5];
  if (score >= 40) return [0.26, 0.3];
  if (score >= 30) return [0.21, 0.25];
  if (score >= 20) return [0.11, 0.2];
  if (score >= 10) return [0.03, 0.1];
  return [0.01, 0.02];
}

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
