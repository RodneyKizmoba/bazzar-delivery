import { QueryClient } from "@tanstack/react-query";

/** Erro devolvido pela API, com mensagem pronta a mostrar ao utilizador. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public errors?: { path: string; message: string }[]) {
    super(message);
  }
}

export async function api<T = any>(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.errors?.length ? `: ${data.errors.map((e: any) => e.message).join("; ")}` : "";
    throw new ApiError(res.status, (data?.message || res.statusText || "Erro") + (data?.code === "VALIDATION_ERROR" ? detail : ""), data?.code, data?.errors);
  }
  return data as T;
}

export const get = <T = any>(url: string) => api<T>("GET", url);
export const post = <T = any>(url: string, body?: unknown, headers?: Record<string, string>) => api<T>("POST", url, body ?? {}, headers);
export const put = <T = any>(url: string, body?: unknown) => api<T>("PUT", url, body ?? {});
export const patch = <T = any>(url: string, body?: unknown) => api<T>("PATCH", url, body ?? {});
export const del = <T = any>(url: string, headers?: Record<string, string>) => api<T>("DELETE", url, undefined, headers);

/**
 * React Query: a chave da query é o URL. Ex.: useQuery({ queryKey: ["/api/stores/1"] })
 * Para URLs com parâmetros use a string completa: ["/api/stores?q=frango"].
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: ({ queryKey }) => get(queryKey[0] as string),
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});
