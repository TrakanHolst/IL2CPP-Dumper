#!/usr/bin/env node

/**
 * Separates build output into assets and HTML folders for ordered FTP deployment.
 *
 * This solves the problem of HTML files being uploaded before CSS/JS assets,
 * which causes users to see unstyled pages temporarily.
 *
 * Output:
 *   deploy-assets/  - Upload FIRST (CSS, JS, images, data files)
 *   deploy-html/    - Upload LAST (all index.html and index.txt with folder structure)
 *
 * Strategy:
 *   - All index.html and index.txt files go to deploy-html (preserving folder structure)
 *   - All other files (CSS, JS, images, data) go to deploy-assets
 *   - Upload assets first, then HTML to ensure styles/scripts are ready
 *
 * Usage:
 *   npm run separate-deploy     (run after build)
 *   npm run build:deploy        (build + separate in one command)
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Configuration
const BUILD_DIR = path.join(__dirname, '../build');
const ASSETS_DIR = path.join(__dirname, '../deploy-assets');
const HTML_DIR = path.join(__dirname, '../deploy-html');

// Stats tracking
let stats = {
  htmlFiles: 0,
  assetFiles: 0,
  htmlSize: 0,
  assetSize: 0
};

/**
 * Recursively removes a directory and all its contents
 */
function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Ensures a directory exists, creating it if necessary
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Copies a file to a destination, creating parent directories if needed
 */
function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return fs.statSync(dest).size;
}

/**
 * Recursively processes a directory, separating HTML/index files from assets
 *
 * Strategy:
 * - All index.html and index.txt files → deploy-html (with folder structure)
 * - All other files (CSS, JS, images, data) → deploy-assets
 */
function processDirectory(srcDir, relativeDir = '') {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const relativePath = path.join(relativeDir, entry.name);

    if (entry.isDirectory()) {
      // Recursively process subdirectories
      processDirectory(srcPath, relativePath);
    } else if (entry.isFile()) {
      const isIndexHtml = entry.name === 'index.html';
      const isIndexTxt = entry.name === 'index.txt';
      const isIndexFile = isIndexHtml || isIndexTxt;

      if (isIndexFile) {
        // All index.html and index.txt files go to deploy-html (with structure)
        const destPath = path.join(HTML_DIR, relativePath);
        const size = copyFile(srcPath, destPath);
        stats.htmlFiles++;
        stats.htmlSize += size;
      } else {
        // All other files go to deploy-assets
        const destPath = path.join(ASSETS_DIR, relativePath);
        const size = copyFile(srcPath, destPath);
        stats.assetFiles++;
        stats.assetSize += size;
      }
    }
  }
}

/**
 * Formats bytes to human-readable string
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Main function
 */
function main() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  Separating Build Files for FTP Deployment');
  console.log('='.repeat(60));
  console.log('');

  // Check if build directory exists
  if (!fs.existsSync(BUILD_DIR)) {
    console.error('Error: Build directory not found!');
    console.error(`Expected: ${BUILD_DIR}`);
    console.error('');
    console.error('Run "npm run build" first, then run this script.');
    process.exit(1);
  }

  // Clean up previous deploy folders
  console.log('Cleaning up previous deploy folders...');
  removeDir(ASSETS_DIR);
  removeDir(HTML_DIR);
  console.log('');

  // Create fresh deploy folders
  ensureDir(ASSETS_DIR);
  ensureDir(HTML_DIR);

  // Process the build directory
  console.log('Processing build directory...');
  console.log(`Source: ${BUILD_DIR}`);
  console.log('');

  processDirectory(BUILD_DIR);

  // Print summary
  console.log('');
  console.log('='.repeat(60));
  console.log('  Summary');
  console.log('='.repeat(60));
  console.log('');
  console.log(`  deploy-assets/ (UPLOAD FIRST)`);
  console.log(`    Files: ${stats.assetFiles.toLocaleString()} (CSS, JS, images, data)`);
  console.log(`    Size:  ${formatSize(stats.assetSize)}`);
  console.log('');
  console.log(`  deploy-html/ (UPLOAD LAST)`);
  console.log(`    Files: ${stats.htmlFiles.toLocaleString()} (index.html + index.txt)`);
  console.log(`    Size:  ${formatSize(stats.htmlSize)}`);
  console.log('');
  console.log('='.repeat(60));
  console.log('');
  console.log('Deployment Instructions:');
  console.log('  1. Upload deploy-assets/ contents to server root');
  console.log('  2. Wait for all transfers to complete');
  console.log('  3. Upload deploy-html/ contents to server root');
  console.log('');
  console.log('Done! Opening folder...');
  console.log('');

  // Open the project folder in Windows Explorer
  const projectDir = path.join(__dirname, '..');
  exec(`explorer "${projectDir}"`);
}

// Run
try {
  main();
} catch (error) {
  console.error('Error during separation:', error.message);
  console.error(error.stack);
  process.exit(1);
}
