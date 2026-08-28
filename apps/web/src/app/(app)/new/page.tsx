import { ReportForm, type Options, type PickedService } from '@/components/report-form';
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
export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}): Promise<React.ReactNode> {
  const { service } = await searchParams;

  /*
    บริการที่เลือกมาจากหน้ารายการ — โหลดฝั่งเซิร์ฟเวอร์เพื่อให้ฟอร์มเปิดมา
    พร้อมค่าที่ถูกต้องเลย ไม่ใช่กระพริบเปลี่ยนทีหลัง

    id ที่ใช้ไม่ได้ (ปิดอยู่ · ไม่มีสิทธิ์ · ไม่มีจริง) **ไม่ทำให้หน้าพัง** —
    ตกกลับไปเป็นฟอร์มพิมพ์อิสระ ซึ่งเป็นสิ่งที่ผู้ใช้ต้องการอยู่แล้ว
    การขึ้นหน้า error เพราะลิงก์เก่าคือการลงโทษคนที่บุ๊กมาร์กไว้
  */
  let picked: PickedService | null = null;
  if (service !== undefined && service !== '') {
    try {
      const res = await apiFetch(`/api/v1/catalog/${service}`);
      if (res.ok) picked = (await res.json()) as PickedService;
    } catch {
      picked = null;
    }
  }

  /*
    **โหลดตัวเลือกของโปรเจกต์ที่บริการนั้นชี้ไป ไม่ใช่โปรเจกต์แรกในรายการ**

    ฟิลด์เพิ่มเติมผูกกับคู่ (โปรเจกต์ × ประเภทงาน) · ถ้าโหลดของโปรเจกต์แรก
    แล้วบริการชี้ไปอีกโปรเจกต์ ฟอร์มจะถามคำถามผิดชุด แล้วเซิร์ฟเวอร์ปฏิเสธ
    ด้วยข้อความว่า "ยังไม่ได้กรอก: ผลกระทบ, ความเร่งด่วน" **ทั้งที่ไม่มีช่อง
    ให้กรอกอยู่บนหน้าจอเลย** — เจอตอนลองใช้จริง ไม่ใช่จากเทสต์

    ข้อความที่บอกให้กรอกสิ่งที่ไม่มีให้กรอก คือทางตันที่ผู้ใช้ออกเองไม่ได้
  */
  const optionsPath =
    picked === null
      ? '/api/v1/work-items/options'
      : `/api/v1/work-items/options?project=${encodeURIComponent(picked.projectKey)}`;

  let options: Options | null = null;
  try {
    const res = await apiFetch(optionsPath);
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
      <h1 className="page-title">{picked === null ? 'แจ้งปัญหา' : picked.name}</h1>
      <p className="page-sub">
        {picked === null
          ? 'เล่าให้ฟังว่าเกิดอะไรขึ้น ทีมไอทีจะได้รับเรื่องทันทีและเริ่มจับเวลาตามข้อตกลงบริการ'
          : 'กรอกรายละเอียดเพิ่มเติม แล้วทีมที่รับผิดชอบจะได้รับเรื่องทันที'}
      </p>
      <ReportForm apiBase={API} options={options} {...(picked === null ? {} : { picked })} />
    </section>
  );
}
