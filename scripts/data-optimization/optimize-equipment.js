#!/usr/bin/env node

/**
 * EQUIPMENT (GEAR) DATA OPTIMIZER
 * 
 * This script optimizes equipment data by splitting it into:
 * 1. equipment-list.json - Lightweight data for equipment grid/list view
 * 2. equipment-details.json - Full data for equipment detail pages
 * 
 * Source: extracted_data/TableCfg/EquipTable.json
 * Output: public/localdb/optimized/equipment/
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
      if (key.endsWith('I18nId') || key === 'nameI18nId' || key === 'descI18nId' || key === 'extraDescI18nId') {
        result[key] = getCanonicalId(value, dedupMap);
      }
      // Check for nested name/desc objects with id
      else if ((key === 'name' || key === 'desc' || key === 'equipDesc' || key === 'equipExtraDesc') &&
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
const EXTRACTED_DATA_PATH = path.join(__dirname, '../../extracted_data/TableCfg/EquipTable.json');
const ITEM_TABLE_PATH = path.join(__dirname, '../../extracted_data/TableCfg/ItemTable.json');
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/equipment');
const LIST_FILE = path.join(OUTPUT_DIR, 'equipment-list.json');
const DETAILS_FILE = path.join(OUTPUT_DIR, 'equipment-details.json');  // Combined details file
const DETAILS_DIR = path.join(OUTPUT_DIR, 'details');

// Fields for list view (minimal data for grid display)
const LIST_FIELDS = [
  'itemId',
  'nameI18nId',                  // Equipment name i18n ID (from ItemTable)
  'name',
  'desc',
  'rarity',
  'type',
  'minWearLv',
  'slot',
  'iconPath'
];

// Fields for detail view (complete data)
const DETAIL_FIELDS = [
  'itemId',
  'nameI18nId',                  // Equipment name i18n ID (from ItemTable)
  'attributeModifiers',
  'equipAttrModifiers',
  'displayBaseAttrModifier',    // Main stat for display
  'displayAttrModifiers',        // Sub stats for display
  'enhanceAttrType',
  'enhanceAttrValues',
  'suitId',
  'suitID',                      // Alternative key name used in some data
  'partType',                    // For filtering (0=Body, 1=Hand, 2=EDC)
  'minWearLv',                   // Level requirement
  'domainId',
  'unlockCharIds'
];

/**
 * Extract only specified fields from an object
 * Also extracts i18n IDs from nested name/desc objects
 */
function extractFields(obj, fields) {
  const result = {};
  fields.forEach(field => {
    if (obj[field] !== undefined) {
      result[field] = obj[field];
    }
  });
  
  // Special handling: Extract i18n IDs from equipDesc/equipExtraDesc objects
  if (obj.equipDesc && obj.equipDesc.id && !result.descI18nId) {
    result.descI18nId = String(obj.equipDesc.id);
  }
  if (obj.equipExtraDesc && obj.equipExtraDesc.id && !result.extraDescI18nId) {
    result.extraDescI18nId = String(obj.equipExtraDesc.id);
  }
  
  return result;
}

/**
 * Main optimization function
 */
