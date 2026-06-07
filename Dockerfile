FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV APP_PORT=5173
ENV DIST_DIR=/app/dist

COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server

EXPOSE 5173
CMD ["npm", "run", "start"]
