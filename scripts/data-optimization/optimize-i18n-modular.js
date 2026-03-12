#!/usr/bin/env node

/**
 * MODULAR I18N TRANSLATIONS OPTIMIZER
 *
 * This script optimizes i18n translation files by splitting them into modules:
 * - core: Always loaded (elements, professions, weapons, attributes, common names)
 * - characters: Character descriptions, skills, talents
 * - weapons: Weapon descriptions, passives
 * - equipment: Equipment names, suit effects
 * - factory: Building names, recipes
 * - map: POI names, zones, enemies
 * - combat: Combat mechanics, tooltips
 * - achievements: Achievement names, descriptions
 *
 * IDs used by multiple modules are automatically moved to 'core'
 *
 * Source: extracted_data/TableCfg/I18nTextTable_*.json
 * Output: public/localdb/optimized/i18n/{module}/I18nTextTable_{lang}.json
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const JSONbigString = require('json-bigint')({ storeAsString: true });
const { loadDedupMap, getCanonicalId, OUTPUT_FILE: DEDUP_MAP_FILE } = require('./i18n-dedup');

/**
 * JSON parser and stringifier that preserves large numbers as strings
 */
function parseJSONWithBigInt(text) {
  return JSONbigString.parse(text);
}

function stringifyJSONWithBigInt(obj) {
  // Minified output for production
  return JSONbigString.stringify(obj);
}

// Global dedup map - loaded once at start
let dedupMap = null;

// Paths
const EXTRACTED_DATA_DIR = path.join(__dirname, '../../extracted_data/TableCfg');
const OPTIMIZED_DATA_DIR = path.join(__dirname, '../../public/localdb/optimized');
const LOCALDB_DIR = path.join(__dirname, '../../public/localdb');
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/i18n');

// Language codes
const LANGUAGES = ['EN', 'CN', 'TC', 'JP', 'KR', 'RU', 'MX', 'FR', 'PT', 'DE', 'ID', 'VI', 'TH', 'IT'];

// Mapping from application language codes to extracted data file names
const LANG_FILE_MAP = {
  'PT': 'BR',  // Application uses PT, extracted data uses BR
  'VI': 'VN',  // Application uses VI, extracted data uses VN
};

/**
 * Module configuration - defines which source files belong to each module
 */
