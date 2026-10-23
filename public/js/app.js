import * as M from './model.js';
import { API_BASE } from './config.js';
import { searchMembers } from './search.js';
const { AREAS, baseOf, parseActivity: PA } = M;

const S = { data: null, ix: null, me: null, admin: false, token: '', tab: 'schedule', day: 24, clock: M.makeClock(location.search),
  version: 0, offline: false, demo: false, seenId: 0, sel: null, lastKey: '', myHash: '' };
const view = document.getElementById('view'), tabs = document.getElementById('tabs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = { get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} } };

/* ---------- API ---------- */
async function api(path, opt = {}) {
  const r = await fetch(API_BASE.replace(/\/$/, '') + path, { ...opt, headers: { 'content-type': 'application/json', ...(S.token ? { 'x-admin-token': S.token } : {}) } });
  if (!r.ok) throw Object.assign(new Error('http ' + r.status), { status: r.status });
  return r.json();
}
function setData(d) { S.data = d; S.ix = M.buildIndex(d); S.version = d.version; }
async function loadDemo() {            // API が無い静的ホスティング(GitHub Pages)では匿名サンプルで動かす
  try { const r = await fetch('demo-data.json'); if (!r.ok) return false; setData(await r.json()); S.demo = true; return true; } catch { return false; }
}
async function refresh() {
  if (S.demo) return false;
  try {
    const d = await api('/data?since=' + S.version);
    S.offline = false;
    if (d.unchanged) return false;
    setData(d); LS.set('bamp:data', d); return true;
  } catch {
    S.offline = true;
    if (!S.data) { const c = LS.get('bamp:data'); if (c) setData(c); else if (await loadDemo()) S.offline = false; }
    return false;
  }
}

/* ---------- 部品 ---------- */
const SHAPES = {
  Square: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>', Circle: '<circle cx="12" cy="12" r="8"/>',
  Triangle: '<path d="M12 3.5 21 19.5H3z" stroke-linejoin="round" stroke-width="2"/>',
  Hexagon: '<path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z" stroke-linejoin="round" stroke-width="2"/>',
  Pentagon: '<path d="M12 3 21 9.6 17.6 20H6.4L3 9.6z" stroke-linejoin="round" stroke-width="2"/>',
};
function glyph(act, size = 40) {
  const p = typeof act === 'string' ? PA(act) : act;
  const base = p.tokens[0] && baseOf(p.tokens[0]);
  const c = base ? AREAS[base].color : M.KIND_COLOR[p.kind];
  const inner = base ? `<svg viewBox="0 0 24 24" width="${size * .6}" height="${size * .6}" fill="${c}" stroke="${c}">${SHAPES[base]}</svg>`
    : `<svg viewBox="0 0 24 24" width="${size * .5}" height="${size * .5}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>`;
  return `<span class="glyph" style="width:${size}px;height:${size}px;border-radius:${size * .32}px;background:color-mix(in srgb,${c} 16%,#fff);box-shadow:0 1px 0 #fff inset,0 4px 12px color-mix(in srgb,${c} 22%,transparent)">${inner}</span>`;
}
const colorOf = p => p.tokens[0] ? AREAS[baseOf(p.tokens[0])].color : M.KIND_COLOR[p.kind];
const avatar = (m, cls = '') => `<span class="avatar ${cls}">${esc(M.initial(m.name))}</span>`;
const ICON = {
  cal: '<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  map: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  bell: '<path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15zM10 21h4"/>',
  live: '<circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.4 2.7-5.5 6-5.5s6 2.1 6 5.5M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.8c1.9.7 3 2.4 3 5.2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  out: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
};
const icon = (k, s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

function toast(text) { const t = document.createElement('div'); t.className = 'toast glass'; t.dataset.testid = 'toast'; t.textContent = text; document.body.appendChild(t); setTimeout(() => t.remove(), 3500); }

let sheetEl = null, scrimEl = null;
function openSheet(html, { center = false } = {}) {
  closeSheet(true);
  scrimEl = document.createElement('div'); scrimEl.className = 'scrim'; scrimEl.dataset.act = 'close';
  sheetEl = document.createElement('div'); sheetEl.className = 'sheet glass' + (center ? ' center' : ''); sheetEl.dataset.testid = 'sheet';
  sheetEl.innerHTML = (center ? '' : '<div class="grab"></div>') + html;
  document.body.append(scrimEl, sheetEl); armMaps(sheetEl); return sheetEl;
}
function closeSheet(now = false) {
  const s = sheetEl, c = scrimEl; sheetEl = scrimEl = null; if (!s) return;
  if (now) { s.remove(); c.remove(); return; }
  s.classList.add('closing'); c.style.opacity = 0; c.style.transition = 'opacity .25s'; setTimeout(() => { s.remove(); c.remove(); }, 280);
}

/* ---------- 地図 ---------- */
function mapHTML(tokens, { all = false, label = '' } = {}) {
  const bases = [...new Set(tokens.map(baseOf))];
  const [W, H] = M.MAP_SIZE; const z = bases.length === 1 && !all ? 2.3 : 1;
  let t = 'none';
  if (z > 1) { const [x, y] = AREAS[bases[0]].pin; const cl = (v, lo) => Math.min(0, Math.max(lo, v));
    t = `translate(${cl((.5 - x / W * z) * 100, (1 - z) * 100)}%,${cl((.5 - y / H * z) * 100, (1 - z) * 100)}%) scale(${z})`; }
  const pins = M.AREA_ORDER.filter(a => all || bases.includes(a)).map(a => { const [x, y] = AREAS[a].pin;
    return `<div class="pin ${bases.includes(a) ? '' : 'dim'}" style="left:${x / W * 100}%;top:${y / H * 100}%;--c:${AREAS[a].color}"><i></i></div>`; }).join('');
  return `<div class="map" data-testid="map" style="--z:${z}"><div class="inner" data-t="${t}"><img src="img/map.webp" alt="エリア図" loading="lazy">${pins}</div>${label ? `<span class="maplabel">${esc(label)}</span>` : ''}</div>`;
}
function armMaps(root = document) { requestAnimationFrame(() => requestAnimationFrame(() => root.querySelectorAll('.map .inner').forEach(e => { e.style.transform = e.dataset.t; }))); }

/* ---------- スケルトン ---------- */
const sk = (w, h, extra = '') => `<div class="sk" style="width:${w};height:${h};${extra}"></div>`;
function skeleton(kind) {
  const card = (h) => `<div class="glass skel-card">${sk('40%', '14px')}${sk('75%', '30px', 'margin-top:12px')}${sk('100%', h, 'margin-top:14px')}</div>`;
  const list = n => Array.from({ length: n }, () => `<div class="glass skel-card row">${sk('46px', '46px', 'border-radius:16px')}<div style="flex:1">${sk('60%', '16px')}${sk('35%', '11px', 'margin-top:8px')}</div></div>`).join('');
  const head = `<div class="top">${sk('44px', '44px', 'border-radius:50%')}<div style="flex:1">${sk('50%', '20px')}</div>${sk('76px', '36px', 'border-radius:999px')}</div>`;
  const body = { name: `<div class="name-wrap"><div class="row" style="margin-bottom:16px">${sk('56px', '56px', 'border-radius:18px')}${sk('45%', '28px')}</div>${sk('100%', '62px', 'border-radius:999px')}<div style="margin-top:18px">${list(4)}</div></div>`,
    schedule: head + sk('100%', '46px', 'border-radius:999px;margin-bottom:14px') + card('120px') + list(4),
    areas: head + sk('100%', '190px', 'border-radius:20px;margin-bottom:14px') + list(3), comms: head + list(3), live: head + card('70px') + card('70px') + card('70px'), members: head + list(6) }[kind] || list(4);
  return `<div class="screen" data-testid="skeleton">${body}</div>`;
}
function put(html, kind) { const el = document.createElement('div'); el.className = 'screen'; el.dataset.testid = kind; el.innerHTML = html; view.replaceChildren(el); armMaps(el); return el; }
function putSkeleton(kind) { view.innerHTML = skeleton(kind); }

/* ---------- 名前入力 ---------- */
function rosterHTML() {
  const ix = S.ix, loc = M.locate(ix, S.clock.now());
  const ref = loc.state === 'after' ? { day: 25, idx: ix.slotsByDay[25].length - 1 } : loc, sl = slotOf(ref.day, ref.idx);
  const rows = S.data.members.map((m, i) => {
    const att = M.attends(m, ref.day), a = att ? M.actOf(ix, m.id, ref.day, ref.idx) : PA(''), label = att ? a.label : '参加なし';
    return `<button class="glass person press" style="--i:${Math.min(i, 10)}" data-act="pick" data-id="${m.id}" data-testid="member-row"><span class="avatar">${esc(M.initial(m.name))}</span>
      <div style="flex:1;min-width:0"><b>${esc(m.name)}</b><div class="small muted">${esc(m.grp)} ${esc(m.role)}</div></div>
      <span class="chip" style="--c:${colorOf(a)}" data-testid="member-now"><i class="dot" style="--c:${colorOf(a)}"></i>${esc(label)}</span></button>`; }).join('');
  return `<div class="h2" data-testid="roster-head">参加者 ${S.data.members.length}人 ・ ${dayLabel(ref.day)} ${slotRange(sl)} ${loc.state === 'before' ? '（開始前の最初の予定）' : '時点'}</div><div class="results stagger">${rows}</div>`;
}
function nameScreen() {
  tabs.innerHTML = ''; S.me = null; S.admin = false;
  const el = put(`<div class="name-wrap">
    <div class="row" style="gap:14px;margin-bottom:16px"><img class="name-logo" src="img/icon-192.png" alt="BAMP!"><h1 class="h1">名前を選択</h1></div>
    <label class="glass field">${icon('search')}<input data-testid="name-input" id="q" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="名前で絞り込み 例: 中西"></label>
    <div class="results stagger" id="results" data-testid="results"></div><div id="roster" data-testid="roster"></div></div>`, 'name');
  const q = el.querySelector('#q'), box = el.querySelector('#results'), roster = el.querySelector('#roster'); let t, seq = 0;
  const draw = () => { roster.innerHTML = S.ix ? rosterHTML() : '<div class="glass empty">データを読み込めません</div>'; S.nameKey = S.ix ? locKey() : ''; };
  draw(); S.nameRefresh = draw;
  const run = async () => {
    const v = q.value.trim(); const my = ++seq; if (!v) { box.innerHTML = ''; roster.style.display = ''; return; }
    box.innerHTML = `<div class="glass person" style="--i:0">${sk('42px', '42px', 'border-radius:50%')}<div style="flex:1">${sk('50%', '16px')}</div></div>`;
    let r;
    if (S.demo) r = ['管理者', 'かんりしゃ', 'admin'].includes(v.toLowerCase().replace(/\s/g, '')) ? { admin: true, pinRequired: false } : { results: searchMembers(v, S.data.members) };
    else try { r = await api('/search?q=' + encodeURIComponent(v)); } catch { r = { results: [], error: true }; }
    if (my !== seq) return;
    roster.style.display = r.admin || r.results?.length ? 'none' : '';      // 該当なしの時は一覧から選べるように残す
    if (r.admin) { box.innerHTML = `<button class="glass person press" style="--i:0" data-act="admin-ask" data-pin="${r.pinRequired ? 1 : 0}" data-testid="result-admin"><span class="avatar" style="background:linear-gradient(135deg,#ff6a3d,#f4260f)">管</span><div><b>管理者</b><div class="small muted">スケジュール変更・コメント</div></div></button>`; return; }
    box.innerHTML = r.results.length ? r.results.map((m, i) => `<button class="glass person press" style="--i:${i}" data-act="pick" data-id="${m.id}" data-testid="result"><span class="avatar">${esc(M.initial(m.name))}</span>
      <div style="flex:1;min-width:0"><b>${esc(m.name)}</b><div class="small muted">${esc(m.grp)} ${esc(m.role)}</div></div></button>`).join('')
      : `<div class="glass empty" style="--i:0;margin-bottom:12px" data-testid="no-result">${r.error ? '接続できません' : '該当する名前が見つかりません。下の一覧から選べます'}</div>`;
  };
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(t); run().then(() => box.querySelector('[data-act]')?.click()); } });
}
function confirmSheet(m) {
  openSheet(`<div style="text-align:center;padding:6px 4px 4px"><div style="display:flex;justify-content:center;margin-bottom:12px"><span class="avatar" style="width:64px;height:64px;font-size:26px">${esc(M.initial(m.name))}</span></div>
    <div class="h1" data-testid="confirm-name">${esc(m.name)}</div><div class="muted" style="margin:6px 0 20px">${esc(m.grp)} ${esc(m.role)}</div>
    <div class="row" style="justify-content:center"><button class="btn ghost" data-act="close">違う</button><button class="btn" data-act="confirm" data-id="${m.id}" data-testid="confirm-yes">この人で開く</button></div></div>`, { center: true });
}
function adminSheet(pin) {
  openSheet(`<div style="padding:4px"><div class="h1" style="margin-bottom:14px">管理者</div>${pin ? '<input class="inp" id="pin" data-testid="pin" type="password" inputmode="numeric" placeholder="PIN" style="margin-bottom:14px">' : '<div class="muted" style="margin-bottom:16px">管理者として開きます</div>'}
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="close">戻る</button><button class="btn" data-act="admin-go" data-testid="admin-go">開く</button></div></div>`, { center: true });
}

