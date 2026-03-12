#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const JSONbig = require('json-bigint');

// Configure json-bigint to convert all numbers to strings to preserve precision
const JSONbigString = JSONbig({ storeAsString: true });

// NOTE: i18n deduplication is DISABLED for map data
// The map uses many unique i18n IDs and the runtime translate() function
// doesn't support dedup lookups, so deduplication would break the map.

/**
 * Custom JSON parser that preserves large numbers as strings
 */
function parseJSONWithBigInt(text) {
  // Fix large i18n IDs in nameI18nId, descI18nId, etc.
  const fixedText = text.replace(
    /"(nameI18nId|descI18nId|id)"\s*:\s*(\d{15,})/g,
    (match, field, number) => `"${field}": "${number}"`
  );
  return JSONbigString.parse(fixedText);
}

function stringifyJSONWithBigInt(obj) {
  return JSONbigString.stringify(obj, null, 2);
}

// Paths - Raw source data
const RAW_LEVEL_CONFIG_DIR = path.join(__dirname, '../../extracted_data/Json/LevelConfig');
const RAW_LEVEL_DATA_DIR = path.join(__dirname, '../../extracted_data/Json/LevelData');
const RAW_TABLECFG_DIR = path.join(__dirname, '../../extracted_data/TableCfg');

// Paths - Aggregated data (generated from raw sources by this optimizer)
const AGGREGATED_DIR = path.join(__dirname, '../../extracted_data/aggregated');
const EXTRACTED_POI_PATH = path.join(AGGREGATED_DIR, 'ExtractedPOIData.json');
const INTERACTIVE_TABLE_PATH = path.join(AGGREGATED_DIR, 'InteractiveTable.json');
const TEXT_TABLE_PATH = path.join(AGGREGATED_DIR, 'TextTable.json');
const LEVEL_CONFIGS_PATH = path.join(AGGREGATED_DIR, 'LevelConfigsData.json');
const LEVEL_MAP_MARKS_PATH = path.join(AGGREGATED_DIR, 'LevelMapMarks.json');

// Raw game tables from TableCfg (read directly - no aggregation needed)
const MAP_MARK_INS_PATH = path.join(RAW_TABLECFG_DIR, 'MapMarkInsTable.json');
const MAP_MARK_TYPE_PATH = path.join(RAW_TABLECFG_DIR, 'MapMarkTypeTable.json');
const TRACK_MAP_POINT_PATH = path.join(RAW_TABLECFG_DIR, 'TrackMapPointTable.json');
const WORLD_ENERGY_POINT_PATH = path.join(RAW_TABLECFG_DIR, 'WorldEnergyPointTable.json');
const COLLECTION_PATH = path.join(RAW_TABLECFG_DIR, 'CollectionTable.json');
const MAP_ID_PATH = path.join(RAW_TABLECFG_DIR, 'MapIdTable.json');
const ENEMY_TEMPLATE_PATH = path.join(RAW_TABLECFG_DIR, 'EnemyTemplateDisplayInfoTable.json');

const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/map');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'map-data.json');
const CONFIG_FILE = path.join(__dirname, 'map-config.json');

// Per-map output files
const MAP_OUTPUT_FILES = {
  'map01': path.join(OUTPUT_DIR, 'map01-data.json'),
  'map02': path.join(OUTPUT_DIR, 'map02-data.json'),
};

/**
 * Default configuration for map data optimization
 *
 * excludePOICategories: Array of POI category strings to exclude from the optimized file
 * excludePOITypes: Array of POI entityType strings to exclude from the optimized file
 * excludeScenes: Array of sceneId strings to exclude from the optimized file
 * includeFullTextTable: Whether to include the full TextTable.json (1.1MB) or extract only used IDs
 * includeFullLevelConfigs: Whether to include the full LevelConfigsData.json (287KB) or extract only used scenes
 */
const DEFAULT_CONFIG = {
  excludePOICategories: [],
  excludePOITypes: [],
  excludeScenes: [],
  includeFullTextTable: false,
  includeFullLevelConfigs: false,
  // Example exclusions (commented out by default):
  // excludePOICategories: ['dungeon', 'test'],
  // excludePOITypes: ['int_dungeon_exit', 'int_test_marker'],
  // excludeScenes: ['base01_dg003', 'test_scene'],
};

/**
 * Check if aggregated files need regeneration
 * Returns true if any aggregated file is missing or older than source files
 */
