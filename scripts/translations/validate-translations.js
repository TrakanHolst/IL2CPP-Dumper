#!/usr/bin/env node

/**
 * WEBSITE TRANSLATIONS VALIDATOR
 *
 * Validates translation files for consistency without modifying them.
 *
 * Usage:
 *   npm run translations:validate
 *
 * Checks:
 *   - All files have the same keys
 *   - No empty EN translations
 *   - Placeholder consistency across languages
 *   - No duplicate keys (should not happen in JSON)
 */

const fs = require('fs');
const path = require('path');

// Configuration
const LANGUAGES = ['EN', 'CN', 'TC', 'JP', 'KR', 'RU', 'MX'];
const INPUT_DIR = path.join(__dirname, '../../public/localdb/lang');

/**
 * Extract placeholders from a string (e.g., {username}, {name})
 */
function extractPlaceholders(text) {
  const matches = text.match(/\{[^}]+\}/g);
  return matches ? matches.sort() : [];
}

/**
 * Read a JSON translation file
 */
function readTranslationFile(lang) {
  const filePath = path.join(INPUT_DIR, `website_translations_${lang}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Main validation function
 */
function validateTranslations() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  WEBSITE TRANSLATIONS VALIDATOR');
  console.log('='.repeat(60));
  console.log('');

  // Read all translation files
  console.log('Reading translation files...');
  const translations = {};
  const errors = [];
  const warnings = [];

  for (const lang of LANGUAGES) {
    translations[lang] = readTranslationFile(lang);

    if (translations[lang] === null) {
      errors.push(`File not found or invalid: website_translations_${lang}.json`);
    } else {
      const keyCount = Object.keys(translations[lang]).length;
      console.log(`  ${lang}: ${keyCount} keys`);
    }
  }

  // If any files are missing, stop here
  if (errors.length > 0) {
    console.log('');
    console.log('ERRORS:');
    errors.forEach(err => console.log(`  - ${err}`));
    console.log('');
    process.exit(1);
  }

  // Collect all keys
  const allKeys = new Set();
  for (const lang of LANGUAGES) {
    Object.keys(translations[lang]).forEach(key => allKeys.add(key));
  }

  const sortedKeys = Array.from(allKeys).sort();
  console.log('');
  console.log(`Total unique keys: ${sortedKeys.length}`);

  // Validation checks
  console.log('');
  console.log('Running validation checks...');

  // 1. Check for keys missing in each language
  console.log('');
  console.log('1. Checking key consistency across languages...');

  const missingByLang = {};
  for (const lang of LANGUAGES) {
    missingByLang[lang] = [];
  }

  for (const key of sortedKeys) {
    for (const lang of LANGUAGES) {
      if (translations[lang][key] === undefined) {
        missingByLang[lang].push(key);
      }
    }
  }

  let keyConsistencyOK = true;
  for (const lang of LANGUAGES) {
    if (missingByLang[lang].length > 0) {
      keyConsistencyOK = false;
      if (lang === 'EN') {
        errors.push(`${missingByLang[lang].length} keys missing in EN (master)`);
      } else {
        warnings.push(`${missingByLang[lang].length} keys missing in ${lang}`);
      }
    }
  }

  if (keyConsistencyOK) {
    console.log('   All languages have the same keys');
  }

  // 2. Check for empty EN translations
  console.log('');
  console.log('2. Checking for empty English translations...');

  const emptyEN = [];
  for (const key of sortedKeys) {
    const value = translations['EN'][key];
    if (value === '' || value === null || value === undefined) {
      emptyEN.push(key);
    }
  }

  if (emptyEN.length > 0) {
    errors.push(`${emptyEN.length} keys have empty EN translations`);
    console.log(`   Found ${emptyEN.length} empty EN translations:`);
    emptyEN.slice(0, 5).forEach(key => console.log(`     - ${key}`));
    if (emptyEN.length > 5) {
      console.log(`     ... and ${emptyEN.length - 5} more`);
    }
  } else {
    console.log('   All EN translations have values');
  }

  // 3. Check placeholder consistency
  console.log('');
  console.log('3. Checking placeholder consistency...');

  const placeholderIssues = [];

  for (const key of sortedKeys) {
    const enValue = translations['EN'][key] || '';
    const enPlaceholders = extractPlaceholders(enValue);

    if (enPlaceholders.length === 0) continue;

    for (const lang of LANGUAGES) {
      if (lang === 'EN') continue;

      const value = translations[lang][key] || '';
      if (!value) continue; // Skip empty translations

      const langPlaceholders = extractPlaceholders(value);

      // Check for missing placeholders
      for (const ph of enPlaceholders) {
        if (!langPlaceholders.includes(ph)) {
          placeholderIssues.push({
            key,
            lang,
            type: 'missing',
            placeholder: ph,
          });
        }
      }

      // Check for extra placeholders
      for (const ph of langPlaceholders) {
        if (!enPlaceholders.includes(ph)) {
          placeholderIssues.push({
            key,
            lang,
            type: 'extra',
            placeholder: ph,
          });
        }
      }
    }
  }

  if (placeholderIssues.length > 0) {
    const missingCount = placeholderIssues.filter(i => i.type === 'missing').length;
    const extraCount = placeholderIssues.filter(i => i.type === 'extra').length;

    if (missingCount > 0) {
      warnings.push(`${missingCount} missing placeholders across translations`);
    }
    if (extraCount > 0) {
      warnings.push(`${extraCount} extra placeholders in translations`);
    }

    console.log(`   Found ${placeholderIssues.length} placeholder issues:`);
    placeholderIssues.slice(0, 5).forEach(issue => {
      if (issue.type === 'missing') {
        console.log(`     - ${issue.key}: ${issue.placeholder} missing in ${issue.lang}`);
      } else {
        console.log(`     - ${issue.key}: extra ${issue.placeholder} in ${issue.lang}`);
      }
    });
    if (placeholderIssues.length > 5) {
      console.log(`     ... and ${placeholderIssues.length - 5} more`);
    }
  } else {
    console.log('   All placeholders are consistent');
  }

  // 4. Check for very long translations (potential issues)
  console.log('');
  console.log('4. Checking for unusually long translations...');

  const longTranslations = [];
  const LONG_THRESHOLD = 500;

  for (const key of sortedKeys) {
    for (const lang of LANGUAGES) {
      const value = translations[lang][key] || '';
      if (value.length > LONG_THRESHOLD) {
        longTranslations.push({ key, lang, length: value.length });
      }
    }
  }

  if (longTranslations.length > 0) {
    console.log(`   Found ${longTranslations.length} translations over ${LONG_THRESHOLD} characters:`);
    longTranslations.slice(0, 5).forEach(item => {
      console.log(`     - ${item.key} (${item.lang}): ${item.length} chars`);
    });
    if (longTranslations.length > 5) {
      console.log(`     ... and ${longTranslations.length - 5} more`);
    }
  } else {
    console.log('   No unusually long translations found');
  }

  // Summary
  console.log('');
  console.log('='.repeat(60));
  console.log('  VALIDATION SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log(`  Total keys: ${sortedKeys.length}`);
  console.log(`  Languages: ${LANGUAGES.join(', ')}`);
  console.log('');

  if (errors.length > 0) {
    console.log('  ERRORS:');
    errors.forEach(err => console.log(`    - ${err}`));
    console.log('');
  }

  if (warnings.length > 0) {
    console.log('  WARNINGS:');
    warnings.forEach(warn => console.log(`    - ${warn}`));
    console.log('');
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('  All validations passed!');
    console.log('');
  } else if (errors.length === 0) {
    console.log('  Validation completed with warnings.');
    console.log('  Missing translations will fall back to English.');
    console.log('');
  } else {
    console.log('  Validation FAILED with errors.');
    console.log('  Please fix errors before proceeding.');
    console.log('');
    process.exit(1);
  }
}

// Run validation
try {
  validateTranslations();
} catch (error) {
  console.error('');
  console.error('Validation failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
