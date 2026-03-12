#!/usr/bin/env node

/**
 * CHARACTER DATA OPTIMIZER (ALL-IN-ONE MODE)
 *
 * This script optimizes character data by splitting it into:
 * 1. characters-list.json - Lightweight data for character grid/list view
 * 2. Individual detail files - COMPLETE character data including skills and talents
 *
 * Source: extracted_data/TableCfg/CharacterTable.json + SkillPatchTable.json + CharGrowthTable.json
 * Output: public/localdb/optimized/characters/
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
      if (key.endsWith('I18nId') || key === 'nameI18nId' || key === 'descI18nId') {
        result[key] = getCanonicalId(value, dedupMap);
      }
      // Check for nested name/desc objects with id
      else if ((key === 'name' || key === 'desc' || key === 'description' || key === 'skillName') &&
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
const CHARACTER_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'CharacterTable.json');
const SKILL_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'SkillPatchTable.json');
const TALENT_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'CharGrowthTable.json');
const POTENTIAL_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'CharacterPotentialTable.json');
const TALENT_EFFECT_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'PotentialTalentEffectTable.json');
const FACTORY_CHAR_SKILL_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'SpaceshipCharSkillTable.json');
const FACTORY_SKILL_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'SpaceshipSkillTable.json');
const BATTLE_TAG_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'CharBattleTagTable.json');
const PROFESSION_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'CharProfessionTable.json');
const CHARACTER_TAG_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'CharacterTagTable.json');
const GIFT_ITEM_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'GiftItemTable.json');
const ITEM_TABLE_PATH = path.join(EXTRACTED_DATA_DIR, 'ItemTable.json');
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/characters');
const LIST_FILE = path.join(OUTPUT_DIR, 'characters-list.json');
const DETAILS_DIR = path.join(OUTPUT_DIR, 'details');

// Fields for list view (bare minimum for character grid)
const LIST_FIELDS = [
  'charId',
  'engName',
  'name',          // Contains i18n ID
  'rarity',
  'profession',
  'charTypeId',    // Element type
  'charBattleTagIds', // Battle tags
  'weaponType',
  'department',
  'mainAttrType',
  'subAttrType'
];

// Fields for detail view (character-specific data only)
const DETAIL_FIELDS = [
  ...LIST_FIELDS,      // Include all list fields
  'cvName',            // Voice actor names
  'profileRecord',     // Profile records
  'skillIds',          // Skill IDs for this character
  'talentIds',         // Talent IDs for this character
  'attributes'         // Character stats/attributes (included in detail files now)
  // EXCLUDED: profileVoice (not used)
];

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
 * Remove unnecessary fields that bloat file size
 * - Empty strings
 * - Zero IDs
 * - Empty objects
 * - Null values
 */
