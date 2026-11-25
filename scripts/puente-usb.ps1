# NEXO · Puente USB Serial -> Servidor NEXO (Windows PowerShell, sin dependencias)
# Lee las tramas enviadas por el ESP32 #2 conectado por USB y las publica en vivo en NEXO.
#
# Uso:
#   npm run puente:usb                     (detecta puertos COM disponibles)
#   npm run puente:usb -- -Puerto COM3     (escucha en COM3 y envía a http://localhost:3000)

param(
  [string]$Puerto = "",
  [int]$Baudios = 115200,
  [string]$Servidor = "http://localhost:3000"
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$puertos = @([System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object)
if (-not $Puerto) {
  if ($puertos.Count -eq 0) {
    Write-Host "No se detecto ningun puerto COM. Conecta el ESP32 #2 por cable USB de datos (y verifica driver CP2102/CH340)." -ForegroundColor Red
    exit 1
  } elseif ($puertos.Count -eq 1) {
    $Puerto = $puertos[0]
    Write-Host "Puerto detectado automaticamente: $Puerto" -ForegroundColor Cyan
  } else {
    Write-Host "Puertos COM disponibles: $($puertos -join ', ')" -ForegroundColor Yellow
    Write-Host "Vuelve a ejecutar indicando el puerto del ESP32 #2, por ejemplo:" -ForegroundColor Yellow
    Write-Host "  npm run puente:usb -- -Puerto $($puertos[0])" -ForegroundColor White
    exit 0
  }
}

$sp = New-Object System.IO.Ports.SerialPort $Puerto, $Baudios, 'None', 8, 'One'
$sp.Encoding = [System.Text.Encoding]::UTF8
$sp.NewLine = "`n"
$sp.ReadTimeout = 500
$sp.DtrEnable = $false
$sp.RtsEnable = $false

try {
  $sp.Open()
  Write-Host "=== Puente USB NEXO activo ===" -ForegroundColor Green
  Write-Host "Escuchando ESP32 #2 en $Puerto ($Baudios baudios) -> $Servidor/api/lora/trama" -ForegroundColor Cyan
  Write-Host "Cierra el Monitor Serie de Arduino IDE si esta abierto. Presiona Ctrl+C para detener." -ForegroundColor DarkGray

  while ($true) {
    try {
      $linea = $sp.ReadLine().Trim()
    } catch [System.TimeoutException] {
      continue
    }
    if (-not $linea) { continue }

    if ($linea -match '^TRAMA\|(-?\d+)\|(.+)$') {
      $rssi = [int]$Matches[1]
      $trama = $Matches[2].Trim()
      Write-Host "[ESP-NOW] RSSI $rssi dBm | $trama" -ForegroundColor Yellow

      $payload = @{
        trama  = $trama
        via    = "espnow"
        rssi   = $rssi
        puerta = "USB-$Puerto"
      } | ConvertTo-Json -Compress

      try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
        $resp = Invoke-RestMethod -Uri "$Servidor/api/lora/trama" -Method Post -ContentType "application/json; charset=utf-8" -Body $bytes
        Write-Host "  -> Subido a NEXO: $($resp.tipo) '$($resp.nombre)' ($($resp.personas) personas)" -ForegroundColor Green
      } catch {
        Write-Host "  -> Error enviando a NEXO (esta corriendo 'npm start'?): $($_.Exception.Message)" -ForegroundColor Red
      }
    } else {
      Write-Host "[ESP32] $linea" -ForegroundColor DarkGray
    }
  }
} finally {
  if ($sp.IsOpen) { $sp.Close() }
  Write-Host "Puerto $Puerto cerrado." -ForegroundColor DarkGray
}
