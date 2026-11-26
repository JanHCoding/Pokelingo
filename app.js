/* Pokélingo – Pokémon-Namen lernen wie bei Duolingo.
 * Reine Client-App (kein Build, kein Server). Fortschritt liegt im localStorage.
 */
'use strict';

// ---------------------------------------------------------------------------
// Daten
// ---------------------------------------------------------------------------
const P = window.POKEMON.map(([id, de, en, types, gen]) => ({ id, de, en, types, gen }));
const BY_ID = new Map(P.map(p => [p.id, p]));

const GENS = [
  { n: 1, region: 'Kanto',  start: 1 },
  { n: 2, region: 'Johto',  start: 152 },
  { n: 3, region: 'Hoenn',  start: 252 },
  { n: 4, region: 'Sinnoh', start: 387 },
  { n: 5, region: 'Einall', start: 494 },
  { n: 6, region: 'Kalos',  start: 650 },
  { n: 7, region: 'Alola',  start: 722 },
  { n: 8, region: 'Galar',  start: 810 },
  { n: 9, region: 'Paldea', start: 906 },
].map(g => ({ ...g, mons: P.filter(p => p.gen === g.n) }));

const TYPE_COLORS = {
  Normal: '#9fa19f', Feuer: '#e62829', Wasser: '#2980ef', Pflanze: '#3fa129', Elektro: '#e0b000',
  Eis: '#3dcef3', Kampf: '#ff8000', Gift: '#9141cb', Boden: '#915121', Flug: '#81b9ef',
  Psycho: '#ef4179', Käfer: '#91a119', Gestein: '#afa981', Geist: '#704170', Drache: '#5060e1',
  Unlicht: '#624d4e', Stahl: '#60a1b8', Fee: '#ef70ef',
};

const LESSON_SIZE = 6;          // neue Pokémon pro Lektion (Chunking)
const LESSONS_PER_CHECKPOINT = 4;
// Leitner-Box -> Tage bis zur nächsten Wiederholung (Spaced Repetition)
const INTERVALS = [0, 1, 2, 4, 8, 16, 35, 90];
const MAX_BOX = INTERVALS.length - 1;
const DAY = 86400000;

const img = id => `img/${String(id).padStart(4, '0')}.png`;

// Lektionen + Checkpoints pro Generation aufbauen
for (const g of GENS) {
  const n = g.mons.length;
  const count = Math.ceil(n / LESSON_SIZE);
  const lessons = [];
  let idx = 0;
  for (let i = 0; i < count; i++) {
    const size = Math.floor(n / count) + (i < n % count ? 1 : 0);
    lessons.push(g.mons.slice(idx, idx + size).map(p => p.id));
    idx += size;
  }
  g.nodes = [];
  let pending = [];
  lessons.forEach((ids, i) => {
    g.nodes.push({ kind: 'lesson', key: `g${g.n}-l${i}`, ids, label: `#${ids[0]}–#${ids[ids.length - 1]}` });
    pending.push(...ids);
    if ((i + 1) % LESSONS_PER_CHECKPOINT === 0 || i === lessons.length - 1) {
      const last = i === lessons.length - 1;
      g.nodes.push({ kind: 'check', key: `g${g.n}-c${i}`, ids: pending, label: last ? 'Abschlusstest' : 'Checkpoint', final: last });
      pending = [];
    }
  });
}

// ---------------------------------------------------------------------------
// Zustand / Speicher
// ---------------------------------------------------------------------------
const STORE_KEY = 'pokelingo-v1';
const defaults = () => ({
  settings: { lang: 'de', typing: true, sound: true, tts: true, goal: 50, unlockAll: false, theme: 'auto' },
  cards: {},        // id -> { box, due, right, wrong, last }
  done: {},         // node key -> beste Genauigkeit (0..1)
  notes: {},        // id -> eigene Eselsbrücke
  xp: 0,
  streak: { count: 0, last: null },
  today: { date: null, xp: 0 },
  best: { blitz: 0 },
});
let S = load();
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw) {
      const d = defaults();
      return { ...d, ...raw, settings: { ...d.settings, ...raw.settings }, best: { ...d.best, ...raw.best } };
    }
  } catch (e) { /* ignorieren */ }
  return defaults();
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* voll/blockiert */ } }

const todayStr = (t = Date.now()) => new Date(t).toLocaleDateString('sv'); // YYYY-MM-DD lokal
function rollDay() {
  const t = todayStr();
  if (S.today.date !== t) S.today = { date: t, xp: 0 };
}
function addXp(n) {
  rollDay();
  S.xp += n; S.today.xp += n;
  const t = todayStr();
  if (S.streak.last !== t) {
    const y = todayStr(Date.now() - DAY);
    S.streak.count = S.streak.last === y ? S.streak.count + 1 : 1;
    S.streak.last = t;
  }
  save();
}
function streakAlive() {
  return S.streak.last === todayStr() || S.streak.last === todayStr(Date.now() - DAY) ? S.streak.count : 0;
}

// Spaced-Repetition-Update
function grade(id, correct) {
  const c = S.cards[id] || { box: 0, due: 0, right: 0, wrong: 0 };
  if (correct) { c.right++; c.box = Math.min(MAX_BOX, c.box + 1); }
  else { c.wrong++; c.box = Math.max(1, Math.floor(c.box / 2)); }
  c.last = Date.now();
  // fällig um 4 Uhr morgens am Zieltag, damit "morgen" wirklich morgen ist
  const d = new Date(Date.now() + INTERVALS[c.box] * DAY); d.setHours(4, 0, 0, 0);
  c.due = INTERVALS[c.box] === 0 ? Date.now() : d.getTime();
  S.cards[id] = c;
}
const isDue = id => S.cards[id] && S.cards[id].due <= Date.now();
const dueIn = mons => mons.filter(p => isDue(p.id));
const learnedIn = mons => mons.filter(p => S.cards[p.id]);
const masteredIn = mons => mons.filter(p => (S.cards[p.id]?.box || 0) >= 5);

function nodeUnlocked(g, i) {
  if (S.settings.unlockAll || i === 0) return true;
  return S.done[g.nodes[i - 1].key] !== undefined;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.random() * a.length | 0];

