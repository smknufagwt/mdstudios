const a = require('../_auth');
module.exports = async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'), code = u.searchParams.get('code'), state = u.searchParams.get('state');
    const raw = a.open(a.parse(req.headers.cookie).ms_oauth || '');
    const o = raw ? JSON.parse(raw) : null;
    res.setHeader('Set-Cookie', a.cookie('ms_oauth', ''));
    if (!o || !code || o.state !== state) return a.send(res, 400, { error: 'state' });
    const r = await a.google('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: a.origin(req) + '/api/auth/callback',
      grant_type: 'authorization_code',
      code_verifier: o.verifier
    });
    if (!r.ok || !r.j.refresh_token) return a.send(res, 400, { error: 'exchange' });
    res.setHeader('Set-Cookie', [a.cookie('ms_rt', a.seal(r.j.refresh_token), { age: 15552000 }), a.cookie('ms_oauth', '')]);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', '/');
    res.statusCode = 302;
    res.end();
  } catch (e) { a.fail(res, e); }
};
