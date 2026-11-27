// A stand-in for Google OAuth and the YouTube Data API, to try the YouTube account features of the worker
// without a Google project. Run `node tools/fake-google.cjs` and add to server/.dev.vars:
//   GOOGLE_CLIENT_ID=fake-client
//   GOOGLE_CLIENT_SECRET=fake-secret
//   GOOGLE_OAUTH_BASE=http://localhost:8799
//   YOUTUBE_API_BASE=http://localhost:8799/yt
//   YOUTUBE_UPLOAD_BASE=http://localhost:8799/up
// (YOUTUBE_API_BASE also moves the chat calls here, which this does not answer.)
// Every call is logged to tools/fake-google.calls.jsonl. GET /_live?id=<broadcast> marks a broadcast as live,
// GET /_state shows what it holds, FAIL=live_disabled refuses new broadcasts.
const http = require('http'); const fs = require('fs'); const path = require('path');
const LOG = path.join(__dirname, 'fake-google.calls.jsonl'); fs.writeFileSync(LOG, '');
const state = { streams: {}, broadcasts: {}, n: 0, thumbs: [] };
const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(body === undefined ? '' : JSON.stringify(body)); };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost:8799'); const chunks = [];
  req.on('data', c => chunks.push(c)); req.on('end', () => {
    const raw = Buffer.concat(chunks); const q = Object.fromEntries(u.searchParams);
    const type = req.headers['content-type'] || '';
    const body = type.includes('json') ? JSON.parse(raw.toString() || '{}') : type.includes('urlencoded') ? Object.fromEntries(new URLSearchParams(raw.toString())) : { bytes: raw.length };
    fs.appendFileSync(LOG, JSON.stringify({ m: req.method, p: u.pathname, q, auth: req.headers.authorization || null, type, body }) + '\n');
    const authed = () => req.headers.authorization === 'Bearer access-from-refresh' || req.headers.authorization === 'Bearer access-from-code';
    if (u.pathname === '/auth') return send(res, 302, undefined, { location: `${q.redirect_uri}?code=fake-code&state=${q.state}` });
    if (u.pathname === '/token') {
      if (body.client_id !== 'fake-client' || body.client_secret !== 'fake-secret') return send(res, 401, { error: 'invalid_client' });
      if (body.grant_type === 'authorization_code') return body.code === 'fake-code' ? (state.revoked = false, send(res, 200, { access_token: 'access-from-code', refresh_token: 'refresh-token-plain', expires_in: 3600 })) : send(res, 400, { error: 'invalid_grant' });
      if (body.grant_type === 'refresh_token') return body.refresh_token === 'refresh-token-plain' && !state.revoked ? send(res, 200, { access_token: 'access-from-refresh', expires_in: 3600 }) : send(res, 400, { error: 'invalid_grant' });
      return send(res, 400, { error: 'unsupported_grant_type' });
    }
    if (u.pathname === '/revoke') { state.revoked = true; return send(res, 200, {}); }
    if (!authed()) return send(res, 401, { error: { code: 401, errors: [{ reason: 'authError' }] } });
    if (u.pathname === '/yt/channels') return send(res, 200, { items: [{ id: 'UCfakefakefakefakefakefa', snippet: { title: '로에나 채널' } }] });
    if (u.pathname === '/yt/liveStreams' && req.method === 'GET') return send(res, 200, { items: state.streams[q.id] ? [state.streams[q.id]] : [] });
    if (u.pathname === '/yt/liveStreams' && req.method === 'POST') {
      if (!body.snippet?.title || body.cdn?.ingestionType !== 'rtmp' || !body.cdn.resolution || !body.cdn.frameRate) return send(res, 400, { error: { errors: [{ reason: 'invalidValue', message: 'bad stream' }] } });
      const id = `stream-${++state.n}`;
      state.streams[id] = { id, cdn: { ingestionInfo: { ingestionAddress: 'rtmp://a.rtmp.youtube.com/live2', rtmpsIngestionAddress: 'rtmps://a.rtmps.youtube.com/live2', streamName: `key-${id}` } } };
      return send(res, 200, state.streams[id]);
    }
    if (u.pathname === '/yt/liveBroadcasts' && req.method === 'POST') {
      const s = body.snippet || {};
      if (process.env.FAIL === 'live_disabled') return send(res, 403, { error: { errors: [{ reason: 'liveStreamingNotEnabled', message: 'not enabled' }] } });
      if (!s.title || s.title.length > 100 || !s.scheduledStartTime || new Date(s.scheduledStartTime) <= new Date() || !body.status?.privacyStatus) return send(res, 400, { error: { errors: [{ reason: 'invalidTitle', message: 'bad broadcast' }] } });
      const id = `bc-${Date.now().toString(36)}${++state.n}`; state.broadcasts[id] = { id, body, status: 'ready' };
      return send(res, 200, { id, snippet: { liveChatId: `chat-${id}` } });
    }
    if (u.pathname === '/yt/liveBroadcasts/bind') { const b = state.broadcasts[q.id]; if (!b || !state.streams[q.streamId]) return send(res, 404, { error: { errors: [{ reason: 'liveBroadcastNotFound' }] } }); b.stream = q.streamId; return send(res, 200, { id: q.id }); }
    if (u.pathname === '/yt/liveBroadcasts' && req.method === 'GET') { const b = state.broadcasts[q.id]; return send(res, 200, { items: b ? [{ status: { lifeCycleStatus: b.status } }] : [] }); }
    if (u.pathname === '/yt/liveBroadcasts/transition') { const b = state.broadcasts[q.id]; if (!b || b.status !== 'live') return send(res, 403, { error: { errors: [{ reason: 'invalidTransition', message: 'not live' }] } }); b.status = 'complete'; return send(res, 200, { id: q.id }); }
    if (u.pathname === '/yt/liveBroadcasts' && req.method === 'DELETE') { delete state.broadcasts[q.id]; res.writeHead(204); return res.end(); }
    if (u.pathname === '/up/thumbnails/set') { state.thumbs.push({ videoId: q.videoId, type, bytes: raw.length }); return send(res, 200, { items: [] }); }
    // test controls
    if (u.pathname === '/_live') { if (state.broadcasts[q.id]) state.broadcasts[q.id].status = 'live'; return send(res, 200, {}); }
    if (u.pathname === '/_state') return send(res, 200, state);
    send(res, 404, { error: { errors: [{ reason: 'notFound' }] } });
  });
}).listen(8799, () => console.log('fake google on 8799'));