function normalize(s) {
  return s.toLowerCase()
    .replace(/♀/g, 'w').replace(/♂/g, 'm')
    .replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
// 'exact' | 'typo' | 'wrong'
function checkTyped(input, target) {
  const a = normalize(input), b = normalize(target);
  if (!a) return 'wrong';
  if (a === b) return 'exact';
  // Nidoran♀/♂ auch ohne Symbol akzeptieren
  if (b.replace(/[wm]$/, '') === a && /[♀♂]/.test(target)) return 'exact';
  const tol = b.length >= 9 ? 2 : b.length >= 5 ? 1 : 0;
  return lev(a, b) <= tol ? 'typo' : 'wrong';
}

const typeBadges = types => `<div class="types">${types.map(t => `<span class="type" style="background:${TYPE_COLORS[t] || '#888'}">${esc(t)}</span>`).join('')}</div>`;

// Welche Sprache wird abgefragt?
function askLang() {
  const l = S.settings.lang;
  return l === 'both' ? pick(['de', 'en']) : l;
}
const LANG_LABEL = { de: 'Deutscher Name', en: 'Englischer Name' };

// Ablenker: bevorzugt "verwechselbare" Pokémon (gleicher Typ, ähnlicher Anfangsbuchstabe, gleiche Gen)
function distractors(p, n, pool, lang = 'de') {
  const name = x => x[lang];
  let cands = pool.filter(x => x.id !== p.id && name(x) !== name(p));
  if (cands.length < n) cands = P.filter(x => x.id !== p.id && x.gen === p.gen);
  const score = x => (x.types.some(t => p.types.includes(t)) ? 2 : 0)
    + (name(x)[0] === name(p)[0] ? 2 : 0)
    + (Math.abs(name(x).length - name(p).length) <= 2 ? 1 : 0)
    + Math.random() * 3;
  const sorted = cands.map(x => [score(x), x]).sort((a, b) => b[0] - a[0]).map(e => e[1]);
  const out = [];
  for (const x of sorted) { if (!out.some(o => name(o) === name(x))) out.push(x); if (out.length === n) break; }
  return out;
}

// Ton (WebAudio, keine Dateien nötig)
let actx;
function beep(ok) {
  if (!S.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = ok ? [660, 880] : [220, 180];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = ok ? 'sine' : 'square'; o.frequency.value = f;
      const t = actx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(ok ? 0.18 : 0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.18);
    });
  } catch (e) { /* kein Audio */ }
}
function speak(text, lang) {
  if (!S.settings.tts || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/♀/, ' weiblich').replace(/♂/, ' männlich'));
    u.lang = lang === 'en' ? 'en-US' : 'de-DE'; u.rate = 0.9;
    speechSynthesis.speak(u);
  } catch (e) { /* nicht unterstützt */ }
}

function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const app = $('#app');
let route = { name: 'home' };
let keyHandler = null;
document.addEventListener('keydown', e => { if (keyHandler) keyHandler(e); });

function go(name, params = {}) {
  route = { name, ...params };
  keyHandler = null;
  if (session && name !== 'lesson') session = null;
  render();
  window.scrollTo(0, 0);
}
function render() {
  applyTheme();
  rollDay();
  ({ home: renderHome, gen: renderGen, lesson: renderLesson, result: renderResult, dex: renderDex, settings: renderSettings, about: renderAbout }[route.name] || renderHome)();
}

function topbar(back) {
  return `<header class="topbar">
    ${back ? `<button class="iconbtn" data-act="back" aria-label="Zurück">←</button>` : ''}
    <div class="title">Pokélingo</div>
    <div class="stat streak" title="Tage in Folge">🔥 ${streakAlive()}</div>
    <div class="stat xp" title="Erfahrungspunkte">⚡ ${S.xp}</div>
  </header>`;
}
function nav(active) {
  const items = [['home', '🏠', 'Lernen'], ['dex', '📕', 'Pokédex'], ['settings', '⚙️', 'Optionen']];
  return `<nav class="nav"><div class="nav-inner">${items.map(([k, ic, l]) =>
    `<button class="${active === k ? 'on' : ''}" data-nav="${k}">${ic}<span>${l}</span></button>`).join('')}</div></nav>`;
}
app.addEventListener('click', e => {
  const n = e.target.closest('[data-nav]'); if (n) { go(n.dataset.nav); return; }
  const b = e.target.closest('[data-act="back"]'); if (b) { go(route.back || 'home', route.backParams || {}); }
});

// ---------------------------------------------------------------------------
// Startseite
// ---------------------------------------------------------------------------
function renderHome() {
  const goal = S.settings.goal;
  const allDue = dueIn(P).length;
  const learned = learnedIn(P).length;
  app.innerHTML = `${topbar(false)}
  <main>
    <div class="daily">
      <div style="font-size:30px">🎯</div>
      <div class="bar">
        <b>Tagesziel</b> <span class="muted small">${S.today.xp} / ${goal} XP</span>
        <div class="progress yellow" style="margin-top:6px"><i style="width:${Math.min(100, S.today.xp / goal * 100)}%"></i></div>
      </div>
    </div>
    <div class="quick">
      <button class="btn ${allDue ? '' : 'ghost'}" id="q-review" ${allDue ? '' : 'disabled'}>🔁 Wiederholen (${allDue})</button>
      <button class="btn blue" id="q-blitz" ${learned >= 4 ? '' : 'disabled'}>⚡ Blitzrunde</button>
    </div>
    <div class="section-title">Generationen</div>
    <div class="gens">
      ${GENS.map(g => {
        const l = learnedIn(g.mons).length, d = dueIn(g.mons).length;
        return `<button class="gen-card" data-gen="${g.n}">
          ${d ? `<span class="due">${d} fällig</span>` : ''}
          <div class="head"><img src="${img(g.start)}" alt="" loading="lazy"><div><h3>Gen ${g.n}</h3><div class="muted small">${g.region} · ${g.mons.length}</div></div></div>
          <div class="progress"><i style="width:${l / g.mons.length * 100}%"></i></div>
          <div class="muted small">${l} gelernt · ${masteredIn(g.mons).length} gemeistert</div>
        </button>`;
      }).join('')}
    </div>
    <div class="info small muted" style="margin-top:20px">
      Gesamt: <b>${learned}</b> / ${P.length} gelernt.
      <a href="#" id="about-link" style="color:var(--blue)">Wie funktioniert das Lernen?</a>
    </div>
  </main>${nav('home')}`;
  app.querySelectorAll('[data-gen]').forEach(b => b.onclick = () => go('gen', { gen: +b.dataset.gen }));
  $('#q-review').onclick = () => startSession({ type: 'review', pool: P, back: 'home' });
  $('#q-blitz').onclick = () => startSession({ type: 'blitz', pool: P, back: 'home' });
  $('#about-link').onclick = e => { e.preventDefault(); go('about', { back: 'home' }); };
}