/* ---------- 画面共通 ---------- */
const TABS = { member: [['schedule', '予定', 'cal'], ['areas', 'エリア', 'map'], ['comms', '連絡', 'bell']], admin: [['live', 'ライブ', 'live'], ['members', 'メンバー', 'users'], ['comms', '連絡', 'bell']] };
function unseen() { const me = S.me; return S.data.comments.filter(c => c.id > S.seenId && (c.member_id === null || c.member_id === me)).length; }
function renderTabs() {
  const list = TABS[S.admin ? 'admin' : 'member']; const i = Math.max(0, list.findIndex(t => t[0] === S.tab));
  tabs.className = 'tabbar glass'; tabs.style.setProperty('--n', list.length); tabs.style.setProperty('--i', i);
  const n = S.admin ? 0 : unseen();
  tabs.innerHTML = list.map(([k, l, ic]) => `<button class="${k === S.tab ? 'on' : ''}" data-act="tab" data-tab="${k}" data-testid="tab-${k}">${icon(ic)}${l}${k === 'comms' && n ? `<span class="badge" data-testid="badge">${n}</span>` : ''}</button>`).join('');
}
const meRec = () => S.ix.byId.get(S.me);
function header() {
  const m = S.admin ? { name: '管理者' } : meRec(); const now = S.clock.now(); const j = M.jst(now);
  return `<div class="top"><button class="avatar press" data-act="logout" data-testid="logout" style="${S.admin ? 'background:linear-gradient(135deg,#ff6a3d,#f4260f)' : ''}">${esc(S.admin ? '管' : M.initial(m.name))}</button>
    <div style="flex:1;min-width:0"><div class="who" data-testid="who">${esc(m.name)}</div>${S.demo ? '<span class="offline" data-testid="demo-chip">デモデータ</span>' : ''}${S.offline ? '<span class="offline">オフライン</span>' : ''}${S.clock.simulated ? '<span class="offline" style="margin-left:4px">テスト時刻</span>' : ''}</div>
    <div class="glass clock num" id="clock" data-testid="clock">${String(j.h).padStart(2, '0')}:${String(j.mi).padStart(2, '0')}</div></div>`;
}
const slotRange = s => `${s.start}${s.end ? '–' + s.end : '〜'}`;
const slotOf = (day, i) => S.ix.slotsByDay[day][i];
const dayLabel = d => `10/${d}`;

