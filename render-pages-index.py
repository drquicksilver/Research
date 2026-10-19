#!/usr/bin/env python3
"""Write the GitHub Pages index: one entry per research folder, linking its
README on GitHub and every HTML artefact in the folder. Standard library only.

Usage: render-pages-index.py REPO_ROOT OUTPUT.html
"""

import html
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SKIP_DIRS = {"node_modules", ".venv", "__pycache__", "_site"}


def git(root, *args):
    try:
        result = subprocess.run(
            ["git", *args], cwd=root, capture_output=True, text=True, timeout=10
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def github_repo(root):
    """owner/repo from $GITHUB_REPOSITORY (set in Actions) or the origin remote."""
    if os.environ.get("GITHUB_REPOSITORY"):
        return os.environ["GITHUB_REPOSITORY"]
    origin = git(root, "remote", "get-url", "origin")
    match = re.search(r"github\.com[:/](.+?)(?:\.git)?$", origin)
    return match.group(1) if match else None


def first_commit_date(root, path):
    dates = git(root, "log", "--follow", "--format=%aI", "--reverse", "--", str(path))
    if dates:
        return datetime.fromisoformat(dates.splitlines()[0])
    return datetime.fromtimestamp((root / path).stat().st_mtime, tz=timezone.utc)


def plain(markdown):
    """Strip the common inline markdown so a paragraph reads as text."""
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", markdown)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[`*_]", "", text)
    return " ".join(text.split())


def title_and_summary(readme, fallback):
    title, paragraph, in_fence = fallback, [], False
    for line in readme.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if stripped.startswith("# ") and title == fallback:
            title = stripped[2:].strip()
            continue
        if not stripped:
            if paragraph:
                break
            continue
        if stripped.startswith(("#", "|", ">", "<", "-", "*", "!")) and not paragraph:
            continue
        paragraph.append(stripped)
    summary = plain(" ".join(paragraph))
    if len(summary) > 400:
        summary = summary[:400].rsplit(" ", 1)[0] + "…"
    return plain(title), summary


def html_files(folder):
    found = []
    for path in sorted(folder.rglob("*.html")):
        rel = path.relative_to(folder)
        if not SKIP_DIRS.intersection(rel.parts):
            found.append(rel.as_posix())
    return found


def projects(root):
    for folder in sorted(root.iterdir()):
        if not folder.is_dir() or folder.name.startswith((".", "_")):
            continue
        if folder.name in SKIP_DIRS:
            continue
        readme = folder / "README.md"
        if not readme.exists():
            continue
        title, summary = title_and_summary(readme, folder.name)
        yield {
            "dir": folder.name,
            "title": title,
            "summary": summary,
            "date": first_commit_date(root, readme.relative_to(root)),
            "pages": html_files(folder),
        }


def render(items, repo):
    e = html.escape
    entries = []
    for item in items:
        readme_url = (
            f"https://github.com/{repo}/tree/main/{item['dir']}#readme" if repo else f"{item['dir']}/README.md"
        )
        links = "".join(
            f'<li><a href="{e(item["dir"])}/{e(page)}">{e(page)}</a></li>' for page in item["pages"]
        )
        entries.append(
            f"""<article>
  <h2><a href="{e(readme_url)}">{e(item['title'])}</a></h2>
  <p class="meta"><code>{e(item['dir'])}/</code> · {item['date'].astimezone(timezone.utc):%Y-%m-%d}</p>
  {f"<p>{e(item['summary'])}</p>" if item['summary'] else ""}
  {f'<ul class="pages">{links}</ul>' if links else ""}
</article>"""
        )
    repo_link = f' · <a href="https://github.com/{e(repo)}">{e(repo)}</a>' if repo else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Research</title>
<style>
  :root {{ --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --line: #d8dee4; --link: #0969da; --chip: #f6f8fa; }}
  @media (prefers-color-scheme: dark) {{
    :root {{ --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #30363d; --link: #4493f8; --chip: #161b22; }}
  }}
  body {{ margin: 0; background: var(--bg); color: var(--fg); line-height: 1.5;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
  main {{ max-width: 860px; margin: 0 auto; padding: 40px 16px; }}
  h1 {{ margin: 0 0 4px; }}
  .intro, .meta {{ color: var(--muted); }}
  article {{ border-top: 1px solid var(--line); padding: 20px 0; }}
  article h2 {{ margin: 0; font-size: 1.25rem; }}
  .meta {{ margin: 4px 0 8px; font-size: 0.875rem; }}
  a {{ color: var(--link); text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  code {{ font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }}
  .pages {{ list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 8px; }}
  .pages a {{ display: inline-block; padding: 2px 10px; border: 1px solid var(--line); border-radius: 999px;
             background: var(--chip); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.85rem; }}
</style>
</head>
<body>
<main>
<h1>Research</h1>
<p class="intro">{len(items)} research projects carried out by AI coding agents{repo_link}</p>
{"".join(entries)}
</main>
</body>
</html>
"""


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: render-pages-index.py REPO_ROOT OUTPUT.html")
    root = Path(sys.argv[1]).resolve()
    items = sorted(projects(root), key=lambda p: p["date"], reverse=True)
    Path(sys.argv[2]).write_text(render(items, github_repo(root)), encoding="utf-8")
    print(f"Wrote index with {len(items)} projects")


if __name__ == "__main__":
    main()
