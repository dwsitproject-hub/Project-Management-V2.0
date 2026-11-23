# Project Management Server Startup Script

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Project Management Server" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Access URLs:" -ForegroundColor Green
Write-Host "- Local:   http://localhost:3000" -ForegroundColor White
Write-Host "- Network: http://172.30.18.102:3000" -ForegroundColor White
Write-Host ""
Write-Host "Share the Network URL with your team!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""


node src/server.js

