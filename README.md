# Jev Drums

A small drum machine where TypeSafe Jev arranges coherent beats from a mood prompt. Six synthesized drum voices, an editable 16-step sequencer, tempo and volume controls, and variations that enter on bar boundaries.

## Run

Requires Node.js 22 or newer. No dependencies or build step.

```sh
cp .env.example .env
# Set OPENROUTER_API_KEY in .env, or enter it through Settings.
npm start
```

Open http://localhost:3003 and press Play to enable audio. The initial starter pattern is hand-authored. Generate asks Jev to write a new arrangement. Keys stay on the local server and `.env` is ignored by Git.

## Inputs and outputs

Input: a mood description, tempo (60–180 BPM), and optionally the current pattern.

Jev uses two native OpenRouter Decisions API calls per generation. First it selects a shared groove and timing feel. Then it picks compatible, complete rhythmic motifs for kick, snare, clap, closed hi-hat, open hi-hat, and tom. Each motif is one bar of sixteen steps: `0` means silence, `1` a normal hit, and `2` an accent. Candidate motifs are curated in code. Jev scores them in musical context, and the app samples its option probabilities to choose motifs and which tracks evolve. Groove and swing use the highest-probability choices to keep a shared musical foundation. Repeating Generate with the same prompt varies the last result. It does not synthesize an audio file or independently invent every sample.

The browser synthesizes the sounds using Web Audio and schedules them against its audio clock. Pattern changes queue at the next bar boundary. Auto-evolve asks for a variation every 1, 2, 4, or 8 bars while playing, with one generation at a time. Each variation uses the previous pattern, changes one or two tracks, and preserves the rest. Generation failures preserve the current beat. The displayed confidence is model choice confidence, not a measure of musical quality.

Only generation sends prompts and pattern context to OpenRouter/TypeSafe. Playback and pad editing are local. Auto-evolve makes ongoing billable requests while enabled and playing; stopping playback stops requesting further variations. Audio may pause if the browser suspends a background tab.

## API

- `GET /api/state` — configured and busy status, model alias.
- `POST /api/generate` — `{ "prompt": "late-night house", "bpm": 120, "previousPattern": { ... } }`; previousPattern is optional.
- `POST /api/settings` — `{ "apiKey": "..." }` replaces the in-memory key.

All POST requests use JSON. The server binds to loopback and rejects foreign hosts and origins. No key is returned to the browser. Model alias: `~typesafe/jev-latest`; endpoint: `https://openrouter.ai/api/alpha/decisions`.

```sh
npm test
```
