#!/usr/bin/env python3
"""Generate the HTML pages for the GitHub Pages site.

For every research folder (a top-level folder with a README.md):
  - render each Markdown file to HTML next to it in the site: README.md
    becomes the folder's index.html (readme.html if the folder already has
    its own index.html), notes.md becomes notes.html, and so on;
  - rewrite relative links between those Markdown files to the rendered pages.
Then write the site index listing every project, linking its page and every
.html artefact in the folder.

Usage: render-pages-site.py REPO_ROOT SITE_DIR
Needs the `markdown` package (see requirements-pages.txt).
"""

import html
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import markdown

SKIP_DIRS = {"node_modules", ".venv", "__pycache__", "_site"}
MD_EXTENSIONS = ["extra", "sane_lists", "toc"]

STYLE = """
  :root { --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --line: #d8dee4; --link: #0969da; --chip: #f6f8fa; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #30363d; --link: #4493f8; --chip: #161b22; }
  }
  body { margin: 0; background: var(--bg); color: var(--fg); line-height: 1.5;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 32px 16px 64px; }
  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.875em; }
  .meta, .intro, nav { color: var(--muted); font-size: 0.875rem; }
  nav { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap;
        padding-bottom: 12px; margin-bottom: 8px; border-bottom: 1px solid var(--line); }
  article { border-top: 1px solid var(--line); padding: 20px 0; }
  article h2 { margin: 0; font-size: 1.25rem; }
  .meta { margin: 4px 0 8px; }
  .pages { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 8px; }
  .pages a { display: inline-block; padding: 2px 10px; border: 1px solid var(--line); border-radius: 999px;
             background: var(--chip); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.85rem; }
  .doc h1, .doc h2 { padding-bottom: 0.3em; border-bottom: 1px solid var(--line); line-height: 1.25; }
  .doc h2 { margin-top: 1.5em; }
  .doc :not(pre) > code { padding: 0.15em 0.35em; border-radius: 6px; background: var(--chip); }
  .doc pre { padding: 12px 16px; border-radius: 6px; background: var(--chip); overflow-x: auto; }
  .doc img { max-width: 100%; height: auto; }
  .doc table { border-collapse: collapse; display: block; overflow-x: auto; }
  .doc th, .doc td { border: 1px solid var(--line); padding: 6px 12px; vertical-align: top; }
  .doc blockquote { margin-left: 0; padding-left: 1em; color: var(--muted); border-left: 0.25em solid var(--line); }
"""


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


