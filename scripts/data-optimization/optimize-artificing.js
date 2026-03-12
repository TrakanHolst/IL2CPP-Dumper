#!/usr/bin/env node

/**
 * ARTIFICING DATA OPTIMIZER FOR GUIDE PAGE
 *
 * This script optimizes equipment artificing data for the Artificing Guide page.
 * It uses already optimized equipment/suits data where available.
 *
 * Source Files:
 * - EquipConst.json - Enhancement limits
 * - EquipEnhanceCostTable.json - Artificing costs
 * - EquipTechConst.json - Tech constants
 *
 * Existing Optimized Data (reused):
 * - public/localdb/optimized/equipment/suits/suits-list.json
 *
 * Output: public/localdb/optimized/guides/artificing-guide-data.json
 */

const fs = require('fs');
const path = require('path');

// Use json-bigint if available, otherwise use custom parser
let JSONbigString;
try {
  JSONbigString = require('json-bigint')({ storeAsString: true });
} catch (e) {
  // Fallback parser
  JSONbigString = {
    parse: (text) => {
      const fixedText = text.replace(
        /:\s*(-?\d{15,})/g,
        (match, number) => `: "${number}"`
      );
      return JSON.parse(fixedText);
    },
    stringify: (obj, replacer, space) => JSON.stringify(obj, replacer, space)
  };
}

// Paths
const EXTRACTED_DATA = path.join(__dirname, '../../extracted_data/TableCfg');
const OPTIMIZED_EQUIPMENT = path.join(__dirname, '../../public/localdb/optimized/equipment');
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/guides');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'artificing-guide-data.json');

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
 * Main optimization function
 */
