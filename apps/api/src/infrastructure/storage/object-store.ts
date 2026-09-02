/**
 * ที่เก็บไฟล์แนบ — MinIO ใน dev, S3 ที่ไหนก็ได้ใน production
 *
 * เก็บ **เฉพาะไบต์** ส่วนความหมายทั้งหมด (ใครอัป งานไหน ชื่ออะไร) อยู่ใน MySQL
 * เหตุผล: ฐานข้อมูลคือแหล่งความจริง object storage สร้างใหม่ได้ถ้ามีไฟล์ต้นทาง
 * แต่ถ้าเก็บ metadata ไว้ที่นี่ด้วย จะมีสองแหล่งที่ไม่ตรงกันโดยไม่มีใครรู้
 *
 * ไม่ใช้ presigned URL ให้ผู้ใช้อัปตรงเข้า bucket โดยเจตนา — ไฟล์ผ่าน API
 * ทำให้ตรวจขนาดและชนิดได้จริงก่อนเก็บ · ที่ผู้ใช้ไม่เกินร้อยคน ราคาที่จ่าย
 * คือแบนด์วิดท์ของ API ซึ่งถูกกว่าการเชื่อสิ่งที่ client บอกมา
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';

export class ObjectStoreUnavailableError extends Error {
  constructor(cause: string) {
    super(`ที่เก็บไฟล์ไม่พร้อมใช้งาน: ${cause}`);
    this.name = 'ObjectStoreUnavailableError';
  }
}

const BUCKET = process.env['S3_BUCKET'] ?? 'itsm-attachments';

let client: S3Client | null = null;

function s3(): S3Client {
  client ??= new S3Client({
    region: process.env['S3_REGION'] ?? 'ap-southeast-1',
    endpoint: process.env['S3_ENDPOINT'] ?? 'http://localhost:4900',
    // MinIO ไม่รองรับ virtual-host style addressing โดยปริยาย
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env['MINIO_ROOT_USER'] ?? 'itsm',
      secretAccessKey: process.env['MINIO_ROOT_PASSWORD'] ?? 'itsm_dev_secret',
    },
  });
  return client;
}

/** สร้าง bucket ถ้ายังไม่มี — เรียกตอนเปิดเครื่อง ไม่ใช่ทุกครั้งที่อัปโหลด */
export async function ensureBucket(): Promise<void> {
  try {
    await s3().send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    try {
      await s3().send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch (err) {
      throw new ObjectStoreUnavailableError(err instanceof Error ? err.message : String(err));
    }
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  try {
    await s3().send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  } catch (err) {
    throw new ObjectStoreUnavailableError(err instanceof Error ? err.message : String(err));
  }
}

export async function getObject(key: string): Promise<Buffer> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = res.Body;
    if (body === undefined) throw new Error('ไม่มีเนื้อไฟล์');
    return Buffer.from(await body.transformToByteArray());
  } catch (err) {
    throw new ObjectStoreUnavailableError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * ลบไบต์ออกจากที่เก็บ
 *
 * แถวในฐานข้อมูลลบแยกต่างหาก และต้องลบ **หลัง** ลบไฟล์สำเร็จเท่านั้น
 * ลำดับกลับกันจะได้แถวที่ชี้ไปไฟล์ที่ยังอยู่ ซึ่งไม่มีใครตามไปลบได้อีก
 */
export async function deleteObject(key: string): Promise<void> {
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    throw new ObjectStoreUnavailableError(err instanceof Error ? err.message : String(err));
  }
}

export interface StoredObject {
  key: string;
  /** เวลาที่ไบต์ถูกเขียนลง bucket — **จำเป็นสำหรับการเก็บกวาดที่ปลอดภัย** */
  lastModified: Date | null;
  sizeBytes: number;
}

/**
 * ไล่รายการทุกวัตถุใน bucket
 *
 * มีไว้เพื่อ **ตรวจว่าไบต์ที่เก็บอยู่ตรงกับที่ฐานข้อมูลรู้จักหรือไม่** ·
 * ฐานข้อมูลคือแหล่งความจริง (ดูหัวไฟล์) แต่ถ้าไม่มีใครเทียบสองฝั่งเลย
 * ไบต์ที่ไม่มีแถวชี้ถึงจะสะสมไปเรื่อย ๆ โดยไม่มีใครรู้ว่ามันอยู่ที่นั่น
 *
 * เดินทีละหน้า — bucket ที่โตแล้วคืนทีเดียวไม่ได้ และการหยุดที่หน้าแรก
 * จะรายงานว่า "ไม่มีขยะ" ซึ่งเป็นคำตอบที่ผิดแบบเงียบที่สุด
 */
export async function listObjects(prefix = ''): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  let token: string | undefined;
  try {
    do {
      const res = await s3().send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          ...(prefix === '' ? {} : { Prefix: prefix }),
          ...(token === undefined ? {} : { ContinuationToken: token }),
        }),
      );
      for (const o of res.Contents ?? []) {
        if (o.Key === undefined) continue;
        out.push({
          key: o.Key,
          lastModified: o.LastModified ?? null,
          /*
            ตรวจชนิดจริงแทนที่จะ `Number()` — lint บอกว่า `Number()` ซ้ำซ้อน
            เพราะ SDK ประกาศ `Size` เป็น `number` · แต่ CLAUDE.md บันทึกไว้ว่า
            เคยลบ `Number()` ตามที่ lint บอก แล้วพังเพราะชนิดที่ประกาศไม่ตรงกับ
            ค่าที่คืนจริง · เขียนแบบนี้ทั้งผ่าน lint และไม่พังถ้าชนิดโกหก
          */
          sizeBytes: typeof o.Size === 'number' ? o.Size : 0,
        });
      }
      token = res.IsTruncated === true ? res.NextContinuationToken : undefined;
    } while (token !== undefined);
  } catch (err) {
    throw new ObjectStoreUnavailableError(err instanceof Error ? err.message : String(err));
  }
  return out;
}
