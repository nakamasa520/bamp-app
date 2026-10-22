import { searchMembers } from './search.js';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const ADMIN_WORDS = ['管理者', 'かんりしゃ', 'admin', 'administrator', '管理人'];

async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(s)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function isAdmin(req, env) {
  if (!env.ADMIN_PIN) return true;                       // PIN未設定なら「管理者」と入力するだけで可（仕様どおり）
  return req.headers.get('x-admin-token') === await hmac(env.ADMIN_PIN, 'bamp-admin');
}
const bump = env => env.DB.prepare("UPDATE meta SET value = CAST(value AS INTEGER)+1 WHERE key='version'");
async function version(env) { return Number((await env.DB.prepare("SELECT value FROM meta WHERE key='version'").first())?.value || 1); }

async function aiRun(env, system, user) {
  if (env.AI_MOCK) return env.AI_MOCK === 'fail' ? null : mock(system, user);
  if (!env.AI) return null;
  try {
    const r = await env.AI.run(env.AI_MODEL || MODEL, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 200, temperature: 0 });
    return (r.response ?? r.result?.response ?? '').trim();
  } catch (e) { return null; }
}
// テスト用スタブ（AI_MOCK を設定した場合のみ。本番では使わない）
function mock(system, user) {
  if (system.includes('ID')) { const m = user.match(/入力: (.*)/)[1]; return m.includes('なかにし') || m.includes('nakanishi') ? '[1]' : '[]'; }
  return user.replace(/\s+/g, ' ').trim() + '【整形】';
}

async function loadAll(env) {
  const [members, slots, entries, comments] = await Promise.all([
    env.DB.prepare('SELECT * FROM members ORDER BY sort').all(),
    env.DB.prepare('SELECT * FROM slots ORDER BY day, idx').all(),
    env.DB.prepare('SELECT member_id m, day d, idx i, activity a, note n FROM entries').all(),
    env.DB.prepare('SELECT * FROM comments ORDER BY id').all(),
  ]);
  return { members: members.results, slots: slots.results, entries: entries.results, comments: comments.results };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url); const p = url.pathname;
    try {
      if (p === '/api/data' && req.method === 'GET') {
        const v = await version(env);
        if (url.searchParams.get('since') === String(v)) return json({ version: v, unchanged: true });
        return json({ version: v, ...(await loadAll(env)) });
      }
      if (p === '/api/search' && req.method === 'GET') {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) return json({ results: [] });
        if (ADMIN_WORDS.some(w => q.toLowerCase().replace(/\s/g, '') === w)) return json({ admin: true, pinRequired: !!env.ADMIN_PIN, results: [] });
        const members = (await env.DB.prepare('SELECT id,name,reading,grp,role FROM members').all()).results;
        let results = searchMembers(q, members), via = 'fuzzy';
        if (!results.length || results[0].score < 0.6) {          // 曖昧一致で足りない時だけ Workers AI（ひらがな/ローマ字/読み違い）
          const list = members.map(m => `[${m.id}] ${m.name}`).join('\n');
          const out = await aiRun(env, '名簿から、入力に最も近い人物のIDを最大3件、JSON配列で返す。ID以外は出力しない。該当なしは[]。', `名簿:\n${list}\n入力: ${q}`);
          const ids = (out?.match(/\d+/g) || []).map(Number).slice(0, 3);
          const ai = ids.map(id => members.find(m => m.id === id)).filter(Boolean).map(m => ({ id: m.id, name: m.name, grp: m.grp, role: m.role, score: 0.5 }));
          if (ai.length) { results = [...results, ...ai.filter(a => !results.some(r => r.id === a.id))]; via = 'ai'; }
        }
        return json({ results, via });
      }
      if (p === '/api/admin/login' && req.method === 'POST') {
        const { pin = '' } = await req.json().catch(() => ({}));
        if (!env.ADMIN_PIN) return json({ ok: true, token: '' });
        if (pin !== env.ADMIN_PIN) return json({ ok: false }, 401);
        return json({ ok: true, token: await hmac(env.ADMIN_PIN, 'bamp-admin') });
      }
      if (p.startsWith('/api/admin') || (req.method !== 'GET' && p.startsWith('/api/'))) {
        if (!(await isAdmin(req, env))) return json({ error: 'forbidden' }, 403);
      }
      if (p === '/api/entries' && req.method === 'PUT') {
        const { changes = [] } = await req.json();
        const now = new Date().toISOString();
        const st = env.DB.prepare('INSERT INTO entries(member_id,day,idx,activity,note,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(member_id,day,idx) DO UPDATE SET activity=excluded.activity, note=excluded.note, updated_at=excluded.updated_at');
        await env.DB.batch([...changes.map(c => st.bind(+c.member_id, +c.day, +c.idx, String(c.activity ?? '').slice(0, 60), String(c.note ?? '').slice(0, 200), now)), bump(env)]);
        return json({ ok: true, version: await version(env) });
      }
      if (p === '/api/comments' && req.method === 'POST') {
        const { member_id = null, text = '' } = await req.json();
        if (!String(text).trim()) return json({ error: 'empty' }, 400);
        await env.DB.batch([env.DB.prepare('INSERT INTO comments(member_id,text,created_at) VALUES(?,?,?)').bind(member_id, String(text).slice(0, 300), new Date().toISOString()), bump(env)]);
        return json({ ok: true, version: await version(env) });
      }
      const del = p.match(/^\/api\/comments\/(\d+)$/);
      if (del && req.method === 'DELETE') {
        await env.DB.batch([env.DB.prepare('DELETE FROM comments WHERE id=?').bind(+del[1]), bump(env)]);
        return json({ ok: true, version: await version(env) });
      }
      if (p === '/api/ai/polish' && req.method === 'POST') {
        const { text = '' } = await req.json();
        const out = await aiRun(env, 'イベント運営の連絡文を、事実を変えず、短く丁寧で分かりやすい日本語1〜2文に整える。前置きや装飾・キャッチコピーは付けない。', String(text).slice(0, 300));
        return out ? json({ text: out }) : json({ error: 'ai_unavailable' }, 503);
      }
      if (p.startsWith('/api/')) return json({ error: 'not_found' }, 404);
      return env.ASSETS.fetch(req);
    } catch (e) { return json({ error: 'server', message: String(e.message || e) }, 500); }
  },
};
