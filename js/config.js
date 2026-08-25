// QEnemSocial - configuração do cliente
// Substitua pelos dados do seu projeto Supabase (Settings > API).
// A anon key é pública por design do Supabase, protegida pelas policies de RLS.

const CONFIG = {
  SUPABASE_URL: "https://viyklmuxrkldctcdfnrp.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpeWtsbXV4cmtsZGN0Y2RmbnJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NzcyOTcsImV4cCI6MjEwMzI1MzI5N30.A8hAHuODQk0ZPqzTsrOsMtR-_w6wtdCh0pNE5IbMHuo",
  EDGE_FUNCTION_NAME: "enem-proxy",
  CHAT_FUNCTION_NAME: "enem-chat",
  CHAT_MESSAGE_LIMIT: 10,
  IMPORT_FUNCTION_NAME: "import-questions",
};

CONFIG.EDGE_FUNCTION_URL = `${CONFIG.SUPABASE_URL}/functions/v1/${CONFIG.EDGE_FUNCTION_NAME}`;
CONFIG.CHAT_FUNCTION_URL = `${CONFIG.SUPABASE_URL}/functions/v1/${CONFIG.CHAT_FUNCTION_NAME}`;
CONFIG.IMPORT_FUNCTION_URL = `${CONFIG.SUPABASE_URL}/functions/v1/${CONFIG.IMPORT_FUNCTION_NAME}`;
