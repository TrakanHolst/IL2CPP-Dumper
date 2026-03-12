#!/usr/bin/env node

/**
 * ACHIEVEMENT DATA OPTIMIZER
 *
 * This script optimizes achievement data by creating:
 * 1. achievements-list.json - All achievements with essential fields for grid/list view
 * 2. achievements-types.json - Categories and groups hierarchy
 *
 * Source: extracted_data/TableCfg/AchievementTable.json + AchievementTypeTable.json
 * Output: public/localdb/optimized/achievements/
 */

const fs = require('fs');
const path = require('path');
const JSONbigString = require('json-bigint')({ storeAsString: true });
const { loadDedupMap, getCanonicalId } = require('./i18n-dedup');

/**
 * JSON parser and stringifier that preserves large numbers as strings
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
 * Recursively deduplicate i18n IDs in an array (handles nested arrays)
 */
function deduplicateI18nArray(arr) {
  return arr.map(item => {
    if (Array.isArray(item)) {
      // Handle nested arrays (e.g., conditionDescI18nIds is string[][])
      return deduplicateI18nArray(item);
    }
    return getCanonicalId(item, dedupMap);
  });
}

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
      if (key.endsWith('I18nId') || key.endsWith('I18nIds')) {
        // Handle both single IDs and arrays of IDs (including nested arrays)
        if (Array.isArray(value)) {
          result[key] = deduplicateI18nArray(value);
        } else {
          result[key] = getCanonicalId(value, dedupMap);
        }
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
const ACHIEVEMENT_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'AchievementTable.json');
const ACHIEVEMENT_TYPE_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'AchievementTypeTable.json');
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/achievements');
const LIST_FILE = path.join(OUTPUT_DIR, 'achievements-list.json');
const TYPES_FILE = path.join(OUTPUT_DIR, 'achievements-types.json');

/**
 * Load and parse JSON file with BigInt support
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
 * Extract i18n ID from nested object, ensuring it's a string
 */
function extractI18nId(obj) {
  if (!obj || !obj.id) return null;
  // Convert to string to preserve BigInt precision
  return String(obj.id);
}

/**
 * Process achievement type table to extract categories and groups
 */
function processAchievementTypes(typeTable) {
  const categories = {};
  const groupToCategory = {};

  Object.entries(typeTable).forEach(([categoryId, categoryData]) => {
    // Extract category info
    categories[categoryId] = {
      categoryId: categoryData.categoryId,
      nameI18nId: extractI18nId(categoryData.categoryName),
      priority: categoryData.categoryPriority,
      noObtainCanView: categoryData.noObtainCanView,
      groups: []
    };

    // Process groups within this category
    if (categoryData.achievementGroupData && Array.isArray(categoryData.achievementGroupData)) {
      categoryData.achievementGroupData.forEach(group => {
        const groupInfo = {
          groupId: group.groupId,
          nameI18nId: extractI18nId(group.groupName)
        };
        categories[categoryId].groups.push(groupInfo);

        // Create reverse mapping from group to category
        groupToCategory[group.groupId] = categoryId;
      });
    }
  });

  return { categories, groupToCategory };
}

/**
 * Process single achievement to extract optimized data
 */
function processAchievement(achieveId, achieveData, groupToCategory) {
  // Extract level information
  const levelInfos = achieveData.levelInfos || {};
  const levels = Object.keys(levelInfos).map(Number).sort((a, b) => a - b);
  const maxLevel = levels.length > 0 ? Math.max(...levels) : achieveData.initLevel || 1;

  // Extract level targets (progressToCompare) and descriptions
  const levelTargets = [];
  const levelDescI18nIds = [];
  const conditionDescI18nIds = [];

  levels.forEach(level => {
    const levelInfo = levelInfos[String(level)];
    if (levelInfo) {
      // Get complete description i18n ID
      levelDescI18nIds.push(extractI18nId(levelInfo.completeDesc));

      // Get conditions (progress targets)
      if (levelInfo.conditions && Array.isArray(levelInfo.conditions)) {
        const levelConditions = [];
        levelInfo.conditions.forEach(condition => {
          levelTargets.push(condition.progressToCompare || 0);
          levelConditions.push(extractI18nId(condition.desc));
        });
        conditionDescI18nIds.push(levelConditions);
      }
    }
  });

  // Extract plate conditions if applicable
  const plateConditions = [];
  if (achieveData.canBePlated && achieveData.plateConditions && Array.isArray(achieveData.plateConditions)) {
    achieveData.plateConditions.forEach(condition => {
      plateConditions.push({
        conditionId: condition.conditionId,
        descI18nId: extractI18nId(condition.desc),
        target: condition.progressToCompare || 0
      });
    });
  }

  // Determine category from group
  const categoryId = groupToCategory[achieveData.groupId] || 'achv_type_hide';

  return {
    achieveId: achieveData.achieveId,
    nameI18nId: extractI18nId(achieveData.name),
    descI18nId: extractI18nId(achieveData.desc),
    groupId: achieveData.groupId,
    categoryId: categoryId,
    canBePlated: achieveData.canBePlated || false,
    canBeUpgraded: achieveData.canBeUpgraded || false,
    applyRareEffect: achieveData.applyRareEffect || false,
    initLevel: achieveData.initLevel || 1,
    maxLevel: maxLevel,
    order: achieveData.order || 0,
    levelTargets: levelTargets,
    levelDescI18nIds: levelDescI18nIds,
    conditionDescI18nIds: conditionDescI18nIds,
    ...(plateConditions.length > 0 && { plateConditions })
  };
}

/**
 * Main optimization function
 */
