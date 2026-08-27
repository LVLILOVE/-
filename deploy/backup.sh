#!/bin/bash
# ============================================================
# 代码段功能：猫屿每日备份脚本（数据库 + 上传图片）
# - 使用方式：crontab -e 添加 每日 03:00 执行
#   0 3 * * * /opt/catisle/deploy/backup.sh >> /var/log/catisle-backup.log 2>&1
# - 保留策略：备份保留 14 天，自动清理更早的备份
# ============================================================
set -euo pipefail

# 项目与备份目录（按实际部署路径修改）
APP_DIR="/opt/catisle"
BACKUP_DIR="/var/backups/catisle"
DATE=$(date +%Y%m%d_%H%M)

mkdir -p "$BACKUP_DIR"

# 1. 数据库在线热备（sqlite .backup 保证一致性，即使服务在运行）
sqlite3 "$APP_DIR/catisle.db" ".backup '$BACKUP_DIR/catisle_$DATE.db'"

# 2. 上传图片目录打包
tar czf "$BACKUP_DIR/uploads_$DATE.tar.gz" -C "$APP_DIR" uploads 2>/dev/null || true

# 3. 保留 14 天，删除更早备份
find "$BACKUP_DIR" -name "catisle_*.db" -mtime +14 -delete
find "$BACKUP_DIR" -name "uploads_*.tar.gz" -mtime +14 -delete

# 4. 日志输出
echo "[$(date '+%F %T')] 备份完成: catisle_$DATE.db / uploads_$DATE.tar.gz"
