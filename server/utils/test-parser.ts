import { readFileSync } from 'fs';
import { parseQubicaScoreFile } from './qubica-parser.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the current file's directory path
const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFilePath);

// Read and parse the sample file
const filePath = join(currentDir, '../../attached_assets/bls_farmmxd_24_25__Conquerer X__wk020.S00');
const fileContent = readFileSync(filePath, 'utf-8');

try {
  const parsedData = parseQubicaScoreFile(fileContent);
  console.log('Successfully parsed score file:');
  console.log('League:', parsedData.header.leagueName);
  console.log('Week:', parsedData.header.weekNumber);
  console.log('Date:', parsedData.header.date.toLocaleDateString());
  console.log('Session Time:', parsedData.header.sessionTime);
  console.log('Center:', parsedData.header.centerName);
  console.log('\nFirst team scores:');
  const firstTeam = parsedData.games[0];
  console.log('Team:', firstTeam.teamName);
  console.log('Game:', firstTeam.gameNumber);
  console.log('Lane:', firstTeam.laneNumber);
  console.log('\nBowlers:');
  firstTeam.bowlers.forEach((bowler, index) => {
    console.log(`\n${index + 1}. ${bowler.bowlerName}`);
    console.log(`   Score: ${bowler.score}`);
    console.log(`   Handicap: ${bowler.handicap}`);
    console.log(`   Average: ${bowler.average}`);
    console.log(`   Status: ${JSON.stringify(bowler.status)}`);
  });
} catch (error) {
  console.error('Error parsing file:', error);
}