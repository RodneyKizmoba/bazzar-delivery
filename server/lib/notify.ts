import twilio from "twilio";
import { config } from "../config";

/**
 * SMS opcional via Twilio. Só envia se TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_FROM_NUMBER existirem.
 * Falhas de SMS nunca interrompem o fluxo de encomenda.
 */
const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_FROM_NUMBER;
const client = sid && token && from ? twilio(sid, token) : null;

const STATUS_TEXT: Record<string, string> = {
  accepted: "foi aceite pela loja",
  preparing: "está a ser preparada",
  ready: "está pronta e aguarda o estafeta",
  picked_up: "está a caminho",
  delivered: "foi entregue. Bom apetite!",
  cancelled: "foi cancelada",
  rejected: "não pôde ser aceite pela loja",
};

function normalize(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+244${digits}`;
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!client || !from) return false;
  try {
    await client.messages.create({ to: normalize(to), from, body });
    return true;
  } catch (e: any) {
    if (!config.isProd) console.warn("[sms] falhou:", e?.message);
    return false;
  }
}

export function notifyOrderStatus(phone: string, orderNumber: string, status: string) {
  const text = STATUS_TEXT[status];
  if (!text) return;
  void sendSms(phone, `BazzarDelivery: a sua encomenda ${orderNumber} ${text}`);
}
