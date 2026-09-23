// Run from reference: node --import tsx ../docs/reviews/2026-09-18-whitepaper-conformance/probes/wire-client-probe.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import * as protocol from '../../../../reference/packages/protocol/src/index.ts';
import * as fixture from '../../../../reference/packages/protocol/tests/fixtures/example.ts';
const require = createRequire(new URL('../../../../reference/package.json', import.meta.url));
const { CML } = require('@lucid-evolution/lucid');
const findings = [];
function observe(name, fn) {
  try { const detail = fn(); findings.push({ name, accepted: true, detail }); }
  catch(error) { findings.push({ name, accepted: false, error: `${error.name}: ${error.message}` }); }
}
function clone(data) { return protocol.dataFromJson(protocol.dataToJson(data)); }
function constructorPaths(data, path = []) {
  if (protocol.isConstr(data)) return [path, ...data.fields.flatMap((item, i) => constructorPaths(item, [...path, i]))];
  return [];
}
function at(data, path) { return path.reduce((item, index) => item.fields[index], data); }
const schemas = [
  ['terms', protocol.termsData(fixture.terms), protocol.termsFromData],
  ['config', protocol.configData(fixture.config), protocol.configFromData],
  ['state', protocol.stateData(fixture.state), protocol.stateFromData],
  ['request', protocol.requestData(fixture.request), protocol.requestFromData],
  ['claim', protocol.claimData(fixture.claim), protocol.claimFromData],
];
for (const [name, sample, read] of schemas) {
  observe(`${name}: recursive extra-field rejection corpus`, () => {
    const outcomes = constructorPaths(sample).map(path => {
      const mutated = clone(sample); at(mutated, path).fields.push(0n);
      try { read(mutated); return { path, accepted: true }; } catch { return { path, accepted: false }; }
    });
    return { cases: outcomes.length, unexpectedAcceptances: outcomes.filter(x => x.accepted), outcomes };
  });
}
const recoveryHex = protocol.hex(protocol.encodeData(protocol.recoveryData(fixture.request.recovery)));
for (const [name, body] of [
  ['large-constructor', 'd866821b002000000000000080'],
  ['65-deep-economic-list', `${'81'.repeat(65)}00`],
]) {
  const raw = `d87a9f444354565302${recoveryHex}${body}ff`;
  observe(`${name}: CML accepts small Request CBOR`, () => {
    const parsed = CML.PlutusData.from_cbor_hex(raw);
    try { return { byteLength: raw.length / 2, rawCbor: raw, reencodedBytes: parsed.to_cbor_hex().length / 2 }; }
    finally { parsed.free(); }
  });
  observe(`${name}: SDK recovery from raw Request CBOR`, () => {
    const data = protocol.decodeData(raw);
    return { recoveredController: protocol.requestRecoveryFromData(data).recovery.controller };
  });
  observe(`${name}: SDK recovery with maxDepth 128 override`, () => {
    const data = protocol.decodeData(raw, { maxDepth: 128 });
    return { recoveredController: protocol.requestRecoveryFromData(data).recovery.controller };
  });
}
for (const [name, datum] of [
  ['bytes-over-settlement-cap', new Uint8Array(5000)],
  ['unsupported-constructor', protocol.constr(999)],
]) {
  const raw = protocol.constr(1, [protocol.bytes(protocol.MAGIC), 2n, protocol.recoveryData(fixture.request.recovery), datum]);
  observe(`${name}: SDK recovery projection ignores body`, () => {
    const parsed = protocol.requestRecoveryFromData(protocol.decodeData(protocol.encodeData(raw)));
    return { controller: parsed.recovery.controller };
  });
}
for (const [name, value] of [
  ['empty-native-name', { policy: fixture.policy, name: '' }],
  ['32-byte-native-name', { policy: fixture.policy, name: 'ab'.repeat(32) }],
  ['33-byte-native-name', { policy: fixture.policy, name: 'ab'.repeat(33) }],
]) observe(name, () => protocol.assetId(value));
for (const index of [0n,65535n,65536n,-1n]) observe(`OutRef index ${index}`, () => protocol.refId({txId:fixture.stateRef.txId,index}));
observe('Terms domains are explicit 14 bytes with trailing zero', () => ({ hex:protocol.TERMS_DOMAIN, bytes:protocol.bytes(protocol.TERMS_DOMAIN).length, hash:protocol.termsHash(fixture.terms) }));
observe('Reordered opaque map changes Terms commitment', () => {
  const a={...fixture.terms,feeDestination:{...fixture.destination,datum:{map:[[1n,2n],[3n,4n]]}}};
  const b={...fixture.terms,feeDestination:{...fixture.destination,datum:{map:[[3n,4n],[1n,2n]]}}};
  return { orderedHash:protocol.termsHash(a), reorderedHash:protocol.termsHash(b), distinct:protocol.termsHash(a)!==protocol.termsHash(b) };
});
const report={scope:'wire-identity isolated offchain probes; not ledger acceptance', findings};
writeFileSync(new URL('./wire-client-probe.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
