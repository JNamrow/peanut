import { describe, expect, it } from "vitest";
import {
  financyAccountName,
  financyCategoryKey,
  financyCategoryName,
  financyMask,
  financyTxnAmount,
  financyTxnDate,
  financyTxnName,
  financyWindow,
  mapFinancyAccountType,
  pickFinancyBalance,
  prettyFinancyCategory,
  prettyFinancyInstitution,
  type FinancyTransaction,
} from "./financy-map";

describe("Financy accounts", () => {
  it("maps Financy account types onto Peanut's", () => {
    expect(mapFinancyAccountType("CHECKING")).toBe("checking");
    expect(mapFinancyAccountType("CARD")).toBe("credit");
    expect(mapFinancyAccountType("SAVINGS")).toBe("savings");
    expect(mapFinancyAccountType("LOAN")).toBe("loan");
    expect(mapFinancyAccountType("SECURITIES")).toBe("investment");
    expect(mapFinancyAccountType(undefined)).toBe("other_asset");
  });

  it("reads both documented balance shapes and keeps liabilities negative", () => {
    expect(
      pickFinancyBalance({
        id: "a",
        accountType: "CHECKING",
        balances: [{ amount: 4210.55, currency: "ILS" }],
      }),
    ).toEqual({ current: 4210.55, available: null });

    expect(
      pickFinancyBalance({
        id: "b",
        accountType: "CARD",
        balances: [
          { balanceType: "interimAvailable", balanceAmount: { amount: 1000, currency: "ILS" } },
          { balanceType: "closingBooked", balanceAmount: { amount: 2345.678, currency: "ILS" } },
        ],
      }),
    ).toEqual({ current: -2345.68, available: 1000 });

    expect(pickFinancyBalance({ id: "c", accountType: "SAVINGS", balances: [] })).toEqual({
      current: null,
      available: null,
    });
  });

  it("names, institutions and masks", () => {
    expect(
      financyAccountName({ id: "a", providerId: "hapoalim", accountType: "CHECKING" }),
    ).toBe("Bank Hapoalim Checking");
    expect(
      financyAccountName({ id: "a", providerId: "max", accountType: "CARD", accountName: " Gold " }),
    ).toBe("Gold");
    expect(prettyFinancyInstitution("max-sandbox")).toBe("Max (sandbox)");
    expect(prettyFinancyInstitution("someNewBank")).toBe("SomeNewBank");
    expect(financyMask({ id: "a", accountNumber: "12-345-678901" })).toBe("8901");
    expect(financyMask({ id: "a", parsedAccount: { number: "77" } })).toBeNull();
  });
});

describe("Financy transactions", () => {
  const txn: FinancyTransaction = {
    id: "t1",
    accountId: "a1",
    amount: {
      chargedAmount: { amount: -87.5, currency: "ILS" },
      originalAmount: { amount: -25, currency: "USD" },
    },
    description: { description: "SHUFERSAL DEAL" },
    merchantName: "Shufersal",
    category: { main: "FOOD_&_DRINKS", sub: "GROCERIES", categorizedBy: "MCC" },
    date: { transactionDate: "2026-10-03T00:00:00.000Z", bookingDate: "2026-10-05" },
  };

  it("keeps the charged amount and Financy's sign (negative = money out)", () => {
    expect(financyTxnAmount(txn, "ILS")).toEqual({ amount: -87.5, currency: "ILS" });
  });

  it("falls back to the original amount and the account currency", () => {
    expect(
      financyTxnAmount(
        { id: "t", accountId: "a", amount: { originalAmount: { amount: 12.345 } } },
        "ILS",
      ),
    ).toEqual({ amount: 12.35, currency: "ILS" });
    expect(financyTxnAmount({ id: "t", accountId: "a" }, "ILS")).toBeNull();
  });

  it("prefers the transaction date, then booking, then value date", () => {
    expect(financyTxnDate(txn)).toBe("2026-10-03");
    expect(
      financyTxnDate({ id: "t", accountId: "a", date: { valueDate: "2026-01-02" } }),
    ).toBe("2026-01-02");
    expect(financyTxnDate({ id: "t", accountId: "a" })).toBeNull();
  });

  it("names the row after the merchant, then the description", () => {
    expect(financyTxnName(txn)).toBe("Shufersal");
    expect(financyTxnName({ ...txn, merchantName: null })).toBe("SHUFERSAL DEAL");
    expect(financyTxnName({ id: "t", accountId: "a" })).toBe("Unknown");
  });

  it("builds the category key and lets the user's Financy override win", () => {
    expect(financyCategoryKey(txn)).toBe("FOOD_&_DRINKS/GROCERIES");
    expect(
      financyCategoryKey({ ...txn, changedCategory: { main: "TRANSPORTATION", sub: "FUEL" } }),
    ).toBe("TRANSPORTATION/FUEL");
    expect(financyCategoryKey({ ...txn, category: { main: "INCOME" } })).toBe("INCOME");
    expect(financyCategoryKey({ id: "t", accountId: "a" })).toBeNull();
  });

  it("bridges known categories to Peanut's and prettifies the rest", () => {
    expect(financyCategoryName("FOOD_&_DRINKS/GROCERIES")).toBe("Groceries");
    expect(financyCategoryName("TRANSPORTATION/FUEL")).toBe("Gas");
    expect(financyCategoryName("INCOME/SALARY")).toBe("Paychecks");
    expect(financyCategoryName("MYSTERY/SOME_THING")).toBeNull();
    expect(prettyFinancyCategory("MYSTERY/SOME_THING")).toBe("Some Thing");
    expect(prettyFinancyCategory("FOOD_&_DRINKS")).toBe("Food & Drinks");
  });
});

describe("Financy sync window", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  it("pulls 12 months first, then the last 45 days", () => {
    expect(financyWindow(null, undefined, now)).toEqual({
      dateFrom: "2025-10-28",
      dateTo: "2026-10-28",
    });
    expect(financyWindow("2026-10-01T00:00:00Z", undefined, now).dateFrom).toBe("2026-09-13");
    expect(financyWindow(null, 3, now).dateFrom).toBe("2026-07-28");
  });
});
