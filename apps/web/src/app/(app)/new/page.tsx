import { ReportForm, type Options } from '@/components/report-form';
import { API_BASE, apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

// ชนิดมาจากคอมโพเนนต์ที่ใช้มันจริง ไม่ประกาศซ้ำ —
// สองสำเนาของชนิดเดียวกันคือสองสำเนาที่จะไม่ตรงกันในวันที่มีคนแก้แค่ที่เดียว

// ที่อยู่ฝั่งเบราว์เซอร์ — ต่างจากที่ server component ใช้ ดู lib/api.ts
const API = API_BASE;

/**
 * หน้าแจ้งปัญหา
 *
 * ตัวเลือกโหลดฝั่งเซิร์ฟเวอร์ เพราะมันไม่เปลี่ยนระหว่างกรอกฟอร์ม
 * และการรอ fetch ฝั่ง client ทำให้เห็นกล่องเปล่าก่อนหนึ่งจังหวะ
 */
export default async function NewItemPage(): Promise<React.ReactNode> {
  let options: Options | null = null;
  try {
    const res = await apiFetch('/api/v1/work-items/options');
    if (res.ok) options = (await res.json()) as Options;
  } catch {
    options = null;
  }

  if (options === null || options.projects.length === 0) {
    return (
      <section className="page">
        <h1 className="page-title">แจ้งปัญหา</h1>
        <p className="page-sub">
          ตอนนี้เชื่อมต่อระบบไม่ได้ จึงยังรับเรื่องไม่ได้ ลองใหม่อีกครั้งในอีกสักครู่
        </p>
      </section>
    );
  }

  return (
    <section className="page">
      <h1 className="page-title">แจ้งปัญหา</h1>
      <p className="page-sub">
        เล่าให้ฟังว่าเกิดอะไรขึ้น ทีมไอทีจะได้รับเรื่องทันทีและเริ่มจับเวลาตามข้อตกลงบริการ
      </p>
      <ReportForm apiBase={API} options={options} />
    </section>
  );
}
