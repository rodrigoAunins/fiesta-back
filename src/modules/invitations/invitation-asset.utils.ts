export type InvitationAssetKind = 'image' | 'gif' | 'audio';

export type DetectedInvitationAsset = {
  kind: InvitationAssetKind;
  mimeType: string;
  extension: string;
};

function startsWith(buffer: Buffer, signature: number[]): boolean {
  return signature.every((value, index) => buffer[index] === value);
}

export function detectInvitationAsset(buffer: Buffer): DetectedInvitationAsset | null {
  if (!buffer?.length) return null;

  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', mimeType: 'image/png', extension: 'png' };
  }

  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { kind: 'image', mimeType: 'image/jpeg', extension: 'jpg' };
  }

  const header = buffer.subarray(0, 12).toString('ascii');
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return { kind: 'gif', mimeType: 'image/gif', extension: 'gif' };
  }

  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return { kind: 'image', mimeType: 'image/webp', extension: 'webp' };
  }

  const hasId3Header = header.startsWith('ID3');
  const hasMpegFrame = buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
  if (hasId3Header || hasMpegFrame) {
    return { kind: 'audio', mimeType: 'audio/mpeg', extension: 'mp3' };
  }

  return null;
}

export type ByteRange = { start: number; end: number };

export function parseByteRange(value: string | undefined, size: number): ByteRange | null {
  if (!value || !Number.isInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match) return null;

  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return null;

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    return null;
  }

  return { start, end: Math.min(requestedEnd, size - 1) };
}
