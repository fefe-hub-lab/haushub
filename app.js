/* =====================================================================
   HausHub – Zählerstände erfassen, auswerten und sichern
   Reine Offline-Web-App (PWA). Alle Daten liegen in IndexedDB auf dem Gerät.
   ===================================================================== */
'use strict';

const APP_VERSION = '1.0.0';
const BACKUP_FORMAT = 1;

/* ---------------------------------------------------------------------
   Hilfsfunktionen
   --------------------------------------------------------------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayNum = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const ymd = (y, m, d = 1) => Date.UTC(y, m - 1, d) / 864e5;
const fmtDate = s => { if (!s) return '–'; const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };
const fmtDateShort = s => { if (!s) return '–'; const [, m, d] = s.split('-'); return `${d}.${m}.`; };
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const curYear = () => new Date().getFullYear();

function nf(v, dec = 1) {
  if (v == null || !isFinite(v)) return '–';
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
}
function nfAuto(v) {
  if (v == null || !isFinite(v)) return '–';
  const a = Math.abs(v);
  return nf(v, a >= 100 ? 0 : a >= 10 ? 1 : 2);
}
const eur = v => (v == null || !isFinite(v)) ? '–' : new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v);
function pct(v) {
  if (v == null || !isFinite(v)) return '–';
  return (v > 0 ? '+' : '') + nf(v * 100, 0) + ' %';
}
/** Akzeptiert "12345,6", "12.345,6" und "12345.6" */
function parseNum(s) {
  if (s == null) return NaN;
  s = String(s).trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return Number(s);
}
const toInput = v => (v == null || !isFinite(v)) ? '' : String(v).replace('.', ',');
function agoText(days) {
  if (days == null) return '';
  if (days <= 0) return 'heute';
  if (days === 1) return 'gestern';
  return `vor ${days} Tagen`;
}

/* ---------------------------------------------------------------------
   Zählertypen
   --------------------------------------------------------------------- */
const TYPES = {
  strom:       { label: 'Strom (Bezug)',       icon: '⚡', unit: 'kWh', color: '#f59e0b', kind: 'verbrauch' },
  einspeisung: { label: 'Strom-Einspeisung',   icon: '🔌', unit: 'kWh', color: '#10b981', kind: 'ertrag' },
  pv:          { label: 'PV-Erzeugung',        icon: '☀️', unit: 'kWh', color: '#eab308', kind: 'erzeugung' },
  waermepumpe: { label: 'Wärmepumpe (Strom)',  icon: '♨️', unit: 'kWh', color: '#8b5cf6', kind: 'verbrauch' },
  wallbox:     { label: 'Wallbox / E-Auto',    icon: '🚗', unit: 'kWh', color: '#06b6d4', kind: 'verbrauch' },
  gas:         { label: 'Gas',                 icon: '🔥', unit: 'm³',  color: '#ef4444', kind: 'verbrauch' },
  wasser:      { label: 'Wasser (kalt)',       icon: '💧', unit: 'm³',  color: '#3b82f6', kind: 'verbrauch' },
  warmwasser:  { label: 'Warmwasser',          icon: '🚿', unit: 'm³',  color: '#f97316', kind: 'verbrauch' },
  garten:      { label: 'Gartenwasser',        icon: '🌱', unit: 'm³',  color: '#22c55e', kind: 'verbrauch' },
  waerme:      { label: 'Wärmemenge',          icon: '🌡️', unit: 'kWh', color: '#dc2626', kind: 'verbrauch' },
  sonstig:     { label: 'Sonstiges',           icon: '📟', unit: '',    color: '#64748b', kind: 'verbrauch' },
};
const typeOf = m => TYPES[m.type] || TYPES.sonstig;
const colorOf = m => typeOf(m).color;

/* ---------------------------------------------------------------------
   IndexedDB
   --------------------------------------------------------------------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('haushub', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('meters', { keyPath: 'id' });
        db.createObjectStore('readings', { keyPath: 'id' });
        db.createObjectStore('photos');   // key = reading.id, value = Blob
        db.createObjectStore('kv');       // Einstellungen
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  _req(store, mode, fn) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction(store, mode);
      const st = tx.objectStore(store);
      let result;
      const r = fn(st);
      if (r) r.onsuccess = () => { result = r.result; };
      tx.oncomplete = () => res(result);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  },
  all(store) { return this._req(store, 'readonly', s => s.getAll()); },
  keys(store) { return this._req(store, 'readonly', s => s.getAllKeys()); },
  get(store, key) { return this._req(store, 'readonly', s => s.get(key)); },
  put(store, val, key) { return this._req(store, 'readwrite', s => key === undefined ? s.put(val) : s.put(val, key)); },
  del(store, key) { return this._req(store, 'readwrite', s => s.delete(key)); },
  clear(store) { return this._req(store, 'readwrite', s => s.clear()); },
  putMany(store, items, keyFn) {
    return this._req(store, 'readwrite', s => { items.forEach(it => keyFn ? s.put(it.value, keyFn(it)) : s.put(it)); return null; });
  },
};

/* ---------------------------------------------------------------------
   Zustand
   --------------------------------------------------------------------- */
const DEFAULT_SETTINGS = { lastBackup: null, changes: 0, backupDays: 30, readDays: 31, remindDay: 1 };
const state = {
  meters: [],
  readings: [],
  settings: { ...DEFAULT_SETTINGS },
  view: 'home',
  params: {},
  form: null,
  detailYear: curYear(),
  statsYear: curYear(),
  persisted: null,
  installPrompt: null,
  depth: 0,
};

async function loadAll() {
  state.meters = (await DB.all('meters')) || [];
  state.readings = (await DB.all('readings')) || [];
  state.settings = { ...DEFAULT_SETTINGS, ...((await DB.get('kv', 'settings')) || {}) };
}
async function saveSettings() { await DB.put('kv', state.settings, 'settings'); }
async function bumpChanges() { state.settings.changes = (state.settings.changes || 0) + 1; await saveSettings(); }

const activeMeters = () => state.meters.filter(m => !m.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const archivedMeters = () => state.meters.filter(m => m.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const findMeter = id => state.meters.find(m => m.id === id);
const findReading = id => state.readings.find(r => r.id === id);

/* ---------------------------------------------------------------------
   Berechnungen
   --------------------------------------------------------------------- */
function sortReadings(rs) {
  return rs.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0));
}
const meterReadings = id => sortReadings(state.readings.filter(r => r.meterId === id));
/** Effektiver Zählerstand nach einer Ablesung (bei Zählertausch: Anfangsstand des neuen Zählers) */
const effValue = r => r.exchange ? r.newStart : r.value;

/** Kumulierte Reihe, bei der Zählerwechsel herausgerechnet sind */
function cumSeries(rs) {
  let off = 0;
  const pts = [];
  for (const r of rs) {
    pts.push({ d: dayNum(r.date), c: r.value + off, r });
    if (r.exchange) off += r.value - r.newStart;
  }
  return pts;
}
/** Linear interpolierter kumulierter Stand an Tag d (null außerhalb der Messdaten) */
function cumAt(pts, d) {
  if (!pts.length || d < pts[0].d || d > pts[pts.length - 1].d) return null;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].d <= d) {
      const p = pts[i], n = pts[i + 1];
      if (!n || p.d === d) return p.c;
      return p.c + (n.c - p.c) * (d - p.d) / (n.d - p.d);
    }
  }
  return null;
}
/** Verbrauch im Intervall [d0, d1) – auf vorhandene Messdaten begrenzt */
function consumption(pts, d0, d1) {
  if (pts.length < 2) return { v: null };
  const a = Math.max(d0, pts[0].d), b = Math.min(d1, pts[pts.length - 1].d);
  if (b <= a) return { v: null };
  return { v: cumAt(pts, b) - cumAt(pts, a), a, b, partial: a > d0 || b < d1, cover: (b - a) / (d1 - d0) };
}

function meterStats(m) {
  const rs = meterReadings(m.id);
  const pts = cumSeries(rs);
  const st = { rs, pts, last: rs[rs.length - 1] || null };
  if (!rs.length) return st;
  st.current = effValue(st.last);
  const lastD = pts[pts.length - 1].d, firstD = pts[0].d;
  st.daysSince = dayNum(todayStr()) - lastD;
  if (lastD - firstD >= 1) {
    const a = Math.max(firstD, lastD - 365);
    st.avgDay = (cumAt(pts, lastD) - cumAt(pts, a)) / (lastD - a);
  }
  const y = curYear(), y0 = ymd(y, 1), y1 = ymd(y + 1, 1);
  const ys = consumption(pts, y0, y1);
  st.yearSoFar = ys.v;
  if (st.avgDay != null) {
    const coveredDays = ys.v != null ? ys.b - ys.a : 0;
    st.projection = (ys.v || 0) + st.avgDay * ((y1 - y0) - coveredDays);
  }
  return st;
}
function yearConsumption(m, y, pts) {
  pts = pts || cumSeries(meterReadings(m.id));
  return consumption(pts, ymd(y, 1), ymd(y + 1, 1));
}
function monthlyValues(pts, y) {
  return MONTHS.map((_, i) => {
    const c = consumption(pts, ymd(y, i + 1), i === 11 ? ymd(y + 1, 1) : ymd(y, i + 2));
    return c.v == null ? null : { v: c.v, partial: c.partial };
  });
}
const hasTariff = m => (m.price > 0) || (m.baseFee > 0);
/** Kosten (bzw. Vergütung) für eine Menge; fraction = Anteil eines Jahres für den Grundpreis */
function costFor(m, amount, fraction = 1) {
  if (!hasTariff(m) || amount == null) return null;
  return amount * (m.factor > 0 ? m.factor : 1) * (m.price || 0) + (m.baseFee || 0) * 12 * fraction;
}
function readingYears() {
  let min = curYear();
  for (const r of state.readings) { const y = +r.date.slice(0, 4); if (y < min) min = y; }
  return { min, max: curYear() };
}
function nextMeterToRead(date) {
  const done = new Set(state.readings.filter(r => r.date === date).map(r => r.meterId));
  const m = activeMeters().find(m => !done.has(m.id));
  return m ? m.id : null;
}
function backupDue() {
  if (!state.readings.length && !state.meters.length) return null;
  const s = state.settings;
  if (!s.lastBackup) return { never: true };
  const days = Math.floor((Date.now() - new Date(s.lastBackup).getTime()) / 864e5);
  if (s.changes > 0 && days >= (s.backupDays || 30)) return { days, changes: s.changes };
  return null;
}

