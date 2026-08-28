# ============================================================
# 代码段功能：用 Playwright 从 Pexels 搜索页提取精确餐品图并替换
# - 替换不符项：燕麦拿铁/青提/白桃乌龙/焦糖布丁/手冲/猫零食/猫爪拉花
# - 提取 images.pexels.com 图片 URL → curl 下载 → 校验 → webp → 更新数据库
# ============================================================
import subprocess, os, re, sqlite3, time
from playwright.sync_api import sync_playwright

BASE = r'C:\Users\Administrator\WorkBuddy\2026-08-26-14-15-18\-\cat-isle-backend'
VENV_PY = r'C:\Users\Administrator\WorkBuddy\2026-08-26-14-15-18\cat-isle-backend\.venv\Scripts\python.exe'
OUT_DIR = os.path.join(BASE, 'uploads', 'menu')
HEADERS = '-H', 'User-Agent: Mozilla/5.0'

# menu_id → Pexels 搜索词（力求与餐品名精确对应）
SEARCH = {
    1: 'latte-art',              # 猫爪印拿铁（拉花拿铁）
    2: 'oat-milk-latte',         # 云朵燕麦拿铁
    3: 'green-grape-drink',      # 冷萃青提气泡
    4: 'peach-iced-tea',         # 白桃乌龙茶
    6: 'creme-caramel',          # 布丁的焦糖杯
    7: 'cat-treats',             # 奶糖的零食罐
    9: 'pour-over-coffee',       # 手冲耶加雪菲
}

def download(url, dst):
    """下载并校验为真实图片"""
    tmp = dst + '.tmp'
    subprocess.run(['curl', '-sL', '-m', '40', *HEADERS, '-o', tmp, url], capture_output=True)
    ok = False
    if os.path.exists(tmp) and os.path.getsize(tmp) > 8 * 1024:
        with open(tmp, 'rb') as f:
            magic = f.read(4)
        if magic[:2] == b'\xff\xd8' or magic[:4] == b'\x89PNG' or magic[:4] == b'RIFF':
            ok = True
    if ok:
        os.replace(tmp, dst)
        return True
    if os.path.exists(tmp):
        os.remove(tmp)
    return False

def compress(dst_jpg, dst_webp):
    subprocess.run([VENV_PY, r'C:\Users\Administrator\WorkBuddy\2026-08-26-14-15-18\-\验收材料\PPT素材\compress_one.py',
                    dst_jpg, dst_webp], capture_output=True, text=True)
    return os.path.exists(dst_webp)

results = {}
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    for mid, kw in SEARCH.items():
        try:
            page.goto(f'https://www.pexels.com/search/{kw}/', wait_until='domcontentloaded', timeout=30000)
            page.wait_for_timeout(4500)   # 等待图片渲染
            # 提取 images.pexels.com 图片 URL（带尺寸参数的 src）
            urls = page.eval_on_selector_all(
                'img[src*="images.pexels.com"]',
                'els => els.map(e => e.src).filter(s => s.includes("/photos/"))')
            if not urls:
                results[mid] = f'{kw}: 无图片'
                continue
            # 取第一张（搜索结果首位），确保带 w= 参数
            u = urls[0]
            u = re.sub(r'(w=)\d+', r'\g<1>800', u)
            dst = os.path.join(OUT_DIR, f'menu_{mid}.jpg')
            if download(u, dst) and compress(dst, os.path.join(OUT_DIR, f'menu_{mid}.webp')):
                size = os.path.getsize(os.path.join(OUT_DIR, f'menu_{mid}.webp')) / 1024
                results[mid] = f'{kw}: OK {size:.0f}KB <- {u.split("/")[5][:30]}'
            else:
                results[mid] = f'{kw}: 下载/压缩失败'
        except Exception as e:
            results[mid] = f'{kw}: 错误 {str(e)[:60]}'
        time.sleep(1)
    browser.close()

# 更新数据库
db = sqlite3.connect(os.path.join(BASE, 'catisle.db'))
for mid in SEARCH:
    if results[mid].startswith(f'{SEARCH[mid]}: OK'):
        db.execute('UPDATE menu_items SET image_url=? WHERE id=?', (f'/uploads/menu/menu_{mid}.webp', mid))
db.commit(); db.close()

for mid in sorted(SEARCH):
    print(f'{mid}: {results[mid]}')
