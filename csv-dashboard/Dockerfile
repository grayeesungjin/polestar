FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
ENV PORT=3000
EXPOSE 3000
VOLUME ["/app/data"]
ENV DB_PATH=/app/data/data.sqlite
CMD ["node", "server.js"]
