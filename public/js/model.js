// 純粋ロジック（時刻・エリア・チーム）。DOMに依存しない。
export const EVENT_YEAR = 2026, EVENT_MONTH = 10;
export const AREAS = {
  Square:   { color: '#f59e0b', jp: '切り出し・処理',   desc: 'チェーンソーで伐採された竹の不要上部を切り出し処理を行う', pin: [1172, 806] },
  Circle:   { color: '#f4260f', jp: '部材加工',         desc: '必要な部材を切り出し、穴を開け、パイプを差し込む',       pin: [995, 483] },
  Triangle: { color: '#2f7cf6', jp: '三角ユニット制作', desc: '部材を麻紐で固定し三角ユニットを制作する',               pin: [860, 285],
              video: 'https://drive.google.com/file/d/1sm_BJHntF_XeJe0J6rSg3e4krcsli5h1/view' },
  Hexagon:  { color: '#10b981', jp: 'ユニット組み合わせ', desc: '三角ユニット同士を組み合わせる',                       pin: [553, 358] },
  Pentagon: { color: '#8b5cf6', jp: 'Captain集合',      desc: 'Captainは集合し進捗を共有する',                         pin: [618, 672] },
};
export const AREA_ORDER = Object.keys(AREAS);
export const MAP_SIZE = [1890, 1063];
const TOKEN_RE = /(Square|Circle|Triangle|Hexagon(?:-?[ⅠⅡ])?|Pentagon)/g;
export const baseOf = t => t.replace(/-?[ⅠⅡ]$/, '');

export function parseActivity(raw = '') {
  const a = String(raw || '').trim();
  const tokens = (a.match(TOKEN_RE) || []).map(t => t.replace(/^(Hexagon)([ⅠⅡ])$/, '$1-$2'));
  let kind = 'free';
  if (!a) kind = 'free';
  else if (tokens.length) kind = 'area';
  else if (/^Lunch/i.test(a)) kind = 'lunch';
  else if (/Chill/i.test(a)) kind = 'chill';
  else if (/撤収/.test(a)) kind = 'strike';
  else if (/八面山荘へ/.test(a)) kind = 'move';
  else if (/BBQ/i.test(a)) kind = 'party';
  else if (/現地発/.test(a)) kind = 'depart';
  else kind = 'work';
  return { raw: a, kind, tokens, label: a || '予定なし' };
}
export const KIND_COLOR = { lunch: '#f59e0b', chill: '#64748b', strike: '#475569', move: '#0ea5e9', party: '#f4260f', depart: '#64748b', work: '#d946ef', free: '#94a3b8', area: '#2f7cf6' };

// ---- 時刻 ----
const pad = n => String(n).padStart(2, '0');
export const toDate = (day, hm) => new Date(`${EVENT_YEAR}-${EVENT_MONTH}-${pad(day)}T${hm}:00+09:00`);
export function jst(d) { const p = new Date(d.getTime() + 9 * 3600e3); return { y: p.getUTCFullYear(), mo: p.getUTCMonth() + 1, d: p.getUTCDate(), h: p.getUTCHours(), mi: p.getUTCMinutes(), s: p.getUTCSeconds() }; }
export const hm = d => { const j = jst(d); return `${pad(j.h)}:${pad(j.mi)}`; };
export function fmtRemain(ms) {
  const m = Math.max(0, Math.ceil(ms / 60000));
  if (m >= 60) return `${Math.floor(m / 60)}時間${pad(m % 60)}分`;
  return `${m}分`;
}

/** time source: real clock, optionally shifted by ?t=2026-10-24T13:10 (リハーサル用) */
export function makeClock(search = '') {
  const t = new URLSearchParams(search).get('t');
  let offset = 0;
  const m = t && t.trim().match(/^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d)(:\d\d)?/);   // 時刻はJST固定で解釈
  if (m) { const target = new Date(`${m[1]}T${m[2]}${m[3] || ':00'}+09:00`); if (!isNaN(target)) offset = target.getTime() - Date.now(); }
  return { now: () => new Date(Date.now() + offset), simulated: !!t };
}

export function buildIndex(data) {
  const ent = new Map();
  for (const e of data.entries) ent.set(`${e.m}:${e.d}:${e.i}`, e);
  const slotsByDay = { 24: [], 25: [] };
  for (const s of data.slots) slotsByDay[s.day].push({ ...s, startAt: toDate(s.day, s.start), endAt: s.end ? toDate(s.day, s.end) : null });
  // 終了なしスロットの実効終了: 24日=翌日最初のスロット開始 / 25日=+2h
  const open = slotsByDay[24].at(-1); if (open) open.endAt = slotsByDay[25][0]?.startAt || new Date(open.startAt.getTime() + 36e5);
  const last = slotsByDay[25].at(-1); if (last) last.endAt = new Date(last.startAt.getTime() + 2 * 36e5);
  const byId = new Map(data.members.map(m => [m.id, m]));
  return { ent, slotsByDay, byId, data };
}
export const entryOf = (ix, mid, day, i) => ix.ent.get(`${mid}:${day}:${i}`);
export const actOf = (ix, mid, day, i) => parseActivity(entryOf(ix, mid, day, i)?.a || '');
export const attends = (m, day) => !!(day === 24 ? m.att1 : m.att2);

/** now の位置: {state:'before'|'during'|'after', day, idx, next:{day,idx}|null} */
export function locate(ix, now) {
  const flat = [...ix.slotsByDay[24], ...ix.slotsByDay[25]];
  if (!flat.length) return { state: 'after' };
  if (now < flat[0].startAt) return { state: 'before', day: flat[0].day, idx: flat[0].idx, next: { day: flat[0].day, idx: flat[0].idx } };
  for (let k = 0; k < flat.length; k++) {
    const s = flat[k];
    if (now >= s.startAt && now < s.endAt) { const n = flat[k + 1]; return { state: 'during', day: s.day, idx: s.idx, next: n ? { day: n.day, idx: n.idx } : null }; }
  }
  // スロット間の隙間（例: 24日夜〜25日朝は open スロットで埋まる）
  const nx = flat.find(s => s.startAt > now);
  return nx ? { state: 'before', day: nx.day, idx: nx.idx, next: { day: nx.day, idx: nx.idx } } : { state: 'after' };
}

// ---- チーム ----
export const captainsOfBase = (data, base) => data.members.filter(m => m.captain_of && baseOf(m.captain_of) === base);
export const captainOfToken = (data, token) => data.members.find(m => m.captain_of === token);
/** そのスロットで token に居るメンバー（Hexagon の base 指定は Ⅰ/Ⅱ 両方） */
export function membersAt(ix, day, idx, token) {
  const exact = /[ⅠⅡ]$/.test(token) || !AREAS[token] ? true : false;
  return ix.data.members.filter(m => attends(m, day) && actOf(ix, m.id, day, idx).tokens.some(t => exact ? t === token : baseOf(t) === token));
}
export const isCaptainOf = (m, token) => !!m.captain_of && (m.captain_of === token || baseOf(m.captain_of) === token);
export function lastName(n) { return n.split(/\s+/)[0]; }
export function initial(n) { const p = n.split(/\s+/); return (p[1] || p[0]).slice(0, 1); }
