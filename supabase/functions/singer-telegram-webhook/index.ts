import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);
const token = Deno.env.get("SINGER_TELEGRAM_BOT_TOKEN");
// Derive the Telegram verification secret from the shared bot token. No second secret to copy.
async function telegramWebhookSecret(tokenValue: string): Promise<string> {
  const bytes = new TextEncoder().encode("singer-webhook:" + tokenValue);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, "0")).join("");
}
const keyboard = {
  keyboard: [
    [{ text: "🔔 Получать уведомления" }, { text: "🔕 Отключить" }],
    [{ text: "📋 Моя подписка" }],
  ],
  resize_keyboard: true,
};

async function sendReply(chatId: number, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: keyboard }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(`Telegram sendMessage failed: HTTP ${response.status}`);
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (!token) return new Response("Not configured", { status: 503 });
  const secret = await telegramWebhookSecret(token);
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (request.method === "GET") {
    try {
      const [bot, database] = await Promise.all([
        fetch(`https://api.telegram.org/bot${token}/getMe`).then((res) => res.json()),
        supabase.from("singer_subscribers").select("chat_id", {head: true, count: "exact"}).limit(1),
      ]);
      if (!bot.ok || database.error) return new Response("Backend not ready", {status: 503});
      return new Response("ready", {status: 200});
    } catch {
      return new Response("Backend not ready", {status: 503});
    }
  }
  if (request.method !== "POST") return new Response("Not found", {status: 404});

  try {
    const update = await request.json();
    if (!Number.isSafeInteger(update.update_id)) return new Response("Bad update", { status: 400 });
    const existing = await supabase.from("singer_bot_updates")
      .select("handled_at").eq("update_id", update.update_id).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.handled_at) return new Response("ok");

    const message = update.message;
    if (message?.chat?.type !== "private" || typeof message?.text !== "string") {
      const { error } = await supabase.from("singer_bot_updates")
        .upsert({ update_id: update.update_id, handled_at: new Date().toISOString() });
      if (error) throw error;
      return new Response("ok");
    }

    const chatId = message.chat.id;
    const text = message.text.trim();
    const command = text.split(/\s+/)[0].split("@")[0].toLowerCase();
    let responseText = "Выберите действие на клавиатуре ниже.";

    if (command === "/start" || command === "/event" || text === "🔔 Получать уведомления") {
      const { error } = await supabase.from("singer_subscribers").upsert(
        { chat_id: chatId, is_active: true, updated_at: new Date().toISOString() },
        { onConflict: "chat_id" },
      );
      if (error) throw error;
      responseText = "✅ Вы подписаны на уведомления о выступлениях!\n\nЯ напомню за 48 часов и за 3 часа до начала. Отключить уведомления можно кнопкой ниже.";
    } else if (command === "/stop" || text === "🔕 Отключить") {
      const { error } = await supabase.from("singer_subscribers")
        .update({ is_active: false, updated_at: new Date().toISOString() }).eq("chat_id", chatId);
      if (error) throw error;
      responseText = "🔕 Уведомления отключены.";
    } else if (command === "/status" || text === "📋 Моя подписка") {
      const { data, error } = await supabase.from("singer_subscribers")
        .select("is_active").eq("chat_id", chatId).maybeSingle();
      if (error) throw error;
      responseText = data?.is_active
        ? "✅ Вы подписаны. Напоминания запланированы за 48 и за 3 часа до выступлений."
        : "Уведомления сейчас выключены. Нажмите «🔔 Получать уведомления».";
    } else if (command === "/help") {
      responseText = "Подписка на открытые выступления: /event — включить; /stop — отключить; /status — проверить.";
    }

    await sendReply(chatId, responseText);
    const { error } = await supabase.from("singer_bot_updates")
      .upsert({ update_id: update.update_id, handled_at: new Date().toISOString() });
    if (error) throw error;
    return new Response("ok");
  } catch (error) {
    console.error("Singer webhook failed:", error instanceof Error ? error.message : "unknown");
    return new Response("Retry", { status: 500 });
  }
});
