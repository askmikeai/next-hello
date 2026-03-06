# WhatsApp Baileys connector Dockerfile
FROM node:20-alpine

RUN apk add --no-cache \
    ca-certificates \
    git

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Run the connector
CMD ["node", "index.js"]
