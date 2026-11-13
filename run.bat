@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Thoth Notes
cd /d "%~dp0"

set "VENV_PY=backend\.venv\Scripts\python.exe"
set "CERT=backend\storage\certs\server-cert.pem"
set "TOKEN_FILE=backend\storage\pairing-token.txt"
set "APP_URL=https://localhost:8443/"
set "PAIR_URL=https://localhost:8443/pair"

echo.
echo   Thoth Notes
echo   -----------
echo.

REM Setup is needed when the Python environment, the pairing token or the trust
REM profile is missing; without them the iPad cannot connect.
REM A trusted public address (tunnel) replaces the certificate entirely.
set "TUNNEL="
if exist "backend\storage\config.json" (
    findstr /C:"\"public_url\": \"http" "backend\storage\config.json" >nul 2>&1 && set "TUNNEL=1"
)

set "NEED_SETUP="
if not exist "%VENV_PY%" set "NEED_SETUP=1"
if not exist "%TOKEN_FILE%" set "NEED_SETUP=1"
if not exist "%CERT%" if not defined TUNNEL set "NEED_SETUP=1"

if defined NEED_SETUP (
    echo   First run - installing the server, pairing token and trust profile.
    echo   This may take a few minutes.
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install-windows.ps1"
    if errorlevel 1 (
        echo.
        echo   Installation failed. Run scripts\install-windows.ps1 directly to see the error.
        pause
        exit /b 1
    )
)

if not exist "%VENV_PY%" (
    echo   Server is not installed: %VENV_PY% is missing.
    pause
    exit /b 1
)

if not exist "%CERT%" if not defined TUNNEL (
    echo   No certificate in %CERT% and no trusted address configured.
    echo   Run scripts\install-windows.ps1 to create the token and certificate,
    echo   or start the server with -PublicUrl if a tunnel fronts it.
    pause
    exit /b 1
)

REM Start the server minimised: the pairing page in the browser is the interface.
echo   Starting the sync server...
start "Thoth Notes server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-server.ps1"

REM Wait until the port accepts connections instead of guessing a delay.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(40); while((Get-Date) -lt $deadline){ try { $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',8443); $c.Close(); exit 0 } catch { Start-Sleep -Milliseconds 400 } }; exit 1" >nul 2>&1

start "" "%PAIR_URL%"

echo.
echo   Pairing page : %PAIR_URL%  ^(opened in your browser^)
echo   First time on the iPad: the pairing page lists the three steps.
echo   The trust profile is downloaded from the laptop at /setup - never sent.
echo   Scan the QR code there with the iPad camera.
echo   The server runs in the minimised "Thoth Notes server" window.
echo   Lost the code? powershell -ExecutionPolicy Bypass -File scripts\pair.ps1
echo.
timeout /t 8 /nobreak >nul
endlocal
