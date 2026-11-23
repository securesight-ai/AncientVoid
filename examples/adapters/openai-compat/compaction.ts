export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

const KEEP_RECENT = 6;
const MIN_REPEAT_CHARS = 512;

export function compactHistory(history: readonly HistoryMessage[]) {
  const firstByContent = new Map<string, number>();
  let repeats = 0;
  let savedBytes = 0;
  const messages = history.map((message, index) => {
    if (message.role !== "assistant" || message.content.length < MIN_REPEAT_CHARS || index >= history.length - KEEP_RECENT) return message;
    const first = firstByContent.get(message.content);
    if (first === undefined) {
      firstByContent.set(message.content, index + 1);
      return message;
    }
    const content = `[Exact repeat of message ${first} in this conversation, counting from 1.]`;
    repeats++;
    savedBytes += Buffer.byteLength(JSON.stringify(message.content)) - Buffer.byteLength(JSON.stringify(content));
    return { ...message, content };
  });
  return { messages, repeats, savedBytes };
}
