BRIVVIANT STUDIO — AI Brief Analysis Strict Setup
=================================================

المشكلة: Failed to fetch
السبب الحقيقي غالبًا إن Supabase Edge Function analyze-brief لم يتم نشرها Deploy، أو تم نشرها مع JWT verification، أو GEMINI_API_KEY غير مضاف في Secrets.

الحل الصارم:

1) تأكد أن config.js يحتوي على:
SUPABASE_URL = https://viwaclirvokwoeqqivgr.supabase.co
AI_BRIEF_ENDPOINT = https://viwaclirvokwoeqqivgr.supabase.co/functions/v1/analyze-brief

2) ثبت Supabase CLI لو مش موجود:
npm install -g supabase

3) ادخل فولدر المشروع من Terminal:
cd path/to/project

4) Login:
supabase login

5) اربط المشروع بمشروع Studio:
supabase link --project-ref viwaclirvokwoeqqivgr

6) أضف Gemini API Key كـ Secret داخل Supabase، لا تضيفه في الواجهة:
supabase secrets set GEMINI_API_KEY=sk-your-openai-api-key

7) اعمل Deploy للـ Function بدون JWT:
supabase functions deploy analyze-brief --no-verify-jwt

8) اختبر الرابط:
افتح هذا الرابط في المتصفح:
https://viwaclirvokwoeqqivgr.supabase.co/functions/v1/analyze-brief
المتوقع يظهر Method not allowed أو response من الفانكشن، المهم لا يظهر 404.

9) ارفع الموقع مرة أخرى على GitHub Pages.

ملاحظات مهمة:
- لا تضع GEMINI_API_KEY في config.js أو GitHub.
- PDF الأفضل يكون أقل من 9MB.
- لو PDF سكان صور فقط بدون نص، التحليل قد يكون أضعف حسب جودة الملف.
- لو ظهر Gemini API error فالمشكلة في المفتاح أو الرصيد أو الموديل، وليس في الموقع.
