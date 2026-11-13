/** Money is whole shillings: "TSh 1,500", from a number or the API's decimal string. */
export const tsh = (amount: number | string) =>
  `TSh ${Math.floor(Number(amount)).toLocaleString("en-US")}`;
