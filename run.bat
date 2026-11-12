@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Thoth Notes
cd /d "%~dp0"

set "VENV_PY=backend\.venv\Scripts\python.exe"
set "CERT=backend\storage\certs\server-cert.pem"
set "TOKEN_FILE=backend\storage\pairing-token.txt"
set "APP_URL=https://localhost:8443/"

echo.
echo   Thoth Notes
echo   -----------
echo.

REM Setup is needed when either the Python environment or the pairing token and
REM certificate are missing; without the certificate the iPad cannot connect.
set "NEED_SETUP="
if not exist "%VENV_PY%" set "NEED_SETUP=1"
if not exist "%TOKEN_FILE%" set "NEED_SETUP=1"
if not exist "%CERT%" set "NEED_SETUP=1"

if defined NEED_SETUP (
    echo   First run - installing the server, pairing token and certificate.
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

if not exist "%CERT%" (
    echo   No certificate in %CERT%.
    echo   Run scripts\install-windows.ps1 to create the token and certificate.
    pause
    exit /b 1
)

REM Start the server in its own console window so this launcher can exit.
echo   Starting the sync server...
start "Thoth Notes server" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-server.ps1"

REM Give Uvicorn a moment to bind the port, then open the app.
timeout /t 3 /nobreak >nul

echo.
echo   Server window: "Thoth Notes server"  ^(close it to stop the server^)
echo   iPad address : see the server window ^(https://^<computer-name^>.local:8443^)
echo   Pairing token: %TOKEN_FILE%
echo   iPad profile : backend\storage\certs\thoth-rootCA.cer
 echo   Local app    : %APP_URL%
echo.

start "" "%APP_URL%"

echo   Opened %APP_URL% in your default browser.
echo   Leave the server window open while you sync from the iPad.
timeout /t 6 /nobreak >nul
endlocal
