#!/usr/bin/env node

/**
 * WEBSITE TRANSLATIONS EXPORTER
 *
 * Exports all language translation files to a single unified CSV file.
 * Format: Key, Module, EN, CN, TC, JP, KR, RU, MX, PT, FR, DE, ID, VI, TH, IT
 *
 * Usage:
 *   npm run translations:export
 *
 * Output:
 *   scripts/translations/translations-export.csv
 */

const fs = require('fs');
const path = require('path');

// Configuration - All languages (including disabled ones)
const LANGUAGES = ['EN', 'CN', 'TC', 'JP', 'KR', 'RU', 'MX', 'PT', 'FR', 'DE', 'ID', 'VI', 'TH', 'IT'];
const INPUT_DIR = path.join(__dirname, '../../public/localdb/lang');
const OUTPUT_FILE = path.join(__dirname, 'translations-export.csv');

/**
 * Escape a value for CSV format
 * - Wraps in quotes if contains comma, quote, or newline
 * - Doubles any existing quotes
 */
function escapeCSV(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  // Check if escaping is needed
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    // Double any quotes and wrap in quotes
    return '"' + str.replace(/"/g, '""') + '"';
  }

  return str;
}

/**
 * Extract module prefix from a translation key
 * e.g., "factory.notifications.saved_to" -> "factory"
 */
function extractModule(key) {
  const parts = key.split('.');
  return parts[0] || '';
}

/**
 * Read a JSON translation file
 */
function readTranslationFile(lang) {
  const filePath = path.join(INPUT_DIR, `website_translations_${lang}.json`);

  if (!fs.existsSync(filePath)) {
    console.error(`  Warning: File not found: ${filePath}`);
    return {};
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`  Error reading ${lang}: ${error.message}`);
    return {};
  }
}

/**
 * Main export function
 */
function exportToCSV() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  WEBSITE TRANSLATIONS EXPORTER');
  console.log('='.repeat(60));
  console.log('');

  // Read all translation files
  console.log('Reading translation files...');
  const translations = {};

  for (const lang of LANGUAGES) {
    translations[lang] = readTranslationFile(lang);
    const keyCount = Object.keys(translations[lang]).length;
    console.log(`  ${lang}: ${keyCount} keys`);
  }

  // Collect all unique keys (using EN as master)
  const allKeys = new Set();

  // First, add all EN keys
  Object.keys(translations['EN']).forEach(key => allKeys.add(key));

  // Then check other languages for any keys not in EN
  for (const lang of LANGUAGES) {
    if (lang === 'EN') continue;
    Object.keys(translations[lang]).forEach(key => {
      if (!allKeys.has(key)) {
        console.log(`  Warning: Key "${key}" exists in ${lang} but not in EN`);
        allKeys.add(key);
      }
    });
  }

  // Sort keys alphabetically
  const sortedKeys = Array.from(allKeys).sort();

  console.log('');
  console.log(`Total unique keys: ${sortedKeys.length}`);

  // Generate unified CSV
  console.log('');
  console.log('Generating unified CSV file...');

  const BOM = '\ufeff'; // UTF-8 BOM for Excel compatibility
  const rows = [];

  // Header row: Key, Module, EN, CN, TC, JP, KR, RU, MX
  const header = ['Key', 'Module', ...LANGUAGES];
  rows.push(header.map(escapeCSV).join(','));

  // Data rows
  for (const key of sortedKeys) {
    const module = extractModule(key);
    const row = [key, module];

    // Add translation for each language
    for (const lang of LANGUAGES) {
      row.push(translations[lang][key] || '');
    }

    rows.push(row.map(escapeCSV).join(','));
  }

  const csvContent = BOM + rows.join('\n');
  fs.writeFileSync(OUTPUT_FILE, csvContent, 'utf8');

  const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2);

  // Count missing translations per language
  const missingCounts = {};
  for (const lang of LANGUAGES) {
    if (lang === 'EN') continue;
    const missing = sortedKeys.filter(k => !translations[lang][k]).length;
    if (missing > 0) {
      missingCounts[lang] = missing;
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('  EXPORT COMPLETE');
  console.log('='.repeat(60));
  console.log('');
  console.log(`  Output file: ${OUTPUT_FILE}`);
  console.log(`  File size: ${fileSize} KB`);
  console.log(`  Total keys: ${sortedKeys.length}`);
  console.log(`  Languages: ${LANGUAGES.join(', ')}`);
  console.log('');

  if (Object.keys(missingCounts).length > 0) {
    console.log('  Missing translations:');
    for (const [lang, count] of Object.entries(missingCounts)) {
      console.log(`    ${lang}: ${count} missing`);
    }
    console.log('');
  }

  console.log('  CSV Format:');
  console.log('    Column A: Key (translation key)');
  console.log('    Column B: Module (auto-generated from key prefix)');
  console.log('    Column C: EN (English - source language)');
  console.log('    Column D-I: CN, TC, JP, KR, RU, MX (other languages)');
  console.log('');
  console.log('  To import in Google Sheets:');
  console.log('    1. File > Import > Upload');
  console.log('    2. Choose the CSV file');
  console.log('    3. Freeze Row 1 and Columns A-B');
  console.log('');
}

// Run export
try {
  exportToCSV();
} catch (error) {
  console.error('');
  console.error('Export failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
