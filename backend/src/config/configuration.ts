// app.* keys live in app.config.ts (registerAs 'app').
// database.* keys live in database.config.ts (registerAs 'database').
export default () => ({
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshExpiresInDays: parseInt(process.env.JWT_REFRESH_EXPIRES_DAYS || '7', 10),
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    /** Legacy JWT secret — Dashboard → API → JWT Settings (for edge function auth). */
    jwtSecret: process.env.SUPABASE_JWT_SECRET,
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY,
  },
});
