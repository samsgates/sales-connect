FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN npm install
RUN npm run build:server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4380
CMD ["sh","-c","node packages/storage-postgres/dist/migrate.js && node apps/server/dist/index.js"]
