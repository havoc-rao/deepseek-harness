#!/usr/bin/env bash
# Regenerate apps/electron/assets icons from apps/web/public/favicon.svg.
# Requires macOS, Chrome (or Chromium/Edge), and Python 3 with Pillow.
# DSH_ICON_COLOR (default #3b82f6) sets the glyph fill.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SRC="$ROOT/apps/web/public/favicon.svg"
THEME_COLOR="${DSH_ICON_COLOR:-#3b82f6}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Pick the first available headless WebKit/Blink binary; only macOS paths
# matter here because the script targets macOS qlmanage + iconutil too.
CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  if [ -x "$c" ]; then CHROME="$c"; break; fi
done
[ -n "$CHROME" ] || { echo "no Chrome/Edge/Chromium found" >&2; exit 1; }

# Extract the SVG path data and wrap it in a 1024 viewport with a flat-fill
# glyph. `qlmanage` is unsuitable because it forces an opaque background.
cat >"$TMP/build_svg.py" <<PYEOF
import re, sys
src = open(sys.argv[1]).read()
color = sys.argv[3]
m = re.search(r'<path[^>]*d="([^"]+)"', src)
if not m:
    sys.exit('no <path d="..."> in source SVG')
svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
    'viewBox="0 0 50 50" fill="none">'
    f'<path fill="{color}" d="{m.group(1)}"/>'
    '</svg>'
)
open(sys.argv[2], 'w').write(svg)
PYEOF

# Chrome screenshot wrapper. Body sets a transparent background so alpha is
# preserved. Width matches the SVG so the path is at native pixel ratio.
cat >"$TMP/render.html" <<'HTML'
<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent}
img{width:1024px;height:1024px;display:block}
</style></head>
<body><img id="g" src="file://__SVG_PATH__"></body></html>
HTML
sed -i '' "s|__SVG_PATH__|$TMP/render.svg|" "$TMP/render.html" 2>/dev/null || \
  python3 -c "import pathlib; p=pathlib.Path('$TMP/render.html'); p.write_text(p.read_text().replace('__SVG_PATH__', '$TMP/render.svg'))"

python3 "$TMP/build_svg.py" "$SRC" "$TMP/render.svg" "$THEME_COLOR"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-sandbox \
  --window-size=1024,1024 --default-background-color=00000000 \
  --screenshot="$TMP/icon-1024-source.png" \
  "file://$TMP/render.html" >/dev/null 2>&1
[ -f "$TMP/icon-1024-source.png" ] || { echo "Chrome screenshot failed" >&2; exit 1; }

cat >"$TMP/build_pngs.py" <<'PYEOF'
import os, sys
from PIL import Image
src = Image.open(sys.argv[1]).convert('RGBA')
out = sys.argv[2]
for s in (16, 32, 48, 64, 128, 256, 512, 1024):
    src.resize((s, s), Image.LANCZOS).save(os.path.join(out, f'icon-{s}.png'))
src.save(os.path.join(out, 'icon.ico'), format='ICO',
         sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
ic = os.path.join(os.path.dirname(sys.argv[1]), 'icon.iconset')
os.makedirs(ic, exist_ok=True)
for name, s in {
    'icon_16x16.png': 16, 'icon_16x16@2x.png': 32,
    'icon_32x32.png': 32, 'icon_32x32@2x.png': 64,
    'icon_128x128.png': 128, 'icon_128x128@2x.png': 256,
    'icon_256x256.png': 256, 'icon_256x256@2x.png': 512,
    'icon_512x512.png': 512, 'icon_512x512@2x.png': 1024,
}.items():
    src.resize((s, s), Image.LANCZOS).save(os.path.join(ic, name))
open(os.path.join(out, '.iconset-dir'), 'w').write(ic)
PYEOF

python3 "$TMP/build_pngs.py" "$TMP/icon-1024-source.png" "$HERE"
iconutil -c icns "$(cat "$HERE/.iconset-dir")" -o "$HERE/icon.icns"
rm -f "$HERE/.iconset-dir"
echo "icons regenerated in $HERE (color=$THEME_COLOR, renderer=$(basename "$CHROME" .app))"