import { ReportForm } from '@/components/report-form';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Options {
  projects: Array<{ key: string; name: string }>;
  issueTypes: Array<{ name: string; icon: string }>;
  priorities: Array<{ rank: number; name: string }>;
}

const API = process.env['API_BASE_URL'] ?? 'http://localhost:4000';

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
