# WhatsApp Bridge Dockerfile
FROM node:20-alpine

# Install git (required by @whiskeysockets/baileys)
RUN apk add --no-cache git

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Run the bridge
CMD ["node", "index.js"]
