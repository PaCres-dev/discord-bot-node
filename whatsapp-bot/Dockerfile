FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production AUTH_DIR=/app/auth
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
VOLUME /app/auth
CMD ["node", "src/main.js"]
