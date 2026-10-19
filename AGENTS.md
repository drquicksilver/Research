Start by creating a new folder for your work with an appropriate name.

Create a notes.md file in that folder and append notes to it as you work, tracking what you tried and anything you learned along the way.

Build a README.md report at the end of the investigation.

Your final commit should include just that folder and selected items from its contents:

The notes.md and README.md files
Any code you wrote along the way
If you checked out and modified an existing repo, the output of "git diff" against that modified repo saved as a file - but not a copy of the full repo
If appropriate, any binary files you created along the way provided they are less than 2MB in size
Do NOT include full copies of code that you fetched as part of your investigation. Your final commit should include only new files you created or diffs showing changes you made to existing code.

## HTML artefacts and GitHub Pages

Every file committed to `main` is published to GitHub Pages at
`https://drquicksilver.github.io/Research/<folder>/<path>` (the path is case-sensitive).
Your README.md is rendered as your project's page at `https://drquicksilver.github.io/Research/<folder>/`
(other `.md` files such as notes.md become `<name>.html`, and relative links between them are fixed up),
unless your folder has its own `index.html`, in which case the README goes to `readme.html`.
The site index at https://drquicksilver.github.io/Research/ links to every project page and to every
`.html` file in each folder, so an HTML file you commit is discoverable without further work.
Link your artefacts from your README with relative links (e.g. `[demo](demo.html)`) so they work both on
GitHub and on the project page.

When an interactive demo, visualisation, playground or rich report would explain your findings
better than Markdown alone, build it as an HTML file inside your folder:

- Prefer a single self-contained file (inline CSS/JS). If it needs libraries, load pinned versions
  from a CDN (cdnjs, jsDelivr, unpkg) rather than committing copies of them.
- Use relative paths only for anything else it loads, so it works both locally and on Pages.
- Commit the built HTML itself (e.g. a bundled `dist/demo.html`), not just the source that produces it.
- Keep each committed file under 2MB.
- Link to the published URL from your README, e.g.
  `https://drquicksilver.github.io/Research/your-folder/demo.html`. It goes live once the
  branch is merged to `main`.

If the published site needs generated files that should not be committed (large data, build output),
add a `github-pages.sh` script to your folder. `build-github-pages.sh` runs it with your folder as the
working directory before copying the repo into the site. It must be idempotent and should not fail the
whole build if an optional download fails (print a warning and exit 0).
