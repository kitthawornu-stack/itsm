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
    endpoint: process.env['S3_ENDPOINT'] ?? 'http://localhost:9000',
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
