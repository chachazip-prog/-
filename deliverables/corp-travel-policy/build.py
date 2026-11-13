#!/usr/bin/env python3
"""src/ 의 CSS·JS를 하나의 HTML 파일로 합친다.  사용: python3 build.py"""
from pathlib import Path

root = Path(__file__).parent
src = root / "src"
css = (src / "base.css").read_text(encoding="utf-8")
views = []
css += "".join("\n/* ---- %s ---- */\n%s" % (p.name, p.read_text(encoding="utf-8")) for p in views)
js_files = [src / "data.js", src / "app.js"]
js = "".join("\n/* ==== %s ==== */\n%s" % (p.name, p.read_text(encoding="utf-8")) for p in js_files)
assert "</script" not in js.lower(), "JS 안에 </script 문자열이 있으면 안 됩니다"
html = (src / "shell.html").read_text(encoding="utf-8").replace("/*__CSS__*/", css).replace("/*__JS__*/", js)
out = root / "corp-travel-policy.html"
out.write_text(html, encoding="utf-8")
print("built", out, len(html), "bytes")
