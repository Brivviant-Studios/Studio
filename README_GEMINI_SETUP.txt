BRIVVIANT STUDIO — GEMINI AI BRIEF SETUP

1) Get free Gemini API key from Google AI Studio.

2) Add the key to Supabase Secrets:
   supabase secrets set GEMINI_API_KEY=YOUR_KEY --project-ref viwaclirvokwoeqqivgr

Optional model override:
   supabase secrets set GEMINI_MODEL=gemini-2.5-flash

3) Deploy the Edge Function:
   supabase functions deploy analyze-brief --no-verify-jwt --project-ref viwaclirvokwoeqqivgr

4) Make sure config.js contains:
   AI_BRIEF_ENDPOINT: 'https://viwaclirvokwoeqqivgr.supabase.co/functions/v1/analyze-brief'

5) Run supabase-real-tables-setup.sql again to add design_elements column.

Result:
- Button: شرح العناصر
- Upload PDF كراسة الشروط
- Gemini analyzes it
- The extracted required elements are saved inside the SAME card in خانة العناصر
- It does NOT create new task cards
