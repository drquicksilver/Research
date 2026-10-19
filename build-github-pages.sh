#!/usr/bin/env bash
# Build the GitHub Pages site into _site/.
#
# 1. Run any per-folder github-pages.sh hook (cwd = that folder) so a project
#    can generate assets that are not committed.
# 2. Copy the repo (minus git/CI/dependency clutter) into _site/, so every
#    committed file is served at https://<owner>.github.io/<repo>/<path>.
# 3. Render each project's Markdown (README.md -> <folder>/index.html) and
#    write _site/index.html listing every project and its HTML artefacts.
set -euo pipefail

site_dir="_site"

find . -path ./.git -prune -o -path "./$site_dir" -prune -o \
  -name github-pages.sh -type f -print | sort | while IFS= read -r hook; do
  echo "::group::${hook#./}"
  (cd "$(dirname "$hook")" && bash ./github-pages.sh)
  echo "::endgroup::"
done

rm -rf "$site_dir"
mkdir -p "$site_dir"

rsync -a ./ "$site_dir"/ \
  --exclude .git/ \
  --exclude .github/ \
  --exclude "$site_dir"/ \
  --exclude node_modules/ \
  --exclude .venv/ \
  --exclude __pycache__/ \
  --exclude .pytest_cache/ \
  --exclude .DS_Store

python3 render-pages-site.py . "$site_dir"
touch "$site_dir/.nojekyll"
