// Brivviant Studio — Supabase Edge Function: analyze-brief
// Purpose: Upload a PDF brief / كراسة الشروط and extract the required design elements using AI.
// Deploy command:
//   supabase functions deploy analyze-brief --no-verify-jwt
// Secret command:
//   supabase secrets set OPENAI_API_KEY=sk-...

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
        fix: 'Run: supabase secrets set OPENAI_API_KEY=sk-your-key'
      }, 500);
    }

    const payload = (await req.json()) as Payload;
    const base64 = payload.pdf?.base64 || '';
    if (!base64) return json({ error: 'PDF base64 is required.' }, 400);

    // Hard limit to avoid Edge Function payload problems. 12MB base64 ≈ 9MB PDF.
    if (base64.length > 12_000_000) {
      return json({ error: 'PDF is too large. Please upload a PDF under about 9 MB, or split the brief.' }, 413);
    }

    const pdfName = payload.pdf?.name || 'brief.pdf';
    const taskTitle = payload.task?.title || 'Untitled task';
    const eventName = payload.task?.event || 'No event';

    const prompt = `
أنت AI Bot داخل نظام Brivviant Studio لإدارة تاسكات فعاليات واستوديو تصميم.
ستقرأ PDF كراسة شروط / Brief وتستخرج فقط العناصر المطلوب تصميمها أو تنفيذها من العميل.

قواعد صارمة:
- لا تخترع أي عنصر غير موجود في PDF.
- لو في نقطة غير واضحة اكتبها ضمن missing_questions.
- ركز على العناصر التصميمية والتنفيذية: بوابات، باك دروب، كاونترات، شاشات، منصات، مناطق تفاعلية، مجسمات، طباعة، ستاندات، signage، production، installation.
- استخرج المقاسات والكميات والخامات والمواعيد لو موجودة.
- اكتب بالعربية الواضحة، واترك المصطلحات الإنجليزية كما هي لو ظهرت في الكراسة.
- رجّع JSON فقط، بدون Markdown أو شرح خارجي.

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
        model: 'gpt-4.1-mini',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_file', filename: pdfName, file_data: `data:application/pdf;base64,${base64}` }
          ]
        }],
        temperature: 0.1
      }),
    });

    const data = await openaiRes.json().catch(() => ({}));
    if (!openaiRes.ok) {
      return json({
        error: data?.error?.message || `OpenAI API error ${openaiRes.status}`,
        details: data
      }, openaiRes.status);
    }

    const outputText = data.output_text
      || data.output?.flatMap((o: any) => o.content || []).map((c: any) => c.text || '').join('\n')
      || '';

    let analysis: unknown;
    try {
      const cleaned = outputText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      analysis = JSON.parse(cleaned);
    } catch (_) {
      analysis = { summary: 'تم التحليل، لكن الرد لم يرجع JSON صالح بالكامل.', raw: outputText };
    }

    return json({ ok: true, analysis });
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
