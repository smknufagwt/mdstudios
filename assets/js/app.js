(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const LS = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};
const SS = {
  get(k, d) { try { return sessionStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  del(k) { try { sessionStorage.removeItem(k); } catch {} }
};

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let lang = LS.get('mdstudio-lang', /^id/i.test(navigator.language) ? 'id' : 'en');
let theme = LS.get('mdstudio-theme', 'dark') === 'light' ? 'light' : 'dark';

const t = (k, v = {}) => {
  const e = T[k];
  let s = e ? (e[lang] || e.en) : k;
  for (const x in v) s = s.replace('{' + x + '}', v[x]);
  return s;
};

const DB = (() => {
  let db;
  const open = () => db ? Promise.resolve(db) : new Promise((res, rej) => {
    const r = indexedDB.open('mdstudio', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'path' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const x = d.transaction(store, mode);
      const rq = fn(x.objectStore(store));
      x.oncomplete = () => res(rq.result);
      x.onerror = () => rej(x.error);
      x.onabort = () => rej(x.error);
    });
  };
  return {
    all: () => tx('files', 'readonly', s => s.getAll()),
    get: p => tx('files', 'readonly', s => s.get(p)),
    put: f => tx('files', 'readwrite', s => s.put(f)),
    del: p => tx('files', 'readwrite', s => s.delete(p)),
    clear: () => tx('files', 'readwrite', s => s.clear()),
    getMeta: k => tx('meta', 'readonly', s => s.get(k)),
    setMeta: (k, v) => tx('meta', 'readwrite', s => s.put(v, k))
  };
})();

const S = { files: new Map(), tabs: [], active: null };
const handles = new Map();
const dirs = new Map();
const hasFS = 'showOpenFilePicker' in window;
const BIN = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|7z|woff2?|ttf|otf|mp[34]|mov|wasm|exe)$/i;
const MAXB = 1048576;
const MAXN = 500;
const LMAP = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', py: 'python', sh: 'bash', bash: 'bash',
  yml: 'yaml', yaml: 'yaml', json: 'json',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'scss', md: 'markdown', markdown: 'markdown',
  rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp'
};

const isMd = p => /\.(md|markdown|mdx)$/i.test(p);
const base = p => p.slice(p.lastIndexOf('/') + 1);
const ext = p => (/\.([^./]+)$/.exec(base(p)) || [, ''])[1].toLowerCase();
const cur = () => S.files.get(S.active);

const uniq = p => {
  if (!S.files.has(p)) return p;
  const i = p.lastIndexOf('.');
  const dot = i > p.lastIndexOf('/');
  const a = dot ? p.slice(0, i) : p, b = dot ? p.slice(i) : '';
  let n = 2;
  while (S.files.has(`${a}-${n}${b}`)) n++;
  return `${a}-${n}${b}`;
};

const persist = f => {
  const c = { ...f };
  if (c.src && c.src.handle) c.src = { ...c.src, handle: undefined };
  return DB.put(c).catch(() => {});
};
const saveUI = () => DB.setMeta('ui', { tabs: S.tabs, active: S.active }).catch(() => {});

function addFile(path, content, src = { type: 'draft' }, dirty = false, readOnly = false) {
  path = uniq(path);
  const f = { path, content, src, dirty, readOnly, updated: Date.now() };
  S.files.set(path, f);
  persist(f);
  return f;
}

function download(name, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  a.download = base(name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function walk(dir, prefix, out) {
  for await (const [n, h] of dir.entries()) {
    if (n === '.git' || n === 'node_modules') continue;
    if (h.kind === 'directory') await walk(h, prefix + n + '/', out);
    else out.push({ path: prefix + n, handle: h });
  }
}

const LocalSource = {
  async list(path = '') {
    const out = [];
    for (const [root, d] of dirs) await walk(d, root + '/', out);
    out.forEach(e => handles.set(e.path, e.handle));
    return out.map(e => e.path).filter(p => p.startsWith(path));
  },
  async read(path) {
    const h = handles.get(path);
    if (!h) throw new Error('no handle');
    const file = await h.getFile();
    if (file.size > MAXB) throw new Error('too large');
    return file.text();
  },
  async write(path, content) {
    const h = handles.get(path);
    if (!h) { download(path, content); return 'download'; }
    const o = { mode: 'readwrite' };
    if (await h.queryPermission(o) !== 'granted' && await h.requestPermission(o) !== 'granted') throw new Error('denied');
    const w = await h.createWritable();
    await w.write(content);
    await w.close();
    return 'file';
  }
};

const G = 'https://www.googleapis.com/drive/v3', GU = 'https://www.googleapis.com/upload/drive/v3';
const GF = 'id,name,modifiedTime,version,mimeType,size';
const FOLDER = 'application/vnd.google-apps.folder';
let tok = null;
let gisToken = null;
let gisClientId = LS.get('mdstudio-gis-client-id', '');
const dirIds = new Map([['drive', 'root']]);

async function driveToken(quiet) {
  if (tok && tok.exp > Date.now() + 30000) return tok.value;
  if (gisToken && gisToken.exp > Date.now() + 30000) return gisToken.value;

  if (window.google && window.google.accounts && window.google.accounts.oauth2 && gisClientId) {
    try {
      const accessToken = await new Promise((resolve, reject) => {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: gisClientId,
          scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly',
          callback: resp => {
            if (resp.error) return reject(new Error(resp.error));
            gisToken = { value: resp.access_token, exp: Date.now() + (resp.expires_in || 3600) * 1000 };
            resolve(gisToken.value);
          }
        });
        client.requestAccessToken({ prompt: quiet ? 'none' : '' });
      });
      return accessToken;
    } catch (e) {
      if (!quiet) console.warn('GIS error', e);
    }
  }

  const r = await fetch('/api/auth/token', { method: 'POST', headers: { 'X-Requested-With': 'mdstudio' } }).catch(() => null);
  if (r && r.ok) {
    const j = await r.json();
    tok = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return tok.value;
  }

  if (!quiet && window.google && window.google.accounts && window.google.accounts.oauth2) {
    return new Promise((resolve, reject) => {
      promptModal({
        title: t('act.drive'),
        desc: t('drive.client_id'),
        placeholder: 'xxxx.apps.googleusercontent.com',
        value: gisClientId,
        onOk: async cid => {
          if (!cid) return reject(new Error('nocfg'));
          gisClientId = cid;
          LS.set('mdstudio-gis-client-id', cid);
          try {
            const token = await driveToken(false);
            resolve(token);
          } catch (err) {
            reject(err);
          }
        }
      });
    });
  }

  if (r && r.status === 401) {
    if (!quiet) location.assign('/api/auth/login');
    throw new Error('login');
  }
  throw new Error(r && r.status === 500 ? 'nocfg' : 'nobackend');
}

