import { cookies } from 'next/headers';

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
export const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:4000';

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

  return fetch(`${API_BASE}${path}`, { ...init, cache: 'no-store', headers });
}

/** true เมื่อ API บอกว่ายังไม่ได้ล็อกอิน — หน้าจอควรพาไปหน้าล็อกอิน ไม่ใช่แสดง error */
export function isUnauthenticated(res: Response): boolean {
  return res.status === 401;
}
