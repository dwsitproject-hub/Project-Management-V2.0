@echo off
REM Project Management Server Startup Script

echo ========================================
echo Project Management Server
echo ========================================
echo.
echo Access URLs:
echo - Local:   http://localhost:3000
echo - Network: http://172.30.18.102:3000
echo.
echo Share the Network URL with your team!
echo ========================================
echo.


node backend/server.js