/* ---------------------------------------------------------------------
   Navigation (mit Android-Zurück-Taste)
   --------------------------------------------------------------------- */
const TAB_VIEWS = ['home', 'stats', 'add', 'meters', 'data'];
const TITLES = { home: 'HausHub', stats: 'Auswertung', add: 'Ablesen', meters: 'Zähler', data: 'Daten & Sicherung', detail: '' };

function go(view, params = {}, { replace = false } = {}) {
  state.view = view;
  state.params = params;
  if (view === 'add') state.form = null;
  state.depth = (history.state?.depth || 0) + (replace ? 0 : 1);
  const s = { view, params, depth: state.depth };
  if (replace) history.replaceState(s, ''); else history.pushState(s, '');
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', e => {
  if (modalOpen()) {           // Zurück-Taste schließt zuerst ein offenes Fenster
    closeModalNow();
    history.pushState({ view: state.view, params: state.params, depth: state.depth }, '');
    return;
  }
  const s = e.state || { view: 'home', params: {}, depth: 0 };
  state.depth = s.depth || 0;
  state.view = s.view;
  state.params = s.params || {};
  if (state.view === 'add') state.form = null;
  render();
});

function render() {
  const v = state.view;
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === v && !state.params.readingId));
  const isSub = v === 'detail' || (v === 'add' && state.params.readingId);
  $('#backBtn').classList.toggle('hidden', !isSub);
  $('#topActions').innerHTML = '';
  const main = $('#main');
  switch (v) {
    case 'home': renderHome(main); break;
    case 'detail': renderDetail(main); break;
    case 'add': renderAdd(main); break;
    case 'stats': renderStats(main); break;
    case 'meters': renderMeters(main); break;
    case 'data': renderData(main); break;
    default: renderHome(main);
  }
  if (v !== 'detail') $('#title').textContent = (v === 'add' && state.params.readingId) ? 'Ablesung bearbeiten' : TITLES[v];
}

/* ---------------------------------------------------------------------
   Ansicht: Übersicht
   --------------------------------------------------------------------- */
function backupBannerHtml() {
  const due = backupDue();
  if (!due) return '';
  const txt = due.never
    ? '<b>Noch keine Datensicherung</b>Deine Zählerstände liegen nur auf diesem Handy.'
    : `<b>Letzte Sicherung vor ${due.days} Tagen</b>${due.changes} Änderung${due.changes === 1 ? '' : 'en'} seitdem.`;
  return `<div class="banner"><span class="b-icon">💾</span><div class="b-text">${txt}</div>
    <button class="btn sm primary" data-act="backup">Sichern</button></div>`;
}
function installBannerHtml() {
  if (!state.installPrompt) return '';
  return `<div class="banner info"><span class="b-icon">📲</span><div class="b-text"><b>Als App installieren</b>HausHub auf den Startbildschirm legen.</div>
    <button class="btn sm primary" data-act="install">Installieren</button></div>`;
}
function bindCommonActions(root) {
  $$('[data-act="backup"]', root).forEach(b => b.onclick = () => shareBackup(true));
  $$('[data-act="install"]', root).forEach(b => b.onclick = doInstall);
}

function meterCardHtml(m) {
  const t = typeOf(m), st = meterStats(m);
  const dec = m.decimals ?? 1;
  const due = st.last && st.daysSince >= (state.settings.readDays || 31);
  const sub = [t.label !== m.name ? t.label : '', m.number ? `Nr. ${m.number}` : '', m.location].filter(Boolean).join(' · ');
  const y = curYear();
  return `<div class="card meter-card" data-id="${m.id}" style="--c:${t.color}">
    <div class="mc-head">
      <span class="mc-icon">${t.icon}</span>
      <div class="mc-title"><div class="mc-name">${esc(m.name)}</div><div class="mc-sub">${esc(sub)}</div></div>
      <button class="mc-add" data-add="${m.id}" aria-label="Ablesen">＋</button>
    </div>
    ${st.last ? `
      <div class="mc-value">${nf(st.current, dec)} <small>${esc(m.unit)}</small></div>
      <div class="mc-date">abgelesen am ${fmtDate(st.last.date)} · ${agoText(st.daysSince)} ${due ? '<span class="badge warn">Ablesung fällig</span>' : ''}</div>
      <div class="mc-stats">
        <div><label>${y} bisher</label><b>${nfAuto(st.yearSoFar)}</b></div>
        <div><label>Ø pro Tag</label><b>${nfAuto(st.avgDay)}</b></div>
        <div><label>Prognose ${y}</label><b>${st.projection != null ? '≈ ' + nfAuto(st.projection) : '–'}</b></div>
      </div>` : `<div class="mc-date" style="margin-top:12px">Noch keine Ablesung – tippe auf ＋</div>`}
  </div>`;
}

function renderHome(main) {
  const meters = activeMeters();
  if (!meters.length) {
    main.innerHTML = `${installBannerHtml()}
      <div class="card empty">
        <div class="e-icon">🏠</div>
        <h3>Willkommen bei HausHub</h3>
        <p>Lege zuerst deine Zähler an. Danach kannst du regelmäßig die Stände eintragen und siehst Verbrauch, Kosten und Prognosen.</p>
        ${templatesHtml()}
        <div style="margin-top:14px"><button class="btn ghost" data-act="restore">Ich habe schon ein Backup → wiederherstellen</button></div>
      </div>`;
    bindTemplates(main);
    bindCommonActions(main);
    $('[data-act="restore"]', main).onclick = pickImportFile;
    return;
  }
  const date = todayStr();
  const open = meters.filter(m => !state.readings.some(r => r.meterId === m.id && r.date === date)).length;
  main.innerHTML = `${backupBannerHtml()}${installBannerHtml()}
    <button class="btn primary block big" id="roundBtn" style="margin-bottom:14px">📝 ${open ? `Zähler ablesen (${open} offen heute)` : 'Alle Zähler für heute erfasst ✓'}</button>
    <div class="grid two">${meters.map(meterCardHtml).join('')}</div>`;
  bindCommonActions(main);
  $('#roundBtn').onclick = () => go('add');
  $$('.meter-card', main).forEach(c => c.onclick = e => {
    const add = e.target.closest('[data-add]');
    if (add) { e.stopPropagation(); go('add', { meterId: add.dataset.add }); return; }
    state.detailYear = curYear();
    go('detail', { id: c.dataset.id });
  });
}

/* ---------------------------------------------------------------------
   Ansicht: Zähler-Detail
   --------------------------------------------------------------------- */
