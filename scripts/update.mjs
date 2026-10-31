// Pulls the official Arknights: Endfield news and the official YouTube channel, and records versions, every
// time-limited activity, livestreams and recent news in data/tracker.json. Also adds new redeem codes to
// data/codes.json when two fan sites both list them as working. Runs on a schedule in GitHub Actions; needs
// Node 20+ and nothing else.
//
//   node scripts/update.mjs
//
// Only facts from posts are stored. Estimates (like the next version's date before it's announced) are
// worked out by the page, so a wrong guess never ends up in the data.

import { readFile, writeFile, mkdir } from "node:fs/promises";

const NEWS = "https://web-news.gryphline.com/api/bulletin";
const QUERY = "lang=en-us&code=arknights_endfield_official";
const CHANNEL = "https://www.youtube.com/channel/UCowPaVRBzg8CE6K4CB6LJfw/streams";
const HEADERS = { "User-Agent": "Mozilla/5.0 (EndfieldTracker; github.com/mentalplatypus/EndfieldTracker)", "Accept-Language": "en-US,en" };
const DATA = new URL("../data/tracker.json", import.meta.url);
const CACHE = new URL("../data/posts.json", import.meta.url);
const CODES = new URL("../data/codes.json", import.meta.url);
const DAY = 864e5;

// There's no official list of redeem codes, so a code is added only when both of these list it as working.
// Codes are never removed here; expired ones are hidden by the page once their expiry passes.
// (Game8 was the first choice, but it sends GitHub's servers an empty page.)
const GAMESRADAR = "https://www.gamesradar.com/games/rpg/arknights-endfield-codes/";
const ENDFIELD_GG = "https://endfield.gg/arknights-endfield-codes/";

// The game launched on Jan. 22, 2026 without an update-notes post; every later version has one.
// Only the day is known, so it is stored at noon UTC to read as Jan. 22 in nearly every time zone.
const LAUNCH = { name: "Launch", start: "2026-01-22T12:00:00Z", post: null };

// posts read in full: the update notes (dates of everything in the version) and the notices that
// announce a version's maintenance time a few days ahead
const NOTES_POST = /^\[(.+)\] Version Update Notes$/;
const PREVIEW_POST = /^\[(.+)\] Version (?:Update & Maintenance Preview|Pre-Download & Update Notice)$/;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// 2026/03/29 11:59, Mar. 29, 2026 at 11:59, June 5, 2026 at 06:00, Sept. 24, 2026 at 12:00
const DATE = String.raw`(?:(\d{4})/(\d{1,2})/(\d{1,2})|([A-Z][a-z]+)\.? (\d{1,2}), (\d{4}) at) (\d{1,2}):(\d{2})`;
const pad = n => String(n).padStart(2, "0");

// a server-time date as "2026-10-29T12:00"; the page turns it into a real time for the chosen server
function local(m, i = 0) {
  const [y, mo, d, mon, d2, y2, h, mi] = m.slice(i + 1, i + 9);
  const month = mo ? +mo : MONTHS.indexOf(mon.slice(0, 3).toLowerCase()) + 1;
  if (!month) return null;
  return `${y || y2}-${pad(month)}-${pad(d || d2)}T${pad(h)}:${mi}`;
}
const dates = text => [...text.matchAll(new RegExp(DATE, "g"))].map(m => local(m)).filter(Boolean);
// a date with its own UTC offset, as an ISO time
function absolute(text) {
  const m = text.match(new RegExp(DATE + String.raw`\s*\(UTC([+-]\d{1,2})\)`));
  if (!m) return null;
  const t = Date.parse(local(m) + ":00Z") - Number(m[9]) * 3600e3;
  return new Date(t).toISOString().replace(".000Z", "Z");
}

async function get(url, as = "json") {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (as === "text") return await res.text();
      const json = await res.json();
      if (json.code !== 0) throw new Error(`${json.code} ${json.msg}`);
      return json.data;
    } catch (err) {
      if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

async function listPosts() {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const data = await get(`${NEWS}?${QUERY}&page=${page}&pageSize=20`);
    out.push(...data.list);
    if (data.list.length < 20 || out.length >= data.total) break;
  }
  return out;
}

