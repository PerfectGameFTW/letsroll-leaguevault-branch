/**
 * Task #745 — Harden bulk-import XLSX against zip bombs.
 *
 * POST /api/bowlers/bulk-import accepts a 5 MB CSV/XLSX upload and
 * parses it through ExcelJS. Because XLSX is a ZIP container, a small
 * compressed upload can decompress to a far larger in-memory workbook
 * (a "zip bomb"). These tests pin the defense-in-depth added in #745:
 *
 *   - content-based file-type validation (magic bytes), not just the
 *     extension + client-supplied MIME,
 *   - a zip-bomb guard that reads the ZIP central directory and rejects
 *     oversized / high-ratio archives *before* ExcelJS decompresses,
 *   - `application/octet-stream` accepted only when the bytes confirm a
 *     real XLSX or valid CSV,
 *
 * while confirming the happy path (a normal CSV / XLSX preview) is
 * unchanged. All happy-path requests use `?preview=true` so no rows are
 * written and no DB cleanup is required.
 */
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { BASE_URL, TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD, login, type AuthSession } from '../helpers';

const IMPORT_PATH = '/api/bowlers/bulk-import';

interface UploadResult {
  status: number;
  data: { success: boolean; data?: unknown; error?: { message?: string; code?: string } };
}

async function uploadFile(
  session: AuthSession,
  opts: { buffer: Buffer; filename: string; contentType: string; query?: string },
): Promise<UploadResult> {
  const form = new FormData();
  const blob = new Blob([opts.buffer], { type: opts.contentType });
  form.append('file', blob, opts.filename);

  const res = await fetch(`${BASE_URL}${IMPORT_PATH}${opts.query ?? ''}`, {
    method: 'POST',
    headers: {
      Cookie: session.cookies,
      'x-csrf-token': session.csrfToken,
      'x-test-rate-limit-bypass': '1',
    },
    body: form,
  });
  const data = (await res.json()) as UploadResult['data'];
  return { status: res.status, data };
}

const HEADER_ROW = 'League Name,Team Name,Team Number,Bowler Name,Email,Phone';

function validCsvBuffer(): Buffer {
  return Buffer.from(
    `${HEADER_ROW}\nMonday Night League,The Strikers,1,John Smith,john-745@example.com,(555) 123-4567\n`,
    'utf-8',
  );
}

async function validXlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.addRow(['League Name', 'Team Name', 'Team Number', 'Bowler Name', 'Email', 'Phone']);
  sheet.addRow(['Monday Night League', 'The Strikers', 1, 'Jane Doe', 'jane-745@example.com', '']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Craft a minimal but structurally-valid ZIP that starts with the
 * local-file-header signature (so the magic-byte check passes) and
 * whose central directory *declares* a huge uncompressed size while
 * carrying only a single byte of data — the shape of a zip bomb.
 */
function zipBombBuffer(declaredUncompressed: number): Buffer {
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const fileData = Buffer.from([0x20]); // 1 byte, "stored"

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); // stored
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(0, 14); // crc
  local.writeUInt32LE(fileData.length, 18); // compressed size
  local.writeUInt32LE(declaredUncompressed, 22); // uncompressed size
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  const localPart = Buffer.concat([local, name, fileData]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10); // stored
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(0, 16); // crc
  central.writeUInt32LE(fileData.length, 20); // compressed size
  central.writeUInt32LE(declaredUncompressed, 24); // uncompressed size
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30); // extra len
  central.writeUInt16LE(0, 32); // comment len
  central.writeUInt16LE(0, 34); // disk start
  central.writeUInt16LE(0, 36); // internal attrs
  central.writeUInt32LE(0, 38); // external attrs
  central.writeUInt32LE(0, 42); // local header offset
  const centralPart = Buffer.concat([central, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8); // entries this disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(centralPart.length, 12); // central dir size
  eocd.writeUInt32LE(localPart.length, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([localPart, centralPart, eocd]);
}

describe('POST /api/bowlers/bulk-import — hardening (task #745)', () => {
  describe('rejections', () => {
    it('rejects a zip-bomb XLSX (huge declared uncompressed size) before parsing', async () => {
      const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
      const { status, data } = await uploadFile(session, {
        buffer: zipBombBuffer(200 * 1024 * 1024), // 200 MB declared, 1 byte real
        filename: 'bomb.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        query: '?preview=true',
      });

      expect(status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error?.message).toMatch(/too large or malformed/i);
    });

    it('rejects a file with forged magic bytes (declared XLSX MIME but not a ZIP)', async () => {
      const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
      const { status, data } = await uploadFile(session, {
        buffer: Buffer.from('this is not really a spreadsheet', 'utf-8'),
        filename: 'forged.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        query: '?preview=true',
      });

      expect(status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error?.message).toMatch(/not a valid xlsx workbook/i);
    });

    it('rejects an application/octet-stream upload that is not actually an XLSX', async () => {
      const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
      const { status, data } = await uploadFile(session, {
        buffer: Buffer.from('League Name,Team Name\nfoo,bar', 'utf-8'),
        filename: 'disguised.xlsx',
        contentType: 'application/octet-stream',
        query: '?preview=true',
      });

      expect(status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error?.message).toMatch(/not a valid xlsx workbook/i);
    });

    it('rejects a .csv whose bytes are actually a binary/ZIP container', async () => {
      const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
      const { status, data } = await uploadFile(session, {
        buffer: zipBombBuffer(1024),
        filename: 'sneaky.csv',
        contentType: 'text/csv',
        query: '?preview=true',
      });

      expect(status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error?.message).toMatch(/does not appear to be a text file/i);
    });
  });

  describe('happy path (unchanged)', () => {
    it('previews a normal CSV upload', async () => {
      const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
      const { status, data } = await uploadFile(session, {
        buffer: validCsvBuffer(),
        filename: 'bowlers.csv',
        contentType: 'text/csv',
        query: '?preview=true',
      });

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      const payload = data.data as { preview: boolean; totalRows: number };
      expect(payload.preview).toBe(true);
      expect(payload.totalRows).toBe(1);
    });

    it('previews a normal CSV uploaded as application/octet-stream', async () => {
      const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
      const { status, data } = await uploadFile(session, {
        buffer: validCsvBuffer(),
        filename: 'bowlers.csv',
        contentType: 'application/octet-stream',
        query: '?preview=true',
      });

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect((data.data as { preview: boolean }).preview).toBe(true);
    });

    it('previews a normal XLSX upload', async () => {
      const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
      const { status, data } = await uploadFile(session, {
        buffer: await validXlsxBuffer(),
        filename: 'bowlers.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        query: '?preview=true',
      });

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      const payload = data.data as { preview: boolean; totalRows: number };
      expect(payload.preview).toBe(true);
      expect(payload.totalRows).toBe(1);
    });

    it('previews a normal XLSX uploaded as application/octet-stream', async () => {
      const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
      const { status, data } = await uploadFile(session, {
        buffer: await validXlsxBuffer(),
        filename: 'bowlers.xlsx',
        contentType: 'application/octet-stream',
        query: '?preview=true',
      });

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect((data.data as { preview: boolean }).preview).toBe(true);
    });
  });
});