function renderDetail(main) {
  const m = findMeter(state.params.id);
  if (!m) { go('home', {}, { replace: true }); return; }
  const t = typeOf(m), st = meterStats(m), dec = m.decimals ?? 1;
  $('#title').textContent = `${t.icon} ${m.name}`;
  $('#topActions').innerHTML = `<button class="icon-btn" id="editMeterBtn" aria-label="Zähler bearbeiten">✏️</button>`;
  $('#editMeterBtn').onclick = () => openMeterForm(m);

  const yrs = readingYears();
  const Y = Math.min(Math.max(state.detailYear, yrs.min), yrs.max);
  state.detailYear = Y;
  const cur = monthlyValues(st.pts, Y), prev = monthlyValues(st.pts, Y - 1);
  const yc = consumption(st.pts, ymd(Y, 1), ymd(Y + 1, 1));
  const yp = consumption(st.pts, ymd(Y - 1, 1), ymd(Y, 1));
  const isCur = Y === curYear();
  const compareBase = yp.v != null && yc.v != null && !yp.partial ? (isCur && st.projection != null ? st.projection : yc.v) : null;
  const change = compareBase != null && yp.v > 0 ? compareBase / yp.v - 1 : null;
  const isErtrag = t.kind === 'ertrag';
  const costLabel = isErtrag ? 'Vergütung' : 'Kosten';
  const costVal = isCur && st.projection != null ? costFor(m, st.projection, 1) : (yc.v != null ? costFor(m, yc.v, yc.cover ?? 1) : null);
  const factorTxt = m.factor > 0 && yc.v != null ? `<span class="small muted">≈ ${nf(yc.v * m.factor, 0)} kWh</span>` : '';

  // Jahrestabelle
  const yearRows = [];
  for (let y = yrs.max; y >= yrs.min; y--) {
    const c = consumption(st.pts, ymd(y, 1), ymd(y + 1, 1));
    if (c.v == null) continue;
    const cost = costFor(m, c.v, c.cover ?? 1);
    yearRows.push(`<tr><td>${y}${c.partial ? ' <span class="partial">(teilw.)</span>' : ''}</td>
      <td class="${c.partial ? 'partial' : ''}">${nf(c.v, 0)} ${esc(m.unit)}</td>
      <td>${nfAuto(c.v / (c.b - c.a))}</td>
      ${hasTariff(m) ? `<td>${eur(cost)}</td>` : ''}</tr>`);
  }

  // Ablesungen (neueste zuerst)
  const items = st.pts.map((p, i) => {
    const r = p.r, prevP = st.pts[i - 1];
    const delta = prevP ? p.c - prevP.c : null;
    const days = prevP ? p.d - prevP.d : null;
    return `<li class="click" data-rid="${r.id}">
      <div class="l-main">
        <div class="l-title">${nf(r.value, dec)} ${esc(m.unit)} ${r.hasPhoto ? '📷' : ''}</div>
        <div class="l-sub">${fmtDate(r.date)}${r.note ? ' · ' + esc(r.note) : ''}</div>
        ${r.exchange ? `<div class="l-sub"><span class="badge warn">Zählertausch</span> neuer Zähler ab ${nf(r.newStart, dec)}${r.newNumber ? ' · Nr. ' + esc(r.newNumber) : ''}</div>` : ''}
      </div>
      <div class="l-right">${delta != null ? `+${nfAuto(delta)}<div class="l-sub">${days > 0 ? nfAuto(delta / days) + '/Tag' : ''}</div>` : '<span class="l-sub">Start</span>'}</div>
    </li>`;
  }).reverse().join('');

  main.innerHTML = `
    <div class="card meter-card" style="--c:${t.color};cursor:default">
      <div class="mc-head"><span class="mc-icon">${t.icon}</span>
        <div class="mc-title"><div class="mc-name">${esc(m.name)}</div>
        <div class="mc-sub">${esc([t.label !== m.name ? t.label : '', m.number ? 'Nr. ' + m.number : '', m.location].filter(Boolean).join(' · '))}</div></div>
        <button class="mc-add" id="addHere" aria-label="Ablesen">＋</button></div>
      ${st.last ? `<div class="mc-value">${nf(st.current, dec)} <small>${esc(m.unit)}</small></div>
        <div class="mc-date">zuletzt am ${fmtDate(st.last.date)} · ${agoText(st.daysSince)}</div>` : '<p class="muted">Noch keine Ablesung.</p>'}
    </div>

    <div class="card">
      <div class="year-switch">
        <button id="yPrev" ${Y <= yrs.min ? 'disabled' : ''}>‹</button><b>${Y}</b><button id="yNext" ${Y >= yrs.max ? 'disabled' : ''}>›</button>
      </div>
      <div class="chart-wrap"><canvas id="chart"></canvas></div>
      <div class="legend"><span><i style="background:${t.color}"></i>${Y}</span><span><i style="background:${t.color};opacity:.35"></i>${Y - 1}</span><span class="muted">Monatsverbrauch in ${esc(m.unit)} (interpoliert)</span></div>
      <div class="kpis four" style="margin-top:14px">
        <div class="kpi"><label>${isCur ? Y + ' bisher' : 'Summe ' + Y}</label><b>${nfAuto(yc.v)}</b> ${factorTxt}</div>
        ${isCur ? `<div class="kpi"><label>Prognose ${Y}</label><b>${st.projection != null ? '≈ ' + nfAuto(st.projection) : '–'}</b></div>` : `<div class="kpi"><label>Ø pro Tag</label><b>${yc.v != null ? nfAuto(yc.v / (yc.b - yc.a)) : '–'}</b></div>`}
        <div class="kpi"><label>Vorjahr ${Y - 1}</label><b>${nfAuto(yp.v)}</b>${yp.partial ? '<span class="small muted">unvollständig</span>' : ''}</div>
        <div class="kpi"><label>${hasTariff(m) ? costLabel + (isCur ? ' (Prognose)' : '') : 'Veränderung'}</label>
          <b>${hasTariff(m) ? eur(costVal) : `<span class="${change > 0 ? (isErtrag ? 'down' : 'up') : (isErtrag ? 'up' : 'down')}">${pct(change)}</span>`}</b>
          ${hasTariff(m) && change != null ? `<span class="small ${change > 0 ? (isErtrag ? 'down' : 'up') : (isErtrag ? 'up' : 'down')}">${pct(change)} zum Vorjahr</span>` : ''}</div>
      </div>
    </div>

    ${yearRows.length ? `<h2>Jahreswerte</h2><div class="card"><div class="table-wrap"><table class="t">
      <tr><th>Jahr</th><th>Verbrauch</th><th>Ø/Tag</th>${hasTariff(m) ? `<th>${costLabel}</th>` : ''}</tr>${yearRows.join('')}</table></div></div>` : ''}

    <h2>Ablesungen (${st.rs.length})</h2>
    ${st.rs.length ? `<div class="card tight"><ul class="list">${items}</ul></div>` : '<p class="muted small">Noch keine Ablesungen.</p>'}
  `;
  $('#addHere').onclick = () => go('add', { meterId: m.id });
  $('#yPrev').onclick = () => { state.detailYear = Y - 1; renderDetail(main); };
  $('#yNext').onclick = () => { state.detailYear = Y + 1; renderDetail(main); };
  $$('[data-rid]', main).forEach(li => li.onclick = () => go('add', { readingId: li.dataset.rid }));
  const draw = () => drawBars($('#chart'), MONTHS, [
    { values: prev, color: t.color, alpha: .3 },
    { values: cur, color: t.color, alpha: 1, labels: true },
  ]);
  requestAnimationFrame(draw);
  state.redraw = draw;
}

/* ---------------------------------------------------------------------
   Ansicht: Ablesen (neu / bearbeiten)
   --------------------------------------------------------------------- */
function newForm(meterId, date) {
  return { mode: 'new', id: null, meterId, date, value: '', note: '', exchange: false, newStart: '', newNumber: '', photo: null, photoChanged: false };
}
async function initForm() {
  const p = state.params;
  if (p.readingId) {
    const r = findReading(p.readingId);
    if (!r) { history.back(); return null; }
    state.form = {
      mode: 'edit', id: r.id, meterId: r.meterId, date: r.date, value: toInput(r.value), note: r.note || '',
      exchange: !!r.exchange, newStart: r.exchange ? toInput(r.newStart) : '', newNumber: r.newNumber || '',
      photo: r.hasPhoto ? await DB.get('photos', r.id) : null, photoChanged: false,
    };
  } else {
    const date = todayStr();
    const mid = p.meterId || nextMeterToRead(date) || activeMeters()[0]?.id;
    state.form = newForm(mid, date);
  }
  return state.form;
}

