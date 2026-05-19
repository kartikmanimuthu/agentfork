import { describe, it, expect, vi, beforeEach } from 'vitest';
import type PgBoss from 'pg-boss';
import { handleWebCrawl } from './handler';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDsRepo = {
  findById: vi.fn(),
  update: vi.fn(),
};

const mockDocRepo = {
  create: vi.fn(),
};

const mockKbRepo = {
  findById: vi.fn(),
};

const mockGetUploadUrl = vi.fn();
const mockUploadBuffer = vi.fn().mockResolvedValue(undefined);
const mockEnqueueIngestion = vi.fn();

const mockCrawler = {
  crawl: vi.fn(),
};

vi.mock('@chatbot/shared/workers', () => ({
  getPrismaClient: vi.fn(() => ({})),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('@chatbot/shared', () => ({
  S3Service: vi.fn().mockImplementation(() => ({
    uploadBuffer: mockUploadBuffer,
  })),
}));

vi.mock('@chatbot/knowledge-base', () => ({
  createDataSourceRepository: vi.fn(() => mockDsRepo),
  createDocumentRepository: vi.fn(() => mockDocRepo),
  createKnowledgeBaseRepository: vi.fn(() => mockKbRepo),
  createWebCrawler: vi.fn(() => mockCrawler),
  DataSourceService: vi.fn().mockImplementation(() => ({
    getUploadUrl: mockGetUploadUrl,
  })),
  DocumentService: vi.fn().mockImplementation(() => ({
    getUploadUrl: mockGetUploadUrl,
  })),
  IngestionService: vi.fn().mockImplementation(() => ({
    enqueueIngestion: mockEnqueueIngestion,
  })),
}));

describe('handleWebCrawl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDsRepo.findById.mockReset();
    mockDsRepo.update.mockReset();
    mockDocRepo.create.mockReset();
    mockGetUploadUrl.mockReset();
    mockUploadBuffer.mockReset();
    mockEnqueueIngestion.mockReset();
    mockCrawler.crawl.mockReset();
  });

  const validPayload = {
    dataSourceId: 'clq1234567890abcdefgh1234',
    tenantId: 'clq1234567890abcdefgh1235',
    knowledgeBaseId: 'clq1234567890abcdefgh1236',
  };

  const mockBoss = {
    send: vi.fn().mockResolvedValue('job-id'),
  } as unknown as PgBoss;

  it('validates payload with Zod schema', async () => {
    await expect(handleWebCrawl({ dataSourceId: 'not-a-cuid' }, mockBoss)).rejects.toThrow();
  });

  it('updates data source status to syncing', async () => {
    mockDsRepo.findById.mockResolvedValue({
      id: validPayload.dataSourceId,
      type: 'URL',
      config: { urls: ['https://example.com'], crawlDepth: 0 },
    });
    mockCrawler.crawl.mockResolvedValue([]);

    await handleWebCrawl(validPayload, mockBoss);

    expect(mockDsRepo.update).toHaveBeenCalledWith(validPayload.dataSourceId, {
      status: 'syncing',
      errorMessage: null,
    });
  });

  it('throws if data source is not found', async () => {
    mockDsRepo.findById.mockResolvedValue(null);

    await expect(handleWebCrawl(validPayload, mockBoss)).rejects.toThrow(
      'DataSource ' + validPayload.dataSourceId + ' not found'
    );
  });

  it('throws if data source is not a URL source', async () => {
    mockDsRepo.findById.mockResolvedValue({
      id: validPayload.dataSourceId,
      type: 'FILE',
      config: {},
    });

    await expect(handleWebCrawl(validPayload, mockBoss)).rejects.toThrow(
      'DataSource ' + validPayload.dataSourceId + ' is not a URL source'
    );
  });

  it('creates documents for each crawled page', async () => {
    mockDsRepo.findById.mockResolvedValue({
      id: validPayload.dataSourceId,
      type: 'URL',
      config: { urls: ['https://example.com'], crawlDepth: 0 },
    });

    mockCrawler.crawl.mockResolvedValue([
      { url: 'https://example.com', title: 'Example', text: 'Hello world', links: [], fetchedAt: new Date() },
    ]);

    mockGetUploadUrl.mockResolvedValue({ uploadUrl: 'https://s3.example.com/upload', s3Key: 'tenant/ds/1-file.txt' });

    mockDocRepo.create.mockResolvedValue({ id: 'doc-1' });

    await handleWebCrawl(validPayload, mockBoss);

    expect(mockGetUploadUrl).toHaveBeenCalledWith(validPayload.dataSourceId, 'https___example_com.txt', 'text/plain');
    expect(mockUploadBuffer).toHaveBeenCalledWith('tenant/ds/1-file.txt', Buffer.from('Hello world', 'utf-8'), 'text/plain');
    expect(mockDocRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSourceId: validPayload.dataSourceId,
        sourceKey: 'tenant/ds/1-file.txt',
        fileName: 'https___example_com.txt',
        mimeType: 'text/plain',
        sizeBytes: 11,
        metadata: expect.objectContaining({ url: 'https://example.com', title: 'Example' }),
      })
    );
  });

  it('enqueues ingestion jobs via boss.send when boss is provided', async () => {
    mockDsRepo.findById.mockResolvedValue({
      id: validPayload.dataSourceId,
      type: 'URL',
      config: { urls: ['https://example.com'], crawlDepth: 0 },
    });

    const fetchedAt = new Date();
    mockCrawler.crawl.mockResolvedValue([
      { url: 'https://example.com', title: 'Example', text: 'Hello', links: [], fetchedAt },
    ]);

    mockGetUploadUrl.mockResolvedValue({ uploadUrl: 'https://s3.example.com/upload', s3Key: 'key-1' });

    mockDocRepo.create.mockResolvedValue({ id: 'doc-1' });

    await handleWebCrawl(validPayload, mockBoss);

    expect(mockEnqueueIngestion).toHaveBeenCalledWith(mockBoss, {
      documentId: 'doc-1',
      tenantId: validPayload.tenantId,
      s3Key: 'key-1',
      mimeType: 'text/plain',
      knowledgeBaseId: validPayload.knowledgeBaseId,
    });
  });

  it('does not enqueue ingestion when boss is not provided', async () => {
    mockDsRepo.findById.mockResolvedValue({
      id: validPayload.dataSourceId,
      type: 'URL',
      config: { urls: ['https://example.com'], crawlDepth: 0 },
    });

    const fetchedAt = new Date();
    mockCrawler.crawl.mockResolvedValue([
      { url: 'https://example.com', title: 'Example', text: 'Hello', links: [], fetchedAt },
    ]);

    mockGetUploadUrl.mockResolvedValue({ uploadUrl: 'https://s3.example.com/upload', s3Key: 'key-1' });

    mockDocRepo.create.mockResolvedValue({ id: 'doc-1' });

    await handleWebCrawl(validPayload);

    expect(mockEnqueueIngestion).not.toHaveBeenCalled();
  });

  it('updates data source status to active on success', async () => {
    mockDsRepo.findById.mockResolvedValue({
      id: validPayload.dataSourceId,
      type: 'URL',
      config: { urls: ['https://example.com'], crawlDepth: 0 },
    });
    mockCrawler.crawl.mockResolvedValue([]);

    await handleWebCrawl(validPayload, mockBoss);

    expect(mockDsRepo.update).toHaveBeenLastCalledWith(
      validPayload.dataSourceId,
      expect.objectContaining({ status: 'active', lastSyncAt: expect.any(Date) })
    );
  });

  it('updates data source status to error on failure and re-throws', async () => {
    mockDsRepo.findById.mockResolvedValue({
      id: validPayload.dataSourceId,
      type: 'URL',
      config: { urls: ['https://example.com'], crawlDepth: 0 },
    });
    mockCrawler.crawl.mockRejectedValue(new Error('Crawl failed'));

    await expect(handleWebCrawl(validPayload, mockBoss)).rejects.toThrow('Crawl failed');

    expect(mockDsRepo.update).toHaveBeenLastCalledWith(
      validPayload.dataSourceId,
      expect.objectContaining({ status: 'error', errorMessage: 'Crawl failed' })
    );
  });

  it('throws when S3 upload fails', async () => {
    mockDsRepo.findById.mockResolvedValue({
      id: validPayload.dataSourceId,
      type: 'URL',
      config: { urls: ['https://example.com'], crawlDepth: 0 },
    });

    mockCrawler.crawl.mockResolvedValue([
      { url: 'https://example.com', title: 'Example', text: 'Hello', links: [], fetchedAt: new Date() },
    ]);

    mockGetUploadUrl.mockResolvedValue({ uploadUrl: 'https://s3.example.com/upload', s3Key: 'key-1' });
    mockUploadBuffer.mockRejectedValue(new Error('S3 upload failed'));

    await expect(handleWebCrawl(validPayload, mockBoss)).rejects.toThrow('S3 upload failed');
  });

  it('passes crawl options to the crawler', async () => {
    mockDsRepo.findById.mockResolvedValue({
      id: validPayload.dataSourceId,
      type: 'URL',
      config: {
        urls: ['https://example.com'],
        crawlDepth: 2,
        includePatterns: ['/docs/*'],
        excludePatterns: ['/blog/*'],
      },
    });
    mockCrawler.crawl.mockResolvedValue([]);

    await handleWebCrawl(validPayload, mockBoss);

    expect(mockCrawler.crawl).toHaveBeenCalledWith({
      seedUrls: ['https://example.com'],
      crawlDepth: 2,
      includePatterns: ['/docs/*'],
      excludePatterns: ['/blog/*'],
      maxPages: 50,
    });
  });
});
