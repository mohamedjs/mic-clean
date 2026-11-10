# Mic (Mohamed) — Windows installer
# Run:  powershell -ExecutionPolicy Bypass -File install-windows.ps1
# - checks Node.js (offers winget install)
# - checks VB-CABLE (the free virtual mic other apps record from) and opens its download page if missing
# - starts the dashboard server at login (hidden) and opens it now
$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = if ($env:PORT) { $env:PORT } else { 4747 }
$Url = "http://localhost:$Port"

Write-Host "`n  Mic (Mohamed) - Windows setup`n" -ForegroundColor Cyan

# 1) Node.js 18+
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "  Node.js is not installed." -ForegroundColor Yellow
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "  Installing Node.js LTS with winget..."
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $node = Get-Command node -ErrorAction SilentlyContinue
  }
  if (-not $node) { Write-Host "  Install Node.js 18+ from https://nodejs.org and run this script again." -ForegroundColor Red; exit 1 }
}
$major = [int]((& node -v).TrimStart('v').Split('.')[0])
if ($major -lt 18) { Write-Host "  Node.js $(& node -v) is too old, need 18+." -ForegroundColor Red; exit 1 }
Write-Host "  [ok] Node.js $(& node -v)"

# 2) VB-CABLE
$cable = Get-CimInstance Win32_PnPEntity -Filter "PNPClass='AudioEndpoint'" | Where-Object { $_.Name -match 'CABLE (Input|Output)|VB-Audio' }
if ($cable) { Write-Host "  [ok] VB-CABLE found" }
else {
  Write-Host "  VB-CABLE is not installed. It is the virtual mic Zoom/OBS/Discord will record from." -ForegroundColor Yellow
  Write-Host "  Download it, unzip, right-click VBCABLE_Setup_x64.exe > Run as administrator, then restart Windows."
  Start-Process 'https://vb-audio.com/Cable/'
}

# 3) Start at login (hidden window)
$dataDir = Join-Path $env:APPDATA 'mic-clean-dashboard'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$vbs = Join-Path $dataDir 'start-server.vbs'
$nodePath = (Get-Command node).Source
@"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$Here"
sh.Run """$nodePath"" ""$Here\server.js""", 0, False
"@ | Set-Content -Encoding ASCII $vbs
$startup = [Environment]::GetFolderPath('Startup')
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $startup 'Mic (Mohamed).lnk'))
$lnk.TargetPath = 'wscript.exe'; $lnk.Arguments = "`"$vbs`""; $lnk.WorkingDirectory = $Here; $lnk.Save()
Write-Host "  [ok] Starts automatically at login"

# 4) Start now and open the dashboard (Chrome or Edge, as an app window)
$running = $false
try { Invoke-WebRequest -UseBasicParsing "$Url/api/status" -TimeoutSec 2 | Out-Null; $running = $true } catch {}
if (-not $running) { Start-Process wscript.exe -ArgumentList "`"$vbs`""; Start-Sleep -Seconds 2 }
$browser = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($browser) { Start-Process $browser -ArgumentList "--app=$Url" } else { Start-Process $Url }

Write-Host "`n  Done. Dashboard: $Url"
Write-Host "  In the dashboard: input = your mic, output = CABLE Input, then press Start."
Write-Host "  In Zoom/Teams/Discord/OBS pick the microphone: CABLE Output (VB-Audio Virtual Cable)`n"
Write-Host "  Uninstall: delete '$startup\Mic (Mohamed).lnk' and '$dataDir'."
