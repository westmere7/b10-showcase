@echo off
setlocal
rem =====================================================================
rem  B10 Showcase - start a local web server and open the viewer.
rem  Double-click this file. Close the window (or press Ctrl+C) to stop.
rem =====================================================================

cd /d "%~dp0"
set "PORT=8000"
if not "%~1"=="" set "PORT=%~1"
set "URL=http://localhost:%PORT%/"

rem Prefer Python (py launcher, then python), fall back to Node's npx.
where py >nul 2>nul && ( set "SERVER=py -m http.server %PORT%" & goto :run )
where python >nul 2>nul && ( set "SERVER=python -m http.server %PORT%" & goto :run )
where npx >nul 2>nul && ( set "SERVER=npx --yes http-server -p %PORT% -c-1 ." & goto :run )

echo Could not find Python or Node.js on this PC.
echo Install Python from https://www.python.org/downloads/ and try again.
pause
exit /b 1

:run
echo Serving "%CD%"
echo Open %URL% in your browser (opening it for you now).
echo Press Ctrl+C or close this window to stop the server.
echo.
start "" "%URL%"
%SERVER%
