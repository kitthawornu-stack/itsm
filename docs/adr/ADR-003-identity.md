# ADR-003 — Keycloak หรือ In-house Auth

**สถานะ:** 🔴 **ต้องตัดสิน** — บล็อก Phase 0 · **วันที่:** 2569-08-24 · **เจ้าของ:** Tech Lead

> นี่คือ ADR เดียวที่ยังไม่มีคำตอบ ต้องตัดสินภายในสัปดาห์ที่ 1
> เพราะโมดูล `identity` เป็นสิ่งแรกที่ต้องสร้างและทุกโมดูลพึ่งพา

## บริบท

ต้องรองรับ SAML 2.0, OIDC, LDAP/AD sync, SCIM (เฟส 5) และ MFA
แต่โหมด on-prem ส่งมอบเป็น Docker Compose bundle ที่ลูกค้าไทยต้องติดตั้งเอง —
ทุก container ที่เพิ่มเข้าไปคือภาระที่ลูกค้าต้องดูแล

## ทางเลือก

### A · Keycloak

**ดี** — ได้ SAML/OIDC/LDAP/MFA/SCIM ครบตั้งแต่วันแรก · ผ่านการตรวจสอบความปลอดภัยมาแล้ว ·
ไม่ต้องเขียน token lifecycle เอง · admin console พร้อมใช้

**ร้าย** — เพิ่ม container + ฐานข้อมูลของตัวเองใน on-prem bundle · ทีมต้องเรียนรู้ Keycloak
(learning curve จริงประมาณ 2 สัปดาห์) · การ sync ผู้ใช้ระหว่าง Keycloak กับตาราง `user` ของเรา
เป็นงานที่ต้องดูแลตลอดไป · อัปเกรด Keycloak เป็น breaking change บ่อย

### B · In-house (JWT + LDAP connector + SAML library)

**ดี** — bundle เล็ก ควบคุมได้ 100% · ตาราง `user` เป็นแหล่งความจริงเดียว ไม่มีปัญหา sync ·
ทีมเข้าใจโค้ดทั้งหมด

**ร้าย** — ต้องเขียนเองและ **ต้องเขียนให้ถูก**: token rotation, refresh token reuse detection,
session revocation, password reset ที่ไม่รั่วข้อมูล, rate limiting, MFA · SAML SP เป็นจุดที่
ทำผิดแล้วเกิดช่องโหว่ร้ายแรงได้ง่ายมาก · ประเมิน 4–6 สัปดาห์ของ backend หนึ่งคน
ซึ่งไม่มีอยู่ในแผนเฟส 0

## แนวทางที่เสนอ

**Keycloak** — เหตุผลหลักคือ SAML SP ที่เขียนเองเป็นความเสี่ยงด้านความปลอดภัยที่ไม่คุ้มรับ
สำหรับทีม 9 คน และเป้าหมาย OWASP ASVS L2 ในเฟส 5

**เงื่อนไขที่ต้องทำถ้าเลือก Keycloak:**
- ห่อ Keycloak ด้วย `identity` module ของเราเสมอ — โค้ดส่วนอื่นไม่รู้จัก Keycloak เลย
  เพื่อให้เปลี่ยนใจทีหลังได้โดยแตะที่เดียว
- ตาราง `user` ของเราเก็บ profile และสิทธิ์ · Keycloak เก็บแค่ credential และ federation
- ทำ just-in-time provisioning — ผู้ใช้ถูกสร้างในตาราง `user` ครั้งแรกที่ล็อกอินสำเร็จ
- เขียน runbook การอัปเกรด Keycloak ตั้งแต่ก่อนส่งมอบ on-prem ครั้งแรก

## ต้องตัดสินโดย

Tech Lead + PO ภายในสัปดาห์ที่ 1 หลังประเมินว่าลูกค้ารายแรกใช้ AD/LDAP อยู่หรือไม่
(ถ้าไม่ใช้ ความคุ้มค่าของ Keycloak ลดลงมาก)
