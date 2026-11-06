import Anthropic from "@anthropic-ai/sdk";

// Legacy path, kept until the phase B pipeline has been tested end to end.
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
const MAX_CONTINUATIONS = 5;

export interface NewsItem {
  titolo: string;
  testo: string;
}

export interface FlashScript {
  intro: string;
  notizie: NewsItem[];
  outro: string;
}

export async function generateScript(categoria: string, numNotizie: number): Promise<FlashScript> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 2 });
  const today = new Date().toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Rome",
  });

  const prompt = `Oggi è ${today}. Cerca le ultime notizie italiane di oggi sulla categoria "${categoria}" e crea uno script per un flash informativo video con esattamente ${numNotizie} notizie.
Rispondi SOLO con JSON valido, senza markdown, senza backtick:
{"intro":"...","notizie":[{"titolo":"...","testo":"..."}],"outro":"..."}`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  // web_search runs server-side: the only continuation signal is pause_turn.
  // The old `while (true)` answered a fake tool_result and had no upper bound.
  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn += 1) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      messages,
    });

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      throw new Error(`Script generation stopped: ${response.stop_reason}`);
    }

    const raw = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Script response is not JSON");
    return JSON.parse(match[0]) as FlashScript;
  }

  throw new Error("Script generation exceeded the continuation limit");
}

export function scriptToText(script: FlashScript): string {
  return [script.intro, ...script.notizie.map((n) => n.testo), script.outro].filter(Boolean).join("\n\n");
}
