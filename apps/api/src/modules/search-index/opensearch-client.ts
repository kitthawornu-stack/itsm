/**
 * OpenSearch client แบบบางที่สุด — ใช้ fetch ของ Node 22 ไม่พึ่ง SDK
 *
 * เหตุผล: เราใช้ API แค่ 6 ตัว (create index, bulk, search, delete, refresh, analyze)
 * SDK ของ OpenSearch ลาก dependency มาเยอะและมีปัญหา type ที่ต้องตามแก้บ่อย
 * ถ้าวันหนึ่งต้องใช้ฟีเจอร์ลึกกว่านี้ ค่อยเปลี่ยน — จุดสัมผัสอยู่ในไฟล์เดียว
 */

const BASE = process.env['OPENSEARCH_URL'] ?? 'http://localhost:9200';

export class OpenSearchError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(`OpenSearch ${path} ตอบกลับ ${status}: ${JSON.stringify(body).slice(0, 400)}`);
    this.name = 'OpenSearchError';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  contentType = 'application/json',
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': `${contentType}; charset=utf-8` },
    body:
      body === undefined
        ? undefined
        : typeof body === 'string'
          ? body
          : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await res.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!res.ok) throw new OpenSearchError(res.status, path, parsed);
  return parsed as T;
}

export const openSearch = {
  async indexExists(index: string): Promise<boolean> {
    const res = await fetch(`${BASE}/${index}`, { method: 'HEAD' });
    return res.ok;
  },

  async createIndex(index: string, settings: unknown): Promise<void> {
    await request('PUT', `/${index}`, settings);
  },

  async deleteIndex(index: string): Promise<void> {
    const res = await fetch(`${BASE}/${index}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      throw new OpenSearchError(res.status, `/${index}`, await res.text());
    }
  },

  /**
   * bulk index — NDJSON ต้องลงท้ายด้วยขึ้นบรรทัดใหม่ ไม่งั้น OpenSearch ปฏิเสธทั้ง batch
   * เป็นความผิดพลาดที่ error message ไม่ได้บอกตรง ๆ
   */
  async bulkIndex(index: string, docs: Array<{ id: string; doc: unknown }>): Promise<void> {
    if (docs.length === 0) return;
    const lines: string[] = [];
    for (const { id, doc } of docs) {
      lines.push(JSON.stringify({ index: { _index: index, _id: id } }));
      lines.push(JSON.stringify(doc));
    }
    const ndjson = lines.join('\n') + '\n';
    const result = await request<{ errors: boolean; items?: unknown[] }>(
      'POST',
      '/_bulk',
      ndjson,
      'application/x-ndjson',
    );
    if (result.errors) {
      const firstError = (result.items ?? []).find(
        (i) => (i as { index?: { error?: unknown } }).index?.error !== undefined,
      );
      throw new OpenSearchError(200, '/_bulk', firstError ?? result);
    }
  },

  /** บังคับให้เอกสารที่เพิ่ง index ค้นหาเจอทันที — ใช้ในเทสต์เท่านั้น ไม่ใช้ใน production */
  async refresh(index: string): Promise<void> {
    await request('POST', `/${index}/_refresh`);
  },

  async search<T = unknown>(
    index: string,
    query: Record<string, unknown>,
    size = 20,
  ): Promise<Array<{ id: string; score: number; source: T }>> {
    const res = await request<{
      hits: { hits: Array<{ _id: string; _score: number; _source: T }> };
    }>('POST', `/${index}/_search?size=${size}`, query);
    return res.hits.hits.map((h) => ({ id: h._id, score: h._score, source: h._source }));
  },

  /** ตรวจว่า analyzer ตัดคำอย่างไร — ใช้ในเทสต์และตอน debug คำค้นที่หาไม่เจอ */
  async analyze(index: string, analyzer: string, text: string): Promise<string[]> {
    const res = await request<{ tokens: Array<{ token: string }> }>(
      'POST',
      `/${index}/_analyze`,
      { analyzer, text },
    );
    return res.tokens.map((t) => t.token);
  },
};
