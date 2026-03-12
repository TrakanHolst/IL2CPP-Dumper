#!/usr/bin/env node

/**
 * WEAPONS DATA OPTIMIZER
 *
 * This script optimizes weapon data by splitting it into:
 * 1. weapons-list.json - Bare minimum for weapon grid/list view
 * 2. details/[weaponId].json - Individual files for weapon detail pages
 *
 * Source: extracted_data/TableCfg/WeaponBasicTable.json
 * Output: public/localdb/optimized/weapons/
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
 * This is done recursively to handle nested structures
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
          key === 'skillNameId' || key === 'descriptionId') {
        result[key] = getCanonicalId(value, dedupMap);
      }
      // Check for nested name/desc objects with id
      else if ((key === 'name' || key === 'desc' || key === 'description' || key === 'skillName' || key === 'engName' || key === 'weaponDesc') &&
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
const EXTRACTED_DATA_PATH = path.join(__dirname, '../../extracted_data/TableCfg/WeaponBasicTable.json');
const ITEM_TABLE_PATH = path.join(__dirname, '../../extracted_data/TableCfg/ItemTable.json');
const SKILL_TABLE_PATH = path.join(__dirname, '../../extracted_data/TableCfg/SkillPatchTable.json');
const BREAKTHROUGH_TABLE_PATH = path.join(__dirname, '../../extracted_data/TableCfg/WeaponBreakThroughTemplateTable.json');
const UPGRADE_TABLE_PATH = path.join(__dirname, '../../extracted_data/TableCfg/WeaponUpgradeTemplateTable.json');
const TALENT_TABLE_PATH = path.join(__dirname, '../../extracted_data/TableCfg/WeaponTalentTemplateTable.json');
const I18N_PATH = path.join(__dirname, '../../public/localdb/optimized/i18n/I18nTextTable_EN.json');
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/weapons');
const LIST_FILE = path.join(OUTPUT_DIR, 'weapons-list.json');
const DETAILS_DIR = path.join(OUTPUT_DIR, 'details');

// Global i18n cache for slug generation
let i18nData = {};

// Global ItemTable cache for correct translation IDs
// ItemTable has the properly translated name.id, while WeaponBasicTable's engName.id is often untranslated
let itemTable = {};

/**
 * Load English i18n translations for slug generation
 */
function loadI18nData() {
  if (!fs.existsSync(I18N_PATH)) {
    console.warn('   ⚠ I18n file not found, slugs will use weaponId as fallback');
    return {};
  }

  const i18nText = fs.readFileSync(I18N_PATH, 'utf8');
  return parseJSONWithBigInt(i18nText);
}

/**
 * Generate SEO-friendly slug from weapon name
 */
function generateSlug(nameI18nId) {
  if (!nameI18nId || !i18nData[nameI18nId]) {
    return null;
  }

  const name = i18nData[nameI18nId];
  if (!name || typeof name !== 'string') {
    return null;
  }

  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '');      // Remove leading/trailing hyphens
}

// Fields for list view (minimal data for grid display)
// NOTE: baseStats and passiveSkills are added programmatically for tooltip support
const LIST_FIELDS = [
  'weaponId',
  'engName',        // Contains {id, text}
  'weaponType',
  'rarity',
  'maxLv'
];

// Flag to include skill data in list for tooltips
const INCLUDE_SKILLS_IN_LIST = true;

// Fields for detail view (complete data)
// Detail view includes ALL list fields plus additional detail-specific fields
const DETAIL_FIELDS = [
  // All list fields
  'weaponId',
  'engName',
  'weaponType',
  'rarity',
  'maxLv',
  // Additional detail-only fields
  'weaponDesc',    // Contains {id, text}
  'weaponSkillList',
  'weaponSkillTags', // NEW: Array of tagIds extracted from skill data
  'breakthroughTemplateId',
  'levelTemplateId',
  'talentTemplateId'
];

/**
 * Extract only specified fields from an object
 * Also extracts i18n IDs from nested name/desc objects
 *
 * IMPORTANT: For weapon names, we use ItemTable's name.id for translations
 * because WeaponBasicTable's engName.id often points to untranslated entries.
 * However, we still use engName.id for slug generation since it has valid English names.
 */