// a post's text, one line per paragraph or list item
async function postText(cid) {
  const { data } = await get(`${NEWS}/${cid}?${QUERY}`);
  return data
    .replace(/<br\s*\/?>|<\/(?:p|li|div|h\d)>/g, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .split("\n").map(l => l.trim()).filter(Boolean);
}

// "[Yuanyuan's Blazing Stoves] Fun & Games Event" → name and type; also "Argent Flow Narrative Event [Back to the Rustics]"
function titled(line) {
  const names = [...line.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
  if (!names.length) return null;
  const rest = line.replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
  // "[Umbral Monument] Challenge Gameplay Updated, [Murmurs of the Deep Forest] Stages Available"
  if (names.length > 1 && /Updated,/.test(line)) return { name: `${names[0]}: ${names[1]}`, type: "New stages" };
  // "[Bedazzled Issue] Open", "[Deep Cold Issue] Arsenal Issue Open" → "Arsenal Issue"
  const type = rest.replace(/^,\s*/, "").replace(/\s*Open$/i, "") || (/Issue\]/.test(line) ? "Arsenal Issue" : "Event");
  return { name: names.length > 1 && !/Issue|Headhunting/.test(line) ? names.join(" & ") : names[0], type };
}

function kindOf(name, type, section) {
  if (/Headhunting/i.test(type)) return "headhunting";
  if (/Issue/i.test(name) || /\bIssue\b/i.test(type)) return "arsenal";
  if (/Gameplay/i.test(section) || /Contingency Contract|Echoes of War|Umbral Monument|Monumental Etching|Delver of the Cryptic/i.test(name)) return "endgame";
  return "event";
}

// "A – B", "After [X] version update – B", "A (server time) – Before version update and maintenance"
function range(value) {
  if (/Permanent/i.test(value)) return null;
  const [from, to] = value.split(/\s+[–-]\s+/);
  const out = {};
  const ds = dates(value);
  if (/^(?:Opens )?after\b|^Throughout/i.test(from)) out.start = "version";
  else if (dates(from)[0]) out.start = dates(from)[0];
  if (/Throughout/i.test(value) || /Before (?:the next )?version update/i.test(value)) out.end = "next";
  else if (to && dates(to)[0]) out.end = dates(to)[0];
  else if (!to && ds.length > 1) out.end = ds[1];
  const banners = value.match(/ends? after (\d+) \[Chartered Headhunting\] banners \(starting from \[([^\]]+)\]\)/i);
  if (banners) out.end = { banners: +banners[1], from: banners[2] };
  const same = value.match(/ends at the same time as \[([^\]]+)\]/i);
  if (same) out.end = { with: same[1] };
  return out.start || out.end ? out : null;
}

// Every activity in one version's update notes, with server-time dates.
function parseNotes(lines, version) {
  const out = [];
  let section = "", item = null, subject = null, pending = null;
  const wanted = s => /New (?:Headhunting|Events)|Events? & Gameplay Updates/i.test(s);
  const add = (title, extra = {}) => {
    const kind = kindOf(title.name, title.type, section);
    const a = { name: title.name, type: title.type, kind, version, ...extra };
    out.push(a);
    return a;
  };
  for (const line of lines) {
    if (line.startsWith("■")) {
      // the version's own section headings start with ■; "■ Event Time:" lines inside an item don't
      if (/^■\s*Event (?:Time|Details)/.test(line) && item) { handle(line.replace(/^■\s*/, "· ")); continue; }
      section = line.replace(/^■\s*/, "");
      item = subject = pending = null;
      continue;
    }
    if (!wanted(section)) continue;
    const head = line.match(/^\d+\.\s+(.*)$/);
    if (head) {
      item = titled(head[1]);
      subject = item && { ...item, made: null };
      pending = null;
      continue;
    }
    if (!item) continue;
    // ○[Season of Phantasia], or "[Monumental Etching: Forest of Maras] limited-time challenge event will also be available"
    const sub = line.match(/^○?\s*\[([^\]]+)\](.*)$/);
    if (sub && !/Availability:/.test(line)) {
      subject = /Echoes of War/.test(item.name)
        ? { name: `Echoes of War: ${sub[1]}`, type: "Echoes of War season", made: null }
        : { name: sub[1], type: /challenge/i.test(sub[2]) ? "Limited-time challenge" : "Event", made: null };
      continue;
    }
    handle(line);
  }
  // permanent additions have no end and aren't time-limited
  return out.filter(a => a.at || a.end).filter(a => !/Permanent/i.test(a.type));

  function handle(line) {
    // per-server times follow an empty "Event Time:" line, on the server's line or the one after it
    const server = line.match(/^(Asia|Americas \/ Europe) Server:?\s*(.*)$/);
    if (pending && (server || pending.key)) {
      const key = server ? (server[1] === "Asia" ? "asia" : "amer") : pending.key;
      const value = server ? server[2] : line;
      if (!value) { pending.key = key; return; }
      pending.lines[key] = value;
      pending.key = null;
      if (pending.lines.asia && pending.lines.amer) {
        const a = range(pending.lines.asia), b = range(pending.lines.amer);
        if (a && b) {
          const act = target();
          act.start = a.start === b.start ? a.start : { asia: a.start, amer: b.start };
          act.end = a.end === b.end ? a.end : { asia: a.end, amer: b.end };
        }
        pending = null;
      }
      return;
    }
    const field = line.match(/^·\s*(.+?):\s*(.*)$/);
    if (!field) return;
    const [, label, value] = field;
    if (/Details|Notes|Rewards?$|Eligibility|Requirements|Criteria/i.test(label)) {
      const feat = value.match(/features the Rate-UP 6★ (?:operator|weapon) \[([^\]]+)\]/);
      if (feat && subject?.made) subject.made.featured = feat[1];
      else if (feat) subject.featured = feat[1];
      return;
    }
    if (/^\[[^\]]+\] Availability|Goods Exchange Availability/i.test(label)) {
      const r = range(value);
      if (r && subject) (target().extra ??= []).push({ label: label.replace(/\s*Availability$/i, "").replace(/[[\]]/g, "") || "Exchange", ...r });
      return;
    }
    if (/Content Update Time|Event Update Time/i.test(label)) {
      const d = dates(value)[0];
      if (d && subject) (target().updates ??= []).push(d);
      return;
    }
    if (/^(?:Event Time|Availability|Event Availability|Season Update|Update Time)$/i.test(label)) {
      if (!value.trim()) { pending = { lines: {} }; return; }
      const r = range(value);
      if (!r) return;
      // a single date for a gameplay update ("Availability: Oct. 22, 2026 at 12:00") is a one-off moment
      if (!r.end && r.start && r.start !== "version") { target().at = r.start; return; }
      const act = target();
      if (act.start || act.at) {
        // a second range in the same item belongs to a new activity (rare; keep both)
        const again = add({ name: subject.name, type: subject.type }, r);
        subject.made = again;
        return;
      }
      Object.assign(act, r);
    }
  }

  function target() {
    if (!subject.made) {
      subject.made = add({ name: subject.name, type: subject.type });
      if (subject.featured) subject.made.featured = subject.featured;
    }
    return subject.made;
  }
}

