#!/usr/bin/env node

const fs = require('fs');
const JSONbig = require('json-bigint')({ storeAsString: true });

// Load i18n for names
const i18n = JSONbig.parse(fs.readFileSync('public/localdb/optimized/i18n/I18nTextTable_EN.json', 'utf8'));

function getName(nameObj) {
  if (!nameObj) return 'Unknown';
  const id = String(nameObj.id);
  return i18n[id] || nameObj.text || id;
}

// ============= WEAPONS =============
console.log('\n' + '='.repeat(60));
console.log('WEAPONS WITH DIFFERENT MODEL PATH');
console.log('='.repeat(60));

const weaponData = JSONbig.parse(fs.readFileSync('extracted_data/TableCfg/WeaponBasicTable.json', 'utf8'));

const weaponRedirects = [];
Object.entries(weaponData).forEach(([id, data]) => {
  const modelMatch = data.modelPath ? data.modelPath.match(/([^/]+)\.prefab$/) : null;
  const modelId = modelMatch ? modelMatch[1] : null;

  if (modelId && modelId !== id && weaponData[modelId]) {
    const name = getName(data.engName);
    const targetName = getName(weaponData[modelId].engName);
    weaponRedirects.push({ weaponId: id, name, modelId, targetName });
  }
});

if (weaponRedirects.length > 0) {
  weaponRedirects.forEach(r => {
    console.log('\n  ' + r.weaponId + ' ("' + r.name + '")');
    console.log('    -> uses data from: ' + r.modelId + ' ("' + r.targetName + '")');
  });
  console.log('\nTotal: ' + weaponRedirects.length + ' weapons with redirects');
} else {
  console.log('\nNo weapons with modelPath redirects found.');
}

// ============= CHARACTERS =============
console.log('\n' + '='.repeat(60));
console.log('CHARACTERS - CHECKING FOR SIMILAR PATTERNS');
console.log('='.repeat(60));

const charData = JSONbig.parse(fs.readFileSync('extracted_data/TableCfg/CharacterTable.json', 'utf8'));
const firstChar = Object.values(charData)[0];

// Show path-related fields
const charPathFields = Object.keys(firstChar).filter(k =>
  k.toLowerCase().includes('path') ||
  k.toLowerCase().includes('model') ||
  k.toLowerCase().includes('prefab')
);

console.log('\nPath-related fields in CharacterTable:');
if (charPathFields.length > 0) {
  charPathFields.forEach(f => {
    console.log('  - ' + f + ': ' + JSON.stringify(firstChar[f]).substring(0, 80));
  });
} else {
  console.log('  None found');
}

// Check for ID mismatches
let charRedirects = 0;
Object.entries(charData).forEach(([id, data]) => {
  if (data.charId && data.charId !== id) {
    const name = getName(data.charName);
    console.log('\n  Mismatch: key=' + id + ', charId=' + data.charId + ' ("' + name + '")');
    charRedirects++;
  }
});

console.log('\nCharacters with ID mismatches: ' + charRedirects);

// ============= EQUIPMENT =============
console.log('\n' + '='.repeat(60));
console.log('EQUIPMENT - CHECKING FOR SIMILAR PATTERNS');
console.log('='.repeat(60));

const equipData = JSONbig.parse(fs.readFileSync('extracted_data/TableCfg/EquipTable.json', 'utf8'));
const firstEquip = Object.values(equipData)[0];

// Show path-related fields
const equipPathFields = Object.keys(firstEquip).filter(k =>
  k.toLowerCase().includes('path') ||
  k.toLowerCase().includes('model') ||
  k.toLowerCase().includes('prefab')
);

console.log('\nPath-related fields in EquipmentTable:');
if (equipPathFields.length > 0) {
  equipPathFields.forEach(f => {
    console.log('  - ' + f + ': ' + JSON.stringify(firstEquip[f]).substring(0, 80));
  });
} else {
  console.log('  None found');
}

// Check for ID mismatches
let equipRedirects = 0;
Object.entries(equipData).forEach(([id, data]) => {
  if (data.equipId && data.equipId !== id) {
    const name = getName(data.equipName);
    console.log('\n  Mismatch: key=' + id + ', equipId=' + data.equipId + ' ("' + name + '")');
    equipRedirects++;
  }
});

console.log('\nEquipment with ID mismatches: ' + equipRedirects);

console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));
console.log('\n  Weapons with modelPath redirect: ' + weaponRedirects.length);
console.log('  Characters with ID mismatch: ' + charRedirects);
console.log('  Equipment with ID mismatch: ' + equipRedirects);
console.log('');
