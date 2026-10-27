import { search, getRadio } from './src/innertube.js';

console.log('🧪 Starting YouTube Music API Tests...\n');

async function runTests() {
  try {
    // 1. Test Search
    console.log('1️⃣ Testing search for "Daft Punk Get Lucky"...');
    const searchRes = await search({ query: 'Daft Punk Get Lucky', filter: 'songs', limit: 3 });
    console.log(`   Found ${searchRes.total} results (showing ${searchRes.results.length}):`);
    searchRes.results.forEach((item, i) => {
      console.log(`   [${i + 1}] ${item.title} - ${item.artist} (${item.durationText || 'N/A'}) [ID: ${item.id}]`);
    });

    if (!searchRes.results.length) {
      throw new Error('Search returned no results');
    }

    const testVideoId = searchRes.results[0].id;

    // 2. Test Radio / Recommendations
    console.log(`\n2️⃣ Testing radio recommendations for videoId: ${testVideoId}...`);
    const radioRes = await getRadio({ videoId: testVideoId, limit: 3 });
    console.log(`   Found ${radioRes.total} radio tracks (showing ${radioRes.tracks.length}):`);
    radioRes.tracks.forEach((item, i) => {
      console.log(`   [${i + 1}] ${item.title} - ${item.artist} (${item.durationText || 'N/A'}) [ID: ${item.id}]`);
    });

    console.log('\n✅ All tests passed successfully!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

runTests();
