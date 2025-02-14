import schedule from 'node-schedule';
import { GoogleDriveService } from './google-drive.js';
import { ScoreImportService } from './score-import.js';
import { readFile, unlink } from 'fs/promises';

export class ScoreSchedulerService {
  private googleDrive: GoogleDriveService;
  private scoreImporter: ScoreImportService;
  private jobs: schedule.Job[] = [];

  constructor(leagueId: number) {
    try {
      console.log('[ScoreScheduler] Initializing service for league:', leagueId);
      this.googleDrive = new GoogleDriveService();
      this.scoreImporter = new ScoreImportService(leagueId);
      console.log('[ScoreScheduler] Service initialized successfully');
    } catch (error) {
      console.error('[ScoreScheduler] Failed to initialize with error:', error);
      throw new Error('Failed to initialize ScoreSchedulerService: ' + 
        (error instanceof Error ? error.message : String(error)));
    }
  }

  async processNewScores(sourceFolderId: string, archiveFolderId: string) {
    console.log('[ScoreScheduler] Starting score processing...');
    console.log('[ScoreScheduler] Source folder:', sourceFolderId);
    console.log('[ScoreScheduler] Archive folder:', archiveFolderId);

    try {
      if (!this.googleDrive) {
        throw new Error('Google Drive service not initialized');
      }

      // List new files
      const files = await this.googleDrive.listNewFiles(sourceFolderId);
      console.log(`[ScoreScheduler] Found ${files.length} new files to process`);

      const results = [];
      for (const file of files) {
        try {
          console.log(`[ScoreScheduler] Processing file: ${file.name} (${file.id})`);

          // Download file
          const filePath = await this.googleDrive.downloadFile(file.id, file.name);
          console.log(`[ScoreScheduler] Downloaded file to: ${filePath}`);

          // Read file content
          const fileContent = await readFile(filePath, 'utf-8');
          console.log(`[ScoreScheduler] Read file content, size: ${fileContent.length} bytes`);

          // Import scores
          const result = await this.scoreImporter.importScoreFile(fileContent);
          console.log(`[ScoreScheduler] Import result for ${file.name}:`, result);
          results.push({ file: file.name, result });

          // Move to archive
          await this.googleDrive.moveToArchive(file.id, archiveFolderId);
          console.log(`[ScoreScheduler] Moved file to archive: ${file.name}`);

          // Clean up temp file
          await unlink(filePath);
          console.log(`[ScoreScheduler] Cleaned up temp file: ${filePath}`);
        } catch (error) {
          console.error(`[ScoreScheduler] Error processing file ${file.name}:`, error);
          results.push({ 
            file: file.name, 
            error: error instanceof Error ? error.message : String(error)
          });
          // Continue with next file even if one fails
        }
      }

      console.log('[ScoreScheduler] Completed score processing');
      return results;
    } catch (error) {
      console.error('[ScoreScheduler] Error in score processing:', error);
      throw error;
    }
  }

  scheduleJob(cronExpression: string, sourceFolderId: string, archiveFolderId: string) {
    console.log(`[ScoreScheduler] Scheduling new job with cron: ${cronExpression}`);
    console.log(`[ScoreScheduler] Source folder: ${sourceFolderId}`);
    console.log(`[ScoreScheduler] Archive folder: ${archiveFolderId}`);

    const job = schedule.scheduleJob(cronExpression, () => {
      this.processNewScores(sourceFolderId, archiveFolderId).catch(error => {
        console.error('[ScoreScheduler] Error in scheduled job:', error);
      });
    });

    this.jobs.push(job);
    console.log('[ScoreScheduler] Job scheduled successfully');
    return job;
  }

  cancelAllJobs() {
    console.log(`[ScoreScheduler] Cancelling ${this.jobs.length} scheduled jobs`);
    this.jobs.forEach(job => job.cancel());
    this.jobs = [];
    console.log('[ScoreScheduler] All jobs cancelled');
  }
}