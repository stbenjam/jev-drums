# Jev Drums

A small drum machine where TypeSafe Jev composes drum patterns from a mood prompt. Six synthesized drum voices, an editable 16-step sequencer, tempo and volume controls, and variations that enter on bar boundaries.

## Run

Requires Node.js 22 or newer. No dependencies or build step.

```sh
cp .env.example .env
# Set OPENROUTER_API_KEY in .env, or enter it through Settings.
npm start
```

Open http://localhost:3003 and click Generate to create a beat and start playback. Play starts the hand-authored starter pattern without waiting for Jev. Keys stay on the local server and `.env` is ignored by Git.

## Inputs and outputs

Input: a mood description, tempo (60–180 BPM), and optionally the current pattern.

Each generation sends **one native OpenRouter Decisions API request containing 96 choice questions**: six tracks × sixteen steps. For each kick, snare, clap, closed hi-hat, open hi-hat, and tom step, Jev chooses among `off`, `hit`, and `accent`. These become pattern values `0`, `1`, and `2`. Every question shares the mood prompt, tempo, and optional previous pattern as context. The app samples Jev's returned option probabilities for each step. Jev supplies every step of the generated pattern through these decisions.

Repeating Generate with the same prompt uses the current beat as context. A changed prompt starts fresh. Automatic evolution also uses the latest applied pattern, and any of its 96 steps may change. Each pattern is one bar of sixteen sixteenth notes in straight 4/4 time. The hand-authored starter beat is separate from Jev's generated patterns.

The browser synthesizes the sounds using Web Audio and schedules them against its audio clock. Generate starts playback when the beat is ready. Pattern changes during playback queue at the next bar boundary. Auto-evolve defaults to every bar; choose every 1, 2, 4, or 8 bars, with one generation at a time. Playback continues with the current beat while waiting for a response or after a generation failure. The displayed confidence is the mean model choice confidence across the 96 per-step decisions, not a measure of musical quality.

Only generation sends prompts and pattern context to OpenRouter/TypeSafe. Playback and pad editing are local. Auto-evolve makes ongoing billable requests while enabled and playing; stopping playback stops requesting further variations. Audio may pause if the browser suspends a background tab.

## API

- `GET /api/state` — configured and busy status, model alias.
- `POST /api/generate` — `{ "prompt": "late-night house", "bpm": 120, "previousPattern": { ... } }`; previousPattern is optional.
- `POST /api/settings` — `{ "apiKey": "..." }` replaces the in-memory key.

All POST requests use JSON. The server binds to loopback and rejects foreign hosts and origins. No key is returned to the browser. Model alias: `~typesafe/jev-latest`; endpoint: `https://openrouter.ai/api/alpha/decisions`.

```sh
npm test
```
