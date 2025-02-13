import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ScoreImportService } from './score-import.js';

// Get the current file's directory path
const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFilePath);

async function testScoreImport() {
  try {
    const filePath = join(currentDir, '../../attached_assets/bls_farmmxd_24_25__Conquerer X__wk020.S00');
    const fileContent = readFileSync(filePath, 'utf-8');

    // Create import service for league ID 1
    const importService = new ScoreImportService(1);

    // Import the scores
    const result = await importService.importScoreFile(fileContent);

    console.log('Score import completed successfully:');
    console.log(`Games created: ${result.gamesCreated}`);
    console.log(`Scores created: ${result.scoresCreated}`);
  } catch (error) {
    console.error('Error importing scores:', error);
  }
}

// Run the import
testScoreImport().catch(console.error);