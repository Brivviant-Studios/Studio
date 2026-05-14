BRIVVIANT STUDIO EVENTS TRELLO — GEMINI VERSION

This build uses the same Brivviant UI and Supabase Studio project.

Main changes:
- AI Brief Analysis now uses Gemini through Supabase Edge Function.
- Button: شرح العناصر inside every task card.
- Upload PDF كراسة الشروط.
- Gemini extracts required design elements.
- Extracted elements are saved inside the SAME task card in خانة العناصر.
- It does NOT create new task cards automatically.

Required setup:
1) Run supabase-real-tables-setup.sql in Supabase SQL Editor.
2) Add Gemini key:
   supabase secrets set GEMINI_API_KEY=YOUR_GOOGLE_AI_STUDIO_KEY
3) Deploy Edge Function:
   supabase functions deploy analyze-brief --no-verify-jwt

Optional:
   supabase secrets set GEMINI_MODEL=gemini-1.5-flash

Files:
- config.js contains your Supabase URL / anon publishable key / function endpoint.
- supabase/functions/analyze-brief/index.ts contains the Gemini function.
- README_GEMINI_SETUP.txt contains setup steps.
