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
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.readonly']
      });

      this.drive = google.drive({ version: 'v3', auth });

      // Ensure temp directory exists
      mkdir(TEMP_DIR, { recursive: true }).catch(console.error);
    } catch (error) {
      console.error('Failed to initialize Google Drive service:', error);
      throw error;
    }
  }

  async listNewFiles(folderId: string): Promise<Array<{ id: string; name: string }>> {
    try {
      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and fileExtension='S00'`,
        fields: 'files(id, name)',
        orderBy: 'createdTime desc'
      });

      // Filter out any files with missing id or name
      const files = (response.data.files || [])
        .filter((file): file is { id: string; name: string } => {
          return typeof file.id === 'string' && typeof file.name === 'string';
        })
        .map(file => ({
          id: file.id,
          name: file.name
        }));

      return files;
    } catch (error) {
      console.error('Failed to list files:', error);
      throw error;
    }
  }

  async downloadFile(fileId: string, fileName: string): Promise<string> {
    try {
      const filePath = join(TEMP_DIR, fileName);
      const dest = createWriteStream(filePath);

      const response = await this.drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      );

      return new Promise((resolve, reject) => {
        response.data
          .on('end', () => resolve(filePath))
          .on('error', reject)
          .pipe(dest);
      });
    } catch (error) {
      console.error('Failed to download file:', error);
      throw error;
    }
  }

  async moveToArchive(fileId: string, archiveFolderId: string): Promise<void> {
    try {
      await this.drive.files.update({
        fileId,
        addParents: archiveFolderId,
        removeParents: 'root',
        fields: 'id, parents'
      });
    } catch (error) {
      console.error('Failed to move file to archive:', error);
      throw error;
    }
  }
}