// ---------------------------------------------------------------------------
// Generationsseite mit Lernpfad
// ---------------------------------------------------------------------------
function renderGen() {
  const g = GENS[route.gen - 1];
  const l = learnedIn(g.mons).length, d = dueIn(g.mons).length;
  const currentIdx = g.nodes.findIndex(nd => S.done[nd.key] === undefined);
  const offsets = [0, 50, 75, 50, 0, -50, -75, -50];
  app.innerHTML = `${topbar(true)}
  <main>
    <div class="gen-header">
      <div class="small" style="opacity:.9;font-weight:800;text-transform:uppercase">Generation ${g.n}</div>
      <h2>${g.region} · #${g.mons[0].id}–#${g.mons[g.mons.length - 1].id}</h2>
      <div class="progress"><i style="width:${l / g.mons.length * 100}%"></i></div>
      <div class="small" style="margin-top:6px">${l}/${g.mons.length} gelernt · ${masteredIn(g.mons).length} gemeistert</div>
    </div>
    <div class="modes">
      <button class="mode" id="m-review" ${d ? '' : 'disabled'}><span class="ic">🔁</span><div><b>Wiederholen</b><span>${d} fällig</span></div></button>
      <button class="mode" id="m-weak" ${l >= 4 ? '' : 'disabled'}><span class="ic">🎯</span><div><b>Schwächen</b><span>häufigste Fehler</span></div></button>
      <button class="mode" id="m-blitz" ${l >= 4 ? '' : 'disabled'}><span class="ic">⚡</span><div><b>Blitzrunde</b><span>60 Sek. Silhouetten</span></div></button>
      <button class="mode" id="m-exam" ${l >= 10 ? '' : 'disabled'}><span class="ic">🏆</span><div><b>Meisterprüfung</b><span>alle gelernten tippen</span></div></button>
    </div>
    <div class="path">
      ${g.nodes.map((nd, i) => {
        const unlocked = nodeUnlocked(g, i);
        const done = S.done[nd.key] !== undefined;
        const cur = i === currentIdx && unlocked;
        const cls = ['node', nd.kind === 'check' ? 'check' : '', done ? 'done' : '', unlocked ? '' : 'locked', cur ? 'current' : ''].join(' ');
        const inner = nd.kind === 'check' ? (nd.final ? '🏆' : '⭐') : `<img src="${img(nd.ids[0])}" alt="" loading="lazy">`;
        return `<div class="node-wrap" style="transform:translateX(${offsets[i % offsets.length]}px)">
          ${cur ? '<div class="start-bubble">Start</div>' : ''}
          <button class="${cls}" data-node="${i}" aria-label="${esc(nd.label)}">${inner}</button>
          <div class="node-label">${nd.kind === 'check' ? nd.label : esc(nd.label)}${done ? ` · ${Math.round(S.done[nd.key] * 100)}%` : ''}</div>
        </div>`;
      }).join('')}
    </div>
  </main>${nav('home')}`;
  route.back = 'home';
  const back = { back: 'gen', backParams: { gen: g.n } };
  app.querySelectorAll('[data-node]').forEach(b => b.onclick = () => {
    const i = +b.dataset.node, nd = g.nodes[i];
    if (!nodeUnlocked(g, i)) {
      if (confirm('Diese Lektion ist noch gesperrt. Willst du direkt einen Test machen, um sie freizuschalten?')) {
        startSession({ type: 'check', node: nd, pool: nd.ids.map(id => BY_ID.get(id)), gen: g, skipTest: true, ...back });
      }
      return;
    }
    startSession({ type: nd.kind, node: nd, pool: nd.ids.map(id => BY_ID.get(id)), gen: g, ...back });
  });
  const cur = app.querySelector('.node.current');
  if (cur && currentIdx > 2) setTimeout(() => cur.scrollIntoView({ block: 'center' }), 0);
  $('#m-review').onclick = () => startSession({ type: 'review', pool: g.mons, gen: g, ...back });
  $('#m-weak').onclick = () => startSession({ type: 'weak', pool: g.mons, gen: g, ...back });
  $('#m-blitz').onclick = () => startSession({ type: 'blitz', pool: g.mons, gen: g, ...back });
  $('#m-exam').onclick = () => startSession({ type: 'exam', pool: g.mons, gen: g, ...back });
}

// ---------------------------------------------------------------------------
// Lern-Session (Lektion, Checkpoint, Wiederholung, Blitz, Prüfung)
// ---------------------------------------------------------------------------
let session = null;

/* Übungstypen, sortiert nach Schwierigkeit (Wiedererkennen -> aktives Abrufen):
 * intro        neues Pokémon vorstellen (Bild + Name + Typ + Aussprache)
 * img2name     Bild -> Name wählen (Multiple Choice)
 * name2img     Name -> Bild wählen
 * translate    deutscher <-> englischer Name (nur bei "beide Sprachen")
 * type2        Welchen Typ hat ...?
 * tiles        Name aus Buchstaben-Kacheln bauen
 * sil          Silhouette -> Name wählen ("Wer ist das Pokémon?")
 * typein       Bild -> Name tippen (freies Abrufen)
 * siltype      Silhouette -> Name tippen (schwerstes)
 */
function easyEx() { return pick(['img2name', 'img2name', 'name2img']); }
function midEx() {
  const opts = ['tiles', 'sil', 'name2img'];
  if (S.settings.lang === 'both') opts.push('translate');
  return pick(opts);
}
function hardEx() { return S.settings.typing ? pick(['typein', 'typein', 'siltype']) : pick(['tiles', 'sil']); }
function exForBox(box) {
  if (box <= 1) return Math.random() < .5 ? easyEx() : midEx();
  if (box <= 3) return Math.random() < .6 ? midEx() : hardEx();
  return hardEx();
}

