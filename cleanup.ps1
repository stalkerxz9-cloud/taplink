Get-Process | Where-Object { $_.ProcessName -match "chrome|chromium" } | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Все процессы Chromium завершены." -ForegroundColor Green
