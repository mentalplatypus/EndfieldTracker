# Endfield Tracker

An all-in-one page for Arknights: Endfield: the current and next version, events happening now and coming up, a calendar of every time-limited activity, headhunting and arsenal banners, endgame modes, livestreams, version history and official news. David's goal: understand what's happening in the game without launching it. Modeled on the HoYo Version Tracker (`../HoyoVersionTracker`) and uses the same Dusk theme as the home page (see its CLAUDE.md): gradient background, translucent rounded cards, Bricolage Grotesque headings, Inter text, light and dark. Activity kinds have colors: events `--pen`, headhunting `--win`, arsenal issues `--apple`, endgame `--leaf`.

Has the site-wide light/dark switch (top right; see the home page CLAUDE.md). Everything redraws on the `themechange` event.

- Repository: https://github.com/mentalplatypus/EndfieldTracker (public, branch `main`)
- Live site: https://mentalplatypus.github.io/EndfieldTracker/ (GitHub Pages redeploys on every push to `main`)
- Listed under "Ongoing projects" on the home page (`mentalplatypus/mentalplatypus.github.io`, branch `master`), started 2026-10-30.

## Files

- `index.html`: the whole page, no build step. Loads `data/tracker.json` and works out the current version, the next one, countdowns, the calendar and every list in the browser.
- `scripts/update.mjs`: reads the official news API and the official YouTube channel and writes `data/tracker.json`. Node 20+, no dependencies.
- `data/tracker.json`: facts only: `versions` (name, maintenance `start`, `open` when maintenance ends, notes post id), `activities` (see below), `livestreams`, `mentions` (when each bracketed version name first appeared in a post title) and the 15 newest `news` posts. `updated` changes only when the data does.
- `data/posts.json`: cache of what was parsed from each post id (and `yt:<id>` for livestream times). Posts from the last 14 days are re-read every run in case they're corrected. Delete it to re-parse everything after changing the parsing rules.
- `.github/workflows/update.yml`: runs the script every three hours and commits `data/` if it changed ("Update tracker data" commits from github-actions[bot] are expected).

## Sources

- **News API** (public, no key): `https://web-news.gryphline.com/api/bulletin?lang=en-us&code=arknights_endfield_official&page=N&pageSize=20` lists posts (`cid`, `tab` notices/events/news, `title`, `displayTime` in Unix seconds); `/api/bulletin/<cid>?lang=en-us&code=arknights_endfield_official` returns the HTML body in `data.data`. Articles live at `https://endfield.gryphline.com/en-us/news/<cid>`. Found in the official site's JS (`cms.host`, `cms.appCode`).
- **"[Name] Version Update Notes"** posts hold everything: maintenance times per server ("Asia Server: … (UTC+8)" is used for `start`/`open`) and, in the sections "New Headhunting Events and Issues", "New Events" and "Event(s) & Gameplay Updates", numbered items with `· Event Time:` / `· Availability:` / `· Season Update:` lines. Items under ○[Season …] are Echoes of War seasons; a bracketed line inside an item (e.g. "[Monumental Etching: …] limited-time challenge event") starts a sub-activity. "Version Update & Maintenance Preview" and "Version Pre-Download & Update Notice" posts give the next version's maintenance time a few days early.
- **Livestreams**: "Special Program" videos on the official YouTube channel's streams tab (channel `UCowPaVRBzg8CE6K4CB6LJfw`); the time is `startTimestamp` from each watch page. Version names are the bracketed or quoted name in the title; "Official Release" is the launch stream. Test-phase streams are skipped. If YouTube fails, the old list is kept. DEV Comm posts are written notes, not streams.
- The launch version (Jan. 22, 2026) has no notes post and is hard-coded as `LAUNCH`.

## Activities

Each has `name`, `type` (as written, e.g. "Chartered Headhunting", "Fun & Games Event"), `kind` (event, headhunting, arsenal, endgame), `version`, and times in **server time** strings like `2026-10-29T12:00`; the page converts them for the chosen server (Asia UTC+8, Americas / Europe UTC−5).

- `start`: a time, or `"version"` (when the version's maintenance ends).
- `end`: a time, `"next"` (when the next version's maintenance begins), `{ banners: 3, from: "X" }` (arsenal issues ending after three chartered banners starting from X), `{ with: "X" }`, or `{ asia, amer }` when the servers differ.
- `at`: a one-off moment (new Umbral Monument stages, a Delver spatial set) instead of a range.
- `updates`: mid-event content updates. `extra`: side ranges such as Secret Sanctuary or goods exchange. `featured`: the rate-up 6★ operator or weapon.
- Permanent additions are dropped.

## Estimates (page only, never stored)

- **Version numbers** are counted from launch (Launch 1.0, then 1.1, 1.2, …); official titles only use names.
- **Next version date**, before it's announced: the Americas / Europe server's events that end at 17:00 UTC−5 (06:00 UTC+8) end exactly when the next maintenance starts (Sanity Supply always does), so the latest such end is used and labeled "Expected". Failing that, 42 days after the current version started, labeled "Estimated".
- **Next version name**: the first new bracketed name in a post title or livestream title after the current version starts.
- **Echoes of War cycles**: three weekly cycles counted from the season start.
- **Resets**: daily at 04:00 server time, weekly Monday 04:00.
- The server switch is saved in `localStorage` under `endfield-server`; first visits guess Americas / Europe for time zones in America, Europe, Africa or Atlantic, else Asia.

## Testing locally

Node and Python aren't installed on this machine; use a temporary portable Node in the scratchpad to run the script and serve the folder over http (the page fetches JSON, so `file://` won't work). Check both servers, light and dark mode, and about 375px width before pushing.

## Git workflow (required)

- Commit each logical change as soon as it works, with a short imperative subject line. Push right after. Pull first, since the bot commits data every few hours.
- Run `git status` and `git diff` before committing so only intended files go in.
- Pushes go live immediately, so only push finished, working changes.
- Never force-push or amend pushed commits; revert with a new commit instead.
- Keep `README.md` visitor-facing: the live link and a short description, no editing notes.
