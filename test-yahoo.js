// Quick test to see what Yahoo Finance returns
async function testYahoo() {
  const symbol = 'BHP.AX';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  const data = await response.json();
  const meta = data.chart.result[0].meta;
  
  console.log('Symbol:', symbol);
  console.log('regularMarketPrice:', meta.regularMarketPrice);
  console.log('regularMarketChange:', meta.regularMarketChange);
  console.log('regularMarketChangePercent:', meta.regularMarketChangePercent);
  console.log('chartPreviousClose:', meta.chartPreviousClose);
  console.log('previousClose:', meta.previousClose);
  console.log('\nFull meta:', JSON.stringify(meta, null, 2));
}

testYahoo().catch(console.error);
