import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (msg: string, code?: string) => new HttpError(400, msg, code);
export const notFound = (msg = "Não encontrado") => new HttpError(404, msg, "NOT_FOUND");
export const forbidden = (msg = "Sem permissão") => new HttpError(403, msg, "FORBIDDEN");
export const conflict = (msg: string, code?: string) => new HttpError(409, msg, code);

/** Envolve um handler async para encaminhar erros para o error handler. */
export const ah = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export function idParam(req: Request, name = "id"): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw badRequest("ID inválido", "INVALID_ID");
  return n;
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      message: "Dados inválidos",
      code: "VALIDATION_ERROR",
      errors: err.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, code: err.code, details: err.details });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "JSON inválido", code: "BAD_JSON" });
  }
  console.error("[erro]", err);
  res.status(500).json({ message: "Erro interno do servidor", code: "INTERNAL" });
}