function startSession(cfg) {
  const { type, pool } = cfg;
  let queue = [];
  const q = (p, ex) => ({ p, ex, lang: askLang() });

  if (type === 'lesson') {
    // 1) Vorstellen + sofort leicht abfragen (je Pokémon), 2) gemischt mittel, 3) gemischt schwer
    const mons = pool;
    mons.forEach((p, i) => {
      queue.push(q(p, 'intro'));
      queue.push(q(p, 'img2name'));
      // nach jedem zweiten neuen Pokémon kurz die beiden vorherigen abfragen (Interleaving)
      if (i % 2 === 1) queue.push(q(mons[i - 1], 'name2img'));
    });
    shuffle(mons).forEach(p => queue.push(q(p, midEx())));
    if (mons.some(p => p.types.length)) queue.push(q(pick(mons), 'type2'));
    shuffle(mons).forEach(p => queue.push(q(p, hardEx())));
  } else if (type === 'check') {
    shuffle(pool).forEach(p => queue.push(q(p, cfg.skipTest ? hardEx() : pick([midEx(), hardEx(), hardEx()]))));
  } else if (type === 'review') {
    const due = shuffle(dueIn(pool)).sort((a, b) => S.cards[a.id].box - S.cards[b.id].box).slice(0, 15);
    shuffle(due).forEach(p => queue.push(q(p, exForBox(S.cards[p.id].box))));
  } else if (type === 'weak') {
    const rate = p => { const c = S.cards[p.id]; return (c.wrong + 1) / (c.right + c.wrong + 2) + (MAX_BOX - c.box) * 0.05; };
    const weak = learnedIn(pool).sort((a, b) => rate(b) - rate(a)).slice(0, 10);
    shuffle(weak).forEach(p => queue.push(q(p, midEx())));
    shuffle(weak).forEach(p => queue.push(q(p, hardEx())));
  } else if (type === 'exam') {
    shuffle(learnedIn(pool)).forEach(p => queue.push(q(p, S.settings.typing ? 'typein' : 'tiles')));
  } else if (type === 'blitz') {
    const l = learnedIn(pool);
    for (let i = 0; i < 200; i++) queue.push(q(pick(l), 'sil'));
  }

  session = {
    cfg, queue, i: 0, total: queue.filter(x => x.ex !== 'intro').length,
    correct: 0, wrong: 0, combo: 0, maxCombo: 0, mistakes: new Set(), retries: 0,
    firstTry: new Map(), // id -> erster Versuch richtig?
    startedAt: Date.now(),
    blitzEnd: type === 'blitz' ? Date.now() + 60000 : 0,
    // Distraktoren: in Lektionen aus der ganzen Gen, sonst aus dem Pool
    // Lektion: Ablenker aus der Lektion + schon Gelerntem (Unterscheiden üben), sonst aus der Gen
    distractorPool: type === 'lesson'
      ? [...new Set([...pool, ...learnedIn(cfg.gen.mons)])]
      : cfg.gen ? cfg.gen.mons : (learnedIn(pool).length >= 8 ? learnedIn(pool) : pool),
  };
  if (!queue.length) { alert('Hier gibt es gerade nichts zu üben.'); return; }
  go('lesson', { back: cfg.back, backParams: cfg.backParams });
}

