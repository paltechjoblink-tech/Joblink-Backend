const express = require('express');
const router = express.Router();
const { verifyGoogleEmail, sendVerificationCode, verifyCode } = require('../config/emailVerification');
const { createClient } = require('@supabase/supabase-js');
const { OAuth2Client } = require('google-auth-library');

const getSupabaseAdminClient = () => {
  const supabaseUrl = process.env.SUPABASE_URL || 'https://cvsifkizrofmorvfmwmq.supabase.co';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseServiceKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  }
  return createClient(supabaseUrl, supabaseServiceKey);
};

const emailAlreadyRegistered = async (email) => {
  const normalizedEmail = String(email).toLowerCase();
  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) return false;

  const { data: userList, error: userListError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (userListError) {
    throw userListError;
  }

  const existingAuthUser = userList?.users?.find((user) => user.email?.toLowerCase() === normalizedEmail) || null;
  if (existingAuthUser) {
    return true;
  }

  const { data: existingProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  return !!existingProfile;
};

/**
 * POST /api/auth/verify-google-email
 * Check if email format is valid and if already verified
 */
router.post('/verify-google-email', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required',
        valid: false,
        exists: false,
        alreadyRegistered: false,
        verified: false
      });
    }

    const normalizedEmail = String(email).toLowerCase();

    if (!normalizedEmail.endsWith('@gmail.com')) {
      return res.json({
        valid: false,
        exists: false,
        alreadyRegistered: false,
        verified: false,
        email,
        message: 'Only Gmail addresses are allowed'
      });
    }

    const result = await verifyGoogleEmail(email);
    return res.json({
      ...result,
      valid: result.exists === true,
      exists: result.exists === true,
      alreadyRegistered: false
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      error: 'Email verification failed',
      valid: false,
      exists: false,
      alreadyRegistered: false,
      verified: false,
      message: error.message
    });
  }
});

/**
 * POST /api/auth/send-verification-code
 * Send a verification code to the user's email
 * 
 * Request body:
 * {
 *   email: "user@gmail.com"
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   message: string,
 *   expiresIn: string
 * }
 */
router.post('/send-verification-code', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const normalizedEmail = String(email).toLowerCase();
    const result = await sendVerificationCode(email);
    return res.json(result);

  } catch (error) {
    console.error('Send verification code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send verification code'
    });
  }
});

/**
 * POST /api/auth/verify-code
 * Verify the code entered by user
 * 
 * Request body:
 * {
 *   email: "user@gmail.com",
 *   code: "123456"
 * }
 * 
 * Response:
 * {
 *   verified: boolean,
 *   message: string
 * }
 */
router.post('/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        verified: false,
        message: 'Email and code are required'
      });
    }

    const result = await verifyCode(email, code);
    
    // Use 400 for verification failures, 200 for success
    const statusCode = result.verified ? 200 : 400;
    return res.status(statusCode).json(result);

  } catch (error) {
    console.error('Verify code error:', error);
    res.status(500).json({
      verified: false,
      message: 'Verification failed'
    });
  }
});

/**
 * POST /api/auth/google-signin
 * Handle Google One Tap sign-in
 * Verifies Google token and creates Supabase session
 */
