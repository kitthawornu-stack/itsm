/**
 * อ่านชื่อไฟล์จากหัว `Content-Disposition`
 *
 * **ต้องอ่าน `filename*` ก่อน `filename` เสมอ** · หัวนี้มีชื่อไฟล์ได้สองแบบ
 * ในบรรทัดเดียวกัน — แบบ ASCII (`filename=`) และแบบที่รองรับอักขระทุกภาษา
 * (`filename*=UTF-8''`) · เซิร์ฟเวอร์ส่งทั้งคู่เพื่อให้เบราว์เซอร์เก่าใช้ได้ด้วย
 *
 * ถ้าอ่านแบบ ASCII ก่อน ชื่อไฟล์ภาษาไทยจะได้ตัวที่ถูกแทนแล้ว โดยที่ไฟล์ยัง
 * ดาวน์โหลดสำเร็จและไม่มี error — ไม่มีใครเห็นว่าชื่อเพี้ยนจนกว่าจะเปิดโฟลเดอร์
 */
export function filenameFrom(header: string | null): string | null {
  if (header === null) return null;

  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1] !== undefined) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /*
        ชื่อที่ถอดรหัสไม่ได้ (เปอร์เซ็นต์ลอย ๆ) ต้องตกไปใช้แบบ ASCII
        ไม่ใช่ทำให้ทั้งการดาวน์โหลดพัง — ไฟล์สำคัญกว่าชื่อไฟล์
      */
    }
  }

  const plain = /filename="([^"]+)"/i.exec(header);
  return plain?.[1] ?? null;
}
