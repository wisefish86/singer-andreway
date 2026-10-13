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
    [{ text: "🎤 Ближайшее выступление" }, { text: "⚙️ Настройки уведомлений" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
const settingsKeyboard = {
  keyboard: [
    [{ text: "📋 Статус уведомлений" }, { text: "🔔 Включить уведомления" }],
    [{ text: "🔕 Отключить уведомления" }],
    [{ text: "⬅️ Назад" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
const confirmKeyboard = {
  keyboard: [
    [{ text: "❗ Да, отключить уведомления" }],
    [{ text: "↩️ Отмена" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
const siteUrl = "https://singer.andreway.ru/";
const channelUrl = "https://t.me/andrey_spoet";
const photoUrl = "https://wsrv.nl/?url=" +
  encodeURIComponent("https://singer.andreway.ru/images/hero-main-1920.webp") +
  "&w=960&h=540&fit=cover&output=jpg&q=80";

type Show = {
  title: string; date: string; time: string; venue: string;
  address: string; website: string; booking_url: string; map_link: string; phone: string;
};
function html(value: string): string {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function validUrl(url: string): string {
  try { const u = new URL(url); return ["https:", "http:"].includes(u.protocol) ? u.href : ""; }
  catch { return ""; }
}
async function nearestShow(): Promise<Show | null> {
  const {data, error} = await supabase.from("singer_next_show")
    .select("show_at,details").eq("id",1).maybeSingle();
  if (error) throw error;
  if (!data?.show_at || Date.parse(data.show_at) <= Date.now()) return null;
  return data.details as Show;
}
async function channelPinnedUrl(): Promise<string> {
  try {
    const response = await fetch("https://api.telegram.org/bot" + token + "/getChat?chat_id=%40andrey_spoet");
    const payload = await response.json();
    const id = payload?.result?.pinned_message?.message_id;
    if (response.ok && payload?.ok && Number.isSafeInteger(id) && id > 0) {
      return channelUrl + "/" + id;
    }
  } catch (error) {
    console.error("Pinned channel link unavailable", error instanceof Error ? error.message : "unknown");
  }
  return channelUrl;
}
async function linkKeyboard(): Promise<object> {
  const pinned = await channelPinnedUrl();
  return {inline_keyboard: [[
    {text:"📣 Telegram-канал / афиша",url:pinned},
    {text:"🌐 Мой сайт",url:siteUrl}
  ]]};
}
async function sendNearestShow(chatId: number): Promise<void> {
  const show = await nearestShow();
  if (!show) return;
  const rows: Array<Array<{text:string;url?:string;callback_data?:string}>> = [];
  const digits = String(show.phone || "").replace(/\D/g, "");
  // Telegram inline URL buttons don't reliably support tel:, so send a callable contact instead.
  if (digits.length === 11 && digits[0] === "7") {
    rows.push([{text:"📞 Позвонить в заведение",callback_data:"venue_contact"}]);
  }
  const booking = validUrl(show.booking_url);
  if (booking) rows.push([{text:"🍽 Забронировать столик",url:booking}]);
  const map = validUrl(show.map_link) || (show.address
    ? "https://yandex.ru/maps/?text=" + encodeURIComponent(show.address) : "");
  if (map) rows.push([{text:"🗺 Построить маршрут",url:map}]);
  const website = validUrl(show.website);
  if (website) rows.push([{text:"🌐 Сайт заведения",url:website}]);
  rows.push([{text:"📣 Telegram-канал / афиша",url:await channelPinnedUrl()},{text:"🌐 Мой сайт",url:siteUrl}]);
  const caption = [
    "<b>🎤 Ближайшее выступление Андрея Шевцова</b>",
    "",
    show.date ? "📅 " + html(show.date) : "",
    show.time ? "🕗 " + html(show.time) : "",
    show.venue ? "🏛️ <b>" + html(show.venue) + "</b>" : "",
    show.address ? "📍 " + html(show.address) : "",
    show.phone ? "📞 Телефон: +" + html(String(show.phone).replace(/\D/g, "").replace(/^8(?=\d{10}$)/, "7")) : "",
    "",
    "Буду рад видеть вас! 🎶",
  ].filter((x, i, a) => x || (i > 0 && a[i-1] !== "")).join("\n");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      chat_id:chatId,
      photo:photoUrl,
      caption,parse_mode:"HTML",reply_markup:{inline_keyboard:rows}
    })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    console.error("Photo error: " + String(payload?.description || response.status).slice(0,300));
    const backup = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chatId,text:caption,parse_mode:"HTML",reply_markup:{inline_keyboard:rows}})});
    if (!backup.ok) throw new Error("Fallback failed, HTTP " + backup.status);
  }
}

async function sendReply(chatId: number, text: string, replyMarkup: object = keyboard): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(`Telegram sendMessage failed: HTTP ${response.status}`);
  }
}

async function sendLinks(chatId: number): Promise<void> {
  const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      chat_id:chatId,text:"Мой сайт и канал с афишей:",
      reply_markup:await linkKeyboard()
    })
  });
  const payload=await response.json();
  if(!response.ok || !payload.ok) throw new Error("sendLinks failed: "+String(payload.description||response.status));
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (!token) return new Response("Not configured", { status: 503 });
  const secret = await telegramWebhookSecret(token);
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (request.method === "POST" && new URL(request.url).searchParams.get("sync_show") === "1") {
    try {
      const data = await request.json();
      const input = data?.show;
      if (input !== null && (!input || typeof input !== "object")) {
        return new Response("Invalid show", {status:400});
      }
      const fields = ["title","date","time","venue","address","website","booking_url","map_link","phone"];
      const details: Record<string,string> = {};
      for (const key of fields) {
        if (input && input[key] !== undefined && typeof input[key] !== "string") return new Response("Invalid field", {status:400});
        details[key] = input ? String(input[key] ?? "").slice(0,1000) : "";
      }
      const showAt = input ? String(data.show_at || "") : null;
      if (showAt && !Number.isFinite(Date.parse(showAt))) return new Response("Invalid show time",{status:400});
      const { error } = await supabase.from("singer_next_show").upsert({
        id:1,show_at:showAt,details,synced_at:new Date().toISOString()
      }, {onConflict:"id"});
      if (error) throw error;
      return new Response("ok");
    } catch (error) {
      console.error("Show synchronization failed", error instanceof Error ? error.message : "unknown");
      return new Response("Sync failed",{status:500});
    }
  }
  if (request.method === "GET" && new URL(request.url).searchParams.get("subscribers") === "1") {
    const { data, error } = await supabase.from("singer_subscribers")
      .select("chat_id").eq("is_active", true).order("chat_id").limit(1000);
    if (error) return new Response("Subscriber lookup unavailable", { status: 503 });
    return new Response(JSON.stringify({ subscribers: (data ?? []).map(row => String(row.chat_id)) }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
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

    const callback = update.callback_query;
    if ((callback?.data === "venue_contact" || /^venue_call:7\d{10}$/.test(String(callback?.data || ""))) && callback.message?.chat?.type === "private") {
      const show = await nearestShow();
      const digits = String(callback.data).startsWith("venue_call:")
        ? String(callback.data).slice("venue_call:".length)
        : String(show?.phone || "").replace(/\D/g, "");
      const chatId = callback.message.chat.id;
      if (show && digits.length === 11 && digits[0] === "7") {
        const res = await fetch("https://api.telegram.org/bot" + token + "/sendContact", {
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({chat_id:chatId,phone_number:"+"+digits,first_name:show.venue || "Заведение"})
        });
        const body = await res.json();
        if (!res.ok || !body.ok) throw new Error("sendContact: " + String(body.description || res.status));
      }
      await fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery", {
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({callback_query_id:callback.id,text:show && digits ? "Контакт заведения отправлен" : "Номер недоступен"})
      });
      const {error} = await supabase.from("singer_bot_updates").upsert({
        update_id:update.update_id,handled_at:new Date().toISOString()
      });
      if(error) throw error;
      return new Response("ok");
    }
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
    let showCard = false;
    let replyKeyboard: object = keyboard;
    let linkType: "site" | "channel" | null = null;
    if (command === "/start" || command === "/event" || text === "🔔 Включить уведомления" || text === "🔔 Получать уведомления") {
      const {error}=await supabase.from("singer_subscribers").upsert({chat_id:chatId,is_active:true,updated_at:new Date().toISOString()},{onConflict:"chat_id"});
      if(error) throw error;
      showCard = command === "/start" || command === "/event";
      responseText = "✅ Вы подписаны на уведомления!\nЗа 2 дня и за 3 часа пришлю напоминание с адресом, маршрутом и контактами заведения.";
      if(text === "🔔 Включить уведомления") replyKeyboard = settingsKeyboard;
    } else if (text === "⚙️ Настройки уведомлений" || command === "/settings") {
      const {data,error}=await supabase.from("singer_subscribers").select("is_active").eq("chat_id",chatId).maybeSingle();
      if(error) throw error;
      responseText = data?.is_active ? "✅ Напоминания включены (за 2 дня и 3 часа)." : "🔕 Напоминания выключены.";
      replyKeyboard = settingsKeyboard;
    } else if (text === "🔕 Отключить уведомления" || command === "/stop") {
      responseText = "Вы точно хотите отключить уведомления?";
      replyKeyboard = confirmKeyboard;
    } else if (text === "❗ Да, отключить уведомления") {
      const {error}=await supabase.from("singer_subscribers").update({is_active:false,updated_at:new Date().toISOString()}).eq("chat_id",chatId);
      if(error) throw error;
      responseText = "🔕 Уведомления отключены. Включить их снова можно в настройках.";
    } else if (text === "↩️ Отмена") {
      responseText = "Отмена. Подписка не изменена.";
      replyKeyboard = settingsKeyboard;
    } else if (text === "⬅️ Назад") {
      responseText = "Главное меню:";
    } else if (command === "/status" || text === "📋 Статус уведомлений" || text === "📋 Моя подписка") {
      const {data,error}=await supabase.from("singer_subscribers").select("is_active").eq("chat_id",chatId).maybeSingle();
      if(error) throw error;
      responseText = data?.is_active ? "✅ Напоминания включены." : "🔕 Напоминания выключены.";
      replyKeyboard = settingsKeyboard;
    } else if (command === "/preview" || text === "🎤 Ближайшее выступление") {
      showCard = true;
      responseText = "🎤 Ближайшее открытое выступление:";
    } else if (text === "🌐 Мой сайт") {
      linkType = "site";
      responseText = "🌐 Сайт Андрея Шевцова:";
    } else if (text === "📣 Telegram-канал") {
      linkType = "channel";
      responseText = "📣 Канал с афишей выступлений:";
    } else if (command === "/links") {
      linkType = "channel";
    } else if (command === "/help") {
      responseText = "Здесь можно посмотреть афишу, управлять уведомлениями и перейти на сайт или в канал.";
    }
    if (linkType) await sendLinks(chatId);
    else await sendReply(chatId,responseText,replyKeyboard);
    if(showCard) {
      try {
        const show=await nearestShow();
        if(show) await sendNearestShow(chatId);
        else await sendReply(chatId,"Пока ближайших открытых выступлений нет.");
      } catch(error) {console.error("Nearest show card failed",error instanceof Error?error.message:"unknown");}
    }
    const { error } = await supabase.from("singer_bot_updates")
      .upsert({ update_id: update.update_id, handled_at: new Date().toISOString() });
    if (error) throw error;
    return new Response("ok");
  } catch (error) {
    console.error("Singer webhook failed:", error instanceof Error ? error.message : "unknown");
    return new Response("Retry", { status: 500 });
  }
});