function cleanObject(obj) {
  if (Array.isArray(obj)) {
    return obj
      .map(item => cleanObject(item))
      .filter(item => {
        // Remove null and undefined
        if (item === null || item === undefined) return false;
        // Remove empty objects {}
        if (typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 0) return false;
        // Remove empty arrays []
        if (Array.isArray(item) && item.length === 0) return false;
        return true;
      });
  }

  if (obj !== null && typeof obj === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip empty strings
      if (value === '') continue;

      // Skip zero IDs (but keep zero for other numeric fields)
      if (key === 'id' && value === 0) continue;

      // Skip empty tagId
      if (key === 'tagId' && value === '') continue;

      // Skip empty charId
      if (key === 'charId' && value === '') continue;

      // Skip text field if empty
      if (key === 'text' && value === '') continue;

      // Recursively clean nested objects
      if (value !== null && typeof value === 'object') {
        const cleanedValue = cleanObject(value);
        // Only include if object/array is not empty
        if (Array.isArray(cleanedValue)) {
          if (cleanedValue.length > 0) {
            cleaned[key] = cleanedValue;
          }
        } else if (Object.keys(cleanedValue).length > 0) {
          cleaned[key] = cleanedValue;
        }
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  return obj;
}

/**
 * Generate SEO-friendly slug from character name
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

  // Special handling: Extract i18n IDs from name/desc objects
  if (obj.name && obj.name.id && !result.nameI18nId) {
    result.nameI18nId = String(obj.name.id);
  }

  // Generate and add slug from English name (for SEO-friendly URLs)
  if (obj.engName) {
    const slug = generateSlug(obj.engName);
    if (slug) {
      result.slug = slug;
    }
  }

  return result;
}

/**
 * Extract character-specific skills from SkillPatchTable
 * Skills are linked by character ID prefix (e.g., chr_0002_endminm_attack1)
 */
function extractCharacterSkills(charId, skillTable) {
  const characterSkills = {};

  // Find all skills that start with this character's ID
  Object.keys(skillTable).forEach(skillId => {
    if (skillId.startsWith(charId)) {
      characterSkills[skillId] = skillTable[skillId];
    }
  });

  return characterSkills;
}

/**
 * Extract character-specific talents from CharGrowthTable
 * Talents are linked by character ID
 */
function extractCharacterTalents(charId, talentTable) {
  // Talents might be stored with character ID as the key
  if (talentTable[charId]) {
    return talentTable[charId];
  }

  // Or search for talents that reference this character
  const characterTalents = {};
  Object.keys(talentTable).forEach(talentId => {
    if (talentId.startsWith(charId) || talentId.includes(charId)) {
      characterTalents[talentId] = talentTable[talentId];
    }
  });

  return characterTalents;
}

/**
 * Extract character-specific potentials from CharacterPotentialTable
 * Potentials are linked by character ID
 */
function extractCharacterPotentials(charId, potentialTable) {
  // Potentials are stored with character ID as the key
  if (potentialTable[charId]) {
    return potentialTable[charId];
  }

  return null;
}

/**
 * SHARED CHARACTER EFFECT ID MAPPING
 * Some characters share talent/potential effects stored under a different character ID.
 * For example, Endministrator (chr_0002_endminm and chr_0003_endminf) share effects
 * stored under chr_9000_endmin.
 *
 * This mapping converts effect IDs to their shared counterpart when the original has empty values.
 */
const SHARED_EFFECT_ID_MAPPINGS = {
  // Endministrator male and female both use chr_9000_endmin for talents/potentials
  'chr_0002_endminm': 'chr_9000_endmin',
  'chr_0003_endminf': 'chr_9000_endmin',
};

/**
 * Try to get effect data from talentEffectTable, with fallback to shared character IDs
 * Returns the effect data if found, or null if not found
 */
function getEffectDataWithFallback(effectId, talentEffectTable) {
  // First, try the original effect ID
  if (talentEffectTable[effectId]) {
    const effectData = talentEffectTable[effectId];
    // Check if effect has actual values (not all zeros/empty)
    if (hasActualValues(effectData)) {
      return JSON.parse(JSON.stringify(effectData));
    }
  }

  // Try fallback mappings
  for (const [originalPrefix, sharedPrefix] of Object.entries(SHARED_EFFECT_ID_MAPPINGS)) {
    if (effectId.startsWith(originalPrefix)) {
      // Convert effect ID to use shared character prefix
      // e.g., chr_0002_endminm_talent_1_1 -> chr_9000_endmin_talent_1_1
      const sharedEffectId = effectId.replace(originalPrefix, sharedPrefix);

      if (talentEffectTable[sharedEffectId]) {
        const effectData = talentEffectTable[sharedEffectId];
        if (hasActualValues(effectData)) {
          return JSON.parse(JSON.stringify(effectData));
        }
      }
    }
  }

  // Return original effect data even if empty (better than nothing)
  if (talentEffectTable[effectId]) {
    return JSON.parse(JSON.stringify(talentEffectTable[effectId]));
  }

  return null;
}

/**
 * Check if effect data has actual values (not all zeros/empty)
 * Returns true if there are meaningful values in the effect
 */
function hasActualValues(effectData) {
  if (!effectData || !effectData.dataList || !Array.isArray(effectData.dataList)) {
    return false;
  }

  for (const data of effectData.dataList) {
    // Check attachBuff.blackboard for values
    if (data.attachBuff?.blackboard?.length > 0) {
      const hasValue = data.attachBuff.blackboard.some(bb => bb.value !== 0 && bb.value !== undefined);
      if (hasValue) return true;
    }

    // Check attachSkill.blackboard for values
    if (data.attachSkill?.blackboard?.length > 0) {
      const hasValue = data.attachSkill.blackboard.some(bb => bb.value !== 0 && bb.value !== undefined);
      if (hasValue) return true;
    }

    // Check skillBbModifier for values
    if (data.skillBbModifier?.floatValue !== 0 && data.skillBbModifier?.floatValue !== undefined) {
      return true;
    }

    // Check attrModifier for values
    if (data.attrModifier?.attrValue !== 0 && data.attrModifier?.attrValue !== undefined) {
      return true;
    }

    // Check skillParamModifier for values
    if (data.skillParamModifier?.paramValue !== 0 && data.skillParamModifier?.paramValue !== undefined) {
      return true;
    }
  }

  return false;
}

/**
 * Resolve potential effect IDs to actual effect data from PotentialTalentEffectTable
 * Embeds effect data directly into potentials array
 * IMPORTANT: Converts large number IDs to strings to preserve precision
 * Uses fallback to shared character IDs when original has empty values
 */
function resolvePotentialEffects(potentials, talentEffectTable) {
  if (!potentials || !talentEffectTable || !potentials.potentialUnlockBundle) {
    return potentials;
  }

  const resolved = { ...potentials };

  // Process potentialUnlockBundle array
  if (Array.isArray(resolved.potentialUnlockBundle)) {
    resolved.potentialUnlockBundle = resolved.potentialUnlockBundle.map(potential => {
      const resolvedPotential = { ...potential };

      // Convert potential name.id to string to preserve BigInt precision
      if (resolvedPotential.name && typeof resolvedPotential.name.id === 'number') {
        resolvedPotential.name.id = String(resolvedPotential.name.id);
      }

      // If potential has effectId, resolve it to actual effect data (with fallback)
      if (potential.potentialEffectId) {
        const effectData = getEffectDataWithFallback(potential.potentialEffectId, talentEffectTable);

        if (effectData) {
          // Convert desc.id to string to preserve BigInt precision
          if (effectData.desc && typeof effectData.desc.id === 'number') {
            effectData.desc.id = String(effectData.desc.id);
          }

          // Convert any other large number IDs in dataList
          if (effectData.dataList && Array.isArray(effectData.dataList)) {
            effectData.dataList = effectData.dataList.map(item => {
              const newItem = { ...item };
              // Convert any id fields to strings
              if (newItem.id && typeof newItem.id === 'number' && Math.abs(newItem.id) > 1000000000000) {
                newItem.id = String(newItem.id);
              }
              return newItem;
            });
          }

          resolvedPotential.effectData = effectData;
        }
      }

      return resolvedPotential;
    });
  }

  return resolved;
}

/**
 * Extract character-specific factory skills from SpaceshipCharSkillTable + SpaceshipSkillTable
 * Returns resolved factory skills with full details (not just IDs)
 */
function extractCharacterFactorySkills(charId, factoryCharSkillTable, factorySkillTable) {
  if (!factoryCharSkillTable || !factorySkillTable) {
    return null;
  }

  // SpaceshipCharSkillTable maps character ID to skillList
  const charSkillMapping = factoryCharSkillTable[charId];
  if (!charSkillMapping || !charSkillMapping.skillList || !Array.isArray(charSkillMapping.skillList)) {
    return null;
  }

  // Resolve skill IDs from skillList to actual skill data
  const resolvedSkills = {};
  charSkillMapping.skillList.forEach(skillEntry => {
    const skillId = skillEntry.skillId;
    if (skillId && factorySkillTable[skillId]) {
      resolvedSkills[skillId] = factorySkillTable[skillId];
    }
  });

  // Also include metadata from the character skill mapping
  return Object.keys(resolvedSkills).length > 0 ? {
    maxSkillCount: charSkillMapping.maxSkillCount,
    skills: resolvedSkills,
    skillList: charSkillMapping.skillList // Keep original mapping for skill indices
  } : null;
}

/**
 * Helper to process effect data for embedding
 * Converts large number IDs to strings to preserve precision
 */
function processEffectDataForEmbedding(effectData) {
  if (!effectData) return null;

  // Convert desc.id to string to preserve BigInt precision
  if (effectData.desc && typeof effectData.desc.id === 'number') {
    effectData.desc.id = String(effectData.desc.id);
  }

  // Convert any other large number IDs in dataList
  if (effectData.dataList && Array.isArray(effectData.dataList)) {
    effectData.dataList = effectData.dataList.map(item => {
      const newItem = { ...item };
      // Convert any id fields to strings
      if (newItem.id && typeof newItem.id === 'number' && Math.abs(newItem.id) > 1000000000000) {
        newItem.id = String(newItem.id);
      }
      return newItem;
    });
  }

  return effectData;
}

/**
 * Resolve talent effect IDs to actual effect data from PotentialTalentEffectTable
 * Talents contain effectIds that reference PotentialTalentEffectTable
 * This function embeds the actual effect data instead of just IDs
 * IMPORTANT: Converts large number IDs to strings to preserve precision
 * Uses fallback to shared character IDs when original has empty values
 */
function resolveTalentEffects(talents, talentEffectTable) {
  if (!talents || !talentEffectTable || Object.keys(talents).length === 0) {
    return talents;
  }

  const resolvedTalents = {};

  Object.entries(talents).forEach(([talentId, talentData]) => {
    resolvedTalents[talentId] = { ...talentData };

    // Special handling for talentNodeMap property (CharGrowthTable structure)
    if (talentId === 'talentNodeMap' && typeof talentData === 'object') {
      const resolvedNodeMap = {};
      let embeddedCount = 0;

      Object.entries(talentData).forEach(([nodeId, nodeData]) => {
        const resolvedNode = { ...nodeData };

        // If node has passiveSkillNodeInfo with talentEffectId, resolve it
        if (nodeData.passiveSkillNodeInfo && nodeData.passiveSkillNodeInfo.talentEffectId) {
          const talentEffectId = nodeData.passiveSkillNodeInfo.talentEffectId;

          // Use fallback mechanism for shared character effects
          const effectData = getEffectDataWithFallback(talentEffectId, talentEffectTable);

          if (effectData) {
            processEffectDataForEmbedding(effectData);

            // Embed effectData into passiveSkillNodeInfo
            resolvedNode.passiveSkillNodeInfo = {
              ...nodeData.passiveSkillNodeInfo,
              effectData
            };
            embeddedCount++;
          }
        }

        resolvedNodeMap[nodeId] = resolvedNode;
      });

      // Talent effects embedded successfully

      resolvedTalents[talentId] = resolvedNodeMap;
      return;
    }

    // If talent has effects array, resolve each effect (old structure)
    if (talentData.effects && Array.isArray(talentData.effects)) {
      resolvedTalents[talentId].effects = talentData.effects.map(effect => {
        // If effect has an effectId, resolve it to actual effect data (with fallback)
        if (effect.effectId) {
          const effectData = getEffectDataWithFallback(effect.effectId, talentEffectTable);

          if (effectData) {
            processEffectDataForEmbedding(effectData);

            return {
              ...effect,
              effectData
            };
          }
        }
        return effect;
      });
    }

    // If this specific property has talentNodeMap (nested structure)
    if (talentData.talentNodeMap && typeof talentData.talentNodeMap === 'object') {
      const resolvedNodeMap = {};
      let embeddedCount = 0;

      Object.entries(talentData.talentNodeMap).forEach(([nodeId, nodeData]) => {
        const resolvedNode = { ...nodeData };

        // If node has passiveSkillNodeInfo with talentEffectId, resolve it
        if (nodeData.passiveSkillNodeInfo && nodeData.passiveSkillNodeInfo.talentEffectId) {
          const talentEffectId = nodeData.passiveSkillNodeInfo.talentEffectId;

          // Use fallback mechanism for shared character effects
          const effectData = getEffectDataWithFallback(talentEffectId, talentEffectTable);

          if (effectData) {
            processEffectDataForEmbedding(effectData);

            // Embed effectData into passiveSkillNodeInfo
            resolvedNode.passiveSkillNodeInfo = {
              ...nodeData.passiveSkillNodeInfo,
              effectData
            };
            embeddedCount++;
          }
        }

        resolvedNodeMap[nodeId] = resolvedNode;
      });

      // Talent effects embedded successfully

      resolvedTalents[talentId].talentNodeMap = resolvedNodeMap;
    }
  });

  return resolvedTalents;
}

/**
 * Resolve battle tag IDs to battle tag data from CharBattleTagTable
 * Returns array of resolved battle tags with full details
 */
function resolveBattleTags(battleTagIds, battleTagTable) {
  if (!battleTagIds || !battleTagTable || !Array.isArray(battleTagIds)) {
    return null;
  }

  const resolvedTags = battleTagIds
    .map(tagId => battleTagTable[tagId])
    .filter(tag => tag !== undefined && tag !== null);

  return resolvedTags.length > 0 ? resolvedTags : null;
}

/**
 * Resolve profession ID to profession data from CharProfessionTable
 * Returns profession details instead of just ID
 */
function resolveProfession(professionId, professionTable) {
  if (professionId === undefined || professionId === null || !professionTable) {
    return null;
  }

  return professionTable[professionId] || null;
}

/**
 * Extract best gifts for a character based on their gift preference tags
 * Matches character.giftPreferTagId[] to gift.giftPreferTag
 * Calculates actual affinity based on hobby tag matches:
 * - 2+ hobby tag matches: 20 points (Perfect match)
 * - 1 hobby tag match: 15 points (Good match)
 * - 0 hobby tag matches: 10 points (Okay match)
 * Returns array of gifts with item details (name, desc, icon, rarity, favorablePoint)
 */
function extractBestGifts(charId, characterTagTable, giftItemTable, itemTable) {
  if (!characterTagTable || !giftItemTable || !itemTable) {
    return null;
  }

  // Get character's gift preference tags and hobby tags
  const charTags = characterTagTable[charId];
  if (!charTags || !charTags.giftPreferTagId || !Array.isArray(charTags.giftPreferTagId) || charTags.giftPreferTagId.length === 0) {
    return null;
  }

  const giftPreferTagIds = charTags.giftPreferTagId;
  const characterHobbyTags = charTags.hobbyTagIds || [];

  // Find all gifts that match character's preference tags
  const bestGifts = [];
  Object.entries(giftItemTable).forEach(([giftId, giftData]) => {
    // Check if gift's giftPreferTag is in character's giftPreferTagId array
    if (giftData.giftPreferTag && giftPreferTagIds.includes(giftData.giftPreferTag)) {
      // Get item details from ItemTable
      const itemData = itemTable[giftId];
      if (itemData) {
        // Calculate actual affinity based on hobby tag matches
        const giftTagList = giftData.tagList || [];
        const matchingTagsCount = giftTagList.filter(tag => characterHobbyTags.includes(tag)).length;

        // Determine affinity points based on matches
        let calculatedAffinity;
        if (matchingTagsCount >= 2) {
          calculatedAffinity = 20; // Perfect match (2+ hobby tags)
        } else if (matchingTagsCount === 1) {
          calculatedAffinity = 15; // Good match (1 hobby tag)
        } else {
          calculatedAffinity = 0; // No match (0 hobby tags)
        }

        bestGifts.push({
          itemId: giftId,
          nameI18nId: itemData.name?.id ? String(itemData.name.id) : null,
          descI18nId: itemData.desc?.id ? String(itemData.desc.id) : null,
          iconId: itemData.iconId || giftId,
          rarity: itemData.rarity || 0,
          favorablePoint: calculatedAffinity
        });
      }
    }
  });

  // Sort by favorable point (highest first), then by rarity
  bestGifts.sort((a, b) => {
    if (b.favorablePoint !== a.favorablePoint) {
      return b.favorablePoint - a.favorablePoint;
    }
    return b.rarity - a.rarity;
  });

  return bestGifts.length > 0 ? bestGifts : null;
}

/**
 * Main optimization function
 */
function optimizeCharacters() {
  console.log('🔧 Starting character data optimization (ALL-IN-ONE MODE)...\n');

  // Load deduplication map for i18n IDs
  console.log('📖 Loading i18n deduplication map...');
  dedupMap = loadDedupMap();
  if (dedupMap) {
    console.log('   ✓ Dedup map loaded - i18n IDs will be deduplicated\n');
  } else {
    console.log('   ⚠ No dedup map found - run i18n-dedup.js first for optimal results\n');
  }

  // Check if source files exist
  if (!fs.existsSync(CHARACTER_TABLE_PATH)) {
    console.error('❌ Error: Source file not found:', CHARACTER_TABLE_PATH);
    console.error('   Please ensure extracted_data/TableCfg/CharacterTable.json exists.');
    process.exit(1);
  }

  // Ensure output directories exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  if (!fs.existsSync(DETAILS_DIR)) {
    fs.mkdirSync(DETAILS_DIR, { recursive: true });
  }

  // Load all required data
  console.log('📖 Loading game data tables...');
  const characterTable = loadJSON(CHARACTER_TABLE_PATH);
  const skillTable = loadJSON(SKILL_TABLE_PATH) || {};
  const talentTable = loadJSON(TALENT_TABLE_PATH) || {};
  const potentialTable = loadJSON(POTENTIAL_TABLE_PATH) || {};
  const talentEffectTable = loadJSON(TALENT_EFFECT_TABLE_PATH) || {};
  const factoryCharSkillTable = loadJSON(FACTORY_CHAR_SKILL_TABLE_PATH) || {};
  const factorySkillTable = loadJSON(FACTORY_SKILL_TABLE_PATH) || {};
  const battleTagTable = loadJSON(BATTLE_TAG_TABLE_PATH) || {};
  const professionTable = loadJSON(PROFESSION_TABLE_PATH) || {};
  const characterTagTable = loadJSON(CHARACTER_TAG_TABLE_PATH) || {};
  const giftItemTable = loadJSON(GIFT_ITEM_TABLE_PATH) || {};
  const itemTable = loadJSON(ITEM_TABLE_PATH) || {};

  console.log(`   ✓ Characters: ${Object.keys(characterTable).length} entries`);
  console.log(`   ✓ Skills: ${Object.keys(skillTable).length} entries`);
  console.log(`   ✓ Talents: ${Object.keys(talentTable).length} entries`);
  console.log(`   ✓ Potentials: ${Object.keys(potentialTable).length} entries`);
  console.log(`   ✓ Talent Effects: ${Object.keys(talentEffectTable).length} entries`);
  console.log(`   ✓ Factory Char Skills: ${Object.keys(factoryCharSkillTable).length} entries`);
  console.log(`   ✓ Factory Skills: ${Object.keys(factorySkillTable).length} entries`);
  console.log(`   ✓ Battle Tags: ${Object.keys(battleTagTable).length} entries`);
  console.log(`   ✓ Professions: ${Object.keys(professionTable).length} entries`);
  console.log(`   ✓ Character Tags: ${Object.keys(characterTagTable).length} entries`);
  console.log(`   ✓ Gift Items: ${Object.keys(giftItemTable).length} entries`);
  console.log(`   ✓ Items: ${Object.keys(itemTable).length} entries\n`);

  const listData = {};
  let count = 0;
  let totalDetailSize = 0;
  let totalSkillsIncluded = 0;
  let totalTalentsIncluded = 0;
  let totalPotentialsIncluded = 0;
  let totalFactorySkillsIncluded = 0;
  let totalBestGiftsIncluded = 0;

  // Process each character
  console.log('⚙️  Processing characters...');
  Object.entries(characterTable).forEach(([charId, charData]) => {
    // Extract list fields (for character grid)
    listData[charId] = extractFields(charData, LIST_FIELDS);

    // Extract detail fields
    const detailData = extractFields(charData, DETAIL_FIELDS);

    // **ALL-IN-ONE**: Include character-specific skills, talents, and potentials directly
    const characterSkills = extractCharacterSkills(charId, skillTable);
    const characterTalents = extractCharacterTalents(charId, talentTable);
    const characterPotentials = extractCharacterPotentials(charId, potentialTable);
    const characterFactorySkills = extractCharacterFactorySkills(charId, factoryCharSkillTable, factorySkillTable);

    // Resolve talent effects (embed effect data instead of just IDs)
    const resolvedTalents = resolveTalentEffects(characterTalents, talentEffectTable);

    // Resolve potential effects (embed effect data instead of just IDs)
    const resolvedPotentials = resolvePotentialEffects(characterPotentials, talentEffectTable);

    // Resolve battle tags (embed tag details instead of just IDs)
    const resolvedBattleTags = resolveBattleTags(charData.charBattleTagIds, battleTagTable);

    // Resolve profession (embed profession details instead of just ID)
    const resolvedProfession = resolveProfession(charData.profession, professionTable);

    detailData.skills = characterSkills;
    detailData.talents = resolvedTalents;
    if (resolvedPotentials) {
      detailData.potentials = resolvedPotentials;
      totalPotentialsIncluded++;
    }
    if (characterFactorySkills) {
      detailData.factorySkills = characterFactorySkills;
      totalFactorySkillsIncluded += Object.keys(characterFactorySkills.skills || {}).length;
    }

    // Extract best gifts for this character
    const characterBestGifts = extractBestGifts(charId, characterTagTable, giftItemTable, itemTable);
    if (characterBestGifts) {
      detailData.bestGifts = characterBestGifts;
      totalBestGiftsIncluded += characterBestGifts.length;
    }

    if (resolvedBattleTags) {
      detailData.battleTagsData = resolvedBattleTags;
    }
    if (resolvedProfession) {
      detailData.professionData = resolvedProfession;
    }

    totalSkillsIncluded += Object.keys(characterSkills).length;
    totalTalentsIncluded += Object.keys(resolvedTalents).length;

    // CLEAN: Remove unnecessary empty fields to reduce file size
    const cleanedDetailData = cleanObject(detailData);

    // Deduplicate i18n IDs in detail data
    const dedupedDetailData = deduplicateI18nIds(cleanedDetailData);

    // Write individual detail file with ALL character data
    const detailJson = stringifyJSONWithBigInt(dedupedDetailData);
    const detailFilePath = path.join(DETAILS_DIR, `${charId}.json`);
    fs.writeFileSync(detailFilePath, detailJson, 'utf8');
    totalDetailSize += fs.statSync(detailFilePath).size;

    count++;
  });

  // Deduplicate i18n IDs in list data
  const dedupedListData = deduplicateI18nIds(listData);

  console.log(`✅ Processed ${count} characters`);
  console.log(`   ✓ Embedded ${totalSkillsIncluded} battle skills across all characters`);
  console.log(`   ✓ Embedded ${totalTalentsIncluded} talents (with resolved effects) across all characters`);
  console.log(`   ✓ Embedded potentials for ${totalPotentialsIncluded} characters`);
  console.log(`   ✓ Embedded ${totalFactorySkillsIncluded} factory skills across all characters`);
  console.log(`   ✓ Embedded ${totalBestGiftsIncluded} best gifts across all characters\n`);
  console.log('💾 Writing optimized files...');

  // Write list file (with deduplicated i18n IDs)
  const listJson = stringifyJSONWithBigInt(dedupedListData);
  fs.writeFileSync(LIST_FILE, listJson, 'utf8');
  const listSize = (fs.statSync(LIST_FILE).size / 1024).toFixed(2);
  console.log(`   ✓ List file: ${LIST_FILE} (${listSize} KB)${dedupMap ? ' [i18n IDs deduplicated]' : ''}`);
  console.log(`   ✓ Detail files: ${count} individual files in ${DETAILS_DIR}/ (${(totalDetailSize / 1024).toFixed(2)} KB total)`);
  console.log(`   ✓ Average detail file size: ${(totalDetailSize / 1024 / count).toFixed(2)} KB per character`);

  // Calculate original size
  const originalSize = (fs.statSync(CHARACTER_TABLE_PATH).size / 1024).toFixed(2);
  const totalOptimized = parseFloat(listSize) + (totalDetailSize / 1024);
  const reduction = ((1 - totalOptimized / parseFloat(originalSize)) * 100).toFixed(1);

  console.log('\n📊 Optimization Summary:');
  console.log(`   Original CharacterTable:  ${originalSize} KB`);
  console.log(`   List file:                ${listSize} KB`);
  console.log(`   Detail files (total):     ${(totalDetailSize / 1024).toFixed(2)} KB (${count} files)`);
  console.log(`   Combined total:           ${totalOptimized.toFixed(2)} KB`);
  console.log(`   Reduction:                ${reduction}%`);
  console.log('\n✨ Character data optimization complete (ALL-IN-ONE MODE)!');
  console.log('   Each character file now contains ALL character-specific data including skills, talents, potentials, and attributes.');
}

// Run optimization
try {
  optimizeCharacters();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
