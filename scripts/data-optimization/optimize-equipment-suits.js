#!/usr/bin/env node

/**
 * EQUIPMENT SUITS/SETS DATA OPTIMIZER
 *
 * This script optimizes equipment suit/set data by:
 * 1. Creating suits-list.json - Lightweight data for suit grid/list view
 * 2. Creating individual detail files with embedded SkillPatchTable data
 *
 * This eliminates the need to load SkillPatchTable.json separately for equipment sets.
 *
 * Source:
 *   - extracted_data/TableCfg/EquipSuitTable.json
 *   - extracted_data/TableCfg/SkillPatchTable.json
 * Output: public/localdb/optimized/equipment/suits/
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
      if (key.endsWith('I18nId') || key === 'descriptionI18nId') {
        result[key] = getCanonicalId(value, dedupMap);
      }
      else if ((key === 'name' || key === 'desc' || key === 'description' || key === 'skillName') &&
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
const SUIT_TABLE_PATH = path.join(__dirname, '../../extracted_data/TableCfg/EquipSuitTable.json');
const SKILL_PATCH_PATH = path.join(__dirname, '../../extracted_data/TableCfg/SkillPatchTable.json');
const I18N_EN_PATH = path.join(__dirname, '../../extracted_data/TableCfg/I18nTextTable_EN.json');
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/equipment/suits');
const LIST_FILE = path.join(OUTPUT_DIR, 'suits-list.json');
const DETAILS_DIR = path.join(OUTPUT_DIR, 'details');

/**
 * Extract tier from equipment list
 * Equipment IDs follow pattern: item_equip_t{tier}_...
 */
function extractHighestTier(equipList) {
  const tiers = equipList.map(id => {
    const match = id.match(/item_equip_t(\d+)_/);
    return match ? parseInt(match[1], 10) : 0;
  });
  return Math.max(...tiers, 0);
}

/**
 * Extract set effect piece counts from list
 */
function extractSetEffectCounts(setEffects) {
  return setEffects.map(effect => effect.equipCnt);
}

/**
 * Embed SkillPatchTable data into set effects
 */
function embedSkillPatchData(setEffects, skillPatchTable) {
  return setEffects.map(effect => {
    const embeddedEffect = { ...effect };

    // Get skill data from SkillPatchTable
    if (effect.skillID && skillPatchTable[effect.skillID]) {
      const skillData = skillPatchTable[effect.skillID];

      // Embed the skill patch data
      embeddedEffect.skillData = skillData;

      // Extract description i18n ID for convenience
      if (skillData.SkillPatchDataBundle &&
          skillData.SkillPatchDataBundle[0] &&
          skillData.SkillPatchDataBundle[0].description) {
        embeddedEffect.descriptionI18nId = String(skillData.SkillPatchDataBundle[0].description.id || '0');
      }
    }

    return embeddedEffect;
  });
}

/**
 * Extract minimal set effect data for list view
 * Includes description i18n ID and blackboard values for dynamic descriptions
 */
function extractMinimalSetEffect(effect, skillPatchTable) {
  const minimalEffect = {
    piecesRequired: effect.equipCnt,
    skillID: effect.skillID,
  };

  // Get skill data from SkillPatchTable for description and blackboard
  if (effect.skillID && skillPatchTable[effect.skillID]) {
    const skillData = skillPatchTable[effect.skillID];

    // Extract description i18n ID
    if (skillData.SkillPatchDataBundle &&
        skillData.SkillPatchDataBundle[0] &&
        skillData.SkillPatchDataBundle[0].description) {
      minimalEffect.descriptionI18nId = String(skillData.SkillPatchDataBundle[0].description.id || '0');
    }

    // Extract blackboard values for dynamic description rendering
    if (skillData.SkillPatchDataBundle &&
        skillData.SkillPatchDataBundle[0] &&
        skillData.SkillPatchDataBundle[0].blackboard) {
      const blackboardValues = {};
      skillData.SkillPatchDataBundle[0].blackboard.forEach((entry) => {
        blackboardValues[entry.key] = Number(entry.value) || 0;
      });
      minimalEffect.blackboardValues = blackboardValues;
    }
  }

  return minimalEffect;
}

