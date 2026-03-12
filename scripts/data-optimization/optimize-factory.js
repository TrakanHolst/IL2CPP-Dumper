#!/usr/bin/env node

/**
 * FACTORY DATA OPTIMIZER
 *
 * This script combines ALL factory data into ONE file for preloading:
 * - Buildings (FactoryBuildingTable.json)
 * - Items (ItemTable.json + FactoryItemTable.json)
 * - Recipes (FactoryMachineCraftTable.json)
 * - Power Poles (FactoryPowerPoleTable.json)
 * - Power Stations (FactoryPowerStationTable.json)
 * - Fuel Items (FactoryFuelItemTable.json)
 * - Hubs (FactoryHubTable.json)
 *
 * Output: public/localdb/optimized/factory/factory-data.json
 */

const fs = require('fs');
const path = require('path');
const JSONbigString = require('json-bigint')({ storeAsString: true });
const { loadDedupMap, getCanonicalId } = require('./i18n-dedup');

/**
 * JSON parser and stringifier that preserves large numbers as strings
 * Uses json-bigint library to handle BigInt precision correctly
 */
function parseJSONWithBigInt(text) {
  return JSONbigString.parse(text);
}

function stringifyJSONWithBigInt(obj) {
  return JSONbigString.stringify(obj, null, 2);
}

// Global dedup map - loaded once at start
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
      // Check if this is an i18n ID field
      if (key.endsWith('I18nId') || key === 'nameI18nId' || key === 'descI18nId' ||
          key === 'formulaDescI18nId' || key === 'decoDescI18nId' || key === 'shortDescI18nId') {
        result[key] = getCanonicalId(value, dedupMap);
      }
      // Check for nested name/desc objects with id
      else if ((key === 'name' || key === 'desc' || key === 'description' || key === 'formulaDesc' || key === 'decoDesc' || key === 'shortDesc') &&
               typeof value === 'object' && value !== null && value.id !== undefined) {
        result[key] = {
          ...value,
          id: getCanonicalId(String(value.id), dedupMap)
        };
      }
      // Recursively process nested objects and arrays
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
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'factory-data.json');

// Source files
const BUILDINGS_PATH = path.join(EXTRACTED_DATA_DIR, 'FactoryBuildingTable.json');
const ITEMS_PATH = path.join(EXTRACTED_DATA_DIR, 'ItemTable.json');
const FACTORY_ITEMS_PATH = path.join(EXTRACTED_DATA_DIR, 'FactoryItemTable.json');
const RECIPES_PATH = path.join(EXTRACTED_DATA_DIR, 'FactoryMachineCraftTable.json');

// Power system files
const POWER_POLES_PATH = path.join(EXTRACTED_DATA_DIR, 'FactoryPowerPoleTable.json');
const POWER_STATIONS_PATH = path.join(EXTRACTED_DATA_DIR, 'FactoryPowerStationTable.json');
const FUEL_ITEMS_PATH = path.join(EXTRACTED_DATA_DIR, 'FactoryFuelItemTable.json');
const HUBS_PATH = path.join(EXTRACTED_DATA_DIR, 'FactoryHubTable.json');

/**
 * Load JSON file with BigInt support
 */
