// Minimal Telegram Bot API client. Staff chats only: nothing here ever addresses a caller.

export type InlineButton = { text: string; callback_data: string };
export type OutgoingMessage = { chatId: number; html: string; buttons?: InlineButton[][] };

export type TelegramClient = {
  send(message: OutgoingMessage): Promise<{ messageId: number }>;
  edit(chatId: number, messageId: number, html: string, buttons?: InlineButton[][]): Promise<void>;
  answer(callbackQueryId: string, text: string): Promise<void>;
};

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TelegramError";
  }
}

export function createTelegramClient(token: string): TelegramClient {
  async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await response.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) throw new TelegramError(json.description ?? `Telegram ${method} failed`, response.status);
    return json.result as T;
  }
  const markup = (buttons?: InlineButton[][]) => (buttons ? { reply_markup: { inline_keyboard: buttons } } : {});
  return {
    async send({ chatId, html, buttons }) {
      const result = await call<{ message_id: number }>("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...markup(buttons) });
      return { messageId: result.message_id };
    },
    async edit(chatId, messageId, html, buttons) {
      await call("editMessageText", { chat_id: chatId, message_id: messageId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...markup(buttons) });
    },
    async answer(callbackQueryId, text) {
      await call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
    },
  };
}
