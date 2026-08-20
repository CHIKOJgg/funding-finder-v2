import axios from 'axios';

async function testExchanges() {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

  // 1. Apex
  try {
    const res = await axios.get('https://omni.apex.exchange/api/v3/symbols', {
      headers: { 'User-Agent': ua }
    });
    console.log('APEX symbols count/structure:', Object.keys(res.data), Array.isArray(res.data?.data) ? res.data.data.length : res.data);
    if (res.data?.data?.[0]) console.log('Apex sample symbol:', JSON.stringify(res.data.data[0]));
  } catch (e: any) {
    console.log('APEX ERROR:', e.message, e.response?.status, e.response?.data);
  }

  // 2. BitMart
  try {
    const res = await axios.get('https://api.bitmart.com/v2/contract/public/symbols-list', {
      headers: { 'User-Agent': ua }
    });
    console.log('BITMART symbols:', res.status, res.data?.data?.length || res.data);
  } catch (e: any) {
    console.log('BITMART ERROR:', e.message, e.response?.status);
  }

  // 3. CoinEx
  try {
    const res = await axios.get('https://api.coinex.com/v2/futures/market', {
      headers: { 'User-Agent': ua }
    });
    console.log('COINEX market structure:', res.status, Array.isArray(res.data?.data) ? res.data.data.length : res.data);
    if (res.data?.data?.[0]) console.log('CoinEx sample:', JSON.stringify(res.data.data[0]));
  } catch (e: any) {
    console.log('COINEX ERROR:', e.message, e.response?.status);
  }

  // 4. CoinW
  try {
    const res = await axios.get('https://api.coinw.com/api/v2/futures/public/symbols', {
      headers: { 'User-Agent': ua }
    });
    console.log('COINW symbols:', res.status, Array.isArray(res.data?.data) ? res.data.data.length : res.data);
    if (res.data?.data?.[0]) console.log('CoinW sample:', JSON.stringify(res.data.data[0]));
  } catch (e: any) {
    console.log('COINW ERROR:', e.message, e.response?.status);
  }

  // 5. Crypto.com
  try {
    const res = await axios.post('https://deriv-api.crypto.com/derivatives/v1/public/get-instruments', {}, {
      headers: { 'User-Agent': ua }
    });
    console.log('CRYPTO.COM instruments:', res.status, res.data?.result?.data?.length || res.data?.result?.length);
    if (res.data?.result?.data?.[0] || res.data?.result?.[0]) {
      console.log('Crypto.com sample:', JSON.stringify((res.data?.result?.data || res.data?.result)[0]));
    }
  } catch (e: any) {
    console.log('CRYPTO.COM ERROR:', e.message, e.response?.status);
  }

  // 6. Deribit
  try {
    const res = await axios.get('https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=future', {
      headers: { 'User-Agent': ua }
    });
    console.log('DERIBIT instruments:', res.status, res.data?.result?.length);
    if (res.data?.result?.[0]) console.log('Deribit sample:', JSON.stringify(res.data.result[0]));
  } catch (e: any) {
    console.log('DERIBIT ERROR:', e.message, e.response?.status);
  }

  // 7. Drift
  try {
    const res = await axios.get('https://data.api.drift.trade/markets', {
      headers: { 'User-Agent': ua }
    });
    console.log('DRIFT markets:', res.status, res.data);
  } catch (e: any) {
    console.log('DRIFT ERROR:', e.message, e.response?.status);
  }

  // 8. Helix
  try {
    const res = await axios.get('https://sentry.exchange.grpc-web.injective.network/api/chronos/v1/derivative/market_summary_all', {
      headers: { 'User-Agent': ua }
    });
    console.log('HELIX chronos:', res.status, Object.keys(res.data));
  } catch (e: any) {
    console.log('HELIX ERROR 1:', e.message);
    try {
      const res2 = await axios.get('https://api.injective.exchange/api/exchange/v1/perpetual-markets', {
        headers: { 'User-Agent': ua }
      });
      console.log('HELIX api.injective.exchange:', res2.status, res2.data?.data?.length);
    } catch (e2: any) {
      console.log('HELIX ERROR 2:', e2.message);
    }
  }

  // 9. Paradex
  try {
    const res = await axios.get('https://api.prod.paradex.trade/v1/markets', {
      headers: { 'User-Agent': ua }
    });
    console.log('PARADEX prod.paradex.trade:', res.status, res.data?.results?.length || res.data?.data?.length || res.data?.length);
    if (res.data?.results?.[0]) console.log('Paradex sample:', JSON.stringify(res.data.results[0]));
  } catch (e: any) {
    console.log('PARADEX ERROR prod:', e.message, e.response?.status);
    try {
      const res2 = await axios.get('https://api.paradex.io/v1/markets', {
        headers: { 'User-Agent': ua }
      });
      console.log('PARADEX api.paradex.io:', res2.status, res2.data?.length);
    } catch (e2: any) {
      console.log('PARADEX ERROR io:', e2.message, e2.response?.status);
    }
  }

  // 10. WEEX
  try {
    const res = await axios.get('https://api-contract.weex.com/capi/v2/market/contracts', {
      headers: { 'User-Agent': ua }
    });
    console.log('WEEX contracts:', res.status, res.data?.data?.length || res.data?.result?.length, res.data);
  } catch (e: any) {
    console.log('WEEX ERROR:', e.message, e.response?.status);
  }
}

testExchanges();
