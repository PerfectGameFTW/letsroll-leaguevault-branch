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

    // Look specifically for the Farmington Mixed League .s00 file
    const farmingtonFile = files.find(f => f.name.toLowerCase().includes('farmmxd') && f.name.endsWith('.s00'));
    if (!farmingtonFile) {
      throw new Error('Farmington Mixed League score file not found');
    }

    console.log('Testing with file:', {
      id: farmingtonFile.id,
      name: farmingtonFile.name,
      size: farmingtonFile.size
    });

    // Get file content
    const fileContent = await googleDrive.getFileContent(farmingtonFile.id);
    console.log('\n=== Raw File Content Analysis ===');
    console.log({
      length: fileContent.length,
      firstLine: fileContent.split('\n')[0],
      lineCount: fileContent.split('\n').length
    });

    // Log first few lines for debugging
    console.log('\n=== First 5 Lines (Raw) ===');
    const firstLines = fileContent.split('\n').slice(0, 5);
    firstLines.forEach((line, index) => {
      console.log(`\nLine ${index + 1}:`);
      console.log('Raw:', line);
      console.log('Fields:', line.split('\t'));

      // Try to parse team number from line
      const fields = line.split('\t');
      if (fields.length >= 1) {
        console.log('Team Number Field:', {
          raw: fields[0],
          trimmed: fields[0].trim(),
          withoutLeadingZeros: fields[0].replace(/^0+/, ''),
          asNumber: parseInt(fields[0])
        });

        // Debug team name if available (usually field 9)
        if (fields.length >= 10) {
          console.log('Team/Bowler Name Field:', fields[9]);
        }

        // Debug position and lane numbers
        if (fields.length >= 9) {
          console.log('Additional Fields:', {
            position: fields[2],
            laneNumber: fields[8]
          });
        }
      }
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
      gameNumbers: [...new Set(parsedData.games.map(g => g.gameNumber))].sort(),
      laneNumbers: [...new Set(parsedData.games.map(g => g.laneNumber))].sort(),
      teamNumbers: [...new Set(parsedData.games.map(g => g.teamNumber))].sort(),
      uniqueTeams: [...new Set(parsedData.games.map(g => g.teamName))].sort()
    });

    // Log detailed game data
    console.log('\n=== Detailed Game Data ===');
    for (const game of parsedData.games.slice(0, 2)) { // Show first 2 games only
      console.log(`\nTeam ${game.teamNumber} (${game.teamName}) on Lane ${game.laneNumber} (Game ${game.gameNumber}):`);
      for (const bowler of game.bowlers) {
        console.log(`  ${bowler.bowlerName.padEnd(20)}: Score=${bowler.score}, Handicap=${bowler.handicap}, Position=${bowler.position}, Status=${JSON.stringify(bowler.status)}, TeamNumber=${bowler.teamNumber}`);
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