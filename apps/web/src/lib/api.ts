import { cookies } from 'next/headers';

/**
 * ที่อยู่ API มีสองแบบ และ **ไม่ใช่ค่าเดียวกันเมื่อรันในคอนเทนเนอร์**
 *
 *   - `API_BASE`     ที่อยู่ที่ **เบราว์เซอร์** ใช้ เช่น http://localhost:4400
 *   - `INTERNAL_API` ที่อยู่ที่ **เซิร์ฟเวอร์ Next** ใช้ เช่น http://api:4400
 *
 * บนเครื่องพัฒนาสองค่านี้เหมือนกัน จึงไม่มีใครเห็นความต่าง
 * แต่ในคอนเทนเนอร์ `localhost` ของ web คือตัว web เอง ไม่ใช่ api
 *
 * อาการที่เจอจริงตอนยกสแตกขึ้น: ล็อกอินได้ หน้าจัดการผู้ใช้ทำงาน
 * (ทั้งคู่เรียกจากเบราว์เซอร์) แต่หน้าคิวและหน้าแจ้งปัญหาว่างเปล่า
 * เพราะเป็น server component — และไม่มี error โผล่ที่ไหนเลย
 */
export const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:4400';

const INTERNAL_API = process.env['API_INTERNAL_URL'] ?? API_BASE;

/**
 * เรียก API จาก **server component**
 *
 * server component รันบนเซิร์ฟเวอร์ Next.js ซึ่ง **ไม่มีคุกกี้ของผู้ใช้ติดมาเอง**
 * ต้องอ่านคุกกี้จากคำขอที่เข้ามาแล้วส่งต่อด้วยมือ · ถ้าลืม ทุกหน้าที่โหลดข้อมูล
 * ฝั่งเซิร์ฟเวอร์จะได้ 401 ทั้งที่ผู้ใช้ล็อกอินอยู่ และหน้าจอจะขึ้นว่า
 * "เชื่อมต่อไม่ได้" ซึ่งชี้ไปผิดทางทั้งหมด
 *
 * ต่างจากฝั่ง client ที่แค่ใส่ `credentials: 'include'` แล้วเบราว์เซอร์จัดการให้
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const jar = await cookies();
  const header = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  // ใช้ Headers ไม่ใช่ spread — `init.headers` เป็น array หรือ Headers ก็ได้
  // การ spread ของพวกนั้นลงใน object ได้คีย์เป็นเลขดัชนี ซึ่งเงียบและผิด
  const headers = new Headers(init.headers);
  if (header !== '') headers.set('cookie', header);

  return fetch(`${INTERNAL_API}${path}`, { ...init, cache: 'no-store', headers });
}

/** true เมื่อ API บอกว่ายังไม่ได้ล็อกอิน — หน้าจอควรพาไปหน้าล็อกอิน ไม่ใช่แสดง error */
export function isUnauthenticated(res: Response): boolean {
  return res.status === 401;
}
