'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Checkbox, Field, Input, LinkButton, Select, Table } from '@itsm/ui';

interface Item {
  id: string;
  name: string;
  description: string | null;
  projectKey: string;
  issueTypeName: string;
  priorityName: string | null;
  isActive: boolean;
}

interface Group {
  id: string;
  name: string;
  items: Item[];
}

interface Options {
  projects: Array<{ key: string; name: string }>;
  issueTypes: Array<{ name: string }>;
  priorities: Array<{ rank: number; name: string }>;
}

const NAME_MAX = 200;

/**
 * ตั้งค่ารายการบริการ
 *
 * **ไม่มีปุ่มลบบริการ** และไม่ใช่เพราะยังไม่ได้ทำ — เรื่องที่แจ้งผ่านบริการนี้
 * ไปแล้วชี้มาที่แถวนี้ · การลบจะทำให้เรื่องเก่าตอบไม่ได้ว่ามาจากบริการไหน
 * "เลิกใช้" จึงเป็นทางเดียวที่มี และเรื่องเก่ายังตอบได้อยู่
 *
 * หมวดลบได้ **เฉพาะตอนที่ไม่เหลือบริการอยู่ข้างใน** — เซิร์ฟเวอร์ปฏิเสธเองและ
 * บอกจำนวนที่เหลือมาด้วย เพราะนั่นคือสิ่งเดียวที่ต้องรู้เพื่อตัดสินใจต่อ
 */
