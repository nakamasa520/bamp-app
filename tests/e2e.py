#!/usr/bin/env python3
"""実ブラウザ(Chromium/Playwright, スマホ表示)で操作するE2Eテスト。
   seed/real.json が必要（npm run seed）。サーバーは自動起動(:8799)・毎回DB初期化。"""
import os, sys, json, time, signal, subprocess, urllib.request
from playwright.sync_api import sync_playwright, expect

PORT = int(os.environ.get('PORT', 8799)); BASE = f'http://localhost:{PORT}'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = json.load(open(os.path.join(ROOT, 'seed/real.json')))
SHOTS = os.path.join(ROOT, 'tests/shots'); os.makedirs(SHOTS, exist_ok=True)
T = lambda s: f'{BASE}/?t={s}'            # 時刻シミュレーション(JST)
RESULTS = []

def start_server():
    try:
        urllib.request.urlopen(BASE + '/api/data', timeout=1); raise SystemExit(f'port {PORT} already in use: 別のサーバーが動いています')
    except (urllib.error.URLError, ConnectionError, OSError): pass
    env = dict(os.environ, PORT=str(PORT), PERSIST=f'/tmp/bamp-e2e-{PORT}')
    p = subprocess.Popen(['bash', os.path.join(ROOT, 'scripts/dev-test-server.sh')], env=env, stdout=open('/tmp/e2e-server.log', 'w'), stderr=subprocess.STDOUT, preexec_fn=os.setsid)
    for _ in range(60):
        try:
            if urllib.request.urlopen(BASE + '/api/data', timeout=2).status == 200: return p
        except Exception: time.sleep(1)
    raise RuntimeError('server did not start')

def case(name):
    def deco(fn):
        fn._name = name; RESULTS.append(fn); return fn
    return deco

