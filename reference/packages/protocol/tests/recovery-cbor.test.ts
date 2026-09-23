/** Raw CBOR fixtures prove recovery independence from unsupported or oversized settlement bodies. */
import { describe, expect, it } from "vitest";
import {
  bytes,
  constr,
  decodeData,
  encodeData,
  hex,
  MAGIC,
  type PlutusData,
  recoveryData,
  requestFromData,
  requestRecoveryFromCbor,
  requestRecoveryFromData,
} from "../src/index.js";
import { request } from "./fixtures/example.js";

const recovery = recoveryData(request.recovery);
const recoveryHex = hex(encodeData(recovery));
const bodyCases = [
  { name: "Word64 constructor beyond safe number", body: "d866821b002000000000000080", bytes: 144 },
  { name: "65-deep body", body: `${"81".repeat(65)}00`, bytes: 197 },
];

const rawRequest = (body: string): string => `d87a9f444354565302${recoveryHex}${body}ff`;

const envelope = (
  overrides: { magic?: PlutusData; version?: PlutusData; recovery?: PlutusData } = {},
): string =>
  hex(
    encodeData(
      constr(1, [
        overrides.magic ?? bytes(MAGIC),
        overrides.version ?? 2n,
        overrides.recovery ?? recovery,
        constr(999),
      ]),
    ),
  );

describe("raw CBOR recovery projection", () => {
  it.each(bodyCases)(
    "projects $name without interpreting its economic body",
    ({ body, bytes: size }) => {
      const raw = rawRequest(body);

      expect(raw.length / 2).toBe(size);

      const result = requestRecoveryFromCbor(raw);

      expect(result.recovery).toEqual(request.recovery);
      expect(hex(result.economicBodyCbor)).toBe(body);
    },
  );

  it("keeps generic decode budgets explicit while recovery bypasses economic depth", () => {
    const raw = rawRequest(`${"81".repeat(65)}00`);

    expect(() => decodeData(raw)).toThrow(/structural budget/);
    expect(requestRecoveryFromData(decodeData(raw, { maxDepth: 128 })).recovery).toEqual(
      request.recovery,
    );
    expect(requestRecoveryFromCbor(raw).recovery).toEqual(request.recovery);
  });

  it("accepts a lossless large constructor generically while strict settlement still rejects it", () => {
    const raw = rawRequest("d866821b002000000000000080");
    const parsed = decodeData(raw);

    expect(requestRecoveryFromData(parsed).economicBody).toEqual(constr(1n << 53n));
    expect(() => requestFromData(parsed)).toThrow(/RequestBody/);
  });

  it.each(["d87a84", "d866820184", "d8669f019f"])(
    "accepts equivalent outer constructor spelling %s and keeps original body bytes",
    (prefix) => {
      const indefinite = prefix === "d8669f019f";
      const raw = `${prefix}444354565302${recoveryHex}d866820080${indefinite ? "ffff" : ""}`;

      expect(requestRecoveryFromCbor(raw)).toEqual({
        recovery: request.recovery,
        economicBodyCbor: bytes("d866820080"),
      });
    },
  );

  it("rejects unknown outer versions, magic, role, arity and invalid extended alternatives", () => {
    const invalid = [
      envelope({ magic: bytes("43545654") }),
      envelope({ version: 3n }),
      envelope().replace(/^d87a/, "d879"),
      `d87a9f444354565302${recoveryHex}00${"00"}ff`,
      `d87a9f444354565302${recoveryHex}ff`,
      `d86682c2410184444354565302${recoveryHex}00`,
      `d866830184444354565302${recoveryHex}0000`,
      "80",
    ];

    for (const raw of invalid) expect(() => requestRecoveryFromCbor(raw)).toThrow();
  });

  it("still recursively validates controller, refund address, datum and deadline", () => {
    const [policy, controller, refund, deadline] = recovery.fields;

    if (
      policy === undefined ||
      controller === undefined ||
      refund === undefined ||
      deadline === undefined
    )
      throw new Error("invalid fixture");

    const invalidRecovery = [
      constr(0, [policy, constr(1, [bytes(request.recovery.controller)]), refund, deadline]),
      constr(0, [policy, constr(0, [new Uint8Array(27)]), refund, deadline]),
      constr(0, [
        policy,
        controller,
        constr(0, [constr(0, [controller, constr(0, [constr(1, [0n, 0n, 0n])])]), constr(1)]),
        deadline,
      ]),
      constr(0, [
        policy,
        controller,
        constr(0, [constr(0, [controller, constr(1)]), constr(0, [new Uint8Array(1024)])]),
        deadline,
      ]),
      constr(0, [policy, controller, refund, 0n]),
      constr(0, [policy, controller, refund, deadline, 0n]),
    ];

    for (const invalid of invalidRecovery)
      expect(() => requestRecoveryFromCbor(envelope({ recovery: invalid }))).toThrow();
  });

  it("bounds the whole item and projected fields without a settlement-body byte cap", () => {
    const raw = rawRequest(hex(encodeData(new Uint8Array(5000))));

    expect(requestRecoveryFromCbor(raw).recovery).toEqual(request.recovery);
    expect(() => requestRecoveryFromCbor(raw, { maxBytes: 4096 })).toThrow(/oversized/);
    expect(() => requestRecoveryFromCbor(raw, { maxDepth: 1 })).toThrow(/budget/);
    expect(() => requestRecoveryFromCbor(raw, { maxNodes: 1 })).toThrow(/budget/);

    for (const key of ["maxBytes", "maxDepth", "maxNodes"] as const)
      for (const value of [NaN, Infinity, -1, 0.5])
        expect(() => requestRecoveryFromCbor(raw, { [key]: value })).toThrow(
          /nonnegative safe integer/,
        );
  });

  it("rejects incomplete and trailing CBOR and reports maintained-parser exhaustion", () => {
    const raw = rawRequest("00");

    expect(() => requestRecoveryFromCbor(raw.slice(0, -2))).toThrow();
    expect(() => requestRecoveryFromCbor(`${raw}00`)).toThrow(/trailing/);
    expect(() => requestRecoveryFromCbor(rawRequest(`${"81".repeat(10000)}00`))).toThrow(
      /resource limit/i,
    );
  });
});
