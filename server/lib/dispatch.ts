import type { Order, Store } from "@shared/schema";
import { config } from "../config";

/**
 * Integração opcional com um portal externo de estafetas (ex.: PedeJá Rider).
 * Só é usada se DRIVER_PORTAL_URL e DRIVER_PORTAL_API_KEY estiverem definidos.
 * Uma falha aqui NUNCA cancela a encomenda: a encomenda continua visível na app de estafetas interna.
 */
export async function notifyExternalDispatch(order: Order, store: Store, customerPhone: string): Promise<string | null> {
  if (!config.driverPortalUrl || !config.driverPortalApiKey) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(config.driverPortalUrl, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-API-Key": config.driverPortalApiKey },
      body: JSON.stringify({
        id: order.id,
        orderNumber: order.orderNumber,
        storeName: store.name,
        storeAddress: `${store.street}, ${store.zone}`,
        customerAddress: order.deliveryAddress,
        customerPhone,
        total: order.total,
        paymentMethod: order.paymentMethod,
        collectCash: order.paymentMethod === "cash" ? order.total : 0,
        createdAt: order.createdAt,
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[dispatch] portal externo respondeu ${res.status}`);
      return null;
    }
    const data: any = await res.json().catch(() => ({}));
    return data?.id ? String(data.id) : "sent";
  } catch (e: any) {
    console.warn("[dispatch] falha a contactar portal externo:", e?.message);
    return null;
  }
}