const MODULE_CONFIG = {
  core: {
    // Core module gets hardcoded IDs and shared IDs
    sourceFiles: [],
    hardcodedIds: [
      // Element types (from CharTypeTable.json via characterLoader.ts)
      '-1566258159335749645',  // Physical
      '-7830608904178817136',  // Heat (Fire)
      '-6369055508956636388',  // Cryo (Cryst)
      '-474170932806761396',   // Nature (Natural)
      '-2170293331777838058',  // Electric (Pulse)
      // Profession types (from CharProfessionTable.json via characterLoader.ts)
      '-6083717892122630775',  // Guard
      '4676145990391874054',   // Defender
      '1423215062502662901',   // Support
      '-6440713593686885024',  // Caster
      '5237214783525020128',   // Vanguard
      '6617530151449191683',   // Striker
      // Weapon types (from I18nTextTable via characterLoader.ts)
      '-7916605382497395047',  // Sword
      '5183277241087333572',   // Arts Unit
      '-8432726716700837576',  // Greatsword
      '5207518553034523032',   // Polearm
      '-6369535528173739273',  // Handcannon
      // Attribute names (from AttributeShowConfigTable.json)
      // Base stats (STR, AGI, WISD, WILL)
      '2355478836573321161',   // Strength (STR)
      '-8815595117790377436',  // Agility (AGI)
      '-1870798312171364168',  // Wisdom (WISD)
      '4654474915400698270',   // Will (WILL)
      // Combat stats
      '6535041932326268949',   // HP related
      '9090593047193833200',   // ATK related
      '-1115310042027022449',  // DEF related
      '-4127398237271770592',  // Crit Rate
      '6365744697763255816',   // Crit Damage
      '8256982325255970099',   // Attack Speed
      // Damage types
      '-9026061863370532608',  // Physical DMG Bonus
      '503695680228916336',    // Fire DMG Bonus
      '-8634492975006047637',  // Pulse DMG Bonus
      '-5263165439314064353',  // Cryst DMG Bonus
      '3969107185443486113',   // Natural DMG Bonus
      // Resistances
      '-5871780708667524427',  // Physical RES
      '2400038995309626520',   // Fire RES
      '-4069323324375830555',  // Pulse RES
      '8662060300360771832',   // Cryst RES
      '-2982559916686864235',  // Natural RES
      '-7375903934825158583',  // Ether RES
      // Additional attribute names
      '-1035022591328361878', '-170824616125197758', '-1870009604335259308',
      '-217961929859924735', '-221062117370437214', '-2389693424450030773',
      '-2406898347439016048', '-2577798867656219658', '-3280217146977148791',
      '-4225907695857912386', '-4436658582686060309', '-4863713992017468224',
      '-5051082370439865772', '-5061652934836028314', '-5261102765662933714',
      '-5985834577512107755', '-6057885156038029140', '-69784554088281091',
      '-7112275883100640641', '-8165957626036507336', '-8325799085009009975',
      '-8432042846502432166', '-8907184635824340131', '-9210691613293415580',
      '102819083519601455', '1213052022371829457', '1491118226404607042',
      '1573185050037038568', '1596911308442434599', '1833733510245640427',
      '2533465355270909849', '2677657836759604437', '2804089720694234149',
      '2897181504006937697', '3102204888478572415', '3380719614180221218',
      '3387953612375124587', '3548227614562377220', '3839868441622269024',
      '3990276471330016624', '4419495593909778339', '4776472189901527402',
      '4893307765032276101', '4950866748476421443', '5412209640958390123',
      '5612420024054189605', '5642466672351304092', '5666431107334094190',
      '6312901184993160544', '6689513536889875149', '6876128936367354009',
      '687719067263433075', '7050913070965160092', '7083179319428632786',
      '7383990943774571713', '7476862277833267158', '7774673864622275302',
      '7781366435486654294', '843070348241674052', '8517998762032258022',
      '8648195336752577363', '8679218165638463463', '9191906397606179018',
      '9193792595313669990',
    ],
    alwaysLoad: true,
  },
  characters: {
    sourceFiles: [
      'characters/characters-list.json',
      'characters/details/*.json',
    ],
    alwaysLoad: false,
  },
  weapons: {
    sourceFiles: [
      'weapons/weapons-list.json',
      'weapons/details/*.json',
      // Essence data (essences are equipped on weapons)
      'essences/essences-database.json',
      'guides/essences-guide-data.json',
    ],
    alwaysLoad: false,
  },
  equipment: {
    sourceFiles: [
      'equipment/equipment-list.json',
      'equipment/details/*.json',
      'equipment/suits/suits-list.json',
      'equipment/suits/details/*.json',
    ],
    alwaysLoad: false,
  },
  factory: {
    sourceFiles: [
      'factory/factory-data.json',
      'factory/factory-browse-data.json',
      'factory/buildings-list.json',
      'factory/item-slugs.json',
    ],
    alwaysLoad: false,
  },
  map: {
    sourceFiles: [
      'map/map-data.json',
      'map/map01-data.json',
      'map/map02-data.json',
    ],
    alwaysLoad: false,
  },
  combat: {
    sourceFiles: [
      'combat/combat-mechanics.json',
    ],
    alwaysLoad: false,
  },
  achievements: {
    sourceFiles: [
      'achievements/achievements-list.json',
      'achievements/achievements-types.json',
    ],
    alwaysLoad: false,
  },
  skills: {
    // Skill module: scanned from extracted_data files (CharGrowthTable, SkillPatchTable)
    // Used by character detail pages for skill multiplier labels
    sourceFiles: [],
    alwaysLoad: false,
  },
};

/**
 * Scan a single file for i18n IDs (reused from optimize-i18n.js)
 */
