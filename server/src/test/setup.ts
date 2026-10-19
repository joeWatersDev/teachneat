process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ??= 'test-session-secret-do-not-use-in-prod';
process.env.TOKEN_ENCRYPTION_KEY ??= 'test-encryption-key-do-not-use-in-prod';
process.env.GOOGLE_CLIENT_ID ??= 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI ??= 'http://localhost:3001/api/auth/google/callback';
process.env.CLIENT_ORIGIN ??= 'http://localhost:5173';