async function renderAdd(main) {
  const meters = activeMeters();
  if (!meters.length && !state.params.readingId) {
    main.innerHTML = `<div class="card empty"><div class="e-icon">🔢</div><h3>Noch keine Zähler</h3>
      <p>Lege zuerst einen Zähler an.</p><button class="btn primary" id="toMeters">Zähler anlegen</button></div>`;
    $('#toMeters').onclick = () => go('meters', {}, { replace: true });
    return;
  }
  const F = state.form || await initForm();
  if (!F) return;
  const m = findMeter(F.meterId);
  if (!m) { state.form = null; go('home', {}, { replace: true }); return; }
  const t = typeOf(m), dec = m.decimals ?? 1;
  const doneToday = new Set(state.readings.filter(r => r.date === F.date).map(r => r.meterId));
  const others = meterReadings(m.id).filter(r => r.id !== F.id);
  const prev = others.filter(r => r.date <= F.date).pop();

  main.innerHTML = `
    ${F.mode === 'new' ? `<div class="chips">${meters.map(x => `<button class="chip ${x.id === m.id ? 'active' : ''}" data-mid="${x.id}" style="--c:${colorOf(x)}">
        ${typeOf(x).icon} ${esc(x.name)} ${doneToday.has(x.id) ? '<span class="done">✓</span>' : ''}</button>`).join('')}</div>` : ''}
    <div class="card">
      <div class="mc-head add-head" style="margin-bottom:14px">
        <span class="mc-icon" style="--c:${t.color}">${t.icon}</span>
        <div class="mc-title"><div class="mc-name">${esc(m.name)}</div>
        <div class="mc-sub">${prev ? `Letzter Stand: <b>${nf(effValue(prev), dec)} ${esc(m.unit)}</b> am ${fmtDate(prev.date)}` : 'Erste Ablesung für diesen Zähler'}${m.number ? ' · Nr. ' + esc(m.number) : ''}</div></div>
      </div>
      <label class="field"><span>Datum</span><input type="date" id="fDate" value="${F.date}"></label>
      <label class="field"><span id="valLabel">${F.exchange ? 'Endstand alter Zähler' : 'Zählerstand'}</span>
        <div class="input-unit"><input id="fValue" class="value-input" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="${prev ? toInput(effValue(prev)) : '0'}" value="${esc(F.value)}"><em>${esc(m.unit)}</em></div>
      </label>
      <div id="live" class="live"></div>

      <label class="check"><input type="checkbox" id="fExchange" ${F.exchange ? 'checked' : ''}> Zählertausch an diesem Tag</label>
      <fieldset class="sub ${F.exchange ? '' : 'hidden'}" id="exBox">
        <label class="field"><span>Anfangsstand neuer Zähler</span>
          <div class="input-unit"><input id="fNewStart" inputmode="decimal" autocomplete="off" value="${esc(F.newStart)}" placeholder="0"><em>${esc(m.unit)}</em></div></label>
        <label class="field"><span>Neue Zählernummer (optional)</span><input id="fNewNumber" value="${esc(F.newNumber)}"></label>
      </fieldset>

      <div class="photo-box">
        <img id="photoPrev" class="${F.photo ? '' : 'hidden'}" alt="Foto">
        <label class="btn">📷 ${F.photo ? 'Neues Foto' : 'Foto vom Zähler'}<input type="file" id="fPhoto" accept="image/*" capture="environment" hidden></label>
        <button class="btn ghost ${F.photo ? '' : 'hidden'}" id="photoDel">Entfernen</button>
      </div>
      <label class="field"><span>Notiz (optional)</span><input id="fNote" value="${esc(F.note)}" placeholder="z. B. geschätzt, Ablesung durch Versorger"></label>

      <button class="btn primary block big" id="saveBtn">💾 Speichern</button>
      ${F.mode === 'edit' ? '<button class="btn danger block" id="delBtn" style="margin-top:10px">Ablesung löschen</button>' : ''}
    </div>`;

  // Foto-Vorschau
  if (F.photo) {
    const url = URL.createObjectURL(F.photo);
    const img = $('#photoPrev');
    img.src = url;
    img.onclick = () => showPhoto(F.photo);
  }
  const updateLive = () => {
    const live = $('#live');
    const v = parseNum(F.value);
    live.className = 'live';
    if (!prev || isNaN(v)) { live.textContent = ''; return; }
    const pe = effValue(prev);
    const diff = v - pe;
    const days = dayNum(F.date) - dayNum(prev.date);
    if (diff < 0) {
      live.className = 'live warn';
      live.textContent = `⚠️ ${nf(diff, dec)} ${m.unit} – kleiner als der letzte Stand`;
    } else {
      const st = meterStats(m);
      const rate = days > 0 ? diff / days : null;
      const high = rate != null && st.avgDay > 0 && rate > st.avgDay * 3;
      live.className = 'live ' + (high ? 'warn' : 'ok');
      live.textContent = `+${nf(diff, dec)} ${m.unit} seit ${fmtDateShort(prev.date)}` + (rate != null ? ` · ${nfAuto(rate)} ${m.unit}/Tag` : '') + (high ? ' · ungewöhnlich hoch' : '');
    }
  };
  updateLive();

  $$('.chip', main).forEach(c => c.onclick = () => {
    F.meterId = c.dataset.mid; F.value = ''; F.exchange = false; F.newStart = ''; F.newNumber = ''; F.photo = null; F.photoChanged = false; F.note = '';
    renderAdd(main);
  });
  const chipActive = $('.chip.active', main);
  if (chipActive) chipActive.scrollIntoView({ inline: 'center', block: 'nearest' });
  $('#fDate').onchange = e => { F.date = e.target.value || todayStr(); renderAdd(main); };
  $('#fValue').oninput = e => { F.value = e.target.value; updateLive(); };
  $('#fValue').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };
  $('#fNote').oninput = e => { F.note = e.target.value; };
  $('#fExchange').onchange = e => { F.exchange = e.target.checked; $('#exBox').classList.toggle('hidden', !F.exchange); $('#valLabel').textContent = F.exchange ? 'Endstand alter Zähler' : 'Zählerstand'; };
  $('#fNewStart').oninput = e => { F.newStart = e.target.value; };
  $('#fNewNumber').oninput = e => { F.newNumber = e.target.value; };
  $('#fPhoto').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try { F.photo = await compressImage(file); F.photoChanged = true; renderAdd(main); }
    catch { toast('Foto konnte nicht gelesen werden'); }
  };
  $('#photoDel').onclick = () => { F.photo = null; F.photoChanged = true; renderAdd(main); };
  $('#saveBtn').onclick = () => saveReading(main);
  if ($('#delBtn')) $('#delBtn').onclick = async () => {
    if (!await confirmDialog({ title: 'Ablesung löschen?', msg: `Stand ${F.value} ${m.unit} vom ${fmtDate(F.date)} wird gelöscht.`, ok: 'Löschen', danger: true })) return;
    await DB.del('readings', F.id);
    await DB.del('photos', F.id);
    state.readings = state.readings.filter(r => r.id !== F.id);
    await bumpChanges();
    toast('Ablesung gelöscht');
    history.back();
  };
  if (F.mode === 'new' && !F.value && matchMedia('(pointer:coarse)').matches === false) $('#fValue').focus();
}

async function saveReading(main) {
  const F = state.form;
  const m = findMeter(F.meterId);
  const value = parseNum(F.value);
  if (isNaN(value)) { toast('Bitte einen Zählerstand eingeben'); $('#fValue').focus(); return; }
  if (!F.date) { toast('Bitte ein Datum wählen'); return; }
  let newStart = null;
  if (F.exchange) {
    newStart = parseNum(F.newStart);
    if (isNaN(newStart)) { toast('Bitte den Anfangsstand des neuen Zählers eingeben'); $('#fNewStart').focus(); return; }
  }
  const dec = m.decimals ?? 1;
  const others = meterReadings(m.id).filter(r => r.id !== F.id);
  const prev = others.filter(r => r.date <= F.date).pop();
  const next = others.find(r => r.date > F.date);
  const warnings = [];
  if (F.date > todayStr()) warnings.push('Das Datum liegt in der Zukunft.');
  if (prev && prev.date === F.date && F.mode === 'new') warnings.push(`Für den ${fmtDate(F.date)} gibt es bei diesem Zähler schon eine Ablesung (${nf(prev.value, dec)}).`);
  if (prev) {
    const pe = effValue(prev);
    if (value < pe) {
      warnings.push(`Der Stand ist kleiner als der vorherige (${nf(pe, dec)} ${m.unit} am ${fmtDate(prev.date)}). Wurde der Zähler getauscht? Dann „Zählertausch“ anhaken.`);
    } else {
      const st = meterStats(m);
      const days = Math.max(1, dayNum(F.date) - dayNum(prev.date));
      const rate = (value - pe) / days;
      if (st.avgDay > 0 && rate > st.avgDay * 3 && value - pe > 0)
        warnings.push(`Ungewöhnlich hoher Verbrauch: ${nfAuto(rate)} ${m.unit}/Tag (sonst Ø ${nfAuto(st.avgDay)}). Vertippt?`);
    }
  }
  if (next) {
    const after = F.exchange ? newStart : value;
    if (!next.exchange && next.value < after) warnings.push(`Der Stand ist größer als die spätere Ablesung vom ${fmtDate(next.date)} (${nf(next.value, dec)} ${m.unit}).`);
  }
  if (warnings.length && !await confirmDialog({ title: 'Bitte prüfen', warnings, ok: 'Trotzdem speichern' })) return;

  const old = F.id ? findReading(F.id) : null;
  const r = {
    id: F.id || uid(), meterId: m.id, date: F.date, value, note: F.note.trim(),
    exchange: !!F.exchange, newStart: F.exchange ? newStart : null, newNumber: F.exchange ? F.newNumber.trim() : '',
    oldNumber: F.exchange ? (old?.oldNumber || m.number || '') : '',
    hasPhoto: F.photoChanged ? !!F.photo : !!old?.hasPhoto,
    createdAt: old?.createdAt || Date.now(), updatedAt: Date.now(),
  };
  if (F.photoChanged) {
    if (F.photo) await DB.put('photos', F.photo, r.id); else await DB.del('photos', r.id);
  }
  await DB.put('readings', r);
  state.readings = state.readings.filter(x => x.id !== r.id).concat(r);
  // Bei Zählertausch mit neuer Nummer: Zählernummer aktualisieren (wenn es die jüngste Ablesung ist)
  if (r.exchange && r.newNumber && !next && r.newNumber !== m.number) {
    m.number = r.newNumber;
    await DB.put('meters', m);
  }
  await bumpChanges();

  if (F.mode === 'edit') { toast('Änderung gespeichert ✓'); history.back(); return; }
  const nextId = nextMeterToRead(F.date);
  if (nextId) {
    state.form = newForm(nextId, F.date);
    toast(`Gespeichert ✓ – weiter mit ${findMeter(nextId).name}`);
    renderAdd(main);
    window.scrollTo(0, 0);
  } else {
    toast('Alle Zähler abgelesen ✓');
    state.form = null;
    go('home', {}, { replace: true });
  }
}

/** Foto verkleinern (max. 1600 px, JPEG) damit der Speicher nicht vollläuft */
async function compressImage(file, max = 1600, quality = 0.72) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
}
function showPhoto(blob) {
  const url = URL.createObjectURL(blob);
  openModal(`<img class="photo-view" src="${url}" alt="Zählerfoto"><div style="margin-top:12px"><button class="btn block" data-close>Schließen</button></div>`,
    () => URL.revokeObjectURL(url));
}

/* ---------------------------------------------------------------------
   Ansicht: Auswertung
   --------------------------------------------------------------------- */
function sumType(type, y) {
  let sum = null, partial = false;
  for (const m of state.meters.filter(m => m.type === type)) {
    const c = yearConsumption(m, y);
    if (c.v != null) { sum = (sum || 0) + c.v; partial = partial || c.partial; }
  }
  return { v: sum, partial };
}

