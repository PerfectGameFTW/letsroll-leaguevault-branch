import { readFileSync } from 'fs';
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

    // List and get the latest files
    console.log('Fetching files from Google Drive folder:', sourceFolderId);
    const files = await googleDrive.listNewFiles(sourceFolderId);

    if (files.length === 0) {
      throw new Error('No files found to import');
    }

    // Find all related files for Farmington Mixed league
    const targetFiles = files.filter(file => 
      file.name.startsWith('bls_farmmxd_24_25.') && 
      (file.name.endsWith('.r00') || file.name.endsWith('.b00'))
    );

    for (const file of targetFiles) {
      console.log(`\n=== Analyzing ${file.name} ===`);
      const fileContent = await googleDrive.getFileContent(file.id);
      console.log('File size:', fileContent.length);

      // Print out first several lines to analyze format
      console.log('\nFirst 10 lines (showing hex for non-printable characters):');
      const lines = fileContent.split(/\r?\n/).slice(0, 10);
      lines.forEach((line, i) => {
        // Convert non-printable characters to hex representation
        const hexLine = line.split('').map(char => {
          const code = char.charCodeAt(0);
          return code < 32 || code > 126 ? `\\x${code.toString(16).padStart(2, '0')}` : char;
        }).join('');
        console.log(`Line ${i + 1}: "${hexLine}"`);
      });

      // Try to identify file structure based on common patterns
      console.log('\nFile structure analysis:');
      const uniqueLineStarts = new Set();
      const linesByLength = new Map();
      const allLines = fileContent.split(/\r?\n/);

      let nonPrintableCount = 0;
      let printableCount = 0;

      allLines.forEach(line => {
        if (line.trim().length === 0) return;

        // Count printable vs non-printable characters
        for (let i = 0; i < line.length; i++) {
          const code = line.charCodeAt(i);
          if (code < 32 || code > 126) {
            nonPrintableCount++;
          } else {
            printableCount++;
          }
        }

        uniqueLineStarts.add(line.substring(0, 5));
        const length = line.length;
        linesByLength.set(length, (linesByLength.get(length) || 0) + 1);
      });

      console.log('Unique line starts (first 5 chars):', Array.from(uniqueLineStarts));
      console.log('Line length distribution:', Object.fromEntries(linesByLength));
      console.log('Character analysis:');
      console.log('- Printable characters:', printableCount);
      console.log('- Non-printable characters:', nonPrintableCount);
      console.log('- Ratio (printable:non-printable):', (printableCount / (nonPrintableCount || 1)).toFixed(2));

      // Try to determine if it's a binary file
      const isBinary = nonPrintableCount > (printableCount * 0.3);
      console.log('File appears to be:', isBinary ? 'Binary format' : 'Text format');
    }

  } catch (error) {
    console.error('Error analyzing files:', error);
  }
}

// Run the analysis
testScoreImport().catch(console.error);