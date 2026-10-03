/**
 * Autentizace push endpointu.
 *
 * ⛔ PŘEGENEROVÁNÍ NENÍ VEŘEJNÁ OPERACE. Bez ověření by kdokoli mohl opakovaným
 * voláním nutit službu tahat všechny publikované stránky z databáze — tedy DoS
 * páka, ne jen zbytečná práce. Čtení generovaných stránek je veřejné (servíruje
 * je nginx), ale jejich VÝROBA je service-to-service operace.
 *
 * Volající je gateway nebo cron se sdíleným service tokenem — týž vzor
 * a týž sdílený primitiv (`verifyServiceRole` z `@aisha/security`), jaký
 * používají sourozenecké služby. Konstantní porovnání řeší primitiv, ne my.
 */
import { verifyServiceRole } from "@aisha/security";
import type { FastifyReply, FastifyRequest } from "fastify";

export class AuthError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Ověří, že volající je oprávněná služba. Vyhazuje `AuthError`, nikdy
 * neprozrazuje důvod — rozlišený důvod by z endpointu udělal orákulum
 * na platnost tokenu.
 */
export function verifyToken(authorizationHeader: string | undefined, serviceToken: string): void {
  try {
    verifyServiceRole(authorizationHeader, serviceToken);
  } catch {
    throw new AuthError(401, "unauthorized");
  }
}

/** Fastify preHandler: pustí dál jen oprávněnou službu. */
export function requireService(serviceToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      verifyToken(request.headers.authorization, serviceToken);
    } catch {
      await reply.code(401).send({ ok: false, duvod: "unauthorized" });
    }
  };
}