function extractFields(obj, fields) {
  const result = {};
  fields.forEach(field => {
    if (obj[field] !== undefined) {
      result[field] = obj[field];
    }
  });

  const weaponId = obj.weaponId;

  // Special handling: Extract i18n IDs for translations
  // Priority: Use ItemTable's name.id (has proper translations) over WeaponBasicTable's engName.id
  if (weaponId && itemTable[weaponId] && itemTable[weaponId].name && itemTable[weaponId].name.id) {
    // Use ItemTable's name.id - this has proper translations in all languages
    result.nameI18nId = String(itemTable[weaponId].name.id);
  } else if (obj.engName && obj.engName.id) {
    // Fallback to WeaponBasicTable's engName.id if ItemTable entry not found
    result.nameI18nId = String(obj.engName.id);
  }

  // For description, use ItemTable's desc.id if available
  if (weaponId && itemTable[weaponId] && itemTable[weaponId].desc && itemTable[weaponId].desc.id) {
    result.descI18nId = String(itemTable[weaponId].desc.id);
  } else if (obj.weaponDesc && obj.weaponDesc.id) {
    result.descI18nId = String(obj.weaponDesc.id);
  }

  // Generate and add slug from English name (for SEO-friendly URLs)
  // Also populate engName.text with the actual English name for page titles
  // Try ItemTable's name.id first, but fall back to engName.id if translation not found
  // NOTE: Use getCanonicalId() to convert to deduplicated ID before i18n lookup
  let englishName = null;
  let nameI18nIdForSlug = null;

  // Helper function to lookup i18n with dedup support
  const lookupI18n = (id) => {
    if (!id) return null;
    const strId = String(id);
    // First try the original ID
    if (i18nData[strId]) return { name: i18nData[strId], id: strId };
    // Then try the canonical (deduplicated) ID
    if (dedupMap) {
      const canonicalId = getCanonicalId(strId, dedupMap);
      if (canonicalId !== strId && i18nData[canonicalId]) {
        return { name: i18nData[canonicalId], id: canonicalId };
      }
    }
    return null;
  };

  // Try ItemTable first
  if (weaponId && itemTable[weaponId] && itemTable[weaponId].name && itemTable[weaponId].name.id) {
    const result = lookupI18n(itemTable[weaponId].name.id);
    if (result) {
      englishName = result.name;
      nameI18nIdForSlug = result.id;
    }
  }

  // Fall back to engName.id if ItemTable translation not found
  if (!englishName && obj.engName && obj.engName.id) {
    const result = lookupI18n(obj.engName.id);
    if (result) {
      englishName = result.name;
      nameI18nIdForSlug = result.id;
    }
  }

  // Generate slug and populate engName.text
  if (nameI18nIdForSlug) {
    const slug = generateSlug(nameI18nIdForSlug);
    if (slug) {
      result.slug = slug;
    }
  }

  if (englishName) {
    if (result.engName) {
      result.engName = { ...result.engName, text: englishName };
    } else {
      result.engName = { id: nameI18nIdForSlug, text: englishName };
    }
  }

  // Extract iconId from modelPath (for weapons that use a different model's icon)
  // e.g., "Gameplay/Prefabs/Weapons/wpn_funnel_0010.prefab" -> "wpn_funnel_0010"
  if (obj.modelPath) {
    const match = obj.modelPath.match(/([^/]+)\.prefab$/);
    if (match && match[1] !== obj.weaponId) {
      // Only add iconId if it differs from weaponId
      result.iconId = match[1];
    }
  }

  return result;
}

/**
 * Extract weapon skills from SkillPatchTable
 */
function extractWeaponSkills(weaponSkillList, skillTable) {
  if (!weaponSkillList || !Array.isArray(weaponSkillList)) {
    return null;
  }

  const skills = {};
  weaponSkillList.forEach(skillId => {
    if (skillTable[skillId]) {
      skills[skillId] = skillTable[skillId];
    }
  });

  return Object.keys(skills).length > 0 ? skills : null;
}

/**
 * Stat key mapping from blackboard keys to attrType
 */
const STAT_KEY_TO_ATTR_TYPE = {
  'str': 39,      // Strength
  'agi': 40,      // Agility
  'wisd': 41,     // Intellect (wisdom)
  'will': 42,     // Will
  'hp': 1,        // HP
  'atk': 2,       // ATK
  'def': 3,       // DEF
  'crit': 9,      // Crit Rate
  'critdmg': 10,  // Crit DMG
};

