import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api.js';
import { runBowlerPostCreateSync } from '../services/bowler-sync.js';
import { createLogger } from '../logger';
import { z } from 'zod';
import { insertBowlerSchema, type InsertBowler } from '../../shared/schema/bowlers';
import {
  hasZipLocalFileHeader,
  looksLikeText,
  inspectZipForBomb,
} from '../utils/spreadsheet-magic-bytes.js';

const log = createLogger("BulkImport");

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Business cap on rows per import. Enforced as early as practical so a
// pathological file cannot make us build an unbounded in-memory array.
const MAX_IMPORT_ROWS = 2000;

// Defense-in-depth against XLSX zip bombs: reject before ExcelJS
// materialises the workbook if the ZIP central directory declares a
// total uncompressed payload above this absolute cap, or an overall
// decompression ratio above the multiplier. A legitimate sub-5MB,
// <=2000-row workbook stays well under both.
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_DECOMPRESSION_RATIO = 100;

// Upper bound on parse wall-clock time. A file that survives the size
// checks but is still pathological cannot hang the request forever; on
// timeout the parse aborts and the route returns a clean 400.
const PARSE_TIMEOUT_MS = 15000;

class ParseTimeoutError extends Error {
  constructor() {
    super('Parsing the file took too long and was aborted.');
    this.name = 'ParseTimeoutError';
  }
}

// Sentinel thrown out of ExcelJS's `eachRow` callback to stop iteration
// the moment the row cap is exceeded (the callback has no `break`).
const ROW_LIMIT_EXCEEDED = Symbol('ROW_LIMIT_EXCEEDED');

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ParseTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}


interface ParsedRow {
  rowNumber: number;
  leagueName: string;
  teamName: string;
  teamNumber: number;
  bowlerName: string;
  email: string;
  phone: string;
}

interface ValidatedRow extends ParsedRow {
  status: 'valid' | 'error' | 'duplicate';
  errors: string[];
  leagueId?: number;
  teamId?: number;
  isNewTeam?: boolean;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapHeaders(rawHeaders: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  const headerMap: Record<string, string> = {
    leaguename: 'leagueName',
    league: 'leagueName',
    teamname: 'teamName',
    team: 'teamName',
    teamnumber: 'teamNumber',
    teamnum: 'teamNumber',
    teamno: 'teamNumber',
    bowlername: 'bowlerName',
    name: 'bowlerName',
    bowler: 'bowlerName',
    email: 'email',
    emailaddress: 'email',
    phone: 'phone',
    phonenumber: 'phone',
    phoneno: 'phone',
  };
  for (let i = 0; i < rawHeaders.length; i++) {
    const normalized = normalizeHeader(rawHeaders[i]);
    const mapped = headerMap[normalized];
    if (mapped && mapping[mapped] === undefined) {
      mapping[mapped] = i;
    }
  }
  return mapping;
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((r) => (r as { text?: string }).text ?? '').join('');
    }
    if (obj.result !== undefined) return cellToString(obj.result);
    if (typeof obj.hyperlink === 'string') return obj.hyperlink;
  }
  return String(value);
}

