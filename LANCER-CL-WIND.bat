@echo off
rem CL-WIND : ouvre index.html dans Chrome, sinon Edge, sinon le navigateur par defaut.
rem Chrome et Edge sont lances dans un profil dedie a CL-WIND avec la carte graphique
rem haute performance (NVIDIA, AMD dediee) : sous Windows, la page ne peut pas la choisir
rem elle-meme, et l'option n'agit que sur un navigateur qui demarre, d'ou le profil dedie.
setlocal
set "APP=%~dp0index.html"
set "PROFIL=%LocalAppData%\CL-WIND\navigateur"
set "OPTS=--user-data-dir="%PROFIL%" --force_high_performance_gpu --no-first-run --no-default-browser-check --new-window"

set "B=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%B%" goto ouvrir
set "B=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%B%" goto ouvrir
set "B=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%B%" goto ouvrir
set "B=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%B%" goto ouvrir
set "B=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%B%" goto ouvrir

echo Chrome et Edge introuvables : ouverture avec le navigateur par defaut.
echo Pour le calcul rapide (WebGPU), utilisez Chrome ou Edge recents.
start "" "%APP%"
timeout /t 6 >nul
goto fin

:ouvrir
start "" "%B%" %OPTS% "%APP%"

:fin
endlocal
