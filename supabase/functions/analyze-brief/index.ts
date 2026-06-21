// Brivviant Studio — Supabase Edge Function: analyze-brief
// STRICT GEMINI VERSION — PDF Brief Analyzer
// Model: gemini-2.5-flash
// Function name MUST be: analyze-brief
// Supabase config MUST be: verify_jwt = false

const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';

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
    return json({
      ok: false,
      error: 'Method not allowed. Use POST only.',
      function: 'analyze-brief',
      model: MODEL,
    }, 405);
  }

  try {
    const apiKey = (Deno.env.get('GEMINI_API_KEY') || '').trim();

    if (!apiKey || apiKey === 'PUT_YOUR_GEMINI_API_KEY_HERE') {
      return json({
        ok: false,
        error: 'GEMINI_API_KEY is missing.',
        fix: 'Add GEMINI_API_KEY in Supabase Edge Function Secrets, then redeploy analyze-brief.',
      }, 500);
    }

    const payload = (await req.json()) as Payload;
    const rawBase64 = payload.pdf?.base64 || '';

    if (!rawBase64) {
      return json({ ok: false, error: 'PDF base64 is required.' }, 400);
    }

    const base64 = cleanBase64(rawBase64);

    if (!base64 || base64.length < 50) {
      return json({ ok: false, error: 'Invalid PDF base64.' }, 400);
    }

    // Conservative size guard for stable browser + Edge Function performance.
    if (base64.length > 20_000_000) {
      return json({
        ok: false,
        error: 'PDF is too large. Compress the PDF or split it into smaller files.',
      }, 413);
    }

    const taskTitle = payload.task?.title || 'Untitled task';
    const eventName = payload.task?.event || 'No event';
    const filename = payload.pdf?.name || 'brief.pdf';
    const mimeType = payload.pdf?.type || 'application/pdf';

    const prompt = buildPrompt({
      taskTitle,
      eventName,
      filename,
      notes: payload.task?.notes || '',
      tags: payload.task?.tags || '',
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        signal: controller.signal,
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
            responseSchema: {
              type: 'OBJECT',
              properties: {
                summary: { type: 'STRING' },
                required_elements: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
                  name: { type: 'STRING' }, description: { type: 'STRING' }, quantity: { type: 'STRING' }, dimensions: { type: 'STRING' }, notes: { type: 'STRING' },
                }, required: ['name', 'description', 'quantity', 'dimensions', 'notes'] } },
                dimensions_quantities: { type: 'ARRAY', items: { type: 'STRING' } },
                materials_finishes: { type: 'ARRAY', items: { type: 'STRING' } },
                deliverables: { type: 'ARRAY', items: { type: 'STRING' } },
                deadlines: { type: 'ARRAY', items: { type: 'STRING' } },
                special_requirements: { type: 'ARRAY', items: { type: 'STRING' } },
                missing_questions: { type: 'ARRAY', items: { type: 'STRING' } },
                production_notes: { type: 'ARRAY', items: { type: 'STRING' } },
                raw: { type: 'STRING' },
              },
              required: ['summary', 'required_elements', 'dimensions_quantities', 'materials_finishes', 'deliverables', 'deadlines', 'special_requirements', 'missing_questions', 'production_notes', 'raw'],
            },
          },
        }),
      }
    ).finally(() => clearTimeout(timeoutId));

    const data = await geminiRes.json().catch(() => ({}));

    if (!geminiRes.ok) {
      return json({
        ok: false,
        provider: 'gemini',
        model: MODEL,
        error: data?.error?.message || `Gemini API error ${geminiRes.status}`,
        details: data,
      }, geminiRes.status);
    }

    const outputText = extractGeminiText(data);

    if (!outputText) {
      return json({
        ok: false,
        provider: 'gemini',
        model: MODEL,
        error: 'Gemini returned an empty response.',
        details: data,
      }, 502);
    }

    let analysis: any;
    try {
      analysis = JSON.parse(cleanJsonText(outputText));
    } catch (_) {
      analysis = fallbackAnalysis(outputText);
    }

    analysis = normalizeAnalysis(analysis);

    return json({
      ok: true,
      provider: 'gemini',
      model: MODEL,
      analysis,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    return json({
      ok: false,
      error: isAbort ? 'AI analysis timed out after 90 seconds. Try a smaller PDF.' : message,
    }, isAbort ? 504 : 500);
  }
});

function buildPrompt(input: { taskTitle: string; eventName: string; filename: string; notes: string; tags: string }) {
  return `
أنت AI Bot داخل نظام Brivviant Studio لإدارة تاسكات فعاليات واستوديو تصميم.
مهمتك قراءة PDF كراسة شروط / Brief واستخراج العناصر المطلوب تصميمها أو تنفيذها فقط.
يجب إرجاع JSON صالح فقط، بدون Markdown، وبدون شرح خارج JSON.

قواعد صارمة:
- لا تخترع أي عنصر غير موجود في PDF.
- لا تنشئ Tasks جديدة.
- التحليل سيتم حفظه داخل نفس الكارت في خانة العناصر.
- ركز على عناصر الفعاليات والتصميم: بوابات، backdrops، counters، photo booth، wheel of fortune، screens، stages، signage، furniture، printing zones، kids zones، production، installation، activation zones، branding، media walls، giveaways.
- استخرج المقاسات والكميات والخامات والمواعيد لو موجودة.
- لو في نقطة ناقصة أو غير واضحة، ضعها في missing_questions.
- اكتب بالعربية الواضحة مع إبقاء المصطلحات الإنجليزية كما هي.
- أي array يجب أن تكون array فعلًا حتى لو فارغة.
- required_elements يجب أن تكون عناصر تصميم/تنفيذ فقط، وليس ملخصات عامة.

Task context:
- Task title: ${input.taskTitle}
- Event / Project: ${input.eventName}
- Notes: ${input.notes}
- Tags: ${input.tags}
- PDF filename: ${input.filename}

JSON schema المطلوب بالضبط:
{
  "summary": "ملخص قصير للكراسة",
  "required_elements": [
    {
      "name": "اسم العنصر المطلوب",
      "description": "شرح مختصر",
      "quantity": "العدد إن وجد أو empty string",
      "dimensions": "المقاس إن وجد أو empty string",
      "notes": "ملاحظات أو empty string"
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
}

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

function fallbackAnalysis(outputText: string) {
  return {
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

function normalizeAnalysis(a: any) {
  const arr = (v: any) => Array.isArray(v) ? v : (v ? [String(v)] : []);
  const element = (x: any) => typeof x === 'string'
    ? { name: x, description: '', quantity: '', dimensions: '', notes: '' }
    : {
      name: String(x?.name || x?.title || x?.element || ''),
      description: String(x?.description || ''),
      quantity: String(x?.quantity || ''),
      dimensions: String(x?.dimensions || x?.size || ''),
      notes: String(x?.notes || ''),
    };
  return {
    summary: String(a?.summary || ''),
    required_elements: arr(a?.required_elements || a?.design_elements || a?.elements).map(element).filter((x: any) => x.name || x.description),
    dimensions_quantities: arr(a?.dimensions_quantities),
    materials_finishes: arr(a?.materials_finishes),
    deliverables: arr(a?.deliverables),
    deadlines: arr(a?.deadlines),
    special_requirements: arr(a?.special_requirements),
    missing_questions: arr(a?.missing_questions),
    production_notes: arr(a?.production_notes),
    raw: String(a?.raw || ''),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
