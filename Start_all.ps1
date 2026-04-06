$ErrorActionPreference = 'Stop'

$projectRoot = "C:\Users\PABLO\Documents\Comercial assistent"
$evolutionRoot = "C:\Users\PABLO\Documents\evolution-api"

function Test-Url($url) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
    return "OK $($response.StatusCode) - $url"
  } catch {
    return "FALHA - $url - $($_.Exception.Message)"
  }
}

function Wait-Url($url, $timeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {}
    Start-Sleep -Seconds 2
  }
  return $false
}

Write-Host ""
Write-Host "=== AGC START ALL ==="
Write-Host ""

Write-Host "[1/4] Subindo PostgreSQL, Redis e Qdrant via Docker..."
Set-Location $projectRoot
try {
  docker info | Out-Null
  docker compose stop evolution-api | Out-Null
  docker compose up -d postgres redis qdrant
} catch {
  Write-Host "Docker indisponivel. PostgreSQL, Redis e Qdrant nao foram iniciados automaticamente."
}

Write-Host "[2/4] Iniciando Evolution API do projeto antigo..."
try {
  $connections8080 = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections8080) {
    if ($connection.OwningProcess -and $connection.OwningProcess -ne $PID) {
      Stop-Process -Id $connection.OwningProcess -Force
    }
  }
} catch {}

Start-Process -FilePath "powershell.exe" `
  -ArgumentList "-NoProfile", "-Command", "Set-Location '$evolutionRoot'; `$env:NODE_OPTIONS='--dns-result-order=ipv4first'; node dist/main.js" `
  -WorkingDirectory $evolutionRoot

Write-Host "[3/4] Iniciando servidor principal + V2..."
Start-Process -FilePath "npm.cmd" `
  -ArgumentList "run", "dev:all" `
  -WorkingDirectory $projectRoot

Write-Host "[4/4] Aguardando servicos ficarem disponiveis..."
[void](Wait-Url "http://localhost:3000/health" 30)
[void](Wait-Url "http://localhost:4000/health" 30)
[void](Wait-Url "http://localhost:6333/" 30)
[void](Wait-Url "http://localhost:8080/" 90)

Write-Host ""
Write-Host "=== STATUS ==="
Write-Host (Test-Url "http://localhost:3000/health")
Write-Host (Test-Url "http://localhost:4000/health")
Write-Host (Test-Url "http://localhost:6333/")
Write-Host (Test-Url "http://localhost:8080/")
Write-Host ""
Write-Host "Painel admin: http://localhost:4000/admin/"
Write-Host ""
