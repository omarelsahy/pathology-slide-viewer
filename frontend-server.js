// Simple frontend development server
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3102;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for all routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🌐 Frontend server running on http://localhost:${PORT}`);
  console.log(`📡 Backend API server default is http://localhost:3101`);
});
