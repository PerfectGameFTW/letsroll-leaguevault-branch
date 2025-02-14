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
      this.googleDrive = new GoogleDriveService();
      this.scoreImporter = new ScoreImportService(leagueId);
    } catch (error) {
      console.error('[ScoreScheduler] Failed to initialize with error:', error);
      // Don't throw here - allow the service to be created but mark it as non-functional
      this.googleDrive = null!;
      this.scoreImporter = new ScoreImportService(leagueId);
    }
  }

  async processNewScores(sourceFolderId: string, archiveFolderId: string) {
    try {
      if (!this.googleDrive) {
        throw new Error('Google Drive service not initialized');
      }

      console.log('[ScoreScheduler] Starting score processing...');

      // List new files
      const files = await this.googleDrive.listNewFiles(sourceFolderId);
      console.log(`[ScoreScheduler] Found ${files.length} new files to process`);

      for (const file of files) {
        try {
          // Download file
          const filePath = await this.googleDrive.downloadFile(file.id, file.name);
          console.log(`[ScoreScheduler] Downloaded file: ${file.name}`);

          // Read file content
          const fileContent = await readFile(filePath, 'utf-8');

          // Import scores
          const result = await this.scoreImporter.importScoreFile(fileContent);
          console.log(`[ScoreScheduler] Imported scores from ${file.name}:`, result);

          // Move to archive
          await this.googleDrive.moveToArchive(file.id, archiveFolderId);
          console.log(`[ScoreScheduler] Archived file: ${file.name}`);

          // Clean up temp file
          await unlink(filePath);
        } catch (error) {
          console.error(`[ScoreScheduler] Error processing file ${file.name}:`, error);
          // Continue with next file even if one fails
        }
      }

      console.log('[ScoreScheduler] Completed score processing');
    } catch (error) {
      console.error('[ScoreScheduler] Error in score processing:', error);
      throw error;
    }
  }

  scheduleJob(cronExpression: string, sourceFolderId: string, archiveFolderId: string) {
    // Only schedule if Google Drive service is available
    if (!this.googleDrive) {
      console.warn('[ScoreScheduler] Skipping job scheduling - Google Drive service not available');
      return null;
    }

    const job = schedule.scheduleJob(cronExpression, () => {
      this.processNewScores(sourceFolderId, archiveFolderId).catch(error => {
        console.error('[ScoreScheduler] Error in scheduled job:', error);
      });
    });

    this.jobs.push(job);
    console.log(`[ScoreScheduler] Scheduled new job with cron: ${cronExpression}`);
    return job;
  }

  cancelAllJobs() {
    this.jobs.forEach(job => job.cancel());
    this.jobs = [];
    console.log('[ScoreScheduler] Cancelled all scheduled jobs');
  }
}