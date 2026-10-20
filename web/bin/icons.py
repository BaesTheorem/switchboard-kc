#!/usr/bin/env python3
"""Makes the web app's icons from the iPhone app icon, the one master.

    python3 web/bin/icons.py

Writes web/public/icons: icon-192, icon-512, apple-touch-icon (180),
favicon-64, and maskable-512, where the art sits in the middle 80 % that
Android's icon mask keeps. Run it after the master icon changes.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MASTER = ROOT / "ios/KC311/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png"
OUT = ROOT / "web/public/icons"

im = Image.open(MASTER).convert("RGB")
for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180), ("favicon-64.png", 64)]:
    im.resize((size, size), Image.Resampling.LANCZOS).save(OUT / name, optimize=True)
padded = Image.new("RGB", (1280, 1280), im.getpixel((5, 5)))
padded.paste(im, (128, 128))
padded.resize((512, 512), Image.Resampling.LANCZOS).save(OUT / "maskable-512.png", optimize=True)
print(f"icons written to {OUT}")
