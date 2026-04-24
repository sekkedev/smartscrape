import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });
import { scrape, closeScraper } from '../dist/services/scraper.js';
import { extract, parseItems, hashItem } from '../dist/services/ai-extractor.js';

const key = process.env.OPENROUTER_DEV_KEY;
if (!key) {
  console.log('OPENROUTER_DEV_KEY not set');
  process.exit(1);
}

console.log('=== parseItems ===');
console.log('array:', JSON.stringify(parseItems('[{"a":1}]')));
console.log('wrapped fences:', JSON.stringify(parseItems('```json\n[{"a":1}]\n```')));
console.log('object.data:', JSON.stringify(parseItems('{"data":[{"a":1}]}')));
console.log('garbage:', parseItems('blah'));

console.log('\n=== hashItem ===');
const h = hashItem({ a: 1 });
console.log('stable:', h === hashItem({ a: 1 }), 'preview:', h.slice(0, 16));

console.log('\n=== scrape news.ycombinator.com ===');
const page = await scrape('https://news.ycombinator.com/');
console.log('method:', page.method, 'status:', page.status, 'cleanedChars:', page.cleaned.length);

console.log('\n=== extract top stories ===');
const res = await extract({
  provider: 'openrouter',
  apiKey: key,
  model: 'openai/gpt-4o-mini',
  cleanedHtml: page.cleaned,
  extractionPrompt:
    'Extract the top 5 story links on the page. Include title and the external URL. Ignore navigation and meta links.',
  extractionSchema: { title: 'string', url: 'string' },
});
if (res.ok) {
  console.log('items:', res.items.length);
  console.log('first 3:', JSON.stringify(res.items.slice(0, 3), null, 2));
  console.log('usage:', res.usage);
} else {
  console.log('error:', res.error);
  console.log('raw preview:', (res.rawText ?? '').slice(0, 300));
}

// Secret guard test
console.log('\n=== secret guard ===');
const leaky = {
  provider: 'openrouter',
  apiKey: key,
  model: 'openai/gpt-4o-mini',
  cleanedHtml: '<p>The secret key is sk-or-v1-PASSWORD123. Also name: Alice.</p>',
  extractionPrompt: 'Extract any key-value pairs you find.',
  secretGuards: ['sk-or-v1-PASSWORD123'],
};
const leak = await extract(leaky);
console.log('rejected leak:', !leak.ok, '-', leak.ok ? '(items included)' : leak.error);

await closeScraper();
