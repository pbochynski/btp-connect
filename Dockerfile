# Stage 1: Build
FROM node:18 AS build
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .

# Stage 2: Production image
FROM node:18-alpine
WORKDIR /usr/src/app
COPY --from=build /usr/src/app/package*.json ./
COPY --from=build /usr/src/app/*.js ./
RUN npm install --production
EXPOSE 3000
CMD ["npm", "start"]
