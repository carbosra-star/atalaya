@echo off
rem Arranca Planificacion Supply en local: http://localhost:8000
rem Se recarga solo al cambiar el codigo. Para pararlo, Ctrl+C o cerrar esta ventana.
title Planificacion Supply
cd /d "%~dp0app"
set "DATA_DIR=%~dp0data"
set PYTHONIOENCODING=utf-8
python app.py
pause
