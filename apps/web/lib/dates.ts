/** Dates as HashiNet's pages say them, in the business's time zone (Africa/Dar_es_Salaam). */
const ZONE = "Africa/Dar_es_Salaam";

/** "Friday 13 November". */
export const dayName = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: ZONE,
  });

/** "13 November 2026". */
export const longDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: ZONE,
  });

/** "13 Nov 2026". */
export const shortDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: ZONE,
  });

/** "18:04". */
export const clock = (d: Date | string) =>
  new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: ZONE });

/** "13 Nov, 18:04". */
export const when = (d: Date | string) =>
  `${new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: ZONE })}, ${clock(d)}`;

/** "Friday", the weekday a week ago today. */
export const weekday = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", { weekday: "long", timeZone: ZONE });
