#!/usr/bin/env node

/**
 * Generate Map Data
 *
 * Unified script to generate all map-related data files from extracted_data:
 * 1. ExtractedPOIData.json - All POI coordinates from level data files
 * 2. InteractiveTable.json - Interactive entity translation mappings
 * 3. TextTable.json - String key to I18n ID mappings (copied)
 *
 * Usage: npm run generate:map-data
 */

const fs = require('fs');
const path = require('path');
const JSONbig = require('json-bigint')({ storeAsString: true });

// Paths
const extractedDataDir = path.join(__dirname, '../extracted_data');
const levelDataDir = path.join(extractedDataDir, 'Json/LevelData');
const levelConfigDir = path.join(extractedDataDir, 'Json/LevelConfig');
const interactiveDataDir = path.join(extractedDataDir, 'Json/Interactive/InteractiveData');
const textTablePath = path.join(extractedDataDir, 'TableCfg/TextTable.json');
const levelMapMarkPath = path.join(extractedDataDir, 'DynamicAssets/gamedata/levelgenforruntime/LevelMapMark.json');
const dungeonSeriesTablePath = path.join(extractedDataDir, 'TableCfg/DungeonSeriesTable.json');
const mapMarkTempTablePath = path.join(extractedDataDir, 'TableCfg/MapMarkTempTable.json');
// Output to extracted_data/aggregated/ instead of public (public should only contain optimized files)
const outputDir = path.join(extractedDataDir, 'aggregated');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// ==============================================================================
// PART 1: Extract POI Data from Level Files
// ==============================================================================

console.log('\n=== PART 1: Extracting POI Data ===\n');

// Load DoodadGeneralTable for nameI18nId mappings
// Use JSONbig to preserve large integer precision
const doodadGeneralTablePath = path.join(extractedDataDir, 'tableCfg/DoodadGeneralTable.json');
let doodadGeneralTable = {};
if (fs.existsSync(doodadGeneralTablePath)) {
  doodadGeneralTable = JSONbig.parse(fs.readFileSync(doodadGeneralTablePath, 'utf-8'));
  console.log(`Loaded DoodadGeneralTable with ${Object.keys(doodadGeneralTable).length} entries`);
} else {
  console.warn('DoodadGeneralTable.json not found - POI names will not be translated');
}

// Load EnemyTemplateDisplayInfoTable for enemy nameI18nId
const enemyDisplayTablePath = path.join(extractedDataDir, 'tableCfg/EnemyTemplateDisplayInfoTable.json');
let enemyDisplayTable = {};
if (fs.existsSync(enemyDisplayTablePath)) {
  enemyDisplayTable = JSONbig.parse(fs.readFileSync(enemyDisplayTablePath, 'utf-8'));
  console.log(`Loaded EnemyTemplateDisplayInfoTable with ${Object.keys(enemyDisplayTable).length} entries`);
} else {
  console.warn('EnemyTemplateDisplayInfoTable.json not found - Enemy names will not be translated');
}

// Load CollectionTable for collection POI to item mappings
const collectionTablePath = path.join(outputDir, 'CollectionTable.json');
let collectionTable = {};
if (fs.existsSync(collectionTablePath)) {
  collectionTable = JSON.parse(fs.readFileSync(collectionTablePath, 'utf-8'));
  console.log(`Loaded CollectionTable with ${Object.keys(collectionTable).length} entries`);
} else {
  console.warn('CollectionTable.json not found - Collection POI names will not be translated via items');
}

// Load ItemTable for item nameI18nId
const itemTablePath = path.join(extractedDataDir, 'tableCfg/ItemTable.json');
let itemTable = {};
if (fs.existsSync(itemTablePath)) {
  itemTable = JSONbig.parse(fs.readFileSync(itemTablePath, 'utf-8'));
  console.log(`Loaded ItemTable with ${Object.keys(itemTable).length} entries`);
} else {
  console.warn('ItemTable.json not found - Collection POI names will not be translated via items');
}

