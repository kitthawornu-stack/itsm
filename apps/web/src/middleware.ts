import { NextResponse, type NextRequest } from 'next/server';

/**
 * กันไม่ให้เปิดหน้าอื่นก่อนล็อกอิน
 *
 * **ไม่ใช่ด่านความปลอดภัย** — ด่านจริงคือ `SessionGuard` ที่ฝั่ง API
 * ซึ่งตรวจเซสชันกับฐานข้อมูลทุกคำขอ · ที่นี่แค่ดูว่ามีคุกกี้อยู่หรือไม่
 * เพื่อไม่ให้ผู้ใช้เห็นหน้าเปล่าที่โหลดข้อมูลไม่ได้ แล้วต้องเดาเองว่าเกิดอะไรขึ้น
 *
 * ถ้าคุกกี้หมดอายุ middleware จะปล่อยผ่าน แต่ API จะตอบ 401 และหน้าจอ
 * แสดงข้อผิดพลาด — ยอมรับได้ เพราะการตรวจซ้ำที่นี่ต้องยิงไปหา API ทุกครั้ง
 */
const SESSION_COOKIE = 'itsm_session';

export function middleware(req: NextRequest): NextResponse {
  if (req.cookies.get(SESSION_COOKIE) !== undefined) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  // จำหน้าที่ตั้งใจจะไป เพื่อพากลับหลังล็อกอินสำเร็จ
  url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  /**
   * ทุกหน้ายกเว้นหน้าล็อกอินเองและไฟล์ static
   *
   * ลืมยกเว้น `/login` เมื่อไร จะได้ redirect วนไม่รู้จบ ซึ่งเบราว์เซอร์
   * จะแสดงเป็น ERR_TOO_MANY_REDIRECTS โดยไม่บอกว่าเกิดจากอะไร
   */
  matcher: ['/((?!login|_next/static|_next/image|favicon.ico).*)'],
};
