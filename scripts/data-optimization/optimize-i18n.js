#!/usr/bin/env node

/**
 * I18N TRANSLATIONS OPTIMIZER
 * 
 * This script optimizes i18n translation files by:
 * 1. Scanning all optimized data files for i18n ID references
 * 2. Extracting only used translations from full i18n files
 * 3. Creating optimized i18n files with only needed translations
 * 
 * Source: extracted_data/TableCfg/I18nTextTable_*.json
 * Output: public/localdb/optimized/i18n/
 */

const fs = require('fs');
const path = require('path');
const JSONbigString = require('json-bigint')({ storeAsString: true });

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

// Paths
const EXTRACTED_DATA_DIR = path.join(__dirname, '../../extracted_data/TableCfg');
const OPTIMIZED_DATA_DIR = path.join(__dirname, '../../public/localdb/optimized');
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/i18n');

// Language codes
// Note: BR (Brazilian Portuguese) maps to PT, VN (Vietnamese) maps to VI in the application
const LANGUAGES = ['EN', 'CN', 'TC', 'JP', 'KR', 'RU', 'MX', 'FR', 'PT', 'DE', 'ID', 'VI', 'TH', 'IT'];

// Mapping from application language codes to extracted data file names
const LANG_FILE_MAP = {
  'PT': 'BR',  // Application uses PT, extracted data uses BR
  'VI': 'VN',  // Application uses VI, extracted data uses VN
  // All other languages use the same code
};

/**
 * Scan a single file for i18n IDs
 */
