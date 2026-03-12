#!/usr/bin/env node

/**
 * I18N DEDUPLICATION UTILITY
 *
 * This script generates a deduplication map for i18n translations.
 * Many i18n IDs map to the exact same translation value (e.g., multiple skills
 * with the same name). This utility:
 *
 * 1. Groups all i18n IDs by their translation value
 * 2. Picks one canonical ID per unique value
 * 3. Outputs a mapping file used by all data optimizers
 *
 * Usage:
 *   node scripts/data-optimization/i18n-dedup.js
 *
 * Output:
 *   public/localdb/optimized/i18n/dedup-map.json
 */

const fs = require('fs');
const path = require('path');
const JSONbigString = require('json-bigint')({ storeAsString: true });

// Paths
const EXTRACTED_DATA_DIR = path.join(__dirname, '../../extracted_data/TableCfg');
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/i18n');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'dedup-map.json');

// Use English as the base for deduplication (most complete)
const SOURCE_FILE = path.join(EXTRACTED_DATA_DIR, 'I18nTextTable_EN.json');

/**
 * JSON parser that preserves large numbers as strings
 */
function parseJSONWithBigInt(text) {
  return JSONbigString.parse(text);
}

/**
 * Generate the deduplication map
 * Returns: { originalId: canonicalId, ... }
 * When originalId === canonicalId, that ID is the canonical one for its value
 */
function generateDedupMap() {
  console.log('🔧 Generating i18n deduplication map...\n');

  // Check if source file exists
  if (!fs.existsSync(SOURCE_FILE)) {
    console.error('❌ Error: English i18n file not found:', SOURCE_FILE);
    process.exit(1);
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Read source i18n data
  console.log('📖 Reading English i18n translations...');
  const sourceText = fs.readFileSync(SOURCE_FILE, 'utf8');
  const i18nData = parseJSONWithBigInt(sourceText);

  const totalIds = Object.keys(i18nData).length;
  console.log(`   Found ${totalIds} translation entries`);

  // Step 1: Group IDs by their translation value
  console.log('\n⚙️  Grouping IDs by translation value...');
  const valueToIds = new Map(); // Map<translationValue, Set<id>>

  Object.entries(i18nData).forEach(([id, value]) => {
    // Normalize the value for comparison (trim whitespace)
    const normalizedValue = typeof value === 'string' ? value.trim() : String(value);

    if (!valueToIds.has(normalizedValue)) {
      valueToIds.set(normalizedValue, new Set());
    }
    valueToIds.get(normalizedValue).add(id);
  });

  const uniqueValues = valueToIds.size;
  console.log(`   Found ${uniqueValues} unique translation values`);
  console.log(`   Potential deduplication: ${totalIds} → ${uniqueValues} IDs (${((1 - uniqueValues / totalIds) * 100).toFixed(1)}% reduction)`);

  // Step 2: Pick canonical ID for each unique value
  // Strategy: Pick the first ID alphabetically (consistent, deterministic)
  console.log('\n🔄 Generating canonical ID mapping...');
  const dedupMap = {}; // { originalId: canonicalId }
  let duplicateCount = 0;

  valueToIds.forEach((ids) => {
    // Sort IDs to pick a consistent canonical ID
    const sortedIds = Array.from(ids).sort();
    const canonicalId = sortedIds[0];

    // Map all IDs to the canonical one
    sortedIds.forEach(id => {
      dedupMap[id] = canonicalId;
      if (id !== canonicalId) {
        duplicateCount++;
      }
    });
  });

  console.log(`   Canonical IDs: ${uniqueValues}`);
  console.log(`   Duplicate IDs: ${duplicateCount}`);

  // Step 3: Write the dedup map
  console.log('\n💾 Writing deduplication map...');

  // Also output the canonical values (for the i18n optimizer)
  const output = {
    version: 1,
    generated: new Date().toISOString(),
    stats: {
      totalIds,
      uniqueValues,
      duplicateIds: duplicateCount,
      reductionPercent: ((1 - uniqueValues / totalIds) * 100).toFixed(1)
    },
    // Map of originalId -> canonicalId
    map: dedupMap
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  const outputSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2);
  console.log(`   ✓ Dedup map: ${OUTPUT_FILE} (${outputSize} KB)`);

  // Summary
  console.log('\n📊 Deduplication Summary:');
  console.log(`   Original IDs:     ${totalIds}`);
  console.log(`   Unique values:    ${uniqueValues}`);
  console.log(`   Duplicate IDs:    ${duplicateCount}`);
  console.log(`   ID reduction:     ${output.stats.reductionPercent}%`);
  console.log('\n✨ I18n deduplication map generated!');

  return dedupMap;
}

// Utility functions for use by other scripts
/**
 * Load the dedup map from file
 * @returns {Object} Map of originalId -> canonicalId
 */
function loadDedupMap() {
  if (!fs.existsSync(OUTPUT_FILE)) {
    console.warn('⚠️  Dedup map not found. Run i18n-dedup.js first.');
    return null;
  }

  const data = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  return data.map;
}

/**
 * Get the canonical ID for a given i18n ID
 * @param {string} id - The original i18n ID
 * @param {Object} dedupMap - The deduplication map
 * @returns {string} The canonical ID (or original if not in map)
 */
function getCanonicalId(id, dedupMap) {
  if (!dedupMap || !id) return id;
  return dedupMap[String(id)] || id;
}

// Export for use by other scripts
module.exports = {
  loadDedupMap,
  getCanonicalId,
  OUTPUT_FILE
};

// Run if called directly
if (require.main === module) {
  try {
    generateDedupMap();
  } catch (error) {
    console.error('\n❌ Error during deduplication:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
