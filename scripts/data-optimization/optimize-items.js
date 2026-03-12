#!/usr/bin/env node

/**
 * ITEMS DATA OPTIMIZER (ASCENSION PLANNER)
 *
 * This script extracts only items used in the Ascension Planner feature:
 * - Character breakthrough materials
 * - Weapon breakthrough materials
 * - Skill upgrade materials
 * - Plant materials
 * - Gold/currency
 * - Character EXP items
 * - Weapon EXP items
 *
 * Source: extracted_data/TableCfg/ItemTable.json
 * Output: public/localdb/optimized/items/items-list.json
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
const EXTRACTED_DATA_PATH = path.join(__dirname, '../../extracted_data/TableCfg/ItemTable.json');
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/items');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'items-list.json');

// Item patterns to extract (regex patterns for item IDs)
const ITEM_PATTERNS = [
  // Character EXP items
  /^item_expcard_/,
  // Weapon EXP items
  /^item_weapon_expcard_/,
  // Character breakthrough materials
  /^item_char_break_stage_/,
  // Weapon breakthrough materials
  /^item_weapon_break_/,
  // Skill level-up materials
  /^item_char_skill_level_/,
  // Skill specialization materials
  /^item_char_skill_specialize_/,
  // Skill crown
  /^item_char_skill_crown$/,
  // Plant materials (used in breakthroughs and skills)
  /^item_plant_/,
  // Gold/currency
  /^item_gold$/,
];

// Fields to extract for each item
const ITEM_FIELDS = [
  'id',
  'name',       // Contains i18n ID
  'iconId',
  'rarity',
  'type',
  'obtainWayIds'
];

/**
 * Determine the category of an item based on its ID
 */
function categorizeItem(itemId) {
  if (itemId.startsWith('item_expcard_')) return 'exp_char';
  if (itemId.startsWith('item_weapon_expcard_')) return 'exp_weapon';
  if (itemId.startsWith('item_char_break_stage_')) return 'breakthrough_char';
  if (itemId.startsWith('item_weapon_break_')) return 'breakthrough_weapon';
  if (itemId.startsWith('item_char_skill_level_')) return 'skill_level';
  if (itemId.startsWith('item_char_skill_specialize_')) return 'skill_specialize';
  if (itemId === 'item_char_skill_crown') return 'skill_crown';
  if (itemId.startsWith('item_plant_')) return 'plant';
  if (itemId === 'item_gold') return 'gold';
  return 'other';
}

/**
 * Check if an item ID matches any of our patterns
 */
function shouldIncludeItem(itemId) {
  return ITEM_PATTERNS.some(pattern => pattern.test(itemId));
}

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

  // Special handling: Extract i18n ID from name object
  if (obj.name && obj.name.id) {
    result.nameI18nId = String(obj.name.id);
  }

  // Special handling: Extract i18n ID from desc object
  if (obj.desc && obj.desc.id) {
    result.descI18nId = String(obj.desc.id);
  }

  // Add category
  result.category = categorizeItem(obj.id);

  return result;
}

/**
 * Main optimization function
 */
function optimizeItems() {
  console.log('🔧 Starting items data optimization (Ascension Planner)...\n');

  // Load deduplication map for i18n IDs
  console.log('📖 Loading i18n deduplication map...');
  dedupMap = loadDedupMap();
  if (dedupMap) {
    console.log('   ✓ Dedup map loaded - i18n IDs will be deduplicated\n');
  } else {
    console.log('   ⚠ No dedup map found - run i18n-dedup.js first for optimal results\n');
  }

  // Check if source file exists
  if (!fs.existsSync(EXTRACTED_DATA_PATH)) {
    console.error('❌ Error: Source file not found:', EXTRACTED_DATA_PATH);
    console.error('   Please ensure extracted_data/TableCfg/ItemTable.json exists.');
    process.exit(1);
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Read and parse source data with BigInt support
  console.log('📖 Reading source data...');
  const sourceText = fs.readFileSync(EXTRACTED_DATA_PATH, 'utf8');
  const sourceData = parseJSONWithBigInt(sourceText);

  const outputData = {};
  let totalCount = 0;
  let includedCount = 0;
  const categoryCounts = {};

  // Process each item
  console.log('⚙️  Filtering items for Ascension Planner...');
  Object.entries(sourceData).forEach(([itemId, itemData]) => {
    totalCount++;

    // Check if this item should be included
    if (shouldIncludeItem(itemId)) {
      outputData[itemId] = extractFields(itemData, ITEM_FIELDS);
      includedCount++;

      // Track category counts
      const category = categorizeItem(itemId);
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    }
  });

  console.log(`\n📊 Item Categories Extracted:`);
  Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).forEach(([category, count]) => {
    console.log(`   • ${category}: ${count} items`);
  });

  console.log(`\n✅ Filtered ${includedCount} items from ${totalCount} total items`);
  console.log('💾 Writing optimized file...');

  // Deduplicate i18n IDs
  const dedupedOutputData = deduplicateI18nIds(outputData);

  // Write optimized JSON file
  const outputJson = stringifyJSONWithBigInt(dedupedOutputData);
  fs.writeFileSync(OUTPUT_FILE, outputJson, 'utf8');
  const outputSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2);
  console.log(`   ✓ Output file: ${OUTPUT_FILE} (${outputSize} KB)${dedupMap ? ' [i18n IDs deduplicated]' : ''}`);

  // Calculate original size
  const originalSize = (fs.statSync(EXTRACTED_DATA_PATH).size / 1024).toFixed(2);
  const reduction = ((1 - parseFloat(outputSize) / parseFloat(originalSize)) * 100).toFixed(1);

  console.log('\n📊 Optimization Summary:');
  console.log(`   Original size:   ${originalSize} KB (${totalCount} items)`);
  console.log(`   Optimized size:  ${outputSize} KB (${includedCount} items)`);
  console.log(`   Reduction:       ${reduction}%`);
  console.log('\n✨ Items data optimization complete!');
}

// Run optimization
try {
  optimizeItems();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
