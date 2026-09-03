/**
 * HQL — ภาษาคิวรีของ Helix · เอนจินตัวที่สี่
 *
 * `status = Open AND priority IN (P1, P2) ORDER BY updated DESC`
 *
 * เป็นฟังก์ชันบริสุทธิ์ทั้งไฟล์ — ไม่แตะฐานข้อมูล ไม่อ่านนาฬิกา ไม่มี I/O
 * ผู้เรียกส่ง `CompileScope` เข้ามาแล้วรับ DSL กลับไปยิงเอง
 *
 * **สองข้อที่พลาดแล้วเสียหายที่สุด และทั้งคู่ล้มเหลวแบบเงียบ:**
 *
 *   1. ขอบเขต tenant และโปรเจกต์ **ประกอบจาก scope เท่านั้น** ไม่เคยมาจากสิ่งที่
 *      ผู้ใช้พิมพ์ · อยู่ใน `filter` แยกจาก `must` ของผู้ใช้ ทั้งเพราะ ADR-005
 *      (filter context ไม่คิดคะแนนและถูกแคช) และเพราะการอ่านคิวรีที่ได้ต้อง
 *      แยกออกทันทีว่าอันไหนระบบบังคับ อันไหนผู้ใช้พิมพ์
 *
 *   2. ฟิลด์ที่ไม่รู้จัก **ถูกปฏิเสธ ไม่ใช่ข้าม** · คิวรีที่สะกดผิดแล้วคืนผลลัพธ์
 *      เหมือนไม่มีเงื่อนไขนั้น คือคำตอบที่ผิดโดยที่ผู้ใช้มั่นใจว่าถูก
 */

// ============================================================
// Errors
// ============================================================

export class HqlSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(`${message} (ตำแหน่ง ${String(position)})`);
    this.name = 'HqlSyntaxError';
  }
}

export class HqlFieldError extends Error {
  constructor(readonly field: string) {
    super(
      `ไม่รู้จักฟิลด์ "${field}" — ตรวจตัวสะกดอีกครั้ง ` +
        `(ฟิลด์ที่ใช้ได้: ${[...Object.keys(FIELDS)].join(', ')})`,
    );
    this.name = 'HqlFieldError';
  }
}

export class HqlValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HqlValueError';
  }
}

// ============================================================
// ฟิลด์ที่อนุญาต
// ============================================================

/**
 * รายการฟิลด์ที่คิวรีได้ — **allow-list ไม่ใช่ deny-list**
 *
 * ปล่อยให้พิมพ์ชื่อฟิลด์อะไรก็ได้ แปลว่าคนที่รู้ชื่อคอลัมน์ภายในจะกรองด้วย
 * ฟิลด์ที่ไม่ควรถูกกรอง และรู้ได้ว่ามีข้อมูลอะไรอยู่จากจำนวนผลลัพธ์
 *
 * `text` = ค้นด้วยการวิเคราะห์คำ (ใช้ `~` ได้ ใช้ `=` ไม่ได้)
 * `keyword` = ตรงทั้งค่า (ใช้ `=` `!=` `IN` ได้ ใช้ `~` ไม่ได้)
 */
interface FieldSpec {
  /** ชื่อฟิลด์จริงในดัชนี — ต่างจากชื่อที่ผู้ใช้พิมพ์ได้ */
  target: string;
  kind: 'keyword' | 'text';
  sortable?: boolean;
  /**
   * มีฟิลด์ย่อย `.ngram` ในดัชนีหรือไม่
   *
   * `summary` มี · `description` ไม่มี (ดู index-mapping.ts) · การยิงไปที่
   * `description.ngram` ที่ไม่มีอยู่ ไม่ใช่ error — มันแค่ไม่ตรงอะไรเลย
   */
  ngram?: boolean;
}

/**
 * **ชื่อ `target` ต้องตรงกับชื่อฟิลด์ในดัชนีจริง** ไม่ใช่ชื่อที่คิดว่าน่าจะเป็น
 *
 * เขียนรอบแรกด้วยการเดา (`status`, `priority`, `issueType`) ทั้งที่ดัชนีเก็บเป็น
 * `statusName`, `priorityRank`, `issueTypeName` · คิวรีที่ได้จะไม่ตรงกับเอกสาร
 * ไหนเลยและคืนศูนย์ผลลัพธ์ทุกครั้ง โดยที่ OpenSearch ไม่ฟ้องอะไร —
 * ฟิลด์ที่ไม่มีอยู่ในดัชนีไม่ใช่ error มันแค่ไม่ตรง
 *
 * `index-mapping.spec.ts` ฝั่ง api ตรวจว่ารายการนี้ตรงกับ mapping จริง
 */