def plain(text):
    """Strip the common inline markdown so a paragraph reads as text."""
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[`*_]", "", text)
    return " ".join(text.split())


def title_and_summary(source, fallback):
    title, paragraph, in_fence = fallback, [], False
    for line in source.splitlines():
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


def project_files(folder, suffix):
    for path in sorted(folder.rglob(f"*{suffix}")):
        rel = path.relative_to(folder)
        if not SKIP_DIRS.intersection(rel.parts):
            yield rel


def page_name(md_rel, folder):
    """Where a Markdown file is published, or None if that would clobber a committed file."""
    if md_rel.name.lower() == "readme.md":
        target = md_rel.with_name("index.html")
        if not (folder / target).exists():
            return target
        target = md_rel.with_name("readme.html")
    else:
        target = md_rel.with_suffix(".html")
    return None if (folder / target).exists() else target


def rewrite_md_links(body, md_rel, pages):
    """Point relative links at .md files that were rendered to their .html page."""

    def fix(match):
        href = html.unescape(match.group(2))
        if re.match(r"^[a-z][a-z0-9+.-]*:|^/|^#", href, re.I):
            return match.group(0)
        path, _, frag = href.partition("#")
        target = Path(os.path.normpath(md_rel.parent / path))
        if target not in pages:
            return match.group(0)
        new = Path(os.path.relpath(pages[target], md_rel.parent or Path("."))).as_posix()
        if frag:
            new += "#" + frag
        return f'{match.group(1)}="{html.escape(new, quote=True)}"'

    return re.sub(r'(href)="([^"]+\.md(?:#[^"]*)?)"', fix, body, flags=re.I)


def document(title, nav, body, body_class=""):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>{STYLE}</style>
</head>
<body>
<main>
{nav}
<div class="{body_class}">
{body}
</div>
</main>
</body>
</html>
"""


def render_project(root, site, folder, repo):
    """Render a folder's Markdown files into the site; return its index entry."""
    pages = {}
    for md_rel in project_files(folder, ".md"):
        target = page_name(md_rel, folder)
        if target:
            pages[md_rel] = target

    for md_rel, target in pages.items():
        source = (folder / md_rel).read_text(encoding="utf-8")
        body = markdown.markdown(source, extensions=MD_EXTENSIONS, output_format="html")
        body = rewrite_md_links(body, md_rel, pages)
        title, _ = title_and_summary(source, md_rel.as_posix())
        up = "../" * (len(target.parts))
        github = f"https://github.com/{repo}/blob/main/{folder.name}/{md_rel.as_posix()}" if repo else None
        nav = (
            f'<nav><a href="{up}">← All research</a>'
            + (f'<a href="{html.escape(github)}">{html.escape(folder.name)}/{html.escape(md_rel.as_posix())} on GitHub</a>' if github else "")
            + "</nav>"
        )
        out = site / folder.name / target
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(document(title, nav, body, "doc"), encoding="utf-8")

    readme = folder / "README.md"
    title, summary = title_and_summary(readme.read_text(encoding="utf-8"), folder.name)
    readme_page = pages.get(Path("README.md"))
    rendered = set(pages.values())
    return {
        "dir": folder.name,
        "title": title,
        "summary": summary,
        "date": first_commit_date(root, readme.relative_to(root)),
        "href": f"{folder.name}/" + ("" if readme_page == Path("index.html") else (readme_page or Path("README.md")).as_posix()),
        "github": f"https://github.com/{repo}/tree/main/{folder.name}" if repo else None,
        "artefacts": [p.as_posix() for p in project_files(folder, ".html") if p not in rendered],
    }


def render_index(items, repo):
    e = html.escape
    entries = []
    for item in items:
        links = "".join(
            f'<li><a href="{e(item["dir"])}/{e(page)}">{e(page)}</a></li>' for page in item["artefacts"]
        )
        source = f' · <a href="{e(item["github"])}">source</a>' if item["github"] else ""
        entries.append(
            f"""<article>
  <h2><a href="{e(item['href'])}">{e(item['title'])}</a></h2>
  <p class="meta"><code>{e(item['dir'])}/</code> · {item['date'].astimezone(timezone.utc):%Y-%m-%d}{source}</p>
  {f"<p>{e(item['summary'])}</p>" if item['summary'] else ""}
  {f'<ul class="pages">{links}</ul>' if links else ""}
</article>"""
        )
    repo_link = f' · <a href="https://github.com/{e(repo)}">{e(repo)}</a>' if repo else ""
    body = (
        "<h1>Research</h1>\n"
        f'<p class="intro">{len(items)} research projects carried out by AI coding agents{repo_link}</p>\n'
        + "".join(entries)
    )
    return document("Research", "", body)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: render-pages-site.py REPO_ROOT SITE_DIR")
    root = Path(sys.argv[1]).resolve()
    site = Path(sys.argv[2]).resolve()
    repo = github_repo(root)
    items = []
    for folder in sorted(root.iterdir()):
        if not folder.is_dir() or folder.name.startswith((".", "_")) or folder.name in SKIP_DIRS:
            continue
        if (folder / "README.md").exists():
            items.append(render_project(root, site, folder, repo))
    items.sort(key=lambda p: p["date"], reverse=True)
    (site / "index.html").write_text(render_index(items, repo), encoding="utf-8")
    print(f"Wrote site index with {len(items)} projects")


if __name__ == "__main__":
    main()
