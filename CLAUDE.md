# IL2CPP Dumper - Build Instructions

## CRITICAL: Output Format Requirements

**This project MUST create the same file structure and format as the reference project at:**
`c:\Users\fonta\GIT\communitywebtemplate\extracted_data\Json\`

### Comparison Rules:
1. **Structure MUST match exactly**: Same fields, same data types, same nesting
2. **Values CAN differ**: Game data updates over time (new positions, items, etc.)
3. **Before committing changes**: Always compare output against reference project
4. **Key validation points**:
   - All fields present in reference must be present in our output
   - Arrays contain proper data (not empty `[]` when they should have data)
   - Enums resolved to names (not raw integers) when reference uses names
   - Struct arrays properly serialized (e.g., `valueArray` with `valueBit64` fields)
   - Dictionary keys use proper types (enum names vs integers)

### Reference Comparison Command:
```bash
# Compare structure (ignore value differences)
diff -u c:/Users/fonta/GIT/communitywebtemplate/extracted_data/Json/MapConfig/map01.json \
        c:/Users/fonta/GIT/IL2CPP-Dumper/extracted_data/Json/MapConfig/map01.json
```

## Building the Project

### Simple Build Command
```bash
cd /c/Users/fonta/GIT/IL2CPP-Dumper
./build.bat
```

This will:
1. Set up Visual Studio environment
2. Build Cheat.dll (the IL2CPP dumper)
3. Build UnlockerIsland.dll
4. Output both to: `EndField.Fps.UnlockerIsland-main/x64/Debug/`

### Build Output
- **Success**: `La génération a réussi` (0 errors, 2 warnings expected)
- **DLL Location**: `EndField.Fps.UnlockerIsland-main/x64/Debug/Cheat.dll`

## Current Extraction Features

### What Gets Extracted (FILTERED FOR MAP GENERATOR)
- **LevelConfig/** - Only map01_* and map02_* files (8 total)
- **MapConfig/** - Only map01 and map02 files (2 total)
- **LevelData/** - Only map01_* and map02_* level folders

### File Naming Format (FIXED)
- **Main files**: `{levelId}_lv_data.json`
- **Sub files**: `{levelId}_lv_data_sub_{mission_name}.json`
  - Mission codes: e1m1, e1m2, c6m1, gm01m1, etc.
  - Features: animal_v1d0, audio, env, factory, npc, boss, defense, etc.

### What's Skipped (Not Needed by Map Generator)
- All single-file config tables (NpcProxyTable, ScriptTaskExtraInfoTable, etc.)
- LevelMountPoint
- Interactive data
- MissionRuntimeAsset, SpawnerConfig, BlockData, ChessboardData, GameMode
- All levels except map01_* and map02_*

### Safety Improvements
- Serialization depth limited to 20 levels (handles complex nested objects)
- Primitive type detection (Int32, Boolean, etc.) to prevent m_value recursion
- Exception handling around all dictionary iterations
- Memory-safe field access with null checks

## Testing the Dumper

1. Build the DLL: `./build.bat`
2. Run Arknights Endfield
3. Inject Cheat.dll into the game process
4. Press **DELETE** key to trigger runtime data dump
5. Check log: `EndField.Fps.UnlockerIsland-main/x64/Debug/IL2CPPDump_Log.txt`
6. View extracted data: `extracted_data/Json/`

## Recent Changes

### File Naming Fix (Latest)
- **FIXED**: Changed from `_FIELD_{fieldname}.json` to correct naming format
- Main file: `{levelId}_lv_data.json`
- Sub files: `{levelId}_lv_data_sub_{mission_name}.json`
- Now uses `SplitAndWriteLevelFiles` to split entities by mission/feature
- Matches communitywebtemplate project structure exactly

### Map Generator Filtering (Latest)
- **FILTERED**: Only extracts files needed by map generator
- LevelConfig: Only map01_* and map02_* (8 files)
- MapConfig: Only map01 and map02 (2 files)
- LevelData: Only map01_* and map02_* level folders
- Skips all single-file tables and unnecessary data

### Primitive Type Fix (m_value recursion)
- **FIXED**: Detects primitive types (Int32, Boolean, Single, etc.) FIRST
- Extracts m_value directly from memory offset 0x10
- Prevents infinite m_value nesting and empty `{}` objects
- Skips m_value fields during normal field iteration

### LevelData Extraction
- Added extraction from `DataManager.m_levelDataCache` field
- Creates per-level folders with main + sub files
- Includes: enemies, interactives, NPCs, level scripts, spawners, patrols, etc.
- Category mapping based on levelLogicId (digits 5-6)

## File Structure

```
IL2CPP-Dumper/
├── build.bat                 # Main build script
├── IL2CPP-Dumper/
│   └── Dump/
│       ├── Dump.vcxproj      # Visual Studio project
│       ├── include/
│       │   └── runtime_dumper.hxx
│       └── src/
│           └── runtime_dumper.cxx  # Main dumper implementation
├── EndField.Fps.UnlockerIsland-main/
│   └── x64/Debug/
│       ├── Cheat.dll         # Output DLL
│       └── IL2CPPDump_Log.txt
└── extracted_data/
    └── Json/                 # Extracted game data
        ├── LevelConfig/
        ├── MapConfig/
        ├── LevelData/        # NEW: Per-level data
        └── ...
```

## Troubleshooting

### Build Issues
- Make sure Visual Studio 2026/2022 is installed
- Ensure VsDevCmd.bat path is correct in build.bat
- Run from Git Bash or similar Unix-like shell on Windows

### Game Crashes
- If game crashes during dump, check log file to see which extraction failed
- May need to skip additional tables in runtime_dumper.cxx
- Reduce serialization depth further if needed

### No Data Extracted
- Make sure you press DELETE after the game is fully loaded
- Check if DataManager singleton was found in the log
- Verify LevelData cache is populated (load into a map first)
