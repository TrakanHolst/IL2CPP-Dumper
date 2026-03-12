#!/usr/bin/env node

/**
 * CONSOLIDATE DUPLICATE TRANSLATION KEYS
 *
 * This script:
 * 1. Updates all translation JSON files to remove duplicate keys
 * 2. Consolidates them into common.* keys
 * 3. Outputs a list of code changes needed
 */

const fs = require('fs');
const path = require('path');

const LANG_DIR = path.join(__dirname, '../../public/localdb/lang');
const LANGUAGES = ['EN', 'CN', 'TC', 'JP', 'KR', 'RU', 'MX', 'PT', 'FR', 'DE', 'ID', 'VI', 'TH', 'IT'];

// Define consolidations: old keys -> new common key
const consolidations = {
  // Level
  'builds.character_level': 'common.level',
  'map.level': 'common.level',
  'weapons.skill_level': 'common.level',

  // Edit
  'builds.edit_mode': 'common.edit',
  'comments.edit': 'common.edit',
  'factory.menu.edit': 'common.edit',

  // Latest
  'builds.sort_latest': 'common.latest',
  'factory_plans.latest': 'common.latest',
  'factory_plans.sort_latest': 'common.latest',

  // Popular
  'builds.sort_popular': 'common.popular',
  'factory.popular': 'common.popular',
  'factory_plans.sort_popular': 'common.popular',

  // Skills
  'ascension.skills': 'common.skills',
  'builds.skills': 'common.skills',
  'weapons.skills': 'common.skills',

  // Comments
  'builds.comments': 'common.comments',
  'comments.title': 'common.comments',
  'factory_plans.comments': 'common.comments',

  // Filters
  'builds.filters': 'common.filters',
  'map.filters': 'common.filters',

  // Private
  'builds.private': 'common.private',
  'factory.visibility_private': 'common.private',
  'factory_plans.private': 'common.private',

  // Public
  'builds.public': 'common.public',
  'factory.visibility_public': 'common.public',
  'factory_plans.public': 'common.public',

  // Tags
  'builds.tags': 'common.tags',
  'factory.filter_by_tags': 'common.tags',
  'factory_plans.tags': 'common.tags',

  // View
  'builds.view_mode': 'common.view',
  'factory.menu.view': 'common.view',

  // Delete
  'comments.delete': 'common.delete',
  'factory.delete': 'common.delete',

  // Clear
  'factory.clear': 'common.clear',
  'map.clear_all': 'common.clear',

  // Buildings
  'factory.building_count': 'common.buildings',
  'factory.buildings': 'common.buildings',
  'factory_plans.buildings': 'common.buildings',

  // Description
  'factory.description': 'common.description',
  'factory_plans.description_label': 'common.description',
  'weapons.description': 'common.description',

  // Planner
  'ascension.planner': 'common.planner',
  'nav.planner': 'common.planner',

  // Remove
  'ascension.remove': 'common.remove',
  'builds.remove_character': 'common.remove',

  // Talents
  'ascension.talents': 'common.talents',
  'characters.talents': 'common.talents',

  // Alternative
  'builds.alternative': 'common.alternative',
  'builds.alternative_equipment': 'common.alternative',

  // Equipment
  'builds.equipment': 'common.equipment',
  'factory.item_category.equipment': 'common.equipment',

  // Weapon
  'builds.filter_by_weapon': 'common.weapon',
  'builds.weapon': 'common.weapon',

  // Character
  'builds.filter_character': 'common.character',
  'summon.table_character': 'common.character',

  // Preview
  'builds.preview': 'common.preview',
  'factory.thumbnail_preview': 'common.preview',

  // Weapons
  'builds.weapons': 'common.weapons',
  'nav.weapons': 'common.weapons',

  // Breakthrough
  'characters.breakthrough': 'common.breakthrough',
  'weapons.breakthrough': 'common.breakthrough',

  // Rarity
  'characters.rarity': 'common.rarity',
  'summon.table_rarity': 'common.rarity',

  // Characters
  'characters.title': 'common.characters',
  'nav.characters': 'common.characters',

  // Cancel - already exists
  'comments.cancel': 'common.cancel',

  // Close
  'map.close': 'common.close',

  // Copy
  'factory.copy': 'common.copy',

  // Save
  'factory.save': 'common.save',

  // Name
  'equipment.sort_name': 'common.name',
  'factory.save_name': 'common.name',

  // Tier
  'equipment.sort_tier': 'common.tier',
  'equipment.tier': 'common.tier',

  // Stats
  'equipment.stats': 'common.stats',
  'essence_solver.stats': 'common.stats',

  // Inputs
  'factory.inputs': 'common.inputs',
  'factory_plans.inputs': 'common.inputs',

  // Outputs
  'factory.outputs': 'common.outputs',
  'factory_plans.outputs': 'common.outputs',

  // Region
  'factory_plans.region': 'common.region',
  'map.region': 'common.region',

  // Type
  'map.type': 'common.type',
  'summon.table_type': 'common.type',
};

