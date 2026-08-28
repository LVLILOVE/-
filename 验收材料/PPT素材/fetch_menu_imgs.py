# ============================================================
# 代码段功能：批量下载餐品图片并应用到数据库
# - 每项餐品：候选 URL 列表（大图优先，缩略图保底）
# - 下载 → 压缩 webp → uploads/menu/ → 更新 menu_items.image_url
# ============================================================
import subprocess, os, re, sqlite3, sys

BASE = r'C:\Users\Administrator\WorkBuddy\2026-08-26-14-15-18\-\cat-isle-backend'
VENV_PY = r'C:\Users\Administrator\WorkBuddy\2026-08-26-14-15-18\cat-isle-backend\.venv\Scripts\python.exe'
OUT_DIR = os.path.join(BASE, 'uploads', 'menu')
os.makedirs(OUT_DIR, exist_ok=True)

def guess_big(small_url):
    """根据缩略图 URL 猜测大图版本（同路径更大尺寸）"""
    m = re.match(r'(https://pixnio\.com/free-images/.+)-(\d+)x(\d+)\.(jpe?g)$', small_url)
    if not m:
        return []
    base, w, h, ext = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
    w, h = (int(w), int(h))
    # 按宽高比生成候选大图尺寸
    ratio = w / h
    cands = []
    for bw, bh in [(1536, 1024), (1344, 896), (1536, 2304), (1536, 1536), (1536, 1920), (1536, 1494), (1200, 800), (1200, 1600), (1280, 720), (1152, 1536), (1344, 1792), (1536, 2048)]:
        if abs(bw / bh - ratio) < 0.01 and bw > w:
            cands.append(f'{base}-{bw}x{bh}.{ext}')
    cands.append(small_url)  # 保底：原缩略图
    return cands

def download(url, dst):
    """curl 下载，校验为真实图片（魔数）且 >10KB 才判定成功"""
    tmp = dst + '.tmp'
    subprocess.run(['curl', '-sL', '-m', '40', '-o', tmp, url], capture_output=True)
    ok = False
    if os.path.exists(tmp) and os.path.getsize(tmp) > 10 * 1024:
        with open(tmp, 'rb') as f:
            magic = f.read(4)
        # JPEG: FFD8 / PNG: 8950 / WEBP: RIFF....WEBP
        if magic[:2] == b'\xff\xd8' or magic[:4] == b'\x89PNG' or magic[:4] == b'RIFF':
            ok = True
    if ok:
        os.replace(tmp, dst)
        return True
    if os.path.exists(tmp):
        os.remove(tmp)
    return False

# 餐品 id → 候选 URL（优先已确认 alt 匹配的）
items = {
    1:  ['https://pixnio.com/free-images/2021/04/06/2021-04-06-10-13-15-576x864.jpg'],          # cappuccino
    2:  ['https://pixnio.com/free-images/2024/04/30/2024-04-30-16-27-06-576x576.jpg'],          # Thai milk tea
    3:  ['https://pixnio.com/free-images/2021/03/25/2021-03-25-11-58-21-576x384.jpg'],          # lemonade mint
    4:  ['https://pixnio.com/free-images/2017/07/14/2017-07-14-08-38-51-576x384.jpg'],          # black tea
    5:  ['https://pixnio.com/free-images/2024/11/19/2024-11-19-11-38-34-576x768.jpeg'],         # tiramisu
    6:  ['https://pixnio.com/free-images/2021/03/29/2021-03-29-11-49-42-576x384.jpg'],          # pudding
    7:  ['https://pixnio.com/free-images/2019/11/28/2019-11-28-13-14-28-1200x800.jpg'],         # cat treats
    8:  ['https://pixnio.com/free-images/2017/03/16/2017-03-16-15-08-51-1536x1494.jpg'],        # dry cat food
    9:  ['https://pixnio.com/free-images/2025/07/10/2025-07-10-04-17-28-576x384.jpeg'],         # espresso
    10: ['https://pixnio.com/free-images/2026/07/24/2026-07-24-15-40-23-1536x1920.jpg'],        # latte macchiato
}

results = {}
for mid, urls in items.items():
    # 生成大图候选列表
    cands = []
    for u in urls:
        cands.extend(guess_big(u) if '1536x' not in u and '1200x' not in u else [u])
    ok_url = None
    webp_dst = os.path.join(OUT_DIR, f'menu_{mid}.webp')
    if os.path.exists(webp_dst):
        results[mid] = f'SKIP（已存在 {os.path.getsize(webp_dst)/1024:.0f}KB）'
        continue
    for u in cands:
        dst = os.path.join(OUT_DIR, f'menu_{mid}.jpg')
        if download(u, dst):
            ok_url = u
            break
    if ok_url:
        # 压缩为 webp（路径通过 argv 传入，错误打印便于排查）
        r = subprocess.run([VENV_PY, os.path.join(os.path.dirname(__file__), 'compress_one.py'),
                            os.path.join(OUT_DIR, f'menu_{mid}.jpg'), webp_dst],
                           capture_output=True, text=True)
        if not os.path.exists(webp_dst):
            results[mid] = f'FAIL（压缩失败）{r.stderr[-200:]}'
            continue
        size = os.path.getsize(webp_dst) / 1024
        results[mid] = f'OK {size:.0f}KB <- {ok_url.split("/")[-1]}'
    else:
        results[mid] = 'FAIL（下载失败）'

# 更新数据库
db = sqlite3.connect(os.path.join(BASE, 'catisle.db'))
for mid, _ in items.items():
    if results[mid].startswith('OK'):
        db.execute('UPDATE menu_items SET image_url=? WHERE id=?', (f'/uploads/menu/menu_{mid}.webp', mid))
db.commit(); db.close()

for mid in sorted(items):
    print(f'{mid}: {results[mid]}')
