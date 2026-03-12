const fs = require('fs');
const path = require('path');
const JSONbig = require('json-bigint')({ storeAsString: true });

// Load suit table with json-bigint to preserve large i18n IDs
const suitTablePath = path.join(process.cwd(), 'public/localdb/endfield_data/EquipSuitTable.json');
const i18nPath = path.join(process.cwd(), 'public/localdb/lang/I18nTextTable_EN.json');

const suitTableText = fs.readFileSync(suitTablePath, 'utf8');
const i18nText = fs.readFileSync(i18nPath, 'utf8');

const suitTable = JSONbig.parse(suitTableText);
const i18n = JSONbig.parse(i18nText);

console.log('Equipment Set Slugs (with json-bigint):');
console.log('='.repeat(80));

// Get suits with their English names
Object.keys(suitTable).forEach(suitId => {
  const data = suitTable[suitId];
  const nameI18nId = data.list[0]?.suitName?.id?.toString() || '0';
  const engName = i18n[nameI18nId] || suitId;
  const slug = (engName || suitId)
    .replace(/^suit_/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  console.log(`${suitId.padEnd(20)} | ${(engName || 'NO NAME').padEnd(40)} | ${slug}`);
});

console.log('\nSitemap URLs:');
console.log('='.repeat(80));
Object.keys(suitTable).forEach(suitId => {
  const data = suitTable[suitId];
  const nameI18nId = data.list[0]?.suitName?.id?.toString() || '0';
  const engName = i18n[nameI18nId] || suitId;
  const slug = (engName || suitId)
    .replace(/^suit_/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  console.log(`https://endfieldtools.dev/equipment/sets/${slug}`);
});