async function dapi(url, o = {}, retry = true) {
  const r = await fetch(url, { ...o, headers: { ...o.headers, Authorization: 'Bearer ' + await driveToken() } });
  if (r.status === 401 && retry) { tok = null; gisToken = null; return dapi(url, o, false); }
  if (!r.ok) throw new Error('drive ' + r.status);
  return r;
}

const dmeta = async id => (await dapi(`${G}/files/${id}?fields=${GF}`)).json();
const mimeOf = p => isMd(p) ? 'text/markdown' : (ext(p) === 'html' ? 'text/html' : (ext(p) === 'json' ? 'application/json' : 'text/plain'));
const stamp = m => ({ version: m.version, modifiedTime: m.modifiedTime });

class DriveSource {
  static async list(path = 'drive') {
    const parentId = dirIds.get(path) ?? 'root';
    const q = encodeURIComponent(`'${parentId}' in parents and trashed=false`);
    const out = [];
    let pt = '';
    for (let i = 0; i < 5; i++) {
      const r = await (await dapi(`${G}/files?q=${q}&orderBy=folder,name&pageSize=200&fields=nextPageToken,files(${GF})${pt}`)).json();
      for (const x of r.files || []) {
        const p = path + '/' + x.name.replace(/\//g, '_');
        const folder = x.mimeType === FOLDER;
        if (folder) dirIds.set(p, x.id);
        out.push({ ...x, folder, path: p });
      }
      if (!r.nextPageToken) break;
      pt = '&pageToken=' + encodeURIComponent(r.nextPageToken);
    }
    return out;
  }

  static async read(path) {
    const f = S.files.get(path);
    if (!f || !f.src || !f.src.id) throw new Error('Missing Drive file ID');
    const m = await dmeta(f.src.id);
    if (+m.size > MAXB) throw new Error('skip');
    const res = await dapi(`${G}/files/${f.src.id}?alt=media`);
    const text = await res.text();
    f.src = { ...f.src, ...stamp(m) };
    return text;
  }

  static async write(path, content, force = false) {
    const f = S.files.get(path) || { path, src: {} };
    const id = f.src ? f.src.id : null;
    const ct = mimeOf(path) + ';charset=UTF-8';

    if (id && !force) {
      const m = await dmeta(id);
      if (f.src.version && m.version && (m.version !== f.src.version || m.modifiedTime !== f.src.modifiedTime)) {
        const e = new Error('conflict');
        e.conflict = true;
        e.remoteMeta = m;
        throw e;
      }
    }

    let r;
    if (id) {
      r = await dapi(`${GU}/files/${id}?uploadType=media&fields=${GF}`, {
        method: 'PATCH',
        headers: { 'Content-Type': ct },
        body: content
      });
    } else {
      const bd = 'mdstudio' + Date.now().toString(36);
      const meta = JSON.stringify({
        name: base(path),
        mimeType: mimeOf(path)
      });
      r = await dapi(`${GU}/files?uploadType=multipart&fields=${GF}`, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/related; boundary=' + bd },
        body: `--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${bd}\r\nContent-Type: ${ct}\r\n\r\n${content}\r\n--${bd}--`
      });
    }
    const m = await r.json();
    f.src = { type: 'drive', id: m.id, ...stamp(m) };
    return m;
  }
}

let pickerApiLoaded = false;
function loadPickerApi() {
  return new Promise(resolve => {
    if (pickerApiLoaded && window.google && window.google.picker) return resolve(true);
    if (window.gapi) {
      window.gapi.load('picker', () => {
        pickerApiLoaded = true;
        resolve(true);
      });
    } else {
      resolve(false);
    }
  });
}

async function showGooglePicker() {
  try {
    const token = await driveToken(false);
    await loadPickerApi();
    if (!window.google || !window.google.picker) {
      toast(t('msg.picker_err'));
      return;
    }

    const pickerOrigin = window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0
      ? window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1]
      : window.location.origin;

    const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS);
    view.setIncludeFolders(true);
    view.setMimeTypes('text/markdown,text/plain,text/x-markdown,application/json,text/html,application/vnd.google-apps.folder');

    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .addView(new window.google.picker.DocsUploadView())
      .setOAuthToken(token)
      .setOrigin(pickerOrigin)
      .setCallback(async data => {
        if (data.action === window.google.picker.Action.PICKED) {
          for (const doc of data.docs || []) {
            try {
              const f = await importDrive({
                id: doc.id,
                name: doc.name,
                mimeType: doc.mimeType || 'text/markdown',
                size: doc.sizeBytes || 0
              }, 'drive/' + doc.name);
              openTab(f.path);
            } catch (e) {
              toast(errMsg(e));
            }
          }
        }
      })
      .build();

    picker.setVisible(true);
  } catch (e) {
    toast(errMsg(e));
  }
}

let ghToken = SS.get('mdstudio_gh_pat', '');
function setGhToken(tokStr) {
  ghToken = tokStr ? tokStr.trim() : '';
  if (ghToken) SS.set('mdstudio_gh_pat', ghToken);
  else SS.del('mdstudio_gh_pat');
}

