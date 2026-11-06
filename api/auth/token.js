const a = require('../_auth');
module.exports = async (req, res) => {
  if (!a.post(req, res)) return;
  try {
    const rt = a.open(a.parse(req.headers.cookie).ms_rt || '');
    if (!rt) return a.send(res, 401, { error: 'login' });
    const r = await a.google('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: rt,
      grant_type: 'refresh_token'
    });
    if (r.j.error === 'invalid_grant') { res.setHeader('Set-Cookie', a.cookie('ms_rt', '')); return a.send(res, 401, { error: 'login' }); }
    if (!r.ok) return a.send(res, 502, { error: 'upstream' });
    a.send(res, 200, { access_token: r.j.access_token, expires_in: r.j.expires_in });
  } catch (e) { a.fail(res, e); }
};
