$ErrorActionPreference = 'SilentlyContinue'

$projectRoot = "C:\Users\PABLO\Documents\Comercial assistent"

Write-Host ""
Write-Host "=== AGC STOP ALL ==="
Write-Host ""

Write-Host "[1/4] Encerrando processos Node relacionados ao projeto..."
$patterns = @(
  "C:\Users\PABLO\Documents\Comercial assistent\src\main.ts",
  "C:\Users\PABLO\Documents\Comercial assistent\src\v2_main.ts",
  "C:\Users\PABLO\Documents\Comercial assistent\dist\main.js",
  "C:\Users\PABLO\Documents\Comercial assistent\dist\v2_main.js",
  "C:\Users\PABLO\Documents\evolution-api\dist\main.js",
  'npm-cli.js" run dev',
  'npm-cli.js" run dev:v2',
  'npm-cli.js" run dev:all'
)

$nodeProcesses = Get-CimInstance Win32_Process -Filter "name = 'node.exe'"
foreach ($proc in $nodeProcesses) {
  $cmd = [string]$proc.CommandLine
  foreach ($pattern in $patterns) {
    if ($cmd -like "*$pattern*") {
      Write-Host "Parando PID $($proc.ProcessId): $cmd"
      Stop-Process -Id $proc.ProcessId -Force
      break
    }
  }
}

Write-Host "[1.1/4] Encerrando processos que ainda estejam ouvindo 3000, 4000 e 8080..."
$ports = 3000, 4000, 8080
foreach ($port in $ports) {
  $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    if ($connection.OwningProcess -and $connection.OwningProcess -ne $PID) {
      Write-Host "Parando processo da porta $port (PID $($connection.OwningProcess))"
      Stop-Process -Id $connection.OwningProcess -Force
    }
  }
}

Write-Host "[2/4] Encerrando containers Docker do projeto..."
Set-Location $projectRoot
docker compose stop evolution-api postgres redis qdrant

Write-Host "[3/4] Limpando PID salvo da V2..."
if (Test-Path "$projectRoot\v2.pid") {
  Remove-Item "$projectRoot\v2.pid" -Force
}

Write-Host "[4/4] Conferindo portas principais..."

function Test-PortDown($url) {
  try {
    Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 | Out-Null
    return "AINDA ATIVO - $url"
  } catch {
    return "OK PARADO - $url"
  }
}

Write-Host (Test-PortDown "http://localhost:3000/health")
Write-Host (Test-PortDown "http://localhost:4000/health")
Write-Host (Test-PortDown "http://localhost:6333/")
Write-Host (Test-PortDown "http://localhost:8080/")
Write-Host ""
