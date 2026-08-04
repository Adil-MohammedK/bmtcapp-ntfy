FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY package.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm install --omit=dev -w @bmtc-tracker/api
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "@bmtc-tracker/api"]
