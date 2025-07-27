export async function callOllama(prompt: string): Promise<string> {
  const url = `${Deno.env.get("OLLAMA_BASE_URL")}/api/generate`;
  const body = {
    model: "phi4",
    prompt,
    stream: false,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Ollama API error: ${res.status} ${error}`);
  }

  const data = await res.json();
  return data.response || "[No response from Ollama]";
}

export async function callLLM(prompt: string): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in environment variables");
  }

  const body = {
    model: "gpt-4",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`OpenAI Error: ${res.status}\n${error}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || "[No output from LLM]";
}
