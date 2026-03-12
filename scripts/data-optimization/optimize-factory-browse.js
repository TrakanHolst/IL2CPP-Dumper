#!/usr/bin/env node

/**
 * FACTORY BROWSE DATA OPTIMIZER
 *
 * Creates a minimal data file for community factory browse pages.
 * Only includes what's needed to display factory cards:
 * - Item names and icons (ONLY craftable items that appear as recipe outputs)
 * - Building names and icons (ONLY producer buildings that appear in recipes)
 *
 * This is much smaller than the full factory-data.json used by the planner.
 * Unlike before, this now filters to ONLY recipe-related items and buildings,
 * not all items in the game.
 *
 * Output: public/localdb/optimized/factory/factory-browse-data.json
 */

const fs = require('fs');
const path = require('path');
const JSONbigString = require('json-bigint')({ storeAsString: true });
const { loadDedupMap, getCanonicalId } = require('./i18n-dedup');

/**
 * JSON parser that preserves large numbers as strings
 */
function parseJSONWithBigInt(text) {
  return JSONbigString.parse(text);
}

function stringifyJSONWithBigInt(obj) {
  return JSONbigString.stringify(obj, null, 2);
}

// Global dedup map
let dedupMap = null;

/**
 * Replace i18n IDs with their canonical equivalents throughout an object
 */
function deduplicateI18nIds(obj) {
  if (!dedupMap || !obj) return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => deduplicateI18nIds(item));
  }

  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key.endsWith('I18nId') || key === 'nameI18nId' || key === 'descI18nId') {
        result[key] = getCanonicalId(value, dedupMap);
      }
      else if ((key === 'name' || key === 'desc') &&
               typeof value === 'object' && value !== null && value.id !== undefined) {
        result[key] = { ...value, id: getCanonicalId(String(value.id), dedupMap) };
      }
      else if (typeof value === 'object' && value !== null) {
        result[key] = deduplicateI18nIds(value);
      }
      else {
        result[key] = value;
      }
    }
    return result;
  }

  return obj;
}

// Paths
const EXTRACTED_DATA_DIR = path.join(__dirname, '../../extracted_data/TableCfg');
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/factory');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'factory-browse-data.json');

// Source files
const BUILDINGS_PATH = path.join(EXTRACTED_DATA_DIR, 'FactoryBuildingTable.json');
const ITEMS_PATH = path.join(EXTRACTED_DATA_DIR, 'ItemTable.json');
const FACTORY_ITEMS_PATH = path.join(EXTRACTED_DATA_DIR, 'FactoryItemTable.json');
const RECIPES_PATH = path.join(EXTRACTED_DATA_DIR, 'FactoryMachineCraftTable.json');

/**
 * Load JSON file with BigInt support
 */