/* ---------- 予定 ---------- */
function scheduleHTML() {
  const ix = S.ix, me = meRec(), now = S.clock.now(), loc = M.locate(ix, now);
  const ref = loc.state === 'after' ? { day: 25, idx: ix.slotsByDay[25].length - 1 } : loc;
  const rs = slotOf(ref.day, ref.idx), act = M.attends(me, ref.day) ? M.actOf(ix, me.id, ref.day, ref.idx) : { raw: '', kind: 'free', tokens: [], label: '参加なし' };
  const c = colorOf(act), base = act.tokens[0] && baseOf(act.tokens[0]);
  const label = loc.state === 'during' ? '<span class="live"><i></i>いま</span>' : loc.state === 'before' ? '<span class="label">次の予定</span>' : '<span class="label">終了</span>';
  const ent = M.entryOf(ix, me.id, ref.day, ref.idx);
  let prog = '';
  if (loc.state === 'during') { const tot = rs.endAt - rs.startAt, pct = Math.min(100, Math.max(0, (now - rs.startAt) / tot * 100));
    prog = `<div class="bar" style="--c:${c}"><b id="prog" style="width:${pct}%"></b></div><div class="row small muted num"><span>${rs.start}</span><span class="sp"></span><b id="remain" data-testid="remain" style="color:var(--ink)">残り ${M.fmtRemain(rs.endAt - now)}</b></div>`; }
  else if (loc.state === 'before') { const d = rs.startAt - now;
    prog = `<div class="row small" style="margin-top:12px"><b class="num" id="remain" data-testid="remain">${d > 12 * 36e5 ? `${dayLabel(ref.day)} ${rs.start} 開始` : `開始まで ${M.fmtRemain(d)}`}</b></div>`; }
  let team = '';
  if (act.tokens.length) { const mem = M.membersAt(ix, ref.day, ref.idx, act.tokens[0]); const cap = M.captainOfToken(S.data, act.tokens[0]) || M.captainsOfBase(S.data, base)[0];
    team = `<button class="team press" data-act="slot" data-day="${ref.day}" data-idx="${ref.idx}" data-testid="team"><div class="stack">${mem.slice(0, 5).map(x => avatar(x, 'sm')).join('')}${mem.length > 5 ? `<span class="avatar sm more">+${mem.length - 5}</span>` : ''}</div>
      <div class="small" style="flex:1"><b>${mem.length}人</b> · Captain ${cap ? esc(M.lastName(cap.name)) : '未設定'}</div><span class="muted">›</span></button>`; }
  const nx = loc.next && loc.state === 'during' ? loc.next : null; let nextHTML = '';
  if (nx) { const na = M.attends(me, nx.day) ? M.actOf(ix, me.id, nx.day, nx.idx) : PA(''); const ns = slotOf(nx.day, nx.idx);
    nextHTML = `<div class="glass next" data-testid="next">${glyph(na, 36)}<div style="flex:1"><div class="small muted">次 ${ns.start}</div><b>${esc(na.label)}</b></div></div>`; }
  const hero = `<div class="glass hero" data-testid="hero" style="--c:${c}"><div class="row">${label}<span class="sp"></span><span class="chip num">${dayLabel(ref.day)} ${slotRange(rs)}</span></div>
    <div class="row" style="margin-top:12px;gap:14px">${glyph(act, 56)}<div class="title" data-testid="hero-title" style="margin:0">${esc(act.label)}</div></div>
    ${base ? `<div class="desc" style="margin-top:10px">${esc(AREAS[base].desc)}</div>` : ''}${prog}
    ${ent?.n ? `<div class="note" data-testid="hero-note">${esc(ent.n)}</div>` : ''}${base ? mapHTML(act.tokens, { label: act.tokens.join(' → ') }) : ''}${team}</div>${nextHTML}`;
  const tl = ix.slotsByDay[S.day].map((s, i) => {
    const a = M.attends(me, S.day) ? M.actOf(ix, me.id, S.day, i) : PA(''); const e = M.entryOf(ix, me.id, S.day, i);
    const st = loc.state === 'during' && loc.day === S.day && loc.idx === i ? 'now' : (now >= s.endAt ? 'past' : '');
    return `<button class="glass slot press ${st}" style="--c:${colorOf(a)};--i:${i}" data-act="slot" data-day="${S.day}" data-idx="${i}" data-testid="row">
      <div class="t num">${s.start}<small>${s.end ? '–' + s.end : '〜'}</small></div>${glyph(a, 40)}
      <div style="flex:1;min-width:0"><div class="nm">${esc(a.label)}</div>${a.tokens[0] ? `<div class="sub">${esc(AREAS[baseOf(a.tokens[0])].jp)}</div>` : ''}${e?.n ? `<div class="bubble">${esc(e.n)}</div>` : ''}</div>
      ${st === 'now' ? '<span class="tag">いま</span>' : ''}</button>`; }).join('');
  const seg = `<div class="seg glass" style="--i:${S.day === 24 ? 0 : 1}" data-testid="days"><button class="${S.day === 24 ? 'on' : ''}" data-act="day" data-day="24" data-testid="day-24">10/24</button><button class="${S.day === 25 ? 'on' : ''}" data-act="day" data-day="25" data-testid="day-25">10/25</button></div>`;
  const absent = !M.attends(me, S.day) ? `<div class="glass empty">この日は参加なし</div>` : `<div class="tl stagger" data-testid="timeline">${tl}</div>`;
  return header() + `<div class="stagger"><div style="--i:0">${hero}</div></div>` + `<div class="h2">タイムライン</div>` + seg + absent;
}