function optimizeAchievements() {
  console.log('🔧 Starting achievement data optimization...\n');

  // Load deduplication map for i18n IDs
  console.log('📖 Loading i18n deduplication map...');
  dedupMap = loadDedupMap();
  if (dedupMap) {
    console.log('   ✓ Dedup map loaded - i18n IDs will be deduplicated\n');
  } else {
    console.log('   ⚠ No dedup map found - run i18n-dedup.js first for optimal results\n');
  }

  // Check if source files exist
  if (!fs.existsSync(ACHIEVEMENT_TABLE_PATH)) {
    console.error('❌ Error: Source file not found:', ACHIEVEMENT_TABLE_PATH);
    console.error('   Please ensure extracted_data/TableCfg/AchievementTable.json exists.');
    process.exit(1);
  }

  if (!fs.existsSync(ACHIEVEMENT_TYPE_TABLE_PATH)) {
    console.error('❌ Error: Source file not found:', ACHIEVEMENT_TYPE_TABLE_PATH);
    console.error('   Please ensure extracted_data/TableCfg/AchievementTypeTable.json exists.');
    process.exit(1);
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Load all required data
  console.log('📖 Loading game data tables...');
  const achievementTable = loadJSON(ACHIEVEMENT_TABLE_PATH);
  const achievementTypeTable = loadJSON(ACHIEVEMENT_TYPE_TABLE_PATH);

  if (!achievementTable) {
    console.error('❌ Error: Failed to load AchievementTable.json');
    process.exit(1);
  }

  if (!achievementTypeTable) {
    console.error('❌ Error: Failed to load AchievementTypeTable.json');
    process.exit(1);
  }

  console.log(`   ✓ Achievements: ${Object.keys(achievementTable).length} entries`);
  console.log(`   ✓ Categories: ${Object.keys(achievementTypeTable).length} entries\n`);

  // Process categories and groups first
  console.log('⚙️  Processing categories and groups...');
  const { categories, groupToCategory } = processAchievementTypes(achievementTypeTable);

  // Count groups
  let totalGroups = 0;
  Object.values(categories).forEach(cat => {
    totalGroups += cat.groups.length;
  });
  console.log(`   ✓ ${Object.keys(categories).length} categories with ${totalGroups} groups\n`);

  // Process each achievement
  console.log('⚙️  Processing achievements...');
  const listData = {};
  let count = 0;
  let upgradableCount = 0;
  let platableCount = 0;
  const categoryStats = {};

  Object.entries(achievementTable).forEach(([achieveId, achieveData]) => {
    const processed = processAchievement(achieveId, achieveData, groupToCategory);
    listData[achieveId] = processed;

    // Track stats
    count++;
    if (processed.canBeUpgraded) upgradableCount++;
    if (processed.canBePlated) platableCount++;

    // Category stats
    if (!categoryStats[processed.categoryId]) {
      categoryStats[processed.categoryId] = 0;
    }
    categoryStats[processed.categoryId]++;
  });

  console.log(`✅ Processed ${count} achievements`);
  console.log(`   ✓ ${upgradableCount} upgradable (multi-level)`);
  console.log(`   ✓ ${platableCount} can be plated/showcased`);
  console.log('\n📊 Achievements by category:');
  Object.entries(categoryStats)
    .sort((a, b) => (categories[a[0]]?.priority || 99) - (categories[b[0]]?.priority || 99))
    .forEach(([catId, catCount]) => {
      const catName = catId.replace('achv_type_', '').toUpperCase();
      console.log(`   ${catName}: ${catCount}`);
    });

  // Deduplicate i18n IDs
  const dedupedCategories = deduplicateI18nIds(categories);
  const dedupedListData = deduplicateI18nIds(listData);

  // Write types file
  console.log('\n💾 Writing optimized files...');
  const typesJson = stringifyJSONWithBigInt({ categories: dedupedCategories, groupToCategory });
  fs.writeFileSync(TYPES_FILE, typesJson, 'utf8');
  const typesSize = (fs.statSync(TYPES_FILE).size / 1024).toFixed(2);
  console.log(`   ✓ Types file: ${TYPES_FILE} (${typesSize} KB)${dedupMap ? ' [i18n IDs deduplicated]' : ''}`);

  // Write list file
  const listJson = stringifyJSONWithBigInt(dedupedListData);
  fs.writeFileSync(LIST_FILE, listJson, 'utf8');
  const listSize = (fs.statSync(LIST_FILE).size / 1024).toFixed(2);
  console.log(`   ✓ List file: ${LIST_FILE} (${listSize} KB)`);

  // Calculate original sizes
  const originalAchievementSize = (fs.statSync(ACHIEVEMENT_TABLE_PATH).size / 1024).toFixed(2);
  const originalTypeSize = (fs.statSync(ACHIEVEMENT_TYPE_TABLE_PATH).size / 1024).toFixed(2);
  const totalOriginal = parseFloat(originalAchievementSize) + parseFloat(originalTypeSize);
  const totalOptimized = parseFloat(listSize) + parseFloat(typesSize);
  const reduction = ((1 - totalOptimized / totalOriginal) * 100).toFixed(1);

  console.log('\n📊 Optimization Summary:');
  console.log(`   Original AchievementTable:     ${originalAchievementSize} KB`);
  console.log(`   Original AchievementTypeTable: ${originalTypeSize} KB`);
  console.log(`   Original total:                ${totalOriginal.toFixed(2)} KB`);
  console.log(`   Optimized total:               ${totalOptimized.toFixed(2)} KB`);
  console.log(`   Reduction:                     ${reduction}%`);
  console.log('\n✨ Achievement data optimization complete!');
}

// Run optimization
try {
  optimizeAchievements();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