function scanFileForI18nIds(filePath, usedIds) {
  if (!fs.existsSync(filePath)) return 0;

  const content = fs.readFileSync(filePath, 'utf8');
  let foundCount = 0;

  // Find all i18n ID patterns (large numbers as strings)
  // Matches: "nameI18nId": "123456789012345", "descriptionI18nId": "123456789012345"
  // Also matches combat mechanics patterns: "titleI18nId", "shortDescI18nId"
  // Also matches banner config patterns: "featuredWeaponNameI18nId", "featuredCharNameI18nId"
  // Also matches essence data patterns: "enemyNameI18nId"
  const idMatches = content.matchAll(/"(?:name|desc|title|recordTitle|recordDesc|voiceTitle|voiceDesc|formulaDesc|decoDesc|noObtainWayHint|description|shortDesc|featuredWeaponName|featuredCharName|enemyName)I18nId"\s*:\s*"([^"]+)"/g);
  for (const match of idMatches) {
    if (!usedIds.has(match[1])) {
      usedIds.add(match[1]);
      foundCount++;
    }
  }

  // Also check for nested id fields in name/desc objects
  // Matches: "name": { "id": "123456789012345" }
  // Also matches effectData nested objects: "effectData": { "desc": { "id": "123..." } }
  const nestedIdMatches = content.matchAll(/"(?:name|desc|title|recordTitle|recordDesc|voiceTitle|voiceDesc|formulaDesc|decoDesc|noObtainWayHint|description)"\s*:\s*\{\s*"id"\s*:\s*"([^"]+)"/g);
  for (const match of nestedIdMatches) {
    if (!usedIds.has(match[1])) {
      usedIds.add(match[1]);
      foundCount++;
    }
  }

  // Check for plain "id" fields that might be i18n references (large numbers, including negative)
  // Match both string format: "id": "123456789012345"
  const plainIdStringMatches = content.matchAll(/"id"\s*:\s*"(-?\d{15,})"/g);
  for (const match of plainIdStringMatches) {
    if (!usedIds.has(match[1])) {
      usedIds.add(match[1]);
      foundCount++;
    }
  }

  // AND numeric format: "id": 123456789012345 or "id": -123456789012345
  const plainIdNumericMatches = content.matchAll(/"id"\s*:\s*(-?\d{15,})/g);
  for (const match of plainIdNumericMatches) {
    const idStr = match[1];
    if (!usedIds.has(idStr)) {
      usedIds.add(idStr);
      foundCount++;
    }
  }

  // SPECIAL: Extract i18n IDs from map config objects (oreClusterI18nIds, spcstoneI18nIds, recyclingI18nId)
  // Match patterns like: "int_doodad_spcstone_1_1": "646027396636393684"
  const mapConfigObjectIdMatches = content.matchAll(/"int_doodad_[^"]+"\s*:\s*"(-?\d{15,})"/g);
  for (const match of mapConfigObjectIdMatches) {
    const idStr = match[1];
    if (!usedIds.has(idStr)) {
      usedIds.add(idStr);
      foundCount++;
    }
  }

  // Also match single ID values like: "recyclingI18nId": "123456...", "tpPointI18nId": "...", "etherShardI18nId": "..."
  const mapConfigSingleIdMatches = content.matchAll(/"(?:recycling|tpPoint|etherShard)I18nId"\s*:\s*"(-?\d{15,})"/g);
  for (const match of mapConfigSingleIdMatches) {
    const idStr = match[1];
    if (!usedIds.has(idStr)) {
      usedIds.add(idStr);
      foundCount++;
    }
  }

  // SPECIAL: Extract map name i18n IDs from mapNameI18nIds object
  // Match patterns like: "map01": "-8543902156289905334"
  const mapNameI18nIdMatches = content.matchAll(/"map\d+"\s*:\s*"(-?\d{15,})"/g);
  for (const match of mapNameI18nIdMatches) {
    const idStr = match[1];
    if (!usedIds.has(idStr)) {
      usedIds.add(idStr);
      foundCount++;
    }
  }

  // SPECIAL: Extract zone name i18n IDs from zoneNameI18nIds object
  // Match patterns like: "map01_lv001": "7662556729362592955"
  const zoneNameI18nIdMatches = content.matchAll(/"map\d+_lv\d+"\s*:\s*"(-?\d{15,})"/g);
  for (const match of zoneNameI18nIdMatches) {
    const idStr = match[1];
    if (!usedIds.has(idStr)) {
      usedIds.add(idStr);
      foundCount++;
    }
  }

  // SPECIAL: Extract sub-zone location i18n IDs from subZoneLocationI18nIds arrays
  // Match patterns like: "map01_lv001": ["50264664946127127", "4295158047967067610", ...]
  const subZoneLevelMatches = content.matchAll(/"map\d+_lv\d+"\s*:\s*\[([\s\S]*?)\]/g);
  for (const match of subZoneLevelMatches) {
    const arrayContent = match[1];
    // Extract all quoted numbers from the array
    const idArrayMatches = arrayContent.matchAll(/"(-?\d{15,})"/g);
    for (const idMatch of idArrayMatches) {
      const idStr = idMatch[1];
      if (!usedIds.has(idStr)) {
        usedIds.add(idStr);
        foundCount++;
      }
    }
  }

  // SPECIAL: Extract i18n IDs from combat mechanics detailedDescI18nIds arrays
  // Match patterns like: "detailedDescI18nIds": ["-7660293067543779546", "4198462965873896262"]
  const detailedDescIdsMatches = content.matchAll(/"detailedDescI18nIds"\s*:\s*\[([\s\S]*?)\]/g);
  for (const match of detailedDescIdsMatches) {
    const arrayContent = match[1];
    // Extract all quoted numbers from the array
    const idArrayMatches = arrayContent.matchAll(/"(-?\d{15,})"/g);
    for (const idMatch of idArrayMatches) {
      const idStr = idMatch[1];
      if (!usedIds.has(idStr)) {
        usedIds.add(idStr);
        foundCount++;
      }
    }
  }

  // SPECIAL: Extract i18n IDs from achievement levelDescI18nIds and similar arrays
  // Match patterns like: "levelDescI18nIds": ["8724881275565959844", "-5200501546158733240"]
  const levelDescIdsMatches = content.matchAll(/"levelDescI18nIds"\s*:\s*\[([\s\S]*?)\]/g);
  for (const match of levelDescIdsMatches) {
    const arrayContent = match[1];
    const idArrayMatches = arrayContent.matchAll(/"(-?\d{15,})"/g);
    for (const idMatch of idArrayMatches) {
      const idStr = idMatch[1];
      if (!usedIds.has(idStr)) {
        usedIds.add(idStr);
        foundCount++;
      }
    }
  }

  // SPECIAL: Extract i18n IDs from achievement conditionDescI18nIds nested arrays
  // Match patterns like: "conditionDescI18nIds": [["-3866210126654692700"], ["-2804237479374794253"]]
  const conditionDescIdsMatches = content.matchAll(/"conditionDescI18nIds"\s*:\s*\[([\s\S]*?)\]\]/g);
  for (const match of conditionDescIdsMatches) {
    const arrayContent = match[1] + ']'; // Add back the last bracket
    // Extract all quoted numbers from nested arrays
    const idArrayMatches = arrayContent.matchAll(/"(-?\d{15,})"/g);
    for (const idMatch of idArrayMatches) {
      const idStr = idMatch[1];
      if (!usedIds.has(idStr)) {
        usedIds.add(idStr);
        foundCount++;
      }
    }
  }

  return foundCount;
}

