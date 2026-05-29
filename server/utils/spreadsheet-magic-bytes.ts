// Content-based file-type validation for the bulk-import upload path.
//
// XLSX is a ZIP container, so a small compressed upload can decompress
// to a far larger in-memory workbook (a "zip bomb"). These helpers let
// the bulk-import route validate an upload cheaply — by its actual
// bytes rather than its filename/extension or the client-supplied MIME
// — and reject a hostile or malformed file *before* ExcelJS
// materialises the whole workbook.
//
// Modelled after `server/utils/image-magic-bytes.ts`.

// ZIP "local file header" signature: PK\x03\x04. Every real .xlsx
// (an OOXML ZIP archive) begins with this.
export function hasZipLocalFileHeader(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 && // 'P'
    buf[1] === 0x4b && // 'K'
    buf[2] === 0x03 &&
    buf[3] === 0x04
  );
}

// Cheap heuristic that an upload is a text file (CSV) rather than a
// binary container. We reject NUL bytes and disallowed control
// characters in a sampled prefix; high bytes (>=0x80) are allowed so
// UTF-8 / Latin-1 CSVs pass. A leading ZIP signature is rejected so a
// disguised .xlsx cannot sneak through the CSV path.
export function looksLikeText(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  if (hasZipLocalFileHeader(buf)) return false;

  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];
    if (byte === 0) return false; // NUL → binary
    // Allow tab (0x09), LF (0x0a), CR (0x0d). Reject other C0 control
    // bytes (< 0x20) which do not appear in legitimate CSV text.
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      return false;
    }
  }
  return true;
}

export interface ZipBombGuardOptions {
  // Hard cap on the summed declared uncompressed size of all entries.
  maxTotalUncompressed: number;
  // Hard cap on the overall decompression ratio (uncompressed/compressed).
  maxRatio: number;
}

export interface ZipBombGuardResult {
  ok: boolean;
  reason?: string;
  totalUncompressed?: number;
  totalCompressed?: number;
}

const EOCD_SIGNATURE = 0x06054b50; // PK\x05\x06 (End Of Central Directory)
const CDFH_SIGNATURE = 0x02014b50; // PK\x01\x02 (Central Directory File Header)
const ZIP64_SIZE_SENTINEL = 0xffffffff;

// Inspect a ZIP container's central directory and reject files whose
// *declared* total uncompressed size or expansion ratio exceeds a sane
// cap — without decompressing anything. This reads the central
// directory the same way an archiver does: locate the End Of Central
// Directory record, then walk each Central Directory File Header and
// sum the declared compressed/uncompressed sizes.
export function inspectZipForBomb(
  buf: Buffer,
  opts: ZipBombGuardOptions,
): ZipBombGuardResult {
  // Locate the EOCD record by scanning backwards. It is 22 bytes plus
  // a trailing comment of up to 65535 bytes.
  const minEocd = 22;
  if (buf.length < minEocd) {
    return { ok: false, reason: 'File is too small to be a valid workbook' };
  }
  const maxBack = Math.min(buf.length - minEocd, 0xffff + minEocd);
  let eocdOffset = -1;
  for (let i = buf.length - minEocd; i >= buf.length - minEocd - maxBack && i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    return { ok: false, reason: 'Not a valid ZIP/XLSX archive (no end-of-central-directory record)' };
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (cdOffset >= buf.length) {
    return { ok: false, reason: 'Malformed ZIP central directory offset' };
  }

  let totalUncompressed = 0;
  let totalCompressed = 0;
  let offset = cdOffset;

  for (let entry = 0; entry < totalEntries; entry++) {
    if (offset + 46 > buf.length) {
      return { ok: false, reason: 'Truncated ZIP central directory' };
    }
    if (buf.readUInt32LE(offset) !== CDFH_SIGNATURE) {
      return { ok: false, reason: 'Malformed ZIP central directory entry' };
    }

    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);

    // ZIP64 stores real sizes in an extra field when the 32-bit field
    // is saturated. We do not parse ZIP64; a legitimate sub-5MB import
    // never needs it, so treat the sentinel as a hostile/oversized
    // archive and reject.
    if (uncompressedSize === ZIP64_SIZE_SENTINEL || compressedSize === ZIP64_SIZE_SENTINEL) {
      return {
        ok: false,
        reason: 'ZIP64 archive is not supported for import',
        totalUncompressed,
        totalCompressed,
      };
    }

    totalUncompressed += uncompressedSize;
    totalCompressed += compressedSize;

    if (totalUncompressed > opts.maxTotalUncompressed) {
      return {
        ok: false,
        reason: 'Uncompressed workbook size exceeds the safe limit',
        totalUncompressed,
        totalCompressed,
      };
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }

  if (totalCompressed > 0 && totalUncompressed / totalCompressed > opts.maxRatio) {
    return {
      ok: false,
      reason: 'Workbook decompression ratio exceeds the safe limit',
      totalUncompressed,
      totalCompressed,
    };
  }

  return { ok: true, totalUncompressed, totalCompressed };
}