function renderStats(main) {
  const meters = activeMeters();
  if (!state.readings.length) {
    main.innerHTML = `<div class="card empty"><div class="e-icon">📊</div><h3>Noch keine Daten</h3><p>Sobald für einen Zähler mindestens zwei Ablesungen vorhanden sind, erscheint hier die Auswertung.</p></div>`;
    return;
  }
  const yrs = readingYears();
  const Y = Math.min(Math.max(state.statsYear, yrs.min), yrs.max);
  state.statsYear = Y;
  const isCur = Y === curYear();
  let costSum = 0, revSum = 0, anyCost = false, anyRev = false;

  const rows = meters.map(m => {
    const t = typeOf(m), st = meterStats(m);
    const c = consumption(st.pts, ymd(Y, 1), ymd(Y + 1, 1));
    const p = consumption(st.pts, ymd(Y - 1, 1), ymd(Y, 1));
    const est = isCur ? st.projection : null;
    const base = isCur ? est : c.v;
    const change = (base != null && p.v > 0 && !p.partial) ? base / p.v - 1 : null;
    const cost = isCur ? costFor(m, est, 1) : costFor(m, c.v, c.cover ?? 1);
    if (cost != null) {
      if (t.kind === 'ertrag') { revSum += cost; anyRev = true; }
      else if (t.kind === 'verbrauch') { costSum += cost; anyCost = true; }
    }
    const bad = t.kind === 'ertrag' || t.kind === 'erzeugung' ? change < 0 : change > 0;
    return `<li class="click" data-id="${m.id}">
      <span class="l-icon">${t.icon}</span>
      <div class="l-main">
        <div class="l-title">${esc(m.name)}</div>
        <div class="l-sub">${isCur ? 'bisher' : Y}: <b class="${c.partial && !isCur ? 'partial' : ''}">${c.v != null ? nf(c.v, 0) + ' ' + esc(m.unit) : '–'}</b>
          · Vorjahr: ${p.v != null ? nf(p.v, 0) + (p.partial ? '*' : '') : '–'}</div>
        ${isCur && est != null ? `<div class="l-sub">Prognose ${Y}: ≈ ${nf(est, 0)} ${esc(m.unit)}</div>` : ''}
      </div>
      <div class="l-right">${cost != null ? `<b>${eur(cost)}</b>` : ''}
        ${change != null ? `<div class="small ${bad ? 'up' : 'down'}">${pct(change)}</div>` : ''}</div>
    </li>`;
  }).join('');

  // PV-Bilanz
  let pvHtml = '';
  const hasPv = state.meters.some(m => m.type === 'pv'), hasEin = state.meters.some(m => m.type === 'einspeisung');
  if (hasPv && hasEin) {
    const pv = sumType('pv', Y), ein = sumType('einspeisung', Y), bez = sumType('strom', Y);
    if (pv.v != null && ein.v != null) {
      const ev = pv.v - ein.v;
      const evq = pv.v > 0 ? ev / pv.v : null;
      const aut = bez.v != null && ev + bez.v > 0 ? ev / (ev + bez.v) : null;
      const part = pv.partial || ein.partial || bez.partial;
      pvHtml = `<h2>☀️ PV-Bilanz ${Y}${isCur ? ' (bisher)' : ''}</h2>
        <div class="card"><div class="kpis four">
          <div class="kpi"><label>Erzeugung</label><b>${nf(pv.v, 0)}</b> <span class="small muted">kWh</span></div>
          <div class="kpi"><label>Eingespeist</label><b>${nf(ein.v, 0)}</b> <span class="small muted">kWh</span></div>
          <div class="kpi"><label>Eigenverbrauch</label><b>${nf(ev, 0)}</b> <span class="small muted">kWh · ${evq != null ? nf(evq * 100, 0) + ' %' : '–'}</span></div>
          <div class="kpi"><label>Autarkiegrad</label><b>${aut != null ? nf(aut * 100, 0) + ' %' : '–'}</b> <span class="small muted">Netzbezug ${bez.v != null ? nf(bez.v, 0) + ' kWh' : '–'}</span></div>
        </div>
        <p class="small muted" style="margin:10px 0 0">Eigenverbrauch = Erzeugung − Einspeisung. Autarkie = Eigenverbrauch / (Eigenverbrauch + Netzbezug).${part ? ' Werte teilweise unvollständig (Ablesungen decken nicht das ganze Jahr ab).' : ''}</p></div>`;
    }
  }

  main.innerHTML = `
    <div class="year-switch"><button id="yPrev" ${Y <= yrs.min ? 'disabled' : ''}>‹</button><b>${Y}</b><button id="yNext" ${Y >= yrs.max ? 'disabled' : ''}>›</button></div>
    ${anyCost || anyRev ? `<div class="kpis" style="margin-bottom:12px">
      ${anyCost ? `<div class="kpi card" style="margin:0"><label>Energie- & Wasserkosten ${isCur ? '(Prognose)' : ''}</label><b>${eur(costSum)}</b></div>` : ''}
      ${anyRev ? `<div class="kpi card" style="margin:0"><label>Einspeisevergütung ${isCur ? '(Prognose)' : ''}</label><b class="down">${eur(revSum)}</b></div>` : ''}
    </div>` : `<div class="banner info"><span class="b-icon">💶</span><div class="b-text">Tipp: Hinterlege bei den Zählern Arbeits- und Grundpreis, dann werden hier die Kosten berechnet.</div></div>`}
    <div class="card tight"><ul class="list">${rows}</ul></div>
    <p class="section-note">Verbrauch zwischen zwei Ablesungen wird linear auf die Tage verteilt. * = Vorjahr nicht vollständig abgedeckt. Prognose = Ø-Verbrauch der letzten 12 Monate hochgerechnet.</p>
    ${pvHtml}`;
  $('#yPrev').onclick = () => { state.statsYear = Y - 1; renderStats(main); };
  $('#yNext').onclick = () => { state.statsYear = Y + 1; renderStats(main); };
  $$('[data-id]', main).forEach(li => li.onclick = () => { state.detailYear = Y; go('detail', { id: li.dataset.id }); });
}

/* ---------------------------------------------------------------------
   Ansicht: Zähler verwalten
   --------------------------------------------------------------------- */
function templatesHtml() {
  return `<div class="templates">
    <button class="btn" data-tpl="strom">⚡ Strom</button>
    <button class="btn" data-tpl="gas">🔥 Gas</button>
    <button class="btn" data-tpl="wasser">💧 Wasser</button>
    <button class="btn" data-tpl="pvset">☀️ PV-Anlage</button>
    <button class="btn" data-tpl="warmwasser">🚿 Warmwasser</button>
    <button class="btn" data-tpl="">➕ Anderer Zähler</button>
  </div>`;
}
function bindTemplates(root) {
  $$('[data-tpl]', root).forEach(b => b.onclick = async () => {
    const tpl = b.dataset.tpl;
    if (tpl === 'pvset') {
      const ok = await confirmDialog({
        title: 'PV-Anlage anlegen',
        msg: 'Es werden zwei Zähler angelegt: „PV-Erzeugung“ (Wechselrichter/Erzeugungszähler) und „Einspeisung“ (Zweirichtungszähler, Register 2.8.0). Den Netzbezug (Register 1.8.0) legst du als normalen Stromzähler an.',
        ok: 'Anlegen',
      });
      if (!ok) return;
      await createMeter({ type: 'pv', name: 'PV-Erzeugung' });
      await createMeter({ type: 'einspeisung', name: 'Einspeisung', price: 0.082 });
      toast('PV-Zähler angelegt ✓');
      render();
      return;
    }
    openMeterForm(null, tpl || 'sonstig');
  });
}
async function createMeter(data) {
  const t = TYPES[data.type] || TYPES.sonstig;
  const m = {
    id: uid(), type: data.type, name: data.name || t.label, unit: data.unit ?? t.unit, number: '', location: '',
    decimals: data.decimals ?? 1, price: data.price ?? null, baseFee: null, factor: null, archived: false,
    order: Math.max(0, ...state.meters.map(x => (x.order ?? 0) + 1)), createdAt: Date.now(),
  };
  await DB.put('meters', m);
  state.meters.push(m);
  await bumpChanges();
  return m;
}

