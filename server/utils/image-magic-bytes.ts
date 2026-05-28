const SIGNATURES: { mime: string; check: (buf: Buffer) => boolean }[] = [
  {
    mime: 'image/png',
    check: (buf) => buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47,
  },
  {
    mime: 'image/jpeg',
    check: (buf) => buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF,
  },
  {
    mime: 'image/gif',
    check: (buf) =>
      buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38,
  },
  {
    mime: 'image/webp',
    check: (buf) =>
      buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50,
  },
];

function detectImageMime(buf: Buffer): string | null {
  for (const sig of SIGNATURES) {
    if (sig.check(buf)) return sig.mime;
  }
  return null;
}

export function validateDataUri(dataUri: string): { valid: true; mimeType: string; buffer: Buffer } | { valid: false; error: string } {
  const matches = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    return { valid: false, error: 'Invalid data URI format' };
  }

  const declaredMime = matches[1];
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedMimeTypes.includes(declaredMime)) {
    return { valid: false, error: `Unsupported MIME type: ${declaredMime}` };
  }

  const MAX_BASE64_LENGTH = Math.ceil((2 * 1024 * 1024) / 3) * 4;
  if (matches[2].length > MAX_BASE64_LENGTH) {
    return { valid: false, error: 'Image data exceeds maximum allowed size' };
  }

  const buffer = Buffer.from(matches[2], 'base64');
  const detectedMime = detectImageMime(buffer);

  if (!detectedMime) {
    return { valid: false, error: 'File content does not match any supported image format' };
  }

  if (detectedMime !== declaredMime) {
    return { valid: false, error: `Declared MIME type ${declaredMime} does not match actual content (${detectedMime})` };
  }

  return { valid: true, mimeType: declaredMime, buffer };
}
