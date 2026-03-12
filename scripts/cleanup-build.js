const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, '..', 'build');
const assetsToRemove = path.join(buildDir, 'assets', 'images');

// Check if build directory exists
if (fs.existsSync(buildDir)) {
  // Remove assets/images from build
  if (fs.existsSync(assetsToRemove)) {
    console.log('Removing assets/images from build...');
    fs.rmSync(assetsToRemove, { recursive: true, force: true });
    console.log('✓ Removed assets/images from build');
  }
} else {
  console.log('Build directory does not exist yet');
}
