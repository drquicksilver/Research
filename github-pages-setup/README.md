# Publishing HTML research artefacts to GitHub Pages

How [simonw/research](https://github.com/simonw/research) publishes to GitHub Pages, and a ready-to-install
version of the same setup for this repo. With it, any HTML file a research task commits goes live at
`https://drquicksilver.github.io/Research/<folder>/<file>.html`.

## How Simon Willison's repo does it

He uses no `gh-pages` branch and no Jekyll. A GitHub Actions workflow deploys a built folder through the
official Pages actions:

| File | Role |
|---|---|
| `.github/workflows/deploy-pages.yml` | On push to `main`: regenerate the README, build `_site/`, upload it with `actions/upload-pages-artifact`, deploy it with `actions/deploy-pages`. |
| `README.md` (a [cog](https://nedbatchelder.com/code/cog/) block) | Walks every folder and writes a dated entry per project. It uses `llm` with an `OPENAI_API_KEY` secret to write a summary into each `<folder>/_summary.md` (cached once written). A bot commits the result back to `main`. |
| `build-github-pages.sh` | Runs the per-folder hooks, `rsync`s the **whole repo** into `_site/`, renders the root README to `index.html` and adds `.nojekyll`. |
| `run-github-pages-hooks.sh` | Finds every `*/github-pages.sh` and runs it from inside its folder. |
| `render-readme-index.py` | Turns README.md into HTML through GitHub's `/markdown` API, so it looks like github.com. |
| AGENTS.md | Tells the agent to link demos as `https://simonw.github.io/research/<folder>/demo.html` and to use a `github-pages.sh` hook for generated assets. |

What this means:

- **Nothing is converted except the index.** Every committed file is copied as-is, so a committed
  `demo.html` is live as soon as it reaches `main`. Folder READMEs are not rendered to HTML.
- **Hooks handle assets too big to commit.** For example, `http-range-drilldown-cubes/github-pages.sh` builds a 43MB
  data file and uses the previously published copy as its build cache. When something goes wrong it prints a warning and
  exits 0, so one broken folder cannot block the deploy for everything else.
- Pages only updates from `main`, so artefacts go live when a PR is merged, not while it is open.

## The setup installed in this repo

These files are now at the repo root:

```
.github/workflows/deploy-pages.yml   # build + deploy on push to main (and manual run)
build-github-pages.sh                # hooks -> rsync to _site/ -> index.html -> .nojekyll
render-pages-index.py                # stdlib-only index generator
AGENTS.md                            # gains an "HTML artefacts and GitHub Pages" section
.gitignore                           # ignores the local _site/ build output
```

[`AGENTS.md.diff`](AGENTS.md.diff) shows exactly what was added to AGENTS.md.

It keeps Simon's design (workflow → build script → per-folder hooks → copy the repo → index) and
removes the parts that need secrets or a bot pushing to `main`:

- **No cog or LLM summaries.** The index generator reads each folder's README itself. It uses the first `#`
  heading as the title and the first paragraph as the summary, dates each project by the first commit of its
  README, and links every `.html` file in the folder as a chip. It needs no API key, no dependencies and no
  network access, and it never commits anything.
- **The hook runner is folded into `build-github-pages.sh`.** The `github-pages.sh` convention is unchanged.
- **The workflow has only `contents: read`,** because nothing writes back to the repo.
- **The new AGENTS.md section** tells agents when to make an HTML artefact and how to make one that
  survives Pages: self-contained or pinned CDN libraries, relative paths, commit the built file, under 2MB,
  link the `drquicksilver.github.io/Research/...` URL from the README.

### Tested

From the repo root I ran `bash build-github-pages.sh`. The resulting
`_site/index.html` lists both existing projects, with correct titles, summaries and GitHub README links. It also
links `2d-rigid-physics-js/dist/sequential-impulses.html` and `dist/xpbd.html`, which are already self-contained
demos. Once installed they will be live at:

- https://drquicksilver.github.io/Research/2d-rigid-physics-js/dist/sequential-impulses.html
- https://drquicksilver.github.io/Research/2d-rigid-physics-js/dist/xpbd.html

## To turn it on

1. Merge the PR that adds these files.
2. On GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
   The repo is public, so Pages is free.
3. Publish: go to **Actions → Deploy GitHub Pages → Run workflow** (the merge's own run may have failed if it
   started before step 2; after that every push to `main` deploys automatically). The site appears at
   https://drquicksilver.github.io/Research/.

Things to watch for:

- The repo name has a capital **R**, and Pages paths are case-sensitive: `/Research/` works, `/research/` 404s.
  Renaming the repo to lowercase would change every URL.
- **Everything in the repo becomes public on the web,** including notes and scripts. The repo is already public,
  so this exposes nothing new.
- Optional extras, if you want them later: Simon's LLM summaries (add `requirements.txt` and the cog block, plus
  an `OPENAI_API_KEY` secret and `contents: write`), or rendering each folder's README to `<folder>/index.html`
  through the GitHub Markdown API, as `render-readme-index.py` does for his root page.