async function parsePost(post) {
  const title = post.title.trim();
  const notes = title.match(NOTES_POST), preview = title.match(PREVIEW_POST);
  if (!notes && !preview) return {};
  const lines = await postText(post.cid);
  const name = (notes || preview)[1];
  const found = { version: name };
  if (notes) {
    // "Asia Server: Oct. 15, 2026 at 06:00 – Oct. 15, 2026 at 12:00 (UTC+8)"
    const asia = lines.find(l => /^Asia Server:/.test(l) && /UTC\+8/.test(l));
    if (asia) {
      const [start, open] = dates(asia);
      found.start = absolute(asia.replace(/–.*?(\(UTC)/, "$1"));
      if (open) found.open = new Date(Date.parse(open + ":00Z") - 8 * 3600e3).toISOString().replace(".000Z", "Z");
    }
    found.activities = parseNotes(lines, name);
  } else {
    // "we plan to begin maintenance for the game client update on Oct. 15, 2026 at 06:00 (UTC+8)"
    const line = lines.find(l => /maintenance/i.test(l) && /\(UTC\+8\)/.test(l));
    if (line) found.start = absolute(line);
  }
  return found;
}

// livestreams: the "Special Program" videos on the official channel, with their (scheduled) start times
async function livestreams(cache) {
  const html = await get(CHANNEL, "text");
  const at = html.indexOf("var ytInitialData = ");
  const data = JSON.parse(html.slice(at + 20, html.indexOf(";</script>", at)));
  const videos = [];
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    const l = o.lockupViewModel;
    if (l?.contentId) videos.push({ id: l.contentId, title: l.metadata?.lockupMetadataViewModel?.title?.content ?? "" });
    for (const k in o) walk(o[k]);
  })(data);
  const out = [];
  for (const v of videos) {
    if (!/Special Program/i.test(v.title)) continue;
    const key = `yt:${v.id}`;
    // past streams are read once; upcoming ones each run in case the time moves
    if (!cache[key] || Date.parse(cache[key].time) > Date.now() - DAY) {
      try {
        const page = await get(`https://www.youtube.com/watch?v=${v.id}`, "text");
        const time = page.match(/"startTimestamp":"([^"]+)"/)?.[1] || page.match(/"scheduledStartTime":"(\d+)"/)?.[1];
        if (time) cache[key] = { time: new Date(/^\d+$/.test(time) ? time * 1000 : time).toISOString().replace(".000Z", "Z") };
      } catch (err) { console.error(`video ${v.id}: ${err.message}`); }
    }
    // test-phase programs aired months before launch and don't belong to a version
    if (!cache[key] || /Test/i.test(v.title)) continue;
    // the version is named in brackets or quotes: The [At the Wake of Spring] Version …, "Sanctuary of Ink" Special Program
    const named = [...v.title.matchAll(/[[“"]([^\]”"]+)[\]”"]/g)].map(m => m[1]).find(n => !/Subtitles/i.test(n));
    out.push({ title: v.title, video: v.id, time: cache[key].time, version: /Official Release/i.test(v.title) ? LAUNCH.name : named ?? null });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

const plain = html => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&ndash;/g, "–").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "’").replace(/\s+/g, " ").trim();