function renderMeters(main) {
  const act = activeMeters(), arc = archivedMeters();
  const row = (m, i, list) => {
    const t = typeOf(m);
    const n = state.readings.filter(r => r.meterId === m.id).length;
    return `<li class="click" data-id="${m.id}">
      ${list ? `<div class="order-btns"><button data-up="${m.id}" ${i === 0 ? 'disabled' : ''} aria-label="nach oben">▲</button><button data-down="${m.id}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="nach unten">▼</button></div>` : ''}
      <span class="l-icon">${t.icon}</span>
      <div class="l-main"><div class="l-title">${esc(m.name)}</div>
        <div class="l-sub">${esc([t.label, m.unit, m.number ? 'Nr. ' + m.number : ''].filter(Boolean).join(' · '))}</div></div>
      <div class="l-right"><span class="l-sub">${n} Abl.</span><div>${hasTariff(m) ? '💶' : ''}</div></div>
    </li>`;
  };
  main.innerHTML = `
    <button class="btn primary block" id="newMeter">➕ Neuen Zähler anlegen</button>
    ${act.length ? `<h2>Aktive Zähler</h2><div class="card tight"><ul class="list">${act.map((m, i) => row(m, i, act)).join('')}</ul></div>
      <p class="section-note">Tippen zum Bearbeiten (Name, Nummer, Preise …). Mit ▲▼ die Reihenfolge für die Ablese-Runde festlegen.</p>` : ''}
    <h2>Schnell anlegen</h2>
    <div class="card">${templatesHtml()}</div>
    ${arc.length ? `<h2>Archiviert</h2><div class="card tight"><ul class="list">${arc.map(m => row(m)).join('')}</ul></div>` : ''}`;
  $('#newMeter').onclick = () => openMeterForm(null, 'strom');
  bindTemplates(main);
  $$('[data-id]', main).forEach(li => li.onclick = e => {
    if (e.target.closest('.order-btns')) return;
    openMeterForm(findMeter(li.dataset.id));
  });
  const move = async (id, dir) => {
    const list = activeMeters();
    const i = list.findIndex(m => m.id === id), j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((m, k) => m.order = k);
    await DB.putMany('meters', list);
    renderMeters(main);
  };
  $$('[data-up]', main).forEach(b => b.onclick = e => { e.stopPropagation(); move(b.dataset.up, -1); });
  $$('[data-down]', main).forEach(b => b.onclick = e => { e.stopPropagation(); move(b.dataset.down, 1); });
}

function openMeterForm(m, typeKey) {
  const isNew = !m;
  const type = m ? m.type : typeKey;
  const t = TYPES[type] || TYPES.sonstig;
  const v = m || { type, name: t.label, unit: t.unit, number: '', location: '', decimals: 1, price: null, baseFee: null, factor: null };
  const priceLabel = tt => tt.kind === 'ertrag' ? 'Vergütung je Einheit (€)' : 'Arbeitspreis je Einheit (€)';
  const html = `
    <h3>${isNew ? 'Neuer Zähler' : 'Zähler bearbeiten'}</h3>
    <label class="field"><span>Art</span><select id="mType">${Object.entries(TYPES).map(([k, x]) => `<option value="${k}" ${k === v.type ? 'selected' : ''}>${x.icon} ${x.label}</option>`).join('')}</select></label>
    <label class="field"><span>Bezeichnung</span><input id="mName" value="${esc(v.name)}" placeholder="z. B. Hauptzähler Keller"></label>
    <div class="field-row">
      <label class="field"><span>Einheit</span><input id="mUnit" value="${esc(v.unit)}" placeholder="kWh"></label>
      <label class="field"><span>Nachkommastellen</span><select id="mDec">${[0, 1, 2, 3].map(n => `<option ${n === (v.decimals ?? 1) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Zählernummer</span><input id="mNumber" value="${esc(v.number)}"></label>
      <label class="field"><span>Standort</span><input id="mLoc" value="${esc(v.location)}" placeholder="z. B. Keller"></label>
    </div>
    <fieldset class="sub"><div class="small muted" style="margin-bottom:10px">💶 Tarif (optional, für die Kostenberechnung)</div>
      <div class="field-row">
        <label class="field"><span id="priceLbl">${priceLabel(t)}</span><input id="mPrice" inputmode="decimal" value="${toInput(v.price)}" placeholder="z. B. 0,32"></label>
        <label class="field"><span>Grundpreis € / Monat</span><input id="mBase" inputmode="decimal" value="${toInput(v.baseFee)}" placeholder="z. B. 12,50"></label>
      </div>
      <label class="field ${v.type === 'gas' || v.factor ? '' : 'hidden'}" id="factorBox"><span>Umrechnung m³ → kWh (Brennwert × Zustandszahl)</span>
        <input id="mFactor" inputmode="decimal" value="${toInput(v.factor)}" placeholder="z. B. 10,3">
        <span class="hint">Steht auf der Gasrechnung. Ist er gesetzt, gilt der Arbeitspreis je kWh.</span></label>
    </fieldset>
    ${isNew ? `<fieldset class="sub"><div class="small muted" style="margin-bottom:10px">Aktueller Zählerstand (optional)</div>
      <div class="field-row">
        <label class="field"><span>Stand</span><input id="mStart" inputmode="decimal" placeholder="0"></label>
        <label class="field"><span>Datum</span><input id="mStartDate" type="date" value="${todayStr()}"></label>
      </div></fieldset>` : ''}
    <div class="btn-col">
      <button class="btn primary big" id="mSave">Speichern</button>
      ${!isNew ? `<button class="btn" id="mArchive">${m.archived ? '↩️ Wieder aktivieren' : '📦 Archivieren (z. B. ausgebaut)'}</button>
        <button class="btn danger" id="mDelete">Zähler und alle Ablesungen löschen</button>` : ''}
      <button class="btn ghost" data-close>Abbrechen</button>
    </div>`;
  const root = openModal(html);
  let prevType = v.type;
  $('#mType', root).onchange = e => {
    const nt = TYPES[e.target.value];
    const ot = TYPES[prevType];
    if (!$('#mUnit', root).value || $('#mUnit', root).value === ot.unit) $('#mUnit', root).value = nt.unit;
    if (!$('#mName', root).value || $('#mName', root).value === ot.label) $('#mName', root).value = nt.label;
    $('#factorBox', root).classList.toggle('hidden', e.target.value !== 'gas' && !parseNum($('#mFactor', root).value));
    $('#priceLbl', root).textContent = priceLabel(nt);
    prevType = e.target.value;
  };
  $('#mSave', root).onclick = async () => {
    const name = $('#mName', root).value.trim();
    if (!name) { toast('Bitte eine Bezeichnung eingeben'); return; }
    const num = id => { const x = parseNum($(id, root).value); return isNaN(x) ? null : x; };
    const data = {
      type: $('#mType', root).value, name, unit: $('#mUnit', root).value.trim(),
      decimals: +$('#mDec', root).value, number: $('#mNumber', root).value.trim(), location: $('#mLoc', root).value.trim(),
      price: num('#mPrice'), baseFee: num('#mBase'), factor: num('#mFactor'),
    };
    if (isNew) {
      const nm = await createMeter(data);
      Object.assign(nm, data);
      await DB.put('meters', nm);
      const start = num('#mStart');
      if (start != null) {
        const r = { id: uid(), meterId: nm.id, date: $('#mStartDate', root).value || todayStr(), value: start, note: 'Anfangsstand', exchange: false, newStart: null, newNumber: '', hasPhoto: false, createdAt: Date.now(), updatedAt: Date.now() };
        await DB.put('readings', r);
        state.readings.push(r);
      }
      toast('Zähler angelegt ✓');
    } else {
      Object.assign(m, data);
      await DB.put('meters', m);
      await bumpChanges();
      toast('Gespeichert ✓');
    }
    closeModalNow();
    render();
  };
  if (!isNew) {
    $('#mArchive', root).onclick = async () => {
      m.archived = !m.archived;
      await DB.put('meters', m);
      await bumpChanges();
      closeModalNow();
      toast(m.archived ? 'Zähler archiviert' : 'Zähler wieder aktiv');
      if (state.view === 'detail' && m.archived) history.back(); else render();
    };
    $('#mDelete', root).onclick = async () => {
      const n = state.readings.filter(r => r.meterId === m.id).length;
      closeModalNow();
      if (!await confirmDialog({ title: `„${m.name}“ löschen?`, msg: `Der Zähler und ${n} Ablesung${n === 1 ? '' : 'en'} werden endgültig gelöscht. Tipp: „Archivieren“ behält die Daten.`, ok: 'Endgültig löschen', danger: true })) return;
      for (const r of state.readings.filter(r => r.meterId === m.id)) { await DB.del('readings', r.id); await DB.del('photos', r.id); }
      await DB.del('meters', m.id);
      state.readings = state.readings.filter(r => r.meterId !== m.id);
      state.meters = state.meters.filter(x => x.id !== m.id);
      await bumpChanges();
      toast('Zähler gelöscht');
      if (state.view === 'detail') history.back(); else render();
    };
  }
}

/* ---------------------------------------------------------------------
   Ansicht: Daten & Sicherung
   --------------------------------------------------------------------- */
function renderData(main) {
  const s = state.settings;
  const due = backupDue();
  const last = s.lastBackup ? new Date(s.lastBackup) : null;
  const status = !state.meters.length ? '<div class="banner info"><span class="b-icon">ℹ️</span><div class="b-text">Noch keine Daten vorhanden.</div></div>'
    : due ? backupBannerHtml()
    : `<div class="banner ok"><span class="b-icon">✅</span><div class="b-text"><b>Gesichert</b>Letzte Sicherung am ${last.toLocaleDateString('de-DE')} um ${last.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}${s.changes ? ` · ${s.changes} Änderung${s.changes === 1 ? '' : 'en'} seitdem` : ''}</div></div>`;
  const photoCount = state.readings.filter(r => r.hasPhoto).length;
  const standalone = matchMedia('(display-mode: standalone)').matches;

  main.innerHTML = `
    ${status}
    <h2>💾 Datensicherung</h2>
    <div class="card">
      <p class="small muted" style="margin-top:0">Alle Daten liegen nur auf diesem Handy. Sichere sie regelmäßig – am einfachsten über „Teilen“ direkt nach Google Drive, in eine E-Mail an dich selbst oder in einen Messenger-Chat mit dir selbst.</p>
      <label class="check"><input type="checkbox" id="withPhotos" checked> Fotos mitsichern (${photoCount} Foto${photoCount === 1 ? '' : 's'})</label>
      <div class="btn-col">
        <button class="btn primary big" id="shareBtn">📤 Backup erstellen & teilen</button>
        <button class="btn" id="dlBtn">⬇️ Backup als Datei herunterladen</button>
        <button class="btn" id="importBtn">♻️ Backup wiederherstellen</button>
      </div>
    </div>

    <h2>📑 Export für Excel</h2>
    <div class="card">
      <p class="small muted" style="margin-top:0">Alle Ablesungen als CSV-Datei (Semikolon, deutsches Zahlenformat) – lässt sich direkt in Excel öffnen.</p>
      <button class="btn block" id="csvBtn">📊 CSV exportieren</button>
    </div>

    <h2>⏰ Erinnerungen</h2>
    <div class="card">
      <div class="field-row">
        <label class="field"><span>Ablesung fällig nach (Tagen)</span><input id="sRead" type="number" min="1" inputmode="numeric" value="${s.readDays}"></label>
        <label class="field"><span>Backup-Hinweis nach (Tagen)</span><input id="sBackup" type="number" min="1" inputmode="numeric" value="${s.backupDays}"></label>
      </div>
      <p class="small muted" style="margin-top:0">Monatlichen Kalendertermin „Zähler ablesen“ anlegen – so kommt die Erinnerung zuverlässig aufs Handy:</p>
      <label class="field"><span>Am Tag des Monats</span><select id="sDay">${Array.from({ length: 28 }, (_, i) => `<option ${i + 1 === s.remindDay ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
      <div class="btn-col">
        <a class="btn" id="gcalBtn" target="_blank" rel="noopener">📅 In Google Kalender eintragen</a>
        <button class="btn" id="icsBtn">🗓️ Kalenderdatei (.ics) für andere Kalender-Apps</button>
      </div>
    </div>

    <h2>📱 App & Speicher</h2>
    <div class="card">
      <ul class="list" style="margin:-6px -16px">
        <li><div class="l-main"><div class="l-title">Installiert</div><div class="l-sub">${standalone ? 'Läuft als App vom Startbildschirm' : 'Läuft im Browser – über das Menü ⋮ „Zum Startbildschirm hinzufügen“ bzw. „App installieren“'}</div></div>
          ${state.installPrompt ? '<button class="btn sm primary" data-act="install">Installieren</button>' : `<span class="badge ${standalone ? 'ok' : ''}">${standalone ? 'ja' : 'nein'}</span>`}</li>
        <li><div class="l-main"><div class="l-title">Dauerhafter Speicher</div><div class="l-sub">Schützt die Daten davor, dass der Browser sie bei Speichermangel automatisch löscht.</div></div>
          ${state.persisted ? '<span class="badge ok">aktiv</span>' : '<button class="btn sm" id="persistBtn">Anfordern</button>'}</li>
        <li><div class="l-main"><div class="l-title">Datenbestand</div><div class="l-sub" id="usage">${state.meters.length} Zähler · ${state.readings.length} Ablesungen · ${photoCount} Fotos</div></div></li>
        <li><div class="l-main"><div class="l-title">Version</div><div class="l-sub">HausHub ${APP_VERSION}</div></div></li>
      </ul>
    </div>

    <h2>⚠️ Gefahrenzone</h2>
    <div class="card"><button class="btn danger block" id="wipeBtn">Alle Daten auf diesem Gerät löschen</button></div>`;

  bindCommonActions(main);
  $('#shareBtn').onclick = () => shareBackup($('#withPhotos').checked);
  $('#dlBtn').onclick = () => downloadBackup($('#withPhotos').checked);
  $('#importBtn').onclick = pickImportFile;
  $('#csvBtn').onclick = exportCsv;
  $('#icsBtn').onclick = exportIcs;
  const updGcal = () => { $('#gcalBtn').href = googleCalendarUrl(); };
  updGcal();
  $('#sDay').onchange = async e => { s.remindDay = +e.target.value; await saveSettings(); updGcal(); };
  $('#sRead').onchange = async e => { s.readDays = Math.max(1, +e.target.value || 31); await saveSettings(); };
  $('#sBackup').onchange = async e => { s.backupDays = Math.max(1, +e.target.value || 30); await saveSettings(); };
  if ($('#persistBtn')) $('#persistBtn').onclick = async () => {
    await requestPersist(true);
    toast(state.persisted ? 'Dauerhafter Speicher aktiv ✓' : 'Vom Browser (noch) nicht gewährt – nach der Installation als App erneut versuchen.');
    renderData(main);
  };
  if (navigator.storage?.estimate) navigator.storage.estimate().then(e => {
    const el = $('#usage');
    if (el && e.usage != null) el.textContent += ` · belegt ca. ${nf(e.usage / 1048576, 1)} MB`;
  });
  $('#wipeBtn').onclick = async () => {
    if (!await confirmDialog({ title: 'Alle Daten löschen?', msg: 'Alle Zähler, Ablesungen und Fotos werden von diesem Gerät gelöscht. Das kann nicht rückgängig gemacht werden – vorher ein Backup erstellen!', ok: 'Weiter', danger: true })) return;
    if (!await confirmDialog({ title: 'Wirklich sicher?', msg: 'Letzte Warnung: Danach sind die Daten nur noch über ein Backup wiederherstellbar.', ok: 'Endgültig löschen', danger: true })) return;
    await Promise.all(['meters', 'readings', 'photos'].map(s => DB.clear(s)));
    state.meters = []; state.readings = [];
    state.settings = { ...DEFAULT_SETTINGS, readDays: s.readDays, backupDays: s.backupDays, remindDay: s.remindDay };
    await saveSettings();
    toast('Alle Daten gelöscht');
    go('home', {}, { replace: true });
  };
}

/* ---------------------------------------------------------------------
   Backup / Wiederherstellung / Export
   --------------------------------------------------------------------- */
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
function dataURLToBlob(url) {
  const [head, data] = url.split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
async function buildBackupFile(withPhotos) {
  const photos = {};
  if (withPhotos) {
    for (const k of await DB.keys('photos')) {
      const b = await DB.get('photos', k);
      if (b) photos[k] = await blobToDataURL(b);
    }
  }
  const s = state.settings;
  const data = {
    app: 'HausHub', format: BACKUP_FORMAT, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
    settings: { backupDays: s.backupDays, readDays: s.readDays, remindDay: s.remindDay },
    meters: state.meters, readings: state.readings, photos,
  };
  const stamp = new Date();
  const name = `HausHub-Backup-${todayStr()}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
  const json = JSON.stringify(data);
  return {
    json: new File([json], name + '.json', { type: 'application/json' }),
    txt: new File([json], name + '.json.txt', { type: 'text/plain' }), // Fallback, falls .json nicht geteilt werden darf
  };
}
async function markBackup() {
  state.settings.lastBackup = new Date().toISOString();
  state.settings.changes = 0;
  await saveSettings();
  if (state.view === 'home' || state.view === 'data') render();
}
function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function shareBackup(withPhotos) {
  if (!state.meters.length) { toast('Noch keine Daten zum Sichern'); return; }
  const f = await buildBackupFile(withPhotos);
  const file = navigator.canShare?.({ files: [f.json] }) ? f.json : navigator.canShare?.({ files: [f.txt] }) ? f.txt : null;
  if (!file) { downloadFile(f.json); await markBackup(); toast('Teilen nicht möglich – Backup wurde heruntergeladen ✓'); return; }
  try {
    await navigator.share({ files: [file], title: 'HausHub-Backup', text: `HausHub-Backup vom ${new Date().toLocaleDateString('de-DE')}` });
    await markBackup();
    toast('Backup geteilt ✓');
  } catch (e) {
    if (e.name === 'AbortError') { toast('Teilen abgebrochen – kein Backup erstellt'); return; }
    downloadFile(f.json); await markBackup(); toast('Backup wurde heruntergeladen ✓');
  }
}
async function downloadBackup(withPhotos) {
  if (!state.meters.length) { toast('Noch keine Daten zum Sichern'); return; }
  const f = await buildBackupFile(withPhotos);
  downloadFile(f.json);
  await markBackup();
  toast('Backup im Ordner „Downloads“ gespeichert ✓');
}
function pickImportFile() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,.txt,application/json,text/plain';
  inp.onchange = () => inp.files[0] && importBackup(inp.files[0]);
  inp.click();
}
async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('Die Datei ist kein gültiges HausHub-Backup'); return; }
  if (!data || data.app !== 'HausHub' || !Array.isArray(data.meters) || !Array.isArray(data.readings)) { toast('Die Datei ist kein gültiges HausHub-Backup'); return; }
  const photos = data.photos || {};
  const nP = Object.keys(photos).length;
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : 'unbekannt';
  const choice = await choiceDialog({
    title: 'Backup wiederherstellen',
    msg: `Backup vom <b>${esc(when)}</b>: ${data.meters.length} Zähler, ${data.readings.length} Ablesungen, ${nP} Fotos.<br><br>
      <b>Ersetzen</b> löscht die aktuellen Daten auf diesem Gerät und übernimmt das Backup.<br>
      <b>Zusammenführen</b> ergänzt fehlende Einträge (gleiche Einträge werden mit dem Backup-Stand überschrieben).`,
    options: [{ id: 'replace', label: 'Alles ersetzen', cls: 'danger' }, { id: 'merge', label: 'Zusammenführen', cls: 'primary' }],
  });
  if (!choice) return;
  try {
    if (choice === 'replace') await Promise.all(['meters', 'readings', 'photos'].map(s => DB.clear(s)));
    const meters = data.meters.filter(m => m && m.id && m.name);
    const readings = data.readings.filter(r => r && r.id && r.meterId && r.date && isFinite(r.value));
    await DB.putMany('meters', meters);
    await DB.putMany('readings', readings);
    const ph = Object.entries(photos).map(([k, url]) => ({ k, value: dataURLToBlob(url) }));
    if (ph.length) await DB.putMany('photos', ph, it => it.k);
    // Fotos, die im Backup fehlen, nicht als vorhanden markieren
    const photoKeys = new Set(await DB.keys('photos'));
    for (const r of readings) if (r.hasPhoto && !photoKeys.has(r.id)) { r.hasPhoto = false; await DB.put('readings', r); }
    if (data.settings) Object.assign(state.settings, data.settings);
    state.settings.lastBackup = data.exportedAt || new Date().toISOString();
    state.settings.changes = choice === 'merge' ? 1 : 0;
    await saveSettings();
    await loadAll();
    toast('Backup wiederhergestellt ✓');
    go('home', {}, { replace: true });
  } catch (e) {
    console.error(e);
    toast('Fehler beim Wiederherstellen: ' + e.message);
  }
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
async function exportCsv() {
  if (!state.readings.length) { toast('Noch keine Ablesungen vorhanden'); return; }
  const num = (v, dec = 3) => v == null || !isFinite(v) ? '' : String(+v.toFixed(dec)).replace('.', ',');
  const lines = [['Zähler', 'Art', 'Zählernummer', 'Einheit', 'Datum', 'Zählerstand', 'Verbrauch seit letzter Ablesung', 'Tage', 'Verbrauch pro Tag', 'Zählertausch', 'Anfangsstand neuer Zähler', 'Notiz'].join(';')];
  for (const m of state.meters.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const pts = cumSeries(meterReadings(m.id));
    pts.forEach((p, i) => {
      const r = p.r, pr = pts[i - 1];
      const delta = pr ? p.c - pr.c : null, days = pr ? p.d - pr.d : null;
      lines.push([m.name, typeOf(m).label, r.oldNumber || m.number, m.unit, fmtDate(r.date), num(r.value),
        num(delta), days ?? '', days > 0 ? num(delta / days) : '', r.exchange ? 'ja' : '', r.exchange ? num(r.newStart) : '', r.note].map(csvCell).join(';'));
    });
  }
  const file = new File(['﻿' + lines.join('\r\n')], `HausHub-Ablesungen-${todayStr()}.csv`, { type: 'text/csv' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'HausHub-Ablesungen' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  downloadFile(file);
  toast('CSV gespeichert ✓');
}

function nextRemindDate() {
  const d = new Date(), day = state.settings.remindDay || 1;
  let y = d.getFullYear(), m = d.getMonth() + 1;
  if (d.getDate() >= day) { m++; if (m > 12) { m = 1; y++; } }
  return { y, m, day };
}
function googleCalendarUrl() {
  const { y, m, day } = nextRemindDate();
  const start = `${y}${pad(m)}${pad(day)}T180000`, end = `${y}${pad(m)}${pad(day)}T181500`;
  const p = new URLSearchParams({
    action: 'TEMPLATE', text: 'Zählerstände ablesen (HausHub)',
    details: 'HausHub öffnen, alle Zähler ablesen und danach ein Backup erstellen.',
    dates: `${start}/${end}`, ctz: 'Europe/Berlin', recur: `RRULE:FREQ=MONTHLY;BYMONTHDAY=${day}`,
  });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
function exportIcs() {
  const { y, m, day } = nextRemindDate();
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HausHub//DE', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:haushub-ablesen-${uid()}@haushub`, `DTSTAMP:${now}`,
    `DTSTART;TZID=Europe/Berlin:${y}${pad(m)}${pad(day)}T180000`, `DTEND;TZID=Europe/Berlin:${y}${pad(m)}${pad(day)}T181500`,
    `RRULE:FREQ=MONTHLY;BYMONTHDAY=${day}`, 'SUMMARY:Zählerstände ablesen (HausHub)',
    'DESCRIPTION:HausHub öffnen\\, alle Zähler ablesen und danach ein Backup erstellen.',
    'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Zählerstände ablesen', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  downloadFile(new File([ics], 'HausHub-Ablesetermin.ics', { type: 'text/calendar' }));
  toast('Kalenderdatei gespeichert – in den Downloads antippen');
}

/* ---------------------------------------------------------------------
   Diagramm (Canvas, ohne externe Bibliotheken)
   --------------------------------------------------------------------- */
function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function compact(v) {
  if (v >= 10000) return nf(v / 1000, v >= 100000 ? 0 : 1) + 'k';
  return nf(v, v >= 100 || v === 0 ? 0 : v >= 10 ? 0 : 1);
}
function drawBars(canvas, labels, series) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const cs = getComputedStyle(document.documentElement);
  const muted = cs.getPropertyValue('--muted').trim(), line = cs.getPropertyValue('--line').trim(), text = cs.getPropertyValue('--text').trim();
  const font = s => `${s}px system-ui, sans-serif`;
  let max = 0;
  series.forEach(s => s.values.forEach(x => { if (x && x.v > max) max = x.v; }));
  if (max <= 0) {
    ctx.fillStyle = muted; ctx.font = font(13); ctx.textAlign = 'center';
    ctx.fillText('Für dieses Jahr noch keine Verbrauchsdaten', w / 2, h / 2 - 8);
    ctx.fillText('(mind. 2 Ablesungen nötig)', w / 2, h / 2 + 12);
    return;
  }
  const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
  const padL = 42, padR = 4, padT = 16, padB = 22;
  const cw = w - padL - padR, ch = h - padT - padB;
  ctx.font = font(11); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.lineWidth = 1;
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = Math.round(padT + ch - v / top * ch) + .5;
    ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillStyle = muted; ctx.fillText(compact(v), padL - 6, y);
  }
  const n = labels.length, gw = cw / n, ns = series.length;
  const bw = Math.min(16, (gw * .8) / ns), gap = 2;
  const groupW = bw * ns + gap * (ns - 1);
  series.forEach((s, si) => {
    s.values.forEach((x, i) => {
      if (!x || x.v <= 0) return;
      const bh = x.v / top * ch;
      const bx = padL + i * gw + (gw - groupW) / 2 + si * (bw + gap);
      const by = padT + ch - bh;
      ctx.globalAlpha = s.alpha * (x.partial ? .55 : 1);
      ctx.fillStyle = s.color;
      const r = Math.min(4, bw / 2, bh);
      ctx.beginPath();
      ctx.moveTo(bx, by + bh); ctx.lineTo(bx, by + r); ctx.quadraticCurveTo(bx, by, bx + r, by);
      ctx.lineTo(bx + bw - r, by); ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r); ctx.lineTo(bx + bw, by + bh);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      if (s.labels && gw >= 26) {
        ctx.fillStyle = text; ctx.font = font(9.5); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(compact(x.v), bx + bw / 2, by - 2);
      }
    });
  });
  ctx.fillStyle = muted; ctx.font = font(10.5); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  labels.forEach((l, i) => ctx.fillText(gw < 24 ? l[0] : l, padL + i * gw + gw / 2, padT + ch + 6));
}
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (state.view === 'detail' && state.redraw) state.redraw(); }, 150); });

