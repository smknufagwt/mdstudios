const a = require('../_auth');
module.exports = async (req, res) => {
  if (!a.post(req, res)) return;
  try {
    const rt = a.open(a.parse(req.headers.cookie).ms_rt || '');
    if (rt) await a.google('https://oauth2.googleapis.com/revoke', { token: rt }).catch(() => {});
    res.setHeader('Set-Cookie', a.cookie('ms_rt', ''));
    a.send(res, 204);
  } catch (e) { a.fail(res, e); }
};
