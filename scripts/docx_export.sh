#!/usr/bin/env bash
# 文档导出流水线：docs/*.md → outputs/*.docx → outputs/*.pdf
#
# 为什么拆成三段（本机环境的硬约束）：
#   bash 能正确处理中文路径，但**不能**调 powershell.exe（安全策略拒绝）；
#   PowerShell 工具能调 Word COM，但命令行**不能**含中文参数。
#   故：中文搬运交给 bash，Word 转换只发生在纯 ASCII 暂存目录。
#
# 用法：
#   bash scripts/docx_export.sh stage            # ① 建 docx 并拷进 C:\temp\docxpdf（生成 map.tsv）
#   #  然后在 PowerShell 工具里跑： & 'C:\temp\docxpdf\run_pdf.ps1'
#   bash scripts/docx_export.sh collect          # ② 按 map.tsv 把 PDF 拷回 outputs/
#   bash scripts/docx_export.sh all              # 只做 ①（② 必须等 PowerShell 转换完）
#   bash scripts/docx_export.sh stage --idx 5,6  # ③ 只处理第 5、6 个（序号见 stage 输出）
#
# 为什么不支持「按中文名传参」：本机沙箱会拦截**命令行里**出现的非 ASCII 字符
# （bash 与 PowerShell 通道都拦）。中文只允许出现在脚本文件内部。故用序号选择。
#
# 完成后务必跑： python scripts/verify_doc_exports.py
set -u

ROOT="C:/Users/Administrator/WorkBuddy/销量预测"
PY="C:/Users/Administrator/.workbuddy/binaries/python/envs/docx/Scripts/python.exe"
STAGE="/c/temp/docxpdf"
STAGE_WIN='C:\temp\docxpdf'
MAP="$STAGE/map.tsv"

cd "$ROOT" || exit 1
mkdir -p "$STAGE"
cp scripts/run_pdf.ps1 "$STAGE/run_pdf.ps1"

ACTION="${1:-all}"
shift || true

# 只认 --idx（ASCII 值），其余参数忽略
WANT_IDX=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --idx) WANT_IDX="${2:-}"; shift 2 || shift ;;
    *) shift ;;
  esac
done

want() {  # $1 = 序号；无 --idx 时全都要
  [ -z "$WANT_IDX" ] && return 0
  case ",$WANT_IDX," in *",$1,"*) return 0;; esac
  return 1
}

case "$ACTION" in
  list)  # 列出序号 ↔ 文档名映射，不构建任何文件
    n=0
    for md in docs/*.md; do
      base="$(basename "$md" .md)"
      [ "$base" = "电商销量预测系统_开发方案文档_V1.0" ] && continue
      n=$((n + 1))
      printf '[%d] %s\n' "$n" "$base"
    done
    echo "TOTAL_SLOTS=$n"
    ;;
  stage|all)
    rm -f "$STAGE"/d*.docx "$STAGE"/d*.pdf "$MAP"
    : > "$MAP"
    n=0
    for md in docs/*.md; do
      base="$(basename "$md" .md)"
      # 历史快照：md 名与内容版本不一致（内容已是 V1.1），不参与自动重建
      [ "$base" = "电商销量预测系统_开发方案文档_V1.0" ] && continue
      n=$((n + 1))
      if ! want "$n"; then continue; fi
      printf '=== [%d] %s ===\n' "$n" "$base"
      "$PY" scripts/build_md_docx_formal.py "$md" "outputs/${base}.docx" || { echo "DOCX_FAIL $base"; continue; }
      cp "outputs/${base}.docx" "$STAGE/d${n}.docx"
      printf '%d\t%s\n' "$n" "$base" >> "$MAP"
    done
    echo "TOTAL_SLOTS=$n  STAGED=$(wc -l < "$MAP" | tr -d ' ')  （下一步在 PowerShell 工具里运行： & '$STAGE_WIN\\run_pdf.ps1'）"
    ;;

  collect)
    n=0
    while IFS=$'\t' read -r idx base; do
      [ -z "${idx:-}" ] && continue
      if [ -f "$STAGE/d${idx}.pdf" ]; then
        cp "$STAGE/d${idx}.pdf" "outputs/${base}.pdf"
        printf 'PDF<- %s\n' "$base"
        n=$((n + 1))
      else
        printf 'MISSING d%s.pdf (%s)\n' "$idx" "$base"
      fi
    done < "$MAP"
    echo "COLLECTED=$n"
    ;;

  *)
    echo "用法: bash scripts/docx_export.sh {stage|collect|all} [关键词...]" >&2
    exit 2
    ;;
esac
