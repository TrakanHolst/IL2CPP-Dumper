#!/usr/bin/env node

/**
 * WEBSITE TRANSLATIONS IMPORTER
 *
 * Imports translations from a single unified CSV file and generates
 * individual JSON files for each language.
 *
 * Expected CSV Format:
 *   Key, Module, EN, CN, TC, JP, KR, RU, MX, PT, FR, DE, ID, VI, TH, IT
 *
 * Usage:
 *   npm run translations:import
 *
 * Input:
 *   scripts/translations/translations-import.csv
 *
 * Output:
 *   public/localdb/lang/website_translations_*.json (14 files)
 */

const fs = require('fs');
const path = require('path');

// Configuration - All languages (including disabled ones)
const LANGUAGES = ['EN', 'CN', 'TC', 'JP', 'KR', 'RU', 'MX', 'PT', 'FR', 'DE', 'ID', 'VI', 'TH', 'IT'];
const INPUT_FILE = path.join(__dirname, 'translations-import.csv');
const OUTPUT_DIR = path.join(__dirname, '../../public/localdb/lang');

/**
 * Parse a CSV line handling quoted fields with commas and escaped quotes
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote (doubled)
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
        i++;
      } else if (char === ',') {
        // Field separator
        result.push(current);
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
  }

  // Add last field
  result.push(current);

  return result;
}

/**
 * Extract placeholders from a string (e.g., {username}, {name})
 */
function extractPlaceholders(text) {
  const matches = text.match(/\{[^}]+\}/g);
  return matches ? matches.sort() : [];
}

/**
 * Validate placeholder consistency across languages
 */
function validatePlaceholders(key, enValue, langValue, lang) {
  const warnings = [];
  const enPlaceholders = extractPlaceholders(enValue || '');

  if (enPlaceholders.length === 0 || !langValue) {
    return warnings;
  }

  const langPlaceholders = extractPlaceholders(langValue);

  // Check if all EN placeholders exist in this language
  for (const ph of enPlaceholders) {
    if (!langPlaceholders.includes(ph)) {
      warnings.push(`Placeholder ${ph} missing in ${lang} for key "${key}"`);
    }
  }

  // Check for extra placeholders not in EN
  for (const ph of langPlaceholders) {
    if (!enPlaceholders.includes(ph)) {
      warnings.push(`Extra placeholder ${ph} in ${lang} for key "${key}" (not in EN)`);
    }
  }

  return warnings;
}

/**
 * Main import function
 */
