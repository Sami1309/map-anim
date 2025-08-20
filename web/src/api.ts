const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

export async function parsePrompt(text: string) {
  const r = await fetch(`${API}/api/llm/parse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).program;
}

export async function resolveProgram(input: { text?: string; program?: unknown }) {
  const r = await fetch(`${API}/api/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).program;
}

export async function renderProgram(program: unknown) {
  const r = await fetch(`${API}/api/animate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: null, program }) // backend uses program if provided; or change to a dedicated endpoint
  });
  if (!r.ok) throw new Error(await r.text());
  return await r.json(); // { url, program }
}

export async function saveTemplate(name: string, program: unknown) {
  const r = await fetch(`${API}/api/templates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, program })
  });
  if (!r.ok) throw new Error(await r.text());
  return await r.json(); // { url }
}
