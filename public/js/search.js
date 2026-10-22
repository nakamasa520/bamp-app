// 「完全一致ではなく概ね合っている」名前検索。依存なし・決定的。
const VARIANTS = { '髙':'高','﨑':'崎','﨑':'崎','櫻':'桜','廣':'広','舩':'船','邊':'辺','邉':'辺','澤':'沢','齋':'斎','齊':'斉','濱':'浜','德':'徳','國':'国','傳':'伝','龍':'竜','隆':'隆' };
export function norm(s = '') {
  let t = String(s).normalize('NFKC').toLowerCase().replace(/[\s\u3000・･\-ー_]/g, '');
  t = t.replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)); // カナ→かな
  return [...t].map(c => VARIANTS[c] || c).join('');
}
const grams = (s, n) => { const a = []; for (let i = 0; i <= s.length - n; i++) a.push(s.slice(i, i + n)); return a; };
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
function scoreOne(q, t) {
  if (!q || !t) return 0;
  if (q === t) return 1;
  if (t.includes(q)) return 0.78 + 0.2 * (q.length / t.length);
  if (q.includes(t) && t.length >= 2) return 0.7;
  const L = 1 - lev(q, t) / Math.max(q.length, t.length);                  // 編集距離（打ち間違い）
  const bg = grams(q, 2), tg = grams(t, 2);
  const dice = bg.length && tg.length ? 2 * bg.filter(g => tg.includes(g)).length / (bg.length + tg.length) : 0;
  const qs = new Set(q), ts = new Set(t);                                    // 文字の重なり（漢字1字違い等）
  const jac = [...qs].filter(c => ts.has(c)).length / new Set([...qs, ...ts]).size;
  return Math.max(L * 0.95, dice * 0.9, jac * 0.75);
}
export function searchMembers(query, members) {
  const q = norm(query);
  if (!q) return [];
  const scored = members.map(m => {
    const parts = m.name.split(/[\s\u3000]+/).filter(Boolean);
    const reads = (m.reading || '').split(/\s+/).filter(Boolean);
    const targets = [norm(m.name), ...parts.map(norm), ...reads.map(norm), ...reads.map(r => norm(r) + (parts[1] ? norm(parts[1]) : ''))];
    const s = Math.max(...targets.map(t => scoreOne(q, t)));
    return { id: m.id, name: m.name, grp: m.grp, role: m.role, score: Math.round(s * 100) / 100 };
  }).filter(r => r.score >= 0.45).sort((a, b) => b.score - a.score || a.id - b.id);
  const strong = scored.length && scored[0].score >= 0.95;           // ほぼ完全一致があるなら、あいまい候補は出さない
  return scored.filter(r => !strong || r.score >= 0.9).slice(0, 6);
}