/* ---------- チーム/エリア シート ---------- */
function teamSheet(day, idx) {
  const ix = S.ix, me = S.admin ? null : meRec(), s = slotOf(day, idx);
  const refMember = me || null; const act = refMember ? M.actOf(ix, refMember.id, day, idx) : PA('');
  return sheetFor(day, idx, act.tokens.length ? act.tokens : null, act.raw, s);
}
function sheetFor(day, idx, tokens, raw, s = slotOf(day, idx)) {
  const ix = S.ix, me = S.admin ? null : meRec();
  const head = `<div class="row" style="margin-bottom:14px"><div style="flex:1"><div class="small muted num">${dayLabel(day)} ${slotRange(s)}</div></div><button class="btn ghost sm" data-act="close">閉じる</button></div>`;
  const pill = m => `<span class="pill ${M.isCaptainOf(m, tokens?.[0] || '') ? 'cap' : ''}" data-testid="member-pill">${avatar(m, 'sm')}${esc(m.name)}${me && m.id === me.id ? '<span class="chip">あなた</span>' : ''}${m.captain_of && tokens && tokens.some(t => M.isCaptainOf(m, t)) ? '<span class="chip cap">Captain</span>' : ''}</span>`;
  let body = '';
  if (tokens) body = tokens.map(t => { const b = baseOf(t), mem = M.membersAt(ix, day, idx, t);
    const caps = /[ⅠⅡ]$/.test(t) ? [M.captainOfToken(S.data, t)].filter(Boolean) : M.captainsOfBase(S.data, b);
    return `<div style="margin-bottom:18px" data-testid="area-section"><div class="row" style="gap:12px">${glyph(t, 48)}<div><div class="h1" style="font-size:22px">${esc(t)}</div><div class="small muted">${esc(AREAS[b].jp)}</div></div></div>
      <div class="desc" style="margin:10px 0;line-height:1.6;font-size:14px">${esc(AREAS[b].desc)}</div>
      ${AREAS[b].video ? `<a class="btn sm ghost" href="${AREAS[b].video}" target="_blank" rel="noopener" data-testid="video">麻紐の縛り方動画</a>` : ''}
      ${mapHTML([t], { label: t })}
      <div class="h2" style="margin-top:16px">Captain</div>${caps.length ? caps.map(c => `<span class="pill cap" data-testid="captain-pill">${avatar(c, 'sm')}${esc(c.name)}</span>`).join('') : '<span class="muted small">未設定</span>'}
      <div class="h2">同じエリアのメンバー（${mem.length}人）</div>${mem.map(pill).join('') || '<span class="muted small">なし</span>'}</div>`; }).join('');
  else { const mem = ix.data.members.filter(m => M.attends(m, day) && M.actOf(ix, m.id, day, idx).raw === raw);
    body = `<div class="h1" style="font-size:22px;margin-bottom:6px">${esc(raw || '予定なし')}</div><div class="h2">同じ予定のメンバー（${mem.length}人）</div>${mem.map(pill).join('')}`; }
  openSheet(head + body);
}
function areaSheet(base) {
  const loc = M.locate(S.ix, S.clock.now()); const day = loc.day || 25, idx = loc.idx ?? 0;
  const tokens = [...new Set(S.data.members.flatMap(m => M.attends(m, day) ? M.actOf(S.ix, m.id, day, idx).tokens : []).filter(t => baseOf(t) === base))];
  sheetFor(day, idx, tokens.length ? tokens : [base], '');
}

