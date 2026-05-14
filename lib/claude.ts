import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface NewsItem {
  titolo: string;
  testo: string;
}

export interface FlashScript {
  intro: string;
  notizie: NewsItem[];
  outro: string;
}

export async function generateScript(
  categoria: string,
  numNotizie: number
): Promise<FlashScript> {
  const today = new Date().toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const prompt = `Oggi è ${today}. Cerca le ultime notizie italiane di oggi sulla categoria "${categoria}" e crea uno script per un flash informativo video con esattamente ${numNotizie} notizie.
Rispondi SOLO con JSON valido, senza markdown, senza backtick:
{"intro":"...","notizie":[{"titolo":"...","testo":"..."}],"outro":"..."}`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: prompt },
  ];

  // Flusso multi-turn per web search
  while (true) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search" }] as any,
      messages,
    });

    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({
          type: "tool_result",
          tool_use_id: b.id,
          content: JSON.stringify(b.input),
        }));
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
    } else {
      const raw = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Risposta Claude non in formato JSON");
      return JSON.parse(match[0]) as FlashScript;
    }
  }
}

export function scriptToText(script: FlashScript): string {
  return [
    script.intro,
    ...script.notizie.map((n) => n.testo),
    script.outro,
  ]
    .filter(Boolean)
    .join("\n\n");
}
