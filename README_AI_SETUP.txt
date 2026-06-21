BRIVVIANT FULL SYSTEM — OPENAI SAFE SETUP

What is included:
- Same UI and same colors.
- Login + Forgot Password.
- Admin Dashboard.
- Events / Team / Tasks / My Tasks.
- Mark as Done with Drive link.
- AI Brief PDF analysis inside the same task card.
- OpenAI Edge Function integration without exposing the API key in the frontend.

IMPORTANT SECURITY:
Never put OPENAI_API_KEY in config.js, index.html, script.js, or any public frontend file.
Put it only in Supabase Secrets:

supabase secrets set OPENAI_API_KEY=your_new_openai_key
supabase secrets set OPENAI_MODEL=gpt-4.1-mini
supabase functions deploy analyze-brief --no-verify-jwt

Then open config.js and confirm:
AI_BRIEF_ENDPOINT points to:
https://YOUR_PROJECT.supabase.co/functions/v1/analyze-brief

Default login account after running supabase-real-tables-setup.sql:
Admin:
username: Brivviant
password: Brivviant@123456

If Supabase is slow or unreachable:
The app requires Supabase for login and saving; it does not claim a local save when the server is unavailable.