function renderLesson() {
  const s = session;
  if (!s) return go('home');
  if (s.i >= s.queue.length || (s.blitzEnd && Date.now() >= s.blitzEnd)) return finishSession();
  const item = s.queue[s.i];
  const { p } = item;
  // Übersetzen ist sinnlos, wenn beide Namen gleich sind (z. B. Natu)
  const ex = item.ex === 'translate' && normalize(p.de) === normalize(p.en) ? 'tiles' : item.ex;
  const lang = item.lang;
  const other = lang === 'de' ? 'en' : 'de';
  const answered = s.queue.slice(0, s.i).filter(x => x.ex !== 'intro' && !x.retry).length;
  const pct = s.cfg.type === 'blitz'
    ? 100 - Math.max(0, (s.blitzEnd - Date.now()) / 600)
    : answered / s.total * 100;

  let body = '', footer = '';
  let correctAnswer = p[lang];
  let check = null; // () => {ok, typo}

  const stage = (sil = false) => `<div class="poke-stage"><img id="poke-img" class="${sil ? 'sil' : ''}" src="${img(p.id)}" alt=""></div>`;
  const prompt = (t, sub) => `<div class="prompt">${sub ? `<small>${sub}</small>` : ''}${t}</div>`;

  if (ex === 'intro') {
    const note = S.notes[p.id] || '';
    body = `<span class="badge-new">✨ Neues Pokémon</span>
      <div class="intro-card">
        <div class="dex">#${String(p.id).padStart(4, '0')}</div>
        ${stage()}
        <div class="big-name">${esc(p[S.settings.lang === 'en' ? 'en' : 'de'])} <button class="speak" id="speak">🔊</button></div>
        <div class="en"><span class="flag">${S.settings.lang === 'en' ? 'DE' : 'EN'}</span>${esc(p[S.settings.lang === 'en' ? 'de' : 'en'])}</div>
        ${typeBadges(p.types)}
        ${introHint(p)}
        <div class="mnemo"><label for="note">💡 Deine Eselsbrücke (optional)</label>
          <textarea id="note" rows="1" placeholder="z. B. Bisa-SAMEN: Pflanze mit Samen auf dem Rücken">${esc(note)}</textarea></div>
      </div>`;
    footer = `<div class="footer"><div class="footer-inner"><button class="btn" id="next">Weiter</button></div></div>`;
  } else if (ex === 'img2name' || ex === 'sil') {
    const opts = shuffle([p, ...distractors(p, 3, s.distractorPool, lang)]);
    body = prompt(ex === 'sil' ? 'Wer ist das Pokémon?' : 'Wie heißt dieses Pokémon?', LANG_LABEL[lang]) + stage(ex === 'sil') +
      `<div class="options grid2">${opts.map((o, k) => `<button class="opt" data-id="${o.id}"><span class="key">${k + 1}</span>${esc(o[lang])}</button>`).join('')}</div>`;
    check = () => { const sel = $('.opt.sel'); return { ok: sel && +sel.dataset.id === p.id }; };
  } else if (ex === 'name2img') {
    const opts = shuffle([p, ...distractors(p, 3, s.distractorPool, lang)]);
    body = prompt(`Welches ist <span style="color:var(--blue)">${esc(p[lang])}</span>?`, LANG_LABEL[lang]) +
      `<div class="options grid2">${opts.map((o, k) => `<button class="opt" data-id="${o.id}"><span class="key">${k + 1}</span><img src="${img(o.id)}" alt="Option ${k + 1}"></button>`).join('')}</div>`;
    check = () => { const sel = $('.opt.sel'); return { ok: sel && +sel.dataset.id === p.id }; };
  } else if (ex === 'translate') {
    const opts = shuffle([p, ...distractors(p, 3, s.distractorPool, other)]);
    correctAnswer = p[other];
    body = prompt(`Wie heißt <span style="color:var(--blue)">${esc(p[lang])}</span> auf ${other === 'de' ? 'Deutsch' : 'Englisch'}?`, 'Übersetzen') + stage() +
      `<div class="options grid2">${opts.map((o, k) => `<button class="opt" data-id="${o.id}"><span class="key">${k + 1}</span>${esc(o[other])}</button>`).join('')}</div>`;
    check = () => { const sel = $('.opt.sel'); return { ok: sel && +sel.dataset.id === p.id }; };
  } else if (ex === 'type2') {
    const key = t => t.join(' / ');
    const right = key(p.types);
    const pool = [...new Set(P.filter(x => x.gen === p.gen).map(x => key(x.types)))].filter(k => k !== right);
    const opts = shuffle([right, ...shuffle(pool).slice(0, 3)]);
    correctAnswer = right;
    body = prompt(`Welchen Typ hat <span style="color:var(--blue)">${esc(p[lang])}</span>?`, 'Typen-Quiz') + stage() +
      `<div class="options">${opts.map((o, k) => `<button class="opt" data-val="${esc(o)}"><span class="key">${k + 1}</span>${typeBadges(o.split(' / '))}</button>`).join('')}</div>`;
    check = () => { const sel = $('.opt.sel'); return { ok: sel && sel.dataset.val === right }; };
  } else if (ex === 'tiles') {
    const name = p[lang];
    const letters = [...name.toUpperCase()].filter(ch => ch !== ' ');
    const abc = 'ABCDEFGHIKLMNOPRSTUWZ';
    const decoys = Array.from({ length: Math.min(4, Math.max(2, 14 - letters.length)) }, () => pick([...abc]));
    const tiles = shuffle([...letters, ...decoys]);
    body = prompt('Baue den Namen zusammen', LANG_LABEL[lang]) + stage() +
      `<div class="tiles-answer" id="tiles-answer"></div>
       <div class="tiles" id="tiles">${tiles.map((t, k) => `<button class="tile" data-k="${k}">${esc(t)}</button>`).join('')}</div>`;
    check = () => {
      const built = [...app.querySelectorAll('#tiles-answer .tile')].map(t => t.textContent).join('');
      return { ok: normalize(built) === normalize(name) };
    };
  } else if (ex === 'typein' || ex === 'siltype') {
    body = prompt(ex === 'siltype' ? 'Wer ist das Pokémon? Tippe den Namen.' : 'Schreibe den Namen', LANG_LABEL[lang]) + stage(ex === 'siltype') +
      `<input class="answer-input" id="answer" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="${lang === 'de' ? 'Name auf Deutsch' : 'Name auf Englisch'}…">
       <button class="btn ghost small" id="hint" style="align-self:flex-start">💡 Tipp</button>
       <div id="hint-out"></div>`;
    check = () => {
      const r = checkTyped($('#answer').value, p[lang]);
      return { ok: r !== 'wrong', typo: r === 'typo', given: $('#answer').value };
    };
  }

  if (!footer) {
    footer = `<div class="footer" id="footer"><div class="footer-inner">
      <div id="fb"></div>
      <div class="fb-row">
        ${s.cfg.type !== 'blitz' ? `<button class="btn ghost skip" id="skip">Weiß nicht</button>` : ''}
        <button class="btn" id="check" disabled ${s.cfg.type === 'blitz' ? 'hidden' : ''}>Überprüfen</button>
      </div></div></div>`;
  }

  app.innerHTML = `<div class="lesson">
    <div class="lesson-top">
      <button class="iconbtn" id="quit" aria-label="Beenden">✕</button>
      <div class="progress"><i style="width:${Math.max(2, pct)}%"></i></div>
      ${s.cfg.type === 'blitz' ? `<div class="timer" id="timer">${Math.ceil((s.blitzEnd - Date.now()) / 1000)}</div>` : `<div class="combo">${s.combo >= 3 ? `🔥${s.combo}` : ''}</div>`}
    </div>
    <div class="lesson-body" id="lb">${body}</div>
    ${footer}
  </div>`;

  $('#quit').onclick = () => {
    if (s.cfg.type === 'blitz' || confirm('Lektion wirklich beenden? Dein Fortschritt in dieser Lektion geht verloren.')) { clearInterval(s.timerId); go(s.cfg.back || 'home', s.cfg.backParams || {}); }
  };

  if (s.cfg.type === 'blitz') {
    clearInterval(s.timerId);
    s.timerId = setInterval(() => {
      const left = Math.ceil((s.blitzEnd - Date.now()) / 1000);
      const t = $('#timer'); if (t) t.textContent = Math.max(0, left);
      if (left <= 0) { clearInterval(s.timerId); finishSession(); }
    }, 250);
  }

  // ---- Intro ----
  if (ex === 'intro') {
    const say = () => speak(p[S.settings.lang === 'en' ? 'en' : 'de'], S.settings.lang === 'en' ? 'en' : 'de');
    $('#speak').onclick = say;
    setTimeout(say, 250);
    const next = () => {
      const v = $('#note').value.trim();
      if (v) S.notes[p.id] = v; else delete S.notes[p.id];
      save(); s.i++; render();
    };
    $('#next').onclick = next;
    keyHandler = e => { if (e.key === 'Enter' && document.activeElement?.id !== 'note') { e.preventDefault(); next(); } };
    return;
  }

  const checkBtn = $('#check');
  let answeredNow = false;

  // ---- Interaktion ----
  const opts = [...app.querySelectorAll('.opt')];
  opts.forEach(o => o.onclick = () => {
    if (answeredNow) return;
    opts.forEach(x => x.classList.remove('sel'));
    o.classList.add('sel'); checkBtn.disabled = false;
    if (s.cfg.type === 'blitz') submit();
  });
  if (ex === 'tiles') {
    const ans = $('#tiles-answer');
    app.querySelectorAll('#tiles .tile').forEach(t => t.onclick = () => {
      if (answeredNow || t.classList.contains('used')) return;
      t.classList.add('used');
      const c = document.createElement('button');
      c.className = 'tile'; c.textContent = t.textContent; c.dataset.src = t.dataset.k;
      c.onclick = () => { if (answeredNow) return; c.remove(); t.classList.remove('used'); checkBtn.disabled = !ans.children.length; };
      ans.appendChild(c); checkBtn.disabled = false;
    });
  }
  if (ex === 'typein' || ex === 'siltype') {
    const inp = $('#answer');
    setTimeout(() => inp.focus(), 50);
    inp.oninput = () => { checkBtn.disabled = !inp.value.trim(); };
    let hints = 0;
    $('#hint').onclick = () => {
      hints++; s.usedHint = true;
      const name = p[lang];
      const shown = hints === 1 ? `${name.length} Buchstaben, beginnt mit „${name[0]}“` : `${name.slice(0, Math.ceil(name.length / 2))}…`;
      $('#hint-out').innerHTML = `<div class="hint-box">${esc(shown)}${hints === 1 && ex === 'siltype' ? '' : ''}</div>`;
      if (hints === 1 && ex === 'siltype') $('#poke-img').classList.remove('sil');
      if (hints >= 2) $('#hint').disabled = true;
      inp.focus();
    };
  }

  function submit(skipped = false) {
    if (answeredNow) return;
    answeredNow = true;
    const r = skipped ? { ok: false } : check();
    const ok = !!r.ok;
    const first = !s.firstTry.has(p.id);
    if (first) s.firstTry.set(p.id, ok);

    // Markieren
    if (opts.length) {
      opts.forEach(o => {
        o.disabled = true;
        const isRight = o.dataset.id ? +o.dataset.id === p.id : o.dataset.val === correctAnswer;
        if (isRight) o.classList.add('right');
        else if (o.classList.contains('sel')) o.classList.add('wrong');
      });
    }
    const pi = $('#poke-img'); if (pi) pi.classList.remove('sil');
    const inp = $('#answer'); if (inp) inp.disabled = true;

    // Wertung + SRS (Lektion: erst am Ende; sonst sofort beim ersten Versuch)
    if (!item.retry) { if (ok) s.correct++; else s.wrong++; }
    if (ok) { s.combo++; s.maxCombo = Math.max(s.maxCombo, s.combo); }
    else { s.combo = 0; s.mistakes.add(p.id); }
    if (s.cfg.type !== 'lesson' && !item.retry && !s.cfg.skipTest) grade(p.id, ok && !s.usedHint);
    s.usedHint = false;

    // Falsch? -> später nochmal (wie bei Duolingo), nicht im Blitz
    if (!ok && s.cfg.type !== 'blitz') {
      const at = Math.min(s.queue.length, s.i + 3 + (Math.random() * 3 | 0));
      s.queue.splice(at, 0, { p, ex: ex === 'typein' || ex === 'siltype' ? 'tiles' : (ex === 'name2img' ? 'img2name' : ex), lang, retry: true });
      s.retries++;
    }

    beep(ok);
    if (ok && ex !== 'type2') speak(correctAnswer, ex === 'translate' ? other : lang);

    if (s.cfg.type === 'blitz') {
      $('#lb').classList.toggle('shake', !ok);
      setTimeout(() => { s.i++; render(); }, ok ? 350 : 900);
      return;
    }

    const footerEl = $('#footer');
    footerEl.className = 'footer ' + (ok ? 'ok' : 'bad');
    const praise = pick(['Super!', 'Richtig!', 'Klasse!', 'Stark!', 'Genau!', 'Volltreffer!']);
    const info = `<div class="fb-text small">#${p.id} · ${esc(p.de)} / ${esc(p.en)}</div>`;
    let html;
    if (ok && r.typo) html = `<div class="fb-title">✔ Fast perfekt!</div><div class="fb-text">Achte auf die Schreibweise: <b>${esc(correctAnswer)}</b></div>`;
    else if (ok) html = `<div class="fb-title">✔ ${praise}</div>${info}`;
    else html = `<div class="fb-title">✖ ${skipped ? 'Kein Problem' : 'Leider falsch'}</div><div class="fb-text">Richtig: <b>${esc(correctAnswer)}</b>${r.given ? ` <span class="small">(du: ${esc(r.given)})</span>` : ''}</div>${info}${S.notes[p.id] ? `<div class="fb-text small">💡 ${esc(S.notes[p.id])}</div>` : ''}`;
    $('#fb').innerHTML = html;
    $('.fb-row').innerHTML = `<button class="btn ${ok ? '' : 'red'}" id="cont">Weiter</button>`;
    const cont = () => { s.i++; render(); };
    $('#cont').onclick = cont;
    setTimeout(() => $('#cont')?.focus(), 30);
  }

  checkBtn && (checkBtn.onclick = () => submit());
  const skip = $('#skip'); if (skip) skip.onclick = () => submit(true);

  keyHandler = e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (answeredNow) { const c = $('#cont'); if (c) c.click(); }
      else if (!checkBtn.disabled) submit();
      return;
    }
    if (!answeredNow && opts.length && /^[1-4]$/.test(e.key) && document.activeElement?.tagName !== 'INPUT') {
      opts[+e.key - 1]?.click();
    }
    if (!answeredNow && ex === 'tiles' && document.activeElement?.tagName !== 'INPUT') {
      if (e.key === 'Backspace') { const last = $('#tiles-answer').lastElementChild; if (last) last.click(); return; }
      if (e.key.length === 1) {
        const t = [...app.querySelectorAll('#tiles .tile:not(.used)')].find(x => x.textContent === e.key.toUpperCase());
        if (t) t.click();
      }
    }
  };
}