function updateRateLimit(res) {
  const rem = res.headers.get('x-ratelimit-remaining');
  const lim = res.headers.get('x-ratelimit-limit');
  const badge = $('#rate-badge');
  if (rem !== null && lim !== null && badge) {
    badge.textContent = `${rem}/${lim}`;
    badge.title = t('gh.rate_limit', { rem, lim });
    badge.classList.toggle('low', parseInt(rem, 10) <= 5);
  }
}

async function ghApi(endpoint, options = {}) {
  const url = endpoint.startsWith('https://') ? endpoint : `https://api.github.com${endpoint}`;
  const headers = {
    'Accept': 'application/vnd.github+json',
    ...(options.headers || {})
  };
  if (ghToken) headers['Authorization'] = `token ${ghToken}`;
  const res = await fetch(url, { ...options, headers });
  updateRateLimit(res);
  return res;
}

function parseGitHubUrl(input) {
  if (!input) return null;
  const s = input.trim();
  if (/^https?:\/\//i.test(s) && !/^https?:\/\/(?:www\.)?github\.com\//i.test(s)) return null;
  const clean = s.replace(/^https?:\/\/(?:www\.)?github\.com\//i, '').replace(/\.git$/i, '');
  const m = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:\/(tree|blob)\/([^/]+)(?:\/(.*))?)?$/.exec(clean);
  if (!m) return null;
  return {
    owner: m[1],
    repo: m[2],
    kind: m[3] || null,
    ref: m[4] ? decodeURIComponent(m[4]) : '',
    subpath: m[5] ? decodeURIComponent(m[5]) : ''
  };
}

function updateShareRoute(owner, repo, ref, path) {
  const sp = new URLSearchParams();
  sp.set('repo', `${owner}/${repo}`);
  if (ref) sp.set('ref', ref);
  if (path) sp.set('path', path);
  history.replaceState(null, '', `${location.pathname}?${sp.toString()}`);
}

const GitHubSource = {
  async list(path = '') {
    return [...S.files.values()]
      .filter(f => f.src && f.src.type === 'github' && f.path.startsWith(path))
      .map(f => f.path);
  },
  async read(path) {
    const f = S.files.get(path);
    if (!f || !f.src || f.src.type !== 'github') throw new Error('Not a GitHub file');
    if (f.binary || f.oversized) throw new Error(t('msg.unsupported'));
    if (!f.lazy && f.content !== null) return f.content;

    const { owner, repo, ref, sha } = f.src;
    let text;
    try {
      const headers = ghToken ? { 'Authorization': `token ${ghToken}` } : {};
      const rawRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${f.path}`, { headers });
      if (rawRes.ok) {
        text = await rawRes.text();
      } else {
        throw new Error('raw failed');
      }
    } catch {
      const blobRes = await ghApi(`/repos/${owner}/${repo}/git/blobs/${sha}`);
      if (!blobRes.ok) throw new Error('github ' + blobRes.status);
      const bData = await blobRes.json();
      if (bData.encoding === 'base64') {
        text = decodeURIComponent(escape(atob(bData.content.replace(/\s/g, ''))));
      } else {
        text = bData.content;
      }
    }
    f.content = text;
    f.lazy = false;
    persist(f);
    return text;
  },
  async write(path, content, message = 'Update via mdstudio') {
    const f = S.files.get(path);
    if (!f || !f.src || f.src.type !== 'github') throw new Error('Not a GitHub file');
    const { owner, repo, ref } = f.src;
    if (!ghToken) {
      const err = new Error('token_required');
      throw err;
    }

    const refRes = await ghApi(`/repos/${owner}/${repo}/git/refs/heads/${ref}`);
    if (!refRes.ok) throw new Error('github ' + refRes.status);
    const refData = await refRes.json();
    const headCommitSha = refData.object.sha;

    const commitRes = await ghApi(`/repos/${owner}/${repo}/git/commits/${headCommitSha}`);
    if (!commitRes.ok) throw new Error('github ' + commitRes.status);
    const commitData = await commitRes.json();
    const baseTreeSha = commitData.tree.sha;

    const blobRes = await ghApi(`/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content, encoding: 'utf-8' })
    });
    if (!blobRes.ok) throw new Error('github ' + blobRes.status);
    const blobData = await blobRes.json();

    const treeRes = await ghApi(`/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: [
          {
            path: f.path,
            mode: f.src.mode || '100644',
            type: 'blob',
            sha: blobData.sha
          }
        ]
      })
    });
    if (!treeRes.ok) throw new Error('github ' + treeRes.status);
    const treeData = await treeRes.json();

    const newCommitRes = await ghApi(`/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: treeData.sha,
        parents: [headCommitSha]
      })
    });
    if (!newCommitRes.ok) throw new Error('github ' + newCommitRes.status);
    const newCommitData = await newCommitRes.json();

    const updateRefRes = await ghApi(`/repos/${owner}/${repo}/git/refs/heads/${ref}`, {
      method: 'PATCH',
      body: JSON.stringify({
        sha: newCommitData.sha,
        force: false
      })
    });
    if (updateRefRes.status === 409 || updateRefRes.status === 422) {
      const err = new Error('conflict');
      err.conflict = true;
      throw err;
    }
    if (!updateRefRes.ok) throw new Error('github ' + updateRefRes.status);

    f.src.sha = blobData.sha;
    f.dirty = false;
    persist(f);
    return { commitSha: newCommitData.sha, blobSha: blobData.sha };
  }
};

