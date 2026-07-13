import { detectInvitationAsset, parseByteRange } from './invitation-asset.utils';

describe('invitation asset utilities', () => {
  it('detects supported image, gif and audio signatures', () => {
    expect(detectInvitationAsset(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mimeType).toBe('image/png');
    expect(detectInvitationAsset(Buffer.from('GIF89a', 'ascii'))?.kind).toBe('gif');
    expect(detectInvitationAsset(Buffer.from('ID3sample', 'ascii'))?.kind).toBe('audio');
    expect(detectInvitationAsset(Buffer.from('not-media', 'ascii'))).toBeNull();
  });

  it('parses regular, open and suffix byte ranges', () => {
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=100-110', 100)).toBeNull();
  });
});
