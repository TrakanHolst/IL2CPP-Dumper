#!/usr/bin/env node

/**
 * ESSENCES DATABASE OPTIMIZER
 *
 * This script optimizes ALL essence/gem data for the Essences Database page.
 * It creates a comprehensive listing of all essences with their stat values.
 *
 * Source Files:
 * - GemPresetTable.json - All preset essence definitions
 * - GemTable.json - Stat term definitions with i18n IDs
 * - GemTagIdTable.json - Tag to term mapping
 * - WorldEnergyPointGroupTable.json - Dungeon data with stat pools
 *
 * Output: public/localdb/optimized/essences/essences-database.json
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
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/essences');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'essences-database.json');

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
 * Extract weapon type from gem ID
 */
function extractWeaponType(gemId) {
  const weaponPatterns = {
    'claym': 'claymore',
    'sword': 'sword',
    'pistol': 'pistol',
    'lance': 'lance',
    'gun': 'gun',
    'bow': 'bow',
    'staff': 'staff',
    'dagger': 'dagger'
  };

  for (const [pattern, type] of Object.entries(weaponPatterns)) {
    if (gemId.includes(pattern)) {
      return type;
    }
  }
  return 'unknown';
}

/**
 * Main optimization function
 */
function optimizeEssencesDatabase() {
  console.log('🔧 Starting Essences Database optimization...\n');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
      totalEssences: 0,
      totalStatTerms: 0
    },
    essences: [],
    statTerms: {},
    tagToTermMap: {},
    presetTypes: [],
    dungeonGroups: [],
    domains: {
      domain_1: { id: 'domain_1', nameKey: 'tundra', engName: 'Tundra' },
      domain_2: { id: 'domain_2', nameKey: 'wuling', engName: 'Wuling' }
    }
  };

  // 1. Load GemTable.json - Stat term definitions
  console.log('📖 Loading GemTable.json...');
  const gemTable = readJsonFile(path.join(EXTRACTED_DATA, 'GemTable.json'));
  if (gemTable) {
    Object.values(gemTable).forEach(term => {
      output.statTerms[term.gemTermId] = {
        termId: term.gemTermId,
        tagId: term.tagId,
        nameI18nId: extractI18nId(term.tagName),
        isSkillTerm: term.isSkillTerm || false,
        termType: term.termType,
        sortOrder: term.sortOrder,
        tagIcon: term.tagIcon || null,
        // Provide English fallback names
        engName: formatTermName(term.tagId)
      };
    });
    output.metadata.totalStatTerms = Object.keys(output.statTerms).length;
    console.log(`   ✓ Loaded ${output.metadata.totalStatTerms} stat terms`);
  }

  // 2. Load GemTagIdTable.json - Tag to term mapping
  console.log('📖 Loading GemTagIdTable.json...');
  const tagIdTable = readJsonFile(path.join(EXTRACTED_DATA, 'GemTagIdTable.json'));
  if (tagIdTable) {
    output.tagToTermMap = { ...tagIdTable };
    console.log(`   ✓ Loaded ${Object.keys(output.tagToTermMap).length} tag mappings`);
  }

  // 3. Load EnemyTemplateDisplayInfoTable.json - Enemy names for dungeon icons
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

  // 4. Load WorldEnergyPointGroupTable.json - Dungeon data
  console.log('📖 Loading WorldEnergyPointGroupTable.json...');
  const dungeonTable = readJsonFile(path.join(EXTRACTED_DATA, 'WorldEnergyPointGroupTable.json'));
  const dungeonGroups = [];
  if (dungeonTable) {
    Object.values(dungeonTable).forEach(dungeon => {
      // Collect all stats this dungeon can drop
      const allStats = new Set();

      // Primary attributes (main stats) - field is primAttrTermIds
      (dungeon.primAttrTermIds || []).forEach(term => allStats.add(term));

      // Secondary stats - field is secAttrTermIds
      (dungeon.secAttrTermIds || []).forEach(term => allStats.add(term));

      // Skill stats - field is skillTermIds
      (dungeon.skillTermIds || []).forEach(term => allStats.add(term));

      // Look up the enemy name from the icon ID
      const enemyNameI18nId = enemyNameMap[dungeon.icon] || null;

      dungeonGroups.push({
        groupId: dungeon.gameGroupId,
        nameI18nId: extractI18nId(dungeon.gameGroupName),
        enemyNameI18nId: enemyNameI18nId,
        icon: dungeon.icon || '',
        allStats: Array.from(allStats),
        primaryAttributes: dungeon.primAttrTermIds || [],
        secondaryStats: dungeon.secAttrTermIds || [],
        skillStats: dungeon.skillTermIds || []
      });
    });
    output.dungeonGroups = dungeonGroups;
    console.log(`   ✓ Loaded ${dungeonGroups.length} dungeon groups`);
  }

  // 5. Load GemPresetTable.json - All essence definitions
  console.log('📖 Loading GemPresetTable.json...');
  const presetTable = readJsonFile(path.join(EXTRACTED_DATA, 'GemPresetTable.json'));
  if (presetTable) {
    const essences = [];
    const presetTypesSet = new Set();

    Object.entries(presetTable).forEach(([gemId, gem]) => {
      // Skip non-preset items (actual gem instances start with gem_)
      const isPreset = gemId.startsWith('item_preset_gem_');

      if (isPreset) {
        presetTypesSet.add(gemId);
      }

      // Extract stats from termList
      const stats = (gem.termList || []).map(term => ({
        termId: term.termId,
        level: term.level,
        tagId: getTagIdFromTermId(term.termId, tagIdTable)
      }));

      // Calculate which dungeons can drop this essence based on its stats
      const possibleDungeons = calculatePossibleDungeons(stats, dungeonGroups);

      essences.push({
        id: gemId,
        domainId: gem.domainId || 'domain_1',
        rarity: gem.rarity || 5,
        weaponType: extractWeaponType(gemId),
        realItemId: gem.realItemId,
        isPreset: isPreset,
        stats: stats,
        statCount: stats.length,
        possibleDungeons: possibleDungeons
      });
    });

    output.essences = essences;
    output.metadata.totalEssences = essences.length;

    // Create preset types list
    output.presetTypes = Array.from(presetTypesSet).map(id => {
      const type = id.replace('item_preset_gem_', '').replace(/^\d+_?/, '');
      return {
        id: id,
        type: type || 'base',
        rarity: parseInt(id.match(/_gem_(\d+)/)?.[1] || '5'),
        nameKey: type || 'base'
      };
    });

    console.log(`   ✓ Loaded ${output.metadata.totalEssences} essences`);
    console.log(`   ✓ Found ${output.presetTypes.length} preset types`);
  }

  // 6. Calculate statistics
  const byDomain = {};
  const byRarity = {};
  const byWeaponType = {};
  const byDungeon = {};

  output.essences.forEach(e => {
    byDomain[e.domainId] = (byDomain[e.domainId] || 0) + 1;
    byRarity[e.rarity] = (byRarity[e.rarity] || 0) + 1;
    byWeaponType[e.weaponType] = (byWeaponType[e.weaponType] || 0) + 1;

    // Track by dungeon
    (e.possibleDungeons || []).forEach(dungeonId => {
      byDungeon[dungeonId] = (byDungeon[dungeonId] || 0) + 1;
    });
  });

  output.metadata.byDomain = byDomain;
  output.metadata.byRarity = byRarity;
  output.metadata.byWeaponType = byWeaponType;
  output.metadata.byDungeon = byDungeon;

  // Write output file
  console.log('\n💾 Writing optimized data...');
  const outputJson = JSON.stringify(output, null, 2);
  fs.writeFileSync(OUTPUT_FILE, outputJson, 'utf8');

  const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2);
  console.log(`   ✓ Output: ${OUTPUT_FILE}`);
  console.log(`   ✓ Size: ${fileSize} KB`);

  console.log('\n📊 Statistics:');
  console.log(`   Total Essences: ${output.metadata.totalEssences}`);
  console.log(`   Total Stat Terms: ${output.metadata.totalStatTerms}`);
  console.log(`   Dungeon Groups: ${output.dungeonGroups.length}`);
  console.log(`   By Domain:`, byDomain);
  console.log(`   By Rarity:`, byRarity);
  console.log(`   By Dungeon:`, byDungeon);

  console.log('\n✨ Essences Database optimization complete!');

  return output;
}

/**
 * Calculate which dungeons can drop an essence based on its stats
 */
function calculatePossibleDungeons(stats, dungeonGroups) {
  if (!stats || stats.length === 0 || !dungeonGroups || dungeonGroups.length === 0) {
    return [];
  }

  const possibleDungeons = [];

  for (const dungeon of dungeonGroups) {
    // Check if ALL of the essence's stats can be obtained from this dungeon
    const canDropAllStats = stats.every(stat => {
      return dungeon.allStats.includes(stat.termId);
    });

    if (canDropAllStats) {
      possibleDungeons.push(dungeon.groupId);
    }
  }

  return possibleDungeons;
}

/**
 * Get tag ID from term ID
 */
function getTagIdFromTermId(termId, tagIdTable) {
  if (!tagIdTable) return null;
  for (const [tagId, mappedTermId] of Object.entries(tagIdTable)) {
    if (mappedTermId === termId) {
      return tagId;
    }
  }
  return null;
}

/**
 * Format term name from tag ID
 */
function formatTermName(tagId) {
  if (!tagId) return 'Unknown';
  return tagId
    .replace(/^attr_/, '')
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Run optimization
try {
  optimizeEssencesDatabase();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