// New common keys to add (with their values from EN)
const newCommonKeys = {
  'common.skills': 'Skills',
  'common.comments': 'Comments',
  'common.private': 'Private',
  'common.public': 'Public',
  'common.tags': 'Tags',
  'common.buildings': 'Buildings',
  'common.description': 'Description',
  'common.planner': 'Planner',
  'common.remove': 'Remove',
  'common.talents': 'Talents',
  'common.alternative': 'Alternative',
  'common.equipment': 'Equipment',
  'common.weapon': 'Weapon',
  'common.character': 'Character',
  'common.preview': 'Preview',
  'common.weapons': 'Weapons',
  'common.breakthrough': 'Breakthrough',
  'common.rarity': 'Rarity',
  'common.characters': 'Characters',
  'common.name': 'Name',
  'common.tier': 'Tier',
  'common.stats': 'Stats',
  'common.inputs': 'Inputs',
  'common.outputs': 'Outputs',
  'common.region': 'Region',
  'common.type': 'Type',
};

function consolidateTranslations() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  CONSOLIDATE DUPLICATE TRANSLATION KEYS');
  console.log('='.repeat(60));
  console.log('');

  console.log(`Keys to consolidate: ${Object.keys(consolidations).length}`);
  console.log(`New common keys: ${Object.keys(newCommonKeys).length}`);
  console.log('');

  // Process each language file
  for (const lang of LANGUAGES) {
    const filePath = path.join(LANG_DIR, `website_translations_${lang}.json`);

    if (!fs.existsSync(filePath)) {
      console.log(`  ${lang}: File not found, skipping`);
      continue;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let keysRemoved = 0;
    let keysAdded = 0;

    // Add new common keys (use value from old key if exists, otherwise EN default)
    for (const [newKey, enValue] of Object.entries(newCommonKeys)) {
      if (!data[newKey]) {
        // Find an old key that maps to this new key to get the translation
        const oldKey = Object.entries(consolidations).find(([old, newK]) => newK === newKey)?.[0];
        if (oldKey && data[oldKey]) {
          data[newKey] = data[oldKey];
        } else if (lang === 'EN') {
          data[newKey] = enValue;
        } else {
          data[newKey] = ''; // Empty for non-EN languages
        }
        keysAdded++;
      }
    }

    // Remove old keys
    for (const oldKey of Object.keys(consolidations)) {
      if (data[oldKey] !== undefined) {
        delete data[oldKey];
        keysRemoved++;
      }
    }

    // Sort keys alphabetically
    const sortedData = {};
    Object.keys(data).sort().forEach(key => {
      sortedData[key] = data[key];
    });

    // Write back
    fs.writeFileSync(filePath, JSON.stringify(sortedData, null, 2), 'utf8');
    console.log(`  ${lang}: Removed ${keysRemoved} keys, added ${keysAdded} keys`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('  CODE CHANGES REQUIRED');
  console.log('='.repeat(60));
  console.log('');
  console.log('Search and replace the following in your codebase:');
  console.log('');

  // Group by new key for cleaner output
  const byNewKey = {};
  for (const [oldKey, newKey] of Object.entries(consolidations)) {
    if (!byNewKey[newKey]) {
      byNewKey[newKey] = [];
    }
    byNewKey[newKey].push(oldKey);
  }

  for (const [newKey, oldKeys] of Object.entries(byNewKey)) {
    console.log(`=> ${newKey}`);
    oldKeys.forEach(oldKey => {
      console.log(`   "${oldKey}" -> "${newKey}"`);
    });
    console.log('');
  }

  console.log('');
  console.log('Translation files have been updated.');
  console.log('Now run: npm run translations:export');
  console.log('');
}

// Export consolidations for use in other scripts
module.exports = { consolidations, newCommonKeys };

// Run if called directly
if (require.main === module) {
  consolidateTranslations();
}
