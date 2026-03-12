/**
 * Test script to debug weapon API fetching
 * Run with: node scripts/test-weapon-api.js
 */

const token = 'Lmlafgt7UXqZhPj6YuJdSTB4gQeKAqf2%2BAlgaKuwaYm1ueMY9%2Fk4fj80BMQPBaRYwGDvvCX7d51ASDjkK3c6JYr38j3tfyGkpb8IALNwcILU%2FBvE%2BAVIcKEKa%2BOmy4OBct7CbjXFlU5YJRnSqJntdaeN26qCZ%2FjE6FUwy6XTZJjKYT00mU4LvTCBRfUtPFVLCVKSqJdEgr0tipixGCeEKKP3lqxYnnLG1AMAxWTvGJCih2%2FOeFkCogCI6T85%2B%2BEtpSjWGGewiLIymn5CsB06%2BCZkRClb2Mp1W2xg29TR%2FtTQtFADGjMs45P6o0DEGFyS0d0eJB9HlGSueBf00jHwili2zZleJRzeysa6zSJHkGL%2BThw%2BT7k0tPzi1vlq%2FOV2ijWXkirYw9ehcaNLugCP8iIr%2B8ZrAPL%2FEm5sl3IkU7BEUU%2FCqKTm1VAn8GHcdsfSvVkaM0ejV1fBAkY60Ovz8t3MCUqPKVbJYCbVkjqyP3RvwNAakHRVfyf29EJmtWHV%2FkL0I%2BHo0hJgbF8vi%2BY97jvyG%2Bh58%2FIaEZ8KNh9XaQm0XgU%2BEXArS1%2FFMRb2TtmjTPM5BGOa%2FwUBcngf0zNnL33FtyqhlYt3Yd3iM4h9hqbKkTLYekUzmtahpX5UIUePzTf03x3AyfRnAg%3D%3D';

// Decode token
function extractToken(input) {
  let t = input.trim();

  if (t.includes('token=')) {
    const match = t.match(/token=([^&\s]+)/);
    if (match) t = match[1];
  }

  if (t.includes('%')) {
    try {
      const decoded = decodeURIComponent(t);
      if (decoded !== t && (decoded.includes('+') || decoded.includes('/') || decoded.includes('='))) {
        t = decoded;
      }
    } catch {
      // Use original
    }
  }

  return t;
}

const decodedToken = extractToken(token);
console.log('Decoded token:', decodedToken.substring(0, 50) + '...');

// API Configuration
const CHARACTER_API_URL = 'https://ef-webview.gryphline.com/api/record/char';
const WEAPON_API_URL = 'https://ef-webview.gryphline.com/api/record/weapon';
const SERVER_ID = '3'; // Global
const LANG = 'en-us';

// Pool types
const CHARACTER_POOL_TYPES = [
  'E_CharacterGachaPoolType_Standard',
  'E_CharacterGachaPoolType_Special',
  'E_CharacterGachaPoolType_Beginner',
];

const WEAPON_POOL_TYPES = [
  'E_WeaponGachaPoolType_Constant',
];

async function testApi(baseUrl, poolType, name) {
  const params = new URLSearchParams({
    token: decodedToken,
    lang: LANG,
    pool_type: poolType,
    server_id: SERVER_ID,
  });

  const url = `${baseUrl}?${params.toString()}`;
  console.log(`\n========================================`);
  console.log(`Testing ${name}: ${poolType}`);
  console.log(`URL: ${baseUrl}?token=...&lang=${LANG}&pool_type=${poolType}&server_id=${SERVER_ID}`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      console.log('Response is not JSON:', text.substring(0, 500));
      return;
    }

    console.log('Response code:', json.code);
    console.log('Response message:', json.message || 'none');

    if (json.data) {
      console.log('Has more:', json.data.hasMore);
      console.log('Records count:', json.data.list?.length || 0);

      if (json.data.list && json.data.list.length > 0) {
        console.log('\nFirst record:');
        console.log(JSON.stringify(json.data.list[0], null, 2));

        if (json.data.list.length > 1) {
          console.log('\nSecond record:');
          console.log(JSON.stringify(json.data.list[1], null, 2));
        }
      }
    } else {
      console.log('Full response:', JSON.stringify(json, null, 2));
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

async function main() {
  console.log('Testing Headhunt API...\n');

  // Test character APIs
  for (const poolType of CHARACTER_POOL_TYPES) {
    await testApi(CHARACTER_API_URL, poolType, 'Character');
  }

  // Test weapon APIs
  for (const poolType of WEAPON_POOL_TYPES) {
    await testApi(WEAPON_API_URL, poolType, 'Weapon');
  }

  // Also try alternative weapon pool types (in case the API uses different names)
  console.log('\n\n========== TRYING ALTERNATIVE WEAPON POOL TYPES ==========');

  const alternativeWeaponPoolTypes = [
    'E_WeaponGachaPoolType_Standard',
    'E_WeaponGachaPoolType_Special',
    'E_WeaponGachaPoolType_Normal',
    '0', // Try numeric
    '1',
    'constant',
    'standard',
  ];

  for (const poolType of alternativeWeaponPoolTypes) {
    await testApi(WEAPON_API_URL, poolType, 'Weapon (alt)');
  }
}

main().catch(console.error);
