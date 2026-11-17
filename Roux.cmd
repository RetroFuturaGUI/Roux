@echo off
rem Opens Roux in the web browser. The project is the folder dropped onto this file, else the one Roux lies in, as when
rem Roux is a project's submodule. Closing this window stops Roux.
cd /d "%~dp0" || goto failed

if not exist node_modules (
    echo Installing Roux's packages, the first time only...
    call npm install || goto failed
)

if "%~1"=="" (
    call npm run serve
) else (
    call npm run serve -- --project "%~1"
)
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo Roux couldn't start. Node 22 or newer is needed: https://nodejs.org
pause
exit /b 1
