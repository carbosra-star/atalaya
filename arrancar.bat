@echo off
rem Arranca Atalaya (Supply) en local: http://localhost:8000
rem Se recarga solo al cambiar el codigo. Para pararlo, Ctrl+C o cerrar esta ventana.
title Atalaya
rem Quita el "modo de edicion rapida" de esta ventana: un clic dentro ya no congela el servidor
powershell -NoProfile -Command "$k=Add-Type -PassThru -Name K -Namespace W -MemberDefinition '[DllImport(\"kernel32.dll\")]public static extern IntPtr GetStdHandle(int h);[DllImport(\"kernel32.dll\")]public static extern bool GetConsoleMode(IntPtr h,out int m);[DllImport(\"kernel32.dll\")]public static extern bool SetConsoleMode(IntPtr h,int m);';$h=$k::GetStdHandle(-10);$m=0;if($k::GetConsoleMode($h,[ref]$m)){[void]$k::SetConsoleMode($h,($m -band -bnot 0x40) -bor 0x80)}" >nul 2>&1
cd /d "%~dp0app"
set "DATA_DIR=%~dp0data"
set PYTHONIOENCODING=utf-8
python app.py
pause