// GamesRadar: "<li><strong>CODE</strong> &ndash; 8,000 T-Creds, … <em>[expires November 25, 2026]</em></li>" above the
// "Expired" heading, and "<li><del>CODE</del> &ndash; … [expired August 30, 2026]</li>" below it.
// "[permanent code]" means it never expires.
async function gamesRadarCodes() {
  const html = await get(GAMESRADAR, "text");
  const end = html.indexOf('id="section-expired');
  if (end < 0) throw new Error("no Expired codes heading on GamesRadar");
  const working = new Map();
  for (const m of html.slice(0, end).matchAll(/<li>\s*<strong>\s*([A-Z0-9]{6,})\s*(?:&ndash;)?\s*<\/strong>(.*?)<\/li>/g)) {
    const text = plain(m[2]);
    const expiry = text.match(/expires (\w+) (\d{1,2}), (\d{4})/i);
    const month = expiry && MONTHS.indexOf(expiry[1].slice(0, 3).toLowerCase()) + 1;
    working.set(m[1], {
      rewards: text.replace(/\[.*$/, "").replace(/^[\s–-]+/, "").trim(),
      expires: month ? `${expiry[3]}-${pad(month)}-${pad(expiry[2])}` : null,
      permanent: /permanent/i.test(text),
      pc: /redeemed on PC|PC only/i.test(text),
    });
  }
  const expired = new Set([...html.slice(end).matchAll(/<li>\s*<del>\s*([A-Z0-9]{6,})\s*<\/del>/g)].map(m => m[1]));
  return { working, expired };
}

// endfield.gg: "<li><strong>CODE</strong> - 8,000x T-Creds, …, and 1x Heat-Driven Cog</li>" under the "Working" heading
async function endfieldGgCodes() {
  const html = await get(ENDFIELD_GG, "text");
  const start = html.indexOf('id="Working_');
  if (start < 0) throw new Error("no Working codes heading");
  const section = html.slice(start, html.indexOf("<h2", start + 10));
  const out = new Map();
  for (const m of section.matchAll(/<li>\s*<strong>([A-Z0-9]+)<\/strong>\s*[-–]\s*(.*?)<\/li>/g)) {
    const text = plain(m[2]);
    const rewards = text.replace(/\(PC only\)/i, "").replace(/\s*×\d+/g, "").replace(/(\d[\d,]*)x /g, "$1 ").replace(/,? and /g, ", ").trim();
    out.set(m[1], { rewards, pc: /PC only/i.test(text) });
  }
  return out;
}

// Keeps data/codes.json in step with GamesRadar: adds codes it and endfield.gg both list as working, copies
// its expiry dates (or "permanent"), and removes codes it lists as expired. Codes GamesRadar doesn't
// mention (added by hand, say) are left alone.
async function updateCodes() {
  const [{ working: a, expired }, b] = await Promise.all([gamesRadarCodes(), endfieldGgCodes()]);
  if (!a.size || !b.size) throw new Error(`found ${a.size} codes on GamesRadar and ${b.size} on endfield.gg; the page layout may have changed`);
  const file = await readJSON(CODES, { codes: [] });
  const before = JSON.stringify(file);
  const today = new Date().toISOString().slice(0, 10);
  for (const [code, gr] of a) {
    let c = file.codes.find(c => c.code === code);
    if (!c) {
      if (!b.has(code)) continue;
      const gg = b.get(code);
      c = { code, rewards: gr.rewards || gg.rewards, added: today, expires: null, auto: true };
      if (gg.pc || gr.pc) c.platform = "PC";
      file.codes.push(c);
      console.log(`New code ${code}: ${c.rewards}`);
    }
    c.expires = gr.expires;
    if (gr.permanent && !gr.expires) c.permanent = true; else delete c.permanent;
  }
  file.codes = file.codes.filter(c => {
    if (!expired.has(c.code)) return true;
    console.log(`Removed expired code ${c.code}`);
    return false;
  });
  if (JSON.stringify(file) !== before) await writeFile(CODES, JSON.stringify(file, null, 2) + "\n");
  console.log(`codes: ${a.size} working and ${expired.size} expired on GamesRadar, ${b.size} on endfield.gg, ${file.codes.length} in data/codes.json`);
}

const readJSON = async (url, fallback) => { try { return JSON.parse(await readFile(url, "utf8")); } catch { return fallback; } };

const tracker = await readJSON(DATA, {});
const { updated, ...oldFacts } = tracker;
const cache = await readJSON(CACHE, {});

let posts;
try {
  posts = await listPosts();
} catch (err) {
  console.error(`Couldn't list posts, keeping old data. ${err.message}`);
  process.exit(1);
}
posts.sort((a, b) => a.displayTime - b.displayTime);

const versions = [{ ...LAUNCH }], activities = [], mentions = {}, art = {};
for (const post of posts) {
  // banner art: the cover of a banner's own announcement shows its operator or weapon, e.g.
  // "[Rejuvenation] Chartered Headhunting" or "[Seal of Jade Issue] LTO Details". Only the first bracketed
  // name counts, since a post announcing two banners pictures the first one.
  const first = post.title.match(/\[([^\]]+)\]([^[]*)/);
  if (post.cover && first && (/Headhunting/i.test(first[2]) || (/Issue$/.test(first[1]) && /LTO|Limited-Time Offer/i.test(first[2])))) art[first[1]] = post.cover;
  // recent posts are re-read in case they were corrected; older ones come from the cache
  const recent = post.displayTime * 1000 > Date.now() - 14 * DAY;
  if (!cache[post.cid] || recent) {
    try { cache[post.cid] = await parsePost(post); } catch (err) { console.error(`post ${post.cid}: ${err.message}`); if (!cache[post.cid]) continue; }
  }
  const f = cache[post.cid];
  const time = new Date(post.displayTime * 1000).toISOString().replace(".000Z", "Z");
  if (f.version) {
    let v = versions.find(v => v.name === f.version);
    if (!v) versions.push(v = { name: f.version });
    if (f.start) v.start = f.start;
    if (f.open) v.open = f.open;
    // the update notes' cover is the version's key art
    if (f.activities) { v.post = post.cid; if (post.cover) v.cover = post.cover; activities.push(...f.activities); }
  }
  // when each bracketed version name first appeared in a title; the page names the next version from this
  if (/\bVersion\b/i.test(post.title)) {
    const name = post.title.match(/\[([^\]]+)\]/)?.[1];
    if (name && !(name in mentions)) mentions[name] = time;
  }
}
versions.sort((a, b) => (a.start || "~").localeCompare(b.start || "~"));