async function cloneGitHubRepo(owner, repo, ref = '', targetPath = '') {
  toast(t('gh.lazy_loading'));
  try {
    let branch = ref;
    if (!branch) {
      const repoRes = await ghApi(`/repos/${owner}/${repo}`);
      if (!repoRes.ok) {
        if (repoRes.status === 401 || repoRes.status === 404) {
          promptModal({
            title: t('gh.token'),
            desc: t('gh.token_prompt'),
            placeholder: 'github_pat_...',
            onOk: val => {
              if (val) {
                setGhToken(val);
                cloneGitHubRepo(owner, repo, ref, targetPath);
              }
            }
          });
          return;
        }
        throw new Error('github ' + repoRes.status);
      }
      const repoData = await repoRes.json();
      branch = repoData.default_branch || 'main';
    }

    const treeRes = await ghApi(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
    if (!treeRes.ok) throw new Error('github ' + treeRes.status);
    const treeData = await treeRes.json();

    if (treeData.truncated) {
      toast(t('gh.truncated'));
    }

    const newFiles = [];
    for (const item of treeData.tree || []) {
      if (item.type !== 'blob') continue;
      const isBin = BIN.test(item.path);
      const isOver = item.size > MAXB;
      const f = {
        path: item.path,
        content: null,
        lazy: true,
        binary: isBin,
        oversized: isOver,
        dirty: false,
        readOnly: true,
        src: {
          type: 'github',
          owner,
          repo,
          ref: branch,
          sha: item.sha,
          size: item.size,
          mode: item.mode
        },
        updated: Date.now()
      };
      S.files.set(f.path, f);
      persist(f);
      newFiles.push(f);
    }

    updateShareRoute(owner, repo, branch, targetPath);

    let toOpen = null;
    if (targetPath && S.files.has(targetPath)) {
      toOpen = targetPath;
    } else {
      const readme = newFiles.find(f => /^readme(\.md)?$/i.test(base(f.path)));
      if (readme) toOpen = readme.path;
      else if (newFiles.length) toOpen = newFiles[0].path;
    }

    if (toOpen) openTab(toOpen);
    else renderAll();
  } catch (e) {
    toast(errMsg(e));
  }
}

const EM = {
  nocfg: 'msg.nodrive',
  nobackend: 'msg.nobackend',
  login: 'msg.login',
  skip: 'msg.unsupported',
  token_required: 'gh.rate_exceeded'
};
function errMsg(e) {
  if (e && e.conflict) return t(e.src === 'github' ? 'gh.conflict' : 'msg.conflictno');
  return t(EM[e.message] || 'msg.err');
}

async function importLocal(path, handle) {
  handles.set(path, handle);
  const old = S.files.get(path);
  if (old && old.src && old.src.type === 'local') {
    if (old.dirty) return old;
    old.content = await LocalSource.read(path);
    old.src.handle = handle;
    persist(old);
    return old;
  }
  return addFile(path, await LocalSource.read(path), { type: 'local', handle });
}

async function openFiles() {
  if (!hasFS) { $('#file-in').click(); return; }
  try {
    let last, n = 0, skipped = 0;
    for (const h of await showOpenFilePicker({ multiple: true })) {
      let p = h.name;
      const o = S.files.get(p);
      if (o && o.src && o.src.handle && !(await o.src.handle.isSameEntry(h))) p = uniq(p);
      try { last = await importLocal(p, h); n++; } catch { skipped++; }
    }
    done(last, n, skipped);
  } catch (e) { if (e.name !== 'AbortError') toast(t('msg.err')); }
}

async function openFolder() {
  try {
    const d = await showDirectoryPicker({ mode: 'readwrite' });
    dirs.set(d.name, d);
    let first, n = 0, skipped = 0;
    for (const p of await LocalSource.list(d.name + '/')) {
      if (BIN.test(p) || n >= MAXN) { skipped++; continue; }
      try { const f = await importLocal(p, handles.get(p)); if (!first || /^[^/]+\/readme\.md$/i.test(p)) first = f; n++; } catch { skipped++; }
    }
    done(first, n, skipped);
  } catch (e) { if (e.name !== 'AbortError') toast(t('msg.err')); }
}

async function importDrive(m, path) {
  if (m.mimeType.startsWith('application/vnd.google-apps') || BIN.test(m.name)) throw new Error('skip');
  let f = [...S.files.values()].find(x => x.src && x.src.id === m.id);
  const fresh = !f;
  if (f && f.dirty) return f;
  if (fresh) { f = { path: uniq(path), content: '', src: { type: 'drive', id: m.id }, dirty: false, updated: Date.now() }; S.files.set(f.path, f); }
  try { f.content = await DriveSource.read(f.path); } catch (e) { if (fresh) S.files.delete(f.path); throw e; }
  persist(f);
  return f;
}

async function renderDir(path, ul) {
  ul.replaceChildren();
  for (const x of await DriveSource.list(path)) {
    const li = document.createElement('li');
    if (x.folder) {
      const d = document.createElement('details'), s = document.createElement('summary'), sub = document.createElement('ul');
      s.textContent = x.name;
      d.append(s, sub);
      d.addEventListener('toggle', () => { if (d.open && !d.dataset.loaded) { d.dataset.loaded = '1'; renderDir(x.path, sub).catch(e => toast(errMsg(e))); } });
      li.append(d);
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'node';
      b.textContent = x.name;
      b.title = x.path;
      b.disabled = x.mimeType.startsWith('application/vnd.google-apps');
      b.addEventListener('click', () => importDrive(x, x.path).then(f => openTab(f.path)).catch(e => toast(errMsg(e))));
      li.append(b);
    }
    ul.append(li);
  }
}

async function openDrive() {
  try {
    await driveToken(false);
    const ul = document.createElement('ul');
    dtree.replaceChildren(ul);
    dwrap.hidden = false;
    app.classList.add('tree-open');
    await renderDir('drive', ul);
  } catch (e) { toast(errMsg(e)); }
}

async function saveDrive(f, copy) {
  let g = f;
  if (copy && (!f.src || f.src.type !== 'drive')) {
    g = { path: uniq('drive/' + base(f.path)), content: f.content, src: { type: 'drive' }, dirty: true, updated: Date.now() };
    S.files.set(g.path, g);
  }
  try {
    try {
      await DriveSource.write(g.path, g.content);
    } catch (e) {
      if (!e.conflict || !confirm(t('msg.conflict'))) throw e;
      await DriveSource.write(g.path, g.content, true);
    }
  } catch (e) {
    if (g !== f) S.files.delete(g.path);
    throw e;
  }
  g.dirty = false;
  persist(g);
  return g;
}

const saving = new Set(), timers = new Map(), paused = new Map();
let auto = LS.get('mdstudio-auto', '1') === '1';

function syncState() {
  const f = cur(), el = $('#sync');
  if (!f || !f.src || f.src.type !== 'drive') { el.textContent = ''; return; }
  el.textContent = t('sync.' + (saving.has(f.path) ? 'saving' : paused.get(f.path) || (f.dirty ? 'unsaved' : 'saved')));
}

function sched(f, ms = 2000) {
  clearTimeout(timers.get(f.path));
  if (auto && f.src && f.src.type === 'drive' && !paused.has(f.path)) {
    timers.set(f.path, setTimeout(() => autoDrive(f), ms));
  }
}

async function autoDrive(f) {
  timers.delete(f.path);
  if (!auto || !f.dirty || !f.src || f.src.type !== 'drive' || saving.has(f.path) || paused.has(f.path)) return;
  saving.add(f.path);
  syncState();
  const c = f.content;
  let retry = false;
  try {
    await driveToken(true);
    await DriveSource.write(f.path, c);
    if (f.content === c) f.dirty = false;
    persist(f);
    renderTabs();
    renderTree();
  } catch (e) {
    if (e.conflict) { paused.set(f.path, 'conflict'); toast(t('msg.conflictno')); }
    else if (e.message === 'login') paused.set(f.path, 'login');
    else retry = true;
  } finally {
    saving.delete(f.path);
    if (f.dirty && !paused.has(f.path)) sched(f, retry ? 10000 : 2000);
    syncState();
  }
}

async function onPicked(files) {
  let last, n = 0, skipped = 0;
  for (const file of files) {
    if (file.size > MAXB || BIN.test(file.name)) { skipped++; continue; }
    last = addFile(file.name, await file.text(), { type: 'local' });
    n++;
  }
  done(last, n, skipped);
}

function done(f, n, skipped) {
  toast(t('msg.opened', { n }) + (skipped ? t('msg.skipped', { n: skipped }) : ''));
  if (f) openTab(f.path); else renderAll();
}

async function commitPush(f = cur()) {
  if (!f || !f.src || f.src.type !== 'github') return;
  if (!ghToken) {
    promptModal({
      title: t('gh.token'),
      desc: t('gh.token_prompt'),
      placeholder: 'github_pat_...',
      onOk: val => {
        if (!val) return;
        setGhToken(val);
        commitPush(f);
      }
    });
    return;
  }
  promptModal({
    title: t('act.push'),
    desc: t('gh.commit_msg'),
    placeholder: 'Update ' + base(f.path),
    value: 'Update ' + base(f.path),
    onOk: async msg => {
      try {
        toast(t('sync.saving'));
        const res = await GitHubSource.write(f.path, f.content, msg || ('Update ' + base(f.path)));
        f.dirty = false;
        persist(f);
        renderTabs();
        renderTree();
        toast(t('gh.pushed', { sha: res.commitSha.slice(0, 7) }));
      } catch (e) {
        if (e.conflict) {
          toast(t('gh.conflict'));
        } else if (e.message === 'token_required' || e.message === 'github 401') {
          setGhToken('');
          toast(t('gh.rate_exceeded'));
        } else {
          toast(t('msg.err'));
        }
      }
    }
  });
}

async function save(f = cur(), toDrive = false) {
  if (!f) return;
  try {
    if (toDrive || (f.src && f.src.type === 'drive')) {
      saving.add(f.path);
      let g;
      try { g = await saveDrive(f, toDrive); } finally { saving.delete(f.path); }
      paused.delete(g.path);
      toast(t('msg.saved', { n: base(g.path) }));
      if (g !== f) openTab(g.path); else { renderTabs(); renderTree(); syncState(); }
      return;
    }
    if (f.src && f.src.type === 'github') {
      commitPush(f);
      return;
    }
    if (!handles.has(f.path) && window.showSaveFilePicker) {
      const h = await showSaveFilePicker({ suggestedName: base(f.path) });
      handles.set(f.path, h);
      f.src = { type: 'local', handle: h };
    }
    const r = await LocalSource.write(f.path, f.content);
    f.dirty = false;
    persist(f);
    renderTabs();
    renderTree();
    toast(t(r === 'file' ? 'msg.saved' : 'msg.downloaded', { n: base(f.path) }));
  } catch (e) { if (e.name !== 'AbortError') toast(errMsg(e)); }
}

function newFile() {
  const n = prompt(t('prompt.name'), 'untitled.md');
  if (!n) return;
  const p = n.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p || /(^|\/)\.\.?(\/|$)/.test(p)) return;
  openTab(addFile(p, '', { type: 'draft' }, true).path);
  ta.focus();
}

