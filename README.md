# Diya Run

Keep the flame alive. Dodge the rain, catch the oil.

One codebase runs as a **website** and installs as an **app** (PWA) on Android, iOS, Windows, macOS and ChromeOS. It works offline once installed.

## Play
- **Move:** drag/tap (touch or mouse), or ← → / A D
- **Pause:** II button, Esc or P · **Start/Restart:** Space or Enter
- Fuel burns down all the time. Oil refills it (+22, +50 points). Rain costs fuel (big drops cost more). Wind gusts start after 20 s, and the game speeds up over ~2 minutes.

## Run locally
Any static server works. Opening the file directly via `file://` won't register the service worker.
```
python3 -m http.server 8000   # then open http://localhost:8000
```

## Publish to the web (free)
GitHub → repo **Settings → Pages** → deploy from your branch, root folder. The site has to be served over HTTPS for "Install app" to work.

## Install as an app
- **Android / desktop Chrome / Edge:** the menu's "Install app" button, or the install icon in the address bar.
- **iPhone / iPad:** Safari → Share → *Add to Home Screen*.
- **Play Store / Microsoft Store:** wrap the hosted URL with [PWABuilder](https://www.pwabuilder.com) (it generates the store packages). No code changes are needed.

## Files
`index.html` · `style.css` · `game.js` (all game logic) · `manifest.webmanifest` + `sw.js` (app install + offline) · `icons/` (`node icons/make-icons.js` regenerates the PNGs from `icon.svg`).

When you change any file, bump `VERSION` in `sw.js`. Otherwise installed copies keep serving the old cached version.