function checkAggregatedFilesStatus() {
  // Check if aggregated directory exists
  if (!fs.existsSync(AGGREGATED_DIR)) {
    return { needsUpdate: true, reason: 'Aggregated directory does not exist' };
  }

  // Check if aggregated files exist
  const requiredFiles = [
    { path: EXTRACTED_POI_PATH, name: 'ExtractedPOIData.json' },
    { path: LEVEL_CONFIGS_PATH, name: 'LevelConfigsData.json' },
    { path: LEVEL_MAP_MARKS_PATH, name: 'LevelMapMarks.json' },
    { path: INTERACTIVE_TABLE_PATH, name: 'InteractiveTable.json' },
    { path: TEXT_TABLE_PATH, name: 'TextTable.json' }
  ];

  for (const file of requiredFiles) {
    if (!fs.existsSync(file.path)) {
      return { needsUpdate: true, reason: `Missing aggregated file: ${file.name}` };
    }
  }

  // Get oldest aggregated file timestamp
  let oldestAggregatedTime = Infinity;
  for (const file of requiredFiles) {
    const stat = fs.statSync(file.path);
    oldestAggregatedTime = Math.min(oldestAggregatedTime, stat.mtimeMs);
  }

  // Check if any source directory has newer files
  const sourceDirs = [
    { path: RAW_LEVEL_CONFIG_DIR, name: 'LevelConfig' },
    { path: RAW_LEVEL_DATA_DIR, name: 'LevelData' },
    { path: RAW_TABLECFG_DIR, name: 'TableCfg' }
  ];

  for (const dir of sourceDirs) {
    if (!fs.existsSync(dir.path)) {
      continue; // Skip if source doesn't exist
    }

    // Check if directory or any file in it is newer
    const stat = fs.statSync(dir.path);
    if (stat.mtimeMs > oldestAggregatedTime) {
      return { needsUpdate: true, reason: `Source directory ${dir.name} has been modified` };
    }

    // Sample a few files from the directory (checking all would be slow)
    try {
      const files = fs.readdirSync(dir.path);
      const sampleSize = Math.min(10, files.length);
      for (let i = 0; i < sampleSize; i++) {
        const filePath = path.join(dir.path, files[i]);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const fileStat = fs.statSync(filePath);
          if (fileStat.mtimeMs > oldestAggregatedTime) {
            return { needsUpdate: true, reason: `Source file ${files[i]} has been modified` };
          }
        }
      }
    } catch (err) {
      // Ignore errors reading directory
    }
  }

  return { needsUpdate: false };
}

/**
 * Generate aggregated files from raw source data
 * This should be called when aggregated files are missing or outdated
 *
 * Runs the generate-map-data.js script which extracts:
 * - ExtractedPOIData.json (from level data files)
 * - LevelMapMarks.json (from LevelMapMark.json)
 * - LevelConfigsData.json (from LevelConfig/*.json)
 * - InteractiveTable.json (from Interactive data)
 * - TextTable.json (from TableCfg)
 */
function generateAggregatedFiles() {
  console.log('\n🔄 Generating aggregated files from raw source data...\n');
  console.log('   Running: npm run generate:map-data\n');

  // Run the generate-map-data.js script which creates all aggregated files
  const { execSync } = require('child_process');

  try {
    execSync('npm run generate:map-data', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '../..')
    });

    console.log('\n✨ Aggregated files generation complete!\n');
  } catch (error) {
    console.error('\n❌ Error generating aggregated files:', error.message);
    console.error('   Please run "npm run generate:map-data" manually to see detailed errors.\n');
    throw error;
  }
}

/**
 * Load or create configuration file
 */
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const configText = fs.readFileSync(CONFIG_FILE, 'utf8');
      const config = JSON.parse(configText);
      console.log('📋 Loaded configuration from map-config.json');
      return { ...DEFAULT_CONFIG, ...config };
    } catch (error) {
      console.warn('⚠ Error loading config file, using defaults:', error.message);
      return DEFAULT_CONFIG;
    }
  } else {
    // Create default config file
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
    console.log('📝 Created default configuration file: map-config.json');
    return DEFAULT_CONFIG;
  }
}

/**
 * Filter POI data based on configuration
 */
function filterPOIData(poiData, config) {
  let filtered = poiData;
  let excludedCount = 0;
  const initialCount = poiData.length;

  // Filter by category
  if (config.excludePOICategories.length > 0) {
    const beforeCount = filtered.length;
    filtered = filtered.filter(poi => !config.excludePOICategories.includes(poi.category));
    excludedCount += (beforeCount - filtered.length);
  }

  // Filter by entity type
  if (config.excludePOITypes.length > 0) {
    const beforeCount = filtered.length;
    filtered = filtered.filter(poi => !config.excludePOITypes.includes(poi.entityType));
    excludedCount += (beforeCount - filtered.length);
  }

  // Filter by scene
  if (config.excludeScenes.length > 0) {
    const beforeCount = filtered.length;
    filtered = filtered.filter(poi => !config.excludeScenes.includes(poi.sceneId));
    excludedCount += (beforeCount - filtered.length);
  }

  if (excludedCount > 0) {
    console.log(`   ✓ Filtered ${excludedCount} POIs (${initialCount} → ${filtered.length})`);
  }

  // Flatten POI structure - extract coordinates from nested position object
  // Some POIs have coordinates in position.x/y/z, others have them at top level
  filtered = filtered.map(poi => {
    // If coordinates are nested in position object, extract them to top level
    if (poi.position && typeof poi.position === 'object') {
      return {
        ...poi,
        x: poi.position.x,
        y: poi.position.y,
        z: poi.position.z,
        // Keep position object for backward compatibility if needed
      };
    }
    // If already flat, return as-is
    return poi;
  });

  return filtered;
}

/**
 * Extract only used i18n IDs from TextTable
 */
function extractUsedTextData(textTable, usedIds) {
  const extracted = {};
  let extractedCount = 0;

  usedIds.forEach(id => {
    if (textTable[id]) {
      extracted[id] = textTable[id];
      extractedCount++;
    }
  });

  return { extracted, extractedCount };
}