const app = $('#app'), ta = $('#ta'), hlc = $('#hl code'), wrap = $('#wrap'), pv = $('#pv'), doc = $('#doc'), tree = $('#tree'), dwrap = $('#dwrap'), dtree = $('#dtree'), tabsEl = $('#tabs'), status = $('#status');
let toastT;
function toast(m) {
  status.textContent = m;
  clearTimeout(toastT);
  toastT = setTimeout(() => { status.textContent = ''; }, 3500);
}

function promptModal({ title, desc = '', placeholder = '', value = '', onOk }) {
  const modal = $('#prompt-modal'), form = $('#prompt-form'), tEl = $('#prompt-title'), dEl = $('#prompt-desc'), valEl = $('#prompt-val'), cancel = $('#prompt-cancel');
  tEl.textContent = title;
  dEl.textContent = desc;
  valEl.placeholder = placeholder;
  valEl.value = value;
  modal.hidden = false;
  valEl.focus();

  const cleanup = () => {
    modal.hidden = true;
    form.onsubmit = null;
    cancel.onclick = null;
  };
  form.onsubmit = e => {
    e.preventDefault();
    const v = valEl.value.trim();
    cleanup();
    if (onOk) onOk(v);
  };
  cancel.onclick = () => cleanup();
}

function parseFM(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { fm: {}, body: src };
  const fm = {};
  try {
    if (typeof jsyaml !== 'undefined' && jsyaml && jsyaml.load) {
      const parsed = jsyaml.load(m[1]);
      if (parsed && typeof parsed === 'object') {
        for (const k in parsed) {
          fm[k.toLowerCase()] = String(parsed[k]).toLowerCase();
        }
      }
    }
  } catch {}
  if (!Object.keys(fm).length) {
    for (const line of m[1].split(/\r?\n/)) {
      const k = /^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/.exec(line);
      if (k) fm[k[1].toLowerCase()] = k[2].replace(/^["']|["']$/g, '').toLowerCase();
    }
  }
  return { fm, body: src.slice(m[0].length) };
}

const SAN = { FORBID_ATTR: ['style'], FORBID_TAGS: ['style'] };
DOMPurify.addHook('afterSanitizeAttributes', n => {
  if (n.tagName === 'A') {
    const h = n.getAttribute('href') || '';
    if (h && h[0] !== '#') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer'); }
  }
});
const hlCode = (code, l) => hljs.getLanguage(l) ? hljs.highlight(code, { language: l, ignoreIllegals: true }).value : esc(code);
marked.use({
  gfm: true,
  renderer: {
    code(code, info) {
      const l = (info || '').trim().split(/\s+/)[0];
      return `<pre><code class="hljs${hljs.getLanguage(l) ? ' language-' + esc(l) : ''}">${hlCode(code, l)}</code></pre>`;
    }
  }
});

function renderMd(src) {
  const { fm, body } = parseFM(src);
  const th = fm.theme === 'light' || fm.theme === 'dark' ? fm.theme : theme;
  const toc = fm.toc === 'true';
  pv.className = 'preview pv-' + th;
  doc.className = 'md layout-' + (fm.layout === 'wide' ? 'wide' : 'narrow') + (toc ? ' has-toc' : '');
  doc.innerHTML = DOMPurify.sanitize(marked.parse(body), SAN);
  const used = new Set(), hs = $$('h1,h2,h3,h4', doc);
  hs.forEach(h => {
    const s = 'md-' + (h.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'h');
    let u = s, n = 2;
    while (used.has(u)) u = s + '-' + n++;
    used.add(u);
    h.id = u;
  });
  if (toc && hs.length) {
    const nav = document.createElement('nav'), b = document.createElement('strong'), ul = document.createElement('ul');
    nav.className = 'toc';
    b.textContent = t('toc.title');
    hs.forEach(h => {
      const li = document.createElement('li'), a = document.createElement('a');
      li.className = 'l' + h.tagName[1];
      a.href = '#' + h.id;
      a.textContent = h.textContent;
      li.append(a);
      ul.append(li);
    });
    nav.append(b, ul);
    doc.prepend(nav);
  }
}

function renderCode(src, path) {
  const l = LMAP[ext(path)] || ext(path);
  hlc.innerHTML = hlCode(src, l) + '\n';
  wrap.className = 'codewrap pv-' + theme;
}

function render() {
  const f = cur();
  if (!f) return;
  if (isMd(f.path)) { wrap.className = 'codewrap pv-' + theme; renderMd(f.content || ''); }
  else renderCode(f.content || '', f.path);
}

function renderTabs() {
  tabsEl.replaceChildren(...S.tabs.map(p => {
    const f = S.files.get(p), d = document.createElement('div'), b = document.createElement('button'), x = document.createElement('button');
    d.className = 'tab' + (p === S.active ? ' on' : '') + (f && f.dirty ? ' dirty' : '') + (f && f.readOnly ? ' readonly' : '');
    d.setAttribute('role', 'tab');
    d.setAttribute('aria-selected', p === S.active);
    b.type = x.type = 'button';
    b.className = 'tab-name';
    b.textContent = base(p);
    if (f && f.readOnly) {
      const roSpan = document.createElement('span');
      roSpan.className = 'badge-ro';
      roSpan.textContent = 'RO';
      b.append(roSpan);
    }
    b.title = p;
    b.dataset.path = p;
    x.className = 'tab-x';
    x.textContent = '×';
    x.dataset.close = p;
    x.setAttribute('aria-label', t('tab.close') + ': ' + base(p));
    d.append(b, x);
    return d;
  }));
}

function renderTree() {
  const root = {};
  for (const p of [...S.files.keys()].sort()) {
    let n = root;
    const parts = p.split('/');
    parts.forEach((s, i) => { n = n[s] ??= i === parts.length - 1 ? p : {}; });
  }
  const build = node => {
    const ul = document.createElement('ul');
    const keys = Object.keys(node).sort((a, b) => (typeof node[a] === 'string') - (typeof node[b] === 'string') || a.localeCompare(b));
    for (const k of keys) {
      const li = document.createElement('li'), v = node[k];
      if (typeof v === 'string') {
        const f = S.files.get(v);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'node' + (v === S.active ? ' on' : '') + (f && f.dirty ? ' dirty' : '');
        b.textContent = k;
        if (f && f.binary) b.textContent += ' (bin)';
        if (f && f.oversized) b.textContent += ' (>1MB)';
        b.title = v;
        b.dataset.path = v;
        li.append(b);
      } else {
        const d = document.createElement('details'), s = document.createElement('summary');
        d.open = true;
        s.textContent = k;
        d.append(s, build(v));
        li.append(d);
      }
      ul.append(li);
    }
    return ul;
  };
  if (Object.keys(root).length) tree.replaceChildren(build(root));
  else { const p = document.createElement('p'); p.className = 'empty-tree'; p.textContent = t('tree.empty'); tree.replaceChildren(p); }
}

async function loadEditor() {
  const f = cur();
  if (!f) {
    ta.value = '';
    ta.disabled = true;
    app.dataset.kind = 'none';
    doc.replaceChildren();
    hlc.textContent = '';
    $('#btn-push').hidden = true;
    syncState();
    return;
  }

  if (f.lazy && f.content === null) {
    ta.value = t('gh.lazy_loading');
    ta.disabled = true;
    try {
      if (f.src && f.src.type === 'github') await GitHubSource.read(f.path);
      else if (f.src && f.src.type === 'drive') await DriveSource.read(f.path);
    } catch (e) {
      toast(errMsg(e));
    }
  }

  const md = isMd(f.path);
  ta.disabled = false;
  ta.wrap = md ? 'soft' : 'off';
  ta.value = f.content || '';

  if (f.readOnly) {
    ta.setAttribute('readonly', 'true');
    $('#btn-ro').textContent = t('act.readonly');
    $('#btn-ro').setAttribute('aria-pressed', 'true');
  } else {
    ta.removeAttribute('readonly');
    $('#btn-ro').textContent = t('act.editmode');
    $('#btn-ro').setAttribute('aria-pressed', 'false');
  }

  if (f.src && f.src.type === 'github') {
    $('#btn-push').hidden = false;
  } else {
    $('#btn-push').hidden = true;
  }

  app.dataset.kind = md ? 'md' : 'code';
  render();
  syncState();
}

function renderAll() { renderTabs(); renderTree(); loadEditor(); }

function openTab(p) {
  if (!S.tabs.includes(p)) S.tabs.push(p);
  S.active = p;
  app.classList.remove('tree-open');
  saveUI();
  renderAll();
}

function closeTab(p) {
  const i = S.tabs.indexOf(p);
  if (i < 0) return;
  S.tabs.splice(i, 1);
  if (S.active === p) S.active = S.tabs[i] ?? S.tabs[i - 1] ?? null;
  saveUI();
  renderAll();
}

function applyI18n() {
  document.documentElement.lang = lang;
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-label]').forEach(el => { const s = t(el.dataset.i18nLabel); el.setAttribute('aria-label', s); el.title = s; });
  $('#btn-lang').textContent = lang.toUpperCase();
}

function setTheme(th) {
  theme = th;
  document.documentElement.dataset.theme = th;
  LS.set('mdstudio-theme', th);
  render();
}

function setMode(m) {
  app.dataset.mode = m;
  LS.set('mdstudio-mode', m);
  $$('#modes button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m));
}

async function compileWebPreview() {
  const indexFile = S.files.get('index.html') || [...S.files.values()].find(f => f.path.endsWith('/index.html') || f.path === 'index.html');
  if (!indexFile) {
    toast(t('compile.noindex'));
    return;
  }

  for (const f of S.files.values()) {
    if (f.lazy && f.content === null && !f.binary && !f.oversized) {
      try {
        if (f.src && f.src.type === 'github') await GitHubSource.read(f.path);
        else if (f.src && f.src.type === 'drive') await DriveSource.read(f.path);
      } catch {}
    }
  }

  const blobMap = new Map();
  const getMime = p => {
    if (/\.html?$/i.test(p)) return 'text/html';
    if (/\.css$/i.test(p)) return 'text/css';
    if (/\.js$/i.test(p)) return 'text/javascript';
    if (/\.json$/i.test(p)) return 'application/json';
    if (/\.svg$/i.test(p)) return 'image/svg+xml';
    return 'text/plain';
  };

  S.files.forEach(f => {
    if (f.content !== null) {
      const b = new Blob([f.content], { type: getMime(f.path) });
      const u = URL.createObjectURL(b);
      blobMap.set(f.path, u);
      blobMap.set(f.path.replace(/^\/+/, ''), u);
      blobMap.set('./' + f.path.replace(/^\/+/, ''), u);
    }
  });

  let html = indexFile.content || '';
  html = html.replace(/(<link[^>]+href=["'])([^"']+)(["'][^>]*>)/gi, (m, p1, href, p3) => {
    if (/^https?:\/\/|^\/\//i.test(href)) return m;
    const clean = href.replace(/^\.\//, '');
    const found = blobMap.get(clean) || [...blobMap.entries()].find(([k]) => k.endsWith(clean))?.[1];
    return found ? `${p1}${found}${p3}` : m;
  });
  html = html.replace(/(<script[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, (m, p1, src, p3) => {
    if (/^https?:\/\/|^\/\//i.test(src)) return m;
    const clean = src.replace(/^\.\//, '');
    const found = blobMap.get(clean) || [...blobMap.entries()].find(([k]) => k.endsWith(clean))?.[1];
    return found ? `${p1}${found}${p3}` : m;
  });
  html = html.replace(/(<img[^>]+src=["'])([^"']+)(["'][^>]*>)/gi, (m, p1, src, p3) => {
    if (/^https?:\/\/|^\/\//i.test(src)) return m;
    const clean = src.replace(/^\.\//, '');
    const found = blobMap.get(clean) || [...blobMap.entries()].find(([k]) => k.endsWith(clean))?.[1];
    return found ? `${p1}${found}${p3}` : m;
  });

  const mainBlob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const frame = $('#compile-frame');
  frame.src = URL.createObjectURL(mainBlob);
  $('#compile-modal').hidden = false;
}

let tp, tr;
ta.addEventListener('input', () => {
  const f = cur();
  if (!f || f.readOnly) return;
  f.content = ta.value;
  f.updated = Date.now();
  if (!f.dirty) { f.dirty = true; renderTabs(); renderTree(); }
  sched(f);
  syncState();
  clearTimeout(tp);
  tp = setTimeout(() => persist(f), 400);
  clearTimeout(tr);
  tr = setTimeout(render, 80);
});

ta.addEventListener('scroll', () => {
  const h = $('#hl');
  h.scrollTop = ta.scrollTop;
  h.scrollLeft = ta.scrollLeft;
});

ta.addEventListener('keydown', e => {
  if (e.key === 'Tab' && app.dataset.kind === 'code' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !ta.readOnly) {
    e.preventDefault();
    ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  }
});

document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); save(); }
  else if (k === 'o') { e.preventDefault(); openFiles(); }
});

tree.addEventListener('click', e => {
  const b = e.target.closest('.node');
  if (b) openTab(b.dataset.path);
});

tabsEl.addEventListener('click', e => {
  const x = e.target.closest('[data-close]'), b = e.target.closest('.tab-name');
  if (x) closeTab(x.dataset.close);
  else if (b) openTab(b.dataset.path);
});

$('#modes').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setMode(b.dataset.mode);
});

$('#btn-new').addEventListener('click', newFile);
$('#btn-open').addEventListener('click', openFiles);
$('#btn-folder').addEventListener('click', openFolder);
$('#btn-save').addEventListener('click', () => save());
$('#btn-push').addEventListener('click', () => commitPush());
$('#btn-picker').addEventListener('click', showGooglePicker);
$('#btn-drive').addEventListener('click', openDrive);
$('#btn-todrive').addEventListener('click', () => save(cur(), true));

$('#btn-copy').addEventListener('click', async () => {
  const f = cur();
  const text = ta.value || (f ? f.content : '');
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast(t('msg.copied'));
  } catch {
    ta.select();
    document.execCommand('copy');
    toast(t('msg.copied'));
  }
});

$('#btn-ro').addEventListener('click', () => {
  const f = cur();
  if (!f) return;
  f.readOnly = !f.readOnly;
  if (!f.readOnly) f.dirty = true;
  persist(f);
  loadEditor();
  renderTabs();
});

$('#btn-compile').addEventListener('click', compileWebPreview);
$('#btn-close-compile').addEventListener('click', () => {
  $('#compile-modal').hidden = true;
  $('#compile-frame').src = 'about:blank';
});

$('#gh-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#gh-input').value.trim();
  if (!input) return;
  const parsed = parseGitHubUrl(input);
  if (!parsed) {
    toast(t('gh.invalid'));
    return;
  }
  cloneGitHubRepo(parsed.owner, parsed.repo, parsed.ref, parsed.subpath);
});

$('#btn-auto').addEventListener('click', () => {
  auto = !auto;
  LS.set('mdstudio-auto', auto ? '1' : '0');
  $('#btn-auto').setAttribute('aria-pressed', auto);
  if (auto) S.files.forEach(f => { if (f.dirty) sched(f, 0); });
  else { timers.forEach(clearTimeout); timers.clear(); }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && auto) S.files.forEach(f => { if (f.dirty && f.src && f.src.type === 'drive') autoDrive(f); });
});

