#!/bin/bash
# Docker entrypoint script for Pathology Slide Viewer
# Handles initialization and service startup

set -e

# Function to log with timestamp
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Function to check if VIPS is working
check_vips() {
    log "Checking VIPS installation..."
    if command -v vips >/dev/null 2>&1; then
        VIPS_VERSION=$(vips --version | head -n1)
        log "✅ VIPS found: $VIPS_VERSION"
        
        # Check VIPS configuration
        log "VIPS Configuration:"
        vips --vips-config | grep -E "(threads|openmp|vector)" || true
        
        return 0
    else
        log "❌ VIPS not found in PATH"
        return 1
    fi
}

# Function to optimize VIPS environment
optimize_vips() {
    log "Optimizing VIPS environment variables..."
    
    # Get system resources
    CPU_COUNT=$(nproc)
    MEMORY_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    MEMORY_MB=$((MEMORY_KB / 1024))
    
    # Calculate optimal settings
    OPTIMAL_THREADS=$((CPU_COUNT / 2))
    if [ $OPTIMAL_THREADS -lt 1 ]; then
        OPTIMAL_THREADS=1
    fi
    
    MAX_MEMORY_MB=$((MEMORY_MB * 40 / 100))  # 40% of total memory
    
    # Set VIPS environment variables if not already set
    export VIPS_CONCURRENCY=${VIPS_CONCURRENCY:-$OPTIMAL_THREADS}
    export VIPS_NTHR=${VIPS_NTHR:-$OPTIMAL_THREADS}
    export VIPS_CACHE_MAX_MEMORY=${VIPS_CACHE_MAX_MEMORY:-$((MAX_MEMORY_MB * 1024 * 1024))}
    export VIPS_PROGRESS=${VIPS_PROGRESS:-1}
    export VIPS_NOVECTOR=${VIPS_NOVECTOR:-0}
    export VIPS_WARNING=${VIPS_WARNING:-1}
    
    log "VIPS Settings:"
    log "  Threads: $VIPS_CONCURRENCY"
    log "  Max Memory: $((VIPS_CACHE_MAX_MEMORY / 1024 / 1024)) MB"
    log "  Vectorization: $([ "$VIPS_NOVECTOR" = "0" ] && echo "Enabled" || echo "Disabled")"
}

# Function to create required directories
setup_directories() {
    log "Setting up directories..."
    
    # Create data directories if they don't exist
    mkdir -p /app/data/slides
    mkdir -p /app/data/dzi
    mkdir -p /app/data/temp
    mkdir -p /app/uploads
    
    # Set permissions
    chown -R appuser:appuser /app/data /app/uploads 2>/dev/null || true
    
    log "✅ Directories created and permissions set"
}

# Function to validate configuration
validate_config() {
    log "Validating configuration..."
    
    # Check if config files exist
    if [ -f "/app/config.js" ]; then
        log "✅ Configuration file found"
    else
        log "⚠️  Configuration file not found, using defaults"
    fi
    
    # Test Node.js configuration
    if node -e "require('./config.js')" >/dev/null 2>&1; then
        log "✅ Configuration is valid"
    else
        log "❌ Configuration validation failed"
        exit 1
    fi
}

# Function to wait for dependencies
wait_for_dependencies() {
    if [ -n "$WAIT_FOR_REDIS" ]; then
        log "Waiting for Redis..."
        while ! nc -z redis 6379; do
            sleep 1
        done
        log "✅ Redis is ready"
    fi
}

# Main initialization
main() {
    log "Starting Pathology Slide Viewer container..."
    log "Container mode: ${WORKER_MODE:-server}"
    
    # System information
    log "System Information:"
    log "  OS: $(uname -a)"
    log "  CPUs: $(nproc)"
    log "  Memory: $(($(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024)) MB"
    log "  Node.js: $(node --version)"
    
    # Run initialization steps
    check_vips || exit 1
    optimize_vips
    setup_directories
    validate_config
    wait_for_dependencies
    
    log "✅ Initialization complete"
    
    # Execute the main command
    log "Starting application: $*"
    exec "$@"
}

# Run main function with all arguments
main "$@"
