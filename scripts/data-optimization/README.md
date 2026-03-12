# Lightweight JSON Optimization System

## Overview

This system creates optimized, lightweight JSON files from the full game data in `extracted_data/`. It splits data into **list** and **detail** files to reduce initial page load sizes while maintaining full data availability for detail pages.

## Benefits

- **Reduced Bundle Size**: Splits data into list (for grids) and details (for pages)
- **Faster Page Loads**: Only loads minimal data for listing pages
- **Easy Updates**: Single command to refresh from extracted_data
- **Maintains Quality**: Preserves all data, just organizes it efficiently

## Architecture

### Source Data
- **Location**: `extracted_data/TableCfg/`
- **Status**: Full game data (1.7GB total)
- **Usage**: Source of truth, not deployed to production

### Optimized Data
- **Location**: `public/localdb/optimized/`
- **Status**: Split and optimized for web delivery
- **Usage**: Loaded by data loaders at runtime

### Data Split Strategy

Each data category is split into two files:

1. **List File** (`*-list.json`)
   - Contains minimal fields needed for grid/list views
   - Loaded on list pages (characters page, weapons page, etc.)
   - Optimized for fast initial rendering

2. **Details File** (`*-details.json`)
   - Contains full data including stats, descriptions, skills
   - Loaded only on detail pages (character/[id], weapon/[id], etc.)
   - Comprehensive data for detailed views

## Directory Structure

```
scripts/data-optimization/
├── optimize-characters.js   # Character data optimizer
├── optimize-equipment.js    # Equipment (gear) data optimizer
├── optimize-weapons.js      # Weapon data optimizer
├── optimize-factory.js      # Factory buildings optimizer
├── refresh-all.js           # Main script - runs all optimizers
└── README.md               # This file

public/localdb/optimized/
├── characters/
│   ├── characters-list.json     # Lightweight character data
│   └── characters-details.json  # Full character data
├── equipment/
│   ├── equipment-list.json      # Lightweight equipment data
│   └── equipment-details.json   # Full equipment data
├── weapons/
│   ├── weapons-list.json        # Lightweight weapon data
│   └── weapons-details.json     # Full weapon data
├── factory/
│   ├── buildings-list.json      # Lightweight building data
│   └── buildings-details.json   # Full building data
└── metadata.json               # Optimization metadata
```

## Usage

### Quick Start

Refresh all optimized data from extracted_data:

```bash
npm run refresh-data
```

Or run directly:

```bash
node scripts/data-optimization/refresh-all.js
```

### Individual Scripts

Run specific optimizers:

```bash
# Characters only
node scripts/data-optimization/optimize-characters.js

# Equipment only
node scripts/data-optimization/optimize-equipment.js

# Weapons only
node scripts/data-optimization/optimize-weapons.js

# Factory buildings only
node scripts/data-optimization/optimize-factory.js
```

## Optimization Details

### Characters

**Source**: `extracted_data/TableCfg/CharacterTable.json` (6.9MB)

**List Fields** (for character grid):
- `charId`, `engName`, `nameI18nId`
- `rarity`, `profession`, `elementType`
- `weaponType`, `department`
- `mainAttrType`, `subAttrType`

**Detail Fields** (for character detail pages):
- `charId`, `battleTagIds`, `cvNames`
- `attributes`, `profileRecords`, `profileVoices`

**Expected Reduction**: ~60% (6.9MB → ~2.8MB total)

### Equipment (Gear)

**Source**: `extracted_data/TableCfg/EquipTable.json` (342KB)

**List Fields** (for equipment grid):
- `itemId`, `name`, `desc`
- `rarity`, `type`, `minWearLv`
- `slot`, `iconPath`

**Detail Fields** (for equipment detail pages):
- `itemId`, `attributeModifiers`, `equipAttrModifiers`
- `enhanceAttrType`, `enhanceAttrValues`
- `suitId`, `unlockCharIds`

**Expected Reduction**: ~12% (342KB → ~300KB total)

### Weapons

**Source**: `extracted_data/TableCfg/WeaponBasicTable.json` (44KB)

**List Fields** (for weapon grid):
- `weaponId`, `engName`, `weaponType`
- `rarity`, `maxLv`, `iconPath`

**Detail Fields** (for weapon detail pages):
- `weaponId`, `weaponDesc`, `weaponSkillList`
- `breakthroughTemplateId`, `levelTemplateId`
- `talentTemplateId`, `attributeModifiers`