async function parseFile(buffer: Buffer, filename: string): Promise<{ rows: ParsedRow[]; errors: string[] }> {
  const errors: string[] = [];
  const rows: ParsedRow[] = [];

  try {
    const ext = (filename || '').split('.').pop()?.toLowerCase();
    const workbook = new ExcelJS.Workbook();

    if (ext === 'csv') {
      await withTimeout(workbook.csv.read(Readable.from([buffer])), PARSE_TIMEOUT_MS);
    } else {
      // ExcelJS's `xlsx.load` is typed as `Buffer` (unparameterised), but
      // multer hands us `Buffer<ArrayBufferLike>` from newer @types/node.
      // Copy the bytes into a plain ArrayBuffer view that ExcelJS accepts
      // at runtime to avoid laundering the type via `as unknown as`.
      const bytes = new Uint8Array(buffer.byteLength);
      bytes.set(buffer);
      await withTimeout(workbook.xlsx.load(bytes.buffer), PARSE_TIMEOUT_MS);
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      errors.push('The file contains no sheets');
      return { rows, errors };
    }

    const rawData: string[][] = [];
    // Stop as soon as the row cap is exceeded so we never build an
    // unbounded array, even if the upload survived the size guards.
    // `eachRow` has no break, so throw a sentinel and catch it below.
    let rowLimitExceeded = false;
    try {
      sheet.eachRow({ includeEmpty: false }, (row) => {
        // header (rawData[0]) + MAX_IMPORT_ROWS data rows is allowed;
        // one more non-empty row means the file is over the cap.
        if (rawData.length > MAX_IMPORT_ROWS) {
          rowLimitExceeded = true;
          throw ROW_LIMIT_EXCEEDED;
        }
        const values = row.values as unknown[];
        const rowArr: string[] = [];
        // ExcelJS row.values is 1-indexed; index 0 is undefined.
        for (let i = 1; i < values.length; i++) {
          rowArr.push(cellToString(values[i]));
        }
        rawData.push(rowArr);
      });
    } catch (iterErr) {
      if (iterErr !== ROW_LIMIT_EXCEEDED) throw iterErr;
    }

    if (rowLimitExceeded) {
      errors.push(`File contains more than ${MAX_IMPORT_ROWS} rows. Maximum is 2,000 rows per import.`);
      return { rows, errors };
    }

    if (rawData.length < 2) {
      errors.push('The file must have a header row and at least one data row');
      return { rows, errors };
    }

    const headerRow = rawData[0].map(String);
    const headerMapping = mapHeaders(headerRow);

    const requiredFields = ['leagueName', 'bowlerName', 'teamName', 'teamNumber'];
    const missingFields = requiredFields.filter((f) => headerMapping[f] === undefined);
    if (missingFields.length > 0) {
      errors.push(`Missing required columns: ${missingFields.join(', ')}. Expected columns: League Name, Team Name, Team Number, Bowler Name`);
      return { rows, errors };
    }

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.every((cell) => !cell || String(cell).trim() === '')) continue;

      const leagueName = String(row[headerMapping.leagueName] ?? '').trim();
      const teamName = String(row[headerMapping.teamName] ?? '').trim();
      const teamNumberRaw = row[headerMapping.teamNumber];
      const teamNumber = typeof teamNumberRaw === 'number' ? teamNumberRaw : parseInt(String(teamNumberRaw).trim(), 10);
      const bowlerName = String(row[headerMapping.bowlerName] ?? '').trim();
      const email = headerMapping.email !== undefined ? String(row[headerMapping.email] ?? '').trim() : '';
      const phone = headerMapping.phone !== undefined ? String(row[headerMapping.phone] ?? '').trim() : '';

      rows.push({
        rowNumber: i + 1,
        leagueName,
        teamName,
        teamNumber: isNaN(teamNumber) ? 0 : teamNumber,
        bowlerName,
        email,
        phone,
      });
    }
  } catch (e) {
    errors.push('Failed to parse file: ' + (e instanceof Error ? e.message : String(e)));
  }

  return { rows, errors };
}

router.get('/template', (_req, res) => {
  const csvContent = 'League Name,Team Name,Team Number,Bowler Name,Email,Phone\nMonday Night League,The Strikers,1,John Smith,john@example.com,(555) 123-4567\nMonday Night League,The Strikers,1,Jane Doe,jane@example.com,\nTuesday Mixed,Pin Busters,1,Bob Wilson,,\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="bowler-import-template.csv"');
  res.send(csvContent);
});