/* ---------- エリア / 連絡 ---------- */
function areasHTML() {
  const ix = S.ix, loc = M.locate(ix, S.clock.now()), day = loc.day || 25, idx = loc.idx ?? 0, me = meRec();
  const mine = M.attends(me, day) ? M.actOf(ix, me.id, day, idx).tokens : [];
  const cards = M.AREA_ORDER.map((a, i) => { const caps = M.captainsOfBase(S.data, a), n = M.membersAt(ix, day, idx, a).length, A = AREAS[a];
    return `<button class="glass areacard press" style="--i:${i + 1}" data-act="area" data-area="${a}" data-testid="area-card"><div class="row" style="gap:12px">${glyph(a, 44)}<div style="flex:1"><div class="row"><b style="font-size:17px">${a}</b>${mine.some(t => baseOf(t) === a) ? '<span class="chip" style="color:#fff;background:' + A.color + '">あなた</span>' : ''}<span class="sp"></span><span class="chip num">${n}人</span></div><div class="small muted">${esc(A.jp)}</div></div></div>
      <div class="small" style="margin-top:10px;color:#344054;line-height:1.55">${esc(A.desc)}</div><div style="margin-top:8px">${caps.length ? caps.map(c => `<span class="chip cap">Captain ${esc(M.lastName(c.name))}${c.captain_of.includes('-') ? ' ' + c.captain_of.slice(-1) : ''}</span>`).join(' ') : '<span class="chip">Captain 未設定</span>'}</div></button>`; }).join('');
  return header() + `<div class="stagger"><div style="--i:0"><div class="glass" style="padding:10px">${mapHTML(mine.length ? mine : [], { all: true })}</div></div>${cards}</div>`.replace('<div class="stagger">', '<div class="stagger" style="margin-top:14px">');
}
function commsHTML() {
  const me = S.admin ? null : meRec(); const list = S.data.comments.filter(c => S.admin || c.member_id === null || c.member_id === me.id).slice().reverse(); const seen = S.seenId;
  const who = c => c.member_id === null ? '全員' : (S.ix.byId.get(c.member_id)?.name || '');
  const dt = c => { const j = M.jst(new Date(c.created_at)); return `${j.mo}/${j.d} ${String(j.h).padStart(2, '0')}:${String(j.mi).padStart(2, '0')}`; };
  const msgs = list.map((c, i) => `<div class="glass msg ${!S.admin && c.id > seen ? 'new' : ''}" style="--i:${i + 1}" data-testid="msg"><div class="meta num">${dt(c)} · ${S.admin ? '宛先 ' + esc(who(c)) : (c.member_id === null ? '全員へ' : 'あなたへ')}</div><div style="font-weight:600;line-height:1.55">${esc(c.text)}</div>
    ${S.admin ? `<button class="btn ghost sm" style="margin-top:10px" data-act="del-comment" data-id="${c.id}">削除</button>` : ''}</div>`).join('') || '<div class="glass empty" style="--i:1">連絡はありません</div>';
  let top = '';
  if (S.admin) top = `<div class="glass card" style="--i:0"><div class="h2" style="margin:0 0 8px">コメントを送る</div><select class="inp" id="c-to" data-testid="c-to"><option value="">全員</option>${S.data.members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
    <textarea class="inp" id="c-text" data-testid="c-text" maxlength="300" style="margin-top:10px" placeholder="内容"></textarea><div class="row" style="margin-top:10px"><button class="btn ghost sm" data-act="polish" data-testid="polish">AIで整える</button><span class="sp"></span><button class="btn sm" data-act="send" data-testid="send">送信</button></div></div>`;
  else { const t = `<div class="glass card" style="--i:0"><div class="h2" style="margin:0 0 4px">移動</div><div class="kv"><span>行き便</span><b>${esc(me.car_out || '—')}</b></div><div class="kv"><span>帰り便</span><b>${esc(me.car_in || '—')}</b></div>
      <div class="kv"><span>10/24</span><b>${esc(me.att1 === '○' ? '参加' : me.att1 || '参加なし')}</b></div><div class="kv"><span>10/25</span><b>${esc(me.att2 === '○' ? '参加' : me.att2 || '参加なし')}</b></div></div>`; top = t; }
  return header() + `<div class="stagger">${top}${msgs}</div>`;
}

