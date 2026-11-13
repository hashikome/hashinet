import { NotFoundException } from "@nestjs/common";
import { apiError } from "../http/error-envelope.js";

/** A venue outside the reader's reach is answered as not found, never as forbidden. */
export const venueNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That venue does not exist."));