$('#btn-glogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'mdstudio' } }).catch(() => {});
  tok = null;
  gisToken = null;
  dwrap.hidden = true;
});

$('#btn-theme').addEventListener('click', () => setTheme(theme === 'dark' ? 'light' : 'dark'));
$('#btn-lang').addEventListener('click', () => {
  lang = lang === 'en' ? 'id' : 'en';
  LS.set('mdstudio-lang', lang);
  applyI18n();
  renderAll();
});

$('#btn-tree').addEventListener('click', () => app.classList.toggle('tree-open'));
$('#file-in').addEventListener('change', e => {
  const l = [...e.target.files];
  e.target.value = '';
  onPicked(l);
});

if (!window.showDirectoryPicker) $('#btn-folder').hidden = true;

const SAMPLE = [
  '---',
  'layout: narrow',
  'theme: dark',
  'toc: true',
  '---',
  '',
  '# mdstudio',
  '',
  'Universal Markdown interpreter & workspace with Local, Google Drive, and GitHub sources.',
  '',
  '## Front Matter Options',
  '',
  '- `layout`: narrow | wide',
  '- `theme`: dark | light',
  '- `toc`: true | false',
  '',
  '## Features Implemented',
  '',
  '* [x] Live sanitized Markdown preview with marked + DOMPurify',
  '* [x] Syntax-highlighted code editor and code blocks with highlight.js',
  '* [x] LocalSource: File System Access API with input fallback',
  '* [x] DriveSource class: Client-side GIS token model & Google Picker API',
  '* [x] Drive API v3 (files.get alt=media for reading, files.create/update for writing) with conflict detection',
  '* [x] One-click Copy Markdown to clipboard',
  '* [x] GitHubSource: Paste link, tree loading, lazy file cache, and atomic commit/push',
  '* [x] Sandboxed iframe web compilation (no build step)',
  '* [x] Read-only vs Edit toggle per file',
  '* [x] IndexedDB workspace persistence & autosave',
  '',
  '## Code Example',
  '',
  '```javascript',
  '// Google Drive integration using DriveSource class & GIS',
  'class DriveSource {',
  '  static async read(path) { /* files.get alt=media */ }',
  '  static async write(path, content, force) { /* files.create / files.update */ }',
  '}',
  '```',
  ''
].join('\n');

