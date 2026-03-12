#!/usr/bin/env node

/**
 * REFRESH ALL OPTIMIZED DATA
 * 
 * This is the main script that runs all data optimization scripts
 * to refresh optimized JSON files from the extracted_data folder.
 * 
 * Usage:
 *   npm run refresh-data
 *   or
 *   node scripts/data-optimization/refresh-all.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Script paths
const SCRIPTS_DIR = __dirname;
const SCRIPTS = [
  // STEP 1: Generate i18n deduplication map FIRST (used by all data optimizers)
  'i18n-dedup.js',
  // STEP 2: Optimize data files (uses dedup map to replace i18n IDs)
  'optimize-characters.js',
  'optimize-equipment.js',
  'optimize-equipment-suits.js',
  'optimize-weapons.js',
  'optimize-factory.js',
  'optimize-factory-browse.js',  // Lightweight factory data for browse pages
  'optimize-map.js',
  'optimize-items.js',
  'optimize-achievements.js',
  'optimize-combat-mechanics.js',  // Combat mechanics for tooltips
  'optimize-banners.js',  // Gacha banner configuration for headhunt tracker
  // STEP 3: Optimize i18n translations (uses dedup map to skip duplicates)
  'optimize-i18n.js',  // Must run before generate-item-slugs to have translations available
  'optimize-i18n-modular.js',  // Modular i18n for lazy loading per-page
  'generate-item-slugs.js'  // Generate item ID to slug mapping for static export
];

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
};

/**
 * Run a script and capture output
 */
function runScript(scriptName) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  
  console.log(`${colors.blue}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}Running: ${scriptName}${colors.reset}\n`);
  
  try {
    execSync(`node "${scriptPath}"`, { stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error(`${colors.red}Failed to run ${scriptName}${colors.reset}`);
    return false;
  }
}

/**
 * Create metadata file with optimization timestamp
 */
function createMetadata(results) {
  const metadata = {
    lastOptimized: new Date().toISOString(),
    scripts: results,
    sourceDirectory: 'extracted_data/TableCfg/',
    outputDirectory: 'public/localdb/optimized/'
  };
  
  const metadataPath = path.join(__dirname, '../../public/localdb/optimized/metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  
  return metadataPath;
}

/**
 * Main function
 */
function main() {
  console.log(`${colors.bright}${colors.green}`);
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                                                           ║');
  console.log('║     LIGHTWEIGHT JSON OPTIMIZATION SYSTEM                  ║');
  console.log('║     Refreshing all optimized data files                   ║');
  console.log('║                                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(colors.reset);
  console.log();
  
  const results = {};
  let successCount = 0;
  let failCount = 0;
  
  // Run each optimization script
  SCRIPTS.forEach(scriptName => {
    const success = runScript(scriptName);
    results[scriptName] = success ? 'success' : 'failed';
    
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
    
    console.log(); // Empty line between scripts
  });
  
  // Create metadata
  console.log(`${colors.blue}${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}Creating metadata...${colors.reset}\n`);
  const metadataPath = createMetadata(results);
  console.log(`${colors.green}✓ Metadata created: ${metadataPath}${colors.reset}`);
  console.log();
  
  // Summary
  console.log(`${colors.bright}${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}SUMMARY${colors.reset}`);
  console.log(`${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`Total scripts: ${SCRIPTS.length}`);
  console.log(`${colors.green}Succeeded: ${successCount}${colors.reset}`);
  if (failCount > 0) {
    console.log(`${colors.red}Failed: ${failCount}${colors.reset}`);
  }
  console.log();
  
  if (failCount === 0) {
    console.log(`${colors.green}${colors.bright}✨ All data optimization scripts completed successfully!${colors.reset}`);
    console.log();
    console.log('📁 Optimized files location: public/localdb/optimized/');
    console.log('   - characters/');
    console.log('   - equipment/');
    console.log('   - weapons/');
    console.log('   - factory/');
    console.log('   - map/');
    console.log('   - items/');
    console.log('   - achievements/');
    console.log('   - combat/');
    console.log('   - i18n/{module}/ (modular translations)');
    console.log('📁 Additional files: public/localdb/');
    console.log('   - banner_config.json');
    console.log();
    process.exit(0);
  } else {
    console.log(`${colors.red}${colors.bright}⚠️  Some scripts failed. Please check the errors above.${colors.reset}`);
    console.log();
    process.exit(1);
  }
}

// Run main function
main();
