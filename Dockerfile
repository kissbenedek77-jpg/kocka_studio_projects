FROM verapdf/cli:v1.30.2 AS verapdf

FROM node:22-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript poppler-utils openjdk-21-jre-headless ca-certificates fonts-dejavu-core fonts-urw-base35 \
    && rm -rf /var/lib/apt/lists/* \
    && test -r /usr/share/color/icc/ghostscript/srgb.icc
COPY --from=verapdf /opt/verapdf /opt/verapdf
ENV VERAPDF_BIN=/opt/verapdf/verapdf
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN PDF_SMOKE_DIAGNOSTICS=1 node scripts/pdf_smoke.cjs
CMD ["node","server/index.cjs"]
