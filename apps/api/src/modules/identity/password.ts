/**
 * แฮชรหัสผ่าน
 *
 * ใช้ **scrypt จาก `node:crypto`** ไม่ใช่ bcrypt หรือ argon2 จาก npm
 *
 * เหตุผล: on-prem bundle ต้องติดตั้งได้บนเครื่องลูกค้าโดยไม่ต้องคอมไพล์อะไร
 * bcrypt และ argon2 เป็น native module ที่ต้องมี binary ตรงกับ Node และ OS
 * ซึ่งเป็นสาเหตุอันดับหนึ่งที่ `pnpm install` ล้มบนเครื่องที่เราไม่ได้ควบคุม
 * scrypt อยู่ใน Node เอง เป็น KDF ที่ OWASP รับรอง และไม่มีวันติดตั้งไม่ได้
 *
 * **พารามิเตอร์เก็บอยู่ในสตริงแฮชเอง** ไม่ใช่ในโค้ด
 * เพราะวันที่เราเพิ่มความแรง รหัสผ่านเก่าต้องยังตรวจได้ด้วยพารามิเตอร์เดิม
 * ถ้าอ่านค่าจากโค้ด รหัสผ่านทุกใบจะใช้ไม่ได้พร้อมกันในวินาทีที่ deploy
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * ห่อ scrypt เป็น Promise เอง แทนการใช้ `promisify`
 *
 * `promisify(scrypt)` เลือก overload สามอาร์กิวเมนต์ ทำให้ส่ง `options` ไม่ได้
 * ตามชนิด — และ **เทสต์ผ่านหมดทั้งที่ tsc แดง** เพราะ vitest ไม่ได้ตรวจชนิด
 * (บทเรียนเดิมของโปรเจกต์: เทสต์เขียวไม่ได้แปลว่า typecheck ผ่าน)
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derived) => {
      if (err !== null) reject(err);
      else resolve(derived);
    });
  });
}

/**
 * ค่าปัจจุบัน — อิงคำแนะนำ OWASP (N=2^16, r=8, p=1 ใช้หน่วยความจำ ~64 MB)
 *
 * แรงพอที่การเดารหัสผ่านเป็นล้านครั้งต่อวินาทีทำไม่ได้ และเบาพอที่เซิร์ฟเวอร์
 * ของทีมไอทีไม่เกินสิบคนรับไหว · เพิ่มได้ภายหลังโดยไม่กระทบรหัสผ่านเดิม
 */
const N = 65_536;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

/**
 * เพดานหน่วยความจำของ scrypt
 *
 * ค่าปริยายของ Node คือ 32 MB ซึ่ง **ต่ำกว่าที่ N=65536 ต้องใช้**
 * ผลคือ scrypt โยน error ทันที ไม่ใช่แฮชช้าลง — ถ้าไม่ตั้งค่านี้ ระบบจะล็อกอิน
 * ไม่ได้เลยสักครั้ง โดย error ไปโผล่ที่ปลายทางที่ดูไม่เกี่ยวกับรหัสผ่าน
 */
const MAX_MEM = 256 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 12;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeakPasswordError';
  }
}

/**
 * ตรวจความยาวและรูปแบบที่แย่ที่สุด — ไม่ใช่กฎ "ต้องมีอักขระพิเศษ"
 *
 * กฎบังคับอักขระพิเศษทำให้คนตั้ง `Password1!` ซึ่งเดาง่ายกว่าวลียาว ๆ
 * NIST เลิกแนะนำกฎแบบนั้นตั้งแต่ปี 2017 · ความยาวคือสิ่งที่ได้ผลจริง
 */
export function assertPasswordAcceptable(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new WeakPasswordError(
      `รหัสผ่านต้องยาวอย่างน้อย ${String(PASSWORD_MIN_LENGTH)} ตัวอักษร — ` +
        'ประโยคที่จำได้ง่ายแต่ยาว ปลอดภัยกว่าคำสั้นที่มีอักขระพิเศษ',
    );
  }
  if (password.trim().length === 0) {
    throw new WeakPasswordError('รหัสผ่านต้องไม่ใช่ช่องว่างทั้งหมด');
  }
  // เพดานกัน DoS — สตริงยาวเป็นเมกะไบต์ทำให้ scrypt กินเวลานานมาก
  if (password.length > 1024) {
    throw new WeakPasswordError('รหัสผ่านยาวเกินไป');
  }
}

/**
 * รูปแบบที่เก็บ: `scrypt$N$r$p$saltBase64$hashBase64`
 *
 * มีพารามิเตอร์อยู่ในตัว จึงตรวจรหัสผ่านที่แฮชด้วยค่าเก่าได้เสมอ
 */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordAcceptable(password);
  const salt = randomBytes(SALT_LEN);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LEN, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });
  return [
    'scrypt',
    String(N),
    String(R),
    String(P),
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/**
 * ตรวจรหัสผ่าน
 *
 * คืน `false` แทนการโยน error ทุกกรณีที่แฮชอ่านไม่ได้ — ผู้โจมตีต้องแยกไม่ออก
 * ระหว่าง "บัญชีนี้ไม่มี" กับ "รหัสผ่านผิด" กับ "ข้อมูลในฐานข้อมูลเสีย"
 *
 * เทียบด้วย `timingSafeEqual` เพื่อไม่ให้เวลาที่ใช้บอกว่าเดาถูกกี่ไบต์แรก
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // กันแฮชที่ถูกแก้ให้พารามิเตอร์สูงจนเป็น DoS ตอนตรวจ
  /**
   * เพดานงานตอนตรวจ — **แคบกว่าที่ `maxmem` จับได้**
   *
   * `maxmem` กันเฉพาะแฮชที่กินหน่วยความจำเกิน 256 MB แต่ค่าอย่าง N=524288, r=2
   * ใช้ราว 134 MB ซึ่งผ่าน `maxmem` ไปได้ แล้วกินเวลาหลายวินาทีต่อการล็อกอิน
   * หนึ่งครั้ง · ใครที่เขียนแถวในฐานข้อมูลได้ จะทำให้เซิร์ฟเวอร์ช้าลงจนใช้ไม่ได้
   * โดยไม่ต้องมีสิทธิ์อะไรเพิ่ม
   *
   * เพดานนี้สูงกว่าค่าที่เราใช้จริง (N=65536) สี่เท่า จึงยังเผื่อการเพิ่มความแรง
   * ในอนาคตได้โดยไม่ต้องแก้ที่นี่
   */
  if (n > 262_144 || r > 16 || p > 8 || n < 2 || r < 1 || p < 1) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? '', 'base64');
    expected = Buffer.from(parts[5] ?? '', 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: MAX_MEM,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * แฮชนี้ใช้พารามิเตอร์ที่อ่อนกว่าค่าปัจจุบันหรือไม่
 *
 * ใช้ตอนล็อกอินสำเร็จ: ถ้าเก่า ให้แฮชใหม่ด้วยค่าปัจจุบันทันที
 * — เป็นทางเดียวที่รหัสผ่านเก่าจะแข็งขึ้นได้โดยไม่ต้องบังคับให้ทุกคนเปลี่ยน
 */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < N || Number(parts[2]) < R || Number(parts[3]) < P;
}
