const http = require('http');
const jobId = process.argv[2];
if (!jobId) { console.error('Usage: node wait-export.mjs <jobId>'); process.exit(1); }

function req(method, path) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 4001, path, method, headers: { 'x-export-token': '29de7f099bff7b31618a1c6decf64fa3', 'Accept': 'application/json' } };
    const r = http.request(opts, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } }); });
    r.on('error', reject); r.end();
  });
}

async function main() {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const status = await req('GET', '/api/export/status/' + jobId);
    if (status.status === 'done') {
      console.log(JSON.stringify({ status: 'done', fileName: status.fileName, url: status.downloadUrl }));
      // Download it
      if (status.downloadUrl) {
        const fs = require('fs');
        const outPath = 'C:\\Users\\Acer\\OneDrive\\Documentos\\Programación\\chatwoot-icc-app\\backend\\exports\\export_preventa_test.xlsx';
        const fileStream = fs.createWriteStream(outPath);
        const downloadReq = http.request({ hostname: 'localhost', port: 4001, path: status.downloadUrl, method: 'GET', headers: { 'x-export-token': '29de7f099bff7b31618a1c6decf64fa3' } }, (res) => {
          res.pipe(fileStream);
          fileStream.on('finish', () => { fileStream.close(); console.log('Downloaded to ' + outPath); process.exit(0); });
        });
        downloadReq.end();
      }
      return;
    }
    if (status.status === 'error') {
      console.log(JSON.stringify({ status: 'error', error: status.error }));
      process.exit(1);
    }
    console.log(`  ${status.status}: ${status.conversacionesProcesadas} conversations (${Math.round(i*5/60*10)/10}m)`);
  }
  console.log('Timed out');
  process.exit(1);
}

main().catch(e => { console.error(e.message); process.exit(1); });
