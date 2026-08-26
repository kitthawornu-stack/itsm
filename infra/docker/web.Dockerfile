# syntax=docker/dockerfile:1
#
# Helix Web (Next.js)
#
# ใช้ output standalone ของ Next — มันคัดเฉพาะไฟล์ที่ต้องใช้จริงมาให้
# ภาพจึงเล็กกว่าการคัด node_modules ทั้งก้อนมาก และไม่ต้องเดาว่าอะไรจำเป็น

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
# ค่านี้ถูกฝังลงไปตอน build สำหรับโค้ดที่รันบนเบราว์เซอร์
# จึงต้องส่งเข้ามาตอน build ไม่ใช่ตอนรัน
ARG API_BASE_URL=http://localhost:4400
ENV API_BASE_URL=$API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @itsm/web build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4300
# Next standalone ใช้ HOSTNAME เป็นที่อยู่ที่ bind ไม่ใช่แค่ชื่อเครื่อง
# Docker ตั้ง HOSTNAME เป็นรหัสคอนเทนเนอร์ให้เอง เซิร์ฟเวอร์จึงฟังเฉพาะชื่อนั้น
# — พอร์ตที่ map ออกไปยังใช้ได้ แต่ healthcheck ที่ยิงเข้า 127.0.0.1 ถูกปฏิเสธ
# เป็นความล้มเหลวที่ดูเหมือนแอปพัง ทั้งที่แอปทำงานปกติ
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
# ไม่มีโฟลเดอร์ public ในโปรเจกต์นี้ — ไอคอนและฟอนต์มาจาก CDN และ CSS
# ถ้าวันหนึ่งมี ให้เพิ่มบรรทัดคัดกลับมา

USER node
EXPOSE 4300

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4300/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