/* ---------------------------------------------------------------------
   Modale Fenster, Dialoge, Toast
   --------------------------------------------------------------------- */
let modalCleanup = null;
const modalOpen = () => !!$('#modalRoot').firstChild;
function openModal(html, onClose) {
  closeModalNow();
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  const bd = $('.modal-backdrop', root);
  bd.addEventListener('click', e => { if (e.target === bd) closeModalNow(); });
  $$('[data-close]', root).forEach(b => b.onclick = closeModalNow);
  modalCleanup = onClose || null;
  return $('.sheet', root);
}
function closeModalNow() {
  const root = $('#modalRoot');
  if (!root.firstChild) return;
  root.innerHTML = '';
  if (modalCleanup) { const f = modalCleanup; modalCleanup = null; f(); }
}
function confirmDialog({ title, msg = '', warnings, ok = 'OK', danger = false }) {
  return new Promise(res => {
    let done = false;
    const finish = v => { if (done) return; done = true; res(v); };
    const sheet = openModal(`<h3>${esc(title)}</h3>
      ${msg ? `<p class="msg">${esc(msg)}</p>` : ''}
      ${warnings ? `<ul class="warnings">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="btn-row"><button class="btn" id="dNo">Abbrechen</button><button class="btn ${danger ? 'danger' : 'primary'}" id="dYes">${esc(ok)}</button></div>`,
      () => finish(false));
    $('#dNo', sheet).onclick = () => closeModalNow();
    $('#dYes', sheet).onclick = () => { finish(true); closeModalNow(); };
  });
}
function choiceDialog({ title, msg, options }) {
  return new Promise(res => {
    let done = false;
    const finish = v => { if (done) return; done = true; res(v); };
    const sheet = openModal(`<h3>${esc(title)}</h3><p class="msg">${msg}</p>
      <div class="btn-col">${options.map(o => `<button class="btn ${o.cls || ''}" data-opt="${o.id}">${esc(o.label)}</button>`).join('')}
      <button class="btn ghost" data-opt="">Abbrechen</button></div>`, () => finish(null));
    $$('[data-opt]', sheet).forEach(b => b.onclick = () => { finish(b.dataset.opt || null); closeModalNow(); });
  });
}
let toastT;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) $('button', t).onclick = () => { t.classList.remove('show'); action.fn(); };
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), action ? 8000 : 2600);
}

/* ---------------------------------------------------------------------
   Installation, Speicher, Service Worker
   --------------------------------------------------------------------- */
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  state.installPrompt = e;
  if (state.view === 'home' || state.view === 'data') render();
});
window.addEventListener('appinstalled', () => {
  state.installPrompt = null;
  toast('HausHub wurde installiert ✓');
  requestPersist(true);
});
async function doInstall() {
  const p = state.installPrompt;
  if (!p) return;
  p.prompt();
  await p.userChoice;
  state.installPrompt = null;
  render();
}
async function requestPersist(ask) {
  if (!navigator.storage?.persisted) return;
  state.persisted = await navigator.storage.persisted();
  if (!state.persisted && ask && navigator.storage.persist) state.persisted = await navigator.storage.persist();
}
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('Neue Version installiert', { label: 'Neu laden', fn: () => location.reload() });
  });
}

/* ---------------------------------------------------------------------
   Start
   --------------------------------------------------------------------- */
async function init() {
  $$('#tabbar button').forEach(b => b.onclick = () => {
    const tab = b.dataset.tab;
    if (tab === state.view && !state.params.readingId && tab !== 'add') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (tab === 'home' && state.depth > 0) { history.go(-state.depth); return; }
    // Von der Übersicht aus "pushen", damit Zurück wieder zur Übersicht führt
    go(tab, {}, { replace: state.view !== 'home' || tab === 'home' });
  });
  $('#backBtn').onclick = () => history.back();
  try {
    await DB.open();
    await loadAll();
  } catch (e) {
    $('#main').innerHTML = `<div class="card"><h3>Speicher nicht verfügbar</h3><p>HausHub konnte die lokale Datenbank nicht öffnen (${esc(e?.message || e)}). Bitte nicht im Inkognito-Modus verwenden.</p></div>`;
    return;
  }
  state.depth = 0;
  history.replaceState({ view: 'home', params: {}, depth: 0 }, '');
  render();
  requestPersist(state.meters.length > 0).then(() => { if (state.view === 'data') render(); });
  registerSW();
}
init();