const FIELDS: Record<string, FieldSpec> = {
  status: { target: 'statusName', kind: 'keyword' },
  category: { target: 'statusCategory', kind: 'keyword' },
  priority: { target: 'priorityRank', kind: 'keyword' },
  assignee: { target: 'assigneeId', kind: 'keyword' },
  reporter: { target: 'reporterId', kind: 'keyword' },
  project: { target: 'projectKey', kind: 'keyword' },
  type: { target: 'issueTypeName', kind: 'keyword' },
  key: { target: 'itemKey', kind: 'keyword' },
  parent: { target: 'parentId', kind: 'keyword' },
  /*
    ป้ายกำกับ — `keyword` จึงต้องตรงทั้งคำ ไม่ใช่ตรงบางส่วน

    ป้ายเป็นคำที่คนเลือกใช้ซ้ำ ๆ ไม่ใช่ประโยค · การให้ตรงบางส่วนจะทำให้
    `label = "เครือข่าย"` ไปเจอ "เครือข่ายภายใน" ด้วย ซึ่งเป็นคนละป้าย
    และคนตั้งชื่อป้ายทั้งสองอันตั้งใจให้ต่างกัน
  */
  label: { target: 'labels', kind: 'keyword' },
  summary: { target: 'summary', kind: 'text', ngram: true },
  description: { target: 'description', kind: 'text' },
  created: { target: 'createdAt', kind: 'keyword', sortable: true },
  updated: { target: 'updatedAt', kind: 'keyword', sortable: true },
  resolved: { target: 'resolvedAt', kind: 'keyword', sortable: true },
};

/** ชื่อฟิลด์ในดัชนีที่ภาษานี้อ้างถึง — ใช้ตรวจกับ mapping จริงฝั่ง api */
export const INDEX_TARGETS: readonly string[] = [
  ...new Set(Object.values(FIELDS).map((f) => f.target)),
];

// ============================================================
// A · ตัวแยกคำ
// ============================================================

export type TokenKind = 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  position: number;
  /** true เมื่อคำนี้มาจากข้อความในเครื่องหมายคำพูด — ห้ามตีความเป็นคำสั่ง */
  quoted: boolean;
}

const OPERATORS = ['!=', '=', '~'];

/**
 * อักขระที่จบคำ
 *
 * ทุกอย่างที่ไม่ใช่ตัวคั่นถือเป็นส่วนหนึ่งของคำ — รวมภาษาไทย สระ และวรรณยุกต์
 * เพราะชื่อสถานะและผลการแก้ไขเป็นภาษาไทยทั้งระบบ การบังคับให้ครอบเครื่องหมาย
 * คำพูดทุกครั้งคือการทำให้ภาษานี้ใช้ไม่ได้จริงกับข้อมูลของตัวเอง
 */
const BREAK = new Set([' ', '\t', '\n', '\r', '(', ')', ',', '=', '!', '~', '"']);

