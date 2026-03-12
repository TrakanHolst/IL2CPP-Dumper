#!/usr/bin/env node

/**
 * Script to generate static pages for all characters and weapons
 *
 * This script reads the JSON data files and outputs information about
 * the pages that will be statically generated at build time.
 *
 * Usage:
 *   node scripts/generate-static-pages.js
 */

const fs = require('fs');
const path = require('path');
const JSONbig = require('json-bigint');

// Configure json-bigint to convert all numbers to strings to preserve precision
const JSONbigString = JSONbig({ storeAsString: true });

// Paths to data files
const CHARACTER_TABLE_PATH = path.join(__dirname, '../public/localdb/endfield_data/CharacterTable.json');
const WEAPON_TABLE_PATH = path.join(__dirname, '../public/localdb/endfield_data/WeaponBasicTable.json');
const I18N_EN_PATH = path.join(__dirname, '../public/localdb/lang/I18nTextTable_EN.json');

// Helper: Generate SEO-friendly slug
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

console.log('🔧 Generating Static Pages Report\n');
console.log('This script analyzes the data files and reports what static pages will be generated.\n');

// Load English i18n translations
console.log('🌐 Loading English translations...');
const i18nData = JSONbigString.parse(fs.readFileSync(I18N_EN_PATH, 'utf8'));
const i18nCache = {};
Object.entries(i18nData).forEach(([id, data]) => {
  // The i18n entry is directly a string, not an object
  i18nCache[id] = typeof data === 'string' ? data : (data.text || '');
});
console.log(`   Loaded ${Object.keys(i18nCache).length} translations\n`);

// Load character data
console.log('📊 Loading character data...');
const characterData = JSONbigString.parse(fs.readFileSync(CHARACTER_TABLE_PATH, 'utf8'));
const characters = Object.values(characterData);
console.log(`   Found ${characters.length} characters`);

// Load weapon data
console.log('⚔️  Loading weapon data...');
const weaponData = JSONbigString.parse(fs.readFileSync(WEAPON_TABLE_PATH, 'utf8'));
const weapons = Object.values(weaponData);
console.log(`   Found ${weapons.length} weapons\n`);

// Character pages
console.log('📄 Character Pages (will be generated at /characters/[slug]):');
console.log('   Routes (SEO-friendly URLs):');
characters.slice(0, 5).forEach(char => {
  const slug = generateSlug(char.engName || char.charId);
  console.log(`   - /characters/${slug} (${char.engName})`);
});
if (characters.length > 5) {
  console.log(`   ... and ${characters.length - 5} more\n`);
}

// Weapon pages
console.log('⚔️  Weapon Pages (will be generated at /weapons/[slug]):');
console.log('   Routes (SEO-friendly URLs):');
weapons.slice(0, 5).forEach(weapon => {
  // Get weapon name from i18n cache or fallback
  let name = weapon.weaponId;
  if (weapon.engName?.id && i18nCache[weapon.engName.id]) {
    name = i18nCache[weapon.engName.id];
  } else if (weapon.engName?.text) {
    name = weapon.engName.text;
  }
  const slug = generateSlug(name);
  console.log(`   - /weapons/${slug} (${name})`);
});
if (weapons.length > 5) {
  console.log(`   ... and ${weapons.length - 5} more\n`);
}

// Summary
console.log('📈 Summary:');
console.log(`   Total static pages to generate: ${characters.length + weapons.length}`);
console.log(`   - ${characters.length} character pages`);
console.log(`   - ${weapons.length} weapon pages\n`);

console.log('✅ Report complete!');
console.log('\n💡 To generate these pages:');
console.log('   1. Run: npm run build');
console.log('   2. Next.js will automatically generate all static pages using generateStaticParams()');
console.log('   3. Pages will be pre-rendered and cached for optimal SEO and performance\n');

// Generate a sitemap list (optional)
const sitemapPath = path.join(__dirname, '../public/static-routes.txt');
const routes = [
  ...characters.map(c => `/characters/${generateSlug(c.engName || c.charId)}`),
  ...weapons.map(w => {
    // Get weapon name from i18n cache or fallback
    let name = w.weaponId;
    if (w.engName?.id && i18nCache[w.engName.id]) {
      name = i18nCache[w.engName.id];
    } else if (w.engName?.text) {
      name = w.engName.text;
    }
    return `/weapons/${generateSlug(name)}`;
  })
];

fs.writeFileSync(sitemapPath, routes.join('\n'), 'utf8');
console.log(`📝 Route list saved to: public/static-routes.txt`);
console.log(`   This file contains all ${routes.length} routes for sitemap generation.\n`);

process.exit(0);
