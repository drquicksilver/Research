"""Copy demo.typ into the <script type="text/plain" id="demo-source"> block of typst.html."""
import pathlib
import re

here = pathlib.Path(__file__).parent
demo = (here / "demo.typ").read_text()
for bad in ("</script", "<!--"):
    if bad in demo.lower():
        raise SystemExit(f"demo.typ contains {bad!r}, which would break the inline <script> block")

html_path = here / "typst.html"
html = html_path.read_text()
block = f'<!-- DEMO:START -->\n<script type="text/plain" id="demo-source">\n{demo}</script>\n<!-- DEMO:END -->'
html, n = re.subn(r"<!-- DEMO:START -->.*?<!-- DEMO:END -->", lambda _: block, html, flags=re.S)
if n != 1:
    raise SystemExit("DEMO markers not found in typst.html")
html_path.write_text(html)
print(f"Inlined {len(demo):,} characters of demo.typ into typst.html")