export function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i] ?? '';

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }

    if (ch === '(') {
      out.push({ kind: 'lparen', value: ch, position: i, quoted: false });
      i += 1;
      continue;
    }
    if (ch === ')') {
      out.push({ kind: 'rparen', value: ch, position: i, quoted: false });
      i += 1;
      continue;
    }
    if (ch === ',') {
      out.push({ kind: 'comma', value: ch, position: i, quoted: false });
      i += 1;
      continue;
    }

    if (ch === '"') {
      const start = i;
      i += 1;
      let value = '';
      let closed = false;
      while (i < input.length) {
        const c = input[i] ?? '';
        if (c === '\\' && input[i + 1] === '"') {
          value += '"';
          i += 2;
          continue;
        }
        if (c === '"') {
          closed = true;
          i += 1;
          break;
        }
        value += c;
        i += 1;
      }
      // เครื่องหมายคำพูดที่ไม่ปิดต้องล้มดัง — ไม่ใช่กลืนไปจนจบบรรทัด
      // แล้วได้คิวรีที่ความหมายต่างจากที่พิมพ์โดยไม่มีอะไรบอก
      if (!closed) throw new HqlSyntaxError('เครื่องหมายคำพูดไม่ได้ปิด', start);
      out.push({ kind: 'ident', value, position: start, quoted: true });
      continue;
    }

    const op = OPERATORS.find((o) => input.startsWith(o, i));
    if (op !== undefined) {
      out.push({ kind: 'op', value: op, position: i, quoted: false });
      i += op.length;
      continue;
    }

    const start = i;
    let word = '';
    // `noUncheckedIndexedAccess` เปิดอยู่ — ดัชนีของสตริงเป็น string | undefined
    // จริงตามชนิด แม้เงื่อนไขวนลูปจะรับประกันว่าไม่ undefined ก็ตาม
    while (i < input.length) {
      const c = input[i];
      if (c === undefined || BREAK.has(c)) break;
      word += c;
      i += 1;
    }
    if (word === '') throw new HqlSyntaxError(`อักขระที่ใช้ไม่ได้: ${ch}`, i);
    out.push({ kind: 'ident', value: word, position: start, quoted: false });
  }

  out.push({ kind: 'eof', value: '', position: input.length, quoted: false });
  return out;
}

// ============================================================
// B · ไวยากรณ์
// ============================================================

export type Node =
  | { kind: 'and'; left: Node; right: Node }
  | { kind: 'or'; left: Node; right: Node }
  | { kind: 'not'; child: Node }
  | { kind: 'cmp'; field: string; op: '=' | '!=' | '~'; value: string }
  | { kind: 'in'; field: string; not: boolean; values: string[] }
  | { kind: 'empty'; field: string; not: boolean };

export interface OrderBy {
  field: string;
  direction: 'asc' | 'desc';
}