// Build entity → doodad_id mapping from template variant data
function buildEntityToDoodadMapping() {
  const mapping = {};

  // Check if directory exists
  if (!fs.existsSync(interactiveDataDir)) {
    console.warn(`InteractiveData directory not found: ${interactiveDataDir}`);
    return mapping;
  }

  const variantFiles = fs.readdirSync(interactiveDataDir).filter(f => f.startsWith('data_int_') && f.endsWith('.json'));

  for (const file of variantFiles) {
    try {
      const filePath = path.join(interactiveDataDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      if (data.templateVariant && typeof data.templateVariant === 'object') {
        for (const [variantKey, variantData] of Object.entries(data.templateVariant)) {
          // Extract doodad_id from diffProperties
          if (variantData.diffProperties && Array.isArray(variantData.diffProperties)) {
            const doodadIdProp = variantData.diffProperties.find(prop => prop.key === 'doodad_id');
            if (doodadIdProp && doodadIdProp.value?.valueArray?.[0]?.valueString) {
              const doodadId = doodadIdProp.value.valueArray[0].valueString;
              mapping[variantKey] = doodadId;
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Error processing variant file ${file}:`, error.message);
    }
  }

  return mapping;
}

const entityToDoodadMapping = buildEntityToDoodadMapping();
console.log(`Built entity→doodad mapping with ${Object.keys(entityToDoodadMapping).length} entries`);

// Load map-config.json for recategorization and exclusions
const mapConfigPath = path.join(__dirname, 'data-optimization/map-config.json');
let mapConfig = { recategorize: {}, excludePOITypes: [] };
if (fs.existsSync(mapConfigPath)) {
  mapConfig = JSON.parse(fs.readFileSync(mapConfigPath, 'utf-8'));
  console.log(`Loaded map-config.json with ${Object.keys(mapConfig.recategorize || {}).length} recategorizations`);
} else {
  console.warn('map-config.json not found - using default categorization');
}

// ==============================================================================
// Build tierIndex lookup from LevelMapMark.json for POI layer detection
// ==============================================================================

/**
 * Build a position-based lookup map for tierIndex from LevelMapMark.json
 * Key: rounded position "x_z" (to 0.1 precision)
 * Value: { tierIndex, tierMap }
 */
function buildTierIndexLookup() {
  const tierLookup = new Map();

  if (!fs.existsSync(levelMapMarkPath)) {
    console.warn('LevelMapMark.json not found - tierIndex lookup will be empty');
    return tierLookup;
  }

  const levelMapMarkData = JSON.parse(fs.readFileSync(levelMapMarkPath, 'utf-8'));
  let count = 0;

  // Iterate through each section
  Object.entries(levelMapMarkData).forEach(([sectionId, marks]) => {
    marks.forEach(mark => {
      const basicData = mark.basicData;
      if (!basicData || !basicData.pos) return;

      // Round position to 0.1 precision for matching
      const x = Math.round(basicData.pos.x * 10) / 10;
      const z = Math.round(basicData.pos.z * 10) / 10;
      const key = `${x}_${z}`;

      // Store tierIndex (default to 0 if not present)
      const tierIndex = basicData.tierIndex !== undefined ? basicData.tierIndex : 0;
      const tierMap = basicData.tierMap || 0;

      // Store the tier info (prefer non-zero tierIndex if multiple marks at same position)
      if (!tierLookup.has(key) || (tierIndex !== 0 && tierLookup.get(key).tierIndex === 0)) {
        tierLookup.set(key, { tierIndex, tierMap });
      }
      count++;
    });
  });

  console.log(`Built tierIndex lookup with ${tierLookup.size} unique positions from ${count} marks`);

  // Log some stats about tier distribution
  let tier0 = 0, tierNeg1 = 0, tierNeg2 = 0, tier1 = 0;
  tierLookup.forEach(({ tierIndex }) => {
    if (tierIndex === 0) tier0++;
    else if (tierIndex === -1) tierNeg1++;
    else if (tierIndex === -2) tierNeg2++;
    else if (tierIndex === 1) tier1++;
  });
  console.log(`  Tier distribution: base(0)=${tier0}, underground(-1)=${tierNeg1}, deep(-2)=${tierNeg2}, top(1)=${tier1}`);

  return tierLookup;
}

/**
 * Find tierIndex for a POI position
 * Tries exact match first, then searches nearby positions
 */
function findTierIndexForPosition(tierLookup, x, z) {
  // Round to 0.1 precision
  const rx = Math.round(x * 10) / 10;
  const rz = Math.round(z * 10) / 10;
  const exactKey = `${rx}_${rz}`;

  // Try exact match
  if (tierLookup.has(exactKey)) {
    return tierLookup.get(exactKey).tierIndex;
  }

  // Try nearby positions (within 1.0 unit tolerance)
  for (let dx = -1; dx <= 1; dx += 0.1) {
    for (let dz = -1; dz <= 1; dz += 0.1) {
      const nearKey = `${Math.round((rx + dx) * 10) / 10}_${Math.round((rz + dz) * 10) / 10}`;
      if (tierLookup.has(nearKey)) {
        return tierLookup.get(nearKey).tierIndex;
      }
    }
  }

  return null; // No matching mark found
}

const tierIndexLookup = buildTierIndexLookup();

// Categories for different interactive entity types
// Matching zmdmap.com's categorization structure
const ENTITY_CATEGORIES = {
  // === Treasure Chests (trchest 宝箱) ===
  'int_trchest_common': 'chest',
  'int_trchest_common_high': 'chest',
  'int_trchest_common_normal': 'chest',
  'int_trchest_lock': 'chest',

  // === Collectibles (收集品) ===
  'int_collection_coin': 'collectible',
  'int_collection_coin_puzzle': 'collectible',
  'int_collection_common': 'collectible', // White Fragments

  // === Events (事件) ===
  'int_collection_piece': 'events', // Puzzle Pieces (not collectibles)

  // === Ether Resources (ether 醚质) ===
  'int_doodad_core_recycle': 'ether',

  // === Minerals (mineral 矿物) - Individual mining nodes ===
  'int_doodad_core_mine_iron': 'mineral',
  'int_doodad_core_mine_originium': 'mineral',
  'int_doodad_core_mine_quartz': 'mineral',
  'int_doodad_core_mine_copper': 'mineral',

  // === Mining Formations (formation 矿脉) - Ore clusters (excluded by default) ===
  'int_doodad_ore_cluster_iron': 'formation',
  'int_doodad_ore_cluster_originium': 'formation',
  'int_doodad_ore_cluster_quartz': 'formation',

  // === Rare Minerals (spcstone 稀有矿物) ===
  'int_doodad_core_spcstone': 'spcstone',
  'int_doodad_spcstone_1_1': 'spcstone',

  // === Plant Materials (plant 植物类素材) ===
  'int_doodad_core_plant_rabbithole': 'plant',
  'int_doodad_crylplant_1_1': 'plant',
  'int_doodad_mushroom_1_1': 'plant',
  'int_doodad_core_plant': 'plant',

  // === Narrative Fragments (narrative 世界叙事碎片) ===
  'int_narrative_common': 'narrative',
  'int_narrative_mission': 'narrative',
  'int_narrative_scene': 'narrative',

  // === Dungeons (dungeon 副本点位) ===
  'int_dungeon_spot': 'dungeon',
  'int_dungeon_exit': 'dungeon',
  'int_system_dungeon_entry': 'dungeon',

  // === Daily Instances (system 日常副本) ===
  'int_challenge_start_point': 'system',
  'int_challenge_start_point_once': 'system',

  // === Battles/Enemies (enemy 敌人) ===
  'int_system_world_energy_point': 'battle',

  // === Fast Travel (travel 快速旅行) ===
  'int_campfire_v2': 'travel',

  // === Terminals (terminal 终端) ===
  'int_001_comm_terminal': 'terminal',
  'gantry_terminal1': 'terminal',
  'gantry_terminal2': 'terminal',
  'gantry_terminal3': 'terminal',

  // === Other ===
  'int_blackbox_entry': 'other',
  'int_doodad_grade': 'other',
  'int_doodad_common': 'other',
};

/**
 * Get category for an entity type
 * Uses exact match first, then pattern matching for variants
 * Applies recategorization from map-config.json
 */
function getCategoryForEntity(entityType) {
  // Check if entity type is excluded
  if (mapConfig.excludePOITypes && mapConfig.excludePOITypes.includes(entityType)) {
    return null; // Exclude this POI type
  }

  // Apply recategorization from config first
  if (mapConfig.recategorize && mapConfig.recategorize[entityType]) {
    return mapConfig.recategorize[entityType];
  }

  // Try exact match in ENTITY_CATEGORIES
  if (ENTITY_CATEGORIES[entityType]) {
    return ENTITY_CATEGORIES[entityType];
  }

  // Pattern matching for variants
  if (entityType.startsWith('int_trchest_')) return 'chest';
  if (entityType.startsWith('int_collection_')) return 'collectible';
  if (entityType.startsWith('int_doodad_core_recycle')) return 'ether';
  if (entityType.startsWith('int_doodad_core_mine_')) return 'mineral';
  if (entityType.startsWith('int_doodad_ore_cluster_')) return 'formation'; // Ore clusters are formation, not mineral
  if (entityType.startsWith('int_doodad_core_spcstone') || entityType.startsWith('int_doodad_spcstone_')) return 'spcstone';
  if (entityType.startsWith('int_doodad_core_plant') || entityType.startsWith('int_doodad_crylplant_') || entityType.startsWith('int_doodad_mushroom_') || entityType.startsWith('int_doodad_flower_') || entityType.startsWith('int_doodad_grass_') || entityType.startsWith('int_doodad_bbflower_') || entityType.startsWith('int_doodad_insect_')) return 'plant';
  if (entityType.startsWith('int_narrative_')) return 'narrative';
  if (entityType.startsWith('int_dungeon_') || entityType === 'int_system_dungeon_entry') return 'dungeon';
  if (entityType.startsWith('int_challenge_')) return 'system';
  if (entityType.startsWith('int_campfire_')) return 'travel';
  if (entityType.includes('terminal')) return 'terminal';
  if (entityType.startsWith('int_doodad_')) return 'other';

  return null; // Unknown entity type
}

/**
 * Get nameI18nId for an entity type (doodads, plants, resources)
 * Looks up: entityType → doodad_id → label.id (nameI18nId)
 * Returns as string (preserved by json-bigint parser)
 */
function getNameI18nId(entityType) {
  // Look up doodad_id from entity type
  const doodadId = entityToDoodadMapping[entityType];
  if (!doodadId) return null;

  // Look up label.id from DoodadGeneralTable (already string from json-bigint)
  const doodadEntry = doodadGeneralTable[doodadId];
  if (!doodadEntry || !doodadEntry.label) return null;

  const nameI18nId = doodadEntry.label.id;

  // Filter out invalid IDs (string "0" or "-1")
  if (nameI18nId === "0" || nameI18nId === "-1" || nameI18nId === 0 || nameI18nId === -1) return null;

  // Already a string from json-bigint
  return nameI18nId;
}

/**
 * Get nameI18nId for an enemy type
 * Looks up: enemyId → name.id (nameI18nId)
 * Returns as string (preserved by json-bigint parser)
 */
function getEnemyNameI18nId(enemyId) {
  // Look up enemy in EnemyTemplateDisplayInfoTable
  const enemyInfo = enemyDisplayTable[enemyId];
  if (!enemyInfo || !enemyInfo.name) return null;

  const nameI18nId = enemyInfo.name.id;

  // Filter out invalid IDs (string "0" or "-1")
  if (nameI18nId === "0" || nameI18nId === "-1" || nameI18nId === 0 || nameI18nId === -1) return null;

  // Already a string from json-bigint
  return nameI18nId;
}

/**
 * Get nameI18nId for collection/interactive types via ItemTable
 * Looks up: entityType → itemId (from CollectionTable) → name.id (from ItemTable)
 * Returns as string (preserved by json-bigint parser)
 */
function getCollectionNameI18nId(entityType) {
  // Look up entity in CollectionTable
  const collectionInfo = collectionTable[entityType];
  if (!collectionInfo) {
    return null;
  }

  if (!collectionInfo.itemId || collectionInfo.itemId === "") {
    return null;
  }

  const itemId = collectionInfo.itemId;

  // Look up item in ItemTable
  const itemInfo = itemTable[itemId];
  if (!itemInfo || !itemInfo.name) return null;

  const nameI18nId = itemInfo.name.id;

  // Filter out invalid IDs (string "0" or "-1")
  if (nameI18nId === "0" || nameI18nId === "-1" || nameI18nId === 0 || nameI18nId === -1) return null;

  // Already a string from json-bigint
  return nameI18nId;
}

function extractPOIs() {
  const pois = [];
  const unknownEntities = new Set(); // Track unknown entity types for debugging

  if (!fs.existsSync(levelDataDir)) {
    console.warn(`Level data directory not found: ${levelDataDir}`);
    return pois;
  }

  const levelFolders = fs.readdirSync(levelDataDir).filter(folder => {
    const fullPath = path.join(levelDataDir, folder);
    return fs.statSync(fullPath).isDirectory();
  });

  console.log(`Processing ${levelFolders.length} level folders...`);

  for (const levelFolder of levelFolders) {
    const levelPath = path.join(levelDataDir, levelFolder);
    const jsonFiles = fs.readdirSync(levelPath).filter(f => f.endsWith('.json'));

    for (const jsonFile of jsonFiles) {
      const filePath = path.join(levelPath, jsonFile);

      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const sceneId = data.sceneId || levelFolder;

        // Process interactives
        if (data.interactives && Array.isArray(data.interactives)) {
          for (const interactive of data.interactives) {
            const entityType = interactive.entityDataIdKey;
            const category = getCategoryForEntity(entityType);

            // Skip dungeon entries - they are handled by LevelMapMarks (PART 5)
            // which has proper unique entityTypes (systemInstId) for each dungeon
            if (category === 'dungeon') continue;

            if (category && interactive.position) {
              const poi = {
                id: `${sceneId}_${interactive.levelLogicId}`,
                sceneId,
                levelLogicId: interactive.levelLogicId,
                entityType,
                category,
                position: interactive.position,
                rotation: interactive.rotation || null,
                isLocked: interactive.isLocked || false,
              };

              // Add tierIndex from LevelMapMark.json lookup
              const tierIndex = findTierIndexForPosition(
                tierIndexLookup,
                interactive.position.x,
                interactive.position.z
              );
              if (tierIndex !== null) {
                poi.tierIndex = tierIndex;
              }

              // Add nameI18nId if available
              // Try multiple lookup methods in order:
              // 1. Doodad lookup (for plants, minerals, etc.)
              // 2. Collection lookup (for coins, collectibles)
              let nameI18nId = getNameI18nId(entityType);
              if (!nameI18nId) {
                nameI18nId = getCollectionNameI18nId(entityType);
              }
              if (nameI18nId) {
                poi.nameI18nId = nameI18nId;
              }

              pois.push(poi);
            } else if (interactive.position) {
              unknownEntities.add(entityType);
            }
          }
        }

        // Process enemies (battle encounters)
        if (data.enemies && Array.isArray(data.enemies)) {
          for (const enemy of data.enemies) {
            if (enemy.position) {
              const enemyId = enemy.entityDataIdKey || 'enemy';
              const poi = {
                id: `${sceneId}_eny_${enemy.levelLogicId}`,
                sceneId,
                levelLogicId: enemy.levelLogicId,
                entityType: enemyId,
                category: 'battle',
                position: enemy.position,
                rotation: enemy.rotation || null,
                isLocked: false,
              };

              // Add tierIndex from LevelMapMark.json lookup
              const tierIndex = findTierIndexForPosition(
                tierIndexLookup,
                enemy.position.x,
                enemy.position.z
              );
              if (tierIndex !== null) {
                poi.tierIndex = tierIndex;
              }

              // Add nameI18nId for enemies
              const nameI18nId = getEnemyNameI18nId(enemyId);
              if (nameI18nId) {
                poi.nameI18nId = nameI18nId;
              }

              pois.push(poi);
            }
          }
        }
      } catch (error) {
        console.warn(`Error processing ${jsonFile}:`, error.message);
      }
    }
  }

  // Report unknown entity types
  if (unknownEntities.size > 0) {
    console.log(`\nFound ${unknownEntities.size} unknown entity types (not extracted):`);
    Array.from(unknownEntities).slice(0, 20).forEach(e => console.log(`  - ${e}`));
    if (unknownEntities.size > 20) {
      console.log(`  ... and ${unknownEntities.size - 20} more`);
    }

    // Write full list to file
    const unknownListPath = path.join(outputDir, 'UnknownEntityTypes.txt');
    fs.writeFileSync(unknownListPath, Array.from(unknownEntities).sort().join('\n'));
    console.log(`Full list saved to: ${unknownListPath}`);
  }

  return pois;
}

const extractedPOIs = extractPOIs();
const poiOutputPath = path.join(outputDir, 'ExtractedPOIData.json');
fs.writeFileSync(poiOutputPath, JSON.stringify(extractedPOIs, null, 2));

console.log(`\nExtracted ${extractedPOIs.length} POIs`);
console.log(`Output: ${path.relative(process.cwd(), poiOutputPath)}`);

// POI breakdown
const poiBreakdown = extractedPOIs.reduce((acc, poi) => {
  acc[poi.category] = (acc[poi.category] || 0) + 1;
  return acc;
}, {});

console.log('\nPOI Breakdown:');
Object.entries(poiBreakdown)
  .sort((a, b) => b[1] - a[1])
  .forEach(([category, count]) => {
    console.log(`  ${category}: ${count}`);
  });

// ==============================================================================
// PART 2: Build Interactive Entity Translation Table
// ==============================================================================

console.log('\n=== PART 2: Building Interactive Table ===\n');

function extractTranslationKey(entityData) {
  // Look for translation keys in configProperties
  if (entityData.configProperties && Array.isArray(entityData.configProperties)) {
    for (const prop of entityData.configProperties) {
      // Check for option_general (common interaction option)
      if (prop.key === 'option_general' && prop.value?.type === 'LangKey') {
        const langKey = prop.value.valueArray?.[0]?.valueString;
        if (langKey) return { type: 'option', key: langKey };
      }

      // Check for option_activated (for campfires, terminals)
      if (prop.key === 'option_activated' && prop.value?.type === 'LangKey') {
        const langKey = prop.value.valueArray?.[0]?.valueString;
        if (langKey) return { type: 'option', key: langKey };
      }

      // Check for option_recovery (campfire rest option)
      if (prop.key === 'option_recovery' && prop.value?.type === 'LangKey') {
        const langKey = prop.value.valueArray?.[0]?.valueString;
        if (langKey) return { type: 'option', key: langKey };
      }

      // Check for collect_info (collectible description)
      if (prop.key === 'collect_info' && prop.value?.type === 'LangKey') {
        const langKey = prop.value.valueArray?.[0]?.valueString;
        if (langKey) return { type: 'info', key: langKey };
      }
    }
  }

  // Check in ClickTriggerComponentForIntData for optionName
  if (entityData.componentList && Array.isArray(entityData.componentList)) {
    for (const component of entityData.componentList) {
      if (component.$type?.includes('ClickTriggerComponentForIntData')) {
        if (component.propertyStateData && Array.isArray(component.propertyStateData)) {
          for (const stateData of component.propertyStateData) {
            if (stateData.optionName?.key) {
              return { type: 'option', key: stateData.optionName.key };
            }
          }
        }
      }
    }
  }

  return null;
}

function extractBornTags(entityData) {
  if (entityData.bornTag && Array.isArray(entityData.bornTag)) {
    return entityData.bornTag.map(tag => tag.tagName || tag.tagId);
  }
  return [];
}

function buildInteractiveTable() {
  const interactiveTable = [];

  if (!fs.existsSync(interactiveDataDir)) {
    console.warn(`Interactive data directory not found: ${interactiveDataDir}`);
    return interactiveTable;
  }

  const files = fs.readdirSync(interactiveDataDir).filter(f => f.startsWith('data_') && f.endsWith('.json'));

  console.log(`Processing ${files.length} interactive entity files...`);

  for (const file of files) {
    try {
      const filePath = path.join(interactiveDataDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      if (!data.id || !data.name) continue;

      const translationData = extractTranslationKey(data);
      const bornTags = extractBornTags(data);

      const entry = {
        id: data.id,
        name: data.name,
        factionIndex: data.factionIndex || 'Neutral',
        tags: bornTags,
      };

      // Add translation keys if found
      if (translationData) {
        entry.nameI18nKey = translationData.key;
        entry.translationType = translationData.type;
      }

      // Add model information
      const modelComponent = data.componentList?.find(c => c.$type?.includes('InteractiveModelComponentData'));
      if (modelComponent?.modelId) {
        entry.modelId = modelComponent.modelId;
      }

      // Add template variants
      if (data.templateVariant && Object.keys(data.templateVariant).length > 0) {
        entry.variants = Object.keys(data.templateVariant);
      }

      interactiveTable.push(entry);
    } catch (error) {
      console.warn(`Error processing ${file}:`, error.message);
    }
  }

  return interactiveTable;
}

const interactiveTable = buildInteractiveTable();
const interactiveOutputPath = path.join(outputDir, 'InteractiveTable.json');
fs.writeFileSync(interactiveOutputPath, JSON.stringify(interactiveTable, null, 2));

console.log(`\nCreated interactive table with ${interactiveTable.length} entities`);
console.log(`Output: ${path.relative(process.cwd(), interactiveOutputPath)}`);

// Show sample entries with translations
const samplesWithTranslations = interactiveTable.filter(e => e.nameI18nKey).slice(0, 5);
if (samplesWithTranslations.length > 0) {
  console.log('\nSample entities with translation keys:');
  samplesWithTranslations.forEach(entry => {
    console.log(`  ${entry.id}: ${entry.nameI18nKey} (${entry.translationType})`);
  });
}

// ==============================================================================
// PART 3: Process TextTable (convert IDs to strings for precision)
// ==============================================================================

console.log('\n=== PART 3: Processing TextTable ===\n');

if (fs.existsSync(textTablePath)) {
  // Load TextTable with JSONbig to preserve precision
  const textTableData = JSONbig.parse(fs.readFileSync(textTablePath, 'utf-8'));

  // Convert all numeric IDs to strings to preserve precision in frontend
  const processedTextTable = {};
  for (const [key, value] of Object.entries(textTableData)) {
    processedTextTable[key] = {
      id: String(value.id), // Convert to string for precision
      text: value.text
    };
  }

  const textTableOutputPath = path.join(outputDir, 'TextTable.json');
  fs.writeFileSync(textTableOutputPath, JSON.stringify(processedTextTable, null, 2));
  console.log(`Processed TextTable.json (${Object.keys(processedTextTable).length} entries with string IDs)`);
  console.log(`Output: ${path.relative(process.cwd(), textTableOutputPath)}`);
} else {
  console.warn(`TextTable.json not found at: ${textTablePath}`);
}

// ==============================================================================
// PART 4: Enrich POIs with InteractiveTable → TextTable translations
// ==============================================================================

console.log('\n=== PART 4: Enriching POI translations ===\n');

// Load the InteractiveTable and TextTable that were just generated
const interactiveTablePath = path.join(outputDir, 'InteractiveTable.json');
const textTablePath2 = path.join(outputDir, 'TextTable.json');

if (fs.existsSync(interactiveTablePath) && fs.existsSync(textTablePath2)) {
  const interactiveTableData = JSON.parse(fs.readFileSync(interactiveTablePath, 'utf-8'));
  const textTableData2 = JSON.parse(fs.readFileSync(textTablePath2, 'utf-8'));

  // Build lookup maps
  const interactiveMap = new Map(interactiveTableData.map(item => [item.id, item]));
  const variantMap = new Map();
  interactiveTableData.forEach(item => {
    if (item.variants && Array.isArray(item.variants)) {
      item.variants.forEach(variant => variantMap.set(variant, item.id));
    }
  });

  /**
   * Get nameI18nId from InteractiveTable → TextTable chain
   */
  function getInteractiveNameI18nId(entityType) {
    // Try direct lookup
    let interactiveEntry = interactiveMap.get(entityType);

    // If not found, check if this is a variant
    if (!interactiveEntry || !interactiveEntry.nameI18nKey) {
      const parentId = variantMap.get(entityType);
      if (parentId) {
        interactiveEntry = interactiveMap.get(parentId);
      }
    }

    if (!interactiveEntry || !interactiveEntry.nameI18nKey) {
      return null;
    }

    // Look up in TextTable
    const textEntry = textTableData2[interactiveEntry.nameI18nKey];
    if (!textEntry || !textEntry.id) {
      return null;
    }

    const nameI18nId = textEntry.id;

    // Filter out invalid IDs
    if (nameI18nId === "0" || nameI18nId === "-1" || nameI18nId === 0 || nameI18nId === -1) {
      return null;
    }

    return nameI18nId;
  }

  // Enrich POIs with missing nameI18nId
  let enrichedCount = 0;
  extractedPOIs.forEach(poi => {
    if (!poi.nameI18nId) {
      const nameI18nId = getInteractiveNameI18nId(poi.entityType);
      if (nameI18nId) {
        poi.nameI18nId = nameI18nId;
        enrichedCount++;
      }
    }
  });

  console.log(`Enriched ${enrichedCount} POIs with Interactive → TextTable translations`);

  // Re-save the enriched POI data
  fs.writeFileSync(poiOutputPath, JSON.stringify(extractedPOIs, null, 2));
  console.log(`Updated: ${path.relative(process.cwd(), poiOutputPath)}`);
} else {
  console.warn('InteractiveTable or TextTable not found - skipping POI enrichment');
}

// ==============================================================================
// PART 5: Compact Level Configs
// ==============================================================================

console.log('\n=== PART 5: Compacting Level Configs ===\n');

function extractLevelConfigs() {
  const levelConfigs = [];

  if (!fs.existsSync(levelConfigDir)) {
    console.warn(`Level config directory not found: ${levelConfigDir}`);
    return levelConfigs;
  }

  const configFiles = fs.readdirSync(levelConfigDir).filter(f => f.endsWith('.json'));
  console.log(`Processing ${configFiles.length} level config files...`);

  // Manual offset configuration for stitching levels together
  const levelOffsets = {
    'map01_lv002': { x: 1, y: -1 },  // Right by 1, down by 1 (negative Y = down)
    'map01_lv005': { x: 0, y: -1 },  // Down by 1
    'map01_lv006': { x: 0, y: -1 },  // Down by 1
    'map01_lv007': { x: 0, y: -2 },  // Down by 2
    'map02_lv002': { x: 1, y: -1 },  // Right by 1, down by 1
  };

  for (const file of configFiles) {
    try {
      const filePath = path.join(levelConfigDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // Extract only the fields we need for seamless world map rendering
      const config = {
        id: data.m_id,
        mapIdStr: data.m_mapIdStr,
        isSeamless: data.m_isSeamless,
        levelGrids: data.m_levelGrids || [],
      };

      // Add rect bounds if available (for coordinate conversion)
      if (data.m_rectLeftBottom && data.m_rectRightTop) {
        config.rectLeftBottom = data.m_rectLeftBottom;
        config.rectRightTop = data.m_rectRightTop;
      }

      // Detect actual tile dimensions and layer/tier information by scanning tile files
      const folderName = config.id.replace(/_/g, ''); // e.g., map01lv001
      const tilePath = path.join(extractedDataDir, 'assets/beyond/dynamicassets/gameplay/ui/sprites/levelmap/levelmapgrids', folderName);

      if (fs.existsSync(tilePath)) {
        // Define tiles to completely exclude from generation (including grid cells)
        // Only exclude '8_1', '8_2', and '8_3' for lv006 (map01_lv006)
        const isLv006 = config.id.includes('lv006');
        const excludedTileCoords = isLv006 ? ['8_1', '8_2', '8_3'] : [];

        const allFiles = fs.readdirSync(tilePath).filter(f => f.endsWith('.png'));

        // Filter out excluded tiles by checking coordinates in filename
        const filteredFiles = allFiles.filter(f => {
          const coordMatch = f.match(/_(\d+)_(\d+)(?:_tier_\d+)?\.png$/);
          if (coordMatch) {
            const coordKey = `${coordMatch[1]}_${coordMatch[2]}`;
            return !excludedTileCoords.includes(coordKey);
          }
          return true;
        });

        const baseTiles = filteredFiles.filter(f => !f.includes('_tier_'));
        const tierTiles = filteredFiles.filter(f => f.includes('_tier_'));

        // Detect grid dimensions from base tiles (excluding removed cells)
        let maxCol = 0, maxRow = 0;
        baseTiles.forEach(tile => {
          const match = tile.match(/_(\d+)_(\d+)\.png$/);
          if (match) {
            const col = parseInt(match[1]);
            const row = parseInt(match[2]);
            maxCol = Math.max(maxCol, col);
            maxRow = Math.max(maxRow, row);
          }
        });

        if (maxCol > 0 && maxRow > 0) {
          config.tileGridWidth = maxCol;
          config.tileGridHeight = maxRow;
        }

        // Detect tile layers/tiers
        // Build a map of tile position -> array of tier numbers
        const tileLayerMap = {}; // { "1_1": [null, 171, 173], "7_4": [null, 171], ... }
        const allTierNumbers = new Set(); // All unique tier numbers found

        // Initialize with base tiles (layer 0 = no tier)
        // Skip excluded tile coordinates
        baseTiles.forEach(tile => {
          const match = tile.match(/_(\d+)_(\d+)\.png$/);
          if (match) {
            const tileKey = `${match[1]}_${match[2]}`;
            // Skip if this tile is in the excluded list
            if (excludedTileCoords.includes(tileKey)) {
              return;
            }
            if (!tileLayerMap[tileKey]) {
              tileLayerMap[tileKey] = [null]; // Layer 0 = base tile (no tier)
            }
          }
        });

        // Add tier tiles (skip excluded coordinates)
        tierTiles.forEach(tile => {
          // Format: map01_lv001_1_1_tier_171.png
          const match = tile.match(/_(\d+)_(\d+)_tier_(\d+)\.png$/);
          if (match) {
            const col = match[1];
            const row = match[2];
            const tierNum = parseInt(match[3]);
            const tileKey = `${col}_${row}`;

            // Skip if this tile is in the excluded list
            if (excludedTileCoords.includes(tileKey)) {
              return;
            }

            if (!tileLayerMap[tileKey]) {
              tileLayerMap[tileKey] = [null]; // Initialize with base layer if not exists
            }

            // Add this tier number to the tile's layer list
            if (!tileLayerMap[tileKey].includes(tierNum)) {
              tileLayerMap[tileKey].push(tierNum);
            }

            allTierNumbers.add(tierNum);
          }
        });

        // If there are any tiers, create layer definitions
        if (allTierNumbers.size > 0) {
          // Find max layer count across all tiles (tile-relative layering)
          // Each tile has its own tier sequence: [null, tier1, tier2, ...]
          let maxLayerCount = 1; // At least base layer

          Object.values(tileLayerMap).forEach(tierList => {
            maxLayerCount = Math.max(maxLayerCount, tierList.length);
          });

          config.tileLayers = {
            layerCount: maxLayerCount, // Max layers across all tiles
            tileLayerMap: tileLayerMap, // Each tile's tier array (tile-relative)
          };

          console.log(`  Detected ${maxLayerCount} layers for ${config.id} (max across all tiles)`);
        }
      }

      // Apply manual offsets for level stitching
      if (levelOffsets[config.id]) {
        const offset = levelOffsets[config.id];
        console.log(`Applying offset to ${config.id}: x+${offset.x}, y+${offset.y}`);

        // Apply offset to all grid cells
        config.levelGrids = config.levelGrids.map(grid => ({
          x: grid.x + offset.x,
          y: grid.y + offset.y,
        }));
      }

      levelConfigs.push(config);
    } catch (error) {
      console.warn(`Error processing ${file}:`, error.message);
    }
  }

  // ==============================================================================
  // PART 4.5: Add synthetic configs for levels with tiles but no config files
  // ==============================================================================

  console.log('\nChecking for levels with tiles but no config files...');

  const tilesDir = path.join(extractedDataDir, 'assets/beyond/dynamicassets/gameplay/ui/sprites/levelmap/levelmapgrids');

  if (fs.existsSync(tilesDir)) {
    const tileFolders = fs.readdirSync(tilesDir).filter(folder => {
      const fullPath = path.join(tilesDir, folder);
      return fs.statSync(fullPath).isDirectory() && folder.match(/^map\d+lv\d+$/);
    });

    tileFolders.forEach(folder => {
      // Convert folder name to level ID (e.g., map02lv003 -> map02_lv003)
      const levelId = folder.replace(/^(map\d+)lv(\d+)$/, '$1_lv$2');

      // Check if this level already has a config
      if (levelConfigs.find(cfg => cfg.id === levelId)) {
        return; // Already has config
      }

      // Analyze tiles to determine grid dimensions
      const tileFolder = path.join(tilesDir, folder);
      const tiles = fs.readdirSync(tileFolder).filter(f => f.endsWith('.png'));

      if (tiles.length === 0) return;

      // Parse tile filenames to find max column and row
      let maxCol = 0, maxRow = 0;
      tiles.forEach(tile => {
        const match = tile.match(/_(\d+)_(\d+)\.png$/);
        if (match) {
          maxCol = Math.max(maxCol, parseInt(match[1]));
          maxRow = Math.max(maxRow, parseInt(match[2]));
        }
      });

      if (maxCol === 0 || maxRow === 0) return;

      // Determine map ID and position based on level number
      const mapMatch = levelId.match(/^(map\d+)_lv(\d+)$/);
      if (!mapMatch) return;

      const mapIdStr = mapMatch[1];
      const levelNum = parseInt(mapMatch[2]);

      // Define starting positions for synthetic levels
      // These are educated guesses - adjust based on visual inspection
      const syntheticPositions = {
        'map02_lv003': { startX: -4, startY: 3 },   // North-east of lv002
        'map02_lv004': { startX: 3, startY: -16 },  // East of lv001
        'map02_lv005': { startX: 3, startY: -7 },   // East of lv002
      };

      const position = syntheticPositions[levelId];
      if (!position) {
        console.log(`  Skipping ${levelId}: No defined position`);
        return;
      }

      // Generate rectangular grid
      const levelGrids = [];
      for (let col = 0; col < maxCol; col++) {
        for (let row = 0; row < maxRow; row++) {
          levelGrids.push({
            x: position.startX + col,
            y: position.startY + row,
          });
        }
      }

      const syntheticConfig = {
        id: levelId,
        mapIdStr: mapIdStr,
        isSeamless: true,
        levelGrids: levelGrids,
        tileGridWidth: maxCol,
        tileGridHeight: maxRow,
        _synthetic: true, // Flag to indicate this was auto-generated
      };

      levelConfigs.push(syntheticConfig);
      console.log(`  Generated synthetic config for ${levelId}: ${maxCol}x${maxRow} grid (${tiles.length} tiles) at X:${position.startX}...${position.startX + maxCol - 1} Y:${position.startY}...${position.startY + maxRow - 1}`);
    });
  }

  return levelConfigs;
}

const levelConfigs = extractLevelConfigs();
const levelConfigOutputPath = path.join(outputDir, 'LevelConfigsData.json');
fs.writeFileSync(levelConfigOutputPath, JSON.stringify(levelConfigs, null, 2));

console.log(`\nCompacted ${levelConfigs.length} level configs`);
console.log(`Output: ${path.relative(process.cwd(), levelConfigOutputPath)}`);

// Show seamless map groupings
const seamlessGroups = levelConfigs
  .filter(cfg => cfg.isSeamless)
  .reduce((acc, cfg) => {
    if (!acc[cfg.mapIdStr]) acc[cfg.mapIdStr] = [];
    acc[cfg.mapIdStr].push(cfg.id);
    return acc;
  }, {});

console.log('\nSeamless map groupings:');
Object.entries(seamlessGroups).forEach(([mapId, levels]) => {
  console.log(`  ${mapId}: ${levels.length} levels (${levels.join(', ')})`);
});

// ==============================================================================
// PART 5: Extract Map Marks from LevelMapMark.json
// ==============================================================================

console.log('\n=== PART 5: Extracting Level Map Marks ===\n');

// Load DungeonSeriesTable for dungeon name i18n IDs
let dungeonSeriesTable = {};
if (fs.existsSync(dungeonSeriesTablePath)) {
  dungeonSeriesTable = JSONbig.parse(fs.readFileSync(dungeonSeriesTablePath, 'utf-8'));
  console.log(`Loaded DungeonSeriesTable with ${Object.keys(dungeonSeriesTable).length} entries`);
}

// Load MapMarkTempTable for mark template info (icons, names)
let mapMarkTempTable = {};
if (fs.existsSync(mapMarkTempTablePath)) {
  mapMarkTempTable = JSONbig.parse(fs.readFileSync(mapMarkTempTablePath, 'utf-8'));
  console.log(`Loaded MapMarkTempTable with ${Object.keys(mapMarkTempTable).length} entries`);
}

// Map section IDs to map regions
// Based on levelId analysis from marks with detailedData.levelId:
//   21 → map01_lv001, 20 → map01_lv002, 30 → map01_lv003
//   34 → map01_lv005, 35 → map01_lv006, 28 → map01_lv007
//   10 → map02_lv001, 22 → map02_lv002
//   26 → map01 (large section), 98 → base01 (ship)
function getSectionMapId(sectionId) {
  const sectionStr = String(sectionId);

  // map01 sections (Valley IV)
  if (sectionStr.startsWith('20') || sectionStr.startsWith('21') ||
      sectionStr.startsWith('26') || sectionStr.startsWith('28') ||
      sectionStr.startsWith('30') || sectionStr.startsWith('34') ||
      sectionStr.startsWith('35')) {
    return 'map01';
  }

  // map02 sections (Wuling/Talos-II)
  if (sectionStr.startsWith('10') || sectionStr.startsWith('22')) {
    return 'map02';
  }

  // Skip base01 (ship) and unknown sections
  return null;
}

// Categorize map marks by their templateId
function getMarkCategory(templateId) {
  if (templateId.includes('dg_bossrush')) return 'dungeon';
  if (templateId.includes('dg_resource')) return 'dungeon';
  if (templateId.includes('dg_blackbox')) return 'dungeon';
  if (templateId.includes('dg_worldlevel')) return 'dungeon';
  if (templateId.includes('dg_ss')) return 'dungeon';
  if (templateId.includes('high_difficulty')) return 'dungeon';
  if (templateId.includes('week_raid')) return 'dungeon';
  if (templateId.includes('sp_campfire')) return 'travel';
  if (templateId.includes('recycler')) return 'ether'; // Recycling stations
  if (templateId.includes('detector_coin')) return 'collectible';
  if (templateId.includes('detector_treasur_chest')) return 'chest';
  if (templateId.includes('equip_formula_chest')) return 'chest';
  if (templateId.includes('minepoint')) return 'mineral';
  if (templateId.includes('doodad_spcstone')) return 'spcstone';
  if (templateId.includes('doodad_tundranest')) return 'plant';
  if (templateId.includes('fixablerobot')) return 'events'; // Delta Bot
  if (templateId.includes('pazzle')) return 'terminal';
  if (templateId.includes('enemyspawner')) return 'battle';
  if (templateId.includes('snapshot')) return 'collectible';
  if (templateId.includes('settlement_defense')) return 'terminal';
  if (templateId.includes('domain_depot')) return 'buildings'; // Depot Node
  if (templateId.includes('domain_')) return 'terminal';
  if (templateId.includes('transtower')) return 'travel';
  if (templateId.includes('ss_')) return 'system'; // Ship/station systems
  if (templateId.includes('npc_')) return 'terminal';
  return 'other';
}

// Extract marks from LevelMapMark.json
let levelMapMarks = [];
if (fs.existsSync(levelMapMarkPath)) {
  const levelMapMarkData = JSON.parse(fs.readFileSync(levelMapMarkPath, 'utf-8'));

  // Iterate through each section (keyed by section ID like "200000000")
  Object.entries(levelMapMarkData).forEach(([sectionId, marks]) => {
    const mapId = getSectionMapId(sectionId);
    if (!mapId) return; // Skip unknown maps

    marks.forEach(mark => {
      const basicData = mark.basicData;
      if (!basicData || !basicData.templateId || !basicData.pos) return;

      const templateId = basicData.templateId;
      const category = getMarkCategory(templateId);

      // Skip detector marks as they're duplicates of POI data
      if (templateId.includes('detector_')) return;

      // Get name i18n ID from dungeon series if available
      let nameI18nId = null;
      if (mark.detailedData && mark.detailedData.systemInstId) {
        const dungeonGroup = dungeonSeriesTable[mark.detailedData.systemInstId];
        if (dungeonGroup && dungeonGroup.name && dungeonGroup.name.id) {
          nameI18nId = String(dungeonGroup.name.id);
        }
      }

      // Fallback: Get name from MapMarkTempTable
      if (!nameI18nId && mapMarkTempTable[templateId]) {
        const markTemp = mapMarkTempTable[templateId];
        if (markTemp.name && markTemp.name.id && markTemp.name.id !== 0 && markTemp.name.id !== '0') {
          nameI18nId = String(markTemp.name.id);
        }
      }

      // Apply mark name overrides from config (for marks with missing/wrong i18n IDs)
      if (mapConfig.markNameOverrides && mapConfig.markNameOverrides[templateId]) {
        nameI18nId = mapConfig.markNameOverrides[templateId];
      }

      // Get levelId from detailedData (where it actually is) or basicData
      const levelId = mark.detailedData?.levelId || basicData.levelId || null;

      // Determine level from levelId pattern
      let level = 1;
      if (levelId) {
        const levelMatch = levelId.match(/lv(\d+)/);
        if (levelMatch) {
          level = parseInt(levelMatch[1], 10);
        }
      }

      // For dungeons with systemInstId, use that as entityType so each dungeon appears separately in filters
      // Otherwise use templateId (e.g., mark_sp_campfire for travel points)
      const systemInstId = mark.detailedData?.systemInstId || null;
      const effectiveEntityType = (category === 'dungeon' && systemInstId) ? systemInstId : templateId;

      levelMapMarks.push({
        id: `lmm_${basicData.markInstId}`,
        entityType: effectiveEntityType,
        sceneId: levelId || `${mapId}_lv00${level}`,
        mapId: mapId,
        position: {
          x: basicData.pos.x,
          y: basicData.pos.y,
          z: basicData.pos.z
        },
        category: category,
        nameI18nId: nameI18nId,
        markInstId: basicData.markInstId,
        serverMarkIndex: basicData.serverMarkIndex,
        systemInstId: mark.detailedData?.systemInstId || null,
        tierIndex: basicData.tierIndex !== undefined ? basicData.tierIndex : 0,
        tierMap: basicData.tierMap || 0
      });
    });
  });

  console.log(`Extracted ${levelMapMarks.length} map marks from LevelMapMark.json`);

  // Count by category
  const categoryCount = {};
  levelMapMarks.forEach(mark => {
    categoryCount[mark.category] = (categoryCount[mark.category] || 0) + 1;
  });
  console.log('Mark categories:');
  Object.entries(categoryCount).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}`);
  });
}

// Write LevelMapMarks to file
const levelMapMarksOutputPath = path.join(outputDir, 'LevelMapMarks.json');
fs.writeFileSync(levelMapMarksOutputPath, JSON.stringify(levelMapMarks, null, 2));
console.log(`\nOutput: ${path.relative(process.cwd(), levelMapMarksOutputPath)}`);

// ==============================================================================
// Summary
// ==============================================================================

console.log('\n=== Generation Complete ===\n');
console.log(`Generated files in: ${path.relative(process.cwd(), outputDir)}`);
console.log(`  - ExtractedPOIData.json (${extractedPOIs.length} POIs)`);
console.log(`  - InteractiveTable.json (${interactiveTable.length} entities)`);
console.log(`  - TextTable.json (translation key mappings)`);
console.log(`  - LevelConfigsData.json (${levelConfigs.length} level configs)`);
console.log(`  - LevelMapMarks.json (${levelMapMarks.length} map marks)`);
console.log('');
