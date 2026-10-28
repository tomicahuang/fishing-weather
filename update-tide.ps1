# Download the CWA 30-day tide predictions for the fishing spots into data/tide-data.js.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File update-tide.ps1
# Also runs on GitHub Actions (pwsh on Linux), so keep it free of Windows-only calls.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = $PSScriptRoot
$stations = [ordered]@{ bx = 'T000702'; jh = 'T000919'; bd = 'T001003'; qg = 'T700015'; ap = 'T700036' }
$taipeiNow = [DateTime]::UtcNow.AddHours(8)

# Chinese words in the CWA page, written as \u escapes so this file stays plain ASCII
$reHigh = '\u6EFF\u6F6E'          # high tide
$reLow = '\u4E7E\u6F6E'           # low tide
$reLunar = '\u8FB2\u66C6\s*(\d{1,2})/(\d{1,2})'
$reRange = '\u6F6E\u5DEE\s*[:\uFF1A]\s*(\u5927|\u4E2D|\u5C0F)'
$rangeName = @{ ([string][char]0x5927) = 'big'; ([string][char]0x4E2D) = 'mid'; ([string][char]0x5C0F) = 'small' }

function Get-Page([string]$url) {
  for ($i = 1; $i -le 3; $i++) {
    try {
      $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 40 -Headers @{ 'User-Agent' = 'Mozilla/5.0 (cria fishing-weather)' }
      return [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
    } catch {
      if ($i -eq 3) { throw }
      Start-Sleep -Seconds 4
    }
  }
}

function Get-IntCell([string]$row, [string]$header) {
  if ($row -match ('headers="[^"]*' + $header + '"[^>]*>\s*(-?\d+)')) { return [int]$matches[1] }
  return $null
}

# the CWA page starts from today, so carry over the last few days from the previous file for the trend curves
$dataFile = Join-Path (Join-Path $root 'data') 'tide-data.js'
$keepFrom = $taipeiNow.AddDays(-7).ToString('yyyy-MM-dd')
$prev = $null
if (Test-Path $dataFile) {
  try {
    $txt = [IO.File]::ReadAllText($dataFile)
    $a = $txt.IndexOf('{'); $z = $txt.LastIndexOf('}')
    if ($a -ge 0 -and $z -gt $a) { $prev = $txt.Substring($a, $z - $a + 1) | ConvertFrom-Json }
  } catch { $prev = $null }
}

$out = [ordered]@{}
foreach ($key in $stations.Keys) {
  $id = $stations[$key]
  $url = "https://www.cwa.gov.tw/V8/C/M/Fishery/tide_30day_MOD/$id.html"
  Write-Host "Tide $key ($id) ..."
  $html = Get-Page $url
  $rows = [regex]::Matches($html, '(?s)<tr>(.*?)</tr>')
  $days = New-Object System.Collections.Generic.List[object]
  $cur = $null
  foreach ($m in $rows) {
    $row = $m.Groups[1].Value
    if ($row -match '(\d{1,2})/(\d{1,2})\s*\(') {
      $mon = [int]$matches[1]; $day = [int]$matches[2]
      $year = $taipeiNow.Year
      if ($mon -lt $taipeiNow.Month - 6) { $year++ } elseif ($mon -gt $taipeiNow.Month + 6) { $year-- }
      $lunar = ''
      if ($row -match $reLunar) { $lunar = '{0:D2}/{1:D2}' -f [int]$matches[1], [int]$matches[2] }
      $range = ''
      if ($row -match $reRange) { $range = $rangeName[$matches[1]] }
      $cur = [ordered]@{ date = ('{0:D4}-{1:D2}-{2:D2}' -f $year, $mon, $day); lunar = $lunar; range = $range; events = (New-Object System.Collections.Generic.List[object]) }
      $days.Add($cur)
    }
    if ($null -eq $cur) { continue }
    $type = $null
    if ($row -match ('headers="[^"]*tide"[^>]*>\s*' + $reHigh)) { $type = 'H' }
    elseif ($row -match ('headers="[^"]*tide"[^>]*>\s*' + $reLow)) { $type = 'L' }
    if (-not $type) { continue }
    if ($row -notmatch 'headers="[^"]*time"[^>]*>\s*(\d{1,2}:\d{2})') { continue }
    $time = $matches[1]
    $cur.events.Add([ordered]@{ type = $type; time = $time; msl = (Get-IntCell $row 'Above_Local_MSL'); chart = (Get-IntCell $row 'Above_Chart_Datum') })
  }
  if ($days.Count -lt 5) { throw "Tide page $id returned only $($days.Count) days; the CWA page layout may have changed." }
  if ($prev -and $prev.spots -and $prev.spots.$key) {
    $firstNew = $days[0].date
    $old = @($prev.spots.$key.days | Where-Object { [string]::CompareOrdinal($_.date, $firstNew) -lt 0 -and [string]::CompareOrdinal($_.date, $keepFrom) -ge 0 })
    if ($old.Count) {
      $merged = New-Object System.Collections.Generic.List[object]
      foreach ($d in $old) { $merged.Add($d) }
      foreach ($d in $days) { $merged.Add($d) }
      $days = $merged
      Write-Host "  kept $($old.Count) past day(s)"
    }
  }
  Write-Host ("  {0} days, {1} .. {2}" -f $days.Count, $days[0].date, $days[$days.Count - 1].date)
  $out[$key] = [ordered]@{ station = $id; days = $days }
}

$payload = [ordered]@{ updated = $taipeiNow.ToString('yyyy-MM-dd HH:mm'); spots = $out }
$json = $payload | ConvertTo-Json -Depth 8 -Compress
$dataDir = Join-Path $root 'data'
New-Item -ItemType Directory -Force $dataDir | Out-Null
$js = "window.TIDE_DATA = $json;`n"
[IO.File]::WriteAllText((Join-Path $dataDir 'tide-data.js'), $js, (New-Object Text.UTF8Encoding $false))
Write-Host "Saved data/tide-data.js ($($taipeiNow.ToString('yyyy-MM-dd HH:mm')))"
