// Brivviant Studio — Supabase Edge Function: analyze-brief
// Gemini version: reads PDF brief / كراسة الشروط and extracts design elements.
//
// Deploy:
//   supabase functions deploy analyze-brief --no-verify-jwt
//
// Recommended Secret:
//   supabase secrets set GEMINI_API_KEY=your_gemini_api_key
//
// Optional model override:
//   supabase secrets set GEMINI_MODEL=gemini-1.5-flash
//
// NOTE:
// الأفضل أمنيًا تحط المفتاح في Supabase Secrets.
// هذا المفتاح الاحتياطي يعمل فقط لو Secret غير موجود.

const DEFAULT_GEMINI_API_KEY = 'PUT_YOUR_GEMINI_API_KEY_HERE';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

type Payload = {
  task?: {
    id?: string;
    title?: string;
    event?: string;
    notes?: string;
    tags?: string;
  };
  pdf?: {
    name?: string;
    type?: string;
    base64?: string;
  };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed. Use POST only.' }, 405);
  }

  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY') || DEFAULT_GEMINI_API_KEY;

    if (!apiKey || apiKey === 'AIzaSyAhifBDB1sYH_V4uaK1SiFlN6kiVqi9lV0') {
      return json({
        error: 'GEMINI_API_KEY is missing.',
        fix: 'Add it in Supabase Secrets: supabase secrets set GEMINI_API_KEY=your-gemini-api-key, or replace DEFAULT_GEMINI_API_KEY inside index.ts.'
      }, 500);
    }

    const payload = (await req.json()) as Payload;
    const rawBase64 = payload.pdf?.base64 || '';

    if (!rawBase64) {
      return json({ error: 'PDF base64 is required.' }, 400);
    }

    const base64 = cleanBase64(rawBase64);

    // Gemini supports inline PDF input; keep this limit conservative for browser upload stability.
    if (base64.length > 20_000_000) {
      return json({
        error: 'PDF is too large. Upload a smaller PDF, compress it, or split the brief into multiple PDFs.'
      }, 413);
    }

    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-1.5-flash';
    const taskTitle = payload.task?.title || 'Untitled task';
    const eventName = payload.task?.event || 'No event';
    const filename = payload.pdf?.name || 'brief.pdf';
    const mimeType = payload.pdf?.type || 'application/pdf';

    const prompt = `
أنت AI Bot داخل نظام Brivviant Studio لإدارة تاسكات فعاليات واستوديو تصميم.
مهمتك قراءة PDF كراسة شروط / Brief واستخراج العناصر المطلوب تصميمها أو تنفيذها فقط، ثم إرجاع JSON صالح فقط.

قواعد صارمة:
- لا تخترع أي عنصر غير موجود في PDF.
- لا تنشئ Tasks جديدة.
- التحليل سيتم حفظه داخل نفس الكارت في خانة العناصر.
- ركز على عناصر الفعاليات والتصميم: بوابات، backdrops، counters، photo booth، wheel of fortune، screens، stages، signage، furniture، printing zones، kids zones، production، installation.
- استخرج المقاسات والكميات والخامات والمواعيد لو موجودة.
- لو في نقطة ناقصة أو غير واضحة، ضعها في missing_questions.
- اكتب بالعربية الواضحة مع إبقاء المصطلحات الإنجليزية كما هي.
- رجّع JSON فقط بدون Markdown وبدون أي شرح خارج JSON.

Task context:
- Task title: ${taskTitle}
- Event / Project: ${eventName}
- Notes: ${payload.task?.notes || ''}
- Tags: ${payload.task?.tags || ''}
- PDF filename: ${filename}

JSON schema المطلوب بالضبط:
{
  "summary": "ملخص قصير للكراسة",
  "required_elements": [
    {
      "name": "اسم العنصر المطلوب",
      "description": "شرح مختصر",
      "quantity": "العدد إن وجد",
      "dimensions": "المقاس إن وجد",
      "notes": "ملاحظات"
    }
  ],
  "dimensions_quantities": ["أي مقاسات أو كميات مهمة"],
  "materials_finishes": ["الخامات والتشطيبات المطلوبة"],
  "deliverables": ["المخرجات المطلوبة مثل renders, PDF, BOQ, drawings, print files"],
  "deadlines": ["مواعيد مهمة لو موجودة"],
  "special_requirements": ["اشتراطات خاصة"],
  "missing_questions": ["أسئلة لازم نسألها للعميل قبل التصميم"],
  "production_notes": ["ملاحظات تنفيذ أو تركيب"],
  "raw": "ملاحظات إضافية مختصرة"
}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    const data = await geminiRes.json().catch(() => ({}));

    if (!geminiRes.ok) {
      return json({
        error: data?.error?.message || `Gemini API error ${geminiRes.status}`,
        details: data,
      }, geminiRes.status);
    }

    const outputText = extractGeminiText(data);

    let analysis: unknown;
    try {
      analysis = JSON.parse(cleanJsonText(outputText));
    } catch (_) {
      analysis = {
        summary: 'تم التحليل، لكن الرد لم يرجع JSON صالح بالكامل.',
        required_elements: [],
        dimensions_quantities: [],
        materials_finishes: [],
        deliverables: [],
        deadlines: [],
        special_requirements: [],
        missing_questions: ['راجع النص الخام لأن Gemini لم يرجع JSON صالح بالكامل.'],
        production_notes: [],
        raw: outputText,
      };
    }

    return json({ ok: true, provider: 'gemini', model, analysis });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function cleanBase64(value: string) {
  return value
    .replace(/^data:application\/pdf;base64,/i, '')
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s/g, '')
    .trim();
}

function extractGeminiText(data: any) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text || '')
      .join('\n')
      .trim() || ''
  );
}

function cleanJsonText(text: string) {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
