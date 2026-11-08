#!/usr/bin/env python3
"""Stamp /assets/style.css and /assets/main.js links in every page with a content hash.

Browsers cache CSS and JS; without a version in the URL a visitor can get new HTML
with an old stylesheet. Run this after changing style.css or main.js:

    python3 tools/stamp-assets.py
"""
import hashlib
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ['style.css', 'main.js']

versions = {
    name: hashlib.sha256((ROOT / 'assets' / name).read_bytes()).hexdigest()[:10]
    for name in ASSETS
}

for page in sorted(ROOT.glob('**/index.html')):
    html = page.read_text(encoding='utf-8')
    stamped = html
    for name, version in versions.items():
        stamped = re.sub(rf'/assets/{re.escape(name)}(\?v=[0-9a-f]+)?"', f'/assets/{name}?v={version}"', stamped)
    if stamped != html:
        page.write_text(stamped, encoding='utf-8')
        print(f'stamped {page.relative_to(ROOT)}')

print(', '.join(f'{name}?v={version}' for name, version in versions.items()))