let streams = oldFacts.livestreams ?? [];
try { streams = await livestreams(cache); } catch (err) { console.error(`Couldn't read livestreams, keeping old ones. ${err.message}`); }
for (const s of streams) if (s.version && s.version !== LAUNCH.name && !(s.version in mentions)) mentions[s.version] = s.time;

try { await updateCodes(); } catch (err) { console.error(`Couldn't check redeem codes, keeping the list as it is. ${err.message}`); }

for (const a of activities) if (art[a.name]) a.art = art[a.name];
// reruns (RE-Factor banners) borrow the art of an earlier banner featuring the same operator or weapon
for (const a of activities) if (!a.art && a.featured) a.art = activities.find(b => b.art && b.featured === a.featured && b.kind === a.kind)?.art;

const facts = {
  versions,
  activities,
  livestreams: streams,
  mentions,
  news: posts.slice().sort((a, b) => b.displayTime - a.displayTime).slice(0, 15)
    .map(p => ({ id: p.cid, title: p.title.trim(), tab: p.tab, time: new Date(p.displayTime * 1000).toISOString().replace(".000Z", "Z") })),
};
// only touch the timestamp when something changed, so quiet runs don't make a commit
const out = { updated: JSON.stringify(facts) === JSON.stringify(oldFacts) ? updated : new Date().toISOString().replace(/\.\d+Z$/, "Z"), ...facts };
await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(DATA, JSON.stringify(out, null, 2) + "\n");
await writeFile(CACHE, JSON.stringify(cache) + "\n");
console.log(`${versions.length} versions, latest ${versions.at(-1).name}; ${activities.length} activities; ${streams.length} livestreams`);
