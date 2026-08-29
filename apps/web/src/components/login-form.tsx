'use client';

import { useState, type ReactNode } from 'react';
import { Button, Field, Input } from '@itsm/ui';

/**
 * ฟอร์มเข้าสู่ระบบ
 *
 * `credentials: 'include'` **จำเป็น** เพราะ web กับ api อยู่คนละพอร์ตในโหมด dev
 * ถ้าไม่ใส่ เบราว์เซอร์จะไม่เก็บคุกกี้เซสชันที่เซิร์ฟเวอร์ส่งมา และผู้ใช้จะเห็น
 * "เข้าสู่ระบบสำเร็จ" แล้วเด้งกลับมาหน้านี้อีกครั้งโดยไม่มี error ให้เห็น
 */
export function LoginForm({ apiBase, next }: { apiBase: string; next: string }): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        setError(data.message ?? `เข้าสู่ระบบไม่สำเร็จ (HTTP ${String(res.status)})`);
        return;
      }
      // ใช้ replace ไม่ใช่ push — กดย้อนกลับแล้วไม่ควรกลับมาหน้าล็อกอินที่ผ่านไปแล้ว
      window.location.replace(next);
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="login-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="อีเมล" htmlFor="lg-email" required>
        <Input
          id="lg-email"
          value={email}
          onChange={setEmail}
          placeholder="ชื่อ@บริษัท.co.th"
        />
      </Field>

      <Field label="รหัสผ่าน" htmlFor="lg-password" required>
        {/* ต้องเป็น input จริงชนิด password — ตัวจัดการรหัสผ่านของเบราว์เซอร์
            และการปิดบังตัวอักษรมาจาก type นี้เท่านั้น · `Input` รับ `type` แล้ว
            จึงไม่ต้องเขียน `<input>` เองอีก */}
        <Input
          id="lg-password"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={setPassword}
        />
      </Field>

      {error === null ? null : (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}

      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
      </Button>
    </form>
  );
}