/**
 * Generate SEO-friendly slug from suit name
 */
function generateSlug(name) {
  if (!name || typeof name !== 'string') {
    return null;
  }
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '');      // Remove leading/trailing hyphens
}

/**
 * Extract list data (minimal fields for grid display)
 * Now includes minimal set effect data with description i18n IDs and blackboard values
 * Also includes English name for SEO-friendly slug generation
 */
function extractListData(suitId, suitData, skillPatchTable, i18nTable) {
  const tier = extractHighestTier(suitData.equipList);
  const setEffectCounts = extractSetEffectCounts(suitData.list);

  // Extract suit name i18n ID
  const suitNameI18nId = suitData.list[0]?.suitName?.id
    ? String(suitData.list[0].suitName.id)
    : '0';

  // Get English name from i18n table for SEO-friendly slug generation
  const engName = i18nTable[suitNameI18nId] || '';

  // Generate pre-computed slug from English name
  const slug = generateSlug(engName);

  // Use first body piece for icon, fallback to first item
  const bodyPiece = suitData.equipList.find(item => item.includes('_body_'));
  const iconItemId = bodyPiece || suitData.equipList[0] || '';

  // Extract minimal set effects with description and blackboard values
  const setEffects = suitData.list.map(effect => extractMinimalSetEffect(effect, skillPatchTable));

  const result = {
    suitId,
    suitNameI18nId,
    engName, // English name for SEO-friendly slug generation
    suitLogoName: suitData.list[0]?.suitLogoName || '',
    iconItemId, // Equipment item ID for icon display
    equipList: suitData.equipList,
    tier,
    setEffectCounts, // e.g., [3] or [2, 4]
    totalPieces: suitData.equipList.length,
    setEffects, // Minimal set effects with description i18n IDs and blackboard values
  };

  // Add slug if generated successfully
  if (slug) {
    result.slug = slug;
  }

  return result;
}

/**
 * Extract detail data (full data with embedded SkillPatchTable)
 */
function extractDetailData(suitId, suitData, skillPatchTable, i18nTable) {
  const listData = extractListData(suitId, suitData, skillPatchTable, i18nTable);

  // Embed full SkillPatchTable data into set effects (more complete than list version)
  const setEffectsWithSkillData = embedSkillPatchData(suitData.list, skillPatchTable);

  return {
    ...listData,
    setEffects: setEffectsWithSkillData
  };
}

/**
 * Main optimization function
 */
