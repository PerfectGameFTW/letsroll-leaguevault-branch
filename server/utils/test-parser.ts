import { readFileSync } from 'fs';
import { parseQubicaScoreFile } from './qubica-parser.js';
import { GoogleDriveService } from '../services/google-drive.js';

async function testScoreImport() {
  try {
    // Initialize Google Drive service
    console.log('Initializing Google Drive service...');
    const googleDrive = new GoogleDriveService();
    const sourceFolderId = process.env.GOOGLE_DRIVE_SOURCE_FOLDER_ID;

    if (!sourceFolderId) {
      throw new Error('Source folder ID not configured');
    }

    // List and get the latest file
    console.log('Fetching files from Google Drive folder:', sourceFolderId);
    const files = await googleDrive.listNewFiles(sourceFolderId);

    if (files.length === 0) {
      throw new Error('No score files found to import');
    }

    // Find the specific file we want
    const targetFile = files.find(file => file.name === 'bls_farmmxd_24_25.s00');
    if (!targetFile) {
      throw new Error('Target score file not found');
    }

    console.log('Found target file:', targetFile.name);
    const fileContent = await googleDrive.getFileContent(targetFile.id);
    console.log('Successfully read file content, length:', fileContent.length);

    // Print out first several lines to analyze format
    console.log('\n=== Raw File Content (first 10 lines) ===');
    const lines = fileContent.split(/\r?\n/).slice(0, 10);
    lines.forEach((line, i) => console.log(`Line ${i + 1}: "${line}"`));

    // Try parsing with current parser
    console.log('\n=== Attempting to parse file ===');
    const parsedData = parseQubicaScoreFile(fileContent);

    // Output parsed information
    console.log('\n=== Parsed Information ===');
    console.log('Date:', parsedData.header.date.toLocaleDateString());
    console.log('League:', parsedData.header.leagueName);
    console.log('Week:', parsedData.header.weekNumber);
    console.log('\nTeams by Lane:');
    const teamsByLane = new Map();
    parsedData.games.forEach(game => {
      if (!teamsByLane.has(game.laneNumber)) {
        teamsByLane.set(game.laneNumber, game.teamName);
      }
    });

    // Sort by lane number and display
    Array.from(teamsByLane.entries())
      .sort(([a], [b]) => a - b)
      .forEach(([lane, team]) => {
        console.log(`Lane ${lane}: ${team}`);
      });

    // Show scores for teams on lanes 9 and 10
    console.log('\nDetailed Scores for Lanes 9 and 10:');
    [9, 10].forEach(laneNumber => {
      const laneGames = parsedData.games.filter(g => g.laneNumber === laneNumber);
      if (laneGames.length > 0) {
        console.log(`\nLane ${laneNumber} - ${laneGames[0].teamName}:`);
        const firstBowler = laneGames[0].bowlers[0];
        if (firstBowler) {
          console.log('First Bowler:', firstBowler.bowlerName);
          laneGames.forEach(game => {
            const bowlerInGame = game.bowlers.find(b => b.bowlerName === firstBowler.bowlerName);
            console.log(`Game ${game.gameNumber}: ${bowlerInGame?.score || 'N/A'}`);
          });
        }
      } else {
        console.log(`No team found on lane ${laneNumber}`);
      }
    });

  } catch (error) {
    console.error('Error importing scores:', error);
  }
}

// Run the import
testScoreImport().catch(console.error);