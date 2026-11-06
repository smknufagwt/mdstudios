# mdstudio

**A lightweight Markdown workspace built with plain HTML, CSS, and vanilla JavaScript.**

Write Markdown, preview it live, organize local files, connect Google Drive, and inspect or commit to GitHub repositories—all from a browser-based editor with no build step.

> **Project status:** Stages 1 (Local workspace, editor/preview, front matter), 2 (Google Drive GIS token model & conflict detection), and 3 (GitHub source, tree clone, lazy loading, atomic commit/push, sandbox web preview) are implemented.

## Overview

mdstudio brings the essentials of Markdown writing and multi-source file management into one focused workspace:

- **Live preview** — edit Markdown and see the sanitized, rendered document alongside it.
- **Multiple views** — switch between editor, split, and preview modes.
- **Polymorphic sources** — unified `{ list, read, write }` interface across Local, Google Drive, and GitHub.
- **Local workspace** — open files and folders, navigate a file tree, and work across tabs with IndexedDB persistence.
- **Autosave** — keep drafts and modifications safely stored in browser storage.
- **Code highlighting** — syntax-highlighted code editor and rendered code blocks with highlight.js.
- **Front matter** — support for document metadata: `layout` (narrow|wide), `theme` (dark|light), and `toc` (true|false).
- **Google Drive** — client-side GIS token client (no client secret), Google Picker API for selecting files, and Drive API v3 (`files.get` alt=media, `files.create`/`files.update`) with conflict detection (`modifiedTime`/`version`).
- **One-click Copy** — instant markdown copy to system clipboard from the header toolbar.
- **GitHub integration** — paste repository links, browse file trees, lazy-load content, track API rate limits, and perform atomic commits (`ref -> blob -> tree -> commit -> PATCH ref`).
- **Web compilation sandbox** — preview workspaces containing `index.html` inside an isolated, sandboxed iframe resolving relative assets via Blob URLs.
- **Read-only vs Edit toggle** — protect remote repositories from accidental keystrokes with per-file edit locks.
- **Themes & language** — dark/light themes and English/Indonesian interface.

## Tech stack

| Component | Technology |
| --- | --- |
| Interface | HTML, CSS, vanilla JavaScript (no framework, no bundler) |
| Markdown parsing | [marked](https://github.com/markedjs/marked) |
| HTML sanitization | [DOMPurify](https://github.com/cure53/DOMPurify) |
| Syntax highlighting | [highlight.js](https://github.com/highlightjs/highlight.js) |
| Front matter parsing | [js-yaml](https://github.com/nodeca/js-yaml) |
| Local persistence | IndexedDB (`mdstudio`) |
| Drive authentication | Google Identity Services (GIS client-side) & optional Vercel endpoints |
| GitHub API | REST v3 + Git Database API (atomic commits) |
| Deployment | Vercel (clean URLs, CSP headers) |

Third-party libraries are vendored in `assets/vendor/`. See `assets/vendor/LICENSES.txt` for license notices.

## Roadmap

- [x] Markdown editor and live preview (editor / split / preview)
- [x] Local file and folder workflow (File System Access API + fallback)
- [x] Tabs and file tree workspace
- [x] IndexedDB autosave and draft recovery
- [x] Front matter layout, theme, and TOC support
- [x] Google Drive integration with GIS token model, Google Picker, and conflict detection
- [x] One-click Markdown copy to clipboard
- [x] GitHub repository cloning, lazy loading, and shareable routes (`?repo=...`)
- [x] Atomic GitHub commit & push
- [x] Web preview compilation inside sandboxed iframe
- [x] Read-only / edit mode toggle per file

## Deployment

The repository includes a Vercel deployment workflow at `.github/workflows/vercel-deploy.yml`. It runs automatically when the `VERCEL_TOKEN` secret is configured in the repository.

## License

See [LICENSE](LICENSE).
