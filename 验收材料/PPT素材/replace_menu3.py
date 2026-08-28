# ============================================================
# 代码段功能：替换 3 项不符餐品图（云朵燕麦拿铁/冷萃青提/白桃乌龙）
# - 新图源：Pixnio（牛奶咖啡/薄荷茶/果茶，更接近餐品名）
# ============================================================
import subprocess, os, re, sqlite3

BASE = r'C:\Users\Administrator\WorkBuddy\2026-08-26-14-15-18\-\cat-isle-backend'
VENV_PY = r'C:\Users\Administrator\WorkBuddy\2026-08-26-14-15-18\cat-isle-backend\.venv\Scripts\python.exe'
OUT = os.path.join(BASE, 'uploads', 'menu')
COMPRESS = r'C:\Users\Administrator\WorkBuddy\2026-08-26-14-15-18\-\验收材料\PPT素材\compress_one.py'

# menu_id → 首选小图 URL
REPLACE = {
    2: 'https://pixnio.com/free-images/2017/05/31/2017-05-31-19-15-04-576x432.jpg',   # 牛奶咖啡（燕麦拿铁替代）
    3: 'https://pixnio.com/free-images/2017/05/23/2017-05-23-17-12-55-576x381.jpg',   # 薄荷茶玻璃杯（青提气泡替代）
    4: 'https://pixnio.com/free-images/2021/05/14/2021-05-14-14-02-51-576x432.jpeg',  # 果茶玻璃壶（白桃乌龙替代）
}

def big_cands(url):
    m = re.match(r'(https://pixnio\.com/free-images/.+)-(\d+)x(\d+)\.(jpe?g)$', url)
    if not m:
        return [url]
    base, w, h, ext = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
    ratio = w / h
    cands = []
    for bw, bh in [(1536, 1024), (1344, 896), (1200, 800), (1152, 768), (1536, 1152), (1200, 900)]:
        if abs(bw / bh - ratio) / ratio < 0.02 and bw > w:
            cands.append(f'{base}-{bw}x{bh}.{ext}')
    cands.append(url)
    return cands

def download(u, dst):
    subprocess.run(['curl', '-sL', '-m', '40', '-o', dst + '.tmp', u], capture_output=True)
    ok = os.path.exists(dst + '.tmp') and os.path.getsize(dst + '.tmp') > 8 * 1024
    if ok:
        with open(dst + '.tmp', 'rb') as f:
            ok = f.read(2) == b'\xff\xd8'
    if ok:
        os.replace(dst + '.tmp', dst)
        return True
    try:  # safe-delete shim 可能拦截删除，容错忽略
        if os.path.exists(dst + '.tmp'):
            os.remove(dst + '.tmp')
    except OSError:
        pass
    return False

for mid, url in REPLACE.items():
    dst = os.path.join(OUT, f'menu_{mid}.jpg')
    webp = os.path.join(OUT, f'menu_{mid}.webp')
    got = None
    for u in big_cands(url):
        if download(u, dst):
            got = u
            break
    if got:
        r = subprocess.run([VENV_PY, COMPRESS, dst, webp], capture_output=True, text=True)
        print(f'{mid}: OK {os.path.getsize(webp)/1024:.0f}KB <- {got.split("/")[-1]}')
    else:
        print(f'{mid}: FAIL 下载失败')

# 数据库 URL 不变（menu_{mid}.webp 同名覆盖），无需更新；确认映射
db = sqlite3.connect(os.path.join(BASE, 'catisle.db'))
for mid in REPLACE:
    row = db.execute('SELECT name, image_url FROM menu_items WHERE id=?', (mid,)).fetchone()
    print(f'   {row[0]} → {row[1]}')
db.close()
