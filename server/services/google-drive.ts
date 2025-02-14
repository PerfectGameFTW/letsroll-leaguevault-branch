import { google } from 'googleapis';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { mkdir } from 'fs/promises';

// Directory for temporary storage of downloaded files
const TEMP_DIR = join(process.cwd(), 'temp');

export class GoogleDriveService {
  private drive;

  constructor() {
    try {
      console.log('[GoogleDrive] Initializing service...');

      // Validate service account key exists
      if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        throw new Error('Google service account key is not configured');
      }

      // Try to parse and validate the service account key
      let credentials;
      try {
        credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      } catch (parseError) {
        console.error('[GoogleDrive] Failed to parse service account key:', parseError);
        throw new Error('Invalid Google service account key format');
      }

      // Validate required fields in credentials
      if (!credentials.client_email || !credentials.private_key) {
        throw new Error('Invalid service account key: missing required fields');
      }

      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.readonly']
      });

      this.drive = google.drive({ version: 'v3', auth });
      console.log('[GoogleDrive] Service initialized successfully');

      // Ensure temp directory exists
      mkdir(TEMP_DIR, { recursive: true }).catch(error => {
        console.error('[GoogleDrive] Error creating temp directory:', error);
      });
    } catch (error) {
      console.error('[GoogleDrive] Failed to initialize service:', error);
      throw new Error('Failed to initialize Google Drive service: ' + 
        (error instanceof Error ? error.message : String(error)));
    }
  }

  async listNewFiles(folderId: string): Promise<Array<{ id: string; name: string }>> {
    try {
      console.log(`[GoogleDrive] Listing new files in folder: ${folderId}`);
      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and fileExtension='S00'`,
        fields: 'files(id, name)',
        orderBy: 'createdTime desc'
      });

      // Filter out any files with missing id or name
      const files = (response.data.files || [])
        .filter((file): file is { id: string; name: string } => {
          const isValid = typeof file.id === 'string' && typeof file.name === 'string';
          if (!isValid) {
            console.warn('[GoogleDrive] Found invalid file entry:', file);
          }
          return isValid;
        })
        .map(file => ({
          id: file.id,
          name: file.name
        }));

      console.log(`[GoogleDrive] Found ${files.length} new files`);
      return files;
    } catch (error) {
      console.error('[GoogleDrive] Failed to list files:', error);
      throw new Error('Failed to list Google Drive files: ' + 
        (error instanceof Error ? error.message : String(error)));
    }
  }

  async downloadFile(fileId: string, fileName: string): Promise<string> {
    try {
      console.log(`[GoogleDrive] Downloading file: ${fileName} (${fileId})`);
      const filePath = join(TEMP_DIR, fileName);
      const dest = createWriteStream(filePath);

      const response = await this.drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      );

      return new Promise((resolve, reject) => {
        response.data
          .on('end', () => {
            console.log(`[GoogleDrive] File downloaded successfully: ${fileName}`);
            resolve(filePath);
          })
          .on('error', (error: Error) => {
            console.error(`[GoogleDrive] Error downloading file ${fileName}:`, error);
            reject(new Error(`Failed to download file: ${error.message}`));
          })
          .pipe(dest);
      });
    } catch (error) {
      console.error('[GoogleDrive] Failed to download file:', error);
      throw new Error('Failed to download file from Google Drive: ' + 
        (error instanceof Error ? error.message : String(error)));
    }
  }

  async moveToArchive(fileId: string, archiveFolderId: string): Promise<void> {
    try {
      console.log(`[GoogleDrive] Moving file ${fileId} to archive folder ${archiveFolderId}`);
      await this.drive.files.update({
        fileId,
        addParents: archiveFolderId,
        removeParents: 'root',
        fields: 'id, parents'
      });
      console.log(`[GoogleDrive] File ${fileId} moved to archive successfully`);
    } catch (error) {
      console.error('[GoogleDrive] Failed to move file to archive:', error);
      throw new Error('Failed to move file to archive in Google Drive: ' + 
        (error instanceof Error ? error.message : String(error)));
    }
  }
}