(async function init() {
  applyI18n();
  $('#btn-auto').setAttribute('aria-pressed', auto);
  document.documentElement.dataset.theme = theme;
  setMode(['editor', 'split', 'preview'].includes(LS.get('mdstudio-mode', 'split')) ? LS.get('mdstudio-mode', 'split') : 'split');

  let files = [], ui;
  try {
    files = await DB.all();
    ui = await DB.getMeta('ui');
  } catch {}

  files.forEach(f => {
    S.files.set(f.path, f);
    if (f.src && f.src.handle) handles.set(f.path, f.src.handle);
  });

  const sp = new URLSearchParams(location.search);
  const repoParam = sp.get('repo');
  if (repoParam) {
    const refParam = sp.get('ref') || '';
    const pathParam = sp.get('path') || '';
    const parsed = parseGitHubUrl(repoParam);
    if (parsed) {
      $('#gh-input').value = repoParam;
      await cloneGitHubRepo(parsed.owner, parsed.repo, refParam || parsed.ref, pathParam || parsed.subpath);
      return;
    }
  }

  if (!S.files.size) {
    const f = addFile('welcome.md', SAMPLE, { type: 'draft' }, false, false);
    S.tabs = [f.path];
    S.active = f.path;
  } else {
    S.tabs = ((ui && ui.tabs) || []).filter(p => S.files.has(p));
    S.active = ui && S.files.has(ui.active) ? ui.active : S.tabs[0] ?? null;
    S.active ??= [...S.files.keys()][0];
    if (S.active && !S.tabs.includes(S.active)) S.tabs.push(S.active);
  }
  renderAll();
})();

})();
