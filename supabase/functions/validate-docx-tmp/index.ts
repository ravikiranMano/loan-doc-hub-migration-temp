import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as fflate from "https://esm.sh/fflate@0.8.2";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  try {
    const { path } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await supabase.storage.from("generated-docs").download(path);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    const buf = new Uint8Array(await data.arrayBuffer());
    const unzip = fflate.unzipSync(buf);
    const out: Record<string, unknown> = { size: buf.length, files: Object.keys(unzip).length, parts: {} };
    const dec = new TextDecoder("utf-8");
    for (const n of ["word/document.xml", "word/header1.xml", "word/header2.xml", "word/header3.xml", "word/footer1.xml", "word/footer2.xml", "word/footer3.xml"]) {
      if (!unzip[n]) continue;
      const xml = dec.decode(unzip[n]);
      // Tag-balance walker (mirrors validateContentXmlPart)
      const tagRe = /<(!\[CDATA\[[\s\S]*?\]\]|!--[\s\S]*?--|\?[^>]*\?|\/?[A-Za-z_][\w:.-]*(?:\s[^<>]*)?)>/g;
      const stack: string[] = []; let bad: string | null = null; let m: RegExpExecArray | null;
      while ((m = tagRe.exec(xml)) !== null) {
        const body = m[1].trim();
        if (!body || body[0] === "?" || body.startsWith("!--") || body.startsWith("![CDATA")) continue;
        if (body[0] === "/") {
          const close = body.slice(1).split(/\s+/)[0];
          const open = stack.pop();
          if (open !== close) { bad = `expected </${open ?? "none"}> before </${close}> @${m.index}`; break; }
        } else if (!body.endsWith("/")) {
          stack.push(body.split(/\s+/)[0]);
        }
      }
      (out.parts as any)[n] = { bytes: xml.length, ok: !bad && stack.length === 0, err: bad ?? (stack.length ? `unclosed <${stack[stack.length - 1]}>` : null) };
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500 });
  }
});
