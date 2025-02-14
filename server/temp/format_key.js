import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the service account key file
const keyContent = readFileSync(join(__dirname, '..', '..', 'attached_assets', 'Pasted--type-service-account-project-id-pg-league-manager-app-private-key-id-067eb1a-1739517560948.txt'), 'utf8');

// Parse and stringify to create a single line
const formattedKey = JSON.stringify(JSON.parse(keyContent));
console.log('Formatted key (single line):');
console.log(formattedKey);