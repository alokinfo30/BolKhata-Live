FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev
COPY . .
RUN npm run build
EXPOSE 8080
ENV PORT=8080
CMD ["npx", "tsx", "server.ts"]