/**
 * Extract all i18n ID references from ALL data files used by the website
 */
function extractUsedI18nIds() {
  const usedIds = new Set();
  const LOCALDB_DIR = path.join(__dirname, '../../public/localdb');

  console.log('📖 Scanning ALL data files for i18n IDs...\n');

  // 1. Scan optimized list files (characters, weapons, equipment, equipment suits, factory, map, guides, essences, items)
  console.log('Scanning optimized list files:');
  const listFiles = [
    'characters/characters-list.json',
    'weapons/weapons-list.json',
    'equipment/equipment-list.json',
    'equipment/suits/suits-list.json',  // Equipment sets list
    'items/items-list.json',  // Ascension planner items (materials, EXP items)
    'factory/factory-data.json',  // Factory loads all data at once
    'factory/buildings-list.json',  // Factory buildings with description i18n IDs
    'map/map-data.json',  // Map data with POIs, enemies, etc. (combined)
    'map/map01-data.json',  // Valley IV map data
    'map/map02-data.json',  // Talos-II map data
    // Guide data files
    'guides/essences-guide-data.json',  // Essences guide with stat term translations
    'guides/artificing-guide-data.json',  // Artificing guide data
    // Essences database
    'essences/essences-database.json',  // Full essences database
    // Achievement tracker
    'achievements/achievements-list.json',  // Achievement list with i18n IDs
    'achievements/achievements-types.json',  // Achievement categories with i18n IDs
    // Combat mechanics (for tooltips)
    'combat/combat-mechanics.json',  // Combat mechanics wiki data for tooltips
  ];

  listFiles.forEach(file => {
    const filePath = path.join(OPTIMIZED_DATA_DIR, file);
    const count = scanFileForI18nIds(filePath, usedIds);
    if (count > 0) {
      console.log(`   ✓ ${file} - ${count} IDs`);
    }
  });

  // 2. Scan individual detail files (characters, weapons, equipment, equipment suits)
  console.log('\nScanning individual detail files:');
  const detailCategories = [
    'characters',
    'weapons',
    'equipment',
    'equipment/suits'  // Equipment sets details
  ];
  detailCategories.forEach(category => {
    const detailsDir = path.join(OPTIMIZED_DATA_DIR, category, 'details');
    if (!fs.existsSync(detailsDir)) return;

    const detailFiles = fs.readdirSync(detailsDir).filter(f => f.endsWith('.json'));
    let categoryCount = 0;

    detailFiles.forEach(file => {
      const filePath = path.join(detailsDir, file);
      categoryCount += scanFileForI18nIds(filePath, usedIds);
    });

    if (categoryCount > 0) {
      console.log(`   ✓ ${category}/details/ - ${categoryCount} IDs from ${detailFiles.length} files`);
    }
  });

  // 3. Scan banner config for weapon/character name i18n IDs
  console.log('\nScanning banner config:');
  const bannerConfigPath = path.join(LOCALDB_DIR, 'banner_config.json');
  const bannerConfigCount = scanFileForI18nIds(bannerConfigPath, usedIds);
  if (bannerConfigCount > 0) {
    console.log(`   ✓ banner_config.json - ${bannerConfigCount} IDs`);
  }

  // 4. Scan skill and progression data files (loaded separately, NOT optimized)
  console.log('\nScanning skill & progression data files:');
  const dataFiles = [
    'CharGrowthTable.json'  // Character talents/progression (still loaded separately)
    // NOTE: The following files are now EMBEDDED in optimized files and no longer loaded separately:
    // - SkillPatchTable.json → Embedded in equipment/suits/details/*.json
    // - PotentialTalentEffectTable.json → Embedded in characters/details/*.json
    // - SpaceshipCharSkillTable.json → Embedded in characters/details/*.json
    // - SpaceshipSkillTable.json → Embedded in characters/details/*.json
    // - EquipSuitTable.json → Replaced by equipment/suits/suits-list.json and equipment/suits/details/*.json
    //
    // NOTE: Also optimized into list/detail files:
    // - CharacterTable.json → characters/characters-list.json + characters/details/*.json
    // - WeaponBasicTable.json → weapons/weapons-list.json + weapons/details/*.json
    // - EquipTable.json → equipment/equipment-list.json + equipment/details/*.json
    // - Factory data → factory/factory-data.json
  ];

  dataFiles.forEach(file => {
    const filePath = path.join(LOCALDB_DIR, 'endfield_data', file);
    const count = scanFileForI18nIds(filePath, usedIds);
    if (count > 0) {
      console.log(`   ✓ ${file} - ${count} IDs`);
    }
  });

  // 5. Scan individual skill files (if any remain separate)
  console.log('\nScanning individual skill files:');
  const skillsDir = path.join(LOCALDB_DIR, 'endfield_data', 'skills');
  if (fs.existsSync(skillsDir)) {
    const skillFiles = fs.readdirSync(skillsDir).filter(f => f.endsWith('.json'));
    let skillCount = 0;
    skillFiles.forEach(file => {
      const filePath = path.join(skillsDir, file);
      skillCount += scanFileForI18nIds(filePath, usedIds);
    });
    if (skillCount > 0) {
      console.log(`   ✓ skills/ - ${skillCount} IDs from ${skillFiles.length} files`);
    }
  }

  console.log(`\n✅ Found ${usedIds.size} unique i18n IDs in use across all data files\n`);

  // Add hardcoded i18n IDs used in frontend code (characterLoader.ts, etc.)
  // These are not in optimized data files but are referenced directly in code
  console.log('Adding hardcoded i18n IDs from frontend code:');

  // Element types (from CharTypeTable.json via characterLoader.ts)
  const elementTypeIds = [
    '-1566258159335749645',  // Physical
    '-7830608904178817136',  // Heat (Fire)
    '-6369055508956636388',  // Cryo (Cryst)
    '-474170932806761396',   // Nature (Natural)
    '-2170293331777838058',  // Electric (Pulse)
  ];

  // Profession types (from CharProfessionTable.json via characterLoader.ts)
  const professionIds = [
    '-6083717892122630775',  // Guard
    '4676145990391874054',   // Defender
    '1423215062502662901',   // Support
    '-6440713593686885024',  // Caster
    '5237214783525020128',   // Vanguard
    '6617530151449191683',   // Striker
  ];

  // Weapon types (from I18nTextTable via characterLoader.ts)
  const weaponTypeIds = [
    '-7916605382497395047',  // Sword
    '5183277241087333572',   // Arts Unit
    '-8432726716700837576',  // Greatsword
    '5207518553034523032',   // Polearm
    '-6369535528173739273',  // Handcannon
  ];

  // Attribute names (from AttributeShowConfigTable.json for character stats display)
  // These are the name.id values from each attribute type's display config
  const attributeNameIds = [
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
    // Additional attribute names from AttributeShowConfigTable
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
  ];

  let hardcodedCount = 0;
  [...elementTypeIds, ...professionIds, ...weaponTypeIds, ...attributeNameIds].forEach(id => {
    if (!usedIds.has(id)) {
      usedIds.add(id);
      hardcodedCount++;
    }
  });
  console.log(`   ✓ Added ${hardcodedCount} hardcoded IDs (elements, professions, weapons, attributes)\n`);

  return usedIds;
}

