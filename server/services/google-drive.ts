import { google } from 'googleapis';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { mkdir, readFile } from 'fs/promises';
import type { GaxiosError } from 'googleapis-common';

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
        console.log('[GoogleDrive] Successfully parsed service account credentials');
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
      console.log('[GoogleDrive] Service initialized successfully with client email:', credentials.client_email);

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
      console.log(`[GoogleDrive] Starting to list files in folder: ${folderId}`);

      // List all files in the folder without initial filtering
      const response = await this.drive.files.list({
        q: `'${folderId}' in parents`,
        fields: 'files(id, name, createdTime, mimeType, size)',
        orderBy: 'createdTime desc'
      });

      // Log the entire response for debugging
      console.log('[GoogleDrive] Raw API response:', JSON.stringify(response.data, null, 2));
      console.log('[GoogleDrive] Total files found in folder:', response.data.files?.length || 0);

      // Process and filter files
      const allFiles = response.data.files || [];
      console.log('[GoogleDrive] All files before filtering:', 
        allFiles.map(f => ({
          name: f.name,
          mimeType: f.mimeType,
          size: f.size,
          createdTime: f.createdTime
        }))
      );

      const files = allFiles
        .filter(file => {
          const isFile = file.mimeType !== 'application/vnd.google-apps.folder';
          if (!isFile) {
            console.log(`[GoogleDrive] Skipping folder: ${file.name}`);
            return false;
          }

          // Check for either .S00 or .s00 extension
          const extension = file.name?.split('.').pop()?.toUpperCase();
          const isScoreFile = extension === 'S00';
          console.log(`[GoogleDrive] File ${file.name}: extension=${extension}, isScoreFile=${isScoreFile}`);
          return isScoreFile;
        })
        .map(file => ({
          id: file.id!,
          name: file.name!
        }));

      console.log(`[GoogleDrive] Found ${files.length} score files after filtering:`, 
        files.map(f => ({ name: f.name, id: f.id })));
      return files;
    } catch (error) {
      console.error('[GoogleDrive] Failed to list files:', error);
      const apiError = error as { response?: { status?: number; statusText?: string; data?: any } };
      if (apiError.response) {
        console.error('[GoogleDrive] API Error Response:', {
          status: apiError.response.status,
          statusText: apiError.response.statusText,
          data: apiError.response.data
        });
      }
      throw new Error('Failed to list Google Drive files: ' + 
        (error instanceof Error ? error.message : String(error)));
    }
  }

  async getFileContent(fileId: string): Promise<string> {
    try {
      console.log(`[GoogleDrive] Starting to get content for file: ${fileId}`);

      // Get file content using media download
      const response = await this.drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'text' }
      );

      if (!response.data) {
        throw new Error('No content received from Google Drive');
      }

      console.log(`[GoogleDrive] Successfully retrieved file content, length: ${response.data.length}`);
      return response.data;
    } catch (error) {
      console.error('[GoogleDrive] Failed to get file content:', error);
      const apiError = error as GaxiosError;
      if (apiError.response) {
        console.error('[GoogleDrive] Get Content API Error:', {
          status: apiError.response.status,
          statusText: apiError.response.statusText,
          data: apiError.response.data
        });
      }
      throw new Error('Failed to get file content from Google Drive: ' + 
        (error instanceof Error ? error.message : String(error)));
    }
  }

  async downloadFile(fileId: string, fileName: string): Promise<string> {
    try {
      console.log(`[GoogleDrive] Starting download for file: ${fileName} (${fileId})`);
      const filePath = join(TEMP_DIR, fileName);
      const dest = createWriteStream(filePath);

      // Verify file exists and get metadata
      try {
        const metadata = await this.drive.files.get({
          fileId,
          fields: 'size,mimeType'
        });
        console.log(`[GoogleDrive] File metadata:`, metadata.data);
      } catch (metadataError) {
        console.error('[GoogleDrive] Failed to get file metadata:', metadataError);
        throw new Error('File not found or not accessible');
      }

      const response = await this.drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      );

      return new Promise((resolve, reject) => {
        let downloadedSize = 0;

        response.data
          .on('data', (chunk: Buffer) => {
            downloadedSize += chunk.length;
            console.log(`[GoogleDrive] Downloaded ${downloadedSize} bytes of ${fileName}`);
          })
          .on('end', () => {
            console.log(`[GoogleDrive] File downloaded successfully: ${fileName} (${downloadedSize} bytes)`);
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
      const apiError = error as GaxiosError;
      if (apiError.response) {
        console.error('[GoogleDrive] Download API Error:', {
          status: apiError.response.status,
          statusText: apiError.response.statusText,
          data: apiError.response.data
        });
      }
      throw new Error('Failed to download file from Google Drive: ' + 
        (error instanceof Error ? error.message : String(error)));
    }
  }

  async moveToArchive(fileId: string, archiveFolderId: string): Promise<void> {
    try {
      console.log(`[GoogleDrive] Moving file ${fileId} to archive folder ${archiveFolderId}`);

      // Get current file details
      const file = await this.drive.files.get({
        fileId,
        fields: 'parents'
      });
      console.log('[GoogleDrive] Current file parents:', file.data.parents);

      const updateResponse = await this.drive.files.update({
        fileId,
        addParents: archiveFolderId,
        removeParents: file.data.parents?.join(','),
        fields: 'id, parents'
      });

      console.log('[GoogleDrive] File move response:', updateResponse.data);
      console.log(`[GoogleDrive] File ${fileId} moved to archive successfully`);
    } catch (error) {
      console.error('[GoogleDrive] Failed to move file to archive:', error);
      const apiError = error as GaxiosError;
      if (apiError.response) {
        console.error('[GoogleDrive] Move API Error:', {
          status: apiError.response.status,
          statusText: apiError.response.statusText,
          data: apiError.response.data
        });
      }
      throw new Error('Failed to move file to archive in Google Drive: ' + 
        (error instanceof Error ? error.message : String(error)));
    }
  }

  async markFileAsProcessed(fileId: string): Promise<void> {
    // Get archive folder ID from environment
    const archiveFolderId = process.env.GOOGLE_DRIVE_ARCHIVE_FOLDER_ID;
    if (!archiveFolderId) {
      throw new Error('Archive folder ID not configured');
    }

    // Move file to archive folder
    await this.moveToArchive(fileId, archiveFolderId);
  }
}