# ============================================================
# 代码段功能：验收 PPT 效果截图采集（Playwright）
# - 截取：首页 / 猫咪列表页（含今日店长）/ 后台仪表盘（登录后）
# - 等待页面渲染后截图，保存到 验收材料/PPT素材/
# ============================================================
from playwright.sync_api import sync_playwright
import re, pathlib

# 读取后台账号（.env）
env_text = pathlib.Path(r'C:\Users\Administrator\WorkBuddy\2026-08-26-14-15-18\-\cat-isle-backend\.env').read_text(encoding='utf-8')
def env_val(key):
    m = re.search(rf'^{key}=(.*)$', env_text, re.M)
    return m.group(1).strip() if m else ''
USERNAME = env_val('ADMIN_USERNAME') or 'admin'
PASSWORD = env_val('ADMIN_PASSWORD')

OUT = r'C:\Users\Administrator\WorkBuddy\2026-08-26-14-15-18\-\验收材料\PPT素材'
BASE = 'http://127.0.0.1:8000'

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 900})

    # 1) 首页
    page.goto(BASE + '/', wait_until='domcontentloaded')
    page.wait_for_timeout(3500)   # 等待 SPA 渲染 + 图片加载
    page.screenshot(path=OUT + r'\01-首页.png')
    print('01-首页.png OK')

    # 2) 猫咪列表页（含今日店长）
    page.goto(BASE + '/cats', wait_until='domcontentloaded')
    page.wait_for_timeout(3500)
    page.screenshot(path=OUT + r'\02-猫咪页.png')
    print('02-猫咪页.png OK')

    # 3) 后台：登录 → 仪表盘
    page.goto(BASE + '/admin/login', wait_until='domcontentloaded')
    page.wait_for_timeout(2500)
    # 登录表单：按 input 顺序填充（用户名/密码），点含「登录」的按钮
    inputs = page.query_selector_all('input')
    if len(inputs) >= 2:
        inputs[0].fill(USERNAME)
        inputs[1].fill(PASSWORD)
    else:
        page.fill('input', USERNAME)
    page.click('button:has-text("登")')
    page.wait_for_timeout(3500)   # 等待跳转仪表盘
    page.goto(BASE + '/admin', wait_until='domcontentloaded')
    page.wait_for_timeout(3500)
    page.screenshot(path=OUT + r'\03-后台管理.png')
    print('03-后台管理.png OK')

    browser.close()
print('=== 截图全部完成 ===')
