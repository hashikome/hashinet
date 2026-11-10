import type { PackageRecord } from "@hashinet/types";

/** A package as `PUT /api/packages/:id` takes it: updates replace the whole package. */
export function packageBody(pkg: PackageRecord) {
  const { id: _id, createdAt: _created, updatedAt: _updated, ...fields } = pkg;
  return { ...fields, priceTsh: Number(fields.priceTsh) };
}
