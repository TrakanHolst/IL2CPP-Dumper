#!/usr/bin/env node

/**
 * COMBAT MECHANICS OPTIMIZER
 *
 * This script extracts combat mechanics data from wiki tables and creates
 * a mapping from #ba.xxx tags (used in skill descriptions) to wiki entries
 * with their i18n IDs for tooltips.
 *
 * Source files:
 *   - WikiEntryDataTable.json - Main entry definitions with short descriptions
 *   - WikiTutorialPageTable.json - Detailed tutorial pages with content
 *
 * Output: public/localdb/optimized/combat/combat-mechanics.json
 */

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
      if (key.endsWith('I18nId') || key.endsWith('I18nIds')) {
        // Handle both single IDs and arrays of IDs
        if (Array.isArray(value)) {
          result[key] = value.map(id => getCanonicalId(id, dedupMap));
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
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/optimized/combat');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'combat-mechanics.json');

/**
 * Mapping from #ba.xxx tags to wiki entry IDs
 * This maps the tag names found in skill descriptions to their corresponding
 * wiki tutorial entries that contain the explanations.
 */
/**
 * Tags that get their tooltip info directly from HyperlinkTextTable
 * rather than mapping to wiki entries.
 * These are character-specific mechanics or special terms.
 */
const HYPERLINK_ONLY_TAGS = [
  'originium', // Endministrator's Originium Crystals mechanic
];

const TAG_TO_WIKI_MAPPING = {
  // Arts Inflictions (Elements)
  'fireinflict': 'wiki_tut_bat_fire',
  'crystinflict': 'wiki_tut_bat_cold',
  'pulseinflict': 'wiki_tut_bat_pulse',
  'naturalinflict': 'wiki_tut_bat_nature',

  // Arts Reactions
  'burning': 'wiki_tut_bat_combust',
  'corrupt': 'wiki_tut_bat_corrode',
  'conduct': 'wiki_tut_bat_conduct',
  'frozen': 'wiki_tut_bat_freeze',

  // Arts Bursts
  'fireburst': 'wiki_tut_bat_fire_outbreak',
  'crystburst': 'wiki_tut_bat_cold_outbreak',
  'pulseburst': 'wiki_tut_bat_pulse_outbreak',
  'naturalburst': 'wiki_tut_bat_nature_outbreak',

  // Physical Effects
  'noguard': 'wiki_tut_bat_break_defence', // Vulnerable (physical status)
  'vulnerable': 'wiki_tut_bat_break_defence', // Vulnerable (physical status)
  'knockdown': 'wiki_tut_bat_knockdown',
  'airborne': 'wiki_tut_bat_airborne',
  'weak': 'wiki_tut_bat_weak',
  'crush': 'wiki_tut_bat_knockback',
  'fracture': 'wiki_tut_bat_breakarmor',

  // Status Effects
  'slow': 'wiki_tut_bat_slow',
  'dispel': 'wiki_tut_bat_dispel',
  'shield': 'wiki_tut_bat_shield',
  'guard': 'wiki_tut_bat_guard',

  // Combat Systems
  'statuslevel': 'wiki_tut_bat_statuslevel',
  'spellburst': 'wiki_tut_bat_fire_outbreak', // Generic arts burst
  'spellinflict': 'wiki_tut_bat_fire', // Generic arts infliction
  'spellstatus': 'wiki_tut_bat_consume', // Arts reaction (consume)
  'consume': 'wiki_tut_bat_consume',
  'enhance': 'wiki_tut_bat_enhance',
  'return': 'wiki_tut_bat_return',
  'combo': 'wiki_tut_bat_combohint',   // Link / Lien mechanic
  'lastcombo': 'wiki_tut_bat_heavy_attack',   // Final Blow / Coup final (Heavy Attack in wiki)

  // Poise system
  'poise': 'wiki_tut_bat_poise',
  'poiseknot': 'wiki_tut_bat_poise',

  // On-character variants (same as base)
  'burningonchar': 'wiki_tut_bat_combust',
  'corruptonchar': 'wiki_tut_bat_corrode',
  'conductonchar': 'wiki_tut_bat_conduct',
  'frozenonchar': 'wiki_tut_bat_freeze',
  'crystonchar': 'wiki_tut_bat_cold',
  'spellinflictonchar': 'wiki_tut_bat_fire',

  // Vulnerability variants
  'physicalvul': 'wiki_tut_bat_vulnerable',
  'spellvul': 'wiki_tut_bat_vulnerable',
  'firevul': 'wiki_tut_bat_fire',
  'crystvul': 'wiki_tut_bat_cold',
  'pulsevul': 'wiki_tut_bat_pulse',

  // Enhancement variants
  'fireenhance': 'wiki_tut_bat_enhance',
  'crystenhance': 'wiki_tut_bat_enhance',
  'pulseenhance': 'wiki_tut_bat_enhance',
  'naturalenhance': 'wiki_tut_bat_enhance',
  'spellenhance': 'wiki_tut_bat_enhance',

  // Cryo-specific
  'crystbreak': 'wiki_tut_bat_freeze', // Shatter (breaking frozen)
  // Note: 'originium' is handled separately via HYPERLINK_ONLY_TAGS below

  // Other
  'physicalstatus': 'wiki_tut_bat_poise', // Physical status (Stagger)
  'spelldmg': 'wiki_tut_bat_dmg_type',
  'dot': 'wiki_tut_bat_combust', // Damage over time
};

/**
 * Main optimization function
 */
function optimizeCombatMechanics() {
  console.log('🔧 Starting combat mechanics optimization...\n');

  // Load deduplication map for i18n IDs
  console.log('📖 Loading i18n deduplication map...');
  dedupMap = loadDedupMap();
  if (dedupMap) {
    console.log('   ✓ Dedup map loaded - i18n IDs will be deduplicated\n');
  } else {
    console.log('   ⚠ No dedup map found - run i18n-dedup.js first for optimal results\n');
  }

  // Check source files exist
  const wikiEntriesPath = path.join(EXTRACTED_DATA_DIR, 'WikiEntryDataTable.json');
  const wikiTutorialsPath = path.join(EXTRACTED_DATA_DIR, 'WikiTutorialPageTable.json');
  const hyperlinkPath = path.join(EXTRACTED_DATA_DIR, 'HyperlinkTextTable.json');

  if (!fs.existsSync(wikiEntriesPath)) {
    console.error('❌ Error: WikiEntryDataTable.json not found');
    process.exit(1);
  }
  if (!fs.existsSync(wikiTutorialsPath)) {
    console.error('❌ Error: WikiTutorialPageTable.json not found');
    process.exit(1);
  }
  if (!fs.existsSync(hyperlinkPath)) {
    console.error('❌ Error: HyperlinkTextTable.json not found');
    process.exit(1);
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Load source data
  console.log('📖 Reading wiki data files...');
  const wikiEntries = JSONbigString.parse(fs.readFileSync(wikiEntriesPath, 'utf8'));
  const wikiTutorials = JSONbigString.parse(fs.readFileSync(wikiTutorialsPath, 'utf8'));
  const hyperlinkTable = JSONbigString.parse(fs.readFileSync(hyperlinkPath, 'utf8'));

  // Build tutorial pages lookup by tutorialId
  const tutorialsByEntry = {};
  Object.entries(wikiTutorials).forEach(([pageId, page]) => {
    const tutorialId = page.tutorialId;
    if (!tutorialsByEntry[tutorialId]) {
      tutorialsByEntry[tutorialId] = [];
    }
    tutorialsByEntry[tutorialId].push({
      pageId,
      titleI18nId: page.title?.id || null,
      contentI18nId: page.content?.id || null,
      order: page.order || 0,
    });
  });

  // Sort tutorial pages by order
  Object.values(tutorialsByEntry).forEach(pages => {
    pages.sort((a, b) => a.order - b.order);
  });

  // Build the tag mapping
  console.log('⚙️  Building tag-to-wiki mapping...');
  const tagMapping = {};
  const processedWikiIds = new Set();

  Object.entries(TAG_TO_WIKI_MAPPING).forEach(([tag, wikiId]) => {
    const entry = wikiEntries[wikiId];
    if (!entry) {
      console.warn(`   ⚠️  Wiki entry not found: ${wikiId} (for tag: ${tag})`);
      return;
    }

    // Get tutorial pages for this entry
    const tutorialPages = tutorialsByEntry[wikiId] || [];

    // Extract i18n IDs
    const shortDescI18nId = entry.desc?.id || null;
    const detailedDescI18nIds = tutorialPages
      .filter(p => p.contentI18nId)
      .map(p => p.contentI18nId);
    const titleI18nId = tutorialPages.length > 0 ? tutorialPages[0].titleI18nId : null;

    tagMapping[tag] = {
      wikiId,
      titleI18nId,
      shortDescI18nId,
      detailedDescI18nIds,
    };

    processedWikiIds.add(wikiId);
  });

  // Process hyperlink-only tags (get info directly from HyperlinkTextTable)
  console.log('⚙️  Processing hyperlink-only tags...');
  HYPERLINK_ONLY_TAGS.forEach(tag => {
    const hyperlinkKey = `ba.${tag}`;
    const hyperlinkEntry = hyperlinkTable[hyperlinkKey];
    if (!hyperlinkEntry) {
      console.warn(`   ⚠️  Hyperlink entry not found: ${hyperlinkKey} (for tag: ${tag})`);
      return;
    }

    // Extract name and desc i18n IDs from hyperlink entry
    const titleI18nId = hyperlinkEntry.name?.id || null;
    const shortDescI18nId = hyperlinkEntry.desc?.id || null;

    tagMapping[tag] = {
      wikiId: null, // No wiki entry - uses hyperlink data directly
      titleI18nId,
      shortDescI18nId,
      detailedDescI18nIds: [], // No detailed descriptions available
    };

    console.log(`   ✓ ${tag}: title=${titleI18nId}, desc=${shortDescI18nId}`);
  });

  // Build output structure
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    tagMapping,
    // Also include all wiki entry short descriptions for direct lookup
    wikiEntries: {},
  };

  // Add all battle wiki entries
  Object.entries(wikiEntries).forEach(([wikiId, entry]) => {
    if (wikiId.startsWith('wiki_tut_bat_')) {
      const tutorialPages = tutorialsByEntry[wikiId] || [];
      output.wikiEntries[wikiId] = {
        shortDescI18nId: entry.desc?.id || null,
        titleI18nId: tutorialPages.length > 0 ? tutorialPages[0].titleI18nId : null,
        detailedDescI18nIds: tutorialPages
          .filter(p => p.contentI18nId)
          .map(p => p.contentI18nId),
      };
    }
  });

  // Deduplicate i18n IDs
  const dedupedOutput = deduplicateI18nIds(output);

  // Write output
  console.log('💾 Writing optimized combat mechanics data...');
  const outputJson = JSON.stringify(dedupedOutput, null, 2);
  fs.writeFileSync(OUTPUT_FILE, outputJson, 'utf8');

  const outputSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2);
  const tagCount = Object.keys(tagMapping).length;
  const wikiCount = Object.keys(output.wikiEntries).length;

  console.log(`\n📊 Optimization Summary:`);
  console.log(`   ✓ Tag mappings: ${tagCount}`);
  console.log(`   ✓ Wiki entries: ${wikiCount}`);
  console.log(`   ✓ Output size: ${outputSize} KB`);
  console.log(`   ✓ Output file: ${OUTPUT_FILE}`);
  console.log('\n✨ Combat mechanics optimization complete!');
}

// Run optimization
try {
  optimizeCombatMechanics();
} catch (error) {
  console.error('\n❌ Error during optimization:', error.message);
  console.error(error.stack);
  process.exit(1);
}
