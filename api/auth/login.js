const c = require('node:crypto');
const a = require('../_auth');
module.exports = (req, res) => {
  try {
    const state = c.randomBytes(16).toString('hex'), verifier = c.randomBytes(32).toString('base64url');
    const q = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      redirect_uri: a.origin(req) + '/api/auth/callback',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive',
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: c.createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256'
    });
    res.setHeader('Set-Cookie', a.cookie('ms_oauth', a.seal(JSON.stringify({ state, verifier })), { lax: true, age: 600 }));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', 'https://accounts.google.com/o/oauth2/v2/auth?' + q);
    res.statusCode = 302;
    res.end();
  } catch (e) { a.fail(res, e); }
};