function optimizeEquipmentSuits() {
  console.log('🔧 Starting equipment suits/sets data optimization...\n');

  // Load deduplication map for i18n IDs
  console.log('📖 Loading i18n deduplication map...');
  dedupMap = loadDedupMap();
  if (dedupMap) {
    console.log('   ✓ Dedup map loaded - i18n IDs will be deduplicated\n');
  } else {
    console.log('   ⚠ No dedup map found - run i18n-dedup.js first for optimal results\n');
  }

  // Check if source files exist
  if (!fs.existsSync(SUIT_TABLE_PATH)) {
    console.error('❌ Error: EquipSuitTable not found:', SUIT_TABLE_PATH);
    process.exit(1);
  }
  if (!fs.existsSync(SKILL_PATCH_PATH)) {
    console.error('❌ Error: SkillPatchTable not found:', SKILL_PATCH_PATH);
    process.exit(1);
  }
  if (!fs.existsSync(I18N_EN_PATH)) {
    console.error('❌ Error: I18nTextTable_EN not found:', I18N_EN_PATH);
    process.exit(1);
  }

  // Ensure output directories exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  if (!fs.existsSync(DETAILS_DIR)) {
    fs.mkdirSync(DETAILS_DIR, { recursive: true });
  }

  // Read and parse source data
  console.log('📖 Reading source data...');
  const suitTableText = fs.readFileSync(SUIT_TABLE_PATH, 'utf8');
  const suitTable = parseJSONWithBigInt(suitTableText);

  console.log('📖 Reading SkillPatchTable...');
  const skillPatchText = fs.readFileSync(SKILL_PATCH_PATH, 'utf8');
  const skillPatchTable = parseJSONWithBigInt(skillPatchText);

  console.log('📖 Reading I18nTextTable_EN for English names...');
  const i18nText = fs.readFileSync(I18N_EN_PATH, 'utf8');
  const i18nTable = parseJSONWithBigInt(i18nText);

  const skillPatchSize = (fs.statSync(SKILL_PATCH_PATH).size / 1024 / 1024).toFixed(2);
  console.log(`   SkillPatchTable size: ${skillPatchSize} MB\n`);

  const listData = {};
  let count = 0;
  let totalDetailSize = 0;
  let totalEmbeddedSkills = 0;

  // Process each equipment suit
  console.log('⚙️  Processing equipment suits...');
  Object.entries(suitTable).forEach(([suitId, suitData]) => {
    // Extract list data (minimal for grid display, includes set effect descriptions and blackboard)
    listData[suitId] = extractListData(suitId, suitData, skillPatchTable, i18nTable);

    // Extract detail data with embedded SkillPatchTable data
    const detailData = extractDetailData(suitId, suitData, skillPatchTable, i18nTable);

    // Count embedded skills
    totalEmbeddedSkills += detailData.setEffects.filter(e => e.skillData).length;

    // Deduplicate i18n IDs in detail data
    const dedupedDetailData = deduplicateI18nIds(detailData);

    // Write individual detail file
    const detailJson = stringifyJSONWithBigInt(dedupedDetailData);
    const detailFilePath = path.join(DETAILS_DIR, `${suitId}.json`);
    fs.writeFileSync(detailFilePath, detailJson, 'utf8');
    totalDetailSize += fs.statSync(detailFilePath).size;

    count++;
  });

  console.log(`✅ Processed ${count} equipment suits`);
  console.log(`✅ Embedded ${totalEmbeddedSkills} set effect skills\n`);
  console.log('💾 Writing optimized files...');

  // Deduplicate i18n IDs in list data
  const dedupedListData = deduplicateI18nIds(listData);

  // Write list file
  const listJson = stringifyJSONWithBigInt(dedupedListData);
  fs.writeFileSync(LIST_FILE, listJson, 'utf8');
  const listSize = (fs.statSync(LIST_FILE).size / 1024).toFixed(2);
  console.log(`   ✓ List file: ${LIST_FILE} (${listSize} KB)${dedupMap ? ' [i18n IDs deduplicated]' : ''}`);
  console.log(`   ✓ Detail files: ${count} individual files in ${DETAILS_DIR}/ (${(totalDetailSize / 1024).toFixed(2)} KB total)`);

  // Calculate optimization
  const originalSuitSize = (fs.statSync(SUIT_TABLE_PATH).size / 1024).toFixed(2);
  const totalOptimized = parseFloat(listSize) + (totalDetailSize / 1024);

  console.log('\n📊 Optimization Summary:');
  console.log(`   EquipSuitTable:    ${originalSuitSize} KB`);
  console.log(`   SkillPatchTable:   ${skillPatchSize} MB (now embedded in suits)`);
  console.log(`   Optimized list:    ${listSize} KB`);
  console.log(`   Optimized details: ${(totalDetailSize / 1024).toFixed(2)} KB (${count} files)`);
  console.log(`   Total optimized:   ${totalOptimized.toFixed(2)} KB`);
  console.log(`\n✨ Equipment suits optimization complete!`);
  console.log(`   SkillPatchTable data is now embedded - no need to load separately for equipment sets.`);
}

// Run optimization
try {
  optimizeEquipmentSuits();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
