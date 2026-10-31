# Endfield Tracker

An all-in-one page for Arknights: Endfield: a sideways timeline of every version (oldest → current → next, each with its art, dates, update notes and preview program; it opens with the current version at the left edge, has ← → buttons, and the mouse wheel pans it while the pointer is over the section, handing back to the page at either end. All cards, the next version included (striped placeholder art until it has some), share one layout. The current version starts full size; clicking a smaller card, which lifts and zooms its art on hover, grows it while the open one shrinks, and clicking the open card closes it so none is open. The accent border follows the open card; the current version is marked by "Live now" and its progress bar. The choice survives the 30-second redraws), daily/weekly resets under the server switch, redeem codes, events happening now and coming up, a calendar of every time-limited activity, Headhunting and Arsenal Exchange banners (each with the official banner art), Endgame Modes, livestreams, version history and official news. David's goal: understand what's happening in the game without launching it. Modeled on the HoYo Version Tracker (`../HoyoVersionTracker`) and uses the same Dusk theme as the home page (see its CLAUDE.md): gradient background, translucent rounded cards, Bricolage Grotesque headings, Inter text, light and dark. Activity kinds have colors: events `--pen`, headhunting `--win`, arsenal issues `--apple`, endgame `--leaf`; the calendar and "Coming up" both show this color key (versions and livestreams are `--accent`). Sections are titled "Headhunting", "Arsenal Exchange" and "Endgame Modes" (David's wording).

Has the site-wide light/dark switch (top right; see the home page CLAUDE.md). Everything redraws on the `themechange` event.

- Repository: https://github.com/mentalplatypus/EndfieldTracker (public, branch `main`)
- Live site: https://mentalplatypus.github.io/EndfieldTracker/ (GitHub Pages redeploys on every push to `main`)
- Listed under "Ongoing projects" on the home page (`mentalplatypus/mentalplatypus.github.io`, branch `master`), started 2026-10-30.

## Files

- `index.html`: the whole page, no build step. Loads `data/tracker.json` and works out the current version, the next one, countdowns, the calendar and every list in the browser. It redraws every 30 seconds, keeping the version timeline's scroll position. (This timeline replaced the separate version/reset cards and the "Versions & livestreams" table, so visitors can find an old version's program without scrolling to the bottom.)
- `scripts/update.mjs`: reads the official news API and the official YouTube channel and writes `data/tracker.json`, and adds cross-checked redeem codes to `data/codes.json`. Node 20+, no dependencies.
- `data/tracker.json`: facts only: `versions` (name, maintenance `start`, `open` when maintenance ends, notes `post` id, `cover` art), `activities` (see below), `livestreams`, `mentions` (when each bracketed version name first appeared in a post title) and the 15 newest `news` posts. `updated` changes only when the data does.
- `data/posts.json`: cache of what was parsed from each post id (and `yt:<id>` for livestream times). Posts from the last 14 days are re-read every run in case they're corrected. Delete it to re-parse everything after changing the parsing rules.
- `data/codes.json`: the list of redeem codes. There's no official or open source; codes come from social media and livestreams and are redeemed only in-game under Settings → Platform & Account → Exchange Code (there is no official web redemption page, so the page has Copy buttons but no Redeem button). Started as a hand-kept list on 2026-10-30; since 2026-10-31 (David's request) the script also adds codes automatically **when both GamesRadar and endfield.gg list them as working** (`auto: true`). David asked for Game8 + endfield.gg, but Game8 sends GitHub's servers an empty page (a datacenter block; don't try to get around it), so he chose GamesRadar as the replacement: it was the most current of the other code pages and gives expiry dates. Each entry: `code`, `rewards`, `added` (date), `expires` (ISO time, a `YYYY-MM-DD` date that lasts to the end of that day at UTC−5, or `null` if no expiry is announced), `permanent` (GamesRadar calls it a permanent code; shown as "Permanent"), optional `expiresWith` (a version name: the code expires when that version ends, as livestream codes usually do), `platform` (e.g. `"PC"`), `note` and `auto`. The page hides expired codes. Codes can still be added by hand (e.g. when David mentions one before the fan sites have it).
  - **GamesRadar** (`gamesradar.com/games/rpg/arknights-endfield-codes/`): `<li><strong>CODE</strong> &ndash; rewards <em>[expires November 25, 2026]</em></li>` items above the `id="section-expired…"` heading (expired codes below it are in `<del>`); "[permanent code]" means no expiry, "can only be redeemed on PC" sets `platform`. Its rewards wording is used for new codes. **GamesRadar is the source of truth for expiry** (David, 2026-10-31): every run copies its date into `expires` and its permanent flag into `permanent` for each code it lists as working, and **removes codes it lists as expired**. Codes it doesn't mention at all are left alone.
  - **endfield.gg** (`endfield.gg/arknights-endfield-codes/`): `<li><strong>CODE</strong> - 8,000x T-Creds, …</li>` items between the `id="Working_…"` heading and the next `<h2>`; "(PC only)" also sets `platform`.
  - If either site fails or yields no codes (a redesign), the list is left as it is and the run logs it.
