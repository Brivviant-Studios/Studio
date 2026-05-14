Brivviant Studio Events Trello UI — AI Brief Analysis

Login default:
Username: Brivviant
Password: Brivviant@123456

New feature:
- Button inside every task card: شرح العناصر
- Upload PDF كراسة الشروط
- AI extracts:
  - required_elements
  - dimensions_quantities
  - materials_finishes
  - deliverables
  - deadlines
  - special_requirements
  - missing_questions
- Result is saved inside the task card as aiBriefAnalysis.
- Admin can click Convert to Tasks to create task cards from extracted elements.

AI API setup with Supabase Edge Function:
1) Install Supabase CLI and login.
2) Link your project:
   supabase link --project-ref YOUR_PROJECT_REF
3) Set OpenAI key safely as secret:
   supabase secrets set OPENAI_API_KEY=sk-xxxxxxxx
4) Deploy function:
   supabase functions deploy analyze-brief --no-verify-jwt
5) In config.js set:
   SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co'
   SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY'
   AI_BRIEF_ENDPOINT: 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/analyze-brief'

Important:
- Do not put the OpenAI API key inside config.js or any frontend file.
- The OpenAI key must stay inside Supabase Secrets only.
- Run supabase-real-tables-setup.sql if you use Supabase tables.
