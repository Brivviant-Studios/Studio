تشغيل نسخة Brivviant Studio المعدلة
=================================

هذه النسخة تعتمد على Supabase كمصدر أساسي للبيانات:
- التاسكات والفعاليات والحسابات والتعديلات والحذف محفوظة في الجداول.
- محاولات تسجيل الدخول الناجحة والفاشلة وتسجيل الخروج محفوظة في studio_login_events.
- كلمات المرور تُحوَّل تلقائيًا إلى bcrypt، والتحقق يتم داخل دالة studio_login في قاعدة البيانات بدون تنزيل كلمة المرور إلى المتصفح.
- سجل الحركات محفوظ في studio_activity_logs.
- مرفقات التاسكات وصور الحسابات وملفات PDF الخاصة بالبريف محفوظة في Storage bucket باسم studio-files.
- استخراج عناصر البريف وحفظها يتم داخل نفس صف التاسك في design_elements و ai_brief_analysis.

خطوات التشغيل الإلزامية
-----------------------

1) افتح Supabase Dashboard للمشروع ثم SQL Editor.
2) شغّل ملف supabase-real-tables-setup.sql كاملًا مرة واحدة.
3) أضف مفتاح Gemini إلى Edge Function Secrets (لا تضعه في ملفات الواجهة):
   supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_KEY --project-ref viwaclirvokwoeqqivgr
4) انشر دالة التحليل المحدثة:
   supabase functions deploy analyze-brief --no-verify-jwt --project-ref viwaclirvokwoeqqivgr
5) ارفع ملفات المشروع إلى الاستضافة أو افتحها عبر web server محلي، ثم اعمل Hard Refresh.

مهم
----

- يجب تنفيذ ملف SQL الجديد قبل أول Login، لأن النظام أصبح يسجل كل محاولة دخول في Supabase.
- لو فشل اتصال Supabase، العملية تتوقف ولا تُعرض كأنها حُفظت محليًا.
- الحد الأقصى للملف الواحد 15MB، والأنواع المسموحة: صور شائعة وPDF.
- config.js يحتوي Publishable/Anon key فقط. لا تضف Gemini API key أو service_role key إلى الواجهة.