// Tier numbers that indicate underground layers
const UNDERGROUND_TIER_MAPS = new Set([
  17, 18, 19,      // General underground tiers
  52, 56,          // Additional underground tiers
  109, 120,        // Cave/tunnel tiers
  133,             // Underground tier
  171, 173, 174, 177, // Deep underground tiers
  187,             // Underground tier
]);

// Tier numbers that indicate top/elevated layers
const TOP_TIER_MAPS = new Set([
  107,             // Top tier
  175,             // Top tier
]);

// Grid cell size in meters
const GRID_CELL_SIZE = 128;

// Dynamically calculated Y thresholds - populated by analyzeUndergroundThresholds()
let LEVEL_Y_THRESHOLDS = {};

/**
 * Analyze POIs with explicit tierIndex to calculate Y thresholds per level.
 * Underground POIs (tierIndex < 0) are used to find the max Y coordinate.
 * The threshold is set to maxY + small margin to catch edge cases.
 *
 * @param poiData - Array of POIs (from ExtractedPOIData and LevelMapMarks)
 */
function analyzeUndergroundThresholds(poiData) {
  // Group POIs by level and collect Y coords for underground POIs
  const levelUndergroundY = {}; // levelId -> array of Y coords

  for (const poi of poiData) {
    // Only consider POIs with explicit underground tierIndex
    if (poi.tierIndex !== undefined && poi.tierIndex < 0) {
      const levelId = poi.sceneId || poi.levelId;
      if (!levelId) continue;

      const y = poi.position?.y ?? poi.y;
      if (y === undefined) continue;

      if (!levelUndergroundY[levelId]) {
        levelUndergroundY[levelId] = [];
      }
      levelUndergroundY[levelId].push(y);
    }
  }

  // Calculate threshold for each level: maxY + 1 (minimal margin for float precision)
  // The threshold should be very close to the actual max underground Y
  // POIs below this threshold are underground, above are base
  const thresholds = {};
  for (const [levelId, yCoords] of Object.entries(levelUndergroundY)) {
    if (yCoords.length > 0) {
      const maxY = Math.max(...yCoords);
      // Add minimal margin (1) for floating point precision only
      thresholds[levelId] = Math.round(maxY + 1);
    }
  }

  console.log(`   ✓ Calculated Y thresholds for ${Object.keys(thresholds).length} levels from ${poiData.filter(p => p.tierIndex < 0).length} underground POIs`);

  // Log the calculated thresholds
  for (const [levelId, threshold] of Object.entries(thresholds)) {
    const count = levelUndergroundY[levelId].length;
    const maxY = Math.max(...levelUndergroundY[levelId]);
    console.log(`      ${levelId}: threshold=${threshold} (maxY=${maxY}, ${count} underground POIs)`);
  }

  return thresholds;
}

/**
 * Find which level has tile data at the POI's actual world position.
 * This checks the POI's coordinates against all levels' tile data.
 *
 * @param poi - The POI with position.x, position.z
 * @param levelConfigs - Object of all level configs
 * @returns Object with { levelConfig, tileInfo } or null if no tile data at position
 */
function findTileDataAtPosition(poi, levelConfigs) {
  const poiX = poi.position?.x ?? poi.x;
  const poiZ = poi.position?.z ?? poi.z;

  if (poiX === undefined || poiZ === undefined) return null;

  const poiGridX = Math.floor(poiX / GRID_CELL_SIZE);
  const poiGridY = Math.floor(poiZ / GRID_CELL_SIZE);

  // Check all levels for tile data at this position
  for (const levelConfig of Object.values(levelConfigs)) {
    if (!levelConfig?.tileLayers?.tileLayerMap) continue;

    const grids = levelConfig.levelGrids || [];
    if (grids.length === 0) continue;

    // Check if POI grid position is within this level's grid bounds
    const minGridX = Math.min(...grids.map(g => g.x));
    const maxGridX = Math.max(...grids.map(g => g.x));
    const minGridY = Math.min(...grids.map(g => g.y));
    const maxGridY = Math.max(...grids.map(g => g.y));

    if (poiGridX < minGridX || poiGridX > maxGridX ||
        poiGridY < minGridY || poiGridY > maxGridY) {
      continue; // POI is outside this level's grid bounds
    }

    // Calculate tile key for this level
    const tileX = poiGridX - minGridX + 1;
    const tileY = poiGridY - minGridY + 1;
    const tileKey = `${tileX}_${tileY}`;

    const tileLayers = levelConfig.tileLayers.tileLayerMap[tileKey];
    if (!tileLayers || tileLayers.length === 0) continue;

    // Found tile data at this position
    let hasBase = tileLayers[0] !== null;
    let hasUnderground = false;
    let hasTop = false;

    for (const tierMap of tileLayers) {
      if (tierMap === null) continue;
      if (UNDERGROUND_TIER_MAPS.has(tierMap)) hasUnderground = true;
      if (TOP_TIER_MAPS.has(tierMap)) hasTop = true;
    }

    return {
      levelConfig,
      tileInfo: { hasBase, hasUnderground, hasTop }
    };
  }

  return null; // No level has tile data at this position
}

/**
 * Calculate the correct layer for a POI based on tile data at its position.
 *
 * Layer detection logic:
 * 1. Find which level has tile data at the POI's actual world position (not based on sceneId)
 * 2. If NO level has tile data at position → ALWAYS base
 * 3. If tile has ONLY base layer → POI is base
 * 4. If tile has MULTIPLE layers:
 *    a. Use explicit tierIndex if set (most reliable)
 *    b. Use Y-threshold for tiles with underground layers
 *
 * @param poi - The POI to calculate layer for
 * @param levelConfigs - Object of all level configs
 * @returns The layer index (0 = base, 1 = underground, 2 = top)
 */