function introHint(p) {
  // Kleine Gedächtnisstütze: deutsch/englisch ähnlich? Dann hervorheben (Kognaten).
  const a = normalize(p.de), b = normalize(p.en);
  if (a === b) return `<div class="hint-box">🌍 Heißt auf Deutsch und Englisch gleich!</div>`;
  if (lev(a, b) <= Math.max(2, Math.floor(b.length / 4))) return `<div class="hint-box">🌍 Deutscher und englischer Name sind fast gleich.</div>`;
  return '';
}

function finishSession() {
  const s = session; if (!s) return go('home');
  clearInterval(s.timerId);
  const type = s.cfg.type;
  const answered = s.correct + s.wrong;
  const acc = answered ? s.correct / answered : 0;
  let xp = 0;

  if (type === 'lesson') {
    // Alle Pokémon der Lektion ins SRS aufnehmen; erster Versuch bestimmt Start-Box
    s.cfg.pool.forEach(p => {
      if (!S.cards[p.id]) S.cards[p.id] = { box: 0, due: 0, right: 0, wrong: 0 };
      grade(p.id, s.firstTry.get(p.id) !== false);
    });
    xp = 10 + s.correct + (s.wrong === 0 ? 5 : 0);
    S.done[s.cfg.node.key] = Math.max(S.done[s.cfg.node.key] || 0, acc);
  } else if (type === 'check') {
    const passed = acc >= 0.8;
    if (passed) {
      S.done[s.cfg.node.key] = Math.max(S.done[s.cfg.node.key] || 0, acc);
      if (s.cfg.skipTest) {
        // Übersprungene Lektionen bis zu diesem Knoten als erledigt markieren
        const g = s.cfg.gen, idx = g.nodes.indexOf(s.cfg.node);
        g.nodes.slice(0, idx).forEach(nd => { if (S.done[nd.key] === undefined) S.done[nd.key] = acc; });
        s.cfg.pool.forEach(p => { if (!S.cards[p.id]) S.cards[p.id] = { box: 0, due: 0, right: 0, wrong: 0 }; grade(p.id, s.firstTry.get(p.id) !== false); });
      }
    }
    xp = passed ? 20 + s.correct : 5;
    s.passed = passed;
  } else if (type === 'blitz') {
    xp = s.correct * 2;
    s.newBest = s.correct > (S.best.blitz || 0);
    if (s.newBest) S.best.blitz = s.correct;
  } else {
    xp = 5 + s.correct;
  }
  addXp(xp);
  save();
  session = null;
  route = { name: 'result', s, xp, acc, back: s.cfg.back, backParams: s.cfg.backParams };
  render();
}