/**
 * Check if a skill ID is a basic stat skill (flat values like Strength, Agility)
 */
function isBasicStatSkill(skillId) {
  return skillId.startsWith('wpn_attr_');
}

/**
 * Check if a skill ID is a secondary stat skill (percentage bonuses like ATK%)
 */
function isSecondaryStatSkill(skillId) {
  return skillId.startsWith('wpn_sp_attr_');
}

/**
 * Extract resolved base stats from weapon skills at max level
 * Returns array of { attrType, value, isPercentage, skillNameId, descriptionId } for display
 */
function extractWeaponBaseStats(weaponSkillList, skillTable) {
  if (!weaponSkillList || !Array.isArray(weaponSkillList)) {
    return [];
  }

  const baseStats = [];

  weaponSkillList.forEach(skillId => {
    // Only process basic stat skills (wpn_attr_*) and secondary stat skills (wpn_sp_attr_*)
    if (!isBasicStatSkill(skillId) && !isSecondaryStatSkill(skillId)) {
      return;
    }

    const skillData = skillTable[skillId];
    if (!skillData || !skillData.SkillPatchDataBundle) {
      return;
    }

    // Get the max level entry (last in array)
    const levels = skillData.SkillPatchDataBundle;
    const maxLevelData = levels[levels.length - 1];

    if (!maxLevelData || !maxLevelData.blackboard) {
      return;
    }

    // Extract skill name and description i18n IDs
    const skillNameId = maxLevelData.skillName?.id ? String(maxLevelData.skillName.id) : null;
    const descriptionId = maxLevelData.description?.id ? String(maxLevelData.description.id) : null;

    // Extract stat values from blackboard
    maxLevelData.blackboard.forEach(entry => {
      const key = entry.key?.toLowerCase();
      const value = entry.value;

      if (key && value !== undefined && value !== 0) {
        const attrType = STAT_KEY_TO_ATTR_TYPE[key];

        // Determine if this is a percentage (secondary stat skills use percentages)
        const isPercentage = isSecondaryStatSkill(skillId);

        baseStats.push({
          skillId,
          attrType: attrType || key,  // Use attrType if known, otherwise raw key
          attrKey: key,
          value,
          isPercentage,
          level: maxLevelData.level,
          skillNameId,      // Include i18n ID for skill name
          descriptionId,    // Include i18n ID for description
          tagId: maxLevelData.tagId || null,  // Essence matching tagId (e.g., "attr_str", "attr_crirate")
        });
      }
    });
  });

  return baseStats;
}

/**
 * Extract passive skill info (non-stat skills like sk_wpn_*)
 * Returns array of { skillId, skillName (i18n ID), description (i18n ID) }
 */
function extractWeaponPassives(weaponSkillList, skillTable) {
  if (!weaponSkillList || !Array.isArray(weaponSkillList)) {
    return [];
  }

  const passives = [];

  weaponSkillList.forEach(skillId => {
    // Skip stat skills - only get passive/active skills
    if (isBasicStatSkill(skillId) || isSecondaryStatSkill(skillId)) {
      return;
    }

    const skillData = skillTable[skillId];
    if (!skillData || !skillData.SkillPatchDataBundle) {
      return;
    }

    // Get the max level entry (last in array)
    const levels = skillData.SkillPatchDataBundle;
    const maxLevelData = levels[levels.length - 1];

    if (!maxLevelData) {
      return;
    }

    passives.push({
      skillId,
      skillNameId: maxLevelData.skillName?.id ? String(maxLevelData.skillName.id) : null,
      descriptionId: maxLevelData.description?.id ? String(maxLevelData.description.id) : null,
      level: maxLevelData.level,
      blackboard: maxLevelData.blackboard || [],
      tagId: maxLevelData.tagId || null,  // Essence matching tagId
    });
  });

  return passives;
}

/**
 * Extract skill tagIds from weapon skills (NEW for Essence Solver)
 * Returns array of tagIds [slot0Tag, slot1Tag, slot2Tag]
 */
function extractWeaponSkillTags(weaponSkillList, skillTable) {
  if (!weaponSkillList || !Array.isArray(weaponSkillList)) {
    return [];
  }

  const tags = [];

  weaponSkillList.forEach(skillId => {
    const skillData = skillTable[skillId];
    if (!skillData || !skillData.SkillPatchDataBundle) {
      tags.push(null);
      return;
    }

    // Get the first level entry (all levels should have same tagId)
    const levels = skillData.SkillPatchDataBundle;
    if (levels && levels.length > 0 && levels[0].tagId) {
      tags.push(levels[0].tagId);
    } else {
      tags.push(null);
    }
  });

  return tags;
}

