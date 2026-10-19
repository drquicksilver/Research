# Notes: GitHub Pages for this research repo

## What I looked at
- Shallow-cloned https://github.com/simonw/research into the session scratchpad (not committed).
- Files that make up his Pages setup:
  - `.github/workflows/deploy-pages.yml`
  - `build-github-pages.sh`
  - `run-github-pages-hooks.sh`
  - `render-readme-index.py`
  - `requirements.txt` (cogapp, llm, httpx)
  - two folders with a per-folder `github-pages.sh` hook (`http-range-drilldown-cubes`, `pyodide-asgi-browser`)
  - AGENTS.md paragraphs telling the agent about Pages URLs and hooks.

## How his pipeline works
1. Runs on push to `main` (ignores README-only / `_summary.md`-only changes, so the bot's own commit doesn't loop) plus `workflow_dispatch`.
2. A cog block in the root README walks every folder, takes the first-commit date of each README,
   and writes an LLM summary into `<folder>/_summary.md` (using `llm` + an `OPENAI_API_KEY` secret). Summaries are cached
   once written. The bot commits the regenerated README back to main.
3. `build-github-pages.sh`:
   - runs every `*/github-pages.sh` hook (cwd = that folder) so a folder can build or fetch extra assets,
   - `rsync`s the **whole repo** (minus .git, .github, caches) into `_site/`,
   - renders root README.md to `_site/index.html` through GitHub's `/markdown` API (GFM, same look as github.com),
   - touches `.nojekyll` so Jekyll leaves the files alone.
4. `actions/upload-pages-artifact` + `actions/deploy-pages` (Pages source = "GitHub Actions", no gh-pages branch).
- So every committed HTML file is live at `https://simonw.github.io/research/<folder>/<file>.html`. Nothing
  else is converted: folder READMEs are not turned into HTML, so a folder URL with no index.html 404s.
- The `http-range-drilldown-cubes` hook is a good example of a heavy hook: it builds a 43MB file that is too big
  to commit, uses the previously published copy as a cache, and never fails the build (warns and exits 0).

## Differences from this repo
- This repo has no root README, no cog, no summaries, no workflow. Remote is `drquicksilver/Research`
  (capital R), so the Pages URL is `https://drquicksilver.github.io/Research/` (path is case-sensitive).
- `2d-rigid-physics-js/dist/*.html` are already self-contained HTML demos – ready-made test case.

## Decisions for the proposal
- Keep the shape (workflow → build script → hooks → rsync → index), drop cog/LLM summaries: they need an
  OpenAI key and a bot pushing to main. Can be added later.
- Index generated with stdlib-only Python (no GitHub Markdown API, no deps): lists each folder with title
  (README H1), first paragraph, link to the README on GitHub, and links to every .html file in the folder.
- Also render each folder's README.md to `<folder>/index.html`? Would need a markdown lib or the API.
  Decided: use the GitHub /markdown API like Simon, but only if available; fall back to just linking to GitHub.
  Actually kept it simpler: no per-folder rendering; the index links to the GitHub README. Fewer moving parts.
- Exclude `node_modules`, `.venv` etc from rsync.

## Testing
- Ran the proposed build script locally against a copy of the repo with the proposed files dropped in (see README).

## Installation
- User asked for the files to be installed at the repo root and a PR opened. Moved them out of `proposed/`
  to their real paths, added a `.gitignore` for `_site/`, and re-ran the build from the root.
- Merging before enabling Pages makes the first deploy fail (Pages not configured); the README says to
  re-run the workflow by hand after switching the source to "GitHub Actions".
