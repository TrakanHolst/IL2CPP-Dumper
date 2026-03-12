const fs = require('fs');
const mapData = JSON.parse(fs.readFileSync('public/localdb/optimized/map/map01-data.json', 'utf8'));

// Simple layer detection - only uses tierIndex
function getPOILayer(poi) {
  if (poi.tierIndex !== undefined && poi.tierIndex !== 0) {
    if (poi.tierIndex < 0) return 1; // Underground
    else if (poi.tierIndex > 0) return 2; // Top
  }
  return 0; // Base
}

const LAYER_NAMES = ['Base', 'Underground', 'Top'];

console.log('=== Test POIs with Simplified Logic ===\n');

// Test POI 1: High-Tier Chest at lv005 (586, 88, -145)
let poi = Object.values(mapData.poiData).find(p => p.id === 'map01_lv005_3400020119');
console.log('1. High-Tier Chest (lv005, Y=88):');
console.log('   tierIndex:', poi.tierIndex);
console.log('   Layer:', LAYER_NAMES[getPOILayer(poi)], `(${getPOILayer(poi)})`);

// Test POI 2: Chest at lv005 (590, 97, -376) - user says should be Base
poi = Object.values(mapData.poiData).find(p => p.id === 'map01_lv005_3400090436');
console.log('\n2. Chest (lv005, Y=97):');
console.log('   tierIndex:', poi.tierIndex);
console.log('   Layer:', LAYER_NAMES[getPOILayer(poi)], `(${getPOILayer(poi)})`);

// Test POI 3: White Fragment at lv006 - should be Base
poi = Object.values(mapData.poiData).find(p => p.id === 'map01_lv006_3500022189');
console.log('\n3. White Fragment (lv006):');
console.log('   tierIndex:', poi.tierIndex);
console.log('   Layer:', LAYER_NAMES[getPOILayer(poi)], `(${getPOILayer(poi)})`);

// Test POI 4: Chest at lv006 (503, 41, 241) - should be Base
poi = Object.values(mapData.poiData).find(p => p.id === 'map01_lv006_3500031184');
console.log('\n4. Chest (lv006, Y=41):');
console.log('   tierIndex:', poi.tierIndex);
console.log('   Layer:', LAYER_NAMES[getPOILayer(poi)], `(${getPOILayer(poi)})`);

// Test POI 5: Chest with tierIndex -1 at lv006 - should be Underground
poi = Object.values(mapData.poiData).find(p => p.id === 'map01_lv006_3500021871');
console.log('\n5. Chest with tierIndex=-1 (lv006):');
console.log('   tierIndex:', poi.tierIndex);
console.log('   Layer:', LAYER_NAMES[getPOILayer(poi)], `(${getPOILayer(poi)})`);

// Summary of POIs by tierIndex
console.log('\n=== POI TierIndex Distribution ===\n');
const tierIndexCounts = {};
for (const poi of Object.values(mapData.poiData)) {
  const ti = poi.tierIndex === undefined ? 'undefined' : poi.tierIndex;
  tierIndexCounts[ti] = (tierIndexCounts[ti] || 0) + 1;
}
for (const [ti, count] of Object.entries(tierIndexCounts).sort((a, b) => {
  const aVal = a[0] === 'undefined' ? 999 : parseInt(a[0]);
  const bVal = b[0] === 'undefined' ? 999 : parseInt(b[0]);
  return aVal - bVal;
})) {
  console.log(`tierIndex ${ti}: ${count} POIs`);
}
