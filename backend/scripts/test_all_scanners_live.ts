import { scanExchanges, getSupportedExchanges } from '../src/exchanges/index.js';

async function main() {
  const exchanges = getSupportedExchanges();
  console.log(`Starting scan of all ${exchanges.length} supported exchanges:`, exchanges.join(', '));
  const startTime = Date.now();
  const results = await scanExchanges(exchanges);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\nScan finished in ${duration}s. Total pairs returned: ${results.length}`);

  const counts: Record<string, number> = {};
  for (const r of results) {
    counts[r.exchange] = (counts[r.exchange] || 0) + 1;
  }

  console.log('\nResults per exchange:');
  for (const ex of exchanges) {
    console.log(`- ${ex.padEnd(14)}: ${counts[ex] || 0} pairs`);
  }
}

main().catch(console.error);