function scanFileForI18nIds(filePath, usedIds) {
  if (!fs.existsSync(filePath)) return 0;

  const content = fs.readFileSync(filePath, 'utf8');
  let foundCount = 0;

  // Find all i18n ID patterns (large numbers as strings)
  const idMatches = content.matchAll(/"(?:name|desc|title|recordTitle|recordDesc|voiceTitle|voiceDesc|formulaDesc|decoDesc|noObtainWayHint|description|shortDesc|featuredWeaponName|featuredCharName|enemyName)I18nId"\s*:\s*"([^"]+)"/g);
  for (const match of idMatches) {
    if (!usedIds.has(match[1])) {
      usedIds.add(match[1]);
      foundCount++;
    }
  }

  // Also check for nested id fields in name/desc objects
  const nestedIdMatches = content.matchAll(/"(?:name|desc|title|recordTitle|recordDesc|voiceTitle|voiceDesc|formulaDesc|decoDesc|noObtainWayHint|description)"\s*:\s*\{\s*"id"\s*:\s*"([^"]+)"/g);
  for (const match of nestedIdMatches) {
    if (!usedIds.has(match[1])) {
      usedIds.add(match[1]);
      foundCount++;
    }
  }

  // Check for plain "id" fields that might be i18n references (large numbers)
  const plainIdStringMatches = content.matchAll(/"id"\s*:\s*"(-?\d{15,})"/g);
  for (const match of plainIdStringMatches) {
    if (!usedIds.has(match[1])) {
      usedIds.add(match[1]);
      foundCount++;
    }
  }

  // AND numeric format: "id": 123456789012345
  const plainIdNumericMatches = content.matchAll(/"id"\s*:\s*(-?\d{15,})/g);
  for (const match of plainIdNumericMatches) {
    const idStr = match[1];
    if (!usedIds.has(idStr)) {
      usedIds.add(idStr);
      foundCount++;
    }
  }

  // Map config patterns
  const mapConfigObjectIdMatches = content.matchAll(/"int_doodad_[^"]+"\s*:\s*"(-?\d{15,})"/g);
  for (const match of mapConfigObjectIdMatches) {
    if (!usedIds.has(match[1])) {
      usedIds.add(match[1]);
      foundCount++;
    }
  }

  const mapConfigSingleIdMatches = content.matchAll(/"(?:recycling|tpPoint)I18nId"\s*:\s*"(-?\d{15,})"/g);
  for (const match of mapConfigSingleIdMatches) {
    if (!usedIds.has(match[1])) {
      usedIds.add(match[1]);
      foundCount++;
    }
  }

  // Map name i18n IDs
  const mapNameI18nIdMatches = content.matchAll(/"map\d+"\s*:\s*"(-?\d{15,})"/g);
  for (const match of mapNameI18nIdMatches) {
    if (!usedIds.has(match[1])) {
      usedIds.add(match[1]);
      foundCount++;
    }
  }

  // Zone name i18n IDs
  const zoneNameI18nIdMatches = content.matchAll(/"map\d+_lv\d+"\s*:\s*"(-?\d{15,})"/g);
  for (const match of zoneNameI18nIdMatches) {
    if (!usedIds.has(match[1])) {
      usedIds.add(match[1]);
      foundCount++;
    }
  }

  // Sub-zone location i18n IDs (arrays)
  const subZoneLevelMatches = content.matchAll(/"map\d+_lv\d+"\s*:\s*\[([\s\S]*?)\]/g);
  for (const match of subZoneLevelMatches) {
    const arrayContent = match[1];
    const idArrayMatches = arrayContent.matchAll(/"(-?\d{15,})"/g);
    for (const idMatch of idArrayMatches) {
      if (!usedIds.has(idMatch[1])) {
        usedIds.add(idMatch[1]);
        foundCount++;
      }
    }
  }

  // Combat mechanics detailedDescI18nIds arrays
  const detailedDescIdsMatches = content.matchAll(/"detailedDescI18nIds"\s*:\s*\[([\s\S]*?)\]/g);
  for (const match of detailedDescIdsMatches) {
    const arrayContent = match[1];
    const idArrayMatches = arrayContent.matchAll(/"(-?\d{15,})"/g);
    for (const idMatch of idArrayMatches) {
      if (!usedIds.has(idMatch[1])) {
        usedIds.add(idMatch[1]);
        foundCount++;
      }
    }
  }

  // Achievement levelDescI18nIds arrays
  const levelDescIdsMatches = content.matchAll(/"levelDescI18nIds"\s*:\s*\[([\s\S]*?)\]/g);
  for (const match of levelDescIdsMatches) {
    const arrayContent = match[1];
    const idArrayMatches = arrayContent.matchAll(/"(-?\d{15,})"/g);
    for (const idMatch of idArrayMatches) {
      if (!usedIds.has(idMatch[1])) {
        usedIds.add(idMatch[1]);
        foundCount++;
      }
    }
  }

  // Achievement conditionDescI18nIds nested arrays
  const conditionDescIdsMatches = content.matchAll(/"conditionDescI18nIds"\s*:\s*\[([\s\S]*?)\]\]/g);
  for (const match of conditionDescIdsMatches) {
    const arrayContent = match[1] + ']';
    const idArrayMatches = arrayContent.matchAll(/"(-?\d{15,})"/g);
    for (const idMatch of idArrayMatches) {
      if (!usedIds.has(idMatch[1])) {
        usedIds.add(idMatch[1]);
        foundCount++;
      }
    }
  }

  return foundCount;
}

