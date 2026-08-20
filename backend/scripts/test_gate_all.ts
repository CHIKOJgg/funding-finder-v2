import axios from 'axios';

async function testGate() {
  const [contractsRes, tickersRes] = await Promise.all([
    axios.get('https://fx-api.gateio.ws/api/v4/futures/usdt/contracts'),
    axios.get('https://fx-api.gateio.ws/api/v4/futures/usdt/tickers')
  ]);
  console.log('Gate contracts count:', contractsRes.data.length, 'sample:', contractsRes.data[0]);
  console.log('Gate tickers count:', tickersRes.data.length, 'sample:', tickersRes.data[0]);
}

testGate();
