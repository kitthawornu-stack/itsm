/**
 * OpenSearch client แบบบางที่สุด — ใช้ fetch ของ Node 22 ไม่พึ่ง SDK
 *
 * เหตุผล: เราใช้ API แค่ 6 ตัว (create index, bulk, search, delete, refresh, analyze)
 * SDK ของ OpenSearch ลาก dependency มาเยอะและมีปัญหา type ที่ต้องตามแก้บ่อย
 * ถ้าวันหนึ่งต้องใช้ฟีเจอร์ลึกกว่านี้ ค่อยเปลี่ยน — จุดสัมผัสอยู่ในไฟล์เดียว
 */

const BASE = process.env['OPENSEARCH_URL'] ?? 'http://localhost:4200';

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

  /**
   * จำนวนเอกสารในดัชนี — `null` เมื่อถามไม่ได้
   *
   * **ไม่โยนเมื่อถามไม่ได้** เพราะผู้เรียกคือตัวตรวจสุขภาพ · ตัวตรวจที่ล้ม
   * เพราะสิ่งที่มันกำลังตรวจพัง ไม่ได้บอกอะไรใครเลย มันแค่หายไปเงียบ ๆ
   */
  async countDocs(index: string): Promise<number | null> {
    try {
      const res = await fetch(`${BASE}/${index}/_count`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { count?: number };
      return typeof body.count === 'number' ? body.count : null;
    } catch {
      return null;
    }
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

  /**
   * ค้นหา — คืน **ยอดรวมจริง** มาด้วย ไม่ใช่แค่หน้าที่ขอ
   *
   * `hits.total.value` ของ OpenSearch หยุดนับที่ 10,000 โดยปริยาย
   * (`track_total_hits` เป็น false) ซึ่งแปลว่ายอดที่ได้จะเป็น "อย่างน้อย 10,000"
   * ไม่ใช่ยอดจริง · หน้าจอที่บอกว่า "พบ 10,000 รายการ" ทั้งที่มี 24,000
   * คือตัวเลขที่อ่านเหมือนข้อเท็จจริงแต่ผิด จึงบังคับ `track_total_hits: true`
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T คือชนิดของ _source ที่ผู้เรียกกำหนด
  async search<T = unknown>(
    index: string,
    query: Record<string, unknown>,
    size = 20,
    from = 0,
  ): Promise<{ total: number; hits: Array<{ id: string; score: number; source: T }> }> {
    const res = await request<{
      hits: {
        total: { value: number };
        hits: Array<{ _id: string; _score: number; _source: T }>;
      };
    }>('POST', `/${index}/_search?size=${size}&from=${from}`, {
      ...query,
      track_total_hits: true,
    });
    return {
      total: res.hits.total.value,
      hits: res.hits.hits.map((h) => ({ id: h._id, score: h._score, source: h._source })),
    };
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