router.post('/google-signin', async (req, res) => {
  try {
    const { token, email, name } = req.body;

    if (!token) {
      return res.status(400).json({
        error: 'Google token is required',
        message: 'Missing token'
      });
    }

    console.log('🔐 Verifying Google token for:', email);

    // Verify Google token
    const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || '423078146697-a07lt64l19fac1h21k7opdd4s8teog9r.apps.googleusercontent.com');
    
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID || '423078146697-a07lt64l19fac1h21k7opdd4s8teog9r.apps.googleusercontent.com',
      });
      payload = ticket.getPayload();
      console.log('✅ Google token verified for:', payload.email);
    } catch (tokenError) {
      console.error('❌ Google token verification failed:', tokenError.message);
      return res.status(401).json({
        error: 'Invalid Google token',
        message: 'Token verification failed'
      });
    }

    // Initialize Supabase admin client
    const supabaseUrl = process.env.SUPABASE_URL || 'https://cvsifkizrofmorvfmwmq.supabase.co';
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseServiceKey) {
      console.error('⚠️ SUPABASE_SERVICE_ROLE_KEY not set in environment');
      return res.status(500).json({
        error: 'Server configuration error',
        message: 'Missing Supabase service role key'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if user exists
    const { data: userList, error: userListError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
    if (userListError) {
      console.error('❌ Database query error:', userListError);
      return res.status(500).json({
        error: 'Database error',
        message: 'Failed to check existing user'
      });
    }

    const existingUser = userList?.users?.find((user) => user.email?.toLowerCase() === payload.email?.toLowerCase()) || null;

    // Create or sign in user via Supabase
    let user;
    if (!existingUser) {
      console.log('📝 Creating new user:', payload.email);
      
      // Use Supabase admin API to create user
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: payload.email,
        user_metadata: {
          name: payload.name || name,
          displayName: payload.name || name,
          avatar_url: payload.picture,
          provider: 'google',
        },
        email_confirm: true,
      });

      if (createError) {
        console.error('❌ User creation error:', createError);
        return res.status(500).json({
          error: 'Failed to create user',
          message: createError.message
        });
      }

      user = newUser.user;
      console.log('✅ New user created:', user.id);
    } else {
      console.log('👤 User exists, fetching details...');
      
      // Get user details
      const { data: userData, error: getUserError } = await supabase.auth.admin.getUserById(existingUser.id);
      
      if (getUserError) {
        console.error('❌ Error fetching user:', getUserError);
        return res.status(500).json({
          error: 'Failed to fetch user',
          message: getUserError.message
        });
      }

      user = userData.user;
    }

    // Generate session tokens
    const { data: sessionData, error: sessionError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
      options: {
        redirectTo: process.env.REDIRECT_URL || 'http://localhost:3000/auth/callback',
      }
    });

    if (sessionError) {
      console.error('❌ Session generation error:', sessionError);
      // Create session using refresh token flow instead
      const { data: { session }, error: refreshError } = await supabase.auth.refreshSession({
        refresh_token: user.refresh_token,
      });

      if (refreshError || !session) {
        // Last resort: return user data and let frontend handle it
        console.warn('⚠️ Could not create session, returning user data');
        return res.json({
          user: user,
          message: 'User authenticated but session creation pending'
        });
      }

      return res.json({
        user: user,
        session: session,
        message: 'User signed in successfully'
      });
    }

    // Extract session from link
    const link = sessionData.verification_link;
    const hashPart = new URL(link).hash.substring(1);
    const params = new URLSearchParams(hashPart);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');

    if (!access_token || !refresh_token) {
      console.error('❌ Failed to extract tokens from link');
      return res.status(500).json({
        error: 'Session creation failed',
        message: 'Could not extract session tokens'
      });
    }

    console.log('✅ Session tokens generated successfully');

    res.json({
      user: {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata,
      },
      session: {
        access_token: access_token,
        refresh_token: refresh_token,
        token_type: 'bearer',
        expires_in: 3600,
      },
      message: 'User signed in successfully'
    });

  } catch (error) {
    console.error('❌ Google sign-in error:', error);
    res.status(500).json({
      error: 'Google sign-in failed',
      message: error.message
    });
  }
});

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({ status: 'Auth service is running' });
});

/**
 * GET /api/auth/avatar-proxy
 * Proxy an external avatar URL so mobile WebViews can load images that
 * may otherwise be blocked or redirected. This endpoint restricts hosts
 * to a safe allowlist to reduce SSRF risk.
 * Query params: url (required)
 */
router.get('/avatar-proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid url' });
    }

    // Only allow common avatar hosts (extend as necessary)
    const allowedHosts = [
      'googleusercontent.com',
      'gstatic.com',
      'gravatar.com',
      'cloudflareusercontent.com'
    ];

    const hostAllowed = allowedHosts.some(h => parsed.hostname.endsWith(h));
    if (!hostAllowed) return res.status(400).json({ error: 'Host not allowed' });

    // Fetch image
    const axios = require('axios');
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
    const contentType = response.headers['content-type'] || 'image/jpeg';

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(response.data);
  } catch (error) {
    console.error('Avatar proxy error:', error?.message || error);
    return res.status(500).json({ error: 'Failed to proxy avatar' });
  }
});

module.exports = router;