function calculatePOILayer(poi, levelConfigs) {
  // Find tile data at the POI's actual world position
  const result = findTileDataAtPosition(poi, levelConfigs);

  // CRITICAL: If NO tile data at this position → ALWAYS base
  if (!result) {
    return 0;
  }

  const { levelConfig, tileInfo } = result;
  const tileHasUnderground = tileInfo.hasUnderground ?? false;
  const tileHasTop = tileInfo.hasTop ?? false;

  // If tile has ONLY base layer, POI is always base
  if (!tileHasUnderground && !tileHasTop) {
    return 0;
  }

  // Tile has multiple layers - determine which layer the POI belongs to

  // 1. Use tierIndex if explicitly set (most reliable)
  if (poi.tierIndex !== undefined && poi.tierIndex !== 0) {
    if (poi.tierIndex < 0 && tileHasUnderground) {
      return 1; // Underground
    } else if (poi.tierIndex > 0 && tileHasTop) {
      return 2; // Top
    }
  }

  // 2. Use Y-threshold for tiles that HAVE underground layers
  // Use the COVERING level's threshold (the level that actually has the tile data)
  if (tileHasUnderground) {
    const threshold = LEVEL_Y_THRESHOLDS[levelConfig.id];

    if (threshold !== undefined) {
      const poiY = poi.position?.y ?? poi.y;
      if (poiY !== undefined && poiY < threshold) {
        return 1; // Underground - Y is below threshold on a multi-layer tile
      }
    }
  }

  // Default to base
  return 0;
}

/**
 * Calculate and add layer property to all POIs.
 * This pre-calculates the correct layer based on tile data at each POI's position.
 *
 * @param poiData - Array of POIs
 * @param levelConfigs - Object of level configs
 */
function calculatePOILayers(poiData, levelConfigs) {
  if (!poiData || !levelConfigs) return;

  let baseCount = 0;
  let undergroundCount = 0;
  let topCount = 0;

  for (const poi of poiData) {
    poi.calculatedLayer = calculatePOILayer(poi, levelConfigs);

    switch (poi.calculatedLayer) {
      case 0: baseCount++; break;
      case 1: undergroundCount++; break;
      case 2: topCount++; break;
    }
  }

  console.log(`   ✓ Calculated POI layers: ${baseCount} base, ${undergroundCount} underground, ${topCount} top`);
}

/**
 * Extract only used scene data from LevelConfigs
 * LevelConfigs are indexed by numeric IDs, so we need to search for configs where config.id matches sceneId
 */
function extractUsedLevelConfigs(levelConfigs, usedScenes) {
  const extracted = {};
  let extractedCount = 0;

  // Convert usedScenes Set to array for easier checking
  const sceneArray = Array.from(usedScenes);

  // Search through all level configs to find ones matching used scenes
  Object.entries(levelConfigs).forEach(([configKey, config]) => {
    if (config.id && sceneArray.includes(config.id)) {
      extracted[configKey] = config;
      extractedCount++;
    }
  });

  return { extracted, extractedCount };
}

/**
 * Main optimization function
 */