function renderResult() {
  const { s, xp, acc } = route;
  const type = s.cfg.type;
  const mins = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
  let title = 'Lektion geschafft!', emoji = '🎉';
  if (type === 'check') { title = s.passed ? (s.cfg.node.final ? 'Generation abgeschlossen!' : 'Checkpoint bestanden!') : 'Fast! Mindestens 80 % nötig.'; emoji = s.passed ? '🏆' : '💪'; }
  if (type === 'review') title = 'Wiederholung erledigt!';
  if (type === 'weak') title = 'Schwächen trainiert!';
  if (type === 'exam') { title = `Meisterprüfung: ${Math.round(acc * 100)} %`; emoji = acc >= .9 ? '🥇' : acc >= .7 ? '🥈' : '🥉'; }
  if (type === 'blitz') { title = s.newBest ? 'Neuer Rekord!' : 'Zeit ist um!'; emoji = '⚡'; }
  const mistakes = [...s.mistakes].map(id => BY_ID.get(id));

  app.innerHTML = `<div class="result">
    <div class="confetti">${emoji}</div>
    <h1>${title}</h1>
    <div class="boxes">
      <div class="box"><b>XP</b><span>⚡ ${xp}</span></div>
      <div class="box g"><b>${type === 'blitz' ? 'Treffer' : 'Genauigkeit'}</b><span>${type === 'blitz' ? s.correct : Math.round(acc * 100) + ' %'}</span></div>
      <div class="box b"><b>${type === 'blitz' ? 'Rekord' : 'Beste Serie'}</b><span>${type === 'blitz' ? S.best.blitz : '🔥 ' + s.maxCombo}</span></div>
    </div>
    ${mistakes.length ? `<div class="mistakes"><div class="muted small" style="font-weight:800;margin-bottom:6px">NOCHMAL ANSCHAUEN</div>
      <div class="chips">${mistakes.map(p => `<span class="chip"><img src="${img(p.id)}" alt="">${esc(p.de)} · ${esc(p.en)}</span>`).join('')}</div></div>` : ''}
    <div class="muted small">${type === 'blitz' ? '60 Sekunden' : `ca. ${mins} Min.`} · Tagesziel ${Math.min(S.today.xp, S.settings.goal)}/${S.settings.goal} XP</div>
  </div>
  <div class="footer"><div class="footer-inner">
    ${type === 'check' && !s.passed ? `<button class="btn ghost" id="retry">Nochmal versuchen</button>` : ''}
    <button class="btn" id="done">Weiter</button>
  </div></div>`;
  const done = () => go(route.back || 'home', route.backParams || {});
  $('#done').onclick = done;
  const r = $('#retry'); if (r) r.onclick = () => startSession(s.cfg);
  keyHandler = e => { if (e.key === 'Enter') { e.preventDefault(); done(); } };
}