/* ---------- 管理者 ---------- */
function liveHTML() {
  const ix = S.ix; const sel = S.sel, s = slotOf(sel.day, sel.idx); const groups = new Map();
  for (const m of S.data.members) { if (!M.attends(m, sel.day)) continue; const a = M.actOf(ix, m.id, sel.day, sel.idx); const k = a.raw || '予定なし'; if (!groups.has(k)) groups.set(k, { a, mem: [] }); groups.get(k).mem.push(m); }
  const ord = ([k, g]) => g.tokens ? 0 : (g.a.tokens.length ? 1 + M.AREA_ORDER.indexOf(baseOf(g.a.tokens[0])) : (g.a.kind === 'free' ? 99 : 10));
  const cards = [...groups.entries()].sort((x, y) => ord(x) - ord(y) || x[0].localeCompare(y[0])).map(([k, g], i) => `<div class="glass agroup" style="--i:${i + 1}" data-testid="group"><div class="row" style="gap:10px">${glyph(g.a, 36)}<b style="font-size:16px">${esc(k)}</b><span class="sp"></span><span class="chip num">${g.mem.length}人</span></div>
    <div>${g.mem.map(m => `<button class="pill ${g.a.tokens.some(t => M.isCaptainOf(m, t)) ? 'cap' : ''}" data-act="edit" data-id="${m.id}" data-testid="pill">${avatar(m, 'sm')}${esc(m.name)}</button>`).join('')}</div></div>`).join('');
  const flat = [...ix.slotsByDay[24], ...ix.slotsByDay[25]]; const k = flat.findIndex(x => x.day === sel.day && x.idx === sel.idx);
  return header() + `<div class="nav-slot"><button class="btn ghost sm" data-act="slot-nav" data-d="-1" data-testid="prev">‹</button><div class="glass" style="flex:1;text-align:center;padding:10px;font-weight:800" data-testid="sel-slot"><span class="num">${dayLabel(sel.day)} ${slotRange(s)}</span></div><button class="btn ghost sm" data-act="slot-nav" data-d="1" data-testid="next-slot">›</button><button class="btn sm" data-act="slot-now">いま</button></div><div class="stagger">${cards}</div>`;
}
function membersHTML() {
  const rows = S.data.members.map((m, i) => { const loc = M.locate(S.ix, S.clock.now()); const a = M.attends(m, loc.day || 24) ? M.actOf(S.ix, m.id, loc.day || 24, loc.idx ?? 0) : PA('');
    return `<button class="glass person press" style="--i:${i}" data-act="edit" data-id="${m.id}" data-testid="mrow" data-name="${esc(m.name)}">${avatar(m)}<div style="flex:1;min-width:0"><b>${esc(m.name)}</b><div class="small muted">${esc(m.role)}</div></div>${glyph(a, 32)}<span class="chip">${esc(a.label)}</span></button>`; }).join('');
  return header() + `<label class="glass field" style="margin-bottom:12px">${icon('search')}<input id="mq" data-testid="mq" placeholder="絞り込み" autocomplete="off"></label><div class="results stagger" id="mlist">${rows}</div>`;
}
function editor(id, st = { day: 24, pending: {} }) {
  const ix = S.ix, m = ix.byId.get(id), day = st.day;
  const opts = [...new Set(S.data.entries.map(e => e.a).filter(Boolean))].sort((a, b) => { const pa = PA(a), pb = PA(b); const o = p => p.tokens.length ? M.AREA_ORDER.indexOf(baseOf(p.tokens[0])) : 9; return o(pa) - o(pb) || a.localeCompare(b); });
  const rows = ix.slotsByDay[day].map((s, i) => { const key = `${day}:${i}`, cur = st.pending[key] || { a: M.entryOf(ix, id, day, i)?.a || '', n: M.entryOf(ix, id, day, i)?.n || '' };
    const orig = M.entryOf(ix, id, day, i); const changed = (orig?.a || '') !== cur.a || (orig?.n || '') !== cur.n; const known = !cur.a || opts.includes(cur.a);
    return `<div class="ed-row ${changed ? 'changed' : ''}" data-key="${key}"><div class="num" style="font-weight:800;padding-top:10px">${s.start}</div><div>
      <select data-f="a" data-testid="ed-sel-${i}"><option value="">予定なし</option>${(known ? opts : [...opts, cur.a]).map(o => `<option ${o === cur.a ? 'selected' : ''}>${esc(o)}</option>`).join('')}<option value="__c">その他（入力）</option></select>
      <input class="note-in" data-f="n" data-testid="ed-note-${i}" maxlength="200" placeholder="コメント" value="${esc(cur.n)}"></div></div>`; }).join('');
  const html = `<div class="row" style="margin-bottom:10px"><div style="flex:1"><div class="h1" style="font-size:22px">${esc(m.name)}</div><div class="small muted">${esc(m.role)}</div></div><button class="btn ghost sm" data-act="close">閉じる</button></div>
    <div class="seg glass" style="--i:${day === 24 ? 0 : 1}"><button class="${day === 24 ? 'on' : ''}" data-act="ed-day" data-day="24">10/24</button><button class="${day === 25 ? 'on' : ''}" data-act="ed-day" data-day="25">10/25</button></div>
    <div data-testid="editor-rows">${rows}</div><div class="row" style="margin-top:16px"><button class="btn ghost sm" data-act="edit-comment" data-id="${id}">この人にコメント</button><span class="sp"></span><button class="btn" data-act="ed-save" data-testid="ed-save">保存</button></div>`;
  const el = sheetEl || openSheet('');
  el.innerHTML = '<div class="grab"></div>' + html; el._st = { id, ...st };
}

