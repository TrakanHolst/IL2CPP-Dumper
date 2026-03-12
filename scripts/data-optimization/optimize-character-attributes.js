#!/usr/bin/env node

/**
 * CHARACTER ATTRIBUTES OPTIMIZER
 *
 * Extracts ONLY character attributes (stats) from CharacterTable.json
 * This creates a lightweight file for character progression without loading the full 7MB table
 *
 * Source: extracted_data/TableCfg/CharacterTable.json
 * Output: public/localdb/optimized/characters/character-attributes.json
 */

const fs = require('fs');
const path = require('path');

/**
 * Custom JSON parser that preserves large numbers as strings
 */
function parseJSONWithBigInt(text) {
  const fixedText = text.replace(
    /"(id|nameI18nId|descI18nId|titleI18nId)"\s*:\s*(\d{15,})/g,
    (match, field, number) => `"${field}": "${number}"`
  );
  return JSON.parse(fixedText);
}

function stringifyJSONWithBigInt(obj) {
  return JSON.stringify(obj, null, 2);
}

// Paths
const EXTRACTED_DATA_DIR = path.join(__dirname, '../../extracted_data/TableCfg');
const CHARACTER_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'CharacterTable.json');
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/characters');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'character-attributes.json');

/**
 * Main optimization function
 */
function optimizeCharacterAttributes() {
  console.log('🔧 Starting character attributes optimization...\n');

  // Check if source file exists
  if (!fs.existsSync(CHARACTER_TABLE_PATH)) {
    console.error('❌ Error: Source file not found:', CHARACTER_TABLE_PATH);
    process.exit(1);
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Load CharacterTable
  console.log('📖 Loading CharacterTable.json...');
  const text = fs.readFileSync(CHARACTER_TABLE_PATH, 'utf8');
  const characterTable = parseJSONWithBigInt(text);
  console.log(`   ✓ Loaded ${Object.keys(characterTable).length} characters\n`);

  // Extract only charId and attributes
  const attributesData = {};
  Object.entries(characterTable).forEach(([charId, charData]) => {
    attributesData[charId] = {
      charId: charData.charId,
      attributes: charData.attributes || []
    };
  });

  // Write optimized file
  console.log('💾 Writing optimized attributes file...');
  const attributesJson = stringifyJSONWithBigInt(attributesData);
  fs.writeFileSync(OUTPUT_FILE, attributesJson, 'utf8');

  // Calculate sizes
  const originalSize = (fs.statSync(CHARACTER_TABLE_PATH).size / 1024).toFixed(2);
  const optimizedSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2);
  const reduction = ((1 - parseFloat(optimizedSize) / parseFloat(originalSize)) * 100).toFixed(1);

  console.log(`   ✓ Output: ${OUTPUT_FILE}`);
  console.log(`   ✓ Size: ${optimizedSize} KB\n`);

  console.log('📊 Optimization Summary:');
  console.log(`   Original CharacterTable:  ${originalSize} KB`);
  console.log(`   Attributes-only file:     ${optimizedSize} KB`);
  console.log(`   Reduction:                ${reduction}%`);
  console.log('\n✨ Character attributes optimization complete!');
}

// Run optimization
try {
  optimizeCharacterAttributes();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
