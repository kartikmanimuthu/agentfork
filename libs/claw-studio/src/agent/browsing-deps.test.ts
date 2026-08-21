import { describe, it, expect, vi } from 'vitest';
import { createScreenshotUploader, screenshotKey } from './browsing-deps';

describe('screenshotKey', () => {
  it('namespaces by tenant, claw and run so one run cannot read another run objects', () => {
    expect(screenshotKey({ tenantId: 't1', clawId: 'c1', runId: 'r1', seq: 3 })).toBe(
      'claw/screenshots/t1/c1/r1/3.jpg',
    );
  });

  it('falls back to an adhoc run segment when there is no run id', () => {
    expect(screenshotKey({ tenantId: 't1', clawId: 'c1', seq: 1 })).toBe('claw/screenshots/t1/c1/adhoc/1.jpg');
  });
});

describe('createScreenshotUploader', () => {
  function fakeS3() {
    return {
      uploadBuffer: vi.fn(async () => undefined),
      getDownloadUrl: vi.fn(async () => 'https://s3.example/signed'),
    };
  }

  it('uploads the jpeg and returns its key and a signed url', async () => {
    const s3 = fakeS3();
    const upload = createScreenshotUploader({ tenantId: 't1', clawId: 'c1', runId: 'r1', s3 });

    const first = await upload(Buffer.from('bytes'));

    expect(s3.uploadBuffer).toHaveBeenCalledWith('claw/screenshots/t1/c1/r1/1.jpg', expect.any(Buffer), 'image/jpeg');
    expect(first).toEqual({ key: 'claw/screenshots/t1/c1/r1/1.jpg', url: 'https://s3.example/signed' });
  });

  it('increments the sequence so a second screenshot does not overwrite the first', async () => {
    const s3 = fakeS3();
    const upload = createScreenshotUploader({ tenantId: 't1', clawId: 'c1', runId: 'r1', s3 });

    await upload(Buffer.from('a'));
    const second = await upload(Buffer.from('b'));

    expect(second.key).toBe('claw/screenshots/t1/c1/r1/2.jpg');
  });

  it('propagates an upload failure so the tool layer can report it', async () => {
    const s3 = fakeS3();
    s3.uploadBuffer.mockRejectedValue(new Error('S3 unreachable'));
    const upload = createScreenshotUploader({ tenantId: 't1', clawId: 'c1', s3 });

    await expect(upload(Buffer.from('a'))).rejects.toThrow('S3 unreachable');
  });
});
