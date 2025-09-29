# Multi-stage Dockerfile for Pathology Slide Viewer
# Optimized for cross-platform deployment with VIPS support

# Build stage - Install dependencies and build tools
FROM ubuntu:22.04 as builder

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    ca-certificates \
    build-essential \
    pkg-config \
    libvips-dev \
    libvips-tools \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 18
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production && npm cache clean --force

# Production stage - Minimal runtime image
FROM ubuntu:22.04 as production

# Install runtime dependencies only
RUN apt-get update && apt-get install -y \
    libvips42 \
    libvips-tools \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js runtime
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create app user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Set working directory
WORKDIR /app

# Copy Node.js dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY . .

# Copy and make entrypoint script executable
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create necessary directories
RUN mkdir -p public/slides public/dzi temp uploads \
    && chown -R appuser:appuser /app

# Set environment variables for VIPS optimization
ENV VIPS_CONCURRENCY=8 \
    VIPS_NTHR=8 \
    VIPS_CACHE_MAX_MEMORY=536870912 \
    VIPS_PROGRESS=1 \
    VIPS_NOVECTOR=0 \
    NODE_ENV=production

# Expose ports
EXPOSE 3102 3003 3001

# Switch to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3102/api/health || exit 1

# Set entrypoint
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Default command
CMD ["npm", "start"]
