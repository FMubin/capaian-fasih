const fs = require('fs');
const path = require('path');

function createTestImageBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

async function runTest() {
  console.log('--- STARTING SIMPLE MASTER DATA & UPLOAD INTEGRATION TEST ---');

  // Test 1: Fetch Master Data
  console.log('1. Testing GET /api/master-data...');
  const masterRes = await fetch('http://localhost:3000/api/master-data');
  const masterJson = await masterRes.json();
  console.log('Master data status:', masterJson.success, '| Total Petugas Master:', masterJson.data.length, '| Total Kecamatan:', masterJson.kecamatan.length);

  // Test 2: Upload Screenshot
  console.log('\n2. Testing POST /api/capaian (Upload Screenshot)...');
  const boundary = '----WebKitFormBoundarySimpleTest';
  const imgBuffer = createTestImageBuffer();

  const postData = [];
  postData.push(`--${boundary}\r\nContent-Disposition: form-data; name="kecamatan"\r\n\r\nKecamatan Kota\r\n`);
  postData.push(`--${boundary}\r\nContent-Disposition: form-data; name="nama"\r\n\r\nAhmad Rizki\r\n`);
  postData.push(`--${boundary}\r\nContent-Disposition: form-data; name="posisi"\r\n\r\nPPL\r\n`);

  postData.push(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="ss_test.png"\r\nContent-Type: image/png\r\n\r\n`);
  const chunk = Buffer.concat([Buffer.from(postData.join('')), imgBuffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);

  const uploadRes = await fetch('http://localhost:3000/api/capaian', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': chunk.length
    },
    body: chunk
  });

  const uploadJson = await uploadRes.json();
  console.log('Upload result:', uploadJson);
  if (!uploadJson.success) {
    throw new Error('Upload screenshot test failed!');
  }

  // Test 3: Delete
  console.log('\n3. Testing DELETE /api/capaian-petugas...');
  const deleteRes = await fetch('http://localhost:3000/api/capaian-petugas', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kecamatan: 'Kecamatan Kota', nama: 'Ahmad Rizki' })
  });
  const deleteJson = await deleteRes.json();
  console.log('Delete result:', deleteJson);

  console.log('\n✅ SIMPLE MASTER DATA & UPLOAD INTEGRATION TEST PASSED!');
}

runTest().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