function optimizeEquipment() {
  console.log('🔧 Starting equipment data optimization...\n');

  // Load deduplication map for i18n IDs
  console.log('📖 Loading i18n deduplication map...');
  dedupMap = loadDedupMap();
  if (dedupMap) {
    console.log('   ✓ Dedup map loaded - i18n IDs will be deduplicated\n');
  } else {
    console.log('   ⚠ No dedup map found - run i18n-dedup.js first for optimal results\n');
  }

  // Check if source files exist
  if (!fs.existsSync(EXTRACTED_DATA_PATH)) {
    console.error('❌ Error: Source file not found:', EXTRACTED_DATA_PATH);
    console.error('   Please ensure extracted_data/TableCfg/EquipTable.json exists.');
    process.exit(1);
  }
  if (!fs.existsSync(ITEM_TABLE_PATH)) {
    console.error('❌ Error: ItemTable not found:', ITEM_TABLE_PATH);
    console.error('   Please ensure extracted_data/TableCfg/ItemTable.json exists.');
    process.exit(1);
  }

  // Ensure output directories exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  if (!fs.existsSync(DETAILS_DIR)) {
    fs.mkdirSync(DETAILS_DIR, { recursive: true });
  }

  // Read and parse source data with BigInt support
  console.log('📖 Reading equipment data...');
  const sourceText = fs.readFileSync(EXTRACTED_DATA_PATH, 'utf8');
  const sourceData = parseJSONWithBigInt(sourceText);

  console.log('📖 Reading item names from ItemTable...');
  const itemTableText = fs.readFileSync(ITEM_TABLE_PATH, 'utf8');
  const itemTable = parseJSONWithBigInt(itemTableText);

  // Build a map of itemId -> nameI18nId from ItemTable
  const itemNamesMap = new Map();
  Object.entries(itemTable).forEach(([itemId, itemData]) => {
    if (itemId.startsWith('item_equip_') && itemData.name && itemData.name.id) {
      itemNamesMap.set(itemId, String(itemData.name.id));
    }
  });
  console.log(`   Found ${itemNamesMap.size} equipment item names`);

  const listData = {};
  const detailsData = {};  // Combined details
  let count = 0;
  let totalDetailSize = 0;

  // Process each equipment item
  console.log('⚙️  Processing equipment...');
  Object.entries(sourceData).forEach(([itemId, equipData]) => {
    // Extract list fields (for equipment grid)
    const listItem = extractFields(equipData, LIST_FIELDS);

    // Add nameI18nId from ItemTable
    const nameI18nId = itemNamesMap.get(itemId);
    if (nameI18nId) {
      listItem.nameI18nId = nameI18nId;
    }

    listData[itemId] = listItem;

    // Extract detail fields
    const detailData = extractFields(equipData, DETAIL_FIELDS);

    // Add nameI18nId to detail data as well
    if (nameI18nId) {
      detailData.nameI18nId = nameI18nId;
    }

    detailsData[itemId] = detailData;  // Add to combined file

    // Deduplicate i18n IDs in detail data for individual files
    const dedupedDetailData = deduplicateI18nIds(detailData);

    // Also write individual file for on-demand loading
    const detailJson = stringifyJSONWithBigInt(dedupedDetailData);
    const detailFilePath = path.join(DETAILS_DIR, `${itemId}.json`);
    fs.writeFileSync(detailFilePath, detailJson, 'utf8');
    totalDetailSize += fs.statSync(detailFilePath).size;

    count++;
  });

  console.log(`✅ Processed ${count} equipment items\n`);
  console.log('💾 Writing optimized files...');

  // Deduplicate i18n IDs
  const dedupedListData = deduplicateI18nIds(listData);
  const dedupedDetailsData = deduplicateI18nIds(detailsData);

  // Write list file
  const listJson = stringifyJSONWithBigInt(dedupedListData);
  fs.writeFileSync(LIST_FILE, listJson, 'utf8');
  const listSize = (fs.statSync(LIST_FILE).size / 1024).toFixed(2);
  console.log(`   ✓ List file: ${LIST_FILE} (${listSize} KB)${dedupMap ? ' [i18n IDs deduplicated]' : ''}`);

  // Write combined details file
  const combinedDetailsJson = stringifyJSONWithBigInt(dedupedDetailsData);
  fs.writeFileSync(DETAILS_FILE, combinedDetailsJson, 'utf8');
  const combinedSize = (fs.statSync(DETAILS_FILE).size / 1024).toFixed(2);
  console.log(`   ✓ Combined details: ${DETAILS_FILE} (${combinedSize} KB)`);
  console.log(`   ✓ Individual files: ${count} files in ${DETAILS_DIR}/ (${(totalDetailSize / 1024).toFixed(2)} KB total)`);

  // Calculate original size
  const originalSize = (fs.statSync(EXTRACTED_DATA_PATH).size / 1024).toFixed(2);
  const totalOptimized = parseFloat(listSize) + (totalDetailSize / 1024);
  const reduction = ((1 - totalOptimized / parseFloat(originalSize)) * 100).toFixed(1);

  console.log('\n📊 Optimization Summary:');
  console.log(`   Original size:  ${originalSize} KB`);
  console.log(`   List file:      ${listSize} KB`);
  console.log(`   Detail files:   ${(totalDetailSize / 1024).toFixed(2)} KB (${count} files)`);
  console.log(`   Total:          ${totalOptimized.toFixed(2)} KB`);
  console.log(`   Reduction:      ${reduction}%`);
  console.log('\n✨ Equipment data optimization complete!');
}

// Run optimization
try {
  optimizeEquipment();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
