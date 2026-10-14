param(
    [Parameter(Mandatory=$true)][string]$Docx,
    [Parameter(Mandatory=$true)][string]$Pdf
)
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
    $doc = $word.Documents.Open($Docx, $false, $true)
    # 展开目录域与页码域（不调这两句 TOC 会是空的）
    $doc.Fields.Update() | Out-Null
    foreach ($toc in $doc.TablesOfContents) { $toc.Update() | Out-Null }
    $doc.Repaginate()
    $doc.Fields.Update() | Out-Null
    # 17 = wdExportFormatPDF
    $doc.SaveAs([ref]$Pdf, [ref]17)
    $pages = $doc.ComputeStatistics(2)  # 2 = wdStatisticPages
    $doc.Close($false)
    Write-Output "PDF_OK pages=$pages path=$Pdf"
} finally {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
