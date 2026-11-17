/**
 * Money is whole shillings: "TSh 1,500", from a number or the API's decimal string. Money given
 * back reads "−TSh 1,500", the sign before the currency.
 */
export const tsh = (amount: number | string) => {
  const n = Number(amount);
  return `${n < 0 ? "−" : ""}TSh ${Math.floor(Math.abs(n)).toLocaleString("en-US")}`;
};