/**
 * Extract i18n IDs for a specific module
 */
function extractModuleIds(moduleName, config) {
  const ids = new Set();

  // Add hardcoded IDs
  if (config.hardcodedIds) {
    config.hardcodedIds.forEach(id => ids.add(id));
  }

  // Scan source files
  if (config.sourceFiles) {
    config.sourceFiles.forEach(pattern => {
      const fullPattern = path.join(OPTIMIZED_DATA_DIR, pattern);
      const files = glob.sync(fullPattern.replace(/\\/g, '/'));

      files.forEach(file => {
        scanFileForI18nIds(file, ids);
      });
    });
  }

  return ids;
}

/**
 * Extract skill-related i18n IDs (for skills module)
 */
function extractSkillIds() {
  const ids = new Set();

  // CharGrowthTable (contains skill names/descriptions) - in extracted_data
  const charGrowthPath = path.join(EXTRACTED_DATA_DIR, 'CharGrowthTable.json');
  scanFileForI18nIds(charGrowthPath, ids);

  // SkillPatchTable (contains skill multiplier data) - in extracted_data
  const skillPatchPath = path.join(EXTRACTED_DATA_DIR, 'SkillPatchTable.json');
  scanFileForI18nIds(skillPatchPath, ids);

  return ids;
}

/**
 * Also scan additional data files that aren't module-specific
 */
function extractAdditionalIds() {
  const ids = new Set();

  // Banner config
  const bannerConfigPath = path.join(LOCALDB_DIR, 'banner_config.json');
  scanFileForI18nIds(bannerConfigPath, ids);

  // Items list
  const itemsListPath = path.join(OPTIMIZED_DATA_DIR, 'items/items-list.json');
  scanFileForI18nIds(itemsListPath, ids);

  // Guides (essences files now in weapons module)
  const guidesFiles = [
    'guides/artificing-guide-data.json',
  ];
  guidesFiles.forEach(file => {
    scanFileForI18nIds(path.join(OPTIMIZED_DATA_DIR, file), ids);
  });

  return ids;
}

/**
 * Filter IDs to only include those that exist in translation files
 */
function filterExistingIds(usedIds) {
  const enPath = path.join(EXTRACTED_DATA_DIR, 'I18nTextTable_EN.json');
  if (!fs.existsSync(enPath)) {
    console.warn('   Warning: English i18n file not found, skipping filter');
    return usedIds;
  }

  const enText = fs.readFileSync(enPath, 'utf8');
  const enData = parseJSONWithBigInt(enText);
  const enKeys = new Set(Object.keys(enData));

  const filteredIds = new Set();
  usedIds.forEach(id => {
    if (enKeys.has(id)) {
      filteredIds.add(id);
    }
  });

  return filteredIds;
}

// Modules that should NOT use deduplication
// These modules have data files that use original IDs (not deduplicated)
// So the translation files must include all original IDs for lookups to work
// 'skills' added because skill data uses original IDs in subDescNameList
const NO_DEDUP_MODULES = ['map', 'skills'];

/**
 * Write module translations for a specific language
 * With deduplication: only writes canonical IDs, skips duplicates
 * Exception: Modules in NO_DEDUP_MODULES store all IDs (both original and canonical)
 * NEW: If canonical ID is not in this module, include the original ID anyway
 */
