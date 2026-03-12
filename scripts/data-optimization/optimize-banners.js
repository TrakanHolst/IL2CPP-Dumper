#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const JSONbigString = require('json-bigint')({ storeAsString: true });
const { loadDedupMap, getCanonicalId } = require('./i18n-dedup');

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
      if (key.endsWith('I18nId') || key === 'nameI18nId') {
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

/**
 * Banner Config Optimizer
 *
 * Generates banner_config.json from game data tables:
 * - GachaCharPoolTable.json (character banners)
 * - GachaCharPoolTypeTable.json (character pity rates)
 * - GachaWeaponPoolTable.json (weapon banners)
 * - GachaWeaponPoolTypeTable.json (weapon pity rates)
 *
 * Uses json-bigint to preserve large integer i18n IDs correctly.
 */

/**
 * JSON parser that preserves large numbers as strings
 */
function parseJSONWithBigInt(text) {
  return JSONbigString.parse(text);
}

function stringifyJSON(obj) {
  return JSON.stringify(obj, null, 2);
}

// Paths
const CHAR_POOL_PATH = path.join(__dirname, '../../extracted_data/TableCfg/GachaCharPoolTable.json');
const CHAR_POOL_TYPE_PATH = path.join(__dirname, '../../extracted_data/TableCfg/GachaCharPoolTypeTable.json');
const WEAPON_POOL_PATH = path.join(__dirname, '../../extracted_data/TableCfg/GachaWeaponPoolTable.json');
const WEAPON_POOL_TYPE_PATH = path.join(__dirname, '../../extracted_data/TableCfg/GachaWeaponPoolTypeTable.json');
const WEAPON_BASIC_PATH = path.join(__dirname, '../../extracted_data/TableCfg/WeaponBasicTable.json');
const OUTPUT_PATH = path.join(__dirname, '../../public/localdb/banner_config.json');

// Base URL for assets
const ASSET_BASE_URL = 'https://endfieldtools.dev/assets/images/endfield';

/**
 * Map type string to type ID
 */
const TYPE_STRING_TO_ID = {
  'Special': '0',
  'Beginner': '1',
  'Standard': '2'
};

/**
 * Get pity configuration based on pool type string
 */
function getCharacterPityConfig(typeString, poolTypeData) {
  const typeId = TYPE_STRING_TO_ID[typeString];
  const typeConfig = poolTypeData[typeId];

  if (!typeConfig) {
    // Default character pity
    return {
      maxPity: 80,
      softPity: 65,
      hardPity: 80
    };
  }

  // Type 1 = Beginner (New Horizon) - guaranteed at 40
  if (typeString === 'Beginner') {
    return {
      maxPity: typeConfig.maxPullCount || 40,
      softPity: null, // No soft pity for beginner
      hardPity: typeConfig.softGuarantee || 40
    };
  }

  // Type 0 = Special (limited), Type 2 = Standard
  return {
    maxPity: typeConfig.hardGuarantee || 80,
    softPity: 65, // Soft pity starts at 65 (hardcoded, ignore game data)
    hardPity: typeConfig.softGuarantee || 80
  };
}

/**
 * Get weapon pity configuration
 */
function getWeaponPityConfig(typeId, poolTypeData) {
  const typeConfig = poolTypeData[String(typeId)];
  if (!typeConfig) {
    // Default weapon pity
    return {
      maxPity: 80,
      softPity: 40,
      hardPity: 80
    };
  }

  return {
    maxPity: typeConfig.hardGuarantee || 80,
    softPity: typeConfig.softGuarantee || 40,
    hardPity: typeConfig.hardGuarantee || 80
  };
}

/**
 * Determine if a banner is limited based on pool ID
 */
function isLimitedBanner(poolId) {
  // Special banners (special_X_X_X) are limited
  // Weapon limited banners (weponbox_X_X_X) are limited
  return /^special_\d+_\d+_\d+$/.test(poolId) || /^weponbox_\d+_\d+_\d+$/.test(poolId);
}

/**
 * Generate character banner config
 */
function generateCharacterBannerConfig(poolId, poolData, poolTypeData) {
  const pityConfig = getCharacterPityConfig(poolData.type, poolTypeData);
  const isLimited = isLimitedBanner(poolId);
  const isBeginner = poolData.type === 'Beginner';
  const isStandard = poolData.type === 'Standard';
  const featuredCharId = poolData.upCharIds?.[0] || null;

  const config = {
    poolId: poolId,
    nameI18nId: poolData.name?.id ? String(poolData.name.id) : null,
    type: 'character',
    poolType: poolData.type,
    isLimited: isLimited,
    ...pityConfig,
    color: poolData.color ? `#${poolData.color}` : null,
    tabImage: poolData.tabImage || null,
    sortId: poolData.sortId || 0
  };

  // Add background image based on banner type
  if (isBeginner) {
    // Beginner banner (New Horizon) - fixed background
    config.backgroundImage = 'https://endfieldtools.dev/assets/images/gacha_guide/image2.webp';
  } else if (isStandard) {
    // Standard banner (Basic Headhunting) - fixed background
    config.backgroundImage = 'https://endfieldtools.dev/assets/images/gacha_guide/image4.webp';
  } else if (featuredCharId && isLimited) {
    // Limited banners use featured character's horizontal head icon
    config.backgroundImage = `${ASSET_BASE_URL}/charhorheadicon/${featuredCharId}.png`;
  }

  // Add beginner-specific fields
  if (isBeginner) {
    config.isGuaranteed = true;
    config.guaranteedAt = pityConfig.maxPity;
    config.guaranteedNote = `Guaranteed 6-star within ${pityConfig.maxPity} pulls`;
  }

  // Add featured character fields for limited banners
  if (featuredCharId) {
    config.featuredCharId = featuredCharId;
    config.featuredCharIcon = `${ASSET_BASE_URL}/charhorheadicon/${featuredCharId}.png`;
    config.hasFeaturedGuarantee = isLimited;
    if (isLimited) {
      config.featuredGuaranteeMax = 80;
    }
  }

  return config;
}

/**
 * Get banner phase number from limited weapon banner pool ID
 * e.g., "weponbox_1_0_3" -> 3
 */
function getBannerPhase(poolId) {
  const match = poolId.match(/^weponbox_\d+_\d+_(\d+)$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Convert number to Roman numeral
 */
function toRomanNumeral(num) {
  const romanNumerals = [
    { value: 10, numeral: 'X' },
    { value: 9, numeral: 'IX' },
    { value: 5, numeral: 'V' },
    { value: 4, numeral: 'IV' },
    { value: 1, numeral: 'I' }
  ];

  let result = '';
  for (const { value, numeral } of romanNumerals) {
    while (num >= value) {
      result += numeral;
      num -= value;
    }
  }
  return result;
}

/**
 * Generate weapon banner config
 */
function generateWeaponBannerConfig(poolId, poolData, poolTypeData, weaponBasicData) {
  const pityConfig = getWeaponPityConfig(poolData.type, poolTypeData);
  const isLimited = isLimitedBanner(poolId);
  const featuredWeaponId = poolData.upWeaponIds?.[0] || null;

  const config = {
    poolId: poolId,
    nameI18nId: poolData.name?.id ? String(poolData.name.id) : null,
    type: 'weapon',
    poolType: poolData.type,
    isLimited: isLimited,
    ...pityConfig,
    sortId: poolData.sortId || 0
  };

  // Add featured weapon fields
  if (featuredWeaponId) {
    config.featuredWeaponId = featuredWeaponId;
    config.featuredWeaponIcon = `${ASSET_BASE_URL}/itemicon/${featuredWeaponId}.png`;

    // Add weapon name i18n ID from WeaponBasicTable
    const weaponData = weaponBasicData[featuredWeaponId];
    if (weaponData && weaponData.engName?.id) {
      config.featuredWeaponNameI18nId = String(weaponData.engName.id);
    }

    if (isLimited) {
      config.hasFeaturedGuarantee = true;
      config.featuredGuaranteeMax = 80;
    }
  }

  // Add banner series i18n ID for all weapon banners
  // This allows the frontend to translate the full banner name (e.g., "Smelting Forge Issue")
  // and extract the series name (e.g., "Smelting Forge")
  if (config.nameI18nId) {
    config.bannerSeriesI18nId = config.nameI18nId;
  }

  // Add phase number for limited weapon banners (weponbox_X_X_X pattern)
  const bannerPhase = getBannerPhase(poolId);
  if (bannerPhase !== null) {
    config.bannerPhase = bannerPhase;
    config.bannerPhaseRoman = toRomanNumeral(bannerPhase);
  }

  return config;
}

/**
 * Main optimization function
 */
function optimizeBanners() {
  console.log('🎰 Starting banner config optimization...\n');

  // Load deduplication map for i18n IDs
  console.log('📖 Loading i18n deduplication map...');
  dedupMap = loadDedupMap();
  if (dedupMap) {
    console.log('   ✓ Dedup map loaded - i18n IDs will be deduplicated\n');
  } else {
    console.log('   ⚠ No dedup map found - run i18n-dedup.js first for optimal results\n');
  }

  // Check if source files exist
  const requiredFiles = [
    { path: CHAR_POOL_PATH, name: 'GachaCharPoolTable.json' },
    { path: CHAR_POOL_TYPE_PATH, name: 'GachaCharPoolTypeTable.json' },
    { path: WEAPON_POOL_PATH, name: 'GachaWeaponPoolTable.json' },
    { path: WEAPON_POOL_TYPE_PATH, name: 'GachaWeaponPoolTypeTable.json' },
    { path: WEAPON_BASIC_PATH, name: 'WeaponBasicTable.json' },
  ];

  for (const file of requiredFiles) {
    if (!fs.existsSync(file.path)) {
      console.error(`❌ Error: ${file.name} not found at ${file.path}`);
      process.exit(1);
    }
  }

  // Read source data
  console.log('📖 Reading source data...');
  const charPoolData = parseJSONWithBigInt(fs.readFileSync(CHAR_POOL_PATH, 'utf8'));
  const charPoolTypeData = parseJSONWithBigInt(fs.readFileSync(CHAR_POOL_TYPE_PATH, 'utf8'));
  const weaponPoolData = parseJSONWithBigInt(fs.readFileSync(WEAPON_POOL_PATH, 'utf8'));
  const weaponPoolTypeData = parseJSONWithBigInt(fs.readFileSync(WEAPON_POOL_TYPE_PATH, 'utf8'));
  const weaponBasicData = parseJSONWithBigInt(fs.readFileSync(WEAPON_BASIC_PATH, 'utf8'));

  // Build banner config
  const banners = {};
  let charCount = 0;
  let weaponCount = 0;

  // Process character banners
  console.log('⚙️  Processing character banners...');
  for (const [poolId, poolData] of Object.entries(charPoolData)) {
    banners[poolId] = generateCharacterBannerConfig(poolId, poolData, charPoolTypeData);
    charCount++;
  }

  // Process weapon banners
  console.log('⚙️  Processing weapon banners...');
  for (const [poolId, poolData] of Object.entries(weaponPoolData)) {
    banners[poolId] = generateWeaponBannerConfig(poolId, poolData, weaponPoolTypeData, weaponBasicData);
    weaponCount++;
  }

  // Build defaults config
  const defaults = {
    character: {
      maxPity: 80,
      softPity: 65, // Character soft pity starts at 65
      hardPity: 80
    },
    weapon: {
      maxPity: 80,
      softPity: 40, // Weapon soft pwaity (50/50) at 40
      hardPity: 80
    },
    beginner: {
      maxPity: 40,
      softPity: null, // Beginner has no soft pity (guaranteed)
      hardPity: 40
    }
  };

  // Build pool type mapping for API
  const poolTypes = {
    character: {
      standard: 'E_CharacterGachaPoolType_Standard',
      special: 'E_CharacterGachaPoolType_Special',
      beginner: 'E_CharacterGachaPoolType_Beginner'
    },
    weapon: {
      // Game only has one weapon pool type (0) for all weapon banners
      constant: 'E_WeaponGachaPoolType_Constant'
    }
  };

  // Build pool ID patterns for categorization
  const poolIdPatterns = {
    standard: '^standard$',
    special: '^special_\\d+_\\d+_\\d+$',
    beginner: '^beginner$',
    weaponConstant: '^weaponbox_constant_\\d+$',
    weaponLimited: '^weponbox_\\d+_\\d+_\\d+$'
  };

  // Final output
  const output = {
    _generated: new Date().toISOString(),
    _source: 'Generated from GachaCharPoolTable.json, GachaWeaponPoolTable.json, and pool type tables',
    banners,
    defaults,
    poolTypes,
    poolIdPatterns
  };

  // Deduplicate i18n IDs
  const dedupedOutput = deduplicateI18nIds(output);

  // Write output
  console.log('💾 Writing banner_config.json...');
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dedupedOutput, null, 2), 'utf8');

  const outputSize = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(2);

  console.log(`\n📊 Optimization Summary:`);
  console.log(`   Character banners: ${charCount}`);
  console.log(`   Weapon banners:    ${weaponCount}`);
  console.log(`   Total banners:     ${charCount + weaponCount}`);
  console.log(`   Output size:       ${outputSize} KB`);
  console.log(`   Output path:       ${OUTPUT_PATH}`);
  console.log('\n✨ Banner config optimization complete!');
}

// Run optimization
try {
  optimizeBanners();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
