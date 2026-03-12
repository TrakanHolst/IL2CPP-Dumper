# Map Optimizer - Data Pipeline Guide

## Overview

The map optimizer (`optimize-map.js`) handles a three-stage data pipeline:

```
Raw Game Data → Aggregated Files → Optimized Map Files
```

## Data Flow

### Stage 1: Raw Game Data (Source)

Located in `extracted_data/`:
- **`Json/LevelConfig/*.json`** - Level configuration files (tile grids, coordinates)
- **`Json/LevelData/*/`** - Level data with POIs, enemies, interactives
- **`Json/Interactive/InteractiveTable.json`** - Interactive object definitions
- **`TableCfg/*.json`** - Game tables (MapMarkIns, TrackMapPoint, etc.)

### Stage 2: Aggregated Files (Intermediate)

Located in `extracted_data/aggregated/`:
- **`LevelConfigsData.json`** - ✅ Auto-generated from `Json/LevelConfig/*.json`
- **`InteractiveTable.json`** - ✅ Auto-copied from `Json/Interactive/`
- **`TextTable.json`** - ✅ Auto-copied from `TableCfg/`
- **`ExtractedPOIData.json`** - ⚠️ Requires external POI extraction tool
- **`LevelMapMarks.json`** - ⚠️ Requires external POI extraction tool

### Stage 3: Optimized Map Files (Output)

Located in `public/localdb/optimized/map/`:
- **`map-data.json`** - Combined data for all maps
- **`map01-data.json`** - Optimized data for Tundra region
- **`map02-data.json`** - Optimized data for Wuling region

## How the Optimizer Works

### 1. Aggregation Check (Automatic)

When you run `npm run optimize:map`, the optimizer:

1. **Checks if aggregated files exist** - If any are missing, triggers regeneration
2. **Compares timestamps** - If source files are newer than aggregated files, triggers regeneration
3. **Runs `npm run generate:map-data`** - Executes the aggregation script automatically

### 2. Aggregation Script (`generate-map-data.js`)

The optimizer automatically calls `scripts/generate-map-data.js` which generates all aggregated files:

**What it generates:**

1. **ExtractedPOIData.json** (2.5MB, 6,000+ POIs)
   - Parses all `LevelData/*/map*_lv_data*.json` files
   - Extracts POIs (chests, battles, collectibles, campfires, enemies)
   - Maps entity types to i18n IDs for translation
   - Categorizes POIs (treasure, battle, collectible, travel, etc.)

2. **LevelMapMarks.json** (131KB, 324 marks)
   - Processes `DynamicAssets/gamedata/levelgenforruntime/LevelMapMark.json`
   - Extracts dungeon entrances, travel points, special markers
   - Links marks to dungeon series for proper naming

3. **LevelConfigsData.json** (266KB, 90 level configs)
   - Aggregates from `Json/LevelConfig/*.json`
   - Extracts tile grid layouts, coordinates, layer information
   - Processes seamless and non-seamless level data

4. **InteractiveTable.json** (80KB)
   - Processes interactive entity data from `Json/Interactive/InteractiveData/`
   - Maps entity templates to doodad IDs for translation

5. **TextTable.json** (1.4MB)
   - Copies from `TableCfg/TextTable.json`
   - String key to i18n ID mappings

**This script is fully automated** - you don't need to run it manually unless debugging.

## When Aggregated Files Are Regenerated

### Automatically Triggered

The optimizer will **automatically run** `generate:map-data` when:
- ✅ Any aggregated file is missing
- ✅ Source files in `Json/LevelConfig/` are modified (sampled check)
- ✅ Source files in `Json/LevelData/` are modified (sampled check)
- ✅ Source files in `TableCfg/` are modified (sampled check)

The timestamp check samples files to avoid scanning thousands of files on every run.

## Usage

### Normal Workflow

```bash
# Run the optimizer (checks aggregation automatically)
npm run optimize:map
```

Output:
```
✓ Aggregated files are up-to-date
✓ Loaded ExtractedPOIData.json (4662 POIs)
✓ map01: 2862 POIs, 109 map marks, 6 levels
✓ map02: 1800 POIs, 65 map marks, 5 levels
```

### When Aggregated Files Are Missing

```bash
npm run optimize:map
```

Output:
```
⚠️  Aggregated files need updating: Missing aggregated file: LevelConfigsData.json
   Generating aggregated files from raw sources...
   Running: npm run generate:map-data

=== PART 1: Extracting POI Data ===
Extracted 6364 POIs from level data files

=== PART 2: Processing Level Configs ===
Generated 90 level configs

=== PART 3: Extracting Level Map Marks ===
Extracted 324 map marks from LevelMapMark.json

✨ Aggregated files generation complete!

[... then continues with optimization ...]
✓ map01: 2862 POIs, 109 map marks, 6 levels
✓ map02: 1800 POIs, 65 map marks, 5 levels
```

## Troubleshooting

### Issue: "Missing aggregated file: ExtractedPOIData.json"

**Cause:** Aggregated files have not been generated yet
**Solution:** The optimizer will automatically run `npm run generate:map-data` to create them

### Issue: "No POIs showing on map"

**Cause:** ExtractedPOIData.json is outdated or empty
**Solution:** Delete the aggregated file and re-run the optimizer, or manually run `npm run generate:map-data`

### Issue: "Aggregated files keep regenerating"

**Cause:** Source file timestamps are newer than aggregated files
**Solution:** This is normal after game data updates. The aggregation script will run automatically.

### Issue: "Error generating aggregated files"

**Cause:** Missing source files or corrupted level data
**Solution:** Check that `extracted_data/Json/LevelData/` and other source directories exist and contain valid JSON files. Run `npm run generate:map-data` manually to see detailed error messages.

## Configuration

Edit `map-config.json` to configure:
- POI categories to exclude (e.g., test dungeons)
- POI types to exclude (e.g., debug markers)
- Scenes to exclude (e.g., blackbox puzzles)
- Whether to include full tables or extract only used data

## Related Scripts

- **`npm run refresh-data`** - Runs all optimizers including map optimizer
- **`npm run optimize:map`** - Runs only the map optimizer
- **`npm run optimize:i18n`** - Optimizes translations (should run after map optimizer)