function writeModuleTranslations(moduleName, ids, lang, fullI18n) {
  const moduleDir = path.join(OUTPUT_DIR, moduleName);
  if (!fs.existsSync(moduleDir)) {
    fs.mkdirSync(moduleDir, { recursive: true });
  }

  const translations = {};
  let foundCount = 0;
  let dedupedCount = 0;

  // Check if this module should skip deduplication
  const skipDedup = NO_DEDUP_MODULES.includes(moduleName);

  ids.forEach(id => {
    if (fullI18n[id] !== undefined) {
      // Skip dedup for certain modules (like map) that use original IDs
      if (skipDedup) {
        // Include all IDs without deduplication
        translations[id] = fullI18n[id];
        foundCount++;
      } else if (dedupMap) {
        // With dedup: only include if this is the canonical ID
        const canonicalId = getCanonicalId(id, dedupMap);
        if (canonicalId === id) {
          // This is a canonical ID - include it
          translations[id] = fullI18n[id];
          foundCount++;
        } else if (!ids.has(canonicalId)) {
          // The canonical ID is not in this module, so include original ID
          // This ensures translations work even when dedup points elsewhere
          translations[id] = fullI18n[id];
          foundCount++;
        } else {
          // This is a duplicate and canonical ID is in this module - skip it
          dedupedCount++;
        }
      } else {
        // No dedup map - include all IDs (legacy behavior)
        translations[id] = fullI18n[id];
        foundCount++;
      }
    }
  });

  const outputPath = path.join(moduleDir, `I18nTextTable_${lang}.json`);
  fs.writeFileSync(outputPath, stringifyJSONWithBigInt(translations), 'utf8');

  return { foundCount, dedupedCount, size: fs.statSync(outputPath).size };
}

/**
 * Main optimization function
 */
