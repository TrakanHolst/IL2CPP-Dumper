@echo off
call "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat"

echo Building Cheat.dll...
cd /d "%~dp0IL2CPP-Dumper"
msbuild Dump.sln -p:Configuration=Release -p:Platform=x64 "-p:OutDir=%~dp0EndField.Fps.UnlockerIsland-main\x64\Debug\\" -v:normal

echo.
echo Building UnlockerIsland.dll...
cd /d "%~dp0EndField.Fps.UnlockerIsland-main\UnlockerIsland"
msbuild UnlockerIsland.vcxproj -p:Configuration=Release -p:Platform=x64 -p:PlatformToolset=v145 -p:WholeProgramOptimization=false "-p:OutDir=%~dp0EndField.Fps.UnlockerIsland-main\x64\Debug\\" -v:normal

echo.
echo Build complete!
