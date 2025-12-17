CLEAR PATH TAKEOFF — MVP v6 (FIX: clicks + zoom)

Fixes:
- Clicks were getting eaten by the PDF canvas in some browsers — pdfCanvas now ignores pointer events so Konva overlay captures clicks.
- Added zoom controls (– / + / Fit) + trackpad wheel zoom.
- Viewer now scrolls when zoomed in.

Deploy:
- Replace repo root files with these 4 files, then hard refresh (Cmd+Shift+R).