function optimizeMapData() {
  console.log('🔧 Starting map data optimization...\n');

  // Check if aggregated files need updating
  const aggregatedStatus = checkAggregatedFilesStatus();
  if (aggregatedStatus.needsUpdate) {
    console.log(`⚠️  Aggregated files need updating: ${aggregatedStatus.reason}`);
    console.log('   Generating aggregated files from raw sources...\n');
    generateAggregatedFiles();
  } else {
    console.log('✓ Aggregated files are up-to-date\n');
  }

  // Load configuration
  const config = loadConfig();
  console.log('\n📊 Configuration:');
  console.log(`   Exclude POI Categories: ${config.excludePOICategories.length > 0 ? config.excludePOICategories.join(', ') : 'None'}`);
  console.log(`   Exclude POI Types: ${config.excludePOITypes.length > 0 ? config.excludePOITypes.join(', ') : 'None'}`);
  console.log(`   Exclude Scenes: ${config.excludeScenes.length > 0 ? config.excludeScenes.join(', ') : 'None'}`);
  console.log(`   Include Full TextTable: ${config.includeFullTextTable}`);
  console.log(`   Include Full LevelConfigs: ${config.includeFullLevelConfigs}\n`);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const optimizedData = {};
  let totalOriginalSize = 0;

  console.log('📖 Reading source data...\n');

  // 1. Load and filter POI data (largest file)
  if (fs.existsSync(EXTRACTED_POI_PATH)) {
    const poiText = fs.readFileSync(EXTRACTED_POI_PATH, 'utf8');
    const poiData = parseJSONWithBigInt(poiText);
    totalOriginalSize += fs.statSync(EXTRACTED_POI_PATH).size;

    const filteredPOI = filterPOIData(poiData, config);
    optimizedData.poiData = filteredPOI;
    console.log(`   ✓ Loaded ExtractedPOIData.json (${filteredPOI.length} POIs)`);
  }

  // 2. Load and filter MapMarkInsTable (exclude specified mark types)
  if (fs.existsSync(MAP_MARK_INS_PATH)) {
    const markInsText = fs.readFileSync(MAP_MARK_INS_PATH, 'utf8');
    const allMarks = parseJSONWithBigInt(markInsText);
    totalOriginalSize += fs.statSync(MAP_MARK_INS_PATH).size;

    // Filter out excluded mark types
    const excludeMarkTypes = config.excludeMarkTypes || [];
    const filteredMarks = {};
    let excludedCount = 0;

    Object.entries(allMarks).forEach(([key, mark]) => {
      if (!excludeMarkTypes.includes(mark.markInfoId)) {
        filteredMarks[key] = mark;
      } else {
        excludedCount++;
      }
    });

    optimizedData.mapMarkIns = filteredMarks;
    console.log(`   ✓ Filtered MapMarkInsTable.json (${Object.keys(filteredMarks).length} marks, excluded ${excludedCount})`);
  }

  // 3. Load MapMarkTypeTable
  if (fs.existsSync(MAP_MARK_TYPE_PATH)) {
    const markTypeText = fs.readFileSync(MAP_MARK_TYPE_PATH, 'utf8');
    optimizedData.mapMarkType = parseJSONWithBigInt(markTypeText);
    totalOriginalSize += fs.statSync(MAP_MARK_TYPE_PATH).size;
    console.log(`   ✓ Loaded MapMarkTypeTable.json (${Object.keys(optimizedData.mapMarkType).length} types)`);
  }

  // 4. Load TrackMapPointTable
  if (fs.existsSync(TRACK_MAP_POINT_PATH)) {
    const trackText = fs.readFileSync(TRACK_MAP_POINT_PATH, 'utf8');
    optimizedData.trackMapPoint = parseJSONWithBigInt(trackText);
    totalOriginalSize += fs.statSync(TRACK_MAP_POINT_PATH).size;
    console.log(`   ✓ Loaded TrackMapPointTable.json (${Object.keys(optimizedData.trackMapPoint).length} points)`);
  }

  // 5. Load WorldEnergyPointTable
  if (fs.existsSync(WORLD_ENERGY_POINT_PATH)) {
    const energyText = fs.readFileSync(WORLD_ENERGY_POINT_PATH, 'utf8');
    optimizedData.worldEnergyPoint = parseJSONWithBigInt(energyText);
    totalOriginalSize += fs.statSync(WORLD_ENERGY_POINT_PATH).size;
    console.log(`   ✓ Loaded WorldEnergyPointTable.json (${Object.keys(optimizedData.worldEnergyPoint).length} points)`);
  }

  // 6. Load CollectionTable
  if (fs.existsSync(COLLECTION_PATH)) {
    const collectionText = fs.readFileSync(COLLECTION_PATH, 'utf8');
    optimizedData.collection = parseJSONWithBigInt(collectionText);
    totalOriginalSize += fs.statSync(COLLECTION_PATH).size;
    console.log(`   ✓ Loaded CollectionTable.json (${Object.keys(optimizedData.collection).length} items)`);
  }

  // 7. Load MapIdTable
  if (fs.existsSync(MAP_ID_PATH)) {
    const mapIdText = fs.readFileSync(MAP_ID_PATH, 'utf8');
    optimizedData.mapId = parseJSONWithBigInt(mapIdText);
    totalOriginalSize += fs.statSync(MAP_ID_PATH).size;
    console.log(`   ✓ Loaded MapIdTable.json (${Object.keys(optimizedData.mapId).length} maps)`);
  }

  // 8. Load InteractiveTable
  if (fs.existsSync(INTERACTIVE_TABLE_PATH)) {
    const interactiveText = fs.readFileSync(INTERACTIVE_TABLE_PATH, 'utf8');
    optimizedData.interactive = parseJSONWithBigInt(interactiveText);
    totalOriginalSize += fs.statSync(INTERACTIVE_TABLE_PATH).size;
    console.log(`   ✓ Loaded InteractiveTable.json (${Object.keys(optimizedData.interactive).length} items)`);
  }

  // 9. Load TextTable (with optional extraction)
  if (fs.existsSync(TEXT_TABLE_PATH)) {
    const textTableText = fs.readFileSync(TEXT_TABLE_PATH, 'utf8');
    const fullTextTable = parseJSONWithBigInt(textTableText);
    totalOriginalSize += fs.statSync(TEXT_TABLE_PATH).size;

    if (config.includeFullTextTable) {
      optimizedData.textTable = fullTextTable;
      console.log(`   ✓ Loaded TextTable.json (full, ${Object.keys(fullTextTable).length} entries)`);
    } else {
      // Extract only i18n IDs used by POIs, zone names, and sub-zone locations
      const usedIds = new Set();
      if (optimizedData.poiData) {
        optimizedData.poiData.forEach(poi => {
          if (poi.nameI18nId) usedIds.add(poi.nameI18nId);
          if (poi.descI18nId) usedIds.add(poi.descI18nId);
        });
      }

      // Add map name i18n IDs
      if (config.mapNameI18nIds) {
        Object.values(config.mapNameI18nIds).forEach(id => usedIds.add(id));
      }

      // Add zone name i18n IDs
      if (config.zoneNameI18nIds) {
        Object.values(config.zoneNameI18nIds).forEach(id => usedIds.add(id));
      }

      // Add sub-zone location i18n IDs
      if (config.subZoneLocationI18nIds) {
        Object.values(config.subZoneLocationI18nIds).forEach(idArray => {
          idArray.forEach(id => usedIds.add(id));
        });
      }

      const { extracted, extractedCount } = extractUsedTextData(fullTextTable, usedIds);
      optimizedData.textTable = extracted;
      console.log(`   ✓ Loaded TextTable.json (extracted ${extractedCount} / ${Object.keys(fullTextTable).length} entries)`);
    }
  }

  // 10. Load LevelConfigsData (with optional extraction)
  if (fs.existsSync(LEVEL_CONFIGS_PATH)) {
    const levelConfigsText = fs.readFileSync(LEVEL_CONFIGS_PATH, 'utf8');
    const fullLevelConfigs = parseJSONWithBigInt(levelConfigsText);
    totalOriginalSize += fs.statSync(LEVEL_CONFIGS_PATH).size;

    if (config.includeFullLevelConfigs) {
      optimizedData.levelConfigs = fullLevelConfigs;
      console.log(`   ✓ Loaded LevelConfigsData.json (full, ${Object.keys(fullLevelConfigs).length} scenes)`);
    } else {
      // Extract scenes used by POIs AND all seamless map levels (map01_*, map02_*, etc.)
      const usedScenes = new Set();
      if (optimizedData.poiData) {
        optimizedData.poiData.forEach(poi => {
          if (poi.sceneId) usedScenes.add(poi.sceneId);
        });
      }

      // Always include seamless map levels for rendering (map01_lv*, map02_lv*)
      // These are needed even if no POIs exist, for map tiles to render
      // BUT respect the excludeScenes config (for unreleased content)
      const excludeScenes = config.excludeScenes || [];
      Object.values(fullLevelConfigs).forEach(levelConfig => {
        if (levelConfig.id && levelConfig.isSeamless && !excludeScenes.includes(levelConfig.id)) {
          // Include seamless levels that are not explicitly excluded
          usedScenes.add(levelConfig.id);
        }
      });

      const { extracted, extractedCount } = extractUsedLevelConfigs(fullLevelConfigs, usedScenes);
      optimizedData.levelConfigs = extracted;
      console.log(`   ✓ Loaded LevelConfigsData.json (extracted ${extractedCount} / ${Object.keys(fullLevelConfigs).length} scenes)`);
    }
  }

  // 11. Load EnemyTemplateDisplayInfoTable (for enemy names)
  if (fs.existsSync(ENEMY_TEMPLATE_PATH)) {
    const enemyTemplateText = fs.readFileSync(ENEMY_TEMPLATE_PATH, 'utf8');
    optimizedData.enemyTemplate = parseJSONWithBigInt(enemyTemplateText);
    totalOriginalSize += fs.statSync(ENEMY_TEMPLATE_PATH).size;
    console.log(`   ✓ Loaded EnemyTemplateDisplayInfoTable.json (${Object.keys(optimizedData.enemyTemplate).length} enemies)`);
  }

  // 11.5. Load LevelMapMarks (dungeon entrances, travel points, etc. from LevelMapMark.json)
  if (fs.existsSync(LEVEL_MAP_MARKS_PATH)) {
    const levelMapMarksText = fs.readFileSync(LEVEL_MAP_MARKS_PATH, 'utf8');
    optimizedData.levelMapMarks = parseJSONWithBigInt(levelMapMarksText);
    totalOriginalSize += fs.statSync(LEVEL_MAP_MARKS_PATH).size;
    console.log(`   ✓ Loaded LevelMapMarks.json (${optimizedData.levelMapMarks.length} marks)`);
  }

  // 12. Add ore cluster, spcstone, and plant i18n IDs from config
  if (config.oreClusterI18nIds) {
    optimizedData.oreClusterI18nIds = config.oreClusterI18nIds;
    console.log(`   ✓ Added ore cluster i18n IDs (${Object.keys(config.oreClusterI18nIds).length} entries)`);
  }
  if (config.spcstoneI18nIds) {
    optimizedData.spcstoneI18nIds = config.spcstoneI18nIds;
    console.log(`   ✓ Added spcstone i18n IDs (${Object.keys(config.spcstoneI18nIds).length} entries)`);
  }
  if (config.plantI18nIds) {
    optimizedData.plantI18nIds = config.plantI18nIds;
    console.log(`   ✓ Added plant i18n IDs (${Object.keys(config.plantI18nIds).length} entries)`);
  }

  // 13. Add map name i18n IDs from config
  if (config.mapNameI18nIds) {
    optimizedData.mapNameI18nIds = config.mapNameI18nIds;
    console.log(`   ✓ Added map name i18n IDs (${Object.keys(config.mapNameI18nIds).length} entries)`);
  }

  // 13.5 Add TP Point i18n ID from config (for campfire/travel point names)
  if (config.tpPointI18nId) {
    optimizedData.tpPointI18nId = config.tpPointI18nId;
    console.log(`   ✓ Added TP Point i18n ID: ${config.tpPointI18nId}`);
  }

  // 13.55 Add Ether Shard i18n ID from config (for collection_coin entities)
  if (config.etherShardI18nId) {
    optimizedData.etherShardI18nId = config.etherShardI18nId;
    console.log(`   ✓ Added Ether Shard i18n ID: ${config.etherShardI18nId}`);
  }

  // 13.6 Add zone name i18n IDs from config (for zone labels on map)
  if (config.zoneNameI18nIds) {
    optimizedData.zoneNameI18nIds = config.zoneNameI18nIds;
    console.log(`   ✓ Added zone name i18n IDs (${Object.keys(config.zoneNameI18nIds).length} entries)`);
  }

  // 13.7 Add sub-zone location i18n IDs from config (for sub-zone labels on map)
  if (config.subZoneLocationI18nIds) {
    optimizedData.subZoneLocationI18nIds = config.subZoneLocationI18nIds;
    const totalSubZones = Object.values(config.subZoneLocationI18nIds).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`   ✓ Added sub-zone location i18n IDs (${totalSubZones} entries across ${Object.keys(config.subZoneLocationI18nIds).length} levels)`);
  }

  // 14. Add icon mapping from config
  if (config.iconMapping) {
    optimizedData.iconMapping = config.iconMapping;
    console.log(`   ✓ Added icon mapping (${Object.keys(config.iconMapping).length} entries)`);
  }

  // 15. Calculate POI layers based on tile data at each POI's position
  // This pre-calculates the correct layer so frontend doesn't need complex tile lookups
  console.log('\n⚙️  Calculating POI layers...');
  if (optimizedData.levelConfigs) {
    // First, dynamically calculate Y thresholds from POIs with explicit tierIndex
    // This analyzes underground POIs to determine the max Y coord per level
    const allPOIs = [
      ...(optimizedData.poiData || []),
      ...(optimizedData.levelMapMarks || []),
    ];
    LEVEL_Y_THRESHOLDS = analyzeUndergroundThresholds(allPOIs);

    // Apply manual threshold overrides from config
    // Set to null/0 to disable Y-threshold for a level, or a number to override
    if (config.levelYThresholds) {
      console.log('   Applying manual Y threshold overrides from config...');
      for (const [levelId, threshold] of Object.entries(config.levelYThresholds)) {
        if (threshold === null || threshold === 0) {
          // Disable Y-threshold for this level
          delete LEVEL_Y_THRESHOLDS[levelId];
          console.log(`      ${levelId}: DISABLED (was ${LEVEL_Y_THRESHOLDS[levelId] || 'not set'})`);
        } else {
          const oldThreshold = LEVEL_Y_THRESHOLDS[levelId];
          LEVEL_Y_THRESHOLDS[levelId] = threshold;
          console.log(`      ${levelId}: ${oldThreshold || 'none'} → ${threshold}`);
        }
      }
    }

    // Now calculate layers using the dynamic thresholds
    if (optimizedData.poiData) {
      console.log('   Processing extracted POI data...');
      calculatePOILayers(optimizedData.poiData, optimizedData.levelConfigs);
    }
    if (optimizedData.levelMapMarks) {
      console.log('   Processing level map marks...');
      calculatePOILayers(optimizedData.levelMapMarks, optimizedData.levelConfigs);
    }
  }

  // NOTE: i18n deduplication is DISABLED for map data
  // The map uses many unique i18n IDs and the runtime translate() function
  // doesn't support dedup lookups, so deduplication breaks the map.
  // Keep the original i18n IDs for proper translation at runtime.

  // Write combined optimized JSON file (for backwards compatibility)
  console.log('\n💾 Writing optimized files...');
  const optimizedJson = stringifyJSONWithBigInt(optimizedData);
  fs.writeFileSync(OUTPUT_FILE, optimizedJson, 'utf8');
  const optimizedSize = fs.statSync(OUTPUT_FILE).size;

  console.log(`   ✓ Created: ${OUTPUT_FILE}`);

  // 14. Generate per-map data files
  console.log('\n📦 Generating per-map data files...');
  generatePerMapFiles(optimizedData, config);

  // Print summary
  const originalMB = (totalOriginalSize / 1024 / 1024).toFixed(2);
  const optimizedKB = (optimizedSize / 1024).toFixed(2);
  const reduction = ((1 - optimizedSize / totalOriginalSize) * 100).toFixed(1);

  console.log('\n📊 Optimization Summary:');
  console.log(`   Original total size:  ${originalMB} MB`);
  console.log(`   Optimized size:       ${optimizedKB} KB`);
  console.log(`   Reduction:            ${reduction}%`);
  console.log('\n✨ Map data optimization complete!');
  console.log('\n💡 To customize exclusions, edit: scripts/data-optimization/map-config.json');
}

