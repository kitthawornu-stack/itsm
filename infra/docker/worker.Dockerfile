# syntax=docker/dockerfile:1
#
# Helix Worker — คิวแจ้งเตือน SLA และการส่งอีเมล
#
# แยกภาพจาก API โดยตั้งใจ ไม่ใช่รันสอง process ในภาพเดียว
# worker ต้องรีสตาร์ตได้โดยไม่กระทบคนที่กำลังใช้หน้าเว็บ และขยายจำนวนคนละแบบกับ API

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

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

FROM deps AS build
COPY . .
RUN pnpm --filter @itsm/api exec prisma generate
RUN pnpm --filter @itsm/types build \
 && pnpm --filter @itsm/lexorank build \
 && pnpm --filter @itsm/worker build

FROM base AS runtime
ENV NODE_ENV=production

# ติดตั้ง api ด้วย เพราะ Prisma CLI และ schema อยู่ในนั้น
# worker อ่านฐานข้อมูลผ่าน client ตัวเดียวกัน
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/types/package.json packages/types/
COPY packages/lexorank/package.json packages/lexorank/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile --prod --filter @itsm/worker... --filter @itsm/api

COPY --from=build /app/packages/types/dist packages/types/dist
COPY --from=build /app/packages/lexorank/dist packages/lexorank/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma

# generate ในชั้นนี้ ไม่คัดมาจากชั้น build — pnpm วางไฟล์ไว้ในโครงของ store
# ไม่ใช่ node_modules/.prisma แบบ npm (เหตุผลเดียวกับ api.Dockerfile)
RUN cd apps/api && ./node_modules/.bin/prisma generate

USER node
WORKDIR /app/apps/worker

# worker ไม่รับคำขอ จึงไม่มี HTTP healthcheck
# การตายของมันเห็นได้จาก restart policy และจาก log — และจากงานที่ค้างในคิว
CMD ["node", "dist/main.js"]
