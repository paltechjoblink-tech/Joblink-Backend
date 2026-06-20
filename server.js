const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Load backend-specific .env first, then root .env as fallback.
const backendEnvPath = path.resolve(__dirname, '.env');
const rootEnvPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: backendEnvPath });
dotenv.config({ path: rootEnvPath, override: false });
console.log(`✅ Loaded env files: ${backendEnvPath}${process.env.PORT ? '' : ` (root fallback ${rootEnvPath} may be used)`}`);

// Import routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Backend server is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// Start server
const PORT = process.env.BACKEND_PORT || process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Joblink Backend running on port ${PORT}`);
  console.log(`📧 Email verification endpoint: POST /api/auth/verify-google-email`);
  console.log(`🔒 Admin endpoints mounted at: /api/admin`);
});

module.exports = app;
