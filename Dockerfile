# ==============================================================================
# Mathsy Meet Control-Plane — Production Multi-Stage Dockerfile
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build stage (compile frontend assets and backend bundle)
# ------------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install all dependencies (including devDependencies required for tsc, vite, esbuild)
COPY package.json package-lock.json ./
RUN npm ci

# Frontend build-time configuration arguments (Vite client bundles only)
# Backend runtime secrets (JWT_SECRET, etc.) MUST NEVER be provided as build args!
ARG VITE_APP_NAME="Mathsy Meet"
ARG VITE_API_BASE_URL="/api"
ARG VITE_MEDIASOUP_SERVER_URL="https://rtc.mathsy.in"
ARG VITE_SUPABASE_PROJECT_ID
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_TLDRAW_LICENSE_KEY

# Set build-time environment variables for Vite bundle embedding
ENV VITE_APP_NAME=$VITE_APP_NAME \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_MEDIASOUP_SERVER_URL=$VITE_MEDIASOUP_SERVER_URL \
    VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID \
    VITE_TLDRAW_LICENSE_KEY=$VITE_TLDRAW_LICENSE_KEY

# Copy application sources needed for compilation
COPY index.html ./
COPY tsconfig.json tsconfig.server.json ./
COPY vite.config.ts postcss.config.js tailwind.config.js ./
COPY src/ ./src/
COPY server/ ./server/

# Build frontend (dist/) and backend (dist-server/) with schema and SQL migrations
RUN npm run build:all

# ------------------------------------------------------------------------------
# Stage 2: Production runtime stage
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled frontend and backend assets from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server

# Verify compiled assets exist at target paths
RUN test -f ./dist-server/index.js && \
    test -f ./dist-server/db/schema.sql && \
    test -d ./dist-server/db/migrations

# Run as non-privileged system user for container security
USER node

# Expose default HTTP port
EXPOSE 5001

# Start compiled server entry point
CMD ["node", "dist-server/index.js"]
