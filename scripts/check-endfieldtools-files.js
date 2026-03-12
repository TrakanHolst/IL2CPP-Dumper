#!/usr/bin/env node

/**
 * Check if files exist on endfieldtools.dev
 * Tests the failing URLs to see if they're already on the new server
 */

const https = require('https');

const BASE_URL = 'https://endfieldtools.dev/uploads';

// Files that failed to download from Supabase (HTTP 400)
const filesToCheck = [
  // Comments
  'comments/52105bd3-0b9e-4331-ae89-c5b3fc0c5ea9/1769419147222-p9l6fh.webp',
  'comments/2bfd99b4-8480-4711-a8c4-faace14082a6/1769381811534-v0rohu.webp',
  'comments/2bfd99b4-8480-4711-a8c4-faace14082a6/1769382441570-nc2b37.webp',
  'comments/0a9efa46-713e-4468-a2b1-8a29a2185ba9/1769382438932-mzryms.webp',
  'comments/46bc519f-7d78-4a0b-8c90-fb6efa770c94/1769383137323-0fi6si.webp',
  'comments/46bc519f-7d78-4a0b-8c90-fb6efa770c94/1769383352583-295e09.webp',
  'comments/1bbbfde9-d109-4cdc-b2a1-49b950dc466c/1769407311827-h9zs28.webp',
  'comments/67df17ce-2492-4ceb-94b1-f1ea3e8d8d89/1769388097230-og9tg6.webp',
  'comments/3c8fc12a-762a-477b-b55d-cc5ec2d0aeb6/1769388418459-0djnnp.webp',
  'comments/70919018-a241-49d2-be1a-9cc637fa6c80/1769390298768-oapiyx.webp',
  'comments/5de60ce3-438c-4567-b66c-87debdd7acca/1769409961315-4j2cpu.webp',
  'comments/52105bd3-0b9e-4331-ae89-c5b3fc0c5ea9/1769412777731-aurc4q.webp',
  'comments/52105bd3-0b9e-4331-ae89-c5b3fc0c5ea9/1769416362529-s9j8fw.webp',
  'comments/0f500d4e-92e5-4b48-a051-82c2c9ec0af9/1769400939743-765dcr.webp',
  // Factory
  'factory/thumbnails/8ef392fe-4878-4984-b4ab-5ff3903997d7/d1a29ff7-aa04-4a4f-9ba3-b60b03dec366.png',
  'factory/screenshots/beb520c9-11a3-433b-810a-846b6435d9e3/2f593d06-40d8-41ba-b8ce-58df00c381a3_2.webp',
  'factory/screenshots/500cf784-a240-40aa-8b70-3fb37b327867/5b32cffd-d509-4e1f-a4af-37bd37588abd_2.webp',
  'factory/thumbnails/f49ab140-9b8d-42a2-bcf9-6e5cabb70988/c6eaadfc-83f2-48e7-9b7f-d481baec175c.png',
];

async function checkFile(path) {
  const url = `${BASE_URL}/${path}`;
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD' }, (res) => {
      resolve({ path, url, status: res.statusCode, exists: res.statusCode === 200 });
    });
    req.on('error', () => resolve({ path, url, status: 'error', exists: false }));
    req.end();
  });
}

async function main() {
  console.log('Checking if files exist on endfieldtools.dev...\n');

  let existCount = 0;
  let missingCount = 0;

  for (const path of filesToCheck) {
    const result = await checkFile(path);
    if (result.exists) {
      console.log(`✅ EXISTS: ${path}`);
      existCount++;
    } else {
      console.log(`❌ MISSING (${result.status}): ${path}`);
      missingCount++;
    }
  }

  console.log(`\n========================================`);
  console.log(`Exists on endfieldtools.dev: ${existCount}`);
  console.log(`Missing: ${missingCount}`);

  if (existCount > 0 && missingCount === 0) {
    console.log(`\n✨ All files already exist on endfieldtools.dev!`);
    console.log(`   The URLs just need to be updated in the database.`);
  } else if (existCount > 0) {
    console.log(`\n⚠️  Some files exist, some are missing.`);
    console.log(`   Missing files may have been deleted or never uploaded.`);
  }
}

main().catch(console.error);
