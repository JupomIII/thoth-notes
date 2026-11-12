@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Thoth Notes
cd /d "%~dp0"

set "VENV_PY=backend\.venv\Scripts\python.exe"
set "APP_URL=https://localhost:8443/"

echo.
echo   Thoth Notes
echo   -----------
echo.

if not exist "%VENV_PY%" (
    echo   First run - installing the local server. This may take a few minutes.
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

REM Start the server in its own console window so this launcher can exit.
echo   Starting the sync server...
start "Thoth Notes server" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-server.ps1"

REM Give Uvicorn a moment to bind the port, then open the app.
timeout /t 3 /nobreak >nul

echo.
echo   Server window: "Thoth Notes server"  ^(close it to stop the server^)
echo   iPad address : see the server window ^(https://^<computer-name^>.local:8443^)
echo   Local app    : %APP_URL%
echo.

start "" "%APP_URL%"

echo   Opened %APP_URL% in your default browser.
echo   Leave the server window open while you sync from the iPad.
timeout /t 6 /nobreak >nul
endlocal