/**
 * Optimize a single language's i18n file
 */
function optimizeLanguage(lang, usedIds) {
  // Map application language code to extracted data file name
  const sourceFileName = LANG_FILE_MAP[lang] || lang;
  const sourcePath = path.join(EXTRACTED_DATA_DIR, `I18nTextTable_${sourceFileName}.json`);

  // Output file uses the application language code (e.g., PT not BR)
  const outputPath = path.join(OUTPUT_DIR, `I18nTextTable_${lang}.json`);

  if (!fs.existsSync(sourcePath)) {
    console.log(`   ⚠️  Source file not found: I18nTextTable_${lang}.json`);
    return { found: 0, total: 0 };
  }

  console.log(`📖 Reading I18nTextTable_${lang}.json...`);
  const sourceText = fs.readFileSync(sourcePath, 'utf8');
  const sourceData = parseJSONWithBigInt(sourceText);

  const optimizedData = {};
  let foundCount = 0;
  const totalIds = Object.keys(sourceData).length;

  // Extract only used translations
  usedIds.forEach(id => {
    if (sourceData[id] !== undefined) {
      optimizedData[id] = sourceData[id];
      foundCount++;
    }
  });

  // Write optimized file (MINIFIED - no pretty-printing)
  const outputJson = stringifyJSONWithBigInt(optimizedData);
  fs.writeFileSync(outputPath, outputJson, 'utf8');
  
  const originalSize = (fs.statSync(sourcePath).size / 1024 / 1024).toFixed(2);
  const optimizedSize = (fs.statSync(outputPath).size / 1024).toFixed(2);
  const reduction = ((1 - (fs.statSync(outputPath).size / fs.statSync(sourcePath).size)) * 100).toFixed(1);
  
  console.log(`   ✓ ${lang}: ${foundCount}/${usedIds.size} translations found`);
  console.log(`   ✓ Size: ${originalSize} MB → ${optimizedSize} KB (${reduction}% reduction)\n`);
  
  return { found: foundCount, total: totalIds, originalSize, optimizedSize, reduction };
}

