#!/usr/bin/env node

/**
 * ESSENCES (GEMS) DATA OPTIMIZER FOR GUIDE PAGE
 *
 * This script optimizes essence/gem data for the Essences Guide page.
 * It extracts and consolidates data from multiple game tables.
 *
 * Source Files:
 * - GemTable.json - Stat term definitions
 * - GemEnhanceTable.json - Enhancement costs & success rates
 * - GemTagIdTable.json - Tag to term mapping
 * - WorldEnergyPointGroupTable.json - Dungeon stat pools
 * - GemDismantleTable.json - Dismantle values
 * - GemConst.json - Enhancement constants
 *
 * Output: public/localdb/optimized/guides/essences-guide-data.json
 */

const fs = require('fs');
const path = require('path');

// Use json-bigint if available, otherwise use custom parser
let JSONbigString;
try {
  JSONbigString = require('json-bigint')({ storeAsString: true });
} catch (e) {
  // Fallback: custom parser that converts large numbers to strings
  JSONbigString = {
    parse: (text) => {
      const fixedText = text.replace(
        /"(id|nameI18nId|descI18nId|tagName)"\s*:\s*{\s*"id"\s*:\s*(-?\d{15,})/g,
        (match, field, number) => match.replace(number, `"${number}"`)
      );
      return JSON.parse(fixedText);
    },
    stringify: (obj, replacer, space) => JSON.stringify(obj, replacer, space)
  };
}

// Paths
const EXTRACTED_DATA = path.join(__dirname, '../../extracted_data/TableCfg');
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/guides');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'essences-guide-data.json');

/**
 * Safely read and parse JSON file
 */
function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`   Warning: File not found: ${path.basename(filePath)}`);
      return null;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    return JSONbigString.parse(text);
  } catch (error) {
    console.error(`   Error reading ${path.basename(filePath)}:`, error.message);
    return null;
  }
}

/**
 * Extract i18n ID from nested object
 */
function extractI18nId(obj) {
  if (!obj) return null;
  if (typeof obj === 'string' || typeof obj === 'number') return String(obj);
  if (obj.id !== undefined) return String(obj.id);
  return null;
}

/**
 * Main optimization function
 */