/* ---------- ナビゲーション ---------- */
async function go(tab, { skel = true } = {}) {
  S.tab = tab; renderTabs();
  const kind = tab; if (skel) { putSkeleton(kind); await Promise.all([sleep(450), S.data ? 0 : refresh()]); }
  paint(); if (tab === 'comms' && !S.admin) { const mx = Math.max(0, ...S.data.comments.map(c => c.id)); S.seenId = mx; LS.set('bamp:seen:' + S.me, mx); renderTabs(); }
}
function paint() {
  const keep = view.firstElementChild?.scrollTop || 0;
  const html = { schedule: scheduleHTML, areas: areasHTML, comms: commsHTML, live: liveHTML, members: membersHTML }[S.tab]();
  const el = put(html, S.tab); if (keep) el.style.animation = 'none', el.scrollTop = keep;
  S.lastKey = locKey();
}
const locKey = () => { const l = M.locate(S.ix, S.clock.now()); return `${l.state}:${l.day}:${l.idx}`; };
async function enter(id, admin = false) {
  S.me = id; S.admin = admin; S.nameRefresh = null; const loc = S.ix ? M.locate(S.ix, S.clock.now()) : {}; S.day = loc.day || 24; S.sel = { day: loc.day || 24, idx: loc.idx ?? 0 };
  S.seenId = admin ? 0 : (LS.get('bamp:seen:' + id) || 0); S.tab = admin ? 'live' : 'schedule'; S.myHash = myHash();
  await go(S.tab);
}
const myHash = () => S.admin || !S.data ? '' : JSON.stringify(S.data.entries.filter(e => e.m === S.me));

