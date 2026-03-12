#!/usr/bin/env node

/**
 * Generate Sitemap & Structured Data
 *
 * Dynamically generates:
 * 1. sitemap.xml - All static and dynamic pages for search engines
 * 2. structured-data.json - Schema.org structured data for rich snippets
 *
 * Page types included:
 * - Static pages (home, lists, tools)
 * - Character detail pages
 * - Character build pages (/build/{character})
 * - Weapon detail pages
 * - Equipment set detail pages
 * - Factory blueprint pages
 *
 * Usage: npm run generate:sitemap
 */

const fs = require('fs');
const path = require('path');
const JSONbig = require('json-bigint')({ storeAsString: true });

// Paths
const outputPath = path.join(__dirname, '../public/sitemap.xml');
const structuredDataPath = path.join(__dirname, '../public/structured-data.json');
const characterTablePath = path.join(__dirname, '../public/localdb/endfield_data/CharacterTable.json');
const weaponTablePath = path.join(__dirname, '../public/localdb/endfield_data/WeaponBasicTable.json');
const suitTablePath = path.join(__dirname, '../public/localdb/endfield_data/EquipSuitTable.json');
const i18nPath = path.join(__dirname, '../public/localdb/lang/I18nTextTable_EN.json');
const itemSlugsPath = path.join(__dirname, '../public/localdb/optimized/factory/item-slugs.json');

// Current date for lastmod
const today = new Date().toISOString().split('T')[0];

// Base URL for all pages
const baseUrl = 'https://endfieldtools.dev';

console.log('Generating sitemap.xml & structured-data.json...');
console.log('='.repeat(80));

