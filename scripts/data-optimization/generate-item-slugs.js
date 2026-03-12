#!/usr/bin/env node

/**
 * Generate Item Slug Mapping
 *
 * Creates a mapping between item IDs and SEO-friendly slugs based on English translations.
 * This allows static export to work with translated name URLs.
 *
 * Output: public/localdb/optimized/factory/item-slugs.json
 */

const fs = require('fs');
const path = require('path');

// Paths
const ITEMS_PATH = path.join(__dirname, '../../public/localdb/optimized/factory/factory-browse-data.json');
const I18N_PATH = path.join(__dirname, '../../public/localdb/optimized/i18n/I18nTextTable_EN.json');
const OUTPUT_PATH = path.join(__dirname, '../../public/localdb/optimized/factory/item-slugs.json');

/**
 * Generate SEO-friendly slug from a name
 */
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Format item ID as fallback name
 */
function formatItemId(itemId) {
  return itemId
    .replace(/^item_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Main function
 */
function generateItemSlugs() {
  console.log('🔧 Generating item slug mapping...\n');

  // Check if source files exist
  if (!fs.existsSync(ITEMS_PATH)) {
    console.error('❌ Error: Factory browse data not found:', ITEMS_PATH);
    console.log('   Run "npm run refresh-data" first to generate factory browse data.');
    process.exit(1);
  }

  if (!fs.existsSync(I18N_PATH)) {
    console.error('❌ Error: English translations not found:', I18N_PATH);
    console.log('   Run "npm run refresh-data" first to generate i18n data.');
    process.exit(1);
  }

  // Load data
  console.log('📖 Loading item data...');
  const browseData = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf8'));
  const i18n = JSON.parse(fs.readFileSync(I18N_PATH, 'utf8'));

  const slugToItemId = {};
  const itemIdToSlug = {};
  const allSlugs = new Set(['blueprint']); // Always include generic blueprint slug

  let itemCount = 0;
  let translatedCount = 0;

  console.log('⚙️  Processing items...');

  // Process each item
  for (const [itemId, item] of Object.entries(browseData.items)) {
    let name;

    // Try to get translated name
    if (item.nameI18nId && i18n[item.nameI18nId]) {
      name = i18n[item.nameI18nId];
      translatedCount++;
    } else {
      // Fallback to formatted ID
      name = formatItemId(itemId);
    }

    const slug = generateSlug(name);

    // Handle duplicate slugs by appending item ID suffix
    let finalSlug = slug;
    let suffix = 1;
    while (allSlugs.has(finalSlug) && slugToItemId[finalSlug] !== itemId) {
      finalSlug = `${slug}-${suffix}`;
      suffix++;
    }

    slugToItemId[finalSlug] = itemId;
    itemIdToSlug[itemId] = finalSlug;
    allSlugs.add(finalSlug);
    itemCount++;
  }

  // Create output
  const output = {
    slugToItemId,
    itemIdToSlug,
    allSlugs: Array.from(allSlugs).sort(),
  };

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write output
  console.log('💾 Writing slug mapping...');
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  const outputSize = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(2);

  console.log(`\n✅ Generated slug mapping for ${itemCount} items`);
  console.log(`   - ${translatedCount} items with translated names`);
  console.log(`   - ${itemCount - translatedCount} items with fallback names`);
  console.log(`   - ${allSlugs.size} unique slugs (including 'blueprint')`);
  console.log(`   - Output: ${OUTPUT_PATH} (${outputSize} KB)`);

  // Show some examples
  console.log('\n📝 Sample mappings:');
  const samples = Object.entries(itemIdToSlug).slice(0, 5);
  for (const [itemId, slug] of samples) {
    console.log(`   ${itemId} → ${slug}`);
  }

  console.log('\n✨ Item slug generation complete!');
}

// Run
try {
  generateItemSlugs();
} catch (error) {
  console.error('\n❌ Error during generation:', error.message);
  console.error(error.stack);
  process.exit(1);
}
