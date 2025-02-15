import { readFileSync } from 'fs';
import { ScoreImportService } from './score-import.js';
import { GoogleDriveService } from './google-drive.js';
import { parseQubicaScoreFile } from '../utils/qubica-parser.js';

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

    // Parse the file content directly to get the information
    const parsedData = parseQubicaScoreFile(fileContent);

    console.log('\n=== Requested Information ===');
    console.log('Date Bowled:', parsedData.header.date.toLocaleDateString());

    // Find teams on lanes 9 and 10
    const lane9Team = parsedData.games.find(game => game.laneNumber === 9);
    const lane10Team = parsedData.games.find(game => game.laneNumber === 10);

    console.log('\nLane 9 Team:', lane9Team ? `${lane9Team.teamName} (Team ${lane9Team.teamNumber})` : 'Not found');
    console.log('Lane 10 Team:', lane10Team ? `${lane10Team.teamName} (Team ${lane10Team.teamNumber})` : 'Not found');

    // Get first bowler's scores from lane 10
    if (lane10Team && lane10Team.bowlers.length > 0) {
      const firstBowler = lane10Team.bowlers[0];
      console.log(`\nFirst bowler on Lane 10: ${firstBowler.bowlerName}`);
      console.log('Scores:', {
        game1: firstBowler.score,
        handicap: firstBowler.handicap,
        average: firstBowler.average
      });
    }

  } catch (error) {
    console.error('Error importing scores:', error);
  }
}

// Run the import
testScoreImport().catch(console.error);