router.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const errObj = (err && typeof err === 'object') ? err as { code?: string; message?: string } : {};
      if (errObj.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 'File is too large. Maximum size is 5MB.', 400);
      }
      return sendError(res, 'File upload error: ' + (errObj.message ?? 'unknown'), 400);
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return sendError(res, 'No file uploaded', 400);
    }

    const ext = (req.file.originalname || '').split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx'].includes(ext || '')) {
      return sendError(res, 'Invalid file type. Please upload a CSV or XLSX file.', 400);
    }

    const buffer = req.file.buffer;
    const mimetype = req.file.mimetype;

    // `application/octet-stream` is intentionally on both allow-lists:
    // browsers and OS file pickers (including the Capacitor mobile
    // picker used by the native apps) frequently have no MIME mapping
    // for .xlsx/.csv and upload them as a generic byte stream. We keep
    // accepting it, but ONLY when the actual file bytes (magic-byte
    // sniffing below) confirm a real ZIP/XLSX container or valid CSV
    // text — never on the client-supplied MIME alone.
    if (ext === 'xlsx') {
      const allowedXlsxMimes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/octet-stream',
      ];
      if (!allowedXlsxMimes.includes(mimetype)) {
        return sendError(res, 'Invalid file type. The uploaded file does not appear to be a valid XLSX file.', 400);
      }
      // Content check: a real .xlsx is a ZIP archive (PK\x03\x04).
      if (!hasZipLocalFileHeader(buffer)) {
        return sendError(res, 'Invalid file. The uploaded file is not a valid XLSX workbook.', 400);
      }
      // Zip-bomb guard: reject oversized/high-ratio archives before
      // ExcelJS decompresses the workbook into memory.
      const guard = inspectZipForBomb(buffer, {
        maxTotalUncompressed: MAX_UNCOMPRESSED_BYTES,
        maxRatio: MAX_DECOMPRESSION_RATIO,
      });
      if (!guard.ok) {
        log.warn(`Rejected XLSX bulk import: ${guard.reason} (uncompressed=${guard.totalUncompressed ?? 'n/a'}, compressed=${guard.totalCompressed ?? 'n/a'})`);
        return sendError(res, 'The uploaded file is too large or malformed to process safely.', 400);
      }
    } else {
      const allowedCsvMimes = [
        'text/csv',
        'application/vnd.ms-excel',
        'application/octet-stream',
      ];
      if (!allowedCsvMimes.includes(mimetype)) {
        return sendError(res, 'Invalid file type. The uploaded file does not appear to be a valid CSV file.', 400);
      }
      // Content check: a CSV must be text, not a binary/ZIP container.
      if (!looksLikeText(buffer)) {
        return sendError(res, 'Invalid file. The uploaded CSV does not appear to be a text file.', 400);
      }
    }

    const organizationId: number | null | undefined = req.user?.organizationId;
    if (!organizationId) {
      return sendError(res, 'Organization context required', 403, 'FORBIDDEN');
    }

    const isAdmin = req.user?.role === 'system_admin' || req.user?.role === 'org_admin';
    if (!isAdmin) {
      return sendError(res, 'Only admins can perform bulk imports', 403, 'FORBIDDEN');
    }

    const { rows, errors: parseErrors } = await parseFile(req.file.buffer, req.file.originalname);
    if (parseErrors.length > 0) {
      return sendError(res, parseErrors.join('; '), 400);
    }
    if (rows.length === 0) {
      return sendError(res, 'No data rows found in the file', 400);
    }
    if (rows.length > 2000) {
      return sendError(res, `File contains ${rows.length} rows. Maximum is 2,000 rows per import.`, 400);
    }

    const orgLeagues = await storage.getLeagues(organizationId);
    const leagueMap = new Map(orgLeagues.map((l) => [l.name.toLowerCase().trim(), l]));

    const existingBowlers = await storage.getBowlers({ organizationId });
    const existingEmailSet = new Set(
      existingBowlers
        .filter((b) => b.email)
        .map((b) => b.email!.toLowerCase().trim()),
    );

    const teamCache = new Map<string, { id: number; isNew: boolean }>();

    const validatedRows: ValidatedRow[] = [];
    const emailsInFile = new Map<string, number>();

    for (const row of rows) {
      const vRow: ValidatedRow = { ...row, status: 'valid', errors: [] };

      const bowlerValidation = insertBowlerSchema.safeParse({
        name: row.bowlerName,
        email: row.email || undefined,
        phone: row.phone || undefined,
        active: true,
        order: 0,
      });
      if (!bowlerValidation.success) {
        for (const issue of bowlerValidation.error.issues) {
          vRow.errors.push(`${issue.path.join('.')}: ${issue.message}`);
        }
      }

      if (!row.leagueName) {
        vRow.errors.push('League name is required');
      } else {
        const league = leagueMap.get(row.leagueName.toLowerCase().trim());
        if (!league) {
          vRow.errors.push(`League "${row.leagueName}" not found. Please create it first.`);
        } else {
          vRow.leagueId = league.id;
        }
      }

      if (!row.teamName) {
        vRow.errors.push('Team name is required');
      }

      if (!row.teamNumber || !Number.isInteger(row.teamNumber) || row.teamNumber < 1) {
        vRow.errors.push('Team number must be a positive integer');
      }

      if (row.email) {
        const emailLower = row.email.toLowerCase();
        if (existingEmailSet.has(emailLower)) {
          vRow.status = 'duplicate';
          vRow.errors.push('A bowler with this email already exists');
        } else if (emailsInFile.has(emailLower)) {
          vRow.status = 'duplicate';
          vRow.errors.push(`Duplicate email in file (same as row ${emailsInFile.get(emailLower)})`);
        } else {
          emailsInFile.set(emailLower, row.rowNumber);
        }
      }

      if (vRow.errors.length > 0 && vRow.status === 'valid') {
        vRow.status = 'error';
      }

      validatedRows.push(vRow);
    }

    const previewOnly = req.query.preview === 'true';
    if (previewOnly) {
      for (const vRow of validatedRows) {
        if (vRow.leagueId && vRow.teamNumber > 0 && vRow.status === 'valid') {
          const cacheKey = `${vRow.leagueId}:${vRow.teamNumber}`;
          if (!teamCache.has(cacheKey)) {
            const existing = await storage.getTeamByNumber(vRow.leagueId, vRow.teamNumber);
            teamCache.set(cacheKey, existing ? { id: existing.id, isNew: false } : { id: 0, isNew: true });
          }
          const cached = teamCache.get(cacheKey)!;
          vRow.isNewTeam = cached.isNew;
        }
      }

      const leagueNames = [...new Set(validatedRows.filter((r) => r.leagueId).map((r) => r.leagueName))];
      const newTeamCount = [...teamCache.values()].filter((t) => t.isNew).length;
      return sendSuccess(res, {
        preview: true,
        totalRows: validatedRows.length,
        validRows: validatedRows.filter((r) => r.status === 'valid').length,
        errorRows: validatedRows.filter((r) => r.status === 'error').length,
        duplicateRows: validatedRows.filter((r) => r.status === 'duplicate').length,
        leaguesMatched: leagueNames.length,
        newTeamsToCreate: newTeamCount,
        rows: validatedRows,
      });
    }

    let bowlersCreated = 0;
    let teamsCreated = 0;
    let rowsSkipped = 0;
    const skippedDetails: { rowNumber: number; reason: string }[] = [];
    const createdTeamNames: string[] = [];

    for (const vRow of validatedRows) {
      if (vRow.status !== 'valid') {
        rowsSkipped++;
        skippedDetails.push({
          rowNumber: vRow.rowNumber,
          reason: vRow.errors.join('; '),
        });
        continue;
      }

      try {
        const cacheKey = `${vRow.leagueId}:${vRow.teamNumber}`;
        if (!teamCache.has(cacheKey)) {
          const existing = await storage.getTeamByNumber(vRow.leagueId!, vRow.teamNumber);
          if (existing) {
            if (existing.name.toLowerCase().trim() !== vRow.teamName.toLowerCase().trim()) {
              log.warn(`Row ${vRow.rowNumber}: Team #${vRow.teamNumber} exists as "${existing.name}" but file has "${vRow.teamName}". Using existing team.`);
            }
            teamCache.set(cacheKey, { id: existing.id, isNew: false });
          } else {
            const newTeam = await storage.createTeam({
              name: vRow.teamName,
              number: vRow.teamNumber,
              leagueId: vRow.leagueId!,
              active: true,
            });
            teamCache.set(cacheKey, { id: newTeam.id, isNew: true });
            teamsCreated++;
            createdTeamNames.push(`${vRow.teamName} (#${vRow.teamNumber})`);
          }
        }

        const teamInfo = teamCache.get(cacheKey)!;
        vRow.teamId = teamInfo.id;

        const bowlerData: InsertBowler = {
          name: vRow.bowlerName,
          active: true,
          order: 0,
          email: vRow.email || null,
          phone: vRow.phone || null,
          // Stamp the importing admin's organization on every imported
          // bowler at creation time (task #342, audited in #415). Bulk
          // import is gated on `req.user.organizationId` at the top of
          // this handler (line ~170) which 403s with a clean message
          // before any rows are processed, so `organizationId` is
          // guaranteed to be a valid number here. The DB-level NOT
          // NULL constraint from #407 is the final safety net.
          organizationId,
        };

        const created = await storage.createBowler(bowlerData);

        await storage.createBowlerLeague({
          bowlerId: created.id,
          leagueId: vRow.leagueId!,
          teamId: vRow.teamId,
          active: true,
          order: 0,
        });

        try {
          await runBowlerPostCreateSync(created, organizationId);
        } catch (syncErr) {
          log.error(`Post-create sync error for bowler ${created.id}:`, syncErr);
        }

        bowlersCreated++;
      } catch (err) {
        log.error(`Error importing row ${vRow.rowNumber}:`, err);
        rowsSkipped++;
        skippedDetails.push({
          rowNumber: vRow.rowNumber,
          reason: 'Server error during import: ' + (err instanceof Error ? err.message : String(err)),
        });
      }
    }

    sendSuccess(res, {
      bowlersCreated,
      teamsCreated,
      rowsSkipped,
      totalRows: validatedRows.length,
      createdTeamNames,
      skippedDetails,
    });
  } catch (error) {
    log.error('Bulk import error:', error);
    if (error instanceof z.ZodError) {
      return sendError(res, 'Validation error', 400);
    }
    sendError(res, 'Failed to process bulk import');
  }
});

export default router;
