BRIVVIANT AI BRIEF ANALYZER — STRICT GEMINI DEPLOY

تم تحديث النظام ليستخدم:
Model: gemini-2.5-flash
Function: analyze-brief
Project: viwaclirvokwoeqqivgr
Endpoint: https://viwaclirvokwoeqqivgr.supabase.co/functions/v1/analyze-brief
verify_jwt=false موجودة داخل supabase/config.toml

الملف المهم:
supabase/functions/analyze-brief/index.ts

طريقة التشغيل الصحيحة:
1) ارفع/حدّث Edge Function باسم analyze-brief في Supabase.
2) تأكد أن Verify JWT = OFF.
3) الأفضل أمنيًا أضف Secret باسم:
   GEMINI_API_KEY
4) اختبر الرابط:
   https://viwaclirvokwoeqqivgr.supabase.co/functions/v1/analyze-brief
   لو ظهر Method not allowed فهذا طبيعي ومعناه أن الدالة شغالة وتنتظر POST.

ملاحظات:
- الكود يحتوي على fallback API Key داخل Edge Function حسب طلبك.
- لا تضع هذا المفتاح داخل index.html أو script.js أو config.js.
- لو سترفع المشروع إلى GitHub public، المفتاح سيكون ظاهرًا داخل ملف index.ts، والأفضل استخدام Secrets فقط.
