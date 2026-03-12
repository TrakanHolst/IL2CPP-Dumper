const fs = require('fs');
const path = require('path');

// Read the current site-config.json
const configPath = path.join(__dirname, '..', 'site-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Parse current version
const [major, minor, patch] = config.version.split('.').map(Number);

// Increment patch version
const newPatch = patch + 1;
const newVersion = `${major}.${minor}.${newPatch}`;

// Update the version
config.version = newVersion;

// Write back to file
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

console.log(`Version incremented from ${major}.${minor}.${patch} to ${newVersion}`); 