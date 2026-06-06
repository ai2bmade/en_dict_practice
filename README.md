# English Dictation Practice Bot

Telegram bot for short English dictation practice.

The bot sends a short audio sentence, receives the learner's typed answer, scores it with a deterministic word-based algorithm, and reveals the answer only when the learner asks for it.

Capitalization and punctuation do not affect the score.

## Current Behavior

- UI language: English
- Level samples: Beginner, Intermediate, Advanced
- Practice: short one-sentence dictation
- Listening practice: pre-beginner expanded sentence audio with visible text
- Free plan: 1 dictation and 1 listening practice per day
- Coffee plan: $5 for one month of practice
- `Try Again`: replay current audio
- `Answer`: reveal answer, show ranking, mark sentence complete
- 100% score: automatically complete sentence and show:

```text
Perfect. You ranked #1 for this sentence today.
```

For scores below 100%, the bot shows a bottom-group ranking for that sentence.

## Environment Variables

Only one variable is required.

```env
TELEGRAM_BOT_TOKEN=BotFather token
```

No OpenAI key is required for learner-facing use.

Optional paid-plan variables:

```env
BUY_ME_A_COFFEE_URL=https://www.buymeacoffee.com/your-page
ACTIVE_CHAT_IDS=123456789,987654321
```

The bot does not verify Buy Me a Coffee payments automatically yet. Add the teacher, family members, or paid learners to `ACTIVE_CHAT_IDS` and redeploy to remove daily limits for those Telegram accounts. Learners can send `/id` to see their Telegram chat ID. `PAID_CHAT_IDS` is still supported as a legacy alias.

## Audio Files

Put public bot audio files here:

```text
audio/public/
```

Expected filenames match sentence IDs:

```text
bgn_000001.ogg
int_000001.ogg
adv_000001.ogg
```

Original MP3 files may use answer text as filenames, but they should stay private in:

```text
audio/source/
```

Do not expose source filenames to learners.

Recommended conversion:

```bash
ffmpeg -i "source.mp3" -map_metadata -1 -ac 1 -ar 24000 -c:a libopus -b:a 32k "bgn_000001.ogg"
```

For this workspace, use the sync script after placing MP3 files under `G:\Codex\en_dict_practice_audio\source_mp3`:

```powershell
.\scripts\sync-audio.ps1
```

Expected source folders:

```text
source_mp3\samples
source_mp3\beginner
source_mp3\intermediate
source_mp3\advanced
source_mp3\listening
```

For listening practice, put an MP3 and a TXT file with the same base name:

```text
source_mp3\listening\be.mp3
source_mp3\listening\be.txt
```

The TXT file contains the visible expanded sentences, one line per sentence:

```text
It is good.
It is good today.
The food is good today.
```

The script writes:

```text
audio/public/*.ogg
content/sentences.json
content/audio_manifest.csv
```

Always inspect `content/audio_manifest.csv` to verify that each public audio ID matches the correct answer.

## Coolify

Use the GitHub repository:

```text
https://github.com/ai2bmade/en_dict_practice
```

Deploy as Dockerfile or Docker Compose.

Environment variable:

```env
TELEGRAM_BOT_TOKEN=BotFather token
ACTIVE_CHAT_IDS=teacher-chat-id,wife-chat-id,paid-learner-chat-id
```

This is a Telegram long polling worker. No HTTP port or domain is required.

## Local Run

```powershell
$env:TELEGRAM_BOT_TOKEN="123456:ABC..."
npm start
```

## Scoring

Scoring ignores capitalization and punctuation. It compares normalized words only.

- Word count similarity: 10%
- Exact same-position words: 20%
- First two words in exact order: 10%
- Last two words in exact order: 10%
- First three words in exact order: 15%
- Last three words in exact order: 15%
- Bag-of-words exact matches: 20%

Total: 100%.
