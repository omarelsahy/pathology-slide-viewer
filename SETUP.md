# Pathology Slide Viewer Setup Guide

## Why Automated Installation Failed

1. **Node.js Missing**: The system didn't have Node.js/npm installed
2. **Interactive Prompts**: Winget required user acceptance of Microsoft Store terms
3. **Permission Requirements**: Package managers need manual confirmation for security

## Manual Installation Steps

### 1. Install Node.js
- Go to https://nodejs.org/
- Download the **LTS version** (recommended for most users)
- Run the installer and follow the setup wizard
- **Important**: Restart your terminal/IDE after installation

### 2. Verify Installation
Open a new terminal and run:
```bash
node --version
npm --version
```

### 3. Install Dependencies
Navigate to the project directory and install packages:
```bash
cd "c:\Pathology Slide Viewer\CascadeProjects\windsurf-project"
npm install
```

### 4. Start the Server
```bash
npm start
```

### 5. Access the Application
Open your browser and go to: http://localhost:3000

## Alternative: Use Chocolatey (if you have it)
```bash
choco install nodejs
```

## Alternative: Use Scoop (if you have it)
```bash
scoop install nodejs
```

## Troubleshooting
- If npm commands don't work, restart your terminal
- Make sure you're in the correct project directory
- Check Windows PATH includes Node.js installation directory
