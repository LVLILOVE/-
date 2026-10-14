# -*- coding: utf-8 -*-
# 批量把 ASCII 暂存目录里的 dN.docx 转成 dN.pdf（Word COM，展开 TOC 域与页码域）。
#
# ⚠️ 本脚本**只处理纯 ASCII 路径**，内容不含任何非 ASCII 字符 —— 这是刻意的：
#    本机 PowerShell 通道对含中文的命令行参数会报
#    "sandbox-center cmd decisionRecord missing actual resource subject"，
#    因此中文路径的搬运一律交给 scripts/docx_export.sh（bash，能正确处理中文）。
#
# 在 PowerShell 工具内调用（勿从 Bash 调 powershell.exe）：
#    & 'C:\temp\docxpdf\run_pdf.ps1'
param([string]$Dir = 'C:\temp\docxpdf')
$ErrorActionPreference = 'Stop'

$files = @(Get-ChildItem -Path (Join-Path $Dir 'd*.docx') -ErrorAction SilentlyContinue | Sort-Object Name)
if ($files.Count -eq 0) { throw "no d*.docx found in $Dir" }

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$results = @()
try {
    foreach ($f in $files) {
        $src = $f.FullName
        $dst = [System.IO.Path]::ChangeExtension($src, '.pdf')
        try {
            $doc = $word.Documents.Open($src, $false, $true)
            # 展开目录域与页码域（不调这两句 TOC 会是空的）
            $doc.Fields.Update() | Out-Null
            foreach ($toc in $doc.TablesOfContents) { $toc.Update() | Out-Null }
            $doc.Repaginate()
            $doc.Fields.Update() | Out-Null
            $doc.SaveAs([ref]$dst, [ref]17)   # 17 = wdExportFormatPDF
            $pages = $doc.ComputeStatistics(2) # 2 = wdStatisticPages
            $doc.Close($false)
            $results += ("PDF_OK {0} pages={1}" -f $f.Name, $pages)
        } catch {
            $results += ("PDF_FAIL {0} {1}" -f $f.Name, $_.Exception.Message)
        }
    }
} finally {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
foreach ($r in $results) { Write-Output $r }