/** คำสั่งของภาษา — เทียบแบบไม่สนตัวพิมพ์ ต่างจาก **ค่า** ซึ่งสนเสมอ */
const isWord = (t: Token, word: string): boolean =>
  !t.quoted && t.kind === 'ident' && t.value.toUpperCase() === word;

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: 'eof', value: '', position: 0, quoted: false };
  }

  private next(): Token {
    const t = this.peek();
    this.pos += 1;
    return t;
  }

  private expect(kind: TokenKind, what: string): Token {
    const t = this.peek();
    if (t.kind !== kind) throw new HqlSyntaxError(`ต้องมี${what}`, t.position);
    return this.next();
  }

  /** ตัดส่วน ORDER BY ออกมาก่อน แล้วคืนตำแหน่งที่เงื่อนไขจบ */
  static splitOrderBy(tokens: Token[]): { where: Token[]; order: OrderBy | null } {
    for (let i = 0; i < tokens.length - 1; i += 1) {
      const t = tokens[i];
      const n = tokens[i + 1];
      if (t === undefined || n === undefined) continue;
      if (!isWord(t, 'ORDER') || !isWord(n, 'BY')) continue;

      const fieldTok = tokens[i + 2];
      if (fieldTok === undefined || fieldTok.kind !== 'ident') {
        throw new HqlSyntaxError('ORDER BY ต้องตามด้วยชื่อฟิลด์', t.position);
      }
      const dirTok = tokens[i + 3];
      let direction: 'asc' | 'desc' = 'desc';
      if (dirTok !== undefined && dirTok.kind === 'ident') {
        if (isWord(dirTok, 'ASC')) direction = 'asc';
        else if (isWord(dirTok, 'DESC')) direction = 'desc';
        else throw new HqlSyntaxError('ทิศทางการเรียงต้องเป็น ASC หรือ DESC', dirTok.position);
      }
      const where = tokens.slice(0, i);
      where.push({ kind: 'eof', value: '', position: t.position, quoted: false });
      return { where, order: { field: fieldTok.value, direction } };
    }
    return { where: tokens, order: null };
  }

  parse(): Node {
    const node = this.parseOr();
    const t = this.peek();
    if (t.kind !== 'eof') throw new HqlSyntaxError(`ไม่เข้าใจ "${t.value}"`, t.position);
    return node;
  }

  /** OR ผูกหลวมที่สุด — `a OR b AND c` = `a OR (b AND c)` */
  private parseOr(): Node {
    let left = this.parseAnd();
    while (isWord(this.peek(), 'OR')) {
      this.next();
      left = { kind: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseUnary();
    while (isWord(this.peek(), 'AND')) {
      this.next();
      left = { kind: 'and', left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Node {
    if (isWord(this.peek(), 'NOT')) {
      this.next();
      return { kind: 'not', child: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const t = this.peek();
    if (t.kind === 'lparen') {
      this.next();
      const inner = this.parseOr();
      this.expect('rparen', 'วงเล็บปิด');
      return inner;
    }
    if (t.kind !== 'ident') throw new HqlSyntaxError('ต้องมีชื่อฟิลด์', t.position);
    const field = this.next().value;

    // IS EMPTY / IS NOT EMPTY
    if (isWord(this.peek(), 'IS')) {
      this.next();
      let not = false;
      if (isWord(this.peek(), 'NOT')) {
        this.next();
        not = true;
      }
      if (!isWord(this.peek(), 'EMPTY')) {
        throw new HqlSyntaxError('หลัง IS ต้องเป็น EMPTY หรือ NOT EMPTY', this.peek().position);
      }
      this.next();
      return { kind: 'empty', field, not };
    }

    // [NOT] IN (...)
    let notIn = false;
    if (isWord(this.peek(), 'NOT')) {
      this.next();
      notIn = true;
    }
    if (isWord(this.peek(), 'IN')) {
      this.next();
      this.expect('lparen', 'วงเล็บเปิดหลัง IN');
      const values: string[] = [];
      while (this.peek().kind !== 'rparen') {
        const v = this.peek();
        if (v.kind !== 'ident') throw new HqlSyntaxError('ต้องมีค่าใน IN', v.position);
        values.push(this.next().value);
        if (this.peek().kind === 'comma') this.next();
        else break;
      }
      this.expect('rparen', 'วงเล็บปิด');
      /*
        `IN ()` ที่ไม่มีค่าเลยถูกปฏิเสธ ไม่ใช่ตีความว่า "ไม่กรอง"
        ทั้งสองความหมายเป็นไปได้ทั้งคู่ และการเดาผิดข้างหนึ่งคืนผลกว้างเกิน
        โดยที่ผู้ใช้ตั้งใจตรงกันข้าม
      */
      if (values.length === 0) throw new HqlSyntaxError('IN ต้องมีค่าอย่างน้อยหนึ่งค่า', t.position);
      return { kind: 'in', field, not: notIn, values };
    }
    if (notIn) throw new HqlSyntaxError('หลัง NOT ต้องเป็น IN', this.peek().position);

    const opTok = this.peek();
    if (opTok.kind !== 'op') throw new HqlSyntaxError('ต้องมีตัวดำเนินการ', opTok.position);
    this.next();
    const valTok = this.peek();
    if (valTok.kind !== 'ident') throw new HqlSyntaxError('ต้องมีค่าหลังตัวดำเนินการ', valTok.position);
    this.next();
    return { kind: 'cmp', field, op: opTok.value as '=' | '!=' | '~', value: valTok.value };
  }
}

/** แปลงข้อความเป็นต้นไม้ไวยากรณ์ — ยังไม่ตรวจว่าฟิลด์มีจริง */
export function parse(input: string): Node {
  const { where } = Parser.splitOrderBy(tokenize(input));
  if (where.length <= 1) throw new HqlSyntaxError('คิวรีว่างเปล่า', 0);
  return new Parser(where).parse();
}

// ============================================================
// C+D+E · แปลเป็น DSL
// ============================================================

export interface CompileScope {
  tenantId: string;
  /** โปรเจกต์ที่ผู้ใช้คนนี้เปิดดูได้ — รายการว่าง = ไม่เห็นอะไรเลย */
  browsableProjectIds: string[];
}

export interface CompiledQuery {
  query: { bool: { filter: unknown[]; must: unknown[] } };
  sort: Array<Record<string, 'asc' | 'desc'>>;
}

function spec(field: string): FieldSpec {
  const f = FIELDS[field];
  if (f === undefined) throw new HqlFieldError(field);
  return f;
}

/**
 * เกณฑ์ที่วัดมาแล้วบนข้อมูลจริง 10,000 ใบ (ADR-005) — ไม่ใช่ตัวเลขที่เดา
 *
 * ไม่ใส่เลย = คำค้นที่ไม่เกี่ยวข้องกันเลยจะคืนผลลัพธ์ เพราะ n-gram ชิ้นเดียว
 * ที่บังเอิญตรงก็นับเป็น hit
 */
const MIN_MAIN = '75%';
const MIN_NGRAM = '80%';

function toClause(node: Node): unknown {
  switch (node.kind) {
    case 'and':
      return { bool: { must: [toClause(node.left), toClause(node.right)] } };
    case 'or':
      // `should` + `minimum_should_match: 1` — ไม่ใช่ `should` เปล่า ๆ ซึ่งใน
      // filter context จะกลายเป็น "ไม่บังคับสักข้อ" และคืนทุกอย่าง
      return { bool: { should: [toClause(node.left), toClause(node.right)], minimum_should_match: 1 } };
    case 'not':
      return { bool: { must_not: [toClause(node.child)] } };
    case 'empty': {
      const f = spec(node.field);
      const exists = { exists: { field: f.target } };
      return node.not ? exists : { bool: { must_not: [exists] } };
    }
    case 'in': {
      const f = spec(node.field);
      if (f.kind !== 'keyword') {
        throw new HqlValueError(`ฟิลด์ "${node.field}" เป็นข้อความ ใช้ IN ไม่ได้ — ใช้ ~ แทน`);
      }
      const terms = { terms: { [f.target]: node.values } };
      return node.not ? { bool: { must_not: [terms] } } : terms;
    }
    case 'cmp': {
      const f = spec(node.field);
      if (node.op === '~') {
        if (f.kind !== 'text') {
          throw new HqlValueError(
            `ฟิลด์ "${node.field}" ต้องตรงทั้งค่า ใช้ ~ ไม่ได้ — ใช้ = หรือ IN แทน`,
          );
        }
        const main = {
          match: { [f.target]: { query: node.value, minimum_should_match: MIN_MAIN } },
        };
        /*
          ฟิลด์ที่มี `.ngram` ต้องยิงสองสาขา เหมือนที่ `buildTextQuery` ทำ

          สาขาหลักใช้ตัวตัดคำ ซึ่งพลาดคำทับศัพท์ที่ตัดไม่ลง · สาขา n-gram
          กู้คืนให้ · ยิงสาขาเดียวแล้วคำอย่าง "ปริ๊นเตอร์" หาไม่เจอเลย
          ซึ่งเป็นความล้มเหลวแบบเงียบที่ ADR-005 บันทึกไว้ทั้งหน้า
        */
        if (f.ngram !== true) return main;
        return {
          bool: {
            minimum_should_match: 1,
            should: [
              main,
              {
                match: {
                  [`${f.target}.ngram`]: { query: node.value, minimum_should_match: MIN_NGRAM },
                },
              },
            ],
          },
        };
      }
      if (f.kind !== 'keyword') {
        throw new HqlValueError(
          `ฟิลด์ "${node.field}" เป็นข้อความ ใช้ ${node.op} ไม่ได้ — ใช้ ~ แทน`,
        );
      }
      const term = { term: { [f.target]: node.value } };
      return node.op === '=' ? term : { bool: { must_not: [term] } };
    }
  }
}

/**
 * แปลคิวรีของผู้ใช้เป็น OpenSearch DSL พร้อมขอบเขตที่ระบบบังคับ
 *
 * ตัวกรองของระบบอยู่ใน `filter` · เงื่อนไขของผู้ใช้อยู่ใน `must`
 * แยกกันโดยตั้งใจ ไม่ใช่เพื่อความสวยงาม — วันที่มีคนแก้กติกาความปลอดภัย
 * จะได้ไม่เผลอแก้เงื่อนไขของผู้ใช้ไปด้วย และคนอ่านคิวรีที่ได้แยกออกทันที
 */
export function compile(input: string, scope: CompileScope): CompiledQuery {
  const tokens = tokenize(input);
  const { where, order } = Parser.splitOrderBy(tokens);
  if (where.length <= 1) throw new HqlSyntaxError('คิวรีว่างเปล่า', 0);
  const ast = new Parser(where).parse();

  let sort: Array<Record<string, 'asc' | 'desc'>> = [{ updatedAt: 'desc' }];
  if (order !== null) {
    const f = spec(order.field);
    // เรียงตามฟิลด์ที่วิเคราะห์คำแล้วให้ผลที่อธิบายไม่ได้ — ปฏิเสธดีกว่า
    if (f.sortable !== true) throw new HqlFieldError(order.field);
    sort = [{ [f.target]: order.direction }];
  }

  return {
    query: {
      bool: {
        filter: [
          { term: { tenantId: scope.tenantId } },
          // รายการว่าง = ไม่เห็นอะไรเลย ซึ่งถูกต้อง · `terms` กับ array ว่าง
          // ไม่ตรงกับเอกสารใดเลย ต่างจากการละตัวกรองทิ้งซึ่งจะเห็นทั้งหมด
          { terms: { projectId: scope.browsableProjectIds } },
        ],
        must: [toClause(ast)],
      },
    },
    sort,
  };
}

// ============================================================
// เป้าหมายที่สอง — เงื่อนไข `where` ของ Prisma
// ============================================================

/**
 * แปล HQL เป็นเงื่อนไข `where` ของ Prisma
 *
 * ## ทำไมต้องมีเป้าหมายที่สอง
 *
 * HQL แปลเป็น OpenSearch DSL อยู่แล้ว และหน้าค้นหาใช้ทางนั้น · แต่ **กระดาน
 * อ่านจาก MySQL** ซึ่งเป็นแหล่งความจริง · ตัวกรองที่ตัดสินว่าการ์ดใบไหน
 * ปรากฏบนกระดาน ต้องเห็นข้อมูลชุดเดียวกับที่กระดานเห็น
 *
 * ถ้าให้ตัวกรองเดินผ่านดัชนีแล้วเอาคีย์กลับมากรอง จะได้ปัญหาสองชั้น: ดัชนี
 * ตามหลัง MySQL อยู่เสมอ (งานที่เพิ่งสร้างจะหายจากกระดานเงียบ ๆ) และรายการ
 * คีย์ที่ตรงมีได้เป็นพัน ซึ่งไม่มีเพดานที่ปลอดภัย
 *
 * ## สิ่งที่แปลไม่ได้ ต้องปฏิเสธ ไม่ใช่แปลแบบพอไหว
 *
 * ฟิลด์ข้อความแปลไม่ได้เพราะ MySQL FULLTEXT ตัดคำไทยไม่ได้ (ADR-005) และ
 * `LIKE '%…%'` ให้ผลคนละแบบกับหน้าค้นหา · **ตัวกรองชื่อเดียวกันที่ตอบ
 * คนละอย่างในสองที่ แย่กว่าไม่มีตัวกรอง** เพราะคนจะเชื่อผลที่เห็นทั้งสองที่
 */
/** ฟิลด์ที่คิวรีบนหน้าค้นหาได้ แต่แปลเป็นเงื่อนไขของฐานข้อมูลไม่ได้ */
export const PRISMA_UNSUPPORTED_FIELDS: readonly string[] = [
  'summary',
  'description',
  // เก็บใน EAV (ADR-001) จึงไม่ใช่คอลัมน์ที่กรองตรง ๆ ได้
  'label',
] as const;

/** ฟิลด์ที่ใช้กับหน้าค้นหาได้ แต่ใช้เป็นตัวกรองบนกระดานไม่ได้ */
export class HqlUnsupportedInPrismaError extends Error {
  constructor(field: string) {
    super(
      `ฟิลด์ "${field}" ใช้เป็นตัวกรองบนกระดานไม่ได้ — ใช้ที่หน้าค้นหาแทน` +
        ' · กระดานอ่านจากฐานข้อมูลโดยตรง ซึ่งค้นข้อความไทยไม่ได้',
    );
  }
}

/** เปรียบเทียบได้เฉพาะ "มีค่า/ไม่มีค่า" ไม่ใช่เท่ากับค่าใดค่าหนึ่ง */
export class HqlComparisonUnsupportedError extends Error {
  constructor(field: string) {
    super(
      `ฟิลด์ "${field}" เทียบเท่ากับค่าใดค่าหนึ่งไม่ได้ — ใช้ได้แค่ IS EMPTY` +
        ' หรือ IS NOT EMPTY · การเทียบวันเวลาแบบตรงวินาทีไม่เคยตรงกับอะไร',
    );
  }
}

/** ค่าที่ใส่ในเงื่อนไขได้ — ครอบเท่าที่เป้าหมายนี้สร้างจริง */
type Scalar = string | number | bigint | null;
/** เงื่อนไขหนึ่งชั้นของ Prisma · โครงสร้างซ้อนได้ไม่จำกัดชั้น */
export interface PrismaWhere {
  [key: string]: Scalar | PrismaWhere | PrismaWhere[] | Scalar[] | undefined;
}

interface ColumnSpec {
  /** ชื่อคอลัมน์ หรือ `[ชื่อความสัมพันธ์, ชื่อฟิลด์ในนั้น]` */
  path: string | [string, string];
  /** แปลงค่าที่ผู้ใช้พิมพ์ (สตริงเสมอ) เป็นชนิดที่คอลัมน์ใช้ */
  cast: (v: string) => Scalar;
  /**
   * คอลัมน์นี้เป็น `NULL` ได้หรือไม่
   *
   * ใช้ตัดสินว่า `!=` ต้องเผื่อแถวที่เป็น NULL ด้วยไหม — ดู `negate()`
   */
  nullable: boolean;
  /** เทียบเท่ากับค่าไม่ได้ ใช้ได้แค่ IS EMPTY / IS NOT EMPTY */
  emptyOnly?: boolean;
}

const bigint = (v: string): bigint => {
  if (!/^\d+$/.test(v)) throw new HqlValueError(`ค่า "${v}" ต้องเป็นรหัสที่เป็นตัวเลข`);
  return BigInt(v);
};
const int = (v: string): number => {
  if (!/^\d+$/.test(v)) throw new HqlValueError(`ค่า "${v}" ต้องเป็นตัวเลข`);
  return Number(v);
};
const str = (v: string): string => v;

/**
 * ฟิลด์ที่แปลได้ — **allow-list เหมือนฝั่ง OpenSearch**
 *
 * ปล่อยให้พิมพ์ชื่ออะไรก็ได้ แปลว่าคนที่รู้ชื่อคอลัมน์ภายในจะกรองด้วยฟิลด์
 * ที่ไม่ควรถูกกรอง และรู้ได้ว่ามีข้อมูลอะไรอยู่จากจำนวนผลลัพธ์
 */
const COLUMNS: Record<string, ColumnSpec> = {
  status: { path: ['status', 'name'], cast: str, nullable: false },
  category: { path: ['status', 'category'], cast: str, nullable: false },
  priority: { path: ['priority', 'rank'], cast: int, nullable: true },
  assignee: { path: 'assigneeId', cast: bigint, nullable: true },
  reporter: { path: 'reporterId', cast: bigint, nullable: false },
  project: { path: ['project', 'key'], cast: str, nullable: false },
  type: { path: ['issueType', 'name'], cast: str, nullable: false },
  key: { path: 'itemKey', cast: str, nullable: false },
  parent: { path: 'parentId', cast: bigint, nullable: true },
  /*
    วันเวลาใช้ได้แค่ "มีค่า/ไม่มีค่า" · `resolved IS EMPTY` = ยังไม่ปิด
    ซึ่งเป็นตัวกรองที่ใช้จริงบนกระดาน · ส่วน `resolved = "..."` ต้องตรง
    ระดับมิลลิวินาที จึงไม่เคยตรงกับอะไรและอ่านเหมือนตัวกรองพัง
  */
  resolved: { path: 'resolvedAt', cast: str, nullable: true, emptyOnly: true },
};

const isUnsupported = (field: string): boolean => PRISMA_UNSUPPORTED_FIELDS.includes(field);

function columnOf(field: string): ColumnSpec {
  if (isUnsupported(field)) throw new HqlUnsupportedInPrismaError(field);
  const c = COLUMNS[field];
  if (c === undefined) throw new HqlFieldError(field);
  return c;
}

/** ห่อค่าให้อยู่ในรูปเงื่อนไขตามเส้นทางของคอลัมน์ */
function at(spec: ColumnSpec, value: Scalar | PrismaWhere): PrismaWhere {
  if (typeof spec.path === 'string') return { [spec.path]: value };
  const [rel, field] = spec.path;
  return { [rel]: { [field]: value } };
}

/**
 * ปฏิเสธค่าหนึ่ง โดย **เผื่อแถวที่เป็น NULL ด้วยเมื่อคอลัมน์เป็น NULL ได้**
 *
 * `assignee != "7"` ใน SQL ตรง ๆ จะไม่คืนแถวที่ `assignee_id` เป็น NULL
 * เพราะ `NULL != 7` ได้ UNKNOWN ไม่ใช่ TRUE · แต่คนที่พิมพ์ "ไม่ใช่คนนี้"
 * คาดว่าจะเห็นงานที่ยังไม่มีผู้รับผิดชอบด้วย — ซึ่งบนกระดานศูนย์บริการ
 * คือกองที่สำคัญที่สุด และถ้าหายไปจะไม่มีอะไรบอกเลย
 */
function negate(spec: ColumnSpec, inner: PrismaWhere): PrismaWhere {
  if (!spec.nullable) return at(spec, inner);
  return { OR: [at(spec, inner), at(spec, null)] };
}

function clauseOf(node: Node): PrismaWhere {
  switch (node.kind) {
    case 'and':
      return { AND: [clauseOf(node.left), clauseOf(node.right)] };
    case 'or':
      return { OR: [clauseOf(node.left), clauseOf(node.right)] };
    case 'not':
      return { NOT: clauseOf(node.child) };
    case 'empty': {
      const spec = columnOf(node.field);
      return at(spec, node.not ? { not: null } : null);
    }
    case 'cmp': {
      const spec = columnOf(node.field);
      /*
        `~` คือการค้นด้วยการวิเคราะห์คำ ซึ่งไม่มีอยู่ในฐานข้อมูลนี้ ·
        ฟิลด์ที่ใช้ `~` ได้ทั้งหมดอยู่ในรายการที่ปฏิเสธไปแล้วข้างบน
        แต่กันไว้อีกชั้นเผื่อมีฟิลด์ใหม่
      */
      if (node.op === '~') throw new HqlUnsupportedInPrismaError(node.field);
      if (spec.emptyOnly === true) throw new HqlComparisonUnsupportedError(node.field);
      const v = spec.cast(node.value);
      return node.op === '=' ? at(spec, v) : negate(spec, { not: v });
    }
    case 'in': {
      const spec = columnOf(node.field);
      if (spec.emptyOnly === true) throw new HqlComparisonUnsupportedError(node.field);
      const vs = node.values.map((v) => spec.cast(v));
      return node.not ? negate(spec, { notIn: vs }) : at(spec, { in: vs });
    }
  }
}

/** ขอบเขตที่ผู้เรียกต้องบอก — เหมือนฝั่ง OpenSearch ทุกประการ */
export interface PrismaScope {
  tenantId: string;
  /** โปรเจกต์ที่ผู้ใช้คนนี้เปิดดูได้ — **รายการว่าง = ไม่เห็นอะไรเลย** */
  browsableProjectIds: string[];
}

/**
 * แปลคิวรีเป็นเงื่อนไข `where`
 *
 * **ขอบเขต tenant และโปรเจกต์ถูกใส่เสมอ** ไม่ว่าคิวรีจะเขียนว่าอะไร
 * (INVARIANT 1) · และรายการโปรเจกต์ว่างแปลว่าไม่เห็นอะไรเลย ไม่ใช่ไม่จำกัด
 * — การไม่กรองคือค่าปริยายของทุกคิวรี ซึ่งเป็นวิธีที่ระบบสิทธิ์รั่วบ่อยที่สุด
 *
 * คิวรีว่างเปล่าไม่ใช่ error ที่นี่ (ต่างจาก `compile`) เพราะ "ไม่กรองอะไรเพิ่ม"
 * เป็นสถานะที่ใช้จริงของตัวกรองบนกระดาน
 */
export function compilePrisma(input: string, scope: PrismaScope): PrismaWhere {
  const base: PrismaWhere = {
    tenantId: BigInt(scope.tenantId),
    projectId: { in: scope.browsableProjectIds.map((p) => BigInt(p)) },
  };
  const tokens = tokenize(input);
  const { where } = Parser.splitOrderBy(tokens);
  /*
    คิวรีว่างเปล่าไม่ใช่ error ที่นี่ (ต่างจาก `compile`) เพราะ
    "ไม่กรองอะไรเพิ่ม" เป็นสถานะที่ใช้จริงของตัวกรองบนกระดาน
  */
  if (where.length <= 1) return base;
  return { ...base, AND: [clauseOf(new Parser(where).parse())] };
}
