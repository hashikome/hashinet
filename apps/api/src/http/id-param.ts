import { NotFoundException, ParseUUIDPipe } from "@nestjs/common";
import { apiError } from "./error-envelope.js";

/** An id in the path: anything that is not a UUID names nothing, so it is not found. */
export const idParam = () =>
  new ParseUUIDPipe({
    exceptionFactory: () => new NotFoundException(apiError("NOT_FOUND", "Not found.")),
  });
