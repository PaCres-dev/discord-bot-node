FROM node:22-slim
WORKDIR /app
# ffmpeg une audio y video (!video, !youtube) y genera miniaturas.
# yt-dlp descarga de YouTube (!youtube) usando la sesión guardada con !ytcookies; usa node para los desafíos JS.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
  && pip3 install --no-cache-dir --break-system-packages "yt-dlp[default]" \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production AUTH_DIR=/app/auth
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
VOLUME /app/auth
CMD ["node", "src/main.js"]