export function CatalogAdmin({ apiBase }: { apiBase: string }): ReactNode {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [catName, setCatName] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemCat, setItemCat] = useState('');
  const [itemProject, setItemProject] = useState('');
  const [itemType, setItemType] = useState('');
  const [itemPriority, setItemPriority] = useState('');

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/catalog`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'ต้องเป็นผู้ดูแลระบบจึงจะตั้งค่าส่วนนี้ได้'
            : `โหลดรายการไม่สำเร็จ (HTTP ${String(res.status)})`,
        );
        setGroups([]);
        return;
      }
      setGroups(((await res.json()) as { groups: Group[] }).groups);
      setError(null);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      setGroups([]);
    }
  }, [apiBase]);

  /*
    **ชนิดงานผูกกับโปรเจกต์ ไม่ใช่รายการกลาง**

    ถ้าไม่โหลดใหม่ตอนเปลี่ยนโปรเจกต์ หน้าจอจะยอมให้ประกอบคู่ที่ไม่มีอยู่จริง
    (เช่น SD × Bug) แล้วเซิร์ฟเวอร์ปฏิเสธตอนกดบันทึก — ซึ่งเป็นการโยน
    ความผิดพลาดของเราไปให้ผู้ดูแล · แย่กว่านั้นคือรอบแรกไม่มีการตรวจเลย
    บริการที่พังจึงถูกสร้างสำเร็จ แล้วไประเบิดใส่ผู้แจ้งแทน
  */
  const loadOptions = useCallback(
    async (projectKey: string): Promise<void> => {
      try {
        const q = projectKey === '' ? '' : `?project=${encodeURIComponent(projectKey)}`;
        const res = await fetch(`${apiBase}/api/v1/work-items/options${q}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (res.ok) {
          const o = (await res.json()) as Options;
          setOptions(o);
          // ชนิดงานที่เลือกไว้อาจใช้กับโปรเจกต์ใหม่ไม่ได้ — ล้างทิ้งดีกว่าปล่อยให้ผิด
          setItemType((cur) => (o.issueTypes.some((t) => t.name === cur) ? cur : ''));
        }
      } catch {
        // เลือกปลายทางไม่ได้ ไม่ควรทำให้ดูรายการที่มีอยู่ไม่ได้
      }
    },
    [apiBase],
  );

  useEffect(() => {
    void load();
    void loadOptions('');
  }, [load, loadOptions]);

  async function post(path: string, body: unknown, ok: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/catalog${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(d?.message ?? `ทำรายการไม่สำเร็จ (HTTP ${String(res.status)})`);
        return false;
      }
      setNotice(ok);
      await load();
      return true;
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeCategory(g: Group): Promise<void> {
    if (!window.confirm(`ลบหมวด "${g.name}" ?`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/catalog/categories/${g.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { message?: string } | null;
        // เซิร์ฟเวอร์บอกมาว่าเหลืออยู่กี่รายการ — แสดงคำนั้นตรง ๆ
        setError(d?.message ?? `ลบไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      setNotice(`ลบหมวด "${g.name}" แล้ว`);
      await load();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  const allItems = (groups ?? []).flatMap((g) => g.items.map((i) => ({ ...i, group: g.name })));

  return (
    <div className="admin">
      {error === null ? null : <Alert tone="error">{error}</Alert>}
      {notice === null ? null : <Alert tone="success">{notice}</Alert>}

      <section className="admin-add">
        <h2 className="detail-section-title">เพิ่มหมวด</h2>
        <form
          className="admin-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              if (await post('/categories', { name: catName }, `เพิ่มหมวด "${catName}" แล้ว`)) {
                setCatName('');
              }
            })();
          }}
        >
          <Field label="ชื่อหมวด" htmlFor="cat-name">
            <Input id="cat-name" value={catName} onChange={setCatName} maxLength={128} />
          </Field>
          <Button variant="primary" type="submit" disabled={busy || catName.trim() === ''}>
            เพิ่มหมวด
          </Button>
        </form>
      </section>

      <section className="admin-add">
        <h2 className="detail-section-title detail-section-gap">เพิ่มบริการ</h2>
        <form
          className="admin-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              const done = await post(
                '/items',
                {
                  categoryId: itemCat,
                  name: itemName,
                  description: itemDesc,
                  // ส่งคีย์และชื่อ — id ภายในหน้าจอนี้ไม่มีและไม่ควรต้องมี
                  projectKey: itemProject,
                  issueTypeName: itemType,
                  ...(itemPriority === '' ? {} : { priorityRank: Number(itemPriority) }),
                },
                `เพิ่มบริการ "${itemName}" แล้ว`,
              );
              if (done) {
                setItemName('');
                setItemDesc('');
              }
            })();
          }}
        >
          <Field label="ชื่อบริการ (ภาษาที่ผู้แจ้งอ่านแล้วรู้ว่าใช่)" htmlFor="it-name">
            <Input id="it-name" value={itemName} onChange={setItemName} maxLength={NAME_MAX} />
          </Field>
          <Field label="ใช้ตอนไหน" htmlFor="it-desc">
            <Input id="it-desc" value={itemDesc} onChange={setItemDesc} maxLength={300} />
          </Field>
          <Field label="หมวด" htmlFor="it-cat">
            <Select
              id="it-cat"
              value={itemCat}
              onChange={setItemCat}
              placeholder="เลือกหมวด"
              options={(groups ?? []).map((g) => ({ value: g.id, label: g.name }))}
            />
          </Field>
          <Field label="ลงที่โปรเจกต์" htmlFor="it-proj">
            <Select
              id="it-proj"
              value={itemProject}
              onChange={(v) => {
                setItemProject(v);
                void loadOptions(v);
              }}
              placeholder="เลือกโปรเจกต์"
              options={(options?.projects ?? []).map((p) => ({ value: p.key, label: p.name }))}
            />
          </Field>
          {/* ชนิดงานที่แสดงคือชนิดที่โปรเจกต์ที่เลือกไว้ผูก workflow ไว้จริงเท่านั้น */}
          <Field label="เป็นงานประเภท" htmlFor="it-type">
            <Select
              id="it-type"
              value={itemType}
              onChange={setItemType}
              placeholder="เลือกประเภทงาน"
              options={(options?.issueTypes ?? []).map((t) => ({ value: t.name, label: t.name }))}
            />
          </Field>
          <Field label="ความสำคัญตั้งต้น (ไม่บังคับ)" htmlFor="it-prio">
            <Select
              id="it-prio"
              value={itemPriority}
              onChange={setItemPriority}
              placeholder="ตามปกติ"
              options={(options?.priorities ?? []).map((p) => ({
                value: String(p.rank),
                label: p.name,
              }))}
            />
          </Field>
          <Button
            variant="primary"
            type="submit"
            disabled={
              busy || itemName.trim() === '' || itemCat === '' || itemProject === '' || itemType === ''
            }
          >
            เพิ่มบริการ
          </Button>
        </form>
      </section>

      <h2 className="detail-section-title detail-section-gap">
        บริการทั้งหมด {allItems.length} รายการ
      </h2>
      <Table
        columns={['บริการ', 'หมวด', 'ลงที่', 'ประเภทงาน', 'ความสำคัญ', 'เปิดใช้']}
        rowCount={allItems.length}
        empty="ยังไม่มีบริการ — เพิ่มหมวดก่อน แล้วจึงเพิ่มบริการเข้าไป"
      >
        {allItems.map((i) => (
          <tr key={i.id} data-inactive={i.isActive ? undefined : 'true'}>
            <td>
              {i.name}
              {i.description === null ? null : (
                <span className="cfg-implied"> · {i.description}</span>
              )}
            </td>
            <td>{i.group}</td>
            <td>{i.projectKey}</td>
            <td>{i.issueTypeName}</td>
            <td>{i.priorityName ?? '—'}</td>
            <td>
              {/* เปิด/ปิด ไม่ใช่ลบ — เรื่องเก่าต้องยังตอบได้ว่ามาจากบริการไหน */}
              <Checkbox
                checked={i.isActive}
                label={`เปิดใช้ ${i.name}`}
                onChange={(v) => {
                  void post(`/items/${i.id}/active`, { isActive: v }, v ? 'เปิดใช้แล้ว' : 'เลิกใช้แล้ว');
                }}
              />
            </td>
          </tr>
        ))}
      </Table>

      <h2 className="detail-section-title detail-section-gap">หมวด</h2>
      <Table
        columns={['หมวด', { label: 'บริการข้างใน', align: 'end' }, { label: '', width: '96px' }]}
        rowCount={(groups ?? []).length}
        empty="ยังไม่มีหมวด"
      >
        {(groups ?? []).map((g) => (
          <tr key={g.id}>
            <td>{g.name}</td>
            <td data-align="end">{g.items.length}</td>
            <td>
              <LinkButton
                tone="danger"
                disabled={busy}
                onClick={() => {
                  void removeCategory(g);
                }}
              >
                ลบหมวด
              </LinkButton>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