function optimizeArtificingGuideData() {
  console.log('🔧 Starting Artificing Guide data optimization...\n');

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
    enhanceCosts: [],
    techConstants: {},
    partTypes: {
      0: { id: 0, nameKey: 'body', engName: 'Body Armor' },
      1: { id: 1, nameKey: 'hand', engName: 'Gloves' },
      2: { id: 2, nameKey: 'edc', engName: 'Accessory (EDC)' }
    },
    tiers: {
      0: { tier: 0, nameKey: 't0', engName: 'Tier 0 - Starter', canArtifice: false },
      1: { tier: 1, nameKey: 't1', engName: 'Tier 1 - Basic', canArtifice: false },
      2: { tier: 2, nameKey: 't2', engName: 'Tier 2 - Intermediate', canArtifice: false },
      3: { tier: 3, nameKey: 't3', engName: 'Tier 3 - Advanced', canArtifice: false },
      4: { tier: 4, nameKey: 't4', engName: 'Tier 4 - Gold Quality', canArtifice: true }
    },
    domains: {
      domain_1: { id: 'domain_1', nameKey: 'tundra', engName: 'Tundra' },
      domain_2: { id: 'domain_2', nameKey: 'wuling', engName: 'Wuling' }
    },
    suits: [],
    sampleEquipment: []
  };

  // 1. Load EquipConst.json - Enhancement limits
  console.log('📖 Loading EquipConst.json...');
  const equipConst = readJsonFile(path.join(EXTRACTED_DATA, 'EquipConst.json'));
  if (equipConst) {
    output.constants = {
      enhanceEquipRarity: equipConst.enhanceEquipRarity || 5,
      maxAttrEnhanceLevel: equipConst.maxAttrEnhanceLevel || 3
    };
    console.log('   ✓ Constants loaded');
  }

  // 2. Load EquipEnhanceCostTable.json - Artificing costs
  console.log('📖 Loading EquipEnhanceCostTable.json...');
  const enhanceCost = readJsonFile(path.join(EXTRACTED_DATA, 'EquipEnhanceCostTable.json'));
  if (enhanceCost) {
    output.enhanceCosts = Object.entries(enhanceCost).map(([domainId, data]) => ({
      domainId: domainId,
      catalystItemId: data.consumeItemId,
      catalystAmount: data.consumeItemCnt || 1,
      returnItemId: data.returnbackItemId,
      returnAmount: data.returnbackItemCnt || 0
    }));
    console.log(`   ✓ Loaded ${output.enhanceCosts.length} domain costs`);
  }

  // 3. Load EquipTechConst.json - Tech constants
  console.log('📖 Loading EquipTechConst.json...');
  const techConst = readJsonFile(path.join(EXTRACTED_DATA, 'EquipTechConst.json'));
  if (techConst) {
    output.techConstants = {
      recycleRatio: techConst.equipRecycleRatio || 0.9,
      visibleFormulaMaxDeltaLevel: techConst.visibleFormulaMaxDeltaLevel || 1
    };
    console.log('   ✓ Tech constants loaded');
  }

  // 4. Load existing optimized suits data
  console.log('📖 Loading optimized suits data...');
  const suitsListPath = path.join(OPTIMIZED_EQUIPMENT, 'suits', 'suits-list.json');
  const suitsList = readJsonFile(suitsListPath);
  if (suitsList) {
    output.suits = Object.values(suitsList).map(suit => ({
      suitId: suit.suitId,
      nameI18nId: suit.suitNameI18nId,
      engName: suit.engName,
      iconItemId: suit.iconItemId,
      tier: suit.tier,
      totalPieces: suit.totalPieces,
      setEffects: suit.setEffects || []
    }));
    console.log(`   ✓ Loaded ${output.suits.length} equipment suits`);
  } else {
    console.log('   ⚠ Suits data not found, loading from source...');
    // Fallback: load from EquipSuitTable.json
    const equipSuitTable = readJsonFile(path.join(EXTRACTED_DATA, 'EquipSuitTable.json'));
    if (equipSuitTable) {
      output.suits = Object.entries(equipSuitTable).map(([suitId, suit]) => {
        const firstEffect = suit.list?.[0];
        return {
          suitId: suitId,
          nameI18nId: firstEffect?.suitName?.id ? String(firstEffect.suitName.id) : null,
          engName: suitId.replace('suit_', '').replace(/_/g, ' '),
          iconItemId: suit.equipList?.[0] || null,
          tier: getTierFromEquipId(suit.equipList?.[0]),
          totalPieces: suit.equipList?.length || 0,
          setEffects: (suit.list || []).map(effect => ({
            piecesRequired: effect.equipCnt,
            skillID: effect.skillID
          }))
        };
      });
      console.log(`   ✓ Loaded ${output.suits.length} suits from source`);
    }
  }

  // 5. Load sample T4 equipment for examples and determine suit domains
  console.log('📖 Loading sample equipment...');
  const equipTable = readJsonFile(path.join(EXTRACTED_DATA, 'EquipTable.json'));
  if (equipTable) {
    // Build a map of suitId -> domainId from equipment
    const suitDomainMap = {};
    Object.entries(equipTable).forEach(([itemId, item]) => {
      const suitId = item.suitID || item.suitId;
      if (suitId && item.domainId && !suitDomainMap[suitId]) {
        suitDomainMap[suitId] = item.domainId;
      }
    });

    // Add domainId to each suit
    output.suits = output.suits.map(suit => ({
      ...suit,
      domainId: suitDomainMap[suit.suitId] || 'domain_1'
    }));
    console.log(`   ✓ Added domain info to ${Object.keys(suitDomainMap).length} suits`);

    // Get 3 sample T4 equipment items (one of each part type)
    const t4Items = Object.entries(equipTable)
      .filter(([id]) => id.includes('_t4_'))
      .slice(0, 9);

    output.sampleEquipment = t4Items.map(([itemId, item]) => ({
      itemId: itemId,
      domainId: item.domainId,
      minWearLv: item.minWearLv,
      partType: item.partType,
      suitId: item.suitID || item.suitId,
      baseAttr: item.displayBaseAttrModifier ? {
        attrType: item.displayBaseAttrModifier.attrType,
        value: item.displayBaseAttrModifier.attrValue
      } : null,
      subStats: (item.displayAttrModifiers || []).slice(0, 3).map(mod => ({
        attrType: mod.attrType,
        value: mod.attrValue
      })),
      enhanceValues: item.equipAttrModifiers?.[0]?.attrValues || []
    }));
    console.log(`   ✓ Loaded ${output.sampleEquipment.length} sample equipment items`);
  }

  // Write output file
  console.log('\n💾 Writing optimized data...');
  const outputJson = JSON.stringify(output, null, 2);
  fs.writeFileSync(OUTPUT_FILE, outputJson, 'utf8');

  const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2);
  console.log(`   ✓ Output: ${OUTPUT_FILE}`);
  console.log(`   ✓ Size: ${fileSize} KB`);

  console.log('\n📊 Statistics:');
  console.log(`   Equipment Suits: ${output.suits.length}`);
  console.log(`   Sample Equipment: ${output.sampleEquipment.length}`);
  console.log(`   Max Enhancement Level: ${output.constants.maxAttrEnhanceLevel}`);

  console.log('\n✨ Artificing Guide data optimization complete!');

  return output;
}

/**
 * Get tier from equipment ID
 */
function getTierFromEquipId(equipId) {
  if (!equipId) return 0;
  const match = equipId.match(/_t(\d)_/);
  return match ? parseInt(match[1]) : 0;
}

// Run optimization
try {
  optimizeArtificingGuideData();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