function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: File not found: ${filePath}`);
    return null;
  }
  const text = fs.readFileSync(filePath, 'utf8');
  return parseJSONWithBigInt(text);
}

/**
 * Extract only the fields needed for browse display from a building
 */
function extractBuildingBrowseFields(id, building) {
  return {
    id,
    nameI18nId: building.name?.id ? String(building.name.id) : null,
    // Buildings use iconOnPanel field for icon
    icon: building.iconOnPanel || null,
  };
}

/**
 * Extract only the fields needed for browse display from an item
 */
function extractItemBrowseFields(id, item) {
  return {
    id,
    nameI18nId: item.name?.id ? String(item.name.id) : null,
    // Items use iconId field for icon
    icon: item.iconId || null,
  };
}

/**
 * Extract craftable item IDs and producer building IDs from recipes
 * Returns: { craftableItemIds: Set, producerBuildingIds: Set }
 */
function extractRecipeData(recipes) {
  const craftableItemIds = new Set();
  const producerBuildingIds = new Set();

  if (!recipes) {
    return { craftableItemIds, producerBuildingIds };
  }

  Object.values(recipes).forEach((recipe) => {
    // Extract producer building (machineId)
    if (recipe.machineId) {
      producerBuildingIds.add(recipe.machineId);
    }

    // Extract output items (craftable items)
    if (recipe.outcomes && Array.isArray(recipe.outcomes)) {
      recipe.outcomes.forEach((outcome) => {
        if (outcome.group && Array.isArray(outcome.group)) {
          outcome.group.forEach((item) => {
            if (item.id) {
              craftableItemIds.add(item.id);
            }
          });
        }
      });
    }
  });

  return { craftableItemIds, producerBuildingIds };
}

/**
 * Main optimization function
 */
function optimizeFactoryBrowse() {
  console.log('Starting factory browse data optimization...\n');

  // Load deduplication map for i18n IDs
  console.log('📖 Loading i18n deduplication map...');
  dedupMap = loadDedupMap();
  if (dedupMap) {
    console.log('   ✓ Dedup map loaded - i18n IDs will be deduplicated\n');
  } else {
    console.log('   ⚠ No dedup map found - run i18n-dedup.js first for optimal results\n');
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Load source data
  console.log('Loading source data files...');
  const buildings = loadJSON(BUILDINGS_PATH);
  const items = loadJSON(ITEMS_PATH);
  const factoryItems = loadJSON(FACTORY_ITEMS_PATH);
  const recipes = loadJSON(RECIPES_PATH);

  // Extract craftable items and producer buildings from recipes
  console.log('Extracting craftable items and producer buildings from recipes...');
  const { craftableItemIds, producerBuildingIds } = extractRecipeData(recipes);
  console.log(`  Found ${craftableItemIds.size} craftable items in recipes`);
  console.log(`  Found ${producerBuildingIds.size} producer buildings in recipes`);

  // Process buildings - ONLY include producer buildings from recipes
  const browseBuildings = {};
  if (buildings) {
    Object.entries(buildings).forEach(([id, building]) => {
      // Skip defense buildings
      if (building.quickBarType === 'battle_machine') return;
      // Only include buildings that are producers in recipes
      if (!producerBuildingIds.has(id)) return;
      browseBuildings[id] = extractBuildingBrowseFields(id, building);
    });
  }

  // Process items - ONLY include craftable items from recipes
  const browseItems = {};

  // Check both ItemTable and FactoryItemTable for the craftable items
  craftableItemIds.forEach((itemId) => {
    // First check ItemTable
    if (items && items[itemId]) {
      browseItems[itemId] = extractItemBrowseFields(itemId, items[itemId]);
    }
    // Then check FactoryItemTable if not found
    else if (factoryItems && factoryItems[itemId]) {
      browseItems[itemId] = extractItemBrowseFields(itemId, factoryItems[itemId]);
    }
    // Item not found in either table - add placeholder
    else {
      console.warn(`  Warning: Item ${itemId} not found in ItemTable or FactoryItemTable`);
      browseItems[itemId] = {
        id: itemId,
        nameI18nId: null,
        icon: null,
      };
    }
  });

  // Create the optimized browse data
  const browseData = {
    buildings: browseBuildings,
    items: browseItems,
  };

  console.log(`\nOptimized data:`);
  console.log(`  Buildings: ${Object.keys(browseBuildings).length} entries (producers only)`);
  console.log(`  Items: ${Object.keys(browseItems).length} entries (craftable only)`);

  // Deduplicate i18n IDs
  const dedupedBrowseData = deduplicateI18nIds(browseData);

  // Write optimized file
  console.log('\nWriting optimized browse data...');
  const browseJson = stringifyJSONWithBigInt(dedupedBrowseData);
  fs.writeFileSync(OUTPUT_FILE, browseJson, 'utf8');

  const outputSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2);
  console.log(`  Output: ${OUTPUT_FILE} (${outputSize} KB)`);

  // Compare with full factory data if it exists
  const fullDataPath = path.join(OUTPUT_DIR, 'factory-data.json');
  if (fs.existsSync(fullDataPath)) {
    const fullSize = (fs.statSync(fullDataPath).size / 1024).toFixed(2);
    const reduction = ((1 - parseFloat(outputSize) / parseFloat(fullSize)) * 100).toFixed(1);
    console.log(`\nComparison with full factory-data.json:`);
    console.log(`  Full data size:   ${fullSize} KB`);
    console.log(`  Browse data size: ${outputSize} KB`);
    console.log(`  Reduction:        ${reduction}%`);
  }

  console.log('\nFactory browse data optimization complete!');
}

// Run optimization
try {
  optimizeFactoryBrowse();
} catch (error) {
  console.error('\nError during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
