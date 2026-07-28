FROM node:18-alpine

# Install build tools for native dependencies
RUN apk add --no-cache python3 make g++ curl bash

WORKDIR /usr/src/app

# Leverage Docker cache for npm install
COPY package*.json ./
COPY .npmrc ./

# Copy the scripts folder so postinstall hooks (like patch-metro.js) can execute
COPY scripts/ ./scripts/

RUN npm install

# Copy the rest of the application code
COPY . .

EXPOSE 3000 8081