FROM node:22-slim
WORKDIR /app
# ffmpeg une los fragmentos de video de !video en un MP4 (y genera miniaturas).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production AUTH_DIR=/app/auth
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
VOLUME /app/auth
CMD ["node", "src/main.js"]
