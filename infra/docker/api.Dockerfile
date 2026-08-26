# syntax=docker/dockerfile:1
#
# Helix API
#
# **ไม่ bundle ด้วย esbuild** — NestJS พึ่ง `design:paramtypes` ที่ TypeScript
# ปล่อยออกมาจาก `emitDecoratorMetadata` ซึ่ง esbuild ไม่ทำให้
# ผลคือ DI พังทุก provider โดยที่ build ผ่านและ error ไปโผล่ตอนรันเท่านั้น
# (เจอมาแล้วกับ Reflector ตอนทำ SessionGuard)

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---------- ติดตั้ง dependency ----------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/lexorank/package.json packages/lexorank/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile

# ---------- คอมไพล์ ----------
FROM deps AS build
COPY . .
# Prisma client ต้องสร้างก่อนคอมไพล์ — โค้ดอ้างชนิดจากมัน
RUN pnpm --filter @itsm/api exec prisma generate
RUN pnpm --filter @itsm/types build \
 && pnpm --filter @itsm/lexorank build \
 && pnpm --filter @itsm/api build

# ---------- ภาพที่ใช้จริง ----------
FROM base AS runtime
ENV NODE_ENV=production

# ติดตั้งเฉพาะ dependency ที่ production ต้องใช้ ไม่เอา devDependencies
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
COPY packages/lexorank/package.json packages/lexorank/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile --prod --filter @itsm/api...

# ผลลัพธ์ที่คอมไพล์แล้ว
COPY --from=build /app/packages/types/dist packages/types/dist
COPY --from=build /app/packages/lexorank/dist packages/lexorank/dist
COPY --from=build /app/apps/api/dist apps/api/dist
# schema กับ migration ต้องติดไปด้วย — on-prem ต้องอัปเกรดสคีมาตัวเองได้
COPY --from=build /app/apps/api/prisma apps/api/prisma

# สร้าง Prisma client ใหม่ในชั้นนี้ ไม่คัดมาจากชั้น build
#
# pnpm วางไฟล์ที่ generate ไว้ในโครงของ store (node_modules/.pnpm/...)
# ไม่ใช่ node_modules/.prisma แบบ npm · การเดาว่ามันอยู่ที่ไหนแล้วคัด
# ทำให้ build ล้มด้วยข้อความ "not found" ที่ไม่บอกว่าทำไม
#
# generate ใหม่ยังรับประกันว่า engine binary ตรงกับ platform ของภาพนี้จริง
RUN cd apps/api && ./node_modules/.bin/prisma generate

# ไม่รันด้วย root — คอนเทนเนอร์นี้รับคำขอจากภายนอก
USER node
WORKDIR /app/apps/api
EXPOSE 4400

# healthcheck ใช้พอร์ตในคอนเทนเนอร์ ไม่ใช่พอร์ตที่ map ออกไป
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4400/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