/**
 * Filter IDs to only include those that exist in at least one translation file
 */
function filterExistingIds(usedIds) {
  console.log('🔍 Filtering IDs to only include those with translations...\n');

  // Load English i18n to check which IDs actually exist
  const enPath = path.join(EXTRACTED_DATA_DIR, 'I18nTextTable_EN.json');
  if (!fs.existsSync(enPath)) {
    console.warn('⚠️  English i18n file not found, skipping filter');
    return usedIds;
  }

  const enText = fs.readFileSync(enPath, 'utf8');
  const enData = parseJSONWithBigInt(enText);
  const enKeys = new Set(Object.keys(enData));

  // Filter to only IDs that exist in English translation file
  const filteredIds = new Set();
  let removedCount = 0;

  usedIds.forEach(id => {
    if (enKeys.has(id)) {
      filteredIds.add(id);
    } else {
      removedCount++;
    }
  });

  console.log(`   ✓ Kept ${filteredIds.size} IDs with translations`);
  console.log(`   ✓ Removed ${removedCount} IDs without translations (deprecated/unused)\n`);

  return filteredIds;
}

/**
 * Main optimization function
 */
function optimizeI18nTranslations() {
  console.log('🔧 Starting i18n translation optimization...\n');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Step 1: Extract used i18n IDs
  let usedIds = extractUsedI18nIds();

  if (usedIds.size === 0) {
    console.log('⚠️  No i18n IDs found in optimized data. Make sure data files are generated first.');
    process.exit(1);
  }

  // Step 2: Filter to only IDs that actually have translations
  usedIds = filterExistingIds(usedIds);

  // Step 3: Optimize each language
  console.log('💾 Optimizing translation files...\n');
  
  const results = {};
  let totalOriginalSize = 0;
  let totalOptimizedSize = 0;
  
  LANGUAGES.forEach(lang => {
    const result = optimizeLanguage(lang, usedIds);
    results[lang] = result;
    
    if (result.originalSize) {
      totalOriginalSize += parseFloat(result.originalSize);
      totalOptimizedSize += parseFloat(result.optimizedSize) / 1024; // Convert KB to MB
    }
  });
  
  // Summary
  console.log('📊 Optimization Summary:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  LANGUAGES.forEach(lang => {
    const result = results[lang];
    if (result.originalSize) {
      console.log(`${lang}: ${result.originalSize} MB → ${result.optimizedSize} KB (${result.reduction}% ↓)`);
    }
  });
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Total: ${totalOriginalSize.toFixed(2)} MB → ${(totalOptimizedSize * 1024).toFixed(2)} KB`);
  console.log(`Overall reduction: ${((1 - totalOptimizedSize / totalOriginalSize) * 100).toFixed(1)}%`);
  console.log('\n✨ I18n translation optimization complete!');
}

// Run optimization
try {
  optimizeI18nTranslations();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