function importFromCSV() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  WEBSITE TRANSLATIONS IMPORTER');
  console.log('='.repeat(60));
  console.log('');

  // Check if input file exists
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Error: Import file not found: ${INPUT_FILE}`);
    console.error('');
    console.error('Please place your CSV file at:');
    console.error(`  ${INPUT_FILE}`);
    console.error('');
    console.error('Expected CSV format:');
    console.error('  Key, Module, EN, CN, TC, JP, KR, RU, MX');
    console.error('');
    console.error('You can export the current translations first with:');
    console.error('  npm run translations:export');
    console.error('');
    process.exit(1);
  }

  // Read and parse CSV
  console.log(`Reading: ${INPUT_FILE}`);
  const content = fs.readFileSync(INPUT_FILE, 'utf8');
  // Remove BOM if present
  const cleanContent = content.replace(/^\ufeff/, '');
  // Split into lines (handle both \r\n and \n)
  const lines = cleanContent.split(/\r?\n/).filter(line => line.trim());

  if (lines.length < 2) {
    console.error('Error: CSV file is empty or has no data rows');
    process.exit(1);
  }

  // Parse header to find language columns
  const header = parseCSVLine(lines[0]);
  console.log(`  Header columns: ${header.join(', ')}`);

  // Validate header format
  if (header[0] !== 'Key') {
    console.error('Error: First column must be "Key"');
    process.exit(1);
  }

  // Find language column indices
  const langIndices = {};
  for (const lang of LANGUAGES) {
    const index = header.indexOf(lang);
    if (index === -1) {
      console.error(`Error: Missing column for language: ${lang}`);
      console.error(`Expected columns: Key, Module, ${LANGUAGES.join(', ')}`);
      process.exit(1);
    }
    langIndices[lang] = index;
  }

  console.log('');
  console.log('Parsing translations...');

  // Parse data rows
  const translations = {};
  for (const lang of LANGUAGES) {
    translations[lang] = {};
  }

  const errors = [];
  const seenKeys = new Set();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const fields = parseCSVLine(line);
    const key = fields[0];

    if (!key) {
      continue; // Skip empty keys
    }

    // Check for duplicates
    if (seenKeys.has(key)) {
      errors.push(`Row ${i + 1}: Duplicate key "${key}"`);
      continue;
    }
    seenKeys.add(key);

    // Extract translation for each language
    for (const lang of LANGUAGES) {
      const value = fields[langIndices[lang]] || '';
      translations[lang][key] = value;
    }
  }

  const keyCount = seenKeys.size;
  console.log(`  Found ${keyCount} translation keys`);

  // Check for errors
  if (errors.length > 0) {
    console.log('');
    console.log('ERRORS (must fix before import):');
    errors.forEach(err => console.log(`  - ${err}`));
    console.log('');
    process.exit(1);
  }

  // Validate and check for issues
  console.log('');
  console.log('Validating...');

  const allWarnings = [];
  const masterKeys = Object.keys(translations['EN']).sort();

  for (const lang of LANGUAGES) {
    if (lang === 'EN') continue;

    // Check for missing translations
    const missingKeys = masterKeys.filter(k => !translations[lang][k]);
    if (missingKeys.length > 0) {
      allWarnings.push(`${lang}: ${missingKeys.length} keys have empty translations`);
    }

    // Check placeholder consistency
    for (const key of masterKeys) {
      const enValue = translations['EN'][key];
      const langValue = translations[lang][key];
      const placeholderWarnings = validatePlaceholders(key, enValue, langValue, lang);
      allWarnings.push(...placeholderWarnings);
    }
  }

  // Check for empty EN translations
  const emptyENKeys = masterKeys.filter(k => !translations['EN'][k]);
  if (emptyENKeys.length > 0) {
    allWarnings.push(`EN: ${emptyENKeys.length} keys have empty values`);
  }

  // Report warnings
  if (allWarnings.length > 0) {
    console.log('');
    console.log(`WARNINGS (${allWarnings.length}):`);

    // Group by type
    const missingWarnings = allWarnings.filter(w => w.includes('empty'));
    const placeholderWarnings = allWarnings.filter(w => w.includes('Placeholder') || w.includes('placeholder'));
    const otherWarnings = allWarnings.filter(w => !w.includes('empty') && !w.includes('laceholder'));

    if (missingWarnings.length > 0) {
      console.log('');
      console.log('  Empty translations:');
      missingWarnings.slice(0, 10).forEach(w => console.log(`    - ${w}`));
      if (missingWarnings.length > 10) {
        console.log(`    ... and ${missingWarnings.length - 10} more`);
      }
    }

    if (placeholderWarnings.length > 0) {
      console.log('');
      console.log('  Placeholder issues:');
      placeholderWarnings.slice(0, 10).forEach(w => console.log(`    - ${w}`));
      if (placeholderWarnings.length > 10) {
        console.log(`    ... and ${placeholderWarnings.length - 10} more`);
      }
    }

    if (otherWarnings.length > 0) {
      console.log('');
      console.log('  Other warnings:');
      otherWarnings.forEach(w => console.log(`    - ${w}`));
    }
  }

  // Write output files
  console.log('');
  console.log('Writing JSON files...');

  for (const lang of LANGUAGES) {
    const outputPath = path.join(OUTPUT_DIR, `website_translations_${lang}.json`);

    // Sort keys alphabetically for consistent output
    const sortedTranslations = {};
    for (const key of masterKeys) {
      sortedTranslations[key] = translations[lang][key] || '';
    }

    // Write with 2-space indentation
    const jsonContent = JSON.stringify(sortedTranslations, null, 2);
    fs.writeFileSync(outputPath, jsonContent, 'utf8');

    const fileSize = (fs.statSync(outputPath).size / 1024).toFixed(2);
    const emptyCount = masterKeys.filter(k => !translations[lang][k]).length;
    const status = emptyCount > 0 ? `${emptyCount} empty` : 'complete';
    console.log(`  ${lang}: ${masterKeys.length} keys (${fileSize} KB) - ${status}`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('  IMPORT COMPLETE');
  console.log('='.repeat(60));
  console.log('');
  console.log(`  Input file: ${INPUT_FILE}`);
  console.log(`  Languages updated: ${LANGUAGES.join(', ')}`);
  console.log(`  Keys per file: ${masterKeys.length}`);
  console.log(`  Warnings: ${allWarnings.length}`);
  console.log('');

  if (allWarnings.length > 0) {
    console.log('  Note: Review warnings above. Empty translations will');
    console.log('  fall back to English in the website.');
    console.log('');
  }
}

// Run import
try {
  importFromCSV();
} catch (error) {
  console.error('');
  console.error('Import failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