- `.github/workflows/update.yml`: runs the script every three hours and commits `data/` if it changed ("Update tracker data" commits from github-actions[bot] are expected).

## Sources

- **News API** (public, no key): `https://web-news.gryphline.com/api/bulletin?lang=en-us&code=arknights_endfield_official&page=N&pageSize=20` lists posts (`cid`, `tab` notices/events/news, `title`, `displayTime` in Unix seconds, `cover` a 1600×900 image on web-static.hg-cdn.com); `/api/bulletin/<cid>?lang=en-us&code=arknights_endfield_official` returns the HTML body in `data.data`. Articles live at `https://endfield.gryphline.com/en-us/news/<cid>`. Found in the official site's JS (`cms.host`, `cms.appCode`).
- **"[Name] Version Update Notes"** posts hold everything: maintenance times per server ("Asia Server: … (UTC+8)" is used for `start`/`open`) and, in the sections "New Headhunting Events and Issues", "New Events" and "Event(s) & Gameplay Updates", numbered items with `· Event Time:` / `· Availability:` / `· Season Update:` lines. Items under ○[Season …] are Echoes of War seasons; a bracketed line inside an item (e.g. "[Monumental Etching: …] limited-time challenge event") starts a sub-activity. "Version Update & Maintenance Preview" and "Version Pre-Download & Update Notice" posts give the next version's maintenance time a few days early.
- **Preview programs** (`livestreams`): every version gets one, alternating so far between a livestream ("Special Program", streams tab) and a premiered video ("Version Preview … is now live", videos tab) on the official YouTube channel (`UCowPaVRBzg8CE6K4CB6LJfw`). Both tabs are read; `live` is `isLiveContent` from the watch page and the page labels them "livestream" or "preview video". The time is `startTimestamp` (streams) or `publishDate` (videos). A stream re-uploaded as a video (same title) is skipped. Programs are kept after they scroll off the tabs' first page; `OLD_PROGRAMS` seeds two (1.1, 1.3) that had already gone. A program naming no version (1.1's "Dev Log … Version Preview") belongs to the next version starting within three weeks. Version names are the bracketed or quoted name in the title; "Official Release" is the launch stream. Test-phase streams are skipped. If YouTube fails, the old list is kept. DEV Comm posts are written notes, not streams.
- The launch version (Jan. 22, 2026) has no notes post and is hard-coded as `LAUNCH`, with the key art from the "Pre-Download Now Available" notice as its `cover`.

## Activities

Each has `name`, `type` (as written, e.g. "Chartered Headhunting", "Fun & Games Event"), `kind` (event, headhunting, arsenal, endgame), `version`, and times in **server time** strings like `2026-10-29T12:00`; the page converts them for the chosen server (Asia UTC+8, Americas / Europe UTC−5).

- `start`: a time, or `"version"` (when the version's maintenance ends).
- `end`: a time, `"next"` (when the next version's maintenance begins), `{ banners: 3, from: "X" }` (arsenal issues ending after three chartered banners starting from X), `{ with: "X" }`, or `{ asia, amer }` when the servers differ.
- `at`: a one-off moment (new Umbral Monument stages, a Delver spatial set) instead of a range.
- `updates`: mid-event content updates. `extra`: side ranges such as Secret Sanctuary or goods exchange. `featured`: the rate-up 6★ operator or weapon.
- `art`: banner image (headhunting and arsenal only), the `cover` of the official post announcing that banner: a post whose title starts with the bracketed banner name and mentions Headhunting, or for "… Issue" names a Limited-Time Offer. Reruns reuse the art of an earlier banner with the same `featured` and kind. Upcoming banners get art once their post appears, usually the day before they open.
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
