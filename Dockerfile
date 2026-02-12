# NextHello - AI Networking Assistant
# Multi-stage build for smaller production image

# ============================================
# Stage 1: Builder
# ============================================
FROM node:22-bookworm AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files first (better layer caching)
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
# Use --no-frozen-lockfile if lockfile doesn't exist (first build)
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile; \
    else \
      pnpm install; \
    fi

# Copy source code
COPY . .

# Build TypeScript
RUN pnpm build

# Prune dev dependencies
RUN pnpm prune --prod

# ============================================
# Stage 2: Production
# ============================================
FROM node:22-bookworm-slim AS production

# Install runtime dependencies for Baileys (WhatsApp)
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Install CLI globally (makes 'nexthello' command available)
RUN npm link

# Create directories for persistent data
RUN mkdir -p /app/data/auth /app/data/media /app/data/sessions

# Allow non-root user to write data
RUN chown -R node:node /app

# Security: Run as non-root user
USER node

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose ports
# 3000 - Main HTTP server (webhooks)
# 3001 - Health check / metrics (optional)
EXPOSE 3000 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the server
CMD ["node", "dist/src/server.js"]