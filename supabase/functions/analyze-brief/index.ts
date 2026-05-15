// Brivviant Studio — Supabase Edge Function: analyze-brief
// OpenAI version: reads PDF brief / كراسة الشروط and extracts design elements.
// Deploy:
//   supabase functions deploy analyze-brief --no-verify-jwt
// Secrets:
//   supabase secrets set OPENAI_API_KEY=your_openai_api_key
// Optional:
//   supabase secrets set OPENAI_MODEL=gpt-4.1-mini

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

type Payload = {
  task?: { id?: string; title?: string; event?: string; notes?: string; tags?: string };
  pdf?: { name?: string; type?: string; base64?: string };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed. Use POST only.' }, 405);

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      return json({
        error: 'OPENAI_API_KEY is missing in Supabase Edge Function Secrets.',
        fix: 'Run: supabase secrets set OPENAI_API_KEY=your-openai-api-key'
      }, 500);
    }

    const payload = (await req.json()) as Payload;
    const base64 = payload.pdf?.base64 || '';
    if (!base64) return json({ error: 'PDF base64 is required.' }, 400);
    if (base64.length > 12_000_000) {
      return json({ error: 'PDF is too large. Upload a PDF under about 9 MB, or split the brief.' }, 413);
    }

    const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4.1-mini';
    const taskTitle = payload.task?.title || 'Untitled task';
    const eventName = payload.task?.event || 'No event';
    const filename = payload.pdf?.name || 'brief.pdf';

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
- رجّع JSON فقط بدون Markdown.

Task context:
- Task title: ${taskTitle}
- Event / Project: ${eventName}
- Notes: ${payload.task?.notes || ''}
- Tags: ${payload.task?.tags || ''}

JSON schema المطلوب:
{
  "summary": "ملخص قصير للكراسة",
  "required_elements": [
    {"name":"اسم العنصر المطلوب", "description":"شرح مختصر", "quantity":"العدد إن وجد", "dimensions":"المقاس إن وجد", "notes":"ملاحظات"}
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

    const openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_file', filename, file_data: `data:application/pdf;base64,${base64}` }
          ]
        }]
      })
    });

    const data = await openaiRes.json().catch(() => ({}));
    if (!openaiRes.ok) {
      return json({ error: data?.error?.message || `OpenAI API error ${openaiRes.status}`, details: data }, openaiRes.status);
    }

    const outputText =
      data?.output_text ||
      data?.output?.flatMap((o: any) => o.content || []).map((c: any) => c.text || '').join('\n') ||
      '';

    let analysis: unknown;
    try {
      const cleaned = outputText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      analysis = JSON.parse(cleaned);
    } catch (_) {
      analysis = { summary: 'تم التحليل، لكن الرد لم يرجع JSON صالح بالكامل.', raw: outputText };
    }

    return json({ ok: true, provider: 'openai', model, analysis });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
