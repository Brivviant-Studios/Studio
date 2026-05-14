// Supabase Edge Function: analyze-brief
// Deploy:
//   supabase functions deploy analyze-brief --no-verify-jwt
// Set your OpenAI key safely as a Supabase secret:
//   supabase secrets set OPENAI_API_KEY=sk-...

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Payload = {
  task?: { id?: string; title?: string; event?: string; notes?: string; tags?: string };
  pdf?: { name?: string; type?: string; base64?: string };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return json({ error: 'OPENAI_API_KEY is not set in Supabase secrets.' }, 500);

    const payload = (await req.json()) as Payload;
    if (!payload.pdf?.base64) return json({ error: 'PDF base64 is required.' }, 400);

    const taskTitle = payload.task?.title || 'Untitled task';
    const eventName = payload.task?.event || 'No event';

    const prompt = `
أنت AI Bot داخل نظام Brivviant Studio لإدارة فعاليات واستوديو تصميم.
اقرأ PDF كراسة الشروط واستخرج العناصر المطلوبة من العميل بشكل عملي لفريق التصميم والتنفيذ.

مهمتك:
- لا تخترع أي معلومات غير موجودة.
- لو في معلومة ناقصة اكتبها في missing_questions.
- ركز على العناصر المطلوب تصميمها أو تنفيذها داخل الفعالية.
- اكتب بالعربية الواضحة، ويمكن إبقاء المصطلحات التقنية بالإنجليزية إذا وردت في الكراسة.

Context:
Task: ${taskTitle}
Event: ${eventName}
Task notes: ${payload.task?.notes || ''}
Tags: ${payload.task?.tags || ''}

رجّع JSON فقط بهذا الشكل بدون Markdown:
{
  "summary": "ملخص قصير للكراسة",
  "required_elements": ["العنصر 1", "العنصر 2"],
  "dimensions_quantities": ["مقاس/كمية لو موجودة"],
  "materials_finishes": ["الخامات والتشطيبات المطلوبة"],
  "deliverables": ["المخرجات المطلوبة مثل renders, PDF, BOQ, drawings"],
  "deadlines": ["مواعيد مهمة لو موجودة"],
  "special_requirements": ["اشتراطات خاصة"],
  "missing_questions": ["أسئلة لازم نسألها للعميل"],
  "raw": "ملاحظات إضافية مختصرة"
}`;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              {
                type: 'input_file',
                filename: payload.pdf.name || 'brief.pdf',
                file_data: `data:application/pdf;base64,${payload.pdf.base64}`,
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) return json({ error: data.error?.message || 'OpenAI API error', details: data }, response.status);

    const outputText = data.output_text || data.output?.flatMap((o: any) => o.content || []).find((c: any) => c.text)?.text || '';
    let analysis: unknown;
    try {
      analysis = JSON.parse(outputText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
    } catch (_) {
      analysis = { summary: 'تم التحليل، لكن الرد لم يرجع JSON كامل.', raw: outputText };
    }

    return json({ analysis });
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