// Generate character slug from character data
function getCharacterSlug(character) {
  const name = character.engName || character.id;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Generate weapon slug from weapon data
function getWeaponSlug(weapon, i18n) {
  // Weapon engName is an object with id and text properties
  let name = weapon.weaponId;

  if (weapon.engName) {
    if (typeof weapon.engName === 'object') {
      // Try i18n lookup first
      if (weapon.engName.id && weapon.engName.id !== '0' && i18n[weapon.engName.id]) {
        name = i18n[weapon.engName.id];
      } else if (weapon.engName.text) {
        name = weapon.engName.text;
      }
    } else if (typeof weapon.engName === 'string') {
      name = weapon.engName;
    }
  }

  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Generate equipment set slug from suit data
function getSuitSlug(suit, i18n) {
  const nameI18nId = suit.list[0]?.suitName?.id?.toString() || '0';
  const engName = i18n[nameI18nId] || suit.id;
  return (engName || suit.id)
    .replace(/^suit_/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ============================================================================
// STRUCTURED DATA GENERATION (Schema.org)
// ============================================================================

/**
 * Generate WebSite schema for home page
 * Includes SearchAction for sitelinks search box
 */
function generateWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    'name': 'EndfieldTools.DEV',
    'description': 'Essential Arknights: Endfield toolkit with factory planner, interactive maps, character database, weapons, equipment sets, community plans, character showcase, and summon simulator.',
    'url': `${baseUrl}/`,
    'potentialAction': {
      '@type': 'SearchAction',
      'target': `${baseUrl}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string'
    }
  };
}

/**
 * Generate BreadcrumbList schema for a page
 * @param {Array} breadcrumbs - Array of {name, url} objects
 */
function generateBreadcrumbSchema(breadcrumbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': breadcrumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      'position': index + 1,
      'name': crumb.name,
      'item': crumb.url
    }))
  };
}

/**
 * Page metadata for structured data generation
 * Maps URL patterns to their display names and parent paths
 */
const PAGE_METADATA = {
  // Main sections
  '/characters': { name: 'Characters', parent: null },
  '/weapons': { name: 'Weapons', parent: null },
  '/equipment': { name: 'Equipment', parent: null },
  '/essences': { name: 'Essences', parent: null },
  '/weapon-essence-solver': { name: 'Weapon Essence Solver', parent: null },
  '/factory-planner': { name: 'Factory Planner', parent: null },
  '/factory-planner/planner': { name: 'Planner', parent: '/factory-planner' },
  '/factory-planner/recipes': { name: 'Recipes', parent: '/factory-planner' },
  '/interactive-map': { name: 'Interactive Maps', parent: null },
  '/interactive-map/valley-iv': { name: 'Valley IV', parent: '/interactive-map' },
  '/interactive-map/wuling': { name: 'Wuling', parent: '/interactive-map' },
  '/community-plans': { name: 'Community Plans', parent: null },
  '/community-builds': { name: 'Community Builds', parent: null },
  '/character-showcase': { name: 'Character Showcase', parent: null },
  '/character-planner': { name: 'Character Planner', parent: null },
  '/summon-simulator': { name: 'Summon Simulator', parent: null },
  '/headhunt-tracker': { name: 'Headhunt Tracker', parent: null },
  '/ascension-planner': { name: 'Ascension Planner', parent: null },
  '/achievement-tracker': { name: 'Achievement Tracker', parent: null },
  '/community-factories': { name: 'AIC Factory Blueprints', parent: null },
  '/guides': { name: 'Guides', parent: null },
  '/guides/essences': { name: 'Essences Guide', parent: '/guides' },
  '/guides/artificing': { name: 'Artificing Guide', parent: '/guides' },
  '/guides/gacha-rates-pity': { name: 'Gacha Rates & Pity', parent: '/guides' },
  '/guides/factory-basics': { name: 'Factory Basics', parent: '/guides' },
  '/guides/character-building': { name: 'Character Building', parent: '/guides' },
  '/guides/factory-equipment': { name: 'Factory Equipment', parent: '/guides' },
  '/guides/team-building': { name: 'Team Building', parent: '/guides' },
};

/**
 * Build breadcrumb trail for a given URL path
 */
function buildBreadcrumbTrail(urlPath, pageName) {
  const breadcrumbs = [{ name: 'Home', url: `${baseUrl}/` }];

  const metadata = PAGE_METADATA[urlPath];

  if (metadata) {
    // Add parent breadcrumb if exists
    if (metadata.parent && PAGE_METADATA[metadata.parent]) {
      breadcrumbs.push({
        name: PAGE_METADATA[metadata.parent].name,
        url: `${baseUrl}${metadata.parent}`
      });
    }

    // Add current page
    breadcrumbs.push({
      name: metadata.name,
      url: `${baseUrl}${urlPath}`
    });
  } else if (pageName) {
    // For dynamic pages not in metadata
    breadcrumbs.push({
      name: pageName,
      url: `${baseUrl}${urlPath}`
    });
  }

  return breadcrumbs;
}

/**
 * Generate structured data key from URL path
 * Converts /path/to/page to path-to-page
 */
function urlToKey(urlPath) {
  if (urlPath === '/') return 'home';
  return urlPath
    .replace(/^\//, '')
    .replace(/\//g, '-');
}

// Static pages
const staticPages = [
  { url: '/', priority: '1.0', changefreq: 'weekly' },
  { url: '/characters', priority: '0.9', changefreq: 'weekly' },
  { url: '/weapons', priority: '0.9', changefreq: 'weekly' },
  { url: '/equipment', priority: '0.9', changefreq: 'weekly' },
  { url: '/essences', priority: '0.8', changefreq: 'weekly' },
  { url: '/weapon-essence-solver', priority: '0.8', changefreq: 'weekly' },
  { url: '/factory-planner', priority: '0.9', changefreq: 'weekly' },
  { url: '/factory-planner/planner', priority: '0.9', changefreq: 'weekly' },
  { url: '/factory-planner/recipes', priority: '0.8', changefreq: 'weekly' },
  { url: '/interactive-map', priority: '0.9', changefreq: 'weekly' },
  { url: '/interactive-map/valley-iv', priority: '0.9', changefreq: 'weekly' },
  { url: '/interactive-map/wuling', priority: '0.9', changefreq: 'weekly' },
  { url: '/community-plans', priority: '0.8', changefreq: 'daily' },
  { url: '/summon-simulator', priority: '0.8', changefreq: 'weekly' },
  { url: '/guides', priority: '0.6', changefreq: 'weekly' },
  { url: '/guides/essences', priority: '0.85', changefreq: 'monthly' },
  { url: '/guides/artificing', priority: '0.85', changefreq: 'monthly' },
  { url: '/guides/gacha-rates-pity', priority: '0.85', changefreq: 'monthly' },
  { url: '/guides/factory-basics', priority: '0.85', changefreq: 'monthly' },
  { url: '/guides/character-building', priority: '0.85', changefreq: 'monthly' },
  { url: '/guides/factory-equipment', priority: '0.85', changefreq: 'monthly' },
  { url: '/guides/team-building', priority: '0.85', changefreq: 'monthly' },
  { url: '/character-planner', priority: '0.7', changefreq: 'weekly' },
  { url: '/community-builds', priority: '0.7', changefreq: 'weekly' },
  { url: '/character-showcase', priority: '0.7', changefreq: 'weekly' },
  { url: '/headhunt-tracker', priority: '0.7', changefreq: 'weekly' },
  { url: '/ascension-planner', priority: '0.8', changefreq: 'weekly' },
  { url: '/achievement-tracker', priority: '0.8', changefreq: 'weekly' },
  { url: '/community-factories', priority: '1.0', changefreq: 'daily' },
];

// Load factory blueprint slugs from item-slugs.json (dynamically generated)
let FACTORY_BLUEPRINT_SLUGS = [];
try {
  const itemSlugsText = fs.readFileSync(itemSlugsPath, 'utf8');
  const itemSlugs = JSON.parse(itemSlugsText);
  FACTORY_BLUEPRINT_SLUGS = itemSlugs.allSlugs || [];
  console.log(`✓ Loaded ${FACTORY_BLUEPRINT_SLUGS.length} factory blueprint slugs from item-slugs.json`);
} catch (error) {
  console.error('Error loading factory blueprint slugs:', error.message);
  console.warn('  Factory blueprint pages will not be included in sitemap');
}

// Load character data
let characterUrls = [];
let buildUrls = [];
try {
  const characterTableText = fs.readFileSync(characterTablePath, 'utf8');
  const characterTable = JSONbig.parse(characterTableText);

  // Use Set to track unique slugs and prevent duplicates
  const seenCharacterSlugs = new Set();

  characterUrls = Object.values(characterTable)
    .map(character => {
      const slug = getCharacterSlug(character);
      return { slug, character };
    })
    .filter(({ slug }) => {
      if (seenCharacterSlugs.has(slug)) {
        return false; // Skip duplicate
      }
      seenCharacterSlugs.add(slug);
      return true;
    })
    .map(({ slug }) => ({
      url: `/characters/${slug}`,
      priority: '1.0',  // Super important - character detail pages are primary content
      changefreq: 'daily'
    }));

  // Generate character build pages (reuses same character data, already deduplicated)
  const seenBuildSlugs = new Set();
  buildUrls = Object.values(characterTable)
    .map(character => {
      const slug = getCharacterSlug(character);
      return { slug, character };
    })
    .filter(({ slug }) => {
      if (seenBuildSlugs.has(slug)) {
        return false; // Skip duplicate
      }
      seenBuildSlugs.add(slug);
      return true;
    })
    .map(({ slug }) => ({
      url: `/community-builds/build/${slug}`,
      priority: '0.5',
      changefreq: 'weekly'
    }));

  console.log(`✓ Loaded ${characterUrls.length} character pages`);
  console.log(`✓ Loaded ${buildUrls.length} character build pages`);
} catch (error) {
  console.error('Error loading character data:', error.message);
}

// Load weapon data
let weaponUrls = [];
try {
  const weaponTableText = fs.readFileSync(weaponTablePath, 'utf8');
  const i18nText = fs.readFileSync(i18nPath, 'utf8');

  const weaponTable = JSONbig.parse(weaponTableText);
  const i18n = JSONbig.parse(i18nText);

  weaponUrls = Object.values(weaponTable).map(weapon => {
    const slug = getWeaponSlug(weapon, i18n);
    return {
      url: `/weapons/${slug}`,
      priority: '0.8',
      changefreq: 'weekly'
    };
  });

  console.log(`✓ Loaded ${weaponUrls.length} weapon pages`);
} catch (error) {
  console.error('Error loading weapon data:', error.message);
}

// Load equipment set data
let equipmentUrls = [];
try {
  const suitTableText = fs.readFileSync(suitTablePath, 'utf8');
  const i18nText = fs.readFileSync(i18nPath, 'utf8');

  const suitTable = JSONbig.parse(suitTableText);
  const i18n = JSONbig.parse(i18nText);

  equipmentUrls = Object.entries(suitTable).map(([suitId, suit]) => {
    const slug = getSuitSlug(suit, i18n);
    return {
      url: `/equipment/sets/${slug}`,
      priority: '0.8',
      changefreq: 'weekly'
    };
  });

  console.log(`✓ Loaded ${equipmentUrls.length} equipment set pages`);
} catch (error) {
  console.error('Error loading equipment data:', error.message);
}

// Generate sitemap XML
let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

// Helper to ensure URL has trailing slash (required for Next.js trailingSlash: true config)
function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : url + '/';
}

// Add static pages
xml += '  <!-- Main Pages -->\n';
staticPages.forEach(page => {
  xml += '  <url>\n';
  xml += `    <loc>${baseUrl}${ensureTrailingSlash(page.url)}</loc>\n`;
  xml += `    <lastmod>${today}</lastmod>\n`;
  xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
  xml += `    <priority>${page.priority}</priority>\n`;
  xml += '  </url>\n';
});

// Add character pages
if (characterUrls.length > 0) {
  xml += '\n  <!-- Character Pages -->\n';
  characterUrls.forEach(page => {
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}${ensureTrailingSlash(page.url)}</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
    xml += `    <priority>${page.priority}</priority>\n`;
    xml += '  </url>\n';
  });
}

// Add character build pages
if (buildUrls.length > 0) {
  xml += '\n  <!-- Character Build Pages -->\n';
  buildUrls.forEach(page => {
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}${ensureTrailingSlash(page.url)}</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
    xml += `    <priority>${page.priority}</priority>\n`;
    xml += '  </url>\n';
  });
}

// Add weapon pages
if (weaponUrls.length > 0) {
  xml += '\n  <!-- Weapon Pages -->\n';
  weaponUrls.forEach(page => {
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}${ensureTrailingSlash(page.url)}</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
    xml += `    <priority>${page.priority}</priority>\n`;
    xml += '  </url>\n';
  });
}

// Add equipment set pages
if (equipmentUrls.length > 0) {
  xml += '\n  <!-- Equipment Set Pages -->\n';
  equipmentUrls.forEach(page => {
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}${ensureTrailingSlash(page.url)}</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
    xml += `    <priority>${page.priority}</priority>\n`;
    xml += '  </url>\n';
  });
}

// Add factory blueprint pages
if (FACTORY_BLUEPRINT_SLUGS.length > 0) {
  xml += '\n  <!-- Factory Blueprint Pages -->\n';
  FACTORY_BLUEPRINT_SLUGS.forEach(slug => {
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/community-factories/blueprints/${slug}/</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += `    <changefreq>daily</changefreq>\n`;
    xml += `    <priority>1.0</priority>\n`;  // Super important - community factory blueprints
    xml += '  </url>\n';
  });
}

xml += '</urlset>\n';

// Write sitemap
fs.writeFileSync(outputPath, xml);

console.log('='.repeat(80));
console.log(`✓ Sitemap generated successfully!`);
console.log(`  Location: ${outputPath}`);
console.log(`  Total URLs: ${staticPages.length + characterUrls.length + buildUrls.length + weaponUrls.length + equipmentUrls.length + FACTORY_BLUEPRINT_SLUGS.length}`);
console.log(`    - Static pages: ${staticPages.length}`);
console.log(`    - Character pages: ${characterUrls.length}`);
console.log(`    - Character build pages: ${buildUrls.length}`);
console.log(`    - Weapon pages: ${weaponUrls.length}`);
console.log(`    - Equipment set pages: ${equipmentUrls.length}`);
console.log(`    - Factory blueprint pages: ${FACTORY_BLUEPRINT_SLUGS.length}`);

// ============================================================================
// GENERATE STRUCTURED DATA (Schema.org JSON-LD)
// ============================================================================

console.log('');
console.log('Generating structured-data.json...');

const structuredData = {};

// 1. Home page - WebSite schema with search action
structuredData['home'] = generateWebSiteSchema();

// 2. Static pages - BreadcrumbList schemas
staticPages.forEach(page => {
  if (page.url === '/') return; // Skip home, already added WebSite schema

  const key = urlToKey(page.url);
  const breadcrumbs = buildBreadcrumbTrail(page.url);
  structuredData[key] = generateBreadcrumbSchema(breadcrumbs);
});

// 3. Community Factories sub-pages - Blueprints
// Add the blueprints parent page breadcrumb
structuredData['community-factories-blueprints'] = generateBreadcrumbSchema([
  { name: 'Home', url: `${baseUrl}/` },
  { name: 'AIC Factory Blueprints', url: `${baseUrl}/community-factories` },
  { name: 'Blueprints', url: `${baseUrl}/community-factories/blueprints` }
]);

// Write structured data
fs.writeFileSync(structuredDataPath, JSON.stringify(structuredData, null, 2));

console.log(`✓ Structured data generated successfully!`);
console.log(`  Location: ${structuredDataPath}`);
console.log(`  Total schemas: ${Object.keys(structuredData).length}`);
console.log('');