/**
 * Generate separate data files for each map
 * Each file contains only POIs and level configs for that specific map
 */
function generatePerMapFiles(optimizedData, config) {
  const mapIds = Object.keys(MAP_OUTPUT_FILES);

  mapIds.forEach(mapId => {
    // Filter zone name i18n IDs for this map
    const mapZoneNameI18nIds = {};
    if (config.zoneNameI18nIds) {
      Object.entries(config.zoneNameI18nIds).forEach(([levelId, i18nId]) => {
        if (levelId.startsWith(mapId + '_')) {
          mapZoneNameI18nIds[levelId] = i18nId;
        }
      });
    }

    // Filter sub-zone location i18n IDs for this map
    const mapSubZoneLocationI18nIds = {};
    if (config.subZoneLocationI18nIds) {
      Object.entries(config.subZoneLocationI18nIds).forEach(([levelId, i18nIds]) => {
        if (levelId.startsWith(mapId + '_')) {
          mapSubZoneLocationI18nIds[levelId] = i18nIds;
        }
      });
    }

    const mapData = {
      mapId: mapId,
      nameI18nId: config.mapNameI18nIds?.[mapId] || null,
      zoneNameI18nIds: mapZoneNameI18nIds,
      subZoneLocationI18nIds: mapSubZoneLocationI18nIds,
      poiData: [],
      levelMapMarks: [], // Dungeon entrances, travel points, etc. from LevelMapMark.json
      levelConfigs: {},
      // Shared data that's needed for all maps
      mapMarkIns: {},
      mapMarkType: optimizedData.mapMarkType || {},
      interactive: optimizedData.interactive || {},
      textTable: {},
      enemyTemplate: {},
      oreClusterI18nIds: optimizedData.oreClusterI18nIds || {},
      spcstoneI18nIds: optimizedData.spcstoneI18nIds || {},
      plantI18nIds: optimizedData.plantI18nIds || {},
      tpPointI18nId: optimizedData.tpPointI18nId || null,
      etherShardI18nId: optimizedData.etherShardI18nId || null,
      iconMapping: optimizedData.iconMapping || {},
    };

    // Filter POIs for this map
    if (optimizedData.poiData) {
      mapData.poiData = optimizedData.poiData.filter(poi => {
        // Match POIs where sceneId starts with this mapId (e.g., map01_lv001)
        return poi.sceneId && poi.sceneId.startsWith(mapId + '_');
      });
    }

    // Filter levelMapMarks for this map
    if (optimizedData.levelMapMarks && Array.isArray(optimizedData.levelMapMarks)) {
      const excludeMarkTypes = config.excludeMarkTypes || [];
      mapData.levelMapMarks = optimizedData.levelMapMarks.filter(mark => {
        // Match marks where mapId matches this map and entityType is not excluded
        return mark.mapId === mapId && !excludeMarkTypes.includes(mark.entityType);
      });
    }

    // Filter level configs for this map
    if (optimizedData.levelConfigs) {
      Object.entries(optimizedData.levelConfigs).forEach(([key, levelConfig]) => {
        if (levelConfig.mapIdStr === mapId || levelConfig.id?.startsWith(mapId + '_')) {
          mapData.levelConfigs[key] = levelConfig;
        }
      });
    }

    // Filter mapMarkIns for this map
    if (optimizedData.mapMarkIns) {
      Object.entries(optimizedData.mapMarkIns).forEach(([key, mark]) => {
        if (mark.levelId && mark.levelId.startsWith(mapId + '_')) {
          mapData.mapMarkIns[key] = mark;
        }
      });
    }

    // Extract only used i18n IDs from textTable for this map's POIs
    const usedI18nIds = new Set();
    mapData.poiData.forEach(poi => {
      if (poi.nameI18nId) usedI18nIds.add(poi.nameI18nId);
      if (poi.descI18nId) usedI18nIds.add(poi.descI18nId);
    });
    // Add i18n IDs from levelMapMarks (dungeon names, etc.)
    mapData.levelMapMarks.forEach(mark => {
      if (mark.nameI18nId) usedI18nIds.add(mark.nameI18nId);
    });
    // Add map name i18n ID
    if (mapData.nameI18nId) {
      usedI18nIds.add(mapData.nameI18nId);
    }
    // Add zone name i18n IDs
    Object.values(mapZoneNameI18nIds).forEach(i18nId => {
      usedI18nIds.add(i18nId);
    });
    // Add sub-zone location i18n IDs
    Object.values(mapSubZoneLocationI18nIds).forEach(i18nIdArray => {
      i18nIdArray.forEach(i18nId => usedI18nIds.add(i18nId));
    });

    if (optimizedData.textTable) {
      usedI18nIds.forEach(id => {
        if (optimizedData.textTable[id]) {
          mapData.textTable[id] = optimizedData.textTable[id];
        } else if (config.hardcodedI18n && config.hardcodedI18n[id]) {
          // Use hardcoded fallback for missing i18n IDs
          mapData.textTable[id] = config.hardcodedI18n[id];
        }
      });
    }

    // Extract only used enemy templates for this map's POIs
    const usedEnemyIds = new Set();
    mapData.poiData.forEach(poi => {
      if (poi.entityType && poi.entityType.startsWith('eny_')) {
        // Strip variant suffix to get base enemy ID
        const baseEnemyId = poi.entityType.replace(/_\d{3}$/, '');
        usedEnemyIds.add(baseEnemyId);
      }
    });

    if (optimizedData.enemyTemplate) {
      usedEnemyIds.forEach(id => {
        if (optimizedData.enemyTemplate[id]) {
          mapData.enemyTemplate[id] = optimizedData.enemyTemplate[id];
        }
      });
    }

    // Write per-map file
    const outputPath = MAP_OUTPUT_FILES[mapId];
    const mapJson = stringifyJSONWithBigInt(mapData);
    fs.writeFileSync(outputPath, mapJson, 'utf8');

    const fileSize = (fs.statSync(outputPath).size / 1024).toFixed(2);
    console.log(`   ✓ ${mapId}: ${mapData.poiData.length} POIs, ${mapData.levelMapMarks.length} map marks, ${Object.keys(mapData.levelConfigs).length} levels (${fileSize} KB)`);
  });
}

// Run optimization
try {
  optimizeMapData();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
