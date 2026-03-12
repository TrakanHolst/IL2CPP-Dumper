#!/usr/bin/env node

/**
 * UPDATE CODE REFERENCES FOR CONSOLIDATED TRANSLATION KEYS
 *
 * This script updates all .tsx and .ts files to use the new common.* keys
 */

const fs = require('fs');
const path = require('path');
const { consolidations } = require('./consolidate-duplicates.js');

const SRC_DIR = path.join(__dirname, '../../src');

// Find all .tsx and .ts files
function findFiles(dir, files = []) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      findFiles(fullPath, files);
    } else if (item.endsWith('.tsx') || item.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function updateCodeReferences() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  UPDATE CODE REFERENCES');
  console.log('='.repeat(60));
  console.log('');

  const files = findFiles(SRC_DIR);
  console.log(`Found ${files.length} source files to check`);
  console.log('');

  let totalReplacements = 0;
  let filesModified = 0;

  for (const filePath of files) {
    let content = fs.readFileSync(filePath, 'utf8');
    let originalContent = content;
    let fileReplacements = 0;

    // Replace each old key with new key
    for (const [oldKey, newKey] of Object.entries(consolidations)) {
      // Match patterns like:
      // t('old.key')
      // translateWebsite('old.key')
      // t("old.key")
      // translateWebsite("old.key")

      // Escape dots in regex
      const escapedOldKey = oldKey.replace(/\./g, '\\.');

      // Pattern for single quotes
      const singleQuotePattern = new RegExp(`(['"])${escapedOldKey}\\1`, 'g');

      const matches = content.match(singleQuotePattern);
      if (matches) {
        content = content.replace(singleQuotePattern, `$1${newKey}$1`);
        fileReplacements += matches.length;
      }
    }

    if (content !== originalContent) {
      fs.writeFileSync(filePath, content, 'utf8');
      const relativePath = path.relative(path.join(__dirname, '../..'), filePath);
      console.log(`  ${relativePath}: ${fileReplacements} replacements`);
      filesModified++;
      totalReplacements += fileReplacements;
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('  SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log(`  Files modified: ${filesModified}`);
  console.log(`  Total replacements: ${totalReplacements}`);
  console.log('');
}

updateCodeReferences();
