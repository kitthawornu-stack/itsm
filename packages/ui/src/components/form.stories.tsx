/**
 * Story ของคอมโพเนนต์ฟอร์ม
 *
 * แต่ละสถานะที่คอมโพเนนต์มีจริง มี story ของตัวเอง — สถานะที่ไม่มี story
 * คือสถานะที่ไม่มีใครเคยดูในธีมมืด
 *
 * ทั้งสามตัวเป็น controlled component จึงต้องมี state จริงใน story
 * ไม่งั้นพิมพ์ไม่ได้ แล้วคนดูจะสรุปผิดว่าคอมโพเนนต์พัง
 */
import type { Meta, StoryObj } from '@storybook/react';
import { useState, type ReactElement } from 'react';

import { Field, Input, Select, Textarea, type SelectOption } from '../index';

const PROJECTS: SelectOption[] = [
  { value: 'SD', label: 'IT Service Desk' },
  { value: 'PLAT', label: 'Platform Engineering' },
];

const PRIORITIES: SelectOption[] = [
  { value: '1', label: 'P1 Critical — งานทั้งแผนกหยุด' },
  { value: '2', label: 'P2 High — ทำงานต่อได้แต่ติดขัดมาก' },
  { value: '3', label: 'P3 Medium — พอมีทางเลี่ยง' },
  { value: '4', label: 'P4 Low — ไม่เร่ง' },
];

// ============================================================
const selectMeta = {
  title: 'Form/Select',
  component: Select,
  args: { value: '', options: PROJECTS, onChange: () => undefined },
} satisfies Meta<typeof Select>;
export default selectMeta;

type SelectStory = StoryObj<typeof selectMeta>;

const Live = ({ children }: { children: (v: string, set: (s: string) => void) => ReactElement }) => {
  const [v, setV] = useState('');
  return children(v, setV);
};

export const Empty: SelectStory = {
  name: 'ยังไม่ได้เลือก',
  render: () => (
    <Live>
      {(v, set) => (
        <Select value={v} onChange={set} options={PROJECTS} placeholder="เลือกโปรเจกต์" />
      )}
    </Live>
  ),
};

export const Selected: SelectStory = {
  name: 'เลือกแล้ว',
  render: () => (
    <Live>
      {(v, set) => (
        <Select value={v === '' ? 'SD' : v} onChange={set} options={PROJECTS} />
      )}
    </Live>
  ),
};

export const Invalid: SelectStory = {
  name: 'ไม่ผ่านการตรวจ',
  render: () => (
    <Select
      value=""
      onChange={() => undefined}
      options={PROJECTS}
      placeholder="เลือกโปรเจกต์"
      invalid
      errorMessage="ต้องเลือกโปรเจกต์ก่อนจึงจะแจ้งงานได้"
      id="sel-invalid"
    />
  ),
};

export const Disabled: SelectStory = {
  name: 'ปิดใช้งาน',
  render: () => (
    <Select value="SD" onChange={() => undefined} options={PROJECTS} disabled />
  ),
};

export const LongThaiOptions: SelectStory = {
  name: 'ตัวเลือกภาษาไทยที่ยาว',
  render: () => (
    <Live>
      {(v, set) => (
        <Select value={v} onChange={set} options={PRIORITIES} placeholder="เลือกความสำคัญ" />
      )}
    </Live>
  ),
  parameters: {
    docs: {
      description: { story: 'ข้อความไทยยาวกว่าอังกฤษ 1.3 เท่า — กล่องต้องไม่บีบข้อความ' },
    },
  },
};

// ============================================================
export const TextareaEmpty: StoryObj = {
  name: 'Textarea / ว่าง',
  render: () => (
    <Live>
      {(v, set) => (
        <Textarea value={v} onChange={set} placeholder="เล่าให้ฟังหน่อยว่าเกิดอะไรขึ้น" />
      )}
    </Live>
  ),
};

export const TextareaFilled: StoryObj = {
  name: 'Textarea / มีข้อความไทยหลายบรรทัด',
  render: () => (
    <Textarea
      value={'เปลี่ยนตลับหมึกใหม่แล้วยังเหมือนเดิม\nลองสั่งพิมพ์จากเครื่องอื่นก็เป็น\nเริ่มเป็นตั้งแต่เมื่อวานบ่าย'}
      onChange={() => undefined}
      rows={4}
    />
  ),
};

export const TextareaNearLimit: StoryObj = {
  name: 'Textarea / ใกล้เต็มเพดาน',
  render: () => (
    <Textarea value={'ก'.repeat(96)} onChange={() => undefined} maxLength={100} />
  ),
  parameters: {
    docs: {
      description: { story: 'ตัวนับเปลี่ยนสีตั้งแต่เหลือ 10% ไม่ใช่ตอนเต็มแล้ว' },
    },
  },
};

export const TextareaInvalid: StoryObj = {
  name: 'Textarea / ไม่ผ่านการตรวจ',
  render: () => (
    <Textarea
      value=""
      onChange={() => undefined}
      invalid
      errorMessage="ต้องกรอกรายละเอียดอย่างน้อยหนึ่งบรรทัด"
      id="ta-invalid"
    />
  ),
};

// ============================================================
export const FieldPlain: StoryObj = {
  name: 'Field / ป้ายกำกับอย่างเดียว',
  render: () => (
    <Live>
      {(v, set) => (
        <Field label="โปรเจกต์" htmlFor="f1">
          <Select id="f1" value={v} onChange={set} options={PROJECTS} placeholder="เลือก" />
        </Field>
      )}
    </Live>
  ),
};

