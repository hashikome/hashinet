import { HttpException, HttpStatus } from "@nestjs/common";
import type { Request } from "express";
import { apiError } from "../../core/http/error-envelope.js";
import { MAX_UPLOAD_BYTES } from "./brand-images.js";

const tooLarge = () =>
  new HttpException(
    apiError("IMAGE_TOO_LARGE", "That image is too large: 8 MB at most."),
    HttpStatus.PAYLOAD_TOO_LARGE,
  );

/** The image is the request's body. Stops reading at the limit, so a large one costs nothing. */
export async function readUpload(request: Request): Promise<Uint8Array> {
  if (Number(request.headers["content-length"] ?? 0) > MAX_UPLOAD_BYTES) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > MAX_UPLOAD_BYTES) throw tooLarge();
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}
