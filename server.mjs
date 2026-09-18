import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateBeat, MODEL } from './jev.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const safeCodes = new Set(['INVALID_INPUT','INVALID_PROMPT','INVALID_BPM','INVALID_PATTERN','MISSING_API_KEY','UPSTREAM_ERROR','INVALID_RESPONSE','INVALID_DECISION','TIMEOUT','NETWORK_ERROR']);
export function createApp({ apiKey = process.env.OPENROUTER_API_KEY || '', generateFn = generateBeat } = {}) {
  let busy = false;
  const state = () => ({ configured: Boolean(apiKey), busy, model: MODEL });
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Send application/json.'), { status: 415 });
    let data = ''; let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 16384) throw Object.assign(new Error('Request too large.'), { status: 413 });
      data += chunk;
    }
    try {
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      return parsed;
    } catch { throw Object.assign(new Error('Invalid JSON object.'), { status: 400 }); }
  }
  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) return json(res, 403, { error: 'Use localhost to access this app.' });
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, 403, { error: 'Cross-origin requests are not allowed.' });
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/state') return json(res, 200, state());
      if (req.method === 'POST' && path.startsWith('/api/')) {
        const input = await body(req);
        if (path === '/api/settings') {
          if (busy) return json(res, 409, { error: 'Wait for Jev to finish before changing the key.' });
          if (typeof input.apiKey !== 'string' || !input.apiKey.trim() || input.apiKey.length > 512) return json(res, 400, { error: 'Enter a valid OpenRouter API key.' });
          apiKey = input.apiKey.trim();
          return json(res, 200, state());
        }
        if (path === '/api/generate') {
          if (!apiKey) return json(res, 400, { error: 'Connect an OpenRouter API key in Settings.' });
          if (busy) return json(res, 409, { error: 'Jev is already writing a pattern.' });
          if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.trim().length > 500 || !Number.isFinite(input.bpm) || input.bpm < 60 || input.bpm > 180) return json(res, 400, { error: 'Enter a mood (1–500 characters) and a tempo from 60–180 BPM.' });
          busy = true;
          let result;
          try { result = await generateFn({ prompt: input.prompt.trim(), bpm: input.bpm, ...(input.previousPattern === undefined ? {} : { previousPattern: input.previousPattern }) }, { apiKey }); }
          finally { busy = false; }
          return json(res, 200, { ...state(), result });
        }
        return json(res, 404, { error: 'Unknown endpoint.' });
      }
      const files = { '/': ['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/audio.js':['audio.js','text/javascript'], '/styles.css':['styles.css','text/css'] };
      if (req.method === 'GET' && files[path]) {
        const [file, type] = files[path];
        const data = readFileSync(resolve(root, 'public', file));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
        return res.end(data);
      }
      json(res, 404, { error: 'Not found.' });
    } catch (error) {
      const code = error.code;
      const status = error.status || (code?.startsWith('INVALID_') && !['INVALID_RESPONSE','INVALID_DECISION'].includes(code) || code === 'MISSING_API_KEY' ? 400 : 502);
      json(res, status, { error: error.status || safeCodes.has(code) ? error.message : 'Could not complete the request. Try again.' });
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createApp();
  const port = Number(process.env.PORT || 3003);
  server.listen(port, '127.0.0.1', () => console.log(`Jev Drums is ready at http://localhost:${port}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
