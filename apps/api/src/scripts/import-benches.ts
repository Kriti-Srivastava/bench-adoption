// Usage: npm run import-benches -- <park-slug> <file.csv>
// CSV columns: code,name,zone,lat,lng[,description]. Re-importing updates existing codes.
import { readFile } from 'node:fs/promises';
import { runScript } from './run.ts';

await runScript(async (services) => {
  const [slug, file] = process.argv.slice(2);
  if (!slug || !file) throw new Error('Usage: npm run import-benches -- <park-slug> <file.csv>');
  const result = await services.benches.importCsv(slug, await readFile(file, 'utf8'));
  console.log(`Imported: ${result.created} created, ${result.updated} updated.`);
});