function optimizeEssencesGuideData() {
  console.log('🔧 Starting Essences Guide data optimization...\n');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      version: '1.0.0'
    },
    constants: {},
    statTerms: [],
    enhancementRates: [],
    dungeonGroups: [],
    essenceTypes: [],
    dismantleValues: {}
  };

  // 1. Load GemConst.json - Enhancement constants
  console.log('📖 Loading GemConst.json...');
  const gemConst = readJsonFile(path.join(EXTRACTED_DATA, 'GemConst.json'));
  if (gemConst) {
    output.constants = {
      enhanceCostGemRarity: gemConst.enhanceCostGemRarity || 5,
      enhancementItemId: gemConst.gemEnhancementItemId || 'item_wpngem_enhance_dust',
      enhancementItemRefundNum: gemConst.gemEnhancementItemRefundNum || 10
    };
    console.log('   ✓ Constants loaded');
  }

  // 2. Load GemTable.json - Stat term definitions
  console.log('📖 Loading GemTable.json...');
  const gemTable = readJsonFile(path.join(EXTRACTED_DATA, 'GemTable.json'));
  if (gemTable) {
    output.statTerms = Object.values(gemTable).map(term => ({
      termId: term.gemTermId,
      tagId: term.tagId,
      nameI18nId: extractI18nId(term.tagName),
      isSkillTerm: term.isSkillTerm || false,
      termType: term.termType, // 0=attribute, 1=stat, 2=skill
      sortOrder: term.sortOrder,
      tagIcon: term.tagIcon || null
    })).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    console.log(`   ✓ Loaded ${output.statTerms.length} stat terms`);
  }

  // 3. Load GemEnhanceTable.json - Enhancement costs & rates
  console.log('📖 Loading GemEnhanceTable.json...');
  const gemEnhance = readJsonFile(path.join(EXTRACTED_DATA, 'GemEnhanceTable.json'));
  if (gemEnhance) {
    output.enhancementRates = Object.entries(gemEnhance).map(([rarity, data]) => ({
      rarity: parseInt(rarity),
      levels: (data.list || []).map((level, index) => ({
        level: index + 2, // Levels start at 2
        costEnhancementItem: level.costEnhancementItem,
        successRate: level.successProbality / 10, // Convert to percentage
        termCost: level.termCost
      }))
    }));
    console.log(`   ✓ Loaded enhancement rates for ${output.enhancementRates.length} rarity levels`);
  }

  // 4. Load EnemyTemplateDisplayInfoTable.json - Enemy names for dungeon icons
  console.log('📖 Loading EnemyTemplateDisplayInfoTable.json...');
  const enemyDisplayInfo = readJsonFile(path.join(EXTRACTED_DATA, 'EnemyTemplateDisplayInfoTable.json'));
  const enemyNameMap = {};
  if (enemyDisplayInfo) {
    Object.entries(enemyDisplayInfo).forEach(([enemyId, data]) => {
      if (data.name && data.name.id) {
        enemyNameMap[enemyId] = extractI18nId(data.name);
      }
    });
    console.log(`   ✓ Loaded ${Object.keys(enemyNameMap).length} enemy names`);
  }

  // 5. Load WorldEnergyPointGroupTable.json - Dungeon stat pools
  console.log('📖 Loading WorldEnergyPointGroupTable.json...');
  const dungeonGroups = readJsonFile(path.join(EXTRACTED_DATA, 'WorldEnergyPointGroupTable.json'));
  if (dungeonGroups) {
    output.dungeonGroups = Object.values(dungeonGroups).map(group => {
      // Look up the enemy name from the icon ID
      const enemyNameI18nId = enemyNameMap[group.icon] || null;

      return {
        groupId: group.gameGroupId,
        nameI18nId: extractI18nId(group.gameGroupName),
        enemyNameI18nId: enemyNameI18nId, // Add enemy name for display
        icon: group.icon,
        preEngravingPermitId: group.gemCustomItemId,
        primaryAttributes: group.primAttrTermIds || [],
        secondaryAttributes: group.secAttrTermIds || [],
        skillStats: group.skillTermIds || [],
        worldLevels: Object.keys(group.worldLevel2GameMechanicsIdMap || {}).map(Number).sort((a, b) => a - b)
      };
    });
    console.log(`   ✓ Loaded ${output.dungeonGroups.length} dungeon groups`);
  }

  // 5. Load GemDismantleTable.json - Dismantle values
  console.log('📖 Loading GemDismantleTable.json...');
  const dismantleTable = readJsonFile(path.join(EXTRACTED_DATA, 'GemDismantleTable.json'));
  if (dismantleTable) {
    output.dismantleValues = {};
    Object.entries(dismantleTable).forEach(([rarity, data]) => {
      output.dismantleValues[rarity] = {};
      if (data.list) {
        Object.entries(data.list).forEach(([domainId, domainData]) => {
          output.dismantleValues[rarity][domainId] = {
            currencyId: domainData.goldId,
            amount: domainData.goldNum,
            enhanceDustId: domainData.itemId,
            enhanceDustAmount: domainData.itemNum
          };
        });
      }
    });
    console.log(`   ✓ Loaded dismantle values`);
  }

  // 6. Define preset essence types (from WorldEnergyPointTable patterns)
  console.log('📖 Defining preset essence types...');
  output.essenceTypes = [
    { id: 'item_preset_gem_5', type: 'base', rarity: 5, nameKey: 'base' },
    { id: 'item_preset_gem_5_force', type: 'force', rarity: 5, nameKey: 'force' },
    { id: 'item_preset_gem_5_tactic', type: 'tactic', rarity: 5, nameKey: 'tactic' },
    { id: 'item_preset_gem_5_combo', type: 'combo', rarity: 5, nameKey: 'combo' },
    { id: 'item_preset_gem_5_smash', type: 'smash', rarity: 5, nameKey: 'smash' },
    { id: 'item_preset_gem_5_phyabn', type: 'phyabn', rarity: 5, nameKey: 'physical_abnormal' },
    { id: 'item_preset_gem_5_magabn', type: 'magabn', rarity: 5, nameKey: 'magical_abnormal' },
    { id: 'item_preset_gem_5_burst', type: 'burst', rarity: 5, nameKey: 'burst' },
    { id: 'item_preset_gem_5_tacafter', type: 'tacafter', rarity: 5, nameKey: 'tactic_after' },
    { id: 'item_preset_gem_5_crit', type: 'crit', rarity: 5, nameKey: 'critical' },
    { id: 'item_preset_gem_5_keyword', type: 'keyword', rarity: 5, nameKey: 'keyword' },
    { id: 'item_preset_gem_5_spirit', type: 'spirit', rarity: 5, nameKey: 'spirit' },
    { id: 'item_preset_gem_5_heal', type: 'heal', rarity: 5, nameKey: 'heal' }
  ];
  console.log(`   ✓ Defined ${output.essenceTypes.length} essence types`);

  // Write output file
  console.log('\n💾 Writing optimized data...');
  const outputJson = JSON.stringify(output, null, 2);
  fs.writeFileSync(OUTPUT_FILE, outputJson, 'utf8');

  const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2);
  console.log(`   ✓ Output: ${OUTPUT_FILE}`);
  console.log(`   ✓ Size: ${fileSize} KB`);

  console.log('\n✨ Essences Guide data optimization complete!');

  return output;
}

// Run optimization
try {
  optimizeEssencesGuideData();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
