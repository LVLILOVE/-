# ============================================================
# 代码段功能：单图压缩为 webp（供批量脚本子进程调用）
# 用法: python compress_one.py <源图> <输出.webp>
# ============================================================
from PIL import Image
import sys

src, dst = sys.argv[1], sys.argv[2]
img = Image.open(src).convert('RGB')
img.thumbnail((800, 800))
img.save(dst, 'WEBP', quality=82)
import os
os.remove(src)
print('OK')
