import { BadRequestException, NotFoundException, type RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { apiError } from "../core/http/error-envelope.js";
import type { WebhookRequest } from "./providers.js";

/** A provider's webhook as its provider reads it: the exact bytes, and the headers. */
export function webhookRequest(request: RawBodyRequest<Request>): WebhookRequest {
  return {
    rawBody: request.rawBody ?? Buffer.alloc(0),
    header: (name) => {
      const value = request.headers[name];
      return typeof value === "string" ? value : null;
    },
    nowSeconds: Math.floor(Date.now() / 1000),
  };
}

export const refused = () => new BadRequestException(apiError("INVALID_SIGNATURE", "Refused."));

/** A provider that isn't set up here has no webhook. */
export const noSuchProvider = () => new NotFoundException(apiError("NOT_FOUND", "Not found."));
