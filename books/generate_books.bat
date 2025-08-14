@echo off
setlocal enabledelayedexpansion
echo Scanning for .rbook files in current directory...

set OUTPUT_FILE=available-books.json
set COUNT=0
set FIRST=true

echo [ > %OUTPUT_FILE%

for %%f in (*.rbook) do (
    if exist "%%f" (
        if "!FIRST!"=="true" (
            set FIRST=false
            echo     "%%f" >> %OUTPUT_FILE%
        ) else (
            echo     ,"%%f" >> %OUTPUT_FILE%
        )
        echo   - %%f
        set /a COUNT+=1
    )
)

echo ] >> %OUTPUT_FILE%

if %COUNT%==0 (
    echo [] > %OUTPUT_FILE%
    echo No .rbook files found. Created empty %OUTPUT_FILE%
) else (
    echo Found %COUNT% .rbook files.
    echo Generated %OUTPUT_FILE%
)

echo Done!