FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY content ./content
COPY audio ./audio

ENV NODE_ENV=production

CMD ["node", "src/bot.js"]
