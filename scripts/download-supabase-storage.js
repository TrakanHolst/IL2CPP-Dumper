#!/usr/bin/env node

/**
 * Download all files from Supabase Storage by querying the database
 * for existing file URLs and downloading them directly.
 *
 * Usage:
 *   node scripts/download-supabase-storage.js
 *
 * Output structure:
 *   downloads/
 *   ├── avatars/{userId}/{filename}
 *   ├── covers/{userId}/{filename}
 *   ├── comments/{userId}/{filename}
 *   └── factory/
 *       ├── thumbnails/{userId}/{filename}
 *       └── screenshots/{userId}/{filename}
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// =====================================================
// Configuration
// =====================================================

const SUPABASE_URL = 'https://rmjxwmsbfgvgjpoqvosg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtanh3bXNiZmd2Z2pwb3F2b3NnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIxNzkwMzIsImV4cCI6MjA2Nzc1NTAzMn0.bs417_Z5bfElhW17BcOr7nWN1J96DES_H42yTVOUv8w';

const OUTPUT_DIR = path.join(__dirname, '../downloads');

// URL pattern mappings
const URL_MAPPINGS = {
  'custom-avatars': 'avatars',
  'custom-covers': 'covers',
  'comment-screenshots': 'comments',
  'factory-thumbnails': 'factory/thumbnails',
  'factory-screenshots': 'factory/screenshots',
};

// =====================================================
// Helper Functions
// =====================================================

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function fetchJSON(url, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
    };

    ensureDir(path.dirname(destPath));
    const file = fs.createWriteStream(destPath);

    const req = https.request(options, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }

      if (res.statusCode === 200) {
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });

    req.on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });

    req.end();
  });
}

function extractPathFromUrl(url, bucket) {
  // Extract: https://xxx.supabase.co/storage/v1/object/public/{bucket}/{userId}/{filename}
  // Returns: { userId, filename }
  // Strip query parameters first
  const urlWithoutQuery = url.split('?')[0];
  const pattern = new RegExp(`/storage/v1/object/public/${bucket}/([^/]+)/(.+)$`);
  const match = urlWithoutQuery.match(pattern);
  if (match) {
    return { userId: match[1], filename: match[2] };
  }
  return null;
}

const BATCH_SIZE = 1000;

async function queryWithPagination(baseUrl, filterFn = null) {
  const allData = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = `${baseUrl}&limit=${BATCH_SIZE}&offset=${offset}`;
    try {
      const data = await fetchJSON(url);
      if (Array.isArray(data) && data.length > 0) {
        const filtered = filterFn ? data.filter(filterFn) : data;
        allData.push(...filtered);
        offset += BATCH_SIZE;
        hasMore = data.length === BATCH_SIZE;
        if (hasMore) {
          console.log(`   ... fetched ${offset} rows so far`);
        }
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error(`  Error at offset ${offset}: ${error.message}`);
      hasMore = false;
    }
  }

  return allData;
}

async function queryProfiles() {
  const baseUrl = `${SUPABASE_URL}/rest/v1/profiles?select=id,avatar_url,custom_avatar_cover_url`;
  // Only return profiles that have at least one supabase storage URL
  return queryWithPagination(baseUrl, row =>
    (row.avatar_url && row.avatar_url.includes('supabase.co/storage')) ||
    (row.custom_avatar_cover_url && row.custom_avatar_cover_url.includes('supabase.co/storage'))
  );
}

async function queryComments() {
  const baseUrl = `${SUPABASE_URL}/rest/v1/comments?select=id,user_id,screenshot_url&screenshot_url=not.is.null`;
  return queryWithPagination(baseUrl, row =>
    row.screenshot_url && row.screenshot_url.includes('supabase.co/storage')
  );
}

async function queryFactoryPlans() {
  const url = `${SUPABASE_URL}/rest/v1/factory_plans?select=id,user_id,thumbnail_url,screenshot_url,additional_screenshot_url`;
  try {
    const data = await fetchJSON(url);
    if (Array.isArray(data)) {
      return data;
    }
    return [];
  } catch (error) {
    console.error(`  Error querying factory_plans: ${error.message}`);
    return [];
  }
}

async function downloadFromUrl(url, bucket, localFolder) {
  const pathInfo = extractPathFromUrl(url, bucket);
  if (!pathInfo) {
    console.log(`    ⚠️  Could not parse URL: ${url.substring(0, 80)}...`);
    return false;
  }

  const destPath = path.join(OUTPUT_DIR, localFolder, pathInfo.userId, pathInfo.filename);

  try {
    await downloadFile(url, destPath);
    console.log(`    ✅ ${pathInfo.userId}/${pathInfo.filename}`);
    return true;
  } catch (error) {
    console.log(`    ❌ ${pathInfo.userId}/${pathInfo.filename}: ${error.message}`);
    return false;
  }
}

// =====================================================
// Main
// =====================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       Supabase Storage Download (via Database Query)       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  console.log(`\n📂 Output directory: ${OUTPUT_DIR}`);
  ensureDir(OUTPUT_DIR);

  let totalDownloaded = 0;
  let totalFailed = 0;

  // 1. Download profile avatars
  console.log('\n📦 Querying profiles for avatars and covers...');
  const profiles = await queryProfiles();
  console.log(`   Found ${profiles.length} profiles`);

  for (const profile of profiles) {
    // Avatar
    if (profile.avatar_url && profile.avatar_url.includes('custom-avatars')) {
      const success = await downloadFromUrl(profile.avatar_url, 'custom-avatars', 'avatars');
      if (success) totalDownloaded++; else totalFailed++;
    }

    // Cover
    if (profile.custom_avatar_cover_url && profile.custom_avatar_cover_url.includes('custom-covers')) {
      const success = await downloadFromUrl(profile.custom_avatar_cover_url, 'custom-covers', 'covers');
      if (success) totalDownloaded++; else totalFailed++;
    }
  }

  // 2. Download comment screenshots
  console.log('\n📦 Querying comments for screenshots...');
  const comments = await queryComments();
  console.log(`   Found ${comments.length} comments with screenshots`);

  for (const comment of comments) {
    if (comment.screenshot_url) {
      const success = await downloadFromUrl(comment.screenshot_url, 'comment-screenshots', 'comments');
      if (success) totalDownloaded++; else totalFailed++;
    }
  }

  // 3. Download factory plan thumbnails and screenshots
  console.log('\n📦 Querying factory_plans for thumbnails and screenshots...');
  const plans = await queryFactoryPlans();
  console.log(`   Found ${plans.length} factory plans`);

  for (const plan of plans) {
    // Thumbnail - check both factory-thumbnails AND factory-screenshots buckets
    // (some thumbnails were incorrectly stored in factory-screenshots)
    if (plan.thumbnail_url && plan.thumbnail_url.includes('factory-thumbnails')) {
      const success = await downloadFromUrl(plan.thumbnail_url, 'factory-thumbnails', 'factory/thumbnails');
      if (success) totalDownloaded++; else totalFailed++;
    } else if (plan.thumbnail_url && plan.thumbnail_url.includes('factory-screenshots')) {
      // Edge case: thumbnail stored in screenshots bucket - download to screenshots folder
      const success = await downloadFromUrl(plan.thumbnail_url, 'factory-screenshots', 'factory/screenshots');
      if (success) totalDownloaded++; else totalFailed++;
    }

    // Screenshot
    if (plan.screenshot_url && plan.screenshot_url.includes('factory-screenshots')) {
      const success = await downloadFromUrl(plan.screenshot_url, 'factory-screenshots', 'factory/screenshots');
      if (success) totalDownloaded++; else totalFailed++;
    }

    // Additional screenshot
    if (plan.additional_screenshot_url && plan.additional_screenshot_url.includes('factory-screenshots')) {
      const success = await downloadFromUrl(plan.additional_screenshot_url, 'factory-screenshots', 'factory/screenshots');
      if (success) totalDownloaded++; else totalFailed++;
    }
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`✨ Download complete!`);
  console.log(`   Downloaded: ${totalDownloaded} files`);
  console.log(`   Failed: ${totalFailed} files`);
  console.log(`   Output: ${OUTPUT_DIR}`);
  console.log('════════════════════════════════════════════════════════════');

  if (totalDownloaded > 0) {
    console.log('\n📋 Next steps:');
    console.log('1. Upload the downloads/ folder contents to your Apache server:');
    console.log('   - Copy contents of downloads/ to /var/www/endfieldtools.dev/uploads/');
    console.log('2. Run the SQL migration in Supabase to update URLs');
  }
}

main().catch(console.error);