/* ---------- イベント ---------- */
document.addEventListener('click', async e => {
  const a = e.target.closest('[data-act]'); if (!a) return; const d = a.dataset;
  if (S.demo && ['ed-save', 'send', 'del-comment', 'polish'].includes(d.act)) return toast('デモ表示のため保存・送信はできません');
  const act = {
    close: () => closeSheet(),
    pick() { confirmSheet(S.data?.members.find(m => m.id === +d.id) || { id: +d.id, name: a.querySelector('b').textContent, grp: '', role: '' }); },
    async confirm() { closeSheet(); LS.set('bamp:me', +d.id); LS.del('bamp:admin'); await enter(+d.id); },
    'admin-ask': () => adminSheet(d.pin === '1'),
    async 'admin-go'() { if (S.demo) { closeSheet(); await enter(0, true); return; } try { const r = await api('/admin/login', { method: 'POST', body: JSON.stringify({ pin: document.getElementById('pin')?.value || '' }) }); S.token = r.token || ''; LS.set('bamp:admin', { token: S.token }); LS.del('bamp:me'); closeSheet(); await enter(0, true); } catch { toast('PINが違います'); } },
    tab: async () => { if (S.tab !== d.tab) await go(d.tab); },
    day: () => { S.day = +d.day; paint(); },
    slot: () => teamSheet(+d.day, +d.idx),
    area: () => areaSheet(d.area),
    logout: () => openSheet(`<div style="text-align:center;padding:4px"><div class="h1" style="margin-bottom:16px">別の人で開く</div><div class="row" style="justify-content:center"><button class="btn ghost" data-act="close">キャンセル</button><button class="btn" data-act="logout-ok" data-testid="logout-ok">切り替える</button></div></div>`, { center: true }),
    async 'logout-ok'() { closeSheet(true); LS.del('bamp:me'); LS.del('bamp:admin'); S.token = ''; putSkeleton('name'); await sleep(450); nameScreen(); },
    'slot-nav': () => { const flat = [...S.ix.slotsByDay[24], ...S.ix.slotsByDay[25]]; let k = flat.findIndex(x => x.day === S.sel.day && x.idx === S.sel.idx) + +d.d; k = Math.min(flat.length - 1, Math.max(0, k)); S.sel = { day: flat[k].day, idx: flat[k].idx }; paint(); },
    'slot-now': () => { const l = M.locate(S.ix, S.clock.now()); S.sel = { day: l.day || 24, idx: l.idx ?? 0 }; paint(); },
    edit: () => editor(+d.id),
    'ed-day': () => { const st = sheetEl._st; editor(st.id, { day: +d.day, pending: st.pending }); },
    'edit-comment': () => { closeSheet(true); go('comms').then(() => { document.getElementById('c-to').value = d.id; }); },
    async 'ed-save'() { const st = sheetEl._st, ch = Object.entries(st.pending).map(([k, v]) => { const [dy, i] = k.split(':'); return { member_id: st.id, day: +dy, idx: +i, activity: v.a, note: v.n }; });
      if (!ch.length) { closeSheet(); return; } try { await api('/entries', { method: 'PUT', body: JSON.stringify({ changes: ch }) }); closeSheet(); toast('保存しました'); await refresh(); paint(); } catch { toast('保存できませんでした'); } },
    async send() { const text = document.getElementById('c-text').value.trim(), to = document.getElementById('c-to').value; if (!text) return toast('内容を入力してください');
      try { await api('/comments', { method: 'POST', body: JSON.stringify({ member_id: to ? +to : null, text }) }); toast('送信しました'); await refresh(); paint(); } catch { toast('送信できませんでした'); } },
    async 'del-comment'() { try { await api('/comments/' + d.id, { method: 'DELETE' }); await refresh(); paint(); } catch { toast('削除できませんでした'); } },
    async polish() { const t = document.getElementById('c-text'); if (!t.value.trim()) return; a.disabled = true; try { const r = await api('/ai/polish', { method: 'POST', body: JSON.stringify({ text: t.value }) }); t.value = r.text; } catch { toast('AIは現在利用できません'); } a.disabled = false; },
  }[d.act]; if (act) act();
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'mq') { const q = t.value.trim().toLowerCase(); document.querySelectorAll('#mlist [data-testid=mrow]').forEach(r => { r.style.display = !q || r.dataset.name.toLowerCase().includes(q) ? '' : 'none'; }); }
  const row = t.closest?.('.ed-row'); if (row && sheetEl?._st) {
    const st = sheetEl._st, key = row.dataset.key, [dy, i] = key.split(':'); const o = M.entryOf(S.ix, st.id, +dy, +i);
    const cur = st.pending[key] || { a: o?.a || '', n: o?.n || '' };
    if (t.dataset.f === 'a') { if (t.value === '__c') { const v = prompt('予定名'); cur.a = v ? v.slice(0, 60) : (o?.a || ''); } else cur.a = t.value; }
    if (t.dataset.f === 'n') cur.n = t.value;
    st.pending[key] = cur; if (t.dataset.f === 'a') editor(st.id, { day: st.day, pending: st.pending }); else row.classList.add('changed');
  }
});

/* ---------- 常時更新 ---------- */
function tick() {
  if (!S.ix) return;
  if (!S.me && !S.admin) { if (S.nameRefresh && S.nameKey !== locKey() && !document.querySelector('[data-testid=skeleton]')) S.nameRefresh(); return; }
  const now = S.clock.now(), j = M.jst(now), ck = document.getElementById('clock'); if (ck) ck.textContent = `${String(j.h).padStart(2, '0')}:${String(j.mi).padStart(2, '0')}`;
  if (locKey() !== S.lastKey && !sheetEl && document.querySelector('[data-testid=skeleton]') === null) { paint(); return; }
  if (S.tab === 'schedule') { const loc = M.locate(S.ix, now); if (loc.state === 'during') { const s = slotOf(loc.day, loc.idx);
    const p = document.getElementById('prog'), r = document.getElementById('remain'); if (p) p.style.width = Math.min(100, (now - s.startAt) / (s.endAt - s.startAt) * 100) + '%'; if (r) r.textContent = '残り ' + M.fmtRemain(s.endAt - now); } }
}
async function poll() {
  if (!S.ix) return; const was = S.offline, changed = await refresh();
  if (!changed) { if (was !== S.offline && (S.me || S.admin) && !sheetEl && !document.querySelector('[data-testid=skeleton]')) paint(); return; }
  if (!S.me && !S.admin) return;
  if (!S.admin) { const h = myHash(); if (h !== S.myHash) { S.myHash = h; toast('予定が更新されました'); }
    if (unseen() > 0 && S.tab !== 'comms') toast('新しい連絡があります'); }
  renderTabs(); const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  const composing = S.admin && S.tab === 'comms' && !!document.getElementById('c-text')?.value;      // 入力途中の文面を消さない
  if (!sheetEl && !composing && !(typing && view.contains(document.activeElement)) && !document.querySelector('[data-testid=skeleton]')) paint();
  if (!S.admin && S.tab === 'comms') { const mx = Math.max(0, ...S.data.comments.map(c => c.id)); S.seenId = mx; LS.set('bamp:seen:' + S.me, mx); }
}

/* ---------- 起動 ---------- */
(async function boot() {
  const t0 = performance.now();
  const loaded = refresh(); putSkeleton('name');
  await Promise.all([loaded, sleep(Math.max(0, 1600 - (performance.now() - t0)))]);
  document.getElementById('splash').classList.add('hide');
  await sleep(750);
  const adm = LS.get('bamp:admin'), me = LS.get('bamp:me');
  if (S.ix && adm) { S.token = adm.token || ''; await enter(0, true); }
  else if (S.ix && me && S.ix.byId.has(me)) await enter(me);
  else nameScreen();
  setInterval(tick, 1000); setInterval(poll, 5000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