function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  File not found: ${filePath}`);
    return null;
  }
  const text = fs.readFileSync(filePath, 'utf8');
  return parseJSONWithBigInt(text);
}

/**
 * Main optimization function
 */
function optimizeFactory() {
  console.log('🔧 Starting factory data optimization...\n');

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

  // Load all factory data
  console.log('📖 Loading factory data files...');
  const buildings = loadJSON(BUILDINGS_PATH);
  const items = loadJSON(ITEMS_PATH);
  const factoryItems = loadJSON(FACTORY_ITEMS_PATH);
  const recipes = loadJSON(RECIPES_PATH);

  // Load power system data
  console.log('📖 Loading power system data files...');
  const powerPoles = loadJSON(POWER_POLES_PATH);
  const powerStations = loadJSON(POWER_STATIONS_PATH);
  const fuelItems = loadJSON(FUEL_ITEMS_PATH);
  const hubs = loadJSON(HUBS_PATH);

  // Filter out excluded buildings:
  // - Defense buildings (battle_machine quickBarType)
  // - Portable Originium Rigs (miner_1, miner_2, miner_3)
  // - Fluid Pump (pump_1)
  // - Zipline Pylons (travel_pole_1, travel_pole_2, travel_pole_nop_1)
  // - Fluid Supply Unit (dumper_1, dumper_nop_1)
  // - Protocol Stash / Easy Stash (storager_nop_1)
  // - Power Terminal (power_terminal_1)
  // - Fluid Tanks (liquid_storager_1, liquid_storager_nop_1)
  const EXCLUDED_BUILDING_IDS = [
    'miner_1', 'miner_2', 'miner_3',  // Portable Originium Rigs
    'pump_1',                          // Fluid Pump
    'travel_pole_1', 'travel_pole_2', 'travel_pole_nop_1',  // Zipline Pylons
    'dumper_1', 'dumper_nop_1',        // Fluid Supply Unit
    'storager_nop_1',                  // Protocol Stash (Easy Stash)
    'power_terminal_1',                // Power Terminal
    'liquid_storager_1', 'liquid_storager_nop_1'  // Fluid Tanks
  ];
  let filteredBuildings = {};
  let defenseCount = 0;
  let excludedByIdCount = 0;
  if (buildings) {
    Object.entries(buildings).forEach(([id, building]) => {
      if (building.quickBarType === 'battle_machine') {
        defenseCount++;
      } else if (EXCLUDED_BUILDING_IDS.includes(id)) {
        excludedByIdCount++;
      } else {
        filteredBuildings[id] = building;
      }
    });
  }

  // Combine all data into one object
  const factoryData = {
    buildings: filteredBuildings,
    items: items || {},
    factoryItems: factoryItems || {},
    recipes: recipes || {},
    // Power system data
    powerPoles: powerPoles || {},
    powerStations: powerStations || {},
    fuelItems: fuelItems || {},
    hubs: hubs || {}
  };

  console.log(`   ✓ Buildings: ${Object.keys(filteredBuildings).length} entries (excluded: ${defenseCount} defense, ${excludedByIdCount} other)`);
  console.log(`   ✓ Items: ${items ? Object.keys(items).length : 0} entries`);
  console.log(`   ✓ Factory Items: ${factoryItems ? Object.keys(factoryItems).length : 0} entries`);
  console.log(`   ✓ Recipes: ${recipes ? Object.keys(recipes).length : 0} entries`);
  console.log(`   ✓ Power Poles: ${powerPoles ? Object.keys(powerPoles).length : 0} entries`);
  console.log(`   ✓ Power Stations: ${powerStations ? Object.keys(powerStations).length : 0} entries`);
  console.log(`   ✓ Fuel Items: ${fuelItems ? Object.keys(fuelItems).length : 0} entries`);
  console.log(`   ✓ Hubs: ${hubs ? Object.keys(hubs).length : 0} entries`);

  // Deduplicate i18n IDs
  const dedupedFactoryData = deduplicateI18nIds(factoryData);

  // Write combined file
  console.log('\n💾 Writing combined factory data...');
  const factoryJson = stringifyJSONWithBigInt(dedupedFactoryData);
  fs.writeFileSync(OUTPUT_FILE, factoryJson, 'utf8');

  const outputSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2);
  console.log(`   ✓ Combined file: ${OUTPUT_FILE} (${outputSize} KB)`);

  // Calculate combined original size
  let totalOriginalSize = 0;
  if (fs.existsSync(BUILDINGS_PATH)) totalOriginalSize += fs.statSync(BUILDINGS_PATH).size;
  if (fs.existsSync(ITEMS_PATH)) totalOriginalSize += fs.statSync(ITEMS_PATH).size;
  if (fs.existsSync(FACTORY_ITEMS_PATH)) totalOriginalSize += fs.statSync(FACTORY_ITEMS_PATH).size;
  if (fs.existsSync(RECIPES_PATH)) totalOriginalSize += fs.statSync(RECIPES_PATH).size;
  // Power system files
  if (fs.existsSync(POWER_POLES_PATH)) totalOriginalSize += fs.statSync(POWER_POLES_PATH).size;
  if (fs.existsSync(POWER_STATIONS_PATH)) totalOriginalSize += fs.statSync(POWER_STATIONS_PATH).size;
  if (fs.existsSync(FUEL_ITEMS_PATH)) totalOriginalSize += fs.statSync(FUEL_ITEMS_PATH).size;
  if (fs.existsSync(HUBS_PATH)) totalOriginalSize += fs.statSync(HUBS_PATH).size;

  const originalSize = (totalOriginalSize / 1024).toFixed(2);
  const reduction = ((1 - parseFloat(outputSize) / parseFloat(originalSize)) * 100).toFixed(1);

  console.log('\n📊 Optimization Summary:');
  console.log(`   Combined original size: ${originalSize} KB`);
  console.log(`   Optimized size:         ${outputSize} KB`);
  console.log(`   Reduction:              ${reduction}%`);
  console.log('\n✨ Factory data optimization complete!');
  console.log('   All factory data combined into ONE file for preloading.');
}

// Run optimization
try {
  optimizeFactory();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
