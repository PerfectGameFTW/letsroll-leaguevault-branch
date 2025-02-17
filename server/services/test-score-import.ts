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

    // Get the first file for testing
    const testFile = files[0];
    console.log('Testing with file:', {
      id: testFile.id,
      name: testFile.name
    });

    // Get file content
    const fileContent = await googleDrive.getFileContent(testFile.id);
    console.log('File content analysis:', {
      length: fileContent.length,
      firstLine: fileContent.split('\n')[0],
      lineCount: fileContent.split('\n').length
    });

    // Parse the file content
    console.log('\n=== Testing Parser ===');
    const parsedData = parseQubicaScoreFile(fileContent);

    console.log('\n=== Parsed Header ===');
    console.log({
      date: parsedData.header.date.toISOString(),
      leagueName: parsedData.header.leagueName,
      weekNumber: parsedData.header.weekNumber,
      description: parsedData.header.description
    });

    console.log('\n=== Games Summary ===');
    console.log({
      totalGames: parsedData.games.length,
      gameNumbers: [...new Set(parsedData.games.map(g => g.gameNumber))],
      laneNumbers: [...new Set(parsedData.games.map(g => g.laneNumber))].sort(),
      teamNumbers: [...new Set(parsedData.games.map(g => g.teamNumber))].sort()
    });

    // Log detailed game data
    console.log('\n=== Detailed Game Data ===');
    for (const game of parsedData.games.slice(0, 2)) { // Show first 2 games only
      console.log(`\nTeam ${game.teamNumber} on Lane ${game.laneNumber} (Game ${game.gameNumber}):`);
      for (const bowler of game.bowlers) {
        console.log(`  ${bowler.bowlerName.padEnd(20)}: Score=${bowler.score}, Handicap=${bowler.handicap}, Position=${bowler.position}, Arrays: frames=${bowler.frames.length}, splits=${bowler.splits.length}, notes=${bowler.notes.length}`);
      }
    }

    // Test actual import with a known league ID
    const leagueId = 1; // Use the Farmington Mixed League ID
    const importService = new ScoreImportService(leagueId);

    console.log('\n=== Testing Score Import ===');
    const result = await importService.importScoreFile(fileContent);
    console.log('Import result:', result);

  } catch (error) {
    console.error('Error testing score import:', error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : error);
  }
}

// Run the test
testScoreImport().catch(console.error);