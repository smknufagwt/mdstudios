const c = require('node:crypto');
const key = () => {
  const e = process.env;
  if (!e.COOKIE_KEY || !e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) throw Object.assign(new Error('config'), { code: 'config' });
  return c.createHash('sha256').update(e.COOKIE_KEY).digest();
};
const seal = v => {
  const iv = c.randomBytes(12), ci = c.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([ci.update(v, 'utf8'), ci.final()]);
  return Buffer.concat([iv, ci.getAuthTag(), ct]).toString('base64url');
};
const open = s => {
  const k = key();
  try {
    const b = Buffer.from(s, 'base64url'), d = c.createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return null; }
};
const parse = h => Object.fromEntries((h || '').split(/;\s*/).filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
const cookie = (n, v, o = {}) => `${n}=${v}; Path=/api/auth; HttpOnly; Secure; SameSite=${o.lax ? 'Lax' : 'Strict'}; Max-Age=${o.age ?? 0}`;
const origin = req => process.env.APP_ORIGIN || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Cache-Control', 'no-store');
  if (body === undefined) { res.end(); return; }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};
const google = async (url, params) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  return { ok: r.ok, j: await r.json().catch(() => ({})) };
};
const fail = (res, e) => send(res, e.code === 'config' ? 500 : 502, { error: e.code === 'config' ? 'config' : 'upstream' });
const post = (req, res) => {
  if (req.method === 'POST' && req.headers['x-requested-with'] === 'mdstudio') return true;
  send(res, 405, { error: 'method' });
  return false;
};
module.exports = { seal, open, parse, cookie, origin, send, google, fail, post };