def new_page(browser, **kw):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='ja-JP', timezone_id='Asia/Tokyo', service_workers='block', **kw)
    page = ctx.new_page(); page.errors = []
    page.on('console', lambda m: page.errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    return ctx, page

def login(page, query, name):
    page.goto(T(query) if query else BASE)
    page.get_by_test_id('name-input').fill(name)
    page.get_by_test_id('result').first.click()
    page.get_by_test_id('confirm-yes').click()
    expect(page.get_by_test_id('hero')).to_be_visible(timeout=8000)

def shot(page, n): page.screenshot(path=f'{SHOTS}/{n}.png')
def no_hscroll(page):
    return page.evaluate("()=>{const s=document.querySelector('.screen');return s.scrollWidth<=s.clientWidth+1 && document.documentElement.scrollWidth<=innerWidth+1}")

# ---------------------------------------------------------------- tests
@case('データ: 工程表とAPIが全セル一致')
def t_data(b):
    d = json.load(urllib.request.urlopen(BASE + '/api/data'))
    assert len(d['members']) == len(SEED['members']) == 24
    api = {(e['m'], e['d'], e['i']): e['a'] for e in d['entries']}
    for e in SEED['entries']: assert api[(e['member_id'], e['day'], e['idx'])] == e['activity'], e
    assert len(api) == len(SEED['entries'])

@case('起動: 即ロゴ → スケルトン → 名前入力 (注意書き/キャッチコピーなし)')
def t_boot(b):
    ctx, p = new_page(b)
    p.add_init_script("window.__seen={splash:false,skel:false};new MutationObserver(()=>{const s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))window.__seen.splash=true;if(document.querySelector('[data-testid=skeleton]'))window.__seen.skel=true}).observe(document,{subtree:true,childList:true,attributes:true})")
    p.goto(BASE, wait_until='commit')
    expect(p.locator('#splash')).to_be_visible(timeout=3000); p.wait_for_timeout(700); shot(p, '01-splash')
    expect(p.get_by_test_id('name-input')).to_be_visible(timeout=8000)
    expect(p.locator('#splash')).to_be_hidden()
    seen = p.evaluate('window.__seen'); assert seen['splash'] and seen['skel'], seen
    assert p.get_by_test_id('skeleton').count() == 0; assert 'BAMP' not in p.inner_text('body')
    shot(p, '02-name'); assert no_hscroll(p); assert not p.errors, p.errors; ctx.close()

@case('名前検索: 概ね一致(誤字/一部/かな/異体字)・複数候補・該当なし')
def t_search(b):
    ctx, p = new_page(b); p.goto(BASE); inp = p.get_by_test_id('name-input'); inp.wait_for(timeout=8000)
    def names(q):
        inp.fill(q); p.wait_for_timeout(1100)
        return p.get_by_test_id('result').all_inner_texts()
    def has(q, who): r = names(q); assert any(who in x for x in r), (q, r)
    has('中西将太', '中西 将大')     # 一字違い
    has('中四', '中西 将大')          # 誤字
    has('なかにし', '中西 将大')      # 読み(ひらがな)
    has('高木', '髙木 佑樹')          # 異体字(髙/高)
    has('船原', '舩原 拓朗')          # 異体字(舩/船)
    r = names('池田'); assert len(r) == 2 and any('紗希子' in x for x in r) and any('莉子' in x for x in r), r
    names('zzzz'); expect(p.get_by_test_id('no-result')).to_be_visible()
    has('nakanishi', '中西 将大')     # Workers AI フォールバック(経路。テストではスタブ)
    shot(p, '03-search'); ctx.close()

@case('確認: 「違う」で戻れる → 確認後にスケルトンを経て予定表示')
def t_confirm(b):
    ctx, p = new_page(b); p.goto(T('2026-10-24T13:10')); p.get_by_test_id('name-input').fill('鬼丸')
    p.get_by_test_id('result').first.click()
    expect(p.get_by_test_id('confirm-name')).to_have_text('鬼丸 凌雅'); shot(p, '04-confirm')
    p.get_by_text('違う').click(); expect(p.get_by_test_id('sheet')).to_have_count(0, timeout=3000)
    p.get_by_test_id('result').first.click(); p.get_by_test_id('confirm-yes').click()
    expect(p.get_by_test_id('skeleton')).to_be_visible(timeout=2000)
    expect(p.get_by_test_id('hero')).to_be_visible(timeout=6000)
    expect(p.get_by_test_id('who')).to_have_text('鬼丸 凌雅'); ctx.close()

@case('リアルタイム: 現在時刻のスロット・残り時間・次の予定(10/24 13:10 Square)')
def t_realtime(b):
    ctx, p = new_page(b); login(p, '2026-10-24T13:10', '宮永')   # 宮永: 13:00-14:30 は Circle
    expect(p.get_by_test_id('hero-title')).to_have_text('Circle')
    expect(p.locator('.hero .live')).to_contain_text('いま')
    expect(p.get_by_test_id('remain')).to_contain_text('残り 1時間20分')
    expect(p.get_by_test_id('map')).to_be_visible(); expect(p.get_by_test_id('next')).to_contain_text('14:30')
    expect(p.locator('.slot.now')).to_have_count(1)
    assert 'Circle' in p.locator('.slot.now').inner_text()
    shot(p, '05-schedule'); assert no_hscroll(p); assert not p.errors, p.errors; ctx.close()

@case('リアルタイム: 時刻が進むとスロットが自動で切り替わる(14:29:55→14:30)')
def t_rollover(b):
    ctx, p = new_page(b); login(p, '2026-10-24T14:29:50', '中西')
    expect(p.get_by_test_id('hero-title')).to_have_text('Square')    # 13:00-14:30 Square
    expect(p.get_by_test_id('hero-title')).to_have_text('Pentagon', timeout=15000)  # 14:30-14:45 Pentagon
    ctx.close()

@case('時間帯: 開始前 / 昼食 / 夜')
def t_states(b):
    ctx, p = new_page(b); login(p, '2026-10-24T09:00', '鬼丸')
    expect(p.locator('.hero .label')).to_have_text('次の予定'); expect(p.get_by_test_id('remain')).to_contain_text('開始まで 1時間15分'); ctx.close()
    ctx, p = new_page(b); login(p, '2026-10-24T12:10', '鬼丸')
    expect(p.get_by_test_id('hero-title')).to_have_text('Lunch'); assert p.get_by_test_id('map').count() == 0; ctx.close()
    ctx, p = new_page(b); login(p, '2026-10-24T19:00', '鬼丸')
    expect(p.get_by_test_id('hero-title')).to_have_text('BBQ Night Party'); ctx.close()

@case('チーム: 同じエリアのメンバーとCaptainが分かる / 三角のみ動画リンク')
def t_team(b):
    ctx, p = new_page(b); login(p, '2026-10-24T11:10', '池田紗希子')      # Triangle
    expect(p.get_by_test_id('hero-title')).to_have_text('Triangle')
    p.get_by_test_id('team').click(); sec = p.get_by_test_id('area-section'); expect(sec).to_have_count(1)
    expect(p.get_by_test_id('captain-pill')).to_contain_text('池田 紗希子')
    pills = p.get_by_test_id('member-pill').all_inner_texts(); assert len(pills) >= 3
    expect(p.get_by_test_id('video')).to_have_attribute('href', 'https://drive.google.com/file/d/1sm_BJHntF_XeJe0J6rSg3e4krcsli5h1/view')
    shot(p, '06-team-sheet'); ctx.close()
    ctx, p = new_page(b); login(p, '2026-10-24T13:10', '鬼丸'); p.get_by_test_id('team').click()
    assert p.get_by_test_id('video').count() == 0
    expect(p.get_by_test_id('area-section')).to_contain_text('Circle'); ctx.close()

@case('Hexagon: Ⅰ/Ⅱ のCaptainが別 / Squareは未設定表示')
def t_hex(b):
    ctx, p = new_page(b); login(p, '2026-10-24T13:10', '河野'); expect(p.get_by_test_id('hero-title')).to_have_text('Hexagon-Ⅰ')
    p.get_by_test_id('team').click(); expect(p.get_by_test_id('captain-pill')).to_have_count(1); expect(p.get_by_test_id('captain-pill')).to_contain_text('河野 史花')
    p.get_by_text('閉じる').click(); p.get_by_test_id('tab-areas').click(); expect(p.get_by_test_id('area-card')).to_have_count(5, timeout=4000)
    hexa = p.get_by_test_id('area-card').nth(3); assert 'Captain 河野' in hexa.inner_text() and 'Captain 小山' in hexa.inner_text()
    assert 'Captain 未設定' in p.get_by_test_id('area-card').nth(0).inner_text()
    shot(p, '07-areas'); hexa.click(); expect(p.get_by_test_id('area-section').first).to_be_visible(); ctx.close()

@case('日切替・不参加日・移動情報')
def t_days(b):
    ctx, p = new_page(b); login(p, '2026-10-24T13:10', '余傳')
    p.get_by_test_id('day-25').click(); expect(p.get_by_text('この日は参加なし')).to_be_visible()
    p.get_by_test_id('day-24').click(); expect(p.get_by_test_id('row')).to_have_count(13)
    p.get_by_test_id('tab-comms').click(); expect(p.get_by_text('20:37中津駅発')).to_be_visible(timeout=4000); ctx.close()
    ctx, p = new_page(b); login(p, '2026-10-24T13:10', '宮永'); p.get_by_test_id('day-25').click(); expect(p.get_by_test_id('row')).to_have_count(10); ctx.close()

@case('スケルトン: タブ切替ごとに全画面スケルトン')
def t_skel(b):
    ctx, p = new_page(b); login(p, '2026-10-24T13:10', '宮永'); p.get_by_test_id('tab-areas').click()
    expect(p.get_by_test_id('skeleton')).to_be_visible(timeout=1500); expect(p.get_by_test_id('area-card').first).to_be_visible(timeout=4000); ctx.close()

@case('管理者: PIN無しで入り、全員の現在地ライブ表示・スロット移動')
def t_admin_live(b):
    ctx, p = new_page(b); p.goto(T('2026-10-24T13:10')); p.get_by_test_id('name-input').fill('管理者')
    p.get_by_test_id('result-admin').click(); p.get_by_test_id('admin-go').click()
    expect(p.get_by_test_id('group').first).to_be_visible(timeout=6000)
    assert p.get_by_test_id('pill').count() == 24; shot(p, '08-admin-live')
    before = p.get_by_test_id('sel-slot').inner_text(); p.get_by_test_id('next-slot').click(); assert p.get_by_test_id('sel-slot').inner_text() != before
    p.get_by_test_id('tab-members').click(); expect(p.get_by_test_id('mrow')).to_have_count(24, timeout=4000)
    p.get_by_test_id('mq').fill('森'); assert sum(1 for r in p.get_by_test_id('mrow').all() if r.is_visible()) == 2; ctx.close()

@case('管理者→メンバー: スケジュール変更とコメントがリアルタイムに反映')
def t_admin_edit(b):
    mctx, m = new_page(b); login(m, '2026-10-24T13:10', '宮永')                     # 13:00-14:30 Circle
    expect(m.get_by_test_id('hero-title')).to_have_text('Circle')
    actx, a = new_page(b); a.goto(T('2026-10-24T13:10')); a.get_by_test_id('name-input').fill('管理者')
    a.get_by_test_id('result-admin').click(); a.get_by_test_id('admin-go').click(); a.get_by_test_id('tab-members').click()
    a.locator('[data-testid=mrow][data-name="宮永 航平"]').click(); expect(a.get_by_test_id('editor-rows')).to_be_visible()
    a.get_by_test_id('ed-sel-4').select_option('Triangle'); a.get_by_test_id('ed-note-4').fill('麻紐を追加で持参')
    shot(a, '09-admin-editor'); a.get_by_test_id('ed-save').click(); expect(a.get_by_test_id('toast')).to_contain_text('保存しました')
    expect(m.get_by_test_id('hero-title')).to_have_text('Triangle', timeout=12000)   # ポーリング(5秒)で反映
    expect(m.get_by_test_id('hero-note')).to_contain_text('麻紐を追加で持参'); expect(m.get_by_test_id('toast').first).to_contain_text('予定が更新されました')
    # コメント(個別 + 全員)
    a.get_by_test_id('tab-comms').click(); a.get_by_test_id('c-to').select_option(label='宮永 航平'); a.get_by_test_id('c-text').fill('集合場所が変わりました')
    a.get_by_test_id('send').click(); expect(a.get_by_test_id('msg')).to_have_count(1, timeout=4000)
    expect(m.get_by_test_id('badge')).to_have_text('1', timeout=12000)
    m.get_by_test_id('tab-comms').click(); expect(m.get_by_test_id('msg').first).to_contain_text('集合場所が変わりました', timeout=4000)
    expect(m.get_by_test_id('badge')).to_have_count(0); shot(m, '10-member-comms')
    a.get_by_test_id('c-to').select_option(''); a.get_by_test_id('c-text').fill('全員: 18:00に八面山荘へ'); a.get_by_test_id('send').click()
    expect(m.get_by_test_id('msg')).to_have_count(2, timeout=12000)
    a.get_by_test_id('msg').first.get_by_text('削除').click(); expect(a.get_by_test_id('msg')).to_have_count(1, timeout=4000)
    expect(m.get_by_test_id('msg')).to_have_count(1, timeout=12000)
    assert not m.errors and not a.errors, (m.errors, a.errors); mctx.close(); actx.close()

@case('管理者: Workers AI でコメント整形(テストではスタブ応答)')
def t_ai(b):
    ctx, a = new_page(b); a.goto(BASE); a.get_by_test_id('name-input').fill('かんりしゃ'); a.get_by_test_id('result-admin').click(); a.get_by_test_id('admin-go').click()
    a.get_by_test_id('tab-comms').click(); a.get_by_test_id('c-text').fill('  明日  9時に  集合  '); a.get_by_test_id('polish').click()
    expect(a.get_by_test_id('c-text')).to_have_value('明日 9時に 集合【整形】', timeout=4000); ctx.close()

@case('権限: 管理者以外はAPIで書き込めない(PIN設定時)')
def t_auth(b):
    # PIN付きの別サーバーで確認
    env = dict(os.environ, PORT='8798', PERSIST='/tmp/bamp-e2e-8798', WRANGLER_PIN='1')
    cfg = open(os.path.join(ROOT, 'wrangler.test.jsonc')).read().replace('"AI_MOCK": "1"', '"AI_MOCK": "1", "ADMIN_PIN": "4321"')
    p = os.path.join(ROOT, 'wrangler.pin.jsonc'); open(p, 'w').write(cfg)
    sh = open(os.path.join(ROOT, 'scripts/dev-test-server.sh')).read().replace('wrangler.test.jsonc', 'wrangler.pin.jsonc')
    sp = os.path.join(ROOT, 'scripts/.pin-server.sh'); open(sp, 'w').write(sh)
    srv = subprocess.Popen(['bash', sp], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, preexec_fn=os.setsid)
    try:
        for _ in range(60):
            try: urllib.request.urlopen('http://localhost:8798/api/data', timeout=2); break
            except Exception: time.sleep(1)
        def call(path, method='GET', body=None, hdr=None):
            r = urllib.request.Request('http://localhost:8798' + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers={'content-type': 'application/json', **(hdr or {})})
            try: return urllib.request.urlopen(r).status
            except urllib.error.HTTPError as e: return e.code
        assert call('/api/comments', 'POST', {'text': 'x'}) == 403
        assert call('/api/entries', 'PUT', {'changes': []}) == 403
        assert call('/api/admin/login', 'POST', {'pin': 'bad'}) == 401
        tok = json.load(urllib.request.urlopen(urllib.request.Request('http://localhost:8798/api/admin/login', data=b'{"pin":"4321"}', method='POST', headers={'content-type': 'application/json'})))['token']
        assert call('/api/comments', 'POST', {'text': 'ok'}, {'x-admin-token': tok}) == 200
        ctx, a = new_page(b); a.goto('http://localhost:8798'); a.get_by_test_id('name-input').fill('管理者'); a.get_by_test_id('result-admin').click()
        a.get_by_test_id('pin').fill('0000'); a.get_by_test_id('admin-go').click(); expect(a.get_by_test_id('toast')).to_contain_text('PIN')
        a.get_by_test_id('pin').fill('4321'); a.get_by_test_id('admin-go').click(); expect(a.get_by_test_id('group').first).to_be_visible(timeout=6000); ctx.close()
    finally:
        os.killpg(os.getpgid(srv.pid), signal.SIGTERM)
        for f in ('wrangler.pin.jsonc', 'scripts/.pin-server.sh'): os.path.exists(os.path.join(ROOT, f)) and os.remove(os.path.join(ROOT, f))

@case('記憶: 再訪で直接予定表示 / 切替で名前入力へ')
def t_remember(b):
    ctx, p = new_page(b); login(p, '2026-10-24T13:10', '宮永'); p.reload()
    expect(p.get_by_test_id('hero')).to_be_visible(timeout=8000); expect(p.get_by_test_id('who')).to_have_text('宮永 航平')
    p.get_by_test_id('logout').click(); p.get_by_test_id('logout-ok').click(); expect(p.get_by_test_id('name-input')).to_be_visible(timeout=4000); ctx.close()

@case('オフライン: 電波が無くても直前の予定を表示し続ける')
def t_offline(b):
    ctx, p = new_page(b); login(p, '2026-10-24T13:10', '宮永'); ctx.set_offline(True)
    expect(p.get_by_text('オフライン')).to_be_visible(timeout=9000); expect(p.get_by_test_id('hero-title')).to_be_visible()
    p.get_by_test_id('day-25').click(); expect(p.get_by_test_id('row').first).to_be_visible(); ctx.close()

@case('見た目: 小さい画面(360px)でも横スクロールなし・全タブ')
def t_layout(b):
    ctx = b.new_context(viewport={'width': 360, 'height': 640}, is_mobile=True, has_touch=True, device_scale_factor=2, service_workers='block'); p = ctx.new_page()
    login(p, '2026-10-24T13:10', '河野')
    for tab in ('schedule', 'areas', 'comms'):
        p.get_by_test_id(f'tab-{tab}').click(); p.wait_for_timeout(900); assert no_hscroll(p), tab
    p.get_by_test_id('tab-schedule').click(); p.wait_for_timeout(900); shot(p, '11-small'); ctx.close()

@case('参加者一覧: 全員と「いま何をしているか」を表示 → 自分の名前タップで確認→予定ページへ')
def t_roster(b):
    ctx, p = new_page(b); p.goto(T('2026-10-24T13:10')); rows = p.get_by_test_id('member-row'); expect(rows).to_have_count(24, timeout=8000)
    expect(p.get_by_test_id('roster-head')).to_contain_text('10/24 13:00–14:30')
    by = {SEED['members'][i]['name']: i for i in range(24)}
    def now_of(name): return rows.nth(by[name]).get_by_test_id('member-now').inner_text()
    assert now_of('宮永 航平') == 'Circle' and now_of('鬼丸 凌雅') == 'Circle' and now_of('河野 史花') == 'Hexagon-Ⅰ' and now_of('池田 紗希子') == 'Triangle'
    assert now_of('余傳 舞美') == 'Circle'
    shot(p, '13-roster')
    p.get_by_test_id('name-input').fill('zzzz'); expect(p.get_by_test_id('no-result')).to_be_visible(timeout=4000); expect(rows.first).to_be_visible()   # 該当なしでも一覧から選べる
    p.get_by_test_id('name-input').fill('')
    rows.nth(by['宮永 航平']).click(); expect(p.get_by_test_id('confirm-name')).to_have_text('宮永 航平')
    p.get_by_test_id('confirm-yes').click(); expect(p.get_by_test_id('hero-title')).to_have_text('Circle', timeout=8000); expect(p.get_by_test_id('who')).to_have_text('宮永 航平')
    ctx.close()
    ctx, p = new_page(b); p.goto(T('2026-10-24T14:29:50')); expect(p.get_by_test_id('member-row').first).to_be_visible(timeout=8000)
    assert p.get_by_test_id('member-now').nth(by['中西 将大']).inner_text() == 'Square'
    expect(p.get_by_test_id('member-now').nth(by['中西 将大'])).to_have_text('Pentagon', timeout=15000)     # 時刻が進むと一覧も自動更新
    ctx.close()

@case('GitHub Pages想定: サブパス静的配信(APIなし)→匿名デモデータで全画面が動く')
def t_pages(b):
    site = '/tmp/bamp-site'; os.makedirs(site, exist_ok=True)
    link = os.path.join(site, 'bamp-app')
    if os.path.islink(link): os.remove(link)
    os.symlink(os.path.join(ROOT, 'public'), link)
    srv = subprocess.Popen(['python3', '-m', 'http.server', '8801', '--directory', site], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, preexec_fn=os.setsid)
    try:
        time.sleep(1.5); ctx, p = new_page(b)
        p.goto('http://localhost:8801/bamp-app/?t=2026-10-24T13:10')
        expect(p.get_by_test_id('member-row')).to_have_count(24, timeout=8000); p.get_by_test_id('member-row').nth(2).click(); expect(p.get_by_test_id('confirm-name')).to_have_text('メンバー03'); p.get_by_test_id('confirm-yes').click()
        expect(p.get_by_test_id('hero')).to_be_visible(timeout=8000); expect(p.get_by_test_id('demo-chip')).to_be_visible()
        expect(p.get_by_test_id('map')).to_be_visible(); assert p.evaluate("()=>document.querySelector('.map img').naturalWidth") > 0   # 画像がサブパスで読める
        assert '中西' not in p.inner_text('body') and '鬼丸' not in p.inner_text('body')
        p.get_by_test_id('tab-areas').click(); expect(p.get_by_test_id('area-card')).to_have_count(5, timeout=4000)
        p.get_by_test_id('logout').click(); p.get_by_test_id('logout-ok').click(); p.get_by_test_id('name-input').fill('管理者')
        p.get_by_test_id('result-admin').click(); p.get_by_test_id('admin-go').click(); expect(p.get_by_test_id('group').first).to_be_visible(timeout=6000)
        p.get_by_test_id('tab-comms').click(); p.get_by_test_id('c-text').fill('x'); p.get_by_test_id('send').click(); expect(p.get_by_test_id('toast')).to_contain_text('デモ')
        shot(p, '12-pages-demo'); bad = [e for e in p.errors if 'Failed to load resource' not in e]; assert not bad, bad; ctx.close()
    finally: os.killpg(os.getpgid(srv.pid), signal.SIGTERM)

# ---------------------------------------------------------------- run
if __name__ == '__main__':
    srv = start_server(); only = sys.argv[1:]; failed = 0
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            for fn in RESULTS:
                if only and not any(o in fn.__name__ for o in only): continue
                t0 = time.time()
                try: fn(b); print(f'PASS  {fn._name}  ({time.time()-t0:.1f}s)')
                except Exception as e: failed += 1; print(f'FAIL  {fn._name}\n      {type(e).__name__}: {str(e)[:600]}')
            b.close()
    finally:
        os.killpg(os.getpgid(srv.pid), signal.SIGTERM)
    print(f'\n{len(RESULTS)-failed if not only else "-"} passed, {failed} failed'); sys.exit(1 if failed else 0)
