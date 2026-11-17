@echo off
rem Builds everything of Roux: the core, the CLI and the web version (npm run build), the VS Code extension's .vsix and
rem the JetBrains plugin's .zip, both copied to dist\. The web version needs nothing more: roux serve serves the UI as it is.
rem The JetBrains plugin needs an installed JetBrains IDE named in hosts\jetbrains\local.properties (rouxIde=<its folder>);
rem without one it is skipped. Java comes from JAVA_HOME, else from that IDE's own runtime.
setlocal
cd /d "%~dp0" || goto failed

echo === npm packages
call npm install || goto failed

echo === Roux: core, CLI, web version and the VS Code extension's code
call npm run build || goto failed

echo === VS Code extension
pushd hosts\vscode
call npm run package || (popd & goto failed)
popd
if not exist dist mkdir dist
copy /y hosts\vscode\*.vsix dist\ >nul || goto failed

echo === JetBrains plugin
set "ROUX_IDE="
if exist hosts\jetbrains\local.properties (
    for /f "usebackq tokens=1,* delims==" %%a in ("hosts\jetbrains\local.properties") do if "%%a"=="rouxIde" set "ROUX_IDE=%%b"
)
if not defined ROUX_IDE (
    echo Skipped: name an installed JetBrains IDE in hosts\jetbrains\local.properties, as rouxIde=^<its folder^>
    goto done
)
if not defined JAVA_HOME set "JAVA_HOME=%ROUX_IDE%\jbr"
pushd hosts\jetbrains
call .\gradlew.bat buildPlugin --no-daemon -q || (popd & goto failed)
popd
copy /y hosts\jetbrains\build\distributions\*.zip dist\ >nul || goto failed

:done
echo.
echo Done. The packages are in %~dp0dist
pause
exit /b 0

:failed
echo.
echo The build failed; the lines above say where.
pause
exit /b 1