/**
 * Extract progression data (breakthrough + upgrade templates)
 */
function extractProgressionData(weapon, breakthroughTable, upgradeTable) {
  const progression = {};

  // Extract breakthrough template
  if (weapon.breakthroughTemplateId && breakthroughTable[weapon.breakthroughTemplateId]) {
    progression.breakthrough = breakthroughTable[weapon.breakthroughTemplateId];
  }

  // Extract upgrade template
  if (weapon.levelTemplateId && upgradeTable[weapon.levelTemplateId]) {
    progression.upgrade = upgradeTable[weapon.levelTemplateId];
  }

  return Object.keys(progression).length > 0 ? progression : null;
}

/**
 * Extract talent template data
 */
function extractTalentData(weapon, talentTable) {
  if (!weapon.talentTemplateId || !talentTable[weapon.talentTemplateId]) {
    return null;
  }

  return talentTable[weapon.talentTemplateId];
}

/**
 * Clean embedded data - remove empty fields, preserve BigInt as strings
 */
function cleanEmbeddedData(data) {
  if (!data) return null;

  // Remove null/undefined fields
  const cleaned = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      cleaned[key] = value;
    }
  });

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

/**
 * Main optimization function
 */
function optimizeWeapons() {
  console.log('🔧 Starting weapon data optimization...\n');

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
    console.error('   Please ensure extracted_data/TableCfg/WeaponBasicTable.json exists.');
    process.exit(1);
  }

  // Ensure output directories exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  if (!fs.existsSync(DETAILS_DIR)) {
    fs.mkdirSync(DETAILS_DIR, { recursive: true });
  }

  // Read and parse all data tables with BigInt support
  console.log('📖 Reading source data and related tables...');
  const sourceText = fs.readFileSync(EXTRACTED_DATA_PATH, 'utf8');
  const sourceData = parseJSONWithBigInt(sourceText);

  // Load English i18n for slug generation
  i18nData = loadI18nData();
  if (Object.keys(i18nData).length > 0) {
    console.log('   ✓ Loaded English i18n for slug generation');
  }

  // Load ItemTable for correct translation IDs
  // ItemTable has properly translated name.id while WeaponBasicTable's engName.id is often not translated
  if (fs.existsSync(ITEM_TABLE_PATH)) {
    const itemTableText = fs.readFileSync(ITEM_TABLE_PATH, 'utf8');
    itemTable = parseJSONWithBigInt(itemTableText);
    console.log('   ✓ Loaded ItemTable for correct translation IDs');
  } else {
    console.warn('   ⚠ ItemTable not found, translations may use WeaponBasicTable IDs (may be untranslated)');
  }

  // Load related tables (with existence checks)
  let skillTable = {};
  let breakthroughTable = {};
  let upgradeTable = {};
  let talentTable = {};

  if (fs.existsSync(SKILL_TABLE_PATH)) {
    const skillText = fs.readFileSync(SKILL_TABLE_PATH, 'utf8');
    skillTable = parseJSONWithBigInt(skillText);
    console.log('   ✓ Loaded SkillPatchTable');
  } else {
    console.warn('   ⚠ SkillPatchTable not found, skills will not be embedded');
  }

  if (fs.existsSync(BREAKTHROUGH_TABLE_PATH)) {
    const breakthroughText = fs.readFileSync(BREAKTHROUGH_TABLE_PATH, 'utf8');
    breakthroughTable = parseJSONWithBigInt(breakthroughText);
    console.log('   ✓ Loaded WeaponBreakThroughTemplateTable');
  } else {
    console.warn('   ⚠ WeaponBreakThroughTemplateTable not found, breakthrough data will not be embedded');
  }

  if (fs.existsSync(UPGRADE_TABLE_PATH)) {
    const upgradeText = fs.readFileSync(UPGRADE_TABLE_PATH, 'utf8');
    upgradeTable = parseJSONWithBigInt(upgradeText);
    console.log('   ✓ Loaded WeaponUpgradeTemplateTable');
  } else {
    console.warn('   ⚠ WeaponUpgradeTemplateTable not found, upgrade data will not be embedded');
  }

  if (fs.existsSync(TALENT_TABLE_PATH)) {
    const talentText = fs.readFileSync(TALENT_TABLE_PATH, 'utf8');
    talentTable = parseJSONWithBigInt(talentText);
    console.log('   ✓ Loaded WeaponTalentTemplateTable');
  } else {
    console.warn('   ⚠ WeaponTalentTemplateTable not found, talent data will not be embedded');
  }

  const listData = {};
  let count = 0;
  let totalDetailSize = 0;

  // Process each weapon
  console.log('⚙️  Processing weapons...');
  let weaponsWithStats = 0;
  let weaponsWithPassives = 0;

  Object.entries(sourceData).forEach(([weaponId, weaponData]) => {
    // Extract list fields (for weapon grid)
    listData[weaponId] = extractFields(weaponData, LIST_FIELDS);

    // Extract detail fields
    const detailData = extractFields(weaponData, DETAIL_FIELDS);

    // Pre-compute skill data for both list and detail
    const skillListToUse = weaponData.weaponSkillList || [];

    // Extract base stats for tooltip display
    const baseStats = extractWeaponBaseStats(skillListToUse, skillTable);

    // Extract passive skills for tooltip display
    const passives = extractWeaponPassives(skillListToUse, skillTable);

    // Add skill data to LIST for tooltip support (avoids loading detail file on hover)
    if (INCLUDE_SKILLS_IN_LIST) {
      if (baseStats.length > 0) {
        listData[weaponId].baseStats = baseStats;
      }
      if (passives.length > 0) {
        listData[weaponId].passiveSkills = passives;
      }
    }

    // Extract full skills for detail file
    const skills = extractWeaponSkills(skillListToUse, skillTable);
    if (skills) {
      detailData.skills = cleanEmbeddedData(skills);
    }

    // Extract and embed skill tagIds (for Essence Solver)
    const skillTags = extractWeaponSkillTags(skillListToUse, skillTable);
    if (skillTags.length > 0) {
      detailData.weaponSkillTags = skillTags;
    }

    // Add resolved base stats to detail file (already extracted above)
    if (baseStats.length > 0) {
      detailData.baseStats = baseStats;
      weaponsWithStats++;
    }

    // Add passive skill info to detail file (already extracted above)
    if (passives.length > 0) {
      detailData.passiveSkills = passives;
      weaponsWithPassives++;
    }

    // Use weapon's own data for progression templates
    const progression = extractProgressionData(weaponData, breakthroughTable, upgradeTable);
    if (progression) {
      detailData.progression = cleanEmbeddedData(progression);
    }

    const talents = extractTalentData(weaponData, talentTable);
    if (talents) {
      detailData.talents = cleanEmbeddedData(talents);
    }

    // Deduplicate i18n IDs in detail data
    const dedupedDetailData = deduplicateI18nIds(detailData);

    // Write individual detail file with embedded data
    const detailJson = stringifyJSONWithBigInt(dedupedDetailData);
    const detailFilePath = path.join(DETAILS_DIR, `${weaponId}.json`);
    fs.writeFileSync(detailFilePath, detailJson, 'utf8');
    totalDetailSize += fs.statSync(detailFilePath).size;

    count++;
  });

  // Deduplicate i18n IDs in list data
  const dedupedListData = deduplicateI18nIds(listData);

  console.log(`   ✓ ${weaponsWithStats} weapons have resolved base stats`);
  console.log(`   ✓ ${weaponsWithPassives} weapons have passive skills`);

  console.log(`✅ Processed ${count} weapons\n`);
  console.log('💾 Writing optimized files...');

  // Write list file (with deduplicated i18n IDs)
  const listJson = stringifyJSONWithBigInt(dedupedListData);
  fs.writeFileSync(LIST_FILE, listJson, 'utf8');
  const listSize = (fs.statSync(LIST_FILE).size / 1024).toFixed(2);
  console.log(`   ✓ List file: ${LIST_FILE} (${listSize} KB)${dedupMap ? ' [i18n IDs deduplicated]' : ''}`);
  console.log(`   ✓ Detail files: ${count} individual files in ${DETAILS_DIR}/ (${(totalDetailSize / 1024).toFixed(2)} KB total)`);

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
  console.log('\n✨ Weapon data optimization complete!');
}

// Run optimization
try {
  optimizeWeapons();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