function optimizeI18nModular() {
  console.log('🔧 Starting MODULAR i18n translation optimization...\n');

  // Step 0: Load deduplication map
  console.log('📖 Loading deduplication map...');
  dedupMap = loadDedupMap();
  if (dedupMap) {
    const dedupStats = JSON.parse(fs.readFileSync(DEDUP_MAP_FILE, 'utf8')).stats;
    console.log(`   ✓ Dedup map loaded: ${dedupStats.totalIds} IDs → ${dedupStats.uniqueValues} unique (${dedupStats.reductionPercent}% reduction)`);
  } else {
    console.log('   ⚠ No dedup map found - running without deduplication');
    console.log('   Run i18n-dedup.js first for optimal results');
  }
  console.log();

  // Step 1: Extract IDs for each module
  console.log('📖 Scanning data files for i18n IDs per module...\n');

  const moduleIds = {};
  let totalIds = 0;

  for (const [moduleName, config] of Object.entries(MODULE_CONFIG)) {
    const ids = extractModuleIds(moduleName, config);
    moduleIds[moduleName] = ids;
    console.log(`   ${moduleName}: ${ids.size} IDs`);
    totalIds += ids.size;
  }

  // Step 2a: Extract skill IDs for skills module
  console.log('\n📖 Scanning skill data files...');
  const skillIds = extractSkillIds();
  console.log(`   Found ${skillIds.size} skill IDs`);

  // Add skill IDs to skills module
  skillIds.forEach(id => {
    moduleIds.skills.add(id);
  });

  // Step 2b: Extract other additional IDs
  console.log('\n📖 Scanning additional data files...');
  const additionalIds = extractAdditionalIds();
  console.log(`   Found ${additionalIds.size} additional IDs`);

  // Add additional IDs to characters module (they're mostly character-related)
  additionalIds.forEach(id => {
    moduleIds.characters.add(id);
  });

  // Step 3: Find IDs used by multiple modules and move to core
  // EXCEPT: skills module keeps all its IDs (no dedup, no shared ID moving)
  console.log('\n🔄 Detecting shared IDs...');

  const idUsageCount = new Map();
  for (const [moduleName, ids] of Object.entries(moduleIds)) {
    // Skip core and skills from shared ID detection
    if (moduleName === 'core' || moduleName === 'skills') continue;
    ids.forEach(id => {
      idUsageCount.set(id, (idUsageCount.get(id) || 0) + 1);
    });
  }

  let sharedCount = 0;
  for (const [id, count] of idUsageCount) {
    if (count > 1) {
      // Move to core
      moduleIds.core.add(id);
      // Remove from individual modules (but NOT from skills module)
      for (const [moduleName, ids] of Object.entries(moduleIds)) {
        if (moduleName !== 'core' && moduleName !== 'skills') {
          ids.delete(id);
        }
      }
      sharedCount++;
    }
  }
  console.log(`   Moved ${sharedCount} shared IDs to core module`);

  // Step 4: Filter to only existing translations
  console.log('\n🔍 Filtering to existing translations...');

  for (const [moduleName, ids] of Object.entries(moduleIds)) {
    const filtered = filterExistingIds(ids);
    const removedCount = ids.size - filtered.size;
    moduleIds[moduleName] = filtered;
    if (removedCount > 0) {
      console.log(`   ${moduleName}: removed ${removedCount} non-existent IDs`);
    }
  }

  // Step 5: Generate per-module, per-language files
  console.log('\n💾 Generating modular translation files...\n');

  const results = {};

  let totalDedupedIds = 0;

  for (const lang of LANGUAGES) {
    const sourceFileName = LANG_FILE_MAP[lang] || lang;
    const sourcePath = path.join(EXTRACTED_DATA_DIR, `I18nTextTable_${sourceFileName}.json`);

    if (!fs.existsSync(sourcePath)) {
      console.log(`   ⚠️  Skipping ${lang}: source file not found`);
      continue;
    }

    const sourceText = fs.readFileSync(sourcePath, 'utf8');
    const fullI18n = parseJSONWithBigInt(sourceText);
    const originalSize = fs.statSync(sourcePath).size;

    let langTotalSize = 0;
    let langTotalIds = 0;
    let langDedupedIds = 0;

    for (const [moduleName, ids] of Object.entries(moduleIds)) {
      const { foundCount, dedupedCount, size } = writeModuleTranslations(moduleName, ids, lang, fullI18n);
      langTotalSize += size;
      langTotalIds += foundCount;
      langDedupedIds += dedupedCount || 0;
    }

    totalDedupedIds += langDedupedIds;
    const reduction = ((1 - langTotalSize / originalSize) * 100).toFixed(1);
    const dedupInfo = dedupMap && langDedupedIds > 0 ? ` [${langDedupedIds} deduped]` : '';
    console.log(`   ${lang}: ${(originalSize / 1024 / 1024).toFixed(2)} MB → ${(langTotalSize / 1024).toFixed(0)} KB (${reduction}% ↓)${dedupInfo}`);

    results[lang] = {
      originalSize,
      optimizedSize: langTotalSize,
      reduction,
      dedupedIds: langDedupedIds,
    };
  }

  // Step 6: Generate manifest
  console.log('\n📋 Generating manifest...');

  const manifest = {
    version: 3,  // Bumped for dedup support
    generated: new Date().toISOString(),
    modules: Object.keys(MODULE_CONFIG),
    deduplication: dedupMap ? {
      enabled: true,
      totalDedupedIds: totalDedupedIds / LANGUAGES.length, // Per language average
    } : { enabled: false },
    stats: {},
  };

  for (const [moduleName, ids] of Object.entries(moduleIds)) {
    const moduleDir = path.join(OUTPUT_DIR, moduleName);
    const enFile = path.join(moduleDir, 'I18nTextTable_EN.json');
    const size = fs.existsSync(enFile) ? fs.statSync(enFile).size : 0;

    manifest.stats[moduleName] = {
      idCount: ids.size,
      sizeBytes: size,
      sizeKB: Math.round(size / 1024),
    };
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  // Summary
  console.log('\n📊 Module Summary:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let totalSize = 0;
  for (const [moduleName, stats] of Object.entries(manifest.stats)) {
    console.log(`${moduleName.padEnd(15)} ${stats.idCount.toString().padStart(5)} IDs   ${stats.sizeKB.toString().padStart(4)} KB`);
    totalSize += stats.sizeBytes;
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Total (EN):      ${Math.round(totalSize / 1024)} KB`);
  if (dedupMap) {
    console.log(`\n🔄 Deduplication: ${Math.round(totalDedupedIds / LANGUAGES.length)} duplicate IDs removed per language`);
  }
  console.log('\n✨ Modular i18n optimization complete!');
  console.log(`\nOutput: ${OUTPUT_DIR}/{module}/I18nTextTable_{lang}.json`);
}

// Run optimization
try {
  optimizeI18nModular();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