// ---------------------------------------------------------------------------
// Pokédex
// ---------------------------------------------------------------------------
let dexState = { q: '', gen: '0', show: 'all' };
function renderDex() {
  app.innerHTML = `${topbar(false)}
  <main>
    <div class="dex-filters">
      <input id="dq" type="search" placeholder="Suchen (DE/EN/Nr.)" value="${esc(dexState.q)}">
      <select id="dg"><option value="0">Alle Gens</option>${GENS.map(g => `<option value="${g.n}" ${dexState.gen == g.n ? 'selected' : ''}>Gen ${g.n} · ${g.region}</option>`).join('')}</select>
      <select id="ds">
        <option value="all" ${dexState.show === 'all' ? 'selected' : ''}>Alle</option>
        <option value="learned" ${dexState.show === 'learned' ? 'selected' : ''}>Gelernt</option>
        <option value="due" ${dexState.show === 'due' ? 'selected' : ''}>Fällig</option>
        <option value="hidden" ${dexState.show === 'hidden' ? 'selected' : ''}>Unbekannt</option>
      </select>
    </div>
    <div class="dex-list" id="dl"></div>
  </main>${nav('dex')}`;
  const draw = () => {
    const q = normalize(dexState.q);
    let list = P;
    if (dexState.gen !== '0') list = list.filter(p => p.gen == dexState.gen);
    if (dexState.show === 'learned') list = list.filter(p => S.cards[p.id]);
    if (dexState.show === 'due') list = list.filter(p => isDue(p.id));
    if (dexState.show === 'hidden') list = list.filter(p => !S.cards[p.id]);
    if (q) list = list.filter(p => normalize(p.de).includes(q) || normalize(p.en).includes(q) || String(p.id) === q);
    $('#dl').innerHTML = list.slice(0, 400).map(p => {
      const c = S.cards[p.id];
      return `<div class="dex-item ${c ? '' : 'unknown'}" title="${esc(S.notes[p.id] || '')}">
        ${c ? `<span class="lvl l${c.box}">Lv ${c.box}</span>` : ''}
        <img src="${img(p.id)}" alt="" loading="lazy">
        <div class="n">#${String(p.id).padStart(4, '0')}</div>
        <div class="de">${esc(p.de)}</div><div class="en">${esc(p.en)}</div>
        ${typeBadges(p.types)}
        ${S.notes[p.id] ? `<div class="small muted" style="margin-top:4px">💡 ${esc(S.notes[p.id])}</div>` : ''}
      </div>`;
    }).join('') + (list.length > 400 ? `<div class="muted small">… ${list.length - 400} weitere, Filter nutzen</div>` : '') +
      (!list.length ? '<div class="muted">Nichts gefunden.</div>' : '');
  };
  $('#dq').oninput = e => { dexState.q = e.target.value; draw(); };
  $('#dg').onchange = e => { dexState.gen = e.target.value; draw(); };
  $('#ds').onchange = e => { dexState.show = e.target.value; draw(); };
  draw();
}

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------
function renderSettings() {
  const st = S.settings;
  const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-set="${key}" data-val="${v}" class="${String(st[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const sw = key => `<button class="switch ${st[key] ? 'on' : ''}" data-toggle="${key}" aria-label="${key}"></button>`;
  app.innerHTML = `${topbar(false)}
  <main>
    <div class="section-title" style="margin-top:0">Lernen</div>
    <div class="setting"><div><b>Abgefragte Sprache</b><span class="muted small">Welche Namen willst du lernen?</span></div>${seg('lang', [['de', 'DE'], ['en', 'EN'], ['both', 'Beide']])}</div>
    <div class="setting"><div><b>Namen tippen</b><span class="muted small">Freies Abrufen – am effektivsten, aber schwerer</span></div>${sw('typing')}</div>
    <div class="setting"><div><b>Tagesziel</b><span class="muted small">XP pro Tag</span></div>${seg('goal', [[20, '20'], [50, '50'], [100, '100'], [200, '200']])}</div>
    <div class="setting"><div><b>Alle Lektionen freischalten</b><span class="muted small">Pfad nicht der Reihe nach</span></div>${sw('unlockAll')}</div>
    <div class="section-title">App</div>
    <div class="setting"><div><b>Töne</b></div>${sw('sound')}</div>
    <div class="setting"><div><b>Namen vorlesen</b><span class="muted small">Aussprache per Sprachausgabe</span></div>${sw('tts')}</div>
    <div class="setting"><div><b>Design</b></div>${seg('theme', [['auto', 'Auto'], ['light', 'Hell'], ['dark', 'Dunkel']])}</div>
    <div class="section-title">Fortschritt</div>
    <div class="info">
      <b>${learnedIn(P).length}</b> gelernt · <b>${masteredIn(P).length}</b> gemeistert · <b>${S.xp}</b> XP · Rekord Blitzrunde: <b>${S.best.blitz}</b>
      <div class="quick" style="margin-top:12px">
        <button class="btn ghost small" id="export" style="width:100%">⬇ Sichern</button>
        <button class="btn ghost small" id="import" style="width:100%">⬆ Laden</button>
      </div>
      <input type="file" id="file" accept="application/json" hidden>
      <button class="btn red small" id="reset" style="width:100%;margin-top:10px">Fortschritt löschen</button>
      <p class="muted small">Dein Fortschritt wird nur in diesem Browser gespeichert. Mit „Sichern“ bekommst du eine Datei, die du auf einem anderen Gerät laden kannst.</p>
    </div>
    <div class="info small muted">
      <a href="#" id="about-link" style="color:var(--blue)">Lernmethode erklärt</a> ·
      Daten &amp; Bilder: <a href="https://www.pokewiki.de/Pok%C3%A9mon-Liste" target="_blank" rel="noopener" style="color:var(--blue)">PokéWiki</a>.
      Pokémon © Nintendo / Creatures / GAME FREAK. Privates Lernprojekt.
    </div>
  </main>${nav('settings')}`;
  app.querySelectorAll('[data-set]').forEach(b => b.onclick = () => {
    const k = b.dataset.set; let v = b.dataset.val; if (k === 'goal') v = +v;
    st[k] = v; save(); renderSettings();
  });
  app.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => { st[b.dataset.toggle] = !st[b.dataset.toggle]; save(); renderSettings(); });
  $('#export').onclick = () => {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pokelingo-${todayStr()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#import').onclick = () => $('#file').click();
  $('#file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d.cards || !d.settings) throw new Error('format');
      localStorage.setItem(STORE_KEY, JSON.stringify(d)); S = load(); alert('Fortschritt geladen!'); renderSettings();
    } catch (err) { alert('Diese Datei konnte nicht gelesen werden.'); }
  };
  $('#reset').onclick = () => { if (confirm('Wirklich ALLES löschen? Das kann nicht rückgängig gemacht werden.')) { S = defaults(); save(); go('home'); } };
  $('#about-link').onclick = e => { e.preventDefault(); go('about', { back: 'settings' }); };
}

function renderAbout() {
  app.innerHTML = `${topbar(true)}
  <main>
    <div class="section-title" style="margin-top:0">So lernst du mit Pokélingo</div>
    <div class="info"><h3>🧩 Kleine Häppchen (Chunking)</h3>Jede Lektion stellt nur ~6 neue Pokémon vor – in Dex-Reihenfolge, damit Entwicklungsreihen zusammen bleiben.</div>
    <div class="info"><h3>🧠 Aktives Abrufen</h3>Statt nur anzuschauen, musst du dich erinnern. Die Übungen werden schwerer: Bild erkennen → Buchstaben bauen → Silhouette → frei tippen.</div>
    <div class="info"><h3>📅 Verteilte Wiederholung</h3>Jedes Pokémon hat ein Level (Leitner-System). Richtig → Level hoch und es kommt erst nach ${INTERVALS.slice(1, 6).join(', ')} … Tagen wieder. Falsch → Level runter, es kommt bald wieder. So wiederholst du genau das, was du gerade vergisst.</div>
    <div class="info"><h3>🔀 Mischen (Interleaving)</h3>In Checkpoints und Wiederholungen werden Pokémon aus verschiedenen Lektionen gemischt. Als Ablenker kommen bewusst ähnliche Pokémon (gleicher Typ, gleicher Anfangsbuchstabe).</div>
    <div class="info"><h3>🖼️ Bild + Wort + Ton</h3>Bild, Name, Typ und Aussprache zusammen verankern den Namen mehrfach im Gedächtnis (Dual Coding).</div>
    <div class="info"><h3>💡 Eigene Eselsbrücken</h3>Viele deutsche Namen sind Wortspiele (Bisa-<i>sam</i> = Samen, Glu-<i>mand</i>-a = Glut + Salamander). Selbst ausgedachte Merksätze bleiben am besten hängen – schreib sie beim Vorstellen ins Feld.</div>
    <div class="info"><h3>🔥 Dranbleiben</h3>Tagesziel und Streak helfen, jeden Tag ein paar Minuten zu lernen – kurze tägliche Einheiten schlagen lange seltene.</div>
    <div class="info"><h3>Empfohlener Ablauf</h3><ul>
      <li>Zuerst immer fällige <b>Wiederholungen</b> machen.</li>
      <li>Dann 1–2 neue Lektionen.</li>
      <li>Nach einer Generation: <b>Meisterprüfung</b> und <b>Blitzrunde</b> für Tempo.</li>
    </ul></div>
  </main>`;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
