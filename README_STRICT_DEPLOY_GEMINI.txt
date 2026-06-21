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
- مفتاح Gemini لا يُكتب داخل الكود؛ يجب إضافته إلى Supabase Secrets فقط.
- لا تضع هذا المفتاح داخل index.html أو script.js أو config.js.
- يمكن رفع الكود بدون كشف المفتاح لأن الدالة تقرأه من Supabase Secrets فقط.
