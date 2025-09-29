#!/bin/bash
# Pathology Slide Viewer - Container Deployment Script
# Supports both Windows (Git Bash/WSL) and Linux deployment

set -e

# Configuration
PROJECT_NAME="pathology-slide-viewer"
COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed. Please install Docker Desktop or Docker Engine."
        exit 1
    fi
    
    # Check Docker Compose
    if ! docker compose version &> /dev/null; then
        error "Docker Compose is not available. Please update Docker to a newer version."
        exit 1
    fi
    
    # Check available resources
    AVAILABLE_MEMORY=$(docker system info --format '{{.MemTotal}}' 2>/dev/null || echo "0")
    if [ "$AVAILABLE_MEMORY" -lt 4000000000 ]; then
        warning "Less than 4GB RAM available for Docker. Performance may be limited."
    fi
    
    success "Prerequisites check passed"
}

# Detect platform
detect_platform() {
    if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]] || [[ -n "$WINDIR" ]]; then
        PLATFORM="windows"
        DATA_PATH="$(pwd)/data"
    else
        PLATFORM="linux"
        DATA_PATH="/opt/pathology/data"
    fi
    
    log "Detected platform: $PLATFORM"
}

# Setup directories
setup_directories() {
    log "Setting up data directories..."
    
    if [ "$PLATFORM" == "windows" ]; then
        # Windows paths
        mkdir -p "data/slides" "data/dzi" "data/temp"
        success "Created Windows data directories"
    else
        # Linux paths
        sudo mkdir -p "$DATA_PATH/slides" "$DATA_PATH/dzi" "$DATA_PATH/temp"
        sudo chown -R $USER:$USER "$DATA_PATH"
        chmod -R 755 "$DATA_PATH"
        success "Created Linux data directories with proper permissions"
    fi
}

# Create environment file if it doesn't exist
setup_environment() {
    if [ ! -f "$ENV_FILE" ]; then
        log "Creating environment file..."
        cat > "$ENV_FILE" << EOF
# Pathology Slide Viewer - Container Configuration
NODE_MODE=server
NODE_ENV=production
PORT=3102
GUI_PORT=3003
CONVERSION_PORT=3001

# Storage paths
SLIDES_DIR=/app/data/slides
DZI_DIR=/app/data/dzi
TEMP_DIR=/app/data/temp

# Performance optimizations
MAX_CONCURRENT=8
VIPS_CONCURRENCY=8
VIPS_CACHE_MAX_MEMORY=1073741824
EOF
        success "Environment file created"
    else
        success "Environment file already exists"
    fi
}

# Build containers
build_containers() {
    log "Building Docker containers..."
    
    # Pull base images first
    docker pull ubuntu:22.04
    docker pull node:18-alpine
    
    # Build the application
    docker compose build --no-cache
    
    success "Containers built successfully"
}

# Deploy services
deploy_services() {
    log "Deploying services..."
    
    # Start services in background
    docker compose up -d
    
    # Wait for services to be ready
    log "Waiting for services to start..."
    sleep 10
    
    # Check service health
    if docker compose ps | grep -q "Up"; then
        success "Services deployed successfully"
        
        # Show service status
        echo ""
        log "Service Status:"
        docker compose ps
        
        echo ""
        log "Access URLs:"
        echo "  🌐 Web Interface: http://localhost:3102"
        echo "  🔧 GUI Interface: http://localhost:3003"
        echo "  📊 API Health: http://localhost:3102/api/health"
        
    else
        error "Some services failed to start"
        docker compose logs
        exit 1
    fi
}

# Show logs
show_logs() {
    log "Recent logs:"
    docker compose logs --tail=20
    
    echo ""
    log "To follow logs in real-time, run:"
    echo "  docker compose logs -f"
}

# Cleanup function
cleanup() {
    log "Stopping services..."
    docker compose down
    success "Services stopped"
}

# Main deployment function
deploy() {
    log "Starting Pathology Slide Viewer deployment..."
    
    detect_platform
    check_prerequisites
    setup_directories
    setup_environment
    build_containers
    deploy_services
    show_logs
    
    success "Deployment completed successfully!"
    echo ""
    log "Next steps:"
    echo "  1. Place slide files in: $DATA_PATH/slides/"
    echo "  2. Access web interface at: http://localhost:3102"
    echo "  3. Monitor logs with: docker compose logs -f"
    echo "  4. Stop services with: docker compose down"
}

# Script usage
usage() {
    echo "Pathology Slide Viewer - Container Deployment"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  deploy    Deploy all services (default)"
    echo "  build     Build containers only"
    echo "  start     Start existing containers"
    echo "  stop      Stop running containers"
    echo "  restart   Restart all services"
    echo "  logs      Show service logs"
    echo "  status    Show service status"
    echo "  clean     Remove containers and images"
    echo "  help      Show this help message"
}

# Handle script arguments
case "${1:-deploy}" in
    "deploy")
        deploy
        ;;
    "build")
        check_prerequisites
        build_containers
        ;;
    "start")
        log "Starting services..."
        docker compose up -d
        success "Services started"
        ;;
    "stop")
        cleanup
        ;;
    "restart")
        log "Restarting services..."
        docker compose restart
        success "Services restarted"
        ;;
    "logs")
        docker compose logs -f
        ;;
    "status")
        docker compose ps
        ;;
    "clean")
        log "Cleaning up containers and images..."
        docker compose down --rmi all --volumes
        success "Cleanup completed"
        ;;
    "help"|"-h"|"--help")
        usage
        ;;
    *)
        error "Unknown command: $1"
        usage
        exit 1
        ;;
esac