export const FieldRequiredWithHint: StoryObj = {
  name: 'Field / จำเป็น พร้อมคำอธิบาย',
  render: () => (
    <Live>
      {(v, set) => (
        <Field
          label="ความสำคัญ"
          htmlFor="f2"
          required
          hint="เลือกจากผลกระทบต่องาน ไม่ใช่จากความรู้สึกเร่งด่วน"
        >
          <Select id="f2" value={v} onChange={set} options={PRIORITIES} placeholder="เลือก" />
        </Field>
      )}
    </Live>
  ),
};

export const FieldStack: StoryObj = {
  name: 'Field / ฟอร์มจริงทั้งชุด',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 460 }}>
      <Field label="โปรเจกต์" htmlFor="s1" required>
        <Select id="s1" value="SD" onChange={() => undefined} options={PROJECTS} />
      </Field>
      <Field label="ความสำคัญ" htmlFor="s2" hint="ปล่อยว่างได้ถ้าไม่แน่ใจ">
        <Select id="s2" value="" onChange={() => undefined} options={PRIORITIES} placeholder="ยังไม่ระบุ" />
      </Field>
      <Field label="รายละเอียด" htmlFor="s3">
        <Textarea id="s3" value="" onChange={() => undefined} maxLength={2000} rows={5} />
      </Field>
    </div>
  ),
};

// ============================================================
export const InputNearLimit: StoryObj = {
  name: 'Input / ใกล้เต็มเพดาน',
  render: () => (
    <Live>
      {(v, set) => (
        <Input
          value={v === '' ? 'ก'.repeat(94) : v}
          onChange={set}
          maxLength={100}
          placeholder="หัวข้อ"
        />
      )}
    </Live>
  ),
  parameters: {
    docs: {
      description: {
        story: 'ตัวนับโผล่เมื่อเหลือน้อยกว่า 10% เท่านั้น — ไม่รกตอนที่ยังไม่ใกล้เต็ม',
      },
    },
  },
};

export const InputWithinLimit: StoryObj = {
  name: 'Input / ยังห่างเพดาน · ไม่มีตัวนับ',
  render: () => (
    <Input value="เครื่องพิมพ์ชั้น 3 พิมพ์ไม่ออก" onChange={() => undefined} maxLength={500} />
  ),
};

/*
  สถานะจริงที่มีอยู่ในแอป: ฟอร์มสร้างกฎอัตโนมัติมีแถวเงื่อนไขซ้ำกันหลายแถว
  ทุกแถวมี Select และ Input หน้าตาเหมือนกันหมด · คนที่ไล่ด้วยคีย์บอร์ดจะได้ยิน
  ชื่อเดียวกันซ้ำ ๆ โดยไม่รู้ว่ากำลังแก้แถวไหน

  story นี้มีไว้ให้เห็นว่าหน้าตาไม่เปลี่ยน แต่ชื่อที่อ่านออกเสียงต่างกันทุกแถว
  — เปิด accessibility panel ของ Storybook แล้วดู aria-label ของแต่ละช่อง
*/
export const RepeatedRowsNamedForScreenReader: StoryObj = {
  name: 'แถวซ้ำ ๆ · ชื่อสำหรับ screen reader',
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      {[1, 2, 3].map((n) => (
        <div key={n} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Select
            value="3"
            ariaLabel={`ฟิลด์ของเงื่อนไขข้อที่ ${String(n)}`}
            options={PRIORITIES}
            onChange={() => undefined}
          />
          <Input
            value=""
            ariaLabel={`ค่าที่เทียบของเงื่อนไขข้อที่ ${String(n)}`}
            placeholder="ค่าที่เทียบ"
            onChange={() => undefined}
          />
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'ต้องใช้ prop `ariaLabel` ไม่ใช่ `aria-label` — TypeScript ไม่ตรวจแอตทริบิวต์ที่มีขีดกลางบนคอมโพเนนต์ของเรา มันจึงหายไปเงียบ ๆ ทั้งที่ typecheck และ lint ผ่านทั้งคู่',
      },
    },
  },
};

/*
  ชนิดของช่องกรอกที่ **ไม่ใช่ข้อความล้วน**

  `date` กับ `datetime-local` เปลี่ยนทั้งหน้าตาและวิธีกรอกของเบราว์เซอร์ ·
  เดิม `date` ยังไม่มีในชนิดที่คอมโพเนนต์รับ ผลคือหน้าจอที่ต้องการมันจะเขียน
  `<input type="date">` เองนอก packages/ui แล้วสไตล์จะแยกกันเดินทันที
  (เหตุผลเดียวกับที่ `password` ถูกเพิ่มเข้ามาก่อนหน้านี้)

  **สถานะที่ไม่มี story คือสถานะที่ไม่มีใครเคยดูในธีมมืด** — ปุ่มปฏิทินของ
  เบราว์เซอร์เป็นของมันเอง ต้องเปิดดูจริงว่ายังอ่านออกทั้งสองธีม
*/
export const InputDate: StoryObj = {
  name: 'Input / วันที่',
  render: () => (
    <Live>{(v, set) => <Input type="date" value={v} onChange={set} id="story-date" />}</Live>
  ),
  parameters: {
    docs: {
      description: {
        story: 'ช่อง `date` ให้วันล้วนไม่มีเขตเวลา — ผู้เรียกต้องเติมเวลาเองก่อนส่งเป็น UTC',
      },
    },
  },
};

export const InputDateTime: StoryObj = {
  name: 'Input / วันและเวลา',
  render: () => (
    <Live>
      {(v, set) => <Input type="datetime-local" value={v} onChange={set} id="story-datetime" />}
    </Live>
  ),
};