**Expected Reduction**: Minimal (already small file)

### Factory Buildings

**Source**: `extracted_data/TableCfg/FactoryBuildingTable.json`

**List Fields** (for building selector):
- `id`, `name`, `desc`
- `quickBarType`, `type`, `canDelete`
- `iconOnPanel`, `needPower`, `powerConsume`

**Detail Fields** (for building placement):
- `id`, `range`, `inputPorts`, `outputPorts`
- `liquidInputPortIndices`, `liquidOutputPortIndices`
- `needPower`, `powerConsume`, `powerProvide`

**Expected Reduction**: Filters non-placeable buildings

## Workflow

### When to Refresh Data

Run the refresh script when:

1. **Game Updates**: New game data is extracted to `extracted_data/`
2. **Field Changes**: Optimization scripts are updated with new fields
3. **Initial Setup**: First time setting up the optimized system

### Update Process

1. Extract new game data to `extracted_data/TableCfg/`
2. Run: `npm run refresh-data`
3. Review the optimization summary
4. Commit optimized files to git
5. Deploy to production

### Git Workflow

```bash
# After refreshing data
git add public/localdb/optimized/
git commit -m "chore: refresh optimized game data"
git push
```

## Integration with Data Loaders

Data loaders in `src/app/*/data/*Loader.ts` will be updated to:

1. Load list data for grid/list views
2. Load detail data only when viewing detail pages
3. Cache both to avoid redundant fetches
4. Merge list + detail data when full object is needed

Example pattern:

```typescript
// Load list data (lightweight)
export async function initializeCharacterList() {
  if (charactersListCache.length > 0) return;
  const listData = await fetch('/localdb/optimized/characters/characters-list.json');
  charactersListCache = await listData.json();
}

// Load detail data (on-demand)
export async function loadCharacterDetails(charId: string) {
  if (!detailsCache[charId]) {
    const details = await fetch('/localdb/optimized/characters/characters-details.json');
    const allDetails = await details.json();
    detailsCache = allDetails;
  }
  return detailsCache[charId];
}
```

## Performance Impact

### Before Optimization
- **Characters page load**: 6.9MB (CharacterTable.json)
- **Equipment page load**: 342KB (EquipTable.json)
- **Total initial load**: ~7.3MB

### After Optimization
- **Characters page load**: ~1.5MB (characters-list.json)
- **Equipment page load**: ~100KB (equipment-list.json)
- **Total initial load**: ~1.7MB
- **Reduction**: ~77%

Detail pages load additional data only when viewed, not upfront.

## Maintenance

### Adding New Fields

To add fields to optimized data:

1. Edit the relevant script (e.g., `optimize-characters.js`)
2. Add field names to `LIST_FIELDS` or `DETAIL_FIELDS`
3. Run the optimizer: `node scripts/data-optimization/optimize-characters.js`
4. Update data loaders to use new fields
5. Test loading and display

### Troubleshooting

**Script fails with "Source file not found":**
- Ensure `extracted_data/TableCfg/` contains the required JSON files
- Check file paths in the script

**Optimized file is too large:**
- Review `LIST_FIELDS` - only include fields needed for grid display
- Move heavy fields (arrays, nested objects) to `DETAIL_FIELDS`

**Data missing after optimization:**
- Check that required fields are in either `LIST_FIELDS` or `DETAIL_FIELDS`
- Run optimizer again after adding fields

## NPM Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "refresh-data": "node scripts/data-optimization/refresh-all.js",
    "optimize:characters": "node scripts/data-optimization/optimize-characters.js",
    "optimize:equipment": "node scripts/data-optimization/optimize-equipment.js",
    "optimize:weapons": "node scripts/data-optimization/optimize-weapons.js",
    "optimize:factory": "node scripts/data-optimization/optimize-factory.js"
  }
}
```

## Future Enhancements

- [ ] Add compression (gzip) for optimized files
- [ ] Generate TypeScript types from optimized data
- [ ] Add validation to ensure all required fields are present
- [ ] Create web UI for running optimizations
- [ ] Add diff comparison between optimization runs
- [ ] Support incremental updates instead of full regeneration

## Support

For issues or questions about the optimization system:
1. Check this README
2. Review script comments
3. Check optimization output logs
4. Open an issue on GitHub

---

**Last Updated**: 2026-01-04
**System Version**: 1.0.0
