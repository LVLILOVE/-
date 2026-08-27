# ============================================================
# 代码段功能：开发期占位数据脚本（对齐实施方案 M4-D3 数据初始化）
# - 插入占位猫咪（6 只）与占位菜单（10 项），让前台页面有可展示内容
# - 幂等：已存在同名数据则跳过，可重复执行
# - 注意：仅用于开发/联调/验收演示；上线前由店主在后台
#   「猫咪管理」「餐单管理」替换为真实素材（实拍照片 + 真实菜单）
# 用法：python -m app.seed_demo   （先启动过后端，数据库已建表）
# ============================================================
from .core.db import SessionLocal
from .models import Cat, MenuItem
from .seed import seed          # 复用基础建表 + 种子 + 部分唯一索引

# 占位猫咪数据：名字/性格/一句话故事/品种/年龄/性别/绝育/技能/照片/排序
# 照片使用 Unsplash 公共猫咪图（开发期）；上线替换为 uploads 本地图
DEMO_CATS = [
    {"name": "奶糖", "persona": "撒娇大王", "story": "摸到舒服会翻肚皮给你看", "breed": "橘白",
     "age": "2岁", "gender": "公", "neutered": 1, "skills": "会击掌", "sort_order": 1,
     "avatar_url": "https://images.unsplash.com/photo-1573865526739-10659fec78a5?auto=format&fit=crop&w=500&q=70"},
    {"name": "布丁", "persona": "探险家", "story": "本咪是猫屿的探险队长，每个角落都要亲自巡逻过才放心~新来的两脚兽，跟着咪走就对了！", "breed": "英短",
     "age": "1岁", "gender": "母", "neutered": 1, "skills": "巡回小玩具", "sort_order": 2,
     "avatar_url": "https://images.unsplash.com/photo-1529778873920-4da4926a72c2?auto=format&fit=crop&w=500&q=70"},
    {"name": "小满", "persona": "运动健将", "story": "本咪的运动细胞可是猫屿第一！跑起来连风都追不上，想挑战的话逗猫棒放马过来~", "breed": "美短",
     "age": "3岁", "gender": "公", "neutered": 1, "skills": "跳高高", "sort_order": 3, "adoptable": 1,
     "avatar_url": "https://images.unsplash.com/photo-1601565812491-fed7af6905f2?auto=format&fit=crop&w=500&q=70"},
    {"name": "芝麻", "persona": "粘人精", "story": "本咪的呼噜声是猫屿限定版，只要人类大腿一出现，咪就自动导航降落~", "breed": "狸花",
     "age": "2岁", "gender": "母", "neutered": 1, "skills": "呼噜机", "sort_order": 4,
     "avatar_url": "https://images.unsplash.com/photo-1618826411640-d6df44dd3f7c?auto=format&fit=crop&w=500&q=70"},
    {"name": "汤圆", "persona": "小吃货", "story": "零食袋一响，本咪就会闪现！想交朋友很简单，冻干管够就行~", "breed": "白猫",
     "age": "1岁", "gender": "母", "neutered": 0, "skills": "要零食", "sort_order": 5, "adoptable": 1,
     "avatar_url": "https://images.unsplash.com/photo-1637424864218-b040b739ac44?auto=format&fit=crop&w=500&q=70"},
    {"name": "豆包", "persona": "安静美男子", "story": "本咪喜欢在窗边看云发呆，不吵不闹~想安静待一会儿的话，咪可以陪你一起看风景。", "breed": "蓝猫",
     "age": "4岁", "gender": "公", "neutered": 1, "skills": "陪看书", "sort_order": 6,
     "avatar_url": "https://images.unsplash.com/photo-1592194996308-7b43878e84a6?auto=format&fit=crop&w=500&q=70"},
]

# 占位菜单数据：名称/分类/价格(分)/描述/排序
DEMO_MENU = [
    {"name": "猫爪印拿铁", "category": "coffee", "price": 2800, "desc": "奶泡上印着猫爪，香浓治愈", "sort_order": 1},
    {"name": "云朵燕麦拿铁", "category": "coffee", "price": 3200, "desc": "燕麦奶+绵密奶泡", "sort_order": 2},
    {"name": "冷萃青提气泡", "category": "tea", "price": 2600, "desc": "清爽果香，适合夏天", "sort_order": 3},
    {"name": "白桃乌龙茶", "category": "tea", "price": 2400, "desc": "白桃清甜，茶香回甘", "sort_order": 4},
    {"name": "小满的下午", "category": "dessert", "price": 2600, "desc": "提拉米苏，甜而不腻", "sort_order": 5},
    {"name": "布丁的焦糖杯", "category": "dessert", "price": 2200, "desc": "焦糖布丁，入口即化", "sort_order": 6},
    {"name": "奶糖的零食罐", "category": "cat_snack", "price": 1200, "desc": "猫咪专用冻干小零食", "sort_order": 7},
    {"name": "小满的冻干桶", "category": "cat_snack", "price": 1500, "desc": "混合冻干，猫咪超爱", "sort_order": 8},
    {"name": "手冲耶加雪菲", "category": "coffee", "price": 3800, "desc": "花果香手冲单品", "sort_order": 9},
    {"name": "桂花酒酿拿铁", "category": "coffee", "price": 3000, "desc": "桂花香+酒酿回甘", "sort_order": 10},
]


def seed_demo():
    """先建表（幂等），再插入占位猫咪与菜单；同名数据存在则跳过"""
    seed()  # 建表 + 基础种子（管理员/时段/门店配置）+ 部分唯一索引
    db = SessionLocal()
    try:
        # 已存在的猫咪名集合（软删除的也视为存在，避免重复）
        existing_cats = {name for (name,) in db.query(Cat.name).all()}
        added_cats = 0
        for c in DEMO_CATS:
            if c["name"] in existing_cats:
                continue
            # 数据字典已含 adoptable（可空默认 0）；status/deleted 为模型默认值
            db.add(Cat(**c, status="active", deleted=0))
            added_cats += 1

        # 已存在的菜单名集合
        existing_menu = {name for (name,) in db.query(MenuItem.name).all()}
        added_menu = 0
        for m in DEMO_MENU:
            if m["name"] in existing_menu:
                continue
            db.add(MenuItem(**m, status="on_sale"))
            added_menu += 1

        db.commit()
        print(f"占位数据导入完成：新增猫咪 {added_cats} 只、菜单 {added_menu} 项"
              f"（已有 {len(existing_cats)} 只猫 / {len(existing_menu)} 项菜单跳过）")
        print("提示：上线前请在后台「猫咪管理」「餐单管理」替换为真实素材。")
    finally:
        db.close()


if __name__ == "__main__":
    seed_demo()
